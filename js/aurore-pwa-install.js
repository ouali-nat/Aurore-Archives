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
   1) Supprime le geste « tirer vers le bas pour recharger » du navigateur, SANS
      toucher au CSS de défilement : on n'intercepte que le geste « tirer vers le bas
      alors qu'on est déjà tout en haut ». Tout autre glissement reste natif.
   2) Recharge automatiquement la page quand la connexion revient, uniquement si
      l'utilisateur avait été hors ligne. Le rechargement est repoussé (jamais
      perdu) tant que l'utilisateur saisit du texte ou lit un PDF en grand écran,
      pour ne rien lui faire perdre. Maximum un rechargement automatique / 20 s. */
(function(){
  'use strict';

  // 1) Plus de « tirer pour recharger ».
  function positionHaut(){
    var se=document.scrollingElement||document.documentElement;
    return ((window.pageYOffset||0)<=1)&&((se&&se.scrollTop||0)<=1);
  }
  function ancetreDefilableVersLeHaut(el){
    // Un conteneur interne déjà défilé vers le bas doit pouvoir remonter normalement.
    var n=el;
    while(n&&n!==document.body&&n!==document.documentElement&&n.nodeType===1){
      try{
        var cs=getComputedStyle(n);
        var oy=cs.overflowY;
        if((oy==='auto'||oy==='scroll')&&n.scrollHeight>n.clientHeight&&n.scrollTop>0)return true;
      }catch(e){}
      n=n.parentElement;
    }
    return false;
  }
  var debutEnHaut=false,derniereY=0;
  document.addEventListener('touchstart',function(e){
    if(!e.touches||e.touches.length!==1){debutEnHaut=false;return;}
    derniereY=e.touches[0].clientY;
    debutEnHaut=positionHaut()&&!ancetreDefilableVersLeHaut(e.target);
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(!debutEnHaut||!e.touches||e.touches.length!==1)return;
    var y=e.touches[0].clientY;
    var versLeBas=y>derniereY;
    derniereY=y;
    if(versLeBas&&positionHaut()&&e.cancelable)e.preventDefault();
  },{passive:false});
  document.addEventListener('touchend',function(){debutEnHaut=false;},{passive:true});
  document.addEventListener('touchcancel',function(){debutEnHaut=false;},{passive:true});

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

/* Aurore — listes de documents disponibles hors ligne
   Chaque lecture Supabase (GET /rest/v1/…) réussie est copiée dans IndexedDB
   (aurore-offline-db). Si le réseau est absent au moment de la même requête, la
   dernière copie est rendue à la place de l'erreur : les listes déjà consultées en
   ligne s'affichent donc hors ligne, avec leurs couvertures (vignettes locales).
   Sécurité : la copie est rangée par identité (rôle + identifiant du jeton). Un
   compte ne relit jamais la copie d'un autre compte ; un jeton illisible n'est
   jamais copié. Les écritures (POST/PATCH/DELETE), les requêtes « Prefer » et
   « Range » ne sont pas touchées. En ligne, rien ne change. */
(function(){
  'use strict';
  if(window.__auroreRestHorsLigne||typeof window.fetch!=='function'||!('indexedDB' in window))return;
  window.__auroreRestHorsLigne=true;

  var RE=/^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\//i;
  var DB='aurore-offline-db',STORE='rest';
  var MAX_ENTREE=1500*1024,MAX_ENTREES=250;
  var ORIG=window.fetch.bind(window);

  function entete(h,nom){
    if(!h)return '';
    try{
      if(typeof Headers!=='undefined'&&h instanceof Headers)return h.get(nom)||'';
      if(Array.isArray(h)){
        for(var i=0;i<h.length;i++){if(String(h[i][0]).toLowerCase()===nom)return h[i][1]||'';}
        return '';
      }
      for(var k in h){if(String(k).toLowerCase()===nom)return h[k]||'';}
    }catch(e){}
    return '';
  }
  function identite(h){
    try{
      var auth=entete(h,'authorization');
      if(!auth){var ak=entete(h,'apikey');if(ak)auth='Bearer '+ak;}
      var m=/^Bearer\s+(.+)$/i.exec(auth||'');
      if(!m)return null;
      var p=m[1].split('.')[1];
      if(!p)return null;
      p=p.replace(/-/g,'+').replace(/_/g,'/');
      while(p.length%4)p+='=';
      var j=JSON.parse(atob(p));
      if(!j||!j.role)return null;
      return j.role+':'+(j.sub||'');
    }catch(e){return null;}
  }

  var dbPromesse=null;
  function ouvrir(){
    if(dbPromesse)return dbPromesse;
    dbPromesse=new Promise(function(resolve){
      try{
        var r=indexedDB.open(DB,1);
        r.onupgradeneeded=function(){
          var d=r.result;
          if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'k'});
        };
        r.onsuccess=function(){resolve(r.result);};
        r.onerror=function(){resolve(null);};
        r.onblocked=function(){resolve(null);};
      }catch(e){resolve(null);}
    });
    return dbPromesse;
  }
  function lire(k){
    return ouvrir().then(function(db){
      if(!db)return null;
      return new Promise(function(resolve){
        try{
          var q=db.transaction(STORE,'readonly').objectStore(STORE).get(k);
          q.onsuccess=function(){resolve(q.result||null);};
          q.onerror=function(){resolve(null);};
        }catch(e){resolve(null);}
      });
    });
  }
  function elaguer(db){
    try{
      var tx=db.transaction(STORE,'readwrite');
      var s=tx.objectStore(STORE);
      var liste=[];
      var c=s.openCursor();
      c.onsuccess=function(ev){
        var cur=ev.target.result;
        if(cur){liste.push({k:cur.key,t:cur.value&&cur.value.t||0});cur.continue();return;}
        if(liste.length<=MAX_ENTREES)return;
        liste.sort(function(a,b){return a.t-b.t;});
        liste.slice(0,liste.length-MAX_ENTREES).forEach(function(x){try{s.delete(x.k);}catch(e){}});
      };
    }catch(e){}
  }
  function ecrire(entree){
    ouvrir().then(function(db){
      if(!db)return;
      try{db.transaction(STORE,'readwrite').objectStore(STORE).put(entree);}catch(e){}
      if(Math.random()<0.05)elaguer(db);
    });
  }

  window.fetch=function(input,init){
    var args=arguments;
    try{
      var url=typeof input==='string'?input:(typeof URL!=='undefined'&&input instanceof URL?String(input):'');
      var methode=String((init&&init.method)||'GET').toUpperCase();
      if(!url||!RE.test(url)||methode!=='GET'||!init||!init.headers)return ORIG.apply(null,args);
      if(entete(init.headers,'prefer')||entete(init.headers,'range'))return ORIG.apply(null,args);
      var id=identite(init.headers);
      if(!id)return ORIG.apply(null,args);
      var cle=id+'|'+url;
      return ORIG.apply(null,args).then(function(res){
        try{
          if(res&&res.ok&&/json/i.test(res.headers.get('content-type')||'')){
            var ct=res.headers.get('content-type');
            res.clone().text().then(function(txt){
              if(txt&&txt.length<=MAX_ENTREE)ecrire({k:cle,t:Date.now(),ct:ct,body:txt});
            }).catch(function(){});
          }
        }catch(e){}
        return res;
      },function(err){
        if(err&&err.name==='AbortError')throw err;
        return lire(cle).then(function(e){
          if(!e||typeof e.body!=='string')throw err;
          return new Response(e.body,{status:200,headers:{'Content-Type':e.ct||'application/json','X-Aurore-Hors-Ligne':'1'}});
        });
      });
    }catch(e){
      return ORIG.apply(null,args);
    }
  };
})();
