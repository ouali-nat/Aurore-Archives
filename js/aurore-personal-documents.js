  // ---------- ESPACE PERSONNEL : documents et livres de l'utilisateur ----------
  let MES_DOCUMENTS_PERSONNELS = [];
  let MES_LIVRES_PERSONNELS = [];
  let MES_NOTIFICATIONS_PERSONNELLES = [];

  function escapeTextePersonnel(v){ return echapperHtmlPub(v == null ? '' : String(v)); }

  let _chargementPersonnelSeq = 0;

  async function chargerDonneesEspacePersonnel(){
    const seq=++_chargementPersonnelSeq;
    if(!session?.id||!session?.access_token) return;

    const name=(session.user_metadata?.full_name||session.user_metadata?.name||session.user_metadata?.given_name||session.nom||'vous').trim();
    const welcome=document.getElementById('personalWelcomeName');
    if(welcome) welcome.textContent=name.split(' ')[0]||'vous';

    const loading=(id,text)=>{
      const el=document.getElementById(id);
      if(el) el.innerHTML=`<div class="activity-loading"><span></span><span>${escapeTextePersonnel(text)}</span></div>`;
    };
    const error=(id,text)=>{
      const el=document.getElementById(id);
      if(!el)return;
      el.innerHTML=`<div class="personal-empty activity-error"><strong>${escapeTextePersonnel(text)}</strong><br><button type="button" class="personal-action" data-activity-retry>Réessayer</button></div>`;
      el.querySelector('[data-activity-retry]')?.addEventListener('click',()=>chargerDonneesEspacePersonnel());
    };

    ['personalDocumentsList','personalBooksList','personalFavoritesList','personalLaterList','personalDownloadsHistory']
      .forEach(id=>loading(id,'Chargement…'));

    let docs=[];
    let rpcError=null;

    // 1. Source principale : RPC serveur confirmée par le diagnostic.
    try{
      const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/lister_documents_personnels`,{
        method:'POST',
        headers:{...headersAdmin(),'Content-Type':'application/json','Accept':'application/json'},
        body:'{}',
        cache:'no-store'
      });
      if(!r.ok){
        rpcError=new Error(`RPC HTTP ${r.status}`);
      }else{
        const data=await r.json();
        docs=Array.isArray(data)?data:[];
      }
    }catch(e){
      rpcError=e;
    }

    // 2. Si la RPC répond vide ou échoue, on vérifie directement la liaison.
    // Cela couvre les appels concurrents/états de session transitoires.
    if(!docs.length){
      try{
        const dr=await fetch(`${SUPABASE_URL}/rest/v1/Depots_deposants?select=document_id&user_id=eq.${encodeURIComponent(session.id)}&order=id.desc`,{
          headers:headersAdmin(),cache:'no-store'
        });
        if(dr.ok){
          const links=await dr.json();
          const ids=[...(Array.isArray(links)?links:[])]
            .map(x=>Number(x.document_id)).filter(Number.isFinite);

          if(ids.length){
            const rr=await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&id=in.(${ids.join(',')})&order=id.desc`,{
              headers:headersAdmin(),cache:'no-store'
            });
            if(rr.ok){
              const fallback=await rr.json();
              if(Array.isArray(fallback)&&fallback.length) docs=fallback;
            }
          }
        }
      }catch(e){
        console.warn('[Espace personnel] fallback direct:',e);
      }
    }

    // Une ancienne requête ne peut jamais écraser le résultat d'une requête
    // plus récente.
    if(seq!==_chargementPersonnelSeq)return;

    // 3. Ne jamais remplacer un résultat déjà valide par [].
    if(docs.length || !MES_DOCUMENTS_PERSONNELS.length){
      const map=new Map();
      docs.forEach(d=>{if(d?.id!=null)map.set(String(d.id),d);});
      MES_DOCUMENTS_PERSONNELS=[...map.values()].sort((a,b)=>Number(b.id||0)-Number(a.id||0));
    }

    MES_LIVRES_PERSONNELS=MES_DOCUMENTS_PERSONNELS.filter(
      d=>String(d['Catégorie']||'').trim().toLowerCase()==='livres'
    );

    // 4. Rendu des dépôts AVANT toutes les autres ressources.
    rendreDocumentsPersonnels();
    rendreLivresPersonnels();
    actualiserCompteursPersonnels();

    if(!MES_DOCUMENTS_PERSONNELS.length && rpcError){
      error('personalDocumentsList','Impossible de récupérer vos dépôts.');
      error('personalBooksList','Impossible de récupérer vos livres.');
    }

    // 5. Le reste ne bloque absolument plus les dépôts.
    Promise.allSettled([
      synchroniserRessourcesSupabase(),
      (async()=>{
        try{
          const nr=await fetch(`${SUPABASE_URL}/rest/v1/Notifications?select=id,titre_document,statut,message,created_at&user_id=eq.${encodeURIComponent(session.id)}&order=created_at.desc&limit=100`,{
            headers:headersAdmin(),cache:'no-store'
          });
          if(nr.ok) MES_NOTIFICATIONS_PERSONNELLES=await nr.json();
        }catch(e){console.warn('[Espace personnel] notifications:',e);}
      })()
    ]).then(async()=>{
      if(seq!==_chargementPersonnelSeq)return;
      actualiserCompteursPersonnels();
      rendreDocumentsPersonnels();
      rendreDocumentsPlusTard();
      rendreDocumentsTelecharges();
      try{await synchroniserRessourcesSupabase();}catch(e){}
      try{await rendreFavorisPersonnels();}catch(e){console.warn('[Espace personnel] favoris:',e);}
    });

    afficherNotificationTelechargementAuRetour();
  }

  function statutDocumentPersonnel(doc){
    return doc && doc.Publie===true ? 'accepted' : 'pending';
  }

  function texteStatutPersonnel(statut){
    if(statut==='accepted') return '✓ Accepté';
    if(statut==='refused') return '× Refusé';
    return '◷ En attente';
  }

  // Présentation commune Aurore : les documents de l'espace personnel
  // reprennent exactement la structure visuelle des documents publics.
  // Cette normalisation ne modifie aucun gestionnaire d'événement existant.
  function appliquerPresentationDocumentAurore(row, doc){
    if(!row) return row;
    const ancienCover=row.querySelector('.personal-doc-cover');
    const main=row.querySelector('.personal-doc-main,.personal-book-main');
    const actions=row.querySelector('.personal-doc-actions');
    const status=row.querySelector('.personal-status');
    if(!main||!actions) return row;

    let cover=ancienCover;
    if(!cover){
      cover=document.createElement('div');
      cover.className='personal-doc-cover icon-wrap';
      cover.innerHTML=ICONS.file;
    }else{
      cover.classList.add('icon-wrap');
    }
    main.classList.add('doc-main-info');
    const title=main.querySelector('.personal-doc-title,.personal-book-title');
    const meta=main.querySelector('.personal-doc-meta,.personal-book-meta');
    if(title) title.classList.add('titre');
    if(meta) meta.classList.add('meta');

    actions.classList.add('doc-actions');
    actions.querySelectorAll('.personal-action').forEach(btn=>{
      btn.classList.add('dl');
      if(!btn.matches('[data-read],[data-lire],[data-lire-tard],[data-lire-download]')){
        btn.classList.add('doc-action-soft');
      }
    });

    const info=document.createElement('div');
    info.className='info';
    info.append(cover,main);
    if(status) main.appendChild(status);
    row.replaceChildren(info,actions);
    row.classList.remove('personal-doc','personal-book');
    row.classList.add('doc-row','aurore-personal-document-row');
    row.__auroreDocumentCouverture=doc||null;
    return row;
  }

  function rendreDocumentsPersonnels(){
    const list=document.getElementById('personalDocumentsList');
    const count=document.getElementById('personalDocsCount');
    if(!list) return;
    const docs=[...MES_DOCUMENTS_PERSONNELS];
    const refus=[];
    (MES_NOTIFICATIONS_PERSONNELLES||[]).forEach(n=>{
      if(String(n.statut||'').toLowerCase()==='refuse') refus.push(n);
    });
    if(count) count.textContent=String(docs.length+refus.length);
    list.innerHTML='';
    if(!docs.length && !refus.length){
      list.innerHTML='<div class="personal-empty">Aucun document déposé pour le moment. Vos prochains dépôts apparaîtront ici avec leur statut.</div>';
      return;
    }
    docs.forEach(doc=>{
      const status=statutDocumentPersonnel(doc);
      const row=document.createElement('article'); row.className='personal-doc';
      const titre=doc.Titre||'Document sans titre';
      const contexte=[doc.Niveau&&`Niveau : ${doc.Niveau}`,doc.Classe&&`Classe : ${doc.Classe}`,doc.Filiere&&`Filière : ${doc.Filiere}`,doc['Matière']&&`Matière : ${doc['Matière']}`].filter(Boolean).join(' · ');
      row.innerHTML=`<div class="personal-doc-cover">${ICONS.file}</div><div class="personal-doc-main"><div class="personal-doc-title">${escapeTextePersonnel(titre)}</div><div class="personal-doc-meta">${escapeTextePersonnel(contexte||'Document déposé sur Aurore')}</div>${tailleBadgeMarkup(doc.Fichier_url)}</div></div><span class="personal-status ${status}">${texteStatutPersonnel(status)}</span><div class="personal-doc-actions">${doc.Fichier_url?`<button type="button" class="personal-action" data-read="1">Voir le document</button>`:''}<button type="button" class="personal-action doc-action-folder" data-case-personal="1">▣ Case</button></div>`;
      appliquerPresentationDocumentAurore(row,doc);
      row.querySelector('[data-read]')?.addEventListener('click',()=>ouvrirLecteurPDF(doc));
      row.querySelector('[data-case-personal]')?.addEventListener('click',()=>window.ouvrirChoixCaseDocument?.(doc));
      list.appendChild(row);
      if (doc.Fichier_url && typeof appliquerCouvertureSiLivre === 'function') appliquerCouvertureSiLivre(row,doc);
    });
    refus.slice(0,20).forEach(n=>{
      const row=document.createElement('article'); row.className='personal-doc';
      row.innerHTML=`<div class="personal-doc-main"><div class="personal-doc-title">${escapeTextePersonnel(n.titre_document||'Document')}</div><div class="personal-doc-meta">${escapeTextePersonnel(n.message||'Le dépôt n’a pas été publié.')}</div></div><span class="personal-status refused">× Refusé</span>`;
      list.appendChild(row);
    });
  }

  function rendreLivresPersonnels(){
    const count=document.getElementById('personalBooksCount');
    if(count) count.textContent=String(MES_LIVRES_PERSONNELS.length);
    const list=document.getElementById('personalBooksList');
    if(!list) return;
    const livres=[...MES_LIVRES_PERSONNELS];
    list.innerHTML='';
    if(!livres.length){list.innerHTML='<div class="personal-empty">Vous n’avez encore ajouté aucun livre.</div>';return;}
    livres.forEach(doc=>{
      const row=document.createElement('article'); row.className='personal-book';
      const status=doc.Publie===true?'accepted':'pending';
      row.innerHTML=`<div class="personal-doc-cover">${ICONS.book}</div><div class="personal-book-main"><div class="personal-book-title">${escapeTextePersonnel(doc.Titre||'Livre sans titre')}</div><div class="personal-book-meta">${escapeTextePersonnel(doc.Genre||'Livre')} · ${status==='accepted'?'Publié':'En attente de validation'}</div>${tailleBadgeMarkup(doc.Fichier_url)}</div></div><span class="personal-status ${status}">${texteStatutPersonnel(status)}</span><div class="personal-doc-actions"><button type="button" class="personal-action" data-read="1">Voir</button></div>`;
      appliquerPresentationDocumentAurore(row,doc);
      row.querySelector('[data-read]')?.addEventListener('click',()=>ouvrirLecteurPDF(doc));
      list.appendChild(row);
      if (doc.Fichier_url && typeof appliquerCouvertureSiLivre === 'function') appliquerCouvertureSiLivre(row,doc);
    });
  }

  function actualiserCompteursPersonnels(){
    const favCount=favoris().length, laterCount=plusTard().length, downCount=telecharges().length;
    const docsCount=MES_DOCUMENTS_PERSONNELS.length, booksCount=MES_LIVRES_PERSONNELS.length;
    [['personalDocsCount',docsCount],['personalDocsBadge',docsCount],['personalBooksCount',booksCount],['personalBooksBadge',booksCount],['personalFavoritesCount',favCount],['personalFavoritesBadge',favCount],['personalDownloadsCount',laterCount],['personalDownloadsBadge',laterCount],['personalLaterCount',laterCount],['personalDownloadsHistoryCount',downCount]].forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.textContent=String(value);});
  }

  async function rendreFavorisPersonnels(){
    const list=document.getElementById('personalFavoritesList');
    if(!list||!session)return;
    const ids=[...new Set(favoris().map(v=>String(v).trim()).filter(Boolean))];
    actualiserCompteursPersonnels();
    if(!ids.length){list.innerHTML='<div class="personal-empty">Aucun favori pour le moment. Utilisez « Favori » sur un document du site.</div>';return;}
    list.innerHTML='<div class="personal-empty">Chargement de vos favoris…</div>';
    try{
      const cacheKey=ids.join(',');
      const cached=favorisDocumentsCache.get(userKey());
      let docs;
      if(cached && cached.key===cacheKey && (Date.now()-cached.at)<FAVORIS_CACHE_TTL){
        docs=Array.isArray(cached.docs)?[...cached.docs]:[];
      }else{
        // Lecture publique des documents favoris. On évite force-cache afin de ne
        // pas réafficher une ancienne réponse après ajout/suppression d'un favori.
        // select=* : même schéma que toutes les autres lectures de "Document"
        // dans ce fichier (évite tout souci d'encodage avec une liste de
        // colonnes entre guillemets, qui pouvait renvoyer 0 résultat).
        const query=`id=in.(${ids.map(id=>id.replace(/[^a-zA-Z0-9_-]/g,'')).filter(Boolean).join(',')})&Publie=eq.true`;
        const r=await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&${query}`,{headers:HEADERS,cache:'no-store'});
        if(!r.ok){
          const detail=await r.text().catch(()=> '');
          throw new Error(`HTTP ${r.status} ${detail}`);
        }
        const data=await r.json();
        docs=Array.isArray(data)?data:[];
        favorisDocumentsCache.set(userKey(),{key:cacheKey,docs:[...docs],at:Date.now()});
      }
      const order=new Map(ids.map((id,i)=>[String(id),i]));
      docs.sort((a,b)=>(order.get(String(a.id))??9999)-(order.get(String(b.id))??9999));
      // Le compteur doit représenter les favoris réellement disponibles dans Aurore,
      // pas d'anciens identifiants conservés en base ou dans le cache local.
      const idsDisponibles=new Set(docs.map(doc=>String(doc.id)));
      const favorisActuels=favoris().filter(id=>idsDisponibles.has(String(id)));
      if(favorisActuels.length!==favoris().length){
        try{localStorage.setItem('aurore_favoris_documents_'+userKey(),JSON.stringify(favorisActuels));}catch(e){console.warn('[Favoris] nettoyage local impossible',e);}
        favorisDocumentsCache.delete(userKey());
      }
      actualiserCompteursPersonnels();
      list.innerHTML='';
      if(!docs.length){list.innerHTML='<div class="personal-empty">Vos favoris ne sont plus disponibles publiquement.</div>';return;}
      docs.forEach(doc=>{
        const row=document.createElement('article');row.className='personal-doc';
        row.innerHTML=`<div class="personal-doc-main"><div class="personal-doc-title">${escapeTextePersonnel(doc.Titre||'Document')}</div><div class="personal-doc-meta">${escapeTextePersonnel([doc.Niveau,doc['Matière']||doc.Genre].filter(Boolean).join(' · ')||'Document')}</div>${tailleBadgeMarkup(doc.Fichier_url)}</div></div><div class="personal-doc-actions"><button type="button" class="personal-action" data-read>Voir</button><button type="button" class="personal-action" data-telecharger-favori>Télécharger maintenant</button><button type="button" class="personal-action is-active" data-remove>♥ Favori</button><button type="button" class="personal-action doc-action-folder" data-case-fav>▣ Case</button></div>`;
        appliquerPresentationDocumentAurore(row,doc);
        row.querySelector('[data-read]')?.addEventListener('click',()=>ouvrirLecteurPDF(doc));
        row.querySelector('[data-telecharger-favori]')?.addEventListener('click',()=>telechargerDocumentAvecProgression(doc));
        row.querySelector('[data-remove]')?.addEventListener('click',()=>{basculerFavoriDocument(doc,row.querySelector('[data-remove]'));actualiserCompteursPersonnels();setTimeout(rendreFavorisPersonnels,0);});
        row.querySelector('[data-case-fav]')?.addEventListener('click',()=>window.ouvrirChoixCaseDocument?.(doc));
        list.appendChild(row);
      });
    }catch(e){
      console.error('[Favoris] chargement impossible',e);
      list.innerHTML=`<div class="personal-empty activity-error"><strong>Impossible de charger vos favoris pour le moment.</strong><br><span style="font-size:.72rem;opacity:.75">${escapeTextePersonnel(e?.message||'Erreur inconnue')}</span><br><button type="button" class="personal-action" data-favoris-retry>Réessayer</button></div>`;
      list.querySelector('[data-favoris-retry]')?.addEventListener('click',()=>rendreFavorisPersonnels());
    }
  }

  function initialiserEspacePersonnel(){
    const root=document.getElementById('personalSpace');
    if(!root||root.dataset.activityReady==='1')return;
    root.dataset.activityReady='1';
    root.addEventListener('click',e=>{
      const btn=e.target.closest?.('[data-personal-tab]');
      if(!btn||!root.contains(btn))return;
      const target=btn.dataset.personalTab;
      root.querySelectorAll('[data-personal-tab]').forEach(b=>{
        const active=b===btn;
        b.classList.toggle('is-active',active);
        b.setAttribute('aria-selected',active?'true':'false');
      });
      root.querySelectorAll('[data-personal-panel]').forEach(panel=>{
        const active=panel.dataset.personalPanel===target;
        panel.classList.toggle('active',active);
        panel.hidden=!active;
      });
    });
    document.getElementById('personalRefresh')?.addEventListener('click',()=>chargerDonneesEspacePersonnel());
  }

  initialiserEspacePersonnel();
  const _ouvrirProfilOriginal=window.ouvrirEspacePersonnelObligatoire;
  document.getElementById('btnOuvrirProfil')?.addEventListener('click',()=>{ if(document.getElementById('screen-profil')?.classList.contains('active')) return; chargerDonneesEspacePersonnel(); });
  // Chargement discret lorsque le profil est ouvert par le flux de connexion.
  const _afficherEcranOriginal=window.afficherEcran;
  if(typeof _afficherEcranOriginal==='function'){}

