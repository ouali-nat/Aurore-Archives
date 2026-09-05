/* Service Worker — Aurore Section Archives
   PWA minimale et sécurisée.
   Les pages et les appels réseau restent gérés par le réseau.
*/

const SW_VERSION = 'v3';
const CACHE_NAME = `aurore-shell-${SW_VERSION}`;

// Installation immédiate de la nouvelle version
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activation + suppression des anciennes versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('aurore-shell-') &&
                key !== CACHE_NAME
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Aucune page HTML ni donnée Supabase n'est conservée en cache
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Les pages doivent toujours être récupérées depuis le réseau
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .catch(() => caches.match(request))
    );
    return;
  }

  try {
    const url = new URL(request.url);

    // Supabase / authentification : toujours réseau
    if (
      url.hostname.includes('supabase.co') ||
      url.pathname.includes('/auth/')
    ) {
      event.respondWith(
        fetch(request, { cache: 'no-store' })
      );
      return;
    }
  } catch (_) {}

  // Autres ressources : réseau normal
  event.respondWith(fetch(request));
});
