// Synchronisation entre appareils via un dossier caché de ton Google Drive (appDataFolder).
// Seul cet appareil et ton compte Google voient ce fichier.
import { state, update, subscribe, SYNC_KEYS } from './store.js';
import { googleFetch, SCOPES, NeedAuthError, forgetGoogleToken } from './google.js';
import { mergeData } from './merge.js';

const FILE_NAME = 'mon-organisateur.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
let running = null;
let timer = null;
let onSynced = () => {};
export function afterSync(fn) { onSynced = fn; }

const drive = (url, opts, interactive) =>
  googleFetch('drive', SCOPES.drive, state.settings.driveEmail, url, opts, interactive);

function payload() {
  const out = { app: 'mon-organisateur', savedAt: state.savedAt };
  for (const k of SYNC_KEYS) out[k] = state[k];
  return out;
}

function setStatus(status, error = '') {
  update((s) => { s.sync.status = status; s.sync.error = error; if (status === 'ok') s.sync.lastSync = Date.now(); }, { silent: true });
}

async function findFile(interactive) {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await drive(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`, {}, interactive);
  return (await res.json()).files?.[0] || null;
}

async function upload(fileId, data, interactive) {
  const body = JSON.stringify(data);
  if (fileId) {
    await drive(`${UPLOAD}/files/${fileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    }, interactive);
    return;
  }
  const boundary = 'mo' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  await drive(`${UPLOAD}/files?uploadType=multipart`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  }, interactive);
}

async function run(interactive) {
  setStatus('syncing');
  try {
    if (!state.settings.driveEmail || interactive) {
      const res = await drive(`${API}/about?fields=user(emailAddress)`, {}, interactive);
      const email = (await res.json()).user?.emailAddress || '';
      update((s) => { s.settings.driveEmail = email; s.settings.syncEnabled = true; }, { silent: true });
    }
    const file = await findFile(interactive);
    let merged = payload();
    if (file) {
      const remote = await (await drive(`${API}/files/${file.id}?alt=media`, {}, interactive)).json();
      merged = mergeData(merged, remote);
      update((s) => { for (const k of SYNC_KEYS) s[k] = merged[k]; s.savedAt = merged.savedAt; }, { silent: true });
    }
    await upload(file?.id, { ...payload(), savedAt: state.savedAt }, interactive);
    setStatus('ok');
    onSynced();
    return true;
  } catch (e) {
    if (e.needAuth) setStatus('reconnect');
    else setStatus('error', e.message);
    if (interactive) throw e;
    return false;
  }
}

export function syncNow({ interactive = false } = {}) {
  if (!interactive && !state.settings.syncEnabled) return Promise.resolve(false);
  running ||= run(interactive).finally(() => { running = null; });
  return running;
}

export function disconnectSync() {
  forgetGoogleToken('drive');
  update((s) => { s.settings.syncEnabled = false; s.settings.driveEmail = ''; s.sync = { lastSync: null, status: 'off', error: '' }; }, { silent: true });
}

export function startAutoSync() {
  // Après chaque modification, synchronise quelques secondes plus tard.
  subscribe((s, info) => {
    if (info.silent || !s.settings.syncEnabled || s.sync.status === 'reconnect') return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow(), 4000);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  window.addEventListener('online', () => syncNow());
  // Toutes les minutes tant que l'application est ouverte : les changements faits ailleurs arrivent vite.
  setInterval(() => { if (!document.hidden) syncNow(); }, 60 * 1000);
  syncNow();
}

export { NeedAuthError };
