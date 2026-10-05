/* Service Worker — Aurore Section Archives (v6)
   Objectif : ouvertures rapides + lecture hors ligne de ce que l'élève a déjà ouvert.
   Les données Supabase, l'authentification et les appels d'API ne sont PAS
   interceptés (traitement natif du navigateur).
     • Pages et fichiers du site (js/css/images/json) : réseau d'abord ; si le réseau
       met plus de 3-4 s (ou est coupé), la dernière copie enregistrée s'affiche.
       Hors ligne, toute page retombe sur l'accueil enregistré.
     • Bibliothèques (pdf.js, CDN, polices) : copie locale d'abord. pdf.js est préchargé à
       l'installation : sans lui, aucun PDF ne peut s'afficher hors ligne.
     • Couvertures d'images (Google Books, R2, Supabase Storage…) : copie locale d'abord,
       toutes conservées. (Les vignettes « 1re page du PDF » sont déjà gardées par le site
       dans IndexedDB.)
     • PDF : enregistrés UNIQUEMENT quand l'élève les ouvre dans le lecteur (le lecteur
       demande le fichier complet avec l'en-tête Accept: application/pdf). La fabrication des
       vignettes (lectures partielles de PDF.js) ne télécharge et n'enregistre jamais un PDF
       complet. Aucune limite fixe : on ne retire les plus anciens que si l'appareil manque
       réellement d'espace.
*/

const SW_VERSION = 'v6';
const PAGE_CACHE = `aurore-shell-${SW_VERSION}`;
const STATIC_CACHE = `aurore-static-${SW_VERSION}`;
// Caches non versionnés : ils survivent aux mises à jour du service worker.
const LIB_CACHE = 'aurore-libs';
const COVER_CACHE = 'aurore-covers';
const PDF_CACHE = 'aurore-pdf-ouverts';
const KEEP_CACHES = [PAGE_CACHE, STATIC_CACHE, LIB_CACHE, COVER_CACHE, PDF_CACHE];

const MARGE_STOCKAGE = 30 * 1024 * 1024;

const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const PDF_HOSTS = ['lsnb-upload.oualikevin9.workers.dev', 'pub-0433751d08eb49fcafb7355ef0bf42ab.r2.dev'];
const COVER_HOSTS = /(?:^|\.)(?:google\.com|googleusercontent\.com|openlibrary\.org|archive\.org|r2\.dev|supabase\.co)$/i;
const LOCAL_STATIC = /\.(?:js|css|png|jpe?g|webp|svg|ico|woff2?|json)$/i;
const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|avif)$/i;
const PDF_EXT = /\.pdf$/i;
const PRECACHE = ['/', '/manifest.json', '/icon-192-1.png', '/icon-512-1.png', '/icon-maskable-512.png'];
const PRECACHE_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.all([precacheShell(), precacheLibs()]));
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

async function precacheLibs() {
  const cache = await caches.open(LIB_CACHE);
  await Promise.all(PRECACHE_LIBS.map(async (href) => {
    try {
      if (await cache.match(href, { ignoreVary: true })) return;
      const res = await fetch(href, { mode: 'cors' });
      if (res && res.ok) await cache.put(href, res);
    } catch (_) {}
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
      .then(() => {
        // Demande un stockage durable : le navigateur ne vide pas les PDF enregistrés quand il manque de place.
        try { if (self.navigator && self.navigator.storage && self.navigator.storage.persist) self.navigator.storage.persist(); } catch (_) {}
        return self.clients.claim();
      })
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
    const cached = await cache.match(key, { ignoreVary: true });
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

// ---- Bibliothèques / polices (CDN) : copie locale d'abord ----
async function libFirst(request) {
  const cache = await caches.open(LIB_CACHE);
  const cached = await cache.match(request.url, { ignoreVary: true });
  // Une copie « opaque » ne peut pas servir une requête CORS.
  if (cached && !(request.mode === 'cors' && cached.type === 'opaque')) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request.url, response.clone()).catch(() => {});
  }
  return response;
}

// ---- Couvertures d'images : copie locale d'abord, toutes conservées ----
async function coverFirst(event, request) {
  const cache = await caches.open(COVER_CACHE);
  const cached = await cache.match(request.url, { ignoreVary: true });
  if (cached && !(request.mode === 'cors' && cached.type === 'opaque')) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    const copy = response.clone();
    event.waitUntil(cache.put(request.url, copy).catch(() => {}));
  }
  return response;
}

// ---- PDF ----
function pdfKey(url) {
  return url.origin + url.pathname + url.search;
}

// Sert une lecture partielle (Range) depuis la copie enregistrée, sans recopier tout le fichier en mémoire.
async function sliceRange(response, header) {
  const m = /bytes=(\d*)-(\d*)/.exec(header || '');
  if (!m || (m[1] === '' && m[2] === '')) return response;
  const blob = await response.clone().blob();
  const total = blob.size;
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
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/pdf',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

// Libère de la place seulement si l'appareil en manque vraiment (retire les plus anciens PDF).
async function garantirPlace(octets) {
  try {
    if (!octets || !self.navigator || !self.navigator.storage || !self.navigator.storage.estimate) return;
    const cache = await caches.open(PDF_CACHE);
    for (let i = 0; i < 1000; i++) {
      const est = await self.navigator.storage.estimate();
      const quota = est.quota || 0;
      const usage = est.usage || 0;
      if (!quota || quota - usage > octets * 1.15 + MARGE_STOCKAGE) return;
      const keys = await cache.keys();
      if (!keys.length) return;
      await cache.delete(keys[0]);
    }
  } catch (_) {}
}

async function enregistrerPdf(key, response) {
  try {
    const taille = parseInt(response.headers.get('content-length') || '0', 10);
    await garantirPlace(taille);
    const cache = await caches.open(PDF_CACHE);
    await cache.put(key, response);
  } catch (_) {
    /* réseau coupé en cours de route ou espace insuffisant : rien n'est enregistré */
  }
}

async function pdfFirst(event, request, url) {
  const cache = await caches.open(PDF_CACHE);
  const key = pdfKey(url);
  const cached = await cache.match(key, { ignoreVary: true });
  const range = request.headers.get('range');
  if (cached) return range ? sliceRange(cached, range) : cached;

  const response = await fetch(request);

  // On n'enregistre que la lecture complète demandée par le lecteur PDF (Accept: application/pdf).
  const demandeParLeLecteur = !range && /application\/pdf/i.test(request.headers.get('accept') || '');
  const type = response.headers.get('content-type') || '';
  if (demandeParLeLecteur && response.ok && response.status === 200 && response.type !== 'opaque' && !/text\/html|json/i.test(type)) {
    event.waitUntil(enregistrerPdf(key, response.clone()));
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
        return (await cache.match(url.origin + '/', { ignoreVary: true })) || Response.error();
      })
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const imageCouverture = IMAGE_EXT.test(url.pathname) || /\/books\/content/.test(url.pathname) || request.destination === 'image';

  // PDF (avant le filtre Range : les lectures partielles sont servies depuis la copie quand elle existe).
  // Le téléchargement (?download=...) reste géré par le navigateur.
  if (
    !sameOrigin &&
    !CDN_HOSTS.includes(url.hostname) &&
    !url.searchParams.has('download') &&
    (PDF_EXT.test(url.pathname) || (PDF_HOSTS.includes(url.hostname) && !imageCouverture && url.pathname.length > 1))
  ) {
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
    event.respondWith(libFirst(request));
    return;
  }

  // Couvertures d'images venant d'autres hôtes.
  if (
    COVER_HOSTS.test(url.hostname) &&
    imageCouverture &&
    !/\/(?:rest|auth|functions)\//.test(url.pathname)
  ) {
    event.respondWith(coverFirst(event, request));
  }
});
