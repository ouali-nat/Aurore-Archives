// ---------- ÉTAT DE NAVIGATION ----------
  let etat = { niveau:null, sousNiveau:null, serieChoisie:null, classe:null, categorie:null, filiere:null, division:null, matiere:null, cheminArbre:[], feuilleArbre:null };

  // ---------- HISTORIQUE NAVIGATEUR (Retour Android/mobile) ----------
  // Une entrée = un écran réellement atteint. Les snapshots sont immuables :
  // un changement ultérieur de "etat" ne modifie jamais l'entrée précédente.
  let navigationParPopState = false;
  let navigationInitialisee = false;
  let navigationCompteur = 0;

  function etatNavigationVide() {
    return {niveau:null,sousNiveau:null,serieChoisie:null,classe:null,categorie:null,filiere:null,division:null,matiere:null,cheminArbre:[],feuilleArbre:null};
  }
  function clonerEtatNavigation() {
    try { return JSON.parse(JSON.stringify(etat)); }
    catch(e) { return etatNavigationVide(); }
  }
  function creerSnapshotNavigation(ecran, scrollY, navigationId = navigationCompteur) {
    return {
      aurasterNavigation:true,
      navigationId:Number.isFinite(Number(navigationId)) ? Number(navigationId) : 0,
      ecranAuraster:ecran,
      etatAuraster:clonerEtatNavigation(),
      scrollY:Number.isFinite(Number(scrollY)) ? Number(scrollY) : 0
    };
  }

  function urlEntreeNavigation(navigationId) {
    try {
      const u = new URL(location.href);
      u.hash = 'aurore-nav-' + String(navigationId);
      return u.href;
    } catch (_) {
      return location.href;
    }
  }
  function enregistrerPositionNavigation() {
    if (navigationParPopState) return;
    try {
      const courant=history.state;
      if(courant && courant.aurasterNavigation) {
        history.replaceState({...courant,scrollY:window.scrollY},'',location.href);
      }
    } catch(e) {}
  }

  function afficherEcran(id, options={}) {
    // Une URL de section partagée est une route publique autonome : aucune autre
    // navigation interne (accueil, recherche, publicité, profil, etc.) ne doit
    // pouvoir remplacer son écran pendant son chargement.
    try {
      if (new URLSearchParams(location.search).has('sectionShare') && id !== 'screen-shared-section') {
        id = 'screen-shared-section';
      }
    } catch (_) {}
    // Un nouvel utilisateur connecté doit terminer son profil essentiel avant
    // de naviguer dans la plateforme. Les administrateurs ne sont pas bloqués.
    if (session && session.role !== 'admin' && !profilEstComplet(session) && id !== 'screen-profil') {
      remplirProfil();
      id = 'screen-profil';
    }
    const cible=document.getElementById(id);
    if(!cible) return;
    if(!navigationParPopState) enregistrerPositionNavigation();
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    cible.classList.add('active');
    // La section de résultats Wikipédia n'a de sens que pendant une recherche
    // (voir auroreRechercherWikipedia plus bas) : toute autre arrivée sur
    // screen-docs (navigation par catégorie, lien partagé, etc.) la réinitialise
    // pour ne jamais laisser d'anciens résultats Wikipédia affichés à tort.
    if (id === 'screen-docs' && typeof window.auroreReinitialiserSectionWikipedia === 'function') {
      window.auroreReinitialiserSectionWikipedia();
    }
    // Les publicités sont chargées une seule fois, mais chaque écran peut être
    // reconstruit après la navigation. On réaffiche donc immédiatement les
    // emplacements avec les données déjà reçues, sans nouvelle requête réseau.
    if(typeof peuplerEmplacementsPublicitaires === 'function' && PUBS_ACTIVES?.length){
      requestAnimationFrame(() => peuplerEmplacementsPublicitaires());
    }
    const scrollY = Number.isFinite(Number(options.scrollY)) ? Number(options.scrollY) : 0;
    window.scrollTo({top:scrollY,behavior:'auto'});
    if(!navigationParPopState) {
      try {
        const navigationId = ++navigationCompteur;
        history.pushState(
          creerSnapshotNavigation(id,0,navigationId),
          '',
          urlEntreeNavigation(navigationId)
        );
      } catch(e) {}
    }
  }

  async function restaurerVueHistorique(ecran) {
    if (ecran === 'screen-home') {
      rendreAccueil();
      document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
      document.getElementById('screen-home')?.classList.add('active');
      return;
    }
    if (ecran === 'screen-level') {
      if (!etat.niveau) {
        allerAccueil();
        return;
      }
      const sn=etat.sousNiveau;
      if (!sn) {
        // Recrée uniquement l'écran du niveau sans pousser d'état.
        const title=document.getElementById('levelTitle');
        const note=document.getElementById('levelNote');
        if(title) title.textContent=etat.niveau.nom;
        if(note) note.textContent=etat.niveau.desc;
        const grid=document.getElementById('sublevelGrid');
        const cat=document.getElementById('catGrid');
        if(grid){ grid.innerHTML=''; grid.style.display='grid'; (etat.niveau.sousNiveaux||[]).forEach(x=>{
          const b=document.createElement('button'); b.className='sublevel-card';
          b.innerHTML=`<div class="small">${etat.niveau.nom}</div><strong>${x.nom}</strong><span>${x.type==='serie'?'Choisir Seconde, Première ou Terminale':x.type==='groupe'?(x.desc||'Choisir une série'):x.type==='arbre'?(x.desc||'Explorer'):'Explorer ce niveau'}</span>`;
          b.onclick=()=>choisirSousNiveau(x.id); grid.appendChild(b);
        }); }
        if(cat) cat.style.display='none';
        majFilAriane(); afficherEcran('screen-level'); return;
      }
      if (sn.type==='arbre') {
        const dernier=(etat.cheminArbre||[]).at(-1);
        if(dernier?.matieres) { afficherCategoriesPourSousNiveau(); }
        else { afficherNoeudArbre(dernier || sn); }
        return;
      }
      if (sn.type==='groupe' && !etat.serieChoisie) {
        // Reproduit le groupe (Général/Technique) sans appeler une fonction qui
        // réinitialiserait l'état.
        const grid=document.getElementById('sublevelGrid'), cat=document.getElementById('catGrid');
        document.getElementById('levelTitle').textContent=`${etat.niveau.nom} · ${sn.nom}`;
        document.getElementById('levelNote').textContent='Choisissez votre série.';
        grid.innerHTML=''; grid.style.display='grid'; cat.style.display='none';
        (sn.troncCommuns||[]).forEach(tronc=>{ const b=document.createElement('button'); b.className='sublevel-card'; b.innerHTML=`<div class="small">${sn.nom}</div><strong>${tronc.nom}</strong><span>Tronc commun — ressources, devoirs et documents</span>`; b.onclick=()=>choisirClasseCommuneSecondCycle(tronc.id); grid.appendChild(b); });
        (sn.series||[]).forEach(serie=>{ const b=document.createElement('button'); b.className='sublevel-card'; b.innerHTML=`<div class="small">${sn.nom}</div><strong>${serie.nom}</strong><span>Choisir Première ou Terminale</span>`; b.onclick=()=>choisirSerieGroupe(serie.id); grid.appendChild(b); });
        majFilAriane(); afficherEcran('screen-level'); return;
      }
      if (etat.serieChoisie && !etat.classe) {
        const grid=document.getElementById('sublevelGrid'), cat=document.getElementById('catGrid');
        document.getElementById('levelTitle').textContent=`${etat.niveau.nom} · ${sn.nom} · ${etat.serieChoisie.nom}`;
        document.getElementById('levelNote').textContent='Choisissez votre classe.';
        grid.innerHTML=''; grid.style.display='grid'; cat.style.display='none';
        (etat.serieChoisie.classes||[]).forEach(cl=>{ const b=document.createElement('button'); b.className='sublevel-card'; b.innerHTML=`<div class="small">${etat.serieChoisie.nom}</div><strong>${cl.nom}</strong><span>Ressources, devoirs et documents</span>`; b.onclick=()=>choisirClasseSecondCycle(cl.id); grid.appendChild(b); });
        majFilAriane(); afficherEcran('screen-level'); return;
      }
      afficherCategoriesPourSousNiveau();
      return;
    }
    if (ecran === 'screen-matieres') {
      // La restauration peut recharger les compteurs de matières. On attend
      // réellement la fin du rendu avant de restaurer la position de scroll,
      // sinon le contenu qui arrive après le "Retour" décale l'utilisateur.
      if(etat.categorie) await allerMatieres();
      return;
    }
    if (ecran === 'screen-docs') {
      // Même principe pour les documents : attendre la reconstruction complète
      // de la liste évite que le chargement réseau écrase la position restaurée.
      if(etat.matiere) await allerDocuments(etat.matiere);
      return;
    }
    const cible=document.getElementById(ecran);
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    cible?.classList.add('active');
  }

  // ---------- LIEN DIRECT DE DOCUMENT PARTAGÉ ----------
  // Un lien partagé ne doit PAS ouvrir le PDF automatiquement. Il conduit
  // simplement le visiteur à l'endroit exact du document dans Aurore.
  function mettreEnEvidenceDocumentPartage(documentId) {
    const cible = [...document.querySelectorAll('.doc-row')].find(row =>
      String(row?._auroreDocument?.id ?? row?.dataset?.documentId ?? '') === String(documentId)
    );
    if (!cible) return false;
    cible.classList.add('aurore-document-partage-cible');
    cible.scrollIntoView({ behavior:'smooth', block:'center', inline:'nearest' });
    setTimeout(() => cible.classList.remove('aurore-document-partage-cible'), 5000);
    return true;
  }

  async function ouvrirDocumentDepuisLienPartage() {
    let documentId = '';
    try { documentId = new URLSearchParams(window.location.search).get('document') || ''; } catch (_) {}
    if (!documentId) return false;

    // Le partage reste public : aucune inscription ne doit interrompre le parcours.
    try { localStorage.setItem('aurore_visitor_mode','1'); } catch (_) {}
    try { window.auroreUnlockAccess?.(); } catch (_) {}
    document.body.classList.remove('site-locked');
    const accessLock = document.getElementById('accessLock');
    if (accessLock) accessLock.style.display = 'none';

    try {
      const params = new URLSearchParams();
      params.set('select', '*');
      params.set('id', 'eq.' + documentId);
      params.set('Publie', 'eq.true');
      params.set('limit', '1');
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?${params.toString()}`, { headers: HEADERS, cache:'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      const doc = Array.isArray(rows) ? rows[0] : null;
      if (!doc) return false;

      const categorie = String(doc['Catégorie'] || doc.Type || '').trim();
      const niveau = String(doc.Niveau || '').trim();
      const matiere = String(doc['Matière'] || '').trim();
      const genre = String(doc.Genre || '').trim();

      // Romans/Livres : on ouvre d'abord la rubrique Livres, puis le genre exact.
      if (categorie === 'Livres') {
        if (typeof allerLivres === 'function') allerLivres();
        const genreObjet = (typeof GENRES !== 'undefined' ? GENRES : []).find(g => String(g.nom) === genre);
        if (genreObjet && typeof allerDocumentsLivre === 'function') {
          await allerDocumentsLivre(genreObjet);
        } else {
          document.getElementById('docsTitle').textContent = genre ? `Livres et romans — ${genre}` : 'Livres et romans';
          const q = `${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent('Livres')}&Publie=eq.true` + (genre ? `&Genre=eq.${encodeURIComponent(genre)}` : '');
          const r = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&${q}`, {headers:HEADERS});
          const data = r.ok ? await r.json() : [doc];
          rendreListeDocuments(document.getElementById('docsContent'), data, true);
          afficherEcran('screen-docs');
        }
      } else {
        // Autres rubriques : on charge la collection exacte où le document est rangé.
        let q = `${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent(categorie)}&Publie=eq.true`;
        if (niveau) q += `&Niveau=eq.${encodeURIComponent(niveau)}`;
        if (matiere) q += `&${encodeURIComponent('Matière')}=eq.${encodeURIComponent(matiere)}`;
        if (doc.Filiere) q += `&Filiere=eq.${encodeURIComponent(doc.Filiere)}`;
        if (doc.Classe) q += `&Classe=eq.${encodeURIComponent(doc.Classe)}`;
        const r = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&${q}&order=id.desc`, {headers:HEADERS});
        const data = r.ok ? await r.json() : [doc];
        const morceaux = [categorie, niveau, matiere].filter(Boolean);
        document.getElementById('docsTitle').textContent = morceaux.join(' — ') || 'Documents';
        const back = document.querySelector('#screen-docs .back-btn');
        if (back) { back.setAttribute('data-back','home'); back.textContent='← Retour à l’accueil'; }
        rendreListeDocuments(document.getElementById('docsContent'), data, categorie === 'Livres');
        afficherEcran('screen-docs');
      }

      // Attend le rendu DOM, puis descend simplement jusqu'au document.
      requestAnimationFrame(() => setTimeout(() => mettreEnEvidenceDocumentPartage(documentId), 180));
      return true;
    } catch (e) {
      console.warn('[Aurore] lien partagé', e);
      return false;
    }
  }

  window.addEventListener('popstate', async (e)=>{
    // Fermeture volontaire du Laboratoire mathématique : le retour doit rester
    // sur la discussion Aurora, même si l'état précédent ne contient pas les
    // marqueurs habituels de navigation de l'écran.
    if(window.__auroraClosingGeoGebra){
      window.__auroraClosingGeoGebra=false;
      return;
    }

    // Filet de sécurité : si le Laboratoire GeoGebra est encore visible à cet
    // instant (drapeau ci-dessus non positionné à temps — bouton Retour
    // matériel/geste Android ou iOS déclenché directement), on ferme uniquement
    // le laboratoire ici.
    if (document.getElementById('auroraGeoGebraWorkspace')) {
      document.getElementById('auroraGeoGebraWorkspace')?.remove();
      window.__auroraClosingGeoGebra=false;
      return;
    }

    // Le lecteur PDF pousse son propre état d'historique à l'ouverture : le
    // Retour matériel doit donc fermer uniquement l'overlay.
    if (document.getElementById('pdfViewerOverlay')?.style.display === 'block') {
      fermerLecteurPDF();
      if (await restaurerSnapshotNavigation(e.state)) return;
      return;
    }

    // Même principe pour la page Wikipédia Aurore.
    if (document.getElementById('wikiViewerOverlay')?.style.display === 'block') {
      if (typeof window.auroreFermerArticleWikipedia === 'function') window.auroreFermerArticleWikipedia();
      if (await restaurerSnapshotNavigation(e.state)) return;
      return;
    }

    // Même principe pour le graphique Aurora agrandi.
    if (document.getElementById('auroraGraphOverlay')?.style.display === 'flex') {
      if (typeof window.auroraFermerGrandGraphique === 'function') window.auroraFermerGrandGraphique({fromPopState:true});
      if (await restaurerSnapshotNavigation(e.state)) return;
      return;
    }

    // Le module PDF admin possède sa propre pile d'historique.
    if (window.__auroreAdminPdfHistoryActive) return;

    // Même principe pour la fiche de gestion admin.
    if (document.getElementById('adminDetail')?.style.display === 'block') {
      fermerFicheAdmin();
      if (await restaurerSnapshotNavigation(e.state)) return;
      return;
    }

    const state=e.state;
    if(!state || !state.aurasterNavigation) return;

    await restaurerSnapshotNavigation(state);
  });

  window.addEventListener('scroll',()=>{
    if(!navigationParPopState){
      clearTimeout(window.__aurasterScrollTimer);
      window.__aurasterScrollTimer=setTimeout(enregistrerPositionNavigation,80);
    }
  },{passive:true});

  try {
    if(history.state && history.state.aurasterNavigation) {
      navigationCompteur = Math.max(0, Number(history.state.navigationId) || 0);
    } else {
      const initial = creerSnapshotNavigation('screen-home',window.scrollY,0);
      history.replaceState(initial,'',location.href);
      navigationCompteur = 0;
    }
    if('scrollRestoration' in history) history.scrollRestoration='manual';
    navigationInitialisee=true;
  } catch(e) {}

  // Les liens ?document=ID sont publics : aucune connexion n’est nécessaire.

  ouvrirDocumentDepuisLienPartage();

  async function restaurerSnapshotNavigation(state) {
    if(!state || !state.aurasterNavigation) return false;
    navigationParPopState=true;
    navigationRestaurationEnCours=true;
    try {
      etat=state.etatAuraster ? JSON.parse(JSON.stringify(state.etatAuraster)) : etatNavigationVide();
      await restaurerVueHistorique(state.ecranAuraster);
      majFilAriane();

      const scrollY=Number(state.scrollY)||0;
      await new Promise(resolve => requestAnimationFrame(() =>
        requestAnimationFrame(resolve)
      ));
      window.scrollTo({top:scrollY,behavior:'auto'});
      return true;
    } catch(err) {
      console.warn('[Aurore] restauration historique',err);
      return false;
    } finally {
      navigationRestaurationEnCours=false;
      navigationParPopState=false;
    }
  }

  function majFilAriane() {
    const bc = document.getElementById('breadcrumb');
    const parts = [{label:'Accueil', action:allerAccueil}];
    if (etat.niveau) parts.push({label:etat.niveau.nom, action:() => allerNiveau(etat.niveau.id)});
    if (etat.sousNiveau) parts.push({label:etat.sousNiveau.nom, action:() => choisirSousNiveau(etat.sousNiveau.id)});
    if (etat.serieChoisie) parts.push({label:etat.serieChoisie.nom, action:() => choisirSerieGroupe(etat.serieChoisie.id)});
    (etat.cheminArbre||[]).forEach((noeud, i) => parts.push({label:noeud.nom, action:() => revenirDansArbre(i)}));
    if (etat.categorie) parts.push({label:etat.categorie.nom, action:() => allerCategorie(etat.categorie.id)});
    if (etat.filiere && !etat.serieChoisie) parts.push({label:'Série ' + etat.filiere, action:null});
    if (etat.division) parts.push({label:etat.division, action:() => allerSerie(etat.division)});
    if (etat.matiere) parts.push({label:etat.matiere.nom, action:null});

    bc.innerHTML = '';
    parts.forEach((p, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'sep'; sep.textContent = '›';
        bc.appendChild(sep);
      }
      if (p.action) {
        const btn = document.createElement('button');
        btn.textContent = p.label;
        btn.onclick = p.action;
        bc.appendChild(btn);
      } else {
        const span = document.createElement('span');
        span.className = 'current'; span.textContent = p.label;
        bc.appendChild(span);
      }
    });
  }

  // ---------- PRÉSENTATION ----------
  function rendrePresentation() {
    const grid = document.getElementById('presentationGrid');
    if (!grid) return;
    grid.innerHTML = `
      <div class="presentation-item">
        <h4>${PRESENTATION_UNIFIEE.titre}</h4>
        <p>${PRESENTATION_UNIFIEE.texte}</p>
      </div>
    `;
  }

  // ---------- ACCUEIL ----------
  function rendreAccueil() {
    const overview = document.getElementById('homeFiveLevels');
    const secondaryChoices = document.getElementById('homeSecondaryChoices');

    if (overview) {
      overview.innerHTML = '';

      const portesAccueil = [
        {id:'prescolaire',label:'Préscolaire',desc:'Petite, moyenne et grande section',kicker:'Premiers apprentissages'},
        {id:'primaire',label:'Primaire',desc:'CP1 à CM2',kicker:'Du CP au CM2'},
        {id:'secondaire',label:'Secondaire',desc:'1er et 2nd cycle',kicker:'De la 6e au lycée',secondaire:true},
        {id:'cpge',label:'CPGE',desc:'MPSI, BCPST et PCSI',kicker:'Classes préparatoires'},
        {id:'superieur',label:'Supérieur',desc:'Licence, Master, Doctorat et MPCI',kicker:'Enseignement supérieur'}
      ];

      portesAccueil.forEach(porte => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'home-five-level';

        const niveauReference = porte.id === 'secondaire'
          ? NIVEAUX.find(n => n.id === 'secondaire-2')
          : NIVEAUX.find(n => n.id === porte.id);

        if (niveauReference?.accent) b.style.setProperty('--accent', niveauReference.accent);

        b.innerHTML = `
          <span class="home-door-kicker">${porte.kicker}</span>
          <strong>${porte.label}</strong>
          <span>${porte.desc}</span>
        `;

        b.onclick = () => {
          if (porte.secondaire) {
            if (secondaryChoices) {
              secondaryChoices.hidden = !secondaryChoices.hidden;
              if (!secondaryChoices.hidden) {
                secondaryChoices.scrollIntoView({behavior:'smooth', block:'nearest'});
              }
            }
            return;
          }
          allerNiveau(porte.id);
        };

        overview.appendChild(b);
      });
    }

    if (secondaryChoices) {
      secondaryChoices.hidden = true;
      secondaryChoices.querySelectorAll('[data-secondary-id]').forEach(btn => {
        btn.onclick = () => {
          secondaryChoices.hidden = true;
          allerNiveau(btn.dataset.secondaryId);
        };
      });
    }
    const grid = document.getElementById('levelGrid');
    grid.innerHTML = '';
    NIVEAUX.forEach(n => {
      const card = document.createElement('button');
      card.className = 'level-card';
      card.dataset.niveau = n.id;
      card.style.setProperty('--accent', n.accent);
      card.innerHTML = `
        <div class="level-badge">${n.sigle}</div>
        <h3>${n.nom}</h3>
        <p>${n.desc}</p>
        <p class="level-stats" style="margin-top:10px; font-size:0.78rem; color:var(--gris);">Chargement…</p>
        <div class="go">Explorer →</div>
      `;
      card.onclick = () => allerNiveau(n.id);
      grid.appendChild(card);
    });
    chargerStatsNiveaux();
    if(typeof peuplerEmplacementsPublicitaires === 'function' && PUBS_ACTIVES?.length){
      requestAnimationFrame(() => peuplerEmplacementsPublicitaires());
    }
  }

  // Rassemble récursivement les libellés "dbNiveaux" d'un niveau macro, en
  // descendant dans les groupes (Enseignement général / technique), les
  // séries et les classes du second cycle.
  function collecterDbNiveaux(macro) {
    const out = [];
    function creuser(noeud) {
      if (!noeud) return;
      if (noeud.dbNiveaux) out.push(...noeud.dbNiveaux);
      (noeud.troncCommuns || []).forEach(creuser);
      (noeud.series || []).forEach(creuser);
      (noeud.classes || []).forEach(creuser);
      (noeud.enfants || []).forEach(creuser);
    }
    creuser(macro);
    (macro?.sousNiveaux || []).forEach(creuser);
    return out;
  }

  async function chargerStatsNiveaux() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=Niveau&Publie=eq.true&Niveau=not.is.null`, { headers: HEADERS });
      if (!res.ok) return;
      const rows = await res.json();
      const stats = {};
      rows.forEach(r => {
        const level = String(r.Niveau || '');
        if (!stats[level]) stats[level] = {n:0};
        stats[level].n++;
      });
      document.querySelectorAll('.level-card').forEach(card => {
        const macro=NIVEAUX.find(n=>n.id===card.dataset.niveau);
        const labels=collecterDbNiveaux(macro);
        const n=labels.reduce((sum,l)=>sum+(stats[l]?.n||0),0);
        const el=card.querySelector('.level-stats');
        el.textContent=n ? `${n} document${n>1?'s':''} disponible${n>1?'s':''}` : 'Explorer les ressources';
      });
    } catch(err) {}
  }

  function allerAccueil() {
    etat = { niveau:null, sousNiveau:null, serieChoisie:null, classe:null, categorie:null, filiere:null, division:null, matiere:null, cheminArbre:[], feuilleArbre:null };
    majFilAriane();
    afficherEcran('screen-home');
  }

  // ---------- HIÉRARCHIE DES NIVEAUX ----------
  function allerNiveau(id) {
    etat.niveau = NIVEAUX.find(n => n.id === id);
    etat.sousNiveau = null; etat.serieChoisie = null; etat.classe = null; etat.categorie = null; etat.filiere = null; etat.division = null; etat.matiere = null; etat.cheminArbre = []; etat.feuilleArbre = null;

    // Certains niveaux de premier niveau (ex: CPGE) sont eux-mêmes une arborescence
    // générique et n'ont pas de "sousNiveaux" : on descend directement dedans.
    if (etat.niveau.type === 'arbre') {
      afficherNoeudArbre(etat.niveau);
      return;
    }

    document.getElementById('levelTitle').textContent = etat.niveau.nom;
    document.getElementById('levelNote').textContent = etat.niveau.desc;
    const seriesNote = document.getElementById('seriesMapNote');
    if (seriesNote) seriesNote.style.display = etat.niveau.id === 'secondaire-2' ? 'block' : 'none';

    const subGrid=document.getElementById('sublevelGrid');
    const catGrid=document.getElementById('catGrid');
    subGrid.innerHTML=''; catGrid.innerHTML=''; catGrid.style.display='none';
    subGrid.style.display='grid';

    (etat.niveau.sousNiveaux||[]).forEach(sn=>{
      const card=document.createElement('button');
      card.className='sublevel-card';
      const isSerie = sn.type === 'serie';
      const isGroupe = sn.type === 'groupe';
      const isArbre = sn.type === 'arbre';
      let sousTexte = 'Explorer ce niveau';
      if (isSerie) sousTexte = 'Choisir Seconde, Première ou Terminale';
      if (isGroupe) sousTexte = sn.desc || 'Choisir une série';
      if (isArbre) sousTexte = sn.desc || 'Explorer';
      card.innerHTML=`<div class="small">${etat.niveau.nom}</div><strong>${sn.nom}</strong><span>${sousTexte}</span>`;
      card.onclick=()=>choisirSousNiveau(sn.id);
      subGrid.appendChild(card);
    });
    majFilAriane(); afficherEcran('screen-level');
  }

  function choisirSousNiveau(id) {
    if(!etat.niveau) return;
    etat.sousNiveau=(etat.niveau.sousNiveaux||[]).find(x=>x.id===id) || null;
    etat.serieChoisie=null; etat.categorie=null; etat.matiere=null; etat.classe=null; etat.division=null; etat.filiere=null; etat.cheminArbre=[]; etat.feuilleArbre=null;
    if(!etat.sousNiveau) return;

    // Supérieur : arborescence générique à profondeur variable (Domaine/Formation/
    // Filière/Année/Semestre...). Voir afficherNoeudArbre / choisirNoeudArbre.
    if (etat.sousNiveau.type === 'arbre') {
      afficherNoeudArbre(etat.sousNiveau);
      return;
    }

    // Second cycle : Groupe (Enseignement général / technique) -> Série.
    if (etat.sousNiveau.type === 'groupe') {
      document.getElementById('levelTitle').textContent=`${etat.niveau.nom} · ${etat.sousNiveau.nom}`;
      document.getElementById('levelNote').textContent='Choisissez votre série.';
      const grid=document.getElementById('sublevelGrid');
      const catGrid=document.getElementById('catGrid');
      grid.style.display='grid'; grid.innerHTML='';
      catGrid.style.display='none';

      (etat.sousNiveau.troncCommuns||[]).forEach(tronc=>{
        const card=document.createElement('button');
        card.className='sublevel-card';
        card.innerHTML=`<div class="small">${etat.sousNiveau.nom}</div><strong>${tronc.nom}</strong><span>Tronc commun — ressources, devoirs et documents</span>`;
        card.onclick=()=>choisirClasseCommuneSecondCycle(tronc.id);
        grid.appendChild(card);
      });
      (etat.sousNiveau.series||[]).forEach(serie=>{
        const card=document.createElement('button');
        card.className='sublevel-card';
        card.innerHTML=`<div class="small">${etat.sousNiveau.nom}</div><strong>${serie.nom}</strong><span>Choisir Première ou Terminale</span>`;
        card.onclick=()=>choisirSerieGroupe(serie.id);
        grid.appendChild(card);
      });
      majFilAriane(); afficherEcran('screen-level');
      return;
    }

    // Second cycle (ancienne forme directe, conservée par compatibilité) : Série -> classe.
    if (etat.sousNiveau.type === 'serie') {
      etat.filiere = etat.sousNiveau.serie;
      document.getElementById('levelTitle').textContent=`${etat.niveau.nom} · ${etat.sousNiveau.nom}`;
      document.getElementById('levelNote').textContent='Choisissez votre classe.';
      const grid=document.getElementById('sublevelGrid');
      const catGrid=document.getElementById('catGrid');
      grid.style.display='grid'; grid.innerHTML='';
      catGrid.style.display='none';

      (etat.sousNiveau.classes||[]).forEach(cl=>{
        const card=document.createElement('button');
        card.className='sublevel-card';
        card.innerHTML=`<div class="small">${etat.sousNiveau.nom}</div><strong>${cl.nom}</strong><span>Ressources, devoirs et documents</span>`;
        card.onclick=()=>choisirClasseSecondCycle(cl.id);
        grid.appendChild(card);
      });
      majFilAriane(); afficherEcran('screen-level');
      return;
    }

    afficherCategoriesPourSousNiveau();
  }

  function choisirClasseCommuneSecondCycle(id) {
    if (!etat.sousNiveau || etat.sousNiveau.type !== 'groupe') return;
    const feuille = (etat.sousNiveau.troncCommuns||[]).find(x=>x.id===id) || null;
    if (!feuille) return;
    etat.classe = feuille;
    etat.serieChoisie = null;
    etat.filiere = '';
    etat.categorie=null; etat.matiere=null; etat.division=null;
    document.getElementById('levelTitle').textContent=`${etat.niveau.nom} · ${etat.sousNiveau.nom} · ${feuille.nom}`;
    document.getElementById('levelNote').textContent='Choisissez ensuite le type de ressource à explorer.';
    afficherCategoriesPourSousNiveau();
  }

  // Choix d'une série à l'intérieur d'un groupe (Enseignement général / technique).
  function choisirSerieGroupe(id) {
    if (!etat.sousNiveau || etat.sousNiveau.type !== 'groupe') return;
    const serie = (etat.sousNiveau.series||[]).find(s=>s.id===id) || null;
    if (!serie) return;
    etat.serieChoisie = serie;
    etat.filiere = serie.serie;
    etat.categorie=null; etat.matiere=null; etat.classe=null; etat.division=null;

    document.getElementById('levelTitle').textContent=`${etat.niveau.nom} · ${etat.sousNiveau.nom} · ${serie.nom}`;
    document.getElementById('levelNote').textContent='Choisissez votre classe.';
    const grid=document.getElementById('sublevelGrid');
    const catGrid=document.getElementById('catGrid');
    grid.style.display='grid'; grid.innerHTML='';
    catGrid.style.display='none';

    (serie.classes||[]).forEach(cl=>{
      const card=document.createElement('button');
      card.className='sublevel-card';
      card.innerHTML=`<div class="small">${serie.nom}</div><strong>${cl.nom}</strong><span>Ressources, devoirs et documents</span>`;
      card.onclick=()=>choisirClasseSecondCycle(cl.id);
      grid.appendChild(card);
    });
    majFilAriane(); afficherEcran('screen-level');
  }

  function choisirClasseSecondCycle(id) {
    const classesSource = etat.serieChoisie ? etat.serieChoisie.classes : (etat.sousNiveau ? etat.sousNiveau.classes : null);
    if (!classesSource) return;
    etat.classe = classesSource.find(x=>x.id===id) || null;
    if (!etat.classe) return;

    // La base actuelle stocke historiquement Seconde/Première/Terminale dans Niveau.
    // La série est conservée dans l'état de navigation sans changer la base à l'aveugle.
    etat.categorie=null; etat.matiere=null; etat.division=null;
    document.getElementById('levelTitle').textContent=`${etat.niveau.nom} · Série ${etat.filiere} · ${etat.classe.nom}`;
    document.getElementById('levelNote').textContent='Choisissez ensuite le type de ressource à explorer.';
    afficherCategoriesPourSousNiveau();
  }

  // ---------- ARBORESCENCE GÉNÉRIQUE (Supérieur : Domaine/Formation/Filière/Année/Semestre) ----------
  // Permet une profondeur variable sans multiplier les fonctions spécifiques :
  // chaque noeud a soit des "enfants" (on continue à descendre), soit une liste
  // "matieres" (c'est une feuille : on passe à la sélection Devoirs/Documents).
  function afficherNoeudArbre(noeud) {
    const racineLabel = etat.sousNiveau ? etat.sousNiveau.nom : null;
    const chemin = [racineLabel, ...etat.cheminArbre.map(n=>n.nom)].filter(Boolean);
    document.getElementById('levelTitle').textContent = `${etat.niveau.nom} · ${chemin.join(' · ')}`;
    document.getElementById('levelNote').textContent = noeud.desc || 'Choisissez une option pour continuer.';
    const grid=document.getElementById('sublevelGrid');
    const catGrid=document.getElementById('catGrid');
    grid.style.display='grid'; grid.innerHTML='';
    catGrid.style.display='none';

    (noeud.enfants||[]).forEach(enfant=>{
      const card=document.createElement('button');
      card.className='sublevel-card';
      const sousTexte = enfant.matieres ? 'Ressources, devoirs et documents' : 'Explorer';
      card.innerHTML=`<div class="small">${noeud.nom||''}</div><strong>${enfant.nom}</strong><span>${sousTexte}</span>`;
      card.onclick=()=>choisirNoeudArbre(enfant);
      grid.appendChild(card);
    });
    majFilAriane(); afficherEcran('screen-level');
  }

  function choisirNoeudArbre(enfant) {
    etat.cheminArbre.push(enfant);
    etat.categorie=null; etat.matiere=null;
    if (enfant.matieres) {
      // Feuille : ce noeud propose directement des matières.
      etat.feuilleArbre = enfant;
      const racineLabel = etat.sousNiveau ? etat.sousNiveau.nom : null;
      const chemin = [racineLabel, ...etat.cheminArbre.map(n=>n.nom)].filter(Boolean);
      document.getElementById('levelTitle').textContent = `${etat.niveau.nom} · ${chemin.join(' · ')}`;
      document.getElementById('levelNote').textContent = 'Choisissez ensuite le type de ressource à explorer.';
      afficherCategoriesPourSousNiveau();
    } else {
      afficherNoeudArbre(enfant);
    }
  }

  // Revient à l'affichage des enfants du noeud situé à "index" dans le chemin
  // (utilisé par le fil d'Ariane pour remonter d'un niveau dans l'arborescence).
  function revenirDansArbre(index) {
    const noeud = etat.cheminArbre[index];
    if (!noeud) return;
    etat.cheminArbre = etat.cheminArbre.slice(0, index+1);
    etat.feuilleArbre = null; etat.categorie = null; etat.matiere = null;
    afficherNoeudArbre(noeud);
  }

  function afficherCategoriesPourSousNiveau() {
    document.getElementById('sublevelGrid').style.display='none';
    const grid=document.getElementById('catGrid');
    grid.style.display='grid'; grid.innerHTML='';
    CATEGORIES.forEach(c=>{
      const card=document.createElement('button'); card.className='cat-card'; card.style.setProperty('--accent',c.accent);
      const contexte = etat.classe ? etat.classe.nom : (etat.feuilleArbre ? etat.feuilleArbre.nom : (etat.sousNiveau?.nom || etat.niveau.nom));
      card.innerHTML=`<div class="icon-wrap">${c.icon}</div><h3>${c.nom} — ${contexte}</h3><p>${c.desc}</p>`;
      card.onclick=()=>allerCategorie(c.id);
      grid.appendChild(card);
    });
    majFilAriane(); afficherEcran('screen-level');
  }

  function allerCategorie(id) {
    etat.categorie=CATEGORIES.find(c=>c.id===id); etat.division=null; etat.matiere=null;
    majFilAriane();
    allerMatieres();
  }

  // ---------- SÉRIE ----------
  function allerSerie(division) {
    etat.division = division;
    majFilAriane();
    allerMatieres();
  }

  // ---------- MATIÈRES ----------
  // Filtre de compatibilité : les anciennes lignes sans Filiere restent visibles,
  // tandis que les nouvelles lignes peuvent être filtrées par série.
  function filtreSerieSiDisponible(rows) {
    if (!etat.filiere) return rows;
    const aFiliere = rows.some(r => Object.prototype.hasOwnProperty.call(r, 'Filiere'));
    if (!aFiliere) return rows;
    return rows.filter(r => !r.Filiere || String(r.Filiere).toUpperCase() === String(etat.filiere).toUpperCase());
  }

  async function allerMatieres() {
    const niveauLabel = (etat.classe?.dbNiveaux?.[0]) || (etat.feuilleArbre?.dbNiveaux?.[0]) || (etat.sousNiveau?.dbNiveaux?.[0]) || '';
    const matieresListe = matieresAvecAutres(etat.classe?.matieres || etat.feuilleArbre?.matieres || etat.sousNiveau?.matieres || MATIERES);
    const serieLabel = etat.filiere ? ' — Série ' + etat.filiere : '';
    document.getElementById('matieresTitle').textContent =
      `${etat.categorie.nom} — ${etat.serieChoisie?.nom || etat.feuilleArbre?.nom || etat.sousNiveau?.nom || niveauLabel}${serieLabel}`;

    const grid = document.getElementById('matiereGrid');
    grid.innerHTML = '';

    if (matieresListe.length === 0) {
      grid.innerHTML = '<div class="doc-empty friendly-empty" style="grid-column:1/-1;"><div class="icon-wrap">'+ICONS.folder+'</div><h3>Aucun document disponible pour le moment.</h3><p>Cette rubrique sera enrichie progressivement.</p></div>';
      document.getElementById('matieresBack').onclick = () => afficherEcran('screen-level');
      majFilAriane();
      afficherEcran('screen-matieres');
      return;
    }

    matieresListe.forEach(m => {
      const card = document.createElement('button');
      card.className = 'matiere-card';
      card.dataset.matiere = m.nom;
      card.style.setProperty('--accent', etat.categorie.accent);
      card.innerHTML = `
        <div class="mono">${m.mono}</div>
        <div class="nom">${m.nom}</div>
        <span class="badge">…</span>
      `;
      card.onclick = () => allerDocuments(m);
      grid.appendChild(card);
    });

    document.getElementById('matieresBack').onclick = () => afficherEcran('screen-level');

    majFilAriane();
    afficherEcran('screen-matieres');

    // Récupère le nombre réel de documents publiés pour ce niveau/catégorie(/série)
    let query = niveauLabel ? `Niveau=eq.${encodeURIComponent(niveauLabel)}&${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent(etat.categorie.nom)}&Publie=eq.true` : `Niveau=eq.__none__&${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent(etat.categorie.nom)}&Publie=eq.true`;
    if (etat.filiere) query += `&Filiere=eq.${encodeURIComponent(etat.filiere)}`;
    if (etat.division) query += `&Classe=eq.${encodeURIComponent(etat.division)}`;

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=${encodeURIComponent('Matière')}&${query}`, { headers: HEADERS });
      if (!res.ok) return; // en cas d'erreur, les badges restent sur "…"
      const rows = filtreSerieSiDisponible(await res.json());
      const compte = {};
      rows.forEach(r => {
        const m = r['Matière'];
        compte[m] = (compte[m] || 0) + 1;
      });
      grid.querySelectorAll('.matiere-card').forEach(card => {
        const nom = card.dataset.matiere;
        const n = compte[nom] || 0;
        card.querySelector('.badge').textContent = n + (n > 1 ? ' documents' : ' document');
      });
    } catch (err) {
      // silencieux : les badges restent sur "…" si le comptage échoue
    }
  }

  