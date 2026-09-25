  // ---------- SERVICE CLIENT (configuration Supabase) ----------
  const SERVICE_CLIENT_FALLBACK = {
    whatsappDisplay:'05505861', whatsappUrl:'https://wa.me/22605505861',
    email:'oualikevin9@gmail.com', text:'Notre équipe est disponible pour vous accompagner.'
  };
  let serviceClientConfigActuelle = {...SERVICE_CLIENT_FALLBACK};

  function normaliserNumeroWhatsApp(valeur) {
    const brut=String(valeur||'').trim();
    const chiffres=brut.replace(/\D/g,'');
    if(!chiffres) return {display:'',url:''};
    const international=chiffres.startsWith('226') ? chiffres : '226'+chiffres.replace(/^0/,'');
    return {display:brut,url:'https://wa.me/'+international};
  }

  function appliquerServiceClientPublic(cfg) {
    const c={...SERVICE_CLIENT_FALLBACK,...cfg};
    const wa=normaliserNumeroWhatsApp(c.whatsappDisplay || c.whatsapp || '');
    c.whatsappDisplay=wa.display || SERVICE_CLIENT_FALLBACK.whatsappDisplay;
    c.whatsappUrl=wa.url || SERVICE_CLIENT_FALLBACK.whatsappUrl;
    c.email=String(c.email||SERVICE_CLIENT_FALLBACK.email).trim();
    c.text=String(c.text||SERVICE_CLIENT_FALLBACK.text).trim();
    serviceClientConfigActuelle=c;
    const txt=document.getElementById('serviceClientPublicText');
    const waLink=document.getElementById('serviceClientWhatsapp');
    const waDisplay=document.getElementById('serviceClientWhatsappDisplay');
    const emLink=document.getElementById('serviceClientEmail');
    const emDisplay=document.getElementById('serviceClientEmailDisplay');
    if(txt) txt.textContent=c.text;
    if(waLink){ waLink.href=c.whatsappUrl; }
    if(waDisplay) waDisplay.textContent=c.whatsappDisplay;
    if(emLink) emLink.href='mailto:'+c.email;
    if(emDisplay) emDisplay.textContent=c.email;
    const waInput=document.getElementById('adminServiceWhatsappInput');
    const emInput=document.getElementById('adminServiceEmailInput');
    const txInput=document.getElementById('adminServiceTextInput');
    if(waInput && document.activeElement!==waInput) waInput.value=c.whatsappDisplay;
    if(emInput && document.activeElement!==emInput) emInput.value=c.email;
    if(txInput && document.activeElement!==txInput) txInput.value=c.text;
    const waOld=document.getElementById('adminServiceWhatsapp');
    const emOld=document.getElementById('adminServiceEmail');
    const txOld=document.getElementById('adminServiceText');
    if(waOld) waOld.textContent=c.whatsappDisplay;
    if(emOld) emOld.textContent=c.email;
    if(txOld) txOld.textContent=c.text;
  }

  async function chargerServiceClientConfig() {
    try {
      const res=await fetch(`${SUPABASE_URL}/rest/v1/service_client?select=id,whatsapp,email,texte&id=eq.1`,{headers:HEADERS});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const rows=await res.json();
      if(rows[0]) appliquerServiceClientPublic({whatsappDisplay:rows[0].whatsapp,email:rows[0].email,text:rows[0].texte});
      else appliquerServiceClientPublic(SERVICE_CLIENT_FALLBACK);
    } catch(e) {
      console.warn('[Service client] configuration distante indisponible, repli local.',e);
      appliquerServiceClientPublic(SERVICE_CLIENT_FALLBACK);
    }
  }

  async function enregistrerServiceClientConfig() {
    const msg=document.getElementById('adminServiceMsg');
    const btn=document.getElementById('adminServiceSave');
    const whatsapp=document.getElementById('adminServiceWhatsappInput')?.value.trim() || '';
    const email=document.getElementById('adminServiceEmailInput')?.value.trim() || '';
    const texte=document.getElementById('adminServiceTextInput')?.value.trim() || '';
    if(msg){msg.className='form-msg';msg.style.display='';}
    if(!session || session.role!=='admin') { if(msg){msg.textContent='Cette action est réservée aux administrateurs.';msg.className='form-msg err';} return; }
    const wa=normaliserNumeroWhatsApp(whatsapp);
    if(!wa.display){if(msg){msg.textContent='Merci de renseigner le numéro WhatsApp.';msg.className='form-msg err';}return;}
    if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){if(msg){msg.textContent='Merci de renseigner une adresse e-mail valide.';msg.className='form-msg err';}return;}
    if(!texte){if(msg){msg.textContent='Merci de renseigner le texte du service client.';msg.className='form-msg err';}return;}
    if(btn){btn.disabled=true;btn.textContent='Enregistrement en cours…';}
    try {
      const res=await fetch(`${SUPABASE_URL}/rest/v1/service_client?id=eq.1`,{
        method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=representation'},
        body:JSON.stringify({whatsapp:wa.display,email,texte,updated_at:new Date().toISOString()})
      });
      const body=await res.text();
      if(!res.ok) throw new Error('HTTP '+res.status+' — '+body);
      const rows=body?JSON.parse(body):[];
      appliquerServiceClientPublic(rows[0]?{whatsappDisplay:rows[0].whatsapp,email:rows[0].email,text:rows[0].texte}:{whatsappDisplay:wa.display,email,text:texte});
      if(msg){msg.textContent='Coordonnées du service client enregistrées avec succès.';msg.className='form-msg ok';}
    } catch(e) {
      if(msg){msg.textContent='Impossible d’enregistrer les coordonnées pour le moment. Veuillez réessayer.';msg.className='form-msg err';}
    } finally { if(btn){btn.disabled=false;btn.textContent='Enregistrer les coordonnées';} }
  }

  document.getElementById('adminServiceSave')?.addEventListener('click',enregistrerServiceClientConfig);
  chargerServiceClientConfig();

  // ---------- ANNONCE ACCUEIL (module indépendant, table dédiée "annonce_accueil") ----------
  // Même motif que service_client ci-dessus : une seule ligne (id=1), lecture
  // publique avec la clé anon, écriture via headersAdmin(). Aucune régression si
  // la table est vide/absente : le bloc public reste simplement display:none.
  function appliquerApercuAnnonceAdmin() {
    const texte = document.getElementById('adminAnnonceInput')?.value.trim() || '';
    const preview = document.getElementById('adminAnnoncePreview');
    const previewTexte = document.getElementById('adminAnnoncePreviewTexte');
    const previewVide = document.getElementById('adminAnnoncePreviewVide');
    if (texte) {
      previewTexte.textContent = texte;
      preview.style.display = 'flex';
      previewVide.style.display = 'none';
    } else {
      preview.style.display = 'none';
      previewVide.style.display = 'block';
    }
  }
  document.getElementById('adminAnnonceInput')?.addEventListener('input', appliquerApercuAnnonceAdmin);

  function appliquerAnnoncePublic(message, active) {
    const bloc = document.getElementById('homeAnnonceBlock');
    const texte = document.getElementById('homeAnnonceTexte');
    const contenu = String(message || '').trim();
    if (active && contenu) {
      texte.textContent = contenu;
      bloc.style.display = 'flex';
    } else {
      bloc.style.display = 'none';
    }
  }

  async function chargerAnnonceAccueil() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/annonce_accueil?select=id,message,active&id=eq.1`, { headers: HEADERS });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      const row = rows[0] || null;
      appliquerAnnoncePublic(row?.message, row?.active === true);
      const input = document.getElementById('adminAnnonceInput');
      const chk = document.getElementById('adminAnnonceActive');
      if (input && document.activeElement !== input) input.value = row?.message || '';
      if (chk) chk.checked = row?.active === true;
      appliquerApercuAnnonceAdmin();
    } catch (e) {
      console.warn('[Annonce accueil] configuration distante indisponible.', e);
      appliquerAnnoncePublic('', false); // reste masqué, aucune régression
    }
  }

  async function enregistrerAnnonceAccueil() {
    const msg = document.getElementById('adminAnnonceMsg');
    const btn = document.getElementById('adminAnnonceSave');
    const message = document.getElementById('adminAnnonceInput')?.value.trim() || '';
    const active = document.getElementById('adminAnnonceActive')?.checked || false;
    if (msg) { msg.className = 'form-msg'; msg.style.display = ''; }
    if (!session || session.role !== 'admin') { if (msg) { msg.textContent = 'Cette action est réservée aux administrateurs.'; msg.className = 'form-msg err'; } return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement en cours…'; }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/annonce_accueil?id=eq.1`, {
        method: 'PATCH', headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({ message, active, updated_at: new Date().toISOString() })
      });
      let body = await res.text();
      let rows = body ? JSON.parse(body) : [];
      if (res.ok && rows.length === 0) {
        // Aucune ligne id=1 n'existe encore : on la crée (une seule fois).
        const resIns = await fetch(`${SUPABASE_URL}/rest/v1/annonce_accueil`, {
          method: 'POST', headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify({ id: 1, message, active, updated_at: new Date().toISOString() })
        });
        body = await resIns.text();
        if (!resIns.ok) throw new Error('HTTP ' + resIns.status + ' — ' + body);
        rows = body ? JSON.parse(body) : [];
      } else if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' — ' + body);
      }
      appliquerAnnoncePublic(rows[0]?.message ?? message, rows[0]?.active ?? active);
      if (msg) { msg.textContent = 'Annonce enregistrée avec succès.'; msg.className = 'form-msg ok'; }
    } catch (e) {
      if (msg) { msg.textContent = "Impossible d’enregistrer l’annonce pour le moment. Veuillez réessayer."; msg.className = 'form-msg err'; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  }
  document.getElementById('adminAnnonceSave')?.addEventListener('click', enregistrerAnnonceAccueil);
  chargerAnnonceAccueil();

  (function initialiserAccueilAuraster(){
    const icon = document.getElementById('homeSearchIcon');
    if (icon && typeof ICONS !== 'undefined') icon.innerHTML = ICONS.search;
    const input = document.getElementById('homeSearchInput');
    if (input) input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      lancerRecherche(input.value);
    });
    chargerAnnoncesActives();
    // Le diagnostic réseau se lance désormais depuis le panneau visible de l'onglet
    // Publicités de l'admin (bouton #diagReseauBtn), pas automatiquement au chargement.
    document.getElementById('diagReseauBtn')?.addEventListener('click', diagnostiquerConnectiviteReseauMinimal);
    document.getElementById('diagPubBtn')?.addEventListener('click', afficherDiagnosticAffichagePublic);
    document.getElementById('diagRenduBtn')?.addEventListener('click', inspecterRenduAdSlots);
    document.getElementById('diagHomeBtn')?.addEventListener('click', diagnostiquerAccueilEtAdHome1);
    const adminPromoTab=document.querySelector('.admin-tab[data-tab="vitrine"]');
    if(adminPromoTab) adminPromoTab.addEventListener('click',chargerPublicitesAdmin);
    document.getElementById('adminPromoSave')?.addEventListener('click',enregistrerPublicite);
    document.getElementById('adminPromoCancelEdit')?.addEventListener('click',annulerModificationPublicite);
    document.getElementById('adminPromoFile')?.addEventListener('change', (e)=>{
      const f=e.target.files?.[0];
      if(!f) return;
      const reader=new FileReader();
      reader.onload=()=>{ document.getElementById('adminPromoPreview').innerHTML=`<img src="${reader.result}" alt="">`; };
      reader.readAsDataURL(f);
    });
  })();

  // ---------- LOGO DU SITE (modifiable depuis l'admin, sans redéploiement) ----------
  // Source unique du logo. Le même objet R2 est utilisé par le site, le favicon,
  // l'icône Apple et le manifeste PWA. Les éléments Google restent sur une URL stable ;
  // seul le logo visible dans l'interface peut utiliser une version de cache.
  (function(){
    const LOGO_CLE = 'site-logo-auraster';
    const LOGO_VERSION_KEY = 'aurore_logo_version';
    const LOGO_URL_BASE = `${R2_PUBLIC_URL}/${LOGO_CLE}`;

    function logoUrl(version) {
      return version
        ? `${LOGO_URL_BASE}?v=${encodeURIComponent(version)}`
        : LOGO_URL_BASE;
    }

    function appliquerLogoDansConteneur(conteneur, url) {
      if (!conteneur) return;
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.onload = () => {
        conteneur.replaceChildren(img);
        img.alt = 'Aurore — Section Archives';
      };
      img.onerror = () => {
        /*
         * Ne vide jamais le logo déjà affiché à cause d'un échec réseau
         * ponctuel. On réessaie une seule fois sur l'URL R2 stable.
         */
        if (url !== LOGO_URL_BASE) {
          const secours = new Image();
          secours.decoding = 'async';
          secours.onload = () => {
            conteneur.replaceChildren(secours);
            secours.alt = 'Aurore — Section Archives';
          };
          secours.src = LOGO_URL_BASE;
        }
      };
      img.src = url;
    }

    function mettreAJourLiensLogo(url) {
      // Une seule source R2 pour le logo du site, le favicon et l'icône Apple.
      // Le manifeste PWA pointe lui aussi vers le même objet R2.
      const manifest = document.querySelector('link[rel="manifest"]');
      if (manifest) manifest.href = `manifest.json?v=${encodeURIComponent(Date.now())}`;
      document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(link => {
        link.href = url;
      });
      document.querySelector('meta[property="og:image"]')?.setAttribute('content', url);
      document.querySelector('meta[name="twitter:image"]')?.setAttribute('content', url);
      const preload = document.querySelector('link[rel="preload"][as="image"]');
      if (preload) preload.href = url;
      const orgLogo = document.querySelector('script[type="application/ld+json"]');
      // Le JSON-LD initial contient déjà la même URL R2 sans version ;
      // Google récupérera donc toujours la source officielle du logo.
    }

    function chargerLogoSite(versionForcee) {
      let version = versionForcee;
      if (!version) {
        try { version = localStorage.getItem(LOGO_VERSION_KEY) || ''; } catch(e) {}
      }
      const url = logoUrl(String(version || ''));
      try { sessionStorage.setItem('aurore_logo_url', url); } catch(e) {}
      try { localStorage.setItem(LOGO_VERSION_KEY, version); } catch(e) {}

      const cibles = [
        document.getElementById('brandLogo'),
        document.getElementById('adminLogoPreview'),
        document.getElementById('accessBrandLogo')
      ];
      cibles.forEach(c => appliquerLogoDansConteneur(c, url));
      mettreAJourLiensLogo(url);
    }
    window.chargerLogoSite = chargerLogoSite;
    window.AURORE_LOGO_URL = () => logoUrl(Date.now());

    document.getElementById('adminLogoSave')?.addEventListener('click', async () => {
      const fileInput = document.getElementById('adminLogoFile');
      const msg = document.getElementById('adminLogoMsg');
      const btn = document.getElementById('adminLogoSave');
      const fichier = fileInput?.files?.[0];
      if (msg) { msg.className = 'form-msg'; msg.style.display = ''; }
      if (!fichier) { if(msg){ msg.textContent = "Choisis d'abord une image."; msg.className = 'form-msg err'; } return; }
      if (!['image/png','image/jpeg','image/webp','image/gif'].includes(fichier.type)) {
        if(msg){ msg.textContent = "Format non pris en charge (PNG, JPG, WEBP ou GIF uniquement)."; msg.className = 'form-msg err'; } return;
      }
      if (fichier.size > 5 * 1024 * 1024) {
        if(msg){ msg.textContent = "Image trop lourde (5 Mo maximum pour le logo)."; msg.className = 'form-msg err'; } return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }
      try {
        const res = await fetch(`${R2_WORKER_URL}/${LOGO_CLE}`, {
          method: 'PUT',
          headers: { 'Content-Type': fichier.type },
          body: fichier,
          cache: 'no-store'
        });
        if (!res.ok) throw new Error('Statut ' + res.status);
        // Nouvelle version persistée : tous les composants du site utilisent
        // immédiatement la nouvelle URL sans conserver l'ancienne image.
        const nouvelleVersion = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        chargerLogoSite(nouvelleVersion);
        // Force la mise à jour du SW/PWA quand le navigateur le permet.
        try { await navigator.serviceWorker?.ready?.then(reg => reg.update()); } catch(e) {}
        if (fileInput) fileInput.value = '';
        if (msg) { msg.textContent = 'Logo mis à jour avec succès — site, favicon et prochaine installation PWA utilisent désormais le nouveau logo.'; msg.className = 'form-msg ok'; }
      } catch (err) {
        if (msg) { msg.textContent = "Le logo n’a pas pu être envoyé pour le moment. Veuillez réessayer."; msg.className = 'form-msg err'; }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Mettre à jour le logo'; }
      }
    });

    document.getElementById('adminLogoReset')?.addEventListener('click', async () => {
      const msg = document.getElementById('adminLogoMsg');
      try {
        const res = await fetch(`${R2_WORKER_URL}/${LOGO_CLE}`, { method: 'DELETE', cache: 'no-store' });
        if (!res.ok) throw new Error('Statut ' + res.status);
        chargerLogoSite(`${Date.now()}-reset`);
        if (msg) { msg.textContent = "Logo retiré — aucun ancien logo local ne sera réutilisé automatiquement."; msg.className = 'form-msg ok'; }
      } catch (err) {
        if (msg) { msg.textContent = "Impossible de retirer le logo automatiquement. Envoie un nouveau logo pour le remplacer."; msg.className = 'form-msg err'; }
      }
    });
  })();

  // ---------- INITIALISATION ----------
  rendrePresentation();
  rendreAccueil();
  majFilAriane();
  chargerLogoSite();

  const VIDEO_TABLE='Videos';
  async function chargerVideosAccueil(){
    const section=document.getElementById('homeVideoSection'),player=document.getElementById('homeVideoPlayer'); if(!section||!player)return;
    try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?select=*&active=eq.true&order=updated_at.desc`,{headers:HEADERS});if(!r.ok)throw new Error('HTTP '+r.status);const rows=await r.json(),v=rows[0];if(!v?.video_url){section.style.display='none';player.removeAttribute('src');player.load();return;}document.getElementById('homeVideoTitle').textContent=v.title||'Vidéo';const d=document.getElementById('homeVideoDesc');d.textContent=v.description||'';d.style.display=v.description?'block':'none';player.src=v.video_url;if(v.poster_url)player.poster=v.poster_url;else player.removeAttribute('poster');player.load();section.style.display='block';}catch(e){console.warn('[Vidéos] lecture indisponible.',e);section.style.display='none';}
  }
  function apercuVideoAdmin(url){const p=document.getElementById('adminVideoPreview');if(!p)return;if(!url){p.innerHTML='<span>Aucune vidéo sélectionnée.</span>';return;}p.innerHTML=`<video controls playsinline preload="metadata" src="${echapperHtmlPub(url)}"></video>`;}
  function resetVideoAdmin(){document.getElementById('adminVideoEditId').value='';document.getElementById('adminVideoFile').value='';document.getElementById('adminVideoTitleInput').value='';document.getElementById('adminVideoDescInput').value='';document.getElementById('adminVideoActive').checked=false;apercuVideoAdmin('');document.getElementById('adminVideoSave').textContent='Ajouter la vidéo';document.getElementById('adminVideoCancel').style.display='none';}
  document.getElementById('adminVideoFile')?.addEventListener('change',function(){const f=this.files?.[0];if(!f)return;const m=document.getElementById('adminVideoMsg');if(!['video/mp4','video/webm','video/ogg'].includes(f.type)){m.textContent='Ce format vidéo n’est pas pris en charge. Utilisez MP4, WEBM ou OGG.';m.className='form-msg err';this.value='';return;}if(f.size>100*1024*1024){m.textContent='Cette vidéo dépasse la taille maximale autorisée de 100 Mo.';m.className='form-msg err';this.value='';return;}apercuVideoAdmin(URL.createObjectURL(f));});
  async function chargerVideosAdmin(){const list=document.getElementById('adminVideoList');if(!list)return;list.innerHTML='<div class="pub-admin-empty">Chargement…</div>';try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?select=*&order=updated_at.desc`,{headers:headersAdmin()});if(!r.ok)throw new Error('HTTP '+r.status);const rows=await r.json();document.getElementById('tabCountVideos').textContent=rows.length;list.innerHTML=rows.length?'':'<div class="pub-admin-empty">Aucune vidéo pour le moment.</div>';rows.forEach(v=>{const x=document.createElement('div');x.className='pub-admin-item';x.innerHTML=`<video src="${echapperHtmlPub(v.video_url||'')}" preload="metadata" muted playsinline></video><div class="pub-admin-item-body"><div class="pub-admin-item-title">${echapperHtmlPub(v.title||'(sans titre)')}</div>${v.description?`<div class="pub-admin-item-desc">${echapperHtmlPub(v.description)}</div>`:''}<div class="pub-admin-item-status ${v.active?'on':'off'}">${v.active?'● Active':'○ Désactivée'}</div></div><div class="pub-admin-item-actions"><button type="button" data-a="e">Modifier</button><button type="button" data-a="t">${v.active?'Désactiver':'Activer'}</button><button type="button" class="danger" data-a="d">Supprimer</button></div>`;x.querySelector('[data-a="e"]').onclick=()=>editVideo(v);x.querySelector('[data-a="t"]').onclick=()=>toggleVideo(v);x.querySelector('[data-a="d"]').onclick=()=>deleteVideo(v);list.appendChild(x);});}catch(e){list.innerHTML='<div class="pub-admin-empty">Impossible de charger les vidéos pour le moment. Veuillez réessayer.</div>';}}
  function editVideo(v){document.getElementById('adminVideoEditId').value=v.id;document.getElementById('adminVideoTitleInput').value=v.title||'';document.getElementById('adminVideoDescInput').value=v.description||'';document.getElementById('adminVideoActive').checked=v.active===true;document.getElementById('adminVideoFile').value='';apercuVideoAdmin(v.video_url||'');document.getElementById('adminVideoSave').textContent='Enregistrer les modifications';document.getElementById('adminVideoCancel').style.display='inline-flex';document.querySelector('.admin-video-manager')?.scrollIntoView({behavior:'smooth',block:'start'});}
  async function saveVideo(){const msg=document.getElementById('adminVideoMsg'),btn=document.getElementById('adminVideoSave');if(!session||session.role!=='admin'){msg.textContent='Cette action est réservée aux administrateurs.';msg.className='form-msg err';return;}const id=document.getElementById('adminVideoEditId').value,title=document.getElementById('adminVideoTitleInput').value.trim(),description=document.getElementById('adminVideoDescInput').value.trim(),active=document.getElementById('adminVideoActive').checked,file=document.getElementById('adminVideoFile').files[0];if(!title){msg.textContent='Veuillez renseigner un titre pour continuer.';msg.className='form-msg err';return;}if(!id&&!file){msg.textContent='Veuillez sélectionner une vidéo avant de continuer.';msg.className='form-msg err';return;}btn.disabled=true;btn.textContent='Enregistrement en cours…';try{let url=null;if(file){const name='video_'+Date.now()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');const up=await fetch(`${R2_WORKER_URL}/${name}`,{method:'PUT',headers:{'Content-Type':file.type},body:file});const b=await up.text().catch(()=> '');if(!up.ok)throw new Error('Le stockage a refusé la vidéo (HTTP '+up.status+'). '+b);url=`${R2_PUBLIC_URL}/${name}`;}const payload={title,description,active,updated_at:new Date().toISOString()};if(url)payload.video_url=url;let r;if(id){r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(payload)});}else{payload.video_url=url;payload.created_at=new Date().toISOString();r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}`,{method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(payload)});}if(!r.ok)throw new Error('HTTP '+r.status+' — '+await r.text());msg.textContent=id?'La vidéo a été mise à jour avec succès.':'La vidéo a été ajoutée avec succès.';msg.className='form-msg ok';resetVideoAdmin();await chargerVideosAdmin();await chargerVideosAccueil();}catch(e){msg.textContent='Impossible d’enregistrer la vidéo pour le moment. Vérifiez les informations saisies et réessayez.';msg.className='form-msg err';}finally{btn.disabled=false;btn.textContent='Ajouter la vidéo';}}
  async function toggleVideo(v){try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?id=eq.${encodeURIComponent(v.id)}`,{method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({active:!v.active,updated_at:new Date().toISOString()})});if(!r.ok)throw new Error('HTTP '+r.status);await chargerVideosAdmin();await chargerVideosAccueil();}catch(e){document.getElementById('adminVideoMsg').textContent='Impossible de modifier l’état pour le moment. Veuillez réessayer.';}}
  async function deleteVideo(v){if(!confirm('Supprimer cette vidéo ?'))return;try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${VIDEO_TABLE}?id=eq.${encodeURIComponent(v.id)}`,{method:'DELETE',headers:headersAdmin()});if(!r.ok)throw new Error('HTTP '+r.status);await chargerVideosAdmin();await chargerVideosAccueil();}catch(e){document.getElementById('adminVideoMsg').textContent='Impossible de supprimer la vidéo pour le moment. Veuillez réessayer.';}}
  document.getElementById('adminVideoSave')?.addEventListener('click',saveVideo);document.getElementById('adminVideoCancel')?.addEventListener('click',resetVideoAdmin);

  const WELCOME_TABLE='message_bienvenue';
  async function chargerMessageBienvenue(){try{const r=await fetch(`${SUPABASE_URL}/rest/v1/${WELCOME_TABLE}?select=id,title,message,active&id=eq.1`,{headers:HEADERS});if(!r.ok)throw new Error('HTTP '+r.status);return (await r.json())[0]||null;}catch(e){console.warn('[Bienvenue] configuration indisponible.',e);return null;}}
  async function afficherBienvenueApresConnexion(sess){
    if(!sess)return;
    const cfg=await chargerMessageBienvenue(),modal=document.getElementById('welcomeModal');
    if(!cfg||cfg.active!==true||!cfg.message||!modal)return;
    const key='aurore_welcome_seen_'+(sess.id||sess.email||''),first=localStorage.getItem(key)!=='1';
    const title=document.getElementById('welcomeModalTitle'),textNode=document.getElementById('welcomeModalText');
    if(title)title.textContent=first?(cfg.title||'Bienvenue sur Aurore'):(cfg.title||'Content de vous revoir sur Aurore');
    if(textNode)textNode.textContent=String(cfg.message).replace(/\{nom\}/gi,sess.nom||'').replace(/\{email\}/gi,sess.email||'');
    modal.hidden=false;
    modal.setAttribute('aria-hidden','false');
    modal.classList.remove('is-opening');
    void modal.offsetWidth;
    modal.classList.add('is-opening');
    localStorage.setItem(key,'1');
  }
  function fermerBienvenue(){const m=document.getElementById('welcomeModal');if(m){m.classList.remove('is-opening');m.hidden=true;m.setAttribute('aria-hidden','true');}}
  function continuerDepuisBienvenue(){fermerBienvenue();const card=document.getElementById('homeRecentsCta');if(card){card.click();}else{afficherEcran('screen-recents');chargerDocumentsRecents();}}
  document.addEventListener('click',e=>{const target=e.target.closest?.('[data-welcome-close],#welcomeModalClose,#welcomeModalOk');if(!target)return;if(target.id==='welcomeModalOk')continuerDepuisBienvenue();else fermerBienvenue();});
  function initialiserEditeurBienvenueAdmin(){const panel=document.querySelector('.admin-tab-panel[data-panel="annonce"]');if(!panel||document.getElementById('adminWelcomeEditor'))return;const box=document.createElement('div');box.className='admin-service-editor';box.id='adminWelcomeEditor';box.innerHTML=`<div class="form-row"><label for="adminWelcomeTitle">Titre du message de bienvenue</label><input id="adminWelcomeTitle" type="text" maxlength="180" placeholder="Bienvenue sur Aurore"></div><div class="form-row"><label for="adminWelcomeMessage">Message</label><textarea id="adminWelcomeMessage" rows="7" maxlength="1200" placeholder="Bienvenue {nom} ! Nous sommes heureux de vous accueillir sur Aurore — Section Archives."></textarea><small>Variables disponibles : {nom} et {email}.</small></div><div class="form-row" style="display:flex;align-items:center;gap:10px;"><input type="checkbox" id="adminWelcomeActive" style="width:18px;height:18px;"><label for="adminWelcomeActive" style="margin:0;">Afficher après une connexion</label></div><div class="admin-promo-actions"><button type="button" class="admin-btn primary" id="adminWelcomeSave">Enregistrer le message de bienvenue</button></div><div class="form-msg" id="adminWelcomeMsg"></div>`;panel.appendChild(box);document.getElementById('adminWelcomeSave').onclick=saveWelcome;chargerMessageBienvenue().then(c=>{if(c){document.getElementById('adminWelcomeTitle').value=c.title||'';document.getElementById('adminWelcomeMessage').value=c.message||'';document.getElementById('adminWelcomeActive').checked=c.active===true;}});}
  async function saveWelcome(){const msg=document.getElementById('adminWelcomeMsg'),btn=document.getElementById('adminWelcomeSave');if(!session||session.role!=='admin'){msg.textContent='Cette action est réservée aux administrateurs.';msg.className='form-msg err';return;}const title=document.getElementById('adminWelcomeTitle').value.trim()||'Bienvenue sur Aurore',message=document.getElementById('adminWelcomeMessage').value.trim(),active=document.getElementById('adminWelcomeActive').checked;if(!message){msg.textContent='Veuillez renseigner le message de bienvenue avant de continuer.';msg.className='form-msg err';return;}btn.disabled=true;try{const payload={id:1,title,message,active,updated_at:new Date().toISOString()};let r=await fetch(`${SUPABASE_URL}/rest/v1/${WELCOME_TABLE}?id=eq.1`,{method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(payload)});if(!r.ok)throw new Error('HTTP '+r.status+' — '+await r.text());let body=await r.text().catch(()=> '');if(body===''||body==='[]'){const q=await fetch(`${SUPABASE_URL}/rest/v1/${WELCOME_TABLE}`,{method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify(payload)});if(!q.ok)throw new Error('HTTP '+q.status+' — '+await q.text());}msg.textContent='Le message de bienvenue a été enregistré avec succès.';msg.className='form-msg ok';}catch(e){msg.textContent='Impossible d’enregistrer le message pour le moment. Veuillez réessayer.';msg.className='form-msg err';}finally{btn.disabled=false;}}
  initialiserEditeurBienvenueAdmin();document.querySelectorAll('.admin-tab').forEach(t=>t.addEventListener('click',()=>{if(t.dataset.tab==='videos')chargerVideosAdmin();if(t.dataset.tab==='annonce')initialiserEditeurBienvenueAdmin();}));chargerVideosAccueil();

