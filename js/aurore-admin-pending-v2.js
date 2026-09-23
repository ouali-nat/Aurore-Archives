(()=>{
'use strict';
const STATE={jobs:[],filtered:[],query:'',level:'',subject:'',sort:'recent',timer:null,loaded:false,fingerprint:'',refreshing:false};
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const clean=(v,f='')=>{const x=String(v??'').trim();return x||f};
const dateValue=v=>{const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d:null};
const stamp=v=>dateValue(v)?.getTime()||0;
const fmt=v=>{const d=dateValue(v);return d?d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Date non disponible'};
const setText=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=String(v??'')};
const statusOf=j=>String(j?.status||'').toLowerCase();
const metadataOf=j=>j&&j.metadata&&typeof j.metadata==='object'?j.metadata:{};
const themeColor=v=>/^#[0-9a-f]{6}$/i.test(String(v||''))?String(v).toUpperCase():'#C85C0D';
const headers=()=>{try{return typeof headersAdmin==='function'?headersAdmin():{}}catch(_){return {}}};
async function adminFetch(url,options={}){
 if(typeof window.adminInventoryFetch==='function')return window.adminInventoryFetch(url,options);
 return fetch(url,{...options,headers:{...headers(),...(options.headers||{})},cache:'no-store'});
}
function normalise(j){
 const m=metadataOf(j),d=m.aurore_design&&typeof m.aurore_design==='object'?m.aurore_design:{};
 const pRaw=Number(m.generation_progress??m.lualatex_progress??m.pdf_progress);
 return {id:Number(j.id),title:clean(j.title,'Document Aurore sans titre'),level:clean(j.level,'Niveau non précisé'),className:clean(j.class_name,'—'),subject:clean(j.subject,'Matière non précisée'),type:clean(j.document_type,'Document'),created:j.created_at,updated:j.updated_at,status:statusOf(j),generatedDocumentId:j.generated_document_id,theme:themeColor(d.theme_color||m.theme_color),metadata:m,error:clean(j.error_message),progress:Number.isFinite(pRaw)?Math.max(0,Math.min(100,pRaw)):null,stage:clean(m.generation_stage||m.lualatex_stage||m.generation_status||m.lualatex_status),search:[j.title,j.level,j.class_name,j.subject,j.document_type,j.id].filter(Boolean).join(' ').toLocaleLowerCase('fr')};
}
function applyFilters(){
 const q=STATE.query.trim().toLocaleLowerCase('fr');
 let a=STATE.jobs.filter(j=>!q||j.search.includes(q));
 if(STATE.level)a=a.filter(j=>j.level===STATE.level);
 if(STATE.subject)a=a.filter(j=>j.subject===STATE.subject);
 a.sort((x,y)=>STATE.sort==='az'?x.title.localeCompare(y.title,'fr',{sensitivity:'base'}):STATE.sort==='za'?y.title.localeCompare(x.title,'fr',{sensitivity:'base'}):STATE.sort==='oldest'?stamp(x.created)-stamp(y.created)||x.id-y.id:stamp(y.created)-stamp(x.created)||y.id-x.id);
 STATE.filtered=a;
}
function populate(id,values,label){
 const e=document.getElementById(id);if(!e)return;const old=e.value;
 e.innerHTML='<option value="">'+esc(label)+'</option>';
 [...new Set(values.map(clean).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'})).forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;e.appendChild(o)});
 if([...e.options].some(o=>o.value===old))e.value=old;
}
function progress(j){
 if(j.progress!=null)return '<div class="admin-pending-v2-progress"><div class="admin-pending-v2-progress-head"><strong>Progression réelle</strong><span>'+j.progress+'%</span></div><div class="admin-pending-v2-progress-track"><i style="width:'+j.progress+'%"></i></div><small>'+esc(j.stage||'Production Aurore')+'</small></div>';
 const s=statusOf(j);
 const label=s==='processing'?'Génération en cours':'En attente de prise en charge';
 return '<div class="admin-pending-v2-progress is-indeterminate"><div class="admin-pending-v2-progress-head"><strong>Progression de production</strong><span>'+esc(label)+'</span></div><div class="admin-pending-v2-progress-track"><i></i></div><small>Le moteur publiera le pourcentage réel dès qu’une progression chiffrée est disponible.</small></div>';
}
async function chooseTheme(j){
 const chooser=window.auroreContentFactoryChooseTheme;
 if(typeof chooser!=='function')throw new Error('Sélecteur de couleur Aurore indisponible.');
 const color=await chooser(j.theme,'generation');
 if(!color)return false;
 const m=metadataOf(j),d=m.aurore_design&&typeof m.aurore_design==='object'?m.aurore_design:{},c=themeColor(color);
 const metadata={...m,theme_color:c,aurore_design:{...d,theme_color:c,version:1}};
 const r=await adminFetch(SUPABASE_URL+'/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(j.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({metadata,updated_at:new Date().toISOString()})});
 const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));return true;
}
async function launch(j){
 if(statusOf(j)!=='draft')return;
 if(typeof window.auroreAdminConfirmContentJob==='function'){await window.auroreAdminConfirmContentJob(j.id);return;}
 const r=await adminFetch(SUPABASE_URL+'/functions/v1/aurora-content-factory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'queue_job',job_id:j.id})});
 const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));
}
async function deleteJob(j){
 if(statusOf(j)==='processing'){alert('Une génération est en cours. Utilise « Annuler la génération » pour arrêter proprement le job.');return}
 if(!confirm('Supprimer définitivement la demande Aurore #'+j.id+' ?\n\nSeule la demande encore dans le sas sera supprimée. Aucun document publié n’est touché.'))return;
 const r=await adminFetch(SUPABASE_URL+'/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(j.id),{method:'DELETE',headers:{Prefer:'return=minimal'}});
 const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));
 await chargerDocumentsEnAttenteAdminV2();
}
async function cancelJob(j){
 const s=statusOf(j);
 if(!['queued','processing'].includes(s))return;
 if(!confirm('Annuler la génération du job Aurore #'+j.id+' ?\n\nLe job sera arrêté et retiré du sas de production. Cette action ne supprime aucun PDF déjà validé ou publié.'))return;
 try{
  const r=await adminFetch(SUPABASE_URL+'/rest/v1/rpc/aurora_cancel_content_job',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({p_job_id:Number(j.id)})
  });
  const t=await r.text();
  if(!r.ok)throw new Error(t||('HTTP '+r.status));
  await chargerDocumentsEnAttenteAdminV2();
 }catch(e){
  throw e;
 }
}
function actions(j){
 const s=statusOf(j),active=['queued','processing'].includes(s);
 let h='<div class="admin-pending-v2-actions">';
 h+='<button type="button" class="admin-btn ghost" data-action="theme" data-id="'+j.id+'" '+(active?'disabled title="Couleur verrouillée pendant la production."':'')+'>Changer la couleur</button>';
 if(s==='draft')h+='<button type="button" class="admin-btn primary" data-action="launch" data-id="'+j.id+'">Lancer la production</button>';
 else if(s==='queued')h+='<button type="button" class="admin-btn ghost" disabled>En file d’attente</button>';
 else h+='<button type="button" class="admin-btn primary" disabled>Production en cours…</button>';
 if(active)h+='<button type="button" class="admin-btn danger admin-pending-v2-cancel" data-action="cancel" data-id="'+j.id+'">Annuler la génération</button>';
 h+='<button type="button" class="admin-btn danger" data-action="delete" data-id="'+j.id+'" '+(active?'disabled title="Annulation requise avant suppression."':'')+'>Supprimer</button>';
 return h+'</div>';
}
function render(){
 const list=document.getElementById('adminPendingV2List');if(!list)return;applyFilters();
 setText('adminPendingV2Total',STATE.jobs.length);
 setText('adminPendingV2Processing',STATE.jobs.filter(j=>statusOf(j)==='processing').length);
 setText('adminPendingV2Queued',STATE.jobs.filter(j=>statusOf(j)==='queued').length);
 setText('adminPendingV2Visible',STATE.filtered.length);
 if(!STATE.filtered.length){list.innerHTML='<div class="admin-pending-v2-empty"><strong>Aucun document Aurore dans le sas.</strong><span>Le sas ne contient que les demandes Content Factory encore sans document PDF associé.</span></div>';return}
 list.innerHTML=STATE.filtered.map(j=>{
   const s=statusOf(j),label=s==='processing'?'Génération en cours':s==='queued'?'En file d’attente':'Brouillon';
   return '<article class="admin-pending-v2-card" style="--pending-theme:'+esc(j.theme)+'"><div class="admin-pending-v2-card-accent"></div><div class="admin-pending-v2-card-main">'+
   '<div class="admin-pending-v2-card-head"><div><span class="admin-pending-v2-source">Aurore — Content Factory</span><h3 class="admin-pending-v2-title">'+esc(j.title)+'</h3></div><span class="admin-pending-v2-id">Job #'+j.id+'</span></div>'+
   progress(j)+
   '<div class="admin-pending-v2-grid"><div><b>Date</b><span>'+esc(fmt(j.created))+'</span></div><div><b>Classe</b><span>'+esc(j.className)+'</span></div><div><b>Niveau</b><span>'+esc(j.level)+'</span></div><div><b>Matière</b><span>'+esc(j.subject)+'</span></div><div><b>Type</b><span>'+esc(j.type)+'</span></div><div><b>État</b><span>'+esc(label)+'</span></div></div>'+
   '<div class="admin-pending-v2-classification">Matière : '+esc(j.subject)+' · Niveau : '+esc(j.level)+' · Classe : '+esc(j.className)+' · Origine : Aurore</div>'+
   '<div class="admin-pending-v2-status"><strong>'+esc(label)+'</strong> · PDF pas encore associé</div>'+
   '<div class="admin-pending-v2-theme"><span style="background:'+esc(j.theme)+'"></span><div><b>Couleur du document</b><small>'+esc(j.theme)+' · modifiable avant lancement</small></div></div>'+
   (j.error?'<div class="admin-pending-v2-error">'+esc(j.error)+'</div>':'')+
   '<div class="admin-pending-v2-note">La régénération PDF, la validation et la publication interviennent dans l’espace « Documents générés » dès que le document PDF existe.</div>'+
   actions(j)+'</div></article>';
 }).join('');
 list.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>runAction(b)));
}
async function runAction(b){
 const j=STATE.jobs.find(x=>x.id===Number(b.dataset.id));if(!j)return;
 const original=b.textContent;
 b.disabled=true;
 if(b.dataset.action==='cancel')b.textContent='Annulation…';
 else if(b.dataset.action==='launch')b.textContent='Lancement…';
 else if(b.dataset.action==='delete')b.textContent='Suppression…';
 else if(b.dataset.action==='theme')b.textContent='Enregistrement…';
 try{
  if(b.dataset.action==='theme'){if(await chooseTheme(j))await chargerDocumentsEnAttenteAdminV2()}
  else if(b.dataset.action==='launch'){await launch(j);await chargerDocumentsEnAttenteAdminV2()}
  else if(b.dataset.action==='cancel'){await cancelJob(j)}
  else if(b.dataset.action==='delete'){await deleteJob(j)}
 }catch(e){console.error('[ADMIN][AURORE PENDING]',e);alert('Action impossible pour le job #'+j.id+'. '+(e?.message||e));b.disabled=false;b.textContent=original}
}
async function chargerDocumentsEnAttenteAdminV2(){
 const list=document.getElementById('adminPendingV2List');if(!list)return;
 const initialLoad=!STATE.loaded;
 if(initialLoad){
  list.innerHTML='<div class="admin-pending-v2-empty"><strong>Chargement du sas Aurore…</strong><span>Lecture exclusive des demandes sans document PDF associé.</span></div>';
 }
 STATE.refreshing=true;
 try{
  const url=SUPABASE_URL+'/rest/v1/aurora_content_jobs?select=id,created_at,updated_at,status,title,subject,level,class_name,document_type,generated_document_id,error_message,metadata&status=in.(draft,queued,processing)&generated_document_id=is.null&order=created_at.desc&limit=100';
  const r=await adminFetch(url,{cache:'no-store'});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));
  const raw=t?JSON.parse(t):[];
  const nextJobs=(Array.isArray(raw)?raw:[]).map(normalise);
  const nextFingerprint=JSON.stringify(nextJobs.map(j=>({
   id:j.id,title:j.title,level:j.level,className:j.className,subject:j.subject,type:j.type,
   created:j.created,updated:j.updated,status:j.status,generatedDocumentId:j.generatedDocumentId,
   theme:j.theme,error:j.error,progress:j.progress,stage:j.stage
  })));
  const changed=nextFingerprint!==STATE.fingerprint;
  STATE.jobs=nextJobs;
  STATE.fingerprint=nextFingerprint;
  STATE.loaded=true;
  populate('adminPendingV2Level',STATE.jobs.map(j=>j.level),'Tous les niveaux');
  populate('adminPendingV2Subject',STATE.jobs.map(j=>j.subject),'Toutes les matières');
  const note=document.getElementById('adminPendingV2Note');if(note)note.textContent='Sas Aurore uniquement : demandes brouillon, en file ou en production qui n’ont pas encore produit de document PDF. Les documents générés ont leur propre page.';
  if(initialLoad || changed) render();
 }catch(e){
  console.error('[ADMIN][AURORE PENDING] chargement',e);
  if(!STATE.loaded){
   STATE.jobs=[];STATE.filtered=[];
   list.innerHTML='<div class="admin-pending-v2-error"><strong>Impossible de charger le sas Aurore.</strong><br>'+esc(e?.message||e)+'</div>';
   setText('adminPendingV2Total',0);setText('adminPendingV2Processing',0);setText('adminPendingV2Queued',0);setText('adminPendingV2Visible',0);
  }else{
   console.warn('[ADMIN][AURORE PENDING] rafraîchissement conservé à l’écran',e);
  }
 }finally{
  STATE.refreshing=false;
 }
}
async function compterDocumentsEnAttente(){
 try{
  const r=await adminFetch(SUPABASE_URL+'/rest/v1/aurora_content_jobs?select=id&status=in.(draft,queued,processing)&generated_document_id=is.null&limit=1000');
  const a=r.ok?await r.json():[],n=Array.isArray(a)?a.length:0;setText('tabCountAttente',n);return n;
 }catch(_){return 0}
}
function close(){if(history.state?.aurasterNavigation&&history.state.ecranAuraster==='screen-admin-pending'){history.back();return}if(typeof afficherEcran==='function')afficherEcran('screen-admin')}
function bind(){
 document.getElementById('adminPendingV2Search')?.addEventListener('input',e=>{STATE.query=e.target.value||'';render()});
 document.getElementById('adminPendingV2Level')?.addEventListener('change',e=>{STATE.level=e.target.value||'';render()});
 document.getElementById('adminPendingV2Subject')?.addEventListener('change',e=>{STATE.subject=e.target.value||'';render()});
 document.getElementById('adminPendingV2Sort')?.addEventListener('change',e=>{STATE.sort=e.target.value||'recent';render()});
 document.getElementById('adminPendingV2Refresh')?.addEventListener('click',chargerDocumentsEnAttenteAdminV2);
 document.getElementById('adminPendingV2Back')?.addEventListener('click',close);
 document.getElementById('adminPendingV2BackBottom')?.addEventListener('click',close);
 const card=document.querySelector('.admin-tab[data-tab="attente"]');
 if(card)card.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();window.ouvrirDocumentsEnAttenteAdmin()},true);
 compterDocumentsEnAttente();
 STATE.timer=setInterval(()=>{document.getElementById('screen-admin-pending')?.classList.contains('active')?chargerDocumentsEnAttenteAdminV2():compterDocumentsEnAttente()},5000);
}
window.chargerDocumentsEnAttenteAdminV2=chargerDocumentsEnAttenteAdminV2;
window.chargerCompteurDocumentsEnAttenteAdmin=compterDocumentsEnAttente;
window.ouvrirDocumentsEnAttenteAdmin=async function(){
 if(typeof session==='undefined'||!session||session.role!=='admin'){alert('Cette page est réservée aux administrateurs.');return}
 if(typeof afficherEcran!=='function')return;
 afficherEcran('screen-admin-pending');window.scrollTo({top:0,behavior:'auto'});await chargerDocumentsEnAttenteAdminV2();
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();