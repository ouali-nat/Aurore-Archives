
(function(){'use strict';const panel=document.querySelector('.admin-tab-panel[data-panel="content-factory"]');if(!panel)return;const list=document.getElementById('adminContentFactoryList'),count=document.getElementById('tabCountContentFactory');let rows=[];let generationQueue=[];let generationRunning=false;let cfCreatePath=[];const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML};const sl=s=>({review:'À contrôler',approved:'Validé',published:'Publié',rejected:'Rejeté',failed:'Échec',generated:'Généré',processing:'Traitement',queued:'En file',draft:'Brouillon'}[s]||s||'Inconnu');const adminOk=()=>!!(session&&session.role==='admin');const normalizeThemeColor=v=>/^#[0-9a-f]{6}$/i.test(String(v||''))?String(v).toUpperCase():'#6D28D9';
const documentThemeColor=metadata=>{
  const m=metadata&&typeof metadata==='object'?metadata:{};
  const d=m.aurore_design&&typeof m.aurore_design==='object'?m.aurore_design:{};
  return normalizeThemeColor(d.theme_color||d.themeColor||m.theme_color||m.themeColor||'#6D28D9');
};
async function chooseRegenerationTheme(defaultColor){
  return new Promise(resolve=>{
    let modal=document.getElementById('cfThemeModal');
    if(!modal){
      modal=document.createElement('div');
      modal.id='cfThemeModal';
      modal.innerHTML='<div class="cf-theme-modal-backdrop"></div><section class="cf-theme-modal-card" role="dialog" aria-modal="true" aria-labelledby="cfThemeModalTitle"><div class="cf-theme-modal-kicker">Identité Aurore</div><h3 id="cfThemeModalTitle">Choisir la couleur du nouveau PDF</h3><p>Les couleurs proposées reprennent les 45 thèmes officiels du site Aurore. La couleur choisie restera associée à cette version.</p><div class="cf-theme-modal-picker"><input id="cfThemeModalInput" type="color" aria-label="Couleur dominante du PDF"><div><strong id="cfThemeModalValue"></strong><span>Couleur dominante</span></div></div><div class="cf-theme-swatches" aria-label="Couleurs proposées"></div><div class="cf-theme-modal-actions"><button type="button" class="admin-btn ghost" id="cfThemeModalCancel">Annuler</button><button type="button" class="admin-btn primary" id="cfThemeModalApply">Régénérer avec cette couleur</button></div></section></div>';
      document.body.appendChild(modal);
      const style=document.createElement('style');
      style.id='cfThemeModalStyles';
      style.textContent='.cf-theme-modal-backdrop{position:fixed;inset:0;background:rgba(4,8,20,.48);backdrop-filter:blur(5px);z-index:10030}.cf-theme-modal-card{position:fixed;z-index:10031;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,calc(100vw - 22px));max-height:calc(100vh - 28px);overflow:auto;box-sizing:border-box;padding:20px;border:1px solid var(--bordure,rgba(0,0,0,.12));border-radius:22px;background:var(--card-bg,#fff);box-shadow:0 22px 70px rgba(0,0,0,.2);color:var(--encre,#111)}.cf-theme-modal-card h3{margin:4px 0 8px;font-size:1.12rem}.cf-theme-modal-card p{margin:0;color:var(--gris,#687080);font-size:.8rem;line-height:1.55}.cf-theme-modal-kicker{font-size:.68rem;font-weight:900;letter-spacing:.09em;text-transform:uppercase;opacity:.68}.cf-theme-modal-picker{display:flex;align-items:center;gap:13px;margin:16px 0 12px;padding:10px;border:1px solid var(--bordure,rgba(0,0,0,.12));border-radius:15px;background:var(--fond,#fafafa)}.cf-theme-modal-picker input{width:58px;height:42px;padding:3px;border:0;border-radius:11px;background:transparent;cursor:pointer}.cf-theme-modal-picker strong{display:block;font-size:.82rem}.cf-theme-modal-picker span{display:block;font-size:.68rem;opacity:.68;margin-top:2px}.cf-theme-swatches{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin:8px 0 18px}.cf-theme-swatch{display:flex;align-items:center;gap:9px;width:100%;min-height:52px;padding:6px 8px;border:1px solid var(--bordure,rgba(0,0,0,.1));border-radius:12px;background:var(--fond,#fafafa);color:var(--encre,#111);cursor:pointer;text-align:left}.cf-theme-swatch-dot{flex:0 0 30px;width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.94);box-shadow:0 0 0 1px rgba(0,0,0,.13)}.cf-theme-swatch-name{font-size:.7rem;font-weight:800;line-height:1.15}.cf-theme-swatch-code{display:block;font-size:.59rem;font-weight:700;opacity:.58;margin-top:2px;letter-spacing:.03em}.cf-theme-swatch.is-selected{border-color:var(--encre,#111);box-shadow:0 0 0 2px rgba(109,40,217,.15)}.cf-theme-modal-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap}@media(max-width:650px){.cf-theme-swatches{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:430px){.cf-theme-modal-card{padding:14px}.cf-theme-swatches{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.cf-theme-swatch{min-height:48px}.cf-theme-swatch-dot{flex-basis:28px;width:28px;height:28px}.cf-theme-swatch-name{font-size:.66rem}.cf-theme-swatch-code{font-size:.54rem}}@media(max-width:560px){.cf-theme-modal-actions .admin-btn{width:100%;justify-content:center}}';
      document.head.appendChild(style);
      const swatches=[
        ['Violet','#6D28D9','#C084FC'],['Rouge','#C93648','#FF8A96'],['Vert','#198754','#75D89C'],
        ['Bleu','#1D4ED8','#7DB3FF'],['Jaune','#B77900','#F5D36B'],['Orange','#C85C0D','#FFB36B'],
        ['Cyan','#0E7490','#67E8F9'],['Rose','#BE185D','#F9A8D4'],['Indigo','#4338CA','#A5B4FC'],
        ['Turquoise','#0F766E','#67E8F9'],['Émeraude','#047857','#6EE7B7'],['Citron vert','#4D7C0F','#BEF264'],
        ['Sarcelle','#115E59','#5EEAD4'],['Magenta','#A21CAF','#F0ABFC'],['Fuchsia','#86198F','#F0ABFC'],
        ['Corail','#C2412D','#FFB4A8'],['Bordeaux','#881337','#FB7185'],['Pourpre','#6B21A8','#D8B4FE'],
        ['Prune','#581C87','#C084FC'],['Or','#9A6700','#F6D365'],['Ambre','#B45309','#FCD34D'],
        ['Menthe','#047857','#A7F3D0'],['Azur','#0369A1','#7DD3FC'],['Lavande','#6D28D9','#DDD6FE'],
        ['Safran','#A16207','#FDE68A'],
        ['Nuit','#1E3A8A','#93C5FD'],['Marine','#0B3440','#67E8F9'],['Océan','#075985','#38BDF8'],
        ['Ciel','#0369A1','#BAE6FD'],['Ardoise','#334155','#CBD5E1'],['Graphite','#27272A','#D4D4D8'],
        ['Forêt','#166534','#86EFAC'],['Sapin','#065F46','#A7F3D0'],['Pomme','#3F6212','#BEF264'],
        ['Pistache','#4D7C0F','#D9F99D'],['Pêche','#C2410C','#FED7AA'],['Abricot','#92400E','#FCD34D'],
        ['Terracotta','#9A3412','#FDBA74'],['Framboise','#9F1239','#FDA4AF'],['Mauve','#6D28D9','#E9D5FF'],
        ['Pervenche','#3730A3','#C7D2FE'],['Glacier','#155E75','#CFFAFE'],['Sable','#854D0E','#FEF3C7'],
        ['Cacao','#451A03','#D6B38C'],['Lagune','#0F5257','#99F6E4']
      ];
      modal.querySelector('.cf-theme-swatches').innerHTML=swatches.map(([label,strong,secondary])=>'<button type="button" class="cf-theme-swatch" data-theme-swatch="'+strong+'" aria-label="Choisir le thème '+label+'" title="'+label+'"><span class="cf-theme-swatch-dot" style="background:linear-gradient(135deg,'+strong+','+secondary+')"></span><span><span class="cf-theme-swatch-name">'+label+'</span><span class="cf-theme-swatch-code">'+strong+'</span></span></button>').join('');
    }
    const input=document.getElementById('cfThemeModalInput'), value=document.getElementById('cfThemeModalValue');
    const cancel=document.getElementById('cfThemeModalCancel'), apply=document.getElementById('cfThemeModalApply');
    const close=v=>{modal.hidden=true;cancel.onclick=null;apply.onclick=null;modal.querySelectorAll('[data-theme-swatch]').forEach(x=>x.onclick=null);resolve(v)};
    modal.hidden=false;
    input.value=normalizeThemeColor(defaultColor);
    value.textContent=normalizeThemeColor(input.value);
    modal.querySelectorAll('[data-theme-swatch]').forEach(x=>x.classList.toggle('is-selected',normalizeThemeColor(x.dataset.themeSwatch)===normalizeThemeColor(input.value)));
    input.oninput=()=>{input.value=normalizeThemeColor(input.value);value.textContent=input.value.toUpperCase()};
    modal.querySelectorAll('[data-theme-swatch]').forEach(x=>x.onclick=()=>{input.value=x.dataset.themeSwatch;value.textContent=input.value;modal.querySelectorAll('[data-theme-swatch]').forEach(y=>y.classList.toggle('is-selected',y===x))});
    cancel.onclick=()=>close(null);
    apply.onclick=()=>close(normalizeThemeColor(input.value));
  });
}
async function persistGeneratedDocumentTheme(id,themeColor,accessToken){
  const color=normalizeThemeColor(themeColor);
  const q=await cfFetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id))+'&select=id,metadata',{cache:'no-store',headers:{'Authorization':'Bearer '+accessToken}});
  const qt=await q.text();
  if(!q.ok)throw new Error('Lecture des métadonnées impossible (HTTP '+q.status+').');
  let rows=[];try{rows=qt?JSON.parse(qt):[]}catch(_){rows=[]}
  const current=Array.isArray(rows)&&rows[0]?.metadata&&typeof rows[0].metadata==='object'?rows[0].metadata:{};
  const currentDesign=current.aurore_design&&typeof current.aurore_design==='object'?current.aurore_design:{};
  const metadata={...current,aurore_design:{...currentDesign,theme_color:color,version:1}};
  const u=await cfFetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id)),{
    method:'PATCH',cache:'no-store',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+accessToken},
    body:JSON.stringify({metadata,updated_at:new Date().toISOString()})
  });
  const ut=await u.text();
  if(!u.ok)throw new Error('Enregistrement de la couleur impossible (HTTP '+u.status+'). '+ut);
  return color;
}

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
function cfChildren(node){
  if(!node)return null;
  if(Array.isArray(node.sousNiveaux))return node.sousNiveaux;
  if(Array.isArray(node.troncCommuns))return [...node.troncCommuns,...(Array.isArray(node.series)?node.series:[])];
  if(Array.isArray(node.series))return node.series;
  if(Array.isArray(node.classes))return node.classes;
  if(Array.isArray(node.enfants))return node.enfants;
  return null;
}
function cfIsLeaf(node){return cfChildren(node)===null;}
function cfSelectedValue(id){return String(document.getElementById(id)?.value||'').trim();}
function cfEscape(v){return esc(v);}
function cfSyncSubjectOptions(){
  const sel=document.getElementById('cfCreateSubject');
  const last=cfCreatePath[cfCreatePath.length-1]||null;
  const leaf=last&&cfIsLeaf(last)?last:null;
  if(!sel)return;
  const base=Array.isArray(leaf?.matieres)?leaf.matieres:(Array.isArray(MATIERES)?MATIERES:[]);
  const names=[...new Set(base.map(x=>typeof x==='string'?x:(x?.nom||'')).map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
  sel.innerHTML='<option value="">'+(leaf?'Choisir une matière…':'Choisir un parcours scolaire…')+'</option>'+names.map(v=>'<option value="'+cfEscape(v)+'">'+cfEscape(v)+'</option>').join('');
  sel.disabled=!leaf||!names.length;
}
function cfResolveClassification(){
  const last=cfCreatePath[cfCreatePath.length-1]||null;
  const leaf=last&&cfIsLeaf(last)?last:null;
  const series=cfCreatePath.find(n=>n.type==='serie')||null;
  const common=Boolean(last&&last.type==='classe-commune'&&['seconde-ti','seconde-ab3'].includes(last.id));
  const level=leaf?(leaf.dbNiveaux?.[0]||(cfCreatePath[0]?.id==='prescolaire'?'Préscolaire':leaf.nom)):'';
  const filiere=(!common&&series)?(series.serie||''):'';
  const className=leaf?String(leaf.nom||'').trim():'';
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value||''};
  set('cfCreateLevel',level);set('cfCreateFiliere',filiere);set('cfCreateClass',className);
  const summary=document.getElementById('cfCreateClassificationSummary');
  if(summary){
    const labels=cfCreatePath.map(n=>n.nom).filter(Boolean);
    summary.textContent=labels.length?(labels.join(' · ')+(leaf?'':' — sélection à terminer')):'Aucun parcours sélectionné';
  }
  cfSyncSubjectOptions();
}
function cfRenderCascade(){
  const zone=document.getElementById('cfCreateCascade');
  if(!zone)return;
  zone.innerHTML='';
  const root=document.createElement('select');
  root.innerHTML='<option value="">Choisir un niveau…</option>'+NIVEAUX.map(n=>'<option value="'+cfEscape(n.id)+'">'+cfEscape(n.nom)+'</option>').join('');
  root.value=cfCreatePath[0]?.id||'';
  root.addEventListener('change',()=>{
    const n=NIVEAUX.find(x=>x.id===root.value)||null;
    cfCreatePath=n?[n]:[];
    cfRenderCascade();cfResolveClassification();
  });
  zone.appendChild(root);
  let current=cfCreatePath[0]||null;
  let depth=1;
  while(current&&!cfIsLeaf(current)){
    const children=cfChildren(current)||[];
    const sel=document.createElement('select');
    sel.innerHTML='<option value="">Choisir…</option>'+children.map(n=>'<option value="'+cfEscape(n.id)+'">'+cfEscape(n.nom)+'</option>').join('');
    sel.value=cfCreatePath[depth]?.id||'';
    const p=depth;
    sel.addEventListener('change',()=>{
      const child=children.find(x=>x.id===sel.value)||null;
      cfCreatePath=cfCreatePath.slice(0,p);
      if(child)cfCreatePath.push(child);
      cfRenderCascade();cfResolveClassification();
    });
    zone.appendChild(sel);
    const chosen=cfCreatePath[depth]||null;
    if(!chosen)break;
    current=chosen;depth++;
  }
}
// La catégorie reste celle du dépôt public. Le type de ressource précise uniquement ce qu'Aurora doit produire.
const CF_RESOURCE_TYPES={
  Documents:['Cours','Fiche de cours','Fiche de révision','Résumé','Corrigé','Document pédagogique'],
  Devoirs:['Devoir','Exercice','Série d’exercices','Corrigé de devoir']
};
function cfUpdateResourceTypes(){
  const category=cfSelectedValue('cfCreateCategory')||'Documents';
  const sel=document.getElementById('cfCreateResourceType');
  if(!sel)return;
  const values=CF_RESOURCE_TYPES[category]||CF_RESOURCE_TYPES.Documents;
  const current=sel.value;
  sel.innerHTML='<option value="">Choisir un type…</option>'+values.map(v=>'<option value="'+cfEscape(v)+'">'+cfEscape(v)+'</option>').join('');
  sel.value=values.includes(current)?current:values[0];
}
function cfInitClassification(){
  document.getElementById('cfCreateCategory')?.addEventListener('change',cfUpdateResourceTypes);
  cfRenderCascade();
  cfResolveClassification();
  cfUpdateResourceTypes();
}
async function loadClassificationOptions(){if(!adminOk())return;cfInitClassification();}
function selectedValue(id){return String(document.getElementById(id)?.value||'').trim();}
async function getJob(jobId){const r=await cfFetch(`${SUPABASE_URL}/rest/v1/aurora_content_jobs?id=eq.${encodeURIComponent(jobId)}&select=id,status,title,generated_document_id,error_message,updated_at`,{cache:'no-store'});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));const a=t?JSON.parse(t):[];return Array.isArray(a)&&a[0]?a[0]:null;}
async function waitForJob(jobId){let last=null;for(let i=0;i<180;i++){const j=await getJob(jobId);if(!j)throw new Error('Job introuvable dans Supabase.');last=j;if(j.status==='queued'){setProgress(8,`Job #${jobId} en file — Aurora attend son tour…`)}else if(j.status==='processing'){setProgress(Math.min(88,18+i*.4),`Aurora traite le document #${jobId}…`)}else if(j.status==='review'){setProgress(100,`Document #${jobId} terminé et placé en contrôle.`);return j}else if(j.status==='failed'||j.status==='rejected'){throw new Error(j.error_message||`La génération s’est arrêtée avec le statut ${j.status}.`)}else{setProgress(12,`Statut Aurora : ${j.status}`)}await new Promise(r=>setTimeout(r,2000));}return last;}
async function runGeneration(item){
  const msg=document.getElementById('cfCreateMsg');generationRunning=true;updateQueueUI();setProgress(2,'Préparation du document « '+item.title+' »…');
  try{
    const finalPrompt=item.prompt+(item.reference?'\n\nRÉFÉRENCE PÉDAGOGIQUE FOURNIE PAR L’ADMINISTRATION : '+item.reference:'');
    const job=await rpc('aurora_create_content_job',{
      p_title:item.title,p_subject:item.subject||null,p_level:item.level||null,p_class_name:item.className||null,p_document_type:item.resourceType,p_prompt:finalPrompt,
      p_instructions:{source:'admin_content_factory',origin:'aurore',queue:'sequential',category:item.category,filiere:item.filiere||null,reference:item.reference||null,rights_confirmed:true,theme_color:normalizeThemeColor(item.themeColor||'#6D28D9'),
        classification:{level:item.level||null,filiere:item.filiere||null,class_name:item.className||null,subject:item.subject||null,category:item.category,resource_type:item.resourceType}}
    });
    const jobId=Number(job);if(!Number.isSafeInteger(jobId)||jobId<1)throw new Error('Identifiant de job invalide.');
    setProgress(8,'Job #'+jobId+' créé — Aurora commence par celui-ci.');
    if(msg){msg.dataset.state='';msg.textContent='Job #'+jobId+' en traitement. Les suivants attendent dans la file.';}
    const workerPromise=cfFetch(SUPABASE_URL+'/functions/v1/aurora-content-worker',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:jobId})}).then(async r=>{const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={error:t}}return{ok:r.ok,status:r.status,data:d};}).catch(e=>({ok:false,status:0,data:{error:e.message||String(e)}}));
    const poll=waitForJob(jobId);const results=await Promise.all([workerPromise,poll]),wr=results[0],jr=results[1];
    if(jr&&jr.status==='review'){
      const generatedId=Number(jr.generated_document_id||0);
      if(generatedId>0){const token=await cfFreshToken();await persistGeneratedDocumentTheme(generatedId,item.themeColor||'#6D28D9',token);}
      if(msg){msg.dataset.state='ok';msg.textContent='✓ « '+item.title+' » est généré et attend le contrôle.';}
      await charger();return;
    }
    if(!wr.ok)throw new Error(wr.data?.error||('HTTP '+wr.status));
    throw new Error('La génération n’a pas abouti.');
  }finally{generationRunning=false;updateQueueUI();}
}
async function processQueue(){if(generationRunning)return;const item=generationQueue.shift();updateQueueUI();if(!item)return;try{await runGeneration(item);}catch(e){const msg=document.getElementById('cfCreateMsg');if(msg){msg.dataset.state='error';msg.textContent=`Le document « ${item.title} » n’a pas pu être généré : ${e.message||e}`}setProgress(100,'Échec de ce document — Aurora passe au suivant.');}finally{updateQueueUI();if(generationQueue.length)processQueue();}}
function enqueueCurrent(){
  if(!adminOk())return;
  const title=selectedValue('cfCreateTitle'),subject=selectedValue('cfCreateSubject'),level=selectedValue('cfCreateLevel'),className=selectedValue('cfCreateClass'),filiere=selectedValue('cfCreateFiliere'),category=selectedValue('cfCreateCategory'),resourceType=selectedValue('cfCreateResourceType'),reference=selectedValue('cfCreateReference'),prompt=(document.getElementById('cfCreatePrompt')?.value||'').trim(),rights=Boolean(document.getElementById('cfCreateRights')?.checked),themeColor=normalizeThemeColor(document.getElementById('cfCreateThemeColor')?.value),msg=document.getElementById('cfCreateMsg');
  if(!title){if(msg){msg.dataset.state='error';msg.textContent='Le titre est obligatoire.';}return;}
  if(!level){if(msg){msg.dataset.state='error';msg.textContent='Sélectionne le parcours scolaire complet.';}return;}
  if(!subject){if(msg){msg.dataset.state='error';msg.textContent='Sélectionne la matière.';}return;}
  if(!category){if(msg){msg.dataset.state='error';msg.textContent='Choisis la catégorie.';}return;}
  if(!resourceType){if(msg){msg.dataset.state='error';msg.textContent='Choisis le type de ressource.';}return;}
  if(!prompt){if(msg){msg.dataset.state='error';msg.textContent='La demande pédagogique est obligatoire.';}return;}
  if(!rights){if(msg){msg.dataset.state='error';msg.textContent='Confirme l’autorisation d’utiliser la demande et les références fournies.';}return;}
  generationQueue.push({title,subject,level,className,filiere,category,resourceType,reference,prompt,themeColor,rights});
  if(msg){msg.dataset.state='ok';msg.textContent='« '+title+' » ajouté à la file ('+generationQueue.length+' en attente'+(generationRunning?' derrière le document en cours':'')+').';}
  updateQueueUI();if(!generationRunning)processQueue();
}
function bindClassification(){
  const themeInput=document.getElementById('cfCreateThemeColor'),themeValue=document.getElementById('cfCreateThemeColorValue'),themeSwatches=document.getElementById('cfCreateThemeSwatches');
  const syncThemeColor=()=>{if(themeInput&&themeValue)themeValue.textContent=normalizeThemeColor(themeInput.value);themeSwatches?.querySelectorAll('[data-create-theme]').forEach(b=>b.classList.toggle('is-selected',normalizeThemeColor(b.dataset.createTheme)===normalizeThemeColor(themeInput?.value||'#6D28D9')))};
  themeInput?.addEventListener('input',syncThemeColor);
  themeSwatches?.querySelectorAll('[data-create-theme]').forEach(b=>b.addEventListener('click',()=>{if(themeInput){themeInput.value=normalizeThemeColor(b.dataset.createTheme);syncThemeColor()}}));
  syncThemeColor();
  loadClassificationOptions();
}

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

function ensureCfPdfProductionStyles(){if(document.getElementById('cfPdfProductionStyles'))return;const s=document.createElement('style');s.id='cfPdfProductionStyles';s.textContent='.cf-pdf-production{margin:18px 0;padding:18px;border:1px solid rgba(18,80,50,.22);border-radius:18px;background:var(--card-bg,#fff);box-shadow:0 8px 30px rgba(0,0,0,.08)}.cf-pdf-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px}.cf-pdf-head strong{font-size:1.05rem}.cf-pdf-head small,.cf-pdf-page-card small{display:block;opacity:.7;margin-top:4px}.cf-pdf-pages{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.cf-pdf-page-card{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px;border:1px solid rgba(0,0,0,.1);border-radius:12px;background:rgba(127,127,127,.06)}.cf-pdf-production-actions{display:flex;align-items:center;gap:12px;margin-top:16px;flex-wrap:wrap}.cf-pdf-production-actions span{font-size:.9rem;opacity:.75}@media(max-width:600px){.cf-pdf-head{align-items:flex-start;flex-direction:column}.cf-pdf-pages{grid-template-columns:1fr}}';document.head.appendChild(s)}
function cfPdfProductionBlock(id,total){
  let box=document.getElementById('cfPdfProduction');
  if(!box){box=document.createElement('section');box.id='cfPdfProduction';box.className='cf-pdf-production';const anchor=document.getElementById('cfProgress');(anchor?.parentNode||document.body).insertBefore(box,anchor||null);}
  box.hidden=false;
  box.innerHTML='<div class="cf-pdf-head"><div><strong>Production du PDF</strong><div id="cfPdfProductionStage">Préparation…</div></div><span id="cfPdfProductionCount">0/'+total+' page(s)</span></div><div class="cf-pdf-pages" id="cfPdfProductionPages"></div><div class="cf-pdf-production-actions"><button type="button" class="admin-btn primary" id="cfPdfMergeAll" disabled>Fusionner tous les PDF</button><span id="cfPdfProductionWait"></span></div>';
  return box;
}
function cfPdfPageCard(n,status,url){
  const pages=document.getElementById('cfPdfProductionPages');if(!pages)return;
  let card=document.getElementById('cfPdfPage-'+n);if(!card){card=document.createElement('div');card.id='cfPdfPage-'+n;card.className='cf-pdf-page-card';pages.appendChild(card)}
  const label=status==='ok'?'Page prête':status==='working'?'En cours…':status==='error'?'Erreur':'En attente';
  card.innerHTML='<div><strong>Page '+n+'</strong><small>'+label+'</small></div>'+(status==='ok'&&url?'<a class="admin-btn ghost" href="'+esc(url)+'" target="_blank" rel="noopener">Lire</a>':'');
}
function cfPdfWait(ms,label){
  return new Promise(resolve=>{const out=document.getElementById('cfPdfProductionWait');let left=Math.ceil(ms/1000);const tick=()=>{if(out)out.textContent=(label||'Nouvelle reprise automatique dans ')+' '+left+' s';if(left<=0){if(out)out.textContent='';resolve();return}left--;setTimeout(tick,1000)};tick()});
}
async function renderPdfPageByPageFromBrowser(id,accessToken,b){
  const h={apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+accessToken,'Content-Type':'application/json'};
  const r=await fetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id))+'&select=id,title,content_json',{headers:h,cache:'no-store'});
  const t=await r.text();let data=[];try{data=t?JSON.parse(t):[]}catch(_){data=[]}
  if(!r.ok||!Array.isArray(data)||!data[0])throw new Error('Document généré introuvable.');
  const d=data[0].content_json||{},parts=[];
  if(d.introduction)parts.push({title:d.title||'Introduction',content:[String(d.introduction)],graphs:[]});
  if(Array.isArray(d.learning_objectives)&&d.learning_objectives.length)parts.push({title:'Objectifs',content:["Objectifs d'apprentissage:",...d.learning_objectives.map(String)],graphs:[]});
  for(const s of Array.isArray(d.sections)?d.sections:[]){const blocks=[];if(s.objective)blocks.push(String(s.objective));if(Array.isArray(s.content))blocks.push(...s.content.map(String));if(Array.isArray(s.exercises))for(const e of s.exercises)blocks.push('Exercice: '+String(e?.question||''));if(s.formula)blocks.push(String(s.formula));if(blocks.length)parts.push({title:s.title||'Section',content:blocks,graphs:Array.isArray(s.graphs)?s.graphs:[]});}
  if(Array.isArray(d.corrections)&&d.corrections.length)parts.push({title:'Corrigés',content:d.corrections.map(c=>'Corrigé — exercice '+String(c?.exercise_number||'')+': '+String(c?.solution||'')),graphs:[]});
  if(!parts.length)throw new Error('Aucun contenu à paginer.');
  cfPdfProductionBlock(id,parts.length);
  const paths=[],uid=session?.user_id||session?.id;if(!uid)throw new Error('Identifiant utilisateur introuvable pour le rendu PDF.');
  const batchSize=5;
  for(let i=0;i<parts.length;i++){
    const n=i+1;cfPdfPageCard(n,'working');setProgress(8+(i/parts.length)*82,'Rendu page '+n+'/'+parts.length+'…');if(b)b.textContent='PDF — page '+n+'/'+parts.length+'…';
    const pagePath='aurora-content-pages/'+uid+'/'+id+'/page-'+String(n).padStart(4,'0')+'.pdf';
    let done=false,last='';
    for(let attempt=0;attempt<3&&!done;attempt++){
      const pr=await fetch(SUPABASE_URL+'/functions/v1/aurora-content-pdf-page',{method:'POST',headers:h,body:JSON.stringify({generated_document_id:Number(id),page_number:n,page_path:pagePath,content:parts[i]})});
      const pt=await pr.text();let pd={};try{pd=pt?JSON.parse(pt):{}}catch(_){pd={error:pt}};
      if(pr.ok&&pd?.ok){paths.push(pd.page_path);cfPdfPageCard(n,'ok',pd.page_url||'');done=true;break}
      last=pd?.error||('Renderer page HTTP '+pr.status);
      if(pr.status===429||/rate limit/i.test(String(last))){const retry=Math.max(30000,Number(pr.headers.get('Retry-After')||0)*1000);if(attempt<2){await cfPdfWait(retry,'Reprise automatique dans');continue}}else throw new Error(last);
    }
    if(!done){cfPdfPageCard(n,'error');throw new Error(last||'Rendu de la page impossible après plusieurs tentatives.')}
    const stage=document.getElementById('cfPdfProductionStage');if(stage)stage.textContent='Pages prêtes : '+paths.length+'/'+parts.length;
    const count=document.getElementById('cfPdfProductionCount');if(count)count.textContent=paths.length+'/'+parts.length+' page(s)';
    if(paths.length<parts.length&&n%batchSize===0)await cfPdfWait(30000,'Pause de sécurité — prochaine reprise dans');
  }
  setProgress(100,'Toutes les pages sont prêtes.');if(b)b.textContent='PDF — toutes les pages sont prêtes';
  const stage=document.getElementById('cfPdfProductionStage');if(stage)stage.textContent='Toutes les pages sont prêtes. Tu peux les lire une par une avant la fusion.';
  const merge=document.getElementById('cfPdfMergeAll');if(merge){merge.disabled=false;merge.onclick=async()=>{
    merge.disabled=true;merge.textContent='Fusion en cours…';setProgress(96,'Fusion de toutes les pages PDF…');
    try{const mr=await fetch(SUPABASE_URL+'/functions/v1/aurora-content-pdf-merge',{method:'POST',headers:h,body:JSON.stringify({generated_document_id:Number(id),page_paths:paths})});const mt=await mr.text();let md={};try{md=mt?JSON.parse(mt):{}}catch(_){md={error:mt}};if(!mr.ok||!md?.ok)throw new Error(md?.error||('Fusionneur HTTP '+mr.status));setProgress(100,'PDF final fusionné.');if(stage)stage.textContent='PDF final fusionné et enregistré dans Aurore.';merge.textContent='PDF finalisé';await charger();alert('Toutes les pages ont été fusionnées. Le PDF final est prêt.')}catch(e){merge.disabled=false;merge.textContent='Fusionner tous les PDF';alert('La fusion n’a pas pu être effectuée. '+(e.message||e))}}
  };
  return {pages:paths.length,paths};
}
ensureCfPdfProductionStyles();
async function renderPdf(id,themeColor=null){
  const b=document.querySelector(`[data-cf-render="${id}"]`);
  if(b){b.disabled=true;b.textContent=b.dataset.hasPdf==='1'?'Régénération LuaLaTeX…':'Génération LuaLaTeX…'}
  try{
    const authClient=await assurerClientAuthGoogle();
    if(!authClient)throw new Error('Client Supabase indisponible.');
    const {data:authData,error:authError}=await authClient.auth.getSession();
    if(authError)throw authError;
    const activeSession=authData?.session;
    const accessToken=activeSession?.access_token;
    if(!accessToken)throw new Error('Session administrateur expirée. Reconnecte-toi puis réessaie.');
    if(session){
      session.access_token=accessToken;
      if(activeSession.refresh_token)session.refresh_token=activeSession.refresh_token;
      if(activeSession.expires_at)session.expires_at=activeSession.expires_at*1000;
      sauvegarderSession();
    }

    const rowForTheme=rows.find(x=>Number(x.id)===Number(id));
    await persistGeneratedDocumentTheme(id,themeColor||documentThemeColor(rowForTheme?.metadata),accessToken);
    if(b)b.textContent='Préparation de la nouvelle identité Aurore…';

    const graphCount=await auroraConstruireEtImporterGraphiquesGeoGebra(id,b,accessToken);
    if(b)b.textContent=graphCount?`Mise en file LuaLaTeX avec ${graphCount} graphique${graphCount>1?'s':''} GeoGebra…`:'Mise en file LuaLaTeX…';
    setProgress(12,'Document envoyé au moteur LuaLaTeX…');

    const request=await cfFetch(`${SUPABASE_URL}/functions/v1/aurora-lualatex-request`,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${accessToken}`},
      body:JSON.stringify({generated_document_id:Number(id)})
    });
    const requestText=await request.text();
    let requestData={};
    try{requestData=requestText?JSON.parse(requestText):{}}catch(_){requestData={error:requestText}};
    if(!request.ok||!requestData?.ok)throw new Error(requestData?.error||(`File d'attente LuaLaTeX HTTP ${request.status}`));

    setProgress(18,'En attente du rendu LuaLaTeX…');
    if(b)b.textContent='LuaLaTeX en préparation…';

    // Le rendu est totalement découplé de la page : une fois la demande acceptée,
    // GitHub Actions continue même si l'écran est verrouillé, l'onglet est fermé
    // ou le navigateur est mis en veille. Le navigateur ne fait qu'observer.
    const foregroundDeadline=Date.now()+2*60*1000;
    let completed=null;
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    while(Date.now()<foregroundDeadline){
      if(document.visibilityState==='hidden'){
        setProgress(92,'Rendu en arrière-plan. Le PDF continue même écran verrouillé.');
        await new Promise(resolve=>{
          const resume=()=>{document.removeEventListener('visibilitychange',resume);resolve();};
          document.addEventListener('visibilitychange',resume,{once:true});
        });
        continue;
      }
      const q=await cfFetch(`${SUPABASE_URL}/rest/v1/aurora_generated_documents?id=eq.${encodeURIComponent(Number(id))}&select=id,pdf_url,pdf_path,metadata,status,updated_at`,{cache:'no-store',headers:{'Authorization':`Bearer ${accessToken}`}});
      const qt=await q.text();
      if(!q.ok)throw new Error(`Lecture de l'état LuaLaTeX impossible (HTTP ${q.status}). Le rendu serveur continue en arrière-plan.`);
      let rows=[];
      try{rows=qt?JSON.parse(qt):[]}catch(_){throw new Error('Réponse Supabase invalide pendant le suivi du rendu.');}
      const row=Array.isArray(rows)?rows[0]:null;
      if(!row)throw new Error('Document introuvable pendant le suivi du rendu.');
      const m=row.metadata&&typeof row.metadata==='object'?row.metadata:{};
      if(row.pdf_url&&m.lualatex_status==='completed'){completed=row;break}
      if(m.lualatex_status==='failed')throw new Error('Le rendu LuaLaTeX a échoué. Consulte les journaux GitHub Actions.');
      const elapsed=Date.now()-(foregroundDeadline-2*60*1000);
      setProgress(Math.min(92,18+Math.floor(elapsed/1000/10)),`LuaLaTeX travaille… ${Math.floor(elapsed/1000)} s`);
      await wait(5000);
    }
    if(!completed){
      setProgress(92,'Rendu en arrière-plan — le PDF continue automatiquement.');
      if(b)b.textContent='LuaLaTeX continue en arrière-plan…';
      await charger();
      surveillerRenduArrierePlan(id,accessToken,b);
      return;
    }
    setProgress(100,'PDF LuaLaTeX généré et enregistré.');
    if(b)b.textContent='PDF LuaLaTeX prêt';
    await charger();
    setTimeout(()=>setProgress(0,'Prêt pour une nouvelle génération.'),1200);
    alert(graphCount?`PDF LuaLaTeX généré avec ${graphCount} graphique${graphCount>1?'s':''} GeoGebra.`:'PDF LuaLaTeX généré et enregistré.');
  }catch(e){
    alert('Le PDF n’a pas pu être généré. '+(e.message||e))
  }finally{
    if(b){b.disabled=false;b.textContent=b.dataset.hasPdf==='1'?'Régénérer le PDF':'Générer le PDF'}
  }
}
async function validateDoc(id){const n=prompt('Note de validation (facultatif) :','');if(n===null)return;try{await rpc('aurora_validate_generated_document',{p_generated_document_id:Number(id),p_notes:n||null});await charger()}catch(e){alert('Validation impossible. '+(e.message||e))}}
async function rejectDoc(id){const n=prompt('Motif du rejet / corrections demandées :','');if(n===null)return;if(!n.trim()){alert('Indique un motif pour rejeter le document.');return}try{await rpc('aurora_reject_generated_document',{p_generated_document_id:Number(id),p_notes:n.trim()});await charger()}catch(e){alert('Rejet impossible. '+(e.message||e))}}
async function publishDoc(id){if(!confirm('Publier ce document dans la bibliothèque publique Aurore ?\n\nCette action crée un document publié à partir du PDF validé.'))return;const n=prompt('Note de publication (facultatif) :','');if(n===null)return;try{await rpc('aurora_publish_generated_document',{p_generated_document_id:Number(id),p_notes:n||null});await charger();alert('Document publié dans la bibliothèque Aurore.')}catch(e){alert('Publication impossible. '+(e.message||e))}}
function apply(){const q=(document.getElementById('adminSearchContentFactory')?.value||'').trim().toLowerCase(),st=document.getElementById('adminFilterContentFactory')?.value||'',sort=document.getElementById('adminSortContentFactory')?.value||'recent';let a=rows.filter(x=>(!st||x.status===st)&&(!q||[x.title,x.subject,x.level,x.class_name,x.document_type,x.status].filter(Boolean).join(' ').toLowerCase().includes(q)));a.sort((x,y)=>{if(sort==='az')return String(x.title).localeCompare(String(y.title),'fr');if(sort==='za')return String(y.title).localeCompare(String(x.title),'fr');const ax=new Date(x.created_at).getTime(),ay=new Date(y.created_at).getTime();return sort==='oldest'?ax-ay:ay-ax});if(!a.length){list.innerHTML='<div class="admin-empty">Aucun document généré pour ces critères.</div>';return}list.innerHTML=a.map(x=>{const pdf=!!x.pdf_url,canRender=['generated','review','approved'].includes(x.status),canValidate=x.status==='review'&&pdf,canReject=['review','approved'].includes(x.status),canPublish=['approved','review'].includes(x.status)&&pdf;return `<article class="cf-admin-card"><div class="cf-admin-icon">PDF</div><div class="cf-admin-body"><div class="cf-admin-title">${esc(x.title)}</div><div class="cf-admin-meta">${esc([x.subject,x.level,x.class_name,x.document_type].filter(Boolean).join(' · '))}<br>Créé le ${esc(new Date(x.created_at).toLocaleString('fr-FR'))}${x.version?' · Version '+esc(x.version):''}</div><span class="cf-admin-status">${esc(sl(x.status))}${pdf?' · PDF prêt':''}</span>${x.validation_notes?`<div class="cf-admin-meta">${esc(x.validation_notes)}</div>`:''}<div class="cf-admin-actions">${pdf?`<a class="admin-btn ghost" href="${esc(x.pdf_url)}" target="_blank" rel="noopener">Ouvrir le PDF</a>`:''}${canRender?`<button type="button" class="admin-btn primary" data-cf-render="${esc(x.id)}" data-has-pdf="${pdf?'1':'0'}" data-theme-color="${documentThemeColor(x.metadata)}">${pdf?'Régénérer le PDF':'Générer le PDF'}</button>`:''}${canValidate?`<button type="button" class="admin-btn valider" data-cf-validate="${esc(x.id)}">Valider</button>`:''}${canReject?`<button type="button" class="admin-btn refuser" data-cf-reject="${esc(x.id)}">Rejeter</button>`:''}${canPublish?`<button type="button" class="admin-btn primary" data-cf-publish="${esc(x.id)}">Publier</button>`:''}${x.published_document_id?`<button type="button" class="admin-btn ghost" disabled>Déjà publié #${esc(x.published_document_id)}</button>`:''}</div>${x.error_message?`<div class="cf-admin-error">${esc(x.error_message)}</div>`:''}</div></article>`}).join('')}
async function surveillerRenduArrierePlan(id,accessToken,b){
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  for(let i=0;i<180;i++){
    try{
      const q=await cfFetch(`${SUPABASE_URL}/rest/v1/aurora_generated_documents?id=eq.${encodeURIComponent(Number(id))}&select=id,pdf_url,metadata,status,updated_at`,{cache:'no-store',headers:{'Authorization':`Bearer ${accessToken}`}});
      const qt=await q.text();if(!q.ok)throw new Error('HTTP '+q.status);
      const rows=qt?JSON.parse(qt):[],row=Array.isArray(rows)?rows[0]:null;
      const m=row?.metadata&&typeof row.metadata==='object'?row.metadata:{};
      if(row?.pdf_url&&m.lualatex_status==='completed'){
        setProgress(100,'PDF LuaLaTeX généré et enregistré.');
        if(b){b.disabled=false;b.textContent='PDF LuaLaTeX prêt';}
        const msg=document.getElementById('cfCreateMsg');
        if(msg){msg.dataset.state='ok';msg.textContent='✓ PDF terminé automatiquement. Le document est de nouveau disponible dans la liste.';}
        await charger();
        setTimeout(()=>setProgress(0,'Prêt pour une nouvelle génération.'),1600);
        return true;
      }
      if(m.lualatex_status==='failed'){
        setProgress(0,'Prêt — le rendu précédent a échoué.');
        if(b){b.disabled=false;b.textContent=b.dataset.hasPdf==='1'?'Régénérer le PDF':'Générer le PDF';}
        await charger();return false;
      }
    }catch(e){console.warn('[Content Factory] Suivi arrière-plan:',e);}
    await wait(10000);
  }
  return false;
}

async function charger(){if(!adminOk()){list.innerHTML='<div class="admin-empty">Cette action est réservée aux administrateurs.</div>';return}list.innerHTML='<div class="admin-empty">Chargement…</div>';try{const r=await cfFetch(`${SUPABASE_URL}/rest/v1/aurora_generated_documents?select=id,job_id,created_at,updated_at,created_by,title,subject,level,class_name,document_type,source_format,pdf_path,pdf_url,version,status,validation_notes,published_document_id,metadata,pdf_diagnostic&order=created_at.desc`,{cache:'no-store'}),t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));rows=t?JSON.parse(t):[];if(!Array.isArray(rows))rows=[];const c={review:0,approved:0,published:0,failed:0};rows.forEach(x=>{if(c[x.status]!=null)c[x.status]++});document.getElementById('cfCountReview').textContent=c.review;document.getElementById('cfCountApproved').textContent=c.approved;document.getElementById('cfCountPublished').textContent=c.published;document.getElementById('cfCountFailed').textContent=c.failed;if(count)count.textContent=String(c.review);apply()}catch(e){list.innerHTML=`<div class="admin-empty">Impossible de charger Content Factory.<br>${esc(e.message||e)}</div>`}}
document.getElementById('cfCreateLaunch')?.addEventListener('click',enqueueCurrent);document.getElementById('adminRefreshContentFactory')?.addEventListener('click',charger);document.getElementById('adminSearchContentFactory')?.addEventListener('input',apply);document.getElementById('adminSortContentFactory')?.addEventListener('change',apply);document.getElementById('adminFilterContentFactory')?.addEventListener('change',apply);list.addEventListener('click',async e=>{const r=e.target.closest('[data-cf-render]'),v=e.target.closest('[data-cf-validate]'),x=e.target.closest('[data-cf-reject]'),p=e.target.closest('[data-cf-publish]');if(r){if(r.dataset.hasPdf==='1'){if(!confirm('Ce document possède déjà un PDF. Le nouveau rendu remplacera le PDF actuel. Continuer ?'))return;const chosen=await chooseRegenerationTheme(r.dataset.themeColor||'#6D28D9');if(!chosen)return;renderPdf(r.dataset.cfRender,chosen)}else{renderPdf(r.dataset.cfRender,r.dataset.themeColor||'#6D28D9')}}else if(v)validateDoc(v.dataset.cfValidate);else if(x)rejectDoc(x.dataset.cfReject);else if(p)publishDoc(p.dataset.cfPublish)});bindClassification();window.chargerAuroraContentFactoryAdmin=charger;})();
