/* Service Worker — Aurore Section Archives (v5)
   Objectif : ouvertures rapides + lecture hors ligne des documents déjà ouverts.
   Les données Supabase, l'authentification et les appels d'API ne sont PAS
   interceptés (traitement natif du navigateur).
     • Pages et fichiers du site (js/css/images/json) : réseau d'abord ; si le réseau
       met plus de 3-4 s (ou est coupé), la dernière copie enregistrée s'affiche.
       Hors ligne, toute page retombe sur l'accueil enregistré.
     • Bibliothèques et polices versionnées (CDN) : copie locale d'abord.
     • Couvertures de livres (Google Books, R2, Supabase Storage…) : copie locale d'abord,
       conservées pour l'affichage hors ligne (300 max).
     • PDF ouverts par l'élève : enregistrés après la 1re ouverture, relus hors ligne,
       y compris en lecture partielle (Range) (40 max, les plus anciens sont retirés).
*/

const SW_VERSION = 'v5';
const PAGE_CACHE = `aurore-shell-${SW_VERSION}`;
const STATIC_CACHE = `aurore-static-${SW_VERSION}`;
// Caches non versionnés : les couvertures et PDF survivent aux mises à jour du service worker.
const COVER_CACHE = 'aurore-covers';
const PDF_CACHE = 'aurore-pdf';
const KEEP_CACHES = [PAGE_CACHE, STATIC_CACHE, COVER_CACHE, PDF_CACHE];

const MAX_COVERS = 300;
const MAX_PDFS = 40;
const MAX_PDF_BYTES = 80 * 1024 * 1024;

const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const COVER_HOSTS = /(?:^|\.)(?:google\.com|googleusercontent\.com|openlibrary\.org|archive\.org|r2\.dev|supabase\.co)$/i;
const LOCAL_STATIC = /\.(?:js|css|png|jpe?g|webp|svg|ico|woff2?|json)$/i;
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|avif)$/i;
const PDF_EXT = /\.pdf$/i;
const PRECACHE = ['/', '/manifest.json', '/icon-192-1.png', '/icon-512-1.png', '/icon-maskable-512.png'];

const pdfDownloads = new Set();

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precacheShell());
});

async function precacheShell() {
  const pages = await caches.open(PAGE_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  await Promise.all(PRECACHE.map(async (path) => {
    try {
      const res = await fetch(path, { cache: 'reload' });
      if (res && res.ok && res.type === 'basic') {
        const href = new URL(path, self.location.origin).href;
        await (path === '/' ? pages : statics).put(href, res);
      }
    } catch (_) { /* l'installation ne doit jamais échouer à cause du pré-chargement */ }
  }));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('aurore-') && !KEEP_CACHES.includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimCache(name, max) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  } catch (_) {}
}

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

// ---- Couvertures : copie locale d'abord, enregistrement à la 1re vue ----
async function coverFirst(event, request) {
  const cache = await caches.open(COVER_CACHE);
  const cached = await cache.match(request.url);
  // Une copie « opaque » ne peut pas servir une requête CORS (canvas, fetch).
  if (cached && !(request.mode === 'cors' && cached.type === 'opaque')) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    const copy = response.clone();
    event.waitUntil(
      cache.put(request.url, copy).then(() => trimCache(COVER_CACHE, MAX_COVERS)).catch(() => {})
    );
  }
  return response;
}

// ---- PDF : copie locale d'abord, enregistrement à la 1re ouverture ----
function pdfKey(url) {
  return url.origin + url.pathname + url.search;
}

function sliceRange(response, header) {
  return response.clone().arrayBuffer().then((buf) => {
    const m = /bytes=(\d*)-(\d*)/.exec(header || '');
    if (!m || (m[1] === '' && m[2] === '')) return response;
    const total = buf.byteLength;
    let start;
    let end;
    if (m[1] === '') {
      start = Math.max(0, total - parseInt(m[2], 10));
      end = total - 1;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
    }
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    }
    return new Response(buf.slice(start, end + 1), {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/pdf',
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes'
      }
    });
  });
}

async function storePdf(key, href) {
  if (pdfDownloads.has(key)) return;
  const conn = self.navigator && self.navigator.connection;
  if (conn && conn.saveData) return;
  pdfDownloads.add(key);
  try {
    const cache = await caches.open(PDF_CACHE);
    if (await cache.match(key)) return;
    const res = await fetch(href);
    const size = parseInt(res.headers.get('content-length') || '0', 10);
    if (res && res.ok && res.status === 200 && res.type !== 'opaque' && size <= MAX_PDF_BYTES) {
      await cache.put(key, res);
      await trimCache(PDF_CACHE, MAX_PDFS);
    }
  } catch (_) {
    /* hors ligne ou refus : on réessaiera à la prochaine ouverture */
  } finally {
    pdfDownloads.delete(key);
  }
}

async function pdfFirst(event, request, url) {
  const cache = await caches.open(PDF_CACHE);
  const key = pdfKey(url);
  const cached = await cache.match(key);
  const range = request.headers.get('range');
  if (cached) return range ? sliceRange(cached, range) : cached;

  if (range) {
    // Lecture partielle : on laisse le réseau répondre et on enregistre le fichier complet à côté.
    event.waitUntil(storePdf(key, request.url));
    return fetch(request);
  }

  const response = await fetch(request);
  const size = parseInt(response.headers.get('content-length') || '0', 10);
  if (response && response.ok && response.status === 200 && response.type !== 'opaque' && size <= MAX_PDF_BYTES) {
    const copy = response.clone();
    event.waitUntil(
      cache.put(key, copy).then(() => trimCache(PDF_CACHE, MAX_PDFS)).catch(() => {})
    );
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }

  // Pages : réseau d'abord ; hors ligne, repli sur la page déjà vue, sinon sur l'accueil.
  if (request.mode === 'navigate') {
    const key = new Request(url.origin + url.pathname);
    event.respondWith(
      networkFirst(request, PAGE_CACHE, key, 4000).catch(async () => {
        const cache = await caches.open(PAGE_CACHE);
        return (await cache.match(url.origin + '/')) || Response.error();
      })
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // PDF (avant le filtre Range : les lectures partielles hors ligne sont servies depuis la copie).
  if (PDF_EXT.test(url.pathname) && !CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(pdfFirst(event, request, url));
    return;
  }

  // Les autres lectures partielles (médias) restent gérées par le navigateur.
  if (request.headers.has('range')) return;

  if (sameOrigin) {
    if (LOCAL_STATIC.test(url.pathname) && !/\/(?:api|auth)\//.test(url.pathname)) {
      event.respondWith(networkFirst(request, STATIC_CACHE, request, 3000));
    }
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Couvertures de livres venant d'autres hôtes.
  if (
    COVER_HOSTS.test(url.hostname) &&
    (request.destination === 'image' || IMAGE_EXT.test(url.pathname) || /\/books\/content/.test(url.pathname)) &&
    !/\/(?:rest|auth|functions)\//.test(url.pathname)
  ) {
    event.respondWith(coverFirst(event, request));
  }
});
