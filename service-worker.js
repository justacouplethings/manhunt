const CACHE_NAME = 'manhunt-v2.2.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './css/leaflet.css',
  './js/leaflet.js',
  './js/paho-mqtt.min.js',
  './js/config.js',
  './js/geo.js',
  './js/network.js',
  './js/map.js',
  './js/game.js',
  './js/simulation.js',
  './js/ui.js',
  './manifest.json',
  './assets/icon.png',
  './assets/icon-192.png',
  './assets/favicon.png',
  './privacy-policy.html'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Purging stale cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Real-time map tiles & WebSocket traffic bypass service worker
  if (event.request.url.includes('tile.openstreetmap.org') ||
      event.request.url.includes('arcgisonline.com') ||
      event.request.url.includes('basemaps.cartocdn.com') ||
      event.request.url.startsWith('ws://') ||
      event.request.url.startsWith('wss://')) {
    return;
  }

  // Network-First strategy: Always fetch latest updates from GitHub Pages, fallback to cache when offline
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && event.request.method === 'GET') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
