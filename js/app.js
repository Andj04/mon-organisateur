// Point d'entrée : navigation, rendu des écrans et gestion des clics.
import { state, initStore, subscribe, update, replaceState, resetState, flush } from './store.js';
import { icon } from './icons.js';
import { esc } from './text.js';
import { todayISO } from './dates.js';
import { todayView, tasksView, projectsView, projectView, inboxView, settingsView, projectDot } from './views.js';
import { initSheets, openQuickAdd, openTask, openProjectEditor, openConfirm, closeSheet, toastDone } from './sheets.js';
import { getTask, activeProjects, completeTask, reopenTask, createTask, rollDailyTasks } from './actions.js';
import { parseQuick } from './parser.js';
import { toast } from './toast.js';
import { startNotifier, enableNotifications, disableNotifications, testNotification, updateBadge } from './notify.js';

const $ = (sel) => document.querySelector(sel);
const filter = { status: 'open', project: 'all' };

// ---------- Thème (préférence propre à chaque appareil) ----------
const getTheme = () => { try { return localStorage.getItem('mo-theme') || 'auto'; } catch { return 'auto'; } };
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0f1117' : '#f5f6fa';
}

// ---------- Navigation ----------
function route() {
  const [name = 'aujourdhui', arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name, arg };
}

const NAV = [
  ['aujourdhui', "Aujourd'hui", 'sun'],
  ['taches', 'Tâches', 'tasks'],
  ['projets', 'Projets', 'folder'],
  ['reglages', 'Réglages', 'sliders'],
];

function renderChrome(r) {
  const active = r.name === 'projet' || r.name === 'boite' ? 'projets' : r.name;
  const today = todayISO();
  const countToday = state.tasks.filter((t) => !t.done && t.due && t.due <= today).length;
  const navItem = ([k, label, ic]) => `
    <a href="#/${k}" class="nav-item ${active === k ? 'on' : ''}">${icon(ic)}<span>${label}</span>${k === 'aujourdhui' && countToday ? `<b class="badge">${countToday}</b>` : ''}</a>`;

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
    </div>`;

  $('#tabbar').innerHTML = `
    ${NAV.slice(0, 2).map(navItem).join('')}
    <button class="fab" data-action="quick-add" aria-label="Nouvelle tâche">${icon('plus')}</button>
    ${NAV.slice(2).map(navItem).join('')}`;
}

function renderView(r) {
  switch (r.name) {
    case 'taches': return tasksView(filter);
    case 'projets': return projectsView();
    case 'projet': return projectView(r.arg);
    case 'boite': return inboxView();
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
    const focused = document.activeElement;
    const keepFocus = focused && view.contains(focused) && focused.matches('input[data-setting]') ? focused.dataset.setting : null;
    view.innerHTML = renderView(r);
    if (keepFocus) {
      const el = view.querySelector(`[data-setting="${keepFocus}"]`);
      el?.focus();
      el?.setSelectionRange?.(el.value.length, el.value.length);
    }
  };
  const key = r.name + '/' + (r.arg || '');
  const changed = key !== lastRouteKey;
  lastRouteKey = key;
  if (transition && changed && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(doRender);
  } else {
    doRender();
  }
  if (changed) window.scrollTo({ top: 0 });
}

// ---------- Actions déclenchées par les clics ----------
function completeWithAnimation(id) {
  const t = getTask(id);
  if (!t) return;
  if (t.done) { reopenTask(id); return; }
  const row = document.querySelector(`.task[data-id="${id}"]`);
  row?.classList.add('completing');
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

const handlers = {
  'quick-add': () => {
    const r = route();
    openQuickAdd(r.name === 'projet' ? { projectId: r.arg } : {});
  },
  'close-sheet': () => closeSheet(),
  'toggle-task': (el) => completeWithAnimation(el.dataset.id),
  'open-task': (el) => openTask(el.dataset.id),
  'open-project': (el) => { location.hash = `#/projet/${el.dataset.id}`; },
  'open-inbox': () => { location.hash = '#/boite'; },
  'new-project': () => openProjectEditor(null, (id) => { location.hash = `#/projet/${id}`; }),
  'edit-project': (el) => openProjectEditor(el.dataset.id),
  go: (el) => { location.hash = `#/${el.dataset.route}`; },
  'filter-status': (el) => { filter.status = el.dataset.key; render(); },
  'filter-project': (el) => { filter.project = el.dataset.key; render(); },
  'set-theme': (el) => {
    try { localStorage.setItem('mo-theme', el.dataset.key); } catch { /* préférence non mémorisée */ }
    applyTheme(el.dataset.key);
    render();
  },
  'test-notif': () => testNotification(),
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
    download(`mon-organisateur-${todayISO()}.json`, JSON.stringify({ app: 'mon-organisateur', exportedAt: new Date().toISOString(), data: state }, null, 2));
    toast('Sauvegarde téléchargée');
  },
  wipe: () => openConfirm({
    title: 'Tout effacer ?',
    text: 'Projets, tâches et apprentissage seront supprimés de cet appareil. Exporte une sauvegarde avant si besoin.',
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
      if (res === 'granted') { toast('Notifications activées'); testNotification(); }
      else toast('Notifications refusées');
    } else {
      disableNotifications();
      toast('Notifications désactivées');
    }
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
        onConfirm: () => { replaceState(data); toast('Sauvegarde importée'); },
      });
    } catch {
      toast('Ce fichier n\'est pas une sauvegarde valide');
    }
    el.value = '';
  }
}

function onInput(e) {
  const key = e.target.dataset.setting;
  if (key) update((s) => { s.settings[key] = e.target.value.trim(); });
}

function onSubmit(e) {
  const form = e.target.closest('[data-form="project-add"]');
  if (!form) return;
  e.preventDefault();
  const text = form.title.value.trim();
  if (!text) return;
  const parsed = parseQuick(text, state.projects);
  createTask(parsed, { projectId: parsed.projectId ?? form.dataset.id });
  form.title.value = '';
  setTimeout(() => document.querySelector('[data-form="project-add"] input')?.focus(), 0);
}

function onKey(e) {
  if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if ($('#sheet').open) return;
  if (e.key === 'n' || e.key === 'N' || e.key === '+') { e.preventDefault(); handlers['quick-add'](); }
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
    else { rollDailyTasks(); render(); }
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
  if (params.get('ajout') === '1') { history.replaceState(null, '', location.pathname + location.hash); openQuickAdd(); }
  startNotifier();
}

start();
