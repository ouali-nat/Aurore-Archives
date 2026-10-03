/* Aurore — Administration : bloc « Dépôts externes »
 * Restaure l'accès à la validation / au rejet des documents déposés par les
 * utilisateurs (table Document, Publie=false). Depuis que « Documents en
 * attente » ouvre la page dédiée aux documents Aurore (Content Factory), ces
 * dépôts n'avaient plus de point d'entrée dans l'administration.
 * Ce module ajoute une carte dédiée et réutilise le panneau existant
 * (#adminList) ainsi que les fonctions validerDepot / refuserDepot.
 * Il ne supprime ni ne modifie rien d'autre. */
(function () {
  'use strict';

  const TAB = 'depots-externes';
  const ID_COMPTEUR = 'tabCountDepotsExternes';
  let carte = null;
  let enCours = false;

  const echapper = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const estAdmin = () => { try { return typeof session !== 'undefined' && !!session && session.role === 'admin'; } catch (_) { return false; } };

  function majCompteur(n) {
    const el = document.getElementById(ID_COMPTEUR);
    if (el) el.textContent = String(n);
  }

  // Les documents suspendus par « Suspendre tous » repassent à Publie=false :
  // ce ne sont pas des dépôts à valider, on les écarte de cette liste.
  async function lireIdsSuspendus() {
    try {
      if (typeof lireDocumentsSuspendusAdmin !== 'function') return new Set();
      const rows = await lireDocumentsSuspendusAdmin();
      return new Set((Array.isArray(rows) ? rows : []).map(r => String(r.document_id)));
    } catch (_) { return new Set(); }
  }

  async function lireDepots(colonnes) {
    const res = await fetch(SUPABASE_URL + '/rest/v1/Document?select=' + colonnes + '&Publie=eq.false&order=id.desc', { headers: headersAdmin(), cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const lignes = await res.json();
    const suspendus = await lireIdsSuspendus();
    return (Array.isArray(lignes) ? lignes : []).filter(d => !suspendus.has(String(d.id)));
  }

  async function mettreAJourCompteur() {
    if (!estAdmin()) return;
    try { majCompteur((await lireDepots('id')).length); } catch (_) { /* silencieux */ }
  }

  function outils(donnees) {
    if (typeof actualiserOutilsAdminApresChargement === 'function' && typeof ADMIN_COLLECTION_CONFIG !== 'undefined') {
      actualiserOutilsAdminApresChargement('attente', ADMIN_COLLECTION_CONFIG.attente, donnees);
    }
  }

  // Après une validation / un refus : recompte, et restaure le compteur de la
  // carte « Documents en attente » que validerDepot / refuserDepot écrasent.
  function apres() {
    const liste = document.getElementById('adminList');
    if (liste) majCompteur(liste.querySelectorAll('.admin-card').length);
    if (typeof window.chargerCompteurDocumentsEnAttenteAdmin === 'function') window.chargerCompteurDocumentsEnAttenteAdmin();
  }

  function creerFiche(doc, deposant, i) {
    const card = document.createElement('div');
    card.className = 'admin-card pending-card';
    const categorie = String(doc['Catégorie'] || doc.Genre || 'Non classé').trim() || 'Non classé';
    const matiere = String(doc['Matière'] || doc.Genre || '');
    card.dataset.adminId = String(doc.id ?? '');
    card.dataset.adminTitle = String(doc.Titre || '');
    card.dataset.adminLevel = String(doc.Niveau || '');
    card.dataset.adminClass = String(doc.Classe || '');
    card.dataset.adminSubject = matiere;
    card.dataset.adminCategory = categorie;
    card.dataset.adminAuthor = String(doc.Auteur || (deposant && deposant.nom) || '');
    card.dataset.adminSearch = [doc.Titre, doc.Niveau, doc.Classe, doc['Catégorie'], doc['Matière'], doc.Genre, doc.Auteur, deposant && deposant.nom, deposant && deposant.email]
      .filter(v => v != null && String(v).trim()).join(' ');
    card.dataset.adminSortValue = String(doc.id ?? '0');
    card.style.animationDelay = (i * 0.04) + 's';
    card._auroreDocument = doc;

    const icone = typeof iconePourCategorie === 'function' ? iconePourCategorie(doc) : '';
    const compte = typeof ligneCompteDeposant === 'function' ? ligneCompteDeposant(deposant) : '';
    const taille = typeof tailleBadgeMarkup === 'function' ? tailleBadgeMarkup(doc.Fichier_url) : '';

    card.innerHTML = `
      <div class="admin-card-icon">${icone}</div>
      <div class="admin-card-body">
        <div class="titre">${echapper(doc.Titre)}</div>
        <div class="meta">
          <b>${echapper(doc.Niveau || 'Culture générale')}</b> ${doc.Classe ? '· ' + echapper(doc.Classe) : ''} · ${echapper(doc['Catégorie'] || '')} · ${echapper(matiere)}<br>
          Déposé par ${echapper(doc.Auteur || 'anonyme')}<br>
          <span style="color:var(--gris);">${echapper(compte)}</span>
        </div>
        ${taille}
        <button type="button" class="admin-btn ghost js-open-pdf-in-site">Ouvrir le PDF dans Aurore →</button>
        <button type="button" class="doc-more-btn admin-document-more" data-document-more="1" aria-label="Options de partage" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg></button>
        <div class="admin-actions">
          <button type="button" class="admin-btn valider">Valider</button>
          <button type="button" class="admin-btn refuser">Refuser / Supprimer</button>
        </div>
      </div>
    `;

    card.querySelector('.js-open-pdf-in-site').addEventListener('click', () => {
      const cible = { ...doc, id: doc.id, Titre: doc.Titre || 'Document', Fichier_url: doc.Fichier_url, Telechargement_autorise: doc.Telechargement_autorise !== false };
      if (!cible.Fichier_url) { alert('Le fichier PDF de ce document est introuvable.'); return; }
      if (typeof window.ouvrirLecteurPDF === 'function') window.ouvrirLecteurPDF(cible);
    });
    card.querySelector('.valider').addEventListener('click', async () => {
      if (typeof validerDepot === 'function') await validerDepot(doc.id, card, doc.Titre, deposant);
      apres();
    });
    card.querySelector('.refuser').addEventListener('click', async () => {
      if (typeof refuserDepot === 'function') await refuserDepot(doc.id, card, doc.Titre, deposant);
      apres();
    });
    return card;
  }

  async function charger() {
    const liste = document.getElementById('adminList');
    if (!liste || enCours) return;
    enCours = true;
    liste.innerHTML = '<p class="admin-empty">Chargement…</p>';
    try {
      const data = await lireDepots('*');
      majCompteur(data.length);
      if (typeof actualiserResumeDepotsAttente === 'function') actualiserResumeDepotsAttente(data);
      if (!data.length) {
        liste.innerHTML = '<p class="admin-empty">Aucun dépôt externe en attente. Tout est à jour.</p>';
        outils({ niveaux: [], classes: [], matieres: [], categories: [] });
        return;
      }
      let deposants = new Map();
      try {
        if (typeof recupererDeposants === 'function') deposants = await recupererDeposants(data.map(d => d.id));
      } catch (e) {
        console.warn('[ADMIN][DÉPÔTS EXTERNES] Informations déposants indisponibles ; affichage poursuivi.', e);
      }
      liste.innerHTML = '';
      data.forEach((doc, i) => {
        const card = creerFiche(doc, deposants.get(doc.id) || null, i);
        liste.appendChild(card);
        if (typeof appliquerCouvertureAdmin === 'function') appliquerCouvertureAdmin(card, doc);
      });
      outils({
        niveaux: data.map(d => d.Niveau),
        classes: data.map(d => d.Classe),
        matieres: data.map(d => d['Matière'] || d.Genre),
        categories: data.map(d => d['Catégorie'])
      });
    } catch (err) {
      console.error('[ADMIN][DÉPÔTS EXTERNES] chargement', err);
      liste.innerHTML = '<p class="admin-empty">Impossible de charger les dépôts pour le moment. Veuillez réessayer dans quelques instants.</p>';
    } finally {
      enCours = false;
    }
  }

  // Même mécanique que le gestionnaire d'onglets de l'administration
  // (aurore-admin-users.js) : le panneau « attente » contient la liste des
  // dépôts ; il n'est plus atteignable par l'ancienne carte.
  function ouvrir() {
    const grille = document.getElementById('adminCategoryGrid');
    const detail = document.getElementById('adminDetail');
    const panneau = document.querySelector('.admin-tab-panel[data-panel="attente"]');
    if (!grille || !detail || !panneau) return;
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t === carte));
    document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.toggle('active', p === panneau));
    grille.style.display = 'none';
    detail.style.display = 'block';
    try {
      const dejaEmpile = typeof navigationParPopState !== 'undefined' && navigationParPopState;
      if (!dejaEmpile && typeof creerSnapshotNavigation === 'function') {
        history.pushState({ ...creerSnapshotNavigation('screen-admin', window.scrollY), adminDetail: true }, '', location.href);
      }
    } catch (_) { /* le bouton Retour de la page reste fonctionnel */ }
    charger();
  }

  function init() {
    const grille = document.getElementById('adminCategoryGrid');
    const modele = grille && grille.querySelector('.admin-tab[data-tab="attente"]');
    const panneau = document.querySelector('.admin-tab-panel[data-panel="attente"]');
    if (!grille || !modele || !panneau || grille.querySelector('.admin-tab[data-tab="' + TAB + '"]')) return;

    carte = document.createElement('button');
    carte.type = 'button';
    carte.className = 'admin-tab admin-category-card';
    carte.dataset.tab = TAB;
    carte.dataset.accent = 'ambre';
    carte.setAttribute('role', 'tab');
    carte.innerHTML = '<span aria-hidden="true" class="admin-category-icon"><svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20"><path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg></span>'
      + '<span class="admin-category-title">Dépôts externes</span>'
      + '<span class="admin-category-desc">Documents déposés à valider ou rejeter</span>'
      + '<span class="tab-count" id="' + ID_COMPTEUR + '">0</span>';
    modele.insertAdjacentElement('afterend', carte);
    carte.addEventListener('click', ouvrir);

    // Le panneau n'est plus utilisé que par ce bloc : on le renomme.
    panneau.setAttribute('aria-label', 'Dépôts externes');
    const vue = panneau.querySelector('.admin-pending-overview');
    if (vue) vue.setAttribute('aria-label', 'Vue d’ensemble des dépôts externes');
    const titre = panneau.querySelector('.admin-pending-overview-head h3');
    if (titre) titre.textContent = 'Dépôts externes';
    const texte = panneau.querySelector('.admin-pending-overview-head p');
    if (texte) texte.textContent = 'Documents déposés par les utilisateurs : validez-les pour les publier ou rejetez-les (le déposant est prévenu).';
    const desc = panneau.querySelector(':scope > .admin-panel-desc');
    if (desc) desc.textContent = 'Documents déposés en attente de validation ou de rejet. Utilisez la recherche ou les filtres pour réduire la liste.';

    // « Actualiser » doit recharger les seuls dépôts externes.
    const actualiser = document.getElementById('adminRefreshAttente');
    if (actualiser) {
      actualiser.addEventListener('click', e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        charger();
      }, true);
    }

    document.getElementById('btnAdmin')?.addEventListener('click', () => setTimeout(mettreAJourCompteur, 400));
    setInterval(() => {
      if (estAdmin() && document.getElementById('screen-admin')?.classList.contains('active')) mettreAJourCompteur();
    }, 20000);
    mettreAJourCompteur();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
