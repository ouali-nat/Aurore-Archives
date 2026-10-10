/* Aurore — désactivation temporaire du cache de site.
   Le worker se met à jour, supprime les caches de pages/scripts/styles puis se
   désinscrit. Les caches PDF et couvertures sont conservés sur l'appareil, mais
   ne sont plus servis tant que le mode cache ne sera pas reconstruit.
*/
const SW_VERSION = 'v11-no-site-cache';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => /^aurore-(?:shell|static|libs)(?:-v[0-9]+)?$/.test(key))
        .map((key) => caches.delete(key)));
    } catch (error) {
      console.warn('[Aurore cache temporaire] Nettoyage impossible :', error);
    }
    try { await self.clients.claim(); } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
  })());
});

// Aucun écouteur fetch/message et aucun préchargement : le worker ne peut plus
// servir ni remplir un cache pour les pages, scripts, styles ou autres ressources.
