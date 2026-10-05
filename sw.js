/* Service Worker — Aurore Section Archives (v4)
   Objectif : ouvertures plus rapides sans jamais servir une version périmée
   quand le réseau répond. Les données Supabase, l'authentification, les PDF et
   les appels d'API ne sont PAS interceptés (traitement natif du navigateur).
     • Pages et fichiers du site (js/css/images/json) : réseau d'abord ; si le réseau
       met plus de 3-4 s, la dernière copie enregistrée s'affiche immédiatement.
     • Bibliothèques et polices versionnées (CDN) : copie locale d'abord.
*/

const SW_VERSION = 'v4';
const PAGE_CACHE = `aurore-shell-${SW_VERSION}`;
const STATIC_CACHE = `aurore-static-${SW_VERSION}`;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const LOCAL_STATIC = /\.(?:js|css|png|jpe?g|webp|svg|ico|woff2?|json)$/i;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('aurore-') && key !== PAGE_CACHE && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName, cacheKey, timeoutMs) {
  const cache = await caches.open(cacheName);
  const key = cacheKey || request;
  const networkPromise = fetch(request, { cache: 'no-cache' });
  networkPromise.catch(() => {});
  let timer;
  try {
    const response = await Promise.race([
      networkPromise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })
    ]);
    clearTimeout(timer);
    if (response && response.ok && response.type === 'basic') {
      cache.put(key, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    clearTimeout(timer);
    const cached = await cache.match(key);
    if (cached) {
      // La requête réseau continue en arrière-plan et met la copie à jour.
      networkPromise.then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
      }).catch(() => {});
      return cached;
    }
    return networkPromise;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && (response.type === 'cors' || response.type === 'basic')) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }

  // Pages : réseau d'abord (copie de secours si le réseau est trop lent).
  if (request.mode === 'navigate') {
    const key = new Request(url.origin + url.pathname);
    event.respondWith(networkFirst(request, PAGE_CACHE, key, 4000));
    return;
  }

  // Les lectures partielles (PDF, médias) restent gérées par le navigateur.
  if (request.headers.has('range')) return;

  if (url.origin === self.location.origin) {
    if (LOCAL_STATIC.test(url.pathname) && !/\/(?:api|auth)\//.test(url.pathname)) {
      event.respondWith(networkFirst(request, STATIC_CACHE, request, 3000));
    }
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});
