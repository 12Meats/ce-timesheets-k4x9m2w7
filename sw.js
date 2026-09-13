// CE Timesheets service worker — cache-first offline support.
// Bump CACHE on every deploy that changes any file in ASSETS.
const CACHE = 'ce-v4';
const ASSETS = [
  'index.html',
  'app.js',
  'paymath.js',
  'storage.js',
  'manifest.json',
  'icon.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
      // Debug hook: with no dev tools available on the owner's iPhone, this line
      // (visible via Safari remote inspect) is how we confirm which cache version
      // is actually active when someone reports "my app looks old".
      .then(() => console.log('CE Timesheets SW active, cache ' + CACHE))
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== location.origin) return;

  // Navigations (e.g. the bare "/" the home-screen icon launches, or any
  // directory URL) don't have a stable cache key across hosts the way a
  // named file does — './' resolves differently depending on where the app
  // is served from, and a mismatch there fails silently forever. Serve the
  // one page the app has instead of trying to key-match the request.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html').then((cached) => cached || fetch(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request);
    })
  );
});
