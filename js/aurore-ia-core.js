
(function(){
  'use strict';

  const openBtn=document.getElementById('auroreIAHeaderBtn');
  const backBtn=document.getElementById('auroreIABack');
  const newBtn=document.getElementById('auroreIANew');
  const form=document.getElementById('auroreIAForm');
  const input=document.getElementById('auroreIAInput');
  const conversation=document.getElementById('auroreIAConversation');
  const screen=document.getElementById('screen-aurore-ia');
  const statusText=document.getElementById('auroreIAStatusText');
  const statusPill=document.querySelector('.aurore-ia-status');
  const sendBtn=form?form.querySelector('.aurore-ia-send'):null;
  const plusBtn=document.getElementById('auroreIAPlus');
  const plusMenu=document.getElementById('auroreIAPlusMenu');
  const menuBtn=document.getElementById('auroreIAMenuBtn');
  const historyOverlay=document.getElementById('auroreIAHistoryOverlay');
  const historyPanel=document.getElementById('auroreIAHistoryPanel');
  const historyList=document.getElementById('auroreIAHistoryList');
  const historyCloseBtn=document.getElementById('auroreIAHistoryClose');
  const historyNewBtn=document.getElementById('auroreIAHistoryNew');
  const stopBtn=document.getElementById('auroreIAStop');
  const imageInput=document.getElementById('auroreIAImageInput');
  const pdfInput=document.getElementById('auroreIAPdfInput');
  const attachmentsEl=document.getElementById('auroreIAAttachments');
  let fichiersIA=[];
  let arretDemande=false;
  const auroraEnCours={row:null,labelTimer:null};
  if(!openBtn||!form||!input||!conversation||!screen)return;

  // Câble le logo réel du site (même source que l'en-tête) sur les repères
  // "A" d'Aurora : le bandeau et l'écran d'accueil. N'écrase jamais un logo
  // déjà injecté, et ne bloque rien si l'image n'est pas encore disponible.
  function appliquerLogoAurora(){
    try{
      const url=(function(){try{return sessionStorage.getItem('aurore_logo_url')||'';}catch(_){return '';}})()||(typeof window.AURORE_LOGO_URL==='function'?window.AURORE_LOGO_URL():'');
      if(!url)return;
      document.querySelectorAll('#auroreIAMark,.aurore-ia-welcome-mark,.aurore-ia-history-item-avatar,.aurore-ia-msg-avatar').forEach(function(cont){
        if(!cont||cont.querySelector('img'))return;
        const img=new Image();
        img.decoding='async';img.loading='eager';img.alt='';
        img.onload=function(){cont.replaceChildren(img);};
        img.src=url;
      });
    }catch(_){}
  }
  appliquerLogoAurora();

  let activeTool='assistant', previousInteractionId=null, sending=false, iaCatalogSnapshot=null, iaFocusDocumentId=null, hasMessages=false;
  let currentConversationId=null, messagesActuels=[];
  const HTML_ACCUEIL_VIDE='<div class="aurore-ia-welcome"><div class="aurore-ia-welcome-orbit" aria-hidden="true"><div class="aurore-ia-welcome-mark">A</div></div><p class="aurore-ia-kicker">Aurora</p><h1>Le savoir, <span>simplement.</span></h1></div>';

  async function getSupabaseClient(){
    try{
      /* Client Auth déjà initialisé : on le réutilise. */
      if(typeof AURORE_SUPABASE_AUTH!=='undefined'&&AURORE_SUPABASE_AUTH)return AURORE_SUPABASE_AUTH;

      /* Le SDK Supabase est chargé en async dans le <head>. Aurora peut donc
         arriver ici avant que window.supabase existe. On attend brièvement le
         chargement naturel au lieu de déclarer immédiatement le client absent.
         Cela évite le faux message « espace sécurisé » sur les mobiles/réseaux
         lents, sans modifier le système d'authentification. */
      if(!window.supabase){
        const debut=Date.now();
        while(!window.supabase && Date.now()-debut<5000){
          await new Promise(resolve=>setTimeout(resolve,100));
        }
      }

      /* Si le SDK est maintenant disponible, reconstruire exactement le même
         client PKCE que celui utilisé par Google/Auth. */
      if(window.supabase&&typeof creerClientAuthGoogle==='function'){
        AURORE_SUPABASE_AUTH=creerClientAuthGoogle();
        if(AURORE_SUPABASE_AUTH)return AURORE_SUPABASE_AUTH;
      }

      /* Dernier recours : utiliser le chargeur avec son CDN de secours. */
      if(typeof assurerClientAuthGoogle==='function'){
        const client=await assurerClientAuthGoogle();
        if(client){AURORE_SUPABASE_AUTH=client;return client;}
      }

      /* Ultime filet de sécurité si le SDK est présent mais que le client Auth
         n'a pas encore été construit. */
      if(window.supabase?.createClient && typeof SUPABASE_URL!=='undefined' && typeof SUPABASE_ANON_KEY!=='undefined'){
        AURORE_SUPABASE_AUTH=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
          auth:{flowType:'pkce',autoRefreshToken:true,persistSession:true,detectSessionInUrl:false,storage:window.localStorage}
        });
        return AURORE_SUPABASE_AUTH;
      }
    }catch(e){
      console.error('[Aurora] Supabase:',e);
    }
    return null;
  }

  async function invokeAuroreIA(message, attachments=[]){
    // Timeout dédié à la phase "obtenir le client + la session" : sur un
    // réseau instable, client.auth.getSession() peut tenter un rafraîchissement
    // silencieux du jeton via un appel réseau qui ne se termine ni en succès
    // ni en erreur (requête qui reste juste en attente). Sans ce garde-fou,
    // le spinner tournait indéfiniment sans jamais afficher d'erreur.
    let client,sessionData;
    try{
      ({client,sessionData}=await Promise.race([
        (async()=>{
          const client=await getSupabaseClient();
          if(!client)throw new Error('Aurora n’arrive pas à joindre son espace sécurisé.');
          const {data:sessionData,error:sessionError}=await client.auth.getSession();
          if(sessionError)throw sessionError;
          return {client,sessionData};
        })(),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('TIMEOUT_AURORA_SESSION')),15000))
      ]));
    }catch(e){
      if(/TIMEOUT_AURORA_SESSION/i.test(e?.message||''))throw new Error('La connexion à Aurora met trop de temps à répondre. Vérifie ta connexion internet et réessaie.');
      throw e;
    }
    if(!sessionData?.session)throw new Error('Connectez-vous à Aurore pour utiliser Aurora.');
    const contexteRecent=messagesActuels.slice(-8).map(m=>({role:m.role==='assistant'?'assistant':'user',text:String(m.text||'').slice(0,3000)}));
    /* Mode DeepSeek unique : toutes les demandes passent désormais par
       le moteur unifié. Le routeur Aurora et les moteurs spécialisés séparés
       ne sont plus appelés depuis cette interface. */
    const body={
      message,
      previousInteractionId,
      catalogSnapshot:Array.isArray(iaCatalogSnapshot)?iaCatalogSnapshot:null,
      focusDocumentId:iaFocusDocumentId,
      conversationContext:contexteRecent,
      attachments:Array.isArray(attachments)?attachments:[],
      skillHint:'FORMAT MATHÉMATIQUE OBLIGATOIRE : si ta réponse contient des mathématiques, écris directement les formules en LaTeX standard avec \\( ... \\) pour une formule dans une phrase et \\[ ... \\] pour une formule isolée. N’utilise JAMAIS de marqueurs ou placeholders tels que @@AURORAMATH0@@, @@AURORA_MATH_0@@, [MATH], <math>, ou des jetons similaires. Les formules doivent contenir leur véritable expression mathématique. Si tu ne peux pas produire une formule, écris-la en texte mathématique lisible plutôt que d’émettre un placeholder. AURORA DISPOSE D’UNE CAPACITÉ GRAPHIQUE NATIVE RÉELLE DANS SON INTERFACE : lorsque l’utilisateur demande explicitement de tracer, construire, dessiner ou représenter graphiquement une fonction/courbe, réponds normalement et ne prétends JAMAIS être incapable de tracer. Le navigateur Aurora possède déjà son moteur graphique interactif ; laisse la demande de graphique être traitée par ce moteur. Les demandes de type « Trace la courbe de x² », « Construis la courbe de la fonction x carré », « Représente graphiquement y=sin(x) » ou « Trace x² et 2x+1 sur le même repère » sont des demandes GRAPH_MATH. N’invente aucun format d’API, aucun outil ou aucun marqueur graphique : le frontend Aurora utilise son moteur natif existant. Pour une simple explication ou une dérivée sans demande de tracé, réponds normalement sans forcer un graphique.'
    };
    async function tenterAppelAurora(){
      /* Appel HTTP direct vers l’Edge Function.
         Le jeton de session est envoyé dans le corps afin d’éviter un
         pré-vol CORS déclenché par l’en-tête Authorization du navigateur. */
      const endpoint=`${SUPABASE_URL}/functions/v1/aurora-deepseek-live`;
      let accessToken='';
      try{
        accessToken=sessionData?.session?.access_token||'';
      }catch(_){}
      if(!accessToken)throw new Error('Session Aurora absente. Reconnectez-vous à Aurore.');

      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),70000);
      let response;
      try{
        response=await fetch(endpoint,{
          method:'POST',
          headers:{'Content-Type':'text/plain;charset=UTF-8'},
          body:JSON.stringify({...body,accessToken}),
          signal:controller.signal
        });
      }catch(e){
        // Capture de l'exception brute levée par fetch() AVANT toute réponse HTTP
        // (uniquement pour le diagnostic — les messages affichés aux utilisateurs
        // ci-dessous ne sont pas modifiés).
        const brute={
          name:(e&&e.name!=null)?e.name:null,
          message:(e&&e.message!=null)?e.message:(e!=null?String(e):''),
          constructorName:(e&&e.constructor&&e.constructor.name)||null,
          code:(e&&e.code!=null)?e.code:null,
          causeName:(e&&e.cause&&e.cause.name)||null,
          causeMessage:(e&&e.cause&&e.cause.message)||null,
          stack:(e&&e.stack)||null
        };
        if(e?.name==='AbortError'){
          const erreurTimeout=new Error('Aurora n’a pas reçu la réponse de DeepSeek dans le délai prévu.');
          erreurTimeout.responseReceived=false;
          erreurTimeout.rawBrowserError=brute;
          throw erreurTimeout;
        }
        const erreurReseau=new Error('Impossible de joindre Aurora. Vérifie ta connexion internet.');
        erreurReseau.responseReceived=false;
        erreurReseau.rawBrowserError=brute;
        throw erreurReseau;
      }finally{
        clearTimeout(timer);
      }

      let raw='';
      try{raw=await response.text();}catch(_){
        const erreurLecture=new Error('Aurora a reçu une réponse illisible de son moteur.');
        erreurLecture.responseReceived=true;
        erreurLecture.httpStatus=response.status;
        throw erreurLecture;
      }

      let data=null;
      try{data=JSON.parse(raw);}catch(_){
        const erreurJson=new Error(`Aurora a renvoyé une réponse invalide (HTTP ${response.status}).`);
        erreurJson.responseReceived=true;
        erreurJson.httpStatus=response.status;
        throw erreurJson;
      }

      if(!response.ok||!data?.ok){
        let detail=data?.error||`Aurora a renvoyé une erreur HTTP ${response.status}.`;
        if(data?.stage)detail=`[${data.stage}] ${detail}`;
        if(data?.authStatus)detail+=` (HTTP ${data.authStatus})`;
        if(data?.networkProbe){
          const np=data.networkProbe;
          detail+=` — diagnostic DeepSeek : ${np.status ? 'HTTP '+np.status : (np.detail||'aucune réponse réseau')}`;
        }
        const erreurHttp=new Error(detail);
        erreurHttp.responseReceived=true;
        erreurHttp.httpStatus=response.status;
        throw erreurHttp;
      }

      if(data.id)previousInteractionId=data.id;
      if(Array.isArray(data.catalogSnapshot))iaCatalogSnapshot=data.catalogSnapshot;
      if(data.focusDocumentId!=null)iaFocusDocumentId=data.focusDocumentId;

      const texte=typeof data.text==='string'?data.text.trim():'';
      if(!texte)throw new Error('Aurora a reçu une réponse vide de son moteur.');
      return data;
    }
    return await tenterAppelAurora();
  }

  function setRouteActive(active){document.body.classList.toggle('aurore-ia-route-active',!!active);}

  function openIA(){
    if(screen.classList.contains('is-mini')){
      desactiverModeMini();
      requestAnimationFrame(()=>{input.focus({preventScroll:true});scrollBottom(true);});
      return;
    }
    if(!screen.classList.contains('active')){
      try{
        if(!history.state?.auroraIA){
          history.pushState({...(history.state||{}),auroraIA:true},'',location.href);
        }
      }catch(_){}
    }
    if(typeof afficherEcran==='function')afficherEcran('screen-aurore-ia');
    else{document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));screen.classList.add('active');}
    setRouteActive(true);
    requestAnimationFrame(()=>{input.focus({preventScroll:true});scrollBottom(true);});
  }

  // Point d'entrée public utilisé par le bouton Aurora flottant.
  // Il appelle directement le vrai ouvreur de l'IA au lieu de dépendre
  // d'un bouton-relais masqué dans l'en-tête.
  window.auroreOuvrirIA=openIA;

  // Exposition en lecture seule pour le Centre de diagnostic Aurora
  // (administration uniquement) : lui permet d'appeler le circuit réel
  // (même endpoint, mêmes paramètres) au lieu de dupliquer cette logique.
  // Ne change rien au fonctionnement normal d'Aurora pour les utilisateurs.
  window.invokeAuroreIA=invokeAuroreIA;

  function closeIA(){
    closePlusMenu();
    if(screen.classList.contains('is-mini')){
      desactiverModeMini({fermerCompletement:true});
      return;
    }
    try{
      if(history.state?.auroraIA){
        history.back();
        return;
      }
    }catch(_){}
    if(typeof afficherEcran==='function')afficherEcran('screen-home');
    else screen.classList.remove('active');
    setRouteActive(false);
  }

  openBtn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openIA();});
  backBtn?.addEventListener('click',e=>{e.preventDefault();closeIA();});

  // ---------- Mode réduit : Aurora en fenêtre flottante, déplaçable et
  // redimensionnable, pendant que le reste du site reste consultable. ----------
  const MINI_GEOM_KEY='aurore_ia_mini_geometry_v1';
  const minimizeBtn=document.getElementById('auroreIAMinimize');
  const resizeHandle=document.getElementById('auroreIAResizeHandle');
  // Icônes en forme de carré (plus lisibles que des flèches fines) : le
  // premier montre un grand carré avec un petit carré plein dans son coin —
  // "réduis-moi en fenêtre flottante" — le second est un carré plein simple —
  // "reviens en plein écran".
  const ICON_REDUIRE='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><rect x="13.2" y="13.2" width="7" height="7" rx="2" fill="currentColor" stroke="none"/></svg>';
  const ICON_AGRANDIR='<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill-opacity=".22"/></svg>';

  function geometrieMiniParDefaut(){
    const w=Math.min(380,Math.max(280,innerWidth-32));
    const h=Math.min(560,Math.max(340,innerHeight-32));
    return {x:Math.max(8,innerWidth-w-18),y:Math.max(8,innerHeight-h-18),w,h};
  }
  function lireGeometrieMini(){
    try{
      const g=JSON.parse(localStorage.getItem(MINI_GEOM_KEY)||'null');
      if(g&&[g.x,g.y,g.w,g.h].every(Number.isFinite))return g;
    }catch(e){}
    return geometrieMiniParDefaut();
  }
  function ecrireGeometrieMini(g){
    try{localStorage.setItem(MINI_GEOM_KEY,JSON.stringify(g));}catch(e){}
  }
  function clamperGeometrieMini(g){
    const w=Math.min(Math.max(g.w,280),Math.min(innerWidth-16,720));
    const h=Math.min(Math.max(g.h,340),Math.min(innerHeight-16,860));
    const x=Math.min(Math.max(g.x,4),Math.max(4,innerWidth-w-4));
    const y=Math.min(Math.max(g.y,4),Math.max(4,innerHeight-h-4));
    return {x,y,w,h};
  }
  function appliquerGeometrieMini(g){
    screen.style.left=g.x+'px';screen.style.top=g.y+'px';
    screen.style.width=g.w+'px';screen.style.height=g.h+'px';
  }
  function sauvegarderGeometrieActuelle(){
    const r=screen.getBoundingClientRect();
    ecrireGeometrieMini(clamperGeometrieMini({x:r.left,y:r.top,w:r.width,h:r.height}));
  }

  function activerModeMini(){
    if(screen.classList.contains('is-mini'))return;
    closePlusMenu();
    if(historyPanel?.classList.contains('is-open'))fermerHistorique();
    screen.classList.add('is-mini','active');
    appliquerGeometrieMini(clamperGeometrieMini(lireGeometrieMini()));
    setRouteActive(false);
    if(minimizeBtn){minimizeBtn.innerHTML=ICON_AGRANDIR;minimizeBtn.setAttribute('aria-label','Agrandir Aurora');minimizeBtn.title='Agrandir Aurora';}
  }
  function desactiverModeMini(options={}){
    if(!screen.classList.contains('is-mini'))return;
    screen.classList.remove('is-mini');
    screen.style.left='';screen.style.top='';screen.style.width='';screen.style.height='';
    if(minimizeBtn){minimizeBtn.innerHTML=ICON_REDUIRE;minimizeBtn.setAttribute('aria-label','Réduire Aurora en fenêtre flottante');minimizeBtn.title='Réduire Aurora';}
    if(options.fermerCompletement){
      screen.classList.remove('active');
      setRouteActive(false);
    }else{
      if(typeof afficherEcran==='function')afficherEcran('screen-aurore-ia');
      else screen.classList.add('active');
      setRouteActive(true);
    }
  }
  minimizeBtn?.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    if(screen.classList.contains('is-mini'))desactiverModeMini();else activerModeMini();
  });

  // API interne exposée au menu principal : permet au menu de l'accueil
  // d'utiliser exactement le même circuit de réduction que le bouton Aurora.
  window.auroreReduireIA=activerModeMini;

  // Glisser le bandeau du haut déplace la fenêtre réduite (souris et
  // tactile) — depuis n'importe quel point du bandeau, y compris par-dessus
  // un bouton (historique, nouvelle conversation, retour…). On distingue un
  // vrai glissement d'un simple tap grâce à un seuil de mouvement : sous ce
  // seuil, le bouton touché reçoit son clic normalement ; au-delà, on prend
  // la main sur le déplacement et on bloque le clic qui aurait suivi.
  (function initDeplacementMini(){
    const topbar=screen.querySelector('.aurore-ia-topbar');
    if(!topbar)return;
    let actif=false,bouge=false,sx=0,sy=0,sl=0,st=0;
    const SEUIL=4;
    topbar.addEventListener('pointerdown',e=>{
      if(!screen.classList.contains('is-mini'))return;
      actif=true;bouge=false;
      const r=screen.getBoundingClientRect();
      sx=e.clientX;sy=e.clientY;sl=r.left;st=r.top;
      try{topbar.setPointerCapture?.(e.pointerId);}catch(_){}
    });
    topbar.addEventListener('pointermove',e=>{
      if(!actif)return;
      const dx=e.clientX-sx,dy=e.clientY-sy;
      if(!bouge&&(Math.abs(dx)>SEUIL||Math.abs(dy)>SEUIL))bouge=true;
      if(!bouge)return;
      const r=screen.getBoundingClientRect();
      const g=clamperGeometrieMini({x:sl+dx,y:st+dy,w:r.width,h:r.height});
      screen.style.left=g.x+'px';screen.style.top=g.y+'px';
    });
    const fin=e=>{
      if(!actif)return;actif=false;
      try{topbar.releasePointerCapture?.(e.pointerId);}catch(_){}
      if(bouge)sauvegarderGeometrieActuelle();
    };
    topbar.addEventListener('pointerup',fin);
    topbar.addEventListener('pointercancel',fin);
    // Capturé avant que l'événement n'atteigne le bouton visé : si le
    // pointeur a réellement bougé, on empêche l'action du bouton de se
    // déclencher juste après le glissement.
    topbar.addEventListener('click',e=>{
      if(bouge){e.stopPropagation();e.preventDefault();bouge=false;}
    },true);
  })();

  // Poignée en bas à droite + bords : redimensionne la fenêtre réduite d'un
  // glissement naturel au doigt, depuis le coin ou depuis n'importe quel côté.
  (function initRedimensionnementMini(){
    const poignees=[
      {el:resizeHandle,mode:'se'},
      {el:document.querySelector('.aurore-ia-resize-e'),mode:'e'},
      {el:document.querySelector('.aurore-ia-resize-w'),mode:'w'},
      {el:document.querySelector('.aurore-ia-resize-s'),mode:'s'}
    ].filter(p=>p.el);
    poignees.forEach(({el:handle,mode})=>{
      let actif=false,sx=0,sy=0,sw=0,sh=0,sl=0,st=0;
      handle.addEventListener('pointerdown',e=>{
        if(!screen.classList.contains('is-mini'))return;
        e.preventDefault();e.stopPropagation();
        actif=true;
        const r=screen.getBoundingClientRect();
        sx=e.clientX;sy=e.clientY;sw=r.width;sh=r.height;sl=r.left;st=r.top;
        try{handle.setPointerCapture?.(e.pointerId);}catch(_){}
      });
      handle.addEventListener('pointermove',e=>{
        if(!actif)return;
        const dx=e.clientX-sx,dy=e.clientY-sy;
        if(mode==='se'){
          const g=clamperGeometrieMini({x:sl,y:st,w:sw+dx,h:sh+dy});
          screen.style.width=g.w+'px';screen.style.height=g.h+'px';
        }else if(mode==='e'){
          const g=clamperGeometrieMini({x:sl,y:st,w:sw+dx,h:sh});
          screen.style.width=g.w+'px';
        }else if(mode==='s'){
          const g=clamperGeometrieMini({x:sl,y:st,w:sw,h:sh+dy});
          screen.style.height=g.h+'px';
        }else if(mode==='w'){
          const g=clamperGeometrieMini({x:sl+dx,y:st,w:sw-dx,h:sh});
          screen.style.left=g.x+'px';screen.style.width=g.w+'px';
        }
      });
      const fin=e=>{
        if(!actif)return;actif=false;
        try{handle.releasePointerCapture?.(e.pointerId);}catch(_){}
        sauvegarderGeometrieActuelle();
      };
      handle.addEventListener('pointerup',fin);
      handle.addEventListener('pointercancel',fin);
    });
  })();

  addEventListener('resize',()=>{
    if(!screen.classList.contains('is-mini'))return;
    const r=screen.getBoundingClientRect();
    appliquerGeometrieMini(clamperGeometrieMini({x:r.left,y:r.top,w:r.width,h:r.height}));
  },{passive:true});

  // Point d'entrée utilisé par l'Accueil flottant pour fermer proprement
  // Aurora (plein écran ou réduite) avant de rejoindre l'accueil.
  window.auroreIAFermerVersAccueil=function(){
    closePlusMenu();
    if(historyPanel?.classList.contains('is-open'))fermerHistorique();
    if(screen.classList.contains('is-mini')){
      screen.classList.remove('is-mini');
      screen.style.left='';screen.style.top='';screen.style.width='';screen.style.height='';
      if(minimizeBtn){minimizeBtn.innerHTML=ICON_REDUIRE;minimizeBtn.setAttribute('aria-label','Réduire Aurora en fenêtre flottante');minimizeBtn.title='Réduire Aurora';}
    }
    screen.classList.remove('active');
    setRouteActive(false);
    if(typeof afficherEcran==='function')afficherEcran('screen-home');
    else document.getElementById('screen-home')?.classList.add('active');
  };

  function demarrerNouvelleConversation(){
    previousInteractionId=null;sending=false;iaCatalogSnapshot=null;iaFocusDocumentId=null;hasMessages=false;
    currentConversationId=null;messagesActuels=[];
    closePlusMenu();
    conversation.innerHTML=HTML_ACCUEIL_VIDE;
    appliquerLogoAurora();
    input.value='';autoGrow();updateSendState();scrollBottom(true);
  }

  newBtn?.addEventListener('click',()=>{
    demarrerNouvelleConversation();
    input.focus({preventScroll:true});
  });

  /* ---------- Historique des discussions (stocké dans Supabase, par utilisateur) ---------- */
  let auroreHistoriqueCache=[];
  async function obtenirUtilisateurCourant(){
    try{
      const client=await getSupabaseClient();
      if(!client)return null;
      const {data,error}=await client.auth.getUser();
      if(error||!data?.user)return null;
      return {client,userId:data.user.id};
    }catch(e){return null;}
  }
  const HISTORIQUE_LOCAL_CLE='aurora-conversations-local-v2';
  function lireHistoriqueLocal(){
    try{const x=JSON.parse(localStorage.getItem(HISTORIQUE_LOCAL_CLE)||'[]');return Array.isArray(x)?x:[];}catch(_){return [];}
  }
  function ecrireHistoriqueLocal(liste){
    try{localStorage.setItem(HISTORIQUE_LOCAL_CLE,JSON.stringify(liste.slice(0,40)));}catch(_){}
  }
  async function chargerHistoriqueDistant(){
    const local=lireHistoriqueLocal();
    const ctx=await obtenirUtilisateurCourant();
    if(!ctx)return local;
    try{
      const {data,error}=await ctx.client
        .from('aurore_ia_conversations')
        .select('id,titre,messages,previous_interaction_id,catalog_snapshot,focus_document_id,maj')
        .eq('user_id',ctx.userId)
        .order('maj',{ascending:false})
        .limit(40);
      if(error)throw error;
      const distant=Array.isArray(data)?data:[];
      return distant.length?distant:local;
    }catch(e){console.error('[Aurora] historique distant:',e);return local;}
  }
  function titreDepuisTexte(texte){
    const t=String(texte||'').replace(/\s+/g,' ').trim();
    return t.length>54?t.slice(0,54)+'…':(t||'Nouvelle discussion');
  }
  async function sauvegarderConversationCourante(){
    if(!messagesActuels.length)return;
    const ctx=await obtenirUtilisateurCourant();
    if(!ctx)return;
    const premierMessage=messagesActuels.find(m=>m.role==='user');
    const donnees={
      user_id:ctx.userId,
      titre:titreDepuisTexte(premierMessage?premierMessage.text:''),
      messages:messagesActuels,
      previous_interaction_id:previousInteractionId,
      catalog_snapshot:iaCatalogSnapshot,
      focus_document_id:iaFocusDocumentId,
      maj:new Date().toISOString()
    };
    if(currentConversationId)donnees.id=currentConversationId;
    /* L'historique doit rester visible même si Supabase met quelques secondes
       à répondre ou si la politique RLS bloque momentanément l'écriture. */
    const local=lireHistoriqueLocal().filter(c=>c.id!==donnees.id);
    const localConv={...donnees,id:donnees.id||('local-'+Date.now())};
    ecrireHistoriqueLocal([localConv,...local]);
    if(!donnees.id)currentConversationId=localConv.id;
    try{
      const {data,error}=await ctx.client
        .from('aurore_ia_conversations')
        .upsert(donnees)
        .select('id')
        .single();
      if(error)throw error;
      if(data?.id){
        currentConversationId=data.id;
        const refreshed=lireHistoriqueLocal().filter(c=>c.id!==localConv.id&&c.id!==data.id);
        ecrireHistoriqueLocal([{...donnees,id:data.id},...refreshed]);
      }
    }catch(e){console.error('[Aurora] sauvegarde historique distant:',e);}
  }
  function formaterDateHistorique(ts){
    try{
      const d=new Date(ts);
      return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})+' · '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    }catch(e){return '';}
  }
  async function rendreListeHistorique(){
    if(!historyList)return;
    historyList.innerHTML='<p class="aurore-ia-history-empty">Chargement…</p>';
    const liste=await chargerHistoriqueDistant();
    auroreHistoriqueCache=liste;
    if(!liste.length){
      historyList.innerHTML='<div class="aurore-history-empty-card"><span class="aurore-history-empty-dot"></span><strong>Vos discussions apparaîtront ici</strong><small>Commencez une conversation avec Aurora et elle restera disponible dans cet espace.</small></div>';
      return;
    }
    historyList.innerHTML=liste.map(c=>{
      const actif=c.id===currentConversationId;
      return '<div class="aurore-ia-history-item'+(actif?' active':'')+'" data-conv-id="'+esc(c.id)+'" role="button" tabindex="0">'+
        '<span class="aurore-ia-history-item-avatar" aria-hidden="true"><span>A</span></span>'+
        '<span class="aurore-ia-history-item-copy"><strong>'+esc(c.titre||'Discussion')+'</strong><small>'+esc(formaterDateHistorique(c.maj))+'</small></span>'+
        '<button type="button" class="aurore-ia-history-item-menu" data-conv-menu="'+esc(c.id)+'" aria-haspopup="menu" aria-label="Options de cette discussion" title="Options"><span></span><span></span><span></span></button>'+
      '</div>';
    }).join('');
    appliquerLogoAurora();
  }
  function ouvrirHistorique(){
    historyOverlay?.removeAttribute('hidden');
    requestAnimationFrame(()=>{historyOverlay?.classList.add('is-open');historyPanel?.classList.add('is-open');});
    historyPanel?.setAttribute('aria-hidden','false');
    menuBtn?.setAttribute('aria-expanded','true');
    rendreListeHistorique();
  }
  function fermerHistorique(){
    historyOverlay?.classList.remove('is-open');historyPanel?.classList.remove('is-open');
    historyPanel?.setAttribute('aria-hidden','true');
    menuBtn?.setAttribute('aria-expanded','false');
    setTimeout(()=>{if(!historyPanel?.classList.contains('is-open'))historyOverlay?.setAttribute('hidden','');},260);
  }
  function chargerConversation(id){
    const conv=auroreHistoriqueCache.find(c=>c.id===id);
    if(!conv)return;
    previousInteractionId=conv.previous_interaction_id||null;
    iaCatalogSnapshot=conv.catalog_snapshot||null;
    iaFocusDocumentId=(conv.focus_document_id!=null)?conv.focus_document_id:null;
    currentConversationId=conv.id;
    messagesActuels=Array.isArray(conv.messages)?conv.messages.slice():[];
    hasMessages=false;sending=false;
    closePlusMenu();
    conversation.innerHTML='';
    if(!messagesActuels.length){
      conversation.innerHTML=HTML_ACCUEIL_VIDE;
      appliquerLogoAurora();
    }else{
      messagesActuels.forEach((m,idxMsg)=>{
        if(m.role==='user')addMessage(m.text,'user');
        else{
          const rowRestaure=addAssistantResponse(m.text);
          afficherGraphiqueSiNecessaire(rowRestaure,messagesActuels[idxMsg-1]?.text||'',m.text);
        }
      });
    }
    input.value='';autoGrow();updateSendState();
    fermerHistorique();
    requestAnimationFrame(()=>scrollBottom(true));
  }
  menuBtn?.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    if(historyPanel?.classList.contains('is-open'))fermerHistorique();else ouvrirHistorique();
  });
  historyCloseBtn?.addEventListener('click',fermerHistorique);
  document.getElementById('auroreIAHistoryMenuBtn')?.addEventListener('click',fermerHistorique);
  historyOverlay?.addEventListener('click',fermerHistorique);
  historyNewBtn?.addEventListener('click',()=>{demarrerNouvelleConversation();fermerHistorique();input.focus({preventScroll:true});});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&historyPanel?.classList.contains('is-open'))fermerHistorique();
  });
  async function supprimerConversationHistorique(id){
    const ctx=await obtenirUtilisateurCourant();
    if(ctx){
      try{await ctx.client.from('aurore_ia_conversations').delete().eq('id',id).eq('user_id',ctx.userId);}
      catch(err){console.error('[Aurora] suppression historique:',err);}
    }
    const local=lireHistoriqueLocal().filter(c=>c.id!==id);
    ecrireHistoriqueLocal(local);
    if(id===currentConversationId)demarrerNouvelleConversation();
    rendreListeHistorique();
  }
  async function renommerConversationHistorique(id){
    const conv=auroreHistoriqueCache.find(c=>c.id===id);
    const actuel=conv?.titre||'Discussion';
    const saisie=prompt('Renommer cette discussion :',actuel);
    if(saisie==null)return;
    const nouveauTitre=saisie.trim().replace(/\s+/g,' ').slice(0,80);
    if(!nouveauTitre||nouveauTitre===actuel)return;
    const local=lireHistoriqueLocal().map(c=>c.id===id?{...c,titre:nouveauTitre}:c);
    ecrireHistoriqueLocal(local);
    rendreListeHistorique();
    const ctx=await obtenirUtilisateurCourant();
    if(ctx){
      try{await ctx.client.from('aurore_ia_conversations').update({titre:nouveauTitre}).eq('id',id).eq('user_id',ctx.userId);}
      catch(err){console.error('[Aurora] renommage historique:',err);}
    }
  }
  let auroreHistMenuPopover=null;
  function ouvrirMenuHistorique(id,source){
    if(!auroreHistMenuPopover){
      auroreHistMenuPopover=document.createElement('div');
      auroreHistMenuPopover.id='auroreIAHistoryMenuPopover';
      auroreHistMenuPopover.className='aurore-ia-history-menu-popover';
      auroreHistMenuPopover.innerHTML='<button type="button" data-hist-rename>✎ Renommer</button><button type="button" data-hist-delete>⌫ Supprimer</button>';
      document.body.appendChild(auroreHistMenuPopover);
      auroreHistMenuPopover.addEventListener('click',e=>e.stopPropagation());
      auroreHistMenuPopover.querySelector('[data-hist-rename]').addEventListener('click',()=>{const cid=auroreHistMenuPopover.dataset.convId;auroreHistMenuPopover.classList.remove('show');if(cid)renommerConversationHistorique(cid);});
      auroreHistMenuPopover.querySelector('[data-hist-delete]').addEventListener('click',()=>{const cid=auroreHistMenuPopover.dataset.convId;auroreHistMenuPopover.classList.remove('show');if(cid)supprimerConversationHistorique(cid);});
      document.addEventListener('click',()=>auroreHistMenuPopover.classList.remove('show'));
      document.addEventListener('keydown',e=>{if(e.key==='Escape')auroreHistMenuPopover.classList.remove('show');});
      window.addEventListener('resize',()=>auroreHistMenuPopover.classList.remove('show'));
    }
    auroreHistMenuPopover.dataset.convId=id;
    const r=source.getBoundingClientRect();
    auroreHistMenuPopover.style.left=Math.min(window.innerWidth-192,Math.max(12,r.right-176))+'px';
    auroreHistMenuPopover.style.top=Math.min(window.innerHeight-96,r.bottom+6)+'px';
    auroreHistMenuPopover.classList.add('show');
  }
  historyList?.addEventListener('click',e=>{
    const menuBtn2=e.target.closest('[data-conv-menu]');
    if(menuBtn2){
      e.preventDefault();
      e.stopPropagation();
      ouvrirMenuHistorique(menuBtn2.getAttribute('data-conv-menu'),menuBtn2);
      return;
    }
    const item=e.target.closest('[data-conv-id]');
    if(item)chargerConversation(item.getAttribute('data-conv-id'));
  });
  historyList?.addEventListener('keydown',e=>{
    const item=e.target.closest('[data-conv-id]');
    if(item&&(e.key==='Enter'||e.key===' ')){e.preventDefault();chargerConversation(item.getAttribute('data-conv-id'));}
  });

  window.addEventListener('popstate',()=>{
    if(screen.classList.contains('is-mini'))return;
    const shouldBeOpen=!!history.state?.auroraIA;
    if(!shouldBeOpen && screen.classList.contains('active')){
      closePlusMenu();
      if(typeof afficherEcran==='function')afficherEcran('screen-home');
      else screen.classList.remove('active');
      setRouteActive(false);
      return;
    }
    const active=screen.classList.contains('active');
    setRouteActive(active);
    if(active)requestAnimationFrame(()=>scrollBottom(true));
  });

  function selectTool(tool,btn){
    activeTool=tool||'assistant';
    document.querySelectorAll('.aurore-ia-tool').forEach(x=>x.classList.toggle('active',x.dataset.iaTool===activeTool));
    const prompts={documents:'Trouve dans les Archives Aurore : ',wikipedia:'Cherche sur Wikipédia : ',web:'Recherche sur le Web : '};
    if(prompts[activeTool]&&!input.value.trim()){input.value=prompts[activeTool];autoGrow();updateSendState();}
    input.focus();
  }

  document.querySelectorAll('.aurore-ia-tool[data-ia-tool]').forEach(btn=>{
    btn.addEventListener('click',()=>selectTool(btn.dataset.iaTool,btn));
  });

  document.querySelectorAll('[data-ia-prompt]').forEach(btn=>btn.addEventListener('click',()=>{
    input.value=btn.dataset.iaPrompt||'';autoGrow();updateSendState();form.requestSubmit();
  }));

  /* --- Bouton "+" : actions rapides dans la zone de saisie --- */
  function openPlusMenu(){if(!plusMenu)return;plusMenu.hidden=false;plusBtn.setAttribute('aria-expanded','true');}
  function closePlusMenu(){if(!plusMenu)return;plusMenu.hidden=true;plusBtn.setAttribute('aria-expanded','false');}
  plusBtn?.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    if(plusMenu.hidden)openPlusMenu();else closePlusMenu();
  });
  plusMenu?.querySelectorAll('[data-ia-tool]').forEach(btn=>{
    btn.addEventListener('click',()=>{selectTool(btn.dataset.iaTool,btn);closePlusMenu();});
  });
  document.addEventListener('click',e=>{
    if(plusMenu&&!plusMenu.hidden&&!plusMenu.contains(e.target)&&e.target!==plusBtn)closePlusMenu();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closePlusMenu();});

  // ---------- Pièces jointes Aurora : photos + PDF ----------
  const MAX_IMAGE_BYTES=12*1024*1024;
  const MAX_PDF_BYTES=30*1024*1024;
  const MAX_PDF_PAGES=8;
  const MAX_TOTAL_ATTACHMENT_BYTES=38*1024*1024;

  function formatTailleIA(n){
    if(n<1024*1024)return Math.max(1,Math.round(n/1024))+' Ko';
    return (n/(1024*1024)).toFixed(1)+' Mo';
  }
  function renderAttachments(){
    if(!attachmentsEl)return;
    attachmentsEl.innerHTML=fichiersIA.map((f,i)=>`<div class="aurore-ia-attachment-chip">
      <span class="icon">${f.kind==='pdf'?'📄':'🖼️'}</span>
      <span class="name"><span>${esc(f.name)}</span><span class="aurore-ia-attachment-status">${esc(f.status||'Prêt pour analyse')}</span></span>
      <button type="button" data-remove-attachment="${i}" aria-label="Retirer ${esc(f.name)}">×</button>
    </div>`).join('');
    attachmentsEl.querySelectorAll('[data-remove-attachment]').forEach(btn=>btn.addEventListener('click',()=>{
      fichiersIA.splice(Number(btn.dataset.removeAttachment),1);renderAttachments();updateSendState();
    }));
  }
  function totalAttachmentBytes(){
    return fichiersIA.reduce((n,f)=>n+(f.bytes||0),0);
  }
  function readFileAsDataURL(file){
    return new Promise((resolve,reject)=>{
      const r=new FileReader();
      r.onload=()=>resolve(String(r.result||''));
      r.onerror=()=>reject(new Error('Impossible de lire '+file.name));
      r.readAsDataURL(file);
    });
  }
  async function chargerImageIA(file){
    if(file.size>MAX_IMAGE_BYTES)throw new Error(`Image trop volumineuse (${formatTailleIA(file.size)}). Maximum ${formatTailleIA(MAX_IMAGE_BYTES)}.`);
    const dataUrl=await readFileAsDataURL(file);
    return await new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const max=1800, scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
          const c=document.createElement('canvas');
          c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));
          const ctx=c.getContext('2d',{alpha:false});
          ctx.drawImage(img,0,0,c.width,c.height);
          resolve({dataUrl:c.toDataURL('image/jpeg',.78),bytes:file.size,name:file.name,kind:'image'});
        }catch(e){reject(e)}
      };
      img.onerror=()=>reject(new Error('Image illisible : '+file.name));
      img.src=dataUrl;
    });
  }
  async function chargerPdfIA(file){
    if(file.size>MAX_PDF_BYTES)throw new Error(`PDF trop volumineux (${formatTailleIA(file.size)}). Maximum ${formatTailleIA(MAX_PDF_BYTES)}.`);
    await chargerPdfJs();
    const data=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data,disableAutoFetch:false,disableStream:false}).promise;
    const count=Math.min(pdf.numPages,MAX_PDF_PAGES);
    const pages=[];
    for(let n=1;n<=count;n++){
      const page=await pdf.getPage(n);
      const base=page.getViewport({scale:1});
      const scale=Math.min(1.35,1800/Math.max(base.width,base.height));
      const vp=page.getViewport({scale});
      const c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
      const ctx=c.getContext('2d',{alpha:false});
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      pages.push({dataUrl:c.toDataURL('image/jpeg',.74),bytes:Math.round(file.size/count),name:`${file.name} — page ${n}`,kind:'image',page:n});
    }
    return {pages,originalName:file.name,originalBytes:file.size,totalPages:pdf.numPages};
  }
  async function ajouterFichiersIA(fileList,kind){
    const files=Array.from(fileList||[]);
    if(!files.length)return;
    for(const file of files){
      try{
        if(totalAttachmentBytes()+file.size>MAX_TOTAL_ATTACHMENT_BYTES)throw new Error(`La taille totale des pièces jointes dépasserait ${formatTailleIA(MAX_TOTAL_ATTACHMENT_BYTES)}.`);
        if(kind==='pdf'){
          const pdf=await chargerPdfIA(file);
          for(const page of pdf.pages){
            if(totalAttachmentBytes()+page.dataUrl.length*0.75>MAX_TOTAL_ATTACHMENT_BYTES)break;
            fichiersIA.push({...page,status:`Page ${page.page}/${pdf.totalPages} prête`});
          }
          if(pdf.totalPages>MAX_PDF_PAGES)fichiersIA[fichiersIA.length-1].status=`8 premières pages sur ${pdf.totalPages} prêtes`;
        }else{
          fichiersIA.push({...await chargerImageIA(file),status:'Image prête pour analyse'});
        }
      }catch(e){
        alert(e?.message||'Impossible d’ajouter ce fichier.');
      }
    }
    renderAttachments();updateSendState();
  }
  function ouvrirSelecteurIA(kind){
    if(kind==='pdf')pdfInput?.click();
    else imageInput?.click();
  }
  imageInput?.addEventListener('change',async()=>{await ajouterFichiersIA(imageInput.files,'image');imageInput.value='';});
  pdfInput?.addEventListener('change',async()=>{await ajouterFichiersIA(pdfInput.files,'pdf');pdfInput.value='';});
  plusMenu?.querySelectorAll('[data-ia-file-kind]').forEach(btn=>{
    btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const k=btn.dataset.iaFileKind;closePlusMenu();if(k==='camera'||k==='image')ouvrirSelecteurIA('image');else ouvrirSelecteurIA('pdf');});
  });
  renderAttachments();

  function autoGrow(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,170)+'px';}
  function updateSendState(){if(sendBtn)sendBtn.disabled=sending||(!input.value.trim()&&!fichiersIA.length);}
  input.addEventListener('input',()=>{autoGrow();updateSendState();});
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!sending&&(input.value.trim()||fichiersIA.length))form.requestSubmit();}
  });
  input.addEventListener('focus',()=>{closePlusMenu();setTimeout(()=>scrollBottom(true),260);});
  autoGrow();updateSendState();

  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function isNearBottom(){return conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<140;}
  function scrollBottom(force){
    if(force||isNearBottom())requestAnimationFrame(()=>conversation.scrollTo({top:conversation.scrollHeight,behavior:force?'auto':'smooth'}));
  }

  /* --- Rendu markdown léger + LaTeX sûr pour les réponses DeepSeek --- */
  function extraireMath(raw){
    const maths=[];
    let s=String(raw||'');
    const stash=(body,display)=>{
      const id=maths.length;
      maths.push({latex:String(body||'').trim(),display:!!display});
      return `\u0000AURORAMATH${id}\u0000`;
    };
    s=s.replace(/\$\$([\s\S]*?)\$\$/g,(m,b)=>stash(b,true));
    s=s.replace(/\\\[([\s\S]*?)\\\]/g,(m,b)=>stash(b,true));
    s=s.replace(/\\\(([\s\S]*?)\\\)/g,(m,b)=>stash(b,false));
    s=s.replace(/(^|[^$])\$([^$\n]+)\$(?!\$)/g,(m,prefix,b)=>prefix+stash(b,false));
    return {source:s,maths};
  }

  function restaurerMath(html,maths){
    return html.replace(/\u0000AURORAMATH(\d+)\u0000/g,(m,idx)=>{
      const item=maths[Number(idx)];
      if(!item)return m;
      return '<span class="aurore-math'+(item.display?' display':'')+'" data-latex="'+esc(item.latex)+'"></span>';
    });
  }

  function mathFallback(el){
    // Filet de sécurité : si KaTeX est indisponible, on affiche le LaTeX brut
    // au lieu de laisser le span vide (mieux vaut du texte lisible qu'un trou).
    if(el.dataset.rendered==='1')return;
    const latex=el.getAttribute('data-latex')||'';
    const display=el.classList.contains('display');
    el.textContent=display?('\\['+latex+'\\]'):('\\('+latex+'\\)');
    el.classList.add('aurore-math-fallback');
    el.dataset.rendered='fallback';
  }

  function rendreMath(root){
    if(!root)return;
    const nodes=root.querySelectorAll?.('.aurore-math[data-latex]');
    if(!nodes?.length)return;
    if(window.__AURORE_KATEX_FAILED){
      nodes.forEach(mathFallback);
      return;
    }
    if(typeof window.katex!=='undefined'){
      nodes.forEach(el=>{
        if(el.dataset.rendered==='1')return;
        try{
          window.katex.render(el.getAttribute('data-latex')||'',el,{
            displayMode:el.classList.contains('display'),
            throwOnError:false,
            strict:'ignore',
            trust:false
          });
          el.dataset.rendered='1';
          el.removeAttribute('data-latex');
        }catch(_){
          mathFallback(el); // erreur de rendu ponctuelle -> texte brut plutôt que vide
        }
      });
    }else if(window.__AURORE_KATEX_READY&&typeof window.__AURORE_KATEX_READY.then==='function'){
      // KaTeX est en cours de chargement (jsdelivr, puis unpkg en secours si
      // besoin — voir <head>). On se branche sur cette même promesse au lieu
      // de sonder à l'aveugle : plus de risque de désynchronisation entre le
      // délai des CDN et un compteur de tentatives séparé.
      window.__AURORE_KATEX_READY.then(ok=>{
        if(ok)rendreMath(root);
        else nodes.forEach(mathFallback);
      });
    }else{
      // Filet de sécurité ultime, si jamais appelé avant que le script du
      // <head> n'ait posé window.__AURORE_KATEX_READY (ne devrait pas
      // arriver en pratique). Plafonné pour ne jamais boucler indéfiniment.
      root.__auroraMathRetryCount=(root.__auroraMathRetryCount||0)+1;
      if(root.__auroraMathRetryCount>20){
        window.__AURORE_KATEX_FAILED=true;
        nodes.forEach(mathFallback);
        return;
      }
      clearTimeout(root.__auroraMathRetry);
      root.__auroraMathRetry=setTimeout(()=>rendreMath(root),500);
    }
  }

  function mdInline(t){
    t=t.replace(/`([^`]+)`/g,'<code>$1</code>');
    t=t.replace(/\*\*([^\n*]+)\*\*/g,'<strong>$1</strong>');
    t=t.replace(/(^|[^*])\*([^\n*]+)\*(?!\*)/g,'$1<em>$2</em>');
    t=t.replace(/(^|[^_])_([^\n_]+)_(?!_)/g,'$1<em>$2</em>');
    t=t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return t;
  }

  function mdToHtml(raw){
    const protectedMath=extraireMath(raw);
    const safe=esc(protectedMath.source);
    const codeBlocks=[];
    const withoutCode=safe.replace(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g,(m,lang,code)=>{
      const idx=codeBlocks.length;
      codeBlocks.push('<pre><code>'+code.replace(/\n$/,'')+'</code></pre>');
      return '\u0000CODEBLOCK'+idx+'\u0000';
    });
    const lines=withoutCode.split('\n');
    let html='',i=0;
    const isTableSep=l=>/^\s*\|?[\s:|-]+\|?\s*$/.test(l)&&/[-:]/.test(l);
    while(i<lines.length){
      const line=lines[i];
      if(!line.trim()){i++;continue;}
      const mh=line.match(/^(#{1,3})\s+(.*)$/);
      if(mh){const lvl=mh[1].length;html+='<h'+lvl+'>'+mdInline(mh[2])+'</h'+lvl+'>';i++;continue;}
      if(/^>\s?/.test(line)){
        const buf=[];
        while(i<lines.length&&/^>\s?/.test(lines[i])){buf.push(lines[i].replace(/^>\s?/,''));i++;}
        html+='<blockquote>'+mdInline(buf.join(' '))+'</blockquote>';continue;
      }
      if(/^\|.*\|\s*$/.test(line.trim())&&lines[i+1]&&isTableSep(lines[i+1])){
        const rows=[line];i+=2;
        while(i<lines.length&&/^\|.*\|\s*$/.test(lines[i].trim())){rows.push(lines[i]);i++;}
        const cellsOf=r=>r.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
        const head=cellsOf(rows[0]),body=rows.slice(1);
        html+='<div class="aurore-ia-table-wrap"><table><thead><tr>'+head.map(c=>'<th>'+mdInline(c)+'</th>').join('')+'</tr></thead><tbody>'+
          body.map(r=>'<tr>'+cellsOf(r).map(c=>'<td>'+mdInline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
        continue;
      }
      if(/^[-*]\s+/.test(line)){
        const buf=[];
        while(i<lines.length&&/^[-*]\s+/.test(lines[i])){buf.push(lines[i].replace(/^[-*]\s+/,''));i++;}
        html+='<ul>'+buf.map(li=>'<li>'+mdInline(li)+'</li>').join('')+'</ul>';continue;
      }
      if(/^\d+[.)]\s+/.test(line)){
        const buf=[];
        while(i<lines.length&&/^\d+[.)]\s+/.test(lines[i])){buf.push(lines[i].replace(/^\d+[.)]\s+/,''));i++;}
        html+='<ol>'+buf.map(li=>'<li>'+mdInline(li)+'</li>').join('')+'</ol>';continue;
      }
      const buf=[line];i++;
      while(i<lines.length&&lines[i].trim()&&!/^(#{1,3}\s|>|[-*]\s|\d+[.)]\s|\|.*\|\s*$)/.test(lines[i])){buf.push(lines[i]);i++;}
      html+='<p>'+mdInline(buf.join('<br>'))+'</p>';
    }
    html=html.replace(/\u0000CODEBLOCK(\d+)\u0000/g,(m,idx)=>codeBlocks[+idx]||'');
    return restaurerMath(html,protectedMath.maths);
  }

  /* ==========================================================================
     AURORA — GRAPHIQUES INTERACTIFS (extension additive)
     --------------------------------------------------------------------------
     Ce bloc est 100% additif : il ne modifie, ne remplace et n'appelle aucune
     fonction existante du circuit Aurora/DeepSeek. Il s'appuie uniquement sur
     le texte déjà produit (question de l'utilisateur + réponse déjà rendue)
     pour détecter une demande de courbe, puis dessine cette courbe côté
     navigateur avec Plotly.js (chargé à la demande, jamais au chargement de
     la page). Aucune expression n'est jamais évaluée avec eval() : un petit
     analyseur syntaxique dédié (tokeniser -> arbre -> évaluation) sert de
     couche de normalisation sécurisée entre le texte et le calcul des points.
     ========================================================================== */

  // --- Chargement paresseux de Plotly.js (jsdelivr, puis unpkg en secours) ---
  function chargerScriptGraphique(url,delaiMs){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      let fini=false;
      const minuteur=setTimeout(()=>{if(fini)return;fini=true;reject(new Error('Délai dépassé : '+url));},delaiMs);
      s.src=url;
      s.onload=()=>{if(fini)return;fini=true;clearTimeout(minuteur);resolve();};
      s.onerror=()=>{if(fini)return;fini=true;clearTimeout(minuteur);reject(new Error('Échec de chargement : '+url));};
      document.head.appendChild(s);
    });
  }
  function assurerPlotlyCharge(){
    if(window.Plotly)return Promise.resolve(window.Plotly);
    if(window.__AURORA_PLOTLY_READY)return window.__AURORA_PLOTLY_READY;
    window.__AURORA_PLOTLY_READY=(async()=>{
      try{
        await chargerScriptGraphique('https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js',12000);
      }catch(_){
        await chargerScriptGraphique('https://unpkg.com/plotly.js-dist-min@2.35.2/plotly.min.js',12000);
      }
      if(!window.Plotly)throw new Error('Plotly indisponible après chargement.');
      return window.Plotly;
    })();
    return window.__AURORA_PLOTLY_READY;
  }

  // --- Lecture d'une variable CSS déjà en place (design cohérent avec Aurora) ---
  function auroraCouleurCSS(nom,repli){
    try{
      const app=document.querySelector('.aurore-ia-app')||document.documentElement;
      const val=getComputedStyle(app).getPropertyValue(nom).trim();
      return val||repli;
    }catch(_){return repli;}
  }

  // --- Normalisation sécurisée d'une expression mathématique en texte ---
  function auroraNormaliserExpression(expr){
    let s=String(expr||'').trim();
    const supMap={'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'};
    s=s.replace(/([)\]a-zA-Z0-9])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g,(m,base,exp)=>{
      const chiffres=exp.split('').map(c=>supMap[c]||'').join('');
      return chiffres?base+'^'+chiffres:base;
    });
    s=s.replace(/√\s*\(([^()]*)\)/g,'sqrt($1)');
    s=s.replace(/√\s*([a-zA-Z0-9.]+)/g,'sqrt($1)');
    s=s.replace(/\|([^|]+)\|/g,'abs($1)');
    s=s.replace(/\bln\s*\(/gi,'log(');
    s=s.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
    s=s.replace(/(\d),(\d)/g,'$1.$2');
    s=s.replace(/(\d)(\s*)([a-zA-Z(])/g,(m,d,sp,c)=>d+'*'+c);
    s=s.replace(/(\))(\s*)([(0-9])/g,(m,p,sp,c)=>p+'*'+c);
    s=s.replace(/\s+/g,'');
    return s;
  }

  // --- Tokeniseur : jamais d'eval(), uniquement des jetons reconnus ---
  function auroraTokeniser(s){
    const tokens=[];let i=0;const n=s.length;
    while(i<n){
      const c=s[i];
      if(/[0-9.]/.test(c)){let j=i;while(j<n&&/[0-9.]/.test(s[j]))j++;tokens.push({t:'num',v:parseFloat(s.slice(i,j))});i=j;continue;}
      if(/[a-zA-Z]/.test(c)){let j=i;while(j<n&&/[a-zA-Z0-9_]/.test(s[j]))j++;tokens.push({t:'id',v:s.slice(i,j).toLowerCase()});i=j;continue;}
      if('+-*/^(),'.includes(c)){tokens.push({t:c});i++;continue;}
      throw new Error('caractère non reconnu dans l’expression : '+c);
    }
    return tokens;
  }

  // --- Analyseur syntaxique (descente récursive) -> arbre d'expression ---
  function auroraAnalyser(tokens){
    let pos=0;
    const pic=()=>tokens[pos];
    const consommer=(t)=>{const tok=tokens[pos];if(!tok||(t&&tok.t!==t))throw new Error('expression mathématique invalide');pos++;return tok;};
    function parseExpr(){let n=parseTerme();while(pic()&&(pic().t==='+'||pic().t==='-')){const op=consommer().t;n={type:'bin',op,g:n,d:parseTerme()};}return n;}
    function parseTerme(){let n=parseFacteur();while(pic()&&(pic().t==='*'||pic().t==='/')){const op=consommer().t;n={type:'bin',op,g:n,d:parseFacteur()};}return n;}
    function parseFacteur(){let n=parseUnaire();if(pic()&&pic().t==='^'){consommer();n={type:'bin',op:'^',g:n,d:parseFacteur()};}return n;}
    function parseUnaire(){if(pic()&&(pic().t==='-'||pic().t==='+')){const op=consommer().t;return {type:'unaire',op,val:parseUnaire()};}return parsePrimaire();}
    function parsePrimaire(){
      const tok=pic();
      if(!tok)throw new Error('expression mathématique incomplète');
      if(tok.t==='num'){consommer();return {type:'num',v:tok.v};}
      if(tok.t==='('){consommer();const e=parseExpr();consommer(')');return e;}
      if(tok.t==='id'){
        consommer();
        if(pic()&&pic().t==='('){consommer();const arg=parseExpr();consommer(')');return {type:'appel',nom:tok.v,arg};}
        return {type:'id',nom:tok.v};
      }
      throw new Error('jeton mathématique inattendu');
    }
    const arbre=parseExpr();
    if(pos!==tokens.length)throw new Error('expression mathématique mal formée');
    return arbre;
  }

  const AURORA_FONCTIONS_MATH={sin:Math.sin,cos:Math.cos,tan:Math.tan,exp:Math.exp,log:Math.log,ln:Math.log,sqrt:Math.sqrt,abs:Math.abs};
  const AURORA_CONSTANTES_MATH={pi:Math.PI,e:Math.E};
  function auroraEvaluerNoeud(node,x){
    switch(node.type){
      case 'num':return node.v;
      case 'id':
        if(node.nom==='x')return x;
        if(node.nom in AURORA_CONSTANTES_MATH)return AURORA_CONSTANTES_MATH[node.nom];
        throw new Error('identifiant mathématique inconnu : '+node.nom);
      case 'unaire':{const v=auroraEvaluerNoeud(node.val,x);return node.op==='-'?-v:v;}
      case 'appel':{const fn=AURORA_FONCTIONS_MATH[node.nom];if(!fn)throw new Error('fonction mathématique inconnue : '+node.nom);return fn(auroraEvaluerNoeud(node.arg,x));}
      case 'bin':{
        const g=auroraEvaluerNoeud(node.g,x),d=auroraEvaluerNoeud(node.d,x);
        if(node.op==='+')return g+d;
        if(node.op==='-')return g-d;
        if(node.op==='*')return g*d;
        if(node.op==='/')return g/d;
        if(node.op==='^')return Math.pow(g,d);
        throw new Error('opérateur mathématique inconnu');
      }
    }
    throw new Error('nœud mathématique invalide');
  }
  // Compile une expression en une fonction JS pure, SANS jamais utiliser eval()
  // ni new Function() sur du texte venant de DeepSeek : seul cet analyseur
  // contrôlé décide de ce qui peut être calculé.
  function auroraCompilerExpression(expr){
    const normalisee=auroraNormaliserExpression(expr);
    const tokens=auroraTokeniser(normalisee);
    const arbre=auroraAnalyser(tokens);
    return function(x){return auroraEvaluerNoeud(arbre,x);};
  }

  // --- Détection discrète d'une demande de graphique dans le texte ---
  // Le déclencheur porte sur des verbes explicites ("trace", "représente
  // graphiquement", "dessine la courbe"...) : une simple présence de LaTeX ou
  // une explication mathématique ("Explique-moi la dérivée de x²") ne doit
  // JAMAIS déclencher de graphique.
  const AURORA_DECLENCHEUR_GRAPHIQUE=/\b(trace[rz]?s?|construi[st]?s?|construire|repr[ée]sente(?:r|z)?(?:\s+graphiquement)?|dessine[rz]?s?(?:\s+(?:la|les)\s+courbe[s]?)?|graphe|graphique|courbe)\b/i;
  function auroraNormaliserDemandeGraphiqueTexte(texte){
    let s=String(texte||'');
    // Vocabulaire naturel français fréquemment utilisé pour parler des puissances.
    // Ces règles servent au moteur graphique local : elles ne modifient pas la
    // réponse textuelle de DeepSeek.
    s=s.replace(/\bx\s+(?:au\s+)?carr(?:é|e)(?![\p{L}\p{N}_])/giu,'x^2');
    s=s.replace(/\bx\s+(?:au\s+)?cube\b/gi,'x^3');
    s=s.replace(/\bx\s+puissance\s+(\d+)\b/gi,'x^$1');
    // "fonction carré", "fonction f carré", "f carré" et variantes
    // désignent ici la fonction f(x)=x² lorsqu'une demande de tracé est explicite.
    s=s.replace(/\bfonction(?:\s+f)?\s+(?:au\s+)?carr(?:é|e)(?![\p{L}\p{N}_])/giu,'f(x)=x^2');
    s=s.replace(/\bf\s+(?:au\s+)?carr(?:é|e)(?![\p{L}\p{N}_])/giu,'f(x)=x^2');
    s=s.replace(/\bfonction(?:\s+f)?\s+(?:au\s+)?cube\b/gi,'f(x)=x^3');
    return s;
  }

  function auroraExtraireDeriveeGraphique(texte){
    const s=auroraNormaliserDemandeGraphiqueTexte(texte);
    if(!/d[ée]riv[ée]e/i.test(s))return [];
    // Dérivées élémentaires demandées explicitement pour le tracé.
    const m2=s.match(/x\s*(?:\^\s*2|²)/i);
    if(m2)return [{label:"f'(x) = 2x",raw:'2*x'}];
    const m3=s.match(/x\s*(?:\^\s*3|³)/i);
    if(m3)return [{label:"f'(x) = 3x^2",raw:'3*x^2'}];
    const mn=s.match(/x\s*\^\s*(\d+)/i);
    if(mn){
      const n=Number(mn[1]);
      if(Number.isInteger(n)&&n>1&&n<=20)return [{label:`f'(x) = ${n}x^${n-1}`,raw:`${n}*x^${n-1}`}];
    }
    return [];
  }

  function auroraExtraireFonctions(texte){
    const s=auroraNormaliserDemandeGraphiqueTexte(texte);
    const resultats=[];
    // Formes explicites : y=e^x, f(x)=exp(x), y=ln(x), etc.
    // On les traite avant l'extracteur générique afin de conserver le domaine
    // de ln(x) et d'éviter que le texte pédagogique autour des équations ne
    // soit pris pour une partie de l'expression.
    const formes=[
      // Formulations françaises : « fonction exponentielle »,
      // « construis l'exponentielle », « trace exp(x) », etc.
      // Elles doivent toujours produire LA fonction exponentielle e^x,
      // même si la réponse pédagogique contient ensuite d'autres expressions.
      {re:/\b(?:fonction\s+)?exponentielle\b/i,label:'f(x) = e^x',raw:'exp(x)',domain:'all'},
      {re:/\bexponentielle\s+de\s+x\b/i,label:'f(x) = e^x',raw:'exp(x)',domain:'all'},
      {re:/\b(?:fonction\s+)?exp\s*\(\s*x\s*\)\b/i,label:'f(x) = e^x',raw:'exp(x)',domain:'all'},
      {re:/\by\s*=\s*e\s*\^\s*x\b/i,label:'y = e^x',raw:'exp(x)',domain:'all'},
      {re:/\bf\s*\(\s*x\s*\)\s*=\s*e\s*\^\s*x\b/i,label:'f(x) = e^x',raw:'exp(x)',domain:'all'},
      {re:/\by\s*=\s*exp\s*\(\s*x\s*\)/i,label:'y = exp(x)',raw:'exp(x)',domain:'all'},
      {re:/\bf\s*\(\s*x\s*\)\s*=\s*exp\s*\(\s*x\s*\)/i,label:'f(x) = exp(x)',raw:'exp(x)',domain:'all'},
      {re:/\by\s*=\s*ln\s*\(\s*x\s*\)/i,label:'y = ln(x)',raw:'ln(x)',domain:'positive'},
      {re:/\bf\s*\(\s*x\s*\)\s*=\s*ln\s*\(\s*x\s*\)/i,label:'f(x) = ln(x)',raw:'ln(x)',domain:'positive'},
      {re:/\by\s*=\s*log\s*\(\s*x\s*\)/i,label:'y = ln(x)',raw:'ln(x)',domain:'positive'},
      {re:/\bf\s*\(\s*x\s*\)\s*=\s*log\s*\(\s*x\s*\)/i,label:'f(x) = ln(x)',raw:'ln(x)',domain:'positive'}
    ];
    for(const f of formes){
      if(f.re.test(s)&&!resultats.some(r=>r.raw===f.raw))resultats.push({label:f.label,raw:f.raw,domain:f.domain});
    }
    if(resultats.length)return resultats;
    const re=/([a-zA-Zα-ωΑ-Ω][\w]*\s*\(\s*x\s*\)|[a-zA-Zα-ωΑ-Ω])\s*=\s*([^=,;\n]+?)(?=(?:\s*(?:,|et)\s*[a-zA-Zα-ωΑ-Ω][\w]*\s*(?:\(\s*x\s*\))?\s*=)|(?:\s+sur\s+)|[.;\n]|$)/gi;
    let m;
    while((m=re.exec(s))){
      const label=m[1].trim().replace(/\s+/g,'');
      let expr=m[2].trim();
      // e^x est normalisé en exp(x), tout comme ln(x) reste une fonction
      // reconnue par le compilateur sécurisé.
      expr=expr.replace(/\be\s*\^\s*x\b/gi,'exp(x)');
      if(expr)resultats.push({label:label+' = '+expr,raw:expr,domain:/\bln\s*\(\s*x\s*\)/i.test(expr)?'positive':'all'});
    }
    if(resultats.length)return resultats;
    // Expressions naturelles sans égalité : « trace la courbe de x²+e^x »,
    // « construis la courbe de x^2 + exp(x) », etc. On extrait l'expression
    // située après un marqueur de tracé et avant une éventuelle précision de domaine.
    const naturel=s.match(/(?:courbe|fonction|graphe|graphique)\s+(?:de|d[eu']|pour)\s+([^.;\n]+?)(?=\s+(?:sur|avec|pour|dans)\s+|[.;\n]|$)/i);
    if(naturel){
      let expr=naturel[1].trim()
        .replace(/\b(?:la|le|les|une|un)\b/gi,'')
        .replace(/\b(?:fonction|courbe|graphe|graphique)\b/gi,'')
        .replace(/\by\s*=\s*/i,'')
        .trim();
      if(/[xX]/.test(expr)&&/(?:\^|²|³|e\s*\^|exp\s*\(|ln\s*\(|sin\s*\(|cos\s*\(|[+\-*/])/.test(expr)){
        resultats.push({label:'y = '+expr,raw:expr,domain:/\b(?:ln|log)\s*\(/i.test(expr)?'positive':'all'});
        return resultats;
      }
    }
    const motifs=/(?:sin|cos|tan|exp|ln|log|sqrt)\s*\([^)]*\)|e\s*\^\s*x|x\s*[²³]|x\s*\^\s*\d+|√\s*x|\|x\||(?:[+-]?\s*(?:\d+(?:[.,]\d+)?\s*\*?\s*)?x(?:\s*\^\s*\d+)?(?:\s*[+-]\s*(?:\d+(?:[.,]\d+)?\s*\*?\s*x|\d+(?:[.,]\d+)?))*)/gi;
    let m2;const vus=new Set();
    while((m2=motifs.exec(s))){
      const brut=m2[0].trim();
      const cle=brut.toLowerCase();
      if(vus.has(cle))continue;
      vus.add(cle);
      if(/^e\s*\^\s*x$/i.test(brut))resultats.push({label:'y = e^x',raw:'exp(x)',domain:'all'});
      else resultats.push({label:brut,raw:brut,domain:/^(?:ln|log)\s*\(/i.test(brut)?'positive':'all'});
    }
    return resultats;
  }
  function auroraDeterminerPlageGraphique(fonctions){
    const fs=fonctions||[];
    const aLn=fs.some(f=>f.domain==='positive'||/\b(?:ln|log)\s*\(/i.test(f.raw));
    const aExp=fs.some(f=>/\bexp\s*\(/i.test(f.raw)||/\be\s*\^/i.test(f.raw));
    // Plage lisible pour le couple e^x / ln(x), sans jamais échantillonner x<=0
    // pour le logarithme. Pour les autres graphiques, on conserve la plage Aurora.
    if(aLn&&aExp)return [ -3, 6 ];
    if(aLn)return [ 0.05, 6 ];
    if(aExp)return [ -5, 5 ];
    return [-10,10];
  }
  // --- Signal explicite du backend : "Fonction à tracer : ..." / "Fonctions à
  // tracer : ...". Ce contrat est produit par aurora-deepseek-live (soit par
  // DeepSeek lui-même, soit injecté par son garde-fou déterministe) dès qu'une
  // fonction mathématique identifiable est en jeu, MÊME si l'utilisateur n'a
  // employé aucun verbe de tracé ("Parle-moi de la fonction exponentielle").
  // Ce signal est prioritaire et autosuffisant : sa seule présence doit
  // déclencher la construction réelle de la courbe, sans dépendre des mots
  // choisis par l'utilisateur. ---
  const AURORA_SIGNAL_A_TRACER=/Fonctions?\s+à\s+tracer\s*:\s*([^\n]+)/iu;
  // Retire les artefacts Markdown (gras **x**, italique *x*/_x_, code `x`)
  // qu'un modèle peut ajouter autour de la ligne de contrat ou de l'expression
  // elle-même, avant toute tentative de compilation mathématique.
  function auroraNettoyerSignalBrut(s){
    let out=String(s||'').trim();
    // Gras/italique Markdown (**x**, *x*, __x__) : uniquement en bordure, car
    // un astérisque isolé À L'INTÉRIEUR de l'expression est l'opérateur de
    // multiplication (ex. "2*x+1") et ne doit jamais être supprimé.
    out=out.replace(/^\*{1,2}|\*{1,2}$/g,'');
    out=out.replace(/^_{1,2}|_{1,2}$/g,'');
    out=out.replace(/^`+|`+$/g,'');
    out=out.trim();
    out=out.replace(/[.\s]+$/,'').trim();
    return out;
  }
  function auroraExtraireDuSignalBackend(assistantText){
    const m=AURORA_SIGNAL_A_TRACER.exec(String(assistantText||''));
    if(!m)return [];
    const resultats=[];
    const segment=auroraNettoyerSignalBrut(m[1]);
    segment.split(';').forEach(part=>{
      const mm=auroraNettoyerSignalBrut(part).match(/^([a-zA-Zα-ωΑ-Ω][\w]*\s*(?:\(\s*x\s*\))?)\s*=\s*(.+)$/);
      if(!mm)return;
      const raw=auroraNettoyerSignalBrut(mm[2]);
      if(!raw)return;
      resultats.push({label:mm[1].trim().replace(/\s+/g,'')+' = '+raw,raw,domain:/\b(?:ln|log)\s*\(/i.test(raw)?'positive':'all'});
    });
    return resultats;
  }
  function auroraDemandeGraphique(userText,assistantText){
    // Priorité absolue : le contrat backend, indépendant du phrasé utilisateur.
    const parSignalBackend=auroraExtraireDuSignalBackend(assistantText);
    if(parSignalBackend.length)return {functions:parSignalBackend.slice(0,6),xRange:auroraDeterminerPlageGraphique(parSignalBackend),intention:'GRAPH_MATH'};
    // Filet de secours existant : filtre lexical côté utilisateur, pour les cas
    // où la réponse n'a exceptionnellement pas produit la ligne de contrat.
    const texteUtilisateur=auroraNormaliserDemandeGraphiqueTexte(userText);
    if(!AURORA_DECLENCHEUR_GRAPHIQUE.test(texteUtilisateur))return null;
    let fonctions=auroraExtraireDeriveeGraphique(texteUtilisateur);
    if(!fonctions.length)fonctions=auroraExtraireFonctions(texteUtilisateur);
    if(!fonctions.length)fonctions=auroraExtraireFonctions(String(assistantText||''));
    if(!fonctions.length)return null;
    return {functions:fonctions.slice(0,6),xRange:auroraDeterminerPlageGraphique(fonctions),intention:'GRAPH_MATH'};
  }

  // --- Échantillonnage sécurisé (coupe les asymptotes/valeurs infinies) ---
  function auroraEchantillonner(fn,xMin,xMax,nbPoints){
    const xs=[],ys=[];
    const pas=(xMax-xMin)/(nbPoints-1);
    let precedent=null;
    for(let i=0;i<nbPoints;i++){
      const x=xMin+i*pas;
      let y;
      try{y=fn(x);}catch(_){y=NaN;}
      if(typeof y!=='number'||!isFinite(y))y=null;
      else if(Math.abs(y)>1e6)y=null;
      else if(precedent!=null&&Math.abs(y-precedent)>50)y=null;
      xs.push(x);ys.push(y);
      precedent=(y==null)?null:y;
    }
    return {xs,ys};
  }

  function auroraIdentifiantGraphique(){
    window.__AURORA_GRAPH_COUNTER=(window.__AURORA_GRAPH_COUNTER||0)+1;
    return 'aurora-graph-'+window.__AURORA_GRAPH_COUNTER;
  }

  // --- Point d'entrée : appelé APRÈS le rendu normal d'une réponse Aurora.
  // N'altère jamais le texte déjà affiché ; ajoute seulement, si pertinent,
  // un bloc graphique après la bulle de réponse existante. Idempotent (ne
  // duplique pas le graphique si déjà présent, utile pour l'historique). ---
  async function afficherGraphiqueSiNecessaire(row,userText,assistantText){
    try{
      if(!row)return;
      const bubble=row.querySelector('.aurore-ia-bubble');
      if(!bubble||bubble.querySelector('.aurora-graph-block'))return;
      const demande=auroraDemandeGraphique(userText,assistantText);
      if(!demande||!demande.functions.length)return;
      const compilees=[];
      demande.functions.forEach(f=>{
        try{compilees.push({label:f.label,raw:f.raw,fn:auroraCompilerExpression(f.raw)});}
        catch(e){console.warn('[Aurora][Graphique] expression ignorée :',f.raw,e);}
      });
      if(!compilees.length)return;
      const bloc=document.createElement('div');bloc.className='aurora-graph-block';
      const entete=document.createElement('div');entete.className='aurora-graph-header';
      entete.innerHTML='<span class="aurora-graph-title">Graphique</span><span class="aurora-graph-sub">'+esc(compilees.map(c=>c.label).join(' · '))+'</span>';
      const idPlot=auroraIdentifiantGraphique();
      // Conteneur cliquable : le graphique Plotly (zonePlot) reste seul à
      // recevoir Plotly.newPlot (qui remplace tout son contenu), donc l'indice
      // visuel "Agrandir" est un frère à part, jamais écrasé par un re-rendu.
      const wrapPlot=document.createElement('div');wrapPlot.className='aurora-graph-plot-wrap';
      const zonePlot=document.createElement('div');zonePlot.className='aurora-graph-plot';zonePlot.id=idPlot;
      const indiceAgrandir=document.createElement('button');
      indiceAgrandir.type='button';
      indiceAgrandir.className='aurora-graph-expand-hint';
      indiceAgrandir.setAttribute('aria-label','Agrandir le graphique');
      indiceAgrandir.title='Agrandir le graphique';
      indiceAgrandir.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"/></svg><span>Agrandir</span>';
      indiceAgrandir.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();ouvrirGrandGraphiqueAurora(zonePlot);});
      const boutonGeo=document.createElement('button');
      boutonGeo.type='button';
      boutonGeo.className='aurora-graph-geo-btn';
      boutonGeo.setAttribute('aria-label','Ouvrir le graphique dans GeoGebra');
      boutonGeo.title='Ouvrir dans GeoGebra';
      boutonGeo.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5M19 5l-8 8"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg><span>GeoGebra</span>';
      boutonGeo.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();ouvrirGeoGebraAurora(compilees);});
      wrapPlot.appendChild(zonePlot);wrapPlot.appendChild(boutonGeo);wrapPlot.appendChild(indiceAgrandir);
      bloc.appendChild(entete);bloc.appendChild(wrapPlot);
      bubble.appendChild(bloc);
      scrollBottom(false);
      const Plotly=await assurerPlotlyCharge();
      // Palette volontairement saturée (pas de tons pâles) pour rester lisible
      // aussi bien en mode sombre qu'en mode clair ; la 1ʳᵉ couleur reprend
      // l'accent de marque Aurora, les suivantes sont choisies pour rester
      // clairement distinctes les unes des autres.
      const couleurs=[auroraCouleurCSS('--ia-accent','#8B5CF6'),'#F59E0B','#10B981','#38BDF8','#F472B6'];
      const xMin=demande.xRange[0],xMax=demande.xRange[1];
      const traces=compilees.map((c,i)=>{
        const {xs,ys}=auroraEchantillonner(c.fn,xMin,xMax,400);
        return {x:xs,y:ys,mode:'lines',type:'scatter',name:c.label,line:{color:couleurs[i%couleurs.length],width:2.4},connectgaps:false,hoverinfo:'x+y'};
      });
      // Bornes verticales réelles : elles doivent exister avant la construction
      // de l'axe Y. L'ancienne version utilisait yMin/yMax sans les calculer,
      // ce qui interrompait Plotly.newPlot et affichait « Le graphique n’a pas pu s’afficher ».
      const valeursY=[];
      traces.forEach(t=>{(t.y||[]).forEach(v=>{if(Number.isFinite(v))valeursY.push(v);});});
      let yMin=valeursY.length?Math.min(...valeursY):0;
      let yMax=valeursY.length?Math.max(...valeursY):1;
      if(!Number.isFinite(yMin)||!Number.isFinite(yMax)||yMin===yMax){
        yMin=0;yMax=1;
      }else{
        // Toujours garder l'origine visible lorsque cela est pertinent.
        if(yMin>0)yMin=0;
        if(yMax<0)yMax=0;
        const amplitude=Math.max(1e-9,yMax-yMin);
        const marge=amplitude*0.05;
        yMin-=marge;yMax+=marge;
      }
      const couleurTexte=auroraCouleurCSS('--ia-muted','#958DA6');
      const couleurGrille=auroraCouleurCSS('--ia-border','rgba(255,255,255,.08)');
      const layout={
        autosize:true,
        margin:{l:38,r:14,t:10,b:32},
        paper_bgcolor:'rgba(0,0,0,0)',
        plot_bgcolor:'rgba(0,0,0,0)',
        font:{color:couleurTexte,size:11},
        xaxis:{zeroline:true,zerolinecolor:couleurTexte,zerolinewidth:2, fixedrange:false,showline:true,linecolor:couleurTexte,linewidth:1.5,gridcolor:couleurGrille,color:couleurTexte,tickmode:'linear', tick0:0, dtick:Math.max(1,Math.ceil((xMax-xMin)/19)),ticks:'outside',title:{text:'x',font:{size:12,color:couleurTexte}}},
        yaxis:{zeroline:true,zerolinecolor:couleurTexte,zerolinewidth:2, fixedrange:false,showline:true,linecolor:couleurTexte,linewidth:1.5,gridcolor:couleurGrille,color:couleurTexte,tickmode:'linear', tick0:0, dtick:Math.max(1,Math.ceil((yMax-yMin)/19)),ticks:'outside',title:{text:'y',font:{size:12,color:couleurTexte}},scaleanchor:'x',scaleratio:1, constrain:'domain'},
        annotations:[{x:0,y:0,xref:'x',yref:'y',text:'O',showarrow:false,xshift:10,yshift:-10,font:{size:13,color:couleurTexte}}],
        showlegend:compilees.length>1,
        legend:{orientation:'h',x:0,y:-0.22,font:{size:10,color:couleurTexte}},
        dragmode:'pan'
      };
      const config={responsive:true,displaylogo:false,scrollZoom:false,modeBarButtonsToRemove:['lasso2d','select2d'],displayModeBar:true};
      await Plotly.newPlot(idPlot,traces,layout,config);
      if(window.ResizeObserver){
        const ro=new ResizeObserver(()=>{try{Plotly.Plots.resize(zonePlot);}catch(_){}});
        ro.observe(zonePlot);
        zonePlot.__auroraResizeObserver=ro;
      }
      // Même configuration conservée pour le grand graphique (objectif : une
      // seule source de vérité, jamais une deuxième courbe recalculée).
      zonePlot.__auroraGraphConfig={traces:traces,subtitle:compilees.map(c=>c.label).join(' · ')};
      auroraCablerClicAgrandissement(wrapPlot,zonePlot);
    }catch(e){
      console.error('[Aurora][Graphique] échec du rendu :',e);
      const bubble=row?.querySelector?.('.aurore-ia-bubble');
      const zone=bubble?.querySelector?.('.aurora-graph-plot');
      if(zone)zone.innerHTML='<div class="aurora-graph-error">Le graphique n’a pas pu s’afficher.</div>';
    }
  }


  /* ==========================================================================
     AURORA — PASSERELLE GEOGEBRA
     --------------------------------------------------------------------------
     Les expressions déjà analysées par Aurora sont réutilisées telles quelles.
     Aucun nouvel appel IA et aucun recalcul du graphique ne sont nécessaires.
     GeoGebra accepte directement les fonctions f(x)=... dans sa saisie.
     ========================================================================== */
  function auroraExpressionGeoGebra(raw){
    let s=String(raw||'').trim();
    s=s.replace(/^\s*(?:y|f\s*\(x\))\s*=\s*/i,'').trim();
    s=s.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
    s=s.replace(/π/gi,'pi').replace(/\be\^/gi,'exp(');
    // Conversion sûre de quelques notations que le moteur Aurora peut produire.
    s=s.replace(/\bexp\s*\(\s*([^()]+)\s*\)/gi,'exp($1)');
    s=s.replace(/\bln\s*\(/gi,'ln(');
    s=s.replace(/\blog\s*\(/gi,'ln(');
    return s;
  }
  function auroraConstruireExpressionsGeoGebra(compilees){
    return (compilees||[]).map((c,i)=>{
      const nom=String.fromCharCode(102+i); // f, g, h...
      return nom+'(x) = '+auroraExpressionGeoGebra(c?.raw||c?.label||'');
    }).filter(Boolean);
  }
  let auroraGeoGebraExpressions=[];
  function fermerGeoGebraAurora(){
    const d=document.getElementById('auroraGeoGebraDialog');
    if(!d)return;
    d.style.display='none';d.hidden=true;
    document.body.classList.remove('aurora-geogebra-open');
  }
  async function copierExpressionsGeoGebraAurora(){
    const value=auroraGeoGebraExpressions.join('\n');
    if(!value)return false;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
      else{
        const ta=document.createElement('textarea');ta.value=value;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
      }
      const b=document.getElementById('auroraGeoGebraCopy');
      if(b){const old=b.innerHTML;b.innerHTML='✓ Expressions copiées';b.classList.add('is-copied');setTimeout(()=>{b.innerHTML=old;b.classList.remove('is-copied');},1600);}
      return true;
    }catch(_){return false;}
  }
  function ouvrirGeoGebraAurora(functions){
  const fs=Array.isArray(functions)?functions:[];
  const exprs=fs.map((f,i)=>{
    let e=String(f && (f.raw||f.expr||f.label) || f || '').trim()
      .replace(/^\s*y\s*=\s*/i,'')
      .replace(/^\s*f\s*\(\s*x\s*\)\s*=\s*/i,'')
      .replace(/^\s*[a-z]\s*\(\s*x\s*\)\s*=\s*/i,'')
      .replace(/\bexp\s*\(\s*x\s*\)/gi,'e^x')
      .replace(/\blog\s*\(\s*x\s*\)/gi,'ln(x)')
      .replace(/×/g,'*')
      .replace(/−/g,'-')
      .trim();
    if(!e)return '';
    return String.fromCharCode(102+i)+'(x)='+e;
  }).filter(Boolean);

  const old=document.getElementById('auroraGeoGebraWorkspace');
  if(old)old.remove();

  const overlay=document.createElement('div');
  overlay.id='auroraGeoGebraWorkspace';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-label','Laboratoire mathématique Aurora');

  const style=document.createElement('style');
  style.textContent=`
    #auroraGeoGebraWorkspace{
      position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;
      background:var(--fond,var(--aurore-bg,#07060B));color:var(--encre,var(--aurore-ink,#F8F7FF));
      font-family:inherit;overflow:hidden;
    }
    #auroraGeoGebraWorkspace .aurora-ggb-top{
      flex:0 0 auto;display:flex;align-items:center;gap:12px;min-height:64px;
      padding:10px 14px;background:var(--papier,var(--aurore-surface,#111019));
      border-bottom:1px solid var(--theme-border,var(--bordure,var(--aurore-line,rgba(216,180,254,.13))));
      box-shadow:0 8px 28px var(--theme-shadow,rgba(0,0,0,.16));
      box-sizing:border-box;
    }
    #auroraGeoGebraWorkspace .aurora-ggb-back{
      width:42px;height:42px;border:1px solid var(--theme-border,var(--bordure,var(--aurore-line,rgba(216,180,254,.13))));
      border-radius:14px;background:var(--theme-soft,var(--aurore-surface-2,#171321));color:var(--theme-primary,var(--aurore-ink,#F8F7FF));
      display:grid;place-items:center;cursor:pointer;flex:0 0 auto;
    }
    #auroraGeoGebraWorkspace .aurora-ggb-back svg{width:20px;height:20px}
    #auroraGeoGebraWorkspace .aurora-ggb-brand{min-width:0;flex:1}
    #auroraGeoGebraWorkspace .aurora-ggb-brand strong{display:block;font-size:15px;line-height:1.2}
    #auroraGeoGebraWorkspace .aurora-ggb-brand span{
      display:block;margin-top:3px;color:var(--gris,var(--aurore-muted,#A9A3B8));font-size:12px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    }
    #auroraGeoGebraWorkspace .aurora-ggb-badge{
      flex:0 0 auto;padding:7px 10px;border-radius:999px;
      background:var(--theme-soft,rgba(139,92,246,.14));color:var(--theme-primary,var(--aurore-lilac,#C084FC));
      border:1px solid var(--theme-border,rgba(192,132,252,.2));font-size:11px;font-weight:700;
    }
    #auroraGeoGebraWorkspace .aurora-ggb-stage{
      position:relative;flex:1;min-height:0;padding:10px;box-sizing:border-box;
    }
    #auroraGeoGebraWorkspace .aurora-ggb-card{
      position:relative;width:100%;height:100%;overflow:hidden;border-radius:20px;
      background:var(--papier,#fff);border:1px solid var(--theme-border,var(--bordure,var(--aurore-line,rgba(216,180,254,.13))));
      box-shadow:0 20px 60px var(--theme-shadow,rgba(0,0,0,.25));
    }
    #auroraGeoGebraWorkspace .aurora-ggb-app{width:100%;height:100%}
    #auroraGeoGebraWorkspace .aurora-ggb-loading{
      position:absolute;inset:0;display:grid;place-items:center;background:var(--papier,#fff);color:var(--encre,#30273d);
      font-size:14px;z-index:2;transition:opacity .2s ease;
    }
    #auroraGeoGebraWorkspace .aurora-ggb-error{
      position:absolute;inset:0;display:none;place-items:center;padding:24px;text-align:center;
      background:var(--papier,#fff);color:var(--encre,#30273d);z-index:3;
    }
    #auroraGeoGebraWorkspace .aurora-ggb-error div{max-width:420px}
    #auroraGeoGebraWorkspace .aurora-ggb-back:hover,
    #auroraGeoGebraWorkspace .aurora-ggb-back:focus-visible{
      background:var(--theme-primary,var(--aurore-violet,#8B5CF6));color:#fff;
      border-color:var(--theme-primary,var(--aurore-violet,#8B5CF6));
      outline:none;box-shadow:0 8px 22px var(--theme-shadow,rgba(0,0,0,.18));
    }
    #auroraGeoGebraWorkspace .aurora-ggb-top::after{
      content:'';position:absolute;left:0;right:0;top:0;height:2px;
      background:linear-gradient(90deg,var(--theme-strong,var(--theme-primary,#8B5CF6)),var(--theme-secondary,var(--theme-primary,#C084FC)));
    }
    #auroraGeoGebraWorkspace .aurora-ggb-top{position:relative;}
    #auroraGeoGebraWorkspace .aurora-ggb-error strong{display:block;margin-bottom:8px}
    @media(max-width:600px){
      #auroraGeoGebraWorkspace .aurora-ggb-top{min-height:58px;padding:8px 10px}
      #auroraGeoGebraWorkspace .aurora-ggb-back{width:40px;height:40px;border-radius:12px}
      #auroraGeoGebraWorkspace .aurora-ggb-stage{padding:6px}
      #auroraGeoGebraWorkspace .aurora-ggb-card{border-radius:15px}
      #auroraGeoGebraWorkspace .aurora-ggb-badge{display:none}
    }
  `;
  overlay.appendChild(style);

  const top=document.createElement('div');top.className='aurora-ggb-top';
  const back=document.createElement('button');back.type='button';back.className='aurora-ggb-back';
  back.setAttribute('aria-label','Retour à la discussion');back.title='Retour à la discussion';
  back.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/><path d="M9 12h11"/></svg>';
  const brand=document.createElement('div');brand.className='aurora-ggb-brand';
  const title=document.createElement('strong');title.textContent='Aurora — Laboratoire mathématique';
  const sub=document.createElement('span');sub.textContent=fs.length?fs.map(f=>String(f?.label||f?.raw||f||'')).join(' · '):'GeoGebra';
  brand.append(title,sub);
  const badge=document.createElement('div');badge.className='aurora-ggb-badge';badge.textContent='GeoGebra';
  top.append(back,brand,badge);

  const stage=document.createElement('div');stage.className='aurora-ggb-stage';
  const card=document.createElement('div');card.className='aurora-ggb-card';
  const app=document.createElement('div');app.className='aurora-ggb-app';app.id='auroraGeoGebraApp';
  const loading=document.createElement('div');loading.className='aurora-ggb-loading';loading.textContent='Chargement du laboratoire mathématique…';
  const error=document.createElement('div');error.className='aurora-ggb-error';
  error.innerHTML='<div><strong>GeoGebra n’a pas pu être chargé.</strong><span>Vérifiez la connexion Internet puis réessayez.</span></div>';
  card.append(app,loading,error);stage.appendChild(card);
  overlay.append(top,stage);
  document.body.appendChild(overlay);

  let closed=false,scriptReady=null;
  const cleanup=()=>{
    if(closed)return;closed=true;
    try{if(app.__auroraGgbApi)app.__auroraGgbApi=null;}catch(_){}
    overlay.remove();
  };
  const close=()=>{
    // Ferme immédiatement le laboratoire à l'écran.
    cleanup();
    // Neutralise l'entrée d'historique dédiée SANS jamais naviguer dedans :
    // un simple replaceState retire le marqueur sur place, sans déplacer
    // l'utilisateur dans la pile de navigation. Le bouton de fermeture ne
    // peut donc plus jamais renvoyer vers l'accueil ou un autre écran.
    if(history.state&&history.state.auroraGeoGebraOverlay){
      try{
        const {auroraGeoGebraOverlay,...reste}=history.state;
        history.replaceState(reste,'',location.href);
      }catch(_){}
    }
  };
  back.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();close();});

  if(!(history.state&&history.state.auroraGeoGebraOverlay)){
    try{history.pushState({...(history.state||{}),auroraGeoGebraOverlay:true},'',location.href);}catch(_){}
  }
  if(!window.__auroraGeoGebraPopstate){
    window.__auroraGeoGebraPopstate=true;
    window.addEventListener('popstate',()=>{
      const el=document.getElementById('auroraGeoGebraWorkspace');
      if(el)el.remove();
      // Nettoyage de sécurité si le popstate a été déclenché par le bouton
      // Retour du navigateur/Android plutôt que par le bouton du laboratoire.
      window.__auroraClosingGeoGebra=false;
    });
  }

  const loadScript=()=>{
    if(window.GGBApplet)return Promise.resolve();
    if(window.__auroraGeoGebraScriptPromise)return window.__auroraGeoGebraScriptPromise;
    window.__auroraGeoGebraScriptPromise=new Promise((resolve,reject)=>{
      const sc=document.createElement('script');
      sc.src='https://www.geogebra.org/apps/deployggb.js';
      sc.async=true;
      sc.onload=()=>resolve();
      sc.onerror=()=>reject(new Error('GeoGebra script unavailable'));
      document.head.appendChild(sc);
    });
    return window.__auroraGeoGebraScriptPromise;
  };

  scriptReady=loadScript().then(()=>{
    if(closed||!window.GGBApplet)return;
    const params={
      appName:'graphing',
      width:Math.max(320,card.clientWidth),
      height:Math.max(320,card.clientHeight),
      showToolBar:true,
      showAlgebraInput:true,
      showMenuBar:false,
      showResetIcon:true,
      showFullscreenButton:false,
      showZoomButtons:true,
      enableLabelDrags:true,
      enableShiftDragZoom:true,
      showSuggestionButtons:true,
      buttonRounding:0.7,
      buttonShadows:false,
      language:'fr',
      appletOnLoad:function(api){
        app.__auroraGgbApi=api;
        for(const command of exprs){try{api.evalCommand(command);}catch(e){console.warn('[Aurora][GeoGebra]',e);}}
        requestAnimationFrame(()=>{loading.style.opacity='0';setTimeout(()=>{loading.style.display='none';},220);});
      }
    };
    const applet=new GGBApplet(params,true);
    applet.inject(app);
  }).catch(err=>{
    console.error('[Aurora][GeoGebra]',err);
    loading.style.display='none';error.style.display='grid';
  });
}

  document.getElementById('auroraGeoGebraClose')?.addEventListener('click',fermerGeoGebraAurora);
  document.getElementById('auroraGeoGebraCopy')?.addEventListener('click',copierExpressionsGeoGebraAurora);
  document.getElementById('auroraGeoGebraOpen')?.addEventListener('click',async()=>{
    await copierExpressionsGeoGebraAurora();
    window.open('https://www.geogebra.org/graphing','_blank','noopener,noreferrer');
  });
  document.getElementById('auroraGeoGebraDialog')?.addEventListener('click',(e)=>{
    if(e.target===e.currentTarget)fermerGeoGebraAurora();
  });
  document.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'&&document.getElementById('auroraGeoGebraDialog')?.style.display==='flex')fermerGeoGebraAurora();
  });

  /* ==========================================================================
     AURORA — MODE AGRANDI DU GRAPHIQUE (extension additive)
     --------------------------------------------------------------------------
     Le petit graphique reste seul responsable du calcul des courbes. Cette
     partie se contente de rejouer, dans un overlay plein écran, exactement
     les mêmes traces Plotly déjà calculées (aucune deuxième évaluation des
     fonctions mathématiques). Le petit graphique dans la conversation n'est
     jamais remplacé : l'overlay est une fenêtre à part, qui se referme pour
     retrouver la conversation intacte.
     ========================================================================== */
  const AURORA_OVERLAY_PLOT_ID='auroraGraphOverlayPlot';
  function auroraOverlayEl(){return document.getElementById('auroraGraphOverlay');}
  function auroraOverlayEstOuvert(){const o=auroraOverlayEl();return !!o&&o.style.display==='flex';}
  function auroraClonerTraces(traces){
    return (traces||[]).map(t=>Object.assign({},t,{x:(t.x||[]).slice(),y:(t.y||[]).slice(),line:Object.assign({},t.line)}));
  }
  // Empêche l'ouverture de l'overlay lorsque le clic provient en réalité d'un
  // glissement (pan) sur le petit graphique, ou d'un clic sur les icônes de la
  // barre d'outils Plotly (zoom, réinitialisation…) : dans ces deux cas
  // l'utilisateur interagit déjà avec le graphique, il ne cherche pas à
  // l'agrandir.
  function auroraCablerClicAgrandissement(wrapPlot,zonePlot){
    if(!wrapPlot||wrapPlot.__auroraClicCable)return;
    wrapPlot.__auroraClicCable=true;
    // L’agrandissement est volontairement déclenché uniquement par le bouton
    // visible « Agrandir » afin de ne pas détourner les clics/pans Plotly.
  }
  async function ouvrirGrandGraphiqueAurora(zonePlot){
    try{
      const cfg=zonePlot&&zonePlot.__auroraGraphConfig;
      if(!cfg||!cfg.traces||!cfg.traces.length)return;
      const overlay=auroraOverlayEl();
      if(!overlay)return;
      const sub=document.getElementById('auroraGraphOverlaySub');
      if(sub)sub.textContent=cfg.subtitle||'';
      // Un seul état d'historique dédié pour l'overlay ("auroraGraphOverlay"),
      // qui conserve l'état de navigation déjà en place (ne casse pas
      // l'historique Aurora / lecteur PDF / autres panneaux).
      if(!(history.state&&history.state.auroraGraphOverlay)){
        try{
          const ecranActuel=document.querySelector('.screen.active')?.id||'screen-aurore-ia';
          const base=(typeof creerSnapshotNavigation==='function')?creerSnapshotNavigation(ecranActuel,window.scrollY):(history.state||{});
          history.pushState(Object.assign({},base,{auroraGraphOverlay:true}),'',location.href);
        }catch(_){}
      }
      overlay.style.display='flex';
      document.body.classList.add('aurora-graph-overlay-open');
      const Plotly=await assurerPlotlyCharge();
      const plotDiv=document.getElementById(AURORA_OVERLAY_PLOT_ID);
      if(!plotDiv)return;
      const traces=auroraClonerTraces(cfg.traces);
      traces.forEach(t=>{if(t.line)t.line.width=Math.max(t.line.width||2,3);});
      const couleurTexte=auroraCouleurCSS('--ia-muted','#958DA6');
      const couleurGrille=auroraCouleurCSS('--ia-border','rgba(255,255,255,.14)');
      const xs=[]; const ys=[];
      traces.forEach(t=>{(t.x||[]).forEach(v=>{if(Number.isFinite(v))xs.push(v);});(t.y||[]).forEach(v=>{if(Number.isFinite(v))ys.push(v);});});
      const gxMin=xs.length?Math.min(...xs):-10, gxMax=xs.length?Math.max(...xs):10;
      let gyMin=ys.length?Math.min(...ys):-1, gyMax=ys.length?Math.max(...ys):1;
      if(!Number.isFinite(gyMin)||!Number.isFinite(gyMax)||gyMin===gyMax){gyMin=-1;gyMax=1;}
      if(gyMin>0)gyMin=0; if(gyMax<0)gyMax=0;
      const gyAmp=Math.max(1e-9,gyMax-gyMin);
      gyMin-=gyAmp*.05; gyMax+=gyAmp*.05;
      const layout={
        autosize:true,
        margin:{l:52,r:20,t:18,b:44},
        paper_bgcolor:'rgba(0,0,0,0)',
        plot_bgcolor:'rgba(0,0,0,0)',
        font:{color:couleurTexte,size:13},
        xaxis:{range:[gxMin,gxMax],zeroline:true,zerolinecolor:couleurTexte,zerolinewidth:2,fixedrange:false,showline:true,linecolor:couleurTexte,linewidth:1.5,gridcolor:couleurGrille,color:couleurTexte,tickmode:'linear',tick0:0,dtick:Math.max(1,Math.ceil((gxMax-gxMin)/19)),ticks:'outside',title:{text:'x',font:{size:12,color:couleurTexte}}},
        yaxis:{range:[gyMin,gyMax],zeroline:true,zerolinecolor:couleurTexte,zerolinewidth:2,fixedrange:false,showline:true,linecolor:couleurTexte,linewidth:1.5,gridcolor:couleurGrille,color:couleurTexte,tickmode:'linear',tick0:0,dtick:Math.max(1,Math.ceil((gyMax-gyMin)/19)),ticks:'outside',title:{text:'y',font:{size:12,color:couleurTexte}}},
        annotations:[{x:0,y:0,xref:'x',yref:'y',text:'O',showarrow:false,xshift:10,yshift:-10,font:{size:13,color:couleurTexte}}],
        showlegend:traces.length>1,
        legend:{orientation:'h',x:0,y:-0.16,font:{size:12,color:couleurTexte}},
        dragmode:'pan'
      };
      const config={responsive:true,displaylogo:false,scrollZoom:true,modeBarButtonsToRemove:['lasso2d','select2d'],displayModeBar:true,doubleClick:'reset+autosize'};
      await Plotly.newPlot(plotDiv,traces,layout,config);
      if(window.ResizeObserver){
        if(plotDiv.__auroraOverlayResizeObserver)plotDiv.__auroraOverlayResizeObserver.disconnect();
        const ro=new ResizeObserver(()=>{try{Plotly.Plots.resize(plotDiv);}catch(_){}});
        ro.observe(plotDiv);
        plotDiv.__auroraOverlayResizeObserver=ro;
      }
      document.getElementById('auroraGraphOverlayClose')?.focus?.({preventScroll:true});
    }catch(e){
      console.error('[Aurora][Graphique] échec de l’agrandissement :',e);
    }
  }
  function fermerGrandGraphiqueAurora(opts){
    const overlay=auroraOverlayEl();
    if(!overlay||overlay.style.display!=='flex')return;
    // Ferme immédiatement le graphique agrandi à l'écran.
    overlay.style.display='none';
    document.body.classList.remove('aurora-graph-overlay-open');
    try{
      const plotDiv=document.getElementById(AURORA_OVERLAY_PLOT_ID);
      if(plotDiv){
        if(plotDiv.__auroraOverlayResizeObserver){plotDiv.__auroraOverlayResizeObserver.disconnect();plotDiv.__auroraOverlayResizeObserver=null;}
        if(window.Plotly)window.Plotly.purge(plotDiv);
      }
    }catch(_){}
    // Neutralise l'entrée d'historique dédiée SANS jamais naviguer dedans :
    // un simple replaceState retire le marqueur sur place, sans déplacer
    // l'utilisateur dans la pile de navigation. Le bouton Fermer ne peut donc
    // plus jamais renvoyer vers l'accueil ou un autre écran. Le retour
    // matériel Android/iOS reste géré séparément via l'écoute "popstate".
    if(!(opts&&opts.fromPopState) && history.state&&history.state.auroraGraphOverlay){
      try{
        const {auroraGraphOverlay,...reste}=history.state;
        history.replaceState(reste,'',location.href);
      }catch(_){}
    }
  }
  // Exposée pour que le gestionnaire "popstate" principal (bouton Retour
  // Android/navigateur) puisse fermer proprement l'overlay sans dupliquer
  // cette logique ni toucher au système d'historique existant.
  window.auroraFermerGrandGraphique=fermerGrandGraphiqueAurora;
  document.getElementById('auroraGraphOverlayClose')?.addEventListener('click',()=>fermerGrandGraphiqueAurora());
  document.getElementById('auroraGraphOverlayReset')?.addEventListener('click',()=>{
    try{
      const plotDiv=document.getElementById(AURORA_OVERLAY_PLOT_ID);
      if(plotDiv&&window.Plotly)window.Plotly.relayout(plotDiv,{'xaxis.autorange':true,'yaxis.autorange':true});
    }catch(_){}
  });
  document.addEventListener('keydown',(e)=>{
    if(e.key==='Escape'&&auroraOverlayEstOuvert())fermerGrandGraphiqueAurora();
  });

  function collapseWelcome(){
    const w=conversation.querySelector('.aurore-ia-welcome');
    if(!w)return;
    w.classList.add('is-leaving');
    setTimeout(()=>w.remove(),220);
  }

  // Petit logo Aurora affiché à côté de chaque intervention de l'IA pendant
  // la discussion (recherche en cours, réponse en train de s'écrire, réponse
  // finale). Reprend le même repère "A" que l'historique, et se voit remplacé
  // par le vrai logo du site dès qu'appliquerLogoAurora() tourne.
  const AVATAR_AURORA_HTML='<span class="aurore-ia-msg-avatar" aria-hidden="true"><span>A</span></span>';
  function creerAvatarAurora(){
    const av=document.createElement('span');
    av.className='aurore-ia-msg-avatar';av.setAttribute('aria-hidden','true');
    av.innerHTML='<span>A</span>';
    return av;
  }
  function rafraichirAvatarsAurora(){try{appliquerLogoAurora();}catch(_){}}

  function addMessage(text,type){
    if(!hasMessages){hasMessages=true;collapseWelcome();}
    const wasBottom=isNearBottom(),row=document.createElement('div');
    row.className='aurore-ia-message '+type;
    const bubble=document.createElement('div');bubble.className='aurore-ia-bubble';bubble.textContent=text;
    row.appendChild(bubble);conversation.appendChild(row);if(wasBottom)scrollBottom(false);
    return row;
  }

  // Galerie d'aperçu des pièces jointes : visible avant l'analyse et conservée dans la discussion.
  function ajouterGaleriePiecesJointesAurora(row, pieces, status='Envoyé pour analyse'){
    if(!row||!Array.isArray(pieces)||!pieces.length)return null;
    const bubble=row.querySelector('.aurore-ia-bubble')||row;
    const galerie=document.createElement('div');
    galerie.className='aurore-ia-attachment-gallery';
    galerie.setAttribute('aria-label','Aperçu des fichiers analysés');
    pieces.forEach((f,i)=>{
      const item=document.createElement('div');
      item.className='aurore-ia-attachment-preview';
      item.dataset.attachmentIndex=String(i);
      const media=document.createElement('button');
      media.type='button';media.className='aurore-ia-attachment-preview-media';
      media.setAttribute('aria-label','Agrandir '+String(f.name||'fichier'));
      if(f.dataUrl){
        const img=document.createElement('img');
        img.src=f.dataUrl;img.alt=f.name||'Aperçu';img.loading='lazy';
        media.appendChild(img);
      }else{
        media.innerHTML='<span class="aurore-ia-file-preview-icon">PDF</span>';
      }
      const caption=document.createElement('div');caption.className='aurore-ia-attachment-preview-caption';
      caption.innerHTML='<strong>'+esc(f.name||'Fichier')+'</strong><span data-attachment-status>'+esc(status)+'</span>';
      item.appendChild(media);item.appendChild(caption);galerie.appendChild(item);
      media.addEventListener('click',()=>ouvrirApercuPieceJointeAurora(pieces,i));
    });
    bubble.appendChild(galerie);
    return galerie;
  }

  function ouvrirApercuPieceJointeAurora(pieces,index){
    const f=pieces?.[index];if(!f)return;
    let overlay=document.getElementById('auroreIAAttachmentViewer');
    if(!overlay){
      overlay=document.createElement('div');overlay.id='auroreIAAttachmentViewer';overlay.className='aurore-ia-attachment-viewer';
      overlay.innerHTML='<div class="aurore-ia-attachment-viewer-card" role="dialog" aria-modal="true" aria-label="Aperçu du fichier"><button type="button" class="aurore-ia-attachment-viewer-close" aria-label="Fermer">×</button><div class="aurore-ia-attachment-viewer-title"></div><div class="aurore-ia-attachment-viewer-body"></div></div>';
      document.body.appendChild(overlay);
      overlay.querySelector('.aurore-ia-attachment-viewer-close').addEventListener('click',()=>{overlay.style.display='none';});
      overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.style.display='none';});
    }
    overlay.querySelector('.aurore-ia-attachment-viewer-title').textContent=f.name||'Aperçu';
    const body=overlay.querySelector('.aurore-ia-attachment-viewer-body');body.innerHTML='';
    if(f.dataUrl){const img=document.createElement('img');img.src=f.dataUrl;img.alt=f.name||'Aperçu';body.appendChild(img);}
    overlay.style.display='flex';
  }

  async function copierTexteAurora(texte,bouton){
    const value=String(texte||'').trim();
    if(!value||!bouton)return;
    const original=bouton.innerHTML;
    try{
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else{
        const ta=document.createElement('textarea');ta.value=value;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
      }
      bouton.classList.add('is-copied');bouton.innerHTML='✓ Copié';
      setTimeout(()=>{bouton.classList.remove('is-copied');bouton.innerHTML=original;},1600);
    }catch(e){
      bouton.innerHTML='Copie impossible';
      setTimeout(()=>{bouton.innerHTML=original;},1600);
    }
  }
  function ajouterBoutonCopieAurora(bubble,texte){
    if(!bubble||bubble.querySelector('.aurore-ia-copy-action'))return;
    const bouton=document.createElement('button');
    bouton.type='button';bouton.className='aurore-ia-copy-action';
    bouton.setAttribute('aria-label','Copier la réponse d’Aurora');bouton.title='Copier la réponse';
    bouton.innerHTML='<span aria-hidden="true">⧉</span><span>Copier</span>';
    bouton.addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();copierTexteAurora(texte,bouton);});
    bubble.appendChild(bouton);
  }

  function addAssistantResponse(text,source='Aurora'){
    const wasBottom=isNearBottom(),row=document.createElement('div');
    row.className='aurore-ia-message assistant';
    row.appendChild(creerAvatarAurora());
    const bubble=document.createElement('div');bubble.className='aurore-ia-bubble';
    const markdown=document.createElement('div');markdown.className='aurore-ia-markdown';
    markdown.innerHTML=mdToHtml(text||'')||'<p></p>';
     rendreMath(markdown);
    bubble.appendChild(markdown);
    ajouterBoutonCopieAurora(bubble,text);
    row.appendChild(bubble);conversation.appendChild(row);if(wasBottom)scrollBottom(false);
    rafraichirAvatarsAurora();
    return row;
  }

  function addToolState(label){
    if(!hasMessages){hasMessages=true;collapseWelcome();}
    const wasBottom=isNearBottom(),row=document.createElement('div');row.className='aurore-ia-message assistant';
    row.innerHTML=AVATAR_AURORA_HTML+'<div class="aurore-ia-bubble aurora-tool-bubble"><span class="aurora-drop" aria-hidden="true"></span><span class="aurora-activity-label">'+esc(label)+'</span></div>';
    conversation.appendChild(row);if(wasBottom)scrollBottom(false);rafraichirAvatarsAurora();return row;
  }

  async function wikiSearch(q,row){
    const box=row?.querySelector('.aurore-ia-bubble');
    try{
      const u='https://fr.wikipedia.org/w/api.php?'+new URLSearchParams({action:'query',generator:'search',gsrsearch:q,gsrlimit:'4',gsrnamespace:'0',prop:'pageimages|extracts',exintro:'1',explaintext:'1',exchars:'180',piprop:'thumbnail',pithumbsize:'260',format:'json',origin:'*'});
      const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();const pages=d?.query?.pages?Object.values(d.query.pages).sort((a,b)=>(a.index||0)-(b.index||0)):[];
      if(!pages.length){box.innerHTML='<div class="aurore-ia-source-card"><strong>Wikipédia</strong>Aucun résultat trouvé pour « '+esc(q)+' ».</div>';return;}
      box.innerHTML='<div class="aurore-ia-source-card"><strong>Wikipédia</strong>Résultats pertinents</div><div class="aurore-ia-results">'+pages.map(p=>{
        const title=esc(p.title||''),ex=esc((p.extract||'').replace(/\s+/g,' ').trim());
        const img=p.thumbnail?.source?'<img src="'+esc(p.thumbnail.source)+'" alt="" loading="lazy" decoding="async">':'';
        const href='https://fr.wikipedia.org/wiki/'+encodeURIComponent(String(p.title||'').replace(/ /g,'_'));
        return '<article class="aurore-ia-result">'+img+'<div class="aurore-ia-result-body"><strong>'+title+'</strong><p>'+ex+'</p><a href="'+href+'" target="_blank" rel="noopener noreferrer">Voir sur Wikipédia ↗</a></div></article>';
      }).join('')+'</div>';scrollBottom(false);
    }catch(e){if(box)box.innerHTML='<div class="aurore-ia-source-card"><strong>Wikipédia</strong>La recherche est momentanément indisponible.</div>';scrollBottom(false);}
  }

  let stopUnlockTimer=null;
  function setBusy(busy){
    sending=busy;
    if(stopUnlockTimer){clearTimeout(stopUnlockTimer);stopUnlockTimer=null;}
    if(statusText)statusText.textContent=busy?'Aurora travaille…':'Prêt';
    if(statusPill)statusPill.classList.toggle('is-busy',busy);
    form.classList.toggle('is-busy',busy);
    /* Sur Android, le bouton d’envoi et le bouton Stop occupent la même zone.
       Si Stop apparaît au même instant que la fin du tap sur Envoyer, le clic
       peut être attribué au nouveau bouton. On laisse donc le tap d’envoi se
       terminer avant d’armer Stop. */
    if(stopBtn){
      stopBtn.disabled=!busy;
      if(busy){
        stopBtn.disabled=true;
        stopUnlockTimer=setTimeout(()=>{if(sending)stopBtn.disabled=false;},450);
      }
    }
    updateSendState();
  }

  // Permet d'interrompre Aurora pendant qu'elle travaille (recherche en cours
  // ou écriture progressive de la réponse), sans casser le fil de la
  // conversation ni la sauvegarde de ce qui a déjà été échangé.
  stopBtn?.addEventListener('click',()=>{
    if(!sending||stopBtn.disabled)return;
    arretDemande=true;
    if(auroraEnCours.labelTimer){clearInterval(auroraEnCours.labelTimer);auroraEnCours.labelTimer=null;}
    const row=auroraEnCours.row;
    if(row&&row.classList.contains('aurore-ia-activity')){
      row.className='aurore-ia-message assistant';
      row.innerHTML=AVATAR_AURORA_HTML+'<div class="aurore-ia-bubble"><div class="aurore-ia-source-card"><strong>Aurora</strong>Réponse arrêtée.</div></div>';
      rafraichirAvatarsAurora();
    }
    setBusy(false);
  });

  /* Détermine le libellé de l'indicateur de moteur à afficher sous une réponse
     Aurora, à partir des champs réellement retournés par aurora-deepseek-live
     ("source" en priorité, "route" en repli). N'invente jamais le moteur :
     si aucune valeur reconnue n'est présente (anciennes réponses, etc.), ne
     retourne rien et aucun indicateur n'est affiché. */
  function libelleMoteurAurora(data){
    if(!data)return null;
    const source=data.source,route=data.route;
    if(source==='cloudflare_workers_ai'||route==='cloudflare_workers_ai')return '⚡ Aurora · Cloudflare Workers AI · Llama 3.1 8B';
    if(source==='deepseek_compatibility'||route==='deepseek_multimodal_compatibility')return '👁 Aurora · Analyse visuelle';
    return null;
  }

  function creerIndicateurAurora(label='Aurora fait cela…'){
    if(!hasMessages){hasMessages=true;collapseWelcome();}
    const wasBottom=isNearBottom(),row=document.createElement('div');
    row.className='aurore-ia-activity';
    row.innerHTML=AVATAR_AURORA_HTML+'<span class="aurora-drop" aria-hidden="true"></span><span class="aurora-activity-label"></span>';
    row.querySelector('.aurora-activity-label').textContent=label;
    conversation.appendChild(row);
    if(wasBottom)scrollBottom(false);
    rafraichirAvatarsAurora();
    return row;
  }

  async function ecrireAurora(row,text,shouldStop,data){
    /* Réponse instantanée : l’ancienne animation écrivait 1 caractère toutes les
       12 ms, ce qui pouvait ajouter plusieurs dizaines de secondes à une
       réponse longue. Le temps d’attente doit venir du traitement, pas de l’UI. */
    const bubble=document.createElement('div');
    bubble.className='aurore-ia-bubble';
    const live=document.createElement('div');
    live.className='aurore-ia-markdown';
    bubble.appendChild(live);
    row.className='aurore-ia-message assistant';
    row.innerHTML='';row.appendChild(creerAvatarAurora());row.appendChild(bubble);
    rafraichirAvatarsAurora();
    const value=String(text||'');
    const moteurLabel=libelleMoteurAurora(data);
    if(shouldStop&&shouldStop()){
      live.innerHTML=mdToHtml(value)||'<p></p>';
      rendreMath(live);
      ajouterBoutonCopieAurora(bubble,value);
      if(moteurLabel){const tag=document.createElement('span');tag.className='aurore-ia-engine-tag';tag.textContent=moteurLabel;bubble.appendChild(tag);}
      scrollBottom(false);
      return;
    }
    live.innerHTML=mdToHtml(value)||'<p></p>';
    rendreMath(live);
    ajouterBoutonCopieAurora(bubble,value);
    if(moteurLabel){const tag=document.createElement('span');tag.className='aurore-ia-engine-tag';tag.textContent=moteurLabel;bubble.appendChild(tag);}
    scrollBottom(false);
  }

  async function submitIA(q, attachments=[], attachmentGallery=null){
    arretDemande=false;
    setBusy(true);
    const actions=['Aurora fait le point…','Aurora cherche…','Aurora prépare la réponse…'];
    const row=creerIndicateurAurora(actions[Math.floor(Math.random()*actions.length)]);
    auroraEnCours.row=row;
    const labelTimer=setInterval(()=>{
      const label=row?.querySelector('.aurora-activity-label');
      if(label)label.textContent=actions[Math.floor(Math.random()*actions.length)];
    },1400);
    auroraEnCours.labelTimer=labelTimer;
    try{
      const data=await invokeAuroreIA(q, attachments);
      clearInterval(labelTimer);
      if(arretDemande)return;
      const texteReponse=data.text||'Aucune réponse.';
      await ecrireAurora(row,texteReponse,()=>arretDemande,data);
      if(attachmentGallery){
        attachmentGallery.querySelectorAll('[data-attachment-status]').forEach(el=>el.textContent='Analyse terminée');
      }
      if(arretDemande)return;
      messagesActuels.push({role:'assistant',text:texteReponse});
      sauvegarderConversationCourante();
      if(historyPanel?.classList.contains('is-open'))rendreListeHistorique();
      afficherGraphiqueSiNecessaire(row,q,texteReponse);
    }
    catch(error){
      clearInterval(labelTimer);
      if(arretDemande)return;
      row.className='aurore-ia-message assistant';
      row.innerHTML=AVATAR_AURORA_HTML+'<div class="aurore-ia-bubble"><div class="aurore-ia-source-card"><strong>Aurora</strong>'+esc(error.message||'Une erreur est survenue.')+'</div></div>';
      rafraichirAvatarsAurora();
      scrollBottom(false);
    }
    finally{auroraEnCours.row=null;auroraEnCours.labelTimer=null;setBusy(false);}
  }

  form.addEventListener('submit',async e=>{
    e.preventDefault();if(sending)return;
    const q=input.value.trim();
    if(!q && !fichiersIA.length)return;
    closePlusMenu();
    const pieces=fichiersIA.map(f=>f.name).join(', ');
    const messagePourDiscussion=q || 'Analyse les fichiers joints.';
    const messageAffiche=q ? (pieces ? q+'\n\n📎 '+pieces : q) : '📎 '+pieces;
    const piecesAEnvoyer=fichiersIA.slice();
    const userRow=addMessage(messageAffiche,'user');
    const galeriePieces=ajouterGaleriePiecesJointesAurora(userRow,piecesAEnvoyer,'Prêt pour analyse');
    input.value='';autoGrow();updateSendState();input.focus({preventScroll:true});
    messagesActuels.push({role:'user',text:messageAffiche});sauvegarderConversationCourante();
    const lower=q.toLowerCase(),wantsWiki=activeTool==='wikipedia'||/wikip[eé]dia/.test(lower);
    if(wantsWiki){
      setBusy(true);
      const row=addToolState('Aurora cherche sur Wikipédia…');
      await wikiSearch(q.replace(/.*?(?:sur|dans)\s+(?:wikip[eé]dia)\s*/i,'').replace(/^cherche.*?:\s*/i,'').trim()||q,row);
      setBusy(false);return;
    }
    fichiersIA=[];renderAttachments();
    await submitIA(messagePourDiscussion, piecesAEnvoyer, galeriePieces);
  });

  /* --- Confort clavier Android : garde la zone de saisie visible et le bas de la conversation en vue --- */
  function setupViewportGuard(){
    if(!window.visualViewport)return;
    const vv=window.visualViewport;
    function onViewportChange(){
      if(!screen.classList.contains('active'))return;
      document.documentElement.style.setProperty('--ia-vvh',vv.height+'px');
      const kbOpen=(window.innerHeight-vv.height)>120;
      document.body.classList.toggle('aurore-ia-kb-open',kbOpen);
      if(kbOpen)requestAnimationFrame(()=>scrollBottom(true));
    }
    vv.addEventListener('resize',onViewportChange);
    vv.addEventListener('scroll',onViewportChange);
  }
  setupViewportGuard();

  // Geste tactile : un défilement horizontal du doigt sur l'écran d'Aurora
  // ouvre l'historique, en plus du bouton dédié. On ignore les gestes qui
  // démarrent sur un bouton, un lien ou la zone de saisie, et on exige un
  // mouvement nettement plus horizontal que vertical pour ne jamais gêner
  // le défilement normal de la conversation.
  (function initSwipeHistorique(){
    const zone=document.querySelector('.aurore-ia-app');
    if(!zone)return;
    let depart=null;
    zone.addEventListener('touchstart',e=>{
      if(historyPanel?.classList.contains('is-open')||screen.classList.contains('is-mini'))return;
      const t=e.target;
      if(t.closest('button, a, textarea, input, .aurore-ia-history-panel'))return;
      const p=e.touches&&e.touches[0];
      if(!p)return;
      depart={x:p.clientX,y:p.clientY};
    },{passive:true});
    zone.addEventListener('touchend',e=>{
      if(!depart)return;
      const p=e.changedTouches&&e.changedTouches[0];
      depart=depart&&p?depart:null;
      if(!p||!depart){depart=null;return;}
      const dx=p.clientX-depart.x,dy=p.clientY-depart.y;
      depart=null;
      if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.8)ouvrirHistorique();
    },{passive:true});
    zone.addEventListener('touchcancel',()=>{depart=null;},{passive:true});
  })();

  const observer=new MutationObserver(()=>{if(isNearBottom())scrollBottom(false);});
  observer.observe(conversation,{childList:true,subtree:true});
  setRouteActive(screen.classList.contains('active'));
})();
