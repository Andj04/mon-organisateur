// Écrans de l'application, rendus en HTML. Tout texte venant de l'utilisateur passe par esc().
import { state } from './store.js';
import { esc } from './text.js';
import { icon } from './icons.js';
import { todayISO, fmt, cap, dueLabel, timeAgo, addDays } from './dates.js';
import { recurrenceLabel } from './recurrence.js';
import { getProject, activeProjects, openTasks, doneToday, sortTasks, bucketOf } from './actions.js';
import { notifPermission, notifSupported } from './notify.js';

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

function section(title, tasks, opts = {}) {
  if (!tasks.length) return '';
  return `
  <section class="group ${opts.cls || ''}">
    <h3 class="group-title">${title}<span class="count">${tasks.length}</span></h3>
    <div class="card list">${tasks.map((t) => taskRow(t, opts)).join('')}</div>
  </section>`;
}

function empty(iconName, title, text, action = '') {
  return `<div class="empty">${icon(iconName, 'empty-ic')}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}

function ring(done, total) {
  const pct = total ? done / total : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return `
  <div class="ring" role="img" aria-label="${done} sur ${total} tâches terminées">
    <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" class="ring-bg"/><circle cx="32" cy="32" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/></svg>
    <span>${total ? Math.round(pct * 100) + '%' : '·'}</span>
  </div>`;
}

// ---------- Aujourd'hui ----------
export function todayView() {
  const today = todayISO();
  const open = sortTasks(openTasks());
  const late = open.filter((t) => t.due && t.due < today);
  const now = open.filter((t) => t.due === today);
  const soon = open.filter((t) => t.due > today && t.due <= addDays(today, 7)).slice(0, 5);
  const done = doneToday().length;
  const total = done + now.length + late.length;
  const hour = new Date().getHours();
  const hello = hour >= 18 ? 'Bonsoir' : 'Bonjour';
  const name = state.settings.name ? ' ' + esc(state.settings.name) : '';

  let tasksBlock;
  if (!state.tasks.length) {
    tasksBlock = empty('sparkles', 'Bienvenue !',
      'Commence par créer tes projets, puis ajoute tes tâches. L\'application apprendra à les ranger toute seule.',
      `<div class="row-gap"><button class="btn primary" data-action="new-project">${icon('folder')}Créer un projet</button><button class="btn" data-action="quick-add">${icon('plus')}Ajouter une tâche</button></div>`);
  } else if (!late.length && !now.length) {
    tasksBlock = empty('check', 'Rien de prévu pour aujourd\'hui', 'Profites-en, ou avance sur une tâche à venir.');
  } else {
    tasksBlock = section('En retard', late, { cls: 'is-late' }) + section('À faire aujourd\'hui', now);
  }

  return `
  <div class="hero">
    <div>
      <p class="eyebrow">${esc(cap(fmt(today, { weekday: 'long', day: 'numeric', month: 'long' })))}</p>
      <h1>${hello}${name}</h1>
      <p class="sub">${total ? `${done} sur ${total} tâche${total > 1 ? 's' : ''} terminée${total > 1 ? 's' : ''} aujourd'hui` : 'Ta journée est libre pour l\'instant.'}</p>
    </div>
    ${ring(done, total)}
  </div>
  ${tasksBlock}
  ${section('Dans les 7 prochains jours', soon)}
  <section class="group">
    <h3 class="group-title">Emploi du temps</h3>
    <div class="card soon">${icon('calendar')}<div><strong>Calendrier à venir</strong><p>Tes cours et événements du jour s'afficheront ici à l'étape 3.</p></div></div>
  </section>
  <section class="group">
    <h3 class="group-title">Mails importants</h3>
    <div class="card soon">${icon('mail')}<div><strong>Mails à venir</strong><p>Tes mails importants s'afficheront ici à l'étape 5.</p></div></div>
  </section>`;
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

// ---------- Réglages ----------
export function settingsView(theme) {
  const perm = notifPermission();
  const s = state.stats;
  const totalAuto = s.autoKept + s.autoFixed;
  const notifOn = state.settings.notifications && perm === 'granted';
  let notifStatus;
  if (!notifSupported()) notifStatus = 'Ton navigateur ne gère pas les notifications.';
  else if (perm === 'denied') notifStatus = 'Bloquées dans les réglages du navigateur. Autorise-les dans les paramètres du site pour les activer.';
  else if (notifOn) notifStatus = 'Activées. Rappel à l\'heure prévue quand l\'application est ouverte ou en arrière-plan, et résumé du jour.';
  else notifStatus = 'Désactivées.';

  const themeBtn = (k, label, ic) => `<button class="${theme === k ? 'on' : ''}" data-action="set-theme" data-key="${k}">${icon(ic)}${label}</button>`;

  return `
  <div class="page-head"><h1>Réglages</h1></div>

  <section class="group">
    <h3 class="group-title">Profil</h3>
    <div class="card form-card">
      <label class="field"><span>Ton prénom (pour l'accueil)</span>
        <input data-setting="name" value="${esc(state.settings.name)}" placeholder="Prénom" autocomplete="given-name"></label>
    </div>
  </section>

  <section class="group">
    <h3 class="group-title">Apparence</h3>
    <div class="card form-card">
      <div class="segmented wide">${themeBtn('auto', 'Auto', 'monitor')}${themeBtn('light', 'Clair', 'sun')}${themeBtn('dark', 'Sombre', 'moon')}</div>
    </div>
  </section>

  <section class="group">
    <h3 class="group-title">Notifications</h3>
    <div class="card form-card">
      <div class="setting-row">
        <div>${icon('bell')}<div><strong>Rappels et résumé du jour</strong><p>${notifStatus}</p></div></div>
        <label class="switch"><input type="checkbox" data-action="toggle-notif" ${notifOn ? 'checked' : ''} ${!notifSupported() || perm === 'denied' ? 'disabled' : ''}><i></i></label>
      </div>
      ${notifOn ? `<button class="btn" data-action="test-notif">${icon('bell')}Envoyer une notification de test</button>` : ''}
      <p class="fine">Sans serveur, Android ne garantit pas l'heure exacte quand l'application est complètement fermée. Des rappels fiables via Google Agenda arriveront à l'étape 4.</p>
    </div>
  </section>

  <section class="group">
    <h3 class="group-title">Rangement automatique</h3>
    <div class="card form-card">
      <div class="stats">
        <div><strong>${s.autoKept}</strong><span>propositions gardées</span></div>
        <div><strong>${s.autoFixed}</strong><span>corrections apprises</span></div>
        <div><strong>${totalAuto ? Math.round((s.autoKept / totalAuto) * 100) + '%' : '·'}</strong><span>de justesse</span></div>
      </div>
      <p class="fine">L'apprentissage se fait uniquement sur ton appareil, rien n'est envoyé. Astuce : écris <b>#nom</b> dans une tâche pour choisir le projet directement.</p>
      <button class="btn ghost danger" data-action="reset-model">Oublier ce qui a été appris</button>
    </div>
  </section>

  <section class="group">
    <h3 class="group-title">Données</h3>
    <div class="card form-card">
      <p class="fine">${icon('shield')}Tes données sont enregistrées uniquement sur cet appareil. La synchronisation avec ton Google Drive arrivera à l'étape 2. En attendant, exporte une sauvegarde de temps en temps.</p>
      <div class="row-gap wrap">
        <button class="btn" data-action="export">${icon('download')}Exporter une sauvegarde</button>
        <label class="btn">${icon('upload')}Importer une sauvegarde<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      </div>
      <button class="btn ghost danger" data-action="wipe">${icon('trash')}Tout effacer sur cet appareil</button>
    </div>
  </section>

  <p class="version">Mon Organisateur · étape 1 · ${state.tasks.length} tâches · ${state.projects.length} projets</p>`;
}
