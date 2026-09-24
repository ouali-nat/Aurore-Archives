

(function(){
'use strict';
if(typeof window==='undefined'||typeof window.adminInventoryFetch==='function')return;
window.adminInventoryFetch=async function(url,options={},retry=true){
  const token=(typeof session!=='undefined'&&session&&session.access_token)||'';
  const headers={...(options.headers||{}),apikey:SUPABASE_ANON_KEY};
  if(token)headers.Authorization='Bearer '+token;
  const response=await fetch(url,{...options,headers,cache:'no-store'});
  if((response.status===401||response.status===403)&&retry&&typeof assurerClientAuthGoogle==='function'){
    try{
      const client=await assurerClientAuthGoogle();
      const refreshed=await client?.auth.refreshSession();
      const fresh=refreshed?.data?.session?.access_token;
      if(fresh){
        const s=refreshed.data.session;
        try{
          session={...(session||{}),access_token:fresh,refresh_token:s.refresh_token||session?.refresh_token||'',expires_at:s.expires_at?s.expires_at*1000:(session?.expires_at||0)};
          if(typeof sauvegarderSession==='function')sauvegarderSession();
        }catch(_){}
        const retryHeaders={...(options.headers||{}),apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+fresh};
        return fetch(url,{...options,headers:retryHeaders,cache:'no-store'});
      }
    }catch(_){}
  }
  return response;
};
})();

(function(){'use strict';const panel=document.querySelector('.admin-tab-panel[data-panel="content-factory"]');if(!panel)return;const list=document.getElementById('adminContentFactoryList'),count=document.getElementById('tabCountContentFactory');let rows=[];let generationQueue=[];let generationRunning=false;window.__aurorePdfActionBusy=window.__aurorePdfActionBusy instanceof Set?window.__aurorePdfActionBusy:new Set();let cfCreatePath=[];let cfClassificationInitialized=false;const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML};const sl=s=>({review:'À contrôler',approved:'Validé',published:'Publié',rejected:'Rejeté',failed:'Échec',generated:'Généré',processing:'Traitement',queued:'En file',draft:'Brouillon'}[s]||s||'Inconnu');const adminOk=()=>!!(session&&session.role==='admin');const normalizeThemeColor=v=>/^#[0-9a-f]{6}$/i.test(String(v||''))?String(v).toUpperCase():'#C85C0D';
const documentThemeColor=metadata=>{
  const m=metadata&&typeof metadata==='object'?metadata:{};
  const d=m.aurore_design&&typeof m.aurore_design==='object'?m.aurore_design:{};
  return normalizeThemeColor(d.theme_color||d.themeColor||m.theme_color||m.themeColor||'#C85C0D');
};
async function chooseRegenerationTheme(defaultColor,mode='regeneration'){
  return new Promise(resolve=>{
    let modal=document.getElementById('cfThemeModal');
    if(!modal){
      modal=document.createElement('div');
      modal.id='cfThemeModal';
      modal.innerHTML='<div class="cf-theme-modal-backdrop"></div><section class="cf-theme-modal-card" role="dialog" aria-modal="true" aria-labelledby="cfThemeModalTitle"><div class="cf-theme-modal-kicker">Identité Aurore</div><h3 id="cfThemeModalTitle">Choisir la couleur du nouveau PDF</h3><p class="cf-theme-modal-description">Les couleurs proposées reprennent les 45 thèmes officiels du site Aurore. La couleur choisie restera associée à cette version.</p><div class="cf-theme-modal-picker"><input id="cfThemeModalInput" type="color" aria-label="Couleur dominante du PDF"><div><strong id="cfThemeModalValue"></strong><span>Couleur dominante</span></div></div><div class="cf-theme-swatches" aria-label="Couleurs proposées"></div><div class="cf-theme-modal-actions"><button type="button" class="admin-btn ghost" id="cfThemeModalCancel">Annuler</button><button type="button" class="admin-btn primary" id="cfThemeModalApply">Régénérer avec cette couleur</button></div></section></div>';
      document.body.appendChild(modal);
      const style=document.createElement('style');
      style.id='cfThemeModalStyles';
      style.textContent='.cf-theme-modal-backdrop{position:fixed;inset:0;background:rgba(4,8,20,.48);backdrop-filter:blur(5px);z-index:10030}.cf-theme-modal-card{position:fixed;z-index:10031;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,calc(100vw - 22px));max-height:calc(100vh - 28px);overflow:auto;box-sizing:border-box;padding:20px;border:1px solid var(--bordure,rgba(0,0,0,.12));border-radius:22px;background:var(--card-bg,#fff);box-shadow:0 22px 70px rgba(0,0,0,.2);color:var(--encre,#111)}.cf-theme-modal-card h3{margin:4px 0 8px;font-size:1.12rem}.cf-theme-modal-card p{margin:0;color:var(--gris,#687080);font-size:.8rem;line-height:1.55}.cf-theme-modal-kicker{font-size:.68rem;font-weight:900;letter-spacing:.09em;text-transform:uppercase;opacity:.68}.cf-theme-modal-picker{display:flex;align-items:center;gap:13px;margin:16px 0 12px;padding:10px;border:1px solid color-mix(in srgb,#C85C0D 20%,var(--bordure,rgba(0,0,0,.12)));border-radius:15px;background:var(--fond,#fafafa)}.cf-theme-modal-picker input{width:58px;height:42px;padding:3px;border:0;border-radius:11px;background:transparent;cursor:pointer}.cf-theme-modal-picker strong{display:block;font-size:.82rem}.cf-theme-modal-picker span{display:block;font-size:.68rem;opacity:.68;margin-top:2px}.cf-theme-swatches{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin:8px 0 18px}.cf-theme-swatch{display:flex;align-items:center;gap:9px;width:100%;min-height:52px;padding:6px 8px;border:1px solid var(--bordure,rgba(0,0,0,.1));border-radius:12px;background:var(--fond,#fafafa);color:var(--encre,#111);cursor:pointer;text-align:left}.cf-theme-swatch-dot{flex:0 0 30px;width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.94);box-shadow:0 0 0 1px rgba(0,0,0,.13)}.cf-theme-swatch-name{font-size:.7rem;font-weight:800;line-height:1.15}.cf-theme-swatch-code{display:block;font-size:.59rem;font-weight:700;opacity:.58;margin-top:2px;letter-spacing:.03em}.cf-theme-swatch.is-selected{border-color:var(--encre,#111);box-shadow:0 0 0 2px rgba(200,92,13,.20)}.cf-theme-modal-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap}[data-theme="dark"] #cfThemeModal .cf-theme-modal-card{background:#11101c!important;color:#f7f5ff!important;border-color:#3a3452!important;box-shadow:0 24px 80px rgba(0,0,0,.55)!important}[data-theme="dark"] #cfThemeModal .cf-theme-modal-card p{color:#b8b2c9!important}[data-theme="dark"] #cfThemeModal .cf-theme-modal-kicker{color:#ddd6fe!important;opacity:.9}[data-theme="dark"] #cfThemeModal .cf-theme-modal-picker{background:#17142a!important;border-color:#3a3452!important;color:#f7f5ff!important}[data-theme="dark"] #cfThemeModal .cf-theme-modal-picker strong{color:#f7f5ff!important}[data-theme="dark"] #cfThemeModal .cf-theme-modal-picker span{color:#b8b2c9!important}[data-theme="dark"] #cfThemeModal .cf-theme-swatch{background:#17142a!important;color:#f7f5ff!important;border-color:#3a3452!important}[data-theme="dark"] #cfThemeModal .cf-theme-swatch:hover{background:#211d38!important;border-color:#5a5278!important}[data-theme="dark"] #cfThemeModal .cf-theme-swatch.is-selected{border-color:#f7f5ff!important;box-shadow:0 0 0 2px rgba(167,139,250,.35)!important}[data-theme="dark"] #cfThemeModal .cf-theme-swatch-code{color:#b8b2c9!important;opacity:.9}[data-theme="dark"] #cfThemeModal .cf-theme-modal-actions .admin-btn.ghost{background:#17142a!important;color:#f7f5ff!important;border-color:#3a3452!important}[data-theme="dark"] #cfThemeModal .cf-theme-modal-actions .admin-btn.primary{background:#7c3aed!important;color:#fff!important;border-color:#7c3aed!important}@media(max-width:650px){.cf-theme-swatches{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:430px){.cf-theme-modal-card{padding:14px}.cf-theme-swatches{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.cf-theme-swatch{min-height:48px}.cf-theme-swatch-dot{flex-basis:28px;width:28px;height:28px}.cf-theme-swatch-name{font-size:.66rem}.cf-theme-swatch-code{font-size:.54rem}}@media(max-width:560px){.cf-theme-modal-actions .admin-btn{width:100%;justify-content:center}}';
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
    const generationMode=mode==='generation';
    const titleEl=modal.querySelector('#cfThemeModalTitle');
    const descEl=modal.querySelector('.cf-theme-modal-description');
    const applyEl=modal.querySelector('#cfThemeModalApply');
    if(titleEl)titleEl.textContent=generationMode?'Choisir la couleur du document':'Choisir la couleur du nouveau PDF';
    if(descEl)descEl.textContent=generationMode
      ?'Choisis la couleur avant de lancer la production. Elle sera enregistrée sur la demande puis reprise par le rendu PDF.'
      :'La couleur choisie restera associée à cette version du PDF.';
    if(applyEl)applyEl.textContent=generationMode?'Générer avec cette couleur':'Régénérer avec cette couleur';
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
window.auroreContentFactoryChooseTheme=async function(defaultColor,mode='generation'){return chooseRegenerationTheme(defaultColor,mode)};
async function updateProductionAttemptFromDocument(id,state,accessToken,extra={}){
  try{
    const token=accessToken||await cfFreshToken();
    const q=await adminInventoryFetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id))+'&select=id,metadata',{cache:'no-store',headers:{'Authorization':'Bearer '+token}});
    const qt=await q.text(); if(!q.ok)return;
    const docRows=qt?JSON.parse(qt):[]; const attemptId=docRows?.[0]?.metadata?.production_attempt_id;
    if(!attemptId)return;
    const body={status:String(state),metadata:extra,updated_at:new Date().toISOString()};
    if(extra?.pdf_url)body.pdf_url=extra.pdf_url;
    if(extra?.pdf_path)body.pdf_path=extra.pdf_path;
    if(extra?.error_message)body.error_message=extra.error_message;
    if(['pdf_ready','failed','cancelled'].includes(String(state)))body.finished_at=new Date().toISOString();
    await adminInventoryFetch(SUPABASE_URL+'/rest/v1/aurora_generated_document_production_attempts?id=eq.'+encodeURIComponent(Number(attemptId)),{method:'PATCH',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body)});
  }catch(e){console.warn('[Content Factory] historique tentative:',e)}
}
async function startProductionAttempt(id,accessToken){
  const token=accessToken||await cfFreshToken();
  const r=await adminInventoryFetch(SUPABASE_URL+'/rest/v1/rpc/aurora_start_pdf_production_attempt',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({p_generated_document_id:Number(id)})});
  const t=await r.text(); if(!r.ok)throw new Error(t||('Création de la tentative impossible (HTTP '+r.status+').'));
  let data=null;try{data=t?JSON.parse(t):null}catch(_){data=null}
  return data;
}
async function setGeneratedProductionState(id,state,accessToken,extra={}){
  const token=accessToken||await cfFreshToken();
  const q=await adminInventoryFetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id))+'&select=id,metadata',{cache:'no-store',headers:{'Authorization':'Bearer '+token}});
  const qt=await q.text();
  if(!q.ok)throw new Error('Lecture de l’état de production impossible (HTTP '+q.status+').');
  let rows=[];try{rows=qt?JSON.parse(qt):[]}catch(_){rows=[]}
  const current=Array.isArray(rows)&&rows[0]?.metadata&&typeof rows[0].metadata==='object'?rows[0].metadata:{};
  const metadata={...current,production_status:String(state),production_status_updated_at:new Date().toISOString(),...extra};
  const u=await adminInventoryFetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id)),{
    method:'PATCH',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body:JSON.stringify({metadata,updated_at:new Date().toISOString()})
  });
  const ut=await u.text();if(!u.ok)throw new Error('Enregistrement de l’état de production impossible (HTTP '+u.status+'). '+ut);
  return metadata;
}
async function persistGeneratedDocumentTheme(id,themeColor,accessToken){
  const color=normalizeThemeColor(themeColor);
  const q=await adminInventoryFetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id))+'&select=id,metadata',{cache:'no-store',headers:{'Authorization':'Bearer '+accessToken}});
  const qt=await q.text();
  if(!q.ok)throw new Error('Lecture des métadonnées impossible (HTTP '+q.status+').');
  let rows=[];try{rows=qt?JSON.parse(qt):[]}catch(_){rows=[]}
  const current=Array.isArray(rows)&&rows[0]?.metadata&&typeof rows[0].metadata==='object'?rows[0].metadata:{};
  const currentDesign=current.aurore_design&&typeof current.aurore_design==='object'?current.aurore_design:{};
  const metadata={...current,aurore_design:{...currentDesign,theme_color:color,version:1},theme_color:color};
  const u=await adminInventoryFetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id)),{
    method:'PATCH',cache:'no-store',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+accessToken},
    body:JSON.stringify({metadata,theme_color:color,updated_at:new Date().toISOString()})
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
async function rpc(name,body){const r=await adminInventoryFetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));try{return t?JSON.parse(t):null}catch(_){return t}}
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
  const rawBase=Array.isArray(leaf?.matieres)?leaf.matieres:(Array.isArray(MATIERES)?MATIERES:[]);const base=typeof matieresAvecAutres==='function'?matieresAvecAutres(rawBase):rawBase;
  const names=[...new Set(base.map(x=>typeof x==='string'?x:(x?.nom||'')).map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
  sel.innerHTML='<option value="">'+(leaf?'Choisir une matière…':'Choisir un parcours…')+'</option>'+names.map(v=>'<option value="'+cfEscape(v)+'">'+cfEscape(v)+'</option>').join('');
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
function cfSeriesClassOptions(node){
  if(!node||!Array.isArray(node.series)||!node.series.some(s=>Array.isArray(s.classes)))return null;
  const items=[];
  if(Array.isArray(node.troncCommuns)){
    for(const classe of node.troncCommuns)items.push({node:classe,series:null});
  }
  for(const serie of node.series){
    if(!Array.isArray(serie.classes))continue;
    for(const classe of serie.classes)items.push({node:classe,series:serie});
  }
  return items.length?items:null;
}
function cfLeafRoutes(root){
  const out=[];
  const walk=(node,path,display)=>{
    if(!node)return;
    const nextPath=[...path,node];
    const isSerie=node.type==='serie';
    const nextDisplay=isSerie?display:[...display,String(node.nom||'').trim()].filter(Boolean);
    const kids=cfChildren(node);
    if(!kids){out.push({leaf:node,path:nextPath,label:nextDisplay.join(' · ')});return;}
    for(const child of kids)walk(child,nextPath,nextDisplay);
  };
  walk(root,[],[]);
  const seen=new Set();
  return out.filter(x=>{const key=String(x.path.map(n=>n.id||n.nom).join('/'));if(seen.has(key))return false;seen.add(key);return true;});
}
let cfRouteChoices=[];
function cfRenderCascade(){
  const zone=document.getElementById('cfCreateCascade');
  if(!zone)return;
  const root=document.getElementById('cfCreateLevelPicker');
  const route=document.getElementById('cfCreatePathPicker');
  if(!root||!route)return;
  root.innerHTML='<option value="">Choisir un niveau…</option>'+NIVEAUX.map(n=>'<option value="'+cfEscape(n.id)+'">'+cfEscape(n.nom)+'</option>').join('');
  root.value=cfCreatePath[0]?.id||'';
  const rootNode=NIVEAUX.find(x=>x.id===root.value)||null;
  cfRouteChoices=rootNode?cfLeafRoutes(rootNode):[];
  route.innerHTML='<option value="">'+(rootNode?'Choisir un parcours…':'Choisis d’abord un niveau…')+'</option>'+cfRouteChoices.map((x,i)=>'<option value="'+i+'">'+cfEscape(x.label)+'</option>').join('');
  route.disabled=!rootNode||!cfRouteChoices.length;
  const currentIndex=cfRouteChoices.findIndex(x=>x.path[x.path.length-1]===cfCreatePath[cfCreatePath.length-1]);
  if(currentIndex>=0)route.value=String(currentIndex);
  root.onchange=()=>{
    const n=NIVEAUX.find(x=>x.id===root.value)||null;
    cfCreatePath=n?[n]:[];
    cfRenderCascade();cfResolveClassification();
  };
  route.onchange=()=>{
    const choice=cfRouteChoices[Number(route.value)];
    cfCreatePath=choice?[...choice.path]:[];
    cfRenderCascade();cfResolveClassification();
  };
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
  sel.value=values.includes(current)?current:'';
}
function cfInitClassification(){
  const category=document.getElementById('cfCreateCategory');
  if(!cfClassificationInitialized){
    category?.addEventListener('change',cfUpdateResourceTypes);
    cfClassificationInitialized=true;
  }
  cfRenderCascade();
  cfResolveClassification();
  cfUpdateResourceTypes();
}
async function loadClassificationOptions(){
  // Le formulaire est déjà construit côté DOM avant l'exécution de ce script.
  // Ne pas conditionner son initialisation à la session admin : l'authentification
  // est finalisée sur DOMContentLoaded, alors que ce fichier defer s'exécute avant.
  // La soumission reste protégée par adminOk().
  cfInitClassification();["cfAiGemini","cfAiLlama","cfAiDeepSeek"].forEach(id=>document.getElementById(id)?.addEventListener("change",syncAiStrategyHint));syncAiStrategyHint();
}
function selectedAiProviders(){return ["chatgpt_editor"];}
function syncAiStrategyHint(){const hint=document.getElementById("cfAiStrategyHint");if(hint)hint.textContent="Éditeur actif : ChatGPT · schéma éditorial aurora-editorial-1 · contenu soumis au contrôle humain avant tout rendu/publication.";}
function selectedValue(id){return String(document.getElementById(id)?.value||'').trim();}
function contentFactoryProfile(resourceType){
  const raw=String(resourceType||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[-_]+/g,' ');
  if(raw.includes('exercice')||raw.includes('devoir')||raw.includes('corrige de devoir')||raw==='corrige'){
    return {
      kind:'exercices',
      version:'exercise-sheet-v2',
      lock:true,
      document_type:'exercices',
      paired_corrections:true,
      exercise_sheet_intro:'Énoncés indépendants, consignes précises, calculs justifiés et corrigés exclusivement liés aux questions posées.'
    };
  }
  if(raw.includes('cours')||raw.includes('revision')||raw.includes('resume')||raw.includes('document pedagogique')||raw==='cours'){
    return {kind:'cours',version:'course-v2',lock:true,document_type:resourceType||'cours'};
  }
  return {kind:'document',version:'document-v1',lock:true,document_type:resourceType||'document'};
}
async function getJob(jobId){const r=await adminInventoryFetch(`${SUPABASE_URL}/rest/v1/aurora_content_jobs?id=eq.${encodeURIComponent(jobId)}&select=id,status,title,generated_document_id,error_message,updated_at`,{cache:'no-store'});const t=await r.text();if(!r.ok)throw new Error(t||('HTTP '+r.status));const a=t?JSON.parse(t):[];return Array.isArray(a)&&a[0]?a[0]:null;}
async function waitForJob(jobId){let last=null;for(let i=0;i<180;i++){const j=await getJob(jobId);if(!j)throw new Error('Job introuvable dans Supabase.');last=j;if(j.status==='queued'){setProgress(8,`Job #${jobId} en file — Aurora attend son tour…`)}else if(j.status==='processing'){setProgress(Math.min(88,18+i*.4),`Aurora traite le document #${jobId}…`)}else if(j.status==='review'){setProgress(100,`Document #${jobId} terminé et placé en contrôle.`);return j}else if(j.status==='failed'||j.status==='rejected'){throw new Error(j.error_message||`La génération s’est arrêtée avec le statut ${j.status}.`)}else{setProgress(12,`Statut Aurora : ${j.status}`)}await new Promise(r=>setTimeout(r,2000));}return last;}
async function runGeneration(item){
  const msg=document.getElementById('cfCreateMsg');
  generationRunning=true;
  updateQueueUI();
  setProgress(8,'Demande éditoriale « '+item.title+' » enregistrée.');
  try{
    let jobId=Number(item.jobId||0);
    if(!jobId){
      const finalPrompt=item.prompt+(item.reference?'\n\nRÉFÉRENCE PÉDAGOGIQUE FOURNIE PAR L’ADMINISTRATION : '+item.reference:'');
      const job=await rpc('aurora_create_content_job',{
        p_title:item.title,p_subject:item.subject||null,p_level:item.level||null,p_class_name:item.className||null,p_document_type:item.resourceType,p_prompt:finalPrompt,
        p_instructions:{
          source:'admin_content_factory',
          origin:'gpt_editorial_queue',
          queue:'sequential',
          category:item.category,
          filiere:item.filiere||null,
          reference:item.reference||null,
          rights_confirmed:true,
          theme_color:normalizeThemeColor(item.themeColor||'#6D28D9'),
          editorial:{role:'editor',engine:'ChatGPT',schema_version:'aurora-editorial-1',status:'pending'},
          profile:contentFactoryProfile(item.resourceType)
        }
      });
      jobId=Number(job);
      if(!Number.isSafeInteger(jobId)||jobId<1)throw new Error('Identifiant de demande invalide.');
    }
    if(msg){
      msg.dataset.state='ok';
      msg.textContent='✓ Demande #'+jobId+' enregistrée. Elle attend maintenant l’éditeur ChatGPT ; le rendu PDF sera lancé séparément après intégration du contenu.';
    }
    setProgress(100,'En attente de l’éditeur ChatGPT · aucun moteur de contenu automatique.');
    await charger();
  }finally{
    generationRunning=false;
    updateQueueUI();
  }
}
async function processQueue(){if(generationRunning)return;const item=generationQueue.shift();updateQueueUI();if(!item)return;try{await runGeneration(item);}catch(e){const msg=document.getElementById('cfCreateMsg');if(msg){msg.dataset.state='error';msg.textContent=`Le document « ${item.title} » n’a pas pu être généré : ${e.message||e}`}setProgress(100,'Échec de ce document — Aurora passe au suivant.');}finally{updateQueueUI();if(generationQueue.length)processQueue();}}
async function enqueueCurrent(){
  if(!adminOk())return;
  const title=selectedValue('cfCreateTitle'),subject=selectedValue('cfCreateSubject'),level=selectedValue('cfCreateLevel'),className=selectedValue('cfCreateClass'),filiere=selectedValue('cfCreateFiliere'),category=selectedValue('cfCreateCategory'),resourceType=selectedValue('cfCreateResourceType'),reference=selectedValue('cfCreateReference'),prompt=(document.getElementById('cfCreatePrompt')?.value||'').trim(),rights=Boolean(document.getElementById('cfCreateRights')?.checked),themeColor=normalizeThemeColor(document.getElementById('cfCreateThemeColor')?.value),aiSelected=selectedAiProviders(),msg=document.getElementById('cfCreateMsg');
  if(!title){if(msg){msg.dataset.state='error';msg.textContent='Le titre est obligatoire.';}return;}
  if(!level){if(msg){msg.dataset.state='error';msg.textContent='Sélectionne le parcours scolaire complet.';}return;}
  if(!subject){if(msg){msg.dataset.state='error';msg.textContent='Sélectionne la matière.';}return;}
  if(!category){if(msg){msg.dataset.state='error';msg.textContent='Choisis la catégorie.';}return;}
  if(!resourceType){if(msg){msg.dataset.state='error';msg.textContent='Choisis le type de ressource.';}return;}
  if(!prompt){if(msg){msg.dataset.state='error';msg.textContent='La demande pédagogique est obligatoire.';}return;}
  if(!rights){if(msg){msg.dataset.state='error';msg.textContent='Confirme l’autorisation d’utiliser la demande et les références fournies.';}return;}
  try{
    const finalPrompt=prompt+(reference?'\n\nRÉFÉRENCE PÉDAGOGIQUE FOURNIE PAR L’ADMINISTRATION : '+reference:'');
    const job=await rpc('aurora_create_content_job',{
      p_title:title,p_subject:subject||null,p_level:level||null,p_class_name:className||null,p_document_type:resourceType,p_prompt:finalPrompt,
      p_instructions:{source:'admin_content_factory',origin:'aurore',queue:'sequential',category,filiere:filiere||null,reference:reference||null,rights_confirmed:true,theme_color:normalizeThemeColor(themeColor||'#6D28D9'),editorial:{role:'editor',engine:'ChatGPT',schema_version:'aurora-editorial-1',status:'pending'},profile:contentFactoryProfile(resourceType),paired_corrections:contentFactoryProfile(resourceType).paired_corrections===true,
        classification:{level:level||null,filiere:filiere||null,class_name:className||null,subject:subject||null,category,resource_type:resourceType}}
    });
    const jobId=Number(job);
    if(!Number.isSafeInteger(jobId)||jobId<1)throw new Error('Identifiant de job invalide.');
    generationQueue.push({title,subject,level,className,filiere,category,resourceType,reference,prompt,themeColor,rights,aiSelected,jobId,profile:contentFactoryProfile(resourceType)});
    if(msg){msg.dataset.state='ok';msg.textContent='« '+title+' » enregistré dans Supabase (#'+jobId+') et protégé contre la fermeture de la page. ('+generationQueue.length+' affiché'+(generationQueue.length>1?'s':'')+' dans la file'+(generationRunning?' derrière le document en cours':'')+').';}
    updateQueueUI();if(!generationRunning)processQueue();
  }catch(e){
    if(msg){msg.dataset.state='error';msg.textContent='Impossible d’enregistrer « '+title+' » dans la file serveur : '+(e.message||e);}
  }
}
function bindClassification(){
  const themeInput=document.getElementById('cfCreateThemeColor');
  const themeValue=document.getElementById('cfCreateThemeColorValue');
  const themeSwatches=document.getElementById('cfCreateThemeSwatches');
  const themeToggle=document.getElementById('cfThemePaletteToggle');
  const themePalette=document.getElementById('cfCreateThemePalette');
  const themePreview=document.getElementById('cfThemeColorPreview');
  const palette=[
    ['Violet','#6D28D9'],['Rouge','#C93648'],['Vert','#198754'],['Bleu','#1D4ED8'],['Jaune','#B77900'],['Orange','#C85C0D'],
    ['Cyan','#0E7490'],['Rose','#BE185D'],['Indigo','#4338CA'],['Turquoise','#0F766E'],['Émeraude','#047857'],['Citron vert','#4D7C0F'],
    ['Sarcelle','#115E59'],['Magenta','#A21CAF'],['Fuchsia','#86198F'],['Corail','#C2412D'],['Bordeaux','#881337'],['Pourpre','#6B21A8'],
    ['Prune','#581C87'],['Or','#9A6700'],['Ambre','#B45309'],['Menthe','#047857'],['Azur','#0369A1'],['Lavande','#6D28D9'],
    ['Safran','#A16207'],['Nuit','#1E3A8A'],['Marine','#0B3440'],['Océan','#075985'],['Ciel','#0369A1'],['Ardoise','#334155'],
    ['Graphite','#27272A'],['Forêt','#166534'],['Sapin','#065F46'],['Pomme','#3F6212'],['Pistache','#4D7C0F'],['Pêche','#C2410C'],
    ['Abricot','#92400E'],['Terracotta','#9A3412'],['Framboise','#9F1239'],['Mauve','#6D28D9'],['Pervenche','#3730A3'],['Glacier','#155E75'],
    ['Sable','#854D0E'],['Cacao','#451A03'],['Lagune','#0F5257']
  ];

  if(themeSwatches&&!themeSwatches.children.length){
    themeSwatches.innerHTML=palette.map(([name,color])=>
      '<button type="button" class="cf-create-theme-swatch" data-create-theme="'+color+
      '" title="'+name+'" aria-label="Choisir '+name+'" style="--cf-swatch:'+color+'"><span></span></button>'
    ).join('');
  }

  const syncThemeColor=()=>{
    const input=document.getElementById('cfCreateThemeColor');
    const value=document.getElementById('cfCreateThemeColorValue');
    const preview=document.getElementById('cfThemeColorPreview');
    const swatches=document.getElementById('cfCreateThemeSwatches');
    const color=normalizeThemeColor(input?.value||'#C85C0D');
    if(input)input.value=color;
    if(value)value.textContent=color;
    if(preview)preview.style.backgroundColor=color;
    swatches?.querySelectorAll('[data-create-theme]').forEach(b=>{
      b.classList.toggle('is-selected',normalizeThemeColor(b.dataset.createTheme)===color);
    });
    return color;
  };

  // Délégation robuste : la palette reste fonctionnelle même si le formulaire est réinjecté.
  // On évite la capture + stopPropagation systématique, qui pouvait neutraliser
  // d'autres interactions de l'interface. Les éléments sont recherchés à chaque clic.
  const ensureThemeSwatches=()=>{
    const swatches=document.getElementById('cfCreateThemeSwatches');
    if(!swatches)return null;
    if(!swatches.children.length){
      swatches.innerHTML=palette.map(([name,color])=>
        '<button type="button" class="cf-create-theme-swatch" data-create-theme="'+color+
        '" title="'+name+'" aria-label="Choisir '+name+'" style="--cf-swatch:'+color+'"><span></span></button>'
      ).join('');
    }
    return swatches;
  };

  if(!window.__auroreCfThemePickerBound){
    window.__auroreCfThemePickerBound=true;
    const onThemeClick=e=>{
      const toggle=e.target?.closest?.('#cfThemePaletteToggle');
      const swatch=e.target?.closest?.('#cfCreateThemeSwatches [data-create-theme]');
      const paletteEl=document.getElementById('cfCreateThemePalette');
      const input=document.getElementById('cfCreateThemeColor');

      if(toggle){
        e.preventDefault();
        e.stopImmediatePropagation();
        ensureThemeSwatches();
        if(!paletteEl)return;
        paletteEl.hidden=!paletteEl.hidden;
        toggle.setAttribute('aria-expanded',String(!paletteEl.hidden));
        syncThemeColor();
        return;
      }

      if(swatch){
        e.preventDefault();
        e.stopImmediatePropagation();
        const color=normalizeThemeColor(swatch.dataset.createTheme);
        if(input)input.value=color;
        syncThemeColor();
        if(paletteEl)paletteEl.hidden=true;
        document.getElementById('cfThemePaletteToggle')?.setAttribute('aria-expanded','false');
        return;
      }

      if(paletteEl&&!paletteEl.hidden&&!e.target?.closest?.('#cfCreateThemePalette')){
        paletteEl.hidden=true;
        document.getElementById('cfThemePaletteToggle')?.setAttribute('aria-expanded','false');
      }
    };
    document.addEventListener('pointerup',onThemeClick,true);
    document.addEventListener('click',e=>{
      if(e.detail===0)onThemeClick(e);
    },true);
    document.addEventListener('keydown',e=>{
      if(e.key!=='Escape')return;
      const paletteEl=document.getElementById('cfCreateThemePalette');
      if(paletteEl&&!paletteEl.hidden){
        paletteEl.hidden=true;
        document.getElementById('cfThemePaletteToggle')?.setAttribute('aria-expanded','false');
      }
    });
  }

  ensureThemeSwatches();

  themeInput?.addEventListener('input',syncThemeColor);
  themeInput?.addEventListener('change',syncThemeColor);
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
function auroraGeoGebraImageReady(g){
  const path=String(g?.geogebra_image_path||"").trim();
  const source=String(g?.geogebra_image_source||"").toLowerCase();
  if(!path||source!=="geogebra")return false;
  const instrument=auroraGeoGebraInstrument(g);
  if(!instrument)return false;
  const objects=Array.isArray(g?.objects)?g.objects:[];
  const solid=objects.some(o=>["sphere","cylinder","cone","cube","prism","pyramid","tetrahedron"].includes(String(o?.type||"").toLowerCase()));
  if(solid&&Number(g?.geogebra_renderer_version||0)<2)return false;
  return true;
}
function auroraGeoGebraInstrument(g){
  const x=g&&typeof g==="object"?g:{};
  const aliases={"function":"function2d","graph":"function2d","courbe":"function2d","parametric":"parametric2d","parametric2d":"parametric2d","parametric3d":"parametric3d","surface":"surface3d","surface3d":"surface3d","geometry3d":"geometry3d","geometrie3d":"geometry3d","3d":"geometry3d"};
  const raw=String(x.instrument||x.graph_type||"").toLowerCase().trim();
  const normalized=aliases[raw]||raw;
  const objects=Array.isArray(x.objects)?x.objects:[];
  const points2=Array.isArray(x.points)&&x.points.some(p=>Array.isArray(p)&&p.length===2);
  const points3=Array.isArray(x.points)&&x.points.some(p=>Array.isArray(p)&&p.length>=3);
  const poi3=Array.isArray(x.points_of_interest)&&x.points_of_interest.some(p=>Number.isFinite(Number(p?.z)));
  const hasObjects=objects.some(o=>o&&typeof o==="object"&&["point","vector","line","plane","sphere","cylinder","cone","polygon","cube","prism","pyramid","tetrahedron"].includes(String(o?.type||"").toLowerCase()));
  const hasExpression=String(x.expression||"").trim();
  const hasX=String(x.x_expression||"").trim(),hasY=String(x.y_expression||"").trim(),hasZ=String(x.z_expression||"").trim();
  const valid={
    function2d:()=>!!hasExpression||points2||Array.isArray(x.asymptotes)&&x.asymptotes.length>0,
    parametric2d:()=>!!hasX&&!!hasY,
    parametric3d:()=>!!hasX&&!!hasY&&!!hasZ,
    surface3d:()=>!!hasExpression,
    geometry3d:()=>hasObjects||points3||poi3
  };
  if(normalized&&valid[normalized]&&valid[normalized]())return normalized;
  if(raw)return null;
  if(objects.length&&hasObjects)return "geometry3d";
  if(hasZ&&hasX&&hasY)return "parametric3d";
  if(hasX&&hasY)return points3||poi3?"parametric3d":"parametric2d";
  if(hasExpression)return String(x.z_label||"").trim()||points3||poi3?"surface3d":"function2d";
  if(points3||poi3)return "geometry3d";
  if(points2||Array.isArray(x.asymptotes)&&x.asymptotes.length)return "function2d";
  return null;
}
function auroraGeoGebraParameter(raw){
  const t=String(raw||"t").replace(/[^A-Za-z0-9_]/g,"").trim()||"t";
  return /^[xyz]$/i.test(t)?"t":t;
}
function auroraGeoGebraExpr(raw){
  return String(raw||"").trim()
    .replace(/^\s*(?:f\s*\(\s*x\s*\)|y)\s*=\s*/i,"")
    .replace(/×/g,"*").replace(/÷/g,"/").replace(/−/g,"-")
    .replace(/√\s*\(/g,"sqrt(").replace(/\bln\s*\(/gi,"ln(")
    .replace(/\blog\s*\(/gi,"log(");
}
function auroraGeoGebraExpr3D(raw){
  return auroraGeoGebraExpr(raw)
    .replace(/\bpi\b/gi,"pi")
    .replace(/\bsin\s*\(/gi,"sin(").replace(/\bcos\s*\(/gi,"cos(")
    .replace(/\btan\s*\(/gi,"tan(").replace(/\bexp\s*\(/gi,"exp(");
}
function auroraGeoGebraFinite(v,d){
  const n=Number(v);
  return Number.isFinite(n)?n:d;
}
function auroraGeoGebraPoint3(raw){
  if(Array.isArray(raw)&&raw.length>=3){
    const a=raw.slice(0,3).map(Number);
    if(a.every(Number.isFinite))return a;
  }
  if(typeof raw==="string"){
    const m=raw.trim().match(/^[\[\(]\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*[\]\)]$/);
    if(m)return m.slice(1).map(Number);
  }
  return null;
}
function auroraGeoGebraPointCommand(name,raw){
  const p=auroraGeoGebraPoint3(raw);
  return p?{name:String(name||"P"),point:p,command:String(name||"P")+"=("+p.join(",")+")"}:null;
}
function auroraGeoGebraGeometryCommands(g){
  const cmds=[],objects=Array.isArray(g?.objects)?g.objects:[],points=[];
  let seq=1;
  const ensurePoint=(raw,prefix)=>{
    if(typeof raw==="string"&&/^[A-Za-z][A-Za-z0-9_]*$/.test(raw))return raw;
    const p=auroraGeoGebraPoint3(raw);
    if(!p)return null;
    const name=(prefix||"P")+seq++;
    cmds.push(name+"=("+p.join(",")+")");
    return name;
  };
  for(const o of objects){
    if(!o||typeof o!=="object")continue;
    const type=String(o.type||"").toLowerCase();
    const requestedName=(String(o.name||"").match(/^[A-Za-z][A-Za-z0-9_]*$/)||[])[0]||"";
    const reserved=new Set(["Angle","Axes","Bottom","Center","Circle","Cone","Cube","Curve","Cylinder","Distance","Function","Height","Intersect","Line","Midpoint","Plane","Point","Polygon","Prism","Pyramid","Radius","Ray","Segment","Sphere","Surface","Tetrahedron","Top","Vector","Volume"]);
    const safePreferred=requestedName && !reserved.has(requestedName) ? requestedName : "";
    const generatedName=()=>{
      const prefix={point:"P",vector:"u",line:"d",plane:"p",sphere:"sphere",cylinder:"cylinder",cone:"cone",polygon:"poly",cube:"cube",prism:"prism",pyramid:"pyr",tetrahedron:"tetra"}[type]||"obj";
      return prefix+String(seq++);
    };
    // Les noms fournis par le JSON sont éditoriaux. Pour les objets 3D,
    // utiliser systématiquement un nom interne neutre évite toute collision
    // avec les commandes GeoGebra ou avec un point déjà créé (A, B, C…).
    const name=type==="point"&&safePreferred?safePreferred:generatedName();
    if(type==="point"){
      const q=auroraGeoGebraPointCommand(name,o.point||o.points?.[0]||o.coordinates);
      if(q){cmds.push(q.name+"="+q.command.split("=").slice(1).join("="));} 
      continue;
    }
    if(type==="vector"){
      const a=ensurePoint(o.from||o.points?.[0],"A"),b=ensurePoint(o.to||o.points?.[1],"B");
      if(a&&b)cmds.push((name||("u"+seq++))+"=Vector("+a+","+b+")");
      continue;
    }
    if(["line","plane","sphere","cylinder","cone","polygon","cube","prism","pyramid","tetrahedron"].includes(type)){
      const ps=Array.isArray(o.points)?o.points:[];
      if(type==="line"){
        const a=ensurePoint(o.from||ps[0],"A"),b=ensurePoint(o.to||ps[1],"B");
        if(a&&b)cmds.push((name||("d"+seq++))+"=Line("+a+","+b+")");
      }else if(type==="plane"){
        const a=ensurePoint(ps[0],"A"),b=ensurePoint(ps[1],"B"),c=ensurePoint(ps[2],"C");
        if(a&&b&&c)cmds.push((name||("p"+seq++))+"=Plane("+a+","+b+","+c+")");
      }else if(type==="sphere"){
        const a=ensurePoint(o.center||o.from||ps[0],"O"),r=Number(o.radius);
        if(a&&Number.isFinite(r)&&r>0)cmds.push((name||("s"+seq++))+"=Sphere("+a+","+r+")");
      }else if(type==="cube"||type==="prism"||type==="pyramid"||type==="tetrahedron"){
        const refs=ps.map((q)=>ensurePoint(q,"P")).filter(Boolean);
        if(type==="cube"&&refs.length>=2)cmds.push((name||("cube"+seq++))+"=Cube("+refs.slice(0,3).join(",")+")");
        else if(type==="pyramid"&&refs.length>=4)cmds.push((name||("pyr"+seq++))+"=Pyramid("+refs.join(",")+")");
        else if(type==="prism"&&refs.length>=6)cmds.push((name||("prism"+seq++))+"=Prism("+refs.join(",")+")");
        else if(type==="tetrahedron"&&refs.length>=3)cmds.push((name||("tetra"+seq++))+"=Tetrahedron("+refs.slice(0,3).join(",")+")");
        else if((type==="cube"||type==="tetrahedron")&&refs.length>=2)cmds.push((name||("solid"+seq++))+"="+(type==="cube"?"Cube":"Tetrahedron")+"("+refs.slice(0,2).join(",")+")");
        else if((type==="pyramid"||type==="prism")&&refs.length>=2&&Number.isFinite(Number(o.height))&&Number(o.height)>0){
          const polyName=type+"Base"+seq++;
          if(refs.length>=3)cmds.push(polyName+"=Polygon("+refs.slice(0,Math.min(refs.length,6)).join(",")+")",(name||type)+seq+"="+(type==="pyramid"?"Pyramid":"Prism")+"("+polyName+","+Number(o.height)+")");
        }
      }else if(type==="cylinder"||type==="cone"){
        const r=Number(o.radius);
        let a=ensurePoint(o.from||ps[0],"A"),b=ensurePoint(o.to||ps[1],"B");
        // Aurora peut décrire un solide de révolution avec un seul point de
        // base + une hauteur. Dans ce cas, l'axe est l'axe Oz.
        if(a&& !b && Number.isFinite(Number(o.height)) && Number(o.height)>0){
          const baseRaw=o.from||ps[0];
          const base=auroraGeoGebraPoint3(baseRaw);
          if(base){
            const top=[base[0],base[1],base[2]+Number(o.height)];
            b=ensurePoint(top,"B");
          }
        }
        if(a&&b&&Number.isFinite(r)&&r>0)cmds.push((name||("s"+seq++))+"="+(type==="cylinder"?"Cylinder":"Cone")+"("+a+","+b+","+r+")");
      }else if(type==="polygon"){
        const refs=ps.map((q)=>ensurePoint(q,"P")).filter(Boolean);
        if(refs.length>=3)cmds.push((name||("poly"+seq++))+"=Polygon("+refs.join(",")+")");
      }
    }
  }
  return cmds;
}
function auroraGeoGebraCommandes(g){
  const instrument=auroraGeoGebraInstrument(g);
  const cmds=[];
  const xmin=auroraGeoGebraFinite(g?.x_min,-10),xmax=auroraGeoGebraFinite(g?.x_max,10);
  const ymin=auroraGeoGebraFinite(g?.y_min,-10),ymax=auroraGeoGebraFinite(g?.y_max,10);
  if(instrument==="parametric2d"){
    const x=auroraGeoGebraExpr3D(g?.x_expression||""),y=auroraGeoGebraExpr3D(g?.y_expression||""),t=auroraGeoGebraParameter(g?.parameter);
    const tmin=auroraGeoGebraFinite(g?.t_min,0),tmax=auroraGeoGebraFinite(g?.t_max,2*Math.PI);
    if(x&&y&&tmax>tmin)cmds.push("Curve("+x+","+y+","+t+","+tmin+","+tmax+")");
  }else if(instrument==="parametric3d"){
    const x=auroraGeoGebraExpr3D(g?.x_expression||""),y=auroraGeoGebraExpr3D(g?.y_expression||""),z=auroraGeoGebraExpr3D(g?.z_expression||""),t=auroraGeoGebraParameter(g?.parameter);
    const tmin=auroraGeoGebraFinite(g?.t_min,0),tmax=auroraGeoGebraFinite(g?.t_max,2*Math.PI);
    if(x&&y&&z&&tmax>tmin)cmds.push("Curve("+x+","+y+","+z+","+t+","+tmin+","+tmax+")");
  }else if(instrument==="surface3d"){
    const expr=auroraGeoGebraExpr3D(g?.expression||"");
    if(expr)cmds.push("f(x,y)="+expr);
  }else if(instrument==="geometry3d"){
    cmds.push(...auroraGeoGebraGeometryCommands(g));
  }else{
    const expr=auroraGeoGebraExpr(g?.expression||"");
    if(expr)cmds.push("f(x)="+expr);
  }
  if(instrument==="function2d"||instrument==="parametric2d"){
    if(xmax>xmin&&ymax>ymin){
      const xr=Math.max(Math.abs(xmin),Math.abs(xmax),1),yr=Math.max(Math.abs(ymin),Math.abs(ymax),1);
      cmds.push("SetCoordSystem("+[-xr,xr,-yr,yr].join(",")+")");
    }
    cmds.push("O=(0,0)","I=(1,0)","J=(0,1)");
    cmds.push("SetLabelVisible(O,true)","SetLabelVisible(I,true)","SetLabelVisible(J,true)");
    cmds.push('SetCaption(O,"O")','SetCaption(I,"I")','SetCaption(J,"J")');
    for(const p of Array.isArray(g?.points)?g.points:[]){
      const q=Array.isArray(p)?p.slice(0,2).map(Number):null;
      if(q&&q.length===2&&q.every(Number.isFinite))cmds.push("P"+cmds.length+"=("+q.join(",")+")");
    }
    for(const p of Array.isArray(g?.points_of_interest)?g.points_of_interest:[]){
      const x=Number(p?.x),y=Number(p?.y);
      if(Number.isFinite(x)&&Number.isFinite(y)){
        const n="P"+cmds.length;cmds.push(n+"=("+x+","+y+")","SetLabelVisible("+n+",true)");
        if(p?.label)cmds.push("SetCaption("+n+",\""+String(p.label).replace(/["\\]/g,"").slice(0,40)+"\")");
      }
    }
    for(const a of Array.isArray(g?.asymptotes)?g.asymptotes:[]){
      const v=Number(a?.value);if(!Number.isFinite(v))continue;
      if(a.type==="vertical")cmds.push("a"+cmds.length+"=x="+v);
      if(a.type==="horizontal")cmds.push("a"+cmds.length+"=y="+v);
    }
  }else{
    for(const p of Array.isArray(g?.points_of_interest)?g.points_of_interest:[]){
      const x=Number(p?.x),y=Number(p?.y),z=Number(p?.z);
      if(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z)){
        const n="P"+cmds.length;cmds.push(n+"=("+x+","+y+","+z+")","SetLabelVisible("+n+",true)");
        if(p?.label)cmds.push("SetCaption("+n+",\""+String(p.label).replace(/["\\]/g,"").slice(0,40)+"\")");
      }
    }
    // The 3D view is configured through the GeoGebra API in appletOnLoad.
    // Do not inject the 2D SetCoordSystem command into the 3D command queue:
    // depending on the GeoGebra app/version it can be rejected and obscure
    // the real construction errors.
  }
  return cmds;
}
async function auroraGeoGebraExportOne(graph){
  await auroraGeoGebraScriptReady();
  const host=document.createElement('div');
  // GeoGebra recommande l'injection dans un conteneur DOM identifié.
  // Le conteneur reste rendu mais ne capte aucun clic de l'interface.
  const hostId='aurora-ggb-export-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  host.id=hostId;
  const instrument=auroraGeoGebraInstrument(graph);
  if(!instrument)throw new Error('Cet élément ne contient aucune construction GeoGebra exploitable. Il est conservé comme image/illustration et ne doit pas être traité comme un graphique.');
  const is3D=['parametric3d','surface3d','geometry3d'].includes(instrument);
  const width=1400,height=is3D?900:820;
  // Le conteneur doit avoir une vraie surface de rendu. Un div de taille nulle
  // peut laisser l'applet initialisée mais empêcher Canvas/WebGL de finaliser
  // correctement la construction.
  host.style.cssText='position:fixed;left:-1600px;top:0;width:'+width+'px;height:'+height+'px;opacity:1;visibility:visible;pointer-events:none;z-index:1;background:#fff;overflow:hidden;';
  document.body.appendChild(host);
  return await new Promise((resolve,reject)=>{
    let finished=false;
    let appletLoaded=false;
    const done=(fn,v)=>{if(finished)return;finished=true;try{api?.remove?.()}catch(_){}host.remove();fn(v);};
    let api=null;
    const timer=setTimeout(()=>done(reject,new Error(appletLoaded
      ? 'GeoGebra a initialisé l’applet mais n’a pas terminé la construction du graphique.'
      : 'GeoGebra n’a pas terminé l’initialisation de l’applet.')),30000);
    const params={
      id:hostId,appName:is3D?'3d':'graphing',width:1400,height:is3D?900:820,showToolBar:false,showAlgebraInput:false,
      showMenuBar:false,showResetIcon:false,showFullscreenButton:false,showZoomButtons:false,
      showSuggestionButtons:false,language:'fr',
      appletOnLoad:function(a){
        api=a;
        appletLoaded=true;
        try{
          // getPNGBase64() exports the active graphics view. Select the
          // intended view explicitly so a 3D construction can never be
          // captured from Graphics View 1.
          try{a.evalCommand('SetActiveView('+(is3D?-1:1)+')')}catch(_){}
          const xmin0=Number(graph?.x_min),xmax0=Number(graph?.x_max),ymin0=Number(graph?.y_min),ymax0=Number(graph?.y_max);
          if(is3D){
            const zmin0=Number(graph?.z_min),zmax0=Number(graph?.z_max);
            if([xmin0,xmax0,ymin0,ymax0,zmin0,zmax0].every(Number.isFinite)&&xmax0>xmin0&&ymax0>ymin0&&zmax0>zmin0){
              a.setCoordSystem(xmin0,xmax0,ymin0,ymax0,zmin0,zmax0,true);
            }
            try{a.setAxesVisible(3,true,true,true)}catch(_){}
            try{a.setGridVisible(3,true)}catch(_){}
            try{a.setAxisLabels(3,'x','y','z')}catch(_){}
            try{a.setAxisSteps(3,1,1,1,0)}catch(_){}
          }else{
            if([xmin0,xmax0,ymin0,ymax0].every(Number.isFinite)&&xmax0>xmin0&&ymax0>ymin0){
              const xr=Math.max(Math.abs(xmin0),Math.abs(xmax0),1),yr=Math.max(Math.abs(ymin0),Math.abs(ymax0),1);
              a.setCoordSystem(-xr,xr,-yr,yr);
            }
            a.setAxesVisible(true,true);
            a.setGridVisible(true);
            try{a.setAxisSteps(1,1,1,0)}catch(_){}
            try{a.setAxisLabels(1,'x','y','')}catch(_){}
          }
          const commands=auroraGeoGebraCommandes(graph);
          const commandErrors=[];
          const primaryCommands=[];
          const primaryLabels=[];
          const isPrimaryConstructionCommand=command=>{
            const s=String(command||'').trim();
            return /^(?:[A-Za-z][A-Za-z0-9_]*=)?(?:Curve|Sphere|Cylinder|Cone|Cube|Prism|Pyramid|Tetrahedron|Polygon|Line|Plane|Vector)\s*\(/i.test(s)
              || /^f\s*\(\s*x(?:\s*,\s*y)?\s*\)\s*=/.test(s)
              || (instrument==="geometry3d" && /^(?:[A-Za-z][A-Za-z0-9_]*=)?\s*\(/.test(s));
          };

          for(const command of commands){
            try{
              const text=String(command||'').trim();
              const primary=isPrimaryConstructionCommand(text);
              let ok=true;
              let labels='';
              if(typeof a.evalCommandGetLabels==='function'){
                const before=typeof a.getObjectNumber==='function'?Number(a.getObjectNumber()):0;
                labels=String(a.evalCommandGetLabels(text)||'').trim();
                const after=typeof a.getObjectNumber==='function'?Number(a.getObjectNumber()):before;
                if(primary){
                  // Certains objets 3D peuvent être créés correctement sans que
                  // evalCommandGetLabels() renvoie un label exploitable. Dans ce
                  // cas, l'augmentation du nombre d'objets est une preuve plus
                  // fiable que le label retourné par l'API.
                  if(labels){
                    labels.split(',').map(s=>s.trim()).filter(Boolean).forEach(label=>primaryLabels.push(label));
                  }else if(after<=before){
                    ok=false;
                    commandErrors.push({command:text,error:'GeoGebra n’a créé aucun objet pour cette construction.'});
                  }
                }
              }else{
                const before=typeof a.getObjectNumber==='function'?Number(a.getObjectNumber()):0;
                ok=a.evalCommand(text)===true;
                const after=typeof a.getObjectNumber==='function'?Number(a.getObjectNumber()):before;
                if(primary&&(!ok||after<=before)){
                  ok=false;
                  commandErrors.push({command:text,error:'GeoGebra a refusé la construction ou n’a créé aucun nouvel objet.'});
                }
              }
              if(primary){
                primaryCommands.push(text);
                if(ok)console.info('[Aurora][GeoGebra export] construction créée',text,labels||'');
              }
              if(!ok)console.warn('[Aurora][GeoGebra export] commande refusée',text);
            }
            catch(e){
              commandErrors.push({command:String(command||''),error:String(e)});
              console.warn('[Aurora][GeoGebra export]',command,e);
            }
          }

          // Do not export a repère-only image. The validation below checks the
          // actual objects created by the graph construction, not helper points.
          if(!primaryCommands.length){
            clearTimeout(timer);
            const graphTitle=String(graph?.title||"Graphique sans titre");
            const objectTypes=Array.isArray(graph?.objects)
              ? graph.objects.map(o=>String(o?.type||"inconnu")).filter(Boolean).join(", ")
              : "";
            const commandPreview=commands.map(String).slice(0,12).join(" | ");
            done(reject,new Error(
              'GeoGebra n’a reçu aucune commande de construction exploitable.'
              +' Graphique: '+graphTitle+'.'
              +' Instrument: '+instrument+'.'
              +(objectTypes?' Types: '+objectTypes+'.':'')
              +(commandPreview?' Commandes générées: '+commandPreview+'.':' Aucune commande n’a été générée.')
            ));
            return;
          }

          let attempts=0;
          const waitForObjects=()=>{
            attempts++;
            let objectCount=0;
            try{objectCount=typeof a.getObjectNumber==='function'?Number(a.getObjectNumber()):0}catch(_){}
            let missing=[];
            if(primaryLabels.length&&typeof a.exists==='function'){
              missing=primaryLabels.filter(label=>{
                try{return !a.exists(label)}catch(_){return true}
              });
            }else if(!primaryLabels.length){
              const expected=primaryCommands.length;
              if(objectCount<expected)missing=primaryCommands.slice(0,expected);
            }

            if(!missing.length&&commandErrors.filter(x=>primaryCommands.includes(x.command)).length===0){
              // Force the real graphics view to repaint before capture. The
              // construction can exist in GeoGebra's model while its canvas
              // still shows only the coordinate system after a hidden/offscreen
              // applet initialization.
              try{if(typeof a.setRepaintingActive==='function')a.setRepaintingActive(true)}catch(_){}
              try{if(typeof a.recalculateEnvironments==='function')a.recalculateEnvironments()}catch(_){}
              try{if(typeof a.refreshViews==='function')a.refreshViews()}catch(_){}
              try{if(is3D&&typeof a.showAllObjects==='function')a.showAllObjects()}catch(_){}
              try{a.evalCommand('SetActiveView('+(is3D?-1:1)+')')}catch(_){}
              for(const label of primaryLabels){
                try{if(typeof a.exists==='function'&&a.exists(label)&&typeof a.setVisible==='function')a.setVisible(label,true)}catch(_){}
              }
              setTimeout(()=>{
                try{
                  if(typeof a.getPNGBase64!=='function')throw new Error('L’export PNG GeoGebra n’est pas disponible.');
                  const b64=a.getPNGBase64(2,false,144);
                  if(!b64)throw new Error('GeoGebra a renvoyé une image vide.');
                  clearTimeout(timer);
                  done(resolve,String(b64).replace(/^data:image\/png;base64,/i,''));
                }catch(e){clearTimeout(timer);done(reject,e instanceof Error?e:new Error(String(e)))}
              },1800);
              return;
            }

            if(attempts<30){setTimeout(waitForObjects,300);return;}
            clearTimeout(timer);
            const rejected=commandErrors.filter(x=>primaryCommands.includes(x.command));
            const details=(rejected.length?rejected:commandErrors).length
              ? ' Commandes problématiques: '+(rejected.length?rejected:commandErrors).map(x=>x.command).join(' | ')
              : '';
            done(reject,new Error(
              'GeoGebra a affiché le repère mais n’a pas construit les objets graphiques demandés.'
              +' Graphique: '+String(graph?.title||"Graphique sans titre")+'.'
              +' Instrument: '+instrument+'. Objets détectés: '+objectCount+'.'
              +' Constructions attendues: '+primaryCommands.length+'.'
              +' Objets manquants: '+missing.join(', ')+'.'+details
            ));
          };
          waitForObjects()
        }catch(e){clearTimeout(timer);done(reject,e instanceof Error?e:new Error(String(e)))}
      }
    };
    try{
      const applet=new GGBApplet(params,true);
      const inject=()=>applet.inject(hostId);
      if(document.readyState==='loading')window.addEventListener('load',inject,{once:true});
      else requestAnimationFrame(()=>requestAnimationFrame(inject));
    }catch(e){clearTimeout(timer);done(reject,e instanceof Error?e:new Error(String(e)))}
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
function ensureLiveCancelButton(id,renderButton){
  if(!renderButton)return null;
  const host=renderButton.parentElement;
  if(!host)return null;
  let cancel=host.querySelector('[data-cf-cancel="'+CSS.escape(String(id))+'"]');
  if(!cancel){
    cancel=document.createElement('button');
    cancel.type='button';
    cancel.className='admin-btn danger cf-pdf-cancel-static';
    cancel.dataset.cfCancel=String(id);
    cancel.textContent='Annuler la génération';
    cancel.title='Annuler cette génération PDF';
    host.insertBefore(cancel,renderButton.nextSibling);
  }
  cancel.disabled=false;
  cancel.textContent='Annuler la génération';
  return cancel;
}
async function renderPdf(id,themeColor=null){
  const b=document.querySelector(`[data-cf-render="${id}"]`);
  if(b){b.disabled=true;b.textContent=b.dataset.hasPdf==='1'?'Régénération LuaLaTeX…':'Génération LuaLaTeX…';ensureLiveCancelButton(id,b)}
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
    const productionAttempt=await startProductionAttempt(id,accessToken);
    if(b)b.textContent='Préparation de la nouvelle identité Aurore…';

    // GeoGebra est optionnel : un document sans graphique va directement
    // vers la file LuaLaTeX sans initialiser ni exécuter GeoGebra.
    const graphSource=await fetch(
      SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(Number(id))+'&select=id,content_json',
      {cache:'no-store',headers:{'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+accessToken}}
    );
    const graphSourceText=await graphSource.text();
    if(!graphSource.ok)throw new Error('Lecture du contenu graphique impossible (HTTP '+graphSource.status+').');
    let graphSourceRows=[];
    try{graphSourceRows=graphSourceText?JSON.parse(graphSourceText):[]}catch(_){graphSourceRows=[]}
    const documentContent=Array.isArray(graphSourceRows)&&graphSourceRows[0]?.content_json&&typeof graphSourceRows[0].content_json==='object'
      ?graphSourceRows[0].content_json:{};
    const documentGraphs=[];
    for(const section of Array.isArray(documentContent.sections)?documentContent.sections:[])
      if(Array.isArray(section?.graphs))documentGraphs.push(...section.graphs);
    const renderableGraphs=documentGraphs.filter(g=>!!auroraGeoGebraInstrument(g));
    const declaredGraphCount=renderableGraphs.length;
    let graphCount=0;
    if(declaredGraphCount>0){
      if(b)b.textContent='Préparation de '+declaredGraphCount+' graphique'+(declaredGraphCount>1?'s':'')+'…';
      graphCount=await auroraConstruireEtImporterGraphiquesGeoGebra(id,b,accessToken);
    }else if(b){
      b.textContent='Aucun graphique à préparer — mise en file LuaLaTeX…';
    }
    if(b)b.textContent=graphCount
      ?'Mise en file LuaLaTeX avec '+graphCount+' graphique'+(graphCount>1?'s':'')+' GeoGebra…'
      :'Mise en file LuaLaTeX…';

    await setGeneratedProductionState(id,'queued',accessToken,{production_attempt_started_at:new Date().toISOString(),production_attempt_id:productionAttempt?.id||null,production_attempt_no:productionAttempt?.attempt_no||null});
    await updateProductionAttemptFromDocument(id,'queued',accessToken,{production_started_at:new Date().toISOString()});
    setProgress(12,'Document envoyé au moteur LuaLaTeX…');

    const request=await adminInventoryFetch(`${SUPABASE_URL}/functions/v1/aurora-lualatex-request`,{
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
    let lastProgress=18;
    let completed=null;
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    while(Date.now()<foregroundDeadline){
      if(document.visibilityState==='hidden'){
        setProgress(lastProgress,`Rendu en arrière-plan · progression serveur ${lastProgress.toFixed(2)}%`);
        await new Promise(resolve=>{
          const resume=()=>{document.removeEventListener('visibilitychange',resume);resolve();};
          document.addEventListener('visibilitychange',resume,{once:true});
        });
        continue;
      }
      const q=await adminInventoryFetch(`${SUPABASE_URL}/rest/v1/aurora_generated_documents?id=eq.${encodeURIComponent(Number(id))}&select=id,pdf_url,pdf_path,metadata,status,updated_at`,{cache:'no-store',headers:{'Authorization':`Bearer ${accessToken}`}});
      const qt=await q.text();
      if(!q.ok)throw new Error(`Lecture de l'état LuaLaTeX impossible (HTTP ${q.status}). Le rendu serveur continue en arrière-plan.`);
      let rows=[];
      try{rows=qt?JSON.parse(qt):[]}catch(_){throw new Error('Réponse Supabase invalide pendant le suivi du rendu.');}
      const row=Array.isArray(rows)?rows[0]:null;
      if(!row)throw new Error('Document introuvable pendant le suivi du rendu.');
      const m=row.metadata&&typeof row.metadata==='object'?row.metadata:{};
      if(row.pdf_url&&m.lualatex_status==='completed'){completed=row;break}
      if(m.lualatex_status==='failed')throw new Error('Le rendu LuaLaTeX a échoué. Consulte les journaux GitHub Actions.');
      const meta=row.metadata&&typeof row.metadata==='object'?row.metadata:{};
      const realProgress=Number.isFinite(Number(meta.lualatex_progress))?Math.max(0,Math.min(100,Number(meta.lualatex_progress))):18;
      const realStage=String(meta.lualatex_stage||'Rendu LuaLaTeX en cours');
      lastProgress=realProgress;
      setProgress(realProgress,`${realStage} · ${realProgress.toFixed(2)}%`);
      await wait(5000);
    }
    if(!completed){
      setProgress(lastProgress,'Rendu en arrière-plan — la progression serveur continue automatiquement.');
      if(b)b.textContent='LuaLaTeX continue en arrière-plan…';
      await charger();
      surveillerRenduArrierePlan(id,accessToken,b);
      return;
    }
    await setGeneratedProductionState(id,'pdf_ready',accessToken,{production_completed_at:new Date().toISOString()});
    await updateProductionAttemptFromDocument(id,'pdf_ready',accessToken,{pdf_url:completed?.pdf_url||null,pdf_path:completed?.pdf_path||null});
    setProgress(100,'PDF LuaLaTeX généré et enregistré.');
    if(b)b.textContent='PDF LuaLaTeX prêt';
    try{await charger();}catch(refreshError){console.warn('[Content Factory] PDF généré mais actualisation de la liste impossible:',refreshError);}
    setTimeout(()=>setProgress(0,'Prêt pour une nouvelle génération.'),1200);
    alert(graphCount?`PDF LuaLaTeX généré avec ${graphCount} graphique${graphCount>1?'s':''} GeoGebra.`:'PDF LuaLaTeX généré et enregistré.');
  }catch(e){
    const wasCancelled=window.__aurorePdfCancelRequested?.has(Number(id));
    if(wasCancelled){
      try{await setGeneratedProductionState(id,'cancelled',session?.access_token||null,{production_cancelled_at:new Date().toISOString()});await updateProductionAttemptFromDocument(id,'cancelled',session?.access_token||null,{})}catch(stateError){console.warn('[Content Factory] état annulé:',stateError)}
      setProgress(100,'Génération annulée par l’administration.');
      await charger();
    }else{
      try{await setGeneratedProductionState(id,'failed',session?.access_token||null,{production_failed_at:new Date().toISOString(),production_last_error:String(e?.message||e)});await updateProductionAttemptFromDocument(id,'failed',session?.access_token||null,{error_message:String(e?.message||e)})}catch(stateError){console.warn('[Content Factory] état échec:',stateError)}
      alert('Le PDF n’a pas pu être généré. '+(e.message||e));
      await charger();
    }
  }finally{
    if(b){b.disabled=false;b.textContent=b.dataset.hasPdf==='1'?'Régénérer le PDF':'Générer le PDF'}
  }
}

const cfAdminCardStyles=document.createElement('style');
cfAdminCardStyles.id='cf-admin-card-enhancements';
cfAdminCardStyles.textContent=`.cf-admin-card-large{position:relative;padding:20px!important;border-radius:22px!important;border-top:4px solid var(--cf-document-theme,#C85C0D)!important;box-shadow:0 12px 30px rgba(0,0,0,.07)}.cf-admin-icon-large{width:58px!important;height:58px!important;border-radius:16px!important;font-size:.72rem!important;background:var(--cf-document-theme,#C85C0D)!important;color:#fff!important}.cf-admin-kicker{font-size:.65rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;opacity:.62;margin-bottom:4px}.cf-admin-meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}.cf-admin-meta-grid span{padding:8px 10px;border:1px solid var(--bordure,rgba(0,0,0,.1));border-radius:11px;background:var(--fond,#fafafa)}.cf-admin-meta-grid strong{display:block;font-size:.61rem;opacity:.62;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}.cf-admin-section-label{margin-top:14px;font-size:.65rem;font-weight:900;text-transform:uppercase;letter-spacing:.06em;opacity:.62}.cf-admin-classification{margin-top:5px;padding:11px 12px;border-radius:13px;background:color-mix(in srgb,var(--cf-document-theme,#C85C0D) 7%,var(--fond,#fafafa));border:1px solid color-mix(in srgb,var(--cf-document-theme,#C85C0D) 18%,var(--bordure,rgba(0,0,0,.1)));line-height:1.55;font-size:.72rem}.cf-admin-theme-row{display:flex;align-items:center;gap:9px;margin-top:12px;padding:10px;border:1px solid var(--bordure,rgba(0,0,0,.1));border-radius:13px}.cf-admin-theme-row span:nth-child(2){flex:1}.cf-admin-theme-row small{display:block;opacity:.62;font-size:.62rem;margin-top:2px}.cf-admin-theme-dot{width:24px;height:24px;border-radius:8px;flex:0 0 24px;box-shadow:0 0 0 1px rgba(0,0,0,.16)}.cf-admin-generation-state{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(180,120,0,.08);font-size:.7rem}.cf-admin-note{margin-top:10px;padding:10px 12px;border-radius:12px;background:var(--fond,#fafafa);font-size:.7rem}.cf-admin-actions-stable{min-height:42px;align-items:center}.cf-admin-actions-stable .admin-btn{transition:none}.cf-pdf-cancel-static{min-width:155px}.cf-pdf-cancel-static:disabled{opacity:.8;cursor:wait}@media(max-width:620px){.cf-admin-card-large{padding:15px!important}.cf-admin-meta-grid{grid-template-columns:1fr}.cf-admin-theme-row{align-items:flex-start;flex-wrap:wrap}.cf-admin-theme-row .admin-btn{width:100%}.cf-admin-actions-stable{display:grid!important;grid-template-columns:1fr}.cf-admin-actions-stable .admin-btn,.cf-admin-actions-stable a{width:100%;justify-content:center}}`;
document.head.appendChild(cfAdminCardStyles);
async function cancelPdfGeneration(id){
  window.__aurorePdfCancelRequested=window.__aurorePdfCancelRequested||new Set();
  const numericId=Number(id), selector='[data-cf-cancel="'+CSS.escape(String(numericId))+'"]';
  const keep=()=>document.querySelectorAll(selector).forEach(b=>{b.disabled=true;b.textContent='Annulation demandée…';b.dataset.cancelState='requested';b.setAttribute('aria-busy','true')});
  if(!confirm('Annuler la génération PDF de ce document ?\\n\\nLa demande sera transmise à Aurore. Le bouton restera visible jusqu’à la fin réelle de la génération.'))return;
  keep();
  try{
    window.__aurorePdfCancelRequested.add(numericId);
    await rpc('aurora_cancel_pdf_generation',{p_generated_document_id:numericId});
    const wait=ms=>new Promise(r=>setTimeout(r,ms)); const deadline=Date.now()+240000; let done=false;
    while(Date.now()<deadline){
      try{
        const r=await adminInventoryFetch(SUPABASE_URL+'/rest/v1/aurora_generated_documents?id=eq.'+encodeURIComponent(numericId)+'&select=id,status,pdf_url,metadata,updated_at',{cache:'no-store'});
        const t=await r.text(), a=t?JSON.parse(t):[], row=Array.isArray(a)?a[0]:null, m=row?.metadata&&typeof row.metadata==='object'?row.metadata:{};
        if(!['queued','processing'].includes(m.lualatex_status)&&m.lualatex_cancel_requested!==true){done=true;break}
      }catch(_){}
      keep(); await wait(3000);
    }
    if(done){window.__aurorePdfCancelRequested.delete(numericId);await charger()}
    else{keep();const msg=document.getElementById('cfCreateMsg');if(msg)msg.textContent='Annulation demandée. La production termine son arrêt côté serveur.'}
  }catch(e){
    window.__aurorePdfCancelRequested.delete(numericId);
    document.querySelectorAll(selector).forEach(b=>{b.disabled=false;b.textContent='Annuler la génération';b.dataset.cancelState='active';b.removeAttribute('aria-busy')});
    alert('Annulation impossible. '+(e.message||e))
  }
}
async function changeDocumentTheme(id,currentColor){
  const color=await chooseRegenerationTheme(currentColor);
  if(!color)return;
  try{
    const token=await cfFreshToken();
    await persistGeneratedDocumentTheme(id,color,token);
    const row=rows.find(x=>Number(x.id)===Number(id));
    const hasPdf=!!row?.pdf_url;
    await charger();
    if(hasPdf && confirm('Couleur enregistrée. Veux-tu régénérer maintenant le PDF pour appliquer cette nouvelle couleur ?')){
      await handlePdfAction({action:'render',id:Number(id),hasPdf:true,themeColor:color});
    }else{
      alert('Couleur enregistrée. Elle sera utilisée lors de la prochaine génération du PDF.');
    }
  }catch(e){alert('Changement de couleur impossible. '+(e.message||e))}
}
// API publique minimale pour la page dédiée « Documents en attente ».
// Elle réutilise exactement le moteur PDF/validation du Content Factory,
// sans dupliquer le circuit de production.
window.auroreAdminGeneratedActions={
  render: async (id,themeColor)=>renderPdf(Number(id),themeColor||null),
  changeTheme: async (id,currentColor)=>changeDocumentTheme(Number(id),currentColor),
  validate: async id=>validateDoc(Number(id)),
  reject: async id=>rejectDoc(Number(id)),
  publish: async id=>publishDoc(Number(id))
};
async function validateDoc(id){const n=prompt('Note de validation (facultatif) :','');if(n===null)return;try{await rpc('aurora_validate_generated_document',{p_generated_document_id:Number(id),p_notes:n||null});await charger()}catch(e){alert('Validation impossible. '+(e.message||e))}}
async function rejectDoc(id){const n=prompt('Motif du rejet / corrections demandées :','');if(n===null)return;if(!n.trim()){alert('Indique un motif pour rejeter le document.');return}try{await rpc('aurora_reject_generated_document',{p_generated_document_id:Number(id),p_notes:n.trim()});await charger()}catch(e){alert('Rejet impossible. '+(e.message||e))}}
async function publishDoc(id){if(!confirm('Publier ce document dans la bibliothèque publique Aurore ?\n\nCette action crée un document publié à partir du PDF validé.'))return;const n=prompt('Note de publication (facultatif) :','');if(n===null)return;try{await rpc('aurora_publish_generated_document',{p_generated_document_id:Number(id),p_notes:n||null});await charger();alert('Document publié dans la bibliothèque Aurore.')}catch(e){alert('Publication impossible. '+(e.message||e))}}
function apply(){
  const q=(document.getElementById('adminSearchContentFactory')?.value||'').trim().toLowerCase(),
        st=document.getElementById('adminFilterContentFactory')?.value||'',
        sort=document.getElementById('adminSortContentFactory')?.value||'recent';
  let a=rows.filter(x=>(!st||x.status===st)&&(!q||[x.title,x.subject,x.matiere,x.level,x.class_name,x.document_type,x.domaine,x.formation,x.specialite,x.annee,x.semestre,x.filiere,x.status,x.job_id].filter(Boolean).join(' ').toLowerCase().includes(q)));
  a.sort((x,y)=>{
    if(sort==='az')return String(x.title).localeCompare(String(y.title),'fr');
    if(sort==='za')return String(y.title).localeCompare(String(x.title),'fr');
    const ax=new Date(x.created_at).getTime(),ay=new Date(y.created_at).getTime();
    return sort==='oldest'?ax-ay:ay-ax
  });
  if(!a.length){list.innerHTML='<div class="admin-empty">Aucun document ou demande éditoriale pour ces critères.</div>';return}
  list.innerHTML=a.map(x=>{
    if(x.contentJob){
      const m=x.metadata&&typeof x.metadata==='object'?x.metadata:{};
      const theme=normalizeThemeColor(m.theme_color||m.aurore_design?.theme_color||x.theme_color||'#C85C0D');
      const classification=[x.matiere||x.subject,x.class_name,x.level,x.filiere].filter(Boolean).join(' · ');
      const status=String(x.job_status||x.status||'').toLowerCase();
      const stage=status==='queued'
        ?'En file : la demande attend l’éditeur ChatGPT. Aucun PDF n’est encore produit.'
        :status==='processing'
          ?'Traitement éditorial en cours.'
          :status==='review'
            ?'Contenu reçu : contrôle humain requis avant le rendu PDF.'
            :'Demande éditoriale enregistrée.';
      const confirm=status==='draft'
        ?'<button type="button" class="admin-btn primary" data-cf-confirm-job="'+esc(x.job_id)+'">Choisir la couleur et lancer la production</button>'
        :'';
      return `<article class="cf-admin-card cf-admin-card-large cf-admin-editorial-request" data-content-job-id="${esc(x.job_id)}" style="--cf-document-theme:${esc(theme)}">
        <div class="cf-admin-icon cf-admin-icon-large">IA</div>
        <div class="cf-admin-body">
          <div class="cf-admin-kicker">Demande éditoriale · Job #${esc(x.job_id)}</div>
          <div class="cf-admin-title">${esc(x.title||'Nouvelle demande')}</div>
          <div class="cf-admin-meta cf-admin-meta-grid">
            <span><strong>Statut</strong> ${esc(sl(status))}</span>
            ${x.document_type?'<span><strong>Type</strong> '+esc(x.document_type)+'</span>':''}
            <span><strong>Origine</strong> Content Factory</span>
            <span><strong>Créé</strong> ${esc(new Date(x.created_at).toLocaleString('fr-FR'))}</span>
            ${x.updated_at?'<span><strong>Modifié</strong> '+esc(new Date(x.updated_at).toLocaleString('fr-FR'))+'</span>':''}
          </div>
          <div class="cf-admin-section-label">Classement enregistré</div>
          <div class="cf-admin-classification">${esc(classification||'Aucune classification détaillée enregistrée.')}</div>
          <div class="cf-admin-theme-row">
            <span class="cf-admin-theme-dot" style="background:${esc(theme)}"></span>
            <span><strong>Couleur du document</strong><small>${esc(theme)}</small></span>
          </div>
          <div class="cf-admin-generation-state"><strong>Production :</strong> ${esc(stage)}</div>
          ${x.validation_notes?'<div class="cf-admin-note"><strong>Message :</strong> '+esc(x.validation_notes)+'</div>':''}
          <div class="cf-admin-actions cf-admin-actions-stable">${confirm}</div>
        </div>
      </article>`;
    }
    const m=x.metadata&&typeof x.metadata==='object'?x.metadata:{};
    const pdf=!!x.pdf_url;
    const active=['queued','processing'].includes(m.lualatex_status);
    const cancelRequested=m.lualatex_cancel_requested===true;
    const canRender=['generated','review','approved','failed'].includes(x.status)&&!active;
    const canValidate=x.status==='review'&&pdf&&!active;
    const canReject=['review','approved'].includes(x.status)&&!active;
    const canPublish=['approved','review'].includes(x.status)&&pdf&&!active;
    const theme=documentThemeColor(m)||x.theme_color||'#C85C0D';
    const classification=[x.domaine,x.formation,x.specialite,x.annee,x.semestre,x.filiere,x.matiere||x.subject,x.class_name,x.level].filter(Boolean).join(' · ');
    const stage=m.lualatex_stage||m.lualatex_status||'';
    const origin=m.origin||m.source||m.producer||'';
    const actionBusy=active||cancelRequested;
    return `<article class="cf-admin-card cf-admin-card-large" data-generated-document-id="${esc(x.id)}" style="--cf-document-theme:${esc(theme)}">
      <div class="cf-admin-icon cf-admin-icon-large">PDF</div>
      <div class="cf-admin-body">
        <div class="cf-admin-kicker">Document IA · #${esc(x.id)}</div>
        <div class="cf-admin-title">${esc(x.title||'Sans titre')}</div>
        <div class="cf-admin-meta cf-admin-meta-grid">
          <span><strong>Statut</strong> ${esc(sl(x.status))}${pdf?' · PDF prêt':''}</span>
          ${x.version?'<span><strong>Version</strong> '+esc(x.version)+'</span>':''}
          ${x.document_type?'<span><strong>Type</strong> '+esc(x.document_type)+'</span>':''}
          ${origin?'<span><strong>Origine</strong> '+esc(origin)+'</span>':''}
          <span><strong>Créé</strong> ${esc(new Date(x.created_at).toLocaleString('fr-FR'))}</span>
          ${x.updated_at?'<span><strong>Modifié</strong> '+esc(new Date(x.updated_at).toLocaleString('fr-FR'))+'</span>':''}
        </div>
        <div class="cf-admin-section-label">Classement enregistré par l’IA</div>
        <div class="cf-admin-classification">${esc(classification||'Aucune classification détaillée enregistrée.')}</div>
        <div class="cf-admin-theme-row">
          <span class="cf-admin-theme-dot" style="background:${esc(theme)}"></span>
          <span><strong>Couleur du document</strong><small>${esc(theme)}</small></span>
          <button type="button" class="admin-btn ghost cf-change-theme" data-cf-theme="${esc(x.id)}" data-theme-color="${esc(theme)}" ${actionBusy?'disabled':''}>Changer la couleur</button>
        </div>
        ${stage?'<div class="cf-admin-generation-state"><strong>Production PDF :</strong> '+esc(stage)+'</div>':''}
        ${x.validation_notes?'<div class="cf-admin-note"><strong>Note administrative :</strong> '+esc(x.validation_notes)+'</div>':''}
        ${m.lualatex_last_error?'<div class="cf-admin-error">'+esc(m.lualatex_last_error)+'</div>':''}
        <div class="cf-admin-actions cf-admin-actions-stable">
          ${pdf?'<a class="admin-btn ghost" href="'+esc(x.pdf_url)+'" target="_blank" rel="noopener">Ouvrir le PDF</a>':''}
          ${active||cancelRequested
            ?'<button type="button" class="admin-btn danger cf-pdf-cancel-static" data-cf-cancel="'+esc(x.id)+'" data-cancel-state="'+(cancelRequested?'requested':'active')+'">'+(cancelRequested?'Annulation demandée…':'Annuler la génération')+'</button>'
            :''}
          ${canRender?'<button type="button" class="admin-btn primary" data-cf-render="'+esc(x.id)+'" data-has-pdf="'+(pdf?'1':'0')+'" data-theme-color="'+esc(theme)+'">'+(pdf?'Régénérer le PDF':'Générer le PDF')+'</button>':''}
          ${canValidate?'<button type="button" class="admin-btn valider" data-cf-validate="'+esc(x.id)+'">Valider le PDF</button>':''}
          ${canReject?'<button type="button" class="admin-btn refuser" data-cf-reject="'+esc(x.id)+'">Rejeter</button>':''}
          ${canPublish?'<button type="button" class="admin-btn primary" data-cf-publish="'+esc(x.id)+'">Publier</button>':''}
          ${x.published_document_id?'<button type="button" class="admin-btn ghost" disabled>Déjà publié #'+esc(x.published_document_id)+'</button>':''}
        </div>
      </div>
    </article>`
  }).join('')
}

async function surveillerRenduArrierePlan(id,accessToken,b){
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  for(let i=0;i<180;i++){
    try{
      const q=await adminInventoryFetch(`${SUPABASE_URL}/rest/v1/aurora_generated_documents?id=eq.${encodeURIComponent(Number(id))}&select=id,pdf_url,metadata,status,updated_at`,{cache:'no-store',headers:{'Authorization':`Bearer ${accessToken}`}});
      const qt=await q.text();if(!q.ok)throw new Error('HTTP '+q.status);
      const rows=qt?JSON.parse(qt):[],row=Array.isArray(rows)?rows[0]:null;
      const m=row?.metadata&&typeof row.metadata==='object'?row.metadata:{};
      const bgProgress=Number.isFinite(Number(m.lualatex_progress))?Math.max(0,Math.min(100,Number(m.lualatex_progress))):0;
      const bgStage=String(m.lualatex_stage||'Rendu LuaLaTeX en cours');
      setProgress(bgProgress,`${bgStage} · ${bgProgress.toFixed(2)}%`);
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
        setProgress(bgProgress,'Le rendu précédent a échoué.');
        if(b){b.disabled=false;b.textContent=b.dataset.hasPdf==='1'?'Régénérer le PDF':'Générer le PDF';}
        await charger();return false;
      }
    }catch(e){console.warn('[Content Factory] Suivi arrière-plan:',e);}
    await wait(10000);
  }
  return false;
}

async function charger(){
  if(!adminOk()){list.innerHTML='<div class="admin-empty">Cette action est réservée aux administrateurs.</div>';return}
  list.innerHTML='<div class="admin-empty">Chargement…</div>';
  try{
    const r=await adminInventoryFetch(`${SUPABASE_URL}/rest/v1/aurora_generated_documents?select=id,job_id,created_at,updated_at,created_by,title,subject,matiere,level,class_name,document_type,domaine,formation,specialite,annee,semestre,filiere,theme_color,source_format,pdf_path,pdf_url,version,status,validation_notes,published_document_id,metadata,pdf_diagnostic&order=created_at.desc`,{cache:'no-store'});
    const t=await r.text();
    if(!r.ok)throw new Error(t||('HTTP '+r.status));
    rows=t?JSON.parse(t):[];
    if(!Array.isArray(rows))rows=[];

    // Les demandes IA récentes existent parfois encore uniquement dans
    // aurora_content_jobs (ex. Job #93) avant la réception du contenu éditorial.
    // Elles doivent malgré tout être visibles dans la réception Content Factory.
    try{
      const jr=await adminInventoryFetch(`${SUPABASE_URL}/rest/v1/aurora_content_jobs?select=id,created_at,updated_at,status,title,subject,level,class_name,document_type,generated_document_id,error_message,metadata&status=in.(draft,queued,processing,review)&order=created_at.desc&limit=500`,{cache:'no-store'});
      const jt=await jr.text();
      if(jr.ok){
        const jobs=jt?JSON.parse(jt):[];
        const known=new Set(rows.map(x=>String(x.job_id||'')).filter(Boolean));
        for(const job of (Array.isArray(jobs)?jobs:[])){
          if(job.generated_document_id!=null||known.has(String(job.id)))continue;
          const jm=job.metadata&&typeof job.metadata==='object'?job.metadata:{};
          rows.push({
            id:'job-'+job.id,
            job_id:job.id,
            created_at:job.created_at,
            updated_at:job.updated_at,
            created_by:null,
            title:job.title||'Nouvelle demande',
            subject:job.subject||'',
            matiere:job.subject||'',
            level:job.level||'',
            class_name:job.class_name||'',
            document_type:job.document_type||'',
            domaine:job.domaine||'',
            formation:job.formation||'',
            specialite:job.specialite||'',
            annee:job.annee||'',
            semestre:job.semestre||'',
            filiere:job.filiere||'',
            theme_color:jm.theme_color||jm.aurore_design?.theme_color||'#C85C0D',
            source_format:'editorial-request',
            pdf_path:null,
            pdf_url:null,
            version:null,
            status:job.status,
            validation_notes:job.error_message||'',
            published_document_id:null,
            metadata:{...jm,origin:jm.origin||'Content Factory',content_job:true,job_status:job.status},
            pdf_diagnostic:null,
            contentJob:true,
            job_status:job.status
          });
          known.add(String(job.id));
        }
      }
    }catch(jobError){
      console.warn('[Content Factory] demandes éditoriales en attente indisponibles',jobError);
    }

    const c={review:0,approved:0,published:0,failed:0};
    rows.forEach(x=>{if(!x.contentJob&&c[x.status]!=null)c[x.status]++});
    document.getElementById('cfCountReview').textContent=c.review;
    document.getElementById('cfCountApproved').textContent=c.approved;
    document.getElementById('cfCountPublished').textContent=c.published;
    document.getElementById('cfCountFailed').textContent=c.failed;
    if(count)count.textContent=String(c.review);
    apply();
  }catch(e){
    list.innerHTML=`<div class="admin-empty">Impossible de charger Content Factory.<br>${esc(e.message||e)}</div>`
  }
}
document.getElementById('cfCreateLaunch')?.addEventListener('click',enqueueCurrent);document.getElementById('adminRefreshContentFactory')?.addEventListener('click',charger);document.getElementById('adminSearchContentFactory')?.addEventListener('input',apply);document.getElementById('adminSortContentFactory')?.addEventListener('change',apply);document.getElementById('adminFilterContentFactory')?.addEventListener('change',apply);
  const handlePdfAction=async detail=>{
    try{
      const id=Number(detail?.id||0);if(!id)return;
      if(detail.action==='render'){
        let color=detail.themeColor||'#C85C0D';
        if(detail.hasPdf){if(!confirm('Ce document possède déjà un PDF. Le nouveau rendu remplacera le PDF actuel. Continuer ?'))return;}
        color=await chooseRegenerationTheme(color);if(!color)return;
        await renderPdf(id,color);
      }else if(detail.action==='validate')await validateDoc(id);
      else if(detail.action==='reject')await rejectDoc(id);
      else if(detail.action==='publish')await publishDoc(id);
    }catch(e){alert('Action PDF impossible. '+(e?.message||e))}
  };
  document.addEventListener('aurore-pdf-action',e=>{handlePdfAction(e.detail)});
  // Route unique de toutes les actions PDF visibles : production, validation,
  // rejet et publication. Capture phase pour neutraliser les anciens routeurs
  // concurrents et garantir le même comportement dans toutes les cartes.
  document.addEventListener('click',e=>{
    const copyButton=e.target?.closest?.('[data-cf-copy-editorial]');
    if(copyButton){
      e.preventDefault();
      e.stopImmediatePropagation();
      const jobId=Number(copyButton.dataset.cfCopyEditorial||0);
      const row=window.auroreContentFactoryAdminRows?.find(x=>x.contentJob&&Number(x.job_id)===jobId);
      if(row) void copyEditorialBrief(row);
      return;
    }
    const confirm=e.target?.closest?.('[data-cf-confirm-job]');
    if(confirm){e.preventDefault();e.stopImmediatePropagation();confirm.disabled=true;confirm.textContent='Confirmation…';void (window.auroreAdminConfirmContentJob?window.auroreAdminConfirmContentJob(Number(confirm.dataset.cfConfirmJob)):Promise.reject(new Error('Le contrôleur de confirmation n’est pas chargé.'))).catch(error=>{alert('La génération n’a pas pu être confirmée : '+(error?.message||error));confirm.disabled=false;confirm.textContent='Choisir la couleur et générer le document';});return;}
    const button=e.target?.closest?.('[data-cf-render],[data-cf-validate],[data-cf-reject],[data-cf-publish],[data-cf-cancel],[data-cf-theme]');
    if(!button)return;
    if(button.hasAttribute('data-cf-cancel')){
      e.preventDefault();e.stopImmediatePropagation();
      const cancelId=Number(button.dataset.cfCancel),busyKey='cancel:'+String(cancelId);
      if(window.__aurorePdfActionBusy.has(busyKey))return;
      window.__aurorePdfActionBusy.add(busyKey);
      button.disabled=true;button.textContent='Annulation…';button.dataset.cancelState='requested';button.setAttribute('aria-busy','true');
      void cancelPdfGeneration(cancelId).finally(()=>{
        window.__aurorePdfActionBusy.delete(busyKey);
        if(button.isConnected&&!window.__aurorePdfCancelRequested?.has(cancelId)){
          button.disabled=false;button.textContent='Annuler la génération';button.dataset.cancelState='active';button.removeAttribute('aria-busy')
        }
      });
      return;
    }
    if(button.hasAttribute('data-cf-theme')){e.preventDefault();e.stopImmediatePropagation();void changeDocumentTheme(Number(button.dataset.cfTheme),button.dataset.themeColor||'#C85C0D');return;}
    const action=button.hasAttribute('data-cf-render')?'render':button.hasAttribute('data-cf-validate')?'validate':button.hasAttribute('data-cf-reject')?'reject':'publish';
    const id=Number(button.dataset?.['cf'+action.charAt(0).toUpperCase()+action.slice(1)]||0);
    if(!id)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const busyKey=action+':'+String(id);
    if(window.__aurorePdfActionBusy.has(busyKey))return;
    window.__aurorePdfActionBusy.add(busyKey);
    const previousText=button.textContent;
    button.disabled=true;button.setAttribute('aria-busy','true');
    if(action==='render')button.textContent=button.dataset.hasPdf==='1'?'Régénération…':'Génération…';
    else if(action==='validate')button.textContent='Validation…';
    else if(action==='reject')button.textContent='Rejet…';
    else if(action==='publish')button.textContent='Publication…';
    void handlePdfAction({
      action,
      id,
      hasPdf:button.dataset.hasPdf==='1',
      themeColor:button.dataset.themeColor||'#C85C0D'
    }).finally(()=>{
      window.__aurorePdfActionBusy.delete(busyKey);
      if(button.isConnected){
        button.disabled=false;
        button.removeAttribute('aria-busy');
        button.textContent=previousText;
      }
    });
  },true);
  window.auroraContentFactoryPdfActions={
    render:(id,hasPdf,themeColor)=>handlePdfAction({action:'render',id,hasPdf,themeColor}),
    chooseTheme:(defaultColor,mode='regeneration')=>chooseRegenerationTheme(defaultColor,mode),
    validate:id=>handlePdfAction({action:'validate',id}),
    reject:id=>handlePdfAction({action:'reject',id}),
    publish:id=>handlePdfAction({action:'publish',id})
  };
  bindClassification();window.chargerAuroraContentFactoryAdmin=charger;})();


/* Les anciens inventaires et le « Centre de gestion des documents » dupliqué ont été retirés. Les pages dédiées existantes restent les interfaces canoniques pour les documents générés et publiés. */
