/* Service worker — Aurore, Section Archives
   Rôle : permettre l'installation de la PWA (icône, écran de démarrage) et
   assurer un minimum de résilience hors-ligne, sans jamais mettre en cache
   les appels vers Supabase, R2 ou les workers (toujours servis par le
   réseau). */

const CACHE_NAME = 'aurore-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Navigation (ouverture/rafraîchissement de page) : réseau en priorité,
  // secours sur la page mise en cache si hors-ligne.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Fichiers du site (même origine uniquement) : cache d'abord, mise à jour
  // en arrière-plan. Tout ce qui vient d'une autre origine (Supabase, R2,
  // workers) est laissé tel quel au réseau, sans interception.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((reponseCache) => {
        const reponseReseau = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
            }
            return res;
          })
          .catch(() => reponseCache);
        return reponseCache || reponseReseau;
      })
    );
  }
});
