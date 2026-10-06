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
        return navigator.serviceWorker.register('./sw.js?v=20261006-1',{scope:'./',updateViaCache:'none'});
      }).then(function(reg){
        if(reg) console.log('[Aurore PWA] Service worker actif.',reg.scope);
      }).catch(function(err){console.warn('[Aurore PWA] Service worker indisponible :',err);});
    });
  }})();

/* Aurore — stockage durable + enregistrement hors ligne garanti
   1) Demande au navigateur de ne JAMAIS vider les données du site (caches, PDF,
      couvertures, listes hors ligne). Sans cette demande, Chrome Android peut tout
      effacer (service worker compris) quand le téléphone manque de place ou quand
      le site reste longtemps inutilisé : c'est la cause principale du « ça ne marche
      plus si j'attends trop ». La demande est refaite à chaque ouverture tant qu'elle
      n'est pas accordée (Chrome l'accorde surtout aux sites installés en application).
   2) Après chaque chargement en ligne, signale au service worker tous les fichiers
      que la page vient d'utiliser (scripts, styles, images, polices) pour qu'ils soient
      enregistrés même s'ils ont été chargés avant que le service worker ne prenne la main.
   3) window.auroreStockage() : diagnostic (console) — stockage durable accordé ou non,
      espace utilisé, contenu de chaque cache. */
(function(){
  'use strict';
  var accorde=false;

  function demanderPersistance(){
    try{
      if(!navigator.storage||!navigator.storage.persist)return Promise.resolve(false);
      var p=navigator.storage.persisted?navigator.storage.persisted():Promise.resolve(false);
      return p.then(function(deja){
        if(deja)return true;
        return navigator.storage.persist();
      }).then(function(ok){
        accorde=!!ok;
        window.__auroreStockagePersistant=accorde;
        try{localStorage.setItem('aurore-stockage-persistant',accorde?'1':'0');}catch(e){}
        return accorde;
      }).catch(function(){return false;});
    }catch(e){return Promise.resolve(false);}
  }

  function rechauffer(){
    try{
      if(!('serviceWorker' in navigator)||navigator.onLine===false)return;
      navigator.serviceWorker.ready.then(function(reg){
        var sw=reg&&(reg.active||reg.waiting||reg.installing);
        if(!sw)return;
        var urls=[];
        try{
          performance.getEntriesByType('resource').forEach(function(e){if(e&&e.name)urls.push(e.name);});
        }catch(e){}
        try{urls.push(location.origin+location.pathname);}catch(e){}
        if(!urls.length)return;
        sw.postMessage({type:'AURORE_WARM',urls:urls});
      }).catch(function(){});
    }catch(e){}
  }

  window.addEventListener('load',function(){
    setTimeout(demanderPersistance,1500);
    setTimeout(rechauffer,4000);
    // Un second passage plus tard rattrape les fichiers chargés à la demande (modules, polices, IA…).
    setTimeout(rechauffer,20000);
  });
  window.addEventListener('appinstalled',function(){setTimeout(demanderPersistance,800);});
  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState==='visible'&&!accorde)demanderPersistance();
  });
  window.addEventListener('online',function(){setTimeout(rechauffer,3000);});

  window.auroreStockage=function(){
    var rapport={persistant:null,utilise:null,quota:null,caches:{}};
    var etapes=[];
    try{
      if(navigator.storage&&navigator.storage.persisted)etapes.push(navigator.storage.persisted().then(function(v){rapport.persistant=v;}));
      if(navigator.storage&&navigator.storage.estimate)etapes.push(navigator.storage.estimate().then(function(e){
        rapport.utilise=Math.round((e.usage||0)/1048576)+' Mo';
        rapport.quota=Math.round((e.quota||0)/1048576)+' Mo';
      }));
      if(window.caches)etapes.push(caches.keys().then(function(ks){
        return Promise.all(ks.map(function(k){
          return caches.open(k).then(function(c){return c.keys();}).then(function(r){rapport.caches[k]=r.length+' élément(s)';});
        }));
      }));
    }catch(e){}
    return Promise.all(etapes).then(function(){console.log('[Aurore] Stockage',rapport);return rapport;});
  };
})();

/* Aurore — retour du réseau
   1) Supprime le geste « tirer vers le bas pour recharger » du navigateur, SANS
      toucher au CSS de défilement : on n'intercepte que le geste « tirer vers le bas
      alors qu'on est déjà tout en haut ». Tout autre glissement reste natif.
   2) Quand la connexion revient après une période hors ligne, l'écran en cours est
      mis à jour DISCRÈTEMENT, sur place : la page n'est JAMAIS rechargée, donc
      l'utilisateur reste exactement où il est (même rubrique, même défilement, rien
      n'est effacé ni remis à l'accueil). Seules les données qui étaient manquantes ou
      périmées sont rafraîchies, et l'écran n'est redessiné que si les données ont
      réellement changé. La mise à jour est repoussée (jamais perdue) tant que
      l'utilisateur saisit du texte ou lit un PDF. Maximum une mise à jour / 20 s. */
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

  // 2) Mise à jour discrète au retour du réseau.
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

  function surcoucheOuverte(){
    // Lecteur PDF, article Wikipédia, graphique agrandi, laboratoire GeoGebra : on n'y touche pas.
    try{
      var p=document.getElementById('pdfViewerOverlay');
      if(p&&p.style.display==='block')return true;
      var w=document.getElementById('wikiViewerOverlay');
      if(w&&w.style.display==='block')return true;
      var g=document.getElementById('auroraGraphOverlay');
      if(g&&g.style.display==='flex')return true;
      if(document.getElementById('auroraGeoGebraWorkspace'))return true;
    }catch(e){}
    return false;
  }

  function majRecente(){
    try{return Date.now()-(parseInt(sessionStorage.getItem(CLE),10)||0)<20000;}catch(e){return false;}
  }

  // ---- Rafraîchissement sur place ----
  // Ces fonctions s'appuient sur l'état et les fonctions du site (aurore-navigation.js,
  // aurore-documents.js), partagés entre les scripts classiques. Si l'une manque,
  // on ne fait simplement rien : jamais de rechargement, jamais de retour à l'accueil.
  function enc(v){return encodeURIComponent(v);}

  function ecranActifId(){
    var a=document.querySelector('.screen.active');
    return a?a.id:'';
  }

  function niveauDb(){
    return (etat.classe&&etat.classe.dbNiveaux&&etat.classe.dbNiveaux[0])||
           (etat.feuilleArbre&&etat.feuilleArbre.dbNiveaux&&etat.feuilleArbre.dbNiveaux[0])||
           (etat.sousNiveau&&etat.sousNiveau.dbNiveaux&&etat.sousNiveau.dbNiveaux[0])||'';
  }

  function lireJsonEnLigne(url){
    // Une réponse venant de la copie hors ligne n'est pas une mise à jour : on l'ignore.
    return fetch(url,{headers:HEADERS}).then(function(res){
      if(!res.ok)throw new Error('HTTP '+res.status);
      if(res.headers.get('X-Aurore-Hors-Ligne')==='1')throw new Error('hors-ligne');
      return res.json();
    });
  }

  function relancerCouvertures(){
    // Les cartes restées sans couverture (échec hors ligne) la redemandent maintenant.
    try{
      if(typeof appliquerCouvertureSiLivre!=='function')return;
      var rows=document.querySelectorAll('#docsContent .doc-row');
      for(var i=0;i<rows.length;i++){
        var row=rows[i];
        var doc=row._auroreDocument;
        if(!doc||!doc.Fichier_url)continue;
        if(row.querySelector('.a-couverture'))continue;
        appliquerCouvertureSiLivre(row,doc);
      }
    }catch(e){}
  }

  function defilementsInternes(){
    var out=[];
    var ws=document.querySelectorAll('#docsContent .aurore-resource-window,#docsContent .aurore-community-window');
    for(var i=0;i<ws.length;i++)out.push(ws[i].scrollTop);
    return out;
  }
  function restaurerDefilements(y,fen){
    try{
      window.scrollTo(0,y);
      var ws=document.querySelectorAll('#docsContent .aurore-resource-window,#docsContent .aurore-community-window');
      for(var i=0;i<ws.length&&i<fen.length;i++)ws[i].scrollTop=fen[i];
    }catch(e){}
  }

  function rafraichirAccueil(){
    var ov=document.getElementById('homeFiveLevels');
    if(!ov||typeof chargerCouverturesPortesAccueil!=='function')return;
    var cartes=ov.querySelectorAll('[data-home-door-id]');
    var portes=[];
    for(var i=0;i<cartes.length;i++)portes.push({id:cartes[i].getAttribute('data-home-door-id')});
    if(!portes.length)return;
    // Une requête échouée hors ligne restait mémorisée : on repart d'une promesse neuve.
    try{COUVERTURES_PORTES_ACCUEIL_PROMESSE=null;}catch(e){}
    chargerCouverturesPortesAccueil(portes,ov);
    try{if(typeof chargerStatsNiveaux==='function')chargerStatsNiveaux();}catch(e){}
    try{if(typeof chargerPresentationAccueil==='function')chargerPresentationAccueil();}catch(e){}
  }

  function rafraichirMatieres(){
    if(typeof etat==='undefined'||!etat||!etat.categorie)return Promise.resolve();
    var grid=document.getElementById('matiereGrid');
    if(!grid||!grid.querySelector('.matiere-card'))return Promise.resolve();
    if(typeof SUPABASE_URL==='undefined'||typeof HEADERS==='undefined')return Promise.resolve();
    var categorie=etat.categorie.nom;
    var niveau=niveauDb();
    var query=(niveau?'Niveau=eq.'+enc(niveau):'Niveau=eq.__none__')+'&'+enc('Catégorie')+'=eq.'+enc(categorie)+'&Publie=eq.true';
    if(etat.filiere)query+='&Filiere=eq.'+enc(etat.filiere);
    if(etat.division)query+='&Classe=eq.'+enc(etat.division);
    return lireJsonEnLigne(SUPABASE_URL+'/rest/v1/Document?select='+enc('Matière')+'&'+query).then(function(rows){
      if(!etat.categorie||etat.categorie.nom!==categorie)return;
      if(typeof filtreSerieSiDisponible==='function')rows=filtreSerieSiDisponible(rows);
      var compte={};
      rows.forEach(function(r){var m=r['Matière'];compte[m]=(compte[m]||0)+1;});
      var cartes=grid.querySelectorAll('.matiere-card');
      for(var i=0;i<cartes.length;i++){
        var n=compte[cartes[i].dataset.matiere]||0;
        var b=cartes[i].querySelector('.badge');
        var txt=n+(n>1?' documents':' document');
        if(b&&b.textContent!==txt)b.textContent=txt;
      }
    }).catch(function(){});
  }

  function rafraichirDocuments(){
    // Vue d'ensemble d'une matière uniquement (Aurore + communauté). Les sous-vues
    // « Voir plus » et les listes de livres restent telles quelles.
    if(typeof etat==='undefined'||!etat||!etat.matiere||!etat.categorie)return Promise.resolve();
    var content=document.getElementById('docsContent');
    if(!content)return Promise.resolve();
    var surVueEnsemble=!!content.querySelector('.aurore-origin-groups,.site-empty-filter')||(content.textContent||'').indexOf('Impossible de charger')!==-1;
    if(!surVueEnsemble)return Promise.resolve();
    if(typeof SUPABASE_URL==='undefined'||typeof HEADERS==='undefined'||typeof normaliserRechercheSite!=='function'||typeof afficherDocumentsPublicsAvecOutils!=='function')return Promise.resolve();

    var matiere=etat.matiere;
    var serieDb=etat.filiere?normaliserRechercheSite(etat.filiere).replace(/^serie\s+/,'').trim().toUpperCase():'';
    var divisionDb=etat.division?String(etat.division).trim():'';
    var niveau=niveauDb();
    // Mêmes filtres que allerDocuments() : on retrouve exactement la même liste.
    var base=[];
    if(niveau)base.push('Niveau=eq.'+enc(niveau));
    base.push(enc('Catégorie')+'=eq.'+enc(etat.categorie.nom));
    base.push(enc('Matière')+'=eq.'+enc(matiere.nom));
    base.push('Publie=eq.true');
    if(serieDb)base.push('Filiere=eq.'+enc(serieDb));
    var precis=base.slice();
    if(divisionDb&&divisionDb.length>1)precis.push('Classe=eq.'+enc(divisionDb));
    precis.push('order=id.desc');

    function charger(filtres){
      return lireJsonEnLigne(SUPABASE_URL+'/rest/v1/Document?select=*&'+filtres.join('&'));
    }
    return charger(precis).then(function(brutes){
      if((!brutes||!brutes.length)&&divisionDb)return charger(base.concat(['order=id.desc']));
      return brutes;
    }).then(function(brutes){
      // L'utilisateur a pu changer d'écran pendant le chargement : on ne touche à rien.
      if(ecranActifId()!=='screen-docs'||!etat.matiere||etat.matiere.nom!==matiere.nom)return;
      var c=document.getElementById('docsContent');
      if(!c)return;
      var nouvelles=Array.isArray(brutes)?brutes:[];
      var memes=false;
      try{memes=JSON.stringify(nouvelles)===JSON.stringify(documentsCourants);}catch(e){}
      if(memes&&c.querySelector('.aurore-origin-groups')){relancerCouvertures();return;}
      // Les données ont changé (ou la liste n'avait pas pu se charger) : on redessine
      // la liste en conservant le défilement de la page et des fenêtres internes.
      var y=window.scrollY||0;
      var fen=defilementsInternes();
      documentsCourants=nouvelles;
      if(typeof actualiserTriPublicDocuments==='function')actualiserTriPublicDocuments(documentsCourants);
      afficherDocumentsPublicsAvecOutils();
      restaurerDefilements(y,fen);
      requestAnimationFrame(function(){restaurerDefilements(y,fen);});
    }).catch(function(){});
  }

  function rafraichirEnDouceur(){
    try{
      var id=ecranActifId();
      if(id==='screen-home')rafraichirAccueil();
      else if(id==='screen-matieres')rafraichirMatieres();
      else if(id==='screen-docs')rafraichirDocuments();
      // Tous les autres écrans (espace personnel, administration, Aurora, lecteur…)
      // ne sont pas touchés : l'utilisateur y reste sans aucune interruption.
    }catch(e){console.warn('[Aurore] mise à jour discrète impossible :',e);}
  }

  function tenter(){
    if(!enAttente||verifEnCours)return;
    if(document.visibilityState!=='visible')return;
    verifEnCours=true;
    reseauReel().then(function(ok){
      verifEnCours=false;
      if(!ok||!enAttente)return;
      if(saisieEnCours()||lecteurPdfOuvert()||surcoucheOuverte()||majRecente())return; // le minuteur réessaiera
      enAttente=false;
      etaitHorsLigne=false;
      try{sessionStorage.setItem(CLE,String(Date.now()));}catch(e){}
      rafraichirEnDouceur();
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
   jamais copié. Repéchage : si aucune copie n'existe pour l'identité courante (ex. session
   expirée hors ligne), on relit la copie PUBLIQUE (visiteur anonyme) — elle ne contient
   que ce qu'un visiteur non connecté pouvait déjà voir. Les écritures (POST/PATCH/DELETE),
   les requêtes « Prefer » et « Range » ne sont pas touchées. En ligne, rien ne change. */
(function(){
  'use strict';
  if(window.__auroreRestHorsLigne||typeof window.fetch!=='function'||!('indexedDB' in window))return;
  window.__auroreRestHorsLigne=true;

  var RE=/^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\//i;
  var DB='aurore-offline-db',STORE='rest';
  var MAX_ENTREE=1500*1024,MAX_ENTREES=600;
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
          if(e&&typeof e.body==='string')return e;
          // Repéchage public : jamais la copie d'un autre compte, seulement celle d'un visiteur anonyme.
          if(id!=='anon:')return lire('anon:|'+url);
          return null;
        }).then(function(e){
          if(!e||typeof e.body!=='string')throw err;
          return new Response(e.body,{status:200,headers:{'Content-Type':e.ct||'application/json','X-Aurore-Hors-Ligne':'1'}});
        });
      });
    }catch(e){
      return ORIG.apply(null,args);
    }
  };
})();
