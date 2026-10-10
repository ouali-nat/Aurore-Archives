/* Service Worker — Aurore Section Archives (v9)
   Actualise les caches d'interface à la mise à jour pour éviter de réafficher un ancien habillage.
   Les liens CSS locaux de la publication portent une clé de révision nouvelle.
   Les anciennes pages profondes et les anciennes feuilles CSS sont invalidées à l'activation.
   Les bibliothèques, couvertures et PDF déjà ouverts restent conservés.
*/

const SW_VERSION = 'v9';
// Caches non versionnés : ils survivent à TOUTES les mises à jour du service worker.
const PAGE_CACHE = 'aurore-shell';
const STATIC_CACHE = 'aurore-static';
const LIB_CACHE = 'aurore-libs';
const COVER_CACHE = 'aurore-covers';
const PDF_CACHE = 'aurore-pdf-ouverts';
const KEEP_CACHES = [PAGE_CACHE, STATIC_CACHE, LIB_CACHE, COVER_CACHE, PDF_CACHE];
// Anciens caches versionnés (aurore-shell-v6, aurore-static-v6…) : leur contenu est repris puis ils sont retirés.
const OLD_VERSIONED = /^aurore-(shell|static)-v\d+$/;

const MARGE_STOCKAGE = 8 * 1024 * 1024;

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
        if (path === '/') {
          // On lit l'accueil pour retrouver les scripts / feuilles de style locaux et les enregistrer aussi.
          let html = '';
          try { html = await res.clone().text(); } catch (_) {}
          await pages.put(href, res);
          await precacheAssetsFromHtml(html, statics);
        } else {
          await statics.put(href, res);
        }
      }
    } catch (_) { /* l'installation ne doit jamais échouer à cause du pré-chargement */ }
  }));
}

// Repère dans le HTML de l'accueil les fichiers locaux (js/css/images) et les enregistre.
async function precacheAssetsFromHtml(html, statics) {
  if (!html) return;
  const trouves = new Set();
  const re = /(?:src|href)\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) && trouves.size < 150) {
    try {
      const u = new URL(m[1], self.location.origin);
      if (u.origin !== self.location.origin) continue;
      if (!LOCAL_STATIC.test(u.pathname)) continue;
      trouves.add(u.href);
    } catch (_) {}
  }
  await Promise.all([...trouves].map(async (href) => {
    try {
      if (await statics.match(href, { ignoreVary: true })) return;
      const res = await fetch(href, { cache: 'reload' });
      if (res && res.ok && res.type === 'basic') await statics.put(href, res);
    } catch (_) {}
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

// Reprend le contenu des anciens caches versionnés dans les caches durables, sans écraser l'existant.
async function migrerAnciensCaches(keys) {
  for (const key of keys) {
    if (!OLD_VERSIONED.test(key)) continue;
    try {
      const cible = await caches.open(key.indexOf('aurore-shell') === 0 ? PAGE_CACHE : STATIC_CACHE);
      const ancien = await caches.open(key);
      const requetes = await ancien.keys();
      for (const req of requetes) {
        try {
          if (await cible.match(req, { ignoreVary: true })) continue;
          const rep = await ancien.match(req, { ignoreVary: true });
          if (rep) await cible.put(req, rep);
        } catch (_) {}
      }
    } catch (_) {}
  }
}

async function rafraichirCachesInterface() {
  // Ne jamais conserver une ancienne page profonde après la publication.
  // La page d'accueil a déjà été renouvelée par precacheShell() à l'installation.
  try {
    const pages = await caches.open(PAGE_CACHE);
    const pageRequests = await pages.keys();
    await Promise.all(pageRequests.map(async (request) => {
      try {
        const url = new URL(request.url);
        if (url.origin === self.location.origin && url.pathname !== '/') {
          await pages.delete(request);
        }
      } catch (_) {}
    }));
  } catch (_) {}

  // Les nouvelles URL CSS possèdent un paramètre de publication distinct.
  // Supprimer uniquement les anciennes entrées CSS, sans toucher aux images,
  // aux polices, aux fichiers PDF ni aux couvertures hors ligne.
  try {
    const statics = await caches.open(STATIC_CACHE);
    const requests = await statics.keys();
    await Promise.all(requests.map(async (request) => {
      try {
        const url = new URL(request.url);
        if (url.origin !== self.location.origin || !/\.css$/i.test(url.pathname)) return;
        if (url.searchParams.get('aurore_release') !== '20261010-firstpaint1') {
          await statics.delete(request);
        }
      } catch (_) {}
    }));
  } catch (_) {}
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await migrerAnciensCaches(keys);
      await rafraichirCachesInterface();
      const finalKeys = await caches.keys();
      await Promise.all(
        finalKeys
          .filter((key) => key.startsWith('aurore-') && !KEEP_CACHES.includes(key))
          .map((key) => caches.delete(key))
      );
      try {
        if (self.navigator && self.navigator.storage && self.navigator.storage.persist) {
          self.navigator.storage.persist();
        }
      } catch (_) {}
      await self.clients.claim();
    })()
  );
});

// ---- La page signale les fichiers qu'elle vient de charger : on les enregistre s'ils manquent ----
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'AURORE_WARM' || !Array.isArray(data.urls)) return;
  event.waitUntil(rechauffer(data.urls));
});

async function rechauffer(urls) {
  const statics = await caches.open(STATIC_CACHE);
  const pages = await caches.open(PAGE_CACHE);
  const libs = await caches.open(LIB_CACHE);
  const vus = new Set();
  for (const brut of urls.slice(0, 250)) {
    let url;
    try { url = new URL(brut, self.location.origin); } catch (_) { continue; }
    if (vus.has(url.href)) continue;
    vus.add(url.href);
    try {
      if (url.origin === self.location.origin) {
        if (/\/(?:api|auth)\//.test(url.pathname)) continue;
        if (LOCAL_STATIC.test(url.pathname)) {
          if (await statics.match(url.href, { ignoreVary: true })) continue;
          const res = await fetch(url.href, { cache: 'reload' });
          if (res && res.ok && res.type === 'basic') await statics.put(url.href, res);
        } else if (!/\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
          // Page du site (sans extension) : clé identique à celle des navigations.
          const cle = url.origin + url.pathname;
          if (await pages.match(cle, { ignoreVary: true })) continue;
          const res = await fetch(cle, { cache: 'reload' });
          if (res && res.ok && res.type === 'basic') await pages.put(cle, res);
        }
      } else if (CDN_HOSTS.includes(url.hostname)) {
        if (await libs.match(url.href, { ignoreVary: true })) continue;
        const res = await fetch(url.href, { mode: 'cors' });
        if (res && res.ok) await libs.put(url.href, res);
      }
    } catch (_) { /* hors ligne ou ressource indisponible : on passe */ }
  }
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

// Sert une lecture partielle (Range) depuis la copie enregistrée.
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

// Libère de la place seulement si l'appareil en manque VRAIMENT (retire les plus anciens PDF, un par un).
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
      networkFirst(request, PAGE_CACHE, key, 250).catch(async () => {
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
      event.respondWith(networkFirst(request, STATIC_CACHE, request, 350));
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
