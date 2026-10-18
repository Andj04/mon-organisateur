// Rangement automatique des tâches : un classifieur bayésien naïf, entièrement local.
// Il part des noms et descriptions des projets, puis apprend de chaque tâche et surtout de chaque correction.
import { tokens } from './text.js';

export const CORRECTION_WEIGHT = 3;
const MIN_CONFIDENCE = 0.35;

export function learn(model, text, projectId, weight = 1) {
  if (!projectId) return;
  const words = (model.words[projectId] ||= {});
  for (const t of tokens(text)) words[t] = (words[t] || 0) + weight;
  model.docs[projectId] = (model.docs[projectId] || 0) + weight;
}

export function unlearn(model, text, projectId, weight = 1) {
  const words = projectId && model.words[projectId];
  if (!words) return;
  for (const t of tokens(text)) {
    words[t] = (words[t] || 0) - weight;
    if (words[t] <= 0) delete words[t];
  }
  model.docs[projectId] = Math.max(0, (model.docs[projectId] || 0) - weight);
}

export function forget(model, projectId) {
  delete model.words[projectId];
  delete model.docs[projectId];
}

// Renvoie { projectId, confidence } ou null si aucun mot connu.
export function predict(model, text, projects) {
  const toks = tokens(text);
  const active = projects.filter((p) => !p.archived);
  if (!toks.length || !active.length) return null;

  const tables = active.map((p) => {
    const counts = { ...(model.words[p.id] || {}) };
    for (const t of tokens(p.name)) counts[t] = (counts[t] || 0) + 3;
    for (const t of tokens(p.description)) counts[t] = (counts[t] || 0) + 1;
    let total = 0;
    for (const k in counts) total += counts[k];
    return { p, counts, total };
  });

  const vocab = new Set();
  for (const t of tables) for (const k in t.counts) vocab.add(k);
  const known = toks.filter((t) => vocab.has(t));
  if (!known.length) return null;

  const V = vocab.size;
  const totalDocs = active.reduce((a, p) => a + (model.docs[p.id] || 0), 0);
  const scores = tables.map(({ p, counts, total }) => {
    let s = Math.log(((model.docs[p.id] || 0) + 1) / (totalDocs + active.length));
    for (const t of known) s += Math.log(((counts[t] || 0) + 0.5) / (total + 0.5 * V));
    return { p, s };
  });

  const max = Math.max(...scores.map((x) => x.s));
  const exps = scores.map((x) => ({ p: x.p, e: Math.exp(x.s - max) }));
  const sum = exps.reduce((a, x) => a + x.e, 0);
  exps.sort((a, b) => b.e - a.e);
  const confidence = exps[0].e / sum;
  if (active.length > 1 && confidence < MIN_CONFIDENCE) return null;
  return { projectId: exps[0].p.id, confidence };
}
