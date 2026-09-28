(function(){
'use strict';
if(typeof window==='undefined'||window.__auroreEditorialTaskAdmin)return;
window.__auroreEditorialTaskAdmin=true;

const PROTOCOL='aurore-chatgpt-editor-v2';
const EDITOR='ChatGPT';
const PAGE_SIZE=10;
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
  const rows=await rest('/rest/v1/aurora_content_jobs?select=id,status,title,subject,level,class_name,document_type,metadata,created_at,updated_at&order=updated_at.desc&limit=500');
  return (Array.isArray(rows)?rows:[]).filter(x=>{
    const w=x?.metadata?.workflow||{};
    return w.protocol===PROTOCOL || w.protocol==='aurore-chatgpt-editor-v1';
  });
}
function workflowMetadata(existing,patch){
  const m=existing&&typeof existing==='object'?existing:{},w=m.workflow&&typeof m.workflow==='object'?m.workflow:{};
  return {...m,manual_publication_only:true,pdf_launch_mode:'manual',manual_pdf_launch_required:true,auto_pdf_launch:false,
    editorial_engine:EDITOR,workflow:{...w,...patch,protocol:PROTOCOL,editorial_engine:EDITOR,updated_at:new Date().toISOString()}};
}
async function updateJob(id,patch,status){
  const row=await getJob(id);if(!row)throw new Error('Tâche introuvable.');
  const metadata=workflowMetadata(row.metadata,patch);
  const body={metadata,updated_at:new Date().toISOString()};if(status)body.status=status;
  await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(id)),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(body)});
  return getJob(id);
}
async function createTask(className,subject){
  const id=Number(await rpc('aurora_create_content_job',{
    p_title:'À organiser — '+className+' — '+subject,p_subject:subject,p_level:className,p_class_name:className,
    p_document_type:'cours',p_prompt:'Tâche éditoriale minimale. ChatGPT est l’éditeur canonique : il récupère la tâche, propose les chapitres, construit la proposition puis rédige le contenu final.',
    p_instructions:{source:'admin_editorial_task',origin:'gpt_editorial_queue',queue:'manual',category:'Documents',rights_confirmed:true,
      theme_color:'#6D28D9',editorial:{role:'editor',engine:EDITOR,schema_version:'aurora-editorial-2',status:'waiting_chatgpt'},
      workflow:{protocol:PROTOCOL,stage:'initiale',proposal_version:0,user_validated:false,chatgpt_claimed:false,
        manual_pdf_only:true,manual_pdf_launch_required:true,auto_pdf_launch:false,editorial_engine:EDITOR}}
  }));
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Identifiant de tâche invalide.');
  return updateJob(id,{stage:'initiale',chatgpt_claimed:false,chatgpt_claimed_at:null,chapters:null,selected_chapter:null,proposal:null,proposal_version:0,user_validated:false,rejected:false,revision_requested:false},'draft');
}
function card(t,mode){
  const w=t.metadata?.workflow||{}, claimed=w.chatgpt_claimed===true;
  const stage=w.stage||'initiale';
  const label=claimed?'Pris en charge par ChatGPT':'En attente de récupération';
  return '<article class="editor-task-card">'+
    '<div class="editor-task-top"><span class="editor-task-id">#'+esc(t.id)+'</span><span class="editor-task-status '+(claimed?'claimed':'waiting')+'">'+label+'</span></div>'+
    '<h4>'+esc(t.class_name||t.level||'Classe non définie')+'</h4><div class="editor-task-subject">'+esc(t.subject||'Matière non définie')+'</div>'+
    '<div class="editor-task-meta"><span>'+esc(t.document_type||'cours')+'</span><span>'+esc(stage)+'</span></div>'+
    '<div class="editor-task-actions">'+(mode==='new'?'<button class="admin-btn ghost" data-editor-open="'+esc(t.id)+'">Détails</button>':'<button class="admin-btn ghost" data-editor-open="'+esc(t.id)+'">Ouvrir</button>')+'</div>'+
  '</article>';
}
function pager(total,page,key){
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));if(pages<=1)return '';
  let s='<div class="editor-pager">';
  for(let i=0;i<pages;i++)s+='<button type="button" class="admin-btn '+(i===page?'primary':'ghost')+'" data-editor-page="'+key+':'+i+'">'+(i+1)+'</button>';
  return s+'</div>';
}
function render(root,state){
  const tasks=state.tasks||[],newTasks=tasks.filter(t=>{const w=t.metadata?.workflow||{};return !w.chatgpt_claimed&&['initiale','chapitres_demandes'].includes(w.stage||'initiale')}),
    activeTasks=tasks.filter(t=>t.metadata?.workflow?.chatgpt_claimed===true);
  const np=state.pages.new||0,ap=state.pages.active||0;
  const ns=newTasks.slice(np*PAGE_SIZE,(np+1)*PAGE_SIZE),as=activeTasks.slice(ap*PAGE_SIZE,(ap+1)*PAGE_SIZE);
  root.innerHTML=
  '<div class="editor-workspace-head"><div><span class="editor-kicker">File éditoriale</span><h3>Demandes de cours</h3><p>Crée les tâches ici ; leur traitement éditorial se poursuit dans notre conversation.</p></div><button type="button" class="admin-btn ghost" id="editorRefresh">↻ Actualiser</button></div>'+
  '<section class="editor-create-card"><div><span class="editor-step">01 · Créer une tâche</span><h4>Nouvelle demande éditoriale</h4><p>Entre seulement la <strong>classe</strong> et la <strong>matière</strong>. Les chapitres et la construction du cours seront traités ensuite dans la conversation ChatGPT.</p></div>'+
  '<div class="editor-create-fields"><label>Classe<input id="editorClass" placeholder="Ex. Terminale C"></label><label>Matière<input id="editorSubject" list="editorSubjects" placeholder="Ex. Mathématiques"><datalist id="editorSubjects">'+([...new Set((Array.isArray(window.MATIERES)?window.MATIERES:[]).map(x=>String(typeof x==='string'?x:x?.nom||'').trim()).filter(Boolean))].slice(0,100).map(x=>'<option value="'+esc(x)+'"></option>').join(''))+'</datalist></label><button type="button" class="admin-btn primary" id="editorCreate">Créer la tâche</button></div></section>'+
  '<section class="editor-section"><div class="editor-section-head"><div><span class="editor-step">02 · File d’attente</span><h4>Tâches à récupérer par ChatGPT</h4><p>Les tâches restent ici tant qu’elles n’ont pas été récupérées dans notre conversation.</p></div><span class="editor-count">'+newTasks.length+'</span></div>'+
  '<div class="editor-task-grid">'+(ns.length?ns.map(t=>card(t,'new')).join(''):'<div class="editor-empty">Aucune tâche en attente. Crée une première demande avec classe + matière.</div>')+'</div>'+pager(newTasks.length,np,'new')+'</section>'+
  '<section class="editor-section"><div class="editor-section-head"><div><span class="editor-step">03 · Suivi ChatGPT</span><h4>Tâches prises en charge</h4><p>Lorsqu’une tâche est récupérée ici, elle quitte la file d’attente et apparaît dans le bloc éditorial de notre conversation.</p></div><span class="editor-count">'+activeTasks.length+'</span></div>'+
  '<div class="editor-task-grid">'+(as.length?as.map(t=>card(t,'active')).join(''):'<div class="editor-empty">Aucune tâche n’est encore prise en charge.</div>')+'</div>'+pager(activeTasks.length,ap,'active')+'</section>'+
  '<section id="editorDetail" class="editor-detail" hidden></section>';
  bind(root,state);
}
function bind(root,state){
  root.querySelector('#editorRefresh')?.addEventListener('click',()=>chargerEspaceEditorialChatGPT());
  root.querySelector('#editorCreate')?.addEventListener('click',async()=>{
    const cls=(root.querySelector('#editorClass')?.value||'').trim(),sub=(root.querySelector('#editorSubject')?.value||'').trim();
    if(!cls||!sub){alert('Renseigne la classe et la matière.');return}
    const b=root.querySelector('#editorCreate');b.disabled=true;
    try{await createTask(cls,sub);root.querySelector('#editorClass').value='';root.querySelector('#editorSubject').value='';await chargerEspaceEditorialChatGPT()}
    catch(e){alert('Impossible de créer la tâche : '+(e.message||e))}finally{b.disabled=false}
  });
  root.querySelectorAll('[data-editor-page]').forEach(b=>b.addEventListener('click',()=>{const [k,p]=b.dataset.editorPage.split(':');state.pages[k]=Number(p);render(root,state)}));
  root.querySelectorAll('[data-editor-open]').forEach(b=>b.addEventListener('click',async()=>{
    try{
      const t=await getJob(Number(b.dataset.editorOpen));if(!t)throw new Error('Tâche introuvable.');
      const d=root.querySelector('#editorDetail');d.hidden=false;
      const w=t.metadata?.workflow||{},chapters=Array.isArray(w.chapters)?w.chapters:[];
      d.innerHTML='<div class="editor-detail-head"><div><span class="editor-step">Tâche #'+esc(t.id)+'</span><h4>'+esc(t.class_name||'')+' · '+esc(t.subject||'')+'</h4><p>État : <strong>'+esc(w.stage||t.status)+'</strong></p></div><button class="admin-btn ghost" id="editorClose">Fermer</button></div>'+
        '<div class="editor-detail-grid"><div><span>Classe</span><strong>'+esc(t.class_name||'')+'</strong></div><div><span>Matière</span><strong>'+esc(t.subject||'')+'</strong></div><div><span>Type</span><strong>'+esc(t.document_type||'cours')+'</strong></div><div><span>PDF</span><strong>Production manuelle uniquement</strong></div></div>'+
        (chapters.length?'<div class="editor-detail-chapters"><h5>Chapitres enregistrés</h5>'+chapters.map(x=>'<div><strong>'+esc(x.title)+'</strong><small>'+esc(x.description||'')+'</small></div>').join('')+'</div>':'<div class="editor-empty">Les chapitres seront ajoutés par ChatGPT après récupération de la tâche.</div>');
      d.querySelector('#editorClose').addEventListener('click',()=>{d.hidden=true});
    }catch(e){alert(e.message||e)}
  }));
}
function injectStyle(){
 if(document.getElementById('aurore-editorial-v2-styles'))return;
 const s=document.createElement('style');s.id='aurore-editorial-v2-styles';s.textContent=
 '#auroreEditorialTaskAdmin{display:grid;gap:16px;color:var(--editor-text,currentColor);--editor-surface:var(--card-bg,#fff);--editor-border:color-mix(in srgb,currentColor 12%,transparent);--editor-accent:#6D28D9;--editor-text:currentColor}.editor-workspace-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.editor-kicker,.editor-step{font-size:.62rem;font-weight:900;letter-spacing:.09em;text-transform:uppercase;opacity:.55}.editor-workspace-head h3{margin:5px 0 7px;font-size:1.2rem}.editor-workspace-head p,.editor-create-card p,.editor-section-head p{margin:0;font-size:.7rem;line-height:1.5;opacity:.7}.editor-create-card{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,1.1fr);gap:18px;align-items:end;padding:20px;border-radius:20px;border:1px solid rgba(109,40,217,.16);background:linear-gradient(135deg,color-mix(in srgb,var(--editor-accent,#6D28D9) 10%,var(--editor-surface,#fff)),var(--editor-surface,#fff))}.editor-create-card h4,.editor-section h4{margin:5px 0 7px;font-size:1rem}.editor-create-fields{display:grid;grid-template-columns:1fr 1fr auto;gap:9px;align-items:end}.editor-create-fields label{display:grid;gap:5px;font-size:.65rem;font-weight:800}.editor-create-fields input{min-width:0;padding:11px 12px;border:1px solid rgba(0,0,0,.12);border-radius:12px;background:var(--card-bg,#fff);color:inherit;font:inherit;font-size:.75rem}.editor-section{padding:18px;border:1px solid var(--bordure,rgba(0,0,0,.1));border-radius:20px;background:var(--fond,#fff)}.editor-section-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.editor-count{min-width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:.7rem;background:color-mix(in srgb,var(--editor-accent,#6D28D9) 10%,transparent)}.editor-task-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:14px}.editor-task-card{min-height:150px;padding:13px;border:1px solid var(--editor-border,rgba(127,127,127,.18));border-radius:16px;background:var(--editor-surface,#fff);display:flex;flex-direction:column;box-shadow:0 3px 15px rgba(0,0,0,.04)}.editor-task-top{display:flex;justify-content:space-between;gap:6px;align-items:center}.editor-task-id{font-size:.58rem;font-weight:900;opacity:.5}.editor-task-status{font-size:.52rem;font-weight:900;border-radius:999px;padding:4px 6px}.editor-task-status.waiting{background:rgba(109,40,217,.09)}.editor-task-status.claimed{background:color-mix(in srgb,#16a34a 11%,transparent)}.editor-task-card h4{margin:13px 0 3px;font-size:.78rem}.editor-task-subject{font-size:.7rem;font-weight:800;opacity:.76}.editor-task-meta{display:flex;gap:6px;margin-top:auto;padding-top:12px}.editor-task-meta span{font-size:.53rem;padding:4px 6px;border-radius:7px;background:color-mix(in srgb,currentColor 6%,transparent)}.editor-task-actions{display:flex;justify-content:flex-end;margin-top:9px}.editor-pager{display:flex;justify-content:center;gap:6px;margin-top:14px}.editor-pager .admin-btn{min-width:32px}.editor-empty{grid-column:1/-1;padding:22px;text-align:center;border:1px dashed var(--editor-border,rgba(127,127,127,.22));border-radius:14px;font-size:.68rem;opacity:.65}.editor-detail{padding:18px;border:1px solid rgba(109,40,217,.18);border-radius:18px;background:color-mix(in srgb,var(--editor-accent,#6D28D9) 4%,var(--editor-surface,#fff))}.editor-detail-head{display:flex;justify-content:space-between;gap:12px}.editor-detail-head h4{margin:5px 0;font-size:.95rem}.editor-detail-head p{font-size:.68rem}.editor-detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.editor-detail-grid>div{padding:10px;border-radius:11px;background:color-mix(in srgb,currentColor 4%,transparent)}.editor-detail-grid span,.editor-detail-chapters h5{display:block;font-size:.56rem;text-transform:uppercase;font-weight:900;opacity:.5}.editor-detail-grid strong{display:block;margin-top:3px;font-size:.67rem}.editor-detail-chapters{margin-top:13px}.editor-detail-chapters>div{padding:9px;border-top:1px solid var(--editor-border,rgba(127,127,127,.14))}.editor-detail-chapters strong,.editor-detail-chapters small{display:block}.editor-detail-chapters strong{font-size:.68rem}.editor-detail-chapters small{font-size:.61rem;opacity:.65;margin-top:3px}@media(max-width:1100px){.editor-task-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.editor-create-card{grid-template-columns:1fr}.editor-create-fields{grid-template-columns:1fr 1fr auto}}@media(max-width:700px){.editor-task-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.editor-create-fields{grid-template-columns:1fr}.editor-detail-grid{grid-template-columns:1fr 1fr}}@media(max-width:480px){.editor-task-grid{grid-template-columns:1fr}.editor-workspace-head{display:block}.editor-workspace-head>.admin-btn{margin-top:10px}}@media(prefers-color-scheme:dark){#auroreEditorialTaskAdmin{--editor-surface:#17171b;--editor-border:rgba(255,255,255,.13)}.editor-create-fields input{background:var(--editor-surface);border-color:var(--editor-border)}.editor-task-meta span,.editor-detail-grid>div{background:rgba(255,255,255,.06)}}';
 document.head.appendChild(s);
}
async function chargerEspaceEditorialChatGPT(){
 const p=panel();if(!p)return false;injectStyle();
 let root=document.getElementById('auroreEditorialTaskAdmin');
 if(!root){root=document.createElement('div');root.id='auroreEditorialTaskAdmin';const host=document.getElementById('auroraRequestFormHost');(host||p).appendChild(root)}
 root.innerHTML='<div class="editor-empty">Chargement de l’espace éditorial…</div>';
 try{const tasks=await listJobs();const state={tasks,pages:{new:0,active:0}};render(root,state);const count=document.getElementById('tabCountAuroraRequest');if(count)count.textContent=String(tasks.length);return true}
 catch(e){root.innerHTML='<div class="editor-empty">Impossible de charger l’espace éditorial : '+esc(e.message||e)+'</div>';return false}
}
window.chargerEspaceEditorialChatGPT=chargerEspaceEditorialChatGPT;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{const p=panel();if(!p)return;injectStyle();const host=document.getElementById('auroraRequestFormHost');if(host&&!document.getElementById('auroreEditorialTaskAdmin')){const root=document.createElement('div');root.id='auroreEditorialTaskAdmin';root.innerHTML='<div class="editor-empty">Ouvre cet espace pour charger les tâches.</div>';host.appendChild(root)}},{once:true});
})();