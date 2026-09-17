/* Contrôle de zoom global du site (indépendant du zoom interne du lecteur
   PDF, qui garde son propre système sur #pdfViewerPages via PDF_ZOOM). Le
   choix de l'utilisateur est mémorisé dans localStorage et appliqué via la
   propriété CSS "zoom" sur <html> : c'est déjà le mécanisme utilisé ailleurs
   sur ce site (voir appliquerZoom() dans aurore-pdf-reader.js), donc un
   comportement cohérent, sans casser les éléments en position fixed. */
(function(){
  const CLE_STOCKAGE='aurore_site_zoom_v1';
  const MIN=40, MAX=160, PAS=1, DEFAUT=100;

  function lireZoomSauvegarde(){
    try{
      const v=parseInt(localStorage.getItem(CLE_STOCKAGE),10);
      if(Number.isFinite(v) && v>=MIN && v<=MAX) return v;
    }catch(e){}
    return DEFAUT;
  }
  function ecrireZoomSauvegarde(v){
    try{ localStorage.setItem(CLE_STOCKAGE,String(v)); }catch(e){}
  }

  let zoomActuel=lireZoomSauvegarde();
  // Applique tout de suite le zoom sauvegardé, sans attendre la construction
  // du bouton, pour éviter un flash à 100 % au chargement de la page.
  document.documentElement.style.zoom=(zoomActuel/100);

  function appliquerZoomSite(v){
    zoomActuel=Math.max(MIN,Math.min(MAX,v));
    document.documentElement.style.zoom=(zoomActuel/100);
    ecrireZoomSauvegarde(zoomActuel);
    const niveau=document.getElementById('aurore-zoom-level');
    const curseur=document.getElementById('aurore-zoom-range');
    if(niveau) niveau.textContent=zoomActuel+'%';
    if(curseur) curseur.value=String(zoomActuel);
  }

  function afficherRappelZoom(){
    const CLE_RAPPEL="aurore_zoom_rappel_v1";
    try{ if(localStorage.getItem(CLE_RAPPEL)==="vu") return; localStorage.setItem(CLE_RAPPEL,"vu"); }catch(e){}
    const rappel=document.createElement("div");
    rappel.id="aurore-zoom-hint";
    rappel.className="aurore-zoom-hint";
    rappel.innerHTML="<strong>Affichage trop grand ?</strong><span>Réduisez le zoom avec − pour mieux adapter Aurore à votre écran.</span>";
    document.body.appendChild(rappel);
    setTimeout(function(){ rappel.classList.add("is-hidden"); setTimeout(function(){ rappel.remove(); },400); },7000);
  }

  function construireControleZoom(){
    if(document.getElementById('aurore-zoom-fab')) return;

    const fab=document.createElement('button');
    fab.type='button';
    fab.id='aurore-zoom-fab';
    fab.className='aurore-zoom-fab';
    fab.setAttribute('aria-label','Régler le zoom du site');
    fab.setAttribute('aria-expanded','false');
    fab.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>';

    const panel=document.createElement('div');
    panel.id='aurore-zoom-panel';
    panel.className='aurore-zoom-panel';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label','Réglage du zoom');
    panel.innerHTML=
      '<p class="azp-title">Zoom du site</p>'+
      '<div class="azp-row">'+
        '<button type="button" class="azp-btn" id="aurore-zoom-out" aria-label="Rétrécir">−</button>'+
        '<span class="azp-level" id="aurore-zoom-level" aria-live="polite">'+zoomActuel+'%</span>'+
        '<button type="button" class="azp-btn" id="aurore-zoom-in" aria-label="Agrandir">+</button>'+
      '</div>'+
      '<input type="range" id="aurore-zoom-range" min="'+MIN+'" max="'+MAX+'" step="'+PAS+'" value="'+zoomActuel+'" aria-label="Niveau de zoom">'+
      '<button type="button" class="azp-reset" id="aurore-zoom-reset">Réinitialiser (100%)</button>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);
    afficherRappelZoom();

    function ouvrirPanneau(){ panel.classList.add('is-open'); fab.setAttribute('aria-expanded','true'); }
    function fermerPanneau(){ panel.classList.remove('is-open'); fab.setAttribute('aria-expanded','false'); }

    fab.addEventListener('click',function(e){
      e.stopPropagation();
      panel.classList.contains('is-open') ? fermerPanneau() : ouvrirPanneau();
    });
    document.addEventListener('click',function(e){
      if(!panel.classList.contains('is-open')) return;
      if(panel.contains(e.target) || fab.contains(e.target)) return;
      fermerPanneau();
    });
    document.getElementById('aurore-zoom-out').addEventListener('click',function(){appliquerZoomSite(zoomActuel-PAS);});
    document.getElementById('aurore-zoom-in').addEventListener('click',function(){appliquerZoomSite(zoomActuel+PAS);});
    document.getElementById('aurore-zoom-reset').addEventListener('click',function(){appliquerZoomSite(DEFAUT);});
    document.getElementById('aurore-zoom-range').addEventListener('input',function(e){appliquerZoomSite(parseInt(e.target.value,10)||DEFAUT);});
    document.addEventListener('keydown',function(e){ if(e.key==='Escape') fermerPanneau(); });
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',construireControleZoom);
  } else {
    construireControleZoom();
  }
})();
