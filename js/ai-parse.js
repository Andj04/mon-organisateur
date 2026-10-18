// Lecture prudente des réponses de l'IA : on ne garde que ce qui est valide, rien n'est inventé côté application.
import { normalize } from './text.js';

export function parseJsonArray(text) {
  const clean = String(text || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
  try {
    const data = JSON.parse(clean);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.tasks)) return data.tasks;
  } catch { /* réponse illisible */ }
  return [];
}

// mails : [{ id, ... }] envoyés à l'IA ; projects : projets existants.
export function normalizeProposals(list, mails, projects) {
  const byId = new Map(mails.map((m) => [m.id, m]));
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const mail = byId.get(String(p?.mailId ?? ''));
    const title = String(p?.title || '').trim().slice(0, 140);
    if (!mail || !title) continue;
    const key = mail.id + '|' + normalize(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const project = p.project
      ? projects.find((x) => !x.archived && normalize(x.name) === normalize(String(p.project)))
      : null;
    out.push({
      key: 'p' + out.length,
      mailId: mail.id,
      title,
      due: /^\d{4}-\d{2}-\d{2}$/.test(p.due) ? p.due : null,
      time: /^\d{2}:\d{2}$/.test(p.time) ? p.time : null,
      priority: [0, 1, 2, 3].includes(Number(p.priority)) ? Number(p.priority) : 0,
      projectId: project ? project.id : null,
      reason: String(p.reason || '').slice(0, 160),
      checked: true,
    });
  }
  return out;
}
