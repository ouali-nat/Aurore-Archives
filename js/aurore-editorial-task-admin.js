(function(){
'use strict';
if(typeof window==='undefined'||window.__auroreEditorialTaskAdmin)return;
window.__auroreEditorialTaskAdmin=true;

const PROTOCOL='aurore-chatgpt-editor-v1';
const EDITOR='ChatGPT';
const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML};
const panel=()=>document.querySelector('.admin-tab-panel[data-panel="aurora-request"]');

async function token(){
  if(typeof assurerClientAuthGoogle!=='function')throw new Error('Client Supabase indisponible.');
  const client=await assurerClientAuthGoogle();
  let s=(await client.auth.getSession())?.data?.session||null;
  if(!s?.access_token)throw new Error('Session administrateur expirée.');
  if(s.expires_at&&Date.now()>=s.expires_at*1000-60000){
    const refreshed=await client.auth.refreshSession();
    if(refreshed.error||!refreshed.data?.session)throw(refreshed.error||new Error('Impossible de rafraîchir la session.'));
    s=refreshed.data.session;
  }
  return s.access_token;
}

async function rest(path,options={}){
  const headers={apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+await token(),...(options.headers||{})};
  const fetcher=typeof adminInventoryFetch==='function'?adminInventoryFetch:fetch;
  const r=await fetcher(SUPABASE_URL+path,{...options,headers,cache:'no-store'});
  const raw=await r.text();
  let data=null;try{data=raw?JSON.parse(raw):null}catch(_){data=raw}
  if(!r.ok)throw new Error(data?.message||data?.error||raw||('HTTP '+r.status));
  return data;
}
async function rpc(name,body){return rest('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})}

async function getJob(id){
  const rows=await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(id))+'&select=id,status,title,subject,level,class_name,document_type,metadata,created_at,updated_at');
  return Array.isArray(rows)?rows[0]||null:null;
}
async function listJobs(){
  const rows=await rest('/rest/v1/aurora_content_jobs?select=id,status,title,subject,level,class_name,document_type,metadata,created_at,updated_at&status=in.(draft,queued,processing,review)&order=updated_at.desc&limit=500');
  return (Array.isArray(rows)?rows:[]).filter(x=>x?.metadata?.workflow?.protocol===PROTOCOL);
}
function workflowMetadata(existing,patch){
  const m=existing&&typeof existing==='object'?existing:{};
  const w=m.workflow&&typeof m.workflow==='object'?m.workflow:{};
  return {
    ...m,
    manual_publication_only:true,
    pdf_launch_mode:'manual',
    manual_pdf_launch_required:true,
    auto_pdf_launch:false,
    editorial_engine:EDITOR,
    workflow:{...w,...patch,protocol:PROTOCOL,editorial_engine:EDITOR,updated_at:new Date().toISOString()}
  };
}
async function updateJob(id,patch,status){
  const row=await getJob(id);
  if(!row)throw new Error('Demande introuvable.');
  const metadata=workflowMetadata(row.metadata,patch);
  const body={metadata,updated_at:new Date().toISOString()};
  if(status)body.status=status;
  await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(id)),{
    method:'PATCH',
    headers:{'Content-Type':'application/json',Prefer:'return=minimal'},
    body:JSON.stringify(body)
  });
  return getJob(id);
}
async function updateClassification(id,className,subject){
  const row=await getJob(id);
  if(!row)throw new Error('Demande introuvable.');
  const metadata=workflowMetadata(row.metadata,{stage:'initiale',selected_chapter:null,chapters:null,proposal:null,user_validated:false,revision_request:null,revision_requested:false});
  await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(id)),{
    method:'PATCH',
    headers:{'Content-Type':'application/json',Prefer:'return=minimal'},
    body:JSON.stringify({
      class_name:className,level:className,subject,title:'À préparer — '+className+' — '+subject,
      metadata,updated_at:new Date().toISOString()
    })
  });
  return getJob(id);
}
async function createTask(className,subject){
  const id=Number(await rpc('aurora_create_content_job',{
    p_title:'À préparer — '+className+' — '+subject,
    p_subject:subject,
    p_level:className,
    p_class_name:className,
    p_document_type:'cours',
    p_prompt:'Demande éditoriale minimale : classe et matière. Le contenu, les chapitres, la proposition et la rédaction seront traités dans la conversation ChatGPT dédiée.',
    p_instructions:{
      source:'admin_editorial_task',
      origin:'gpt_editorial_queue',
      queue:'manual',
      category:'Documents',
      rights_confirmed:true,
      theme_color:'#6D28D9',
      editorial:{role:'editor',engine:EDITOR,schema_version:'aurora-editorial-1',status:'awaiting_editor'},
      classification:{level:className,class_name:className,subject:subject,category:'Documents',resource_type:'cours'},
      workflow:{protocol:PROTOCOL,stage:'initiale',proposal_version:0,user_validated:false,manual_pdf_only:true,manual_pdf_launch_required:true,auto_pdf_launch:false,editorial_engine:EDITOR}
    }
  }));
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Identifiant de demande invalide.');
  return updateClassification(id,className,subject);
}
function chapterCards(state){
  const w=state.task?.metadata?.workflow||{},ch=Array.isArray(w.chapters)?w.chapters:[],selected=w.selected_chapter;
  if(!ch.length)return '<div class="aurore-editorial-empty">Aucun chapitre n’a encore été enregistré par ChatGPT.</div>';
  return ch.slice().sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)).map(x=>{
    const active=selected&&String(selected.id)===String(x.id);
    return '<article class="aurore-editorial-chapter'+(active?' is-selected':'')+'"><div><strong>'+esc(x.title)+'</strong><p>'+esc(x.description||'')+'</p></div><button type="button" class="admin-btn '+(active?'primary':'ghost')+'" data-editorial-chapter="'+esc(x.id)+'">'+(active?'Chapitre choisi':'Choisir')+'</button></article>';
  }).join('');
}
function proposalHTML(state){
  const w=state.task?.metadata?.workflow||{},p=w.proposal;
  if(!p||typeof p!=='object')return '<div class="aurore-editorial-empty">Aucune proposition éditoriale enregistrée pour le moment.</div>';
  const objectives=Array.isArray(p.objectives)?p.objectives:[],plan=Array.isArray(p.content_plan)?p.content_plan:[];
  const validated=w.user_validated===true||w.stage==='validee';
  return '<div class="aurore-editorial-proposal">'+
    '<div><span>Titre</span><strong>'+esc(p.title||'')+'</strong></div>'+
    '<div><span>Description</span><p>'+esc(p.description||'')+'</p></div>'+
    '<div><span>Objectifs</span><ul>'+objectives.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>'+
    '<div><span>Plan</span><ol>'+plan.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ol></div>'+
    '<div><span>Exercices</span><p>'+esc(p.exercise_plan?.count||0)+' · '+(p.exercise_plan?.correction===false?'sans corrigé':'corrigés prévus')+'</p></div>'+
    '<div class="aurore-editorial-actions">'+(validated?
      '<button type="button" class="admin-btn ghost" id="auroreEditorialUnvalidate">Revenir à la vérification</button><button type="button" class="admin-btn primary" id="auroreEditorialProduction">Confirmer pour production éditoriale</button>':
      '<button type="button" class="admin-btn ghost" id="auroreEditorialRevision">Demander une révision à ChatGPT</button><button type="button" class="admin-btn ghost" id="auroreEditorialReject">Rejeter</button><button type="button" class="admin-btn primary" id="auroreEditorialValidate">Valider la proposition</button>')+
    '</div>'+
    '<div class="aurore-editorial-note">'+(validated?'Proposition validée par l’administration. ChatGPT peut maintenant récupérer la demande complète et produire le contenu. Le PDF reste une opération manuelle séparée.':'Proposition en attente de vérification humaine.')+'</div>'+
  '</div>';
}
function render(root,state){
  const t=state.task,w=t?.metadata?.workflow||{};
  const subjects=[...new Set((Array.isArray(window.MATIERES)?window.MATIERES:[]).map(x=>String(typeof x==='string'?x:x?.nom||'').trim()).filter(Boolean))].slice(0,100);
  root.innerHTML=
    '<div class="aurore-editorial-head"><span class="aurore-editorial-kicker">Aurore · éditeur ChatGPT</span><h3>Demandes éditoriales</h3><p>Le site enregistre les demandes et les validations. La conversation ChatGPT récupère les tâches via le connecteur Supabase, propose les chapitres et la proposition éditoriale, puis produit le contenu complet après validation. Aucun moteur IA du site n’est appelé ici.</p></div>'+
    '<div class="aurore-editorial-grid">'+
      '<section class="aurore-editorial-card"><div class="aurore-editorial-step">01 · À organiser</div><h4>Classe + matière</h4><p>Deux informations suffisent pour créer ou modifier une demande.</p>'+
      '<label><span>Classe</span><input id="auroreEditorialClass" value="'+esc(t?.class_name||'')+'" placeholder="Ex. Terminale C"></label>'+
      '<label><span>Matière</span><input id="auroreEditorialSubject" list="auroreEditorialSubjects" value="'+esc(t?.subject||'')+'" placeholder="Ex. Mathématiques"><datalist id="auroreEditorialSubjects">'+subjects.map(x=>'<option value="'+esc(x)+'"></option>').join('')+'</datalist></label>'+
      '<div class="aurore-editorial-actions"><button type="button" class="admin-btn primary" id="auroreEditorialCreate">'+(t?'Actualiser la demande':'Créer la demande')+'</button>'+(t?'<button type="button" class="admin-btn ghost" id="auroreEditorialNew">Nouvelle demande</button>':'')+'</div>'+
      '<div class="aurore-editorial-state">Étape actuelle : <strong>'+esc(w.stage||'initiale')+'</strong></div></section>'+
      '<section class="aurore-editorial-card"><div class="aurore-editorial-step">02 · Chapitres disponibles</div><h4>Choisir le chapitre</h4><p>Les chapitres sont proposés et enregistrés par ChatGPT dans Supabase.</p><div class="aurore-editorial-chapters">'+chapterCards(state)+'</div></section>'+
      '<section class="aurore-editorial-card"><div class="aurore-editorial-step">03 · Vérification</div><h4>Proposition éditoriale</h4><p>La proposition enregistrée est contrôlée ici avant la production du contenu complet.</p>'+proposalHTML(state)+'</section>'+
    '</div>'+
    '<section class="aurore-editorial-card aurore-editorial-task-list"><div class="aurore-editorial-step">Demandes de ce circuit</div><div class="aurore-editorial-list">'+
      (state.tasks.length?state.tasks.map(x=>{
        const xw=x.metadata?.workflow||{},sel=xw.selected_chapter?.title||'chapitre non choisi';
        return '<div class="aurore-editorial-task"><div><strong>#'+esc(x.id)+' · '+esc(x.class_name||'')+' — '+esc(x.subject||'')+'</strong><small>'+esc(xw.stage||x.status||'')+' · '+esc(sel)+'</small></div><button type="button" class="admin-btn ghost" data-editorial-load="'+esc(x.id)+'">Ouvrir</button></div>';
      }).join(''):'<div class="aurore-editorial-empty">Aucune nouvelle demande de ce circuit pour le moment.</div>')+
    '</div></section>';
  bind(root,state);
}
async function refresh(root,state,id){
  state.tasks=await listJobs();
  state.task=await getJob(id);
  render(root,state);
}
function bind(root,state){
  root.querySelector('#auroreEditorialNew')?.addEventListener('click',()=>{state.task=null;render(root,state)});
  root.querySelectorAll('[data-editorial-load]').forEach(b=>b.addEventListener('click',async()=>{try{state.task=await getJob(Number(b.dataset.editorialLoad));render(root,state)}catch(e){alert('Demande introuvable : '+(e.message||e))}}));
  root.querySelector('#auroreEditorialCreate')?.addEventListener('click',async()=>{
    const cls=(root.querySelector('#auroreEditorialClass')?.value||'').trim(),sub=(root.querySelector('#auroreEditorialSubject')?.value||'').trim();
    if(!cls||!sub){alert('Renseigne la classe et la matière.');return}
    try{
      if(state.task){
        const w=state.task.metadata?.workflow||{};
        if(w.protocol!==PROTOCOL)throw new Error('Cette demande n’appartient pas au circuit éditorial ChatGPT.');
        if(['validee','production_editoriale','contenu_ingere','pdf_a_lancer'].includes(String(w.stage||'')))throw new Error('Cette demande est déjà validée ou en production.');
        state.task=await updateClassification(state.task.id,cls,sub);
      }else{
        state.task=await createTask(cls,sub);
      }
      await refresh(root,state,state.task.id);
    }catch(e){alert('Impossible d’enregistrer la demande : '+(e.message||e))}
  });
  root.querySelectorAll('[data-editorial-chapter]').forEach(b=>b.addEventListener('click',async()=>{
    try{
      if(!state.task)throw new Error('Aucune demande sélectionnée.');
      const current=await getJob(state.task.id),w=current?.metadata?.workflow||{},chapters=Array.isArray(w.chapters)?w.chapters:[];
      const ch=chapters.find(x=>String(x.id)===String(b.dataset.editorialChapter));
      if(!ch)throw new Error('Chapitre introuvable.');
      await updateJob(current.id,{stage:'chapitre_selectionne',selected_chapter:ch,proposal:null,proposal_version:0,user_validated:false,revision_request:null,revision_requested:false,chapter_selected_at:new Date().toISOString()},'draft');
      await refresh(root,state,current.id);
    }catch(e){alert('Choix du chapitre impossible : '+(e.message||e))}
  });
  root.querySelector('#auroreEditorialRevision')?.addEventListener('click',async()=>{
    const note=prompt('Que veux-tu demander à ChatGPT pour la révision ?','');
    if(note===null||!note.trim())return;
    try{await updateJob(state.task.id,{stage:'revision_demandee',revision_requested:true,revision_request:note.trim(),revision_requested_at:new Date().toISOString(),user_validated:false},'draft');await refresh(root,state,state.task.id)}
    catch(e){alert('Demande de révision impossible : '+(e.message||e))}
  });
  root.querySelector('#auroreEditorialReject')?.addEventListener('click',async()=>{
    if(!confirm('Rejeter cette proposition éditoriale ?'))return;
    try{await updateJob(state.task.id,{stage:'rejetee',user_validated:false,rejected_at:new Date().toISOString()},'draft');await refresh(root,state,state.task.id)}
    catch(e){alert('Rejet impossible : '+(e.message||e))}
  });
  root.querySelector('#auroreEditorialValidate')?.addEventListener('click',async()=>{
    try{await updateJob(state.task.id,{stage:'validee',user_validated:true,validated_at:new Date().toISOString(),revision_requested:false},'draft');await refresh(root,state,state.task.id)}
    catch(e){alert('Validation impossible : '+(e.message||e))}
  });
  root.querySelector('#auroreEditorialUnvalidate')?.addEventListener('click',async()=>{
    try{await updateJob(state.task.id,{stage:'proposition_a_valider',user_validated:false,reopened_at:new Date().toISOString()},'draft');await refresh(root,state,state.task.id)}
    catch(e){alert('Retour en vérification impossible : '+(e.message||e))}
  });
  root.querySelector('#auroreEditorialProduction')?.addEventListener('click',async()=>{
    try{
      const t=await getJob(state.task.id),w=t?.metadata?.workflow||{};
      if(w.user_validated!==true)throw new Error('La proposition doit être validée.');
      await updateJob(state.task.id,{stage:'production_editoriale',production_confirmed_at:new Date().toISOString(),lualatex_requested:false,lualatex_status:'not_requested',manual_pdf_launch_required:true,auto_pdf_launch:false},'draft');
      await refresh(root,state,state.task.id);
    }catch(e){alert('Confirmation impossible : '+(e.message||e))}
  });
}
function injectStyle(){
  if(document.getElementById('aurore-editorial-task-styles'))return;
  const s=document.createElement('style');s.id='aurore-editorial-task-styles';
  s.textContent='#auroreEditorialTaskAdmin{display:grid;gap:14px}.aurore-editorial-head{padding:4px 2px 2px}.aurore-editorial-kicker,.aurore-editorial-step{font-size:.62rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;opacity:.58}.aurore-editorial-head h3{margin:4px 0 6px}.aurore-editorial-head p{margin:0;max-width:900px;font-size:.72rem;line-height:1.5;opacity:.72}.aurore-editorial-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.aurore-editorial-card{padding:15px;border:1px solid var(--bordure,rgba(0,0,0,.1));border-radius:18px;background:var(--fond,#fff)}.aurore-editorial-card h4{margin:5px 0 7px;font-size:.92rem}.aurore-editorial-card>p{font-size:.69rem;line-height:1.45;opacity:.7}.aurore-editorial-card label{display:grid;gap:5px;margin:9px 0}.aurore-editorial-card label span{font-size:.66rem;font-weight:800}.aurore-editorial-card input{width:100%;box-sizing:border-box;border:1px solid var(--bordure,rgba(0,0,0,.12));border-radius:11px;padding:9px;background:var(--card-bg,#fff);color:inherit;font:inherit;font-size:.75rem}.aurore-editorial-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.aurore-editorial-state,.aurore-editorial-note{margin-top:10px;padding:9px 10px;border-radius:11px;background:color-mix(in srgb,#6D28D9 8%,transparent);font-size:.65rem;line-height:1.4}.aurore-editorial-chapters{display:grid;gap:8px;margin-top:10px}.aurore-editorial-chapter{display:flex;justify-content:space-between;gap:9px;align-items:flex-start;padding:10px;border:1px solid var(--bordure,rgba(0,0,0,.09));border-radius:13px}.aurore-editorial-chapter.is-selected{box-shadow:inset 0 0 0 1px currentColor}.aurore-editorial-chapter strong{display:block;font-size:.73rem}.aurore-editorial-chapter p{margin:4px 0 0;font-size:.62rem;line-height:1.4;opacity:.68}.aurore-editorial-proposal{display:grid;gap:8px;margin-top:10px}.aurore-editorial-proposal span{display:block;font-size:.59rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase;opacity:.52}.aurore-editorial-proposal strong{display:block;font-size:.75rem;margin-top:2px}.aurore-editorial-proposal p,.aurore-editorial-proposal li{font-size:.65rem;line-height:1.4}.aurore-editorial-proposal ul,.aurore-editorial-proposal ol{margin:5px 0 0;padding-left:18px}.aurore-editorial-task-list{grid-column:1/-1}.aurore-editorial-list{display:grid;gap:7px;margin-top:10px}.aurore-editorial-task{display:flex;justify-content:space-between;gap:9px;align-items:center;padding:9px 10px;border:1px solid var(--bordure,rgba(0,0,0,.09));border-radius:12px}.aurore-editorial-task strong,.aurore-editorial-task small{display:block}.aurore-editorial-task strong{font-size:.7rem}.aurore-editorial-task small{margin-top:3px;font-size:.59rem;opacity:.58}.aurore-editorial-empty{padding:10px;border:1px dashed var(--bordure,rgba(0,0,0,.14));border-radius:11px;font-size:.64rem;line-height:1.4;opacity:.7}@media(max-width:900px){.aurore-editorial-grid{grid-template-columns:1fr}.aurore-editorial-task-list{grid-column:auto}}';
  document.head.appendChild(s);
}
function init(){
  const p=panel();if(!p)return false;
  injectStyle();
  let root=document.getElementById('auroreEditorialTaskAdmin');
  if(!root){root=document.createElement('div');root.id='auroreEditorialTaskAdmin';const host=document.getElementById('auroraRequestFormHost');(host||p).appendChild(root)}
  root.innerHTML='<div class="aurore-editorial-empty">Chargement des demandes…</div>';
  (async()=>{
    try{
      const tasks=await listJobs();
      const state={task:tasks[0]||null,tasks};
      render(root,state);
    }catch(e){root.innerHTML='<div class="aurore-editorial-empty">Impossible de charger les demandes : '+esc(e.message||e)+'</div>}
  })();
  return true;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else if(!init()){let n=0,t=setInterval(()=>{if(init()||++n>40)clearInterval(t)},150)}
})();