/* AURORE — Barre latérale gauche (style « menu vitré »)
   Aucune logique métier ici : chaque entrée délègue au bouton existant du site
   (.click()), donc droits, historique et gardes de navigation restent inchangés.
   Retirer ce fichier ne casse rien : le site retrouve son état d'avant. */
(function () {
  'use strict';
  if (window.__auroreSidebarReady) return;
  window.__auroreSidebarReady = true;

  var KEY = 'aurore_sidebar_collapsed_v1';

  var ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    upload: '<path d="M12 16V5"/><path d="m7.5 9.5 4.5-4.5 4.5 4.5"/><path d="M5 19h14"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.4-2.9 7.6-7 9.5-4.1-1.9-7-5.1-7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
    logout: '<path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    collapse: '<path d="m15 6-6 6 6 6"/>'
  };
  function svg(name) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  /* Chaque entrée : id de la cible existante à cliquer. */
  var MENU = [
    { id: 'home', label: 'Accueil', icon: 'home', run: goHome },
    { id: 'search', label: 'Rechercher', icon: 'search', run: focusSearch },
    { id: 'recents', label: 'Documents récents', icon: 'recent', target: 'homeRecentsCta' },
    { id: 'livres', label: 'Livres', icon: 'book', target: 'btnLivres' },
    { id: 'personal', label: 'Mon espace', icon: 'folder', target: 'auroraPersonalEndBtn', auth: true },
    { id: 'aurora', label: 'Aurora', icon: 'spark', target: 'auroreIAHeaderBtn' }
  ];
  var MORE = [
    { id: 'deposit', label: 'Déposer un document', icon: 'upload', target: 'btnDeposer', auth: true },
    { id: 'profile', label: 'Mon profil', icon: 'user', target: 'btnOuvrirProfil', auth: true },
    { id: 'admin', label: 'Espace admin', icon: 'shield', target: 'btnAdmin', admin: true },
    { id: 'logout', label: 'Déconnexion', icon: 'logout', target: 'btnDeconnexion', auth: true }
  ];

  function $(id) { return document.getElementById(id); }

  function goHome() {
    var f = $('auroreFloatingHome');
    if (f) { f.click(); return; }
    if (typeof afficherEcran === 'function') afficherEcran('screen-home');
  }
  function focusSearch() {
    var inp = $('headerSearchInput') || $('homeSearchInput');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (inp) setTimeout(function () { try { inp.focus(); } catch (_) {} }, 120);
  }

  function isConnected() {
    var chip = $('userChip');
    if (chip) return getComputedStyle(chip).display !== 'none';
    return false;
  }
  function isAdmin() {
    try { return !!(typeof session !== 'undefined' && session && session.role === 'admin'); } catch (_) { return false; }
  }

  function buildItem(it) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'asb-item';
    b.dataset.asb = it.id;
    b.title = it.label;
    b.setAttribute('aria-label', it.label);
    b.innerHTML = '<span class="asb-ico">' + svg(it.icon) + '</span><span class="asb-label">' + it.label + '</span><span class="asb-arrow">' + svg('chevron') + '</span>';
    b.addEventListener('click', function () {
      if (it.run) it.run();
      else if (it.target) { var t = $(it.target); if (t) t.click(); }
      markActive(it.id);
      if (window.matchMedia('(max-width:900px)').matches) setOpen(false);
    });
    return b;
  }

  var nav, scrim, toggle;

  function build() {
    nav = document.createElement('nav');
    nav.id = 'auroreSidebar';
    nav.className = 'asb';
    nav.setAttribute('aria-label', 'Menu principal');

    var dots = '<div class="asb-dots" aria-hidden="true"><i></i><i></i><i></i></div>';
    var head = '<div class="asb-head"><div class="asb-brand">Aurore</div><button type="button" class="asb-collapse" aria-label="Réduire le menu" title="Réduire / agrandir">' + svg('collapse') + '</button></div>';
    nav.innerHTML = dots + head + '<div class="asb-sep"></div><div class="asb-section">Menu</div><div class="asb-group" data-group="main"></div><div class="asb-sep asb-sep-mid"></div><div class="asb-group" data-group="more"></div><div class="asb-sep"></div><div class="asb-user" id="asbUser" hidden><span class="asb-avatar" id="asbAvatar"></span><span class="asb-user-text"><strong id="asbName"></strong><small>Compte Aurore</small></span></div>';

    var gMain = nav.querySelector('[data-group="main"]');
    var gMore = nav.querySelector('[data-group="more"]');
    MENU.forEach(function (it) { gMain.appendChild(buildItem(it)); });
    MORE.forEach(function (it) { gMore.appendChild(buildItem(it)); });

    scrim = document.createElement('div');
    scrim.className = 'asb-scrim';
    scrim.addEventListener('click', function () { setOpen(false); });

    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'asb-toggle';
    toggle.setAttribute('aria-label', 'Ouvrir le menu');
    toggle.innerHTML = svg('chevron');
    toggle.addEventListener('click', function () { setOpen(!nav.classList.contains('is-open')); });

    document.body.appendChild(scrim);
    document.body.appendChild(nav);
    document.body.appendChild(toggle);

    nav.querySelector('.asb-collapse').addEventListener('click', function () {
      if (window.matchMedia('(max-width:900px)').matches) { setOpen(false); return; }
      setCollapsed(!document.documentElement.classList.contains('asb-collapsed'));
    });
    nav.querySelector('#asbUser').addEventListener('click', function () {
      var p = $('btnOuvrirProfil'); if (p) p.click();
    });
  }

  function setOpen(v) {
    nav.classList.toggle('is-open', v);
    scrim.classList.toggle('is-on', v);
    toggle.setAttribute('aria-expanded', v ? 'true' : 'false');
  }
  function setCollapsed(v) {
    document.documentElement.classList.toggle('asb-collapsed', v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (_) {}
  }

  function markActive(id) {
    nav.querySelectorAll('.asb-item').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.asb === id);
    });
  }
  function syncActive() {
    var home = $('screen-home');
    if (home && home.classList.contains('active')) markActive('home');
  }

  function refresh() {
    var on = isConnected();
    var adm = isAdmin();
    nav.querySelectorAll('.asb-item').forEach(function (b) {
      var all = MENU.concat(MORE);
      var it = all.filter(function (x) { return x.id === b.dataset.asb; })[0];
      var show = true;
      if (it.auth && !on) show = false;
      if (it.admin && !adm) show = false;
      if (it.target && !$(it.target)) show = false;
      b.hidden = !show;
    });
    var u = $('asbUser');
    if (on) {
      var name = ($('userNom') && $('userNom').textContent || '').trim();
      var av = $('userAvatar');
      u.hidden = false;
      $('asbName').textContent = name || 'Mon compte';
      var holder = $('asbAvatar');
      if (av && av.getAttribute('src')) {
        holder.innerHTML = '';
        var im = document.createElement('img');
        im.alt = ''; im.src = av.getAttribute('src');
        holder.appendChild(im);
      } else {
        holder.textContent = (name || 'A').charAt(0).toUpperCase();
      }
    } else {
      u.hidden = true;
    }
    syncActive();
  }

  function init() {
    if (!document.body) return;
    build();
    try { if (localStorage.getItem(KEY) === '1') setCollapsed(true); } catch (_) {}
    document.documentElement.classList.add('has-asb');
    refresh();
    ['aurore:user-connected', 'aurore:user-disconnected'].forEach(function (e) {
      window.addEventListener(e, function () { setTimeout(refresh, 60); });
    });
    var chip = $('userChip');
    if (chip && window.MutationObserver) {
      new MutationObserver(function () { refresh(); }).observe(chip, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    var n = 0;
    (function poll() { refresh(); if (n++ < 30) setTimeout(poll, 500); })();
    document.addEventListener('click', function () { setTimeout(syncActive, 150); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
