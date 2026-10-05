/* AURORE — Barre latérale gauche (style « menu vitré ») — v2
   Aucune logique métier ici : chaque entrée délègue au contrôle existant du site
   (.click()), donc droits, historique et gardes de navigation restent inchangés.
   Retirer ce fichier ne casse rien : le site retrouve son état d'avant.
   Contenu : menu, parcours en arborescence (miroir du fil d'Ariane), mes cases,
   apparence (thème + 25 couleurs), éléments flottants (activables). */
(function () {
  'use strict';
  if (window.__auroreSidebarReady) return;
  window.__auroreSidebarReady = true;

  var KEY = 'aurore_sidebar_collapsed_v1';
  var PKEY = 'aurore_sidebar_prefs_v1';
  var DEFAULT_PREFS = { fhome: false, fai: true, zoom: true };

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
    collapse: '<path d="m15 6-6 6 6 6"/>',
    tree: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10"/><path d="M6 12h10"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.5-1-2.6 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    cases: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><path d="M16.5 14v6M13.5 17h6"/>',
    moon: '<path d="M20 14.2A8 8 0 1 1 9.8 4a6.3 6.3 0 0 0 10.2 10.2z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  function svg(name, size) {
    var s = size || 20;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

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
  var TOGGLES = [
    { k: 'fhome', label: 'Accueil flottant', sub: 'Bouton Accueil déplaçable' },
    { k: 'fai', label: 'Aurora flottant', sub: 'Bouton Aurora en bas à droite' },
    { k: 'zoom', label: 'Zoom de page', sub: 'Bouton de zoom en bas de page' }
  ];
  var THEMES = [
    { v: 'sombre', label: 'Sombre', icon: 'moon' },
    { v: 'clair', label: 'Clair', icon: 'sun' },
    { v: 'systeme', label: 'Auto', icon: 'monitor' }
  ];

  var nav, scrim, toggle;

  /* Cherche d'abord dans la page, puis dans la barre (utile avant son insertion dans le DOM). */
  function $(id) {
    var e = document.getElementById(id);
    if (e) return e;
    return nav ? nav.querySelector('#' + id) : null;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- actions déléguées ---------- */
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
    return !!chip && getComputedStyle(chip).display !== 'none';
  }
  function isAdmin() {
    try { return !!(typeof session !== 'undefined' && session && session.role === 'admin'); } catch (_) { return false; }
  }

  /* ---------- préférences des éléments flottants ---------- */
  function readPrefs() {
    var p = { fhome: DEFAULT_PREFS.fhome, fai: DEFAULT_PREFS.fai, zoom: DEFAULT_PREFS.zoom };
    try {
      var s = JSON.parse(localStorage.getItem(PKEY) || '{}');
      Object.keys(p).forEach(function (k) { if (typeof s[k] === 'boolean') p[k] = s[k]; });
    } catch (_) {}
    return p;
  }
  function applyPrefs(p) {
    var c = document.documentElement.classList;
    c.toggle('asb-pref-fhome', !!p.fhome);
    c.toggle('asb-pref-nofai', !p.fai);
    c.toggle('asb-pref-nozoom', !p.zoom);
  }
  function savePrefs(p) { try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (_) {} }

  /* ---------- construction ---------- */
  function buildItem(it) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'asb-item';
    b.dataset.asb = it.id;
    b.title = it.label;
    b.setAttribute('aria-label', it.label);
    b.innerHTML = '<span class="asb-ico">' + svg(it.icon) + '</span><span class="asb-label">' + it.label + '</span><span class="asb-arrow">' + svg('chevron', 16) + '</span>';
    b.addEventListener('click', function () {
      if (it.run) it.run();
      else if (it.target) { var t = $(it.target); if (t) t.click(); }
      markActive(it.id);
      closeOnMobile();
    });
    return b;
  }

  function acc(id, title, icon, open) {
    return '<details class="asb-acc" id="' + id + '"' + (open ? ' open' : '') + '><summary><span class="asb-ico">' + svg(icon) + '</span><span class="asb-label">' + title + '</span><span class="asb-caret">' + svg('chevron', 16) + '</span></summary><div class="asb-acc-body" id="' + id + 'Body"></div></details>';
  }

  function build() {
    nav = document.createElement('nav');
    nav.id = 'auroreSidebar';
    nav.className = 'asb';
    nav.setAttribute('aria-label', 'Menu principal');

    nav.innerHTML =
      '<div class="asb-dots" aria-hidden="true"><i></i><i></i><i></i></div>' +
      '<div class="asb-head"><div class="asb-brand">Aurore</div><button type="button" class="asb-collapse" aria-label="Réduire le menu" title="Réduire / agrandir">' + svg('collapse', 16) + '</button></div>' +
      '<div class="asb-sep"></div>' +
      '<div class="asb-scroll">' +
        '<div class="asb-section">Menu</div><div class="asb-group" data-group="main"></div>' +
        acc('asbTree', 'Parcours', 'tree', true) +
        acc('asbSections', 'Mes cases', 'cases', false) +
        acc('asbLook', 'Apparence', 'palette', false) +
        acc('asbFloat', 'Éléments flottants', 'layers', false) +
        '<div class="asb-sep"></div><div class="asb-group" data-group="more"></div>' +
      '</div>' +
      '<div class="asb-sep"></div>' +
      '<div class="asb-user" id="asbUser" hidden><span class="asb-avatar" id="asbAvatar"></span><span class="asb-user-text"><strong id="asbName"></strong><small>Compte Aurore</small></span></div>';

    scrim = document.createElement('div');
    scrim.className = 'asb-scrim';
    scrim.addEventListener('click', function () { setOpen(false); });

    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'asb-toggle';
    toggle.setAttribute('aria-label', 'Ouvrir le menu');
    toggle.innerHTML = svg('chevron', 16);
    toggle.addEventListener('click', function () { setOpen(!nav.classList.contains('is-open')); });

    /* On insère d'abord la barre, la poignée et le fond : même si un détail du
       contenu échouait ensuite, la poignée d'ouverture existe toujours. */
    document.body.appendChild(scrim);
    document.body.appendChild(nav);
    document.body.appendChild(toggle);

    var gMain = nav.querySelector('[data-group="main"]');
    var gMore = nav.querySelector('[data-group="more"]');
    MENU.forEach(function (it) { gMain.appendChild(buildItem(it)); });
    MORE.forEach(function (it) { gMore.appendChild(buildItem(it)); });

    try { buildLook(); } catch (e) { if (window.console) console.warn('[sidebar] apparence', e); }
    try { buildFloat(); } catch (e) { if (window.console) console.warn('[sidebar] flottants', e); }

    nav.querySelector('.asb-collapse').addEventListener('click', function () {
      if (window.matchMedia('(max-width:900px)').matches) { setOpen(false); return; }
      setCollapsed(!document.documentElement.classList.contains('asb-collapsed'));
    });
    nav.querySelector('#asbUser').addEventListener('click', function () {
      var p = $('btnOuvrirProfil'); if (p) p.click();
    });
  }

  /* ----- Apparence : thème + couleurs ----- */
  function buildLook() {
    var body = $('asbLookBody');
    var row = document.createElement('div');
    row.className = 'asb-theme-row';
    THEMES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'asb-theme-btn';
      b.dataset.themeChoice = t.v;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = svg(t.icon, 16) + '<span>' + t.label + '</span>';
      b.addEventListener('click', function () {
        var src = document.querySelector('.theme-switch-btn[data-theme-choice="' + t.v + '"]');
        if (src) src.click();
        setTimeout(syncLook, 80);
      });
      row.appendChild(b);
    });
    body.appendChild(row);

    var head = document.createElement('div');
    head.className = 'asb-sw-head';
    head.innerHTML = '<span>Couleur du site</span><strong id="asbColorName"></strong>';
    body.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'asb-sw-grid';
    grid.id = 'asbSwGrid';
    body.appendChild(grid);
    buildSwatches();
  }

  function buildSwatches() {
    var grid = $('asbSwGrid');
    if (!grid || grid.childElementCount) return;
    var src = document.querySelectorAll('#colorThemeFlyoutScroll .theme-color-swatch[data-color-choice]');
    if (!src.length) return;
    Array.prototype.forEach.call(src, function (sw) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'asb-sw';
      b.dataset.colorChoice = sw.dataset.colorChoice;
      b.title = sw.getAttribute('title') || sw.dataset.colorChoice;
      b.setAttribute('aria-label', 'Couleur ' + b.title);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        sw.click();
        setTimeout(syncLook, 80);
      });
      grid.appendChild(b);
    });
    paintSwatches();
  }
  function paintSwatches() {
    var grid = $('asbSwGrid');
    if (!grid) return;
    Array.prototype.forEach.call(grid.children, function (b) {
      if (b.dataset.painted) return;
      var sw = document.querySelector('#colorThemeFlyoutScroll .theme-color-swatch[data-color-choice="' + b.dataset.colorChoice + '"]');
      if (!sw) return;
      var cs = getComputedStyle(sw);
      var bg = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)') { b.style.background = bg; b.dataset.painted = '1'; }
    });
  }
  function syncLook() {
    if (!nav) return;
    buildSwatches();
    paintSwatches();
    nav.querySelectorAll('.asb-theme-btn').forEach(function (b) {
      var src = document.querySelector('.theme-switch-btn[data-theme-choice="' + b.dataset.themeChoice + '"]');
      b.setAttribute('aria-pressed', src && src.getAttribute('aria-pressed') === 'true' ? 'true' : 'false');
    });
    nav.querySelectorAll('.asb-sw').forEach(function (b) {
      var src = document.querySelector('#colorThemeFlyoutScroll .theme-color-swatch[data-color-choice="' + b.dataset.colorChoice + '"]');
      b.setAttribute('aria-pressed', src && src.getAttribute('aria-pressed') === 'true' ? 'true' : 'false');
    });
    var cur = $('colorThemeFlyoutCurrent');
    var nm = $('asbColorName');
    if (nm) nm.textContent = cur ? cur.textContent.trim() : '';
  }

  /* ----- Éléments flottants : interrupteurs ----- */
  function buildFloat() {
    var body = $('asbFloatBody');
    var p = readPrefs();
    TOGGLES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'asb-switch';
      b.dataset.pref = t.k;
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', p[t.k] ? 'true' : 'false');
      b.innerHTML = '<span class="asb-switch-text"><strong>' + t.label + '</strong><small>' + t.sub + '</small></span><span class="asb-knob" aria-hidden="true"></span>';
      b.addEventListener('click', function () {
        var cur = readPrefs();
        cur[t.k] = !cur[t.k];
        savePrefs(cur);
        applyPrefs(cur);
        b.setAttribute('aria-checked', cur[t.k] ? 'true' : 'false');
      });
      body.appendChild(b);
    });
  }

  /* ----- Parcours en arborescence (miroir du fil d'Ariane) ----- */
  function renderTree() {
    var body = $('asbTreeBody');
    if (!body) return;
    var bc = $('breadcrumb');
    var nodes = [];
    if (bc) {
      Array.prototype.forEach.call(bc.children, function (el) {
        if (el.classList.contains('sep')) return;
        var t = (el.textContent || '').replace(/[›»\/>]/g, '').replace(/\s+/g, ' ').trim();
        if (!t) return;
        var clickable = el.tagName === 'BUTTON' || el.tagName === 'A';
        nodes.push({ label: t, el: clickable ? el : null, cur: !clickable });
      });
    }
    if (!nodes.length || nodes[0].label.toLowerCase().indexOf('accueil') !== 0) {
      nodes.unshift({ label: 'Accueil', run: goHome, cur: !nodes.length });
    }
    if (!nodes.some(function (n) { return n.cur; })) nodes[nodes.length - 1].cur = true;

    var curIdx = 0;
    nodes.forEach(function (n, i) { if (n.cur) curIdx = i; });

    function nodeHtml(i) {
      if (i >= nodes.length) return '';
      var n = nodes[i];
      var cls = i === curIdx ? 'is-current' : (i < curIdx ? 'is-past' : 'is-next');
      var inner = '<button type="button" class="asb-node-btn" data-i="' + i + '"' + (i === curIdx ? ' aria-current="page"' : '') + '><span class="asb-node-dot"></span><span class="asb-node-label">' + esc(n.label) + '</span></button>';
      var child = nodeHtml(i + 1);
      return '<li class="asb-node ' + cls + '">' + inner + (child ? '<ol>' + child + '</ol>' : '') + '</li>';
    }
    var sig = nodes.map(function (n) { return n.label; }).join('|') + '#' + curIdx;
    if (body.dataset.sig === sig) return;
    body.dataset.sig = sig;
    body.innerHTML =
      '<div class="asb-tree-meta">Étape <b>' + (curIdx + 1) + '</b> sur <b>' + nodes.length + '</b></div>' +
      '<div class="asb-tree-bar"><i style="width:' + Math.round(((curIdx + 1) / nodes.length) * 100) + '%"></i></div>' +
      '<ol class="asb-tree">' + nodeHtml(0) + '</ol>';
    body.querySelectorAll('.asb-node-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var live = [];
        var bc2 = $('breadcrumb');
        if (bc2) {
          Array.prototype.forEach.call(bc2.children, function (el) {
            if (el.classList.contains('sep')) return;
            if (!(el.textContent || '').replace(/[›»\/>]/g, '').trim()) return;
            live.push(el);
          });
        }
        var i = parseInt(b.dataset.i, 10);
        var n = nodes[i];
        if (!n || n.cur) return;
        if (n.run) n.run();
        else if (n.el && n.el.isConnected) n.el.click();
        else if (live[i] && live[i].tagName === 'BUTTON') live[i].click();
        closeOnMobile();
      });
    });
  }

  /* ----- Mes cases (sections créées par l'utilisateur) ----- */
  function renderSections() {
    var body = $('asbSectionsBody');
    if (!body) return;
    var grid = $('personalFolderGrid');
    var items = grid ? grid.querySelectorAll('.personal-folder') : [];
    var html = '';
    Array.prototype.forEach.call(items, function (it, i) {
      var nameEl = it.querySelector('strong,[class*="name"],[class*="title"]') || it;
      var name = (nameEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34) || 'Case ' + (i + 1);
      html += '<button type="button" class="asb-sub" data-i="' + i + '"><span class="asb-sub-dot"></span><span class="asb-label">' + esc(name) + '</span></button>';
    });
    if (!html) html = '<p class="asb-empty">Aucune case pour le moment.</p>';
    if ($('personalFolderCreate')) {
      html += '<button type="button" class="asb-sub asb-sub-create" data-create="1"><span class="asb-ico">' + svg('plus', 16) + '</span><span class="asb-label">Créer une case</span></button>';
    }
    if (body.dataset.sig === html) return;
    body.dataset.sig = html;
    body.innerHTML = html;
    body.querySelectorAll('.asb-sub').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.create) { var c = $('personalFolderCreate'); if (c) c.click(); }
        else {
          var live = grid ? grid.querySelectorAll('.personal-folder') : [];
          var t = live[parseInt(b.dataset.i, 10)];
          if (t) t.click();
        }
        closeOnMobile();
      });
    });
  }

  /* ---------- état ---------- */
  function closeOnMobile() {
    if (window.matchMedia('(max-width:900px)').matches) setOpen(false);
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
    var all = MENU.concat(MORE);
    nav.querySelectorAll('.asb-item').forEach(function (b) {
      var it = all.filter(function (x) { return x.id === b.dataset.asb; })[0];
      var show = true;
      if (it.auth && !on) show = false;
      if (it.admin && !adm) show = false;
      if (it.target && !$(it.target)) show = false;
      b.hidden = !show;
    });
    $('asbSections').hidden = !on;

    var u = $('asbUser');
    if (on) {
      var name = ($('userNom') && $('userNom').textContent || '').trim();
      var av = $('userAvatar');
      u.hidden = false;
      $('asbName').textContent = name || 'Mon compte';
      var holder = $('asbAvatar');
      if (av && av.getAttribute('src')) {
        if (!holder.firstChild || holder.firstChild.tagName !== 'IMG' || holder.firstChild.getAttribute('src') !== av.getAttribute('src')) {
          holder.innerHTML = '';
          var im = document.createElement('img');
          im.alt = ''; im.src = av.getAttribute('src');
          holder.appendChild(im);
        }
      } else {
        holder.textContent = (name || 'A').charAt(0).toUpperCase();
      }
    } else {
      u.hidden = true;
    }
    syncActive();
    syncLook();
    renderSections();
  }

  function observe(el, opts, fn) {
    if (el && window.MutationObserver) new MutationObserver(fn).observe(el, opts);
  }

  function init() {
    if (!document.body) return;
    applyPrefs(readPrefs());
    build();
    try { if (localStorage.getItem(KEY) === '1') setCollapsed(true); } catch (_) {}
    document.documentElement.classList.add('has-asb');
    try { renderTree(); } catch (e) {}
    try { refresh(); } catch (e) {}

    ['aurore:user-connected', 'aurore:user-disconnected'].forEach(function (e) {
      window.addEventListener(e, function () { setTimeout(function () { try { refresh(); } catch (_) {} }, 60); });
    });
    observe($('userChip'), { attributes: true, attributeFilter: ['style', 'class'] }, function () { try { refresh(); } catch (_) {} });
    observe($('breadcrumb'), { childList: true, subtree: true, characterData: true }, function () { try { renderTree(); } catch (_) {} });
    observe($('personalFolderGrid'), { childList: true, subtree: true }, function () { try { renderSections(); } catch (_) {} });
    observe($('colorThemeFlyoutScroll'), { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] }, syncLook);
    observe($('themeSwitch'), { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] }, syncLook);

    var n = 0;
    (function poll() { try { refresh(); renderTree(); } catch (_) {} if (n++ < 30) setTimeout(poll, 500); })();
    document.addEventListener('click', function () { setTimeout(syncActive, 150); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
