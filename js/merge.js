// Fusion de deux versions des données (cet appareil et Google Drive).
// Pour chaque élément, la version modifiée le plus récemment l'emporte ; une suppression l'emporte
// sur toute modification plus ancienne.
const LISTS = ['projects', 'tasks', 'events', 'ideas', 'followups'];
const TOMBSTONE_DAYS = 90;

const stamp = (x) => x.updatedAt || x.lastActivity || x.createdAt || 0;

function mergeList(a = [], b = [], deleted) {
  const byId = new Map();
  for (const x of [...a, ...b]) {
    const cur = byId.get(x.id);
    if (!cur || stamp(x) > stamp(cur)) byId.set(x.id, x);
  }
  return [...byId.values()].filter((x) => !(deleted[x.id] && deleted[x.id] >= stamp(x)));
}

export function mergeData(a, b) {
  const deleted = { ...(a.deleted || {}) };
  for (const [id, at] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, at);
  const limit = Date.now() - TOMBSTONE_DAYS * 86400000;
  for (const id of Object.keys(deleted)) if (deleted[id] < limit) delete deleted[id];

  const newer = (a.savedAt || 0) >= (b.savedAt || 0) ? a : b;
  const out = { deleted, savedAt: Math.max(a.savedAt || 0, b.savedAt || 0) };
  for (const k of LISTS) out[k] = mergeList(a[k], b[k], deleted);

  const seen = new Set();
  out.log = [...(a.log || []), ...(b.log || [])]
    .filter((l) => { const k = l.taskId + ':' + l.at; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => x.at - y.at)
    .slice(-2000);

  out.model = newer.model || a.model || b.model;
  out.stats = newer.stats || a.stats || b.stats;
  out.shared = newer.shared || a.shared || b.shared;
  return out;
}
