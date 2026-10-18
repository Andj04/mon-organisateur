// Notifications sans serveur : rappels à l'heure tant que l'application tourne,
// résumé du jour à l'ouverture, et réveil périodique par Android quand c'est possible.
import { state, update } from './store.js';
import { todayISO, nowTime } from './dates.js';
import { openTasks } from './actions.js';

export const notifSupported = () => 'Notification' in window && 'serviceWorker' in navigator;
export const notifPermission = () => (notifSupported() ? Notification.permission : 'unsupported');

async function show(title, options = {}) {
  if (notifPermission() !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification(title, {
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    lang: 'fr',
    ...options,
  });
}

export async function enableNotifications() {
  if (!notifSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  update((s) => { s.settings.notifications = perm === 'granted'; });
  if (perm === 'granted') await registerPeriodic();
  return perm;
}

export function disableNotifications() {
  update((s) => { s.settings.notifications = false; });
}

export const testNotification = () =>
  show('Notifications activées', { body: 'Tu recevras ici tes rappels de tâches.', tag: 'test' });

async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state === 'granted') {
      await reg.periodicSync.register('resume-du-jour', { minInterval: 12 * 60 * 60 * 1000 });
    }
  } catch { /* non disponible : l'application gère les rappels à l'ouverture */ }
}

function summary() {
  const today = todayISO();
  const open = openTasks();
  const late = open.filter((t) => t.due && t.due < today).length;
  const now = open.filter((t) => t.due === today).length;
  return { late, now };
}

export function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const { late, now } = summary();
  const n = late + now;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

function tick() {
  if (!state.settings.notifications || notifPermission() !== 'granted') return;
  const today = todayISO();
  const time = nowTime();

  // Résumé du jour, une fois par jour, à partir de 7 h.
  if (state.settings.lastSummary !== today && time >= '07:00') {
    const { late, now } = summary();
    update((s) => { s.settings.lastSummary = today; });
    if (late || now) {
      const parts = [];
      if (now) parts.push(`${now} tâche${now > 1 ? 's' : ''} aujourd'hui`);
      if (late) parts.push(`${late} en retard`);
      show('Ta journée', { body: parts.join(' · '), tag: 'resume' });
    }
  }

  // Rappels à l'heure exacte.
  for (const t of openTasks()) {
    if (t.due !== today || !t.time || t.time > time) continue;
    const key = `${t.due} ${t.time}`;
    if (t.notified === key) continue;
    update((s) => { const x = s.tasks.find((y) => y.id === t.id); if (x) x.notified = key; });
    show(t.title, { body: `Prévu à ${t.time.replace(':', 'h')}`, tag: t.id, data: { taskId: t.id } });
  }
}

export function startNotifier() {
  if (state.settings.notifications) registerPeriodic();
  tick();
  updateBadge();
  setInterval(() => { tick(); updateBadge(); }, 30 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
