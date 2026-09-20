
document.addEventListener('DOMContentLoaded', function(){
  const btn = document.getElementById('auroraPersonalEndBtn');
  if(btn){
    btn.addEventListener('click', function(){
      const existing = document.getElementById('btnOuvrirProfil');
      if(existing){ existing.click(); return; }
      if(typeof window.ouvrirEspaceAvecCode === 'function'){ window.ouvrirEspaceAvecCode(); }
    });
  }
});


  /* ===== RECHERCHE UNIFIÉE — anti-race + toutes les recherches publiques ===== */
  (function corrigerRecherchePartout(){
    let seq=0;
    let timer=null;
    let controller=null;

    function annulerRechercheEnCours(){
      seq++;
      if(timer){clearTimeout(timer);timer=null;}
      if(controller){try{controller.abort();}catch(e){} controller=null;}
    }

    function normaliser(v){
      return typeof normaliserRechercheSite==='function'
        ? normaliserRechercheSite(v)
        : String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    }

    function synchroniser(v, source){
      const value=String(v??'');
      ['headerSearchInput','homeSearchInput'].forEach(id=>{
        if(id===source) return;
        const el=document.getElementById(id);
        if(el && el.value!==value) el.value=value;
      });
    }

    async function executer(v){
      const requete=String(v??'').trim();
      const current=++seq;
      if(controller){try{controller.abort();}catch(e){} controller=null;}
      if(!requete){
        const content=document.getElementById('docsContent');
        if(content && document.getElementById('screen-docs')?.classList.contains('active')){
          content.innerHTML='';
        }
        return;
      }

      const content=document.getElementById('docsContent');
      const title=document.getElementById('docsTitle');
      const breadcrumb=document.getElementById('breadcrumb');
      const back=document.querySelector('#screen-docs .back-btn');
      if(!content||!title) return;

      if(breadcrumb) breadcrumb.innerHTML='';
      title.textContent=`Résultats pour « ${requete} »`;
      if(back) back.setAttribute('data-back','home');
      if(typeof afficherEcran==='function') afficherEcran('screen-docs');
      content.innerHTML='<p style="color:var(--gris); font-size:0.9rem;">Recherche en cours…</p>';

      const terme=requete.replace(/[,()]/g,' ').replace(/\s+/g,' ').trim();
      if(!terme) return;
      const termeEnc=encodeURIComponent(terme);
      const champs=['Titre','Matière','Niveau','Filiere','Catégorie','Auteur'];
      const or=champs.map(c=>`${encodeURIComponent(c)}.ilike.*${termeEnc}*`).join(',');
      const url=`${SUPABASE_URL}/rest/v1/Document?select=*&or=(${or})&Publie=eq.true&order=id.desc`;
      controller=typeof AbortController!=='undefined'?new AbortController():null;

      try{
        const res=await fetch(url,{headers:HEADERS,signal:controller?.signal,cache:'no-store'});
        if(current!==seq) return;
        if(!res.ok) throw new Error('HTTP '+res.status);
        const data=await res.json();
        if(current!==seq) return;
        rendreListeDocuments(content,Array.isArray(data)?data:[],true);
      }catch(err){
        if(err?.name==='AbortError'||current!==seq) return;
        content.innerHTML='<div class="doc-empty"><div class="icon-wrap">'+ICONS.warning+'</div><h3>Recherche indisponible</h3><p>La recherche n’a pas pu aboutir pour le moment. Veuillez réessayer dans quelques instants.</p></div>';
      }finally{
        if(current===seq) controller=null;
      }
    }

    function programmer(v,source){
      synchroniser(v,source);
      annulerRechercheEnCours();
      const requete=String(v??'').trim();
      if(!requete) return;
      timer=setTimeout(()=>{timer=null;executer(requete);},220);
    }

    // Un seul flux de recherche pour les deux champs globaux.
    ['headerSearchInput','homeSearchInput'].forEach(id=>{
      const input=document.getElementById(id);
      if(!input) return;
      input.addEventListener('input',e=>programmer(e.target.value,id));
      // Capture : neutralise l'ancien gestionnaire Enter qui pouvait lancer
      // une seconde requête obsolète en parallèle.
      input.addEventListener('keydown',e=>{
        if(e.key==='Enter'){
          e.preventDefault();
          e.stopImmediatePropagation();
          programmer(e.currentTarget.value,id);
        }
      },true);
    });

    // Toute saisie/effacement dans les recherches internes doit rester fiable.
    // Elles sont déjà locales, donc aucun appel réseau supplémentaire n'est créé.
    document.getElementById('docsSearch')?.addEventListener('input',()=>{
      if(typeof docsPageCourante!=='undefined') docsPageCourante=1;
      if(typeof afficherDocumentsPublicsAvecOutils==='function') afficherDocumentsPublicsAvecOutils();
    },true);
    document.getElementById('recentsSearch')?.addEventListener('input',()=>{
      if(typeof recentsPageCourante!=='undefined') recentsPageCourante=1;
      if(typeof rendreRecentsAvecOutils==='function') rendreRecentsAvecOutils();
    },true);

    // Le bouton d'effacement/retour doit aussi invalider une recherche réseau.
    document.addEventListener('input',e=>{
      if(e.target?.id==='headerSearchInput'||e.target?.id==='homeSearchInput') return;
      if(e.target?.matches?.('input[type="search"]') && !e.target.value.trim()){
        // Les recherches internes sont locales ; leur gestionnaire existant suffit.
      }
    },true);

    window.auroreRechercheRobuste=executer;
  })();

  /* ===== PARTAGE DE SECTION — couche finale ===== */
  (function(){
    'use strict';
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function rpc(name,body){
      const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json'},body:JSON.stringify(body||{}),cache:'no-store'});
      if(!r.ok)throw new Error('RPC '+name+' HTTP '+r.status+' '+await r.text().catch(()=>''));
      return r.status===204?null:await r.json();
    }
    function getModal(){
      let m=document.getElementById('auroreSectionShareModal');if(m)return m;
      m=document.createElement('div');m.id='auroreSectionShareModal';m.className='aurore-section-share-modal';m.innerHTML=`<section class="aurore-section-share-card" role="dialog" aria-modal="true"><button class="aurore-section-share-close" data-close>×</button><span class="aurore-section-share-kicker">PARTAGE DE SECTION</span><h2 id="assmTitle">Partager votre section</h2><p id="assmIntro">Créez un lien public en lecture seule. Votre espace personnel reste totalement privé.</p><div id="assmBody"></div><div class="aurore-section-share-actions"><button type="button" data-copy>Copier le lien</button><button type="button" data-wa>WhatsApp</button><button type="button" data-revoke class="danger">Révoquer</button></div></section>`;document.body.appendChild(m);
      m.addEventListener('click',e=>{if(e.target===m||e.target.closest('[data-close]'))m.classList.remove('show')});
      return m;
    }
    let currentShare=null,currentSection=null;
    function pickExpiryPreset(expiresAtIso){
      if(!expiresAtIso) return 'never';
      const days=Math.round((new Date(expiresAtIso).getTime()-Date.now())/86400000);
      if(days<=10) return '7';
      if(days<=45) return '30';
      return '90';
    }
    function formatExpiryInfo(expiresAtIso){
      if(!expiresAtIso) return 'Ce lien n’expire jamais.';
      const d=new Date(expiresAtIso);
      if(Number.isNaN(d.getTime())) return '';
      const diffMs=d.getTime()-Date.now();
      const dateLabel=d.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
      if(diffMs<=0) return `A expiré le ${dateLabel}.`;
      const days=Math.floor(diffMs/86400000);
      const hours=Math.floor((diffMs%86400000)/3600000);
      const remain=days>0?`dans ${days} jour${days!==1?'s':''}`:`dans ${hours} heure${hours!==1?'s':''}`;
      return `Expire le ${dateLabel} · ${remain}`;
    }
    async function shareSection(f){
      if(!session?.id){alert('Connectez-vous pour partager une section.');return;}
      currentSection=f;const m=getModal(),body=m.querySelector('#assmBody'),actions=m.querySelector('.aurore-section-share-actions');
      m.querySelector('#assmTitle').textContent=`Partager « ${f.name} »`;
      body.innerHTML='<div class="aurore-section-share-loading">Préparation du partage…</div>';actions.style.display='none';m.classList.add('show');
      try{
        const q=`section_id=eq.${encodeURIComponent(f.id)}&owner_id=eq.${encodeURIComponent(session.id)}&order=created_at.desc&limit=1`;
        const r=await fetch(`${SUPABASE_URL}/rest/v1/partages_sections_personnelles?select=*&${q}`,{headers:headersAdmin(),cache:'no-store'});
        if(!r.ok)throw new Error('HTTP '+r.status);const rows=await r.json();currentShare=Array.isArray(rows)&&rows[0]?.active?rows[0]:null;
        if(!currentShare){
          const defaultExpiresAt=new Date(Date.now()+30*24*60*60*1000).toISOString();
          const created=await rpc('create_section_share',{p_section_id:f.id,p_allow_open:true,p_allow_download:true,p_expires_at:defaultExpiresAt});
          currentShare=Array.isArray(created)?created[0]:created;
        }
        const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('sectionShare',currentShare.token);
        body.innerHTML=`<div class="aurore-section-share-success"><div class="aurore-share-check">✓</div><strong>Section prête à être partagée</strong><span>Les visiteurs ne verront que les documents publiés de cette section.</span><div class="aurore-section-share-link"><input readonly value="${esc(url.href)}"><button type="button" data-copy>Copier</button></div><div class="aurore-section-share-options"><label><input type="checkbox" data-open ${currentShare.allow_open!==false?'checked':''}> Autoriser l’ouverture des documents</label><label><input type="checkbox" data-download ${currentShare.allow_download!==false?'checked':''}> Autoriser les téléchargements</label><label class="aurore-section-share-expiry-row">Expiration du lien<select data-expiry class="aurore-section-share-expiry-select"><option value="7">7 jours</option><option value="30">1 mois</option><option value="90">3 mois</option><option value="never">Jamais</option></select></label><small data-expiry-info class="aurore-section-share-expiry-info"></small></div></div>`;
        actions.style.display='flex';
        const expirySelect=body.querySelector('[data-expiry]');
        if(expirySelect) expirySelect.value=pickExpiryPreset(currentShare.expires_at);
        const expiryInfo=body.querySelector('[data-expiry-info]');
        if(expiryInfo) expiryInfo.textContent=formatExpiryInfo(currentShare.expires_at);
        body.querySelector('[data-open]')?.addEventListener('change',update);body.querySelector('[data-download]')?.addEventListener('change',update);body.querySelector('[data-expiry]')?.addEventListener('change',update);
        const copy=async()=>{try{await navigator.clipboard.writeText(url.href);body.querySelector('[data-copy]').textContent='Copié ✓';setTimeout(()=>body.querySelector('[data-copy]').textContent='Copier',1600)}catch(_){prompt('Copiez le lien :',url.href)}};
        body.querySelector('[data-copy]')?.addEventListener('click',copy);actions.querySelector('[data-copy]').onclick=copy;actions.querySelector('[data-wa]').onclick=()=>window.open('https://wa.me/?text='+encodeURIComponent(`Découvrez ma section « ${f.name} » sur Aurore :
${url.href}`),'_blank','noopener,noreferrer');actions.querySelector('[data-revoke]').onclick=async()=>{if(!confirm('Révoquer le lien de cette section ?'))return;try{await rpc('revoke_section_share',{p_share_id:currentShare.id});m.classList.remove('show');alert('Le partage de la section a été révoqué.')}catch(e){alert('Impossible de révoquer le partage pour le moment.')}};
        async function update(){
          try{
            const expiryVal=body.querySelector('[data-expiry]')?.value;
            let newExpiresAt=currentShare.expires_at||null;
            if(expiryVal) newExpiresAt = expiryVal==='never' ? null : new Date(Date.now()+Number(expiryVal)*24*60*60*1000).toISOString();
            await rpc('update_section_share',{p_share_id:currentShare.id,p_allow_view:true,p_allow_open:!!body.querySelector('[data-open]')?.checked,p_allow_download:!!body.querySelector('[data-download]')?.checked,p_expires_at:newExpiresAt});
            currentShare.allow_open=body.querySelector('[data-open]')?.checked;
            currentShare.allow_download=body.querySelector('[data-download]')?.checked;
            currentShare.expires_at=newExpiresAt;
            const info=body.querySelector('[data-expiry-info]'); if(info) info.textContent=formatExpiryInfo(newExpiresAt);
          }catch(e){console.warn('[Aurore] permissions section',e)}
        }
      }catch(e){console.error('[Aurore] partage section',e);body.innerHTML='<div class="aurore-section-share-error">Impossible de préparer le partage pour le moment. Vérifiez que le SQL du partage de sections est bien exécuté.</div>';actions.style.display='none'}
    }
    window.aurorePartagerSection=shareSection;
    window.addEventListener('beforeunload',()=>{});
  })();
