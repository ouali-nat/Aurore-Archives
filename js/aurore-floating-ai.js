(function(){
  const el=document.getElementById('auroreFloatingAI');
  const menu=document.getElementById('auroreFloatingAIMenu');
  const iconBox=document.getElementById('auroreFloatingAIIcon');
  const subLabel=document.getElementById('auroreFloatingAISub');
  const btnHistory=document.getElementById('auroreFAIHistory');
  const btnResize=document.getElementById('auroreFAIResize');
  const resizeLabel=document.getElementById('auroreFAIResizeLabel');
  const resizeIcon=document.getElementById('auroreFAIResizeIcon');
  const ICON_SHRINK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h4v4"/><path d="M14 10l6-6"/><path d="M8 20H4v-4"/><path d="M10 14l-6 6"/></svg>';
  const ICON_EXPAND='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5"/><path d="M4 4l6 6"/><path d="M15 20h5v-5"/><path d="M20 20l-6-6"/></svg>';
  if(!el||!menu)return;

  // ---- Positionnement fixe (non déplaçable) : sur les écrans du site,
  // Aurora reste dans une zone indépendante en bas à droite afin de ne jamais
  // concurrencer le logo, la recherche ou le compte. Dans l'IA, elle se range
  // dans le coin supérieur gauche de la fenêtre pour rester accessible. ----
  function ancrerSurHeader(){
    el.classList.add('is-positioned');
    el.style.transform='none';
    el.style.left='auto';
    el.style.right='max(14px, env(safe-area-inset-right, 0px))';
    el.style.top='auto';
    el.style.bottom='max(18px, calc(env(safe-area-inset-bottom, 0px) + 18px))';
  }
  function ancrerCoinIA(){
    const ecran=document.getElementById('screen-aurore-ia');
    el.classList.add('is-positioned');
    el.style.transform='none';
    const w=el.offsetWidth||44,h=el.offsetHeight||44;
    const r=ecran?ecran.getBoundingClientRect():{left:0,top:0};
    let left=Math.round(r.left+10);
    let top=Math.round(r.top+10);
    left=Math.min(Math.max(4,left),innerWidth-w-4);
    top=Math.min(Math.max(4,top),innerHeight-h-4);
    el.style.left=left+'px';el.style.top=top+'px';
    el.style.right='auto';el.style.bottom='auto';
  }
  function placer(){
    if(estDansIA())ancrerCoinIA();else ancrerSurHeader();
    if(menu.classList.contains('is-open'))positionMenu();
  }
  addEventListener('resize',placer,{passive:true});
  addEventListener('load',placer);

  // Suivi fluide (au lieu d'observer chaque mutation de style, ce qui
  // provoquait des recalculs de mise en page trop fréquents et rendait le
  // glisser du bloc réduit saccadé) : une seule lecture par image, et on
  // ne réécrit la position que si elle a réellement changé.
  // Le MutationObserver plus bas ne fonctionne pas de façon fiable : ce
  // script s'exécute avant que #screen-aurore-ia n'existe dans la page (le
  // bloc HTML de l'IA arrive plus loin dans le document), donc la cible
  // observée est nulle et jamais réattachée. C'est cette boucle qui doit
  // détecter tout changement de contexte (IA ouverte/fermée/réduite) et
  // replacer la pastille en conséquence — y compris son retour à l'ancrage
  // du header à la fermeture complète.
  let dernierePos='';
  let dernierContexteIA=null;
  (function boucleSuivi(){
    const dansIA=estDansIA();
    if(dansIA){
      const ecran=document.getElementById('screen-aurore-ia');
      if(ecran){
        const r=ecran.getBoundingClientRect();
        const cle=r.left+','+r.top+','+r.width+','+r.height;
        if(cle!==dernierePos){dernierePos=cle;placer();}
      }
    }
    if(dansIA!==dernierContexteIA){
      dernierContexteIA=dansIA;
      placer();
      rafraichirApparence();
    }
    requestAnimationFrame(boucleSuivi);
  })();

  // ---- Le bouton sert aussi de poignée : le faire glisser quand le bloc
  // est réduit déplace toute la fenêtre (un simple tap ouvre le menu). ----
  let dragBloc=false,dragBougé=false,dsx=0,dsy=0,dsl=0,dst=0;
  el.addEventListener('pointerdown',e=>{
    if(!estEnModeMini())return;
    const ecran=document.getElementById('screen-aurore-ia');
    if(!ecran)return;
    dragBloc=true;dragBougé=false;
    const r=ecran.getBoundingClientRect();
    dsx=e.clientX;dsy=e.clientY;dsl=r.left;dst=r.top;
    try{el.setPointerCapture?.(e.pointerId);}catch(_){}
  });
  el.addEventListener('pointermove',e=>{
    if(!dragBloc)return;
    const dx=e.clientX-dsx,dy=e.clientY-dsy;
    if(!dragBougé&&(Math.abs(dx)>4||Math.abs(dy)>4))dragBougé=true;
    if(!dragBougé)return;
    const ecran=document.getElementById('screen-aurore-ia');
    if(!ecran)return;
    const w=ecran.offsetWidth,h=ecran.offsetHeight;
    const nl=Math.min(Math.max(4,dsl+dx),Math.max(4,innerWidth-w-4));
    const nt=Math.min(Math.max(4,dst+dy),Math.max(4,innerHeight-h-4));
    ecran.style.left=nl+'px';ecran.style.top=nt+'px';
    placer();
  });
  const finDragBloc=e=>{
    if(!dragBloc)return;dragBloc=false;
    try{el.releasePointerCapture?.(e.pointerId);}catch(_){}
    if(dragBougé){
      const ecran=document.getElementById('screen-aurore-ia');
      if(ecran){
        const r=ecran.getBoundingClientRect();
        try{localStorage.setItem('aurore_ia_mini_geometry_v1',JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height}));}catch(_){}
      }
    }
  };
  el.addEventListener('pointerup',finDragBloc);
  el.addEventListener('pointercancel',finDragBloc);

  // ---- Logo du site sur le repère "A" ----
  function appliquerLogo(){
    try{
      const url=(function(){try{return sessionStorage.getItem('aurore_logo_url')||'';}catch(_){return '';}})()||(typeof window.AURORE_LOGO_URL==='function'?window.AURORE_LOGO_URL():'');
      if(!url||iconBox.querySelector('img'))return;
      const img=new Image();img.decoding='async';img.loading='eager';img.alt='';
      img.onload=function(){iconBox.replaceChildren(img);};
      img.src=url;
    }catch(_){}
  }
  appliquerLogo();
  let logoChecks=0;
  const logoWatch=setInterval(()=>{appliquerLogo();if(iconBox.querySelector('img')||logoChecks++>40)clearInterval(logoWatch);},300);

  // ---- Ouverture par glissement horizontal sur le site ----
  // Un balayage horizontal franc ouvre Aurora depuis les écrans du site.
  // On ignore les champs de saisie et les zones qui possèdent leur propre
  // défilement horizontal afin de ne pas casser les interactions existantes.
  let gesteHorizontalDepart=null;
  let gesteHorizontalTemps=0;
  const zoneAutoriseGeste=target=>{
    const n=target?.closest?.('input,textarea,select,[contenteditable="true"],.admin-tabs,.admin-tabs *');
    return !n;
  };
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1||estDansIA()||!zoneAutoriseGeste(e.target))return;
    const t=e.touches[0];
    gesteHorizontalDepart={x:t.clientX,y:t.clientY};
    gesteHorizontalTemps=Date.now();
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(!gesteHorizontalDepart||estDansIA()){gesteHorizontalDepart=null;return;}
    const t=e.changedTouches[0];
    const dx=t.clientX-gesteHorizontalDepart.x;
    const dy=t.clientY-gesteHorizontalDepart.y;
    const duree=Date.now()-gesteHorizontalTemps;
    gesteHorizontalDepart=null;
    // Seuil assez net pour éviter qu'un simple déplacement vertical de page
    // soit interprété comme une demande d'ouverture.
    if(Math.abs(dx)>=75&&Math.abs(dx)>Math.abs(dy)*1.35&&duree<=900){
      ouvrirAurora();
    }
  },{passive:true});

  // ---- Contexte : accueil ou intérieur de l'IA ----
  function estDansIA(){
    const ecran=document.getElementById('screen-aurore-ia');
    return !!(ecran&&(ecran.classList.contains('active')||ecran.classList.contains('is-mini')));
  }
  function estEnModeMini(){
    const ecran=document.getElementById('screen-aurore-ia');
    return !!(ecran&&ecran.classList.contains('is-mini'));
  }
  function rafraichirApparence(){
    if(estDansIA()){
      el.setAttribute('title','Aurora — options (historique, réduire)');
      el.setAttribute('aria-label','Options Aurora');
      if(subLabel)subLabel.textContent='Historique · Réduire';
    }else{
      el.setAttribute('title','Ouvrir Aurora');
      el.setAttribute('aria-label','Ouvrir Aurora');
      if(subLabel)subLabel.textContent='Poser une question';
    }
    if(resizeLabel)resizeLabel.textContent=estEnModeMini()?'Agrandir Aurora':'Réduire en fenêtre flottante';
    if(resizeIcon)resizeIcon.innerHTML=estEnModeMini()?ICON_EXPAND:ICON_SHRINK;
    el.style.setProperty('cursor',estEnModeMini()?(dragBloc?'grabbing':'grab'):'pointer','important');
  }

  // ---- Panneau d'options : positionnement intelligent près du bouton ----
  function positionMenu(){
    const r=el.getBoundingClientRect();
    menu.style.visibility='hidden';menu.classList.add('is-open');
    const mr=menu.getBoundingClientRect();
    menu.classList.remove('is-open');menu.style.visibility='';
    let left=r.left;
    if(left+mr.width>innerWidth-10)left=innerWidth-mr.width-10;
    if(left<10)left=10;
    let top=r.top-mr.height-10;
    if(top<10)top=Math.min(r.bottom+10,innerHeight-mr.height-10);
    menu.style.left=Math.round(left)+'px';
    menu.style.top=Math.round(Math.max(10,top))+'px';
  }
  function ouvrirMenu(){
    rafraichirApparence();
    positionMenu();
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden','false');
    el.setAttribute('aria-expanded','true');
  }
  function fermerMenu(){
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden','true');
    el.setAttribute('aria-expanded','false');
  }
  document.addEventListener('click',e=>{
    if(!menu.classList.contains('is-open'))return;
    if(menu.contains(e.target)||el.contains(e.target))return;
    fermerMenu();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.classList.contains('is-open'))fermerMenu();});

  function ouvrirAurora(){
    if(typeof window.auroreOuvrirIA==='function'){
      window.auroreOuvrirIA();
      return;
    }
    document.getElementById('auroreIAHeaderBtn')?.click();
  }

  el.addEventListener('click',e=>{
    if(dragBougé){dragBougé=false;return;}
    if(menu.classList.contains('is-open')){fermerMenu();return;}
    if(estDansIA())ouvrirMenu();else ouvrirAurora();
  });

  // Sécurité de clic mobile : Aurora répond dès l'interaction utilisateur,
  // en phase capture, sans dépendre de l'ordre des autres gestionnaires.
  let dernierDeclenchement=0;
  function declencherAuroraDepuisClic(e){
    const target=e.target?.closest?.('#auroreFloatingAI');
    if(!target||target!==el||estDansIA())return;
    const maintenant=Date.now();
    if(maintenant-dernierDeclenchement<500)return;
    dernierDeclenchement=maintenant;
    ouvrirAurora();
  }
  document.addEventListener('pointerup',declencherAuroraDepuisClic,true);
  document.addEventListener('touchend',declencherAuroraDepuisClic,true);
  document.addEventListener('click',declencherAuroraDepuisClic,true);
  el.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){
      e.preventDefault();
      if(menu.classList.contains('is-open')){fermerMenu();return;}
      if(estDansIA())ouvrirMenu();else ouvrirAurora();
    }
  });

  btnHistory?.addEventListener('click',()=>{
    fermerMenu();
    document.getElementById('auroreIAMenuBtn')?.click();
  });
  btnResize?.addEventListener('click',()=>{
    fermerMenu();
    document.getElementById('auroreIAMinimize')?.click();
  });

  // ---- Repositionnement automatique : tout changement de contexte (IA
  // ouverte/fermée, mode réduit activé/désactivé) déplace la pastille sans
  // jamais laisser l'utilisateur la glisser lui-même. La détection fiable se
  // fait dans boucleSuivi() ci-dessus (le MutationObserver sur
  // #screen-aurore-ia ne peut pas être utilisé ici : cet élément n'existe
  // pas encore dans la page à ce stade du chargement). ----
  placer();
  rafraichirApparence();
  requestAnimationFrame(placer);
  setTimeout(placer,400);
})();
