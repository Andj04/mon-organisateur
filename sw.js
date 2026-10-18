// Service worker : fonctionnement hors ligne, notifications et réveil périodique.
const VERSION = 'v1.0.0';
const CACHE = 'mon-organisateur-' + VERSION;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/actions.js', 'js/classifier.js', 'js/dates.js', 'js/db.js', 'js/icons.js',
  'js/notify.js', 'js/parser.js', 'js/recurrence.js', 'js/sheets.js', 'js/store.js', 'js/text.js',
  'js/toast.js', 'js/views.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/badge-96.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord pour avoir la dernière version, cache si hors ligne.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const taskId = e.notification.data?.taskId;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all[0];
    if (client) {
      await client.focus();
      if (taskId) client.postMessage({ type: 'open-task', taskId });
    } else {
      await self.clients.openWindow('./#/aujourdhui');
    }
  })());
});

// ---- Réveil périodique (Android, application installée) : résumé du jour ----
function readState() {
  return new Promise((resolve) => {
    const req = indexedDB.open('mon-organisateur', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const get = req.result.transaction('kv').objectStore('kv').get('state');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => resolve(null);
    };
  });
}

const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'resume-du-jour') return;
  e.waitUntil((async () => {
    const s = await readState();
    if (!s?.settings?.notifications) return;
    const today = localISO(new Date());
    const open = s.tasks.filter((t) => !t.done && t.due);
    const now = open.filter((t) => t.due === today).length;
    const late = open.filter((t) => t.due < today).length;
    if (!now && !late) return;
    const parts = [];
    if (now) parts.push(`${now} tâche${now > 1 ? 's' : ''} aujourd'hui`);
    if (late) parts.push(`${late} en retard`);
    await self.registration.showNotification('Ta journée', {
      body: parts.join(' · '), tag: 'resume', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', lang: 'fr',
    });
  })());
});
