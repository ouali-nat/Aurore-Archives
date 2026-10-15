/* Service Worker — Aurore Section Archives (v12, mode hors ligne reconstruit)

   Objectifs
   1) Hors ligne : la page d'accueil, les scripts, les styles, les bibliothèques (pdf.js),
      les couvertures et les PDF déjà ouverts restent disponibles sans connexion.
   2) Déploiements : en ligne, le RÉSEAU PASSE TOUJOURS EN PREMIER (avec revalidation).
      La copie locale ne sert qu'en cas de coupure réelle, d'erreur serveur (5xx) ou de
      réseau vraiment trop lent (NETWORK_TIMEOUT). Un nouveau déploiement est donc visible
      dès l'ouverture suivante, sans jamais rester bloqué sur une ancienne version.
   3) Les copies de fichiers locaux sont rangées sans leur paramètre « ?v= » : un seul
      exemplaire par fichier, toujours le dernier vu en ligne (pas d'accumulation).

   Caches durables (jamais supprimés par une mise à jour du worker) :
   aurore-shell (pages), aurore-static (js/css/images locaux), aurore-libs (CDN),
   aurore-covers (couvertures), aurore-pdf-ouverts (PDF).
*/

const SW_VERSION = 'v15-native-biometric-bridge-20261015';

const PAGE_CACHE = 'aurore-shell';
const STATIC_CACHE = 'aurore-static';
const LIB_CACHE = 'aurore-libs';
const COVER_CACHE = 'aurore-covers';
const PDF_CACHE = 'aurore-pdf-ouverts';
const KEEP_CACHES = [PAGE_CACHE, STATIC_CACHE, LIB_CACHE, COVER_CACHE, PDF_CACHE];

const MARGE_STOCKAGE = 8 * 1024 * 1024;
// Au-delà de ce délai (réseau réellement très lent), on sert la copie locale pendant que le réseau continue.
const NETWORK_TIMEOUT = 6000;

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

// Bloc « désactivation temporaire » encore présent dans index.html : il désinscrirait ce worker et
// viderait ses caches à chaque chargement. Le worker le retire des pages qu'il sert et qu'il range.
const BLOC_DESACTIVATION = /<script[^>]*id=["']aurore-temporary-disable-site-cache["'][^>]*>[\s\S]*?<\/script>\s*/i;

const PAGE_HORS_LIGNE = '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Aurore — hors ligne</title>' +
  '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;' +
  'background:#0f0e17;color:#f3f1ff;text-align:center;padding:24px}' +
  'main{max-width:420px}h1{font-size:1.25rem;margin:0 0 10px}p{opacity:.8;line-height:1.5;margin:0 0 18px}' +
  'button{border:0;border-radius:12px;padding:12px 20px;font-size:1rem;font-weight:700;background:#f59e0b;color:#1a1200}</style>' +
  '</head><body><main><h1>Aurore est hors ligne</h1>' +
  '<p>Aucune copie de cette page n\'est encore enregistrée sur cet appareil. ' +
  'Reconnectez-vous une première fois : le site sera ensuite disponible sans connexion.</p>' +
  '<button onclick="location.reload()">Réessayer</button></main></body></html>';

// ---------------------------------------------------------------------------------------------
// Clés de cache
// ---------------------------------------------------------------------------------------------
function cleLocale(url) {
  // Fichier local : on ignore le paramètre de version (?v=…, ?aurore_fresh=…).
  return url.origin + url.pathname;
}

// ---------------------------------------------------------------------------------------------
// Nettoyage du HTML
// ---------------------------------------------------------------------------------------------
async function nettoyerHtml(response) {
  try {
    const type = response.headers.get('content-type') || '';
    if (!/text\/html/i.test(type)) return response;
    const html = await response.clone().text();
    if (!BLOC_DESACTIVATION.test(html)) return response;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(html.replace(BLOC_DESACTIVATION, ''), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (_) {
    return response;
  }
}

// ---------------------------------------------------------------------------------------------
// Installation : copie de l'accueil, de ses fichiers locaux et de pdf.js
// ---------------------------------------------------------------------------------------------
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
      if (!res || !res.ok || res.type !== 'basic') return;
      const href = new URL(path, self.location.origin).href;
      if (path === '/') {
        let html = '';
        try { html = await res.clone().text(); } catch (_) {}
        await pages.put(href, await nettoyerHtml(res));
        await precacheAssetsFromHtml(html, statics);
      } else {
        await statics.put(href, res);
      }
    } catch (_) { /* l'installation ne doit jamais échouer à cause du pré-chargement */ }
  }));
}

// Repère dans le HTML de l'accueil les fichiers locaux (js/css/images) et les enregistre.
async function precacheAssetsFromHtml(html, statics) {
  if (!html) return;
  const trouves = new Map();
  const re = /(?:src|href)\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) && trouves.size < 200) {
    try {
      const u = new URL(m[1], self.location.origin);
      if (u.origin !== self.location.origin) continue;
      if (!LOCAL_STATIC.test(u.pathname)) continue;
      trouves.set(cleLocale(u), u.href);
    } catch (_) {}
  }
  const liste = [...trouves.entries()];
  // Par petits groupes, pour ne pas concurrencer le chargement de la page.
  for (let i = 0; i < liste.length; i += 8) {
    await Promise.all(liste.slice(i, i + 8).map(async ([cle, href]) => {
      try {
        if (await statics.match(cle, { ignoreVary: true })) return;
        const res = await fetch(href, { cache: 'reload' });
        if (res && res.ok && res.type === 'basic') await statics.put(cle, res);
      } catch (_) {}
    }));
  }
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

// ---------------------------------------------------------------------------------------------
// Activation : on garde les caches durables, on retire tout le reste
// ---------------------------------------------------------------------------------------------
async function retirerAnciennesCles() {
  // Anciennes copies rangées avec leur « ?v=… » : remplacées par une copie unique par fichier.
  try {
    const statics = await caches.open(STATIC_CACHE);
    const requetes = await statics.keys();
    await Promise.all(requetes.map(async (req) => {
      try {
        const u = new URL(req.url);
        if (u.search || u.pathname === '/js/aurore-personal-actions.js') await statics.delete(req);
      } catch (_) {}
    }));
  } catch (_) {}
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await retirerAnciennesCles();
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('aurore-') && !KEEP_CACHES.includes(key))
        .map((key) => caches.delete(key))
    );
    try {
      if (self.navigator && self.navigator.storage && self.navigator.storage.persist) {
        self.navigator.storage.persist();
      }
    } catch (_) {}
    await self.clients.claim();
  })());
});

// ---------------------------------------------------------------------------------------------
// Messages de la page
// ---------------------------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'AURORE_WARM' && Array.isArray(data.urls)) {
    event.waitUntil(rechauffer(data.urls));
    return;
  }
  if (data.type === 'AURORE_PURGE') {
    // Mise à jour forcée : on retire pages et fichiers locaux (couvertures, PDF et bibliothèques restent).
    event.waitUntil((async () => {
      try { await caches.delete(PAGE_CACHE); } catch (_) {}
      try { await caches.delete(STATIC_CACHE); } catch (_) {}
      try { if (event.source) event.source.postMessage({ type: 'AURORE_PURGED' }); } catch (_) {}
    })());
  }
});

// La page signale les fichiers qu'elle vient de charger : on enregistre ceux qui manquent.
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
        const cle = cleLocale(url);
        if (LOCAL_STATIC.test(url.pathname)) {
          if (await statics.match(cle, { ignoreVary: true })) continue;
          const res = await fetch(url.href, { cache: 'no-cache' });
          if (res && res.ok && res.type === 'basic') await statics.put(cle, res);
        } else if (!/\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
          if (await pages.match(cle, { ignoreVary: true })) continue;
          const res = await fetch(cle, { cache: 'no-cache' });
          if (res && res.ok && res.type === 'basic') await pages.put(cle, await nettoyerHtml(res));
        }
      } else if (CDN_HOSTS.includes(url.hostname)) {
        if (await libs.match(url.href, { ignoreVary: true })) continue;
        const res = await fetch(url.href, { mode: 'cors' });
        if (res && res.ok) await libs.put(url.href, res);
      }
    } catch (_) { /* hors ligne ou ressource indisponible : on passe */ }
  }
}

// ---------------------------------------------------------------------------------------------
// Réseau d'abord (pages et fichiers du site)
// ---------------------------------------------------------------------------------------------
async function memoriser(cache, key, response, transform) {
  if (!response) return response;
  if (response.ok && response.type === 'basic') {
    const sortie = transform ? await transform(response) : response;
    cache.put(key, sortie.clone()).catch(() => {});
    return sortie;
  }
  return response;
}

async function networkFirst(request, cacheName, key, timeoutMs, transform) {
  const cache = await caches.open(cacheName);

  // Appareil clairement hors ligne : inutile d'attendre le réseau.
  if (self.navigator && self.navigator.onLine === false) {
    const copie = await cache.match(key, { ignoreVary: true });
    if (copie) return copie;
  }

  const networkPromise = fetch(request, { cache: 'no-cache' });
  networkPromise.catch(() => {});
  let timer;
  try {
    const response = await Promise.race([
      networkPromise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })
    ]);
    clearTimeout(timer);
    // Erreur serveur : une copie saine vaut mieux qu'une page d'erreur.
    if (response && response.status >= 500) {
      const copie = await cache.match(key, { ignoreVary: true });
      if (copie) return copie;
    }
    return await memoriser(cache, key, response, transform);
  } catch (err) {
    clearTimeout(timer);
    const copie = await cache.match(key, { ignoreVary: true });
    if (copie) {
      // Le réseau continue en arrière-plan et met la copie à jour pour la prochaine ouverture.
      networkPromise.then((res) => memoriser(cache, key, res, transform)).catch(() => {});
      return copie;
    }
    return networkPromise;
  }
}

async function pageSecours(url) {
  try {
    const cache = await caches.open(PAGE_CACHE);
    const accueil = await cache.match(url.origin + '/', { ignoreVary: true });
    if (accueil) return accueil;
  } catch (_) {}
  return new Response(PAGE_HORS_LIGNE, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// ---------------------------------------------------------------------------------------------
// Bibliothèques / polices (CDN) : copie locale d'abord
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// Couvertures d'images : copie locale d'abord, toutes conservées
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// Interception des requêtes
// ---------------------------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }

  // Pages : réseau d'abord ; hors ligne, repli sur la page déjà vue, sinon sur l'accueil.
  if (request.mode === 'navigate') {
    if (url.origin !== self.location.origin) return;
    event.respondWith(
      networkFirst(request, PAGE_CACHE, cleLocale(url), NETWORK_TIMEOUT, nettoyerHtml)
        .catch(() => pageSecours(url))
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
      event.respondWith(networkFirst(request, STATIC_CACHE, cleLocale(url), NETWORK_TIMEOUT));
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
