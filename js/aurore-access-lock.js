(function(){
  const lock=document.getElementById('accessLock');
  const google=document.getElementById('accessGoogleBtn');
  const visitor=document.getElementById('accessVisitorBtn');
  const signupOpen=document.getElementById('accessSignupBtn');
  const modal=document.getElementById('signupModal');
  const close=document.getElementById('signupClose');
  const form=document.getElementById('signupForm');
  const loginForm=document.getElementById('loginForm');
  const showLoginBtn=document.getElementById('showLoginBtn');
  const backSignupBtn=document.getElementById('backSignupBtn');
  const loginSwitch=document.getElementById('accountLoginSwitch');
  const resend=document.getElementById('signupResend');
  const resendWrap=document.getElementById('signupResendWrap');
  const resendCountdown=document.getElementById('signupResendCountdown');
  let dernierEmailInscription='';
  let resendTimer=null;
  let resendSecondesRestantes=0;
  const msg=document.getElementById('signupMessage');
  const loginMsg=document.getElementById('loginMessage');
  const accessMessage=document.getElementById('accessMessage');
  const redirectConfirmation=()=>window.location.origin+window.location.pathname;
  const authWait=document.getElementById('auroreAuthWait');
  const authWaitText=document.getElementById('auroreAuthWaitText');
  let auroreAuthWaitSafetyTimer=null;
  function afficherVeuillezPatienter(texte='Aurore prépare votre espace…'){
    if(authWaitText)authWaitText.textContent=texte;
    if(authWait){
      authWait.classList.add('show');
      authWait.setAttribute('aria-hidden','false');
    }
    clearTimeout(auroreAuthWaitSafetyTimer);
    // Filet de sécurité : une erreur réseau ou JS inattendue ne doit jamais
    // laisser l'écran de connexion couvert indéfiniment (impression de page blanche).
    auroreAuthWaitSafetyTimer=setTimeout(()=>{
      if(authWait?.classList.contains('show')){
        cacherVeuillezPatienter();
        const m=document.getElementById('accessMessage');
        if(m){
          m.textContent='La connexion prend plus de temps que prévu. Vous pouvez réessayer sans recharger la page.';
          m.className='access-message err';
          m.style.display='block';
        }
      }
    },12000);
  }
  function cacherVeuillezPatienter(){
    clearTimeout(auroreAuthWaitSafetyTimer);
    auroreAuthWaitSafetyTimer=null;
    if(authWait){authWait.classList.remove('show');authWait.setAttribute('aria-hidden','true');}
  }
  window.auroreAfficherVeuillezPatienter=afficherVeuillezPatienter;
  window.auroreCacherVeuillezPatienter=cacherVeuillezPatienter;

  function afficherMessageInscription(texte,type='ok'){
    msg.textContent=texte;
    msg.className='access-message '+type;
    msg.style.display='block';
  }

  function demarrerCompteAReboursResend(secondes=60){
    if(!resend || !resendCountdown) return;
    if(resendTimer) clearInterval(resendTimer);
    resendSecondesRestantes=Math.max(1,Number(secondes)||60);
    resend.disabled=true;
    resend.classList.add('is-counting');
    if(resendWrap) resendWrap.style.display='grid';
    resendCountdown.style.display='block';
    const afficher=()=>{
      if(resendSecondesRestantes>0){
        resend.textContent=`Renvoyer dans ${resendSecondesRestantes}s`;
        resendCountdown.textContent=`Nouveau renvoi disponible dans ${resendSecondesRestantes} seconde${resendSecondesRestantes>1?'s':''}`;
      }else{
        arreterCompteAReboursResend();
      }
    };
    afficher();
    resendTimer=setInterval(()=>{resendSecondesRestantes--;afficher();},1000);
  }

  function arreterCompteAReboursResend(){
    if(resendTimer) clearInterval(resendTimer);
    resendTimer=null; resendSecondesRestantes=0;
    if(resend){ resend.disabled=false; resend.classList.remove('is-counting'); resend.textContent='Renvoyer l’e-mail de confirmation'; }
    if(resendCountdown){ resendCountdown.style.display='block'; resendCountdown.textContent='Vous pouvez demander un nouvel e-mail de confirmation.'; }
  }

  function afficherModeConnexionEmail(){ form.style.display='none'; loginForm.style.display='grid'; loginSwitch.style.display='none'; setTimeout(()=>document.getElementById('loginEmail')?.focus(),50); }
  function afficherModeInscription(){ form.style.display='grid'; loginForm.style.display='none'; loginSwitch.style.display='flex'; if(resendWrap) resendWrap.style.display=dernierEmailInscription?'grid':'none'; }
  function unlock(){ document.body.classList.remove('site-locked'); if(lock) lock.style.display='none'; }
  window.auroreUnlockAccess=unlock;
  visitor?.addEventListener('click',()=>{ try{localStorage.setItem('aurore_visitor_mode','1');}catch(e){} unlock(); });
  google?.addEventListener('click',async()=>{
    if (google.classList.contains('is-loading')) return;
    // Le bloc est également affiché directement dans le portail d'accès.
    // Cela garantit que l'utilisateur le voit avant la redirection vers Google,
    // même lorsque le navigateur quitte la page très rapidement.
    afficherVeuillezPatienter('Connexion sécurisée avec Google…');
    if(accessMessage){
      accessMessage.textContent='Veuillez patienter — connexion sécurisée avec Google en cours…';
      accessMessage.className='access-message ok';
      accessMessage.style.display='block';
    }
    google.classList.add('is-loading');
    const strong = google.querySelector('strong'); if (strong) strong.textContent = 'Connexion à Google…';
    // Ne pas retarder la redirection OAuth : sur mobile, chaque délai supplémentaire
    // augmente le risque que le navigateur suspende la page avant la redirection.
    if(typeof demarrerConnexionGoogle==='function') { try { await demarrerConnexionGoogle(); } catch (err) { console.error('[Google OAuth]', err); window.auroreAfficherErreurDebug?.('[Bouton Google — accès] ' + (err?.message || err)); } } else { window.auroreAfficherErreurDebug?.('[Bouton Google — accès] demarrerConnexionGoogle est introuvable (script non chargé ?)'); }
  });
  signupOpen?.addEventListener('click',()=>{modal.style.display='flex';modal.setAttribute('aria-hidden','false');afficherModeInscription();setTimeout(()=>document.getElementById('signupName')?.focus(),50);});
  showLoginBtn?.addEventListener('click',afficherModeConnexionEmail);
  backSignupBtn?.addEventListener('click',afficherModeInscription);
  function fermer(){modal.style.display='none';modal.setAttribute('aria-hidden','true');msg.style.display='none';loginMsg.style.display='none';}
  close?.addEventListener('click',fermer); modal?.addEventListener('click',e=>{if(e.target===modal)fermer();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal?.style.display!=='none')fermer();});
  resend?.addEventListener('click',async ()=>{
    const email=(dernierEmailInscription||document.getElementById('signupEmail')?.value||'').trim();
    if(!email){
      afficherMessageInscription('Saisissez votre adresse e-mail pour renvoyer le message de confirmation.','err');
      return;
    }
    if(resend.disabled) return;
    dernierEmailInscription=email;
    if(resendWrap) resendWrap.style.display='grid';
    resend.disabled=true; resend.textContent='Envoi de l’e-mail…'; msg.style.display='none';
    try{
      const r=await fetch(`${SUPABASE_URL}/auth/v1/resend`,{
        method:'POST',
        headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({type:'signup',email,options:{emailRedirectTo:redirectConfirmation()}})
      });
      const raw=await r.text(); let d={};
      try{d=raw?JSON.parse(raw):{}}catch(_){d={message:raw}}
      if(!r.ok){
        const detail=d.msg||d.error_description||d.message||raw||('HTTP '+r.status);
        if(r.status===429){ afficherMessageInscription('Trop de demandes. Pour protéger votre compte, patientez 60 secondes avant de demander un nouveau message.','err'); if(resendWrap) resendWrap.style.display='grid'; demarrerCompteAReboursResend(60); return; }
        if(r.status===422 && /already|confirm/i.test(detail)) throw new Error('Cette adresse e-mail est peut-être déjà confirmée. Connectez-vous pour accéder à votre espace.');
        throw new Error(detail);
      }
      afficherMessageInscription('E-mail de confirmation renvoyé. Vérifiez votre boîte de réception et les courriers indésirables.','ok');
      demarrerCompteAReboursResend(60);
    }catch(e){
      afficherMessageInscription('Impossible de renvoyer l’e-mail : '+(e.message||'erreur inconnue'),'err');
      arreterCompteAReboursResend();
    }
  });

  loginForm?.addEventListener('submit',async e=>{
    e.preventDefault(); loginMsg.style.display='none';
    const email=document.getElementById('loginEmail').value.trim(), password=document.getElementById('loginPassword').value, btn=document.getElementById('loginSubmit');
    btn.disabled=true; btn.textContent='Connexion en cours…';
    // Affiche le bloc d'attente avant toute opération réseau. Le navigateur
    // dispose ainsi d'un cycle de rendu pour l'afficher même si Supabase répond lentement.
    afficherVeuillezPatienter('Connexion à Aurore en cours…');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{
      const r=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
      const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error_description||d.msg||d.message||'Identifiants invalides.');
      const infos=await recupererUtilisateur(d.access_token); if(!infos) throw new Error('Impossible de charger votre profil.');
      if(infos.banni===true) throw new Error('Votre compte a été suspendu par l’administration. Contactez le service client si vous pensez qu’il s’agit d’une erreur.');
      const role=await assurerProfilEtObtenirRole(d.access_token,infos);
      session={access_token:d.access_token,refresh_token:d.refresh_token||null,expires_at:Date.now()+((d.expires_in||3600)*1000),id:infos.id,email:infos.email,nom:infos.nom,avatar:infos.avatar,prenom:infos.prenom||'',lycee:infos.lycee||'',niveau:infos.niveau||'',classe:infos.classe||'',filiere:infos.filiere||'',discipline:infos.discipline||'',fonction:infos.fonction||'',enfant_informations:infos.enfant_informations||'',banni:infos.banni===true,provider:infos.provider||'E-mail',role};
      sauvegarderSession();
      // L'enregistrement statistique d'une connexion ne doit jamais ralentir
      // l'ouverture du site : il est volontairement lancé en arrière-plan.
      enregistrerConnexion(session).catch(()=>{});
      afficherUtilisateurConnecte(); unlock(); fermer();
      if(profilEstComplet(session)) afficherBienvenueApresConnexion(session); else ouvrirEspacePersonnelObligatoire();
    }catch(err){loginMsg.textContent=err.message||'Impossible de vous connecter.';loginMsg.className='access-message err';loginMsg.style.display='block';}
    finally{cacherVeuillezPatienter();btn.disabled=false;btn.textContent='SE CONNECTER';}
  });

  form?.addEventListener('submit',async e=>{
    e.preventDefault(); const name=document.getElementById('signupName').value.trim(),email=document.getElementById('signupEmail').value.trim(),p=document.getElementById('signupPassword').value,p2=document.getElementById('signupPasswordConfirm').value,btn=document.getElementById('signupSubmit');
    msg.style.display='none'; if(p!==p2){msg.textContent='Les deux mots de passe ne correspondent pas.';msg.className='access-message err';msg.style.display='block';return;} if(p.length<8){msg.textContent='Le mot de passe doit contenir au moins 8 caractères.';msg.className='access-message err';msg.style.display='block';return;}
    btn.disabled=true;btn.textContent='Création en cours…';
    afficherVeuillezPatienter('Création de votre espace en cours…');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{
      const r=await fetch(`${SUPABASE_URL}/auth/v1/signup`,{method:'POST',headers:{'apikey':SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:p,data:{full_name:name,name},options:{emailRedirectTo:redirectConfirmation()}})}); const d=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(d.msg||d.error_description||d.message||('HTTP '+r.status));
      if(d.access_token){
        const infos=await recupererUtilisateur(d.access_token); if(infos){const role=await assurerProfilEtObtenirRole(d.access_token,infos);session={access_token:d.access_token,refresh_token:d.refresh_token||null,expires_at:Date.now()+((d.expires_in||3600)*1000),id:infos.id,email:infos.email,nom:infos.nom,avatar:infos.avatar,prenom:infos.prenom||'',lycee:infos.lycee||'',niveau:infos.niveau||'',classe:infos.classe||'',filiere:infos.filiere||'',discipline:infos.discipline||'',fonction:infos.fonction||'',enfant_informations:infos.enfant_informations||'',provider:infos.provider||'E-mail',role};sauvegarderSession();enregistrerConnexion(session);afficherUtilisateurConnecte();unlock();fermer();ouvrirEspacePersonnelObligatoire();}
      } else {dernierEmailInscription=email;if(resendWrap) resendWrap.style.display='grid';msg.textContent='Compte créé. Consultez votre e-mail pour confirmer votre adresse avant de vous connecter. Vérifiez aussi les courriers indésirables.';msg.className='access-message ok';msg.style.display='block';}
    }catch(err){msg.textContent='Impossible de créer le compte : '+(err.message||'vérifiez les informations saisies.');msg.className='access-message err';msg.style.display='block';}
    finally{cacherVeuillezPatienter();btn.disabled=false;btn.textContent='CRÉER MON COMPTE';}
  });
})();
