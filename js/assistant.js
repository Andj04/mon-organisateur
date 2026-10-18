// Assistant conversationnel (Gemini via le relais Vercel).
// Seuls des titres, dates et noms sont envoyés : jamais le contenu des mails ni les notes.
import { state, local, update } from './store.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { todayISO, addDays, fmt, diffDays, toISO } from './dates.js';
import { getProject, openTasks, inactiveProjects } from './actions.js';
import { recurrenceLabel } from './recurrence.js';
import { toast } from './toast.js';
import { allMails } from './mail.js';

const messages = []; // conversation de la session : { role: 'user'|'assistant', text }
let pending = false;
const PRIORITY = ['', 'basse', 'moyenne', 'haute'];

export async function callAssistantApi(payload) {
  const password = local.get('app-password');
  if (!password) throw new Error('Saisis d\'abord le mot de passe de l\'assistant dans Réglages.');
  let res;
  try {
    res = await fetch('api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-password': password },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Pas de connexion internet.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data.text || '';
}

// Résumé compact des données, envoyé avec chaque question.
export function buildContext() {
  const today = todayISO();
  const lines = [];
  const day = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  lines.push(`Aujourd'hui : ${fmt(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`);

  lines.push('\nPROJETS (nom | dernière activité | tâches ouvertes | seuil d\'alerte) :');
  for (const p of state.projects.filter((x) => !x.archived)) {
    const open = state.tasks.filter((t) => t.projectId === p.id && !t.done).length;
    const days = diffDays(today, toISO(new Date(p.lastActivity || p.createdAt)));
    lines.push(`- ${p.name} | il y a ${days} j | ${open} | ${p.inactivityDays || 'aucun'} j`);
  }
  const inactive = inactiveProjects();
  if (inactive.length) lines.push(`Projets considérés comme négligés : ${inactive.map((x) => x.p.name).join(', ')}.`);

  lines.push('\nTÂCHES OUVERTES (titre | projet | échéance | priorité | répétition | état) :');
  for (const t of openTasks().slice(0, 150)) {
    const p = getProject(t.projectId);
    lines.push(`- ${t.title} | ${p ? p.name : 'sans projet'} | ${t.due ? day(t.due) + (t.time ? ' ' + t.time : '') : 'sans date'}${t.due && t.due < today ? ' (EN RETARD)' : ''} | ${PRIORITY[t.priority] || '-'} | ${recurrenceLabel(t.recurrence) || '-'} | ${t.blocked ? 'bloquée' : '-'}`);
  }

  const weekAgo = Date.now() - 7 * 86400000;
  const done = state.log.filter((l) => l.at >= weekAgo);
  if (done.length) lines.push(`\nTÂCHES TERMINÉES CES 7 DERNIERS JOURS : ${done.map((l) => l.title).slice(-40).join(' ; ')}`);

  const end = addDays(today, 14);
  const events = state.events.filter((e) => e.date >= today && e.date <= end)
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  lines.push('\nAGENDA DES 14 PROCHAINS JOURS :');
  for (const e of events.slice(0, 120)) lines.push(`- ${day(e.date)} ${e.allDay ? 'journée' : `${e.start || ''}-${e.end || ''}`} : ${e.title}${e.location ? ' (' + e.location + ')' : ''}`);

  const follow = state.followups.filter((f) => !f.done);
  if (follow.length) {
    lines.push('\nRELANCES :');
    for (const f of follow) lines.push(`- ${f.kind === 'relancer' ? 'À relancer' : 'Attend une réponse de'} ${f.person} : ${f.subject} (depuis ${day(f.since)})`);
  }
  // Mails : seulement si tu l'as autorisé, et uniquement expéditeur, objet et date.
  if (state.settings.mailConsent) {
    const since = Date.now() - 7 * 86400000;
    const mails = allMails().filter((m) => m.date >= since && !m.promo).slice(0, 25);
    if (mails.length) {
      lines.push('\nMAILS DES 7 DERNIERS JOURS (expéditeur | objet | reçu le) :');
      for (const m of mails) lines.push(`- ${m.fromName || m.fromEmail} | ${m.subject} | ${day(toISO(new Date(m.date)))}${m.important ? ' (important)' : ''}`);
    }
  }
  return lines.join('\n');
}

function systemPrompt() {
  const name = state.shared.name || 'l\'utilisateur';
  return `Tu es l'assistant personnel d'organisation de ${name}, étudiant en dernière année d'école d'ingénieurs et président d'une association de conseil.
Réponds en français, de façon brève, concrète et bienveillante. Utilise des listes courtes.
Base-toi UNIQUEMENT sur les données ci-dessous. Si une information n'y figure pas, dis-le simplement, sans inventer.
N'utilise pas de tiret long.

${buildContext()}`;
}

// Mise en forme simple et sûre : gras et listes.
export function formatAnswer(text) {
  const safe = esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out = [];
  let list = false;
  for (const line of safe.split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${m[1]}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (line.trim()) out.push(`<p>${line.replace(/^#+\s*/, '')}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

const SUGGESTIONS = [
  'Qu\'est-ce que j\'ai cette semaine ?',
  'Quels projets je néglige ?',
  'Par quoi je commence aujourd\'hui ?',
  'Qu\'est-ce qui est en retard ?',
];

export function assistantView() {
  const configured = Boolean(local.get('app-password'));
  return `
  <div class="page-head"><h1>Assistant</h1>${messages.length ? `<button class="btn ghost" data-action="chat-clear">${icon('trash')}<span>Effacer</span></button>` : ''}</div>
  ${configured ? '' : `<div class="card form-card"><p class="fine">${icon('alert')}Pour utiliser l'assistant, saisis le mot de passe choisi sur Vercel dans <a href="#/reglages"><b>Réglages</b></a>.</p></div>`}
  <div class="chat" id="chat">
    ${messages.length ? '' : `
      <div class="chat-hello">${icon('sparkles', 'empty-ic')}<h3>Pose-moi une question</h3>
      <p>Je connais tes projets, tâches, relances et ton agenda.${state.settings.mailConsent ? ' Je vois aussi l\'expéditeur et l\'objet de tes mails récents.' : ' Je ne lis pas tes mails (tu peux l\'autoriser dans Réglages).'}</p></div>`}
    ${messages.map((m) => `<div class="bubble ${m.role}">${m.role === 'assistant' ? formatAnswer(m.text) : `<p>${esc(m.text)}</p>`}</div>`).join('')}
    ${pending ? '<div class="bubble assistant typing"><i></i><i></i><i></i></div>' : ''}
  </div>
  <div class="chat-suggestions chips scroll-x">${state.settings.mailConsent && state.accounts.length ? `<button class="chip on" data-action="analyze-mails">${icon('mail')}Trouver des tâches dans mes mails</button>` : ''}${SUGGESTIONS.map((s) => `<button class="chip" data-action="chat-suggest">${esc(s)}</button>`).join('')}</div>
  <form class="chat-input card" data-form="chat">
    <textarea name="q" rows="1" placeholder="Ta question…" enterkeyhint="send" ${pending ? 'disabled' : ''}></textarea>
    <button class="icon-btn send" type="submit" aria-label="Envoyer" ${pending ? 'disabled' : ''}>${icon('next')}</button>
  </form>
  <details class="fine-details"><summary>Ce qui est envoyé à Gemini</summary><pre>${esc(buildContext())}</pre></details>`;
}

async function ask(question) {
  if (!question.trim() || pending) return;
  messages.push({ role: 'user', text: question.trim() });
  pending = true;
  update(() => {}, { silent: true });
  try {
    const text = await callAssistantApi({ kind: 'chat', system: systemPrompt(), messages });
    messages.push({ role: 'assistant', text: text || 'Je n\'ai pas de réponse.' });
  } catch (e) {
    messages.push({ role: 'assistant', text: `⚠️ ${e.message}` });
  } finally {
    pending = false;
    update(() => {}, { silent: true });
    requestAnimationFrame(() => document.querySelector('.bubble:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

export const assistantHandlers = {
  'chat-suggest': (el) => ask(el.textContent),
  'chat-clear': () => { messages.length = 0; update(() => {}, { silent: true }); },
};

export function onChatSubmit(form) {
  const q = form.q.value;
  form.q.value = '';
  ask(q);
}

export function testAssistant() {
  return callAssistantApi({ kind: 'chat', system: 'Réponds seulement "OK".', messages: [{ role: 'user', text: 'Test' }] })
    .then(() => toast('Assistant connecté'))
    .catch((e) => toast(e.message));
}
