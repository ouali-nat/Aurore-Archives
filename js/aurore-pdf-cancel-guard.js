/* Aurore — garde d’annulation des rendus PDF.
   La production visible possède déjà son propre bouton d’annulation.
   Cette garde neutralise uniquement les rejets de promesse liés à une annulation.
   Aucun polling ni MutationObserver n’est nécessaire ici. */
(function () {
  'use strict';

  function ensureStyles() {
    if (document.getElementById('aurore-pdf-cancel-admin-styles')) return;
    const s = document.createElement('style');
    s.id = 'aurore-pdf-cancel-admin-styles';
    s.textContent = [
      '.cf-pdf-cancel-static{min-width:155px!important}',
      '.cf-pdf-cancel-static:disabled{opacity:.8!important;cursor:wait!important}',
      '.aurore-pdf-cancel-note{display:block;margin-top:6px;font-size:.68rem;color:#b91c1c;line-height:1.4}'
    ].join('');
    document.head.appendChild(s);
  }

  window.addEventListener('unhandledrejection', function (event) {
    const r = event.reason;
    const message = String(r?.message || r || '');
    if (/rendering\s+cancelled|RenderingCancelled|génération\s+annulée/i.test(message)) {
      event.preventDefault();
    }
  });

  function boot() {
    ensureStyles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

/* Aurore — chargement précoce du module « navigation fluide » (cache des données,
   animation de chargement, restauration du Retour). Ce fichier est le premier script
   de la page : le module s'exécute donc avant tous les autres appels réseau.
   Désactivation de secours : ?fluid=off */
(function () {
  try {
    if (document.readyState === 'loading') {
      document.write(
        '<link rel="stylesheet" href="css/aurore-fluid-navigation.css?v=20261003-fluid1">' +
        '<script src="js/aurore-fluid-navigation.js?v=20261003-fluid1"><\/script>'
      );
    }
  } catch (e) {}
})();
