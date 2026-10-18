// Assistant conversationnel (Gemini via le relais Vercel).
// Seuls des titres, dates et noms sont envoyés : jamais le contenu des mails ni les notes.
import { state, local, update, uid } from './store.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { todayISO, addDays, fmt, diffDays, toISO, timeAgo, dueLabel, weekday } from './dates.js';
import { getProject, getTask, getEvent, openTasks, inactiveProjects, createTask, saveEvent, deleteTask, deleteEvent, suggestProject } from './actions.js';
import { firstDue } from './recurrence.js';
import { parseAssistantReply, normalizeActions } from './ai-parse.js';
import { recurrenceLabel } from './recurrence.js';
import { toast } from './toast.js';
import { allMails } from './mail.js';
import { openSheet, closeSheet, openConfirm } from './sheets.js';

const MAX_CHATS = 10;
let currentId = null; // conversation affichée (null = nouvelle conversation)

const currentChat = () => state.chats.find((c) => c.id === currentId) || null;
const currentMessages = () => currentChat()?.messages || [];
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

TU PEUX AUSSI AGIR : ajouter des tâches et des événements quand l'utilisateur te le demande explicitement (« ajoute », « note », « programme », « rappelle-moi »…).
Réponds TOUJOURS avec un objet JSON valide, sans texte autour :
{"reply":"ta réponse en texte (peut contenir **gras** et des listes)","actions":[...]}
Actions possibles (laisse "actions" vide si on ne te demande pas d'ajouter quelque chose) :
- {"type":"add_task","title":"…","due":"AAAA-MM-JJ ou null","time":"HH:MM ou null","priority":0 à 3,"project":"nom exact d'un projet existant ou null","recurrence":null ou {"freq":"daily"} ou {"freq":"weekly","days":[numéros des jours, 0 = dimanche, 1 = lundi…]}}
- {"type":"add_event","title":"…","date":"AAAA-MM-JJ","start":"HH:MM ou null","end":"HH:MM ou null","location":"… ou vide"}
Règles :
- Une tâche est une chose à faire ; un événement a lieu à une date précise (réunion, rendez-vous, examen, soirée…).
- Calcule les dates relatives (demain, jeudi, la semaine prochaine…) avec le calendrier ci-dessous. N'invente jamais de date.
- S'il manque la date d'un événement, ne crée rien et demande-la dans "reply".
- Dans "reply", confirme en une phrase ce que tu as ajouté, avec la date.

CALENDRIER DES 14 PROCHAINS JOURS :
${Array.from({ length: 14 }, (_, i) => addDays(todayISO(), i)).map((d) => `${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })} = ${d}`).join('\n')}

${buildContext()}`;
}

// Exécute les ajouts demandés et renvoie de quoi afficher une carte (avec annulation) dans la conversation.
function applyActions(actions) {
  const done = [];
  const today = todayISO();
  for (const a of actions) {
    if (a.type === 'task') {
      let { due, recurrence } = a;
      if (recurrence?.freq === 'weekly' && !recurrence.days.length) recurrence = { ...recurrence, days: [weekday(due || today)] };
      if (recurrence && !due) due = firstDue(recurrence, today);
      const auto = a.projectGiven ? null : suggestProject(a.title)?.projectId ?? null;
      const projectId = a.projectId ?? auto;
      const id = createTask({ title: a.title, due, time: a.time, priority: a.priority, recurrence, projectId: null }, { projectId, auto });
      done.push({ kind: 'task', id, title: a.title, when: due ? dueLabel(due) + (a.time ? ' ' + a.time.replace(':', 'h') : '') : 'sans date', project: getProject(projectId)?.name || '' });
    } else if (a.type === 'event') {
      const id = saveEvent({ title: a.title, date: a.date, start: a.start, end: a.end, allDay: a.allDay, location: a.location, source: 'assistant' });
      done.push({ kind: 'event', id, title: a.title, when: dueLabel(a.date) + (a.start ? ' ' + a.start.replace(':', 'h') + (a.end ? '–' + a.end.replace(':', 'h') : '') : ''), project: a.location });
    }
  }
  return done;
}

function actionCards(m, chatId, index) {
  if (!m.actions?.length) return '';
  return `<div class="chat-actions">${m.actions.map((a, i) => {
    const exists = a.kind === 'task' ? getTask(a.id) : getEvent(a.id);
    const gone = a.undone || !exists;
    return `
    <div class="chat-action ${gone ? 'undone' : ''}">
      ${icon(a.kind === 'task' ? 'tasks' : 'calendar')}
      <div><strong>${gone ? 'Annulé' : a.kind === 'task' ? 'Tâche ajoutée' : 'Événement ajouté'} : ${esc(a.title)}</strong><small>${esc(a.when)}${a.project ? ' · ' + esc(a.project) : ''}</small></div>
      ${gone ? '' : `<span class="ca-btns"><button class="btn small ghost" data-action="${a.kind === 'task' ? 'open-task' : 'open-event'}" data-id="${a.id}">Ouvrir</button>
      <button class="btn small ghost danger" data-action="chat-undo" data-chat="${chatId}" data-msg="${index}" data-i="${i}">Annuler</button></span>`}
    </div>`;
  }).join('')}</div>`;
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
  'Ajoute une tâche : préparer la réunion du bureau demain à 18h',
];

export function assistantView() {
  const configured = Boolean(local.get('app-password'));
  const chat = currentChat();
  const messages = currentMessages();
  return `
  <div class="page-head"><h1>Assistant</h1>
    <div class="row-gap">
      ${state.chats.length ? `<button class="btn ghost" data-action="chat-history">${icon('clock')}<span>Historique</span></button>` : ''}
      ${messages.length ? `<button class="btn" data-action="chat-new">${icon('plus')}<span>Nouvelle</span></button>` : ''}
    </div>
  </div>
  ${chat ? `<p class="chat-title">${esc(chat.title)} · ${esc(timeAgo(chat.updatedAt))}</p>` : ''}
  ${configured ? '' : `<div class="card form-card"><p class="fine">${icon('alert')}Pour utiliser l'assistant, saisis le mot de passe choisi sur Vercel dans <a href="#/reglages"><b>Réglages</b></a>.</p></div>`}
  <div class="chat" id="chat">
    ${messages.length ? '' : `
      <div class="chat-hello">${icon('sparkles', 'empty-ic')}<h3>Pose-moi une question</h3>
      <p>Je connais tes projets, tâches, relances et ton agenda, et je peux ajouter des tâches ou des événements pour toi (« ajoute réunion du bureau jeudi à 18h »).${state.settings.mailConsent ? ' Je vois aussi l\'expéditeur et l\'objet de tes mails récents.' : ' Je ne lis pas tes mails (tu peux l\'autoriser dans Réglages).'}</p></div>`}
    ${messages.map((m, i) => `<div class="bubble ${m.role}">${m.role === 'assistant' ? formatAnswer(m.text) : `<p>${esc(m.text)}</p>`}</div>${actionCards(m, chat?.id, i)}`).join('')}
    ${pending ? '<div class="bubble assistant typing"><i></i><i></i><i></i></div>' : ''}
  </div>
  <div class="chat-suggestions chips scroll-x">${state.settings.mailConsent && state.accounts.length ? `<button class="chip on" data-action="analyze-mails">${icon('mail')}Trouver des tâches dans mes mails</button>` : ''}${SUGGESTIONS.map((s) => `<button class="chip" data-action="chat-suggest">${esc(s)}</button>`).join('')}</div>
  <form class="chat-input card" data-form="chat">
    <textarea name="q" rows="1" placeholder="Ta question…" enterkeyhint="send" ${pending ? 'disabled' : ''}></textarea>
    <button class="icon-btn send" type="submit" aria-label="Envoyer" ${pending ? 'disabled' : ''}>${icon('next')}</button>
  </form>
  <details class="fine-details"><summary>Ce qui est envoyé à Gemini</summary><pre>${esc(buildContext())}</pre></details>`;
}

// Ajoute un message à la conversation en cours (créée au premier message) et garde les 10 plus récentes.
function addMessage(msg) {
  update((s) => {
    let c = s.chats.find((x) => x.id === currentId);
    if (!c) {
      currentId = uid();
      const title = msg.text.length > 60 ? msg.text.slice(0, 57) + '…' : msg.text;
      c = { id: currentId, title, messages: [], createdAt: Date.now() };
      s.chats.unshift(c);
    }
    c.messages.push(msg);
    c.updatedAt = Date.now();
    s.chats.sort((a, b) => b.updatedAt - a.updatedAt);
    s.chats = s.chats.slice(0, MAX_CHATS);
  }, { silent: true });
}

async function ask(question) {
  if (!question.trim() || pending) return;
  addMessage({ role: 'user', text: question.trim() });
  pending = true;
  update(() => {}, { silent: true });
  try {
    // Les messages d'erreur ne sont pas renvoyés à Gemini.
    const history = currentMessages().filter((m) => !m.error);
    const raw = await callAssistantApi({ kind: 'chat', json: true, system: systemPrompt(), messages: history.map(({ role, text }) => ({ role, text })) });
    const { reply, actions } = parseAssistantReply(raw);
    const done = applyActions(normalizeActions(actions, state.projects));
    const text = reply || (done.length ? 'C\'est fait.' : 'Je n\'ai pas de réponse.');
    addMessage({ role: 'assistant', text, ...(done.length ? { actions: done } : {}) });
  } catch (e) {
    addMessage({ role: 'assistant', text: `⚠️ ${e.message}`, error: true });
  } finally {
    pending = false;
    update(() => {}, { silent: true });
    requestAnimationFrame(() => document.querySelector('.bubble:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

export const assistantHandlers = {
  'chat-suggest': (el) => ask(el.textContent),
  'chat-new': () => { currentId = null; update(() => {}, { silent: true }); },
  'chat-history': () => openHistory(),
  'chat-undo': (el) => {
    const c = state.chats.find((x) => x.id === el.dataset.chat);
    const a = c?.messages[Number(el.dataset.msg)]?.actions?.[Number(el.dataset.i)];
    if (!a || a.undone) return;
    if (a.kind === 'task') deleteTask(a.id); else deleteEvent(a.id);
    update((s) => {
      const x = s.chats.find((y) => y.id === c.id)?.messages[Number(el.dataset.msg)]?.actions?.[Number(el.dataset.i)];
      if (x) x.undone = true;
    }, { silent: true });
    toast(a.kind === 'task' ? 'Tâche supprimée' : 'Événement supprimé');
  },
};

// ---------- Historique ----------
function historyHtml() {
  if (!state.chats.length) return '<h2 class="sheet-title">Historique</h2><p class="fine">Aucune conversation enregistrée.</p>';
  return `
  <h2 class="sheet-title">Historique</h2>
  <p class="fine">Tes ${MAX_CHATS} dernières conversations, enregistrées sur cet appareil.</p>
  <div class="card list chat-list">${state.chats.map((c) => `
    <div class="row-item ${c.id === currentId ? 'current' : ''}">
      <button class="ri-main" data-chat-open="${c.id}">${icon('sparkles')}<span><strong>${esc(c.title)}</strong><small>${esc(timeAgo(c.updatedAt))} · ${c.messages.filter((m) => m.role === 'user').length} question${c.messages.filter((m) => m.role === 'user').length > 1 ? 's' : ''}</small></span></button>
      <button class="icon-btn small" data-chat-del="${c.id}" aria-label="Supprimer cette conversation">${icon('trash')}</button>
    </div>`).join('')}</div>
  <div class="sheet-actions">
    <button class="btn ghost danger" data-chat-wipe>${icon('trash')}Tout effacer</button>
    <button class="btn" data-action="close-sheet">Fermer</button>
  </div>`;
}

function openHistory() {
  openSheet(`<div class="chat-history">${historyHtml()}</div>`, (d) => {
    const box = d.querySelector('.chat-history');
    box.addEventListener('click', (e) => {
      const open = e.target.closest('[data-chat-open]');
      const del = e.target.closest('[data-chat-del]');
      if (open) {
        currentId = open.dataset.chatOpen;
        closeSheet(() => update(() => {}, { silent: true }));
      } else if (del) {
        const id = del.dataset.chatDel;
        update((s) => { s.chats = s.chats.filter((c) => c.id !== id); }, { silent: true });
        if (currentId === id) currentId = null;
        box.innerHTML = historyHtml();
      } else if (e.target.closest('[data-chat-wipe]')) {
        openConfirm({
          title: 'Effacer tout l\'historique ?',
          text: 'Les conversations enregistrées sur cet appareil seront supprimées.',
          confirm: 'Tout effacer',
          onConfirm: () => { currentId = null; update((s) => { s.chats = []; }, { silent: true }); toast('Historique effacé'); },
        });
      }
    });
  });
}

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
