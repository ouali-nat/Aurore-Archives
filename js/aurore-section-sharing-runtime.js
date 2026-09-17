(function(){
  'use strict';

  let token='';
  try { token=new URLSearchParams(location.search).get('sectionShare')||''; } catch(_) {}
  if(!token) return;

  window.__auroreSharedSectionRoute=true;
  document.documentElement.classList.add('aurore-shared-route');
  // Le partage de section est un parcours public : aucune authentification
  // ne doit pouvoir afficher l'écran d'inscription par-dessus cette route.
  try { localStorage.setItem('aurore_visitor_mode','1'); } catch (_) {}
  try { document.body?.classList.remove('site-locked'); } catch (_) {}
  try { window.auroreUnlockAccess?.(); } catch (_) {}

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function root(){return document.getElementById('sharedSectionContent');}

  function goHome(){
    const clean=location.pathname+location.hash;
    try{history.replaceState(null,'',clean);}catch(_){location.href=clean;return;}
    window.__auroreSharedSectionRoute=false;
    document.documentElement.classList.remove('aurore-shared-route');
    document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
    document.getElementById('screen-home')?.classList.add('active');
    try{if(typeof rendreAccueil==='function')rendreAccueil();}catch(_){}
  }

  function assprToast(message){
    let t=document.getElementById('assprToast');
    if(!t){
      t=document.createElement('div');
      t.id='assprToast';
      t.className='assp-toast';
      document.body.appendChild(t);
    }
    t.textContent=message;
    t.classList.remove('show');
    // force reflow pour rejouer l'animation si un second clic arrive vite
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(t.__assprTimer);
    t.__assprTimer=setTimeout(()=>t.classList.remove('show'),2600);
  }

  function formatDateExpiration(iso){
    try{
      const d=new Date(iso);
      if(Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
    }catch(_){ return ''; }
  }
  function formatExpiryCountdown(iso){
    try{
      const d=new Date(iso);
      if(Number.isNaN(d.getTime())) return '';
      const diffMs=d.getTime()-Date.now();
      const dateLabel=formatDateExpiration(iso);
      if(diffMs<=0) return `${dateLabel} (lien expiré)`;
      const days=Math.floor(diffMs/86400000);
      const hours=Math.floor((diffMs%86400000)/3600000);
      const remain=days>0?`${days} j`:`${hours} h`;
      return `${dateLabel} · dans ${remain}`;
    }catch(_){ return ''; }
  }

  function showShell(){
    document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
    document.getElementById('screen-shared-section')?.classList.add('active');
    const r=root();
    if(r) r.innerHTML='<div class="aurore-shared-loading"><span class="aurore-shared-spinner"></span><strong>Ouverture de la section…</strong><small>Nous préparons les documents partagés.</small></div>';
  }

  function showError(kind){
    const r=root(); if(!r)return;
    const isNetwork = kind==='network';
    const title = isNetwork ? 'Impossible de charger cette section' : 'Ce lien de partage n\u2019est plus disponible';
    const message = isNetwork
      ? 'Impossible de charger cette section pour le moment. Vérifiez votre connexion puis réessayez.'
      : 'Ce lien de partage n\u2019est plus disponible. Il a peut-être été révoqué ou a expiré.';
    r.innerHTML=`<div class="aurore-shared-error-page"><div class="aurore-shared-error-mark">!</div><span class="kicker">SECTION PARTAGÉE</span><h1>${esc(title)}</h1><p>${esc(message)}</p><div class="assp-error-actions">${isNetwork?'<button type="button" class="shared-section-home-btn assp-retry-btn" id="sharedSectionRetryBtn">Réessayer</button>':''}<button type="button" class="shared-section-home-btn" id="sharedSectionHomeBtn">← Retour à l’accueil</button></div></div>`;
    document.getElementById('sharedSectionRetryBtn')?.addEventListener('click',()=>{ boot(); });
    document.getElementById('sharedSectionHomeBtn')?.addEventListener('click',goHome);
  }

  function handleShareClick(shareUrl,sectionName){
    return async function(){
      const title='Section partagée · '+(sectionName||'Aurore');
      if(navigator.share){
        try{
          await navigator.share({title,text:'Une sélection de documents organisée dans Aurore.',url:shareUrl});
          return;
        }catch(e){
          // Annulation ou échec du partage natif : on retombe sur la copie du lien,
          // sauf si l'utilisateur a lui-même annulé la boîte de dialogue.
          if(e && e.name==='AbortError') return;
        }
      }
      try{
        await navigator.clipboard.writeText(shareUrl);
        assprToast('Lien copié dans le presse-papiers.');
      }catch(_){
        assprToast('Impossible de copier le lien automatiquement.');
      }
    };
  }

  function showSection(data){
    const r=root(); if(!r)return false;
    const section=data.section||{}, share=data.share||{}, docs=Array.isArray(data.documents)?data.documents:[];
    const downloadableCount=docs.filter(d=>d.download_allowed===true).length;
    const expiresIso=share.expires_at||data.expires_at||'';
    const expiresLabel=expiresIso?formatExpiryCountdown(expiresIso):'';
    const shareUrl=location.href;

    r.innerHTML=`
      <div class="aurore-shared-section-page">
        <div class="aurore-shared-section-banner">
          <span class="kicker">SECTION PARTAGÉE</span>
          <h1>${esc(section.name||'Section')}</h1>
          <p>Une sélection de documents organisée dans Aurore.</p>
          <div class="assp-badges">
            <span class="assp-badge">Lecture seule</span>
            <span class="assp-badge">${docs.length} document${docs.length!==1?'s':''}</span>
            ${downloadableCount>0?`<span class="assp-badge">${downloadableCount} téléchargement${downloadableCount!==1?'s':''} autorisé${downloadableCount!==1?'s':''}</span>`:''}
            ${expiresLabel?`<span class="assp-badge assp-badge-expiry">Expire le ${esc(expiresLabel)}</span>`:''}
          </div>
        </div>
        <div class="aurore-shared-section-heading">
          <strong>Documents de la section</strong>
          <button type="button" class="assp-share-btn" id="asspShareBtn">↗ Partager cette section</button>
        </div>
        <div id="auroreSharedDocumentList" class="aurore-shared-section-list"></div>
        <p class="assp-footer">Partagé via Aurore</p>
      </div>`;

    const holder=document.getElementById('auroreSharedDocumentList');
    if(docs.length===0){
      holder.innerHTML=`<div class="doc-empty friendly-empty assp-empty"><div class="icon-wrap">${(window.ICONS&&ICONS.folder)||''}</div><h3>Cette section ne contient encore aucun document.</h3><p>Revenez un peu plus tard.</p><button type="button" class="shared-section-home-btn" id="asspEmptyHomeBtn">← Retour à l’accueil</button></div>`;
      document.getElementById('asspEmptyHomeBtn')?.addEventListener('click',goHome);
    }else{
      const prepared=docs.map(d=>({...d,Telechargement_autorise:d.download_allowed===true,Fichier_url:d.open_allowed===true?d.Fichier_url:null}));
      if(typeof rendreListeDocuments==='function') rendreListeDocuments(holder,prepared,false);
      else holder.innerHTML='<div class="doc-empty"><h3>Lecteur indisponible</h3><p>Veuillez réessayer.</p></div>';
      holder.querySelectorAll('[data-favori],[data-plus-tard],[data-case],[data-signaler],.doc-share-wrap').forEach(el=>el.remove());
      if(share.allow_open===false) holder.querySelectorAll('[data-lire]').forEach(b=>b.remove());
    }

    document.getElementById('asspShareBtn')?.addEventListener('click',handleShareClick(shareUrl,section.name));
    return true;
  }

  async function fetchShare(){
    let res;
    try{
      res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_shared_section`,{method:'POST',headers:{...HEADERS,'Content-Type':'application/json'},body:JSON.stringify({p_token:token}),cache:'no-store'});
    }catch(networkErr){
      const err=new Error('NETWORK_ERROR'); err.kind='network'; throw err;
    }
    const text=await res.text(); let data=null; try{data=JSON.parse(text)}catch(_){}
    if(!res.ok){
      const detail=data?.message||data?.error||text||('HTTP '+res.status);
      const err=new Error(detail); err.kind='network'; throw err;
    }
    if(Array.isArray(data)) data=data[0]||null;
    if(!data?.success){
      const err=new Error(data?.error||'SHARE_INVALID'); err.kind='invalid'; throw err;
    }
    return data;
  }

  async function boot(){
    showShell();
    // Laisser le DOM et les scripts de la page terminer leur initialisation avant
    // de charger les données, sans jamais rendre l'accueil visible.
    await new Promise(r=>setTimeout(r,0));
    for(let i=0;i<3;i++){
      try{
        const data=await fetchShare();
        if(showSection(data)){
          document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
          document.getElementById('screen-shared-section')?.classList.add('active');
          return;
        }
      }catch(e){
        if(e && e.kind==='invalid'){
          console.warn('[Aurore] section partagée : lien invalide —',e.message);
          showError('invalid');
          return;
        }
        if(i===2){
          console.warn('[Aurore] section partagée : réseau —',e);
          showError('network');
        }else{
          await new Promise(r=>setTimeout(r,500*(i+1)));
        }
      }
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
