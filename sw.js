/* Service Worker — Aurore Section Archives
   PWA minimale : installation et activation.
   Les requêtes du site restent gérées normalement par le réseau.
*/

const CACHE_NAME = 'aurore-shell-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});
