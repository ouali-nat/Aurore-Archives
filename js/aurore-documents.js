async function allerDocuments(matiere) {
    // Les sections scolaires utilisent elles aussi la couverture de première page.
    COUVERTURES_PREMIERE_PAGE_ACTIVES = true;
    etat.matiere = matiere;
    const niveauLabel = (etat.classe?.dbNiveaux?.[0]) || (etat.feuilleArbre?.dbNiveaux?.[0]) || (etat.sousNiveau?.dbNiveaux?.[0]) || '';
    const serieLabel = etat.filiere ? ' — Série ' + etat.filiere : '';
    document.getElementById('docsTitle').textContent =
      `${etat.categorie.nom} — ${etat.serieChoisie?.nom || etat.feuilleArbre?.nom || etat.sousNiveau?.nom || niveauLabel}${serieLabel} — ${matiere.nom}`;
    majFilAriane();
    document.querySelector('#screen-docs .back-btn').setAttribute('data-back', 'matieres');
    afficherEcran('screen-docs');

    const content = document.getElementById('docsContent');
    content.innerHTML = '<p style="color:var(--gris); font-size:0.9rem;">Chargement des documents…</p>';

    let query = `Niveau=eq.${encodeURIComponent(niveauLabel)}&${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent(etat.categorie.nom)}&${encodeURIComponent('Matière')}=eq.${encodeURIComponent(matiere.nom)}&Publie=eq.true&order=id.desc`;
    if (etat.filiere) query += `&Filiere=eq.${encodeURIComponent(etat.filiere)}`;
    if (etat.division) query += `&Classe=eq.${encodeURIComponent(etat.division)}`;

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&${query}`, { headers: HEADERS });
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      const data = filtreSerieSiDisponible(await res.json());
      documentsCourants = Array.isArray(data) ? data : [];
      actualiserTriPublicDocuments(documentsCourants);
      docsPageCourante = 1;
      if(document.getElementById('docsSearch')) document.getElementById('docsSearch').value = '';
      afficherDocumentsPublicsAvecOutils();
    } catch (err) {
      content.innerHTML = `<div class="doc-empty"><div class="icon-wrap">${ICONS.warning}</div><h3>Impossible de charger les documents</h3><p>Le contenu n’a pas pu être récupéré pour le moment. Veuillez réessayer dans quelques instants.</p></div>`;
    }
  }

  let docsPageCourante = 1;
  function afficherDocumentsPublicsAvecOutils(){
    const content=document.getElementById('docsContent');
    const q=normaliserRechercheSite(document.getElementById('docsSearch')?.value||'');
    const filtered=(documentsCourants||[]).filter(doc=>!q||valeurTexteDocument(doc).includes(q));
    const sorted=trierDocumentsClient(filtered);
    const pages=Math.max(1,Math.ceil(sorted.length/SITE_PUBLIC_PAGE_SIZE));
    docsPageCourante=Math.min(docsPageCourante,pages);
    if(!sorted.length){ content.innerHTML='<div class="site-empty-filter">Aucun document ne correspond à votre recherche.</div>'; afficherPaginationSite('docsPager',0,1,()=>{}); return; }
    const start=(docsPageCourante-1)*SITE_PUBLIC_PAGE_SIZE;
    rendreListeDocuments(content, sorted.slice(start,start+SITE_PUBLIC_PAGE_SIZE), COUVERTURES_PREMIERE_PAGE_ACTIVES);
    afficherPaginationSite('docsPager',sorted.length,docsPageCourante,p=>{docsPageCourante=p;afficherDocumentsPublicsAvecOutils();});
  }
  document.getElementById('docSort').addEventListener('change', () => { docsPageCourante=1; afficherDocumentsPublicsAvecOutils(); });
  document.getElementById('docsSearch')?.addEventListener('input', () => { docsPageCourante=1; afficherDocumentsPublicsAvecOutils(); });

async function allerDocuments(matiere) {
    COUVERTURES_PREMIERE_PAGE_ACTIVES = true;
    documentsOrigineCourants='aurore';
    etat.matiere = matiere;
    const niveauLabel = (etat.classe?.dbNiveaux?.[0]) || (etat.feuilleArbre?.dbNiveaux?.[0]) || (etat.sousNiveau?.dbNiveaux?.[0]) || '';
    const serieLabel = etat.filiere ? ' — Série ' + etat.filiere : '';
    document.getElementById('docsTitle').textContent = etat.categorie.nom+' — '+(etat.serieChoisie?.nom || etat.feuilleArbre?.nom || etat.sousNiveau?.nom || niveauLabel)+serieLabel+' — '+matiere.nom;
    majFilAriane();document.querySelector('#screen-docs .back-btn').setAttribute('data-back', 'matieres');afficherEcran('screen-docs');
    const content = document.getElementById('docsContent');content.innerHTML = '<p style="color:var(--gris); font-size:0.9rem;">Chargement des documents…</p>';
    let query = 'Niveau=eq.'+encodeURIComponent(niveauLabel)+'&'+encodeURIComponent('Catégorie')+'=eq.'+encodeURIComponent(etat.categorie.nom)+'&'+encodeURIComponent('Matière')+'=eq.'+encodeURIComponent(matiere.nom)+'&Publie=eq.true&order=id.desc';
    if (etat.filiere) query += '&Filiere=eq.'+encodeURIComponent(etat.filiere);
    if (etat.division) query += '&Classe=eq.'+encodeURIComponent(etat.division);
    try{
      const res=await fetch(SUPABASE_URL+'/rest/v1/Document?select=*'+'&'+query,{headers:HEADERS});
      if(!res.ok)throw new Error('Statut HTTP '+res.status);
      documentsCourants=filtreSerieSiDisponible(await res.json());if(!Array.isArray(documentsCourants))documentsCourants=[];
      actualiserTriPublicDocuments(documentsCourants);docsPageCourante=1;if(document.getElementById('docsSearch'))document.getElementById('docsSearch').value='';
      majFiltreOrigineDocuments();afficherDocumentsPublicsAvecOutils();
    }catch(err){
      const wrap=document.getElementById('docsOriginFilter');if(wrap){wrap.hidden=true;wrap.innerHTML='';}
      content.innerHTML='<div class="doc-empty"><div class="icon-wrap">'+ICONS.warning+'</div><h3>Impossible de charger les documents</h3><p>Le contenu n’a pas pu être récupéré pour le moment. Veuillez réessayer dans quelques instants.</p></div>';
    }
  }
  let docsPageCourante = 1;
  function afficherDocumentsPublicsAvecOutils(){
    const content=document.getElementById('docsContent');
    const q=normaliserRechercheSite(document.getElementById('docsSearch')?.value||'');
    const originData=(documentsCourants||[]).filter(doc=>documentsOrigineCourants==='communaute'?!documentEstAurore(doc):documentEstAurore(doc));
    const filtered=originData.filter(doc=>!q||valeurTexteDocument(doc).includes(q));
    const sorted=trierDocumentsClient(filtered);
    const pages=Math.max(1,Math.ceil(sorted.length/SITE_PUBLIC_PAGE_SIZE));docsPageCourante=Math.min(docsPageCourante,pages);
    if(!sorted.length){
      content.innerHTML=documentsOrigineCourants==='aurore'?'<div class="docs-origin-empty"><div class="empty-mark">A</div><h3>Aucune ressource Aurore dans cette matière</h3><p>Les publications préparées par Aurore apparaîtront ici dès qu’elles seront validées. Les documents de la communauté restent accessibles séparément.</p><button type="button" class="admin-btn ghost" id="docsSeeCommunity">Voir les documents de la communauté</button></div>':'<div class="docs-origin-empty"><div class="empty-mark">C</div><h3>Aucun document de la communauté dans cette matière</h3><p>Les contributions déposées et validées par les utilisateurs apparaîtront ici.</p></div>';
      content.querySelector('#docsSeeCommunity')?.addEventListener('click',()=>{documentsOrigineCourants='communaute';majFiltreOrigineDocuments();afficherDocumentsPublicsAvecOutils();});
      afficherPaginationSite('docsPager',0,1,()=>{});return;
    }
    const start=(docsPageCourante-1)*SITE_PUBLIC_PAGE_SIZE;
    rendreListeDocuments(content,sorted.slice(start,start+SITE_PUBLIC_PAGE_SIZE),COUVERTURES_PREMIERE_PAGE_ACTIVES);
    afficherPaginationSite('docsPager',sorted.length,docsPageCourante,p=>{docsPageCourante=p;afficherDocumentsPublicsAvecOutils();});
  }
  document.getElementById('docSort').addEventListener('change',()=>{docsPageCourante=1;afficherDocumentsPublicsAvecOutils();});
  document.getElementById('docsSearch')?.addEventListener('input',()=>{docsPageCourante=1;afficherDocumentsPublicsAvecOutils();});

    // ---------- LIVRES ET ROMANS ----------
  function allerLivres() {
    // Prépare pdf.js pendant que l’utilisateur choisit le genre, afin que la première page soit rendue immédiatement après l’ouverture des livres.
    if (typeof chargerPdfJs === 'function') chargerPdfJs().catch(() => {});
    etat = { niveau:null, sousNiveau:null, serieChoisie:null, classe:null, categorie:null, filiere:null, division:null, matiere:null, cheminArbre:[], feuilleArbre:null };
    const grid = document.getElementById('genreGrid');
    grid.innerHTML = '';
    GENRES.forEach(g => {
      const card = document.createElement('button');
      card.className = 'matiere-card';
      card.style.setProperty('--accent', COULEURS.violet);
      card.innerHTML = `<div class="mono">${g.mono}</div><div class="nom">${g.nom}</div><span class="badge">…</span>`;
      card.onclick = () => allerDocumentsLivre(g);
      grid.appendChild(card);
    });
    document.getElementById('breadcrumb').innerHTML = '';
    afficherEcran('screen-livres');

    // NB : nécessite que la colonne "Genre" existe dans Document (voir migration
    // SQL fournie : ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "Genre" text;).
    fetch(`${SUPABASE_URL}/rest/v1/Document?select=Genre&${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent('Livres')}&Publie=eq.true`, { headers: HEADERS })
      .then(res => res.ok ? res.json() : [])
      .then(rows => {
        const compte = {};
        rows.forEach(r => { compte[r.Genre] = (compte[r.Genre] || 0) + 1; });
        grid.querySelectorAll('.matiere-card').forEach((card, i) => {
          const n = compte[GENRES[i].nom] || 0;
          card.querySelector('.badge').textContent = n + (n > 1 ? ' livres' : ' livre');
        });
      })
      .catch(() => {});
  }

  async function allerDocumentsLivre(genre) {
    const originWrap=document.getElementById('docsOriginFilter');if(originWrap){originWrap.hidden=true;originWrap.innerHTML='';}
    // Les couvertures sont actives uniquement ici, dans l'emplacement Romans.
    COUVERTURES_PREMIERE_PAGE_ACTIVES = true;
    document.getElementById('docsTitle').textContent = `Livres et romans — ${genre.nom}`;
    document.querySelector('#screen-docs .back-btn').setAttribute('data-back', 'livres');
    afficherEcran('screen-docs');

    const content = document.getElementById('docsContent');
    content.innerHTML = '<p style="color:var(--gris); font-size:0.9rem;">Chargement des documents…</p>';

    const query = `${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent('Livres')}&Genre=eq.${encodeURIComponent(genre.nom)}&Publie=eq.true`;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&${query}`, { headers: HEADERS });
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      const data = await res.json();
      // Les résultats utilisent eux aussi la première page comme couverture.
      COUVERTURES_PREMIERE_PAGE_ACTIVES = true;
      rendreListeDocuments(content, data, true);
    } catch (err) {
      content.innerHTML = `<div class="doc-empty"><div class="icon-wrap">${ICONS.warning}</div><h3>Impossible de charger les documents</h3><p>Le contenu n’a pas pu être récupéré pour le moment. Veuillez réessayer dans quelques instants.</p></div>`;
    }
  }

  document.getElementById('btnLivres').querySelector('.icon-wrap').innerHTML = ICONS.book;
  document.getElementById('btnLivres').addEventListener('click', allerLivres);

  // ---------- BOUTONS RETOUR GÉNÉRIQUES ----------
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cible=btn.getAttribute('data-back');
      // Les boutons explicitement marqués « home » vont toujours à l'accueil,
      // même si l'historique contient un écran précédent.
      if(cible==='home'){
        allerAccueil();
        return;
      }
      if (history.state && history.state.aurasterNavigation) {
        history.back();
        return;
      }
      if(cible==='level') afficherEcran('screen-level');
      else if(cible==='livres') afficherEcran('screen-livres');
      else if(cible==='matieres') afficherEcran('screen-matieres');
    });
  });

  // ---------- ÉCRAN DÉPÔT ----------
  document.getElementById('btnDeposer').addEventListener('click', () => {
    afficherEcran('screen-deposer');
    document.getElementById('breadcrumb').innerHTML = '';
    const connecte = !!session;
    document.getElementById('depotConnexionRequise').style.display = connecte ? 'none' : 'block';
    document.getElementById('depotFormCard').style.display = connecte ? 'block' : 'none';
  });
  document.getElementById('btnConnexionDepuisDepot').addEventListener('click', demarrerConnexionGoogle);

  // ---------- DOCUMENTS RÉCEMMENT PUBLIÉS (accueil → écran dédié) ----------
  // Lecture publique (comme tout document publié) filtrée sur la colonne
  // "Mis_en_avant" (sélection admin indépendante — voir migration SQL fournie
  // et basculerMiseEnAvantDocument()). Tant que cette colonne n'existe pas
  // encore côté Supabase, la requête échoue proprement et l'écran affiche
  // l'état vide plutôt que de casser la page.
  (function(){
    const card=document.getElementById('homeRecentsCta');
    if(!card) return;
    const open=()=>{
      document.getElementById('breadcrumb').innerHTML='';
      afficherEcran('screen-recents');
      chargerDocumentsRecents();
    };
    card.addEventListener('click',open);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
  })();

  function tagsClassementDocument(doc) {
    return [
      doc.Niveau && doc.Niveau !== 'Livres' ? doc.Niveau : null,
      doc.Filiere ? 'Série ' + doc.Filiere : null,
      doc['Catégorie'] || null,
      doc['Matière'] || doc.Genre || null
    ].filter(Boolean);
  }

  let documentsRecentsCourants = [];
  let recentsPageCourante = 1;
  function rendreRecentsAvecOutils(){
    const content=document.getElementById('recentsContent');
    const q=normaliserRechercheSite(document.getElementById('recentsSearch')?.value||'');
    const select=document.getElementById('recentsSort');
    const current=select?.value||'recent';

    if(select){
      const opts=[['recent','Plus récent'],['oldest','Plus ancien'],['az','Titre A → Z'],['za','Titre Z → A']];
      if((documentsRecentsCourants||[]).some(d=>String(d.Niveau||'').trim())) opts.push(['niveau','Niveau A → Z']);
      if((documentsRecentsCourants||[]).some(d=>String(d.Classe||'').trim())) opts.push(['classe','Classe A → Z']);
      if((documentsRecentsCourants||[]).some(d=>String(d['Matière']||'').trim())) opts.push(['matiere','Matière A → Z']);
      select.innerHTML=opts.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
      select.value=opts.some(([v])=>v===current)?current:'recent';
    }

    const mode=select?.value||'recent';
    let data=(documentsRecentsCourants||[]).filter(doc=>!q||valeurTexteDocument(doc).includes(q));
    data.sort((a,b)=>{
      const cle=(doc)=> mode==='niveau'?doc.Niveau : mode==='classe'?doc.Classe : mode==='matiere'?doc['Matière'] : doc.Titre;
      if(['az','za','niveau','classe','matiere'].includes(mode)){
        const c=String(cle(a)||'').localeCompare(String(cle(b)||''),'fr',{sensitivity:'base'});
        return mode==='za'?-c:c;
      }
      const aId=Number(a.id)||0,bId=Number(b.id)||0;
      return mode==='oldest'?aId-bId:bId-aId;
    });

    const pages=Math.max(1,Math.ceil(data.length/SITE_PUBLIC_PAGE_SIZE));
    recentsPageCourante=Math.min(recentsPageCourante,pages);

    if(!data.length){
      content.innerHTML='<div class="site-empty-filter">Aucun document ne correspond à votre recherche.</div>';
      afficherPaginationSite('recentsPager',0,1,()=>{});
      return;
    }

    const startIndex=(recentsPageCourante-1)*SITE_PUBLIC_PAGE_SIZE;
    const list=document.createElement('div');
    // IMPORTANT : les documents récemment publiés utilisent exactement
    // le même composant que la bibliothèque publique (.doc-list / .doc-row).
    // Seules les actions propres à cette section sont conservées.
    list.className='doc-list';

    content.innerHTML='';
    content.appendChild(list);

    data.slice(startIndex,startIndex+SITE_PUBLIC_PAGE_SIZE).forEach(doc=>{
      const row=document.createElement('div');
      row.className='doc-row';
      const telechargementOk=doc.Telechargement_autorise!==false;
      const contexte=[
        doc.Niveau && `Niveau : ${doc.Niveau}`,
        doc.Filiere && `Filière : ${doc.Filiere}`,
        (doc['Catégorie']||doc.Type) && `Catégorie : ${doc['Catégorie']||doc.Type}`,
        doc.Genre && `Genre : ${doc.Genre}`
      ].filter(Boolean).join(' · ');
      const titreDocument=obtenirTitreDocument(doc);
      row.dataset.documentTitle=titreDocument;

      row.innerHTML=`
        <div class="info">
          <div class="icon-wrap">${ICONS.file}</div>
          <div class="doc-main-info">
            <div class="titre" title="${echapperHtmlPub(titreDocument)}">${echapperHtmlPub(titreDocument)}</div>
            <div class="meta">Déposé par ${echapperHtmlPub(doc.Auteur||'anonyme')}${telechargementOk?'':' · Lecture seule'}</div>
            ${contexte?`<div class="doc-context">${echapperHtmlPub(contexte)}</div>`:''}
            ${tailleBadgeMarkup(doc.Fichier_url)}
          </div>
        </div>
        ${boutonPlusCarteDocumentMarkup()}
        ${panneauActionsCarteDocumentMarkup(telechargementOk)}`;

      row._auroreDocument=doc;
      brancherActionsCarteDocument(row, doc);

      actualiserEtatActionsDocument(row,doc);
      list.appendChild(row);

      // Même vignette : première page réelle du PDF, comme dans la bibliothèque.
      if(doc.Fichier_url && typeof appliquerCouvertureSiLivre==='function'){
        appliquerCouvertureSiLivre(row,doc);
      }
    });

    afficherPaginationSite('recentsPager',data.length,recentsPageCourante,p=>{
      recentsPageCourante=p;
      rendreRecentsAvecOutils();
    });
  }

  async function chargerDocumentsRecents() {
    const content = document.getElementById('recentsContent');
    content.innerHTML = '<p class="admin-empty">Chargement…</p>';
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&Publie=eq.true&Mis_en_avant=eq.true&order=id.desc&limit=100`, { headers: HEADERS });
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      const data = await res.json();
      documentsRecentsCourants=Array.isArray(data)?data:[];
      recentsPageCourante=1;
      if(document.getElementById('recentsSearch')) document.getElementById('recentsSearch').value='';
      if(!documentsRecentsCourants.length){
        content.innerHTML = `<div class="doc-empty friendly-empty"><div class="icon-wrap">${ICONS.folder}</div><h3>Aucun document mis en avant pour le moment.</h3><p>Revenez bientôt : cette sélection est enrichie régulièrement par l'équipe d'${SITE_NOM}.</p></div>`;
        afficherPaginationSite('recentsPager',0,1,()=>{}); return;
      }
      rendreRecentsAvecOutils();
    } catch (err) {
      content.innerHTML = `<p class="admin-empty">Impossible de charger cette sélection pour le moment.</p>`;
    }
  }
  document.getElementById('recentsSearch')?.addEventListener('input',()=>{recentsPageCourante=1;rendreRecentsAvecOutils();});
  document.getElementById('recentsSort')?.addEventListener('change',()=>{recentsPageCourante=1;rendreRecentsAvecOutils();});

  let DOC_EN_APERCU = null;
  function ouvrirApercuDocument(doc) {
    DOC_EN_APERCU = doc;
    document.getElementById('apercuTitre').textContent = doc.Titre || 'Document';
    document.getElementById('apercuTags').innerHTML = tagsClassementDocument(doc).map(t => `<span class="tag">${t}</span>`).join('');
    document.getElementById('apercuMeta').textContent = `Déposé par ${doc.Auteur || 'anonyme'}${doc.Source ? ' · Source : ' + doc.Source : ''}`;
    document.getElementById('apercuOverlay').style.display = 'flex';
  }
  function fermerApercu() {
    document.getElementById('apercuOverlay').style.display = 'none';
    DOC_EN_APERCU = null;
  }
  document.getElementById('apercuFermer').addEventListener('click', fermerApercu);
  document.getElementById('apercuOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'apercuOverlay') fermerApercu();
  });
  document.getElementById('apercuConsulter').addEventListener('click', () => {
    const doc = DOC_EN_APERCU;
    fermerApercu();
    if (doc) ouvrirLecteurPDF(doc);
  });

  const selGenre = document.getElementById('f_genre');
  GENRES.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.nom; opt.textContent = g.nom;
    selGenre.appendChild(opt);
  });
  selGenre.insertAdjacentHTML('afterbegin', '<option value="">Choisir</option>');
