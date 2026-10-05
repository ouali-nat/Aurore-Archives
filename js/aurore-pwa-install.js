(function(){
  'use strict';
  var deferredPrompt=null;
  var installBtn=document.getElementById('pwaInstallBtn');
  var hint=document.getElementById('pwaInstallHint');
  var hintBtn=document.getElementById('pwaInstallHintBtn');
  function estInstallee(){return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;}
  function afficher(){if(estInstallee())return;if(installBtn)installBtn.style.display='inline-flex';}
  function masquer(){if(installBtn)installBtn.style.display='none';if(hint)hint.style.display='none';}
  function lancerInstallation(){
    if(!deferredPrompt){
      if(hint)hint.style.display='block';
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function(){deferredPrompt=null;masquer();}).catch(function(){deferredPrompt=null;});
  }
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferredPrompt=e;afficher();});
  window.addEventListener('appinstalled',function(){deferredPrompt=null;masquer();});
  if(installBtn)installBtn.addEventListener('click',lancerInstallation);
  if(hintBtn)hintBtn.addEventListener('click',function(){lancerInstallation();});
  if(!estInstallee()) setTimeout(function(){if(deferredPrompt)afficher();},1200);
  // En production, on conserve l'enregistrement existant. Le retirer puis le
  // recréer à chaque visite ajoute des échanges réseau inutiles et peut ralentir
  // l'ouverture, notamment sur les réseaux mobiles.
  if('serviceWorker' in navigator){
    window.addEventListener('load',function(){
      navigator.serviceWorker.getRegistration('./').then(function(existing){
        if(existing) return existing;
        return navigator.serviceWorker.register('./sw.js?v=20260922-1',{scope:'./',updateViaCache:'none'});
      }).then(function(reg){
        if(reg) console.log('[Aurore PWA] Service worker actif.',reg.scope);
      }).catch(function(err){console.warn('[Aurore PWA] Service worker indisponible :',err);});
    });
  }})();

/* Aurore — retour du réseau
   1) Supprime le geste « tirer vers le bas pour recharger » du navigateur.
   2) Recharge automatiquement la page quand la connexion revient, uniquement si
      l'utilisateur avait été hors ligne. Le rechargement est repoussé (jamais
      perdu) tant que l'utilisateur saisit du texte ou lit un PDF en grand écran,
      pour ne rien lui faire perdre. Maximum un rechargement automatique / 20 s. */
(function(){
  'use strict';

  // 1) Plus de « tirer pour recharger ».
  try{
    var st=document.createElement('style');
    st.id='aurore-sans-tirer-pour-recharger';
    st.textContent='html,body{overscroll-behavior-y:none!important;}';
    (document.head||document.documentElement).appendChild(st);
  }catch(e){}

  // 2) Rechargement automatique au retour du réseau.
  var CLE='aurore-reco-reload';
  var etaitHorsLigne=(navigator.onLine===false);
  var enAttente=false;
  var verifEnCours=false;

  function reseauReel(){
    // HEAD sur l'accueil : jamais intercepté par le service worker, donc pas de faux « en ligne » venant du cache.
    return fetch('/',{method:'HEAD',cache:'no-store'})
      .then(function(r){return !!(r&&r.ok);})
      .catch(function(){return false;});
  }

  function saisieEnCours(){
    var a=document.activeElement;
    if(!a)return false;
    var t=(a.tagName||'').toLowerCase();
    return t==='input'||t==='textarea'||t==='select'||a.isContentEditable===true;
  }

  function lecteurPdfOuvert(){
    // Un grand canvas visible (page de PDF en lecture) : on n'interrompt pas la lecture.
    var cs=document.getElementsByTagName('canvas');
    for(var i=0;i<cs.length;i++){
      var r=cs[i].getBoundingClientRect();
      if(r.width>window.innerWidth*0.8&&r.height>window.innerHeight*0.5&&r.bottom>0&&r.top<window.innerHeight)return true;
    }
    return false;
  }

  function rechargeRecent(){
    try{return Date.now()-(parseInt(sessionStorage.getItem(CLE),10)||0)<20000;}catch(e){return false;}
  }

  function tenter(){
    if(!enAttente||verifEnCours)return;
    if(document.visibilityState!=='visible')return;
    verifEnCours=true;
    reseauReel().then(function(ok){
      verifEnCours=false;
      if(!ok||!enAttente)return;
      if(saisieEnCours()||lecteurPdfOuvert()||rechargeRecent())return; // le minuteur réessaiera
      enAttente=false;
      etaitHorsLigne=false;
      try{sessionStorage.setItem(CLE,String(Date.now()));}catch(e){}
      location.reload();
    });
  }

  window.addEventListener('offline',function(){etaitHorsLigne=true;});
  window.addEventListener('online',function(){
    if(!etaitHorsLigne)return;
    enAttente=true;
    setTimeout(tenter,1200); // laisse la connexion se stabiliser
  });
  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState!=='visible')return;
    if(navigator.onLine===false){etaitHorsLigne=true;return;}
    if(etaitHorsLigne)enAttente=true;
    tenter();
  });
  setInterval(function(){if(enAttente)tenter();},5000);
})();

/* Aurore — couvertures disponibles hors ligne
   Le site garde la 1re page de chaque PDF dans IndexedDB (aurore-couvertures-db),
   mais lit cette base de façon asynchrone sans l'attendre : si la liste s'affiche
   avant la fin de la lecture, le site croit que la vignette n'existe pas et tente
   de la refaire depuis le PDF. En ligne cela passe inaperçu ; hors ligne cela échoue
   et la carte reste sans couverture.
   Correctif : on retarde le traitement de la file des couvertures jusqu'à ce que
   la base soit chargée en mémoire. Aucune autre logique du site n'est modifiée. */
(function(){
  'use strict';
  function installer(){
    try{
      if(window.__auroreCouvHorsLigne)return true;
      if(typeof traiterFileCouvertures!=='function'||typeof CACHE_COUVERTURES_PRET==='undefined'||!CACHE_COUVERTURES_PRET||typeof CACHE_COUVERTURES_PRET.then!=='function')return false;
      window.__auroreCouvHorsLigne=true;
      var originale=traiterFileCouvertures;
      var charge=false;
      CACHE_COUVERTURES_PRET.then(function(){charge=true;},function(){charge=true;});
      window.traiterFileCouvertures=function(){
        if(charge)return originale();
        var relancer=function(){charge=true;originale();};
        CACHE_COUVERTURES_PRET.then(relancer,relancer);
      };
      return true;
    }catch(e){return false;}
  }
  if(installer())return;
  var essais=0;
  var t=setInterval(function(){
    essais++;
    if(installer()||essais>80)clearInterval(t);
  },250);
})();
