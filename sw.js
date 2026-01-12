
/* Service Worker - network-first para HTML/CSS/JS (ideal en desarrollo y GitHub Pages) */
const CACHE = 'scorecard-v2';
self.skipWaiting();
self.clients.claim();

const CORE = [
  './',
  './styles.css',
  './manifest.json',
  './exec/index.html', './exec/exec.js',
  './admin/index.html','./admin/admin.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null))))
  );
});

/* Network-first para docs/scripts/styles; cache-first para otros (icons, imágenes) */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const dest = req.destination; // 'document' | 'script' | 'style' | 'image' ...

  if (dest === 'document' || dest === 'script' || dest === 'style') {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req))
    );
  } else {
    e.respondWith(caches.match(req).then(res => res || fetch(req)));
  }
});
