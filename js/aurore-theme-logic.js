// ---------- THÈME (clair / sombre / système) ----------
  // Choix persisté dans localStorage. L'attribut data-theme sur <html> pilote
  // le CSS (voir le bloc de style dédié au thème, plus haut dans le head). Une version très
  // courte de cette logique tourne déjà en tête de <head> pour éviter un flash
  // du mauvais thème au chargement ; ce bloc-ci prend le relais pour la partie
  // interactive (boutons, changement à la volée, suivi du système en direct).
  const THEME_CLE = 'auraster-theme';
  const prefereClairMedia = window.matchMedia('(prefers-color-scheme: light)');

  function resoudreThemeAffiche(choix) {
    if (choix === 'systeme') return prefereClairMedia.matches ? 'clair' : 'sombre';
    return choix;
  }

  function appliquerChoixTheme(choix) {
    const affiche = resoudreThemeAffiche(choix);
    // Même correspondance que le script d'amorçage en tête de <head> : le CSS
    // du thème clair cible [data-theme="light"], jamais "clair"/"sombre".
    document.documentElement.setAttribute('data-theme', affiche === 'clair' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme-choix', choix);
    try { localStorage.setItem(THEME_CLE, choix); } catch (e) {}
    document.querySelectorAll('.theme-switch-btn').forEach(btn => {
      btn.setAttribute('aria-pressed', btn.dataset.themeChoice === choix ? 'true' : 'false');
    });
  }

  document.querySelectorAll('.theme-switch-btn').forEach(btn => {
    const host = btn.querySelector('.theme-icon-host');
    host.innerHTML = ICONS[host.dataset.icon];
    btn.addEventListener('click', () => appliquerChoixTheme(btn.dataset.themeChoice));
  });

  appliquerChoixTheme(localStorage.getItem(THEME_CLE) || 'systeme');

  // Si l'utilisateur a choisi "Système" et change la préférence de son appareil
  // pendant qu'il a le site ouvert, le thème suit immédiatement, sans rechargement.
  prefereClairMedia.addEventListener('change', () => {
    if ((localStorage.getItem(THEME_CLE) || 'systeme') === 'systeme') appliquerChoixTheme('systeme');
  });

  // Filet de sécurité : toute erreur JS imprévue s'affiche dans le journal de dépôt si ouvert
  window.addEventListener('error', function(e){
    const debugBox = document.getElementById('depotDebug');
    const debugLog = document.getElementById('depotDebugLog');
    if (debugBox && debugBox.style.display === 'block' && debugLog) {
      const line = document.createElement('div');
      line.style.color = '#ff6b6b';
      line.textContent = '• Erreur JavaScript imprévue : ' + e.message + ' (' + (e.filename || '') + ':' + (e.lineno || '') + ')';
      debugLog.appendChild(line);
    }

  });

  