// État de l'application : chargé depuis l'appareil, sauvegardé à chaque modification.
import { load, save } from './db.js';

export const SCHEMA_VERSION = 2;

// Données partagées entre appareils (synchronisées avec Google Drive).
// Les mails eux-mêmes restent sur chaque appareil : seuls les comptes et leurs autorisations circulent.
export const SYNC_KEYS = ['projects', 'tasks', 'events', 'ideas', 'followups', 'log', 'model', 'stats', 'deleted', 'shared', 'chats', 'accounts', 'vault'];

const defaults = () => ({
  version: SCHEMA_VERSION,
  savedAt: 0,
  projects: [],
  tasks: [],
  events: [], // { id, title, date, start, end, allDay, location, notes, source, updatedAt }
  ideas: [], // { id, text, createdAt, updatedAt }
  followups: [], // { id, person, subject, kind: 'relancer'|'attente', since, remindOn, done, link, updatedAt }
  log: [], // tâches terminées : { taskId, projectId, title, at }
  model: { words: {}, docs: {} },
  stats: { autoKept: 0, autoFixed: 0 },
  deleted: {}, // éléments supprimés : { id: date }, pour que la suppression se propage aux autres appareils
  shared: {
    name: '', lastReview: null, timetable: { filiere: 'Conseil', option: 'GI', groupe: '7' },
    prefs: {
      mailConsent: false, // autorise l'assistant à lire objet, expéditeur et court extrait des mails
      autoMailTasks: true, // analyse automatique des nouveaux mails (si autorisé)
      briefing: true, // résumé du matin
    },
  },
  // Coffre synchronisé dans ton Drive : mot de passe de l'assistant et autorisations Google longue durée.
  vault: { appPassword: '', refresh: {}, updatedAt: 0 },
  // Propre à cet appareil :
  settings: {
    notifications: false, lastSummary: null, syncEnabled: false, driveEmail: '',
  },
  accounts: [], // comptes mail : { id, type: 'gmail'|'outlook', email, createdAt }
  mails: {}, // cache local : { [accountId]: { fetchedAt, items: [] } }
  sync: { lastSync: null, status: 'off', error: '' },
  mailProposals: { items: [], analyzed: {}, lastRun: null, running: false, error: '' }, // tâches proposées depuis les mails
  briefing: { date: null, text: '', loading: false, error: '' }, // résumé du matin
  chats: [], // historique de l'assistant : { id, title, messages, createdAt, updatedAt }, 10 au maximum
});

export let state = defaults();
const listeners = new Set();
let undoSnapshot = null;
let saveTimer = null;
let pendingSince = 0; // première modification non encore sauvegardée

function migrate(s) {
  const d = defaults();
  const out = { ...d, ...s };
  for (const k of ['model', 'stats', 'settings', 'sync', 'shared', 'mailProposals', 'briefing', 'vault']) out[k] = { ...d[k], ...(s[k] || {}) };
  out.shared.timetable = { ...d.shared.timetable, ...(s.shared?.timetable || {}) };
  out.shared.prefs = { ...d.shared.prefs, ...(s.shared?.prefs || {}) };
  // Version précédente : ces réglages étaient propres à l'appareil.
  for (const k of Object.keys(d.shared.prefs)) if (s.settings && k in s.settings && !s.shared?.prefs) out.shared.prefs[k] = s.settings[k];
  out.vault.refresh = { ...(s.vault?.refresh || {}) };
  out.accounts = (out.accounts || []).map((a) => ({ createdAt: 1, ...a }));
  // Version 1 : le prénom était dans les réglages locaux.
  if (s.settings?.name && !s.shared?.name) out.shared.name = s.settings.name;
  // Un chargement interrompu ne doit pas rester bloqué au redémarrage.
  out.mailProposals.running = false;
  out.briefing.loading = false;
  out.version = SCHEMA_VERSION;
  return out;
}

export async function initStore() {
  const saved = await load('state');
  if (saved) state = migrate(saved);
}

// silent : modification technique (synchro), ne déclenche pas de nouvelle synchro.
export function update(fn, { undoable = false, silent = false } = {}) {
  if (undoable) undoSnapshot = JSON.stringify(state);
  fn(state);
  if (!silent) state.savedAt = Date.now();
  persist();
  emit({ silent });
}

export function undo() {
  if (!undoSnapshot) return;
  state = JSON.parse(undoSnapshot);
  state.savedAt = Date.now();
  undoSnapshot = null;
  persist();
  emit({});
}

export function replaceState(next) {
  state = migrate(next);
  state.savedAt = Date.now();
  persist(true);
  emit({});
}

export function resetState() {
  state = defaults();
  persist(true);
  emit({});
}

// Sauvegarde regroupée après une courte pause, mais jamais retardée de plus d'une seconde.
function persist(now = false) {
  clearTimeout(saveTimer);
  if (!pendingSince) pendingSince = Date.now();
  const write = () => { pendingSince = 0; return save('state', state); };
  if (now || Date.now() - pendingSince > 1000) return write();
  saveTimer = setTimeout(write, 120);
}

export function flush() {
  clearTimeout(saveTimer);
  pendingSince = 0;
  return save('state', state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(info) {
  for (const fn of listeners) fn(state, info);
}

export const uid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Mot de passe de l'assistant : gardé sur l'appareil et dans le coffre synchronisé.
export const appPassword = () => local.get('app-password') || state.vault.appPassword || '';
export function setAppPassword(value) {
  local.set('app-password', value);
  update((s) => { s.vault.appPassword = value; s.vault.updatedAt = Date.now(); });
}

// Autorisations Google longue durée, synchronisées entre appareils.
export const getRefresh = (key) => state.vault.refresh[key] || null;
export function setRefresh(key, token) {
  update((s) => {
    if (token) s.vault.refresh[key] = token; else delete s.vault.refresh[key];
    s.vault.updatedAt = Date.now();
  });
}

// Préférences propres à l'appareil, hors base (thème).
export const local = {
  get(key, fallback = '') {
    try { return localStorage.getItem('mo-' + key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { if (value === '' || value == null) localStorage.removeItem('mo-' + key); else localStorage.setItem('mo-' + key, value); } catch { /* stockage indisponible */ }
  },
};
