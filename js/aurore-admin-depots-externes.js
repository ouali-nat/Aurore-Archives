/* Aurore — Dépôts externes : bibliothèque interne + communauté.
 * Regroupe les entrées qui pointent vers le même fichier et expose les
 * emplacements distincts. Retirer un emplacement ne supprime jamais le PDF
 * du stockage : seules les lignes Document de cet emplacement sont retirées. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const TAB = 'depots-externes';
  const ID_COMPTEUR = 'tabCountDepotsExternes';
  const state = { groups: new Map(), status: 'all', query: '', loading: false, active: false };
  let carte = null;
  let enCours = false;

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const normalize = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const estAdmin = () => { try { return typeof session !== 'undefined' && !!session && session.role === 'admin'; } catch (_) { return false; } };
  const docId = d => String(d?.id ?? '');
  const isPublished = d => d?.Publie === true;

  function majCompteur(n) {
    const el = document.getElementById(ID_COMPTEUR);
    if (el) el.textContent = String(n);
  }

  function locationKey(d) {
    return [d?.Niveau, d?.Classe, d?.['Catégorie'], d?.['Matière'], d?.Genre, d?.Filiere]
      .map(v => normalize(v)).join('|');
  }
  function locationLabel(d) {
    const parts = [d?.Niveau, d?.Classe, d?.['Catégorie'], d?.['Matière'] || d?.Genre, d?.Filiere ? 'Filière ' + d.Filiere : ''].filter(v => String(v || '').trim());
    return parts.length ? parts.join(' · ') : 'Emplacement non renseigné';
  }
  function canonicalFileKey(d) {
    const raw = String(d?.Fichier_url || '').trim();
    if (!raw) return 'document:' + docId(d);
    try {
      const u = new URL(raw);
      return u.origin.toLowerCase() + u.pathname;
    } catch (_) { return raw.split(/[?#]/)[0]; }
  }
  function estDocumentAurore(d) {
    const auteur = normalize(d?.Auteur);
    const source = normalize(d?.Source);
    let pathname = '';
    try { pathname = new URL(String(d?.Fichier_url || '')).pathname.toLowerCase(); } catch (_) {}
    return auteur === 'aurore' || source === 'aurore' || source.startsWith('aurore ') ||
      pathname.includes('/aurora-assisted-final-pdfs/') || pathname.includes('/aurore/');
  }

  async function lireIdsSuspendus() {
    try {
      if (typeof lireDocumentsSuspendusAdmin !== 'function') return new Set();
      const rows = await lireDocumentsSuspendusAdmin();
      return new Set((Array.isArray(rows) ? rows : []).map(r => String(r.document_id)));
    } catch (_) { return new Set(); }
  }

  async function lireTousLesDocuments() {
    const res = await fetch(SUPABASE_URL + '/rest/v1/Document?select=*&order=id.desc', {
      headers: headersAdmin(), cache: 'no-store'
    });
    if (!res.ok) throw new Error('Lecture des documents impossible (HTTP ' + res.status + ').');
    const rows = await res.json();
    const suspendus = await lireIdsSuspendus();
    return (Array.isArray(rows) ? rows : []).filter(d => !suspendus.has(docId(d)));
  }

  async function lireDepots(colonnes) {
    const res = await fetch(SUPABASE_URL + '/rest/v1/Document?select=' + colonnes + '&Publie=eq.false&order=id.desc', {
      headers: headersAdmin(), cache: 'no-store'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const suspendus = await lireIdsSuspendus();
    return (Array.isArray(rows) ? rows : []).filter(d => !suspendus.has(docId(d)));
  }

  async function mettreAJourCompteur() {
    if (!estAdmin()) return;
    try { majCompteur((await lireDepots('id')).length); } catch (_) {}
  }

  function outils(donnees) {
    if (typeof actualiserOutilsAdminApresChargement === 'function' && typeof ADMIN_COLLECTION_CONFIG !== 'undefined') {
      actualiserOutilsAdminApresChargement('attente', ADMIN_COLLECTION_CONFIG.attente, donnees);
    }
  }

  function buildGroups(rows, deposants) {
    const byFile = new Map();
    (rows || []).forEach(doc => {
      const key = canonicalFileKey(doc);
      if (!byFile.has(key)) byFile.set(key, { key, docs: [], locations: new Map(), deposants: [] });
      const group = byFile.get(key);
      group.docs.push(doc);
      const lk = locationKey(doc);
      if (!group.locations.has(lk)) group.locations.set(lk, { key: lk, label: locationLabel(doc), rows: [], deposants: [] });
      const location = group.locations.get(lk);
      location.rows.push(doc);
      const deposant = deposants?.get?.(Number(doc.id)) || deposants?.get?.(doc.id) || null;
      if (deposant && !group.deposants.some(x => x.user_id && x.user_id === deposant.user_id)) group.deposants.push(deposant);
      if (deposant && !location.deposants.some(x => x.user_id && x.user_id === deposant.user_id)) location.deposants.push(deposant);
    });
    const result = [...byFile.values()].map((g, i) => {
      g.docs.sort((a,b) => Number(b.id) - Number(a.id));
      g.locations = [...g.locations.values()].map(location => {
        location.rows.sort((a,b) => Number(b.id) - Number(a.id));
        location.pending = location.rows.filter(d => !isPublished(d));
        location.published = location.rows.filter(isPublished);
        location.latest = location.rows[0];
        return location;
      }).sort((a,b) => Number(b.latest?.id || 0) - Number(a.latest?.id || 0));
      g.primary = g.docs[0];
      g.aurore = g.docs.some(estDocumentAurore);
      g.pendingCount = g.docs.filter(d => !isPublished(d)).length;
      g.publishedCount = g.docs.filter(isPublished).length;
      g.duplicateRows = Math.max(0, g.docs.length - g.locations.length);
      g.token = 'external-group-' + i;
      return g;
    });
    return result.sort((a,b) => Number(b.primary?.id || 0) - Number(a.primary?.id || 0));
  }

  function ensureManager(list) {
    let root = document.getElementById('externalDepositManager');
    if (root) { root.hidden = false; return root; }
    root = document.createElement('section');
    root.id = 'externalDepositManager';
    root.className = 'external-deposit-manager';
    root.innerHTML = `
      <div class="dx-manager-head"><div><span class="dx-kicker">Administration · Catalogue documentaire</span><h3>Documents Aurore et communauté</h3><p>Chaque fichier apparaît une seule fois. Ses différents emplacements sont gérés séparément.</p></div><span class="dx-manager-state" id="dxRefreshState">Synchronisé</span></div>
      <div class="dx-manager-toolbar"><label class="dx-search"><span aria-hidden="true">⌕</span><input id="dxSearch" type="search" placeholder="Rechercher un titre, déposant, niveau ou matière…" autocomplete="off"></label><select id="dxStatusFilter" aria-label="Filtrer les documents"><option value="all">Tous les statuts</option><option value="pending">En attente</option><option value="published">Publiés</option><option value="multi">Plusieurs emplacements</option></select></div>
      <div class="dx-manager-stats"><div><strong id="dxStatFiles">0</strong><span>Fichiers</span></div><div><strong id="dxStatAurore">0</strong><span>Documents Aurore</span></div><div><strong id="dxStatCommunity">0</strong><span>Documents communauté</span></div><div><strong id="dxStatLocations">0</strong><span>Emplacements</span></div><div><strong id="dxStatPending">0</strong><span>En attente</span></div></div>`;
    list.insertAdjacentElement('beforebegin', root);
    root.querySelector('#dxSearch').addEventListener('input', e => { state.query = normalize(e.target.value); render(); });
    root.querySelector('#dxStatusFilter').addEventListener('change', e => { state.status = e.target.value; render(); });
    return root;
  }

  function injectStyles() {
    if (document.getElementById('externalDepositManagerStyles')) return;
    const style = document.createElement('style');
    style.id = 'externalDepositManagerStyles';
    style.textContent = `
      #externalDepositManager{margin:0 0 16px;color:var(--encre,#24212f)}
      #externalDepositManager .dx-manager-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:4px 0 15px}
      #externalDepositManager .dx-kicker{font-size:.66rem;letter-spacing:.09em;text-transform:uppercase;font-weight:850;color:var(--gris,#707080)}
      #externalDepositManager h3{font-size:1.05rem;margin:4px 0 5px}
      #externalDepositManager .dx-manager-head p{font-size:.78rem;line-height:1.5;color:var(--gris,#707080);margin:0;max-width:650px}
      #externalDepositManager .dx-manager-state{font-size:.67rem;border:1px solid var(--bordure,rgba(100,100,120,.2));border-radius:999px;padding:6px 9px;white-space:nowrap;color:var(--gris,#707080)}
      #externalDepositManager .dx-manager-toolbar{display:flex;gap:9px;align-items:center;margin:12px 0;flex-wrap:wrap}
      #externalDepositManager .dx-search{display:flex;align-items:center;gap:8px;flex:1 1 250px;min-width:0;border:1px solid var(--bordure,rgba(100,100,120,.22));border-radius:12px;background:var(--card-bg,#fff);padding:0 11px;min-height:42px}
      #externalDepositManager .dx-search span{font-size:1.15rem;color:var(--gris,#707080)}
      #externalDepositManager .dx-search input{border:0!important;outline:0!important;background:transparent!important;box-shadow:none!important;width:100%;min-width:0;color:inherit;font:inherit;font-size:.8rem}
      #externalDepositManager #dxStatusFilter{min-height:42px;border:1px solid var(--bordure,rgba(100,100,120,.22));border-radius:12px;background:var(--card-bg,#fff);color:inherit;padding:0 10px;font-size:.76rem;max-width:100%}
      #externalDepositManager .dx-manager-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin:12px 0 18px}
      #externalDepositManager .dx-manager-stats>div{border:1px solid var(--bordure,rgba(100,100,120,.16));border-radius:13px;background:var(--card-bg,rgba(255,255,255,.55));padding:10px 8px;min-width:0}
      #externalDepositManager .dx-manager-stats strong{display:block;font-size:1.1rem;font-variant-numeric:tabular-nums}
      #externalDepositManager .dx-manager-stats span{display:block;font-size:.62rem;color:var(--gris,#707080);line-height:1.3;margin-top:3px}
      #adminList .dx-section{margin:18px 0 22px}
      #adminList .dx-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--bordure,rgba(100,100,120,.16));padding:0 2px 9px;margin-bottom:12px}
      #adminList .dx-section-head h4{margin:0;font-size:.9rem}
      #adminList .dx-section-head span{font-size:.68rem;color:var(--gris,#707080)}
      #adminList .dx-group-card{position:relative;overflow:visible;padding-top:14px}
      #adminList .dx-group-card>.admin-card-body{padding-left:32px;min-width:0}
      #adminList .dx-group-card .dx-menu-toggle{position:absolute;z-index:5;left:9px;top:10px;width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--bordure,rgba(100,100,120,.2));border-radius:10px;background:var(--card-bg,#fff);color:var(--encre,#24212f);cursor:pointer}
      #adminList .dx-group-card .dx-menu-toggle svg{width:18px;height:18px}
      #adminList .dx-group-card .dx-menu{position:absolute;z-index:25;left:9px;top:48px;min-width:205px;padding:6px;border:1px solid var(--bordure,rgba(100,100,120,.22));border-radius:13px;background:var(--card-bg,#fff);box-shadow:0 14px 35px rgba(20,20,35,.16);display:none}
      #adminList .dx-group-card .dx-menu.is-open{display:grid;gap:3px}
      #adminList .dx-group-card .dx-menu button{border:0;background:transparent;color:inherit;text-align:left;border-radius:8px;padding:10px;font-size:.74rem;cursor:pointer}
      #adminList .dx-group-card .dx-menu button:hover{background:var(--fond,rgba(100,100,120,.08))}
      #adminList .dx-origin{display:inline-flex;align-items:center;border-radius:999px;border:1px solid var(--bordure,rgba(100,100,120,.2));padding:4px 8px;font-size:.62rem;font-weight:800;letter-spacing:.04em;margin:0 0 7px}
      #adminList .dx-origin.aurore{color:#6d28d9;background:rgba(109,40,217,.07)}
      #adminList .dx-origin.community{color:#0e7490;background:rgba(14,116,144,.07)}
      #adminList .dx-state-line{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px}
      #adminList .dx-state-pill{border:1px solid var(--bordure,rgba(100,100,120,.18));border-radius:999px;padding:4px 8px;font-size:.64rem;color:var(--gris,#707080)}
      #adminList .dx-main-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}
      #adminList .dx-main-actions .admin-btn{font-size:.73rem}
      #adminList .dx-empty-section{font-size:.77rem;color:var(--gris,#707080);padding:13px;border:1px dashed var(--bordure,rgba(100,100,120,.23));border-radius:12px}
      .dx-modal-backdrop{position:fixed;inset:0;background:rgba(9,12,22,.58);backdrop-filter:blur(3px);z-index:10080;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}
      .dx-modal{width:min(680px,100%);max-height:min(86vh,850px);overflow:auto;background:var(--card-bg,#fff);color:var(--encre,#24212f);border:1px solid var(--bordure,rgba(100,100,120,.2));border-radius:20px;box-shadow:0 25px 80px rgba(0,0,0,.28);padding:16px;box-sizing:border-box}
      .dx-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:1px solid var(--bordure,rgba(100,100,120,.18));padding-bottom:11px;margin-bottom:12px}
      .dx-modal-head h3{font-size:1rem;margin:0 0 4px}.dx-modal-head p{font-size:.72rem;color:var(--gris,#707080);margin:0}
      .dx-modal-close{width:34px;height:34px;border:1px solid var(--bordure,rgba(100,100,120,.2));border-radius:10px;background:transparent;color:inherit;font-size:1.1rem;cursor:pointer}
      .dx-location-row{border:1px solid var(--bordure,rgba(100,100,120,.17));border-radius:13px;padding:11px;margin:9px 0}
      .dx-location-title{font-size:.78rem;font-weight:800;line-height:1.4}.dx-location-meta{font-size:.67rem;color:var(--gris,#707080);margin-top:4px;line-height:1.45}
      .dx-location-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.dx-location-actions .admin-btn{font-size:.68rem;padding:7px 9px}
      .dx-status-tag{display:inline-block;font-size:.61rem;border:1px solid var(--bordure,rgba(100,100,120,.2));border-radius:999px;padding:3px 7px;margin-top:6px;color:var(--gris,#707080)}
      [data-theme="dark"] .dx-modal,[data-theme="dark"] #externalDepositManager .dx-manager-stats>div{background:#171622;color:#f4f2fb;border-color:#3b384b}
      [data-theme="dark"] #adminList .dx-group-card .dx-menu{background:#171622;color:#f4f2fb;border-color:#3b384b}
      @media(max-width:560px){#externalDepositManager .dx-manager-stats{grid-template-columns:repeat(3,minmax(0,1fr))}#externalDepositManager .dx-manager-head{align-items:flex-start}#externalDepositManager .dx-manager-state{display:none}.dx-modal{padding:12px;border-radius:16px}}
    `;
    document.head.appendChild(style);
  }

  function getDeposant(group) {
    if (group.deposants.length) return group.deposants[0];
    return null;
  }
  function searchText(group) {
    const values = [group.primary?.Titre, group.primary?.Auteur, group.primary?.Source];
    group.docs.forEach(d => values.push(d.Titre,d.Niveau,d.Classe,d['Catégorie'],d['Matière'],d.Genre,d.Auteur,d.Source));
    group.deposants.forEach(d => values.push(d.nom,d.email));
    group.locations.forEach(l => values.push(l.label));
    return normalize(values.filter(Boolean).join(' '));
  }
  function groupMatches(group) {
    if (state.status === 'pending' && group.pendingCount < 1) return false;
    if (state.status === 'published' && group.publishedCount < 1) return false;
    if (state.status === 'multi' && group.locations.length < 2) return false;
    return !state.query || searchText(group).includes(state.query);
  }

  function creerCarte(group) {
    const doc = group.primary || {};
    const deposant = getDeposant(group);
    const infoDeposant = group.aurore ? 'Origine : production Aurore' :
      group.deposants.length > 1 ? group.deposants.length + ' comptes déposants associés' :
      (typeof ligneCompteDeposant === 'function' ? ligneCompteDeposant(deposant) : 'Compte du déposant : information non disponible');
    const taille = typeof tailleBadgeMarkup === 'function' ? tailleBadgeMarkup(doc.Fichier_url) : '';
    const statut = group.pendingCount && group.publishedCount
      ? group.pendingCount + ' en attente · ' + group.publishedCount + ' publié(s)'
      : group.pendingCount ? group.pendingCount + ' en attente' : group.publishedCount + ' publié(s)';
    const card = document.createElement('article');
    card.className = 'admin-card pending-card dx-group-card';
    card.dataset.externalGroup = group.token;
    card.dataset.adminId = docId(doc);
    card.dataset.adminTitle = String(doc.Titre || '');
    card.dataset.adminLevel = String(doc.Niveau || '');
    card.dataset.adminClass = String(doc.Classe || '');
    card.dataset.adminSubject = String(doc['Matière'] || doc.Genre || '');
    card.dataset.adminCategory = String(doc['Catégorie'] || '');
    card.dataset.adminAuthor = String(doc.Auteur || '');
    card.dataset.adminSearch = searchText(group);
    card.dataset.adminSortValue = String(doc.id || '0');
    card._auroreDocument = doc;
    const icon = typeof iconePourCategorie === 'function' ? iconePourCategorie(doc) : '';
    card.innerHTML = `
      <button type="button" class="dx-menu-toggle" data-dx-menu-toggle aria-label="Ouvrir les options du document" aria-expanded="false"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg></button>
      <div class="admin-card-icon">${icon}</div>
      <div class="admin-card-body">
        <span class="dx-origin ${group.aurore ? 'aurore' : 'community'}">${group.aurore ? 'DOCUMENT AURORE' : 'DOCUMENT DE LA COMMUNAUTÉ'}</span>
        <div class="titre">${esc(doc.Titre || 'Document sans titre')}</div>
        <div class="meta">${esc(doc.Niveau || 'Niveau non précisé')}${doc.Classe ? ' · ' + esc(doc.Classe) : ''} · ${esc(doc['Catégorie'] || 'Non classé')} · ${esc(doc['Matière'] || doc.Genre || 'Matière non précisée')}<br>
          ${group.aurore ? 'Production Aurore' : 'Déposé par ' + esc(doc.Auteur || deposant?.nom || 'Anonyme')}<br>
          <span style="color:var(--gris);">${esc(infoDeposant)}</span>
        </div>
        <div class="dx-state-line"><span class="dx-state-pill">${group.locations.length} emplacement(s)</span><span class="dx-state-pill">${group.docs.length} entrée(s) catalogue</span><span class="dx-state-pill">${esc(statut)}</span>${group.duplicateRows ? '<span class="dx-state-pill">'+group.duplicateRows+' répétition(s) de ligne</span>' : ''}</div>
        ${taille}
        <div class="dx-main-actions"><button type="button" class="admin-btn ghost" data-dx-open-pdf>Ouvrir le PDF dans Aurore</button><button type="button" class="admin-btn primary" data-dx-locations>Voir les emplacements (${group.locations.length})</button></div>
      </div>
      <div class="dx-menu" role="menu" aria-label="Fonctionnalités du document">
        <button type="button" data-dx-menu-action="locations">Voir les emplacements</button>
        <button type="button" data-dx-menu-action="copy">Copier le lien du PDF</button>
        <button type="button" data-dx-menu-action="refresh">Actualiser les documents</button>
      </div>`;

    card.querySelector('[data-dx-open-pdf]')?.addEventListener('click', () => { fermerMenu(card); ouvrirPdf(doc); });
    card.querySelector('[data-dx-locations]')?.addEventListener('click', () => { fermerMenu(card); ouvrirEmplacements(group.token); });
    card.querySelector('[data-dx-menu-toggle]')?.addEventListener('click', e => {
      const menu = card.querySelector('.dx-menu');
      const open = !menu.classList.contains('is-open');
      document.querySelectorAll('#adminList .dx-menu.is-open').forEach(x => x.classList.remove('is-open'));
      menu.classList.toggle('is-open', open);
      e.currentTarget.setAttribute('aria-expanded', String(open));
    });
    card.querySelector('[data-dx-menu-action="locations"]')?.addEventListener('click', () => { fermerMenu(card); ouvrirEmplacements(group.token); });
    card.querySelector('[data-dx-menu-action="copy"]')?.addEventListener('click', async () => { fermerMenu(card); await copierLien(doc.Fichier_url); });
    card.querySelector('[data-dx-menu-action="refresh"]')?.addEventListener('click', () => { fermerMenu(card); charger(); });
    return card;
  }

  function fermerMenu(card) {
    card?.querySelector('.dx-menu')?.classList.remove('is-open');
    card?.querySelector('[data-dx-menu-toggle]')?.setAttribute('aria-expanded','false');
  }

  function render() {
    const list = document.getElementById('adminList');
    if (!list) return;
    const root = ensureManager(list);
    const groups = [...state.groups.values()];
    const visible = groups.filter(groupMatches);
    const aurore = visible.filter(g => g.aurore);
    const community = visible.filter(g => !g.aurore);
    const totalPending = groups.reduce((n,g)=>n+g.pendingCount,0);
    const totalLocations = groups.reduce((n,g)=>n+g.locations.length,0);
    root.querySelector('#dxStatFiles').textContent = String(groups.length);
    root.querySelector('#dxStatAurore').textContent = String(groups.filter(g=>g.aurore).length);
    root.querySelector('#dxStatCommunity').textContent = String(groups.filter(g=>!g.aurore).length);
    root.querySelector('#dxStatLocations').textContent = String(totalLocations);
    root.querySelector('#dxStatPending').textContent = String(totalPending);
    list.innerHTML = '';
    const section = (title, items, type) => {
      const wrap = document.createElement('section');
      wrap.className = 'dx-section';
      const cards = items.map(creerCarte);
      wrap.innerHTML = `<div class="dx-section-head"><h4>${title}</h4><span>${items.length} fichier(s) · ${items.reduce((n,g)=>n+g.locations.length,0)} emplacement(s)</span></div>`;
      if (!cards.length) {
        const empty = document.createElement('div'); empty.className='dx-empty-section';
        empty.textContent = state.query || state.status !== 'all' ? 'Aucun document ne correspond à ces critères.' : 'Aucun document dans ce groupe.';
        wrap.appendChild(empty);
      } else cards.forEach(card => wrap.appendChild(card));
      list.appendChild(wrap);
    };
    section('Documents Aurore', aurore, 'aurore');
    section('Documents de la communauté', community, 'community');
    const badge = root.querySelector('#dxRefreshState');
    if (badge) badge.textContent = 'Synchronisé · ' + new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  }

  function obtenirModal() {
    let host = document.getElementById('dxLocationModal');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'dxLocationModal';
    host.hidden = true;
    host.innerHTML = '<div class="dx-modal-backdrop" data-dx-close><section class="dx-modal" role="dialog" aria-modal="true" aria-labelledby="dxModalTitle"><div class="dx-modal-head"><div><h3 id="dxModalTitle">Emplacements du document</h3><p id="dxModalSubtitle"></p></div><button type="button" class="dx-modal-close" data-dx-close aria-label="Fermer">×</button></div><div id="dxModalLocations"></div></section></div>';
    document.body.appendChild(host);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !host.hidden) fermerModal(); });
    host.addEventListener('click', e => {
      if (e.target.matches('[data-dx-close]')) fermerModal();
      const action = e.target.closest('[data-dx-location-action]');
      if (!action || !host.contains(action)) return;
      const token = action.dataset.groupToken, location = action.dataset.locationKey;
      const kind = action.dataset.dxLocationAction;
      if (kind === 'remove') {
        e.preventDefault(); e.stopPropagation();
        if (action.dataset.busy === '1') return;
        action.dataset.busy = '1';
        action.disabled = true;
        action.textContent = 'Retrait en cours…';
        Promise.resolve(retirerEmplacement(token, location, action)).catch(error => {
          console.error('[Dépôts externes] Retrait:', error);
          alert('Impossible de retirer cet emplacement : ' + String(error?.message || error));
          action.disabled = false; action.dataset.busy = '0'; action.textContent = 'Retirer cet emplacement';
        });
        return;
      }
      if (kind === 'publish') publierEmplacement(token, location);
      if (kind === 'view') voirEmplacement(action.dataset.documentId);
      if (kind === 'download') basculerTelechargement(token, location);
    });
    return host;
  }

  function ouvrirEmplacements(token) {
    const group = state.groups.get(token);
    if (!group) return;
    const host = obtenirModal();
    host.querySelector('#dxModalTitle').textContent = group.primary?.Titre || 'Emplacements du document';
    host.querySelector('#dxModalSubtitle').textContent = group.locations.length + ' emplacement(s) distinct(s) · ' + group.docs.length + ' entrée(s) catalogue. Retirer un emplacement ne touche pas aux autres.';
    const target = host.querySelector('#dxModalLocations');
    target.innerHTML = group.locations.map((loc,index) => {
      const pending = loc.pending.length, published = loc.published.length;
      const stateLabel = pending && published ? pending+' en attente · '+published+' publié(s)' : pending ? 'En attente de validation' : 'Publié';
      const ids = loc.rows.map(docId).join(',');
      const primary = loc.latest || loc.rows[0];
      const deposantLine = group.aurore ? 'Production Aurore' : loc.deposants.length > 1 ? loc.deposants.length + ' comptes déposants associés' : (typeof ligneCompteDeposant === 'function' ? ligneCompteDeposant(loc.deposants[0] || null) : 'Compte déposant non disponible');
      return `<article class="dx-location-row"><div class="dx-location-title">${index+1}. ${esc(loc.label)}</div><span class="dx-status-tag">${esc(stateLabel)}</span><div class="dx-location-meta">${loc.rows.length} enregistrement(s) pour cet emplacement · ID ${esc(ids)}<br>${esc(deposantLine)}</div><div class="dx-location-actions">
        ${published ? '<button type="button" class="admin-btn ghost" data-dx-location-action="view" data-document-id="'+esc(docId(primary))+'">Voir dans Aurore</button>' : ''}
        ${pending ? '<button type="button" class="admin-btn primary" data-dx-location-action="publish" data-group-token="'+esc(token)+'" data-location-key="'+esc(loc.key)+'">Valider cet emplacement</button>' : ''}
        ${published ? '<button type="button" class="admin-btn ghost" data-dx-location-action="download" data-group-token="'+esc(token)+'" data-location-key="'+esc(loc.key)+'">'+(loc.rows.every(d=>d.Telechargement_autorise===false)?'Autoriser le téléchargement':'Passer en lecture seule')+'</button>' : ''}
        <button type="button" class="admin-btn refuser" data-dx-location-action="remove" data-group-token="'+esc(token)+'" data-location-key="'+esc(loc.key)+'">Retirer cet emplacement</button>
      </div></article>`;
    }).join('');
    host.hidden = false;
  }
  function fermerModal() { const host=document.getElementById('dxLocationModal'); if(host)host.hidden=true; }

  function ouvrirPdf(doc) {
    if (!doc?.Fichier_url) { alert('Le fichier PDF de ce document est introuvable.'); return; }
    const cible = { ...doc, id:doc.id, Titre:doc.Titre || 'Document', Fichier_url:doc.Fichier_url, Telechargement_autorise:doc.Telechargement_autorise !== false };
    if (typeof window.ouvrirLecteurPDF === 'function') window.ouvrirLecteurPDF(cible);
    else window.open(doc.Fichier_url,'_blank','noopener,noreferrer');
  }
  function voirEmplacement(id) {
    const groupDoc = [...state.groups.values()].flatMap(g=>g.docs).find(d=>docId(d)===String(id));
    if (!groupDoc) return;
    if (!isPublished(groupDoc)) { alert('Cet emplacement est encore en attente de validation.'); return; }
    if (typeof window.voirEmplacementPublicDocument === 'function') window.voirEmplacementPublicDocument(groupDoc);
    else if (typeof obtenirUrlDocumentPartage === 'function') window.open(obtenirUrlDocumentPartage({id:groupDoc.id}),'_blank','noopener,noreferrer');
    else window.open('./?document='+encodeURIComponent(id),'_blank','noopener,noreferrer');
  }
  async function copierLien(url) {
    if (!url) { alert('Aucun lien PDF n’est disponible.'); return; }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(String(url));
      else { const input=document.createElement('textarea');input.value=String(url);input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();const ok=document.execCommand('copy');input.remove();if(!ok)throw new Error('Copie indisponible'); }
      alert('Lien du PDF copié.');
    } catch (_) { alert('La copie du lien est indisponible sur ce navigateur.'); }
  }

  function getLocation(groupToken, locationKey) {
    const group=state.groups.get(groupToken);
    return group ? {group,location:group.locations.find(x=>x.key===locationKey)} : null;
  }
  async function retirerEmplacement(groupToken, locationKey, button) {
    const found=getLocation(groupToken,locationKey); if(!found?.location)return;
    const {group,location}=found;
    const count=location.rows.length;
    const extra=count>1?'\n\n'+count+' entrées identiques seront retirées pour cet emplacement.':'';
    const tail=group.locations.length>1?'Les autres emplacements du même PDF seront conservés.':'C’est le dernier emplacement : le document ne sera plus référencé dans le catalogue, mais le fichier PDF restera dans le stockage.';
    if(!confirm('Retirer uniquement cet emplacement ?\n\n'+location.label+extra+'\n\n'+tail)){if(button){button.disabled=false;button.dataset.busy='0';button.textContent='Retirer cet emplacement';}return;}
    const ids=location.rows.map(docId).filter(Boolean);
    if(!ids.length){alert('Aucun identifiant exploitable pour cet emplacement. Actualise la liste et réessaie.');if(button){button.disabled=false;button.dataset.busy='0';button.textContent='Retirer cet emplacement';}return;}
    const originalLabel=button?.textContent||'Retirer cet emplacement';
    if(button){button.disabled=true;button.dataset.busy='1';button.textContent='Retrait en cours…';button.setAttribute('aria-busy','true');}
    try {
      // Suppression ciblée par identifiant, avec confirmation individuelle du serveur.
      // Cela évite qu'une réponse vide ou une politique RLS fasse croire que tout a réussi.
      for(const id of ids){
        const res=await fetch(SUPABASE_URL+'/rest/v1/Document?id=eq.'+encodeURIComponent(id),{
          method:'DELETE',headers:{...headersAdmin(),'Prefer':'return=representation'},cache:'no-store'
        });
        const raw=await res.text();
        if(!res.ok)throw new Error('HTTP '+res.status+(raw?' · '+raw.slice(0,260):''));
        let deleted=[];try{deleted=raw?JSON.parse(raw):[]}catch(_){}
        if(!Array.isArray(deleted)||!deleted.some(row=>docId(row)===id))throw new Error('Le serveur n’a pas confirmé la suppression de l’entrée '+id+'. Vérifie les droits administrateur/RLS.');
      }
      if(location.pending.length===location.rows.length && group.locations.length===1 && typeof notifierDeposant==='function')for(const deposant of (location.deposants||[])){
        if(deposant?.user_id)await notifierDeposant(deposant,{titreDocument:group.primary?.Titre,statut:'refuse',message:'Votre document « '+(group.primary?.Titre||'sans titre')+' » n’a pas été retenu dans le catalogue Aurore.'});
      }
      fermerModal(); await charger();
    } catch(error) {
      console.error('[Dépôts externes] Retrait emplacement:',error);
      alert('Retrait de l’emplacement impossible. '+String(error?.message||error));
      if(button){button.disabled=false;button.dataset.busy='0';button.textContent=originalLabel;button.removeAttribute('aria-busy');}
      // Si plusieurs lignes composaient cet emplacement, rafraîchir l’état réel après un échec partiel.
      if(typeof charger==='function')await Promise.resolve(charger()).catch(()=>{});
    }
  }

  async function publierEmplacement(groupToken, locationKey) {
    const found=getLocation(groupToken,locationKey); if(!found?.location)return;
    const {location}=found;
    const pending=location.pending;
    if(!pending.length)return;
    try {
      const ids=pending.map(docId).filter(Boolean);
      const res=await fetch(SUPABASE_URL+'/rest/v1/Document?id=in.('+ids.map(encodeURIComponent).join(',')+')',{
        method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=representation'},
        body:JSON.stringify({Publie:true}),cache:'no-store'
      });
      const raw=await res.text();if(!res.ok)throw new Error(raw||('HTTP '+res.status));
      let updated=[];try{updated=raw?JSON.parse(raw):[]}catch(_){}
      if(!Array.isArray(updated)||updated.length!==ids.length)throw new Error('La validation de cet emplacement n’a pas été confirmée.');
      const depositors=location.deposants||[];
      if(typeof notifierDeposant==='function')for(const deposant of depositors){
        if(deposant?.user_id)await notifierDeposant(deposant,{titreDocument:found.group.primary?.Titre,statut:'valide',message:'Votre document « '+(found.group.primary?.Titre||'sans titre')+' » a été validé et publié dans cet emplacement Aurore.'});
      }
      fermerModal();await charger();
    } catch(error) { alert('Validation de cet emplacement impossible. '+String(error?.message||error)); }
  }

  async function basculerTelechargement(groupToken, locationKey) {
    const found=getLocation(groupToken,locationKey);if(!found?.location)return;
    const rows=found.location.rows;
    const allow=rows.every(d=>d.Telechargement_autorise===false);
    try {
      const ids=rows.map(docId).filter(Boolean);
      const res=await fetch(SUPABASE_URL+'/rest/v1/Document?id=in.('+ids.map(encodeURIComponent).join(',')+')',{
        method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=representation'},
        body:JSON.stringify({Telechargement_autorise:allow}),cache:'no-store'
      });
      const raw=await res.text();if(!res.ok)throw new Error(raw||('HTTP '+res.status));
      fermerModal();await charger();
    } catch(error) { alert('Modification des droits de téléchargement impossible. '+String(error?.message||error)); }
  }

  async function charger() {
    const list=document.getElementById('adminList'); if(!list||enCours)return;
    enCours=true;state.loading=true;
    list.innerHTML='<p class="admin-empty">Chargement des documents Aurore et de la communauté…</p>';
    const stateEl=document.getElementById('dxRefreshState');if(stateEl)stateEl.textContent='Synchronisation…';
    try {
      const rows=await lireTousLesDocuments();
      const deposants=new Map();
      try { if(typeof recupererDeposants==='function') { const found=await recupererDeposants(rows.map(d=>d.id)); found.forEach((v,k)=>deposants.set(k,v)); } }
      catch(error){console.warn('[DÉPÔTS EXTERNES] informations déposants indisponibles',error);}
      const groups=buildGroups(rows,deposants);
      state.groups=new Map(groups.map(g=>[g.token,g]));
      const pending=rows.filter(d=>!isPublished(d));
      majCompteur(pending.length);
      if(typeof actualiserResumeDepotsAttente==='function')actualiserResumeDepotsAttente(pending);
      outils({niveaux:pending.map(d=>d.Niveau),classes:pending.map(d=>d.Classe),matieres:pending.map(d=>d['Matière']||d.Genre),categories:pending.map(d=>d['Catégorie'])});
      ensureManager(list);render();
      if(!groups.length)list.innerHTML='<p class="admin-empty">Aucun document Aurore ou communautaire dans le catalogue.</p>';
    } catch(error) {
      console.error('[DÉPÔTS EXTERNES] chargement',error);
      list.innerHTML='<p class="admin-empty">Impossible de charger les documents pour le moment. '+esc(error?.message||error)+'</p>';
      if(stateEl)stateEl.textContent='Erreur de synchronisation';
    } finally { enCours=false;state.loading=false; }
  }

  function ouvrir() {
    const grille=document.getElementById('adminCategoryGrid');
    const detail=document.getElementById('adminDetail');
    const panneau=document.querySelector('.admin-tab-panel[data-panel="attente"]');
    const toolbar=document.getElementById('adminToolbarAttente');
    const list=document.getElementById('adminList');
    if(!grille||!detail||!panneau||!list)return;
    state.active=true;
    if(toolbar)toolbar.hidden=true;
    document.querySelectorAll('.admin-tab').forEach(t=>t.classList.toggle('active',t===carte));
    document.querySelectorAll('.admin-tab-panel').forEach(p=>p.classList.toggle('active',p===panneau));
    grille.style.display='none';detail.style.display='block';
    try { const pushed=typeof navigationParPopState!=='undefined'&&navigationParPopState;if(!pushed&&typeof creerSnapshotNavigation==='function')history.pushState({...creerSnapshotNavigation('screen-admin',window.scrollY),adminDetail:true},'',location.href); } catch(_) {}
    charger();
  }

  function init() {
    injectStyles();
    const grille=document.getElementById('adminCategoryGrid');
    const modele=grille&&grille.querySelector('.admin-tab[data-tab="attente"]');
    const panneau=document.querySelector('.admin-tab-panel[data-panel="attente"]');
    if(!grille||!modele||!panneau||grille.querySelector('.admin-tab[data-tab="'+TAB+'"]'))return;
    carte=document.createElement('button');
    carte.type='button';carte.className='admin-tab admin-category-card';carte.dataset.tab=TAB;carte.dataset.accent='ambre';carte.setAttribute('role','tab');
    carte.innerHTML='<span aria-hidden="true" class="admin-category-icon"><svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20"><path d="M3 7h18M5 7v13h14V7M9 7V4h6v3M9 11h6M9 15h6"></path></svg></span><span class="admin-category-title">Dépôts externes</span><span class="admin-category-desc">Documents Aurore et contributions de la communauté</span><span class="tab-count" id="'+ID_COMPTEUR+'">0</span>';
    modele.insertAdjacentElement('afterend',carte);carte.addEventListener('click',ouvrir);
    panneau.setAttribute('aria-label','Dépôts externes · documents Aurore et communauté');
    const vue=panneau.querySelector('.admin-pending-overview');
    if(vue)vue.setAttribute('aria-label','Vue d’ensemble des documents Aurore et de la communauté');
    const titre=panneau.querySelector('.admin-pending-overview-head h3');if(titre)titre.textContent='Dépôts externes';
    const texte=panneau.querySelector('.admin-pending-overview-head p');if(texte)texte.textContent='Documents de la plateforme Aurore et dépôts de la communauté, regroupés par fichier et organisés par emplacement.';
    const desc=panneau.querySelector(':scope > .admin-panel-desc');if(desc)desc.textContent='Ouvre les options de chaque document avec le menu à trois points. Consulte ses emplacements et retire une seule destination sans toucher aux autres.';
    const actualiser=document.getElementById('adminRefreshAttente');
    if(actualiser)actualiser.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();charger();},true);
    // Quand une autre catégorie reprend le panneau d'attente, rétablir ses outils standards.
    document.addEventListener('click',e=>{
      const tab=e.target?.closest?.('.admin-tab');
      if(!tab||tab===carte)return;
      state.active=false;
      const toolbar=document.getElementById('adminToolbarAttente');if(toolbar)toolbar.hidden=false;
      const manager=document.getElementById('externalDepositManager');if(manager)manager.hidden=true;
    },true);
    document.getElementById('btnAdmin')?.addEventListener('click',()=>setTimeout(mettreAJourCompteur,400));
    window.addEventListener('focus',()=>{if(state.active)charger();});
    document.addEventListener('click',e=>{const target=e.target instanceof Element?e.target:e.target?.parentElement;if(!target?.closest('.dx-group-card'))document.querySelectorAll('#adminList .dx-menu.is-open').forEach(x=>x.classList.remove('is-open'));});
    setInterval(()=>{if(estAdmin()&&document.getElementById('screen-admin')?.classList.contains('active'))mettreAJourCompteur();},20000);
    mettreAJourCompteur();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
