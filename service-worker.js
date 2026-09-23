const CACHE_NAME = 'habitly-v32';
const STATIC_CACHE = `${CACHE_NAME}-static`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './auth-gate.css',
  './auth-gate.js',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './og-image.png',
  './assets/Fav Icon Habitly.png',
  './assets/Habitly Leaf Transparent.png',
  './assets/Habitly Leaf White.png',
  './assets/favicon-16.png',
  './assets/favicon-32.png',
  './assets/apple-touch-icon.png',
  './assets/habitly-icon-192.png',
  './assets/habitly-icon-512.png',
  './auth/index.html',
  './auth/app.js',
  './auth/styles.css',
  './auth/assets/google.svg',
  './auth/assets/habitly-logo.png',
  './auth/assets/mountain-habitly.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(error => console.warn('Habitly cache warmup failed:', error))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

function isAppCode(request) {
  return ['document', 'script', 'style'].includes(request.destination);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !isSameOrigin(request)) return;

  // HTML/CSS/JS are network-first so a deployed update is picked up
  // immediately instead of leaving users stuck on an old cached build.
  if (isAppCode(request)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // Images/fonts and other static assets can remain cache-first.
  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      }))
      .catch(() => caches.match('./index.html'))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const route = event.notification?.data?.route === 'calendar' ? 'calendar' : 'habits';
  const target = `./index.html#/${route}`;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(client => new URL(client.url).origin === self.location.origin);
      if (existing) {
        return existing.navigate(target).catch(() => {}).then(() => existing.focus());
      }
      return clients.openWindow(target);
    })
  );
});
