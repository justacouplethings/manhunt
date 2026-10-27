const CACHE_NAME = 'manhunt-v1.2.0';
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
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Tile requests & WebSocket shouldn't fail offline
  if (event.request.url.includes('tile.openstreetmap.org') ||
      event.request.url.includes('arcgisonline.com') ||
      event.request.url.includes('basemaps.cartocdn.com') ||
      event.request.url.startsWith('ws://') ||
      event.request.url.startsWith('wss://')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).catch(() => {
        // Fallback for offline navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
