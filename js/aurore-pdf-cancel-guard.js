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

/* Aurore — chargement PRÉCOCE de la détection réelle du réseau (site + application).
   Les scripts « defer » du site attendent le moteur Supabase (CDN) avant de s'exécuter :
   si ce CDN est lent, tout ce qui est chargé plus bas démarre en retard. Ce fichier est
   le premier script de la page : la détection du réseau (notification « Connexion
   interrompue / rétablie ») démarre donc immédiatement, sans attendre.
   Chargement asynchrone : aucun blocage de l'affichage. Voir js/aurore-reseau-fiable.js. */
(function () {
  try {
    if (window.__auroreReseauFiableCharge) return;
    window.__auroreReseauFiableCharge = true;
    var s = document.createElement('script');
    s.src = 'js/aurore-reseau-fiable.js?v=20261007-1';
    s.async = true;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();

/* Aurore — ouverture sans « flash » (application Android et site installé).
   Problème : à l'ouverture, la page de départ (écran d'accueil par défaut, mise en forme
   encore incomplète) était visible quelques millisecondes avant que le site n'affiche la
   page voulue pour l'utilisateur.
   Solution : pour un utilisateur déjà connu (session ou mode visiteur), dans l'application
   ou le site installé uniquement, le contenu reste invisible (fond du thème) jusqu'à ce que
   le site ait fini de se préparer, puis apparaît en fondu très court (0,18 s).
   Sécurité : l'affichage est de toute façon rétabli après 1,2 s au maximum, et dès que
   l'application revient au premier plan. Rien n'est bloqué, seule l'opacité change.
   Désactivation de secours : ?boot=off */
(function () {
  try {
    if (/[?&]boot=off\b/.test(location.search || '')) return;
    var de = document.documentElement;
    var natif = false;
    try { natif = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) {}
    var installe = false;
    try { installe = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; } catch (e) {}
    if (!natif && !installe) return;

    var deconnecte = localStorage.getItem('aurore_explicit_logout') === '1';
    var connu = !!localStorage.getItem('lsnb_session') || localStorage.getItem('aurore_visitor_mode') === '1';
    if (!connu || deconnecte) return;
    if (/[?&](?:sectionShare|code|token_hash|error)=/.test(location.search || '') || /access_token=/.test(location.hash || '')) return;

    var st = document.createElement('style');
    st.id = 'aurore-boot-style';
    st.textContent =
      'html.aurore-boot body{opacity:0!important}' +
      'html.aurore-boot.aurore-boot-fin body{opacity:1!important;transition:opacity .18s ease}';
    (document.head || de).appendChild(st);
    de.classList.add('aurore-boot');

    var revele = false;
    function reveler() {
      if (revele) return;
      revele = true;
      de.classList.add('aurore-boot-fin');
      setTimeout(function () {
        de.classList.remove('aurore-boot', 'aurore-boot-fin');
        try { st.remove(); } catch (e) {}
      }, 400);
    }
    function apresPreparation() {
      // Laisse le site choisir la bonne page, puis affiche (deux images pour être sûr du rendu).
      setTimeout(function () {
        requestAnimationFrame(function () { requestAnimationFrame(reveler); });
      }, 60);
    }

    setTimeout(reveler, 1200);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') reveler();
    });
    if (document.readyState === 'complete') apresPreparation();
    else document.addEventListener('DOMContentLoaded', apresPreparation, { once: true });
  } catch (e) {
    try { document.documentElement.classList.remove('aurore-boot'); } catch (_) {}
  }
})();
