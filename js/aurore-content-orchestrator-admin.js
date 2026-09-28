(function(){
'use strict';
if(typeof window==='undefined'||window.__auroreContentOrchestratorAdmin)return;
window.__auroreContentOrchestratorAdmin=true;
const PROTOCOL='aurore-content-orchestrator-v1';
const EDITOR_ENGINE='ChatGPT';
const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML};
const panel=()=>document.querySelector('.admin-tab-panel[data-panel="aurora-request"]');

async function getToken(){
  if(typeof assurerClientAuthGoogle!=='function')throw new Error('Client Supabase indisponible.');
  const client=await assurerClientAuthGoogle();
  let s=(await client.auth.getSession())?.data?.session||null;
  if(!s?.access_token)throw new Error('Session administrateur expirée.');
  if(s.expires_at&&Date.now()>=s.expires_at*1000-60000){
    const refreshed=await client.auth.refreshSession();
    if(refreshed.error||!refreshed.data?.session?.access_token)throw(refreshed.error||new Error('Impossible de rafraîchir la session.'));
    s=refreshed.data.session;
  }
  session={...(session||{}),access_token:s.access_token,refresh_token:s.refresh_token||session?.refresh_token||'',expires_at:s.expires_at?s.expires_at*1000:0};
  if(typeof sauvegarderSession==='function')sauvegarderSession();
  return s.access_token;
}

async function rest(path,options={}){
  const token=await getToken();
  const fetcher=typeof adminInventoryFetch==='function'?adminInventoryFetch:fetch;
  const headers={apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+token,...(options.headers||{})};
  const r=await fetcher(SUPABASE_URL+path,{...options,headers,cache:'no-store'});
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null}catch(_){data=raw}
  if(!r.ok)throw new Error(data?.message||data?.error||raw||('HTTP '+r.status));
  return data;
}
async function rpc(name,body){return rest('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})}
async function getJob(id){
  const rows=await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(id))+'&select=id,status,title,subject,level,class_name,document_type,metadata,created_at,updated_at');
  return Array.isArray(rows)?rows[0]||null:null;
}
async function listJobs(){
  const rows=await rest('/rest/v1/aurora_content_jobs?select=id,status,title,subject,level,class_name,document_type,metadata,created_at,updated_at&status=in.(draft,queued,processing,review)&order=created_at.desc&limit=100');
  return (Array.isArray(rows)?rows:[]).filter(x=>x?.metadata?.workflow?.protocol===PROTOCOL);
}
async function patchWorkflow(id,patch){
  const row=await getJob(id);
  if(!row)throw new Error('Demande introuvable.');
  const m=row.metadata&&typeof row.metadata==='object'?row.metadata:{};
  const w=m.workflow&&typeof m.workflow==='object'?m.workflow:{};
  const metadata={...m,manual_publication_only:true,workflow:{...w,...patch,protocol:PROTOCOL,updated_at:new Date().toISOString()}};
  await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(id)),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({metadata,updated_at:new Date().toISOString()})});
  return {...row,metadata};
}
async function createTask(cls,sub){
  const result=await rpc('aurora_create_content_job',{
    p_title:'Préparation — '+cls+' — '+sub,p_subject:sub,p_level:cls,p_class_name:cls,p_document_type:'cours',
    p_prompt:'Préparation éditoriale Aurore : l’éditeur est ChatGPT dans une conversation dédiée. Aucun moteur IA du site et aucun PDF ne sont sollicités à cette étape.',
    p_instructions:{source:'admin_orchestrator',origin:'aurore_content_orchestrator',queue:'manual',category:'Documents',rights_confirmed:true,manual_publication_only:true,lualatex_requested:false,pdf_launch_mode:'manual',auto_pdf_launch:false,
      editorial:{role:'editor',engine:EDITOR_ENGINE,schema_version:'aurora-editorial-1',status:'awaiting_editor'},
      classification:{level:cls,class_name:cls,subject:sub,category:'Documents',resource_type:'cours'},
      workflow:{protocol:PROTOCOL,stage:'initiale',proposal_version:0,user_validated:false,manual_pdf_only:true,editorial_engine:EDITOR_ENGINE}
    }
  });
  const id=Number(result);
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Identifiant de demande invalide.');
  const row=await getJob(id);
  if(row){
    const metadata={...(row.metadata||{}),manual_publication_only:true,pdf_launch_mode:'manual',auto_pdf_launch:false,editorial_engine:EDITOR_ENGINE,workflow:{...((row.metadata||{}).workflow||{}),protocol:PROTOCOL,stage:'initiale',editorial_engine:EDITOR_ENGINE}};
    await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'draft',metadata,updated_at:new Date().toISOString()})});
  }
  return getJob(id);
}
function injectStyle(){
  if(document.getElementById('aurore-content-orchestrator-styles'))return;
  const s=document.createElement('style');s.id='aurore-content-orchestrator-styles';
  s.textContent='#auroreContentOrchestrator{display:grid;gap:14px}.aurore-flow-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.aurore-flow-card{border:1px solid var(--bordure,rgba(0,0,0,.1));border-radius:18px;background:var(--fond,#fff);padding:15px}.aurore-flow-kicker{font-size:.62rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;opacity:.6}.aurore-flow-card h4{margin:5px 0 6px;font-size:.92rem}.aurore-flow-card p{font-size:.72rem;line-height:1.45;opacity:.72}.aurore-flow-field{display:grid;gap:5px;margin:8px 0}.aurore-flow-field span{font-size:.68rem;font-weight:800}.aurore-flow-field input,.aurore-flow-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--bordure,rgba(0,0,0,.12));border-radius:11px;padding:9px;background:var(--card-bg,#fff);color:inherit;font:inherit;font-size:.75rem}.aurore-flow-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.aurore-flow-list,.aurore-chapter-grid{display:grid;gap:7px;margin-top:10px}.aurore-flow-task,.aurore-chapter{border:1px solid var(--bordure,rgba(0,0,0,.09));border-radius:12px;padding:9px}.aurore-flow-task{display:flex;justify-content:space-between;gap:7px}.aurore-flow-task strong,.aurore-flow-task small{display:block}.aurore-flow-task small{font-size:.6rem;opacity:.6;margin-top:2px}.aurore-chapter h5{margin:0 0 4px;font-size:.75rem}.aurore-chapter p{margin:0 0 8px;font-size:.65rem;opacity:.7}.aurore-flow-status{margin-top:9px;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,#6D28D9 8%,transparent);font-size:.66rem}.aurore-proposal-line{font-size:.68rem;line-height:1.45;margin-bottom:8px}.aurore-proposal-line strong{display:block;font-size:.62rem;opacity:.62;margin-bottom:2px}.aurore-proposal-edit{display:grid;gap:7px}.aurore-proposal-edit textarea{min-height:68px;resize:vertical}@media(max-width:900px){.aurore-flow-grid{grid-template-columns:1fr}}';
  document.head.appendChild(s);
}
function proposalHTML(p,w){
  const objectives=Array.isArray(p.objectives)?p.objectives:[],plan=Array.isArray(p.content_plan)?p.content_plan:[],editing=w.editing===true,validated=w.user_validated===true,rejected=w.stage==='rejected';
  if(editing)return '<div class="aurore-proposal-edit"><label class="aurore-flow-field"><span>Titre</span><input id="auroreProposalTitle" value="'+esc(p.title)+'"></label><label class="aurore-flow-field"><span>Description</span><textarea id="auroreProposalDescription">'+esc(p.description)+'</textarea></label><label class="aurore-flow-field"><span>Objectifs (un par ligne)</span><textarea id="auroreProposalObjectives">'+esc(objectives.join('\\n'))+'</textarea></label><label class="aurore-flow-field"><span>Plan (un par ligne)</span><textarea id="auroreProposalPlan">'+esc(plan.join('\\n'))+'</textarea></label><label class="aurore-flow-field"><span>Nombre d’exercices</span><input id="auroreProposalExercises" type="number" min="0" max="30" value="'+esc(p.exercise_plan?.count||0)+'"></label><div class="aurore-flow-actions"><button type="button" class="admin-btn primary" id="auroreProposalSave">Enregistrer</button><button type="button" class="admin-btn ghost" id="auroreProposalCancelEdit">Annuler</button></div></div>';
  return '<div class="aurore-proposal-line"><strong>Titre</strong>'+esc(p.title)+'</div><div class="aurore-proposal-line"><strong>Description</strong>'+esc(p.description)+'</div><div class="aurore-proposal-line"><strong>Objectifs</strong>'+objectives.map(x=>'<div>• '+esc(x)+'</div>').join('')+'</div><div class="aurore-proposal-line"><strong>Plan</strong>'+plan.map(x=>'<div>• '+esc(x)+'</div>').join('')+'</div><div class="aurore-proposal-line"><strong>Exercices</strong>'+esc(p.exercise_plan?.count||0)+' · '+(p.exercise_plan?.correction!==false?'corrigés prévus':'sans corrigé')+'</div><div class="aurore-proposal-line"><strong>Circuit</strong>Éditeur : ChatGPT · PDF : pipeline Aurore manuel</div><div class="aurore-flow-actions">'+(validated?'<button type="button" class="admin-btn primary" id="aurorePrepareProduction">Préparer la production</button><button type="button" class="admin-btn ghost" id="auroreProposalUnvalidate">Revenir en révision</button>':rejected?'<button type="button" class="admin-btn ghost" id="auroreProposalEdit">Réouvrir</button>':'<button type="button" class="admin-btn ghost" id="auroreProposalEdit">Modifier</button><button type="button" class="admin-btn ghost" id="auroreProposalRevision">Préparer une révision ChatGPT</button><button type="button" class="admin-btn ghost" id="auroreProposalReject">Rejeter</button><button type="button" class="admin-btn primary" id="auroreProposalValidate">Valider la proposition</button>')+'</div><div class="aurore-flow-status">'+(validated?'Proposition validée par l’administrateur.':rejected?'Proposition rejetée par l’administrateur.':'Proposition en attente de validation humaine.')+'</div>';
}
async function refresh(state,id){
  state.tasks=await listJobs();
  state.task=await getJob(id);
  render(document.getElementById('auroreContentOrchestrator'),state);
}
function buildChatGPTBrief(state,kind,note){
  const t=state.task,w=t?.metadata?.workflow||{},ch=w.selected_chapter||{};
  if(kind==='chapters')return ['Aurore — éditeur ChatGPT','','Tâche : '+t.id,'Classe : '+(t.class_name||''),'Matière : '+(t.subject||''),'Niveau : '+(t.level||''),'','Propose 4 à 16 chapitres plausibles et distincts adaptés à cette classe et cette matière.','Ne génère aucun PDF et ne lance aucun moteur de rendu.','Retourne uniquement : {"chapters":[{"id":"...","title":"...","description":"...","order":1}]}'].join('\\n');
  if(kind==='proposal')return ['Aurore — proposition éditoriale ChatGPT','','Tâche : '+t.id,'Classe : '+(t.class_name||''),'Matière : '+(t.subject||''),'Chapitre : '+(ch.title||''),'','Prépare uniquement la proposition éditoriale, pas le cours complet.','Retourne uniquement un JSON avec title, document_type, description, objectives, content_plan, exercise_plan et tools.','Ne génère aucun PDF et ne lance aucun moteur de rendu.'].join('\\n');
  return ['Aurore — révision éditoriale ChatGPT','','Tâche : '+t.id,'Classe : '+(t.class_name||''),'Matière : '+(t.subject||''),'Chapitre : '+(ch.title||''),'Demande : '+(note||w.revision_request||''),'','Révise la proposition courante et retourne uniquement la proposition complète au même format JSON.','Ne génère aucun PDF et ne lance aucun moteur de rendu.','PROPOSITION COURANTE :',JSON.stringify(w.proposal||{},null,2)].join('\\n');
}
async function copyChatGPTBrief(state,kind,note){
  if(!navigator.clipboard?.writeText)throw new Error('Copie automatique indisponible sur ce navigateur.');
  await navigator.clipboard.writeText(buildChatGPTBrief(state,kind,note));
  statusMsg('Brief ChatGPT copié. Ouvre la conversation ChatGPT puis colle-le.');
}
function manualImportDialog(kind){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    const box=document.createElement('div');box.style.cssText='width:min(820px,100%);max-height:90vh;overflow:auto;background:var(--fond,#fff);color:inherit;border:1px solid var(--bordure,rgba(0,0,0,.12));border-radius:18px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.24);';
    const title=kind==='chapters'?'Importer les chapitres de ChatGPT':'Importer la proposition de ChatGPT';
    const help=kind==='chapters'?'Colle le JSON : {"chapters":[{"id":"fonctions","title":"Fonctions","description":"...","order":1}]}':'Colle le JSON : {"title":"...","description":"...","objectives":["..."],"content_plan":["..."],"exercise_plan":{"count":8,"correction":true}}';
    box.innerHTML='<div style="font-size:.62rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;opacity:.6">ChatGPT → Aurore</div><h3 style="margin:5px 0 8px">'+esc(title)+'</h3><p style="font-size:.72rem;line-height:1.5;opacity:.72">'+esc(help)+'</p><textarea id="auroreChatGPTImportText" style="width:100%;min-height:260px;box-sizing:border-box;border:1px solid var(--bordure,rgba(0,0,0,.14));border-radius:12px;padding:10px;background:var(--card-bg,#fff);color:inherit;font:inherit;font-size:.76rem"></textarea><div class="aurore-flow-actions"><button type="button" class="admin-btn primary" id="auroreChatGPTImportSave">Importer</button><button type="button" class="admin-btn ghost" id="auroreChatGPTImportCancel">Annuler</button></div><div id="auroreChatGPTImportError" class="aurore-flow-status" hidden></div>';
    overlay.appendChild(box);document.body.appendChild(overlay);
    const close=v=>{overlay.remove();resolve(v)};
    box.querySelector('#auroreChatGPTImportCancel').onclick=()=>close(null);
    box.querySelector('#auroreChatGPTImportSave').onclick=()=>{const raw=box.querySelector('#auroreChatGPTImportText').value.trim();if(!raw)return;try{close(JSON.parse(raw))}catch(_){const er=box.querySelector('#auroreChatGPTImportError');er.hidden=false;er.textContent='JSON invalide. Vérifie le bloc renvoyé par ChatGPT.'}};
  });
}
function normalizeChapters(raw){
  const arr=Array.isArray(raw)?raw:raw?.chapters;if(!Array.isArray(arr)||!arr.length||arr.length>16)throw new Error('Les chapitres doivent contenir de 1 à 16 éléments.');
  const seen=new Set();
  return arr.map((x,i)=>{const title=String(x?.title||'').trim();if(!title)throw new Error('Chapitre '+(i+1)+' : titre obligatoire.');let id=String(x?.id||title).trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||('chapitre-'+(i+1));if(seen.has(id))id+='-'+(i+1);seen.add(id);return {id,title:title.slice(0,220),description:String(x?.description||'').trim().slice(0,500),order:Number.isFinite(Number(x?.order))?Number(x.order):i+1}});
}
function normalizeProposal(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('La proposition doit être un objet JSON.');
  const title=String(raw.title||'').trim(),description=String(raw.description||'').trim(),objectives=Array.isArray(raw.objectives)?raw.objectives.map(x=>String(x||'').trim()).filter(Boolean).slice(0,12):[],content_plan=Array.isArray(raw.content_plan)?raw.content_plan.map(x=>String(x||'').trim()).filter(Boolean).slice(0,20):[];
  if(!title||!description||!objectives.length||!content_plan.length)throw new Error('La proposition doit contenir title, description, objectives et content_plan.');
  const ep=raw.exercise_plan&&typeof raw.exercise_plan==='object'?raw.exercise_plan:{},tools=raw.tools&&typeof raw.tools==='object'?raw.tools:{};
  return {title:title.slice(0,300),document_type:String(raw.document_type||'cours').trim().slice(0,80)||'cours',description:description.slice(0,1400),objectives,content_plan,exercise_plan:{count:Math.max(0,Math.min(30,Number(ep.count)||0)),correction:ep.correction!==false},tools:{latex:tools.latex===true,geogebra:tools.geogebra===true}};
}
async function discover(state){
  statusMsg('Travail éditorial ChatGPT…');
  try{
    await copyChatGPTBrief(state,'chapters');
    const raw=await manualImportDialog('chapters');if(!raw)return;
    const chapters=normalizeChapters(raw);
    await patchWorkflow(state.task.id,{stage:'chapitres_ready',chapters,chapters_source:EDITOR_ENGINE,selected_chapter:null,proposal:null,user_validated:false,editing:false,rejection_reason:null});
    await refresh(state,state.task.id);
  }catch(e){alert('Import des chapitres impossible : '+(e.message||e))}
}
async function buildProposal(state,ch){
  statusMsg('Travail éditorial ChatGPT…');
  try{
    await patchWorkflow(state.task.id,{stage:'chapitre_selectionne',selected_chapter:ch,proposal:null,user_validated:false,editing:false,rejection_reason:null});
    await refresh(state,state.task.id);
    await copyChatGPTBrief(state,'proposal');
    const raw=await manualImportDialog('proposal');if(!raw)return;
    const proposal=normalizeProposal(raw);
    const t=await getJob(state.task.id),w=t.metadata?.workflow||{},v=Number(w.proposal_version||0)+1;
    await patchWorkflow(state.task.id,{stage:'proposal_review',proposal,proposal_version:v,proposal_versions:(Array.isArray(w.proposal_versions)?w.proposal_versions:[]).concat([{version:v,proposal,source:EDITOR_ENGINE,imported_at:new Date().toISOString()}]),user_validated:false,editing:false,rejection_reason:null});
    await refresh(state,state.task.id);
  }catch(e){alert('Proposition éditoriale impossible : '+(e.message||e))}
}
async function saveProposal(state){
  const w=state.task.metadata.workflow,p=w.proposal||{};
  const next={...p,title:(document.getElementById('auroreProposalTitle')?.value||'').trim(),description:(document.getElementById('auroreProposalDescription')?.value||'').trim(),objectives:(document.getElementById('auroreProposalObjectives')?.value||'').split('\n').map(x=>x.trim()).filter(Boolean),content_plan:(document.getElementById('auroreProposalPlan')?.value||'').split('\n').map(x=>x.trim()).filter(Boolean),exercise_plan:{...(p.exercise_plan||{}),count:Math.max(0,Math.min(30,Number(document.getElementById('auroreProposalExercises')?.value)||0))}};
  if(!next.title||!next.description||!next.objectives.length||!next.content_plan.length){alert('La proposition doit conserver un titre, une description, des objectifs et un plan.');return}
  const v=Number(w.proposal_version||0)+1;
  await patchWorkflow(state.task.id,{stage:'proposal_review',proposal:next,proposal_version:v,user_validated:false,editing:false,proposal_versions:(Array.isArray(w.proposal_versions)?w.proposal_versions:[]).concat([{version:v,proposal:next,source:'human_edit'}])});
  await refresh(state,state.task.id);
}
function render(root,state){
  const t=state.task,w=t?.metadata?.workflow||{},chs=Array.isArray(w.chapters)?w.chapters:[],sel=w.selected_chapter,p=w.proposal||null;
  const raw=Array.isArray(window.MATIERES)?window.MATIERES:[],subs=[...new Set(raw.map(x=>String(typeof x==='string'?x:x?.nom||'').trim()).filter(Boolean))].slice(0,100);
  let h='<div><div class="aurore-flow-kicker">Aurore · orchestrateur éditorial</div><h3 style="margin:4px 0 6px">Préparer une ressource sans tout renseigner</h3><p style="margin:0;max-width:820px;font-size:.72rem;line-height:1.5;opacity:.72">Classe + matière d’abord. ChatGPT prépare les chapitres, la proposition et le contenu dans notre conversation. L’administration importe, contrôle et valide ; le PDF reste un lancement manuel séparé.</p></div><div class="aurore-flow-grid">';
  h+='<section class="aurore-flow-card"><div class="aurore-flow-kicker">01 · À organiser</div><h4>Classe + matière</h4><p>Deux informations suffisent pour commencer.</p><label class="aurore-flow-field"><span>Classe</span><input id="auroreFlowClass" value="'+esc(t?.class_name||'')+'" placeholder="Ex. Terminale C"></label><label class="aurore-flow-field"><span>Matière</span><input id="auroreFlowSubject" list="auroreFlowSubjects" value="'+esc(t?.subject||'')+'" placeholder="Ex. Français, Physique-Chimie, Mathématiques…"><datalist id="auroreFlowSubjects">'+subs.map(x=>'<option value="'+esc(x)+'"></option>').join('')+'</datalist></label><div class="aurore-flow-actions"><button type="button" class="admin-btn primary" id="auroreFlowStart">'+(t?'Actualiser les chapitres':'Créer et découvrir les chapitres')+'</button>'+(t?'<button type="button" class="admin-btn ghost" id="auroreFlowNew">Nouvelle demande</button>':'')+'</div>';
  if(state.tasks.length)h+='<div class="aurore-flow-list">'+state.tasks.map(x=>'<div class="aurore-flow-task"><div><strong>'+esc(x.class_name||'Demande')+'</strong><small>'+esc(x.subject||'')+' · '+esc(x.metadata?.workflow?.stage||x.status||'')+'</small></div><button type="button" class="admin-btn ghost" data-load="'+esc(x.id)+'">Ouvrir</button></div>').join('')+'</div>';
  h+='<div id="auroreFlowStatus" class="aurore-flow-status">Étape actuelle : '+esc(w.stage||'initiale')+'</div></section>';
  h+='<section class="aurore-flow-card"><div class="aurore-flow-kicker">02 · Chapitres disponibles</div><h4>Choisir le chapitre</h4><p>'+ (chs.length?'Chaque choix reste une validation humaine.':'Lance la découverte depuis le bloc 01.')+'</p><div class="aurore-chapter-grid">'+(chs.length?chs.slice().sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)).map(ch=>'<article class="aurore-chapter"><h5>'+esc(ch.title)+'</h5><p>'+esc(ch.description||'')+'</p><button type="button" class="admin-btn '+(sel?.id===ch.id?'primary':'ghost')+'" data-chapter="'+esc(ch.id)+'">'+(sel?.id===ch.id?'Chapitre choisi':'Choisir')+'</button></article>').join(''):'<div class="aurore-flow-status">Aucun chapitre proposé.</div>')+'</div></section>';
  h+='<section class="aurore-flow-card"><div class="aurore-flow-kicker">03 · Proposition éditoriale</div><h4>Décrire ce qui sera produit</h4><p>'+(p?'La proposition peut être modifiée, révisée ou validée.':'Choisis un chapitre.')+'</p>'+(p?proposalHTML(p,w):'<div class="aurore-flow-status">Aucune proposition éditoriale.</div>')+'</section></div>';
  root.innerHTML=h;bind(root,state);
}
function statusMsg(v){const e=document.getElementById('auroreFlowStatus');if(e)e.textContent=v}
function bind(root,state){
  root.querySelector('#auroreFlowNew')?.addEventListener('click',()=>{state.task=null;render(root,state)});
  root.querySelectorAll('[data-load]').forEach(b=>b.addEventListener('click',async()=>{state.task=await getJob(Number(b.dataset.load));render(root,state)}));
  root.querySelector('#auroreFlowStart')?.addEventListener('click',async()=>{
    const cls=(document.getElementById('auroreFlowClass')?.value||'').trim(),sub=(document.getElementById('auroreFlowSubject')?.value||'').trim();
    if(!cls||!sub){alert('Renseigne la classe et la matière.');return}
    try{
      if(state.task){
        const stage=String(state.task.metadata?.workflow?.stage||'initiale');
        if(['validated','production_ready'].includes(stage))throw new Error('Cette demande est déjà validée ou mise en production. Utilise « Nouvelle demande » pour en créer une autre.');
        await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(state.task.id)),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({class_name:cls,level:cls,subject:sub,title:'Préparation — '+cls+' — '+sub,updated_at:new Date().toISOString()})});
        state.task=await getJob(state.task.id);
      }else state.task=await createTask(cls,sub);
      await discover(state);
    }catch(e){alert('Impossible de préparer la demande : '+(e.message||e))}
  });
  root.querySelectorAll('[data-chapter]').forEach(b=>b.addEventListener('click',async()=>{const ch=(state.task?.metadata?.workflow?.chapters||[]).find(x=>String(x.id)===String(b.dataset.chapter));if(ch)await buildProposal(state,ch)}));
  root.querySelector('#auroreProposalEdit')?.addEventListener('click',async()=>{await patchWorkflow(state.task.id,{editing:true});await refresh(state,state.task.id)});
  root.querySelector('#auroreProposalCancelEdit')?.addEventListener('click',async()=>{await patchWorkflow(state.task.id,{editing:false});await refresh(state,state.task.id)});
  root.querySelector('#auroreProposalSave')?.addEventListener('click',()=>saveProposal(state));
  root.querySelector('#auroreProposalRevision')?.addEventListener('click',async()=>{
    const note=prompt('Demande de révision à transmettre à ChatGPT :','');if(note===null||!note.trim())return;
    try{
      await patchWorkflow(state.task.id,{revision_request:note.trim(),revision_requested_at:new Date().toISOString(),editing:false,user_validated:false,stage:'proposal_review'});
      await refresh(state,state.task.id);
      await copyChatGPTBrief(state,'revision',note.trim());
      const raw=await manualImportDialog('proposal');if(!raw)return;
      const proposal=normalizeProposal(raw);
      const t=await getJob(state.task.id),w=t.metadata?.workflow||{},v=Number(w.proposal_version||0)+1;
      await patchWorkflow(state.task.id,{stage:'proposal_review',proposal,proposal_version:v,proposal_versions:(Array.isArray(w.proposal_versions)?w.proposal_versions:[]).concat([{version:v,proposal,source:'revision_chatgpt',request:note.trim(),imported_at:new Date().toISOString()}]),user_validated:false,editing:false});
      await refresh(state,state.task.id);
    }catch(e){alert('Révision impossible : '+(e.message||e))}
  });  root.querySelector('#auroreProposalValidate')?.addEventListener('click',async()=>{await patchWorkflow(state.task.id,{stage:'validated',user_validated:true,validated_at:new Date().toISOString(),editing:false});await refresh(state,state.task.id)});
  root.querySelector('#auroreProposalUnvalidate')?.addEventListener('click',async()=>{await patchWorkflow(state.task.id,{stage:'proposal_review',user_validated:false});await refresh(state,state.task.id)});
  root.querySelector('#aurorePrepareProduction')?.addEventListener('click',async()=>{
    try{
      const t=await getJob(state.task.id),w=t?.metadata?.workflow||{};
      if(w.user_validated!==true)throw new Error('La proposition doit être validée.');
      await patchWorkflow(state.task.id,{stage:'production_ready',prepared_for_production_at:new Date().toISOString(),manual_pdf_only:true,manual_pdf_launch_required:true,auto_pdf_launch:false,lualatex_requested:false,lualatex_status:'not_requested'});
      await refresh(state,state.task.id);
    }catch(e){alert('Préparation de la production impossible : '+(e.message||e))}
  });}
function init(){
  const p=panel();if(!p)return false;
  injectStyle();
  const legacy=p.querySelector('.cf-create-box');if(legacy)legacy.hidden=true;
  let root=document.getElementById('auroreContentOrchestrator');
  if(!root){root=document.createElement('div');root.id='auroreContentOrchestrator';const host=document.getElementById('auroraRequestFormHost');(host||p).prepend(root)}
  const state={task:null,tasks:[]};
  root.innerHTML='<div class="aurore-flow-status">Chargement des demandes Aurore…</div>';
  (async()=>{try{state.tasks=await listJobs();state.task=state.tasks[0]||null;render(root,state)}catch(e){root.innerHTML='<div class="aurore-flow-status">Impossible de charger l’orchestrateur : '+esc(e.message||e)+'</div>'}})();
  return true;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else if(!init()){let n=0,t=setInterval(()=>{if(init()||++n>40)clearInterval(t)},150)}
})();