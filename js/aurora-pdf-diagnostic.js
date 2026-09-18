
(function(){
  'use strict';
  const panel=document.querySelector('.admin-tab-panel[data-panel="diagnostic-pdf"]');
  if(!panel)return;

  const SUPA=()=>typeof SUPABASE_URL!=='undefined'?SUPABASE_URL:'';
  const ANON=()=>typeof SUPABASE_ANON_KEY!=='undefined'?SUPABASE_ANON_KEY:'';
  const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML};
  const isAdmin=()=>!!(typeof session!=='undefined'&&session&&session.role==='admin');
  const icon={ok:'🟢',warn:'🟡',fail:'🔴',pending:'⚪'};
  let rows={};
  let journal=[];
  let diagId=null;

  const tests=[
    ['browser','Navigateur / réseau'],
    ['session','Session Supabase'],
    ['jwt','JWT utilisateur'],
    ['document','Document Supabase'],
    ['renderer_gateway','Passerelle renderer PDF'],
    ['renderer_auth','Authentification renderer'],
    ['renderer_reception','Réception par le renderer'],
    ['renderer_stage','Étape interne du renderer'],
    ['geogebra','GeoGebra'],
    ['pdf_save','Construction / sauvegarde PDF'],
    ['storage','Storage — bucket Pdfs'],
    ['database','Mise à jour Supabase'],
    ['diagnostic','Diagnostic serveur PDF']
  ];

  function now(){
    return new Date().toLocaleTimeString('fr-FR',{hour12:false});
  }
  function newId(){
    const d=new Date(),p=n=>String(n).padStart(2,'0');
    const h=d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
    const r=Math.random().toString(16).slice(2,8).toUpperCase();
    return 'PDF-'+h+'-'+r;
  }
  function log(s){
    journal.push(now()+' — '+s);
    const el=document.getElementById('pdfDiagLog');
    if(el)el.textContent=journal.join('\n');
  }
  function setRow(id,state,msg,detail){
    rows[id]={state,msg,detail,time:now()};
    const host=document.getElementById('pdfDiagRows');
    if(!host)return;
    host.innerHTML=tests.map(([k,label])=>{
      const r=rows[k]||{state:'pending',msg:'Non testé.'};
      return `<div class="diag-row" data-state="${r.state}">
        <div class="diag-row-top">
          <span class="diag-row-icon">${icon[r.state]||icon.pending}</span>
          <span class="diag-row-name">${esc(label)}</span>
          <span class="diag-row-time">${esc(r.time||'')}</span>
        </div>
        <div class="diag-row-msg">${esc(r.msg||'')}</div>
        ${r.detail?`<button type="button" class="diag-row-detail-toggle" data-pdfdiag-detail="${esc(k)}">Détails techniques</button><div class="diag-row-detail" data-pdfdiag-detail-box="${esc(k)}">${esc(r.detail)}</div>`:''}
      </div>`;
    }).join('');
    updateBadge();
  }
  function reset(){
    rows={};
    tests.forEach(([k])=>setRow(k,'pending','Non testé.'));
    const s=document.getElementById('pdfDiagSummary');
    if(s)s.style.display='none';
  }
  function updateBadge(){
    const b=document.getElementById('pdfDiagBadge');
    if(!b)return;
    const states=tests.map(([k])=>(rows[k]||{}).state||'pending');
    if(states.every(s=>s==='pending')){b.dataset.state='pending';b.textContent='⚪ Non testé';}
    else if(states.includes('fail')){b.dataset.state='fail';b.textContent='🔴 Bloqué';}
    else if(states.includes('warn')||states.includes('pending')){b.dataset.state='warn';b.textContent='🟡 Diagnostic partiel';}
    else{b.dataset.state='ok';b.textContent='🟢 Circuit PDF accessible';}
  }
  function msg(text,cls){
    const el=document.getElementById('pdfDiagMsg');
    if(!el)return;
    el.style.display='block';
    el.className='form-msg'+(cls?' '+cls:'');
    el.textContent=text;
  }
  function setId(){
    const el=document.getElementById('pdfDiagId');
    const id=document.getElementById('pdfDiagDocument')?.value||'';
    if(el)el.textContent='Diagnostic PDF : '+diagId+' — document #'+id+' — endpoint : '+SUPA()+'/functions/v1/aurora-content-renderer-ggb';
  }
  function headers(token){
    return {'apikey':ANON(),'Authorization':'Bearer '+token,'Content-Type':'application/json'};
  }
  async function getAuth(){
    if(typeof assurerClientAuthGoogle==='function'){
      const c=await assurerClientAuthGoogle();
      if(c){
        const {data,error}=await c.auth.getSession();
        if(error)throw error;
        if(data?.session?.access_token)return data.session;
      }
    }
    if(typeof session!=='undefined'&&session?.access_token)return {
      access_token:session.access_token,
      refresh_token:session.refresh_token||null,
      expires_at:session.expires_at?Math.floor(session.expires_at/1000):null,
      user:{id:session.id,email:session.email}
    };
    return null;
  }
  async function readResponse(r){
    const text=await r.text();
    let data=null;
    try{data=text?JSON.parse(text):null}catch(_){}
    return {text,data,status:r.status,headers:[...r.headers.entries()]};
  }
  function responseDetail(x){
    const body=x.data?JSON.stringify(x.data,null,2):x.text;
    return 'HTTP '+x.status+'\n\n'+(body||'(corps vide)');
  }
  function classifyRendererProbe(x){
    if(x.status===401){
      const body=x.data?.message||x.data?.error||x.text||'';
      if(/invalid jwt|jwt|unauthoriz|token/i.test(String(body))){
        return ['fail','401 : JWT refusé par la passerelle Supabase ou par l’authentification du renderer.',responseDetail(x)];
      }
      return ['fail','401 : authentification refusée. Le corps exact est conservé ci-dessous.',responseDetail(x)];
    }
    if(x.status===403)return ['fail','403 : accès interdit. Le jeton est reconnu mais l’autorisation est refusée.',responseDetail(x)];
    if(x.status>=200&&x.status<300)return ['ok','Le renderer accepte la requête de diagnostic.',responseDetail(x)];
    if(x.status===400||x.status===404||x.status===422)return ['ok','Le renderer a répondu sans 401 : la requête atteint bien la fonction. Le corps indique ensuite la validation attendue.',responseDetail(x)];
    if(x.status>=500)return ['warn','Le renderer est atteint mais renvoie une erreur serveur. Le diagnostic interne doit être lu dans la réponse et/ou les journaux.',responseDetail(x)];
    return ['warn','Réponse HTTP inattendue ; voir le corps exact.',responseDetail(x)];
  }

  async function run(){
    if(!isAdmin()){msg('Cette action est réservée aux administrateurs.','err');return;}
    diagId=newId();journal=[];setId();reset();msg('Diagnostic PDF en cours…','');
    const id=Number(document.getElementById('pdfDiagDocument')?.value||16);
    log('Diagnostic démarré — '+diagId+' — document #'+id);

    // 1. Browser / network
    if(navigator.onLine){
      setRow('browser','ok','Navigateur en ligne.', 'navigator.onLine=true');
      log('Navigateur : en ligne');
    }else{
      setRow('browser','fail','Le navigateur signale une absence de connexion.','navigator.onLine=false');
      log('Échec : navigateur hors ligne');
      msg('Diagnostic arrêté : navigateur hors ligne.','err');return;
    }

    // 2. Auth session
    let auth=null;
    try{
      auth=await getAuth();
      if(!auth)throw new Error('Aucune session Supabase active.');
      const uid=auth.user?.id||session?.id||'inconnu';
      setRow('session','ok','Session Supabase active.','user_id='+uid+'\nemail='+(auth.user?.email||session?.email||'non exposé'));
      log('Session Supabase : OK');
    }catch(e){
      setRow('session','fail','Impossible d’obtenir la session Supabase.',String(e?.message||e));
      ['jwt','document','renderer_gateway','renderer_auth','renderer_reception','renderer_stage','geogebra','pdf_save','storage','database','diagnostic'].forEach(k=>setRow(k,'pending','Non testé — session indisponible.'));
      log('Échec session : '+(e?.message||e));
      msg('PROBLÈME AUTH — aucune session Supabase exploitable.','err');return;
    }

    // 3. JWT
    const token=auth.access_token;
    if(!token){
      setRow('jwt','fail','Aucun access_token utilisateur disponible.','La clé anon n’est pas un JWT utilisateur et ne doit pas remplacer Authorization Bearer.');
      ['document','renderer_gateway','renderer_auth','renderer_reception','renderer_stage','geogebra','pdf_save','storage','database','diagnostic'].forEach(k=>setRow(k,'pending','Non testé — JWT absent.'));
      log('Échec JWT : access_token absent');
      msg('PROBLÈME AUTH — aucun JWT utilisateur valide à envoyer.','err');return;
    }
    const tokenParts=String(token).split('.');
    setRow('jwt',tokenParts.length===3?'ok':'warn',tokenParts.length===3?'JWT utilisateur présent.':'Un token est présent mais sa forme est inhabituelle.','segments='+tokenParts.length+'\nexp='+((auth.expires_at||0)?new Date(Number(auth.expires_at)*1000).toISOString():'non disponible'));
    log('JWT utilisateur : présent');

    // 4. DB document
    let doc=null;
    try{
      const u=SUPA()+'/rest/v1/aurora_generated_documents?select=id,title,status,pdf_path,pdf_url,metadata,pdf_diagnostic,updated_at&id=eq.'+encodeURIComponent(id);
      const r=await fetch(u,{headers:{'apikey':ANON(),'Authorization':'Bearer '+token},cache:'no-store'});
      const x=await readResponse(r);
      if(!r.ok)throw new Error(responseDetail(x));
      const a=Array.isArray(x.data)?x.data:[];
      doc=a[0]||null;
      if(!doc)throw new Error('Document #'+id+' introuvable dans aurora_generated_documents.');
      const md=doc.metadata&&typeof doc.metadata==='object'?doc.metadata:{};
      const detail=JSON.stringify({
        id:doc.id,title:doc.title,status:doc.status,pdf_path:doc.pdf_path||null,pdf_url:doc.pdf_url||null,
        pdf_render:md.pdf_render??null,pdf_diagnostic:doc.pdf_diagnostic??null,updated_at:doc.updated_at||null
      },null,2);
      setRow('document','ok','Document #'+id+' trouvé dans Supabase.',detail);
      log('Document #'+id+' : trouvé');
    }catch(e){
      setRow('document','fail','Lecture du document impossible.',String(e?.message||e));
      ['renderer_gateway','renderer_auth','renderer_reception','renderer_stage','geogebra','pdf_save','storage','database','diagnostic'].forEach(k=>setRow(k,'pending','Non testé — document inaccessible.'));
      log('Échec lecture document : '+(e?.message||e));
      msg('PROBLÈME SUPABASE — impossible de lire le document sélectionné.','err');return;
    }

    // 5. Critical auth/gateway probe: POST invalid/non-rendering id.
    // This intentionally uses a non-existent document id so the function can
    // prove whether the JWT passes the gateway without starting a PDF build.
    try{
      const probeId=0;
      const t0=performance.now();
      const r=await fetch(SUPA()+'/functions/v1/aurora-content-renderer-ggb',{
        method:'POST',headers:headers(token),body:JSON.stringify({generated_document_id:probeId,diagnostic_probe:true})
      });
      const x=await readResponse(r);
      const ms=Math.round(performance.now()-t0);
      const c=classifyRendererProbe(x);
      setRow('renderer_gateway',c[0],c[1]+' ('+ms+' ms)',c[2]);
      log('Probe renderer sans rendu — HTTP '+x.status+' — '+ms+' ms');
      if(c[0]==='fail'){
        ['renderer_auth','renderer_reception','renderer_stage','geogebra','pdf_save','storage','database','diagnostic'].forEach(k=>setRow(k,'pending','Non testé — la passerelle/authentification bloque avant le rendu.'));
        msg('PROBLÈME AUTH / GATEWAY — le renderer PDF n’accepte pas le JWT. Le rendu réel n’a pas été lancé.','err');return;
      }
      setRow('renderer_auth','ok','Le JWT a franchi la passerelle Supabase.','Le probe a reçu une réponse autre que 401.');
      setRow('renderer_reception','ok','La requête atteint le renderer PDF.','Le corps HTTP ci-dessus permet d’identifier la validation exécutée.');
    }catch(e){
      setRow('renderer_gateway','fail','Impossible d’appeler le endpoint renderer.',String(e?.message||e));
      ['renderer_auth','renderer_reception','renderer_stage','geogebra','pdf_save','storage','database','diagnostic'].forEach(k=>setRow(k,'pending','Non testé — endpoint inaccessible.'));
      log('Échec réseau renderer : '+(e?.message||e));
      msg('PROBLÈME RÉSEAU / CORS — le endpoint renderer ne peut pas être joint.','err');return;
    }

    // 6. Interpret server-side diagnostic persisted on the document.
    const md=doc.metadata&&typeof doc.metadata==='object'?doc.metadata:{};
    const pr=md.pdf_render;
    const pd=doc.pdf_diagnostic;
    const stage=pd?.stage||pr?.stage||null;
    const version=pd?.version||pr?.version||null;
    const detail=JSON.stringify({pdf_diagnostic:pd||null,metadata_pdf_render:pr||null},null,2);
    if(stage){
      setRow('renderer_stage',stage==='PDF_SAVE_START'||stage==='PDF_SAVE_DONE'?'warn':'ok','Dernière étape PDF connue : '+stage+(version?' — '+version:''),detail);
      log('Dernière étape persistée : '+stage+(version?' — '+version:''));
      setRow('diagnostic','ok','Le document contient un diagnostic serveur exploitable.',detail);
    }else{
      setRow('renderer_stage','warn','Aucune étape de rendu PDF persistée pour ce document.',detail);
      setRow('diagnostic','warn','Pas de diagnostic serveur PDF persistant disponible.',detail);
      log('Aucune étape PDF persistée');
    }

    // 7. GeoGebra auth/prepare, deliberately separate from PDF renderer.
    try{
      const t0=performance.now();
      const r=await fetch(SUPA()+'/functions/v1/aurora-geogebra',{
        method:'POST',headers:headers(token),
        body:JSON.stringify({generated_document_id:id,action:'prepare'})
      });
      const x=await readResponse(r);
      const ms=Math.round(performance.now()-t0);
      if(x.status===401){
        setRow('geogebra','fail','GeoGebra rejette aussi ce JWT (HTTP 401).',responseDetail(x));
      }else if(r.ok||x.status===400||x.status===404||x.status===422){
        const n=Array.isArray(x.data?.graphs)?x.data.graphs.length:null;
        setRow('geogebra','ok','Endpoint GeoGebra joignable'+(n!==null?' — '+n+' graphique(s) détecté(s).':'.'),'HTTP '+x.status+' — '+ms+' ms\n'+(x.data?JSON.stringify(x.data,null,2):x.text));
      }else{
        setRow('geogebra','warn','GeoGebra répond mais avec HTTP '+x.status+'.',responseDetail(x));
      }
      log('GeoGebra — HTTP '+x.status+' — '+ms+' ms');
    }catch(e){
      setRow('geogebra','warn','Test GeoGebra non déterminable.',String(e?.message||e));
      log('GeoGebra : '+(e?.message||e));
    }

    // 8. Existing PDF/storage state (no upload is performed).
    if(doc.pdf_path||doc.pdf_url){
      setRow('storage','ok','Le document possède déjà une référence PDF.',JSON.stringify({pdf_path:doc.pdf_path||null,pdf_url:doc.pdf_url||null},null,2));
      setRow('pdf_save','ok','Un PDF existe déjà selon la base.','Aucun nouveau rendu n’a été lancé par le diagnostic standard.');
      setRow('database','ok','Les colonnes PDF sont renseignées.',JSON.stringify({pdf_path:doc.pdf_path||null,pdf_url:doc.pdf_url||null},null,2));
    }else{
      setRow('storage','warn','Aucun pdf_path/pdf_url actuellement enregistré.','Le diagnostic standard ne téléverse aucun fichier.');
      setRow('pdf_save','warn','Aucun PDF sauvegardé pour ce document.','Le diagnostic standard ne lance pas pdf.save().');
      setRow('database','warn','La base ne contient pas encore de référence PDF.','pdf_path=null et pdf_url=null.');
    }

    // Summary
    const critical=rows.renderer_gateway?.state==='ok'&&rows.renderer_auth?.state==='ok';
    const summary=document.getElementById('pdfDiagSummary');
    if(summary){
      summary.style.display='block';
      summary.innerHTML='<strong>Lecture du diagnostic</strong>\n'+
        (critical
          ? 'Le JWT passe la passerelle du renderer. Un HTTP 401 lors du rendu réel ne vient donc pas du rejet initial de la passerelle ; il faudra examiner la réponse interne du renderer, GeoGebra ou l’étape enregistrée sur le document.'
          : 'Le point critique est situé avant le rendu PDF. Consulte les lignes rouges et ouvre « Détails techniques » : le corps HTTP exact est conservé pour distinguer Invalid JWT, session refusée, CORS, ou erreur serveur.');
    }
    msg(critical?'Diagnostic terminé : la passerelle renderer accepte le JWT. Aucun rendu réel n’a été lancé.':'Diagnostic terminé : un blocage a été isolé. Consulte les détails techniques.','ok');
    log('Diagnostic terminé');
  }

  async function renderReal(){
    if(!isAdmin()){msg('Cette action est réservée aux administrateurs.','err');return;}
    const id=Number(document.getElementById('pdfDiagDocument')?.value||16);
    if(!confirm('Le test de rendu réel va appeler aurora-content-renderer-ggb sur le document #'+id+'. Il peut lancer un vrai rendu PDF et consommer des ressources. Continuer ?'))return;
    diagId=newId();journal=[];setId();reset();msg('Test de rendu réel en cours…','');
    log('Test de rendu réel démarré — '+diagId+' — document #'+id);
    try{
      const auth=await getAuth();
      if(!auth?.access_token)throw new Error('Aucun JWT utilisateur disponible.');
      setRow('session','ok','Session Supabase active.');
      setRow('jwt','ok','JWT utilisateur présent.');
      const t0=performance.now();
      const r=await fetch(SUPA()+'/functions/v1/aurora-content-renderer-ggb',{
        method:'POST',headers:headers(auth.access_token),
        body:JSON.stringify({generated_document_id:id})
      });
      const x=await readResponse(r);
      const ms=Math.round(performance.now()-t0);
      const body=x.data?JSON.stringify(x.data,null,2):x.text;
      if(x.status===401){
        setRow('renderer_gateway','fail','HTTP 401 pendant le rendu réel — le corps exact est ci-dessous.',responseDetail(x));
        setRow('renderer_auth','fail','Le JWT n’est pas accepté à ce stade.',responseDetail(x));
        ['renderer_reception','renderer_stage','pdf_save','storage','database'].forEach(k=>setRow(k,'pending','Non déterminable — HTTP 401.'));
        msg('HTTP 401 ISOLÉ — ouvre « Détails techniques » de la ligne renderer : le corps exact permet de savoir si le rejet vient du gateway ou du code de la fonction.','err');
      }else if(r.ok){
        setRow('renderer_gateway','ok','Renderer accepté — HTTP '+x.status+' ('+ms+' ms).',body);
        setRow('renderer_auth','ok','JWT accepté.');
        setRow('renderer_reception','ok','Requête reçue.');
        setRow('renderer_stage','ok','Rendu réel terminé selon la réponse du renderer.',body);
        setRow('pdf_save','ok','Le renderer a terminé sans erreur HTTP.',body);
        setRow('storage','ok','La réponse indique un rendu terminé ; vérifier pdf_path/pdf_url ci-dessous.',body);
        setRow('database','ok','La réponse du renderer a été reçue.',body);
        msg('Rendu réel terminé avec succès. Actualise Content Factory pour vérifier le PDF.','ok');
      }else{
        setRow('renderer_gateway','ok','Le renderer a répondu sans 401 — HTTP '+x.status+'.',body);
        setRow('renderer_auth','ok','Le JWT a franchi le contrôle d’accès.');
        setRow('renderer_reception','ok','La requête a atteint la fonction.');
        setRow('renderer_stage','warn','Le rendu réel s’est terminé par une erreur HTTP '+x.status+'.',body);
        setRow('pdf_save','warn','La réponse n’autorise pas à conclure que pdf.save() a réussi.',body);
        setRow('storage','pending','Non déterminable.');
        setRow('database','pending','Non déterminable.');
        msg('Le renderer est atteint mais le rendu réel échoue en HTTP '+x.status+'. Consulte le corps exact.','err');
      }
      log('Rendu réel — HTTP '+x.status+' — '+ms+' ms');
    }catch(e){
      setRow('renderer_gateway','fail','Appel du renderer impossible.',String(e?.message||e));
      msg('Échec du test réel : '+(e?.message||e),'err');
      log('Exception : '+(e?.message||e));
    }
  }

  document.getElementById('pdfDiagRun')?.addEventListener('click',run);
  document.getElementById('pdfDiagRender')?.addEventListener('click',renderReal);
  document.getElementById('pdfDiagToggleLog')?.addEventListener('click',()=>{
    const b=document.getElementById('pdfDiagLogBox'); if(b)b.style.display=b.style.display==='none'?'block':'none';
  });
  document.getElementById('pdfDiagCopyLog')?.addEventListener('click',()=>{
    const t=journal.join('\n'); if(navigator.clipboard?.writeText)navigator.clipboard.writeText(t).catch(()=>{});
  });
  document.getElementById('pdfDiagRows')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-pdfdiag-detail]'); if(!b)return;
    const id=b.getAttribute('data-pdfdiag-detail'), box=document.querySelector('[data-pdfdiag-detail-box="'+CSS.escape(id)+'"]');
    if(box)box.classList.toggle('open');
  });
  document.getElementById('pdfDiagDocument')?.addEventListener('change',()=>{
    diagId=null;journal=[];const id=document.getElementById('pdfDiagDocument')?.value||'';const el=document.getElementById('pdfDiagId');if(el)el.textContent='Diagnostic PDF : — (document #'+id+')';reset();
  });
  reset();
})();


/* AURORE_PDF_LAB_V1 */
(function(){
  'use strict';
  function findPdfPanel(){
    return document.querySelector('.admin-tab-panel[data-panel="diagnostic-pdf"]')
      || document.querySelector('[data-panel*="diagnostic"][data-panel*="pdf"]')
      || document.getElementById('pdfDiagRun')?.closest('.admin-tab-panel')
      || document.getElementById('pdfDiagRun')?.closest('section')
      || Array.from(document.querySelectorAll('section,div')).find(el=>/Diagnostic PDF/.test((el.textContent||'').trim()) && el.querySelector('#pdfDiagRun'));
  }
  function mountLab(){
    const panel=findPdfPanel();
    if(!panel) return false;
    const existingLab=document.getElementById('aurorePdfLab');
    const css=document.createElement('link');
  css.rel='stylesheet';
  css.href='./css/aurore-pdf-lab.css';
  document.head.appendChild(css);

  const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML;};
  const supa=()=>typeof SUPABASE_URL!=='undefined'?SUPABASE_URL:'';
  const anon=()=>typeof SUPABASE_ANON_KEY!=='undefined'?SUPABASE_ANON_KEY:'';
  const admin=()=>!!(typeof session!=='undefined'&&session&&session.role==='admin');

  const lab=existingLab||document.createElement('section');
  if(!existingLab){
  lab.className='aurore-pdf-lab';
  lab.id='aurorePdfLab';
  lab.innerHTML=`
    <div class="aurore-pdf-lab-head">
      <div>
        <p class="aurore-pdf-lab-kicker">Laboratoire isolé</p>
        <h3>Laboratoire de rendu PDF</h3>
        <p class="aurore-pdf-lab-intro">Analyse le document avant le rendu pour repérer les corruptions LaTeX, délimiteurs mélangés, caractères de contrôle, formules suspectes et références graphiques. Cette première couche ne remplace ni ne modifie le PDF de production.</p>
      </div>
      <span class="aurore-pdf-lab-status" id="aurorePdfLabStatus">⚪ Prêt</span>
    </div>
    <div class="aurore-pdf-lab-controls">
      <input id="aurorePdfLabDocument" inputmode="numeric" type="number" min="1" placeholder="ID du document, ex. 21" aria-label="ID du document à analyser">
      <button class="primary" id="aurorePdfLabRun" type="button">Analyser le document</button>
      <button id="aurorePdfLabOpen" type="button" disabled>Ouvrir le PDF</button>
    </div>
    <div class="aurore-pdf-lab-grid" id="aurorePdfLabStages"></div>
    <pre class="aurore-pdf-lab-report" id="aurorePdfLabReport" hidden></pre>
    <div class="aurore-pdf-lab-links" id="aurorePdfLabLinks"></div>
    <p class="aurore-pdf-lab-note">Mode actuel : diagnostic non destructif. Aucun fichier, contenu_json, metadata ou PDF existant n'est modifié. Le prochain niveau pourra ajouter le rendu expérimental Browser Rendering dans un endpoint séparé.</p>
  `;

  if(!existingLab){
    const anchor=panel.querySelector('.pdfdiag-controls')||panel.firstElementChild;
    if(anchor&&anchor.parentNode) anchor.parentNode.insertBefore(lab,anchor.nextSibling);
    else panel.appendChild(lab);
  }
  }

  const stageDefs=[
    ['source','Contenu source','Lecture de content_json / source_content'],
    ['delimiters','Délimiteurs LaTeX','Recherche de $, \\( \\), \\[ \\] et incohérences'],
    ['commands','Commandes LaTeX','Recherche de commandes connues comme \\infy, \\mathrm{quad} ou text mathbb'],
    ['controls','Caractères suspects','Détection de caractères de contrôle et séquences inhabituelles'],
    ['formulas','Formules','Comptage et contrôle structurel des champs formula'],
    ['graphs','Graphiques','Présence des références GeoGebra / assets'],
    ['metadata','Diagnostic précédent','Lecture du diagnostic PDF déjà enregistré'],
    ['pdf','PDF existant','Vérification de pdf_path / pdf_url sans régénération']
  ];

  function renderStages(results){
    const host=document.getElementById('aurorePdfLabStages');
    host.innerHTML=stageDefs.map(([id,name])=>{
      const r=results[id]||{state:'pending',detail:'Non testé.'};
      const icon=r.state==='ok'?'🟢':r.state==='warn'?'🟡':r.state==='fail'?'🔴':'⚪';
      return '<div class="aurore-pdf-lab-stage" data-state="'+r.state+'"><div class="aurore-pdf-lab-stage-top"><span class="aurore-pdf-lab-stage-icon">'+icon+'</span><span class="aurore-pdf-lab-stage-name">'+esc(name)+'</span></div><div class="aurore-pdf-lab-stage-detail">'+esc(r.detail)+'</div></div>';
    }).join('');
  }

  function setStatus(state,text){
    const el=document.getElementById('aurorePdfLabStatus');
    if(el){el.dataset.state=state;el.textContent=text;}
  }

  function getToken(){
    return (typeof session!=='undefined'&&session&&session.access_token)?session.access_token:'';
  }

  function walk(value, path, out){
    if(value==null)return;
    if(typeof value==='string'){
      out.push({path,text:value});
      return;
    }
    if(Array.isArray(value)){value.forEach((v,i)=>walk(v,path+'['+i+']',out));return;}
    if(typeof value==='object')Object.keys(value).forEach(k=>walk(value[k],path?path+'.'+k:k,out));
  }

  function auditMath(texts){
    let dollar=0,inlineOpen=0,inlineClose=0,displayOpen=0,displayClose=0;
    let suspicious=[];
    const badCommands=[/\\\\infy\\b/g,/\\\\mathrm\\{quad\\}/g,/\\\\text\\{mathbb\\{R\\}\\}/g,/\\\\text\\{R\\}/g];
    texts.forEach(x=>{
      dollar+=(x.text.match(/\$/g)||[]).length;
      inlineOpen+=(x.text.match(/\\\\\(/g)||[]).length;
      inlineClose+=(x.text.match(/\\\\\)/g)||[]).length;
      displayOpen+=(x.text.match(/\\\\\[/g)||[]).length;
      displayClose+=(x.text.match(/\\\\\]/g)||[]).length;
      badCommands.forEach(re=>{if(re.test(x.text))suspicious.push(x.path+' : '+x.text.slice(0,220));re.lastIndex=0;});
    });
    return {dollar,inlineOpen,inlineClose,displayOpen,displayClose,suspicious};
  }

  async function run(){
    if(!admin()){setStatus('fail','🔴 Réservé aux administrateurs');return;}
    const input=document.getElementById('aurorePdfLabDocument')||document.getElementById('aurorePdfLabId');
    const id=Number(input?.value||0);
    if(!Number.isInteger(id)||id<1){setStatus('warn','🟡 ID requis');return;}
    const token=getToken();
    if(!token){setStatus('fail','🔴 Session absente');return;}

    setStatus('warn','🟡 Analyse en cours…');
    const results={};
    renderStages(results);
    const report=document.getElementById('aurorePdfLabReport');
    report.hidden=false;
    report.textContent='Lecture du document #'+id+'…';
    const openBtn=document.getElementById('aurorePdfLabOpen');
    openBtn.disabled=true;
    document.getElementById('aurorePdfLabLinks').innerHTML='';

    try{
      const url=supa()+'/rest/v1/aurora_generated_documents?select=id,title,status,source_format,source_content,content_json,pdf_path,pdf_url,metadata,pdf_diagnostic,updated_at&id=eq.'+encodeURIComponent(id);
      const r=await fetch(url,{headers:{apikey:anon(),Authorization:'Bearer '+token},cache:'no-store'});
      const body=await r.text();
      let data=null; try{data=body?JSON.parse(body):null;}catch(_){}
      if(!r.ok)throw new Error('HTTP '+r.status+' — '+(body||'corps vide'));
      const doc=Array.isArray(data)?data[0]:null;
      if(!doc)throw new Error('Document #'+id+' introuvable.');

      results.source={state:(doc.content_json||doc.source_content)?'ok':'warn',detail:(doc.content_json?'content_json disponible. ':'')+(doc.source_content?'source_content disponible.':'Aucun contenu source exploitable.')};
      const texts=[];
      if(doc.source_content)texts.push({path:'source_content',text:String(doc.source_content)});
      if(doc.content_json)walk(doc.content_json,'content_json',texts);
      const math=auditMath(texts);

      const delimiterBad=math.inlineOpen!==math.inlineClose||math.displayOpen!==math.displayClose||math.dollar%2!==0;
      results.delimiters={state:delimiterBad?'warn':'ok',detail:'$='+math.dollar+' · inline '+math.inlineOpen+'/'+math.inlineClose+' · display '+math.displayOpen+'/'+math.displayClose+(delimiterBad?' — déséquilibre détecté.':' — équilibre global.')};
      results.commands={state:math.suspicious.length?'warn':'ok',detail:math.suspicious.length?math.suspicious.length+' occurrence(s) suspecte(s) détectée(s).':'Aucune commande connue comme suspecte détectée.'};

      const controlHits=[];
      texts.forEach(x=>{
        const m=x.text.match(/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F-\\x9F]/g);
        if(m)controlHits.push(x.path+' : '+Array.from(new Set(m)).map(c=>'U+'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')).join(', '));
      });
      results.controls={state:controlHits.length?'fail':'ok',detail:controlHits.length?controlHits.length+' champ(s) contiennent des caractères de contrôle/non imprimables.':'Aucun caractère de contrôle/non imprimable détecté dans les champs analysés.'};

      const formulas=[];
      walk(doc.content_json||{},'content_json',formulas);
      const formulaFields=formulas.filter(x=>/\\.formula$/.test(x.path));
      const malformed=formulaFields.filter(x=>/\\infy|\\mathrm\\{quad\\}|\\text\\{mathbb\\{R\\}\\}|\\text\\{R\\}/.test(x.text));
      results.formulas={state:malformed.length?'warn':'ok',detail:formulaFields.length+' champ(s) formula analysé(s) · '+malformed.length+' anomalie(s) canonique(s) connue(s).'};

      const md=doc.metadata&&typeof doc.metadata==='object'?doc.metadata:{};
      const geogebra=md.geogebra||md.graphs||null;
      const graphText=JSON.stringify(doc.content_json||{})+' '+JSON.stringify(md);
      const graphCount=(graphText.match(/geogebra|graph-/gi)||[]).length;
      results.graphs={state:graphCount?'ok':'warn',detail:graphCount?'Références graphiques détectées dans les données/metadata.':'Aucune référence GeoGebra/graphique détectée.'};

      const pd=doc.pdf_diagnostic||null;
      const pr=md.pdf_render||null;
      results.metadata={state:(pd||pr)?'ok':'warn',detail:(pd||pr)?'Diagnostic PDF persistant présent.':'Aucun diagnostic PDF persistant trouvé.'};
      results.pdf={state:(doc.pdf_path||doc.pdf_url)?'ok':'warn',detail:(doc.pdf_path||doc.pdf_url)?'Référence PDF présente — aucune régénération effectuée.':'Aucune référence PDF enregistrée.'};

      const summary={
        id:doc.id,title:doc.title,status:doc.status,source_format:doc.source_format,
        words:doc.content_json?JSON.stringify(doc.content_json).length:null,
        formulas:formulaFields.length,
        delimiter_counts:math,
        control_hits:controlHits,
        suspicious_commands:math.suspicious,
        pdf:{path:doc.pdf_path||null,url:doc.pdf_url||null,diagnostic:pd,metadata_pdf_render:pr},
        updated_at:doc.updated_at||null
      };
      report.textContent=JSON.stringify(summary,null,2);

      if(doc.pdf_url){
        openBtn.disabled=false;
        openBtn.onclick=()=>window.open(doc.pdf_url,'_blank','noopener');
      }
      if(doc.pdf_path){
        const link=document.createElement('span');
        link.textContent='PDF Storage : '+doc.pdf_path;
        document.getElementById('aurorePdfLabLinks').appendChild(link);
      }

      renderStages(results);
      const states=Object.values(results).map(x=>x.state);
      if(states.includes('fail'))setStatus('fail','🔴 Anomalies critiques');
      else if(states.includes('warn'))setStatus('warn','🟡 Anomalies à examiner');
      else setStatus('ok','🟢 Source propre');
    }catch(e){
      renderStages({source:{state:'fail',detail:String(e.message||e)}});
      report.textContent=String(e.stack||e.message||e);
      setStatus('fail','🔴 Échec du laboratoire');
    }
  }

  const runBtn=document.getElementById('aurorePdfLabRun');
  if(runBtn && runBtn.dataset.bound!=='1'){runBtn.addEventListener('click',run);runBtn.dataset.bound='1';}
  const openBtn=document.getElementById('aurorePdfLabOpen');
  if(openBtn && openBtn.dataset.labBound!=='1'){
    openBtn.addEventListener('click',()=>{
      const input=document.getElementById('aurorePdfLabDocument')||document.getElementById('aurorePdfLabId');
      const id=Number(input?.value||0);
      if(!Number.isInteger(id)||id<1)return;
      if(openBtn.dataset.pdfUrl)window.open(openBtn.dataset.pdfUrl,'_blank','noopener');
    });
    openBtn.dataset.labBound='1';
  }
  renderStages({});
  return true;
  }

  // Le tableau admin peut être monté/rejoué par le routeur après le chargement initial.
  // On retente brièvement pour que le laboratoire apparaisse même si l'onglet PDF est
  // injecté ou réinitialisé après le chargement des scripts.
  let attempts=0;
  const boot=()=>{
    attempts++;
    if(mountLab() || attempts>=30)return;
    setTimeout(boot,200);
  };
  boot();
})();
