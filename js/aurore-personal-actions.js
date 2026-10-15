(function(){
  const KEY_FAV='aurore_favoris_documents_';
  const KEY_LATER='aurore_documents_plus_tard_';
  const KEY_DOWNLOADS='aurore_documents_telecharges_';
  // Cache local des dépôts effectués par ce compte. Il sert uniquement de
  // filet de sécurité d'affichage lorsque la table de liaison Depots_deposants
  // est protégée par RLS et ne peut pas être lue par un élève.
  const KEY_DEPOSITS='aurore_depots_personnels_';
  const KEY_CODE='aurore_code_espace_';
  const FAVORIS_CACHE_TTL=30000;
  const favorisDocumentsCache=new Map();
  // Données personnelles synchronisées avec Supabase. Le localStorage reste
  // un cache/fallback afin de ne jamais perdre l'affichage pendant une panne réseau.
  const TABLE_FAVORIS_PERSONNELS='favoris_documents';
  const TABLE_PLUS_TARD_PERSONNELS='documents_plus_tard';
  const TABLE_TELECHARGEMENTS_PERSONNELS='telechargements_documents';

  async function fetchPersonnelAvecTimeout(url, options={}, timeout=12000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{return await fetch(url,{...options,signal:controller.signal,cache:options.cache||'no-store'});}
    finally{clearTimeout(timer);}
  }

  async function apiPersonnel(table, options={}){
    if(!session?.access_token) throw new Error('SESSION_ABSENTE');
    const url=`${SUPABASE_URL}/rest/v1/${table}${options.query?'?'+options.query:''}`;
    const headers={...headersAdmin(),'Content-Type':'application/json',...(options.headers||{})};
    const r=await fetchPersonnelAvecTimeout(url,{method:options.method||'GET',headers,body:options.body?JSON.stringify(options.body):undefined},12000);
    if(!r.ok){const detail=await r.text().catch(()=> '');throw new Error(`${table} HTTP ${r.status} ${detail}`);}
    return r.status===204?null:(await r.text()).trim();
  }

  async function synchroniserRessourcesSupabase(){
    if(!session?.id||!session?.access_token)return;

    // Chaque ressource est indépendante : une requête lente ou en erreur
    // ne peut plus maintenir les autres onglets en "Chargement…".
    const chargerFavoris=async()=>{
      try{
        const raw=await apiPersonnel(TABLE_FAVORIS_PERSONNELS,{
          query:`select=document_id&user_id=eq.${encodeURIComponent(session.id)}&order=created_at.desc`
        });
        const rows=raw?JSON.parse(raw):[];
        const ids=(Array.isArray(rows)?rows:[])
          .map(x=>String(x.document_id??'').trim()).filter(Boolean);
        safeWrite(KEY_FAV+userKey(),ids);
      }catch(e){
        console.warn('[Espace personnel] favoris Supabase:',e);
        if(localStorage.getItem(KEY_FAV+userKey())===null)safeWrite(KEY_FAV+userKey(),[]);
      }finally{
        // Toujours sortir de l'état "Chargement".
        try{await rendreFavorisPersonnels();}catch(e){console.warn('[Favoris] rendu:',e);}
        actualiserCompteursPersonnels();
      }
    };

    const chargerPlusTard=async()=>{
      try{
        const raw=await apiPersonnel(TABLE_PLUS_TARD_PERSONNELS,{
          query:`select=document_id,created_at&user_id=eq.${encodeURIComponent(session.id)}&order=created_at.desc`
        });
        const rows=raw?JSON.parse(raw):[];
        // CORRECTIF : la table "documents_plus_tard" ne stocke que
        // document_id/created_at (aucune colonne titre/URL) — remplacer
        // purement et simplement le cache local par cette lecture minimale
        // effaçait le titre, l'auteur et surtout Fichier_url déjà connus
        // localement (enregistrés au moment du clic sur « ＋ Plus tard »),
        // ce qui vidait l'affichage et cassait le bouton « Voir » (plus
        // d'URL à ouvrir) dès que l'espace personnel se rechargeait. On
        // fusionne donc avec les entrées locales existantes au lieu de les
        // écraser : Supabase reste la source de vérité pour la liste des id
        // réellement enregistrés, le cache local conserve leurs détails.
        const precedents=new Map(plusTard().map(x=>[String(x.id),x]));
        safeWrite(KEY_LATER+userKey(),(Array.isArray(rows)?rows:[])
          .map(x=>{
            if(x.document_id==null)return null;
            const ancien=precedents.get(String(x.document_id))||{};
            return {...ancien,id:x.document_id,saved_at:x.created_at};
          }).filter(Boolean));
      }catch(e){
        console.warn('[Espace personnel] Plus tard Supabase:',e);
        if(localStorage.getItem(KEY_LATER+userKey())===null)safeWrite(KEY_LATER+userKey(),[]);
      }finally{
        rendreDocumentsPlusTard();
        actualiserCompteursPersonnels();
      }
    };

    const chargerTelechargements=async()=>{
      let erreurLecture=null;
      try{
        const raw=await apiPersonnel(TABLE_TELECHARGEMENTS_PERSONNELS,{
          query:`select=id,document_id,titre_document,created_at&user_id=eq.${encodeURIComponent(session.id)}&order=created_at.desc&limit=100`
        });
        const rows=raw?JSON.parse(raw):[];
        const serveur=Array.isArray(rows)?rows.filter(x=>x&&x.document_id!=null):[];
        // Si Supabase contient des téléchargements, on enrichit chaque ligne avec
        // les vraies métadonnées du document. Si la table est momentanément vide,
        // on conserve le cache local au lieu de l'effacer.
        const anciens=new Map(telecharges().map(x=>[String(x.id),x]));
        let docs=[];
        if(serveur.length){
          const ids=[...new Set(serveur.map(x=>String(x.document_id)).filter(Boolean))];
          try{
            const q=ids.join(',');
            const rawDocs=await apiPersonnel('Document',{query:`select=*&id=in.(${q})`});
            const parsed=rawDocs?JSON.parse(rawDocs):[]; docs=Array.isArray(parsed)?parsed:[];
          }catch(e){console.warn('[Téléchargements] métadonnées documents:',e);}
        }
        const docMap=new Map(docs.map(d=>[String(d.id),d]));
        const fusion=serveur.length?serveur.map(x=>{
          const d=docMap.get(String(x.document_id))||{}; const ancien=anciens.get(String(x.document_id))||{};
          return {...ancien,...d,id:x.document_id,titre:d.Titre||x.titre_document||ancien.titre||'Document',auteur:d.Auteur||ancien.auteur||'',url:d.Fichier_url||ancien.url||'',categorie:d['Catégorie']||ancien.categorie||'',niveau:d.Niveau||ancien.niveau||'',matiere:d['Matière']||ancien.matiere||'',genre:d.Genre||ancien.genre||'',downloaded_at:x.created_at||ancien.downloaded_at};
        }):telecharges();
        if(serveur.length) safeWrite(KEY_DOWNLOADS+userKey(),fusion.slice(0,100));
      }catch(e){
        console.warn('[Espace personnel] téléchargements Supabase:',e);
        erreurLecture=e;
        // Ne vide jamais un historique local déjà existant en cas d'erreur réseau/RLS.
        if(localStorage.getItem(KEY_DOWNLOADS+userKey())===null)safeWrite(KEY_DOWNLOADS+userKey(),[]);
      }finally{
        rendreDocumentsTelecharges(erreurLecture);
        actualiserCompteursPersonnels();
      }

    };

    // Lancement simultané : les trois ressources ne se bloquent plus entre elles.
    await Promise.allSettled([
      chargerFavoris(),
      chargerPlusTard(),
      chargerTelechargements()
    ]);
  }

  async function synchroniserFavoriSupabase(docIdValue, active){
    if(!session?.id||!session?.access_token||!docIdValue)return;
    const q=`user_id=eq.${encodeURIComponent(session.id)}&document_id=eq.${encodeURIComponent(docIdValue)}`;
    try{
      if(active){
        await apiPersonnel(TABLE_FAVORIS_PERSONNELS,{method:'POST',query:'on_conflict=user_id,document_id',headers:{'Prefer':'resolution=ignore-duplicates,return=minimal'},body:{user_id:session.id,document_id:Number(docIdValue)}});
      }else{
        await apiPersonnel(TABLE_FAVORIS_PERSONNELS,{method:'DELETE',query:q,headers:{'Prefer':'return=minimal'}});
      }
    }catch(e){console.warn('[Favoris] synchronisation Supabase échouée',e);}
  }

  async function synchroniserPlusTardSupabase(doc, active){
    if(!session?.id||!session?.access_token||doc?.id==null)return;
    const q=`user_id=eq.${encodeURIComponent(session.id)}&document_id=eq.${encodeURIComponent(doc.id)}`;
    try{
      if(active){
        await apiPersonnel(TABLE_PLUS_TARD_PERSONNELS,{method:'POST',query:'on_conflict=user_id,document_id',headers:{'Prefer':'resolution=ignore-duplicates,return=minimal'},body:{user_id:session.id,document_id:Number(doc.id)}});
      }else{
        await apiPersonnel(TABLE_PLUS_TARD_PERSONNELS,{method:'DELETE',query:q,headers:{'Prefer':'return=minimal'}});
      }
    }catch(e){console.warn('[Plus tard] synchronisation Supabase échouée',e);}
  }

  async function synchroniserTelechargementSupabase(doc){
    if(!session?.id||!session?.access_token||doc?.id==null)throw new Error('Session ou document absent.');
    await apiPersonnel(TABLE_TELECHARGEMENTS_PERSONNELS,{method:'POST',headers:{'Prefer':'return=minimal'},body:{user_id:session.id,document_id:Number(doc.id),titre_document:doc.Titre||'Document'}});
    // Vérification réelle en base, comme pour les favoris et « Plus tard » :
    // sans cette étape, un échec silencieux côté RLS/schéma n'était jamais
    // visible et l'historique local se faisait ensuite écraser par la
    // resynchronisation suivante (qui relit la table, restée vide côté serveur).
    const check=await apiPersonnel(TABLE_TELECHARGEMENTS_PERSONNELS,{
      query:`user_id=eq.${encodeURIComponent(session.id)}&document_id=eq.${encodeURIComponent(doc.id)}&select=document_id&order=created_at.desc&limit=1`
    });
    const rows=check?JSON.parse(check):[];
    if(!Array.isArray(rows)||!rows.length){
      throw new Error('Le téléchargement n’a pas été confirmé par Supabase.');
    }
  }
  const codeModal=document.getElementById('accessCodeModal');
  const codeInput=document.getElementById('accessCodeInput');
  const codeMsg=document.getElementById('accessCodeMessage');
  const codeTitle=document.getElementById('accessCodeTitle');
  const codeIntro=document.getElementById('accessCodeIntro');
  let codeMode='verify';
  let codeResolve=null;
  let espaceOptions={};

  const userKey=()=>session&&session.id?String(session.id):'';
  const safeRead=(key)=>{try{const v=localStorage.getItem(key);return v?JSON.parse(v):[];}catch(e){return[];}};
  const safeWrite=(key,v)=>{try{localStorage.setItem(key,JSON.stringify(v));return true;}catch(e){return false;}};
  const docId=doc=>String(doc&&doc.id!=null?doc.id:'');
  function requireLogin(){
    const signup=document.getElementById('accessSignupBtn');
    if(signup) signup.click();
    setTimeout(()=>document.getElementById('showLoginBtn')?.click(),30);
    const m=document.getElementById('loginMessage');
    if(m){m.textContent='Connectez-vous pour utiliser les favoris et enregistrer des documents pour plus tard dans votre espace personnel.';m.className='access-message ok';m.style.display='block';}
  }
  function favoris(){return userKey()?safeRead(KEY_FAV+userKey()).map(String):[];}
  function plusTard(){return userKey()?safeRead(KEY_LATER+userKey()):[];}
  function telecharges(){return userKey()?safeRead(KEY_DOWNLOADS+userKey()):[];}
  function depotsPersonnelsLocaux(){return userKey()?safeRead(KEY_DEPOSITS+userKey()):[];}
  function memoriserDepotPersonnelLocal(doc){
    if(!session||!session.id||!doc||doc.id==null)return;
    const id=String(doc.id);
    let arr=depotsPersonnelsLocaux().filter(x=>String(x.id)!==id);
    arr.unshift({
      id:doc.id,Titre:doc.Titre||'Document',Auteur:doc.Auteur||session.nom||'',
      Fichier_url:doc.Fichier_url||'',Niveau:doc.Niveau||'',Classe:doc.Classe||null,
      Filiere:doc.Filiere||'',"Matière":doc['Matière']||'',Genre:doc.Genre||'',
      "Catégorie":doc['Catégorie']||'',Publie:doc.Publie===true,
      saved_at:new Date().toISOString()
    });
    safeWrite(KEY_DEPOSITS+userKey(),arr.slice(0,100));
  }
  async function enregistrerTelechargementPersonnel(doc){
    if(!session||!doc||doc.id==null)return false;
    const id=docId(doc); if(!id)return false;
    const key=KEY_DOWNLOADS+userKey();
    let arr=telecharges().filter(x=>String(x.id)!==id);
    const entree={id:doc.id,titre:doc.Titre||'Document',auteur:doc.Auteur||'',url:doc.Fichier_url||'',categorie:doc['Catégorie']||'',niveau:doc.Niveau||'',matiere:doc['Matière']||'',genre:doc.Genre||'',downloaded_at:new Date().toISOString()};
    arr.unshift(entree);
    const ok=safeWrite(key,arr.slice(0,100));
    if(!ok)return false;
    const verif=safeRead(key);
    if(!Array.isArray(verif)||!verif.some(x=>String(x.id)===id))return false;
    rendreDocumentsTelecharges();
    afficherNotificationTelechargement(entree);
    // Synchronisation distante : l'historique appartient au compte et revient
    // même après changement de navigateur/appareil. On attend désormais la
    // confirmation réelle : un échec (RLS/schéma) était auparavant avalé en
    // silence, puis l'entrée locale disparaissait à la resynchronisation
    // suivante (qui relit la table restée vide côté serveur) sans que
    // personne ne voie jamais la vraie raison.
    try{
      await synchroniserTelechargementSupabase(doc);
    }catch(err){
      // Aucune alerte native : même une erreur de synchronisation reste affichée
      // dans l'interface Aurore, sans message externe ni sortie du site.
      console.error('[Téléchargements] enregistrement réel impossible',err);
      afficherCarteTelechargement(
        doc,
        'succes',
        100,
        null,
        null,
        'Votre document a bien été téléchargé sur votre appareil. Vous pouvez continuer à utiliser Aurore.'
      );
    }
    return true;
  }

  function afficherNotificationTelechargement(entree){
    if(!session||!entree)return;
    const key='aurore_derniere_notification_telechargement_'+userKey();
    safeWrite(key,{id:String(entree.id),titre:entree.titre||'Document',downloaded_at:entree.downloaded_at||new Date().toISOString()});
    afficherCarteNotificationTelechargement(entree.titre||'Document');
  }

  function afficherCarteNotificationTelechargement(titre){
    let box=document.getElementById('downloadSavedNotice');
    if(!box){
      box=document.createElement('div'); box.id='downloadSavedNotice'; box.setAttribute('role','status'); box.setAttribute('aria-live','polite');
      box.style.cssText='position:fixed;left:16px;right:16px;bottom:18px;z-index:10020;max-width:520px;margin:0 auto;padding:14px 16px;border:1px solid var(--bordure);border-radius:16px;background:var(--papier);color:var(--encre);box-shadow:0 14px 35px rgba(0,0,0,.22);font-size:.88rem;line-height:1.45;display:flex;align-items:flex-start;gap:10px;';
      document.body.appendChild(box);
    }
    box.innerHTML='<span style="font-size:1.1rem;line-height:1">✓</span><div><strong>Téléchargement enregistré</strong><br><span>'+escapeTextePersonnel(titre)+'</span></div>';
    box.style.display='flex';
    clearTimeout(window.__auroreDownloadNoticeTimer);
    window.__auroreDownloadNoticeTimer=setTimeout(()=>{if(box)box.style.display='none';},7000);
  }

  function afficherNotificationTelechargementAuRetour(){
    if(!session||!session.id)return;
    const key='aurore_derniere_notification_telechargement_'+userKey();
    const n=safeRead(key);
    if(!n||typeof n!=='object'||!n.titre)return;
    const vuKey=key+'_vue';
    if(safeRead(vuKey)===n.downloaded_at)return;
    afficherCarteNotificationTelechargement(n.titre);
    safeWrite(vuKey,n.downloaded_at);
  }
  function basculerFavoriDocument(doc,button){
    if(!session){requireLogin();return;}
    const id=docId(doc); if(!id)return;
    let arr=favoris(); const i=arr.indexOf(id);
    if(i>=0){arr.splice(i,1);if(button)button.classList.remove('is-active');}
    else{arr.push(id);if(button)button.classList.add('is-active');}
    const ok=safeWrite(KEY_FAV+userKey(),arr);
    if(!ok) return;
    const verify=favoris();
    if(verify.length!==arr.length || arr.some(id=>!verify.includes(String(id)))) return;
    favorisDocumentsCache.delete(userKey());
    actualiserCompteursPersonnels();
    actualiserEtatActionsDocument(button?.closest('.doc-row,.recents-card')||button,doc);
    synchroniserFavoriSupabase(id,i<0);
  }
  function ajouterDocumentPlusTard(doc,button){
    if(!session){requireLogin();return;}
    const id=docId(doc); if(!id)return;
    let arr=plusTard();
    const i=arr.findIndex(x=>String(x.id)===id);
    const active=i<0;
    if(i>=0) arr.splice(i,1);
    else arr.unshift({id:doc.id,titre:doc.Titre||'Document',auteur:doc.Auteur||'',url:doc.Fichier_url||'',categorie:doc['Catégorie']||'',niveau:doc.Niveau||'',matiere:doc['Matière']||'',genre:doc.Genre||'',saved_at:new Date().toISOString()});
    if(!safeWrite(KEY_LATER+userKey(),arr))return;
    if(button){button.classList.toggle('is-active',active);button.textContent=active?'✓ Plus tard':'＋ Plus tard';}
    actualiserCompteursPersonnels();
    rendreDocumentsPlusTard();
    synchroniserPlusTardSupabase(doc,active);
  }
  function actualiserEtatActionsDocument(root,doc){
    if(!root||!doc||!userKey())return;
    const fav=favoris().includes(docId(doc));
    const fb=root.querySelector?.('[data-favori],[data-favori-card]'); if(fb){fb.classList.toggle('is-active',fav);fb.setAttribute('aria-pressed',String(fav));fb.textContent=fav?'♥ Favori':'♡ Favori';}
    const later=plusTard().some(x=>String(x.id)===docId(doc)); const lb=root.querySelector?.('[data-plus-tard],[data-plus-tard-card]'); if(lb){lb.classList.toggle('is-active',later);lb.textContent=later?'✓ Plus tard':'＋ Plus tard';}
  }
  window.basculerFavoriDocument=basculerFavoriDocument;
  window.ajouterDocumentPlusTard=ajouterDocumentPlusTard;
  window.actualiserEtatActionsDocument=actualiserEtatActionsDocument;

  async function supprimerTelechargementPersonnel(docIdValue){
    if(!session||!docIdValue)return;
    const id=String(docIdValue);
    const key=KEY_DOWNLOADS+userKey();
    const arr=telecharges();
    const next=arr.filter(x=>String(x.id)!==id);
    if(next.length===arr.length)return;
    safeWrite(key,next);
    rendreDocumentsTelecharges();
    actualiserCompteursPersonnels();
    try{
      await apiPersonnel(TABLE_TELECHARGEMENTS_PERSONNELS,{
        method:'DELETE',
        query:`user_id=eq.${encodeURIComponent(session.id)}&document_id=eq.${encodeURIComponent(id)}`,
        headers:{'Prefer':'return=minimal'}
      });
    }catch(e){
      // Le serveur reste la source de vérité : on restaure l'entrée locale si la suppression distante échoue.
      safeWrite(key,arr);
      rendreDocumentsTelecharges(e);
      actualiserCompteursPersonnels();
      throw e;
    }
  }

  async function effacerToutHistoriqueTelechargements(){
    if(!session)return false;
    const key=KEY_DOWNLOADS+userKey();
    const ancien=telecharges();
    try{
      await apiPersonnel(TABLE_TELECHARGEMENTS_PERSONNELS,{
        method:'DELETE',
        query:`user_id=eq.${encodeURIComponent(session.id)}`,
        headers:{'Prefer':'return=minimal'}
      });
      safeWrite(key,[]);
      safeWrite('aurore_derniere_notification_telechargement_'+userKey(),null);
      safeWrite('aurore_derniere_notification_telechargement_'+userKey()+'_vue',null);
      rendreDocumentsTelecharges();
      actualiserCompteursPersonnels();
      return true;
    }catch(e){
      safeWrite(key,ancien);
      rendreDocumentsTelecharges(e);
      actualiserCompteursPersonnels();
      return false;
    }
  }

  async function demanderCodePuisEffacerHistorique(){
    if(!session)return;
    if(!codeStocke()){
      alert('Créez d’abord votre code d’accès personnel depuis votre profil.');
      return;
    }
    const value=window.prompt('Entrez votre code d’accès personnel pour effacer tout l’historique des téléchargements :');
    if(value===null)return;
    if(!/^\d{4,8}$/.test(String(value).trim())){alert('Le code doit contenir entre 4 et 8 chiffres.');return;}
    try{
      const ok=(await hashCode(String(value).trim()))===codeStocke();
      if(!ok){alert('Code incorrect. L’historique n’a pas été effacé.');return;}
      const success=await effacerToutHistoriqueTelechargements();
      if(!success){alert('Impossible d’effacer l’historique sur le serveur. Vos données ont été conservées.');return;}
      afficherCarteNotificationTelechargement('Historique des téléchargements effacé');
    }catch(e){alert('Impossible de vérifier le code ou d’effacer l’historique.');}
  }

  function rendreDocumentsTelecharges(erreurLecture){
    const list=document.getElementById('personalDownloadsHistory'); if(!list||!session)return;
    const arr=telecharges();
    list.innerHTML='';
    if(!arr.length){
      if(erreurLecture){
        list.innerHTML=`<div class="personal-empty activity-error"><strong>Impossible de charger votre historique de téléchargements.</strong><br><span style="font-size:.72rem;opacity:.75">${escapeTextePersonnel(erreurLecture?.message||'Erreur inconnue')}</span><br><button type="button" class="personal-action" data-dl-retry>Réessayer</button></div>`;
        list.querySelector('[data-dl-retry]')?.addEventListener('click',()=>synchroniserRessourcesSupabase());
      }else{
        list.innerHTML='<div class="personal-empty">Aucun téléchargement enregistré pour le moment.</div>';
      }
      return;
    }
    arr.forEach(d=>{
      const row=document.createElement('article'); row.className='personal-book personal-history-row';
      const date=d.downloaded_at?new Date(d.downloaded_at).toLocaleString('fr-FR',{dateStyle:'medium',timeStyle:'short'}):'';
      row.innerHTML=`<div class="personal-book-main"><div class="personal-book-title">${escapeTextePersonnel(d.titre||'Document')}</div><div class="personal-book-meta">Téléchargé${date?' · '+escapeTextePersonnel(date):''}</div></div><div class="personal-doc-actions"><button type="button" class="personal-action" data-lire-download>Voir</button><button type="button" class="personal-action" data-telecharger-download>Télécharger</button><button type="button" class="personal-action" data-favori-download>♡ Favori</button><button type="button" class="personal-action doc-action-folder" data-case-download>▣ Case</button><button type="button" class="personal-history-delete" data-delete-download aria-label="Supprimer ce document de l’historique" title="Supprimer de l’historique">×</button></div>`;
      const historyDoc={id:d.id,Titre:d.titre,Auteur:d.auteur,Fichier_url:d.url,'Catégorie':d.categorie,Niveau:d.niveau,'Matière':d.matiere,Genre:d.genre};
      appliquerPresentationDocumentAurore(row,historyDoc);
      row.querySelector('[data-lire-download]')?.addEventListener('click',()=>ouvrirLecteurPDF(historyDoc));
      row.querySelector('[data-telecharger-download]')?.addEventListener('click',()=>telechargerDocumentAvecProgression(historyDoc));
      row.querySelector('[data-favori-download]')?.addEventListener('click',e=>basculerFavoriDocument(historyDoc,e.currentTarget));
      row.querySelector('[data-case-download]')?.addEventListener('click',()=>window.ouvrirChoixCaseDocument?.(historyDoc));
      row.querySelector('[data-delete-download]')?.addEventListener('click',async()=>{
        if(!confirm('Supprimer ce document de votre historique de téléchargements ?'))return;
        try{await supprimerTelechargementPersonnel(d.id);}catch(e){alert('Impossible de supprimer ce document de l’historique.');}
      });
      list.appendChild(row);
    });
  }
  window.rendreDocumentsTelecharges=rendreDocumentsTelecharges;

  function rendreDocumentsPlusTard(){
    const list=document.getElementById('personalLaterList'); if(!list||!session)return;
    const arr=plusTard();
    list.innerHTML='';
    if(!arr.length){list.innerHTML='<div class="personal-empty">Aucun document enregistré pour plus tard. Utilisez « ＋ Plus tard » sur un document du site.</div>';return;}
    arr.forEach(d=>{
      const row=document.createElement('article');row.className='personal-book';
      row.innerHTML=`<div class="personal-book-main"><div class="personal-book-title">${escapeTextePersonnel(d.titre)}</div><div class="personal-book-meta">Document enregistré pour plus tard${d.niveau?' · '+escapeTextePersonnel(d.niveau):''}</div>${tailleBadgeMarkup(d.url)}</div></div><div class="personal-doc-actions"><button type="button" class="personal-action" data-lire-tard>Voir</button><button type="button" class="personal-action" data-telecharger-tard>Télécharger maintenant</button><button type="button" class="personal-action doc-action-folder" data-case-later>▣ Case</button><button type="button" class="personal-action" data-remove-later>Retirer</button></div>`;
      appliquerPresentationDocumentAurore(row,{id:d.id,Titre:d.titre,Auteur:d.auteur,Fichier_url:d.url,'Catégorie':d.categorie,Niveau:d.niveau,'Matière':d.matiere,Genre:d.genre});
      row.querySelector('[data-lire-tard]')?.addEventListener('click',()=>ouvrirLecteurPDF({id:d.id,Titre:d.titre,Auteur:d.auteur,Fichier_url:d.url,'Catégorie':d.categorie,Niveau:d.niveau,'Matière':d.matiere,Genre:d.genre}));
      row.querySelector('[data-telecharger-tard]')?.addEventListener('click',()=>telechargerDocumentAvecProgression({id:d.id,Titre:d.titre,Auteur:d.auteur,Fichier_url:d.url,'Catégorie':d.categorie,Niveau:d.niveau,'Matière':d.matiere,Genre:d.genre}));
      row.querySelector('[data-case-later]')?.addEventListener('click',()=>window.ouvrirChoixCaseDocument?.({id:d.id,Titre:d.titre,Auteur:d.auteur,Fichier_url:d.url,'Catégorie':d.categorie,Niveau:d.niveau,'Matière':d.matiere,Genre:d.genre}));
      row.querySelector('[data-remove-later]')?.addEventListener('click',()=>ajouterDocumentPlusTard({id:d.id,Titre:d.titre,Auteur:d.auteur,Fichier_url:d.url,'Catégorie':d.categorie,Niveau:d.niveau,'Matière':d.matiere,Genre:d.genre},null));
      list.appendChild(row);
    });
  }
  window.rendreDocumentsPlusTard=rendreDocumentsPlusTard;


  // Favori depuis l’aperçu.
  document.getElementById('apercuFavori')?.addEventListener('click',()=>{if(typeof DOC_EN_APERCU!=='undefined'&&DOC_EN_APERCU)basculerFavoriDocument(DOC_EN_APERCU,document.getElementById('apercuFavori'));});
  document.getElementById('apercuPlusTard')?.addEventListener('click',()=>{if(typeof DOC_EN_APERCU!=='undefined'&&DOC_EN_APERCU)ajouterDocumentPlusTard(DOC_EN_APERCU,document.getElementById('apercuPlusTard'));});
  document.getElementById('apercuCase')?.addEventListener('click',()=>{if(typeof DOC_EN_APERCU!=='undefined'&&DOC_EN_APERCU)window.ouvrirChoixCaseDocument?.(DOC_EN_APERCU);});
  const oldOpen=window.ouvrirApercuDocument;
  // La fonction d’origine n’est pas exportée partout : on synchronise à chaque ouverture via un MutationObserver léger.
  const apercu=document.getElementById('apercuOverlay');
  if(apercu){new MutationObserver(()=>{if(apercu.style.display==='flex'&&typeof DOC_EN_APERCU!=='undefined'&&DOC_EN_APERCU)actualiserEtatActionsDocument(apercu,DOC_EN_APERCU);}).observe(apercu,{attributes:true,attributeFilter:['style']});}

  // Code d’accès personnel et déverrouillage biométrique local.
  // Cette biométrie est un raccourci de verrouillage sur l’appareil, pas une authentification serveur.
  const KEY_BIOMETRIE='aurore_biometrie_credential_';
  function codeStocke(){return userKey()?localStorage.getItem(KEY_CODE+userKey()):null;}
  const cleBiometrie=()=>userKey()?KEY_BIOMETRIE+userKey():'';
  function credentialBiometrique(){try{return cleBiometrie()?localStorage.getItem(cleBiometrie()):null;}catch(_){return null;}}
  function biometrieDisponible(){return !!(window.isSecureContext&&navigator.credentials&&window.PublicKeyCredential&&navigator.credentials.create&&navigator.credentials.get);}
  function bytesVersBase64Url(bytes){let b='';new Uint8Array(bytes).forEach(x=>b+=String.fromCharCode(x));return btoa(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
  function base64UrlVersBytes(value){const b64=String(value).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(b64+'='.repeat((4-b64.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
  function nouveauChallenge(){const b=new Uint8Array(32);crypto.getRandomValues(b);return b;}
  async function identifiantUtilisateurBiometrie(){const data=new TextEncoder().encode(userKey());return new Uint8Array(await crypto.subtle.digest('SHA-256',data)).slice(0,32);}
  function afficherMessageCode(message,classe){if(!codeMsg)return;codeMsg.textContent=message;codeMsg.className='access-code-message '+(classe||'');codeMsg.style.display='block';}
  async function hashCode(v){const data=new TextEncoder().encode(v);const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');}
  async function enregistrerBiometrie(){
    if(!session||!biometrieDisponible()){afficherMessageCode('La biométrie n’est pas disponible dans ce navigateur. Utilisez le code habituel.','err');return;}
    try{
      const cred=await navigator.credentials.create({publicKey:{
        challenge:nouveauChallenge(),rp:{name:'Aurore — Section Archives',id:location.hostname},
        user:{id:await identifiantUtilisateurBiometrie(),name:String(session.email||session.id),displayName:String(session.nom||session.email||'Utilisateur Aurore')},
        pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
        timeout:60000,attestation:'none',
        authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'preferred'}
      }});
      if(!cred||!cred.rawId)throw new Error('Aucun identifiant biométrique reçu.');
      localStorage.setItem(cleBiometrie(),bytesVersBase64Url(cred.rawId));
      actualiserBoutonsBiometrie();actualiserGestionBiometrieProfil();
      alert('Déverrouillage biométrique activé sur cet appareil. Le code reste disponible en secours.');
    }catch(e){
      console.warn('[Espace personnel] activation biométrique:',e);
      alert(e&&e.name==='NotAllowedError'?'Opération annulée ou verrouillage de l’appareil indisponible.':'Impossible d’activer la biométrie sur cet appareil. Le code reste disponible.');
    }
  }
  async function deverrouillerBiometrie(){
    if(!biometrieDisponible()||!credentialBiometrique()){afficherMessageCode('Aucune biométrie configurée. Utilisez votre code d’accès.','err');return;}
    try{
      const cred=await navigator.credentials.get({publicKey:{
        challenge:nouveauChallenge(),rpId:location.hostname,
        allowCredentials:[{type:'public-key',id:base64UrlVersBytes(credentialBiometrique())}],
        userVerification:'required',timeout:60000
      }});
      if(!cred||bytesVersBase64Url(cred.rawId)!==credentialBiometrique())throw new Error('Identifiant biométrique inattendu.');
      const options={...espaceOptions};closeCode();ouvrirEspaceInterne(options);
    }catch(e){
      console.warn('[Espace personnel] déverrouillage biométrique:',e);
      afficherMessageCode(e&&e.name==='NotAllowedError'?'Empreinte non validée ou opération annulée. Vous pouvez saisir votre code.':'Déverrouillage biométrique impossible. Utilisez votre code.','err');
    }
  }
  function showCode(mode,options){
    codeMode=mode;espaceOptions=options||{};if(!codeModal)return;
    codeMsg.className='access-code-message';codeMsg.textContent='';codeMsg.style.display='none';codeInput.value='';
    if(mode==='setup'){codeTitle.textContent='Créer votre code d’accès';codeIntro.textContent='Choisissez un code personnel de 4 à 8 chiffres. Il sera demandé avant l’ouverture de votre espace sur cet appareil.';}
    else {codeTitle.textContent='Code d’accès à votre espace';codeIntro.textContent='Saisissez votre code personnel pour ouvrir votre espace Aurore.';}
    actualiserBoutonsBiometrie();
    codeModal.style.display='flex';codeModal.setAttribute('aria-hidden','false');setTimeout(()=>{if(!credentialBiometrique())codeInput.focus();},50);
  }
  function closeCode(){codeModal.style.display='none';codeModal.setAttribute('aria-hidden','true');codeResolve?.(false);codeResolve=null;}
  function normaliserCodeAcces(raw){
    let value=String(raw||'').trim();
    const chiffres={'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9','０':'0','１':'1','２':'2','３':'3','４':'4','５':'5','６':'6','７':'7','８':'8','９':'9'};
    value=Array.from(value,c=>chiffres[c]||c).join('');
    return value.replace(/[\\s\\u200B-\\u200D\\uFEFF]/g,'');
  }
  async function confirmerReinitialisationCode(){
    if(!session||!userKey()){afficherMessageCode('Reconnectez-vous à votre compte pour réinitialiser ce verrou.','err');return;}
    if(!window.confirm('Réinitialiser le code local de cet appareil ? Vous devrez créer un nouveau code. Votre mot de passe de compte ne sera pas modifié.'))return;
    showCode('setup',{...espaceOptions,resetCode:true});
  }
  async function confirmCode(){
    const value=normaliserCodeAcces(codeInput.value);
    if(!/^[0-9]{4,8}$/.test(value)){afficherMessageCode('Le code doit contenir entre 4 et 8 chiffres. Vérifiez que vous avez saisi uniquement des chiffres, puis réessayez.','err');return;}
    if(codeMode==='setup'){
      try{
        const options={...espaceOptions};
        localStorage.setItem(KEY_CODE+userKey(),await hashCode(value));
        codeInput.value='';
        if(options.afterSetupBiometric){options.afterSetupBiometric=false;closeCode();espaceOptions=options;await enregistrerBiometrie();return;}
        afficherMessageCode('Nouveau code enregistré. Votre espace va s’ouvrir.','ok');
        setTimeout(()=>{closeCode();ouvrirEspaceInterne(options);},300);
      }catch(e){afficherMessageCode('Impossible d’enregistrer le code sur cet appareil.','err');}
      return;
    }
    try{
      const ok=(await hashCode(value))===codeStocke();
      if(!ok){afficherMessageCode('Code incorrect. Vous pouvez réessayer ou utiliser « Code oublié ? Réinitialiser ».','err');return;}
      const options={...espaceOptions};closeCode();
      if(options.biometricEnroll){await enregistrerBiometrie();return;}
      if(options.biometricDisable){try{localStorage.removeItem(cleBiometrie());}catch(_){}actualiserBoutonsBiometrie();actualiserGestionBiometrieProfil();alert('Déverrouillage biométrique désactivé.');return;}
      ouvrirEspaceInterne(options);
    }catch(e){afficherMessageCode('Impossible de vérifier le code.','err');}
  }
  const codeActions=document.querySelector('#accessCodeModal .access-code-actions');
  let codeBiometrieBtn=document.getElementById('accessCodeBiometrie');
  if(!codeBiometrieBtn&&codeActions){codeBiometrieBtn=document.createElement('button');codeBiometrieBtn.type='button';codeBiometrieBtn.id='accessCodeBiometrie';codeBiometrieBtn.className='personal-action';codeActions.insertBefore(codeBiometrieBtn,codeActions.firstChild);}
  function actualiserBoutonsBiometrie(){
    if(!codeBiometrieBtn)return;
    codeBiometrieBtn.hidden=!(biometrieDisponible()&&credentialBiometrique()&&codeMode==='verify'&&!espaceOptions.biometricEnroll&&!espaceOptions.biometricDisable);
    codeBiometrieBtn.textContent='Utiliser mon empreinte digitale';
    codeBiometrieBtn.setAttribute('aria-label','Déverrouiller avec la biométrie ou le verrouillage de cet appareil');
  }
  codeBiometrieBtn?.addEventListener('click',deverrouillerBiometrie);
  let codeResetBtn=document.getElementById('accessCodeReset');
  if(!codeResetBtn&&codeActions){
    codeResetBtn=document.createElement('button');codeResetBtn.type='button';codeResetBtn.id='accessCodeReset';
    codeResetBtn.className='personal-action';codeResetBtn.textContent='Code oublié ? Réinitialiser';
    codeActions.appendChild(codeResetBtn);
  }
  codeResetBtn?.addEventListener('click',confirmerReinitialisationCode);
  window.ouvrirGestionProtectionEspace=function(){
    if(!session){requireLogin();return;}
    if(!codeStocke())showCode('setup',{afterSetupBiometric:true});
    else showCode('verify',{biometricEnroll:!credentialBiometrique(),biometricDisable:!!credentialBiometrique()});
  };
  function ouvrirEspaceInterne(options={}){
    if(!session)return;if(typeof window.auroreUnlockAccess==='function')window.auroreUnlockAccess();document.getElementById('breadcrumb').innerHTML='';remplirProfil();
    const screen=document.getElementById('screen-profil');
    if(screen && options.forceComplete && !screen.querySelector('.profile-completion-banner')){const banner=document.createElement('div');banner.className='profile-completion-banner';banner.textContent='Bienvenue dans votre espace personnel. Avant de commencer, renseignez au minimum votre établissement, votre niveau et votre classe. Ces informations permettent à Aurore de personnaliser et organiser votre expérience.';screen.insertBefore(banner,screen.querySelector('.profile-card'));}
    auroreMasquerInvitationEspacePersonnel(false);
     afficherEcran('screen-profil');setTimeout(()=>chargerDonneesEspacePersonnel?.(),0);
  }
  function ouvrirEspaceAvecCode(options={}){
    if(!session)return;
    if(!codeStocke())showCode('setup',options);else showCode('verify',options);
  }
  window.ouvrirEspaceAvecCode=ouvrirEspaceAvecCode;
  document.getElementById('accessCodeConfirm')?.addEventListener('click',confirmCode);
  document.getElementById('accessCodeCancel')?.addEventListener('click',closeCode);
  codeModal?.addEventListener('click',e=>{if(e.target===codeModal)closeCode();});
  codeInput?.addEventListener('keydown',e=>{if(e.key==='Enter')confirmCode();if(e.key==='Escape')closeCode();});

  // Gestion du code et du raccourci biométrique depuis le profil.
  const meta=document.querySelector('#screen-profil .profile-meta');
  if(meta && !document.getElementById('profilCodeAccessCard')){
    const card=document.createElement('div');card.className='profile-meta-item';card.id='profilCodeAccessCard';
    card.innerHTML='<div class="label">Protection de l’espace personnel</div><div class="value" style="font-size:.82rem;font-weight:500;color:var(--gris);margin-bottom:10px;">La biométrie utilise le verrouillage de cet appareil. Le code reste disponible en secours et le mot de passe du compte reste inchangé.</div><button type="button" class="personal-action" id="profilCodeModifier">Modifier mon code</button> <button type="button" class="personal-action" id="profilBiometrieGerer"></button>';
    meta.appendChild(card);
    card.querySelector('#profilCodeModifier').addEventListener('click',()=>{if(session){showCode('setup',{});}});
    card.querySelector('#profilBiometrieGerer').addEventListener('click',()=>{
      if(!session)return;
      if(!biometrieDisponible()){alert('La biométrie n’est pas prise en charge dans ce navigateur. Essayez Chrome ou l’application Aurore installée, avec le verrouillage de l’appareil configuré.');return;}
      showCode('verify',{biometricEnroll:!credentialBiometrique(),biometricDisable:!!credentialBiometrique()});
    });
  }
  function actualiserGestionBiometrieProfil(){
    const btn=document.getElementById('profilBiometrieGerer');if(!btn)return;
    btn.hidden=!biometrieDisponible();
    btn.textContent=credentialBiometrique()?'Désactiver la biométrie':'Activer la biométrie';
  }
  actualiserGestionBiometrieProfil();

  // --- Correctif espace personnel (favoris / plus tard / téléchargements) ---
  // Le script principal (hors de cette IIFE) appelle favoris(), plusTard(),
  // telecharges(), userKey(), favorisDocumentsCache, synchroniserRessourcesSupabase()
  // et enregistrerTelechargementPersonnel() — mais ces identifiants n'existaient
  // que dans la portée locale de cette IIFE. Le script principal levait donc un
  // ReferenceError (favoris/plusTard/telecharges/... is not defined), ce qui
  // interrompait chargerDonneesEspacePersonnel() avant que les panneaux
  // « Favoris », « Plus tard » et « Téléchargements » ne soient jamais peints
  // (ni en données, ni en état vide « Aucun favori »/« Aucun téléchargement »).
  // On expose ici uniquement les identifiants nécessaires, sans toucher au
  // chargeur de « Mes documents »/« Mes livres » ni à aucune autre logique.
  window.favoris=favoris;
  window.plusTard=plusTard;
  window.telecharges=telecharges;
  window.userKey=userKey;
  window.favorisDocumentsCache=favorisDocumentsCache;
  // FAVORIS_CACHE_TTL manquait ici : rendreFavorisPersonnels() (script
  // principal, hors de cette IIFE) le référence directement et levait
  // "FAVORIS_CACHE_TTL is not defined", ce qui interrompait le rendu des
  // favoris avant même l'affichage de l'état vide.
  window.FAVORIS_CACHE_TTL=FAVORIS_CACHE_TTL;
  // Les fonctions de rendu des favoris vivent hors de cette IIFE : elles
  // utilisent safeWrite pour nettoyer les favoris devenus invalides.
  // Exposer safeWrite évite un ReferenceError qui bloquait tout le panneau.
  window.safeWrite=safeWrite;
  window.synchroniserRessourcesSupabase=synchroniserRessourcesSupabase;
  window.enregistrerTelechargementPersonnel=enregistrerTelechargementPersonnel;
  window.demanderCodePuisEffacerHistorique=demanderCodePuisEffacerHistorique;
  window.effacerToutHistoriqueTelechargements=effacerToutHistoriqueTelechargements;
  // Deux identifiants présentaient exactement le même défaut que
  // FAVORIS_CACHE_TTL plus haut (déclarés seulement dans la portée locale de
  // cette IIFE, mais appelés directement par le script principal hors de
  // cette IIFE) et n'étaient exposés nulle part ailleurs dans le fichier :
  // - memoriserDepotPersonnelLocal() : appelée juste après une insertion
  //   Supabase réussie lors d'un dépôt (le document était donc déjà
  //   enregistré) — son ReferenceError interrompait tout le reste de la
  //   fonction de soumission, empêchant à la fois l'affichage du message de
  //   succès ET le rafraîchissement de « Mes documents » qui le suit.
  // - afficherNotificationTelechargementAuRetour() : appelée à l'ouverture du
  //   site et à l'ouverture de l'espace personnel pour signaler un
  //   téléchargement effectué juste avant un rechargement de page.
  window.memoriserDepotPersonnelLocal=memoriserDepotPersonnelLocal;
  window.afficherNotificationTelechargementAuRetour=afficherNotificationTelechargementAuRetour;
})();
