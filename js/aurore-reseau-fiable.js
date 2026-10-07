/* Aurore — détection RÉELLE du réseau (site + application Android)
   Problème : la notification « Connexion interrompue / rétablie » et la mise à jour
   des pages au retour du réseau ne dépendaient que de navigator.onLine. Dans la
   WebView de l'application (Capacitor), cette valeur reste souvent « true » alors que
   l'appareil n'a plus d'accès réel à Internet (Wi-Fi sans accès, données épuisées,
   zone faible) : aucune notification, et au retour du réseau rien ne se déclenchait
   assez vite.
   Solution : une petite sonde (requête HEAD très légère, jamais interceptée par le
   service worker) vérifie la vraie connexion. navigator.onLine devient fiable pour
   TOUT le code du site, et les événements « offline » / « online » sont émis au bon
   moment : la notification existante de index.html apparaît donc aussi dans
   l'application, et la mise à jour discrète des pages démarre sans attendre.
   - 2 échecs consécutifs avant de déclarer « hors ligne » (évite les faux positifs) ;
   - 1 seul succès suffit pour déclarer « en ligne » ;
   - sonde immédiate au retour dans l'application, au retour du réseau, au focus ;
   - aucune sonde quand l'application est en arrière-plan.
   Désactivation de secours : ajouter ?reseau=natif à l'adresse (retour au comportement d'origine). */
(function () {
  'use strict';
  if (window.__auroreReseauFiable) return;
  try { if (/[?&]reseau=natif\b/.test(location.search || '')) return; } catch (e) {}
  window.__auroreReseauFiable = true;

  var SUPA = 'https://tdeotqfsbvouresfhkab.supabase.co';
  var DELAI_SONDE = 5000;       // une sonde sans réponse après 5 s compte comme un échec
  var PAUSE_EN_LIGNE = 15000;   // entre deux sondes quand tout va bien
  var PAUSE_HORS_LIGNE = 3000;  // entre deux sondes quand le réseau est coupé
  var ECHECS_AVANT_HORS_LIGNE = 2;

  var ORIG = window.fetch ? window.fetch.bind(window) : null;
  if (!ORIG) return;

  var natif = null;
  try { natif = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine'); } catch (e) {}
  function lireNatif() {
    try { return natif && natif.get ? natif.get.call(navigator) !== false : true; } catch (e) { return true; }
  }

  var reel = true;      // verdict de la sonde
  var echecs = 0;
  var enCours = false;
  var minuterie = null;

  // navigator.onLine devient fiable pour tout le site (bannière, mises à jour, caches…).
  try {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: function () { return lireNatif() === false ? false : reel; }
    });
  } catch (e) {}

  function diffuser(type) {
    try { window.dispatchEvent(new Event(type)); } catch (e) {}
  }

  function essayer(url, options) {
    return new Promise(function (resolve) {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var fini = false;
      var t = setTimeout(function () {
        if (fini) return;
        fini = true;
        try { if (ctrl) ctrl.abort(); } catch (e) {}
        resolve(false);
      }, DELAI_SONDE);
      if (ctrl) options.signal = ctrl.signal;
      ORIG(url, options).then(function () {
        if (fini) return;
        fini = true; clearTimeout(t); resolve(true);   // toute réponse HTTP prouve que le réseau passe
      }, function () {
        if (fini) return;
        fini = true; clearTimeout(t); resolve(false);
      });
    });
  }

  // En ligne dès qu'UNE des deux cibles répond (le site, ou Supabase).
  function sonder() {
    return new Promise(function (resolve) {
      var restant = 2, termine = false;
      function fin(ok) {
        if (termine) return;
        if (ok) { termine = true; resolve(true); return; }
        restant--;
        if (restant === 0) { termine = true; resolve(false); }
      }
      var stamp = Date.now();
      essayer(location.origin + '/?_sonde=' + stamp, { method: 'HEAD', cache: 'no-store' }).then(fin);
      essayer(SUPA + '/auth/v1/health?_=' + stamp, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }).then(fin);
    });
  }

  function apresRetour() {
    // Récupère tout de suite la dernière version du service worker et des fichiers.
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(function (r) {
          if (r && r.update) r.update().catch(function () {});
        }).catch(function () {});
      }
    } catch (e) {}
  }

  function appliquer(ok) {
    if (ok) {
      echecs = 0;
      if (!reel) {
        reel = true;
        apresRetour();
        diffuser('online');      // déclenche « Connexion rétablie » + mise à jour discrète des pages
      }
      return;
    }
    echecs++;
    if (reel && echecs >= ECHECS_AVANT_HORS_LIGNE) {
      reel = false;
      diffuser('offline');       // déclenche « Connexion interrompue »
    }
  }

  function planifier(delai) {
    clearTimeout(minuterie);
    minuterie = setTimeout(cycle, delai);
  }

  function cycle() {
    if (document.visibilityState === 'hidden') { planifier(reel ? PAUSE_EN_LIGNE : PAUSE_HORS_LIGNE); return; }
    verifier();
  }

  function verifier() {
    if (enCours) return;
    if (!lireNatif()) {
      // Le système dit lui-même « pas de réseau » : inutile de sonder.
      enCours = false;
      planifier(PAUSE_HORS_LIGNE);
      return;
    }
    enCours = true;
    sonder().then(function (ok) {
      enCours = false;
      appliquer(ok);
      if (!ok && reel) { planifier(1500); return; }          // premier échec : on revérifie vite
      planifier(reel ? PAUSE_EN_LIGNE : PAUSE_HORS_LIGNE);
    });
  }

  function surReprise() {
    clearTimeout(minuterie);
    verifier();
  }

  window.addEventListener('online', function () { setTimeout(surReprise, 150); });
  window.addEventListener('offline', function () { clearTimeout(minuterie); planifier(PAUSE_HORS_LIGNE); });
  window.addEventListener('focus', surReprise);
  window.addEventListener('pageshow', surReprise);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') surReprise();
  });

  // Diagnostic : window.auroreReseau() dans la console.
  window.auroreReseau = function () {
    var r = { natif: lireNatif(), sonde: reel, echecs: echecs, onLine: navigator.onLine };
    try { console.log('[Aurore] Réseau', r); } catch (e) {}
    return r;
  };

  planifier(800);
})();
