(function(){
'use strict';
if(typeof window==='undefined'||window.__auroreContentOrchestratorAdmin)return;
window.__auroreContentOrchestratorAdmin=true;
const PROTOCOL='aurore-content-orchestrator-v1';
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
async function callAurore(action,task,context){
  const token=await getToken();
  const r=await fetch(SUPABASE_URL+'/functions/v1/aurora-content-orchestrator',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,apikey:SUPABASE_ANON_KEY},body:JSON.stringify({protocol:PROTOCOL,task_id:task.id,action,task,context:context||{}})});
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null}catch(_){data={error:raw}}
  if(!r.ok||!data?.ok)throw new Error(data?.error||('Aurore HTTP '+r.status));
  return data;
}
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
    p_prompt:'Orchestration éditoriale Aurore : découvrir les chapitres puis préparer une proposition à valider humainement. Aucun PDF à cette étape.',
    p_instructions:{
      source:'admin_orchestrator',origin:'aurore_content_orchestrator',queue:'manual',category:'Documents',
      rights_confirmed:true,manual_publication_only:true,lualatex_requested:false,
      editorial:{role:'orchestrator',engine:'DeepSeek',schema_version:PROTOCOL,status:'draft'},
      classification:{level:cls,class_name:cls,subject:sub,category:'Documents',resource_type:'cours'},
      workflow:{protocol:PROTOCOL,stage:'initiale',proposal_version:0,user_validated:false,manual_pdf_only:true}
    }
  });
  const id=Number(result);
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Identifiant de demande invalide.');
  return getJob(id);
}
function injectStyle(){
  if(document.getElementById('aurore-content-orchestrator-styles'))return;
  const s=document.createElement('style');s.id='aurore-content-orchestrator-styles';
  s.textContent='#auroreContentOrchestrator{display:grid;gap:14px}.aurore-flow-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.aurore-flow-card{border:1px solid var(--bordure,rgba(0,0,0,.1));border-radius:18px;background:var(--fond,#fff);padding:15px}.aurore-flow-kicker{font-size:.62rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;opacity:.6}.aurore-flow-card h4{margin:5px 0 6px;font-size:.92rem}.aurore-flow-card p{font-size:.72rem;line-height:1.45;opacity:.72}.aurore-flow-field{display:grid;gap:5px;margin:8px 0}.aurore-flow-field span{font-size:.68rem;font-weight:800}.aurore-flow-field input,.aurore-flow-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--bordure,rgba(0,0,0,.12));border-radius:11px;padding:9px;background:var(--card-bg,#fff);color:inherit;font:inherit;font-size:.75rem}.aurore-flow-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.aurore-flow-list,.aurore-chapter-grid{display:grid;gap:7px;margin-top:10px}.aurore-flow-task,.aurore-chapter{border:1px solid var(--bordure,rgba(0,0,0,.09));border-radius:12px;padding:9px}.aurore-flow-task{display:flex;justify-content:space-between;gap:7px}.aurore-flow-task strong,.aurore-flow-task small{display:block}.aurore-flow-task small{font-size:.6rem;opacity:.6;margin-top:2px}.aurore-chapter h5{margin:0 0 4px;font-size:.75rem}.aurore-chapter p{margin:0 0 8px;font-size:.65rem;opacity:.7}.aurore-flow-status{margin-top:9px;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,#6D28D9 8%,transparent);font-size:.66rem}.aurore-proposal-line{font-size:.68rem;line-height:1.45;margin-bottom:8px}.aurore-proposal-line strong{display:block;font-size:.62rem;opacity:.62;margin-bottom:2px}.aurore-proposal-edit{display:grid;gap:7px}.aurore-proposal-edit textarea{min-height:68px;resize:vertical}@media(max-width:900px){.aurore-flow-grid{grid-template-columns:1fr}}';
  document.head.appendChild(s);
}
function proposalHTML(p,w){
  const objectives=Array.isArray(p.objectives)?p.objectives:[],plan=Array.isArray(p.content_plan)?p.content_plan:[],editing=w.editing===true,validated=w.user_validated===true;
  if(editing)return '<div class="aurore-proposal-edit"><label class="aurore-flow-field"><span>Titre</span><input id="auroreProposalTitle" value="'+esc(p.title)+'"></label><label class="aurore-flow-field"><span>Description</span><textarea id="auroreProposalDescription">'+esc(p.description)+'</textarea></label><label class="aurore-flow-field"><span>Objectifs (un par ligne)</span><textarea id="auroreProposalObjectives">'+esc(objectives.join('\n'))+'</textarea></label><label class="aurore-flow-field"><span>Plan (un par ligne)</span><textarea id="auroreProposalPlan">'+esc(plan.join('\n'))+'</textarea></label><label class="aurore-flow-field"><span>Nombre d’exercices</span><input id="auroreProposalExercises" type="number" min="0" max="30" value="'+esc(p.exercise_plan?.count||0)+'"></label><div class="aurore-flow-actions"><button type="button" class="admin-btn primary" id="auroreProposalSave">Enregistrer</button><button type="button" class="admin-btn ghost" id="auroreProposalCancelEdit">Annuler</button></div></div>';
  return '<div class="aurore-proposal-line"><strong>Titre</strong>'+esc(p.title)+'</div><div class="aurore-proposal-line"><strong>Description</strong>'+esc(p.description)+'</div><div class="aurore-proposal-line"><strong>Objectifs</strong>'+objectives.map(x=>'<div>• '+esc(x)+'</div>').join('')+'</div><div class="aurore-proposal-line"><strong>Plan</strong>'+plan.map(x=>'<div>• '+esc(x)+'</div>').join('')+'</div><div class="aurore-proposal-line"><strong>Exercices</strong>'+esc(p.exercise_plan?.count||0)+' · '+(p.exercise_plan?.correction!==false?'corrigés prévus':'sans corrigé')+'</div><div class="aurore-flow-actions">'+(validated?'<button type="button" class="admin-btn primary" id="aurorePrepareProduction">Préparer la production</button><button type="button" class="admin-btn ghost" id="auroreProposalUnvalidate">Revenir en révision</button>':'<button type="button" class="admin-btn ghost" id="auroreProposalEdit">Modifier</button><button type="button" class="admin-btn ghost" id="auroreProposalRevision">Demander une révision</button><button type="button" class="admin-btn primary" id="auroreProposalValidate">Valider la proposition</button>')+'</div><div class="aurore-flow-status">'+(validated?'Proposition validée par l’administrateur.':'Proposition en attente de validation humaine.')+'</div>';
}
async function refresh(state,id){
  state.tasks=await listJobs();
  state.task=await getJob(id);
  render(document.getElementById('auroreContentOrchestrator'),state);
}
async function discover(state){
  statusMsg('Aurore prépare les chapitres…');
  try{
    const d=await callAurore('discover_chapters',{id:state.task.id,class_name:state.task.class_name,subject:state.task.subject},{workflow:state.task.metadata?.workflow||{}});
    await patchWorkflow(state.task.id,{stage:'chapitres_ready',chapters:d.result.chapters,chapters_provenance:d.provenance,selected_chapter:null,proposal:null,user_validated:false,editing:false});
    await refresh(state,state.task.id);
  }catch(e){alert('Découverte des chapitres impossible : '+(e.message||e))}
}
async function buildProposal(state,ch){
  statusMsg('Aurore prépare la proposition éditoriale…');
  try{
    const d=await callAurore('build_editorial_proposal',{id:state.task.id,class_name:state.task.class_name,subject:state.task.subject,chapter:ch},{workflow:state.task.metadata?.workflow||{}});
    await patchWorkflow(state.task.id,{stage:'proposal_review',selected_chapter:ch,proposal:d.result,proposal_version:1,proposal_versions:[{version:1,proposal:d.result,source:'ai',provenance:d.provenance}],user_validated:false,editing:false});
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
  let h='<div><div class="aurore-flow-kicker">Aurore · orchestrateur éditorial</div><h3 style="margin:4px 0 6px">Préparer une ressource sans tout renseigner</h3><p style="margin:0;max-width:820px;font-size:.72rem;line-height:1.5;opacity:.72">Classe + matière d’abord. Aurore propose ensuite les chapitres, puis un brief éditorial. Rien n’est publié automatiquement et le PDF reste manuel.</p></div><div class="aurore-flow-grid">';
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
    const note=prompt('Demande de révision à transmettre à Aurore :','');if(note===null||!note.trim())return;
    const w=state.task.metadata.workflow;statusMsg('Aurore révise la proposition…');
    try{
      const d=await callAurore('revise_editorial_proposal',{id:state.task.id,class_name:state.task.class_name,subject:state.task.subject,chapter:w.selected_chapter},{workflow:{...w,proposal:w.proposal,revision_request:note}});
      const v=Number(w.proposal_version||0)+1;
      await patchWorkflow(state.task.id,{stage:'proposal_review',proposal:d.result,proposal_version:v,user_validated:false,editing:false,proposal_versions:(Array.isArray(w.proposal_versions)?w.proposal_versions:[]).concat([{version:v,proposal:d.result,source:'revision',request:note,provenance:d.provenance}])});
      await refresh(state,state.task.id);
    }catch(e){alert('Révision impossible : '+(e.message||e))}
  });
  root.querySelector('#auroreProposalValidate')?.addEventListener('click',async()=>{await patchWorkflow(state.task.id,{stage:'validated',user_validated:true,validated_at:new Date().toISOString(),editing:false});await refresh(state,state.task.id)});
  root.querySelector('#auroreProposalUnvalidate')?.addEventListener('click',async()=>{await patchWorkflow(state.task.id,{stage:'proposal_review',user_validated:false});await refresh(state,state.task.id)});
  root.querySelector('#aurorePrepareProduction')?.addEventListener('click',async()=>{
    try{
      const t=await getJob(state.task.id);if(t?.metadata?.workflow?.user_validated!==true)throw new Error('La proposition doit être validée.');
      const q=await rpc('aurora_queue_content_job',{p_job_id:Number(t.id)});if(!q||Number(q.id)!==Number(t.id))throw new Error('La demande n’a pas pu être mise en file.');
      await patchWorkflow(t.id,{stage:'production_ready',queued_at:new Date().toISOString(),manual_pdf_only:true});
      await refresh(state,t.id);
    }catch(e){alert('Mise en production impossible : '+(e.message||e))}
  });
}
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