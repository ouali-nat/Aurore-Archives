  async function chargerPublicitesAdmin(){
    const list=document.getElementById('pubAdminList');
    if(!list) return;
    list.innerHTML='<div class="pub-admin-empty">Chargement…</div>';
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?select=*&order=updated_at.desc`,{headers:headersAdmin()});
      if(!res.ok) throw new Error('Impossible de charger les publicités (HTTP '+res.status+').');
      const ads=await res.json();
      rendreListeAdminPublicites(ads);
      const tabCount=document.getElementById('tabCountPubs');
      if(tabCount) tabCount.textContent=String(ads.length);
    }catch(e){ list.innerHTML=`<div class="pub-admin-empty">${messageErreurPublicite(e,'liste admin')}</div>`; }
  }

  function rendreListeAdminPublicites(ads){
    const list=document.getElementById('pubAdminList');
    if(!list) return;
    if(!ads.length){ list.innerHTML='<div class="pub-admin-empty">Aucune publicité pour le moment.</div>'; return; }
    list.innerHTML='';
    ads.forEach(ad=>{
      const titre = ad.alt_text || '(sans titre)';
      const item=document.createElement('div');
      item.className='pub-admin-item';
      item.innerHTML = `
        <img src="${echapperHtmlPub(ad.image_url||'')}" alt="" loading="lazy" decoding="async">
        <div class="pub-admin-item-body">
          <div class="pub-admin-item-title">${echapperHtmlPub(titre)}</div>
          ${ad.description ? `<div class="pub-admin-item-desc">${echapperHtmlPub(ad.description)}</div>` : ''}
          <div class="pub-admin-item-status ${ad.active?'on':'off'}">${ad.active?'● Active':'○ Désactivée'}</div>
        </div>
        <div class="pub-admin-item-actions">
          <button type="button" data-action="edit">Modifier</button>
          <button type="button" data-action="toggle">${ad.active?'Désactiver':'Activer'}</button>
          <button type="button" class="danger" data-action="delete">Supprimer</button>
        </div>`;
      item.querySelector('[data-action="edit"]').addEventListener('click',()=>commencerModificationPublicite(ad));
      item.querySelector('[data-action="toggle"]').addEventListener('click',()=>basculerActivationPublicite(ad));
      item.querySelector('[data-action="delete"]').addEventListener('click',()=>supprimerPublicite(ad));
      list.appendChild(item);
    });
  }

  function commencerModificationPublicite(ad){
    document.getElementById('adminPromoEditId').value=ad.id;
    document.getElementById('adminPromoAltInput').value=ad.alt_text||'';
    document.getElementById('adminPromoLinkInput').value=ad.link_url||'';
    const descInput=document.getElementById('adminPromoDescInput');
    if(descInput) descInput.value=ad.description||'';
    const preview=document.getElementById('adminPromoPreview');
    preview.innerHTML = ad.image_url ? `<img src="${echapperHtmlPub(ad.image_url)}" alt="" loading="lazy" decoding="async">` : '<span>Aucune image sélectionnée.</span>';
    const note=document.getElementById('adminPromoFileNote');
    if(note) note.textContent='(laisser vide pour conserver l’image actuelle)';
    document.getElementById('adminPromoSave').textContent='Enregistrer les modifications';
    document.getElementById('adminPromoCancelEdit').style.display='inline-flex';
    document.getElementById('adminPromoMsg').textContent='';
    document.querySelector('.admin-promo-manager')?.scrollIntoView({behavior:'smooth', block:'start'});
  }

  function annulerModificationPublicite(){
    document.getElementById('adminPromoEditId').value='';
    document.getElementById('adminPromoAltInput').value='';
    document.getElementById('adminPromoLinkInput').value='';
    const descInput=document.getElementById('adminPromoDescInput');
    if(descInput) descInput.value='';
    const fileInput=document.getElementById('adminPromoFile');
    if(fileInput) fileInput.value='';
    const note=document.getElementById('adminPromoFileNote');
    if(note) note.textContent='';
    document.getElementById('adminPromoPreview').innerHTML='<span>Aucune image sélectionnée.</span>';
    document.getElementById('adminPromoSave').textContent='Ajouter la publicité';
    document.getElementById('adminPromoCancelEdit').style.display='none';
    document.getElementById('adminPromoMsg').textContent='';
  }

  async function enregistrerPublicite(){
    const editId=document.getElementById('adminPromoEditId')?.value||null;
    const file=document.getElementById('adminPromoFile')?.files?.[0]||null;
    const altText=document.getElementById('adminPromoAltInput')?.value.trim()||'';
    const link=document.getElementById('adminPromoLinkInput')?.value.trim()||null;
    const description=document.getElementById('adminPromoDescInput')?.value.trim()||null;
    const msg=document.getElementById('adminPromoMsg');
    const btn=document.getElementById('adminPromoSave');

    if(!editId && !file){ msg.textContent='Veuillez sélectionner une image avant de continuer.'; msg.className='form-msg err'; return; }
    if(file && !['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)){ msg.textContent='Ce format d’image n’est pas pris en charge. Utilisez PNG, JPEG, WEBP ou GIF.'; msg.className='form-msg err'; return; }
    if(file && file.size>8*1024*1024){ msg.textContent='Cette image dépasse la taille maximale autorisée de 8 Mo.'; msg.className='form-msg err'; return; }
    if(!altText){ msg.textContent='Veuillez renseigner un titre pour continuer.'; msg.className='form-msg err'; return; }

    btn.disabled=true; btn.textContent='Enregistrement en cours…';
    msg.textContent='Enregistrement en cours…'; msg.className='form-msg';
    try{
      let imageUrl=null;
      if(file){
        const name='vitrine_'+Date.now()+'_'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        // En-têtes volontairement identiques à ceux du dépôt PDF (qui fonctionne) :
        // uniquement Content-Type, sans en-tête personnalisé supplémentaire (pré-vérification
        // CORS non satisfaite par le Worker sinon). Le Worker "lsnb-pdf-worker-v2" n'est pas modifié.
        const up=await fetch(`${R2_WORKER_URL}/${name}`,{method:'PUT',headers:{'Content-Type':file.type},body:file});
        const body=await up.text().catch(()=> '');
        if(!up.ok) throw new Error('Le stockage a refusé l’image (HTTP '+up.status+'). '+body);
        imageUrl=`${R2_PUBLIC_URL}/${name}`;
      }

      // Prefer: return=minimal partout (une lecture après écriture peut être bloquée par
      // les policies RLS selon le rôle connecté — voir la note de diagnostic historique).
      // Colonnes réelles de public."Publicites" : alt_text, link_url, image_url, active,
      // et désormais "description" (colonne déjà créée précédemment en base).
      const payload={ alt_text:altText, link_url:link, description:description };
      if(imageUrl) payload.image_url=imageUrl;
      console.log('[Publicité][ADMIN] Payload envoyé à Supabase :', payload);

      if(editId){
        const res=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?id=eq.${encodeURIComponent(editId)}`,{
          method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},
          body:JSON.stringify(payload)
        });
        if(!res.ok){ const rb=await res.text().catch(()=> ''); throw new Error(`Impossible de modifier la publicité (HTTP ${res.status}) : ${rb}`); }
        msg.textContent='La publicité a été mise à jour avec succès.'; msg.className='form-msg ok';
      }else{
        payload.active=true;
        const res=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}`,{
          method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},
          body:JSON.stringify(payload)
        });
        if(!res.ok){ const rb=await res.text().catch(()=> ''); throw new Error(`Impossible d'enregistrer la publicité (HTTP ${res.status}) : ${rb}`); }
        msg.textContent='La publicité a été ajoutée avec succès.'; msg.className='form-msg ok';
      }
      // L'INSERT/PATCH est confirmé réussi ici. Tout ce qui suit (rafraîchir la liste
      // admin, tenter de recharger l'affichage public à titre de diagnostic) est isolé
      // dans son propre try/catch : une erreur là-dedans ne doit plus jamais écraser le
      // message de succès ci-dessus ni faire croire à un échec de l'enregistrement.
      annulerModificationPublicite();
      try{
        await chargerPublicitesAdmin();
      }catch(e2){ console.error('[Publicité][ADMIN] Rafraîchissement de la liste admin échoué (sans impact sur l\'enregistrement, déjà confirmé) :', e2); }
      try{
        await chargerAnnoncesActives();
      }catch(e2){ console.error('[Publicité][ADMIN] Rafraîchissement de l\'affichage public échoué (sans impact sur l\'enregistrement, déjà confirmé) :', e2); }
    }catch(e){
      msg.textContent=messageErreurPublicite(e,'enregistrement'); msg.className='form-msg err';
    }finally{
      btn.disabled=false;
      btn.textContent = document.getElementById('adminPromoEditId')?.value ? 'Enregistrer les modifications' : 'Ajouter la publicité';
    }
  }

  async function basculerActivationPublicite(ad){
    const msg=document.getElementById('adminPromoMsg');
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?id=eq.${encodeURIComponent(ad.id)}`,{
        method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},
        body:JSON.stringify({active:!ad.active})
      });
      if(!res.ok) throw new Error('Échec de la mise à jour (HTTP '+res.status+').');
      await chargerPublicitesAdmin();
      await chargerAnnoncesActives();
    }catch(e){ if(msg){ msg.textContent=messageErreurPublicite(e,'activation'); msg.className='form-msg err'; } }
  }

  async function supprimerPublicite(ad){
    if(!confirm('Supprimer cette publicité ?')) return;
    const msg=document.getElementById('adminPromoMsg');
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?id=eq.${encodeURIComponent(ad.id)}`,{method:'DELETE',headers:headersAdmin()});
      if(!res.ok) throw new Error('Échec de la suppression (HTTP '+res.status+').');
      await chargerPublicitesAdmin();
      await chargerAnnoncesActives();
    }catch(e){ if(msg){ msg.textContent=messageErreurPublicite(e,'suppression'); msg.className='form-msg err'; } }
  }

