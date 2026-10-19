// Connexion aux comptes Google (Drive, Gmail, Agenda).
// Si GOOGLE_CLIENT_SECRET est configuré sur Vercel, la connexion est longue durée : l'application
// renouvelle seule l'autorisation (via api/google) et la partage entre tes appareils par la synchro.
// Sinon, repli sur une autorisation d'une heure, à renouveler par un clic.
import { getConfig } from './config.js';
import { appPassword, getRefresh, setRefresh } from './store.js';

export const SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive.appdata',
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
};

export class NeedAuthError extends Error {
  constructor() { super('Reconnexion nécessaire'); this.needAuth = true; }
}

// Jetons d'accès (une heure) : propres à l'appareil.
const readTokens = () => { try { return JSON.parse(localStorage.getItem('mo-gtokens') || '{}'); } catch { return {}; } };
const writeTokens = (t) => { try { localStorage.setItem('mo-gtokens', JSON.stringify(t)); } catch { /* indisponible */ } };
function keepAccess(key, token, expiresIn) {
  const all = readTokens();
  all[key] = { token, exp: Date.now() + Number(expiresIn || 3600) * 1000 };
  writeTokens(all);
  return token;
}

export function renameGoogleKey(from, to) {
  const all = readTokens();
  if (all[from]) { all[to] = all[from]; delete all[from]; writeTokens(all); }
  const r = getRefresh(from);
  if (r) { setRefresh(to, r); setRefresh(from, null); }
}

export function forgetGoogleToken(key) {
  const all = readTokens();
  delete all[key];
  writeTokens(all);
  if (getRefresh(key)) setRefresh(key, null);
}

async function serverCall(body) {
  const password = appPassword();
  if (!password) throw new Error('Saisis d\'abord le mot de passe de l\'application dans Réglages > Assistant.');
  const res = await fetch('api/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-password': password },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Erreur ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// ---------- Connexion longue durée (fenêtre Google classique) ----------
const redirectUri = () => new URL('auth.html', location.href).href.split('#')[0].split('?')[0];

function waitForPopup() {
  return new Promise((resolve, reject) => {
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('mo-auth') : null;
    const onData = (data) => { if (data?.type === 'ms-auth') { cleanup(); resolve(data); } };
    const onMessage = (e) => { if (e.origin === location.origin) onData(e.data); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Connexion expirée. Réessaie.')); }, 5 * 60 * 1000);
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); channel?.close(); };
    window.addEventListener('message', onMessage);
    if (channel) channel.onmessage = (e) => onData(e.data);
  });
}

// La fenêtre est ouverte tout de suite, dans le clic, pour ne pas être bloquée par le navigateur.
async function connectOffline(key, scope, email, popup) {
  const { googleClientId } = await getConfig();
  const state = 'g' + Math.random().toString(36).slice(2);
  popup.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: googleClientId, redirect_uri: redirectUri(), response_type: 'code', scope,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    ...(email ? { login_hint: email } : {}),
  });
  const result = await waitForPopup();
  if (result.error) throw new Error(result.error === 'access_denied' ? 'Connexion refusée.' : result.error_description || result.error);
  if (result.state !== state) throw new Error('Réponse de connexion invalide.');
  const data = await serverCall({ action: 'exchange', code: result.code, redirectUri: redirectUri() });
  if (data.refresh_token) setRefresh(key, data.refresh_token);
  return keepAccess(key, data.access_token, data.expires_in);
}

async function refreshAccess(key) {
  const refresh = getRefresh(key);
  if (!refresh) return null;
  try {
    const data = await serverCall({ action: 'refresh', refreshToken: refresh });
    return keepAccess(key, data.access_token, data.expires_in);
  } catch (e) {
    if (e.status === 401 && /invalid_grant|expir|revok/i.test(e.message + (e.code || ''))) setRefresh(key, null);
    if (e.status === 401) throw new NeedAuthError();
    throw e;
  }
}

// ---------- Repli : autorisation d'une heure (bibliothèque Google) ----------
let gisPromise = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => { gisPromise = null; reject(new Error('Impossible de joindre Google. Vérifie ta connexion.')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

async function connectShort(key, scope, email) {
  const { googleClientId } = await getConfig();
  if (!googleClientId) throw new Error('Connexion Google non configurée (GOOGLE_CLIENT_ID manquant sur Vercel).');
  await loadGis();
  return new Promise((resolve, reject) => {
    window.google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope,
      hint: email || undefined,
      login_hint: email || undefined,
      prompt: email ? '' : 'select_account',
      callback: (r) => {
        if (r.error) { reject(new Error(r.error_description || r.error)); return; }
        resolve(keepAccess(key, r.access_token, r.expires_in));
      },
      error_callback: (e) => {
        const messages = {
          popup_closed: 'Connexion annulée.',
          popup_failed_to_open: 'Fenêtre de connexion bloquée par le navigateur. Autorise les fenêtres pop-up pour ce site, puis réessaie.',
        };
        reject(new Error(messages[e?.type] || `Connexion Google impossible (${e?.type || 'erreur inconnue'}).`));
      },
    }).requestAccessToken();
  });
}

// Charge à l'avance la configuration (et la bibliothèque Google en mode repli), pour que la
// fenêtre de connexion s'ouvre immédiatement au clic.
let configCache = null;
// Connexion longue durée seulement si le serveur la permet et que le mot de passe de l'application est connu.
// Sur un nouvel appareil, la première connexion se fait donc en mode simple, puis la synchro apporte le reste.
const useOffline = () => Boolean(configCache?.googleOffline && appPassword());
export async function preloadGoogle() {
  try {
    configCache = await getConfig();
    if (configCache.googleClientId && !useOffline()) await loadGis();
  } catch { /* hors ligne : chargé plus tard */ }
}

// key identifie le couple (usage, compte), par exemple "gmail:moi@gmail.com".
export async function googleToken(key, scope, email, { interactive = false } = {}) {
  const saved = readTokens()[key];
  if (saved && saved.exp > Date.now() + 60000) return saved.token;

  // Ouverture de la fenêtre avant toute attente, sinon le navigateur la bloque.
  let popup = null;
  if (interactive && useOffline() && !getRefresh(key)) {
    popup = window.open('', 'g-login', 'width=500,height=680');
    if (!popup) throw new Error('Fenêtre de connexion bloquée par le navigateur. Autorise les fenêtres pop-up pour ce site, puis réessaie.');
  }
  try {
    const renewed = await refreshAccess(key).catch((e) => { if (e.needAuth && interactive) return null; throw e; });
    if (renewed) { popup?.close(); return renewed; }
    if (!interactive) throw new NeedAuthError();
    configCache ||= await getConfig();
    if (useOffline()) {
      popup ||= window.open('', 'g-login', 'width=500,height=680');
      if (!popup) throw new Error('Fenêtre de connexion bloquée par le navigateur. Autorise les fenêtres pop-up pour ce site, puis réessaie.');
      return await connectOffline(key, scope, email, popup);
    }
    await loadGis();
    return await connectShort(key, scope, email);
  } catch (e) {
    try { popup?.close(); } catch { /* déjà fermée */ }
    throw e;
  }
}

export async function googleFetch(key, scope, email, url, options = {}, interactive = false) {
  const call = async (token) => fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  let res = await call(await googleToken(key, scope, email, { interactive }));
  if (res.status === 401) {
    // Jeton refusé : on le jette et on retente une fois avec un jeton renouvelé.
    const all = readTokens();
    delete all[key];
    writeTokens(all);
    res = await call(await googleToken(key, scope, email, { interactive }));
    if (res.status === 401) throw new NeedAuthError();
  }
  if (!res.ok) {
    let msg = `Erreur Google (${res.status})`;
    try { msg = (await res.json()).error?.message || msg; } catch { /* réponse vide */ }
    throw new Error(msg);
  }
  return res;
}
