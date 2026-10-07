/* Aurore — Édition assistée : modèle de blocs indépendant + projection content_json */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const state = {
    course: null,
    page: 1,
    selected: null,
    drag: null,
    resize: null,
    modalPreview: false,
    loaded: false
  };

  const W = 794, H = 1123;
  const printable = { left: 83, right: 83, top: 97, bottom: 89 };

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function esc(v) {
    return String(v ?? '').replace(/[&<>"]/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[m]));
  }
  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

  function newCourse() {
    return {
      version: 2,
      id: uid('course'),
      title: 'Nouveau cours',
      status: 'draft',
      metadata: {
        editor: 'edition_assistee',
        schema: 'aurore-assisted-course-v2',
        source: 'manual_admin'
      },
      pages: [
        { id: uid('page'), role: 'cover', title: 'Couverture', locked: true, blocks: [] },
        { id: uid('page'), role: 'content', title: 'Page 1', locked: false, blocks: [] },
        { id: uid('page'), role: 'final', title: 'Mentions · crédits · vérification', locked: true, blocks: [] }
      ],
      validation: { ok: false, errors: [], warnings: [] },
      content_json: null,
      updated_at: null
    };
  }

  function currentPage() { return state.course.pages[state.page]; }
  function allBlocks() {
    return state.course.pages.reduce((a, p) => a.concat(Array.isArray(p.blocks) ? p.blocks : []), []);
  }
  function blockById(id) { return allBlocks().find(b => b.id === id) || null; }

  function defaultBlock(type) {
    const base = {
      id: uid('block'),
      type,
      layout: { page: state.page, x: printable.left + 10, y: printable.top + 62, width: 500, height: type === 'graphique' ? 170 : 86, zIndex: 1, locked: false },
      validation: { ok: false, errors: [], warnings: [] },
      content: {}
    };
    if (type === 'paragraph') base.content = { text: 'Nouveau paragraphe.' };
    if (type === 'point') base.content = { title: 'Point de cours', text: 'Présentez ici une notion, une définition, une propriété ou une idée essentielle.' };
    if (type === 'exercise') base.content = { title: 'Exercice', statement: 'Énoncé de l’exercice.', hint: '' };
    if (type === 'graphique') base.content = { json: { id: uid('graph'), instrument: 'function2d', expression: 'x^2' } };
    if (type === 'wikimedia-image') base.content = { imageUrl: '', thumbUrl: '', title: '', sourceUrl: '', author: '', license: '', query: '' };
    return base;
  }

  function canonicalGraph(raw) {
    const g = typeof raw === 'object' && raw ? deepClone(raw) : {};
    if (!g.id) g.id = uid('graph');
    if (!g.instrument && !g.graph_type) g.instrument = 'function2d';
    return g;
  }

  function projection() {
    const c = state.course;
    const content = {
      title: String(c.title || 'Cours').trim(),
      document_type: 'cours',
      subject: String(c.metadata?.subject || '').trim(),
      level: String(c.metadata?.level || '').trim(),
      class_name: String(c.metadata?.class_name || '').trim(),
      author: String(c.metadata?.author || '').trim(),
      metadata: {
        ...(c.metadata || {}),
        origin: 'assisted_editor',
        assisted_course_id: c.id,
        layout_schema: 'aurore-assisted-course-layout-v2'
      },
      sections: []
    };

    c.pages.filter(p => p.role === 'content').forEach((p, pageIndex) => {
      const sec = { title: String(p.title || ('Page ' + (pageIndex + 1))).trim() || ('Page ' + (pageIndex + 1)), content: [], graphs: [], visuals: [], exercises: [] };
      (p.blocks || []).slice().sort((a,b) => (Number(a.layout?.zIndex)||0) - (Number(b.layout?.zIndex)||0)).forEach(b => {
        const t = b.type;
        if (t === 'paragraph') {
          if (String(b.content?.text || '').trim()) sec.content.push(String(b.content.text).trim());
        } else if (t === 'point') {
          const label = String(b.content?.title || '').trim();
          const text = String(b.content?.text || '').trim();
          if (label && text) sec.content.push(label + ': ' + text);
          else if (text) sec.content.push(text);
        } else if (t === 'exercise') {
          sec.exercises.push({
            id: b.id,
            title: String(b.content?.title || '').trim(),
            statement: String(b.content?.statement || '').trim(),
            hint: String(b.content?.hint || '').trim()
          });
        } else if (t === 'graphique') {
          sec.graphs.push(canonicalGraph(b.content?.json || {}));
        } else if (t === 'wikimedia-image') {
          if (String(b.content?.imageUrl || '').trim()) {
            sec.visuals.push({
              type: 'wikimedia',
              id: b.id,
              query: String(b.content?.query || b.content?.title || sec.title).trim(),
              caption: String(b.content?.caption || b.content?.title || '').trim(),
              purpose: 'illustration',
              priority: 'required',
              required: true,
              selected_image_url: String(b.content.imageUrl).trim(),
              source_url: String(b.content.sourceUrl || '').trim(),
              author: String(b.content.author || '').trim(),
              license: String(b.content.license || '').trim()
            });
          }
        }
      });
      if (!sec.content.length) delete sec.content;
      if (!sec.graphs.length) delete sec.graphs;
      if (!sec.visuals.length) delete sec.visuals;
      if (!sec.exercises.length) delete sec.exercises;
      content.sections.push(sec);
    });

    return content;
  }

  function validateBlock(b) {
    const errors = [], warnings = [];
    const l = b.layout || {};
    if (!Number.isFinite(Number(l.x)) || !Number.isFinite(Number(l.y))) errors.push('Position invalide.');
    if (!Number.isFinite(Number(l.width)) || Number(l.width) < 55) errors.push('Largeur minimale non respectée.');
    if (!Number.isFinite(Number(l.height)) || Number(l.height) < 30) errors.push('Hauteur minimale non respectée.');
    if (Number(l.x) < printable.left || Number(l.y) < printable.top) warnings.push('Le bloc dépasse la zone imprimable en haut/à gauche.');
    if (Number(l.x) + Number(l.width) > W - printable.right) warnings.push('Le bloc dépasse la zone imprimable à droite.');
    if (Number(l.y) + Number(l.height) > H - printable.bottom) warnings.push('Le bloc dépasse la zone imprimable en bas.');

    if (b.type === 'paragraph' && !String(b.content?.text || '').trim()) errors.push('Paragraphe vide.');
    if (b.type === 'point' && !String(b.content?.text || '').trim()) errors.push('Point de cours vide.');
    if (b.type === 'exercise' && !String(b.content?.statement || '').trim()) errors.push('Énoncé vide.');
    if (b.type === 'graphique') {
      if (!b.content?.json || typeof b.content.json !== 'object' || Array.isArray(b.content.json)) errors.push('Le JSON du graphique doit être un objet.');
      else {
        const g = b.content.json;
        if (!g.id) errors.push('Le graphique doit posséder un id.');
        if (!g.instrument && !g.graph_type) errors.push('Le graphique doit déclarer instrument ou graph_type.');
        if (!g.expression && !g.points && !g.objects && !(g.x_expression && g.y_expression)) warnings.push('JSON valide mais construction GeoGebra incomplète.');
      }
    }
    if (b.type === 'wikimedia-image') {
      if (!String(b.content?.imageUrl || '').startsWith('https://upload.wikimedia.org/')) errors.push('Image Wikimedia non sélectionnée ou URL non autorisée.');
      if (!String(b.content?.sourceUrl || '').trim()) errors.push('Source Wikimedia absente.');
      if (!String(b.content?.license || '').trim()) errors.push('Licence Wikimedia absente.');
    }
    b.validation = { ok: errors.length === 0, errors, warnings };
    return b.validation;
  }

  function validateCourse() {
    const errors = [], warnings = [];
    if (!String(state.course.title || '').trim()) errors.push('Le titre du cours est obligatoire.');
    const editPages = state.course.pages.filter(p => p.role === 'content');
    if (!editPages.length) errors.push('Le cours doit avoir au moins une page de contenu.');
    editPages.forEach(p => (p.blocks || []).forEach(validateBlock));

    const validBlocks = allBlocks().filter(b => b.type !== 'wikimedia-image' || b.content?.imageUrl);
    const missingIds = new Set();
    validBlocks.forEach(b => {
      const id = b.type === 'graphique' ? b.content?.json?.id : null;
      if (id) {
        if (missingIds.has(id)) errors.push('ID de graphique dupliqué : ' + id);
        missingIds.add(id);
      }
    });

    editPages.forEach((p, idx) => {
      const bs = (p.blocks || []).filter(b => b.validation?.ok);
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        if (overlap(bs[i], bs[j])) warnings.push('Chevauchement entre ' + bs[i].id + ' et ' + bs[j].id + ' sur ' + p.title + '.');
      }
    });

    state.course.validation = { ok: errors.length === 0, errors, warnings };
    state.course.content_json = projection();
    return state.course.validation;
  }

  function overlap(a,b) {
    const ax=Number(a.layout.x), ay=Number(a.layout.y), aw=Number(a.layout.width), ah=Number(a.layout.height);
    const bx=Number(b.layout.x), by=Number(b.layout.y), bw=Number(b.layout.width), bh=Number(b.layout.height);
    return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
  }

  function statusText(t) {
    const e = document.getElementById('assistedStatus');
    if (e) e.textContent = t;
  }

  function previewBlock(b) {
    let inner = '';
    if (b.type === 'wikimedia-image') {
      inner = b.content?.imageUrl
        ? '<div class="ae-image-frame"><img src="' + esc(b.content.imageUrl) + '" alt="' + esc(b.content.title || 'Image Wikimedia') + '"></div>'
        : '<div class="ae-image-empty">Image Wikimedia à sélectionner.</div>';
    } else if (b.type === 'graphique') {
      inner = '<div class="ae-graph-frame"><div class="ae-graph-label">Graphique GeoGebra · JSON</div><pre>' + esc(JSON.stringify(b.content?.json || {}, null, 2)) + '</pre></div>';
    } else if (b.type === 'exercise') {
      inner = '<div class="ae-exercise-box"><span class="ae-pill">' + esc(b.content?.title || 'Exercice') + '</span><div>' + esc(b.content?.statement || '') + '</div>' + (b.content?.hint ? '<small><b>Indication :</b> ' + esc(b.content.hint) + '</small>' : '') + '</div>';
    } else if (b.type === 'point') {
      inner = '<div class="ae-label-box"><span class="ae-pill">' + esc(b.content?.title || 'Point de cours') + '</span><div>' + esc(b.content?.text || '') + '</div></div>';
    } else {
      inner = '<div class="ae-paragraph-box">' + esc(b.content?.text || '') + '</div>';
    }
    return '<div class="assisted-block ' + (b.id === state.selected ? 'is-selected' : '') + '" data-id="' + esc(b.id) + '" style="left:' + Number(b.layout.x) + 'px;top:' + Number(b.layout.y) + 'px;width:' + Number(b.layout.width) + 'px;height:' + Number(b.layout.height) + 'px;z-index:' + Number(b.layout.zIndex || 1) + ';">' +
      '<div class="ae-block-content">' + inner + '</div><button type="button" class="assisted-resize" data-rid="' + esc(b.id) + '" aria-label="Redimensionner"></button></div>';
  }

  function renderPage() {
    const p = currentPage();
    const blocks = Array.isArray(p.blocks) ? p.blocks : [];
    if (p.role === 'cover') {
      return '<div class="ae-cover-preview"><div class="ae-title-block"><div class="ae-brand">AURORE · SECTION ARCHIVES</div><div class="ae-title-panel"><div class="ae-doc-type">Document pédagogique</div><div class="ae-doc-title">' + esc(state.course.title) + '</div><div class="ae-doc-meta">Aurore — Section Archives' + (state.course.metadata?.subject ? ' · ' + esc(state.course.metadata.subject) : '') + '</div></div><div class="ae-logo-card"><img src="icon-192-1.png" alt="Aurore"></div></div><div class="ae-cover-foot">Document pédagogique édité avec Aurora · identité visuelle Aurore</div></div>';
    }
    if (p.role === 'final') {
      return '<div class="ae-final-preview"><span class="ae-pill">Mentions · crédits · vérification</span><h2>Édition Aurore</h2><div class="ae-final-title">' + esc(state.course.title) + '</div><div class="ae-final-card"><b>IDENTITÉ DE L’ÉDITION</b><div>Éditeur : Aurore · version 1</div><div>' + esc([state.course.metadata?.subject, state.course.metadata?.level, state.course.metadata?.class_name].filter(Boolean).join(' · ') || 'Document pédagogique Aurore') + '</div></div><div class="ae-final-card"><b>VÉRIFICATION & PUBLICATION</b><div>La vérification de l’édition finale sera effectuée par le circuit Aurore avant publication.</div></div><div class="ae-final-card"><b>DROITS & RÉUTILISATION</b><div>Les ressources tierces conservent leurs propres licences et conditions d’utilisation.</div></div></div>';
    }
    return '<div class="ae-content-page"><div class="ae-bg-bubble bubble-a"></div><div class="ae-bg-bubble bubble-b"></div><div class="ae-page-header"><img src="icon-192-1.png" alt=""><span>Section Archives</span></div><div class="ae-page-rule"></div><div class="ae-spine"></div><div class="ae-content-title">' + esc(p.title) + '</div><div class="ae-block-layer">' + (blocks.length ? blocks.slice().sort((a,b)=>(Number(a.layout?.zIndex)||0)-(Number(b.layout?.zIndex)||0)).map(previewBlock).join('') : '<div class="assisted-empty">Ajoutez un bloc pour construire cette page.</div>') + '</div><div class="ae-page-footer">Aurore — Section Archives <span>•</span> ' + (state.page + 1) + '</div></div>';
  }

  function render() {
    const root = document.getElementById('assistedRoot');
    if (!root || !state.course) return;
    validateCourse();
    const p = currentPage();
    root.innerHTML =
      '<div class="assisted-editor">' +
        '<header class="assisted-head"><div><span class="assisted-kicker">Administration · Édition assistée</span><h3>Construire le cours par blocs</h3><p>Le contenu et la mise en page sont séparés. La couverture et la page finale restent protégées par le modèle Aurore.</p></div><span class="assisted-status" id="assistedStatus">' + (state.course.validation.ok ? 'Cours validable' : 'Brouillon à compléter') + '</span></header>' +
        '<div class="assisted-toolbar">' +
          '<button class="admin-btn primary" id="aeNew">＋ Créer un cours</button>' +
          '<button class="admin-btn ghost" id="aeP">＋ Paragraphe</button><button class="admin-btn ghost" id="aeC">＋ Point de cours</button><button class="admin-btn ghost" id="aeE">＋ Exercice</button><button class="admin-btn ghost" id="aeG">＋ Graphique JSON</button><button class="admin-btn ghost" id="aeW">＋ Image Wikimedia</button><button class="admin-btn ghost" id="aePage">＋ Page</button>' +
          '<button class="admin-btn ghost" id="aeValidate">Valider le cours</button><button class="admin-btn ghost" id="aeSave">Enregistrer</button><button class="admin-btn ghost" id="aeExport">Exporter content_json</button><button class="admin-btn ghost" id="aePreview">Prévisualiser</button>' +
        '</div>' +
        '<div class="assisted-layout">' +
          '<aside class="assisted-sidebar"><div class="ae-course-fields"><label>Titre<input id="aeTitle" value="' + esc(state.course.title) + '"></label><label>Matière<input id="aeSubject" value="' + esc(state.course.metadata?.subject || '') + '"></label><label>Niveau<input id="aeLevel" value="' + esc(state.course.metadata?.level || '') + '"></label><label>Classe<input id="aeClass" value="' + esc(state.course.metadata?.class_name || '') + '"></label><label>Auteur<input id="aeAuthor" value="' + esc(state.course.metadata?.author || '') + '"></label></div><div class="ae-course-list-title">Pages</div><div class="assisted-pages">' +
            state.course.pages.map((pg,i)=>'<button class="assisted-page-item ' + (i === state.page ? 'is-active' : '') + '" data-page="' + i + '" type="button"><span><strong>' + esc(pg.title) + '</strong><small>' + (pg.blocks || []).length + ' bloc(s) · ' + (pg.role === 'content' ? 'éditable' : 'protégée') + '</small></span><span>' + (pg.role === 'content' ? '✎' : '🔒') + '</span></button>').join('') +
          '</div></aside>' +
          '<main class="assisted-main"><div class="assisted-pagebar"><div><input id="aePageTitle" value="' + esc(p.title) + '"><small>' + (p.role === 'content' ? 'Page éditable' : 'Modèle protégé') + '</small></div><div class="ae-validation">' + (state.course.validation.ok ? '✓ structure valide' : '⚠ à compléter') + '</div></div>' +
            '<div class="assisted-canvas-wrap"><div class="assisted-canvas" id="assistedCanvas">' + renderPage() + '</div></div><div id="assistedInspector"></div>' +
          '</main></div></div><div class="assisted-modal" id="assistedModal" hidden></div>';

    bind();
    inspector();
  }

  function add(type) {
    const p = currentPage();
    if (!p || p.role !== 'content' || p.locked) { statusText('Page protégée.'); return; }
    const b = defaultBlock(type);
    b.layout.zIndex = (p.blocks || []).reduce((m,x) => Math.max(m, Number(x.layout?.zIndex)||0), 0) + 1;
    p.blocks.push(b);
    state.selected = b.id;
    render();
    statusText('Bloc ajouté.');
  }

  function inspector() {
    const h = document.getElementById('assistedInspector');
    const b = blockById(state.selected);
    if (!h) return;
    if (!b) { h.innerHTML = '<div class="assisted-inspector"><strong>Inspecteur</strong><span>Sélectionnez un bloc pour modifier son contenu et sa géométrie.</span></div>'; return; }
    const payload = b.type === 'graphique' ? (b.content?.json || {}) : (b.content || {});
    h.innerHTML =
      '<div class="assisted-inspector"><div class="ae-inspector-head"><strong>Bloc · ' + esc(b.type) + '</strong><span class="' + (b.validation?.ok ? 'ok' : 'bad') + '">' + (b.validation?.ok ? '✓ valide' : '⚠ à corriger') + '</span></div>' +
      '<div class="assisted-inspector-grid"><label>X<input data-k="x" type="number" value="' + Number(b.layout.x) + '"></label><label>Y<input data-k="y" type="number" value="' + Number(b.layout.y) + '"></label><label>Largeur<input data-k="width" type="number" value="' + Number(b.layout.width) + '"></label><label>Hauteur<input data-k="height" type="number" value="' + Number(b.layout.height) + '"></label></div>' +
      '<label class="ae-json-label">JSON / contenu<textarea id="aeJson" class="assisted-json">' + esc(JSON.stringify(payload, null, 2)) + '</textarea></label>' +
      '<div class="assisted-actions"><button class="admin-btn primary" id="aeApply">Appliquer</button><button class="admin-btn ghost" id="aeCopy">Copier le JSON</button><button class="admin-btn ghost" id="aeDuplicate">Dupliquer</button><button class="admin-btn ghost" id="aeLock">' + (b.layout.locked ? 'Déverrouiller' : 'Verrouiller') + '</button><button class="admin-btn danger" id="aeDelete">Supprimer</button></div>' +
      (b.validation?.errors?.length ? '<div class="ae-errors">' + b.validation.errors.map(x => '• ' + esc(x)).join('<br>') + '</div>' : '');

    h.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', () => {
      if (b.layout.locked) return;
      const k = inp.dataset.k;
      b.layout[k] = Math.max(k === 'width' || k === 'height' ? 30 : 0, Number(inp.value) || 0);
      validateCourse(); drawCanvasOnly(); inspector();
    }));

    document.getElementById('aeApply')?.addEventListener('click', () => {
      try {
        const v = JSON.parse(document.getElementById('aeJson').value);
        b.content = b.type === 'graphique' ? { json: canonicalGraph(v) } : v;
        validateCourse(); render(); statusText('Contenu appliqué.');
      } catch (_) { statusText('JSON invalide.'); }
    });
    document.getElementById('aeCopy')?.addEventListener('click', () => navigator.clipboard?.writeText(JSON.stringify(payload, null, 2)));
    document.getElementById('aeDuplicate')?.addEventListener('click', () => {
      const copy = deepClone(b); copy.id = uid('block'); copy.layout.x += 18; copy.layout.y += 18; copy.layout.zIndex += 1; copy.layout.locked = false; if (copy.type === 'graphique') copy.content.json.id = uid('graph'); currentPage().blocks.push(copy); state.selected = copy.id; render();
    });
    document.getElementById('aeLock')?.addEventListener('click', () => { b.layout.locked = !b.layout.locked; render(); });
    document.getElementById('aeDelete')?.addEventListener('click', () => { currentPage().blocks = currentPage().blocks.filter(x => x.id !== b.id); state.selected = null; render(); });
  }

  function drawCanvasOnly() {
    const c = document.getElementById('assistedCanvas');
    if (!c) return;
    c.querySelectorAll('.assisted-block').forEach(el => {
      const b = blockById(el.dataset.id);
      if (!b) return;
      el.style.left = Number(b.layout.x) + 'px'; el.style.top = Number(b.layout.y) + 'px'; el.style.width = Number(b.layout.width) + 'px'; el.style.height = Number(b.layout.height) + 'px';
      el.classList.toggle('is-selected', b.id === state.selected);
    });
  }

  function pointerDown(e) {
    if (e.target.closest('.assisted-resize')) return;
    const el = e.currentTarget, b = blockById(el.dataset.id);
    if (!b || currentPage().role !== 'content' || b.layout.locked) return;
    state.selected = b.id;
    state.drag = { id:b.id, sx:e.clientX, sy:e.clientY, x:Number(b.layout.x), y:Number(b.layout.y) };
    el.setPointerCapture?.(e.pointerId);
    drawCanvasOnly(); inspector();
  }
  function resizeDown(e) {
    e.stopPropagation();
    const b = blockById(e.currentTarget.dataset.rid);
    if (!b || currentPage().role !== 'content' || b.layout.locked) return;
    state.selected = b.id;
    state.resize = { id:b.id, sx:e.clientX, sy:e.clientY, w:Number(b.layout.width), h:Number(b.layout.height) };
  }

  document.addEventListener('pointermove', e => {
    if (state.drag) {
      const b = blockById(state.drag.id); if (!b) return;
      b.layout.x = Math.max(0, Math.min(W - Number(b.layout.width), state.drag.x + (e.clientX - state.drag.sx)));
      b.layout.y = Math.max(0, Math.min(H - Number(b.layout.height), state.drag.y + (e.clientY - state.drag.sy)));
      drawCanvasOnly();
    } else if (state.resize) {
      const b = blockById(state.resize.id); if (!b) return;
      b.layout.width = Math.max(55, Math.min(W - Number(b.layout.x), state.resize.w + (e.clientX - state.resize.sx)));
      b.layout.height = Math.max(30, Math.min(H - Number(b.layout.y), state.resize.h + (e.clientY - state.resize.sy)));
      drawCanvasOnly();
    }
  });
  document.addEventListener('pointerup', () => {
    if (state.drag || state.resize) { validateCourse(); inspector(); }
    state.drag = null; state.resize = null;
  });

  function openPreview() {
    const modal = document.getElementById('assistedModal');
    if (!modal) return;
    state.modalPreview = true;
    modal.hidden = false;
    modal.innerHTML = '<div class="assisted-modal-card ae-preview-modal"><div class="assisted-modal-head"><div><h4>Prévisualisation Aurore</h4><small>Habillage calé sur le moteur LuaLaTeX courant</small></div><button class="admin-btn ghost" id="aePreviewClose">Fermer</button></div><div class="ae-preview-stack">' +
      state.course.pages.map((_,i) => {
        const old = state.page; state.page = i; const html = renderPage(); state.page = old;
        return '<section class="ae-preview-sheet">' + html + '</section>';
      }).join('') + '</div></div>';
    document.getElementById('aePreviewClose').onclick = () => { state.modalPreview=false; modal.hidden=true; };
  }

  async function save() {
    validateCourse();
    state.course.updated_at = new Date().toISOString();
    state.course.status = state.course.validation.ok ? 'validated' : 'editing';
    try {
      if (window.supabase?.createClient) {
        const client = window.__auroreAssistedSb || (window.__auroreAssistedSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
        const { data: { user } = {} } = await client.auth.getUser();
        if (!user) throw new Error('Session administrateur absente.');
        const r = await client.from('aurora_assisted_courses').upsert({
          id: state.course.id,
          created_by: user.id,
          title: state.course.title,
          status: state.course.status === 'validated' ? 'validated' : 'editing',
          course_json: state.course
        }, { onConflict: 'id' });
        if (r.error) throw r.error;
        statusText(state.course.validation.ok ? 'Cours validé et enregistré.' : 'Cours enregistré · à compléter.');
        return;
      }
      throw new Error('Supabase indisponible.');
    } catch (e) {
      localStorage.setItem('aurore_assisted_course', JSON.stringify(state.course));
      statusText('Supabase indisponible · brouillon local conservé.');
    }
  }

  function exportContentJson() {
    validateCourse();
    const blob = new Blob([JSON.stringify(state.course.content_json, null, 2)], { type:'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'aurore-content_json-' + (state.course.id || 'cours') + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  async function wiki() {
    const modal = document.getElementById('assistedModal');
    if (!modal) return;
    modal.hidden = false;
    modal.innerHTML = '<div class="assisted-modal-card"><div class="assisted-modal-head"><div><h4>Rechercher une image Wikimedia</h4><small>Sélectionnez une image libre ; elle restera référencée dans le bloc.</small></div><button class="admin-btn ghost" id="aeWikiClose">Fermer</button></div><div class="assisted-wiki-search"><input id="aeWikiQ" placeholder="Ex. cellule animale, volcan, Newton…"><button class="admin-btn primary" id="aeWikiGo">Rechercher</button></div><div class="assisted-wiki-results" id="aeWikiResults"></div></div>';
    document.getElementById('aeWikiClose').onclick = () => modal.hidden = true;
    document.getElementById('aeWikiGo').onclick = searchWiki;
    document.getElementById('aeWikiQ').addEventListener('keydown', e => { if (e.key === 'Enter') searchWiki(); });
  }

  async function searchWiki() {
    const q = document.getElementById('aeWikiQ')?.value.trim();
    const out = document.getElementById('aeWikiResults');
    if (!q || !out) return;
    out.innerHTML = 'Recherche…';
    try {
      const u = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=' + encodeURIComponent(q) + '&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=520&format=json&origin=*';
      const r = await fetch(u);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const pages = Object.values(d?.query?.pages || {});
      const usable = pages.filter(p => {
        const i = p?.imageinfo?.[0] || {}, m = i.extmetadata || {};
        const license = String(m?.LicenseShortName?.value || m?.UsageTerms?.value || '').toLowerCase();
        return (i.thumburl || i.url || '').startsWith('https://upload.wikimedia.org/') &&
          ['image/jpeg','image/png'].includes(String(i.mime || '').toLowerCase()) &&
          !/fair use|non-commercial|no derivatives/.test(license);
      });
      out.innerHTML = usable.map(p => {
        const i=p.imageinfo?.[0]||{}, m=i.extmetadata||{}, title=String(p.title||'').replace(/^File:/,'');
        const data={imageUrl:i.url || i.thumburl, thumbUrl:i.thumburl || i.url, title, caption:String(m?.ImageDescription?.value||title).replace(/<[^>]+>/g,''), sourceUrl:i.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title)), author:String(m?.Artist?.value||'').replace(/<[^>]+>/g,''), license:String(m?.LicenseShortName?.value||m?.UsageTerms?.value||'').replace(/<[^>]+>/g,''), query:q};
        return '<article class="assisted-wiki-card"><img src="' + esc(data.thumbUrl) + '" alt=""><div><strong>' + esc(data.title) + '</strong><small>' + esc(data.author || 'Auteur non renseigné') + '</small><small>Licence : ' + esc(data.license || 'À vérifier') + '</small></div><button class="admin-btn primary" data-wiki="' + esc(JSON.stringify(data)) + '">Choisir</button></article>';
      }).join('') || 'Aucune image exploitable trouvée.';
      out.querySelectorAll('[data-wiki]').forEach(btn => btn.onclick = () => {
        const data = JSON.parse(btn.dataset.wiki);
        if (currentPage().role !== 'content') return;
        const b=defaultBlock('wikimedia-image'); b.content=data; b.layout.width=500; b.layout.height=230; b.layout.zIndex=(currentPage().blocks||[]).length+1;
        currentPage().blocks.push(b); state.selected=b.id; modal.hidden=true; render(); statusText('Image Wikimedia sélectionnée.');
      });
    } catch (_) { out.textContent='Recherche Wikimedia indisponible.'; }
  }

  async function loadCourses() {
    try {
      if (!window.supabase?.createClient) return;
      const client = window.__auroreAssistedSb || (window.__auroreAssistedSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
      const { data, error } = await client.from('aurora_assisted_courses').select('id,title,status,course_json,updated_at').order('updated_at', { ascending:false }).limit(12);
      if (error) throw error;
      state.loaded = true;
      return Array.isArray(data) ? data : [];
    } catch (_) {
      return [];
    }
  }

  function bind() {
    document.querySelectorAll('[data-page]').forEach(x => x.onclick = () => { state.page = Number(x.dataset.page)||0; state.selected=null; render(); });
    document.getElementById('aeNew').onclick = () => { state.course=newCourse(); state.page=1; state.selected=null; render(); };
    document.getElementById('aeP').onclick = () => add('paragraph');
    document.getElementById('aeC').onclick = () => add('point');
    document.getElementById('aeE').onclick = () => add('exercise');
    document.getElementById('aeG').onclick = () => add('graphique');
    document.getElementById('aeW').onclick = wiki;
    document.getElementById('aePage').onclick = () => {
      const finalIndex=state.course.pages.findIndex(p=>p.role==='final');
      state.course.pages.splice(finalIndex < 0 ? state.course.pages.length : finalIndex, 0, { id:uid('page'), role:'content', title:'Page ' + (state.course.pages.filter(p=>p.role==='content').length+1), locked:false, blocks:[] });
      state.page=Math.max(0, finalIndex < 0 ? state.course.pages.length-1 : finalIndex);
      render();
    };
    document.getElementById('aeValidate').onclick = () => { const v=validateCourse(); statusText(v.ok ? 'Validation réussie.' : 'Validation bloquée · corriger les blocs indiqués.'); render(); };
    document.getElementById('aeSave').onclick = save;
    document.getElementById('aeExport').onclick = exportContentJson;
    document.getElementById('aePreview').onclick = openPreview;

    const bindField = (id, fn) => document.getElementById(id)?.addEventListener('change', fn);
    bindField('aeTitle', e => { state.course.title=e.target.value; render(); });
    bindField('aeSubject', e => { state.course.metadata.subject=e.target.value; validateCourse(); });
    bindField('aeLevel', e => { state.course.metadata.level=e.target.value; validateCourse(); });
    bindField('aeClass', e => { state.course.metadata.class_name=e.target.value; validateCourse(); });
    bindField('aeAuthor', e => { state.course.metadata.author=e.target.value; validateCourse(); });
    bindField('aePageTitle', e => { if(currentPage().role==='content'){ currentPage().title=e.target.value; render(); } });
    document.querySelectorAll('.assisted-block').forEach(el => el.addEventListener('pointerdown', pointerDown));
    document.querySelectorAll('.assisted-resize').forEach(el => el.addEventListener('pointerdown', resizeDown));
  }

  async function showLoader() {
    const courses = await loadCourses();
    const root = document.getElementById('assistedRoot');
    if (!root || !courses.length) return;
    const selectId = 'aeExistingCourse';
    const box = document.createElement('div');
    box.className='ae-existing-row';
    box.innerHTML='<label>Ouvrir un brouillon existant<select id="'+selectId+'"><option value="">Choisir…</option>'+courses.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.title)+' · '+esc(c.status)+'</option>').join('')+'</select></label>';
    root.prepend(box);
    box.querySelector('select').onchange=e=>{
      const row=courses.find(x=>x.id===e.target.value);
      if(row?.course_json){ state.course=row.course_json; state.page=Math.min(1, state.course.pages.length-1); state.selected=null; render(); }
    };
  }

  function init() {
    const root=document.getElementById('assistedRoot');
    if(!root) return;
    const card=document.querySelector('.admin-tab[data-tab="edition-assistee"]');
    const panel=document.querySelector('.admin-tab-panel[data-panel="edition-assistee"]');
    if(card && panel) card.addEventListener('click', () => {
      const detail=document.getElementById('adminDetail'); if(detail) detail.style.display='block';
      document.querySelectorAll('.admin-tab-panel').forEach(p=>p.style.display=p===panel?'block':'none');
      document.querySelectorAll('.admin-tab').forEach(b=>b.classList.toggle('active',b===card));
      state.course ||= newCourse();
      state.page=Math.min(state.page, state.course.pages.length-1);
      render(); showLoader();
    });
    state.course ||= newCourse();
    render();
  }

  window.AuroreAssistedEditor={init,render,save,getState:()=>state.course,toContentJson:projection,validate:validateCourse};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();