// Écrans de l'application, rendus en HTML. Tout texte venant de l'utilisateur passe par esc().
import { state } from './store.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { todayISO, dueLabel, timeAgo } from './dates.js';
import { recurrenceLabel } from './recurrence.js';
import { getProject, activeProjects, sortTasks, bucketOf } from './actions.js';

const PRIORITY_LABELS = ['Aucune', 'Basse', 'Moyenne', 'Haute'];
export { PRIORITY_LABELS };

// ---------- Morceaux réutilisables ----------
export function projectDot(p) {
  return `<i class="dot" style="--c:${p ? esc(p.color) : 'var(--muted)'}"></i>`;
}

export function taskRow(t, { showProject = true } = {}) {
  const p = getProject(t.projectId);
  const today = todayISO();
  const meta = [];
  if (t.due) {
    const cls = t.done ? '' : t.due < today ? 'late' : t.due === today ? 'today' : '';
    meta.push(`<span class="meta ${cls}">${icon('calendar')}${esc(dueLabel(t.due))}${t.time ? ' · ' + esc(t.time.replace(':', 'h')) : ''}</span>`);
  } else if (t.time) {
    meta.push(`<span class="meta">${icon('clock')}${esc(t.time.replace(':', 'h'))}</span>`);
  }
  if (t.blocked) meta.push(`<span class="meta late">${icon('alert')}Bloquée</span>`);
  if (t.link) meta.push(`<span class="meta">${icon('mail')}Mail</span>`);
  if (t.recurrence) meta.push(`<span class="meta">${icon('repeat')}${esc(recurrenceLabel(t.recurrence))}</span>`);
  if (t.subtasks.length) {
    const d = t.subtasks.filter((s) => s.done).length;
    meta.push(`<span class="meta">${icon('list')}${d}/${t.subtasks.length}</span>`);
  }
  if (showProject) {
    meta.push(p
      ? `<span class="meta proj">${projectDot(p)}${esc(p.name)}${t.autoAssigned ? icon('sparkles', 'auto') : ''}</span>`
      : `<span class="meta proj muted">${icon('inbox')}Boîte de réception</span>`);
  }
  return `
  <div class="task prio-${t.priority} ${t.done ? 'is-done' : ''}" data-id="${t.id}">
    <button class="check" data-action="toggle-task" data-id="${t.id}" aria-label="${t.done ? 'Rouvrir' : 'Terminer'} la tâche">${icon('check')}</button>
    <button class="task-body" data-action="open-task" data-id="${t.id}">
      <span class="task-title">${esc(t.title)}</span>
      ${meta.length ? `<span class="task-meta">${meta.join('')}</span>` : ''}
    </button>
  </div>`;
}

export function section(title, tasks, opts = {}) {
  if (!tasks.length) return '';
  return `
  <section class="group ${opts.cls || ''}">
    <h3 class="group-title">${title}<span class="count">${tasks.length}</span></h3>
    <div class="card list">${tasks.map((t) => taskRow(t, opts)).join('')}</div>
  </section>`;
}

export function empty(iconName, title, text, action = '') {
  return `<div class="empty">${icon(iconName, 'empty-ic')}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}

export function ring(done, total) {
  const pct = total ? done / total : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return `
  <div class="ring" role="img" aria-label="${done} sur ${total} tâches terminées">
    <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" class="ring-bg"/><circle cx="32" cy="32" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>
    <span>${total ? Math.round(pct * 100) + '%' : '·'}</span>
  </div>`;
}

// ---------- Tâches ----------
const BUCKETS = [
  ['overdue', 'En retard'], ['today', "Aujourd'hui"], ['tomorrow', 'Demain'],
  ['week', 'Cette semaine'], ['later', 'Plus tard'], ['nodate', 'Sans date'],
];

export function tasksView(filter) {
  const projects = activeProjects();
  const chip = (key, label, extra = '') =>
    `<button class="chip ${filter.project === key ? 'on' : ''}" data-action="filter-project" data-key="${key}">${extra}${esc(label)}</button>`;
  const chips = [chip('all', 'Toutes'), chip('inbox', 'Boîte de réception', icon('inbox')),
    ...projects.map((p) => chip(p.id, p.name, projectDot(p)))].join('');

  let list = state.tasks.filter((t) => (filter.status === 'done' ? t.done : !t.done));
  if (filter.project === 'inbox') list = list.filter((t) => !t.projectId);
  else if (filter.project !== 'all') list = list.filter((t) => t.projectId === filter.project);

  let body;
  if (!list.length) {
    body = filter.status === 'done'
      ? empty('check', 'Aucune tâche terminée', 'Les tâches que tu termines apparaîtront ici.')
      : empty('tasks', 'Aucune tâche à faire', 'Ajoute une tâche avec le bouton +.');
  } else if (filter.status === 'done') {
    list.sort((a, b) => b.doneAt - a.doneAt);
    body = section('Terminées', list.slice(0, 100));
  } else {
    const sorted = sortTasks(list);
    body = BUCKETS.map(([k, label]) => section(label, sorted.filter((t) => bucketOf(t) === k), { cls: k === 'overdue' ? 'is-late' : '' })).join('');
  }

  return `
  <div class="page-head">
    <h1>Tâches</h1>
    <div class="segmented" role="tablist">
      <button class="${filter.status === 'open' ? 'on' : ''}" data-action="filter-status" data-key="open">À faire</button>
      <button class="${filter.status === 'done' ? 'on' : ''}" data-action="filter-status" data-key="done">Terminées</button>
    </div>
  </div>
  <div class="chips scroll-x">${chips}</div>
  ${body}`;
}

// ---------- Projets ----------
function projectCard(p) {
  const tasks = state.tasks.filter((t) => t.projectId === p.id);
  const open = tasks.filter((t) => !t.done).length;
  const doneN = tasks.length - open;
  const pct = tasks.length ? Math.round((doneN / tasks.length) * 100) : 0;
  return `
  <button class="card project-card" data-action="open-project" data-id="${p.id}" style="--c:${esc(p.color)}">
    <span class="pc-top"><span class="pc-badge">${esc(p.name.charAt(0).toUpperCase())}</span><span class="pc-count">${open} à faire</span></span>
    <span class="pc-name">${esc(p.name)}</span>
    <span class="pc-desc">${esc(p.description || 'Pas de description')}</span>
    <span class="bar"><i style="width:${pct}%"></i></span>
    <span class="pc-foot">${icon('clock')}Activité ${esc(timeAgo(p.lastActivity))}</span>
  </button>`;
}

export function projectsView() {
  const projects = activeProjects();
  const inbox = state.tasks.filter((t) => !t.projectId && !t.done).length;
  return `
  <div class="page-head">
    <h1>Projets</h1>
    <button class="btn primary" data-action="new-project">${icon('plus')}<span>Nouveau</span></button>
  </div>
  ${projects.length ? '' : empty('folder', 'Aucun projet', 'Crée un projet pour chaque chose sur laquelle tu travailles : cours, association, stage, perso…')}
  <div class="grid">
    ${projects.map(projectCard).join('')}
    ${inbox ? `<button class="card project-card inbox-card" data-action="open-inbox"><span class="pc-top"><span class="pc-badge">${icon('inbox')}</span><span class="pc-count">${inbox} à faire</span></span><span class="pc-name">Boîte de réception</span><span class="pc-desc">Tâches que l'application n'a pas su ranger. Range-les pour l'aider à apprendre.</span></button>` : ''}
  </div>`;
}

export function projectView(id) {
  const p = getProject(id);
  if (!p) return empty('folder', 'Projet introuvable', 'Il a peut-être été supprimé.');
  const tasks = state.tasks.filter((t) => t.projectId === id);
  const open = sortTasks(tasks.filter((t) => !t.done));
  const done = tasks.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
  return `
  <div class="project-hero" style="--c:${esc(p.color)}">
    <button class="icon-btn" data-action="go" data-route="projets" aria-label="Retour">${icon('back')}</button>
    <div class="ph-main">
      <h1>${esc(p.name)}</h1>
      ${p.description ? `<p class="sub">${esc(p.description)}</p>` : ''}
      <p class="ph-meta">${icon('clock')}Dernière activité ${esc(timeAgo(p.lastActivity))} · ${open.length} à faire · ${done.length} terminée${done.length > 1 ? 's' : ''}</p>
    </div>
    <button class="icon-btn" data-action="edit-project" data-id="${p.id}" aria-label="Modifier le projet">${icon('pencil')}</button>
  </div>
  <form class="inline-add card" data-form="project-add" data-id="${p.id}">
    ${icon('plus')}<input name="title" placeholder="Ajouter une tâche à ${esc(p.name)}" autocomplete="off" enterkeyhint="done">
  </form>
  ${open.length ? section('À faire', open, { showProject: false }) : empty('check', 'Tout est fait', 'Aucune tâche en cours dans ce projet.')}
  ${done.length ? `<details class="group"><summary class="group-title">Terminées<span class="count">${done.length}</span></summary><div class="card list">${done.slice(0, 50).map((t) => taskRow(t, { showProject: false })).join('')}</div></details>` : ''}`;
}

export function inboxView() {
  const open = sortTasks(state.tasks.filter((t) => !t.projectId && !t.done));
  return `
  <div class="page-head">
    <div class="row-gap"><button class="icon-btn" data-action="go" data-route="projets" aria-label="Retour">${icon('back')}</button><h1>Boîte de réception</h1></div>
  </div>
  <p class="hint">Ouvre une tâche et choisis son projet : l'application retiendra ce choix pour les suivantes.</p>
  ${open.length ? section('À ranger', open) : empty('inbox', 'Boîte vide', 'Toutes tes tâches sont rangées.')}`;
}
