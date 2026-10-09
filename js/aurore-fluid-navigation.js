/* Aurore — Navigation fluide
   1) Cache « stale-while-revalidate » des lectures publiques Supabase : les pages
      déjà vues (et le bouton Retour) s'affichent instantanément.
   2) Animation de chargement (barre en haut + squelettes) si l'attente dure.
   3) Retour téléphone : restauration exacte de la position (page, listes internes,
      recherche et tri), même si le contenu arrive après.
   Désactivation de secours : ouvrir le site avec ?fluid=off (réactiver : ?fluid=on). */
(function () {
  'use strict';

  try {
    var q = location.search || '';
    if (/[?&]fluid=off\b/.test(q)) sessionStorage.setItem('aurore_fluid_off', '1');
    if (/[?&]fluid=on\b/.test(q)) sessionStorage.removeItem('aurore_fluid_off');
    if (sessionStorage.getItem('aurore_fluid_off') === '1') return;
  } catch (e) {}
  if (window.__auroreFluid || typeof window.fetch !== 'function') return;
  window.__auroreFluid = { version: '1.0' };

  var SUPA = 'https://tdeotqfsbvouresfhkab.supabase.co';
  var REST = SUPA + '/rest/v1/';
  var FRESH_MS = 30 * 1000;          // < 30 s : aucune requête
  var STALE_MS = 5 * 60 * 1000;      // < 5 min : affichage immédiat + mise à jour en fond
  var MAX_ENTRY = 600 * 1024;
  var MAX_TOTAL = 2200 * 1024;
  var STORE_KEY = 'aurore_fluid_cache_v1';
  var ORIG = window.fetch.bind(window);
  var mem = new Map();
  var inflight = new Map();
  var revalidating = new Set();

  function byId(id) { return document.getElementById(id); }
  function noop() {}

  /* ---------- Persistance (sessionStorage, au mieux) ---------- */
  try {
    var raw = sessionStorage.getItem(STORE_KEY);
    if (raw) {
      var saved = JSON.parse(raw), now0 = Date.now();
      Object.keys(saved).forEach(function (k) {
        var e = saved[k];
        if (e && typeof e.body === 'string' && now0 - e.t < STALE_MS) mem.set(k, e);
      });
    }
  } catch (e) {}
  var persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      try {
        var out = {}, total = 0;
        Array.from(mem.entries()).sort(function (a, b) { return b[1].t - a[1].t; }).forEach(function (kv) {
          var size = kv[1].body.length + kv[0].length;
          if (total + size > MAX_TOTAL) return;
          total += size; out[kv[0]] = kv[1];
        });
        sessionStorage.setItem(STORE_KEY, JSON.stringify(out));
      } catch (err) { try { sessionStorage.removeItem(STORE_KEY); } catch (_) {} }
    }, 500);
  }
  function invalidate() {
    mem.clear();
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) {}
  }
  window.auroreInvaliderCache = invalidate;
  window.addEventListener('aurore:invalidate-cache', invalidate);

  /* ---------- Règles de mise en cache ---------- */
  var anonMemo = {};
  function tokenIsAnon(auth) {
    if (anonMemo[auth] !== undefined) return anonMemo[auth];
    var ok = false;
    try {
      var m = /^Bearer\s+(.+)$/i.exec(auth || '');
      if (m) {
        var p = m[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        var json = JSON.parse(atob(p));
        ok = !!json && json.role === 'anon';
      }
    } catch (e) {}
    anonMemo[auth] = ok;
    return ok;
  }
  function headerValue(h, name) {
    if (!h || typeof h !== 'object' || Array.isArray(h)) return undefined;
    if (typeof Headers !== 'undefined' && h instanceof Headers) return undefined;
    for (var k in h) { if (String(k).toLowerCase() === name) return h[k]; }
    return undefined;
  }
  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (typeof URL !== 'undefined' && input instanceof URL) return String(input);
    return '';
  }
  function methodOf(init) { return String((init && init.method) || 'GET').toUpperCase(); }
  function cacheKeyFor(input, init) {
    var url = urlOf(input);
    if (!url || url.indexOf(REST) !== 0 || url.indexOf('/rest/v1/rpc/') >= 0) return null;
    if (methodOf(init) !== 'GET' || !init) return null;
    if (init.cache === 'no-store' || init.cache === 'reload' || init.cache === 'no-cache') return null;
    var h = init.headers;
    if (!h || headerValue(h, 'prefer') || headerValue(h, 'range')) return null;
    if (!tokenIsAnon(headerValue(h, 'authorization'))) return null;
    return url;
  }

  /* ---------- Indicateur de chargement ---------- */
  var pending = 0, showTimer = null, shownAt = 0, bar = null;
  function ensureBar() {
    if (bar || !document.body) return bar;
    bar = document.createElement('div');
    bar.id = 'aurore-fluid-bar';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<i></i>';
    document.body.appendChild(bar);
    return bar;
  }
  function showBar() { var b = ensureBar(); if (!b) return; shownAt = Date.now(); b.classList.add('on'); }
  function hideBar() {
    if (!bar) return;
    setTimeout(function () { if (pending === 0 && bar) bar.classList.remove('on'); },
      Math.max(0, 320 - (Date.now() - shownAt)));
  }
  function track(promise) {
    pending++;
    if (pending === 1) {
      clearTimeout(showTimer);
      showTimer = setTimeout(function () { if (pending > 0) showBar(); }, 140);
    }
    var done = function () {
      pending = Math.max(0, pending - 1);
      if (pending === 0) { clearTimeout(showTimer); hideBar(); }
    };
    promise.then(done, done);
    return promise;
  }

  /* ---------- Cache SWR ---------- */
  function mk(e) {
    return new Response(e.body, { status: 200, headers: { 'Content-Type': e.ct || 'application/json' } });
  }
  function doFetch(key, init) {
    return ORIG(key, init).then(function (res) {
      if (!res.ok) return { res: res };
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('json') < 0) return { res: res };
      return res.clone().text().then(function (text) {
        var e = { t: Date.now(), ct: ct, body: text };
        if (text.length <= MAX_ENTRY) { mem.set(key, e); persist(); }
        return { res: res, e: e };
      }, function () { return { res: res }; });
    });
  }
  function network(key, init, silent) {
    var pend = inflight.get(key);
    if (pend) {
      return pend.then(function (r) { return r.e ? mk(r.e) : ORIG(key, init); },
                       function () { return ORIG(key, init); });
    }
    var p = doFetch(key, init);
    if (!silent) track(p);
    inflight.set(key, p);
    var clean = function () { if (inflight.get(key) === p) inflight.delete(key); };
    p.then(clean, clean);
    return p.then(function (r) { return r.res; });
  }
  function revalidate(key, init) {
    if (revalidating.has(key) || inflight.has(key)) return;
    revalidating.add(key);
    var i2 = {}; for (var k in init) i2[k] = init[k]; delete i2.signal;
    doFetch(key, i2).catch(noop).then(function () { revalidating.delete(key); });
  }
  function cachedFetch(key, init, silent) {
    var e = mem.get(key), now = Date.now();
    if (e) {
      var age = now - e.t;
      if (age < FRESH_MS) return Promise.resolve(mk(e));
      if (age < STALE_MS) { revalidate(key, init); return Promise.resolve(mk(e)); }
      mem.delete(key);
    }
    return network(key, init, silent);
  }

  window.fetch = function (input, init) {
    try {
      var url = urlOf(input);
      if (url && url.indexOf(REST) === 0) {
        var key = cacheKeyFor(input, init);
        if (key) return cachedFetch(key, init, false);
        var p = ORIG.apply(null, arguments);
        track(p);
        var m = methodOf(init);
        if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') p.then(invalidate, invalidate);
        return p;
      }
    } catch (e) {}
    return ORIG.apply(null, arguments);
  };

  /* ---------- Squelettes pendant l'attente ---------- */
  function skeletonHtml(n) {
    var cards = '';
    for (var i = 0; i < n; i++) {
      cards += '<div class="aurore-skel-card"><div class="aurore-skel-cover"></div>' +
               '<div class="aurore-skel-line"></div><div class="aurore-skel-line short"></div></div>';
    }
    return '<div class="aurore-skel aurore-skel-grid" aria-busy="true" aria-label="Chargement">' + cards + '</div>';
  }
  function watchLoading(el) {
    if (!el || el.__fluidWatch || typeof MutationObserver === 'undefined') return;
    el.__fluidWatch = true;
    new MutationObserver(function () {
      var c = el.firstElementChild;
      if (el.children.length === 1 && c && c.tagName === 'P' && /^\s*Chargement/i.test(c.textContent || '')) {
        el.innerHTML = skeletonHtml(6);
      }
    }).observe(el, { childList: true });
  }

  /* ---------- Préchargement des listes de documents ---------- */
  function lowData() {
    var c = navigator.connection;
    return !!(c && (c.saveData || /2g/.test(c.effectiveType || '')));
  }
  function urlMatiere(nom) {
    try {
      if (typeof etat === 'undefined' || !etat || !etat.categorie) return null;
      var niv = (etat.classe && etat.classe.dbNiveaux && etat.classe.dbNiveaux[0]) ||
                (etat.feuilleArbre && etat.feuilleArbre.dbNiveaux && etat.feuilleArbre.dbNiveaux[0]) ||
                (etat.sousNiveau && etat.sousNiveau.dbNiveaux && etat.sousNiveau.dbNiveaux[0]) || '';
      var serieDb = etat.filiere
        ? normaliserRechercheSite(etat.filiere).replace(/^serie\s+/, '').trim().toUpperCase() : '';
      var division = etat.division ? String(etat.division).trim() : '';
      var f = [];
      if (niv) f.push('Niveau=eq.' + encodeURIComponent(niv));
      f.push(encodeURIComponent('Catégorie') + '=eq.' + encodeURIComponent(etat.categorie.nom));
      f.push(encodeURIComponent('Matière') + '=eq.' + encodeURIComponent(nom));
      f.push('Publie=eq.true');
      if (serieDb) f.push('Filiere=eq.' + encodeURIComponent(serieDb));
      if (division && division.length > 1) f.push('Classe=eq.' + encodeURIComponent(division));
      f.push('order=id.desc');
      return REST + 'Document?select=*&' + f.join('&');
    } catch (e) { return null; }
  }
  function urlGenre(nom) {
    return REST + 'Document?select=*&' + encodeURIComponent('Catégorie') + '=eq.' + encodeURIComponent('Livres') +
           '&Genre=eq.' + encodeURIComponent(nom) + '&Publie=eq.true';
  }
  function prefetch(url) {
    try {
      if (!url || typeof HEADERS === 'undefined') return;
      var e = mem.get(url);
      if (e && Date.now() - e.t < FRESH_MS) return;
      cachedFetch(url, { headers: HEADERS }, true).catch(noop);
    } catch (err) {}
  }
  function urlForCard(card) {
    if (!card) return null;
    if (card.closest('#genreGrid')) {
      var n = card.querySelector('.nom');
      return n ? urlGenre((n.textContent || '').trim()) : null;
    }
    if (card.closest('#matiereGrid') && card.dataset && card.dataset.matiere) return urlMatiere(card.dataset.matiere);
    return null;
  }
  function bindPrefetch() {
    document.addEventListener('pointerdown', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      prefetch(urlForCard(t.closest('.matiere-card')));
    }, { capture: true, passive: true });
    var ms = byId('screen-matieres');
    if (!ms || typeof MutationObserver === 'undefined') return;
    var timer = null;
    new MutationObserver(function () {
      if (!ms.classList.contains('active') || lowData()) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        var cards = Array.prototype.slice.call(document.querySelectorAll('#matiereGrid .matiere-card')).slice(0, 14);
        var i = 0;
        (function next() {
          if (!ms.classList.contains('active') || i >= cards.length) return;
          prefetch(urlForCard(cards[i++]));
          setTimeout(next, 180);
        })();
      }, 500);
    }).observe(ms, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- Position (Retour téléphone) ---------- */
  function innerEls() {
    return Array.prototype.slice.call(
      document.querySelectorAll('#docsContent .aurore-resource-window, #docsContent .aurore-community-window'));
  }
  function applyInner(list) {
    if (!list || !list.length) return;
    var els = innerEls();
    list.forEach(function (v, i) {
      if (els[i] && v > 0 && Math.abs(els[i].scrollTop - v) > 2) els[i].scrollTop = v;
    });
  }
  function jump(y) {
    try { window.scrollTo({ top: y, behavior: 'instant' }); }
    catch (e) { window.scrollTo(0, y); }
  }
  function settleScroll(target, inner) {
    return new Promise(function (resolve) {
      var start = Date.now(), user = false;
      function stop() { user = true; }
      function cleanup() {
        window.removeEventListener('touchstart', stop, true);
        window.removeEventListener('wheel', stop, true);
      }
      window.addEventListener('touchstart', stop, { capture: true, passive: true });
      window.addEventListener('wheel', stop, { capture: true, passive: true });
      (function step() {
        if (user || Date.now() - start > 1800) { cleanup(); resolve(); return; }
        var maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        var want = Math.min(target, maxY);
        if (Math.abs(window.scrollY - want) > 2) jump(want);
        applyInner(inner);
        if (maxY >= target && Math.abs(window.scrollY - target) <= 2 && Date.now() - start > 250) {
          cleanup(); resolve(); return;
        }
        requestAnimationFrame(step);
      })();
    });
  }
  function docsActive() {
    var s = byId('screen-docs');
    return !!(s && s.classList.contains('active'));
  }
  function captureNow() {
    var st = history.state;
    if (!st || !st.aurasterNavigation) return;
    if (document.body.classList.contains('aurore-nav-back')) return;
    if (st.ecranAuraster !== 'screen-docs' || !docsActive()) return;
    var extra = {
      fluidInner: innerEls().map(function (e) { return Math.round(e.scrollTop); }),
      fluidUi: { search: (byId('docsSearch') || {}).value || '', sort: (byId('docSort') || {}).value || '' }
    };
    history.replaceState(Object.assign({}, st, extra), '', location.href);
  }
  var capTimer = null;
  function captureSoon() {
    clearTimeout(capTimer);
    capTimer = setTimeout(function () { try { captureNow(); } catch (e) {} }, 120);
  }
  async function restoreExtras(state) {
    var ui = state.fluidUi;
    if (ui && docsActive()) {
      var s = byId('docsSearch'), o = byId('docSort'), changed = false;
      if (o && ui.sort && o.value !== ui.sort) { o.value = ui.sort; if (o.value === ui.sort) changed = true; }
      if (s && typeof ui.search === 'string' && s.value !== ui.search) { s.value = ui.search; changed = true; }
      if (changed && typeof window.afficherDocumentsPublicsAvecOutils === 'function') window.afficherDocumentsPublicsAvecOutils();
    }
    await settleScroll(Number(state.scrollY) || 0, state.fluidInner);
  }
  function wrapNavigation() {
    var oRestore = window.restaurerSnapshotNavigation;
    if (typeof oRestore === 'function' && !oRestore.__fluid) {
      var wRestore = async function (state) {
        document.body.classList.add('aurore-nav-back');
        var ok = false;
        try { ok = await oRestore.apply(this, arguments); }
        finally { setTimeout(function () { document.body.classList.remove('aurore-nav-back'); }, 350); }
        if (ok && state) { try { await restoreExtras(state); } catch (e) {} }
        return ok;
      };
      wRestore.__fluid = true;
      window.restaurerSnapshotNavigation = wRestore;
    }
    var oShow = window.afficherEcran;
    if (typeof oShow === 'function' && !oShow.__fluid) {
      var wShow = function () {
        try { captureNow(); } catch (e) {}
        return oShow.apply(this, arguments);
      };
      wShow.__fluid = true;
      window.afficherEcran = wShow;
    }
  }

  function onReady() {
    try { ensureBar(); } catch (e) {}
    try { watchLoading(byId('docsContent')); watchLoading(byId('recentsContent')); } catch (e) {}
    try { wrapNavigation(); } catch (e) {}
    try { bindPrefetch(); } catch (e) {}
    document.addEventListener('scroll', function (ev) {
      var t = ev.target;
      if (t && t.classList && (t.classList.contains('aurore-resource-window') || t.classList.contains('aurore-community-window'))) captureSoon();
    }, true);
    document.addEventListener('input', function (ev) { if (ev.target && ev.target.id === 'docsSearch') captureSoon(); }, true);
    document.addEventListener('change', function (ev) { if (ev.target && ev.target.id === 'docSort') captureSoon(); }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
  else onReady();
})();
