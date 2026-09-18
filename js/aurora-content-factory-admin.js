
(function(){'use strict';const panel=document.querySelector('.admin-tab-panel[data-panel="content-factory"]');if(!panel)return;const list=document.getElementById('adminContentFactoryList'),count=document.getElementById('tabCountContentFactory');let rows=[];let generationQueue=[];let generationRunning=false;let classificationLoaded=false;let classificationRows=[];const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML};const sl=s=>({review:'À contrôler',approved:'Validé',published:'Publié',rejected:'Rejeté',failed:'Échec',generated:'Généré',processing:'Traitement',queued:'En file',draft:'Brouillon'}[s]||s||'Inconnu');const adminOk=()=>!!(session&&session.role==='admin');
async function cfFreshToken(){
  const client=await assurerClientAuthGoogle();
  if(!client)throw new Error('Client Supabase indisponible.');
  let current=(await client.auth.getSession())?.data?.session||null;
  if(!current?.access_token)throw new Error('Session administrateur expirée. Reconnecte-toi puis réessaie.');
  const exp=current.expires_at?current.expires_at*1000:0;
  if(exp&&Date.now()>=exp-60000){
    const refreshed=await client.auth.refreshSession();
    if(refreshed.error||!refreshed.data?.session?.access_token)throw (refreshed.error||new Error('Impossible de rafraîchir la session Supabase.'));
    current=refreshed.data.session;
  }
  session={...(session||{}),access_token:current.access_token,refresh_token:current.refresh_token||session?.refresh_token||'',expires_at:current.expires_at?current.expires_at*1000:(session?.expires_at||0)};
  sauvegarderSession();
  return current.access_token;
}
async function cfFetch(url,options={},retry=true){
  const token=await cfFreshToken();
  const headers={...(options.headers||{}),apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token};
  const r=await fetch(url,{...options,headers});
  if((r.status===401||r.status===403)&&retry){
    const text=await r.clone().text().catch(()=> '');
    if(r.status===401||/PGRST303|JWT expired/i.test(text)){
      const client=await assurerClientAuthGoogle();
      const refreshed=await client?.auth.refreshSession();
      if(!refreshed?.error&&refreshed?.data?.session?.access_token){
        const s=refreshed.data.session;session={...(session||{}),access_token:s.access_token,refresh_token:s.refresh_token||session?.refresh_token||'',expires_at:s.expires_at?s.expires_at*1000:(session?.expires_at||0)};sauvegarderSession();
        const h={...(options.headers||{}),apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+s.access_token};
        return fetch(url,{...options,headers:h});
      }
    }
  }
  return r;
}
async function rpc(name,body){const r=await cfFetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));try{return t?JSON.parse(t):null}catch(_){return t}}
function setProgress(percent,stage){const box=document.getElementById('cfProgress'),bar=document.getElementById('cfProgressBar'),pct=document.getElementById('cfProgressPercent'),st=document.getElementById('cfProgressStage');if(box)box.hidden=false;if(bar)bar.style.width=Math.max(0,Math.min(100,percent))+'%';if(pct)pct.textContent=Math.round(percent)+'%';if(st)st.textContent=stage||'';}
function updateQueueUI(){const box=document.getElementById('cfGenerationQueue'),txt=document.getElementById('cfGenerationQueueText'),btn=document.getElementById('cfCreateLaunch');if(!box||!txt)return;const n=generationQueue.length;box.hidden=!generationRunning&&!n;txt.textContent=generationRunning?(n?` — 1 document en cours, ${n} suivant(s) en attente.`:' — 1 document en cours, aucun autre en attente.'):(n?` — ${n} document(s) en attente.`:'');if(btn)btn.textContent=generationRunning?'Ajouter à la file':'Ajouter à la file de génération';}
function populateSelect(id,values,placeholder,keepValue=true){const sel=document.getElementById(id);if(!sel)return;const current=keepValue?sel.value:'';const clean=[...new Set(values.map(v=>String(v??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));sel.innerHTML=`<option value="">${esc(placeholder)}</option>`+clean.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')+'<option value="__custom__">Autre / nouveau…</option>';if(current&&clean.includes(current))sel.value=current;else if(current==='__custom__')sel.value='__custom__';}
function bindCustomSelect(selectId,inputId){const s=document.getElementById(selectId),i=document.getElementById(inputId);if(!s||!i)return;s.addEventListener('change',()=>{const custom=s.value==='__custom__';i.style.display=custom?'block':'none';if(custom)i.focus();else i.value='';});}
function refreshClassificationOptions(){const level=document.getElementById('cfCreateLevel')?.value||'',cls=document.getElementById('cfCreateClass')?.value||'',sub=document.getElementById('cfCreateSubject')?.value||'';const realLevel=level==='__custom__'?'':level,realClass=cls==='__custom__'?'':cls,realSub=sub==='__custom__'?'':sub;const base=classificationRows;const forLevel=base.filter(x=>!realClass&&!realSub||(!realClass||x.Classe===realClass)&&(!realSub||(x['Matière']||x.Genre)===realSub));const levels=base.map(x=>x.Niveau);const classes=base.filter(x=>!realLevel||x.Niveau===realLevel).filter(x=>!realSub||(x['Matière']||x.Genre)===realSub).map(x=>x.Classe);const subjects=base.filter(x=>!realLevel||x.Niveau===realLevel).filter(x=>!realClass||x.Classe===realClass).map(x=>x['Matière']||x.Genre);const titles=base.filter(x=>!realLevel||x.Niveau===realLevel).filter(x=>!realClass||x.Classe===realClass).filter(x=>!realSub||(x['Matière']||x.Genre)===realSub).map(x=>x.Titre);populateSelect('cfCreateLevel',levels,'Choisir un niveau disponible…');populateSelect('cfCreateClass',classes,'Choisir une classe disponible…');populateSelect('cfCreateSubject',subjects,'Choisir une matière disponible…');populateSelect('cfCreateTitle',titles,'Choisir un titre existant…');}
async function loadClassificationOptions(){if(classificationLoaded||!adminOk())return;classificationLoaded=true;try{const url=`${SUPABASE_URL}/rest/v1/Document?select=Titre,Niveau,Classe,%22Mati%C3%A8re%22,Genre&Publie=eq.true&order=Titre.asc&limit=2000`;const r=await cfFetch(url,{cache:'no-store'});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));const data=t?JSON.parse(t):[];classificationRows=Array.isArray(data)?data:[];refreshClassificationOptions();}catch(e){classificationLoaded=false;const m=document.getElementById('cfCreateMsg');if(m){m.dataset.state='error';m.textContent='Les choix de classement n’ont pas pu être chargés. Réessayez.';}}}
function selectedValue(selectId,inputId){const s=document.getElementById(selectId),i=document.getElementById(inputId);if(!s)return'';return s.value==='__custom__'?(i?.value||'').trim():(s.value||'').trim();}
async function getJob(jobId){const r=await cfFetch(`${SUPABASE_URL}/rest/v1/aurora_content_jobs?id=eq.${encodeURIComponent(jobId)}&select=id,status,title,generated_document_id,error_message,updated_at`,{cache:'no-store'});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));const a=t?JSON.parse(t):[];return Array.isArray(a)&&a[0]?a[0]:null;}
async function waitForJob(jobId){let last=null;for(let i=0;i<180;i++){const j=await getJob(jobId);if(!j)throw new Error('Job introuvable dans Supabase.');last=j;if(j.status==='queued'){setProgress(8,`Job #${jobId} en file — Aurora attend son tour…`)}else if(j.status==='processing'){setProgress(Math.min(88,18+i*.4),`Aurora traite le document #${jobId}…`)}else if(j.status==='review'){setProgress(100,`Document #${jobId} terminé et placé en contrôle.`);return j}else if(j.status==='failed'||j.status==='rejected'){throw new Error(j.error_message||`La génération s’est arrêtée avec le statut ${j.status}.`)}else{setProgress(12,`Statut Aurora : ${j.status}`)}await new Promise(r=>setTimeout(r,2000));}return last;}
async function runGeneration(item){const msg=document.getElementById('cfCreateMsg');generationRunning=true;updateQueueUI();setProgress(2,`Préparation du document « ${item.title} »…`);try{const job=await rpc('aurora_create_content_job',{p_title:item.title,p_subject:item.subject||null,p_level:item.level||null,p_class_name:item.className||null,p_document_type:'fiche de révision',p_prompt:item.prompt,p_instructions:{source:'admin_content_factory',queue:'sequential'}});const jobId=Number(job);if(!Number.isSafeInteger(jobId)||jobId<1)throw new Error('Identifiant de job invalide.');setProgress(8,`Job #${jobId} créé — Aurora commence par celui-ci.`);if(msg){msg.dataset.state='';msg.textContent=`Job #${jobId} en traitement. Les suivants attendent dans la file.`}const workerPromise=cfFetch(`${SUPABASE_URL}/functions/v1/aurora-content-worker`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:jobId})}).then(async r=>{const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={error:t}}return{ok:r.ok,status:r.status,data:d}}).catch(e=>({ok:false,status:0,data:{error:e.message||String(e)}}));const poll=waitForJob(jobId);const [wr,jr]=await Promise.all([workerPromise,poll]);if(jr&&jr.status==='review'){if(msg)msg.dataset.state='ok';await charger();return}if(!wr.ok)throw new Error(wr.data?.error||('HTTP '+wr.status));throw new Error('La génération n’a pas abouti.');}finally{generationRunning=false;updateQueueUI();}}
async function processQueue(){if(generationRunning)return;const item=generationQueue.shift();updateQueueUI();if(!item)return;try{await runGeneration(item);}catch(e){const msg=document.getElementById('cfCreateMsg');if(msg){msg.dataset.state='error';msg.textContent=`Le document « ${item.title} » n’a pas pu être généré : ${e.message||e}`}setProgress(100,'Échec de ce document — Aurora passe au suivant.');}finally{updateQueueUI();if(generationQueue.length)processQueue();}}
function enqueueCurrent(){if(!adminOk())return;const title=selectedValue('cfCreateTitle','cfCreateTitleCustom'),subject=selectedValue('cfCreateSubject','cfCreateSubjectCustom'),level=selectedValue('cfCreateLevel','cfCreateLevelCustom'),className=selectedValue('cfCreateClass','cfCreateClassCustom'),prompt=(document.getElementById('cfCreatePrompt')?.value||'').trim(),msg=document.getElementById('cfCreateMsg');if(!title||!prompt){if(msg){msg.dataset.state='error';msg.textContent='Le titre et la demande sont obligatoires. Choisis les valeurs disponibles ou « Autre / nouveau… ».'}return}if((document.getElementById('cfCreateSubject')?.value==='__custom__')&&!subject){if(msg)msg.textContent='Indique la matière.';return}if((document.getElementById('cfCreateLevel')?.value==='__custom__')&&!level){if(msg)msg.textContent='Indique le niveau.';return}if((document.getElementById('cfCreateClass')?.value==='__custom__')&&!className){if(msg)msg.textContent='Indique la classe.';return}generationQueue.push({title,subject,level,className,prompt});if(msg){msg.dataset.state='ok';msg.textContent=`« ${title} » ajouté à la file (${generationQueue.length} en attente${generationRunning?' derrière le document en cours':''}).`}updateQueueUI();if(!generationRunning)processQueue();}
function bindClassification(){['cfCreateTitle','cfCreateSubject','cfCreateLevel','cfCreateClass'].forEach(id=>document.getElementById(id)?.addEventListener('change',refreshClassificationOptions));bindCustomSelect('cfCreateTitle','cfCreateTitleCustom');bindCustomSelect('cfCreateSubject','cfCreateSubjectCustom');bindCustomSelect('cfCreateLevel','cfCreateLevelCustom');bindCustomSelect('cfCreateClass','cfCreateClassCustom');loadClassificationOptions();}

async function auroraGeoGebraScriptReady(){
  if(window.GGBApplet)return;
  if(window.__auroraGeoGebraScriptPromise)return window.__auroraGeoGebraScriptPromise;
  window.__auroraGeoGebraScriptPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://www.geogebra.org/apps/deployggb.js';
    s.async=true;
    s.onload=()=>resolve();
    s.onerror=()=>reject(new Error('GeoGebra est indisponible.'));
    document.head.appendChild(s);
  });
  return window.__auroraGeoGebraScriptPromise;
}
function auroraGeoGebraExpr(raw){
  let s=String(raw||'').trim()
    .replace(/^\s*(?:f\s*\(\s*x\s*\)|y)\s*=\s*/i,'')
    .replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-')
    .replace(/√\s*\(/g,'sqrt(').replace(/\bln\s*\(/gi,'ln(')
    .replace(/\blog\s*\(/gi,'log(');
  return s;
}
function auroraGeoGebraCommandes(g){
  const cmds=[];
  const expr=auroraGeoGebraExpr(g?.expression||'');
  if(expr)cmds.push('f(x)='+expr);
  const xmin0=Number(g?.x_min),xmax0=Number(g?.x_max),ymin0=Number(g?.y_min),ymax0=Number(g?.y_max);
  if([xmin0,xmax0,ymin0,ymax0].every(Number.isFinite)&&xmax0>xmin0&&ymax0>ymin0){
    const xr=Math.max(Math.abs(xmin0),Math.abs(xmax0),1),yr=Math.max(Math.abs(ymin0),Math.abs(ymax0),1);
    cmds.push(`SetCoordSystem(${-xr},${xr},${-yr},${yr})`);
  }
  cmds.push('O=(0,0)','I=(1,0)','J=(0,1)');
  cmds.push('SetLabelVisible(O,true)','SetLabelVisible(I,true)','SetLabelVisible(J,true)');
  cmds.push('SetCaption(O,"O")','SetCaption(I,"I")','SetCaption(J,"J")');
  for(const a of Array.isArray(g?.asymptotes)?g.asymptotes:[]){
    const v=Number(a?.value); if(!Number.isFinite(v))continue;
    if(a.type==='vertical')cmds.push(`a${cmds.length}=x=${v}`);
    if(a.type==='horizontal')cmds.push(`a${cmds.length}=y=${v}`);
  }
  return cmds;
}
async function auroraGeoGebraExportOne(graph){
  await auroraGeoGebraScriptReady();
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:-10000px;top:-10000px;width:1400px;height:820px;opacity:0;pointer-events:none;z-index:-1;background:#fff;';
  document.body.appendChild(host);
  return await new Promise((resolve,reject)=>{
    let finished=false;
    const done=(fn,v)=>{if(finished)return;finished=true;try{api?.remove?.()}catch(_){}host.remove();fn(v);};
    let api=null;
    const timer=setTimeout(()=>done(reject,new Error('GeoGebra n’a pas terminé la construction du graphique.')),30000);
    const params={
      appName:'graphing',width:1400,height:820,showToolBar:false,showAlgebraInput:false,
      showMenuBar:false,showResetIcon:false,showFullscreenButton:false,showZoomButtons:false,
      showSuggestionButtons:false,language:'fr',
      appletOnLoad:function(a){
        api=a;
        try{
          const xmin0=Number(graph?.x_min),xmax0=Number(graph?.x_max),ymin0=Number(graph?.y_min),ymax0=Number(graph?.y_max);
          if([xmin0,xmax0,ymin0,ymax0].every(Number.isFinite)&&xmax0>xmin0&&ymax0>ymin0){
            const xr=Math.max(Math.abs(xmin0),Math.abs(xmax0),1),yr=Math.max(Math.abs(ymin0),Math.abs(ymax0),1);
            a.setCoordSystem(-xr,xr,-yr,yr);
          }
          a.setAxesVisible(true,true);
          a.setGridVisible(true);
          try{a.setAxisSteps(1,1,1,0)}catch(_){}
          try{a.setAxisLabels(1,'x','y','')}catch(_){}
          for(const c of auroraGeoGebraCommandes(graph)){
            try{a.evalCommand(c)}catch(e){console.warn('[Aurora][GeoGebra export]',c,e)}
          }
          setTimeout(()=>{
            try{
              if(typeof a.getPNGBase64!=='function')throw new Error('L’export PNG GeoGebra n’est pas disponible.');
              const b64=a.getPNGBase64(2,false,144);
              if(!b64)throw new Error('GeoGebra a renvoyé une image vide.');
              clearTimeout(timer);
              done(resolve,String(b64).replace(/^data:image\/png;base64,/i,''));
            }catch(e){clearTimeout(timer);done(reject,e instanceof Error?e:new Error(String(e)))}
          },1200);
        }catch(e){clearTimeout(timer);done(reject,e instanceof Error?e:new Error(String(e)))}
      }
    };
    try{const applet=new GGBApplet(params,true);applet.inject(host)}catch(e){clearTimeout(timer);done(reject,e instanceof Error?e:new Error(String(e)))}
  });
}
async function auroraConstruireEtImporterGraphiquesGeoGebra(id,button,accessToken){
  // Utilise le JWT frais transmis par renderPdf() plutôt que headersAdmin()
  // (qui repose sur la variable locale "session", potentiellement périmée).
  // Conserve headersAdmin() en repli uniquement si aucun token n'est fourni,
  // pour ne rien casser ailleurs si cette fonction est un jour appelée sans.
  const ggbHeaders=accessToken?{"apikey":SUPABASE_ANON_KEY,"Authorization":"Bearer "+accessToken}:headersAdmin();
  const prep=await fetch(`${SUPABASE_URL}/functions/v1/aurora-geogebra`,{
    method:'POST',headers:{...ggbHeaders,'Content-Type':'application/json'},
    body:JSON.stringify({generated_document_id:Number(id),action:'prepare'})
  });
  const pt=await prep.text();let pd={};try{pd=pt?JSON.parse(pt):{}}catch(_){pd={error:pt}}
  if(!prep.ok)throw new Error(pd.error||('Préparation GeoGebra HTTP '+prep.status));
  const graphs=Array.isArray(pd.graphs)?pd.graphs:[];
  for(let i=0;i<graphs.length;i++){
    if(button)button.textContent=`GeoGebra ${i+1}/${graphs.length}…`;
    const png=await auroraGeoGebraExportOne(graphs[i]);
    const up=await fetch(`${SUPABASE_URL}/functions/v1/aurora-geogebra`,{
      method:'POST',headers:{...ggbHeaders,'Content-Type':'application/json'},
      body:JSON.stringify({generated_document_id:Number(id),graph_index:Number(graphs[i].graph_index),png_base64:png})
    });
    const ut=await up.text();let ud={};try{ud=ut?JSON.parse(ut):{}}catch(_){ud={error:ut}}
    if(!up.ok)throw new Error(ud.error||('Import GeoGebra HTTP '+up.status));
  }
  return graphs.length;
}

async function obtenirJwtPourRenduPdf(){
  // Le renderer PDF exige un vrai JWT utilisateur (verify_jwt=true).
  // On récupère la session Supabase actuelle juste avant l'appel afin de ne
  // jamais envoyer une clé anon à la place du Bearer token.
  try{
    const client=await assurerClientAuthGoogle();
    if(client){
      const {data,error}=await client.auth.getSession();
      if(!error&&data?.session?.access_token){
        session={...(session||{}),access_token:data.session.access_token,refresh_token:data.session.refresh_token||session?.refresh_token||'',expires_at:data.session.expires_at?data.session.expires_at*1000:(session?.expires_at||0)};
        sauvegarderSession();
        return data.session.access_token;
      }
    }
  }catch(e){console.warn('[Content Factory] Session PDF indisponible:',e);}
  if(session?.access_token){
    if(session.expires_at&&Date.now()>session.expires_at-60000){
      const ok=await rafraichirSession();
      if(!ok)return null;
    }
    return session.access_token||null;
  }
  return null;
}

async function renderPdfPageByPageFromBrowser(id,accessToken,b){
  // Chaque page est invoquee directement depuis le navigateur : chaque appel
  // possede ainsi sa propre trace Supabase et evite Edge -> Edge en chaine.
  const h={apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+accessToken,'Content-Type':'application/json'};
  const r=await fetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id))+'&select=id,title,content_json',{headers:h,cache:'no-store'});
  const t=await r.text();let data=[];try{data=t?JSON.parse(t):[]}catch(_){data=[]}
  if(!r.ok||!Array.isArray(data)||!data[0])throw new Error('Document genere introuvable.');
  const d=data[0].content_json||{},parts=[];
  if(d.introduction)parts.push({title:d.title||'Introduction',content:[String(d.introduction)],graphs:[]});
  if(Array.isArray(d.learning_objectives)&&d.learning_objectives.length)parts.push({title:'Objectifs',content:["Objectifs d'apprentissage:",...d.learning_objectives.map(String)],graphs:[]});
  for(const s of Array.isArray(d.sections)?d.sections:[]){
    const blocks=[];if(s.objective)blocks.push(String(s.objective));if(Array.isArray(s.content))blocks.push(...s.content.map(String));
    if(Array.isArray(s.exercises))for(const e of s.exercises)blocks.push('Exercice: '+String(e?.question||''));
    if(s.formula)blocks.push(String(s.formula));
    if(blocks.length)parts.push({title:s.title||'Section',content:blocks,graphs:Array.isArray(s.graphs)?s.graphs:[]});
  }
  if(Array.isArray(d.corrections)&&d.corrections.length)parts.push({title:'Corriges',content:d.corrections.map(c=>'Corrige — exercice '+String(c?.exercise_number||'')+': '+String(c?.solution||'')),graphs:[]});
  if(!parts.length)throw new Error('Aucun contenu a paginer.');
  const paths=[],uid=session?.user_id||session?.id;
  if(!uid)throw new Error('Identifiant utilisateur introuvable pour le rendu PDF.');
  for(let i=0;i<parts.length;i++){
    setProgress(8+(i/parts.length)*82,'Rendu page '+(i+1)+'/'+parts.length+'…');
    if(b)b.textContent='PDF — page '+(i+1)+'/'+parts.length+'…';
    const pagePath='aurora-content-pages/'+uid+'/'+id+'/page-'+String(i+1).padStart(4,'0')+'.pdf';
    let done=false,last='';
    for(let attempt=0;attempt<4&&!done;attempt++){
      const pr=await fetch(SUPABASE_URL+'/functions/v1/aurora-content-pdf-page',{method:'POST',headers:h,body:JSON.stringify({generated_document_id:Number(id),page_number:i+1,page_path:pagePath,content:parts[i]})});
      const pt=await pr.text();let pd={};try{pd=pt?JSON.parse(pt):{}}catch(_){pd={error:pt}};
      if(pr.ok&&pd?.ok){paths.push(pd.page_path);done=true;break}
      last=pd?.error||('Renderer page HTTP '+pr.status);
      if(pr.status===429||/rate limit/i.test(String(last))){
        const retry=Number(pr.headers.get('Retry-After')||0)*1000;
        await new Promise(res=>setTimeout(res,Math.min(20000,Math.max(1000,retry||4000))));
      }else throw new Error(last);
    }
    if(!done)throw new Error(last||'Renderer page : échec après plusieurs tentatives.');
  }
  setProgress(92,'Fusion des pages PDF…');if(b)b.textContent='PDF — fusion des pages…';
  const mr=await fetch(SUPABASE_URL+'/functions/v1/aurora-content-pdf-merge',{method:'POST',headers:h,body:JSON.stringify({generated_document_id:Number(id),page_paths:paths})});
  const mt=await mr.text();let md={};try{md=mt?JSON.parse(mt):{}}catch(_){md={error:mt}};
  if(!mr.ok||!md?.ok)throw new Error(md?.error||('Fusionneur HTTP '+mr.status));
  setProgress(100,'PDF généré et fusionné.');return md;
}
async function renderPdf(id){
  const b=document.querySelector(`[data-cf-render="${id}"]`);
  if(b){b.disabled=true;b.textContent=b.dataset.hasPdf==='1'?'Régénération PDF…':'Génération PDF…'}
  try{
    // Récupère la session Supabase réellement active EN PREMIER, avant toute
    // requête de renderPdf() — y compris la préparation GeoGebra. Auparavant
    // cette vérification n'avait lieu que juste avant l'appel au renderer :
    // l'étape GeoGebra (headersAdmin(), donc la variable locale "session",
    // potentiellement périmée) pouvait alors échouer en 401 avant même
    // d'atteindre le renderer v17, ce qui produisait le même message d'erreur
    // générique et laissait croire à tort que le renderer refusait le JWT.
    const authClient=await assurerClientAuthGoogle();
    if(!authClient)throw new Error('Client Supabase indisponible.');
    const {data:authData,error:authError}=await authClient.auth.getSession();
    if(authError)throw authError;
    const activeSession=authData?.session;
    const accessToken=activeSession?.access_token;
    if(!accessToken)throw new Error('Session administrateur expirée. Reconnecte-toi puis réessaie.');

    // Synchronise la session locale sans modifier les autres informations admin.
    if(session){
      session.access_token=accessToken;
      if(activeSession.refresh_token)session.refresh_token=activeSession.refresh_token;
      if(activeSession.expires_at)session.expires_at=activeSession.expires_at*1000;
      sauvegarderSession();
    }

    const graphCount=await auroraConstruireEtImporterGraphiquesGeoGebra(id,b,accessToken);
    if(b)b.textContent=graphCount?`Génération PDF avec ${graphCount} graphique${graphCount>1?'s':''} GeoGebra…`:'Génération PDF…';

    await renderPdfPageByPageFromBrowser(id,accessToken,b);
    await charger();
    alert(graphCount?`PDF généré avec ${graphCount} graphique${graphCount>1?'s':''} construit${graphCount>1?'s':''} par GeoGebra.`:'PDF généré et contrôle qualité de base effectué.');
  }catch(e){
    alert('Le PDF n’a pas pu être généré. '+(e.message||e))
  }finally{
    if(b){b.disabled=false;b.textContent=b.dataset.hasPdf==='1'?'Régénérer le PDF':'Générer le PDF'}
  }
}
async function validateDoc(id){const n=prompt('Note de validation (facultatif) :','');if(n===null)return;try{await rpc('aurora_validate_generated_document',{p_generated_document_id:Number(id),p_notes:n||null});await charger()}catch(e){alert('Validation impossible. '+(e.message||e))}}
async function rejectDoc(id){const n=prompt('Motif du rejet / corrections demandées :','');if(n===null)return;if(!n.trim()){alert('Indique un motif pour rejeter le document.');return}try{await rpc('aurora_reject_generated_document',{p_generated_document_id:Number(id),p_notes:n.trim()});await charger()}catch(e){alert('Rejet impossible. '+(e.message||e))}}
async function publishDoc(id){if(!confirm('Publier ce document dans la bibliothèque publique Aurore ?\n\nCette action crée un document publié à partir du PDF validé.'))return;const n=prompt('Note de publication (facultatif) :','');if(n===null)return;try{await rpc('aurora_publish_generated_document',{p_generated_document_id:Number(id),p_notes:n||null});await charger();alert('Document publié dans la bibliothèque Aurore.')}catch(e){alert('Publication impossible. '+(e.message||e))}}
function apply(){const q=(document.getElementById('adminSearchContentFactory')?.value||'').trim().toLowerCase(),st=document.getElementById('adminFilterContentFactory')?.value||'',sort=document.getElementById('adminSortContentFactory')?.value||'recent';let a=rows.filter(x=>(!st||x.status===st)&&(!q||[x.title,x.subject,x.level,x.class_name,x.document_type,x.status].filter(Boolean).join(' ').toLowerCase().includes(q)));a.sort((x,y)=>{if(sort==='az')return String(x.title).localeCompare(String(y.title),'fr');if(sort==='za')return String(y.title).localeCompare(String(x.title),'fr');const ax=new Date(x.created_at).getTime(),ay=new Date(y.created_at).getTime();return sort==='oldest'?ax-ay:ay-ax});if(!a.length){list.innerHTML='<div class="admin-empty">Aucun document généré pour ces critères.</div>';return}list.innerHTML=a.map(x=>{const pdf=!!x.pdf_url,canRender=['generated','review','approved'].includes(x.status),canValidate=x.status==='review'&&pdf,canReject=['review','approved'].includes(x.status),canPublish=['approved','review'].includes(x.status)&&pdf;return `<article class="cf-admin-card"><div class="cf-admin-icon">PDF</div><div class="cf-admin-body"><div class="cf-admin-title">${esc(x.title)}</div><div class="cf-admin-meta">${esc([x.subject,x.level,x.class_name,x.document_type].filter(Boolean).join(' · '))}<br>Créé le ${esc(new Date(x.created_at).toLocaleString('fr-FR'))}${x.version?' · Version '+esc(x.version):''}</div><span class="cf-admin-status">${esc(sl(x.status))}${pdf?' · PDF prêt':''}</span>${x.validation_notes?`<div class="cf-admin-meta">${esc(x.validation_notes)}</div>`:''}<div class="cf-admin-actions">${pdf?`<a class="admin-btn ghost" href="${esc(x.pdf_url)}" target="_blank" rel="noopener">Ouvrir le PDF</a>`:''}${canRender?`<button type="button" class="admin-btn primary" data-cf-render="${esc(x.id)}" data-has-pdf="${pdf?'1':'0'}">${pdf?'Régénérer le PDF':'Générer le PDF'}</button>`:''}${canValidate?`<button type="button" class="admin-btn valider" data-cf-validate="${esc(x.id)}">Valider</button>`:''}${canReject?`<button type="button" class="admin-btn refuser" data-cf-reject="${esc(x.id)}">Rejeter</button>`:''}${canPublish?`<button type="button" class="admin-btn primary" data-cf-publish="${esc(x.id)}">Publier</button>`:''}${x.published_document_id?`<button type="button" class="admin-btn ghost" disabled>Déjà publié #${esc(x.published_document_id)}</button>`:''}</div>${x.error_message?`<div class="cf-admin-error">${esc(x.error_message)}</div>`:''}</div></article>`}).join('')}
async function charger(){if(!adminOk()){list.innerHTML='<div class="admin-empty">Cette action est réservée aux administrateurs.</div>';return}list.innerHTML='<div class="admin-empty">Chargement…</div>';try{const r=await cfFetch(`${SUPABASE_URL}/rest/v1/aurora_generated_documents?select=*&order=created_at.desc`,{cache:'no-store'}),t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));rows=t?JSON.parse(t):[];if(!Array.isArray(rows))rows=[];const c={review:0,approved:0,published:0,failed:0};rows.forEach(x=>{if(c[x.status]!=null)c[x.status]++});document.getElementById('cfCountReview').textContent=c.review;document.getElementById('cfCountApproved').textContent=c.approved;document.getElementById('cfCountPublished').textContent=c.published;document.getElementById('cfCountFailed').textContent=c.failed;if(count)count.textContent=String(c.review);apply()}catch(e){list.innerHTML=`<div class="admin-empty">Impossible de charger Content Factory.<br>${esc(e.message||e)}</div>`}}
document.getElementById('cfCreateLaunch')?.addEventListener('click',enqueueCurrent);document.getElementById('adminRefreshContentFactory')?.addEventListener('click',charger);document.getElementById('adminSearchContentFactory')?.addEventListener('input',apply);document.getElementById('adminSortContentFactory')?.addEventListener('change',apply);document.getElementById('adminFilterContentFactory')?.addEventListener('change',apply);list.addEventListener('click',e=>{const r=e.target.closest('[data-cf-render]'),v=e.target.closest('[data-cf-validate]'),x=e.target.closest('[data-cf-reject]'),p=e.target.closest('[data-cf-publish]');if(r){if(r.dataset.hasPdf==='1'&&!confirm('Ce document possède déjà un PDF. Le nouveau rendu remplacera le PDF actuel. Continuer ?'))return;renderPdf(r.dataset.cfRender)}else if(v)validateDoc(v.dataset.cfValidate);else if(x)rejectDoc(x.dataset.cfReject);else if(p)publishDoc(p.dataset.cfPublish)});bindClassification();window.chargerAuroraContentFactoryAdmin=charger;})();
