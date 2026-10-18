// Revue hebdomadaire, relances, idées, recherche globale et menu "Plus".
import { state, update } from './store.js';
import { esc, normalize } from './text.js';
import { icon } from './icons.js';
import { todayISO, addDays, fmt, diffDays, weekday, dueLabel, timeAgo } from './dates.js';
import {
  openTasks, sortTasks, inactiveProjects, snoozeProject, getFollowup, saveFollowup, pingFollowup,
  deleteFollowup, deleteIdea, eventsOn, activeProjects,
} from './actions.js';
import { taskRow, projectDot } from './views.js';
import { focusSoon, openSheet, closeSheet, openQuickAdd } from './sheets.js';
import { allMails, mailCard } from './mail.js';
import { toast } from './toast.js';

const mondayOf = (iso) => addDays(iso, -((weekday(iso) + 6) % 7));
const card = (title, body, count) => `<section class="group"><h3 class="group-title">${title}${count != null ? `<span class="count">${count}</span>` : ''}</h3>${body}</section>`;

// ---------- Projets négligés (affichés sur Aujourd'hui et dans la revue) ----------
export function inactiveBlock(limit = 3) {
  const list = inactiveProjects().slice(0, limit);
  if (!list.length) return '';
  return card('Projets sans nouvelles', `<div class="card list">${list.map(({ p, days }) => `
    <div class="row-item">
      <button class="ri-main" data-action="open-project" data-id="${p.id}">${projectDot(p)}<span><strong>${esc(p.name)}</strong><small>Aucune activité depuis ${days} jours</small></span></button>
      <button class="btn small ghost" data-action="snooze-project" data-id="${p.id}">Plus tard</button>
    </div>`).join('')}</div>`, list.length);
}

// ---------- Relances ----------
function followupRow(f) {
  const today = todayISO();
  const days = diffDays(today, f.since);
  const late = f.remindOn && f.remindOn <= today;
  return `
  <div class="row-item fu ${late ? 'due' : ''}">
    <button class="ri-main" data-action="open-followup" data-id="${f.id}">
      <span class="fu-avatar">${esc((f.person || '?').charAt(0).toUpperCase())}</span>
      <span><strong>${esc(f.person)}</strong><small>${esc(f.subject)} · depuis ${days ? days + ' j' : "aujourd'hui"}${f.remindOn ? ` · relance ${esc(dueLabel(f.remindOn).toLowerCase())}` : ''}</small></span>
    </button>
    ${f.link ? `<a class="icon-btn small" href="${esc(f.link)}" target="_blank" rel="noopener" aria-label="Ouvrir le mail">${icon('mail')}</a>` : ''}
    <button class="btn small" data-action="ping-followup" data-id="${f.id}">Relancé</button>
    <button class="icon-btn small ok" data-action="done-followup" data-id="${f.id}" aria-label="Réglé">${icon('check')}</button>
  </div>`;
}

export function followupsBlock(list, title) {
  return list.length ? card(title, `<div class="card list">${list.map(followupRow).join('')}</div>`, list.length) : '';
}

export function followupsView() {
  const open = state.followups.filter((f) => !f.done).sort((a, b) => (a.remindOn || '9').localeCompare(b.remindOn || '9'));
  const mine = open.filter((f) => f.kind === 'relancer');
  const waiting = open.filter((f) => f.kind === 'attente');
  return `
  <div class="page-head"><h1>Relances</h1><button class="btn primary" data-action="new-followup">${icon('plus')}<span>Nouvelle</span></button></div>
  <p class="hint">Garde une trace des personnes à relancer et de celles dont tu attends une réponse. Tu es prévenu le jour de la relance.</p>
  ${followupsBlock(mine, 'Je dois relancer')}
  ${followupsBlock(waiting, "J'attends une réponse de")}
  ${open.length ? '' : `<div class="empty">${icon('clock', 'empty-ic')}<h3>Aucune relance en cours</h3><p>Depuis un mail, le bouton « Relance » en crée une automatiquement.</p></div>`}`;
}

export function openFollowup(id, prefill = {}) {
  const f = id ? getFollowup(id) : { person: '', subject: '', kind: 'attente', remindOn: addDays(todayISO(), 3), ...prefill };
  if (!f) return;
  openSheet(`
    <form class="fu-form">
      <h2 class="sheet-title">${id ? 'Relance' : 'Nouvelle relance'}</h2>
      <div class="segmented wide" style="margin-bottom:14px">
        <button type="button" class="${f.kind === 'attente' ? 'on' : ''}" data-kind="attente">J'attends une réponse</button>
        <button type="button" class="${f.kind === 'relancer' ? 'on' : ''}" data-kind="relancer">Je dois relancer</button>
      </div>
      <label class="field"><span>Personne</span><input name="person" required value="${esc(f.person)}" placeholder="Nom, entreprise…" autocomplete="off"></label>
      <label class="field" style="margin-top:12px"><span>Sujet</span><input name="subject" value="${esc(f.subject)}" placeholder="Devis, convention, réponse au mail…" autocomplete="off"></label>
      <label class="field" style="margin-top:12px"><span>${icon('bell')}Me le rappeler le</span><input type="date" name="remindOn" value="${esc(f.remindOn || '')}"></label>
      <div class="sheet-actions">
        ${id ? `<button type="button" class="btn ghost danger" data-fu-del>${icon('trash')}Supprimer</button>` : '<button type="button" class="btn ghost" data-action="close-sheet">Annuler</button>'}
        <button type="submit" class="btn primary">Enregistrer</button>
      </div>
    </form>`, (d) => {
    const form = d.querySelector('form');
    let kind = f.kind;
    form.addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (b) { kind = b.dataset.kind; form.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b)); }
      if (e.target.closest('[data-fu-del]')) { deleteFollowup(id); closeSheet(); toast('Relance supprimée', { action: 'Annuler', undo: true }); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveFollowup({ ...(id ? { id } : { link: prefill.link || null }), kind, person: form.person.value.trim(), subject: form.subject.value.trim(), remindOn: form.remindOn.value || null });
      closeSheet();
      toast(id ? 'Relance enregistrée' : 'Relance ajoutée');
    });
    if (!id) focusSoon(form.person);
  });
}

// ---------- Idées ----------
export function ideasView() {
  return `
  <div class="page-head"><h1>Idées</h1><button class="btn primary" data-action="quick-idea">${icon('plus')}<span>Capturer</span></button></div>
  <form class="inline-add card" data-form="idea">${icon('sparkles')}<input name="text" placeholder="Note une idée en vitesse…" autocomplete="off" enterkeyhint="done"></form>
  ${state.ideas.length ? `<div class="card list">${state.ideas.map((i) => `
    <div class="row-item idea">
      <div class="ri-main static"><span><strong>${esc(i.text)}</strong><small>${esc(timeAgo(i.createdAt))}</small></span></div>
      <button class="btn small" data-action="idea-to-task" data-id="${i.id}">${icon('tasks')}Tâche</button>
      <button class="icon-btn small" data-action="delete-idea" data-id="${i.id}" aria-label="Supprimer">${icon('trash')}</button>
    </div>`).join('')}</div>` : `<div class="empty">${icon('sparkles', 'empty-ic')}<h3>Aucune idée notée</h3><p>Capture tout ce qui te passe par la tête, tu trieras plus tard.</p></div>`}`;
}

// ---------- Revue hebdomadaire ----------
export function reviewView() {
  const today = todayISO();
  const monday = mondayOf(today);
  const start = new Date(monday + 'T00:00:00').getTime();
  const done = state.log.filter((l) => l.at >= start);
  const open = openTasks();
  const late = sortTasks(open.filter((t) => t.due && t.due < today));
  const blocked = open.filter((t) => t.blocked);
  const noNews = state.followups.filter((f) => !f.done && diffDays(today, f.since) >= 7);
  const next7 = sortTasks(open.filter((t) => t.due && t.due >= today && t.due <= addDays(today, 7)));
  const nextEvents = Array.from({ length: 7 }, (_, i) => addDays(today, i)).flatMap((d) => eventsOn(d).filter((e) => e.source !== 'edt'));
  const nodate = open.filter((t) => !t.due && !t.recurrence).length;
  const inbox = open.filter((t) => !t.projectId).length;
  const reviewed = state.shared.lastReview && state.shared.lastReview >= monday;

  const byProject = activeProjects().map((p) => ({ p, n: done.filter((l) => l.projectId === p.id).length })).filter((x) => x.n);
  return `
  <div class="page-head"><h1>Revue de la semaine</h1></div>
  <div class="stats big">
    <div><strong>${done.length}</strong><span>tâches terminées</span></div>
    <div class="${late.length ? 'bad' : ''}"><strong>${late.length}</strong><span>en retard</span></div>
    <div class="${blocked.length ? 'warn' : ''}"><strong>${blocked.length}</strong><span>bloquées</span></div>
  </div>
  ${byProject.length ? `<p class="hint" style="margin-top:12px">Cette semaine : ${byProject.map((x) => `${esc(x.p.name)} (${x.n})`).join(', ')}.</p>` : ''}
  ${card('En retard', late.length ? `<div class="card list">${late.map((t) => taskRow(t)).join('')}</div>` : '<p class="hint">Rien en retard. Bravo !</p>', late.length)}
  ${blocked.length ? card('Bloquées', `<div class="card list">${blocked.map((t) => taskRow(t)).join('')}</div>`, blocked.length) : ''}
  ${inactiveBlock(10)}
  ${followupsBlock(noNews, 'Sans nouvelles depuis 7 jours')}
  ${card('Les 7 prochains jours', next7.length || nextEvents.length ? `<div class="card list">${next7.map((t) => taskRow(t)).join('')}${nextEvents.map((e) => `<button class="row-item ri-main" data-action="open-event" data-id="${e.id}">${icon('calendar')}<span><strong>${esc(e.title)}</strong><small>${esc(dueLabel(e.date))}${e.start ? ' · ' + esc(e.start) : ''}</small></span></button>`).join('')}</div>` : '<p class="hint">Semaine calme pour l\'instant.</p>')}
  <div class="card form-card">
    <p class="fine">${icon('list')}À trier : ${inbox} tâche${inbox > 1 ? 's' : ''} sans projet, ${nodate} sans date, ${state.ideas.length} idée${state.ideas.length > 1 ? 's' : ''}.</p>
    <button class="btn ${reviewed ? '' : 'primary'}" data-action="review-done">${icon('check')}${reviewed ? 'Revue faite cette semaine' : 'J\'ai fait ma revue'}</button>
  </div>`;
}

// ---------- Recherche ----------
let query = '';
export function searchView() {
  const q = normalize(query.trim());
  let results = '';
  if (q.length >= 2) {
    const has = (...texts) => texts.some((t) => normalize(t || '').includes(q));
    const tasks = state.tasks.filter((t) => has(t.title, t.notes, ...t.subtasks.map((s) => s.title))).slice(0, 30);
    const projects = state.projects.filter((p) => has(p.name, p.description));
    const events = state.events.filter((e) => has(e.title, e.location, e.notes)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    const ideas = state.ideas.filter((i) => has(i.text));
    const fus = state.followups.filter((f) => has(f.person, f.subject));
    const mails = allMails().filter((m) => has(m.subject, m.fromName, m.fromEmail, m.snippet)).slice(0, 10);
    const total = tasks.length + projects.length + events.length + ideas.length + fus.length + mails.length;
    results = total ? [
      projects.length ? card('Projets', `<div class="card list">${projects.map((p) => `<button class="row-item ri-main" data-action="open-project" data-id="${p.id}">${projectDot(p)}<span><strong>${esc(p.name)}</strong><small>${esc(p.description)}</small></span></button>`).join('')}</div>`, projects.length) : '',
      tasks.length ? card('Tâches', `<div class="card list">${tasks.map((t) => taskRow(t)).join('')}</div>`, tasks.length) : '',
      events.length ? card('Agenda', `<div class="card list">${events.map((e) => `<button class="row-item ri-main" data-action="open-event" data-id="${e.id}">${icon('calendar')}<span><strong>${esc(e.title)}</strong><small>${esc(fmt(e.date, { weekday: 'short', day: 'numeric', month: 'short' }))}${e.start ? ' · ' + esc(e.start) : ''}</small></span></button>`).join('')}</div>`, events.length) : '',
      fus.length ? followupsBlock(fus, 'Relances') : '',
      ideas.length ? card('Idées', `<div class="card list">${ideas.map((i) => `<div class="row-item"><div class="ri-main static"><span><strong>${esc(i.text)}</strong></span></div></div>`).join('')}</div>`, ideas.length) : '',
      mails.length ? card('Mails', `<div class="mails">${mails.map((m) => mailCard(m, { compact: true })).join('')}</div>`, mails.length) : '',
    ].join('') : `<div class="empty">${icon('alert', 'empty-ic')}<h3>Aucun résultat</h3><p>Essaie un autre mot.</p></div>`;
  }
  return `
  <div class="page-head"><h1>Recherche</h1></div>
  <div class="search-box card">${icon('list')}<input type="search" data-search value="${esc(query)}" placeholder="Tâches, projets, agenda, mails…" autocomplete="off" enterkeyhint="search"></div>
  <div id="search-results">${results || (q.length ? '' : '<p class="hint">Tape au moins deux lettres.</p>')}</div>`;
}

export function setSearch(value) { query = value; }

// ---------- Menu "Plus" (mobile) ----------
export function moreView() {
  const fuDue = state.followups.filter((f) => !f.done && f.remindOn && f.remindOn <= todayISO()).length;
  const tiles = [
    ['projets', 'Projets', 'folder', `${activeProjects().length} projets`],
    ['mails', 'Mails', 'mail', state.accounts.length ? `${state.accounts.length} compte${state.accounts.length > 1 ? 's' : ''}` : 'À connecter'],
    ['assistant', 'Assistant', 'sparkles', 'Pose une question'],
    ['revue', 'Revue', 'check', 'Bilan de la semaine'],
    ['relances', 'Relances', 'clock', fuDue ? `${fuDue} à faire` : 'Personnes à relancer'],
    ['idees', 'Idées', 'pencil', `${state.ideas.length} idée${state.ideas.length > 1 ? 's' : ''}`],
    ['recherche', 'Recherche', 'list', 'Tout retrouver'],
    ['reglages', 'Réglages', 'sliders', 'Synchro, comptes…'],
  ];
  return `
  <div class="page-head"><h1>Plus</h1></div>
  <div class="tiles">${tiles.map(([k, l, ic, sub]) => `<a class="tile card" href="#/${k}">${icon(ic)}<strong>${l}</strong><small>${esc(sub)}</small></a>`).join('')}</div>`;
}

export const extrasHandlers = {
  'snooze-project': (el) => { snoozeProject(el.dataset.id); toast('Rappel masqué pendant 7 jours'); },
  'new-followup': () => openFollowup(null),
  'open-followup': (el) => openFollowup(el.dataset.id),
  'ping-followup': (el) => { pingFollowup(el.dataset.id); toast('Noté. Prochain rappel dans 3 jours.'); },
  'done-followup': (el) => { saveFollowup({ id: el.dataset.id, done: true }); toast('Relance réglée'); },
  'delete-idea': (el) => { deleteIdea(el.dataset.id); toast('Idée supprimée', { action: 'Annuler', undo: true }); },
  'idea-to-task': (el) => {
    const idea = state.ideas.find((i) => i.id === el.dataset.id);
    if (idea) openQuickAdd({ prefill: idea.text, onCreated: () => deleteIdea(idea.id) });
  },
  'quick-idea': () => openQuickAdd({ mode: 'idee' }),
  'review-done': () => { update((s) => { s.shared.lastReview = todayISO(); }); toast('Revue enregistrée. Bonne semaine !'); },
};

