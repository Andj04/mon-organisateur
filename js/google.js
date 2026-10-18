// Connexion aux comptes Google (Drive, Gmail, Agenda) directement depuis le navigateur.
// Les jetons durent une heure ; ensuite un clic sur "Reconnecter" suffit.
import { getConfig } from './config.js';

export const SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive.appdata',
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
};

export class NeedAuthError extends Error {
  constructor() { super('Reconnexion nécessaire'); this.needAuth = true; }
}

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

const readTokens = () => { try { return JSON.parse(localStorage.getItem('mo-gtokens') || '{}'); } catch { return {}; } };
const writeTokens = (t) => { try { localStorage.setItem('mo-gtokens', JSON.stringify(t)); } catch { /* indisponible */ } };

// key identifie le couple (usage, compte), par exemple "gmail:moi@gmail.com".
export async function googleToken(key, scope, email, { interactive = false } = {}) {
  const saved = readTokens()[key];
  if (saved && saved.exp > Date.now() + 60000) return saved.token;
  if (!interactive) throw new NeedAuthError();

  const { googleClientId } = await getConfig();
  if (!googleClientId) throw new Error('Connexion Google non configurée (GOOGLE_CLIENT_ID manquant sur Vercel).');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: googleClientId,
      scope,
      hint: email || undefined,
      login_hint: email || undefined,
      prompt: email ? '' : 'select_account',
      callback: (r) => {
        if (r.error) { reject(new Error(r.error_description || r.error)); return; }
        const all = readTokens();
        all[key] = { token: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 };
        writeTokens(all);
        resolve(r.access_token);
      },
      error_callback: (e) => {
        const messages = {
          popup_closed: 'Connexion annulée.',
          popup_failed_to_open: 'Fenêtre de connexion bloquée par le navigateur. Autorise les fenêtres pop-up pour ce site, puis réessaie.',
        };
        reject(new Error(messages[e?.type] || `Connexion Google impossible (${e?.type || 'erreur inconnue'}).`));
      },
    });
    client.requestAccessToken();
  });
}

// Charge le module Google dès le démarrage : la fenêtre de connexion s'ouvre alors
// immédiatement au clic, sans être prise pour une fenêtre surgissante non désirée.
export async function preloadGoogle() {
  try {
    const { googleClientId } = await getConfig();
    if (googleClientId) await loadGis();
  } catch { /* hors ligne : chargé plus tard */ }
}

export function forgetGoogleToken(key) {
  const all = readTokens();
  delete all[key];
  writeTokens(all);
}

export async function googleFetch(key, scope, email, url, options = {}, interactive = false) {
  const token = await googleToken(key, scope, email, { interactive });
  const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) { forgetGoogleToken(key); throw new NeedAuthError(); }
  if (!res.ok) {
    let msg = `Erreur Google (${res.status})`;
    try { msg = (await res.json()).error?.message || msg; } catch { /* réponse vide */ }
    throw new Error(msg);
  }
  return res;
}
