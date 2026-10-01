(function(){
'use strict';
if(typeof window==='undefined')return;

const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML};
const token=async()=>{
  if(typeof assurerClientAuthGoogle!=='function')throw new Error('Client Supabase indisponible.');
  const client=await assurerClientAuthGoogle();
  const s=(await client.auth.getSession())?.data?.session;
  if(!s?.access_token)throw new Error('Session administrateur expirée.');
  return s.access_token;
};
async function api(path,options={}){
  const t=await token();
  const headers={apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+t,...(options.headers||{})};
  const fetcher=typeof adminInventoryFetch==='function'?adminInventoryFetch:fetch;
  const r=await fetcher(SUPABASE_URL+path,{...options,headers,cache:'no-store'});
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null}catch(_){data=raw}
  if(!r.ok)throw new Error(data?.message||data?.error||raw||('HTTP '+r.status));
  return data;
}
async function listRevisions(){
  const rows=await api('/rest/v1/rpc/aurora_list_editorial_revision_documents',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  return Array.isArray(rows)?rows:[];
}
async function requestRevision(id){
  let reason=prompt('Pourquoi ce document doit-il être révisé ?\n\nLe motif sera conservé dans l’historique éditorial. Laissez vide si aucun motif particulier n’est nécessaire.','');
  if(reason===null)return false;
  const r=await api('/rest/v1/rpc/aurora_request_editorial_revision',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({p_generated_document_id:Number(id),p_reason:String(reason||'').trim()||null})
  });
  if(!r?.ok)throw new Error('La demande de révision n’a pas été confirmée par Supabase.');
  return true;
}
async function requestRevisionForJob(jobId){
  const rows=await api('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(jobId))+'&select=id,generated_document_id,status,metadata');
  const job=Array.isArray(rows)?rows[0]:null;
  const docId=Number(job?.generated_document_id||0);
  if(!docId)throw new Error('Aucun document généré n’est associé au job #'+jobId+'.');
  return requestRevision(docId);
}
window.auroreRequestEditorialRevisionForJob=requestRevisionForJob;
async function beginRevision(id){
  const r=await api('/rest/v1/rpc/aurora_begin_editorial_revision',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({p_generated_document_id:Number(id)})
  });
  if(!r?.ok)throw new Error('La reprise en D n’a pas été confirmée par Supabase.');
  return r;
}
function ensureStyle(){
  if(document.getElementById('aurore-revision-section-e-style'))return;
  const s=document.createElement('style');s.id='aurore-revision-section-e-style';s.textContent=
  '.aurore-revision-e{margin:18px 0 0;padding:16px;border:1px solid color-mix(in srgb,#6D28D9 18%,currentColor);border-radius:18px;background:color-mix(in srgb,#6D28D9 3%,var(--card-bg,#fff));box-shadow:0 8px 26px rgba(0,0,0,.06)}'+
  '.aurore-revision-e-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}.aurore-revision-e-kicker{font-size:.62rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#6D28D9}.aurore-revision-e h3{margin:3px 0 4px;font-size:1rem}.aurore-revision-e p{margin:0;font-size:.7rem;line-height:1.45;color:var(--gris,#687080)}'+
  '.aurore-revision-e-badge{padding:6px 9px;border-radius:9px;background:color-mix(in srgb,#6D28D9 9%,transparent);font-size:.61rem;font-weight:900;white-space:nowrap}'+
  '.aurore-revision-e-list{display:grid;gap:9px}.aurore-revision-e-card{padding:12px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:13px;background:var(--card-bg,#fff)}.aurore-revision-e-card strong{display:block;font-size:.75rem}.aurore-revision-e-meta{margin-top:4px;font-size:.64rem;line-height:1.45;color:var(--gris,#687080)}.aurore-revision-e-reason{margin-top:7px;padding:7px 9px;border-left:3px solid #6D28D9;background:color-mix(in srgb,#6D28D9 5%,transparent);font-size:.63rem;line-height:1.4}.aurore-revision-e-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.aurore-revision-e-empty{font-size:.68rem;color:var(--gris,#687080);padding:7px 0}.aurore-revision-request-btn{margin-top:8px!important}.aurore-revision-e-card .admin-btn{min-height:36px}'+
  '@media(max-width:600px){.aurore-revision-e{padding:13px}.aurore-revision-e-head{flex-direction:column}.aurore-revision-e-badge{align-self:flex-start}.aurore-revision-e-actions .admin-btn{width:100%}}';
  document.head.appendChild(s);
}
function hostFor(kind){
  if(kind==='content'){
    const center=document.getElementById('aurorePdfProductionCenter');
    if(center)return {parent:center,after:center};
    const list=document.getElementById('aurorePdfProdList');
    if(list)return {parent:list,after:list};
    return null;
  }
  const list=document.getElementById('adminPendingV2List')||document.getElementById('adminList');
  return list?{parent:list,after:list}:null;
}
function ensureBox(kind){
  const host=hostFor(kind);if(!host)return null;
  const id='auroreRevisionE-'+kind;
  let box=document.getElementById(id);
  if(!box){
    box=document.createElement('section');box.id=id;box.className='aurore-revision-e';box.setAttribute('aria-label','Section E — Documents à réviser');
    host.after.parentNode.insertBefore(box,host.after.nextSibling);
  }
  return box;
}
function renderBox(kind,rows){
  const box=ensureBox(kind);if(!box)return;
  box.innerHTML='<div class="aurore-revision-e-head"><div><span class="aurore-revision-e-kicker">Section E</span><h3>Documents à réviser</h3><p>Les documents envoyés ici quittent le circuit PDF en attente et peuvent être repris explicitement en D. Aucun PDF n’est lancé depuis E.</p></div><span class="aurore-revision-e-badge">'+rows.length+' à réviser</span></div><div class="aurore-revision-e-list">'+
    (rows.length?rows.map(r=>{
      const when=r.revision_requested_at?new Date(r.revision_requested_at).toLocaleString('fr-FR'):'Date non disponible';
      const reason=r.revision_reason?'<div class="aurore-revision-e-reason"><strong>Motif :</strong> '+esc(r.revision_reason)+'</div>':'';
      return '<article class="aurore-revision-e-card" data-revision-id="'+esc(r.generated_document_id)+'"><strong>'+esc(r.title||('Document #'+r.generated_document_id))+'</strong><div class="aurore-revision-e-meta">#'+esc(r.generated_document_id)+' · Tâche #'+esc(r.job_id||'—')+' · '+esc(r.class_name||r.level||'—')+' · '+esc(r.subject||'—')+' · demandé le '+esc(when)+'</div>'+reason+'<div class="aurore-revision-e-actions"><button type="button" class="admin-btn primary js-revision-begin" data-revision-id="'+esc(r.generated_document_id)+'">Reprendre en D →</button>'+(r.pdf_url?'<button type="button" class="admin-btn ghost js-revision-open" data-revision-pdf="'+esc(r.pdf_url)+'">Ouvrir l’ancien PDF</button>':'')+'</div></article>';
    }).join(''):'<div class="aurore-revision-e-empty">Aucun document en révision. Les demandes apparaîtront ici dès qu’un administrateur utilise « Demander une révision ».</div>')+
    '</div>';
  box.querySelectorAll('.js-revision-begin').forEach(b=>b.addEventListener('click',async()=>{
    const id=Number(b.dataset.revisionId);if(!id)return;
    b.disabled=true;b.textContent='Reprise en D…';
    try{
      await beginRevision(id);
      alert('Document repris en Section D. Il est maintenant disponible pour une nouvelle édition éditoriale. Aucun PDF n’a été lancé.');
      await refreshAll();
    }catch(e){alert(e.message||e);b.disabled=false;b.textContent='Reprendre en D →'}
  }));
  box.querySelectorAll('.js-revision-open').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.revisionPdf)window.open(b.dataset.revisionPdf,'_blank','noopener,noreferrer')}));
}
function extractId(card){
  if(!card)return null;
  const vals=[
    card.dataset.generatedDocumentId,card.dataset.documentId,card.dataset.docId,
    card.dataset.adminId
  ];
  for(const v of vals){
    const m=String(v||'').match(/(?:aurora-)?(\d+)$/);if(m)return Number(m[1]);
  }
  const el=card.querySelector('[data-generated-document-id],[data-document-id],[data-doc-id]');
  if(el){const m=String(el.dataset.generatedDocumentId||el.dataset.documentId||el.dataset.docId||'').match(/(\d+)/);if(m)return Number(m[1])}
  return null;
}
function addRevisionButtons(){
  document.querySelectorAll('.aurora-generated-card,[data-generated-document-id],[data-document-id]').forEach(card=>{
    const id=extractId(card);if(!id||card.querySelector('.aurore-revision-request-btn'))return;
    const actions=card.querySelector('.admin-actions')||card.querySelector('.admin-card-body');
    if(!actions)return;
    const btn=document.createElement('button');btn.type='button';btn.className='admin-btn ghost aurore-revision-request-btn';btn.textContent='Envoyer en E — réviser';btn.dataset.revisionRequestId=String(id);
    actions.appendChild(btn);
  });
  document.querySelectorAll('[data-revision-job]').forEach(btn=>{
    if(btn.dataset.revisionBound==='1')return;
    btn.dataset.revisionBound='1';
    btn.addEventListener('click',async()=>{
      const jobId=Number(btn.dataset.revisionJob);if(!jobId)return;
      btn.disabled=true;const original=btn.textContent;btn.textContent='Envoi en E…';
      try{
        if(typeof window.auroreRequestEditorialRevisionForJob!=='function')throw new Error('Le circuit Section E n’est pas chargé.');
        const ok=await window.auroreRequestEditorialRevisionForJob(jobId);
        if(!ok){btn.disabled=false;btn.textContent=original;return;}
        alert('Job #'+jobId+' envoyé en Section E. Il quitte maintenant le sas PDF et pourra être repris explicitement en D après révision.');
        await refreshAll();
        if(typeof window.chargerEspaceEditorialChatGPT==='function'&&window.__auroreEditorialActiveSection)await window.chargerEspaceEditorialChatGPT(window.__auroreEditorialActiveSection);
        if(typeof window.chargerDocumentsEnAttenteAdminV2==='function')await window.chargerDocumentsEnAttenteAdminV2();
      }catch(e){alert(e.message||e);btn.disabled=false;btn.textContent=original}
    });
  });
}
async function bindRevisionButtons(){
  document.querySelectorAll('.aurore-revision-request-btn').forEach(b=>{
    if(b.dataset.revisionBound==='1')return;b.dataset.revisionBound='1';
    b.addEventListener('click',async()=>{
      const id=Number(b.dataset.revisionRequestId);if(!id)return;
      b.disabled=true;b.textContent='Enregistrement…';
      try{
        await requestRevision(id);
        alert('Demande de révision enregistrée. Le document est maintenant dans la Section E. Il ne sera pas régénéré automatiquement.');
        await refreshAll();
      }catch(e){alert(e.message||e);b.disabled=false;b.textContent='Demander une révision'}
    });
  });
}
async function refreshAll(){
  try{
    const rows=await listRevisions();
    renderBox('content',rows);
    renderBox('pending',rows);
  }catch(e){
    console.error('[Aurore][Section E]',e);
    const msg='<div class="aurore-revision-e-empty">Impossible de charger les documents à réviser : '+esc(e.message||e)+'</div>';
    for(const kind of ['content','pending']){const b=ensureBox(kind);if(b)b.innerHTML=msg}
    return;
  }
  addRevisionButtons();await bindRevisionButtons();
  if(typeof window.chargerEspaceEditorialChatGPT==='function'&&window.__auroreEditorialActiveSection==='E')await window.chargerEspaceEditorialChatGPT('E');
}
function observe(){
  ensureStyle();
  const mo=new MutationObserver(()=>{addRevisionButtons();bindRevisionButtons()});
  ['aurorePdfProdList','adminPendingV2List','adminList'].forEach(id=>{const el=document.getElementById(id);if(el)mo.observe(el,{childList:true,subtree:true})});
  refreshAll();
  setInterval(()=>{if(document.visibilityState!=='hidden')refreshAll()},15000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
window.auroreRefreshRevisionSection=refreshAll;
})();