/* Aurore — Lecteur PDF « Plus » (v2, 2026-10-09)
   Chargé après aurore-pdf-reader.js (voir aurore-zoom-control.js). Ne remplace pas le lecteur :
   il corrige et complète ses fonctions internes.

   v2 — CORRECTIFS
   • Les feuilles de style du lecteur (pdf-reader.css, refonte, lecture horizontale) imposent des
     tailles en !important (largeur 100 % des pages, canvas « width:auto »…). Toutes les tailles
     posées par ce module sont donc écrites en !important inline : plus aucune page « zoomée ».
   • Texte en double : la couche de texte invisible vit désormais dans un Shadow DOM, hors de
     portée des CSS du site (le texte est toujours transparent, seul le surlignage est visible).
   • Zoom du site : tant que le lecteur est ouvert, html{zoom:1!important} (impossible à écraser
     par un script) ; la largeur disponible tient compte d'un éventuel zoom résiduel.
   • Zoom > 100 % : le conteneur des pages s'élargit (on peut atteindre les deux bords) ; en lecture
     horizontale, défilement vertical autorisé et « aimantation » désactivée quand on zoome.

   FONCTIONS : recherche dans le texte, sélection/copie, miniatures, plan, liens cliquables,
   rotation, ajustement « page entière » / « largeur », netteté (rendu à la résolution physique).
   Lecture seule (Telechargement_autorise === false) : texte non sélectionnable ni copiable. */
(function () {
  'use strict';
  if (window.__aurorePdfPlus) return;
  window.__aurorePdfPlus = true;

  var $ = function (id) { return document.getElementById(id); };
  var MAX_SIDE = 8192, MAX_PX_PAGE = 16e6, BUDGET_PX = 70e6;
  var S = { pdf: null, q: '', qn: '', pages: [], norm: [], indexed: 0, building: false, buildProm: null,
            matches: [], idx: -1, curN: 0, curK: -1, token: 0, qid: 0, auto: false };
  var DIMS = {}, DIMSPDF = null;
  var side = { open: false, tab: 'thumbs', thumbsFor: null, outlineFor: null, timer: null, lastPage: 0 };
  var refitTimer = null, rendTimer = null, lastDpr = 0, thumbQ = Promise.resolve(), thumbIO = null;

  /* ---------- utilitaires ---------- */
  function imp(el, o) { for (var k in o) el.style.setProperty(k, o[k], 'important'); }
  function ouvert() { var o = $('pdfViewerOverlay'); return !!o && o.style.display !== 'none' && !!PDF_EN_COURS; }
  function lectureSeule() { return !!(DOC_EN_LECTURE && DOC_EN_LECTURE.Telechargement_autorise === false); }
  function largeurBase() {
    var z = $('pdfViewerZone');
    if (!z) return Math.max(1, Math.min(980, window.innerWidth - 20));
    var cs = getComputedStyle(z), pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var w = z.clientWidth, r = z.getBoundingClientRect();
    var k = z.offsetWidth > 0 ? r.width / z.offsetWidth : 1;
    // Zoom résiduel (visuel ≠ mise en page) : on se cale sur la largeur réelle de l'écran.
    if (k > 0.3 && k < 3 && Math.abs(k - 1) > 0.02) w = Math.min(w, window.innerWidth / k);
    else w = Math.min(w, window.innerWidth);
    return Math.max(1, Math.min(980, Math.floor(w - pad - 8)));
  }
  function dprEff() { return Math.max(1, Math.min(window.devicePixelRatio || 1, 3)); }
  function rotTotale(page) { return (((page.rotate || 0) + PDF_ROTATION) % 360 + 360) % 360; }
  function ratioPage(n) {
    var d = DIMS[n] || DIMS[1]; if (!d) return 1.4142;
    return (PDF_ROTATION % 180) !== 0 ? d.w / d.h : d.h / d.w;
  }
  function wrapperDe(n) { return document.querySelector('#pdfViewerPages .pdf-reader-page[data-page="' + n + '"]'); }
  function cleRendu() { return [Math.round(PDF_ZOOM * 1000), PDF_ROTATION, Math.round(largeurBase()), dprEff().toFixed(3)].join('|'); }
  function pause() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function nz(s) {
    var out = '', map = [];
    for (var i = 0; i < s.length; i++) {
      var c = s[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      out += c; for (var k = 0; k < c.length; k++) map.push(i);
    }
    return { text: out, map: map };
  }
  function nzRapide(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  /* ---------- mise en page (taille de TOUTES les pages, rendues ou non) ---------- */
  function relayout() {
    var pages = $('pdfViewerPages'); if (!pages || !PDF_EN_COURS) return;
    var L = largeurBase(); pdfLargeurBase = L;
    var cssW = L * PDF_ZOOM, zone = $('pdfViewerZone');
    if (zone) zone.classList.toggle('apx-zoomed', PDF_ZOOM > 1.02);
    pages.querySelectorAll('.pdf-reader-page').forEach(function (w) {
      var n = +w.dataset.page, cssH = cssW * ratioPage(n);
      imp(w, { 'width': cssW + 'px', 'max-width': 'none', 'min-width': '0', 'flex': '0 0 auto', 'min-height': Math.round(cssH + 32) + 'px' });
      if (w.__apxKey) {                       // page déjà dessinée : étirement immédiat de l'ancien bitmap
        var c = w.querySelector('canvas');
        if (c) imp(c, { 'width': cssW + 'px', 'height': cssH + 'px', 'max-width': 'none' });
        var ly = w.querySelector('.apx-layers');
        if (ly && ly.__w) ly.style.transform = 'scale(' + (cssW / ly.__w) + ')';
      }
    });
  }
  function ancre() {
    var zone = $('pdfViewerZone'), w = wrapperDe(PDF_PAGE_ACTUELLE || 1); if (!zone || !w) return null;
    var zr = zone.getBoundingClientRect(), r = w.getBoundingClientRect();
    return { n: PDF_PAGE_ACTUELLE || 1, ry: (zr.top + zr.height * 0.35 - r.top) / Math.max(1, r.height), rx: (zr.left + zr.width * 0.5 - r.left) / Math.max(1, r.width) };
  }
  function restaurerAncre(a) {
    if (!a) return; var zone = $('pdfViewerZone'), w = wrapperDe(a.n); if (!zone || !w) return;
    var zr = zone.getBoundingClientRect(), r = w.getBoundingClientRect();
    zone.scrollTop += r.top + a.ry * r.height - (zr.top + zr.height * 0.35);
    zone.scrollLeft += r.left + a.rx * r.width - (zr.left + zr.width * 0.5);
  }

  /* ---------- rendu net d'une page ---------- */
  async function rendrePlus(n, force) {
    var pdf = PDF_EN_COURS; if (!pdf) return;
    if (DIMSPDF !== pdf) { DIMS = {}; DIMSPDF = pdf; }
    var w = wrapperDe(n); if (!w) return;
    var key = cleRendu();
    if (!force && w.__apxKey === key) return;
    if (w.__apxProm && w.__apxPromKey === key && !force) return w.__apxProm;
    try { if (w.__apxTask) w.__apxTask.cancel(); } catch (e) {}
    var jeton = PDF_JETON_OUVERTURE;
    var p = (async function () {
      var page = await pdf.getPage(n);
      if (PDF_EN_COURS !== pdf || jeton !== PDF_JETON_OUVERTURE || !w.isConnected) return;
      var rot = rotTotale(page);
      var vp1 = page.getViewport({ scale: 1, rotation: rot });
      var sw = (PDF_ROTATION % 180) !== 0;
      DIMS[n] = { w: sw ? vp1.height : vp1.width, h: sw ? vp1.width : vp1.height };
      var cssWt = largeurBase() * PDF_ZOOM, cssHt = cssWt * vp1.height / vp1.width;
      var out = dprEff();
      out = Math.min(out, MAX_SIDE / Math.max(cssWt, cssHt), Math.sqrt(MAX_PX_PAGE / (cssWt * cssHt)));
      out = Math.max(out, 0.5);
      var pxW = Math.max(1, Math.round(cssWt * out));
      var s = pxW / vp1.width;
      var viewport = page.getViewport({ scale: s, rotation: rot });
      var nc = document.createElement('canvas');
      nc.width = Math.max(1, Math.round(viewport.width));
      nc.height = Math.max(1, Math.round(viewport.height));
      var cssW = nc.width / out, cssH = nc.height / out;
      var ctx = nc.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, nc.width, nc.height);
      var task = page.render({ canvasContext: ctx, viewport: viewport });
      w.__apxTask = task;
      try { await task.promise; }
      catch (e) { if (/cancel/i.test(String(e && (e.name || e.message)))) return; throw e; }
      if (PDF_EN_COURS !== pdf || jeton !== PDF_JETON_OUVERTURE || !w.isConnected) return;
      if (key !== cleRendu()) return;        // le zoom a changé pendant le rendu : un nouveau rendu est déjà demandé
      nc.style.cssText = 'display:block!important;margin-left:auto!important;margin-right:auto!important;max-width:none!important;width:' + cssW + 'px!important;height:' + cssH + 'px!important';
      var old = w.querySelector('canvas');
      nc.setAttribute('aria-label', (old && old.getAttribute('aria-label')) || ('Page ' + n));
      if (old) old.replaceWith(nc); else w.insertBefore(nc, w.firstChild);
      imp(w, { 'width': cssW + 'px', 'max-width': 'none', 'min-width': '0', 'flex': '0 0 auto', 'min-height': Math.round(cssH + 32) + 'px' });
      w.__apxKey = key; w.__apxPx = nc.width * nc.height;
      w.classList.add('pdf-page-rendered');
      construireCouches(w, page, rot, cssW, cssH, cssW / vp1.width, n, key);
      ajusterMemoire();
    })().catch(function (e) {
      if (!/cancel/i.test(String(e && (e.name || e.message || e)))) console.warn('[Lecteur PDF+] rendu page ' + n, e);
    });
    w.__apxProm = p; w.__apxPromKey = key;
    p.then(function () { if (w.__apxProm === p) w.__apxProm = null; });
    return p;
  }

  function ajusterMemoire() {
    var ws = Array.prototype.filter.call(document.querySelectorAll('#pdfViewerPages .pdf-reader-page'), function (w) { return w.__apxKey && w.__apxPx; });
    var total = ws.reduce(function (a, w) { return a + w.__apxPx; }, 0);
    if (total <= BUDGET_PX) return;
    var cur = PDF_PAGE_ACTUELLE || 1;
    ws.sort(function (a, b) { return Math.abs(+b.dataset.page - cur) - Math.abs(+a.dataset.page - cur); });
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i]; if (total <= BUDGET_PX * 0.8) break;
      if (Math.abs(+w.dataset.page - cur) <= 1) continue;
      var c = w.querySelector('canvas');
      if (c) {
        var cw = c.style.getPropertyValue('width'), ch = c.style.getPropertyValue('height');
        c.width = 1; c.height = 1; imp(c, { 'width': cw, 'height': ch });
      }
      total -= w.__apxPx; w.__apxKey = null; w.__apxPx = 0;
      var ly = w.querySelector('.apx-layers'); if (ly) ly.remove();
      w.classList.remove('pdf-page-rendered');
    }
  }

  /* ---------- couches texte (Shadow DOM : insensible aux CSS du site) + liens ---------- */
  var TEXT_CSS =
    ':host{display:block}' +
    '.t{all:initial;display:block;position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;line-height:1;text-align:initial;forced-color-adjust:none;text-size-adjust:none;-webkit-user-select:inherit;user-select:inherit}' +
    'span,br{all:initial;position:absolute;white-space:pre;color:transparent;-webkit-text-fill-color:transparent;cursor:text;transform-origin:0 0;-webkit-user-select:text;user-select:text}' +
    ':host(.apx-ro) span,:host(.apx-ro) br{-webkit-user-select:none;user-select:none;pointer-events:none}' +
    'span::selection,span *::selection{background:rgba(37,99,235,.3);color:transparent}' +
    'mark{all:initial;font:inherit;white-space:pre;color:transparent;-webkit-text-fill-color:transparent;background:rgba(255,214,0,.5);border-radius:2px}' +
    'mark.apx-cur{background:rgba(255,120,0,.7);outline:2px solid rgba(255,120,0,.9)}';

  async function construireCouches(w, page, rot, cssW, cssH, scaleCss, n, key) {
    var old = w.querySelector('.apx-layers'); if (old) old.remove();
    var c = w.querySelector('canvas'); if (!c) return;
    var ly = document.createElement('div');
    ly.className = 'apx-layers' + (lectureSeule() ? ' apx-ro' : '');
    ly.style.cssText = 'left:' + c.offsetLeft + 'px;top:' + c.offsetTop + 'px;width:' + cssW + 'px;height:' + cssH + 'px';
    ly.__w = cssW; w.appendChild(ly);
    var pdf = PDF_EN_COURS, jeton = PDF_JETON_OUVERTURE;
    function perime() { return PDF_EN_COURS !== pdf || jeton !== PDF_JETON_OUVERTURE || w.__apxKey !== key || !ly.isConnected; }
    var vpCss = page.getViewport({ scale: scaleCss, rotation: rot });
    try {
      if (typeof pdfjsLib !== 'undefined' && typeof pdfjsLib.renderTextLayer === 'function' && Element.prototype.attachShadow) {
        var tc = await page.getTextContent();
        if (perime()) return;
        var host = document.createElement('div'); host.className = 'apx-text' + (lectureSeule() ? ' apx-ro' : '');
        host.style.width = cssW + 'px'; host.style.height = cssH + 'px';
        host.addEventListener('contextmenu', function (e) { if (!lectureSeule()) e.stopPropagation(); });
        var sr = host.attachShadow({ mode: 'open' });
        sr.innerHTML = '<style>' + TEXT_CSS + '</style><div class="t"></div>';
        var cont = sr.querySelector('.t'); cont.style.setProperty('--scale-factor', String(scaleCss));
        ly.appendChild(host);
        var divs = [], strs = [], args = { container: cont, viewport: vpCss, textDivs: divs, textContentItemsStr: strs }, task;
        try { task = pdfjsLib.renderTextLayer(Object.assign({ textContentSource: tc }, args)); }
        catch (e1) { task = pdfjsLib.renderTextLayer(Object.assign({ textContent: tc }, args)); }
        await task.promise;
        if (perime()) return;
        host.__divs = divs; host.__strs = strs;
        if (S.qn) surlignerPage(n);
      }
    } catch (e) { if (!/cancel/i.test(String(e && (e.name || e.message)))) console.warn('[Lecteur PDF+] couche texte', e); }
    try {
      var ann = await page.getAnnotations({ intent: 'display' });
      if (perime()) return;
      ann.forEach(function (a) {
        if (a.subtype !== 'Link' || !a.rect) return;
        var r = vpCss.convertToViewportRectangle(a.rect);
        var x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]), ww = Math.abs(r[2] - r[0]), hh = Math.abs(r[3] - r[1]);
        if (ww < 2 || hh < 2) return;
        var el = document.createElement('a'); el.className = 'apx-link';
        el.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + ww + 'px;height:' + hh + 'px';
        if (a.url && /^(https?:|mailto:)/i.test(a.url)) { el.href = a.url; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
        else if (a.dest) { el.href = '#'; el.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); allerDest(a.dest); }); }
        else return;
        ly.appendChild(el);
      });
    } catch (e) {}
  }

  async function destVersPage(dest) {
    var pdf = PDF_EN_COURS; if (!pdf || !dest) return null;
    var d = dest; if (typeof d === 'string') d = await pdf.getDestination(d);
    if (!Array.isArray(d)) return null;
    var ref = d[0];
    if (ref && typeof ref === 'object') return (await pdf.getPageIndex(ref)) + 1;
    if (Number.isInteger(ref)) return ref + 1;
    return null;
  }
  async function allerDest(dest) { try { var n = await destVersPage(dest); if (n) allerPageNumero(n); } catch (e) {} }

  /* ---------- zoom (remplace appliquerZoom) ---------- */
  function planifierRendus(d) { clearTimeout(rendTimer); rendTimer = setTimeout(rendreVisibles, d); }
  async function rendreVisibles() {
    if (!PDF_EN_COURS) return; var zone = $('pdfViewerZone'); if (!zone) return;
    var zr = zone.getBoundingClientRect(), cx = zr.left + zr.width / 2, cy = zr.top + zr.height / 2;
    var cand = Array.prototype.map.call(document.querySelectorAll('#pdfViewerPages .pdf-reader-page'), function (el) {
      var r = el.getBoundingClientRect();
      return { n: +el.dataset.page, r: r, d: Math.hypot((r.left + r.right) / 2 - cx, (r.top + r.bottom) / 2 - cy) };
    }).filter(function (o) { return o.r.bottom > zr.top - 700 && o.r.top < zr.bottom + 700 && o.r.right > zr.left - 700 && o.r.left < zr.right + 700; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 12);
    for (var i = 0; i < cand.length; i++) { if (!PDF_EN_COURS) break; await rendreUnePagePDF(cand[i].n); }
  }
  async function zoomPlus(delta, absolue, ancrage) {
    var zone = $('pdfViewerZone'), pages = $('pdfViewerPages'), niveau = $('pdfViewerZoomLevel');
    var cible = absolue ? delta : PDF_ZOOM + delta;
    var prochain = Math.max(PDF_ZOOM_MIN, Math.min(PDF_ZOOM_MAX, +Number(cible).toFixed(2)));
    if (pages) { pages.style.zoom = '1'; pages.style.transform = 'none'; }
    if (prochain === PDF_ZOOM) { if (niveau) niveau.textContent = Math.round(PDF_ZOOM * 100) + '%'; return; }
    var ancien = PDF_ZOOM; PDF_ZOOM = prochain;
    if (niveau) niveau.textContent = Math.round(PDF_ZOOM * 100) + '%';
    if (!pages || !zone) return;
    var px = ancrage && isFinite(ancrage.x) ? Math.max(0, Math.min(zone.clientWidth, ancrage.x)) : zone.clientWidth / 2;
    var py = ancrage && isFinite(ancrage.y) ? Math.max(0, Math.min(zone.clientHeight, ancrage.y)) : Math.min(zone.clientHeight * 0.38, Math.max(40, zone.clientHeight / 2));
    var ax = zone.scrollLeft + px, ay = zone.scrollTop + py, ratio = prochain / Math.max(0.01, ancien);
    relayout();
    zone.scrollLeft = Math.max(0, ax * ratio - px);
    zone.scrollTop = Math.max(0, ay * ratio - py);
    planifierRendus(110);
    try { majBarreDefilementPDF(); } catch (e) {}
  }
  function zoomLargeur() { zoomPlus(1, true); }
  function zoomPage() {
    var zone = $('pdfViewerZone'); if (!zone || !PDF_EN_COURS) return;
    var n = PDF_PAGE_ACTUELLE || 1, h1 = largeurBase() * ratioPage(n);
    var cs = getComputedStyle(zone), padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var z = Math.max(PDF_ZOOM_MIN, Math.round(Math.min(1, (zone.clientHeight - padV - 16) / h1) * 100) / 100);
    zoomPlus(z, true); setTimeout(function () { allerPageNumero(n); }, 60);
  }
  function pivoter() {
    if (!PDF_EN_COURS) return; var n = PDF_PAGE_ACTUELLE || 1;
    PDF_ROTATION = (PDF_ROTATION + 90) % 360;
    document.querySelectorAll('#pdfViewerPages .pdf-reader-page').forEach(function (w) {
      w.__apxKey = null; var c = w.querySelector('canvas'); if (c) c.style.visibility = 'hidden';
      var ly = w.querySelector('.apx-layers'); if (ly) ly.remove();
    });
    relayout();
    setTimeout(function () { allerPageNumero(n); planifierRendus(40); }, 30);
  }

  /* ---------- ajustement automatique (redimensionnement / zoom du site) ---------- */
  function refit() {
    if (!ouvert()) return;
    var L = largeurBase(), d = dprEff();
    if (Math.abs(L - pdfLargeurBase) < 1 && d === lastDpr) return;
    lastDpr = d; var a = ancre(); relayout(); restaurerAncre(a); planifierRendus(60);
  }
  function planifierRefit() { clearTimeout(refitTimer); refitTimer = setTimeout(refit, 140); }

  function neutraliser() {
    var r = document.documentElement; if (!r) return;
    r.classList.add('aurore-lecteur-pdf-ouvert');
    if (PDF_ZOOM_SITE_NEUTRALISE) return;
    PDF_ZOOM_SITE_SAUVEGARDE = r.style.zoom || '';
    PDF_ZOOM_SITE_NEUTRALISE = true;
    r.style.zoom = '1';
    window.dispatchEvent(new Event('resize'));
  }
  function restaurer() {
    var r = document.documentElement; if (!r) return;
    r.classList.remove('aurore-lecteur-pdf-ouvert');
    if (!PDF_ZOOM_SITE_NEUTRALISE) return;
    r.style.zoom = PDF_ZOOM_SITE_SAUVEGARDE || '';
    PDF_ZOOM_SITE_SAUVEGARDE = null; PDF_ZOOM_SITE_NEUTRALISE = false;
    window.dispatchEvent(new Event('resize'));
  }

  /* ---------- recherche dans le texte ---------- */
  function effacerSurlignages() {
    document.querySelectorAll('#pdfViewerPages .apx-text').forEach(function (box) {
      if (!box.__divs) return;
      for (var i = 0; i < box.__divs.length; i++) { var d = box.__divs[i]; if (d.__hl) { d.textContent = box.__strs[i]; d.__hl = false; } }
    });
  }
  function surlignerPage(n) {
    var w = wrapperDe(n), box = w && w.querySelector('.apx-text'); if (!box || !box.__divs) return;
    var divs = box.__divs, strs = box.__strs, i;
    for (i = 0; i < divs.length; i++) if (divs[i].__hl) { divs[i].textContent = strs[i]; divs[i].__hl = false; }
    if (!S.qn) return;
    var joined = '', starts = new Array(strs.length);
    for (i = 0; i < strs.length; i++) { starts[i] = joined.length; joined += strs[i]; }
    var r0 = nz(joined), text = r0.text, map = r0.map, ranges = [], p = 0;
    while ((p = text.indexOf(S.qn, p)) >= 0 && ranges.length < 2000) { ranges.push([map[p], map[p + S.qn.length - 1] + 1]); p += Math.max(1, S.qn.length); }
    if (!ranges.length) return;
    var per = new Map(); i = 0;
    for (var r = 0; r < ranges.length; r++) {
      var a = ranges[r][0], b = ranges[r][1];
      while (i < strs.length && starts[i] + strs[i].length <= a) i++;
      for (var j = i; j < strs.length && starts[j] < b; j++) {
        var s0 = starts[j], x = Math.max(a, s0) - s0, y = Math.min(b, s0 + strs[j].length) - s0;
        if (y > x) { var arr = per.get(j); if (!arr) { arr = []; per.set(j, arr); } arr.push([x, y, r]); }
      }
    }
    per.forEach(function (segs, j) {
      var d = divs[j]; if (!d) return;
      var str = strs[j], frag = document.createDocumentFragment(), pos = 0;
      segs.sort(function (u, v) { return u[0] - v[0]; });
      segs.forEach(function (sg) {
        if (sg[0] < pos) return;
        if (sg[0] > pos) frag.appendChild(document.createTextNode(str.slice(pos, sg[0])));
        var m = document.createElement('mark');
        m.className = 'apx-hl' + ((n === S.curN && sg[2] === S.curK) ? ' apx-cur' : '');
        m.textContent = str.slice(sg[0], sg[1]); frag.appendChild(m); pos = sg[1];
      });
      if (pos < str.length) frag.appendChild(document.createTextNode(str.slice(pos)));
      d.textContent = ''; d.appendChild(frag); d.__hl = true;
    });
  }
  function surlignerTout() {
    document.querySelectorAll('#pdfViewerPages .pdf-reader-page').forEach(function (w) {
      if (w.querySelector('.apx-text')) surlignerPage(+w.dataset.page);
    });
  }
  function marqueCourante(w) {
    var host = w && w.querySelector('.apx-text');
    return host && host.shadowRoot ? host.shadowRoot.querySelector('mark.apx-cur') : null;
  }
  function majCompteur() {
    var el = $('apxCount'); if (!el) return;
    var tot = S.matches.length, n = S.pdf ? S.pdf.numPages : 0;
    if (S.qn.length < 2) { el.textContent = ''; return; }
    var t;
    if (tot) t = (S.idx >= 0 ? S.idx + 1 : 0) + ' / ' + tot + (S.building ? ' …' : '');
    else t = S.building ? ('Recherche ' + Math.round(S.indexed / Math.max(1, n) * 100) + '%') : 'Aucun résultat';
    el.textContent = t;
  }
  function recalculer() {
    var m = [];
    if (S.qn) for (var n = 1; n <= S.indexed && m.length < 5000; n++) {
      var t = S.norm[n]; if (!t) continue;
      var p = 0, k = 0;
      while ((p = t.indexOf(S.qn, p)) >= 0 && m.length < 5000) { m.push({ n: n, k: k++ }); p += Math.max(1, S.qn.length); }
    }
    S.matches = m;
    if (S.auto && m.length && S.idx < 0) { S.auto = false; aller(0); } else majCompteur();
  }
  async function construireIndex() {
    var pdf = S.pdf; if (!pdf) return;
    if (S.building) return S.buildProm;
    if (S.indexed >= pdf.numPages) return;
    S.building = true; var tok = S.token;
    S.buildProm = (async function () {
      try {
        for (var n = S.indexed + 1; n <= pdf.numPages; n++) {
          if (tok !== S.token || PDF_EN_COURS !== pdf) return;
          var page = await pdf.getPage(n), tc = await page.getTextContent();
          var str = tc.items.map(function (it) { return it.str; }).join('');
          S.pages[n] = str; S.norm[n] = nzRapide(str); S.indexed = n;
          if (n % 8 === 0 || n === pdf.numPages) { recalculer(); await pause(); }
        }
      } catch (e) { console.warn('[Lecteur PDF+] indexation', e); }
      finally { if (tok === S.token) { S.building = false; recalculer(); } }
    })();
    return S.buildProm;
  }
  async function chercher(q) {
    var id = ++S.qid;
    S.q = q.trim().replace(/\s+/g, ' '); S.qn = nz(S.q).text; S.matches = []; S.idx = -1; S.curN = 0; S.curK = -1;
    effacerSurlignages(); majCompteur();
    if (S.qn.length < 2 || !S.pdf) return;
    S.auto = true; recalculer();
    await construireIndex();
    if (id !== S.qid) return;
    recalculer();
  }
  async function aller(i) {
    var len = S.matches.length; if (!len) return;
    S.idx = ((i % len) + len) % len;
    var m = S.matches[S.idx]; S.curN = m.n; S.curK = m.k; majCompteur();
    allerPageNumero(m.n);
    await rendreUnePagePDF(m.n);
    var w = wrapperDe(m.n), box = null;
    for (var t = 0; t < 40; t++) { box = w && w.querySelector('.apx-text'); if (box && box.__divs) break; await new Promise(function (r) { setTimeout(r, 80); }); }
    surlignerTout();
    var mk = marqueCourante(w);
    if (mk) mk.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }
  function ouvrirRecherche() {
    var bar = $('apxSearch'); if (!bar || !PDF_EN_COURS) return;
    fermerMenuLecteurPDF(); bar.classList.add('open'); bar.setAttribute('aria-hidden', 'false');
    var inp = $('apxQ'); setTimeout(function () { inp.focus(); inp.select(); }, 30);
    if (inp.value) chercher(inp.value);
  }
  function fermerRecherche() {
    var bar = $('apxSearch'); if (!bar) return;
    bar.classList.remove('open'); bar.setAttribute('aria-hidden', 'true');
    S.qid++; S.q = ''; S.qn = ''; S.matches = []; S.idx = -1; S.curN = 0; S.curK = -1;
    effacerSurlignages(); majCompteur();
  }

  /* ---------- panneau miniatures + plan ---------- */
  function ouvrirPanneau(tab) {
    if (!PDF_EN_COURS) return; fermerMenuLecteurPDF();
    side.open = true; side.tab = tab || side.tab;
    $('apxSide').classList.add('open'); $('apxSideBack').classList.add('open'); $('apxSide').setAttribute('aria-hidden', 'false');
    choisirOnglet(side.tab);
    clearInterval(side.timer); side.timer = setInterval(suivreMiniature, 400);
  }
  function fermerPanneau() {
    side.open = false; clearInterval(side.timer);
    var s = $('apxSide'), b = $('apxSideBack'); if (!s) return;
    s.classList.remove('open'); b.classList.remove('open'); s.setAttribute('aria-hidden', 'true');
  }
  function choisirOnglet(t) {
    side.tab = t;
    $('apxTabThumbs').classList.toggle('on', t === 'thumbs'); $('apxTabOutline').classList.toggle('on', t === 'outline');
    $('apxThumbs').hidden = t !== 'thumbs'; $('apxOutline').hidden = t !== 'outline';
    if (t === 'thumbs') construireMiniatures();
    if (t === 'outline' && side.outlineFor !== S.pdf) chargerPlan();
  }
  function construireMiniatures() {
    var pdf = S.pdf, list = $('apxThumbs'); if (!pdf || side.thumbsFor === pdf) return;
    side.thumbsFor = pdf; list.textContent = '';
    if (thumbIO) thumbIO.disconnect();
    thumbIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting && !e.target.__done) { thumbIO.unobserve(e.target); dessinerMiniature(pdf, +e.target.dataset.page, e.target); } });
    }, { root: list, rootMargin: '400px 0px' });
    for (var n = 1; n <= pdf.numPages; n++) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'apx-th'; b.dataset.page = String(n);
      b.setAttribute('aria-label', 'Aller à la page ' + n);
      var c = document.createElement('canvas'); c.width = 1; c.height = 1; b.appendChild(c);
      var l = document.createElement('span'); l.textContent = String(n); b.appendChild(l);
      b.style.minHeight = '150px';
      (function (num) { b.addEventListener('click', function () { allerPageNumero(num); if (window.innerWidth < 700) fermerPanneau(); }); })(n);
      list.appendChild(b); thumbIO.observe(b);
    }
  }
  function dessinerMiniature(pdf, n, btn) {
    thumbQ = thumbQ.then(async function () {
      if (PDF_EN_COURS !== pdf || btn.__done) return;
      var page = await pdf.getPage(n), vp1 = page.getViewport({ scale: 1 });
      var cssW = 110, dpr = Math.min(window.devicePixelRatio || 1, 2);
      var vp = page.getViewport({ scale: cssW * dpr / vp1.width });
      var c = btn.querySelector('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      imp(c, { 'width': cssW + 'px', 'height': (c.height / dpr) + 'px', 'max-width': '100%' });
      await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
      btn.__done = true; btn.style.minHeight = '0';
    }).catch(function () {});
  }
  function suivreMiniature() {
    if (!side.open || side.tab !== 'thumbs') return;
    var n = PDF_PAGE_ACTUELLE || 1; if (n === side.lastPage) return; side.lastPage = n;
    var list = $('apxThumbs');
    list.querySelectorAll('.apx-th.on').forEach(function (b) { b.classList.remove('on'); });
    var cur = list.querySelector('.apx-th[data-page="' + n + '"]');
    if (cur) { cur.classList.add('on'); cur.scrollIntoView({ block: 'nearest' }); }
  }
  async function chargerPlan() {
    var pdf = S.pdf, list = $('apxOutline'); if (!pdf) return;
    side.outlineFor = pdf; list.textContent = 'Chargement…';
    var o = null; try { o = await pdf.getOutline(); } catch (e) {}
    if (PDF_EN_COURS !== pdf) return;
    list.textContent = '';
    $('apxTabOutline').style.display = (o && o.length) ? '' : 'none';
    if (!o || !o.length) { var p = document.createElement('p'); p.className = 'apx-empty'; p.textContent = 'Ce document n’a pas de plan (table des matières).'; list.appendChild(p); return; }
    (function rendre(items, niv) {
      items.forEach(function (it) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'apx-ol';
        b.style.paddingLeft = (10 + niv * 14) + 'px'; b.textContent = it.title || '(sans titre)';
        if (it.bold) b.style.fontWeight = '700';
        b.addEventListener('click', function () {
          if (it.dest) allerDest(it.dest); else if (it.url && /^https?:/i.test(it.url)) window.open(it.url, '_blank', 'noopener');
          if (window.innerWidth < 700) fermerPanneau();
        });
        list.appendChild(b);
        if (it.items && it.items.length) rendre(it.items, niv + 1);
      });
    })(o, 0);
  }

  /* ---------- interface ---------- */
  var ICONS = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    pages: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/></svg>',
    rotate: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>',
    fitpage: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="1.5"/><polyline points="3 8 3 3 8 3"/><polyline points="21 16 21 21 16 21"/></svg>',
    fitwidth: '<svg viewBox="0 0 24 24"><polyline points="7 8 3 12 7 16"/><polyline points="17 8 21 12 17 16"/><line x1="3" y1="12" x2="21" y2="12"/></svg>'
  };
  function css() {
    if ($('apx-css')) return;
    var s = document.createElement('style'); s.id = 'apx-css';
    s.textContent =
      /* zoom du site neutralisé tant que le lecteur est ouvert (ne peut pas être écrasé par un script) */
      'html.aurore-lecteur-pdf-ouvert,html.aurore-lecteur-pdf-ouvert body{zoom:1!important}' +
      'html.aurore-lecteur-pdf-ouvert #aurore-zoom-fab,html.aurore-lecteur-pdf-ouvert #aurore-zoom-panel,html.aurore-lecteur-pdf-ouvert #aurore-zoom-hint{display:none!important}' +
      /* lecture verticale : le conteneur s'élargit avec le zoom, les deux bords restent accessibles */
      'html body #pdfViewerZone.pdf-lecture-vertical{align-items:flex-start!important}' +
      'html body #pdfViewerZone.pdf-lecture-vertical #pdfViewerPages{width:max-content!important;min-width:100%!important;max-width:none!important}' +
      /* lecture horizontale : défilement vertical autorisé, aimantation coupée quand on zoome */
      'html body #pdfViewerZone.pdf-lecture-horizontal{overflow-y:auto!important;touch-action:pan-x pan-y!important}' +
      'html body #pdfViewerZone.pdf-lecture-horizontal.apx-zoomed{scroll-snap-type:none!important}' +
      'html body #pdfViewerZone.pdf-lecture-horizontal.apx-zoomed .pdf-reader-page{scroll-snap-align:none!important;scroll-snap-stop:normal!important}' +
      '#pdfViewerPages .pdf-reader-page{position:relative!important}' +
      '.apx-layers{position:absolute;transform-origin:0 0;z-index:3;pointer-events:none}' +
      '.apx-text{position:absolute!important;left:0;top:0;overflow:hidden;pointer-events:auto;-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default}' +
      '.apx-ro.apx-text,.apx-ro .apx-text{pointer-events:none!important;-webkit-user-select:none!important;user-select:none!important}' +
      '.apx-link{position:absolute;display:block;pointer-events:auto;cursor:pointer;border-radius:2px}.apx-link:hover{background:rgba(37,99,235,.12)}' +
      '.apx-menu{display:flex;flex-direction:column;border-top:1px solid var(--bordure,#e5e7eb);margin-top:6px;padding-top:6px}' +
      '.apx-mb{display:flex;align-items:center;gap:10px;width:100%;padding:11px 12px;background:none;border:0;color:var(--encre,#111827);font:inherit;font-size:.9rem;text-align:left;cursor:pointer;border-radius:10px}' +
      '.apx-mb:hover,.apx-mb:active{background:rgba(127,127,127,.14)}' +
      '.apx-mb svg{width:20px;height:20px;flex:none;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
      '.apx-search{position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top,0px) + 58px);z-index:2147483000;display:none;align-items:center;gap:6px;max-width:520px;margin:0 auto;padding:8px 10px;background:var(--fond,#fff);color:var(--encre,#111827);border:1px solid var(--bordure,#d1d5db);border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.22)}' +
      '.apx-search.open{display:flex}' +
      '.apx-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:16px;padding:6px 4px}' +
      '.apx-count{font-size:.74rem;opacity:.7;white-space:nowrap}' +
      '.apx-ib{width:34px;height:34px;flex:none;border:0;border-radius:10px;background:rgba(127,127,127,.14);color:inherit;font-size:14px;cursor:pointer}' +
      '.apx-side-back{position:fixed;inset:0;z-index:2147482998;background:rgba(0,0,0,.35);display:none}.apx-side-back.open{display:block}' +
      '.apx-side{position:fixed;top:0;bottom:0;left:0;width:min(82vw,310px);z-index:2147482999;background:var(--fond,#fff);color:var(--encre,#111827);border-right:1px solid var(--bordure,#d1d5db);transform:translateX(-102%);transition:transform .22s ease;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px);box-shadow:6px 0 28px rgba(0,0,0,.25)}' +
      '.apx-side.open{transform:none}' +
      '.apx-side-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;border-bottom:1px solid var(--bordure,#e5e7eb)}' +
      '.apx-tabs{display:flex;gap:6px}.apx-tabs button{border:0;border-radius:999px;padding:7px 14px;background:rgba(127,127,127,.14);color:inherit;font:inherit;font-size:.82rem;cursor:pointer}' +
      '.apx-tabs button.on{background:var(--encre,#111827);color:var(--fond,#fff)}' +
      '.apx-list{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:10px;display:flex;flex-direction:column;gap:10px;align-items:center}' +
      '.apx-list[hidden]{display:none}' +
      '.apx-th{display:flex;flex-direction:column;align-items:center;gap:4px;border:2px solid transparent;border-radius:8px;background:none;padding:4px;color:inherit;cursor:pointer;width:100%}' +
      '.apx-th canvas{background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25);max-width:100%}.apx-th span{font-size:.72rem;opacity:.75}' +
      '.apx-th.on{border-color:#2563eb}' +
      '#apxOutline{align-items:stretch;gap:2px}.apx-ol{border:0;background:none;color:inherit;font:inherit;font-size:.86rem;text-align:left;padding:9px 10px;border-radius:8px;cursor:pointer}.apx-ol:hover{background:rgba(127,127,127,.14)}' +
      '.apx-empty{font-size:.85rem;opacity:.7;text-align:center;padding:18px 8px}';
    document.head.appendChild(s);
  }
  function mb(id, icon, label) { return '<button type="button" class="apx-mb" id="' + id + '">' + icon + '<span>' + label + '</span></button>'; }
  function injecterMenu() {
    var panel = $('pdfViewerMenuPanel'); if (!panel || $('apxMenu')) return;
    var box = document.createElement('div'); box.id = 'apxMenu'; box.className = 'apx-menu';
    box.innerHTML = mb('apxBtnSearch', ICONS.search, 'Rechercher dans le texte') + mb('apxBtnPages', ICONS.pages, 'Miniatures et plan') +
      mb('apxBtnRotate', ICONS.rotate, 'Pivoter les pages') + mb('apxBtnFitPage', ICONS.fitpage, 'Ajuster à la page entière') + mb('apxBtnFitWidth', ICONS.fitwidth, 'Ajuster à la largeur');
    panel.appendChild(box);
    function lier(id, fn) { $(id).addEventListener('click', function (e) { e.stopPropagation(); fermerMenuLecteurPDF(); fn(); }); }
    lier('apxBtnSearch', ouvrirRecherche); lier('apxBtnPages', function () { ouvrirPanneau('thumbs'); });
    lier('apxBtnRotate', pivoter); lier('apxBtnFitPage', zoomPage); lier('apxBtnFitWidth', zoomLargeur);
  }
  function construireUI() {
    var ov = $('pdfViewerOverlay'); if (!ov || $('apxSearch')) return;
    var bar = document.createElement('div'); bar.id = 'apxSearch'; bar.className = 'apx-search'; bar.setAttribute('role', 'search'); bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<input id="apxQ" type="search" placeholder="Rechercher dans le document" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Rechercher dans le document">' +
      '<span class="apx-count" id="apxCount" aria-live="polite"></span>' +
      '<button type="button" class="apx-ib" id="apxPrev" aria-label="Résultat précédent">▲</button>' +
      '<button type="button" class="apx-ib" id="apxNext" aria-label="Résultat suivant">▼</button>' +
      '<button type="button" class="apx-ib" id="apxClose" aria-label="Fermer la recherche">✕</button>';
    ov.appendChild(bar);
    var back = document.createElement('div'); back.id = 'apxSideBack'; back.className = 'apx-side-back'; ov.appendChild(back);
    var sd = document.createElement('aside'); sd.id = 'apxSide'; sd.className = 'apx-side'; sd.setAttribute('aria-hidden', 'true');
    sd.innerHTML = '<div class="apx-side-head"><div class="apx-tabs"><button type="button" id="apxTabThumbs" class="on">Pages</button><button type="button" id="apxTabOutline">Plan</button></div>' +
      '<button type="button" class="apx-ib" id="apxSideClose" aria-label="Fermer">✕</button></div><div class="apx-list" id="apxThumbs"></div><div class="apx-list" id="apxOutline" hidden></div>';
    ov.appendChild(sd);
    var inp = $('apxQ'), deb = null;
    inp.addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(function () { chercher(inp.value); }, 300); });
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();                     // le lecteur ne doit pas tourner les pages / se fermer pendant la saisie
      if (e.key === 'Enter') { e.preventDefault(); if (S.qn !== nz(inp.value.trim().replace(/\s+/g, ' ')).text) { clearTimeout(deb); chercher(inp.value); } else aller(S.idx + (e.shiftKey ? -1 : 1)); }
      else if (e.key === 'Escape') { e.preventDefault(); fermerRecherche(); }
    });
    $('apxNext').addEventListener('click', function () { aller(S.idx + 1); });
    $('apxPrev').addEventListener('click', function () { aller(S.idx - 1); });
    $('apxClose').addEventListener('click', fermerRecherche);
    $('apxSideClose').addEventListener('click', fermerPanneau); back.addEventListener('click', fermerPanneau);
    $('apxTabThumbs').addEventListener('click', function () { choisirOnglet('thumbs'); });
    $('apxTabOutline').addEventListener('click', function () { choisirOnglet('outline'); });
  }

  /* ---------- cycle de vie ---------- */
  function reinitialiserEtat(pdf) {
    S.token++; S.pdf = pdf || null; S.pages = []; S.norm = []; S.indexed = 0; S.building = false; S.buildProm = null;
    S.matches = []; S.idx = -1; S.curN = 0; S.curK = -1; S.q = ''; S.qn = ''; S.qid++;
    side.thumbsFor = null; side.outlineFor = null; side.lastPage = 0;
    var inp = $('apxQ'); if (inp) inp.value = '';
    fermerRecherche(); fermerPanneau();
    if (thumbIO) { thumbIO.disconnect(); thumbIO = null; }
    var th = $('apxThumbs'); if (th) th.textContent = '';
    var tabO = $('apxTabOutline'); if (tabO) tabO.style.display = '';
  }
  function apresConstruction() {
    var pdf = PDF_EN_COURS; if (!pdf) return;
    construireUI(); injecterMenu();
    if (S.pdf !== pdf) { reinitialiserEtat(pdf); chargerPlan(); }
    lastDpr = dprEff(); relayout(); planifierRendus(80);
  }

  function init() {
    if (typeof PDF_EN_COURS === 'undefined' || typeof window.rendreUnePagePDF !== 'function' || typeof window.appliquerZoom !== 'function' ||
        typeof window.rendrePagePDF !== 'function' || typeof window.fermerLecteurPDF !== 'function') return false;
    if (!Object.getOwnPropertyDescriptor(window, 'rendreUnePagePDF')) { console.warn('[Lecteur PDF+] le lecteur n’est pas un script global : module inactif.'); return true; }
    css(); construireUI(); injecterMenu();
    window.rendreUnePagePDF = rendrePlus;
    window.appliquerZoom = zoomPlus;
    window.neutraliserZoomGlobalPourLecteurPDF = neutraliser;
    window.restaurerZoomGlobalApresLecteurPDF = restaurer;
    var oR = window.rendrePagePDF;
    window.rendrePagePDF = async function () { var r = await oR.apply(this, arguments); apresConstruction(); return r; };
    var oF = window.fermerLecteurPDF;
    window.fermerLecteurPDF = function () {
      try { reinitialiserEtat(null); clearTimeout(rendTimer); clearTimeout(refitTimer); } catch (e) {}
      return oF.apply(this, arguments);
    };
    window.addEventListener('resize', planifierRefit);
    window.addEventListener('orientationchange', planifierRefit);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', planifierRefit);
    var zone = $('pdfViewerZone');
    if (zone && typeof ResizeObserver !== 'undefined') new ResizeObserver(planifierRefit).observe(zone);
    // Si un autre script modifie le zoom du site pendant la lecture : on retient la valeur à restaurer à la fermeture.
    new MutationObserver(function () {
      if (!ouvert()) return;
      var z = document.documentElement.style.zoom;
      if (z && z !== '1') { PDF_ZOOM_SITE_SAUVEGARDE = z; document.documentElement.style.zoom = '1'; planifierRefit(); }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    document.addEventListener('keydown', function (e) {
      if (!ouvert()) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); ouvrirRecherche(); return; }
      if (e.key === 'Escape') {
        var bar = $('apxSearch');
        if (bar && bar.classList.contains('open')) { e.preventDefault(); e.stopPropagation(); fermerRecherche(); }
        else if (side.open) { e.preventDefault(); e.stopPropagation(); fermerPanneau(); }
      }
    }, true);
    // Documents en lecture seule : aucune copie du texte.
    document.addEventListener('copy', function (e) { if (ouvert() && lectureSeule()) e.preventDefault(); }, true);
    document.addEventListener('cut', function (e) { if (ouvert() && lectureSeule()) e.preventDefault(); }, true);
    if (ouvert()) apresConstruction();
    return true;
  }

  var essais = 0;
  (function attendre() {
    var ok = false; try { ok = init(); } catch (e) { console.warn('[Lecteur PDF+] init', e); ok = true; }
    if (!ok && ++essais < 160) setTimeout(attendre, 150);
    else if (!ok) console.warn('[Lecteur PDF+] lecteur introuvable : module inactif.');
  })();
})();
