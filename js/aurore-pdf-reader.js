  // ---------- LECTEUR PDF INTÉGRÉ (rendu canvas via PDF.js) ----------
  // Le fichier est chargé en mémoire par PDF.js et rendu page par page sur un
  // <canvas>. Aucune visionneuse native du navigateur n'est utilisée : il n'y a
  // donc pas de barre d'outils native avec bouton d'enregistrement/impression
  // intégré à contourner. En mode lecture seule (Telechargement_autorise ===
  // false), aucune URL du fichier n'apparaît dans le DOM (pas de href, pas
  // d'onglet), et le bouton Imprimer est masqué (l'impression navigateur peut
  // servir à "imprimer vers PDF", ce qui équivaudrait à contourner l'interdiction
  // de téléchargement — même règle appliquée aux deux, faute d'une règle dédiée).
  // Rappel honnête : ceci retire les moyens de téléchargement évidents depuis
  // l'interface, mais ne peut pas garantir une protection absolue contre la
  // copie d'un contenu affiché dans un navigateur.
  // pdf.js (~300 Ko) n'est nécessaire que lorsqu'un document est réellement
  // ouvert : le charger ici plutôt qu'au démarrage de la page évite de
  // bloquer l'affichage initial pour les visiteurs qui ne lisent aucun PDF.
  let PDFJS_CHARGEMENT = null;
  function chargerPdfJs() {
    if (typeof pdfjsLib !== 'undefined') return Promise.resolve(pdfjsLib);
    if (PDFJS_CHARGEMENT) return PDFJS_CHARGEMENT;
    PDFJS_CHARGEMENT = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(pdfjsLib);
      };
      s.onerror = () => { PDFJS_CHARGEMENT = null; reject(new Error('pdf.js indisponible (réseau bloqué ou instable).')); };
      document.head.appendChild(s);
    });
    return PDFJS_CHARGEMENT;
  }
  let DOC_EN_LECTURE = null;
  let PDF_EN_COURS = null;      // instance PDFDocumentProxy de PDF.js
  let PDF_OCTETS_COURANTS = null; // ArrayBuffer déjà téléchargé, réutilisé pour l'impression
  let PDF_PAGE_ACTUELLE = 1;
  let PDF_JETON_OUVERTURE = 0;  // évite qu'un chargement obsolète n'écrase un lecteur déjà refermé
  let PDF_ZOOM = 1;             // zoom réel du rendu par rapport à la largeur de référence
  let PDF_ROTATION = 0;         // 0/90/180/270
  const PDF_ZOOM_MIN = 0.5, PDF_ZOOM_MAX = 3, PDF_ZOOM_PAS = 0.01;
  const PDF_ZOOM_CONFORT_BASE = 0.82;

  function lireZoomGlobalPourLecteurPDF() {
    let valeur = NaN;
    try {
      const sauvegarde = parseFloat(localStorage.getItem('aurore_site_zoom_v1'));
      if (Number.isFinite(sauvegarde)) valeur = sauvegarde;
    } catch (e) {}
    if (!Number.isFinite(valeur)) {
      const cssZoom = parseFloat(getComputedStyle(document.documentElement).zoom || document.documentElement.style.zoom || '1');
      if (Number.isFinite(cssZoom) && cssZoom > 0) valeur = cssZoom * 100;
    }
    return Math.max(40, Math.min(160, Number.isFinite(valeur) ? valeur : 100));
  }

  function calculerZoomInitialPDF() {
    // Le lecteur démarre volontairement à 60 %. Le zoom global du site est
    // neutralisé à 100 % pendant la lecture puis restauré à la fermeture.
    return 0.60;
  }
  let PDF_MODE_LECTURE = 'vertical'; // vertical = défilement continu ; horizontal = pages côte à côte
  // Cache mémoire court : rouvrir un PDF déjà consulté évite un nouveau téléchargement.
  const PDF_CACHE_OCTETS = new Map();
  const PDF_CACHE_MAX = 4;
  let PDF_FETCH_CONTROLLER = null;
  // Le lecteur PDF doit devenir réellement indépendant du zoom global du site.
  // On mémorise le zoom utilisateur à l'ouverture, puis on neutralise
  // temporairement document.documentElement.style.zoom pendant toute la lecture.
  // Le zoom interne du PDF (PDF_ZOOM) reste, lui, inchangé.
  let PDF_ZOOM_SITE_SAUVEGARDE = null;
  let PDF_ZOOM_SITE_NEUTRALISE = false;

  function neutraliserZoomGlobalPourLecteurPDF() {
    const racine = document.documentElement;
    if (!racine) return;
    if (PDF_ZOOM_SITE_NEUTRALISE) return;
    PDF_ZOOM_SITE_SAUVEGARDE = racine.style.zoom || '';
    PDF_ZOOM_SITE_NEUTRALISE = true;
    racine.style.zoom = '1';
    window.dispatchEvent(new Event('resize'));
  }

  function restaurerZoomGlobalApresLecteurPDF() {
    const racine = document.documentElement;
    if (!racine || !PDF_ZOOM_SITE_NEUTRALISE) return;
    racine.style.zoom = PDF_ZOOM_SITE_SAUVEGARDE || '';
    PDF_ZOOM_SITE_SAUVEGARDE = null;
    PDF_ZOOM_SITE_NEUTRALISE = false;
    window.dispatchEvent(new Event('resize'));
  }

  function memoriserPDFCache(cle, octets) {
    if (!cle || !octets) return;
    PDF_CACHE_OCTETS.delete(cle);
    PDF_CACHE_OCTETS.set(cle, octets);
    while (PDF_CACHE_OCTETS.size > PDF_CACHE_MAX) PDF_CACHE_OCTETS.delete(PDF_CACHE_OCTETS.keys().next().value);
  }

  function texteFichierPourAffichage(doc) {
    return (doc && doc.Titre) ? doc.Titre : 'document';
  }

  let PDF_PROGRESS_DEBUT=0;
  let PDF_PROGRESS_CHARGE_PRECEDENTE=0;
  let PDF_PROGRESS_TEMPS_PRECEDENT=0;
  function reinitialiserProgressionLecteurPDF(){
    PDF_PROGRESS_DEBUT=Date.now();
    PDF_PROGRESS_CHARGE_PRECEDENTE=0;
    PDF_PROGRESS_TEMPS_PRECEDENT=PDF_PROGRESS_DEBUT;
    const bar=document.getElementById('pdfViewerProgressBar');
    const percent=document.getElementById('pdfViewerProgressPercent');
    const stage=document.getElementById('pdfViewerProgressStage');
    const speed=document.getElementById('pdfViewerProgressSpeed');
    if(bar) bar.style.width='0%';
    if(percent) percent.textContent='0%';
    if(stage) stage.textContent='Préparation';
    if(speed) speed.textContent='Préparation…';
    // Nouveau document : on repart sur la barre pleine largeur, pas la sphère
    // compacte laissée par une éventuelle lecture précédente.
    masquerSpherePDF();
  }
  function mettreAJourProgressionLecteurPDF(pct, etape, info={}) {
    const percentEl=document.getElementById('pdfViewerProgressPercent');
    const currentPercent=percentEl ? parseFloat(String(percentEl.textContent).replace(',','.')) : 0;
    const p=(pct==null || Number.isNaN(Number(pct)))
      ? Math.max(0,Math.min(100,Number.isFinite(currentPercent)?currentPercent:0))
      : Math.max(0,Math.min(100,Number(pct)||0));
    const bar=document.getElementById('pdfViewerProgressBar');
    const percent=document.getElementById('pdfViewerProgressPercent');
    const stage=document.getElementById('pdfViewerProgressStage');
    const speed=document.getElementById('pdfViewerProgressSpeed');
    if(bar) bar.style.width=p+'%';
    if(percent) percent.textContent=Math.round(p)+'%';
    if(stage && etape) stage.textContent=etape;
    if(speed){
      // Dans le lecteur, ce texte reste volontairement simple et non technique.
      // La précision du pourcentage reste pilotée par les octets réellement reçus.
      if(info.speedText) speed.textContent=info.speedText;
    }
    mettreAJourSpherePDF(p, etape);
  }

  /* ---------- Sphère de progression (mode compact) ---------- */
  const PDF_SPHERE_CIRCONFERENCE = 2 * Math.PI * 17; // r=17, cf. le SVG de la sphère
  let pdfModeCompactActif = false;
  function mettreAJourSpherePDF(p, etape){
    const arc = document.getElementById('pdfViewerProgressSphereArc');
    const percentEl = document.getElementById('pdfViewerProgressSpherePercent');
    const sphere = document.getElementById('pdfViewerProgressSphere');
    if(arc) arc.style.strokeDashoffset = String(PDF_SPHERE_CIRCONFERENCE * (1 - p / 100));
    if(percentEl) percentEl.textContent = Math.round(p) + '%';
    if(sphere && etape) sphere.title = etape;
  }
  // Bascule la barre pleine largeur vers la sphère compacte : appelé dès que
  // la première page est visible et lisible, pour ne plus gêner la lecture.
  function activerModeCompactProgressionPDF(){
    if(pdfModeCompactActif) return;
    pdfModeCompactActif = true;
    const dock = document.getElementById('pdfViewerLoadProgressDock');
    const sphere = document.getElementById('pdfViewerProgressSphere');
    if(dock){ dock.classList.remove('is-visible'); dock.setAttribute('aria-hidden','true'); }
    if(sphere){ sphere.classList.add('is-visible'); sphere.setAttribute('aria-hidden','false'); }
  }
  function masquerSpherePDF(){
    pdfModeCompactActif = false;
    const sphere = document.getElementById('pdfViewerProgressSphere');
    if(sphere){ sphere.classList.remove('is-visible'); sphere.setAttribute('aria-hidden','true'); }
  }
  // Clic/tap sur la sphère : petit rappel de l'étape en cours via le badge
  // (le texte est déjà exposé par l'attribut title / aria-live pour lecteurs
  // d'écran), et navigation clavier basique.
  document.getElementById('pdfViewerProgressSphere')?.addEventListener('click', function(){
    const stage = document.getElementById('pdfViewerProgressStage');
    const percentEl = document.getElementById('pdfViewerProgressSpherePercent');
    if(stage && percentEl) this.title = stage.textContent + ' — ' + percentEl.textContent;
  });

  const PDF_RECENTS_KEY='aurore_pdf_recents_v1';
  const PDF_RECENTS_MAX=8;
  function auroreLirePDFRecents(){try{const a=JSON.parse(localStorage.getItem(PDF_RECENTS_KEY)||'[]');return Array.isArray(a)?a:[];}catch(e){return[];}}
  function auroreEcrirePDFRecents(a){try{localStorage.setItem(PDF_RECENTS_KEY,JSON.stringify(a.slice(0,PDF_RECENTS_MAX)));}catch(e){}}
  function auroreEnregistrerPDFRecent(doc){
    if(!doc||doc.id==null||!doc.Fichier_url)return;
    const id=String(doc.id);
    const a=auroreLirePDFRecents().filter(x=>String(x.id)!==id);
    a.unshift({id:doc.id,Titre:doc.Titre||'Document',Auteur:doc.Auteur||'',Fichier_url:doc.Fichier_url,'Catégorie':doc['Catégorie']||'',Niveau:doc.Niveau||'',Classe:doc.Classe||'',Filiere:doc.Filiere||'','Matière':doc['Matière']||'',Genre:doc.Genre||'',Telechargement_autorise:doc.Telechargement_autorise!==false});
    auroreEcrirePDFRecents(a);
    auroreRendrePDFRecents();
  }
  function auroreRendrePDFRecents(){
    const list=document.getElementById('pdfRecentList'); if(!list)return;
    const a=auroreLirePDFRecents();
    list.innerHTML='';
    if(!a.length){list.innerHTML='<div class="pdf-recent-empty">Aucun document récent.</div>';return;}
    a.forEach(doc=>{
      const b=document.createElement('button'); b.type='button'; b.className='pdf-recent-item'; b.title=doc.Titre||'Document';
      const s=document.createElement('span'); s.className='pdf-recent-item-title'; s.textContent=doc.Titre||'Document'; b.appendChild(s);
      const remove=document.createElement('span'); remove.className='pdf-recent-item-remove'; remove.setAttribute('role','button'); remove.setAttribute('tabindex','0'); remove.setAttribute('aria-label','Supprimer ce document des récents'); remove.title='Retirer des récents'; remove.textContent='×'; b.appendChild(remove);
      const retirer=(e)=>{
        e.preventDefault(); e.stopPropagation();
        auroreEcrirePDFRecents(auroreLirePDFRecents().filter(x=>String(x.id)!==String(doc.id)));
        auroreRendrePDFRecents();
      };
      remove.addEventListener('click',retirer);
      remove.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();retirer(e);}});
      b.addEventListener('click',()=>{
        const panel=document.getElementById('pdfRecentPanel'); const toggle=document.getElementById('pdfRecentToggle');
        if(panel){panel.classList.remove('open');panel.setAttribute('aria-hidden','true');} if(toggle)toggle.setAttribute('aria-expanded','false');
        ouvrirLecteurPDF(doc);
      });
      list.appendChild(b);
    });
  }
  document.getElementById('pdfRecentToggle')?.addEventListener('click',(e)=>{
    e.stopPropagation();
    const panel=document.getElementById('pdfRecentPanel'); const btn=document.getElementById('pdfRecentToggle'); if(!panel||!btn)return;
    const open=!panel.classList.contains('open'); panel.classList.toggle('open',open); panel.setAttribute('aria-hidden',String(!open)); btn.setAttribute('aria-expanded',String(open));
    if(open)auroreRendrePDFRecents();
  });
  document.addEventListener('DOMContentLoaded',auroreRendrePDFRecents);

  // Même mécanique de progression que le dépôt : XHR fournit les octets
  // réellement reçus, puis requestAnimationFrame garde l'affichage fluide
  // entre deux événements réseau. Le lecteur utilise ainsi la même logique
  // de précision que la barre d'envoi, sans progression fictive.
  function chargerPDFAvecProgressionDepotStyle(url, signal, onProgress, onEtat) {
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      let termine=false, total=0, loaded=0, frame=0;
      let dernierTemps=Date.now(), dernierCharge=0;
      const finir=(fn,val)=>{
        if(termine)return;
        termine=true;
        if(frame&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame);
        fn(val);
      };
      const pousser=(l,t,force=false)=>{
        loaded=Math.max(loaded,Number(l)||0);
        if(Number(t)>0)total=Number(t);
        if(typeof onProgress==='function')onProgress(loaded,total,force);
      };
      const frameProgress=()=>{
        if(termine||!onProgress)return;
        frame=0;
        pousser(loaded,total);
      };
      const demanderFrame=()=>{
        if(frame||termine||typeof requestAnimationFrame!=='function')return;
        frame=requestAnimationFrame(frameProgress);
      };
      if(signal){
        if(signal.aborted){try{xhr.abort();}catch(e){};return reject(new DOMException('Chargement annulé','AbortError'));}
        signal.addEventListener('abort',()=>{try{xhr.abort();}catch(e){}},{once:true});
      }
      xhr.open('GET',url,true);
      xhr.responseType='arraybuffer';
      xhr.setRequestHeader('Accept','application/pdf');
      xhr.timeout=15*60*1000;
      xhr.onprogress=e=>{
        const t=(e.lengthComputable&&Number(e.total)>0)?Number(e.total):total;
        if(t>0)total=t;
        pousser(e.loaded,total,true);
        const now=Date.now(),dt=Math.max(.001,(now-dernierTemps)/1000);
        const delta=Math.max(0,loaded-dernierCharge);
        if(delta>0&&dt>=.05){
          const debit=delta/dt;
          onEtat?.('progress', {loaded,total,speed:debit});
          dernierCharge=loaded;dernierTemps=now;
        }
        demanderFrame();
      };
      xhr.onload=()=>{
        if(xhr.status>=200&&xhr.status<300){
          if(total<=0)total=loaded||Number(xhr.response?.byteLength)||0;
          pousser(total,total,true);
          onEtat?.('termine',{loaded:total,total});
          finir(resolve,xhr.response);
        }else{
          finir(reject,new Error('HTTP '+xhr.status+' lors du chargement du PDF.'));
        }
      };
      xhr.onerror=()=>finir(reject,new Error('Erreur réseau pendant le chargement du PDF.'));
      xhr.onabort=()=>finir(reject,new DOMException('Chargement annulé','AbortError'));
      xhr.ontimeout=()=>finir(reject,new Error('Le chargement du PDF a expiré.'));
      try{xhr.send();}catch(e){finir(reject,e);}
    });
  }

  async function ouvrirLecteurPDF(doc) {
    if (!doc || !doc.Fichier_url) return;
    auroreEnregistrerPDFRecent(doc);
    DOC_EN_LECTURE = doc;
    if (PDF_EN_COURS && PDF_EN_COURS.destroy) { try { PDF_EN_COURS.destroy(); } catch(e){} }
    PDF_EN_COURS = null;
    PDF_OCTETS_COURANTS = null;
    PDF_PAGE_ACTUELLE = 1;
    PDF_ZOOM = calculerZoomInitialPDF();
    PDF_ROTATION = 0;
    PDF_MODE_LECTURE = 'vertical';
    document.getElementById('pdfViewerZoomLevel').textContent = Math.round(PDF_ZOOM * 100) + '%';
    mettreAJourModeLecturePDF();
    fermerMenuLecteurPDF();
    const jeton = ++PDF_JETON_OUVERTURE;
    if (PDF_FETCH_CONTROLLER) { try { PDF_FETCH_CONTROLLER.abort(); } catch(e) {} }
    PDF_FETCH_CONTROLLER = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const telechargementOk = doc.Telechargement_autorise !== false;

    document.getElementById('pdfViewerTitre').textContent = doc.Titre || 'Document';
    document.getElementById('pdfViewerLectureSeuleBadge').style.display = telechargementOk ? 'none' : 'inline-block';

    const btnDl = document.getElementById('pdfViewerTelecharger');
    if (telechargementOk) {
      btnDl.style.display = 'inline-flex';
      btnDl.onclick = () => { fermerMenuLecteurPDF(); telechargerDocumentAvecProgression(doc); };
    } else {
      btnDl.style.display = 'none';
      btnDl.onclick = null;
    }
    // Réinitialisation de l'affichage : écran de chargement visible, erreur et
    // canvas masqués, pagination remise à "— / —".
    afficherEtatChargement();
    reinitialiserProgressionLecteurPDF();
    const progressDockInitial=document.getElementById('pdfViewerLoadProgressDock');
    if(progressDockInitial){ progressDockInitial.classList.add('is-visible'); progressDockInitial.setAttribute('aria-hidden','false'); }
    mettreAJourProgressionLecteurPDF(0, 'Envoi du document…', {speedText:'Préparation…'});
    document.getElementById('pdfViewerPage').textContent = '— / —';
    document.getElementById('pdfViewerOverlay').classList.remove('pdf-immersive');
    // Le site peut être zoomé à 40–160 %. Le lecteur, lui, doit toujours
    // prendre 100 % de la fenêtre physique : on neutralise donc le zoom global
    // uniquement pendant son ouverture.
    neutraliserZoomGlobalPourLecteurPDF();
    const overlayLecteur = document.getElementById('pdfViewerOverlay');
    overlayLecteur.style.display = 'block';
    // L'overlay vient de passer de display:none à display:block : on attend
    // un cycle de rendu pour que clientWidth/clientHeight représentent bien
    // la fenêtre physique. Cela évite qu'un zoom du site précédent ou une
    // largeur encore à 0 soit utilisée pour calculer les pages.
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (jeton !== PDF_JETON_OUVERTURE) return;
    window.dispatchEvent(new Event('resize'));
    document.getElementById('pdfViewerZone').focus({ preventScroll: true });

    // Historique : on empile un état dédié au lecteur pour que le bouton Retour
    // Android le referme au lieu de sortir de l'écran (Documents/Matière/Série…)
    // sur lequel il a été ouvert. Voir le gestionnaire "popstate" plus bas.
    try {
      if (!navigationParPopState) {
        const ecranActuel = document.querySelector('.screen.active')?.id || 'screen-docs';
        history.pushState({ ...creerSnapshotNavigation(ecranActuel, window.scrollY), lecteurPDF: true }, '', location.href);
      }
    } catch (e) {}

    // Diagnostic technique temporaire (voir §9 de la mission "lecteur PDF") :
    // n'apparaît jamais pour un utilisateur normal. Journalise l'URL exacte
    // appelée, le statut HTTP, Content-Type/Content-Length, les octets réçus et
    // l'étape en échec, pour localiser précisément la panne de récupération.
    const estAdminPourDiag = !!(session && session.role === 'admin');
    const diagBox = document.getElementById('pdfViewerDiagBox');
    const diagLogEl = document.getElementById('pdfViewerDiagLog');
    diagLogEl.textContent = '';
    diagBox.style.display = estAdminPourDiag ? 'block' : 'none';
    function diagLog(texte) {
      if (!estAdminPourDiag) return;
      diagLogEl.textContent += texte + '\n';
      console.log('[Diag lecteur PDF]', texte);
    }
    diagLog('Document.Fichier_url = ' + doc.Fichier_url);

    try {
      await chargerPdfJs();
    } catch (e) {
      diagLog('→ échec chargement pdf.js : ' + (e?.message || e));
      afficherErreurLecteur("La visionneuse n'a pas pu se charger. Réessayez dans quelques instants.", telechargementOk, doc.Fichier_url);
      return;
    }
    if (jeton !== PDF_JETON_OUVERTURE) return; // le lecteur a été refermé pendant le chargement de pdf.js

    try {
      const cacheCle=String(doc.Fichier_url);
      let pdf = null;
      let sourceRapide = null;

      // Ouverture progressive : PDF.js reçoit directement l'URL et demande
      // uniquement les octets nécessaires (Range/stream). On ne télécharge
      // donc plus tout le PDF avant d'afficher la première page.
      const urlPublique = (doc.Fichier_url && String(doc.Fichier_url).indexOf(R2_PUBLIC_URL + '/') === 0)
        ? String(doc.Fichier_url) : null;
      const urlWorker = urlPublique
        ? `${R2_WORKER_URL}/${urlPublique.slice(R2_PUBLIC_URL.length + 1)}`
        : String(doc.Fichier_url);

      let derniereErreur = null;
      const sources = [urlWorker, urlPublique].filter((v,i,a)=>v && a.indexOf(v)===i);

      // IMPORTANT : même mécanique que le dépôt. Le PDF est d’abord reçu
      // par XHR et la progression est alimentée par les octets réellement
      // reçus (loaded/total). Aucun chargement de première page séparé.
      for (const source of sources) {
        try {
          sourceRapide = source;
          diagLog('→ Chargement XHR du PDF avec progression dépôt : ' + source);
          mettreAJourProgressionLecteurPDF(0,'Envoi du document…',{speedText:'Préparation…'});
          const octets = await chargerPDFAvecProgressionDepotStyle(
            source,
            PDF_FETCH_CONTROLLER?.signal,
            (loaded,total)=>{
              if(jeton!==PDF_JETON_OUVERTURE)return;
              const pct = total>0 ? Math.min(100,Math.max(0,(loaded/total)*100)) : 0;
              mettreAJourProgressionLecteurPDF(pct,'Envoi du document…',{loaded,total});
            },
            (type,info)=>{
              if(jeton!==PDF_JETON_OUVERTURE || type!=='progress' || !info?.total)return;
              const debit=Number(info.speed)||0;
              const speedText=debit>=1024*1024
                ? (debit/(1024*1024)).toFixed(1)+' Mo/s'
                : Math.max(1,Math.round(debit/1024))+' Ko/s';
              const pct=Math.min(100,Math.max(0,(info.loaded/info.total)*100));
              mettreAJourProgressionLecteurPDF(pct,'Envoi du document…',{speedText,loaded:info.loaded,total:info.total});
            }
          );
          if(jeton!==PDF_JETON_OUVERTURE)return;
          if(!octets || !octets.byteLength) throw new Error('Le PDF reçu est vide.');
          mettreAJourProgressionLecteurPDF(100,'Document chargé',{speedText:'Document prêt.'});
          pdf = await pdfjsLib.getDocument({data:new Uint8Array(octets),stopAtErrors:false}).promise;
          if(!pdf || !pdf.numPages) throw new Error('PDF sans page exploitable');
          diagLog('→ PDF.js prêt : '+pdf.numPages+' page(s).');
          break;
        } catch(e) {
          derniereErreur=e; pdf=null; sourceRapide=null;
          diagLog('→ Source XHR indisponible : '+(e?.message||e));
        }
      }

      if(!pdf) {
        // Si Range/stream n'est pas disponible, on utilise uniquement le lecteur
        // natif en secours : aucun téléchargement complet n'est recopié en JS.
        diagLog('→ Range/PDF.js indisponible : ouverture native directe du PDF.');
        if (afficherVisionneuseNativePDF(doc.Fichier_url)) return;
        throw derniereErreur || new Error('Impossible d’ouvrir le flux PDF.');
      }

      if (jeton !== PDF_JETON_OUVERTURE) return;
      diagLog('→ PDF.js a chargé le document : '+pdf.numPages+' page(s).'+(sourceRapide?' Source Range/URL.':' Source mémoire.'));
      PDF_EN_COURS=pdf;

      // Dès que PDF.js possède assez d'informations pour servir les pages, on
      // retire l'écran de chargement. La première page devient prioritaire ;
      // les suivantes continuent en arrière-plan. La progression est déplacée
      // dans un petit dock discret afin de ne jamais recouvrir la lecture.
      const loading=document.getElementById('pdfViewerLoading');
      const progressDock=document.getElementById('pdfViewerLoadProgressDock');
      if(loading) loading.style.display='none';
      if(progressDock){ progressDock.classList.add('is-visible'); progressDock.setAttribute('aria-hidden','false'); }
      mettreAJourProgressionLecteurPDF(100,'Document chargé',{speedText:'Document prêt.'});
      document.getElementById('pdfViewerStatut').textContent='';

      // Première page : priorité absolue, sans attendre les autres.
      await rendrePagePDF(1,true);
      if (jeton !== PDF_JETON_OUVERTURE) return;
      mettreAJourProgressionLecteurPDF(undefined,'Préparation en cours',{speedText:pdf.numPages>1?'Vous pouvez continuer votre lecture pendant la préparation du document.':'Document prêt à lire'});

      // Deuxième page et pages voisines : démarrage immédiat mais non bloquant.
      if(pdf.numPages>1) rendreUnePagePDF(2);
      installerRenduProgressifPDF();
      diagLog('→ Page 1 rendue avec succès ; chargement des autres pages en arrière-plan.');
    } catch (err) {
      if (jeton !== PDF_JETON_OUVERTURE) return;
      console.error('[Lecteur PDF] échec de chargement :', err);
      diagLog('→ ÉCHEC FINAL : ' + (err && err.name ? err.name + ' — ' : '') + ((err && err.message) ? err.message : String(err)));
      const messageTechnique = (err && err.message) ? err.message : '';
      let message;
      if (/HTTP 4\d\d/.test(messageTechnique)) {
        message = "Ce document est introuvable ou n'est plus disponible à cet emplacement.";
      } else if (/HTTP 5\d\d/.test(messageTechnique)) {
        message = "Le serveur de stockage rencontre un problème temporaire. Merci de réessayer dans un instant.";
      } else if (/invalid|corrupt/i.test(messageTechnique)) {
        message = "Ce fichier semble endommagé ou n'est pas un PDF valide.";
      } else {
        message = "La visionneuse intégrée n'a pas pu afficher ce document (connexion réseau ou format non pris en charge).";
      }
      // Dernier secours : si CORS/Range empêche PDF.js de lire les octets,
      // le lecteur natif du navigateur peut souvent afficher directement l’URL R2
      // sans exposer les octets au JavaScript. Cela évite de bloquer les gros PDF.
      if (afficherVisionneuseNativePDF(doc.Fichier_url)) {
        diagLog('→ Secours visionneuse PDF native activé : affichage direct du fichier.');
      } else {
        afficherErreurLecteur(message, telechargementOk, doc.Fichier_url);
      }
    }
  }

  window.ouvrirLecteurPDF = ouvrirLecteurPDF;

  function afficherEtatChargement() {
    // Correctif « ancien PDF visible à l'ouverture d'un nouveau » : les pages
    // de l'ancien document restaient dans le DOM jusqu'à ce que le nouveau
    // PDF soit effectivement reçu (rendrePagePDF), ce qui les affichait par-
    // dessus/à côté de l'écran de chargement et prêtait à confusion. On les
    // efface donc ici, dès le tout début de l'ouverture, avant même la
    // moindre requête réseau vers le nouveau document.
    const anciennesPages = document.getElementById('pdfViewerPages');
    if (anciennesPages) {
      anciennesPages.innerHTML = '';
      anciennesPages.style.transform = '';
      anciennesPages.style.transformOrigin = '';
    }
    const zone = document.getElementById('pdfViewerZone');
    if (zone) zone.scrollTop = 0;
    document.getElementById('pdfViewerLoading').style.display = 'flex';
    const progressDock=document.getElementById('pdfViewerLoadProgressDock');
    if(progressDock){ progressDock.classList.remove('is-visible'); progressDock.setAttribute('aria-hidden','true'); }
    masquerSpherePDF();
    document.getElementById('pdfViewerErreurBox').style.display = 'none';
    document.getElementById('pdfViewerCanvas').style.display = 'none';
    const native=document.getElementById('pdfViewerNative');
    if(native){native.style.display='none';native.removeAttribute('src');}
    document.getElementById('pdfViewerStatut').textContent = 'Chargement du document…';
    mettreAJourProgressionLecteurPDF(0,'Préparation');
  }

  function afficherErreurLecteur(message, telechargementOk, url) {
    document.getElementById('pdfViewerLoading').style.display = 'none';
    document.getElementById('pdfViewerCanvas').style.display = 'none';
    document.getElementById('pdfViewerPages').innerHTML = '';
    const native=document.getElementById('pdfViewerNative');
    if(native){native.style.display='none';native.removeAttribute('src');}
    const box = document.getElementById('pdfViewerErreurBox');
    box.style.display = 'flex';
    box.innerHTML = '';
    const icon=document.createElement('div'); icon.className='pdf-reader-error-icon'; icon.setAttribute('aria-hidden','true'); icon.textContent='!';
    const title=document.createElement('h3'); title.className='pdf-reader-error-title'; title.textContent='Impossible d’afficher ce document';
    const detail=document.createElement('p'); detail.className='pdf-reader-error-detail'; detail.textContent=message || 'La connexion au fichier PDF a échoué. Vous pouvez réessayer ou ouvrir le document avec la visionneuse de votre appareil.';
    const actions=document.createElement('div'); actions.className='pdf-reader-error-actions';
    const retry=document.createElement('button'); retry.type='button'; retry.className='deposer-btn'; retry.textContent='Réessayer'; retry.addEventListener('click',()=>{ if(DOC_EN_LECTURE) ouvrirLecteurPDF(DOC_EN_LECTURE); });
    actions.appendChild(retry);
    if(telechargementOk && url){
      const lien=document.createElement('a'); lien.href=url; lien.target='_blank'; lien.rel='noopener'; lien.textContent='Ouvrir le PDF';
      lien.style.background='var(--fond)'; lien.style.color='var(--encre)'; lien.style.border='1px solid var(--bordure)';
      actions.appendChild(lien);
    }
    box.append(icon,title,detail,actions);
  }

  function afficherVisionneuseNativePDF(url){
    if(!url)return false;
    const native=document.getElementById('pdfViewerNative');
    if(!native)return false;
    document.getElementById('pdfViewerLoading').style.display='none';
    document.getElementById('pdfViewerErreurBox').style.display='none';
    document.getElementById('pdfViewerCanvas').style.display='none';
    document.getElementById('pdfViewerPages').innerHTML='';
    native.style.display='block';
    native.src=url;
    const statut=document.getElementById('pdfViewerStatut'); if(statut)statut.textContent='';
    mettreAJourProgressionLecteurPDF(100,'Document prêt',{speedText:'Prêt à lire'});
    return true;
  }

  document.getElementById('pdfViewerReessayer').addEventListener('click', () => {
    if (DOC_EN_LECTURE) ouvrirLecteurPDF(DOC_EN_LECTURE);
  });

  // Récupère les octets du PDF pour PDF.js. Cloudflare R2 ne renvoie aucun en-tête
  // CORS par défaut sur son domaine public (*.r2.dev) : une lecture des octets en
  // JavaScript (fetch/XHR, nécessaire à PDF.js) y échoue donc systématiquement,
  // même si l'affichage direct d'un lien ou d'une image fonctionne (cela ne
  // nécessite pas de CORS). On tente donc d'abord de récupérer le fichier via le
  // Worker Cloudflare déjà utilisé pour le dépôt (mêmes en-têtes que l'upload),
  // puis on retente l'URL publique directe en dernier recours. Aucune de ces
  // deux tentatives ne modifie R2 ni le Worker : ce sont de simples requêtes.
  // onProgress(pct|null) est appelé pendant le téléchargement quand la taille du
  // fichier est connue (Content-Length, exposé par défaut par les CORS), pour un
  // chargement progressif visible sur les documents volumineux.
  // diagLog(texte) est optionnel : n'est fourni (voir ouvrirLecteurPDF) que pour
  // un compte administrateur, et journalise chaque tentative en détail.
  let TELECHARGEMENT_DOCUMENT_EN_COURS = false;
  let TELECHARGEMENT_TOAST_TIMER = null;
  let TELECHARGEMENT_ABORT_CONTROLLER = null;

  function nomFichierTelechargementDepuisDocument(doc) {
    const titre = String(doc && doc.Titre || '').trim();
    let extension = '.pdf';
    try {
      const u = new URL(doc && doc.Fichier_url || '', window.location.href);
      const nom = decodeURIComponent(u.pathname.split('/').pop() || '').trim();
      const match = nom.match(/(\.[a-z0-9]{2,8})$/i);
      if (match) extension = match[1].toLowerCase();
    } catch(e) {}
    const propre = titre.replace(/[\\/:*?"<>|]+/g, ' ').replace(/[\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
    return (propre || 'Document') + extension;
  }

  function formaterTailleTelechargement(octets) {
    if (!Number.isFinite(octets) || octets < 0) return '';
    if (octets < 1024) return octets + ' o';
    if (octets < 1024 * 1024) return (octets / 1024).toFixed(1).replace('.0','') + ' Ko';
    if (octets < 1024 * 1024 * 1024) return (octets / (1024 * 1024)).toFixed(1).replace('.0','') + ' Mo';
    return (octets / (1024 * 1024 * 1024)).toFixed(2).replace(/0+$/,'').replace(/\.$/,'') + ' Go';
  }

  function afficherCarteTelechargement(doc, etat='preparation', pct=null, recu=null, total=null, detail=null) {
    const box=document.getElementById('downloadProgressToast');
    const title=document.getElementById('downloadProgressTitle');
    const name=document.getElementById('downloadProgressName');
    const percent=document.getElementById('downloadProgressPercent');
    const bar=document.getElementById('downloadProgressBar');
    const detailEl=document.getElementById('downloadProgressDetail');
    if(!box) return;
    if(TELECHARGEMENT_TOAST_TIMER) { clearTimeout(TELECHARGEMENT_TOAST_TIMER); TELECHARGEMENT_TOAST_TIMER=null; }
    name.textContent=(doc && doc.Titre ? String(doc.Titre).trim() : 'Document');
    box.classList.remove('is-success','is-error','is-indeterminate','is-annule');
    const cancelBtn=document.getElementById('downloadProgressCancel');
    if(cancelBtn) cancelBtn.style.display=(etat==='succes'||etat==='erreur'||etat==='annule')?'none':'inline-flex';
    if(etat==='succes') {
      title.textContent='Merci ! Téléchargement terminé';
      percent.textContent='100%';
      bar.style.width='100%';
      box.classList.add('is-success');
      detailEl.textContent=detail || 'Votre document a été enregistré avec succès dans les téléchargements de votre téléphone. Vous pouvez continuer à utiliser Aurore.';
      TELECHARGEMENT_TOAST_TIMER=setTimeout(()=>{box.style.display='none';},5000);
    } else if(etat==='annule') {
      title.textContent='Téléchargement annulé';
      percent.textContent='—';
      bar.style.width='0%';
      box.classList.add('is-annule');
      detailEl.textContent=detail || 'Le téléchargement a été annulé. Aucun fichier n’a été enregistré dans votre historique.';
      TELECHARGEMENT_TOAST_TIMER=setTimeout(()=>{box.style.display='none';},3500);
    } else if(etat==='erreur') {
      title.textContent='Téléchargement impossible';
      percent.textContent='—';
      bar.style.width='0%';
      box.classList.add('is-error');
      detailEl.textContent=detail || 'Une erreur est survenue.';
    } else if(pct==null) {
      title.textContent='Téléchargement en cours…';
      percent.textContent='…';
      bar.style.width='42%';
      box.classList.add('is-indeterminate');
      detailEl.textContent=detail || (recu ? formaterTailleTelechargement(recu)+' reçu(s)' : 'Connexion au fichier…');
    } else {
      const p=Math.max(0,Math.min(100,Math.round(pct)));
      title.textContent='Téléchargement en cours…';
      percent.textContent=p+'%';
      bar.style.width=p+'%';
      detailEl.textContent=detail || (total ? `${formaterTailleTelechargement(recu||0)} / ${formaterTailleTelechargement(total)}` : 'Transfert du fichier…');
    }
    box.style.display='block';
  }

  function fermerCarteTelechargement() {
    const box=document.getElementById('downloadProgressToast');
    if(box) box.style.display='none';
    if(TELECHARGEMENT_TOAST_TIMER) { clearTimeout(TELECHARGEMENT_TOAST_TIMER); TELECHARGEMENT_TOAST_TIMER=null; }
  }

  // Identifiant anonyme local (pas une donnée personnelle) permettant de
  // distinguer approximativement des visiteurs différents dans les
  // statistiques admin, sans aucun compte ni cookie de suivi tiers.
  function idVisiteurAnonyme() {
    try {
      let id = localStorage.getItem('aurore_visitor_id');
      if (!id) {
        id = 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('aurore_visitor_id', id);
      }
      return id;
    } catch (e) { return ''; }
  }

  // Enregistre une visite/tentative anonyme dans la table "Visites_anonymes"
  // (RLS : insertion publique autorisée, lecture réservée aux admins via RPC —
  // voir compter_visites_anonymes / lister_visites_anonymes_recentes). Best
  // effort : une erreur réseau ici ne doit jamais bloquer la navigation.
  async function enregistrerVisiteAnonyme(contexte, doc) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/Visites_anonymes`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          contexte: contexte || 'visite',
          document_titre: (doc && doc.Titre) || null,
          visitor_id: idVisiteurAnonyme(),
          user_agent: (navigator && navigator.userAgent) || null
        })
      });
    } catch (e) { console.warn('[Visites anonymes] enregistrement impossible', e); }
  }

  // Bloque le téléchargement pour un visiteur non connecté et ouvre la même
  // fenêtre de connexion/inscription que le reste du site (voir requireLogin()
  // dans l'espace personnel, même principe rejoué ici car scripts séparés).
  function exigerConnexionPourTelechargement(doc) {
    enregistrerVisiteAnonyme('tentative_telechargement', doc);
    const signup = document.getElementById('accessSignupBtn');
    if (signup) signup.click();
    setTimeout(() => document.getElementById('showLoginBtn')?.click(), 30);
    const m = document.getElementById('loginMessage');
    if (m) {
      m.textContent = 'Connectez-vous pour télécharger ce document. La lecture reste libre, seul le téléchargement nécessite un compte.';
      m.className = 'access-message ok';
      m.style.display = 'block';
    }
  }

  // Téléchargement interne Aurore : ne jamais naviguer vers le PDF/R2.
// La lecture d'un PDF passe par ouvrirLecteurPDF(), la visionneuse intégrée.
async function telechargerDocumentAvecProgression(doc) {
    if (!doc || !doc.Fichier_url || doc.Telechargement_autorise === false || TELECHARGEMENT_DOCUMENT_EN_COURS) return;
    if (!session) { exigerConnexionPourTelechargement(doc); return; }

    TELECHARGEMENT_DOCUMENT_EN_COURS = true;
    TELECHARGEMENT_ABORT_CONTROLLER = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = TELECHARGEMENT_ABORT_CONTROLLER?.signal;
    const nomTelechargement = nomFichierTelechargementDepuisDocument(doc);
    afficherCarteTelechargement(doc,'preparation',null,0,null,'Préparation du fichier…');

    try {
      const source = String(doc.Fichier_url);
      const cle = source.indexOf(R2_PUBLIC_URL + '/') === 0
        ? source.slice(R2_PUBLIC_URL.length + 1)
        : null;

      let res = null;

      // Tentative 1 : Worker v2, avec le mode téléchargement demandé.
      if (cle) {
        try {
          const workerUrl = `${R2_WORKER_URL}/${cle}?download=1&filename=${encodeURIComponent(nomTelechargement)}`;
          res = await fetch(workerUrl, signal ? {signal, cache:'no-store'} : {cache:'no-store'});
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
        }
      }

      // Secours : URL publique R2 déjà enregistrée dans Supabase.
      if (!res || !res.ok) {
        try {
          res = await fetch(source, signal ? {signal, cache:'no-store'} : {cache:'no-store'});
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
        }
      }

      if (!res || !res.ok) {
        throw new Error('Le fichier n’a pas pu être récupéré.');
      }

      const total = parseInt(res.headers.get('Content-Length') || '', 10);
      let blob;

      // Même mécanisme que l'ancienne version fonctionnelle : lecture du flux
      // puis création d'un Blob local avant le déclenchement du téléchargement.
      if (res.body) {
        const lecteur = res.body.getReader();
        const morceaux = [];
        let recu = 0;

        while (true) {
          const {done, value} = await lecteur.read();
          if (done) break;
          if (!value) continue;
          morceaux.push(value);
          recu += value.byteLength;

          if (Number.isFinite(total) && total > 0) {
            afficherCarteTelechargement(
              doc,
              'progress',
              Math.min(99, Math.round((recu / total) * 100)),
              recu,
              total
            );
          } else {
            afficherCarteTelechargement(doc,'progress',null,recu,null,'Téléchargement du fichier…');
          }
        }

        blob = new Blob(morceaux, {type:'application/pdf'});
      } else {
        afficherCarteTelechargement(doc,'progress',null,0,null,'Téléchargement du fichier…');
        blob = await res.blob();
      }

      if (signal?.aborted) {
        throw new DOMException('Téléchargement annulé','AbortError');
      }

      if (!blob || blob.size <= 0) {
        throw new Error('Le fichier téléchargé est vide.');
      }

      // Déclenchement réel du téléchargement sur Android/WebView :
      // on utilise le Blob téléchargé, pas une simple navigation vers l'URL PDF.
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.target = '_self';
      a.rel = 'noopener noreferrer';
      a.download = nomTelechargement;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

      await enregistrerTelechargementPersonnel(doc);

      afficherCarteTelechargement(
        doc,
        'succes',
        100,
        blob.size,
        blob.size,
        'Téléchargement terminé. Le fichier a été transmis au téléchargement de votre téléphone.'
      );
    } catch (e) {
      if (e?.name === 'AbortError') {
        afficherCarteTelechargement(doc,'annule',null,null,null,'Le téléchargement a été annulé.');
      } else {
        console.error('[Téléchargement document]', e);
        afficherCarteTelechargement(doc,'erreur',null,null,null,'Le téléchargement n’a pas pu être effectué. Réessayez dans quelques instants.');
      }
    } finally {
      TELECHARGEMENT_DOCUMENT_EN_COURS = false;
      TELECHARGEMENT_ABORT_CONTROLLER = null;
    }
  }

  const btnFermerCarteTelechargement=document.getElementById('downloadProgressClose');
  if(btnFermerCarteTelechargement) btnFermerCarteTelechargement.addEventListener('click',fermerCarteTelechargement);
  const btnAnnulerTelechargement=document.getElementById('downloadProgressCancel');
  if(btnAnnulerTelechargement) btnAnnulerTelechargement.addEventListener('click',()=>TELECHARGEMENT_ABORT_CONTROLLER?.abort());

  // Aucun repli de téléchargement complet ici : un gros PDF doit rester un
  // flux HTTP/Range afin d'éviter de charger 50–200 Mo dans la mémoire du téléphone.

  // Rendu PDF optimisé : affichage immédiat de la première page, puis rendu
  // progressif des autres pages uniquement lorsqu'elles approchent de la zone
  // visible. Cela évite de bloquer l'ouverture des gros documents.
  let pdfRenduObserver = null;
  let pdfPagesRendues = new Set();
  let pdfRendusEnCours = new Map();
  let pdfLargeurBase = 0;

  async function rendreUnePagePDF(n, force=false) {
    if (!PDF_EN_COURS || (!force && pdfPagesRendues.has(n))) return;
    if (pdfRendusEnCours.has(n)) return pdfRendusEnCours.get(n);
    const wrapper = document.querySelector('#pdfViewerPages .pdf-reader-page[data-page="'+n+'"]');
    if (!wrapper) return;
    const canvas = wrapper.querySelector('canvas');
    if (!canvas) return;

    const promesse = (async()=>{
      const page = await PDF_EN_COURS.getPage(n);
      if (!PDF_EN_COURS || !wrapper.isConnected) return;
      const zoneLecteur = document.getElementById('pdfViewerZone');
      const largeurFenetre = zoneLecteur ? Math.max(1, zoneLecteur.clientWidth - 20) : 1;
      const largeurDispo = pdfLargeurBase > 0 ? Math.min(pdfLargeurBase, largeurFenetre) : Math.min(980, largeurFenetre);
      const vpBase = page.getViewport({scale:1, rotation:PDF_ROTATION});
      const echelleAjustement = largeurDispo / Math.max(1, vpBase.width);
      const echelle = Math.max(0.25, Math.min(8, echelleAjustement * PDF_ZOOM));
      const viewport = page.getViewport({scale:echelle, rotation:PDF_ROTATION});
      // Haute résolution : jusqu'à 3x la densité physique de l'écran (au lieu
      // de 2x) pour un rendu net du texte sur les téléphones/tablettes à
      // forte densité, tout en restant borné pour ne pas saturer la mémoire.
      const dpr = Math.min(window.devicePixelRatio || 1, 3);

      // Toutes les pages utilisent exactement la même largeur CSS disponible.
      // Seule la hauteur varie selon le ratio propre à chaque page.
      // La largeur du wrapper suit exactement celle de la page rendue.
      // Cela évite tout effet de double échelle ou de centrage ambigu.
      wrapper.style.width = Math.max(1, Math.round(viewport.width)) + 'px';
      wrapper.style.maxWidth = 'none';
      wrapper.style.marginLeft = 'auto';
      wrapper.style.marginRight = 'auto';

      canvas.width = Math.max(1, Math.round(viewport.width * dpr));
      canvas.height = Math.max(1, Math.round(viewport.height * dpr));
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      canvas.style.maxWidth = 'none';
      canvas.style.display = 'block';
      canvas.style.marginLeft = 'auto';
      canvas.style.marginRight = 'auto';
      const ctx = canvas.getContext('2d', {alpha:false});
      ctx.setTransform(dpr,0,0,dpr,0,0);
      try {
        await page.render({canvasContext:ctx, viewport}).promise;
      } catch (error) {
        /*
         * PDF.js rejette volontairement la promesse lorsque le lecteur est
         * fermé ou qu'un rendu est remplacé. Ce n'est pas une panne.
         */
        const message = String(error?.message || error || '');
        if (/rendering\s+cancelled|RenderingCancelled/i.test(message)) {
          return;
        }
        throw error;
      }

      if (!PDF_EN_COURS || !wrapper.isConnected) return;
      pdfPagesRendues.add(n);
      wrapper.classList.add('pdf-page-rendered');
    })().finally(()=>pdfRendusEnCours.delete(n));

    pdfRendusEnCours.set(n,promesse);
    return promesse;
  }

  function installerRenduProgressifPDF(){
    if(pdfRenduObserver) pdfRenduObserver.disconnect();
    const zone=document.getElementById('pdfViewerZone');
    const wrappers=document.querySelectorAll('#pdfViewerPages .pdf-reader-page');
    if(!zone || !wrappers.length) return;

    if('IntersectionObserver' in window){
      // Le lecteur peut être fermé pendant qu'un callback IntersectionObserver
      // est encore en file d'attente. Dans ce cas PDF_EN_COURS devient null et
      // l'ancien code provoquait : "Cannot read properties of null (reading 'numPages')".
      const totalPagesObservees = PDF_EN_COURS ? Number(PDF_EN_COURS.numPages) || 0 : 0;
      pdfRenduObserver=new IntersectionObserver(entries=>{
        if (!PDF_EN_COURS || PDF_EN_COURS.numPages !== totalPagesObservees) return;
        entries.filter(e=>e.isIntersecting).forEach(e=>{
          if (!PDF_EN_COURS) return;
          const n=Number(e.target.dataset.page)||1;
          rendreUnePagePDF(n);
          // Prépare aussi les pages voisines pour que le défilement reste fluide.
          if(n>1) rendreUnePagePDF(n-1);
          if(PDF_EN_COURS && n<totalPagesObservees) rendreUnePagePDF(n+1);
        });
      },{root:zone,rootMargin:'900px 0px',threshold:0.01});
      wrappers.forEach(w=>pdfRenduObserver.observe(w));
    } else {
      // Repli léger pour les navigateurs sans IntersectionObserver.
      for(let n=1;n<=Math.min(3,PDF_EN_COURS.numPages);n++) rendreUnePagePDF(n);
    }
  }

  async function rendrePagePDF(numero) {
    if (!PDF_EN_COURS) return;
    numero = Math.max(1, Math.min(numero, PDF_EN_COURS.numPages));
    PDF_PAGE_ACTUELLE = numero;
    const zone = document.getElementById('pdfViewerZone');
    const pages = document.getElementById('pdfViewerPages');
    if (!zone || !pages) return;
    try {
      if(pdfRenduObserver) pdfRenduObserver.disconnect();
      pdfPagesRendues = new Set();
      pdfRendusEnCours = new Map();
      pages.innerHTML = '';
      pages.style.transform = '';
      pages.style.transformOrigin = '';
      // Une nouvelle ouverture doit toujours repartir de 100 % et de la
      // largeur réelle du lecteur. Le zoom CSS de l'ancien document ne doit
      // jamais être conservé, même si PDF_ZOOM vient d'être réinitialisé.
      pages.style.zoom = '1';
      pages.style.width = '100%';
      pages.style.maxWidth = '100%';
      pages.style.margin = '0 auto';
      pages.style.marginBottom = '0';
      document.getElementById('pdfViewerLoading').style.display = 'flex';
      document.getElementById('pdfViewerStatut').textContent = 'Ouverture du document…';

      // Largeur automatique unique pour toute la série de pages.
      // On retire une petite marge interne afin qu'aucune page ne déborde,
      // même sur un écran mobile étroit.
      pdfLargeurBase = Math.max(1, Math.min(980, zone.clientWidth - 20));
      pages.style.width = pdfLargeurBase + 'px';
      pages.style.maxWidth = '100%';
      pages.style.zoom = '1';
      pages.style.transform = 'none';
      pages.style.transformOrigin = 'top center';
      pages.style.marginLeft = 'auto';
      pages.style.marginRight = 'auto';
      const total=PDF_EN_COURS.numPages;

      // Les emplacements gardent une hauteur estimée : sans cela, les pages
      // non rendues font ~0px et IntersectionObserver les considère déjà hors
      // écran. On peut donc réellement rendre 1, puis 2, puis 3… au défilement.
      let hauteurEstimee = Math.max(260, Math.round(pdfLargeurBase * 1.414));
      try {
        const page1Meta = await PDF_EN_COURS.getPage(1);
        const vp1 = page1Meta.getViewport({scale:1, rotation:PDF_ROTATION});
        if (vp1.width > 0) hauteurEstimee = Math.max(260, Math.round(pdfLargeurBase * (vp1.height / vp1.width) * PDF_ZOOM));
      } catch(e) {}
      for(let n=1;n<=total;n++){
        const wrapper=document.createElement('div');
        wrapper.className='pdf-reader-page';
        wrapper.dataset.page=String(n);
        wrapper.style.minHeight=Math.round(hauteurEstimee + 32)+'px';
        const canvas=document.createElement('canvas');
        canvas.setAttribute('aria-label','Page '+n+' sur '+total);
        const label=document.createElement('span');
        label.className='pdf-reader-page-label';
        label.textContent=n+' / '+total;
        wrapper.appendChild(canvas);
        wrapper.appendChild(label);
        pages.appendChild(wrapper);
      }

      document.getElementById('pdfViewerPage').textContent='1 / '+total;
      document.getElementById('pdfViewerPrec').disabled=total<=1;
      document.getElementById('pdfViewerSuiv').disabled=total<=1;

      // Priorité absolue à la première page : le document devient lisible dès
      // que cette page est prête, sans attendre le rendu du reste.
      mettreAJourProgressionLecteurPDF(88,'Rendu de la première page',{speedText:'Préparation de l’affichage…'});
      await rendreUnePagePDF(1,true);
      document.getElementById('pdfViewerLoading').style.display='none';
      document.getElementById('pdfViewerErreurBox').style.display='none';
      // Les premières pages sont visibles : la barre pleine largeur laisse la
      // place à la sphère compacte pour ne plus gêner la lecture.
      activerModeCompactProgressionPDF();
      installerRenduProgressifPDF();
      installerSuiviPagesPDF();
      const pdfSessionToken = PDF_JETON_OUVERTURE;
      // Précharge une seule page à la fois : page 2 après la page 1, puis la
      // suivante si elle existe. Cela rend le comportement déterministe même
      // si IntersectionObserver est capricieux sur certains Android.
      (async()=>{
        for(let n=2;n<=Math.min(total,4);n++){
          if(PDF_JETON_OUVERTURE !== pdfSessionToken || !PDF_EN_COURS) break;
          try {
            await rendreUnePagePDF(n);
          } catch (error) {
            const message = String(error?.message || error || '');
            if (!/rendering\s+cancelled|RenderingCancelled/i.test(message)) {
              console.warn('[Lecteur PDF] pré-rendu interrompu :', error);
            }
          }
        }
      })().catch(()=>{});
      document.getElementById('pdfViewerStatut').textContent='';
      requestAnimationFrame(majBarreDefilementPDF);
    } catch(err){
      console.error('[Lecteur PDF] échec de rendu continu',err);
      afficherErreurLecteur('Erreur d’affichage du document.',DOC_EN_LECTURE?.Telechargement_autorise!==false,DOC_EN_LECTURE?.Fichier_url);
    }
  }

  function pagePDFVisibleCible(direction) {
    const pages=document.querySelectorAll('#pdfViewerPages .pdf-reader-page');
    if (!pages.length) return;
    let idx=Math.max(0, PDF_PAGE_ACTUELLE-1);
    idx=Math.max(0,Math.min(pages.length-1,idx+direction));
    pages[idx].scrollIntoView({behavior:'smooth',block:PDF_MODE_LECTURE==='horizontal'?'center':'start',inline:PDF_MODE_LECTURE==='horizontal'?'center':'nearest'});
    PDF_PAGE_ACTUELLE=idx+1;
    document.getElementById('pdfViewerPage').textContent=(idx+1)+' / '+pages.length;
  }

  let pdfPagesObserver=null;
  function installerSuiviPagesPDF(){
    if(pdfPagesObserver) pdfPagesObserver.disconnect();
    const zone=document.getElementById('pdfViewerZone');
    const pages=document.querySelectorAll('#pdfViewerPages .pdf-reader-page');
    if(!zone || !pages.length || !('IntersectionObserver' in window)) return;
    pdfPagesObserver=new IntersectionObserver(entries=>{
      let meilleure=null;
      for(const entry of entries){ if(entry.isIntersecting && (!meilleure || entry.intersectionRatio>meilleure.intersectionRatio)) meilleure=entry; }
      if(meilleure){
        const n=Number(meilleure.target.dataset.page)||1;
        PDF_PAGE_ACTUELLE=n;
        document.getElementById('pdfViewerPage').textContent=n+' / '+pages.length;
      }
    },{root:zone,threshold:[0.35,0.6,0.85]});
    pages.forEach(p=>pdfPagesObserver.observe(p));
  }

  function mettreAJourModeLecturePDF() {
    const zone = document.getElementById('pdfViewerZone');
    const bouton = document.getElementById('pdfViewerModeLecture');
    if (!zone) return;
    const horizontal = PDF_MODE_LECTURE === 'horizontal';
    zone.classList.toggle('pdf-lecture-horizontal', horizontal);
    zone.classList.toggle('pdf-lecture-vertical', !horizontal);
    if (bouton) {
      const label = document.getElementById('pdfViewerModeLectureLabel');
      if (label) label.textContent = horizontal ? 'Lecture horizontale' : 'Lecture verticale';
      bouton.setAttribute('aria-pressed', horizontal ? 'true' : 'false');
      bouton.title = horizontal ? 'Lecture horizontale' : 'Lecture verticale';
      bouton.setAttribute('aria-label', horizontal ? 'Passer en lecture verticale' : 'Passer en lecture horizontale');
    }
  }

  function changerModeLecturePDF() {
    const zone = document.getElementById('pdfViewerZone');
    if (!zone) return;
    const page = document.querySelector('#pdfViewerPages .pdf-reader-page[data-page="'+PDF_PAGE_ACTUELLE+'"]');
    PDF_MODE_LECTURE = PDF_MODE_LECTURE === 'vertical' ? 'horizontal' : 'vertical';
    mettreAJourModeLecturePDF();
    requestAnimationFrame(() => {
      if (page) page.scrollIntoView({behavior:'auto', block:'center', inline:'center'});
      document.getElementById('pdfViewerPages')?.focus?.({preventScroll:true});
      majBarreDefilementPDF();
    });
  }

  document.getElementById('pdfViewerModeLecture')?.addEventListener('click', changerModeLecturePDF);

  // ---------- MENU "3 POINTS" (regroupe zoom / ajuster / mode / récents / téléchargement / signalement) ----------
  // Un unique bouton en haut à gauche ouvre un panneau qui rassemble tous les
  // outils autrefois répartis sur une barre d'outils pleine largeur. Les
  // boutons eux-mêmes (id inchangés) gardent exactement leur comportement.
  function ouvrirMenuLecteurPDF() {
    const toggle = document.getElementById('pdfViewerMenuToggle');
    const panel = document.getElementById('pdfViewerMenuPanel');
    if (!toggle || !panel) return;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function fermerMenuLecteurPDF() {
    const toggle = document.getElementById('pdfViewerMenuToggle');
    const panel = document.getElementById('pdfViewerMenuPanel');
    if (!toggle || !panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
    // Referme aussi le sous-panneau "Documents récents" s'il était ouvert.
    const recentPanel = document.getElementById('pdfRecentPanel');
    const recentToggle = document.getElementById('pdfRecentToggle');
    if (recentPanel) { recentPanel.classList.remove('open'); recentPanel.setAttribute('aria-hidden','true'); }
    if (recentToggle) recentToggle.setAttribute('aria-expanded','false');
  }
  (function initialiserMenuLecteurPDF() {
    const toggle = document.getElementById('pdfViewerMenuToggle');
    const panel = document.getElementById('pdfViewerMenuPanel');
    if (!toggle || !panel) return;
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.contains('open') ? fermerMenuLecteurPDF() : ouvrirMenuLecteurPDF();
    });
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('open')) return;
      if (toggle.contains(e.target) || panel.contains(e.target)) return;
      fermerMenuLecteurPDF();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) fermerMenuLecteurPDF();
    });
  })();

  function allerPagePrecedente() { pagePDFVisibleCible(-1); }
  function allerPageSuivante()   { pagePDFVisibleCible(1); }
  document.getElementById('pdfViewerPrec').addEventListener('click', allerPagePrecedente);
  document.getElementById('pdfViewerSuiv').addEventListener('click', allerPageSuivante);

  // ---------- BARRE DE DÉFILEMENT PERSONNALISÉE ----------
  // #pdfViewerZone garde son défilement natif (overflow:auto) : cette barre
  // n'est qu'un indicateur/raccourci visuel synchronisé dessus, elle ne
  // remplace rien de l'existant et se masque simplement s'il n'y a rien à
  // faire défiler ou en mode lecture horizontale (pagination par page, pas
  // de long défilement vertical dans ce mode).
  function majBarreDefilementPDF() {
    const zone = document.getElementById('pdfViewerZone');
    const track = document.getElementById('pdfViewerScrollbar');
    const thumb = document.getElementById('pdfViewerScrollbarThumb');
    if (!zone || !track || !thumb) return;
    const scrollable = zone.scrollHeight - zone.clientHeight;
    if (PDF_MODE_LECTURE === 'horizontal' || scrollable <= 1) { track.style.display = 'none'; return; }
    track.style.display = '';
    const trackH = track.clientHeight;
    const ratioVisible = Math.min(1, zone.clientHeight / zone.scrollHeight);
    const thumbH = Math.max(28, trackH * ratioVisible);
    const maxThumbTop = Math.max(0, trackH - thumbH);
    const progression = scrollable > 0 ? (zone.scrollTop / scrollable) : 0;
    thumb.style.height = thumbH + 'px';
    thumb.style.top = (progression * maxThumbTop) + 'px';
  }
  (function initialiserBarreDefilementPDF() {
    const zone = document.getElementById('pdfViewerZone');
    const track = document.getElementById('pdfViewerScrollbar');
    const thumb = document.getElementById('pdfViewerScrollbarThumb');
    if (!zone || !track || !thumb) return;
    zone.addEventListener('scroll', majBarreDefilementPDF, { passive: true });
    window.addEventListener('resize', majBarreDefilementPDF);
    let glissementActif = false, yDepart = 0, scrollDepart = 0;
    thumb.addEventListener('pointerdown', (e) => {
      glissementActif = true; yDepart = e.clientY; scrollDepart = zone.scrollTop;
      try { thumb.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!glissementActif) return;
      const trackH = track.clientHeight, thumbH = thumb.clientHeight;
      const scrollable = zone.scrollHeight - zone.clientHeight;
      const deplacement = trackH - thumbH;
      if (deplacement <= 0) return;
      const deltaScroll = ((e.clientY - yDepart) / deplacement) * scrollable;
      zone.scrollTop = Math.max(0, Math.min(scrollable, scrollDepart + deltaScroll));
    });
    const arreterGlissement = (e) => { glissementActif = false; try { thumb.releasePointerCapture(e.pointerId); } catch (err) {} };
    thumb.addEventListener('pointerup', arreterGlissement);
    thumb.addEventListener('pointercancel', arreterGlissement);
    track.addEventListener('click', (e) => {
      if (e.target === thumb) return;
      const rect = track.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      const scrollable = zone.scrollHeight - zone.clientHeight;
      zone.scrollTop = Math.max(0, Math.min(scrollable, ratio * scrollable));
    });
  })();

  // ---------- RECHERCHE / SAUT DE PAGE ----------
  function allerPageNumero(n) {
    const pages = document.querySelectorAll('#pdfViewerPages .pdf-reader-page');
    if (!PDF_EN_COURS || !pages.length) return;
    const total = Math.min(pages.length, Number(PDF_EN_COURS.numPages) || pages.length);
    const cible = Math.max(1, Math.min(total, Math.round(Number(n)) || 1));
    const pageCible = pages[cible - 1];
    if (!pageCible) return;
    pageCible.scrollIntoView({ behavior: 'smooth', block: PDF_MODE_LECTURE === 'horizontal' ? 'center' : 'start', inline: PDF_MODE_LECTURE === 'horizontal' ? 'center' : 'nearest' });
    PDF_PAGE_ACTUELLE = cible;
    const indicateur = document.getElementById('pdfViewerPage');
    if (indicateur) indicateur.textContent = cible + ' / ' + total;
  }
  (function initialiserRecherchePagePDF() {
    const toggle = document.getElementById('pdfViewerPageJumpToggle');
    const panel = document.getElementById('pdfViewerPageJumpPanel');
    const input = document.getElementById('pdfViewerPageJumpInput');
    const go = document.getElementById('pdfViewerPageJumpGo');
    if (!toggle || !panel || !input || !go) return;
    function fermer() { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); toggle.setAttribute('aria-expanded', 'false'); }
    function ouvrir() {
      if (!PDF_EN_COURS) return;
      input.max = String(PDF_EN_COURS.numPages);
      input.value = String(PDF_PAGE_ACTUELLE);
      panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); toggle.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => input.focus());
    }
    toggle.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.contains('open') ? fermer() : ouvrir(); });
    function valider() {
      if (!PDF_EN_COURS || !input.value) return;
      allerPageNumero(input.value);
      fermer();
    }
    go.addEventListener('click', valider);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valider(); } });
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('open')) return;
      if (toggle.contains(e.target) || panel.contains(e.target)) return;
      fermer();
    });
  })();
  // Dissuasion raisonnable : pas de menu contextuel (clic droit) sur la zone de
  // lecture. Cela n'empêche pas une capture d'écran ou l'inspection réseau,
  // mais retire les raccourcis évidents ("Enregistrer l'image sous…").
  document.getElementById('pdfViewerZone').addEventListener('contextmenu', (e) => e.preventDefault());

  // -- Défilement tactile : vertical uniquement. Aucun changement de page horizontal.
  // Le lecteur reste volontairement en pan-y pour un confort proche d'un livre numérique.

  // -- Zoom / ajustement / rotation --
  // Le zoom est appliqué au rendu de CHAQUE page : le document entier reste
  // cohérent, au lieu d'étirer uniquement un texte ou une page isolée.
  let pdfRenduZoomEnCours = false;
  let pdfZoomDemandeEnAttente = null;

  function memoriserAncragePDF() {
    const zone=document.getElementById('pdfViewerZone');
    const page=document.querySelector('#pdfViewerPages .pdf-reader-page[data-page="'+PDF_PAGE_ACTUELLE+'"]');
    if(!zone || !page) return null;
    const zr=zone.getBoundingClientRect();
    const pr=page.getBoundingClientRect();
    return {
      page:PDF_PAGE_ACTUELLE,
      ratio:Math.max(0,Math.min(1,(zr.top+zr.height*0.35-pr.top)/Math.max(1,pr.height)))
    };
  }

  async function appliquerZoom(delta, valeurAbsolue=false, ancrage=null) {
    const cible=valeurAbsolue ? delta : (PDF_ZOOM + delta);
    const prochain=Math.max(PDF_ZOOM_MIN,Math.min(PDF_ZOOM_MAX,+Number(cible).toFixed(2)));
    const pages=document.getElementById('pdfViewerPages');
    const zone=document.getElementById('pdfViewerZone');
    if(prochain===PDF_ZOOM) {
      if(pages) pages.style.zoom='1';
      const niveauActuel=document.getElementById('pdfViewerZoomLevel');
      if(niveauActuel) niveauActuel.textContent=Math.round(PDF_ZOOM*100)+'%';
      return;
    }
    const ancien=PDF_ZOOM;
    PDF_ZOOM=prochain;
    const niveau=document.getElementById('pdfViewerZoomLevel');
    if(niveau) niveau.textContent=Math.round(PDF_ZOOM*100)+'%';
    if(!pages || !zone) return;

    // Le zoom du lecteur est maintenant un zoom de mise en page, pas une
    // transformation CSS flottante. Cela évite le décalage du document sous
    // les doigts sur Android : la zone de défilement connaît réellement la
    // nouvelle taille du document. On conserve en plus la position relative
    // de lecture pour que la page courante reste sous les yeux.
    // Le point d'ancrage reste fixe à l'écran : le zoom se fait directement
    // autour de la zone regardée, sans déplacement parasite.
    const pointX=ancrage && Number.isFinite(ancrage.x) ? Math.max(0,Math.min(zone.clientWidth,ancrage.x)) : zone.clientWidth/2;
    const pointY=ancrage && Number.isFinite(ancrage.y) ? Math.max(0,Math.min(zone.clientHeight,ancrage.y)) : Math.min(zone.clientHeight*0.38,Math.max(40,zone.clientHeight/2));
    const ancienX=zone.scrollLeft+pointX;
    const ancienY=zone.scrollTop+pointY;
    const ratio=prochain/Math.max(0.01,ancien);

    pages.style.transform='none';
    pages.style.transformOrigin='top center';
    pages.style.width='100%';
    // PDF_ZOOM est déjà intégré à l'échelle PDF.js : aucun zoom CSS permanent.
    pages.style.zoom='1';
    pages.style.marginBottom='0';

    requestAnimationFrame(async()=>{
      zone.scrollLeft=Math.max(0,ancienX*ratio-pointX);
      zone.scrollTop=Math.max(0,ancienY*ratio-pointY);

      // Les pages visibles sont rerendues à la résolution correspondant au
      // nouveau zoom, sans attendre tout le document.
      const visibles=[...document.querySelectorAll('#pdfViewerPages .pdf-reader-page')].filter(el=>{
        const r=el.getBoundingClientRect(), z=zone.getBoundingClientRect();
        return r.bottom>z.top-700 && r.top<z.bottom+700;
      });
      for(const el of visibles){
        const n=Number(el.dataset.page)||1;
        pdfPagesRendues.delete(n);
        await rendreUnePagePDF(n,true);
      }
      installerRenduProgressifPDF();
    });
  }

  // Un appui bref = un seul pas de 1 %. Un appui prolongé (≈350 ms)
  // lance ensuite une progression continue, toujours de 1 % en 1 %.
  function installerAppuiProlongeZoom(id, delta) {
    const bouton=document.getElementById(id);
    if(!bouton) return;
    let depart=null;
    let intervalle=null;
    let appuiLong=false;
    let ignorerClic=false;

    const arreter=()=>{
      if(depart){clearTimeout(depart);depart=null;}
      if(intervalle){clearInterval(intervalle);intervalle=null;}
      if(appuiLong) ignorerClic=true;
      appuiLong=false;
    };

    bouton.addEventListener('click',(e)=>{
      if(ignorerClic){
        ignorerClic=false;
        e.preventDefault();
        return;
      }
      appliquerZoom(delta);
    });

    bouton.addEventListener('pointerdown',()=>{
      if(depart) clearTimeout(depart);
      if(intervalle) clearInterval(intervalle);
      appuiLong=false;
      depart=setTimeout(()=>{
        depart=null;
        appuiLong=true;
        intervalle=setInterval(()=>appliquerZoom(delta),90);
      },350);
    });

    ['pointerup','pointercancel','pointerleave'].forEach(type=>{
      bouton.addEventListener(type,arreter);
    });
    bouton.addEventListener('blur',arreter);
  }
  installerAppuiProlongeZoom('pdfViewerZoomIn', PDF_ZOOM_PAS);
  installerAppuiProlongeZoom('pdfViewerZoomOut', -PDF_ZOOM_PAS);

  document.getElementById('pdfViewerAjuster').addEventListener('click', () => appliquerZoom(1,true));

  // Pinçage à deux doigts : zoom progressif par petits pas de 1 %.
  // Pendant le geste, seule la mise à l'échelle de la zone est ajustée : le
  // rendu PDF lourd n'est effectué qu'à la fin du geste, ce qui évite les
  // à-coups visibles tout en gardant une progression naturelle 100, 101, 102…
  let pdfPinchActif=false, pdfPinchDistanceInitiale=0, pdfPinchZoomInitial=1;
  let pdfPinchLastX=0, pdfPinchLastY=0;
  let pdfPinchZoomAffiche=1, pdfPinchRaf=0;
  const pdfZoneGeste=document.getElementById('pdfViewerZone');
  if(pdfZoneGeste){
    pdfZoneGeste.addEventListener('touchstart',(e)=>{
      if(e.touches.length!==2) return;
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const distance=Math.hypot(dx,dy);
      if(distance<10) return;
      pdfPinchLastX=((e.touches[0].clientX+e.touches[1].clientX)/2)-pdfZoneGeste.getBoundingClientRect().left;
      pdfPinchLastY=((e.touches[0].clientY+e.touches[1].clientY)/2)-pdfZoneGeste.getBoundingClientRect().top;
      pdfPinchActif=true;
      pdfPinchDistanceInitiale=distance;
      pdfPinchZoomInitial=PDF_ZOOM;
      pdfPinchZoomAffiche=PDF_ZOOM;
    },{passive:true});

    pdfZoneGeste.addEventListener('touchmove',(e)=>{
      if(!pdfPinchActif || e.touches.length!==2) return;
      e.preventDefault();
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const distance=Math.hypot(dx,dy);
      if(distance<10) return;
      const ratio=distance/Math.max(1,pdfPinchDistanceInitiale);
      const cible=Math.max(PDF_ZOOM_MIN,Math.min(PDF_ZOOM_MAX,pdfPinchZoomInitial*ratio));
      // 1 % par étape : 1.00 → 1.01 → 1.02…
      const ciblePas=Math.round(cible*100)/100;
      if(ciblePas===pdfPinchZoomAffiche) return;
      pdfPinchZoomAffiche=ciblePas;
      if(pdfPinchRaf) return;
      pdfPinchRaf=requestAnimationFrame(()=>{
        pdfPinchRaf=0;
        const pages=document.getElementById('pdfViewerPages');
        if(pages) {
          // Aperçu temporaire relatif au zoom réellement rendu.
          pages.style.zoom=String(pdfPinchZoomAffiche / Math.max(0.01,pdfPinchZoomInitial));
        }
        const niveau=document.getElementById('pdfViewerZoomLevel');
        if(niveau) niveau.textContent=Math.round(pdfPinchZoomAffiche*100)+'%';
      });
    },{passive:false});

    const terminerPinch=()=>{
      if(!pdfPinchActif) return;
      pdfPinchActif=false;
      if(pdfPinchRaf){cancelAnimationFrame(pdfPinchRaf);pdfPinchRaf=0;}
      const cible=Math.max(PDF_ZOOM_MIN,Math.min(PDF_ZOOM_MAX,pdfPinchZoomAffiche));
      // Le rendu définitif est fait une seule fois, après le geste, pour éviter
      // les saccades liées au rerendu des pages à chaque mouvement du doigt.
      appliquerZoom(cible,true,{x:pdfPinchLastX,y:pdfPinchLastY});
    };
    pdfZoneGeste.addEventListener('touchend',terminerPinch,{passive:true});
    pdfZoneGeste.addEventListener('touchcancel',terminerPinch,{passive:true});

    // Lecture immersive : un appui simple sur le document masque les barres
    // du haut et du bas pour ne laisser que le PDF, plein écran. Un second
    // appui les fait réapparaître. On ignore les clics sur un élément
    // interactif (bouton, lien…) et pendant un pincement à deux doigts.
    pdfZoneGeste.addEventListener('click',(e)=>{
      if(pdfPinchActif)return;
      if(e.target.closest('button,a,input,select,textarea'))return;
      document.getElementById('pdfViewerOverlay')?.classList.toggle('pdf-immersive');
    });
  }
  // -- Navigation clavier (bonnes pratiques ; pas un audit RGAA/WCAG complet) --
  document.getElementById('pdfViewerOverlay').addEventListener('keydown', (e) => {
    if (document.getElementById('pdfViewerOverlay').style.display === 'none') return;
    if (e.key === 'Escape') { e.preventDefault(); demanderFermetureLecteur(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); allerPagePrecedente(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); allerPageSuivante(); }
  });

  // Ferme le lecteur en respectant l'historique : si l'entrée d'historique
  // actuelle est bien celle poussée par ouvrirLecteurPDF (lecteurPDF:true), un
  // simple "retour" la dépile proprement (déclenche le popstate ci-dessous, qui
  // referme réellement l'overlay et restaure le défilement de l'écran précédent).
  // Sinon (overlay fermé par un autre chemin), on masque directement sans toucher
  // à l'historique pour ne pas désynchroniser la pile de navigation.
  function demanderFermetureLecteur() {
    if (history.state && history.state.lecteurPDF) { history.back(); }
    else { fermerLecteurPDF(); }
  }

  function fermerLecteurPDF() {
    PDF_JETON_OUVERTURE++; // invalide tout chargement PDF.js encore en cours
    if (PDF_FETCH_CONTROLLER) { try { PDF_FETCH_CONTROLLER.abort(); } catch(e) {} PDF_FETCH_CONTROLLER=null; }
    // Stopper les observers avant de vider PDF_EN_COURS : un callback déjà
    // programmé ne doit plus tenter de lire .numPages sur null.
    if (pdfRenduObserver) { try { pdfRenduObserver.disconnect(); } catch(e) {} pdfRenduObserver = null; }
    if (pdfPagesObserver) { try { pdfPagesObserver.disconnect(); } catch(e) {} pdfPagesObserver = null; }
    document.getElementById('pdfViewerOverlay').style.display = 'none';
    fermerMenuLecteurPDF();
    // Le zoom choisi par l'utilisateur est restauré exactement comme avant
    // l'ouverture du lecteur.
    restaurerZoomGlobalApresLecteurPDF();
    const progressDock=document.getElementById('pdfViewerLoadProgressDock');
    if(progressDock){ progressDock.classList.remove('is-visible'); progressDock.setAttribute('aria-hidden','true'); }
    masquerSpherePDF();
    const canvas = document.getElementById('pdfViewerCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (PDF_EN_COURS && PDF_EN_COURS.destroy) { try { PDF_EN_COURS.destroy(); } catch(e){} }
    PDF_EN_COURS = null;
    PDF_OCTETS_COURANTS = null;
    DOC_EN_LECTURE = null;
  }
  document.getElementById('pdfViewerFermer').addEventListener('click', demanderFermetureLecteur);
  document.getElementById('pdfViewerSignaler').addEventListener('click', () => {
    fermerMenuLecteurPDF();
    if (DOC_EN_LECTURE) ouvrirSignalement(DOC_EN_LECTURE);
  });

  // ---------- SIGNALEMENT / RÉCLAMATIONS (droits d'auteur) ----------
  // Nécessite la table "Signalements" déjà créée précédemment (voir SQL fourni
  // dans une livraison antérieure). Si elle est absente, l'envoi échoue
  // proprement avec un message clair au lieu de casser le reste du site.
  let DOC_A_SIGNALER = null;
  function ouvrirSignalement(doc) {
    DOC_A_SIGNALER = doc;
    document.getElementById('signalerMsg').textContent = '';
    document.getElementById('signalerForm').reset();
    document.getElementById('signalerOverlay').style.display = 'flex';
  }
  function fermerSignalement() {
    document.getElementById('signalerOverlay').style.display = 'none';
    DOC_A_SIGNALER = null;
  }
  document.getElementById('signalerAnnuler').addEventListener('click', fermerSignalement);
  document.getElementById('signalerOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'signalerOverlay') fermerSignalement();
  });
  document.getElementById('signalerForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const msg = document.getElementById('signalerMsg');
    if (!DOC_A_SIGNALER) return;
    const payload = {
      document_id: DOC_A_SIGNALER.id,
      document_titre: DOC_A_SIGNALER.Titre || null,
      nom: document.getElementById('signalerNom').value.trim(),
      email: document.getElementById('signalerEmail').value.trim(),
      motif: document.getElementById('signalerMotif').value,
      details: document.getElementById('signalerDetails').value.trim() || null,
      statut: 'nouveau'
    };
    msg.textContent = 'Envoi en cours…'; msg.className = 'form-msg';
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Signalements`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const detail = await res.text().catch(()=> '');
        throw new Error(detail || ('HTTP ' + res.status));
      }
      msg.textContent = 'Signalement envoyé. Merci, un administrateur va l\'examiner rapidement.';
      msg.className = 'form-msg ok';
      setTimeout(fermerSignalement, 1800);
    } catch (err) {
      msg.textContent = "L’envoi du signalement a échoué. Veuillez réessayer dans quelques instants.";
      msg.className = 'form-msg err';
    }
  });

  // ---------- RECHERCHE (titre, matière, niveau, filière, catégorie, auteur) ----------
  async function lancerRecherche(q) {
    const requete = (q || '').trim();
    if (!requete) return;
    document.getElementById('breadcrumb').innerHTML = '';
    document.getElementById('docsTitle').textContent = `Résultats pour « ${requete} »`;
    document.querySelector('#screen-docs .back-btn').setAttribute('data-back', 'home');
    afficherEcran('screen-docs');
    const content = document.getElementById('docsContent');
    content.innerHTML = '<p style="color:var(--gris); font-size:0.9rem;">Recherche en cours…</p>';

    const terme = requete.replace(/[,()]/g, ' ').trim();
    const termeEnc = encodeURIComponent(terme);
    const champs = ['Titre', 'Matière', 'Niveau', 'Filiere', 'Catégorie', 'Auteur'];
    const or = champs.map(c => `${encodeURIComponent(c)}.ilike.*${termeEnc}*`).join(',');
    const url = `${SUPABASE_URL}/rest/v1/Document?select=*&or=(${or})&Publie=eq.true&order=id.desc`;

    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) { const detail = await res.text().catch(()=> ''); throw new Error(`HTTP ${res.status} — ${detail}`); }
      const data = await res.json();
      // Les résultats de recherche utilisent eux aussi la couverture / première
      // page du PDF, comme toutes les autres listes de documents du site.
      rendreListeDocuments(content, data, true);
    } catch (err) {
      content.innerHTML = `<div class="doc-empty"><div class="icon-wrap">${ICONS.warning}</div><h3>Recherche indisponible</h3><p>La recherche n’a pas pu aboutir pour le moment. Veuillez réessayer dans quelques instants.</p></div>`;
    }
  }

  document.getElementById('headerSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lancerRecherche(e.target.value);
  });
