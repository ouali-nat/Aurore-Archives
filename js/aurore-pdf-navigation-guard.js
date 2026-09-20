
(function(){
  function isPdfHref(href){ return /\.pdf(?:[?#]|$)/i.test(String(href||'')); }

  document.addEventListener('click',function(e){
    const a=e.target.closest && e.target.closest('a[href]');
    if(!a) return;
    const href=a.getAttribute('href')||'';
    if(!/\.pdf(?:[?#]|$)/i.test(href)) return;
    // Les documents publics doivent rester dans le lecteur intégré.
    e.preventDefault();
    try{
      const fake={id:null,Titre:(a.textContent||'Document PDF').replace(/→/g,'').trim(),Fichier_url:a.href,Telechargement_autorise:true};
      if(typeof window.ouvrirLecteurPDF==='function') window.ouvrirLecteurPDF(fake);
    }catch(err){ console.warn('[Aurore] ouverture PDF interne impossible',err); }
  },true);

  // Filet de sécurité ultime : quel que soit l'endroit du code (présent ou
  // ajouté plus tard) qui appellerait window.open sur un PDF, on intercepte
  // et on route vers le lecteur intégré au lieu de laisser un nouvel onglet
  // (ou une application externe, sur mobile) s'ouvrir.
  const ouvertureOriginale = window.open.bind(window);
  window.open = function(url, ...reste){
    if (isPdfHref(url)) {
      try{
        const fake={id:null,Titre:'Document PDF',Fichier_url:new URL(String(url),location.href).href,Telechargement_autorise:true};
        if(typeof window.ouvrirLecteurPDF==='function'){ window.ouvrirLecteurPDF(fake); return null; }
      }catch(err){ console.warn('[Aurore] interception window.open impossible',err); }
    }
    return ouvertureOriginale(url, ...reste);
  };
})();
