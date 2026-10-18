// État de l'application : chargé depuis l'appareil, sauvegardé à chaque modification.
import { load, save } from './db.js';

export const SCHEMA_VERSION = 1;

const defaults = () => ({
  version: SCHEMA_VERSION,
  projects: [],
  tasks: [],
  log: [], // historique des tâches terminées : { taskId, projectId, title, at }
  model: { words: {}, docs: {} },
  stats: { autoKept: 0, autoFixed: 0 },
  settings: { name: '', notifications: false, lastSummary: null },
});

export let state = defaults();
const listeners = new Set();
let undoSnapshot = null;
let saveTimer = null;

function migrate(s) {
  const d = defaults();
  return {
    ...d,
    ...s,
    model: { ...d.model, ...s.model },
    stats: { ...d.stats, ...s.stats },
    settings: { ...d.settings, ...s.settings },
  };
}

export async function initStore() {
  const saved = await load('state');
  if (saved) state = migrate(saved);
}

export function update(fn, { undoable = false } = {}) {
  if (undoable) undoSnapshot = JSON.stringify(state);
  fn(state);
  persist();
  emit();
}

export function undo() {
  if (!undoSnapshot) return;
  state = JSON.parse(undoSnapshot);
  undoSnapshot = null;
  persist();
  emit();
}

export function replaceState(next) {
  state = migrate(next);
  persist(true);
  emit();
}

export function resetState() {
  state = defaults();
  persist(true);
  emit();
}

function persist(now = false) {
  clearTimeout(saveTimer);
  if (now) return save('state', state);
  saveTimer = setTimeout(() => save('state', state), 120);
}

export function flush() {
  clearTimeout(saveTimer);
  return save('state', state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

export const uid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2));
