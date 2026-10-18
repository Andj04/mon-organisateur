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

// Réponse du chat : { reply, actions }. Si l'IA a répondu en texte simple, on garde le texte.
export function parseAssistantReply(text) {
  const clean = String(text || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
  try {
    const data = JSON.parse(clean);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { reply: String(data.reply || '').trim(), actions: Array.isArray(data.actions) ? data.actions : [] };
    }
  } catch { /* texte simple */ }
  return { reply: clean, actions: [] };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const validDate = (s) => ISO.test(s) && !isNaN(Date.parse(s + 'T00:00:00'));

// Ne garde que les ajouts de tâches et d'événements complets et valides.
export function normalizeActions(list, projects) {
  const out = [];
  for (const a of Array.isArray(list) ? list.slice(0, 10) : []) {
    const title = String(a?.title || '').trim().slice(0, 140);
    if (!title) continue;
    if (a.type === 'add_task') {
      const project = a.project
        ? projects.find((p) => !p.archived && normalize(p.name) === normalize(String(a.project)))
        : null;
      let recurrence = null;
      if (a.recurrence?.freq === 'daily') recurrence = { freq: 'daily', days: [] };
      if (a.recurrence?.freq === 'weekly') {
        const days = [...new Set((a.recurrence.days || []).map(Number).filter((d) => d >= 0 && d <= 6))];
        recurrence = { freq: 'weekly', days };
      }
      out.push({
        type: 'task', title,
        due: validDate(a.due) ? a.due : null,
        time: HM.test(a.time) ? a.time : null,
        priority: [0, 1, 2, 3].includes(Number(a.priority)) ? Number(a.priority) : 0,
        projectId: project ? project.id : null,
        projectGiven: Boolean(a.project),
        recurrence,
      });
    } else if (a.type === 'add_event') {
      if (!validDate(a.date)) continue; // pas de date, pas d'événement
      const start = HM.test(a.start) ? a.start : null;
      const end = start && HM.test(a.end) && a.end > start ? a.end : null;
      out.push({
        type: 'event', title, date: a.date, start, end,
        allDay: !start, location: String(a.location || '').trim().slice(0, 100),
      });
    }
  }
  return out;
}
