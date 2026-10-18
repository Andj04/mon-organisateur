// Connexion Outlook / Microsoft 365 en lecture seule (Mail.Read), sans serveur, avec le protocole PKCE.
import { getConfig } from './config.js';
import { NeedAuthError } from './google.js';

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const SCOPE = 'offline_access User.Read Mail.Read';
const redirectUri = () => new URL('auth.html', location.href).href.split('#')[0].split('?')[0];

const readTokens = () => { try { return JSON.parse(localStorage.getItem('mo-mstokens') || '{}'); } catch { return {}; } };
const writeTokens = (t) => { try { localStorage.setItem('mo-mstokens', JSON.stringify(t)); } catch { /* indisponible */ } };

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

async function tokenRequest(params) {
  const { microsoftClientId } = await getConfig();
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: microsoftClientId, scope: SCOPE, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description?.split('\r\n')[0] || 'Connexion Microsoft refusée.');
  return data;
}

function store(key, data) {
  const all = readTokens();
  all[key] = { token: data.access_token, refresh: data.refresh_token || all[key]?.refresh, exp: Date.now() + data.expires_in * 1000 };
  writeTokens(all);
  return all[key].token;
}

// Ouvre la fenêtre de connexion Microsoft et renvoie l'adresse du compte connecté.
export async function connectMicrosoft(emailHint = '') {
  const { microsoftClientId } = await getConfig();
  if (!microsoftClientId) throw new Error('Connexion Outlook non configurée (MICROSOFT_CLIENT_ID manquant sur Vercel).');
  const verifier = randomString();
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const stateParam = randomString();
  const url = `${AUTH}/authorize?` + new URLSearchParams({
    client_id: microsoftClientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
    scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state: stateParam,
    prompt: 'select_account', ...(emailHint ? { login_hint: emailHint } : {}),
  });
  const popup = window.open(url, 'ms-login', 'width=480,height=680');
  if (!popup) throw new Error('Fenêtre de connexion bloquée. Autorise les fenêtres surgissantes.');

  // La réponse arrive par la page auth.html (canal de diffusion, la fenêtre parente pouvant être détachée).
  const result = await new Promise((resolve, reject) => {
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('mo-auth') : null;
    const onData = (data) => { if (data?.type === 'ms-auth') { cleanup(); resolve(data); } };
    const onMessage = (e) => { if (e.origin === location.origin) onData(e.data); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Connexion expirée. Réessaie.')); }, 5 * 60 * 1000);
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); channel?.close(); };
    window.addEventListener('message', onMessage);
    if (channel) channel.onmessage = (e) => onData(e.data);
  });
  if (result.error) throw new Error(result.error_description || result.error);
  if (result.state !== stateParam) throw new Error('Réponse de connexion invalide.');

  const data = await tokenRequest({ grant_type: 'authorization_code', code: result.code, redirect_uri: redirectUri(), code_verifier: verifier });
  const tmpKey = 'tmp';
  store(tmpKey, data);
  const me = await (await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })).json();
  const email = (me.mail || me.userPrincipalName || '').toLowerCase();
  const all = readTokens();
  all['outlook:' + email] = all[tmpKey];
  delete all[tmpKey];
  writeTokens(all);
  return email;
}

export async function microsoftToken(email) {
  const key = 'outlook:' + email;
  const saved = readTokens()[key];
  if (saved && saved.exp > Date.now() + 60000) return saved.token;
  if (!saved?.refresh) throw new NeedAuthError();
  try {
    return store(key, await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refresh }));
  } catch {
    throw new NeedAuthError();
  }
}

export function forgetMicrosoft(email) {
  const all = readTokens();
  delete all['outlook:' + email];
  writeTokens(all);
}
