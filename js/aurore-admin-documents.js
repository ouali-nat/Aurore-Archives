  async function chargerDepotsEnAttente() {
    const list = document.getElementById('adminList');
    list.innerHTML = '<p class="admin-empty">Chargement…</p>';
    try {
      // Deux circuits doivent apparaître dans « Documents en attente » :
      // 1) les dépôts communautaires classiques (table Document) ;
      // 2) les documents Aurore produits par Content Factory et encore soumis au
      // contrôle humain (aurora_generated_documents). On ne mélange jamais leurs
      // mécanismes de validation/publication : ici on ne fait que les afficher.
      const [res, resAurore] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&Publie=eq.false&order=id.desc`, { headers: headersAdmin() }),
        fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_list_aurora_generated_documents`, { headers: headersAdmin(), cache: 'no-store' })
      ]);
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      if (!resAurore.ok) throw new Error("Statut HTTP Aurore " + resAurore.status);

      const data = await res.json();
      const dataAurore = await resAurore.json();

      const totalAttente = (data?.length || 0) + (dataAurore?.length || 0);
      majCompteurOnglet('tabCountAttente', totalAttente);
      actualiserResumeDepotsAttente(data);

      if ((!data || data.length === 0) && (!dataAurore || dataAurore.length === 0)) {
        list.innerHTML = '<p class="admin-empty">Aucun document en attente. Tout est à jour.</p>';
        actualiserOutilsAdminApresChargement('attente', ADMIN_COLLECTION_CONFIG.attente, {niveaux:[],classes:[],matieres:[],categories:[]});
        return;
      }

      const deposants = await recupererDeposants((data || []).map(d => d.id));

      list.innerHTML = '';

      // Documents déposés par la communauté : comportement historique inchangé.
      (data || []).forEach((doc, i) => {
        const deposant = deposants.get(doc.id) || null;
        const card = document.createElement('div');
        card.className = 'admin-card pending-card';
        card.dataset.adminId = String(doc.id ?? '');
        card.dataset.adminTitle = String(doc.Titre || '');
        card.dataset.adminLevel = String(doc.Niveau || '');
        card.dataset.adminClass = String(doc.Classe || '');
        card.dataset.adminSubject = String(doc['Matière'] || doc.Genre || '');
        card.dataset.adminCategory = String(doc['Catégorie'] || '');
        card.dataset.adminAuthor = String(doc.Auteur || deposant && deposant.nom || '');
        card.dataset.adminSearch = [doc.Titre, doc.Niveau, doc.Classe, doc['Catégorie'], doc['Matière'], doc.Genre, doc.Auteur, deposant && deposant.nom, deposant && deposant.email].filter(v => v != null && String(v).trim()).join(' ');
        card.dataset.adminCategory = String(doc['Catégorie'] || doc.Genre || 'Non classé').trim() || 'Non classé';
        card.dataset.adminAuthor = String(doc.Auteur || '');
        card.dataset.adminSortValue = String(doc.id ?? '0');
        card.style.animationDelay = (i * 0.04) + 's';
        card._auroreDocument = doc;
        card.innerHTML = `
          <div class="admin-card-icon">${iconePourCategorie(doc)}</div>
          <div class="admin-card-body">
            <div class="titre">${doc.Titre || ''}</div>
            <div class="meta">
              <b>${doc.Niveau || 'Culture générale'}</b> ${doc.Classe ? '· ' + doc.Classe : ''} · ${doc['Catégorie'] || ''} · ${doc['Matière'] || doc.Genre || ''}<br>
              Déposé par ${doc.Auteur || 'anonyme'}<br>
              <span style="color:var(--gris);">${ligneCompteDeposant(deposant)}</span>
            </div>
            ${tailleBadgeMarkup(doc.Fichier_url)}
            <button type="button" class="admin-btn ghost js-open-pdf-in-site">Ouvrir le PDF dans Aurore →</button>
            <button type="button" class="doc-more-btn admin-document-more" data-document-more="1" aria-label="Options de partage" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg></button>
            <div class="admin-actions">
              <button class="admin-btn valider">Valider</button>
              <button class="admin-btn refuser">Refuser / Supprimer</button>
            </div>
          </div>
        `;
        const ouvrirAdminPdfAttente = card.querySelector('.js-open-pdf-in-site');
        if (ouvrirAdminPdfAttente) ouvrirAdminPdfAttente.addEventListener('click', () => {
          const cible = {...doc, id: doc.id, Titre: doc.Titre || 'Document', Fichier_url: doc.Fichier_url, Telechargement_autorise: doc.Telechargement_autorise !== false};
          if (!cible.Fichier_url) { alert('Le fichier PDF de ce document est introuvable.'); return; }
          if (typeof window.ouvrirLecteurPDF === 'function') window.ouvrirLecteurPDF(cible);
        });
        card.querySelector('.valider').addEventListener('click', () => validerDepot(doc.id, card, doc.Titre, deposant));
        card.querySelector('.refuser').addEventListener('click', () => refuserDepot(doc.id, card, doc.Titre, deposant));
        list.appendChild(card);
        appliquerCouvertureAdmin(card, doc);
      });

      // Documents Aurore / Content Factory : visibles dès leur arrivée dans
      // aurora_generated_documents, même lorsque le PDF n'est pas encore prêt.
      (dataAurore || []).forEach((doc, i) => {
        const card = document.createElement('div');
        const niveau = doc.level || 'Non précisé';
        const classe = doc.class_name || niveau;
        const matiere = doc.subject || doc.matiere || 'Non précisée';
        const statut = String(doc.status || 'review');
        const pdfUrl = doc.pdf_url || '';
        const statutLabel = statut === 'review'
          ? 'À contrôler'
          : statut === 'processing'
            ? 'PDF en génération'
            : statut === 'queued'
              ? 'En file de génération'
              : 'Document généré — contrôle requis';

        card.className = 'admin-card pending-card aurora-generated-card';
        card.dataset.adminId = 'aurora-' + String(doc.id ?? '');
        card.dataset.adminTitle = String(doc.title || '');
        card.dataset.adminLevel = String(niveau);
        card.dataset.adminClass = String(classe);
        card.dataset.adminSubject = String(matiere);
        card.dataset.adminCategory = 'Aurore — Content Factory';
        card.dataset.adminAuthor = 'Aurore';
        card.dataset.adminSearch = [doc.title, niveau, classe, matiere, 'Aurore', 'Content Factory', statutLabel].filter(Boolean).join(' ');
        card.dataset.adminSortValue = String(doc.id ?? '0');
        card.style.animationDelay = ((data || []).length + i) * 0.04 + 's';
        card.innerHTML = `
          <div class="admin-card-icon">✦</div>
          <div class="admin-card-body">
            <div class="titre">${doc.title || 'Document Aurore sans titre'}</div>
            <div class="meta">
              <b>${niveau}</b> · ${classe} · ${matiere}<br>
              <strong>Aurore — Content Factory</strong> · Auteur : Aurore<br>
              <span style="color:var(--gris);">${statutLabel}</span>
            </div>
            ${pdfUrl
              ? '<button type="button" class="admin-btn ghost js-open-aurora-pdf">Ouvrir le PDF dans Aurore →</button>'
              : '<div class="admin-empty" style="margin:.6rem 0 0;">Le PDF est encore en préparation. Le document reste visible ici pour le contrôle du circuit.</div>'}
            <div class="admin-actions">
              <span class="admin-btn ghost" style="cursor:default;opacity:.85;">Contrôle humain requis</span>
            </div>
          </div>
        `;

        const ouvrirAuroraPdf = card.querySelector('.js-open-aurora-pdf');
        if (ouvrirAuroraPdf) ouvrirAuroraPdf.addEventListener('click', () => {
          if (!pdfUrl) return;
          const cible = {
            id: doc.id,
            Titre: doc.title || 'Document Aurore',
            Fichier_url: pdfUrl,
            Telechargement_autorise: false
          };
          if (typeof window.ouvrirLecteurPDF === 'function') window.ouvrirLecteurPDF(cible);
          else window.open(pdfUrl, '_blank', 'noopener,noreferrer');
        });

        list.appendChild(card);
      });

      actualiserOutilsAdminApresChargement('attente', ADMIN_COLLECTION_CONFIG.attente, {
        niveaux:(data || []).map(d=>d.Niveau).concat((dataAurore || []).map(d=>d.level)),
        classes:(data || []).map(d=>d.Classe).concat((dataAurore || []).map(d=>d.class_name)),
        matieres:(data || []).map(d=>d['Matière'] || d.Genre).concat((dataAurore || []).map(d=>d.subject || d.matiere)),
        categories:(data || []).map(d=>d['Catégorie']).concat((dataAurore || []).map(()=>'Aurore — Content Factory'))
      });
    } catch (err) {
      console.error('[ADMIN][ATTENTE] Échec du chargement des documents en attente :', err);
      list.innerHTML = '<p class="admin-empty">Impossible de charger ces éléments pour le moment. Veuillez réessayer dans quelques instants.</p>';
    }
  }

  document.getElementById('adminRefreshAttente')?.addEventListener('click', () => chargerDepotsEnAttente());
  document.getElementById('adminRefreshPublies')?.addEventListener('click', () => chargerDocumentsPublies());

  async function validerDepot(id, card, titreDocument, deposant) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ Publie: true })
      });
      const text = await res.text();
      if (!res.ok) throw new Error("Statut HTTP " + res.status + " — " + text);

      let data;
      try { data = JSON.parse(text); } catch(e) { data = null; }

      if (!data || data.length === 0) {
        throw new Error("La requête a réussi mais aucune ligne n'a été modifiée. C'est presque toujours un blocage de la policy UPDATE (RLS) sur la table Document — vérifie qu'elle autorise bien la mise à jour publique (USING true, WITH CHECK true).");
      }

      notifierDeposant(deposant, {
        titreDocument,
        statut: 'valide',
        message: `Votre document « ${titreDocument || 'sans titre'} » a été validé et publié sur ${SITE_NOM}.`
      });

      card.remove();
      const list = document.getElementById('adminList');
      if (!list.querySelector('.admin-card')) list.innerHTML = '<p class="admin-empty">Aucun dépôt en attente. Tout est à jour.</p>';
      majCompteurOnglet('tabCountAttente', list.querySelectorAll('.admin-card').length);
      actualiserResumeDepotsAttente([...list.querySelectorAll('.pending-card')].map(c => ({Titre:c.dataset.adminTitle, 'Catégorie':c.dataset.adminCategory || '' ,Auteur:c.dataset.adminAuthor || ''})));
      chargerDocumentsPublies();
    } catch (err) {
      alert("La validation n’a pas pu être effectuée pour le moment. Veuillez réessayer.");
    }
  }

  async function refuserDepot(id, card, titreDocument, deposant) {
    // Un seul dialogue combine confirmation + motif facultatif : annuler
    // (Annuler/Échap) abandonne le refus, comme avant avec confirm() seul.
    // Un motif vide reste accepté (facultatif) pour ne pas complexifier un
    // refus rapide ; s'il est renseigné, il est inclus tel quel dans le
    // message envoyé au déposant (aucune colonne supplémentaire nécessaire :
    // le motif fait simplement partie du texte de la notification, que la
    // table "Notifications" stocke déjà dans sa colonne "message").
    const motif = prompt(
      "Refuser ce dépôt ?\n\nVous pouvez indiquer un motif qui sera envoyé au déposant (facultatif — laissez vide si vous ne souhaitez pas en préciser un).\n\nCliquez sur Annuler pour ne rien faire.",
      ""
    );
    if (motif === null) return; // L'administrateur a annulé : le dépôt reste en attente, inchangé.
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${id}`, {
        method: 'DELETE',
        headers: { ...headersAdmin(), 'Prefer': 'return=representation' }
      });
      const text = await res.text();
      if (!res.ok) throw new Error("Statut HTTP " + res.status + " — " + text);

      let data;
      try { data = JSON.parse(text); } catch(e) { data = null; }

      if (!data || data.length === 0) {
        throw new Error("La requête a réussi mais aucune ligne n'a été supprimée. Vérifie la policy DELETE (RLS) sur la table Document.");
      }

      const motifPropre = (motif || '').trim();
      const message = motifPropre
        ? `Votre document « ${titreDocument || 'sans titre'} » n'a pas été publié sur ${SITE_NOM}. Motif indiqué par l'administrateur : « ${motifPropre} »`
        : `Votre document « ${titreDocument || 'sans titre'} » n'a pas été publié sur ${SITE_NOM}.`;

      notifierDeposant(deposant, { titreDocument, statut: 'refuse', message });

      card.remove();
      const list = document.getElementById('adminList');
      if (!list.querySelector('.admin-card')) list.innerHTML = '<p class="admin-empty">Aucun dépôt en attente. Tout est à jour.</p>';
      majCompteurOnglet('tabCountAttente', list.querySelectorAll('.admin-card').length);
    } catch (err) {
      alert("La suppression n’a pas pu être effectuée pour le moment. Veuillez réessayer.");
    }
  }

  // Ouvre l’emplacement public exact d’un document publié, sans exposer son
  // URL PDF. La page publique ?document=ID reconstruit la rubrique
  // (catégorie / niveau / matière / classe / série) puis met le document en évidence.
  function voirEmplacementPublicDocument(doc) {
    const id = doc?.id ?? doc?.ID ?? doc?.document_id;
    if (id == null || String(id).trim() === '') {
      alert('L’emplacement public de ce document est indisponible : identifiant manquant.');
      return;
    }
    const url = obtenirUrlDocumentPartage({ id });
    if (!url) {
      alert('Impossible de déterminer l’emplacement public de ce document.');
      return;
    }
    // L’administrateur garde son espace ouvert ; l’emplacement public s’ouvre
    // dans un nouvel onglet. Le paramètre ?document=ID est déjà pris en charge
    // par ouvrirDocumentDepuisLienPartage().
    const fenetre = window.open(url, '_blank', 'noopener,noreferrer');
    if (!fenetre) {
      // Secours si le navigateur bloque window.open : on navigue dans l’onglet courant.
      window.location.assign(url);
    }
  }

  window.voirEmplacementPublicDocument = voirEmplacementPublicDocument;

  async function chargerDocumentsPublies() {
    const list = document.getElementById('adminListPublies');
    list.innerHTML = '<p class="admin-empty">Chargement…</p>';
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&Publie=eq.true&order=id.desc`, { headers: HEADERS });
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      const data = await res.json();
      majCompteurOnglet('tabCountPublies', data ? data.length : 0);
      actualiserResumeDepotsPublies(data);

      if (!data || data.length === 0) {
        list.innerHTML = '<p class="admin-empty">Aucun document publié pour l\'instant.</p>';
        actualiserOutilsAdminApresChargement('publies', ADMIN_COLLECTION_CONFIG.publies, {niveaux:[],classes:[],matieres:[]});
        return;
      }

      const deposants = await recupererDeposants(data.map(d => d.id));

      list.innerHTML = '';
      data.forEach((doc, i) => {
        const deposant = deposants.get(doc.id) || null;
        const card = document.createElement('div');
        card.className = 'admin-card pending-card published-card';
        card.dataset.adminId = String(doc.id ?? '');
        card.dataset.adminTitle = String(doc.Titre || '');
        card.dataset.adminLevel = String(doc.Niveau || '');
        card.dataset.adminClass = String(doc.Classe || '');
        card.dataset.adminSubject = String(doc['Matière'] || doc.Genre || '');
        card.dataset.adminCategory = String(doc['Catégorie'] || '');
        card.dataset.adminAuthor = String(doc.Auteur || deposant && deposant.nom || '');
        card.dataset.adminSearch = [doc.Titre, doc.Niveau, doc.Classe, doc['Catégorie'], doc['Matière'], doc.Genre, doc.Auteur, deposant && deposant.nom, deposant && deposant.email].filter(v => v != null && String(v).trim()).join(' ');
        card.dataset.adminSortValue = String(doc.id ?? '0');
        card.style.animationDelay = (i * 0.04) + 's';
        const telechargementOk = doc.Telechargement_autorise !== false;
        // Mis_en_avant : colonne optionnelle (voir migration SQL fournie) pour
        // la sélection "Documents récemment publiés" de l'accueil. Tant que la
        // colonne n'existe pas encore côté Supabase, on considère simplement
        // qu'aucun document n'est mis en avant (false), sans casser l'affichage.
        const misEnAvant = doc.Mis_en_avant === true;
        card.innerHTML = `
          <div class="admin-card-icon">${iconePourCategorie(doc)}</div>
          <div class="admin-card-body">
            <div class="titre">${doc.Titre || ''}</div>
            <div class="meta">
              <b>${doc.Niveau || 'Culture générale'}</b> ${doc.Classe ? '· ' + doc.Classe : ''} · ${doc['Catégorie'] || ''} · ${doc['Matière'] || doc.Genre || ''}<br>
              Déposé par ${doc.Auteur || 'anonyme'} · <span class="dl-status">${telechargementOk ? 'Lecture + téléchargement' : 'Lecture seule'}</span><br>
              <span style="color:var(--gris);">${ligneCompteDeposant(deposant)}</span>
            </div>
            ${tailleBadgeMarkup(doc.Fichier_url)}
            <div class="admin-published-location-actions">
              <button type="button" class="admin-btn ghost js-view-public-location" title="Voir où ce document apparaît sur le site public" aria-label="Voir l’emplacement public de ce document"><span aria-hidden="true">◉</span> Voir l’emplacement</button>
              <button type="button" class="admin-btn ghost js-open-pdf-in-site">Ouvrir le PDF dans Aurore →</button>
            </div>
            <button type="button" class="doc-more-btn admin-document-more" data-document-more="1" aria-label="Options de partage" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg></button>
            <div class="admin-actions">
              <button class="admin-btn ghost dl-toggle">${telechargementOk ? 'Passer en lecture seule' : 'Autoriser le téléchargement'}</button>
              <button class="admin-btn ghost avant-toggle">${misEnAvant ? 'Retirer de « Récemment publiés »' : 'Mettre dans « Récemment publiés »'}</button>
              <button class="admin-btn refuser">Supprimer</button>
            </div>
          </div>
        `;
        const voirEmplacementPublie = card.querySelector('.js-view-public-location');
        if (voirEmplacementPublie) voirEmplacementPublie.addEventListener('click', () => {
          voirEmplacementPublicDocument(doc);
        });
        const ouvrirAdminPdfPublie = card.querySelector('.js-open-pdf-in-site');
        if (ouvrirAdminPdfPublie) ouvrirAdminPdfPublie.addEventListener('click', () => {
          const cible = {...doc, id: doc.id, Titre: doc.Titre || 'Document', Fichier_url: doc.Fichier_url, Telechargement_autorise: doc.Telechargement_autorise !== false};
          if (!cible.Fichier_url) { alert('Le fichier PDF de ce document est introuvable.'); return; }
          if (typeof window.ouvrirLecteurPDF === 'function') window.ouvrirLecteurPDF(cible);
        });
        card.querySelector('.refuser').addEventListener('click', () => supprimerDocumentPublie(doc.id, card));
        card.querySelector('.dl-toggle').addEventListener('click', () => basculerTelechargementDocument(doc, card));
        card.querySelector('.avant-toggle').addEventListener('click', () => basculerMiseEnAvantDocument(doc, card));
        list.appendChild(card);
        appliquerCouvertureAdmin(card, doc);
      });
      actualiserOutilsAdminApresChargement('publies', ADMIN_COLLECTION_CONFIG.publies, {
        niveaux:data.map(d=>d.Niveau), classes:data.map(d=>d.Classe), matieres:data.map(d=>d['Matière'] || d.Genre), categories:data.map(d=>d['Catégorie'])
      });
    } catch (err) {
      list.innerHTML = `<p class="admin-empty">Impossible de charger ces éléments pour le moment. Veuillez réessayer dans quelques instants.</p>`;
    }
  }

  async function basculerTelechargementDocument(doc, card) {
    const nouvelleValeur = doc.Telechargement_autorise === false ? true : false;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${doc.id}`, {
        method: 'PATCH',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ Telechargement_autorise: nouvelleValeur })
      });
      if (!res.ok) {
        const detail = await res.text().catch(()=> '');
        throw new Error(detail || ('HTTP ' + res.status));
      }
      doc.Telechargement_autorise = nouvelleValeur;
      card.querySelector('.dl-status').textContent = nouvelleValeur ? 'Lecture + téléchargement' : 'Lecture seule';
      card.querySelector('.dl-toggle').textContent = nouvelleValeur ? 'Passer en lecture seule' : 'Autoriser le téléchargement';
    } catch (err) {
      alert("Le mode de lecture n’a pas pu être modifié pour le moment. Veuillez réessayer.");
    }
  }

  // Ajoute/retire un document de la sélection "Documents récemment publiés"
  // (accueil). Ne touche jamais à Publie ni ne supprime rien : uniquement la
  // colonne "Mis_en_avant" (voir migration SQL fournie). Nécessite que cette
  // colonne existe déjà côté Supabase ; sinon échoue proprement avec un message
  // clair plutôt que de casser l'affichage.
  async function basculerMiseEnAvantDocument(doc, card) {
    const nouvelleValeur = doc.Mis_en_avant === true ? false : true;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${doc.id}`, {
        method: 'PATCH',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ Mis_en_avant: nouvelleValeur })
      });
      if (!res.ok) {
        const detail = await res.text().catch(()=> '');
        throw new Error(detail || ('HTTP ' + res.status));
      }
      doc.Mis_en_avant = nouvelleValeur;
      card.querySelector('.avant-toggle').textContent = nouvelleValeur ? 'Retirer de « Récemment publiés »' : 'Mettre dans « Récemment publiés »';
    } catch (err) {
      alert("La mise en avant n’a pas pu être modifiée pour le moment. Vérifiez la configuration puis réessayez.");
    }
  }

  async function supprimerDocumentPublie(id, card) {
    if (!confirm("Retirer définitivement ce document du site ?")) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${id}`, {
        method: 'DELETE',
        headers: { ...headersAdmin(), 'Prefer': 'return=representation' }
      });
      const text = await res.text();
      if (!res.ok) throw new Error("Statut HTTP " + res.status + " — " + text);

      let data;
      try { data = JSON.parse(text); } catch(e) { data = null; }

      if (!data || data.length === 0) {
        throw new Error("La requête a réussi mais aucune ligne n'a été supprimée. Vérifie la policy DELETE (RLS) sur la table Document.");
      }

      card.remove();
      const list = document.getElementById('adminListPublies');
      if (!list.querySelector('.admin-card')) list.innerHTML = '<p class="admin-empty">Aucun document publié pour l\'instant.</p>';
      majCompteurOnglet('tabCountPublies', list.querySelectorAll('.admin-card').length);
    } catch (err) {
      alert("La suppression n’a pas pu être effectuée pour le moment. Veuillez réessayer.");
    }
  }

  async function lireDocumentsSuspendusAdmin() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_documents_suspendus?select=document_id&order=suspendu_at.desc`, {
      headers: headersAdmin(), cache: 'no-store'
    });
    if(!res.ok){
      const detail=await res.text().catch(()=> '');
      throw new Error(detail || ('HTTP '+res.status));
    }
    return await res.json().catch(()=>[]);
  }

  async function actualiserBoutonRepublicationAdmin() {
    const rep=document.getElementById('adminRepublierTout');
    if(!rep || !session || session.role!=='admin') return;
    try {
      const suspendus=await lireDocumentsSuspendusAdmin();
      const actif=Array.isArray(suspendus) && suspendus.length>0;
      rep.style.display=actif ? 'inline-flex' : 'none';
      const hint=document.getElementById('adminGlobalPublishHint');
      if(hint && actif) hint.textContent='Des documents ont été suspendus. Utilisez « Republier tous » pour les ramener.';
    } catch(e) {
      console.warn('[Admin] état des suspensions globales indisponible',e);
    }
  }

  async function suspendreTousLesDocumentsAdmin() {
    if(!session || session.role !== 'admin'){alert('Cette action est réservée aux administrateurs.');return;}
    if(!confirm('Suspendre tous les documents publiés ?\n\nIls seront retirés du site public sans être supprimés. Ils pourront être ramenés avec « Republier tous ».')) return;
    const btn=document.getElementById('adminSuspendreTout');
    if(btn){btn.disabled=true;btn.textContent='Suspension…';}
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/suspendre_tous_documents_admin`,{method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json'},body:'{}'});
      const detail=await res.text().catch(()=> '');
      if(!res.ok) throw new Error(detail||('HTTP '+res.status));
      await chargerDocumentsPublies();
      await chargerDepotsEnAttente();
      await actualiserBoutonRepublicationAdmin();
      const hint=document.getElementById('adminGlobalPublishHint');
      if(hint) hint.textContent='Les documents ont été suspendus. Utilisez « Republier tous » pour les ramener.';
      alert('Le site public a été suspendu. Les documents sont conservés.');
    }catch(e){console.error('[Admin] suspension globale',e);alert('La suspension globale n’a pas pu être effectuée. '+(e.message||'Vérifiez le SQL administrateur puis réessayez.'));}
    finally{if(btn){btn.disabled=false;btn.textContent='⏸ Suspendre tous';}}
  }

  async function republierTousLesDocumentsAdmin() {
    if(!session || session.role !== 'admin'){alert('Cette action est réservée aux administrateurs.');return;}
    if(!confirm('Republier tous les documents précédemment suspendus ?')) return;
    const btn=document.getElementById('adminRepublierTout');
    if(btn){btn.disabled=true;btn.textContent='Republication…';}
    try{
      // On vérifie d'abord ce qui doit réellement être restauré. Cela évite
      // un faux succès si la RPC retourne 0 alors que des suspensions existent.
      const suspendus=await lireDocumentsSuspendusAdmin();
      const ids=(Array.isArray(suspendus)?suspendus:[]).map(x=>String(x.document_id||'')).filter(Boolean);
      if(!ids.length){
        if(btn) btn.style.display='none';
        const hint=document.getElementById('adminGlobalPublishHint');
        if(hint) hint.textContent='Aucun document suspendu à republier.';
        alert('Aucun document suspendu n’est actuellement mémorisé.');
        return;
      }

      const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/ramener_tous_documents_admin`,{method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json'},body:'{}'});
      const detail=await res.text().catch(()=> '');
      if(!res.ok) throw new Error(detail||('HTTP '+res.status));
      let rpcCount=0; try { rpcCount=Number(JSON.parse(detail)); } catch(e) { rpcCount=0; }

      // Sécurité de fonctionnement : si la RPC répond sans avoir restauré les
      // documents mémorisés, on restaure exactement ces IDs via la table
      // Document, puis on nettoie leur mémorisation. Aucun autre document n'est touché.
      if(rpcCount===0){
        const filtre=ids.map(id=>encodeURIComponent(id)).join(',');
        const patch=await fetch(`${SUPABASE_URL}/rest/v1/Document?id=in.(${filtre})`,{
          method:'PATCH',
          headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=representation'},
          body:JSON.stringify({Publie:true})
        });
        const patchText=await patch.text().catch(()=> '');
        if(!patch.ok) throw new Error('La RPC n’a restauré aucun document et la restauration de secours a échoué (HTTP '+patch.status+'). '+patchText);
        let restored=[]; try { restored=JSON.parse(patchText); } catch(e) { restored=[]; }
        if(!Array.isArray(restored) || restored.length===0) throw new Error('Aucun des documents suspendus n’a pu être restauré.');
        // Nettoyage sécurisé : un DELETE par document avec un filtre eq explicite.
        // Cela évite l'erreur PostgREST « DELETE requires a WHERE clause »
        // rencontrée avec le filtre IN global.
        for(const id of ids){
          const del=await fetch(`${SUPABASE_URL}/rest/v1/admin_documents_suspendus?document_id=eq.${encodeURIComponent(id)}`,{
            method:'DELETE',
            headers:{...headersAdmin(),'Prefer':'return=minimal'}
          });
          if(!del.ok){
            const dd=await del.text().catch(()=> '');
            throw new Error('Les documents ont été republiés mais la mémorisation du document '+id+' n’a pas pu être nettoyée. '+dd);
          }
        }
        rpcCount=restored.length;
      }

      await chargerDocumentsPublies();
      await chargerDepotsEnAttente();
      if(btn) btn.style.display='none';
      const hint=document.getElementById('adminGlobalPublishHint');
      if(hint) hint.textContent='Les documents suspendus ont été ramenés sur le site public.';
      alert(rpcCount+' document(s) suspendu(s) ont été republiés.');
    }catch(e){console.error('[Admin] republication globale',e);alert('La republication globale n’a pas pu être effectuée. '+(e.message||'Vérifiez le SQL administrateur puis réessayez.'));}
    finally{if(btn){btn.disabled=false;btn.textContent='↻ Republier tous';}}
  }

  document.getElementById('adminSuspendreTout')?.addEventListener('click',suspendreTousLesDocumentsAdmin);
  document.getElementById('adminRepublierTout')?.addEventListener('click',republierTousLesDocumentsAdmin);

  // ---------- DÉTECTION DES DOUBLONS PUBLIÉS ----------
  // Analyse volontairement déclenchée par l'administrateur. Les documents sont
  // comparés par SHA-256 du contenu réel. Aucun document n'est supprimé pendant
  // l'analyse.
  const adminDuplicateHashCache = new Map();

  async function recupererDocumentPubliesPourDoublons() {
    const params = new URLSearchParams();
    params.set('select','id,Titre,Niveau,Filiere,Classe,"Matière","Catégorie",Genre,Auteur,Fichier_url,Publie');
    params.set('Publie','eq.true');
    params.set('order','id.desc');
    params.set('limit','5000');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?${params.toString()}`, {headers: headersAdmin(), cache:'no-store'});
    if(!res.ok){
      const detail=await res.text().catch(()=> '');
      throw new Error('Lecture des documents publiés impossible (HTTP '+res.status+'). '+detail);
    }
    return await res.json();
  }

  async function tailleEtHashDocumentDoublon(doc){
    if(!doc || !doc.Fichier_url) return {taille:0,hash:null};
    const cacheKey=String(doc.Fichier_url);
    if(adminDuplicateHashCache.has(cacheKey)) return adminDuplicateHashCache.get(cacheKey);
    const octets=await recupererOctetsPDF(doc.Fichier_url);
    const blob=new Blob([octets]);
    const hash=await empreinteSha256(blob);
    const result={taille:blob.size,hash};
    adminDuplicateHashCache.set(cacheKey,result);
    return result;
  }

  function afficherGroupesDoublonsAdmin(groupes, erreurs=0){
    const list=document.getElementById('adminDuplicatesList');
    const count=document.getElementById('tabCountDoublons');
    if(count) count.textContent=String(groupes.reduce((n,g)=>n+g.documents.length,0));
    if(!list) return;
    if(!groupes.length){
      list.innerHTML='<div class="admin-duplicate-empty success">Aucun doublon strict détecté parmi les documents publiés.</div>' +
        (erreurs ? `<div class="admin-duplicate-note">${erreurs} document(s) n’ont pas pu être vérifiés. Ils ne sont pas déclarés doublons par prudence.</div>` : '');
      return;
    }
    list.innerHTML='';
    groupes.forEach((g,idx)=>{
      const wrap=document.createElement('div');
      wrap.className='admin-duplicate-group';
      const docs=g.documents;
      wrap.innerHTML=`<div class="admin-duplicate-group-head"><div><strong>Doublon #${idx+1}</strong><span>${docs.length} exemplaires · ${formaterTailleTelechargement(g.taille)}</span></div><span class="admin-duplicate-hash">SHA-256 : ${g.hash.slice(0,16)}…</span></div><div class="admin-duplicate-items"></div>`;
      const items=wrap.querySelector('.admin-duplicate-items');
      docs.forEach(doc=>{
        const item=document.createElement('div');
        item.className='admin-duplicate-item';
        item.innerHTML=`<div class="admin-duplicate-item-main"><strong>${echapperHtmlPub(doc.Titre||'Sans titre')}</strong><span>${echapperHtmlPub([doc.Niveau,doc.Classe,doc['Matière']||doc.Genre].filter(Boolean).join(' · ')||'Informations non renseignées')}</span><small>${echapperHtmlPub(nomFichierExactDepuisUrl(doc.Fichier_url))}</small></div><div class="admin-duplicate-item-actions"><button type="button" class="admin-btn ghost js-open-pdf-in-site">Ouvrir dans Aurore</button><button type="button" class="admin-btn refuser" data-duplicate-delete="1">Exclure du site</button></div>`;
        item.querySelector('[data-duplicate-delete="1"]').addEventListener('click',()=>exclureDoublonAdmin(doc.id,doc.Titre,wrap));
        item.querySelector('.js-open-pdf-in-site')?.addEventListener('click',()=>{
          const cible={...doc,id:doc.id,Titre:doc.Titre||'Document',Fichier_url:doc.Fichier_url,Telechargement_autorise:doc.Telechargement_autorise!==false};
          if(!cible.Fichier_url){alert('Le fichier PDF de ce document est introuvable.');return;}
          if(typeof window.ouvrirLecteurPDF==='function')window.ouvrirLecteurPDF(cible);
        });
        items.appendChild(item);
      });
      list.appendChild(wrap);
    });
    if(erreurs){
      const note=document.createElement('div'); note.className='admin-duplicate-note';
      note.textContent=`${erreurs} document(s) n’ont pas pu être vérifiés (réseau ou fichier inaccessible). Ils ne sont pas déclarés doublons par prudence.`;
      list.prepend(note);
    }
  }

  async function chargerDoublonsAdmin(){
    const list=document.getElementById('adminDuplicatesList');
    const status=document.getElementById('adminDuplicatesStatus');
    const btn=document.getElementById('adminDuplicatesRefresh');
    if(!list||!status) return;
    if(btn) btn.disabled=true;
    list.innerHTML='<div class="admin-duplicate-empty">Analyse des documents publiés…</div>';
    status.textContent='Récupération des documents publiés…';
    adminDuplicateHashCache.clear();
    try{
      const docs=await recupererDocumentPubliesPourDoublons();
      if(!docs.length){
        afficherGroupesDoublonsAdmin([]);
        status.textContent='Analyse terminée : aucun document publié à analyser.';
        return;
      }

      // Regroupement progressif par taille : les tailles sont calculées depuis
      // les octets réellement récupérés, donc aucun HEAD/CORS particulier n'est
      // requis pour décider si deux fichiers sont candidats.
      const parTaille=new Map();
      let erreurs=0;
      for(let i=0;i<docs.length;i++){
        const doc=docs[i];
        status.textContent=`Lecture des fichiers ${i+1}/${docs.length}…`;
        try{
          const info=await tailleEtHashDocumentDoublon(doc);
          doc.__dupSize=info.taille;
          doc.__dupHash=info.hash;
          if(!parTaille.has(String(info.taille))) parTaille.set(String(info.taille),[]);
          parTaille.get(String(info.taille)).push(doc);
        }catch(e){
          erreurs++;
          console.warn('[Doublons admin] document non vérifiable',doc.id,e);
        }
      }

      const parHash=new Map();
      for(const arr of parTaille.values()){
        if(arr.length<2) continue;
        for(const doc of arr){
          if(!doc.__dupHash) continue;
          if(!parHash.has(doc.__dupHash)) parHash.set(doc.__dupHash,[]);
          parHash.get(doc.__dupHash).push(doc);
        }
      }
      const groupes=[];
      for(const [hash,arr] of parHash.entries()){
        if(arr.length>1) groupes.push({taille:Number(arr[0].__dupSize)||0,hash,documents:arr});
      }
      groupes.sort((a,b)=>b.documents.length-a.documents.length || b.taille-a.taille);
      afficherGroupesDoublonsAdmin(groupes,erreurs);
      status.textContent=groupes.length
        ? `${groupes.length} groupe(s) de doublons stricts détecté(s).`
        : (erreurs ? `Analyse terminée : aucun doublon confirmé. ${erreurs} document(s) n’ont pas pu être vérifiés.` : 'Analyse terminée : aucun doublon strict détecté.');
    }catch(e){
      console.error('[Doublons admin]',e);
      list.innerHTML=`<div class="admin-duplicate-empty error">Impossible d’analyser les documents publiés. ${echapperHtmlPub(e.message||'Erreur inconnue.')}</div>`;
      status.textContent='Analyse impossible.';
    }finally{if(btn) btn.disabled=false;}
  }

  async function exclureDoublonAdmin(id,titre,groupCard){
    if(!confirm(`Exclure « ${titre||'ce document'} » du site ?\n\nLe document sera simplement dépublié. Il ne sera PAS supprimé de la base de données ni du stockage.`)) return;
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${encodeURIComponent(id)}`,{
        method:'PATCH',
        headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=representation'},
        body:JSON.stringify({Publie:false})
      });
      const text=await res.text();
      if(!res.ok) throw new Error(text||('HTTP '+res.status));
      let data=[]; try{data=JSON.parse(text)||[]}catch(e){}
      if(!data.length) throw new Error('Aucune modification effectuée. Vérifie la policy UPDATE.');
      await chargerDoublonsAdmin();
      await chargerDocumentsPublies();
    }catch(e){
      console.error('[Exclusion doublon]',e);
      alert('Le document n’a pas pu être exclu du site pour le moment. Vérifie les permissions administrateur puis réessaie.');
    }
  }

  document.getElementById('adminDuplicatesRefresh')?.addEventListener('click',chargerDoublonsAdmin);

  // ---------- RÉCLAMATIONS / SIGNALEMENTS (droits d'auteur) ----------
  // Nécessite la table "Signalements" (déjà créée avec ses policies RLS — voir
  // SQL fourni précédemment : insertion publique, lecture/écriture admin
  // uniquement via la fonction is_admin()).
  async function chargerReclamationsAdmin() {
    const list = document.getElementById('adminListReclamations');
    list.innerHTML = '<p class="admin-empty">Chargement…</p>';
    try {
      // On n'affiche que les réclamations non traitées : dès qu'un signalement
      // est marqué "traité", il disparaît de cette liste (mais reste en base).
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Signalements?select=*&statut=neq.traite&order=id.desc`, { headers: headersAdmin() });
      if (!res.ok) {
        if (res.status === 404 || res.status === 400) {
          list.innerHTML = '<p class="admin-empty">Aucune réclamation pour l\'instant.</p>';
          majCompteurOnglet('tabCountReclamations', 0);
          return;
        }
        throw new Error("Statut HTTP " + res.status);
      }
      const data = await res.json();
      majCompteurOnglet('tabCountReclamations', data ? data.length : 0);
      if (!data || data.length === 0) {
        list.innerHTML = '<p class="admin-empty">Aucune réclamation pour l\'instant.</p>';
        actualiserOutilsAdminApresChargement('reclamations', ADMIN_COLLECTION_CONFIG.reclamations, {statuts:[]});
        return;
      }
      list.innerHTML = '';
      data.forEach((r, i) => {
        const card = document.createElement('div');
        card.className = 'admin-card';
        card.dataset.adminId = String(r.id ?? '');
        card.dataset.adminTitle = String(r.document_titre || ('Document #' + r.document_id));
        card.dataset.adminStatus = String(r.statut || '');
        card.dataset.adminSearch = [r.document_titre, r.document_id, r.motif, r.statut, r.nom, r.email, r.details].filter(v => v != null).join(' ');
        card.dataset.adminSortValue = String(r.id ?? '0');
        card.style.animationDelay = (i * 0.04) + 's';
        // Un signalement n'est pas un document : conserver le signalement lui-même
        // évite une ReferenceError qui interrompait tout le rendu de la liste admin.
        card._auroreSignalement = r;
        card.innerHTML = `
          <div class="admin-card-icon">${ICONS.warning}</div>
          <div class="admin-card-body">
            <div class="titre">${echapperHtmlPub(r.document_titre || ('Document #' + r.document_id))}</div>
            <div class="meta">
              <b>${echapperHtmlPub(r.motif || '')}</b> · Statut : ${echapperHtmlPub(r.statut || 'nouveau')}<br>
              Signalé par ${echapperHtmlPub(r.nom || 'anonyme')} (${echapperHtmlPub(r.email || 'sans email')})<br>
              ${r.details ? echapperHtmlPub(r.details) : ''}
            </div>
            <div class="admin-actions">
              <button class="admin-btn ghost" data-action="ouvrir">Ouvrir le document</button>
              <button class="admin-btn refuser" data-action="retirer">Retirer le document</button>
              <button class="admin-btn ghost" data-action="traite">Marquer traité</button>
            </div>
          </div>
        `;
        card.querySelector('[data-action="ouvrir"]').addEventListener('click', async () => {
          try {
            if (!r.document_id) {
              alert("Ce signalement ne contient pas d'identifiant de document. Le document associé ne peut pas être ouvert automatiquement.");
              return;
            }
            const dres = await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${encodeURIComponent(r.document_id)}&select=id,Fichier_url,Titre,Telechargement_autorise`, { headers: HEADERS });
            if (!dres.ok) throw new Error('HTTP ' + dres.status);
            const ddata = await dres.json();
            // Reste à l'intérieur d'Aurore : ouverture via le lecteur PDF
            // interne, jamais via un nouvel onglet / lecteur externe.
            if (ddata && ddata[0] && ddata[0].Fichier_url) {
              ouvrirLecteurPDF({
                id: ddata[0].id,
                Titre: ddata[0].Titre || r.document_titre || 'Document',
                Fichier_url: ddata[0].Fichier_url,
                Telechargement_autorise: ddata[0].Telechargement_autorise
              });
            } else {
              alert("Le document associé est introuvable (peut-être déjà retiré).");
            }
          } catch(e) {
            console.error('[Réclamations] ouverture du document', e);
            alert("Impossible d'ouvrir le document pour le moment. Vérifiez que le PDF associé existe encore.");
          }
        });
        card.querySelector('[data-action="retirer"]').addEventListener('click', async () => {
          if (!confirm("Retirer définitivement le document concerné par cette réclamation ?")) return;
          try {
            const dres = await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${r.document_id}`, { method:'DELETE', headers: { ...headersAdmin(), 'Prefer':'return=representation' } });
            if (!dres.ok) throw new Error('HTTP ' + dres.status);
            await marquerReclamation(r.id, 'traite');
            chargerReclamationsAdmin();
            chargerDocumentsPublies();
          } catch(e) { alert("Le retrait du document n’a pas pu être effectué pour le moment. Veuillez réessayer."); }
        });
        card.querySelector('[data-action="traite"]').addEventListener('click', async () => {
          if (!confirm("Marquer ce signalement comme traité ? Il disparaîtra de la liste des réclamations en attente.")) return;
          await marquerReclamation(r.id, 'traite');
          // Rechargement complet depuis Supabase pour refléter fidèlement l'état
          // en base (évite tout doublon ou incohérence visuelle).
          await chargerReclamationsAdmin();
        });
        list.appendChild(card);
      });
      actualiserOutilsAdminApresChargement('reclamations', ADMIN_COLLECTION_CONFIG.reclamations, {statuts:data.map(r=>r.statut)});
    } catch (err) {
      list.innerHTML = `<p class="admin-empty">Impossible de charger ces éléments pour le moment. Veuillez réessayer dans quelques instants.</p>`;
    }
  }

  async function marquerReclamation(id, statut) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/Signalements?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ statut })
      });
    } catch(e) { console.error('[Réclamations] mise à jour du statut échouée', e); }
  }

  // ---------- AURASTER : publicités multiples (emplacements publics + gestion admin) ----------
  // Table Supabase réelle : public."Publicites"
  // Colonnes : id (bigint), image_url (text), link_url (text), alt_text (text),
  // active (boolean), created_at (timestamptz), updated_at (timestamptz).
  // Pas de colonne "titre" ni "description" : le formulaire admin n'a qu'un seul
  // champ texte, mappé directement sur alt_text.
  const PUB_TABLE = 'Publicites';
  // Une publicité par emplacement, deux emplacements par secteur, jamais identiques côte à côte.
  const AD_PAGES = ['home','livres','niveaux','series','matieres','docs'];

  let PUBS_ACTIVES = [];
  // Décalage aléatoire tiré une fois par visite : fait varier la sélection d'une session
  // à l'autre sans jamais faire apparaître deux annonces identiques sur un même secteur.
  const PUB_OFFSET = Math.floor(Math.random()*97);

  // Le détail technique reste dans la console pour le diagnostic développeur, ET est
  // maintenant inclus dans le message affiché à l'admin (plus de message générique qui
  // masquait l'erreur réelle).
  function messageErreurPublicite(e, contexte){
    console.error('[Publicité]', contexte, e);
    if(e instanceof TypeError){
      // fetch() rejette avec un TypeError générique en cas de coupure réseau, de blocage
      // CORS, ou d'un bloqueur qui filtre la requête. On garde le message technique brut
      // ("Failed to fetch") visible en plus de l'explication, pour ne rien cacher.
      return 'Le service publicitaire est momentanément indisponible. Vérifiez votre connexion puis réessayez.';
    }
    return 'Une erreur est survenue lors de cette opération. Veuillez réessayer.';
  }

  function echapperHtmlPub(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ----- Diagnostic réseau en couches (déclenché quand la requête principale échoue) -----
  // Objectif : distinguer domaine inaccessible / CORS / clé anon incorrecte / bloqueur réseau.
  async function diagnostiquerReseauPublicites(){
    console.log('%c[Publicité][DIAG-RÉSEAU] Démarrage du diagnostic en couches…', 'color:#f59e0b;font-weight:bold');

    // --- Test 1 : le domaine Supabase est-il joignable, indépendamment du CORS ? ---
    // mode:'no-cors' envoie quand même la requête au réseau mais ne lève jamais d'erreur
    // CORS : si CE test échoue aussi, le problème n'est pas le CORS mais un blocage plus
    // en amont (DNS, réseau coupé, ou un bloqueur/extension qui empêche la requête de
    // partir du tout — cas fréquent avec un mot comme "Publicites" dans l'URL).
    let domaineJoignable = null;
    try{
      await fetch(SUPABASE_URL, { mode:'no-cors' });
      domaineJoignable = true;
      console.log('[Publicité][DIAG-RÉSEAU] Test 1/4 — domaine Supabase joignable (réponse reçue, même opaque en no-cors). ✅');
    }catch(e){
      domaineJoignable = false;
      console.error('[Publicité][DIAG-RÉSEAU] Test 1/4 — ÉCHEC : le domaine Supabase n\'est même pas joignable en no-cors.', e);
      console.error('[Publicité][DIAG-RÉSEAU] → La requête ne quitte probablement jamais le navigateur : DNS local en échec, connexion internet coupée, ou un bloqueur réseau/extension (adblock, antivirus, proxy d\'entreprise ou scolaire) qui coupe la requête avant même le CORS. Teste dans un onglet de navigation privée sans extension, ou depuis un autre réseau, pour confirmer.');
    }

    // --- Test 2 : requête REST minimale (sans filtre) vers Publicites, en mode normal (cors) ---
    let minimaleOk = null;
    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?select=id&limit=1`, { headers: HEADERS });
      minimaleOk = true;
      console.log(`[Publicité][DIAG-RÉSEAU] Test 2/4 — requête minimale "Publicites?select=id&limit=1" : HTTP ${res.status} ${res.statusText}. ✅ (réponse obtenue)`);
      console.log('[Publicité][DIAG-RÉSEAU] Headers de réponse (test 2) :', {
        'content-type': res.headers.get('content-type'),
        'content-range': res.headers.get('content-range'),
        'access-control-allow-origin': res.headers.get('access-control-allow-origin')
      });
    }catch(e){
      minimaleOk = false;
      console.error('[Publicité][DIAG-RÉSEAU] Test 2/4 — ÉCHEC de la requête minimale (même sans le filtre active=eq.true) :', e);
      if(domaineJoignable){
        console.error('[Publicité][DIAG-RÉSEAU] → Le domaine est joignable en no-cors mais cette requête normale échoue : c\'est un rejet CORS (le serveur ne renvoie pas les headers Access-Control-Allow-Origin attendus pour ce header "apikey"), ou un blocage ciblé sur ce chemin d\'URL précis "/rest/v1/Publicites".');
      }
    }

    // --- Test 3 : requête complète, identique à celle utilisée réellement par le site public ---
    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?select=*&active=eq.true&order=updated_at.desc`, { headers: HEADERS });
      console.log(`[Publicité][DIAG-RÉSEAU] Test 3/4 — requête complète (active=eq.true) : HTTP ${res.status} ${res.statusText}. ✅ (réponse obtenue)`);
    }catch(e){
      console.error('[Publicité][DIAG-RÉSEAU] Test 3/4 — ÉCHEC de la requête complète :', e);
      if(minimaleOk){
        console.error('[Publicité][DIAG-RÉSEAU] → La requête minimale passe mais celle-ci échoue : le blocage cible spécifiquement les paramètres "active=eq.true" ou "order=updated_at.desc" dans l\'URL (signature typique d\'un bloqueur de publicités/traqueurs qui filtre sur des mots-clés de l\'URL).');
      }
    }

    // --- Test 4 : comparaison des headers utilisés côté public vs côté admin ---
    const headersPublic = HEADERS;
    const headersAdminActuels = headersAdmin();
    console.log('[Publicité][DIAG-RÉSEAU] Test 4/4 — comparaison des headers :');
    console.log('  Public (HEADERS)      → apikey présent :', !!headersPublic.apikey, '| Authorization :', headersPublic.Authorization ? headersPublic.Authorization.slice(0,20)+'…' : '(absent)');
    console.log('  Admin (headersAdmin()) → apikey présent :', !!headersAdminActuels.apikey, '| Authorization :', headersAdminActuels.Authorization ? headersAdminActuels.Authorization.slice(0,20)+'…' : '(absent)');
    if(headersPublic.apikey !== headersAdminActuels.apikey && !session){
      console.log('  → Sans session admin active, les deux utilisent la même clé anon : normal.');
    } else if(session){
      console.log('  → Une session admin est active dans cet onglet : le dashboard utilise le token utilisateur (Authorization différent), pas la clé anon. Ce n\'est PAS ce que voit un visiteur public non connecté — le vrai test doit se faire sans session (navigation privée).');
    }
    console.log('  ⚠️ Rappel sécurité : seule la clé "anon" publique est utilisée ici, jamais la clé service_role.');

    console.log('%c[Publicité][DIAG-RÉSEAU] Résumé : Test1(domaine)=%s Test2(minimale)=%s', 'color:#f59e0b;font-weight:bold', domaineJoignable ? 'OK':'ÉCHEC', minimaleOk ? 'OK':'ÉCHEC');
  }

  // ======================================================================
  // DIAGNOSTIC RÉSEAU MINIMAL — totalement indépendant du système publicitaire.
  // N'est appelé nulle part dans le CRUD admin ni dans l'affichage public :
  // il ne peut donc affecter ni le round-robin, ni les 12 emplacements, ni
  // l'enregistrement des publicités. Sert uniquement à isoler la connectivité.
  // Écrit à la fois dans la console ET dans le panneau visible #diagReseauResultats.
  // ======================================================================
  function diagAfficher(id, texte, ok){
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = texte;
    el.style.color = ok===true ? '#22c55e' : ok===false ? '#ef4444' : '';
  }

  async function diagnostiquerConnectiviteReseauMinimal(){
    const btn = document.getElementById('diagReseauBtn');
    if(btn){ btn.disabled = true; btn.textContent = 'Diagnostic en cours…'; }
    diagAfficher('diagReseauTest0', 'Test 0 (contrôle, hors-Supabase) : en cours…');
    diagAfficher('diagReseauTest1', 'Test 1 (domaine Supabase, no-cors) : en attente…');
    diagAfficher('diagReseauTest2', 'Test 2 (GET minimal Publicites) : en attente…');
    diagAfficher('diagReseauTest3', 'Test 3 (INSERT + DELETE de test) : en attente…');
    const ctxEl = document.getElementById('diagReseauContexte');
    if(ctxEl) ctxEl.textContent = `navigator.onLine = ${navigator.onLine} | location.origin = ${location.origin}`;

    console.log('%c[RÉSEAU] ===== Diagnostic de connectivité minimal =====', 'color:#f59e0b;font-weight:bold;font-size:1.1em');
    console.log('[RÉSEAU] navigator.onLine :', navigator.onLine);
    console.log('[RÉSEAU] location.origin :', location.origin);

    // --- Test 0 (contrôle) : une requête externe QUI N'EST PAS Supabase, pour savoir si
    // le problème touche Supabase spécifiquement ou toutes les requêtes externes du site. ---
    try{
      await fetch('https://www.google.com/generate_204', { mode:'no-cors' });
      console.log('[RÉSEAU] Test 0 — OK : requête envoyée et réponse reçue.');
      diagAfficher('diagReseauTest0', 'Test 0 (contrôle, hors-Supabase) : ✅ OK — le navigateur a accès à internet en général.', true);
    }catch(e){
      console.error('[RÉSEAU] Test 0 — ÉCHEC "Failed to fetch" même hors-Supabase :', e.message);
      diagAfficher('diagReseauTest0', `Test 0 (contrôle, hors-Supabase) : ❌ ÉCHEC — ${e.message} → problème réseau général, pas spécifique à Supabase.`, false);
    }

    // --- Test 1 : le domaine Supabase est-il joignable (no-cors, sans headers custom) ? ---
    try{
      await fetch(SUPABASE_URL, { mode:'no-cors' });
      console.log('[RÉSEAU] Test 1 — OK : domaine Supabase joignable.');
      diagAfficher('diagReseauTest1', 'Test 1 (domaine Supabase, no-cors) : ✅ OK — domaine joignable.', true);
    }catch(e){
      console.error('[RÉSEAU] Test 1 — ÉCHEC :', e.message);
      diagAfficher('diagReseauTest1', `Test 1 (domaine Supabase, no-cors) : ❌ ÉCHEC — ${e.message}`, false);
    }

    // --- Test 2 : requête REST minimale (GET, clé anon) ---
    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?select=id&limit=1`, { headers: HEADERS });
      console.log(`[RÉSEAU] Test 2 — réponse reçue, HTTP ${res.status} ${res.statusText}.`);
      diagAfficher('diagReseauTest2', `Test 2 (GET minimal Publicites) : ✅ réponse reçue — HTTP ${res.status} ${res.statusText}.`, res.ok);
    }catch(e){
      console.error('[RÉSEAU] Test 2 — ÉCHEC direct "Failed to fetch" :', e.message);
      diagAfficher('diagReseauTest2', `Test 2 (GET minimal Publicites) : ❌ ÉCHEC direct — ${e.message}`, false);
    }

    // --- Test 3 : INSERT de test (POST) vers Publicites, avec suppression immédiate si
    // réussi pour ne laisser aucune donnée persistante. ---
    try{
      const payloadTest = { alt_text:'[TEST DIAGNOSTIC RÉSEAU — à ignorer]', active:false };
      const resInsert = await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}`, {
        method:'POST',
        headers:{ ...headersAdmin(), 'Content-Type':'application/json', 'Prefer':'return=representation' },
        body: JSON.stringify(payloadTest)
      });
      console.log(`[RÉSEAU] Test 3 — réponse reçue, HTTP ${resInsert.status} ${resInsert.statusText}.`);
      if(resInsert.ok){
        const rows = await resInsert.json().catch(()=>[]);
        console.log('[RÉSEAU] Test 3 — INSERT accepté, ligne créée :', rows[0]);
        let suffixeNettoyage = '';
        if(rows[0] && rows[0].id != null){
          const resDel = await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?id=eq.${encodeURIComponent(rows[0].id)}`, { method:'DELETE', headers: headersAdmin() });
          console.log(`[RÉSEAU] Test 3 — nettoyage : ligne supprimée (HTTP ${resDel.status}).`);
          suffixeNettoyage = resDel.ok ? ' (ligne de test nettoyée)' : ' (⚠️ nettoyage de la ligne de test a échoué — à supprimer manuellement)';
        }
        diagAfficher('diagReseauTest3', `Test 3 (INSERT + DELETE de test) : ✅ réponse reçue — HTTP ${resInsert.status}${suffixeNettoyage}.`, true);
      } else {
        const detail = await resInsert.text().catch(()=> '');
        console.error(`[RÉSEAU] Test 3 — INSERT refusé : HTTP ${resInsert.status} — ${detail}`);
        diagAfficher('diagReseauTest3', `Test 3 (INSERT + DELETE de test) : ⚠️ réponse reçue mais refusée — HTTP ${resInsert.status} : ${detail}`, false);
      }
    }catch(e){
      console.error('[RÉSEAU] Test 3 — ÉCHEC direct "Failed to fetch" sur l\'INSERT :', e.message);
      diagAfficher('diagReseauTest3', `Test 3 (INSERT + DELETE de test) : ❌ ÉCHEC direct — ${e.message}`, false);
    }

    console.log('%c[RÉSEAU] ===== Fin du diagnostic =====', 'color:#f59e0b;font-weight:bold');
    if(btn){ btn.disabled = false; btn.textContent = 'Relancer le diagnostic'; }
  }

  // ----- Diagnostic de la chaîne image_url (ligne Supabase → URL → chargement navigateur) -----
  // Purement informatif : ne doit jamais interrompre le flux appelant (isolé par try/catch).
  function diagnostiquerImageUrl(ad, provenance){
    try{
      console.log(`%c[Publicité][IMAGE] Ligne reçue (${provenance}) :`, 'color:#22c55e', ad);
      const url = ad ? ad.image_url : undefined;
      console.log('[Publicité][IMAGE] Valeur exacte de image_url :', JSON.stringify(url));
      if(!url || !String(url).trim()){
        console.warn('[Publicité][IMAGE] image_url est vide/absent pour cette ligne → l\'emplacement sera masqué volontairement (voir remplirEmplacementPub), ce n\'est pas un problème réseau.');
        return;
      }
      // Rappel important : les images publicitaires sont stockées sur Cloudflare R2
      // (R2_PUBLIC_URL, worker "lsnb-pdf-worker"), PAS dans le bucket Supabase Storage "Pdfs"
      // qui sert uniquement aux PDF de la table Document. Si image_url ne commence pas par
      // R2_PUBLIC_URL, l'image ne vient pas de là où on l'attend.
      if(!String(url).startsWith(R2_PUBLIC_URL)){
        console.warn(`[Publicité][IMAGE] image_url ne commence pas par R2_PUBLIC_URL attendu (${R2_PUBLIC_URL}). Vérifier d'où vient réellement cette URL.`);
      }
      console.log('[Publicité][IMAGE] URL finale qui sera utilisée dans <img src="…"> :', url);
      const testImg = new Image();
      testImg.onload = () => console.log(`%c[Publicité][IMAGE] ✅ Chargement réussi (${testImg.naturalWidth}×${testImg.naturalHeight}px) :`, 'color:#22c55e', url);
      testImg.onerror = () => {
        console.error('[Publicité][IMAGE] ❌ Échec de chargement de l\'image via new Image() :', url);
        console.error('[Publicité][IMAGE] → Causes possibles : (1) le fichier n\'existe pas/plus dans le bucket R2 "lsnb-documents", (2) le bucket ou l\'accès public en lecture n\'est pas activé côté Cloudflare R2, (3) l\'URL R2_PUBLIC_URL a changé, (4) un bloqueur bloque aussi le chargement d\'images depuis ce domaine. Ouvrir cette URL directement dans un nouvel onglet pour confirmer laquelle de ces causes s\'applique.');
      };
      testImg.src = url;
    }catch(e){ console.error('[Publicité][IMAGE] Diagnostic interrompu (sans impact sur le reste) :', e); }
  }

  // ----- Emplacements publics (2 par secteur × 6 secteurs = 12) -----
  async function chargerAnnoncesActives(){
    console.log('%c[Publicité][PUBLIC] Étape 1/4 — requête Supabase (clé anon)…', 'color:#c084fc');
    console.log(`[Publicité][PUBLIC] URL : ${SUPABASE_URL}/rest/v1/${PUB_TABLE}?select=*&active=eq.true&order=updated_at.desc`);
    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?select=*&active=eq.true&order=updated_at.desc`, {headers:HEADERS});
      if(res.ok){
        PUBS_ACTIVES = await res.json();
        console.log(`[Publicité][PUBLIC] Étape 2/4 — ${PUBS_ACTIVES.length} ligne(s) reçue(s) de Supabase (active=true).`);
        if(PUBS_ACTIVES.length){
          const p = PUBS_ACTIVES[0];
          console.log('[Publicité][PUBLIC] Première publicité reçue :', {
            id: p.id, image_url: p.image_url, alt_text: p.alt_text, active: p.active
          });
          PUBS_ACTIVES.forEach(ad => diagnostiquerImageUrl(ad, 'requête publique'));
        } else {
          console.warn('[Publicité][PUBLIC] 0 ligne reçue malgré un statut HTTP OK. Cause probable : policy RLS Supabase sur public."Publicites" qui n\'autorise pas le rôle "anon" en SELECT (ou n\'autorise que active=true pour un rôle authentifié). Vérifier dans Supabase → Authentication → Policies sur la table Publicites.');
        }
      } else {
        const detail = await res.text().catch(()=> '');
        console.error(`[Publicité][PUBLIC] Échec de la requête — HTTP ${res.status} ${res.statusText}. Réponse Supabase : ${detail}`);
        PUBS_ACTIVES = [];
      }
    }catch(e){
      console.error('[Publicité][PUBLIC] Erreur réseau/fetch avant même la réponse Supabase :', e);
      PUBS_ACTIVES = [];
      await diagnostiquerReseauPublicites();
    }
    peuplerEmplacementsPublicitaires();
  }

  // ======================================================================
  // Alimente le panneau visible « Diagnostic affichage public ». Réutilise les
  // données déjà obtenues par chargerAnnoncesActives (= exactement ce que reçoit
  // un visiteur public) : ne fait aucune requête ni rendu supplémentaire, purement
  // lecture/affichage des variables existantes (PUBS_ACTIVES, AD_SLOTS_*).
  // ======================================================================
  async function afficherDiagnosticAffichagePublic(){
    const btn = document.getElementById('diagPubBtn');
    if(btn){ btn.disabled = true; btn.textContent = 'Chargement…'; }
    // Recharge réellement depuis Supabase avec la clé anon, exactement comme le site public.
    await chargerAnnoncesActives();

    const resumeEl = document.getElementById('diagPubResume');
    const listeEl = document.getElementById('diagPubListe');
    const cibleEl = document.getElementById('diagPubCible');
    const imageEl = document.getElementById('diagPubImage');
    const slotsEl = document.getElementById('diagPubSlots');

    resumeEl.textContent = `1) Nombre de lignes reçues (active=true, clé anon) : ${PUBS_ACTIVES.length}`;

    // 2) le détail de chaque publicité reçue
    if(PUBS_ACTIVES.length){
      listeEl.innerHTML = '2) Détail des lignes reçues :<br>' + PUBS_ACTIVES.map(p =>
        `&nbsp;&nbsp;• id=${echapperHtmlPub(p.id)} | active=${p.active} | alt_text="${echapperHtmlPub(p.alt_text||'')}" | image_url=${echapperHtmlPub(p.image_url||'(vide)')}`
      ).join('<br>');
    } else {
      listeEl.textContent = '2) Aucune ligne reçue.';
    }

    // 3) chercher spécifiquement la publicité "8882822" (par alt_text ou id)
    const cible = PUBS_ACTIVES.find(p => String(p.alt_text||'').includes('8882822') || String(p.id)==='8882822');
    if(!cible){
      cibleEl.textContent = '3) Publicité "8882822" introuvable dans les lignes reçues côté public (voir liste ci-dessus).';
      imageEl.textContent = '';
    } else {
      const url = cible.image_url;
      cibleEl.textContent = `3) Publicité "8882822" trouvée — image_url exacte : ${JSON.stringify(url)}`;
      imageEl.textContent = '4/5/6) Test new Image() en cours…';
      if(!url){
        imageEl.textContent = '4) image_url est vide pour cette ligne — impossible de tester le chargement.';
      } else {
        const testImg = new Image();
        testImg.onload = () => {
          imageEl.textContent = `4) new Image() → onload ✅ | 5) dimensions naturelles : ${testImg.naturalWidth}×${testImg.naturalHeight}px | 6) URL finale testée : ${url}`;
          imageEl.style.color = '#22c55e';
        };
        testImg.onerror = () => {
          imageEl.textContent = `4) new Image() → onerror ❌ | 6) URL finale testée (inaccessible) : ${url}`;
          imageEl.style.color = '#ef4444';
        };
        testImg.src = url;
      }
    }

    // 7) emplacements trouvés/remplis (déjà calculés par peuplerEmplacementsPublicitaires,
    // appelée en interne par chargerAnnoncesActives ci-dessus)
    slotsEl.textContent = `7) Emplacements DOM trouvés : ${AD_SLOTS_TROUVES}/12 | effectivement remplis : ${AD_SLOTS_REMPLIS}/12`;

    if(btn){ btn.disabled = false; btn.textContent = 'Relancer la vérification'; }
  }
  // les deux emplacements d'un même secteur reçoivent systématiquement des index
  // consécutifs (donc différents) ; avec une seule annonce active, les deux
  // emplacements affichent forcément la même (il n'y a rien d'autre à montrer).
  function choisirAnnoncePour(pageIndex, slotIndex){
    if(!PUBS_ACTIVES.length) return null;
    if(PUBS_ACTIVES.length===1) return PUBS_ACTIVES[0];
    const idx = (PUB_OFFSET + pageIndex*2 + slotIndex) % PUBS_ACTIVES.length;
    return PUBS_ACTIVES[idx];
  }

  function remplirEmplacementPub(container, ad){
    if(!container) return false;
    if(!ad || !ad.image_url){ container.style.display='none'; container.innerHTML=''; return false; }
    const titre = ad.alt_text || '';
    const cta = ad.link_url ? `<a class="ad-slot-cta" href="${echapperHtmlPub(ad.link_url)}" rel="noopener">En savoir plus →</a>` : '';
    container.innerHTML = `
      <div class="ad-slot-label">Publicité</div>
      <div class="ad-slot-card">
        <img class="ad-slot-img" src="${echapperHtmlPub(ad.image_url)}" alt="${echapperHtmlPub(titre||'Publicité')}" loading="eager" decoding="async" fetchpriority="high">
      </div>
      <div class="ad-slot-body">
        ${titre ? `<div class="ad-slot-title">${echapperHtmlPub(titre)}</div>` : ''}
        ${ad.description ? `<div class="ad-slot-desc">${echapperHtmlPub(ad.description)}</div>` : ''}
        ${cta}
      </div>`;
    // Un emplacement rempli doit être visible, même si un ancien état HTML/CSS
    // (display:none ou hidden) subsiste. On ne modifie jamais la donnée de publicité.
    container.removeAttribute('hidden');
    container.style.removeProperty('visibility');
    container.style.removeProperty('opacity');
    container.style.setProperty('display','block','important');
    return true;
  }

  let AD_SLOTS_TROUVES = 0, AD_SLOTS_REMPLIS = 0;

  function peuplerEmplacementsPublicitaires(){
    console.log('%c[Publicité][PUBLIC] Étape 3/4 — recherche des 12 emplacements dans le DOM…', 'color:#c084fc');
    let trouves=0, remplis=0;
    const manquants=[];
    AD_PAGES.forEach((page, pageIndex)=>{
      [0,1].forEach(slotIndex=>{
        const id = `ad-${page}-${slotIndex+1}`;
        const el=document.getElementById(id);
        if(!el){ manquants.push(id); return; }
        trouves++;
        const ok = remplirEmplacementPub(el, choisirAnnoncePour(pageIndex, slotIndex));
        if(ok) remplis++;
      });
    });
    AD_SLOTS_TROUVES = trouves; AD_SLOTS_REMPLIS = remplis;
    // Recalage de rendu après insertion : utile lorsque l'écran vient juste de
    // devenir actif ou qu'une finition CSS a été appliquée avant le remplissage.
    if(remplis){
      requestAnimationFrame(() => {
        AD_PAGES.forEach(page => [1,2].forEach(n => {
          const slot = document.getElementById(`ad-${page}-${n}`);
          if(slot && slot.children.length) {
            slot.removeAttribute('hidden');
            slot.style.setProperty('display','block','important');
            slot.style.setProperty('visibility','visible','important');
            slot.style.setProperty('opacity','1','important');
          }
        }));
      });
    }
    console.log(`[Publicité][PUBLIC] Étape 4/4 — ${trouves}/12 emplacement(s) trouvé(s) dans le DOM, ${remplis}/12 effectivement rempli(s) et affiché(s).`);
    if(manquants.length) console.warn('[Publicité][PUBLIC] IDs introuvables dans le DOM :', manquants);
    if(trouves && !remplis && PUBS_ACTIVES.length){
      console.warn('[Publicité][PUBLIC] Les emplacements existent et Supabase a renvoyé des publicités, mais aucune n\'a été affichée — vérifier que chaque ligne a bien une "image_url" non vide (une publicité sans image est masquée volontairement).');
    }
  }

  // ======================================================================
  // Inspection du rendu visuel — purement diagnostique. N'appelle et n'est
  // appelée par aucune fonction du CRUD/round-robin/chargerAnnoncesActives.
  // Applique juste une classe CSS de debug (bordure + hauteur mini) aux
  // emplacements déjà remplis, et affiche leurs styles calculés réels.
  // ======================================================================
  function inspecterRenduAdSlots(){
    const out = document.getElementById('diagRenduResultats');
    const lignes = [];
    let inspectes = 0;

    AD_PAGES.forEach((page)=>{
      [1,2].forEach(n=>{
        const id = `ad-${page}-${n}`;
        const el = document.getElementById(id);
        if(!el) return;
        const rempli = el.children.length > 0;
        if(!rempli) return; // on n'inspecte que les emplacements effectivement remplis
        inspectes++;

        el.classList.add('ad-slot-debug'); // bordure rouge + hauteur mini, diagnostic uniquement

        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const card = el.querySelector('.ad-slot-card');
        const csCard = card ? getComputedStyle(card) : null;
        const img = el.querySelector('.ad-slot-img');
        const rectImg = img ? img.getBoundingClientRect() : null;

        const ecran = el.closest('.screen');
        const ecranActif = ecran ? ecran.classList.contains('active') : null;
        const csEcran = ecran ? getComputedStyle(ecran) : null;

        const bloc = [
          `— ${id} —`,
          `  container : display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity} width=${cs.width} height=${cs.height} position=${cs.position} z-index=${cs.zIndex} overflow=${cs.overflow}`,
          `  getBoundingClientRect(container) : x=${rect.x.toFixed(0)} y=${rect.y.toFixed(0)} w=${rect.width.toFixed(0)} h=${rect.height.toFixed(0)}`,
          card ? `  .ad-slot-card : display=${csCard.display} visibility=${csCard.visibility} opacity=${csCard.opacity} width=${csCard.width} height=${csCard.height}` : `  .ad-slot-card : introuvable dans le DOM`,
          img ? `  <img> src="${img.getAttribute('src')}" | rect w=${rectImg.width.toFixed(0)} h=${rectImg.height.toFixed(0)} | naturalWidth=${img.naturalWidth} naturalHeight=${img.naturalHeight}` : `  <img> introuvable`,
          ecran ? `  Écran parent (.screen) : id=${ecran.id} classe "active" présente=${ecranActif} | display calculé=${csEcran.display}` : `  Aucun ancêtre .screen trouvé`
        ].join('\n');
        lignes.push(bloc);
        console.log(`[Publicité][RENDU] ${id}`, { computed: {display:cs.display, visibility:cs.visibility, opacity:cs.opacity, width:cs.width, height:cs.height, position:cs.position, zIndex:cs.zIndex, overflow:cs.overflow}, rect, imgSrc: img?.getAttribute('src'), ecranActif, ecranDisplay: csEcran?.display });
      });
    });

    if(out){
      out.textContent = inspectes
        ? lignes.join('\n\n')
        : 'Aucun emplacement rempli trouvé à inspecter (recharge le diagnostic affichage public d\'abord).';
    }
    console.log(`[Publicité][RENDU] ${inspectes} emplacement(s) rempli(s) inspecté(s). Bordure rouge de debug appliquée sur chacun.`);
  }

  // ======================================================================
  // Diagnostic ciblé : navigue réellement vers screen-home avec la fonction de
  // navigation EXISTANTE (afficherEcran, non modifiée), attend le rendu, puis
  // inspecte #screen-home et #ad-home-1 en détail. Purement diagnostique —
  // n'appelle et n'est appelé par aucune fonction Supabase/R2/CRUD/round-robin.
  // ======================================================================
  function diagLigne(label, valeur){
    return `${label} : ${valeur}`;
  }

  async function diagnostiquerAccueilEtAdHome1(){
    const btn = document.getElementById('diagHomeBtn');
    const out = document.getElementById('diagHomeResultats');
    if(btn){ btn.disabled = true; btn.textContent = 'Navigation en cours…'; }
    if(out) out.textContent = 'Navigation vers Accueil…';

    // 1) navigation réelle avec la fonction existante, exactement comme le fait le reste
    // du site (aucune fonction de navigation créée ou modifiée ici).
    afficherEcran('screen-home');

    // 2) laisser le temps au navigateur de recalculer le rendu/layout.
    await new Promise(r => setTimeout(r, 300));

    const lignes = [];
    const screenHome = document.getElementById('screen-home');
    const adHome1 = document.getElementById('ad-home-1');

    if(!screenHome){ if(out) out.textContent='#screen-home introuvable dans le DOM.'; if(btn){btn.disabled=false; btn.textContent='Naviguer vers Accueil et inspecter';} return; }

    const csScreen = getComputedStyle(screenHome);
    const rectScreen = screenHome.getBoundingClientRect();
    lignes.push('--- screen-home ---');
    lignes.push(diagLigne('screen-home.classList', screenHome.classList.value));
    lignes.push(diagLigne("screen-home.classList.contains('active')", screenHome.classList.contains('active')));
    lignes.push(diagLigne('getComputedStyle(screen-home).display', csScreen.display));
    lignes.push(diagLigne('getBoundingClientRect(screen-home)', `x=${rectScreen.x.toFixed(0)} y=${rectScreen.y.toFixed(0)} w=${rectScreen.width.toFixed(0)} h=${rectScreen.height.toFixed(0)}`));

    if(!adHome1){
      lignes.push('\n#ad-home-1 introuvable dans le DOM.');
    } else {
      // Bordure de debug forcée, !important, purement visuelle/diagnostique.
      adHome1.style.setProperty('outline', '5px solid #ef4444', 'important');
      adHome1.style.setProperty('outline-offset', '2px', 'important');
      adHome1.style.setProperty('background', 'rgba(239,68,68,0.25)', 'important');
      adHome1.style.setProperty('min-height', '80px', 'important');

      const cs1 = getComputedStyle(adHome1);
      const rect1 = adHome1.getBoundingClientRect();
      const card = adHome1.querySelector('.ad-slot-card');
      const img = adHome1.querySelector('.ad-slot-img');
      const rectImg = img ? img.getBoundingClientRect() : null;

      lignes.push('\n--- ad-home-1 ---');
      lignes.push(diagLigne('getComputedStyle(ad-home-1).display', cs1.display));
      lignes.push(diagLigne('getComputedStyle(ad-home-1).visibility', cs1.visibility));
      lignes.push(diagLigne('getBoundingClientRect(ad-home-1)', `x=${rect1.x.toFixed(0)} y=${rect1.y.toFixed(0)} w=${rect1.width.toFixed(0)} h=${rect1.height.toFixed(0)}`));
      lignes.push(diagLigne('ad-home-1 innerHTML non vide', adHome1.innerHTML.trim().length > 0));

      if(img){
        lignes.push('\n--- image dans ad-home-1 ---');
        lignes.push(diagLigne('getBoundingClientRect(img)', rectImg ? `x=${rectImg.x.toFixed(0)} y=${rectImg.y.toFixed(0)} w=${rectImg.width.toFixed(0)} h=${rectImg.height.toFixed(0)}` : 'n/a'));
        lignes.push(diagLigne('img.complete', img.complete));
        lignes.push(diagLigne('img.naturalWidth', img.naturalWidth));
        lignes.push(diagLigne('img.naturalHeight', img.naturalHeight));
        lignes.push(diagLigne('img.src', img.src));
      } else {
        lignes.push('\nAucune <img class="ad-slot-img"> trouvée dans ad-home-1 (l\'emplacement est peut-être vide/non rempli — recharge le diagnostic affichage public d\'abord).');
      }

      lignes.push('\n--- styles inline (attribut style="…") ---');
      lignes.push(diagLigne('ad-home-1 (avant bordure de debug ajoutée ci-dessus)', adHome1.getAttribute('style') || '(aucun)'));
      lignes.push(diagLigne('.ad-slot-card', card ? (card.getAttribute('style') || '(aucun)') : '(introuvable)'));
      lignes.push(diagLigne('<img>', img ? (img.getAttribute('style') || '(aucun)') : '(introuvable)'));

      console.log('[Publicité][DIAG-HOME] ad-home-1 —', {
        display: cs1.display, visibility: cs1.visibility, rect: rect1,
        imgComplete: img?.complete, imgNaturalWidth: img?.naturalWidth, imgSrc: img?.src,
        styleInlineAvant: adHome1.getAttribute('style')
      });
    }

    if(out) out.textContent = lignes.join('\n');
    console.log('[Publicité][DIAG-HOME] Résultat complet :\n' + lignes.join('\n'));
    if(btn){ btn.disabled = false; btn.textContent = 'Relancer'; }
  }

  // ----- Gestion admin (liste, ajout, modification, activation, suppression) -----
