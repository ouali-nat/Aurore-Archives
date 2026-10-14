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

/* Aurore — chargement non bloquant du module « navigation fluide ».
   Le cœur du site doit rester visible même si ce module de confort est lent.
   Le module conserve sa propre option de secours ?fluid=off. */
(function () {
  'use strict';
  try {
    if (document.getElementById('aurore-fluid-navigation-script')) return;

    if (!document.getElementById('aurore-fluid-navigation-style')) {
      var link = document.createElement('link');
      link.id = 'aurore-fluid-navigation-style';
      link.rel = 'stylesheet';
      link.href = '/css/aurore-fluid-navigation.css?v=20261010-startup-nonblocking1';
      document.head.appendChild(link);
    }

    var script = document.createElement('script');
    script.id = 'aurore-fluid-navigation-script';
    script.src = '/js/aurore-fluid-navigation.js?v=20261010-startup-nonblocking1';
    script.async = true;
    script.onerror = function () {
      console.warn('[Aurore navigation] Module de navigation fluide indisponible ; la navigation standard reste active.');
    };
    document.head.appendChild(script);
  } catch (e) {
    console.warn('[Aurore navigation] Chargement non bloquant impossible :', e);
  }
})();

/* Aurore — écran d'ouverture : boule à 4 trous qui tourne (style Pinterest).
   Remplace l'anneau du #auroreBootOverlay pendant le chargement des CSS. */
(function () {
  'use strict';
  try {
    function applyBall() {
      var ring = document.querySelector('.aurore-boot-ring');
      if (!ring || ring.__auroreBall) return;
      ring.__auroreBall = true;
      var s = document.createElement('style');
      s.id = 'aurore-boot-ball-css';
      s.textContent = [
        '.aurore-boot-ring{position:absolute;inset:0;border:0;border-radius:50%;',
        'background:radial-gradient(circle at 34% 30%,#f3e8ff 0%,#a78bfa 38%,#6d28d9 100%);',
        'box-shadow:0 0 26px rgba(139,92,246,.5),inset -6px -8px 14px rgba(40,10,90,.45);',
        'animation:aurore-boot-spin 1.4s linear infinite}',
        '.aurore-boot-ring::after{display:none}',
        '.aurore-boot-ring i{position:absolute;width:12px;height:12px;border-radius:50%;',
        'background:#0d0b1f;box-shadow:inset 0 2px 3px rgba(0,0,0,.7)}',
        '.aurore-boot-ring i:nth-child(1){top:4px;left:calc(50% - 6px)}',
        '.aurore-boot-ring i:nth-child(2){right:4px;top:calc(50% - 6px)}',
        '.aurore-boot-ring i:nth-child(3){bottom:4px;left:calc(50% - 6px)}',
        '.aurore-boot-ring i:nth-child(4){left:4px;top:calc(50% - 6px)}',
        '@media(prefers-reduced-motion:reduce){.aurore-boot-ring{animation:none!important}}'
      ].join('');
      document.head.appendChild(s);
      for (var i = 0; i < 4; i++) ring.appendChild(document.createElement('i'));
    }
    applyBall();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyBall, { once: true });
    }
  } catch (e) {
    console.warn('[Aurore boot] boule de chargement indisponible :', e);
  }
})();
