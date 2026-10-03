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
async function requestRevisionForGeneratedDocument(documentId){
  return requestRevision(Number(documentId));
}
window.auroreRequestEditorialRevisionForDocument=requestRevisionForGeneratedDocument;
async function beginRevision(id){
  const r=await api('/rest/v1/rpc/aurora_create_new_d_production_from_revision',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({p_generated_document_id:Number(id)})
  });
  if(!r?.ok)throw new Error('La création de la nouvelle production D n’a pas été confirmée par Supabase.');
  return r;
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
  addRevisionButtons();await bindRevisionButtons();
  if(typeof window.chargerEspaceEditorialChatGPT==='function'&&window.__auroreEditorialActiveSection==='E')await window.chargerEspaceEditorialChatGPT('E');
}
function observe(){
  ensureStyle();
  const mo=new MutationObserver(()=>{addRevisionButtons();bindRevisionButtons()});
  ['aurorePdfProdList','adminPendingV2List','adminList','auroreEditorialTaskAdmin'].forEach(id=>{const el=document.getElementById(id);if(el)mo.observe(el,{childList:true,subtree:true})});
  refreshAll();
  setInterval(()=>{if(document.visibilityState!=='hidden')refreshAll()},15000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
window.auroreRefreshRevisionSection=refreshAll;
})();