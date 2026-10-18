// Point d'entrée : navigation, rendu des écrans et gestion des clics.
import { state, initStore, subscribe, update, replaceState, resetState, flush, local } from './store.js';
import { icon } from './icons.js';
import { esc } from './text.js';
import { todayISO } from './dates.js';
import { tasksView, projectsView, projectView, inboxView, projectDot } from './views.js';
import { todayView } from './today.js';
import { settingsView } from './settings.js';
import { calendarView, calendarHandlers, scrollCalendar, openEvent } from './calendar.js';
import { mailsView, mailHandlers, refreshAll, findMail } from './mail.js';
import { assistantView, assistantHandlers, onChatSubmit, testAssistant } from './assistant.js';
import { reviewView, followupsView, ideasView, searchView, moreView, setSearch, extrasHandlers, openFollowup } from './extras.js';
import { openTimetableImport } from './timetable.js';
import { initSheets, openQuickAdd, openTask, openProjectEditor, openConfirm, closeSheet, toastDone } from './sheets.js';
import { getTask, activeProjects, completeTask, reopenTask, createTask, rollDailyTasks, addIdea, dueFollowups } from './actions.js';
import { parseQuick } from './parser.js';
import { toast } from './toast.js';
import { startNotifier, enableNotifications, disableNotifications, testNotification, updateBadge } from './notify.js';
import { syncNow, startAutoSync, disconnectSync } from './sync.js';
import { preloadGoogle } from './google.js';

const $ = (sel) => document.querySelector(sel);
const filter = { status: 'open', project: 'all' };

// ---------- Thème (préférence propre à chaque appareil) ----------
const getTheme = () => local.get('theme', 'auto');
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0f1117' : '#f5f6fa';
}

// ---------- Navigation ----------
function route() {
  const [name = 'aujourdhui', ...args] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'aujourdhui', arg: args[0], arg2: args[1] };
}

const NAV = [
  ['aujourdhui', "Aujourd'hui", 'sun'],
  ['taches', 'Tâches', 'tasks'],
  ['agenda', 'Agenda', 'calendar'],
  ['projets', 'Projets', 'folder'],
  ['mails', 'Mails', 'mail'],
  ['assistant', 'Assistant', 'sparkles'],
  ['revue', 'Revue', 'check'],
  ['relances', 'Relances', 'clock'],
  ['idees', 'Idées', 'pencil'],
  ['recherche', 'Recherche', 'list'],
  ['reglages', 'Réglages', 'sliders'],
];
const TABS = ['aujourdhui', 'agenda', 'taches'];
const SECTION_OF = { projet: 'projets', boite: 'projets' };

function badgeFor(k) {
  const today = todayISO();
  if (k === 'aujourdhui') return state.tasks.filter((t) => !t.done && t.due && t.due <= today).length;
  if (k === 'relances') return dueFollowups().length;
  if (k === 'mails') return state.accounts.flatMap((a) => state.mails[a.id]?.items || []).filter((m) => m.important && m.unread).length;
  return 0;
}

function renderChrome(r) {
  const active = SECTION_OF[r.name] || r.name;
  const navItem = ([k, label, ic]) => {
    const n = badgeFor(k);
    return `<a href="#/${k}" class="nav-item ${active === k ? 'on' : ''}">${icon(ic)}<span>${label}</span>${n ? `<b class="badge">${n}</b>` : ''}</a>`;
  };
  const syncDot = state.settings.syncEnabled ? `<a href="#/reglages" class="sync-chip ${state.sync.status}" title="Synchronisation">${icon('repeat')}${state.sync.status === 'reconnect' ? 'Reconnecter' : state.sync.status === 'error' ? 'Erreur synchro' : 'Synchronisé'}</a>` : '';

  $('#sidebar').innerHTML = `
    <div class="brand"><img src="icons/icon.svg" alt="" width="32" height="32"><span>Mon Organisateur</span></div>
    <button class="btn primary block" data-action="quick-add">${icon('plus')}Nouvelle tâche<kbd>N</kbd></button>
    <nav class="nav">${NAV.map(navItem).join('')}</nav>
    <div class="side-section">
      <div class="side-title"><span>Projets</span><button class="icon-btn small" data-action="new-project" aria-label="Nouveau projet">${icon('plus')}</button></div>
      ${activeProjects().map((p) => {
        const n = state.tasks.filter((t) => t.projectId === p.id && !t.done).length;
        return `<a href="#/projet/${p.id}" class="nav-item sub ${r.name === 'projet' && r.arg === p.id ? 'on' : ''}">${projectDot(p)}<span>${esc(p.name)}</span>${n ? `<small>${n}</small>` : ''}</a>`;
      }).join('') || '<p class="side-empty">Aucun projet pour l\'instant.</p>'}
    </div>
    ${syncDot}`;

  const tab = (k) => navItem(NAV.find((x) => x[0] === k));
  const moreOn = !TABS.includes(active);
  const moreBadge = ['relances', 'mails'].reduce((a, k) => a + badgeFor(k), 0);
  $('#tabbar').innerHTML = `
    ${tab('aujourdhui')}${tab('agenda')}
    <button class="fab" data-action="quick-add" aria-label="Nouvelle tâche">${icon('plus')}</button>
    ${tab('taches')}
    <a href="#/plus" class="nav-item ${moreOn ? 'on' : ''}">${icon('list')}<span>Plus</span>${moreBadge ? `<b class="badge">${moreBadge}</b>` : ''}</a>`;
}

function renderView(r) {
  switch (r.name) {
    case 'taches': return tasksView(filter);
    case 'agenda': return calendarView(r.arg, r.arg2);
    case 'projets': return projectsView();
    case 'projet': return projectView(r.arg);
    case 'boite': return inboxView();
    case 'mails': return mailsView();
    case 'assistant': return assistantView();
    case 'revue': return reviewView();
    case 'relances': return followupsView();
    case 'idees': return ideasView();
    case 'recherche': return searchView();
    case 'plus': return moreView();
    case 'reglages': return settingsView(getTheme());
    default: return todayView();
  }
}

let lastRouteKey = '';
function render({ transition = false } = {}) {
  const r = route();
  const doRender = () => {
    renderChrome(r);
    const view = $('#view');
    // Garde le focus et le curseur dans un champ en cours de saisie.
    const f = document.activeElement;
    const keep = f && view.contains(f) && f.matches('input[data-setting], input[data-search], input[data-shared-tt], textarea[name="q"]')
      ? { sel: f.matches('[data-search]') ? '[data-search]' : f.matches('[name="q"]') ? 'textarea[name="q"]' : `[data-setting="${f.dataset.setting}"],[data-shared-tt="${f.dataset.sharedTt}"]`, value: f.value, pos: f.selectionStart }
      : null;
    view.innerHTML = renderView(r);
    if (keep) {
      const el = view.querySelector(keep.sel);
      if (el) { el.value = keep.value; el.focus(); try { el.setSelectionRange(keep.pos, keep.pos); } catch { /* type sans curseur */ } }
    }
  };
  const key = r.name + '/' + (r.arg || '') + '/' + (r.arg2 || '');
  const changed = key !== lastRouteKey;
  lastRouteKey = key;
  if (transition && changed && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(doRender).finished.then(() => { if (r.name === 'agenda') scrollCalendar(); });
  } else {
    doRender();
    if (changed && r.name === 'agenda') scrollCalendar();
  }
  if (changed) window.scrollTo({ top: 0 });
}

// ---------- Actions déclenchées par les clics ----------
function completeWithAnimation(id) {
  const t = getTask(id);
  if (!t) return;
  if (t.done) { reopenTask(id); return; }
  document.querySelectorAll(`.task[data-id="${id}"]`).forEach((row) => row.classList.add('completing'));
  setTimeout(() => {
    const next = completeTask(id);
    toastDone(t, next);
    if (navigator.vibrate) navigator.vibrate(12);
  }, 380);
}

function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function connectSync() {
  try {
    await syncNow({ interactive: true });
    toast('Synchronisation activée');
  } catch (e) {
    toast(e.message);
  }
}

const handlers = {
  ...calendarHandlers,
  ...mailHandlers,
  ...assistantHandlers,
  ...extrasHandlers,
  'quick-add': () => {
    const r = route();
    openQuickAdd(r.name === 'projet' ? { projectId: r.arg } : r.name === 'idees' ? { mode: 'idee' } : {});
  },
  'close-sheet': () => closeSheet(),
  'toggle-task': (el) => completeWithAnimation(el.dataset.id),
  'open-task': (el) => openTask(el.dataset.id),
  'open-project': (el) => { location.hash = `#/projet/${el.dataset.id}`; },
  'open-inbox': () => { location.hash = '#/boite'; },
  'new-project': () => openProjectEditor(null, (id) => { location.hash = `#/projet/${id}`; }),
  'edit-project': (el) => openProjectEditor(el.dataset.id),
  'import-edt': () => openTimetableImport(),
  go: (el) => { location.hash = `#/${el.dataset.route}`; },
  'filter-status': (el) => { filter.status = el.dataset.key; render(); },
  'filter-project': (el) => { filter.project = el.dataset.key; render(); },
  'set-theme': (el) => { local.set('theme', el.dataset.key); applyTheme(el.dataset.key); render(); },
  'test-notif': () => testNotification(),
  'test-assistant': () => testAssistant(),
  'sync-connect': () => connectSync(),
  'sync-now': () => syncNow({ interactive: true }).then(() => toast('Synchronisé')).catch((e) => toast(e.message)),
  'sync-off': () => openConfirm({
    title: 'Désactiver la synchronisation ?',
    text: 'Tes données restent sur cet appareil et dans ton Drive, mais ne seront plus mises à jour entre tes appareils.',
    confirm: 'Désactiver',
    onConfirm: () => { disconnectSync(); toast('Synchronisation désactivée'); },
  }),
  'mail-task': (el) => {
    const m = findMail(el.dataset.id);
    if (m) openQuickAdd({ prefill: m.subject, link: m.link, notes: `Mail de ${m.fromName || m.fromEmail}` });
  },
  'mail-event': (el) => {
    const m = findMail(el.dataset.id);
    const d = m?.dates[Number(el.dataset.i)];
    if (d) openEvent(null, { title: m.subject, date: d.due, start: d.time || '', allDay: !d.time, notes: `Mail de ${m.fromName || m.fromEmail}`, link: m.link, source: 'mail' });
  },
  'mail-followup': (el) => {
    const m = findMail(el.dataset.id);
    if (m) openFollowup(null, { person: m.fromName || m.fromEmail, subject: m.subject, kind: 'attente', link: m.link });
  },
  'reset-model': () => openConfirm({
    title: 'Oublier l\'apprentissage ?',
    text: 'Le rangement automatique repartira des noms et descriptions de tes projets. Tes tâches ne changent pas.',
    confirm: 'Oublier',
    onConfirm: () => {
      update((s) => {
        s.model = { words: {}, docs: {} };
        s.stats = { autoKept: 0, autoFixed: 0 };
        s.tasks.forEach((t) => { t.learned = null; t.autoAssigned = false; });
      });
      toast('Apprentissage réinitialisé');
    },
  }),
  export: () => {
    const { mails, ...data } = state;
    download(`mon-organisateur-${todayISO()}.json`, JSON.stringify({ app: 'mon-organisateur', exportedAt: new Date().toISOString(), data }, null, 2));
    toast('Sauvegarde téléchargée');
  },
  wipe: () => openConfirm({
    title: 'Tout effacer ?',
    text: 'Projets, tâches, agenda et apprentissage seront supprimés de cet appareil. Exporte une sauvegarde avant si besoin.',
    confirm: 'Tout effacer',
    onConfirm: () => { resetState(); toast('Données effacées'); },
  }),
};

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.matches('input')) return;
  const fn = handlers[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
}

async function onChange(e) {
  const el = e.target;
  if (el.dataset.action === 'toggle-notif') {
    if (el.checked) {
      const res = await enableNotifications();
      if (res === 'granted') { toast('Notifications activées'); testNotification(); } else toast('Notifications refusées');
    } else {
      disableNotifications();
      toast('Notifications désactivées');
    }
    render();
  }
  if (el.dataset.local === 'app-password' && el.value) {
    local.set('app-password', el.value);
    el.value = '';
    toast('Mot de passe enregistré sur cet appareil');
    render();
  }
  if (el.dataset.action === 'import' && el.files[0]) {
    try {
      const json = JSON.parse(await el.files[0].text());
      const data = json.data || json;
      if (!Array.isArray(data.tasks) || !Array.isArray(data.projects)) throw new Error('format');
      openConfirm({
        title: 'Remplacer les données ?',
        text: `La sauvegarde contient ${data.projects.length} projets et ${data.tasks.length} tâches. Elle remplacera les données actuelles de cet appareil.`,
        confirm: 'Importer',
        onConfirm: () => { replaceState({ ...data, accounts: state.accounts, mails: state.mails, settings: state.settings, sync: state.sync }); toast('Sauvegarde importée'); },
      });
    } catch {
      toast('Ce fichier n\'est pas une sauvegarde valide');
    }
    el.value = '';
  }
}

let typingTimer;
function onInput(e) {
  const t = e.target;
  if (t.dataset.setting) {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => update((s) => { s.shared[t.dataset.setting] = t.value.trim(); }), 400);
  }
  if (t.dataset.sharedTt) {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => update((s) => { s.shared.timetable[t.dataset.sharedTt] = t.value.trim(); }), 400);
  }
  if (t.matches('[data-search]')) { setSearch(t.value); render(); }
  if (t.matches('textarea[name="q"]')) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
}

function onSubmit(e) {
  const form = e.target;
  if (form.matches('[data-form="project-add"]')) {
    e.preventDefault();
    const text = form.title.value.trim();
    if (!text) return;
    const parsed = parseQuick(text, state.projects);
    createTask(parsed, { projectId: parsed.projectId ?? form.dataset.id });
    form.title.value = '';
    setTimeout(() => document.querySelector('[data-form="project-add"] input')?.focus(), 0);
  } else if (form.matches('[data-form="idea"]')) {
    e.preventDefault();
    if (!form.text.value.trim()) return;
    addIdea(form.text.value);
    form.text.value = '';
    setTimeout(() => document.querySelector('[data-form="idea"] input')?.focus(), 0);
  } else if (form.matches('[data-form="chat"]')) {
    e.preventDefault();
    onChatSubmit(form);
  }
}

function onKey(e) {
  if (e.target.matches('textarea[name="q"]') && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    e.target.form.requestSubmit();
    return;
  }
  if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if ($('#sheet').open) return;
  if (e.key === 'n' || e.key === 'N' || e.key === '+') { e.preventDefault(); handlers['quick-add'](); }
  if (e.key === '/') { e.preventDefault(); location.hash = '#/recherche'; setTimeout(() => $('[data-search]')?.focus(), 50); }
}

// ---------- Démarrage ----------
async function start() {
  applyTheme(getTheme());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getTheme()));
  await initStore();
  rollDailyTasks();
  initSheets();

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => render({ transition: true }));
  matchMedia('(min-width: 900px)').addEventListener('change', () => render());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
    else { rollDailyTasks(); refreshAll(false); render(); }
  });

  subscribe(() => { render(); updateBadge(); });
  render();
  document.body.classList.add('ready');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open-task' && getTask(e.data.taskId)) openTask(e.data.taskId);
    });
  }
  const params = new URLSearchParams(location.search);
  const ajout = params.get('ajout');
  if (ajout) { history.replaceState(null, '', location.pathname + location.hash); openQuickAdd(ajout === 'idee' ? { mode: 'idee' } : {}); }
  preloadGoogle();
  startNotifier();
  startAutoSync();
  refreshAll(false);
}

start();
