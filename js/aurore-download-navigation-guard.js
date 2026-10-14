(function(){
  function isPdfUrl(url){
    try { return /\.pdf(?:[?#]|$)/i.test(new URL(url, location.href).href); }
    catch(e){ return /\.pdf(?:[?#]|$)/i.test(String(url||'')); }
  }

  function markDownload(url, title){
    try{
      if(typeof window.enregistrerTelechargementPersonnel === 'function'){
        const id = (document.body && document.body.dataset && document.body.dataset.documentId) || null;
        window.enregistrerTelechargementPersonnel({
          id: id,
          Titre: title || 'Document PDF',
          Fichier_url: url
        });
      }
    }catch(e){}
  }

  /* Plugins Capacitor disponibles uniquement dans l'application Android. */
  function nativePlugins(){
    const C = window.Capacitor;
    if(!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return null;
    const P = C.Plugins || {};
    return P.Filesystem ? P : null;
  }

  function blobToBase64(blob){
    return new Promise(function(resolve, reject){
      const r = new FileReader();
      r.onload = function(){ resolve(String(r.result).split(',')[1]); };
      r.onerror = function(){ reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function toast(text){
    try{
      const t = document.createElement('div');
      t.textContent = text;
      t.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:2147483000;' +
        'background:rgba(30,27,45,.96);color:#fff;padding:11px 18px;border-radius:14px;font:600 .8rem system-ui,sans-serif;' +
        'box-shadow:0 8px 30px rgba(0,0,0,.35);max-width:86vw;text-align:center';
      document.body.appendChild(t);
      setTimeout(function(){ t.remove(); }, 3200);
    }catch(e){}
  }

  /* Télécharge le PDF et l'écrit sur le téléphone.
     1) dossier Documents/Aurore ; 2) à défaut (Android récent), cache de l'app.
     Puis ouvre le menu de partage pour l'enregistrer où l'utilisateur veut. */
  async function saveOnDevice(P, url, filename){
    toast('Téléchargement du PDF…');
    const res = await fetch(url, { credentials: 'omit' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await blobToBase64(await res.blob());
    const safeName = filename.replace(/[\\\/:*?"<>|]+/g, '_');

    let written, where = 'Documents/Aurore';
    try{
      written = await P.Filesystem.writeFile({
        path: 'Aurore/' + safeName, data: data, directory: 'DOCUMENTS', recursive: true
      });
    }catch(e){
      where = 'cache';
      written = await P.Filesystem.writeFile({
        path: safeName, data: data, directory: 'CACHE', recursive: true
      });
    }

    toast(where === 'cache' ? 'PDF prêt : choisissez où l’enregistrer' : 'PDF enregistré dans Documents/Aurore');

    if(P.Share && typeof P.Share.share === 'function'){
      try{
        await P.Share.share({
          title: safeName,
          dialogTitle: 'Enregistrer ou partager le PDF',
          files: [written.uri]
        });
      }catch(e){ /* annulation du partage : le fichier reste disponible */ }
    }
    return written;
  }

  document.addEventListener('click', function(e){
    const a=e.target.closest && e.target.closest('a[href]');
    if(!a)return;
    const href=a.getAttribute('href');
    if(!href || !isPdfUrl(href))return;

    /* Un clic de téléchargement PDF ne doit jamais remplacer la page Aurore. */
    if(a.hasAttribute('download')){
      e.preventDefault();
      e.stopPropagation();

      const url=new URL(href, location.href).href;
      const filename=(a.getAttribute('download')||'').trim() ||
        decodeURIComponent(url.split('/').pop().split('?')[0]) || 'document.pdf';
      const title = a.textContent.trim();

      const P = nativePlugins();
      if(P){
        saveOnDevice(P, url, filename)
          .then(function(){ markDownload(url, title); })
          .catch(function(err){
            console.warn('Enregistrement natif impossible, ouverture dans le navigateur :', err);
            toast('Ouverture du PDF dans le navigateur…');
            const B = window.Capacitor.Plugins.Browser;
            if(B && typeof B.open === 'function'){ B.open({ url: url }); }
            markDownload(url, title);
          });
        return;
      }

      const blobLink=document.createElement('a');
      blobLink.href=url;
      blobLink.download=filename;
      blobLink.rel='noopener';
      blobLink.style.display='none';
      document.body.appendChild(blobLink);
      blobLink.click();
      blobLink.remove();

      markDownload(url, title);
      return;
    }
  }, true);

  /* Empêche les navigations déclenchées par des formulaires vers un PDF. */
  document.addEventListener('submit', function(e){
    const form=e.target;
    if(!form || !form.action || !isPdfUrl(form.action))return;
    e.preventDefault();
  }, true);
})();
