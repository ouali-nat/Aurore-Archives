(function(){
  'use strict';
  const STATE={documents:[],filtered:[],query:'',level:'',subject:'',sort:'recent',loading:false};
  const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const clean=(v,f='')=>{const x=String(v??'').trim();return x||f};
  const dateValue=v=>{const d=v?new Date(v):null;return d&&!Number.isNaN(d.getTime())?d:null};
  const stamp=v=>dateValue(v)?.getTime()||0;
  const fmt=v=>{const d=dateValue(v);return d?d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Date non disponible'};
  const setText=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=String(v??'')};
  const headers=()=>typeof headersAdmin==='function'?headersAdmin():{};
  const themeColor=v=>/^#[0-9a-f]{6}$/i.test(String(v||''))?String(v).toUpperCase():'#C85C0D';

  function normaliserAurore(doc){
    const m=doc?.metadata&&typeof doc.metadata==='object'?doc.metadata:{};
    const status=String(doc?.status||'').toLowerCase();
    return {
      key:'aurora:'+doc.id,id:doc.id,source:'aurora',sourceLabel:'Aurore — Content Factory',
      title:clean(doc.title,'Document Aurore sans titre'),level:clean(doc.level,'Niveau non précisé'),
      klass:clean(doc.class_name),subject:clean(doc.subject||doc.matiere,'Matière non précisée'),
      category:clean(doc.document_type,'Document'),author:'Aurore',created:doc.created_at,
      updated:doc.updated_at,pdfUrl:clean(doc.pdf_url),pdfPath:clean(doc.pdf_path),version:doc.version||1,
      status,statusLabel:'À contrôler',theme:themeColor(doc.theme_color||m.aurore_design?.theme_color||m.theme_color),
      metadata:m,validationNotes:clean(doc.validation_notes),raw:doc,
      progress:Number.isFinite(Number(m.lualatex_progress))?Math.max(0,Math.min(100,Number(m.lualatex_progress))):null,
      stage:clean(m.lualatex_stage||m.lualatex_status),error:clean(m.lualatex_last_error),
      search:[doc.title,doc.level,doc.class_name,doc.subject,doc.matiere,doc.document_type,'Aurore','Content Factory','À contrôler'].filter(Boolean).join(' ').toLocaleLowerCase('fr')
    };
  }

  function appliquerFiltres(){
    const q=STATE.query.trim().toLocaleLowerCase('fr');
    let a=STATE.documents.filter(d=>!q||d.search.includes(q));
    if(STATE.level)a=a.filter(d=>d.level===STATE.level);
    if(STATE.subject)a=a.filter(d=>d.subject===STATE.subject);
    a.sort((x,y)=>STATE.sort==='az'?x.title.localeCompare(y.title,'fr',{sensitivity:'base'}):STATE.sort==='za'?y.title.localeCompare(x.title,'fr',{sensitivity:'base'}):STATE.sort==='oldest'?stamp(x.created)-stamp(y.created):stamp(y.created)-stamp(x.created)||Number(y.id)-Number(x.id));
    STATE.filtered=a;
  }
  function populate(id,vals,placeholder){
    const e=document.getElementById(id);if(!e)return;const old=e.value;
    e.innerHTML='<option value="">'+esc(placeholder)+'</option>';
    [...new Set(vals.map(clean).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'})).forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;e.appendChild(o)});
    if([...e.options].some(o=>o.value===old))e.value=old;
  }
  function progress(doc){
    if(doc.progress==null)return '';
    return '<div class="admin-pending-v2-progress"><div><strong>Progression réelle</strong><span>'+doc.progress+'%</span></div><div class="admin-pending-v2-progress-track"><i style="width:'+doc.progress+'%"></i></div><small>'+esc(doc.stage||'Production PDF')+'</small></div>';
  }
  function actions(doc){
    const a=window.auroreAdminGeneratedActions;
    const disabled=!a;
    return '<div class="admin-pending-v2-actions">'+
      (doc.pdfUrl?'<button type="button" class="admin-btn ghost" data-action="open" data-id="'+doc.id+'">Ouvrir le PDF</button>':'<button type="button" class="admin-btn ghost" disabled>PDF indisponible</button>')+
      '<button type="button" class="admin-btn ghost" data-action="theme" data-id="'+doc.id+'" data-theme="'+esc(doc.theme)+'" '+(disabled?'disabled':'')+'>Changer la couleur</button>'+
      '<button type="button" class="admin-btn primary" data-action="regenerate" data-id="'+doc.id+'" data-theme="'+esc(doc.theme)+'" '+(disabled?'disabled':'')+'>Régénérer le PDF</button>'+
      (doc.pdfUrl?'<button type="button" class="admin-btn valider" data-action="validate" data-id="'+doc.id+'" '+(disabled?'disabled':'')+'>Valider le PDF</button>':'')+
      '<button type="button" class="admin-btn refuser" data-action="reject" data-id="'+doc.id+'" '+(disabled?'disabled':'')+'>Rejeter</button>'+
      (doc.pdfUrl?'<button type="button" class="admin-btn primary" data-action="publish" data-id="'+doc.id+'" '+(disabled?'disabled':'')+'>Publier</button>':'')+
      '</div>';
  }
  function render(){
    const list=document.getElementById('adminPendingV2List');if(!list)return;appliquerFiltres();
    setText('adminPendingV2Total',STATE.documents.length);setText('adminPendingV2Aurora',STATE.documents.length);setText('adminPendingV2Community',0);setText('adminPendingV2Filtered',STATE.filtered.length);setText('adminPendingV2Visible',STATE.filtered.length);
    if(!STATE.filtered.length){list.innerHTML='<div class="admin-pending-v2-empty"><strong>Aucun document Aurore à contrôler.</strong><span>Seuls les documents Aurore actuellement au statut « À contrôler » sont affichés ici.</span></div>';return;}
    list.innerHTML=STATE.filtered.map(doc=>'<article class="admin-pending-v2-card" data-id="'+doc.id+'" style="--pending-theme:'+esc(doc.theme)+'">'+
      '<div class="admin-pending-v2-card-accent"></div><div class="admin-pending-v2-card-main">'+
      '<div class="admin-pending-v2-card-head"><div><span class="admin-pending-v2-source">Aurore — Content Factory</span><h3>'+esc(doc.title)+'</h3></div><span class="admin-pending-v2-id">#'+doc.id+'</span></div>'+
      progress(doc)+
      '<div class="admin-pending-v2-grid"><div><b>Date</b><span>'+esc(fmt(doc.created))+'</span></div><div><b>Classe</b><span>'+esc(doc.klass||'—')+'</span></div><div><b>Niveau</b><span>'+esc(doc.level)+'</span></div><div><b>Matière</b><span>'+esc(doc.subject)+'</span></div><div><b>Type</b><span>'+esc(doc.category)+'</span></div><div><b>Version</b><span>'+esc(doc.version)+'</span></div></div>'+
      '<div class="admin-pending-v2-classification">Matière : '+esc(doc.subject)+' · Niveau : '+esc(doc.level)+' · Classe : '+esc(doc.klass||'—')+' · Origine : Aurore</div>'+ 
      '<div class="admin-pending-v2-status"><strong>À contrôler</strong>'+(doc.pdfUrl?' · PDF prêt':' · PDF indisponible')+'</div>'+
      '<div class="admin-pending-v2-theme"><span style="background:'+esc(doc.theme)+'"></span><div><b>Couleur du document</b><small>'+esc(doc.theme)+' · modifiable avant génération</small></div></div>'+
      (doc.validationNotes?'<div class="admin-pending-v2-note"><b>Note :</b> '+esc(doc.validationNotes)+'</div>':'')+(doc.error?'<div class="admin-pending-v2-error">'+esc(doc.error)+'</div>':'')+
      actions(doc)+'</div></article>').join('');
    list.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',()=>runAction(btn)));
  }
  async function runAction(btn){
    const id=Number(btn.dataset.id),doc=STATE.documents.find(d=>Number(d.id)===id),a=window.auroreAdminGeneratedActions;if(!doc||!a)return;
    btn.disabled=true;
    try{
      if(btn.dataset.action==='open'){if(doc.pdfUrl){if(typeof window.ouvrirLecteurPDF==='function')window.ouvrirLecteurPDF({id:doc.id,Titre:doc.title,Fichier_url:doc.pdfUrl,Telechargement_autorise:false});else window.open(doc.pdfUrl,'_blank','noopener,noreferrer')}return}
      if(btn.dataset.action==='theme')await a.changeTheme(id,doc.theme);
      else if(btn.dataset.action==='regenerate')await a.render(id,doc.theme);
      else if(btn.dataset.action==='validate')await a.validate(id);
      else if(btn.dataset.action==='reject')await a.reject(id);
      else if(btn.dataset.action==='publish')await a.publish(id);
      await chargerDocumentsEnAttenteAdminV2();
    }catch(e){console.error('[ADMIN][AURORE ATTENTE]',e);alert('Action impossible pour le document #'+id+'. '+(e?.message||e));btn.disabled=false;}
  }
  async function chargerDocumentsEnAttenteAdminV2(){
    const list=document.getElementById('adminPendingV2List');if(!list)return;STATE.loading=true;
    list.innerHTML='<div class="admin-pending-v2-empty"><strong>Chargement des documents Aurore…</strong><span>Recherche exclusive des documents actuellement « À contrôler ».</span></div>';
    try{
      const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/admin_list_aurora_generated_documents',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:'{}',cache:'no-store'});
      const t=await r.text();if(!r.ok)throw new Error('Lecture des documents Aurore impossible (HTTP '+r.status+').');
      const raw=t?JSON.parse(t):[];
      STATE.documents=(Array.isArray(raw)?raw:[]).filter(d=>String(d.status||'').toLowerCase()==='review').map(normaliserAurore);
      populate('adminPendingV2Level',STATE.documents.map(d=>d.level),'Tous les niveaux');populate('adminPendingV2Subject',STATE.documents.map(d=>d.subject),'Toutes les matières');
      const note=document.getElementById('adminPendingV2Note');if(note){note.textContent='Cette page est réservée au circuit Aurore : aucun dépôt Communauté n’est affiché ici. Seuls les documents au statut « À contrôler » sont présents.';note.style.display='block'}
      render();
    }catch(e){console.error('[ADMIN][AURORE ATTENTE] chargement',e);STATE.documents=[];list.innerHTML='<div class="admin-pending-v2-error"><strong>Impossible de charger les documents Aurore.</strong><br>'+esc(e.message||e)+'</div>';updateSummary();}
    finally{STATE.loading=false}
  }
  function updateSummary(){setText('adminPendingV2Total',STATE.documents.length);setText('adminPendingV2Aurora',STATE.documents.length);setText('adminPendingV2Community',0);setText('adminPendingV2Filtered',STATE.filtered.length);setText('adminPendingV2Visible',STATE.filtered.length)}
  function resetState(){STATE.documents=[];STATE.filtered=[];STATE.query='';STATE.level='';STATE.subject='';STATE.sort='recent';}
  function bind(){
    document.getElementById('adminPendingV2Search')?.addEventListener('input',e=>{STATE.query=e.target.value||'';render()});
    document.getElementById('adminPendingV2Level')?.addEventListener('change',e=>{STATE.level=e.target.value||'';render()});
    document.getElementById('adminPendingV2Subject')?.addEventListener('change',e=>{STATE.subject=e.target.value||'';render()});
    document.getElementById('adminPendingV2Sort')?.addEventListener('change',e=>{STATE.sort=e.target.value||'recent';render()});
    const refresh=document.getElementById('adminPendingV2Refresh');refresh?.addEventListener('click',chargerDocumentsEnAttenteAdminV2);
    const close=()=>{if(history.state?.aurasterNavigation&&history.state.ecranAuraster==='screen-admin-pending')history.back();else if(typeof afficherEcran==='function')afficherEcran('screen-admin')};
    document.getElementById('adminPendingV2Back')?.addEventListener('click',close);document.getElementById('adminPendingV2BackBottom')?.addEventListener('click',close);
  }
  window.chargerDocumentsEnAttenteAdminV2=chargerDocumentsEnAttenteAdminV2;
  window.chargerCompteurDocumentsEnAttenteAdmin=async function(){try{const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/admin_list_aurora_generated_documents',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:'{}',cache:'no-store'});const a=r.ok?(await r.json()):[];const n=Array.isArray(a)?a.filter(d=>String(d.status||'').toLowerCase()==='review').length:0;setText('tabCountAttente',n);return n}catch(_){return 0}};
  window.ouvrirDocumentsEnAttenteAdmin=async function(){if(typeof session==='undefined'||!session||session.role!=='admin'){alert('Cette page est réservée aux administrateurs.');return}if(typeof afficherEcran!=='function')return;resetState();afficherEcran('screen-admin-pending');window.scrollTo({top:0,behavior:'auto'});await chargerDocumentsEnAttenteAdminV2()};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();