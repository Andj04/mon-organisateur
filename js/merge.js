// Fusion de deux versions des données (cet appareil et Google Drive).
// Pour chaque élément, la version modifiée le plus récemment l'emporte ; une suppression l'emporte
// sur toute modification plus ancienne.
const LISTS = ['projects', 'tasks', 'events', 'ideas', 'followups', 'chats', 'accounts'];
const MAX_CHATS = 10;
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

  out.chats = out.chats.sort((x, y) => stamp(y) - stamp(x)).slice(0, MAX_CHATS);
  // Un même compte mail ajouté sur deux appareils ne doit apparaître qu'une fois.
  const seenAcc = new Set();
  out.accounts = out.accounts.sort((x, y) => stamp(x) - stamp(y)).filter((acc) => {
    const k = acc.type + ':' + acc.email;
    if (seenAcc.has(k)) return false;
    seenAcc.add(k);
    return true;
  });

  // Coffre : mot de passe le plus récent, autorisations de chaque compte réunies.
  const va = a.vault || {};
  const vb = b.vault || {};
  const newerVault = (va.updatedAt || 0) >= (vb.updatedAt || 0) ? va : vb;
  const olderVault = newerVault === va ? vb : va;
  out.vault = {
    appPassword: newerVault.appPassword || olderVault.appPassword || '',
    refresh: Object.fromEntries(Object.entries({ ...(olderVault.refresh || {}), ...(newerVault.refresh || {}) })
      // Autorisation d'un compte mail retiré : supprimée aussi.
      .filter(([k]) => !k.startsWith('gmail:') || out.accounts.some((acc) => 'gmail:' + acc.email === k))),
    updatedAt: Math.max(va.updatedAt || 0, vb.updatedAt || 0),
  };

  out.model = newer.model || a.model || b.model;
  out.stats = newer.stats || a.stats || b.stats;
  // Réglages partagés : les plus récents l'emportent, sans perdre ce qu'une ancienne version ne connaissait pas.
  const older = newer === a ? b : a;
  const os = older.shared || {};
  const ns = newer.shared || {};
  out.shared = {
    ...os, ...ns,
    timetable: { ...(os.timetable || {}), ...(ns.timetable || {}) },
    prefs: { ...(os.prefs || {}), ...(ns.prefs || {}) },
  };
  return out;
}
