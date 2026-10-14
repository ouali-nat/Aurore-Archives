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

  /* Télécharge le PDF et l'écrit dans le stockage du téléphone (dossier Aurore/). */
  async function saveOnDevice(P, url, filename){
    const res = await fetch(url, { credentials: 'omit' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await blobToBase64(await res.blob());
    const safeName = filename.replace(/[\\\/:*?"<>|]+/g, '_');
    const written = await P.Filesystem.writeFile({
      path: 'Aurore/' + safeName,
      data: data,
      directory: 'DOCUMENTS',
      recursive: true
    });
    if(P.Share && typeof P.Share.share === 'function'){
      try{
        await P.Share.share({
          title: safeName,
          dialogTitle: 'Enregistrer ou partager le PDF',
          files: [written.uri]
        });
      }catch(e){ /* annulation du partage : le fichier reste enregistré */ }
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
