
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

      const blobLink=document.createElement('a');
      blobLink.href=url;
      blobLink.download=filename;
      blobLink.rel='noopener';
      blobLink.style.display='none';
      document.body.appendChild(blobLink);
      blobLink.click();
      blobLink.remove();

      markDownload(url, a.textContent.trim());
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
