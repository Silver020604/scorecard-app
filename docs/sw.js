
// ===== Service Worker – GitHub Pages (/docs) =====
const BASE = '/scorecard-app';     // prefijo del repo
const VERSION = 'v3';              // incrementa cuando cambies recursos
const STATIC_CACHE = `${BASE}-static-${VERSION}`;

const STATIC_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/styles.css`,
  `${BASE}/admin.js`,
  `${BASE}/manifest.json`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/exec/index.html`,
  `${BASE}/exec/exec.js`
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => k.startsWith(`${BASE}-static-`) && k !== STATIC_CACHE)
        .map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// HTML/JSON: network-first (para ver cambios rápidos)
// CSS/JS/IMG: cache-first (rápido y offline)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (!url.pathname.startsWith(BASE)) return;

  const isHTML = req.headers.get('accept')?.includes('text/html');
  const isJSON = url.pathname.endsWith('.json');
  const isStatic = /\.(css|js|png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/.test(url.pathname);

  if (isHTML || isJSON) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
        .then((cached) => cached || caches.match(`${BASE}/index.html`))
    );
    return;
  }

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
