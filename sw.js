            /* =========================================================
   AURORE — SERVICE WORKER / PWA
   Version : 2026-09-04-2

   Objectifs :
   - Garder l'application fluide
   - Mettre en cache le shell de l'application
   - Toujours privilégier la version réseau pour index.html
     et le manifest afin d'éviter les anciennes versions
   - Fonctionnement hors-ligne de secours
   - Ne jamais intercepter les fichiers PDF
   - Ne pas empêcher les téléchargements
   ========================================================= */

const CACHE_NAME = 'aurore-shell-v2026-09-04-2';

const SHELL = [
  './',
  './index.html',
  './manifest.json'
];

/* =========================================================
   INSTALLATION
   ========================================================= */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});


/* =========================================================
   ACTIVATION
   Supprime les anciens caches
   ========================================================= */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});


/* =========================================================
   RESSOURCES CRITIQUES
   ========================================================= */

function estRessourceCritique(request) {
  const url = new URL(request.url);

  return (
    request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/manifest.json') ||
    url.pathname.endsWith('/sw.js')
  );
}


/* =========================================================
   INTERCEPTION DES REQUÊTES
   ========================================================= */

self.addEventListener('fetch', event => {

  const request = event.request;
  const url = new URL(request.url);

  /*
   * Ne traiter que les ressources appartenant
   * au même domaine que le Service Worker.
   */
  if (url.origin !== self.location.origin) {
    return;
  }


  /* =======================================================
     NAVIGATION + INDEX + MANIFEST + SW
     Réseau prioritaire pour éviter les anciennes versions
     ======================================================= */

  if (estRessourceCritique(request)) {

    event.respondWith(

      fetch(request, {
        cache: 'no-store'
      })

      .then(response => {

        if (response && response.ok) {

          const copie = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(request, copie);
            })
            .catch(() => {});
        }

        return response;
      })

      .catch(() => {

        /*
         * Si le réseau est indisponible,
         * utiliser la version mise en cache.
         */

        return caches.match(request)
          .then(cached => {

            if (cached) {
              return cached;
            }

            return caches.match('./index.html');
          });
      })
    );

    return;
  }


  /* =======================================================
     RESSOURCES STATIQUES
     Cache-first pour améliorer la rapidité
     ======================================================= */

  if (
    request.method === 'GET' &&
    !/\.pdf(?:$|[?#])/i.test(url.pathname)
  ) {

    event.respondWith(

      caches.match(request)

        .then(cached => {

          /*
           * Si la ressource existe déjà dans le cache,
           * on la retourne immédiatement.
           */

          if (cached) {
            return cached;
          }


          /*
           * Sinon, récupération réseau.
           */

          return fetch(request)

            .then(response => {

              if (
                response &&
                response.ok &&
                response.type === 'basic'
              ) {

                const copie = response.clone();

                caches.open(CACHE_NAME)
                  .then(cache => {
                    cache.put(request, copie);
                  })
                  .catch(() => {});
              }

              return response;
            });
        })
    );
  }

});
