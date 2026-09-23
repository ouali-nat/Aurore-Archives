(function(){
  'use strict';

  const STATE = {
    documents: [],
    filtered: [],
    query: '',
    source: '',
    level: '',
    subject: '',
    sort: 'recent',
    loading: false
  };

  function esc(value){
    return String(value ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }

  function clean(value, fallback=''){
    const v = String(value ?? '').trim();
    return v || fallback;
  }

  function dateValue(value){
    const d = value ? new Date(value) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }

  function formatDate(value){
    const d = dateValue(value);
    if(!d) return 'Date non disponible';
    return d.toLocaleString('fr-FR',{
      day:'numeric',
      month:'short',
      year:'numeric',
      hour:'2-digit',
      minute:'2-digit'
    }).replace(' à ', ', ');
  }

  function timestamp(value){
    const d = dateValue(value);
    return d ? d.getTime() : 0;
  }

  function setText(id,value){
    const el=document.getElementById(id);
    if(el) el.textContent=String(value ?? '');
  }

  function populateSelect(id, values, placeholder){
    const el=document.getElementById(id);
    if(!el) return;
    const previous=el.value;
    const sorted=[...new Set(values.map(v=>clean(v)).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
    el.innerHTML='';
    const first=document.createElement('option');
    first.value='';
    first.textContent=placeholder;
    el.appendChild(first);
    sorted.forEach(v=>{
      const o=document.createElement('option');
      o.value=v;
      o.textContent=v;
      el.appendChild(o);
    });
    if(sorted.includes(previous)) el.value=previous;
  }

  function normaliserCommunaute(doc,deposant){
    const title=clean(doc?.Titre,'Document sans titre');
    const level=clean(doc?.Niveau,'Niveau non précisé');
    const klass=clean(doc?.Classe);
    const subject=clean(doc?.['Matière'] || doc?.Genre,'Matière non précisée');
    const category=clean(doc?.['Catégorie'] || doc?.Genre,'Non classé');
    const author=clean(doc?.Auteur || deposant?.nom,'Anonyme');
    const created=doc?.created_at || doc?.createdAt || doc?.date_creation || null;
    return {
      key:'community:'+String(doc?.id ?? ''),
      source:'community',
      sourceLabel:'Communauté',
      id:doc?.id ?? null,
      title,
      level,
      klass,
      subject,
      category,
      author,
      created,
      pdfUrl:clean(doc?.Fichier_url),
      status:'En attente de validation',
      statusKey:'review',
      raw:doc,
      deposant:deposant || null,
      search:[title,level,klass,subject,category,author,'Communauté','dépôt','validation'].join(' ').toLocaleLowerCase('fr')
    };
  }

  function normaliserAurore(doc){
    const title=clean(doc?.title,'Document Aurore sans titre');
    const level=clean(doc?.level,'Niveau non précisé');
    const klass=clean(doc?.class_name || doc?.classe);
    const subject=clean(doc?.subject || doc?.matiere,'Matière non précisée');
    const created=doc?.created_at || doc?.createdAt || doc?.updated_at || null;
    const statusKey=clean(doc?.status,'review').toLowerCase();
    const statusLabel={
      queued:'En file de génération',
      processing:'PDF en génération',
      generated:'PDF généré — contrôle requis',
      review:'À contrôler'
    }[statusKey] || 'Contrôle requis';
    return {
      key:'aurora:'+String(doc?.id ?? ''),
      source:'aurora',
      sourceLabel:'Aurore',
      id:doc?.id ?? null,
      title,
      level,
      klass,
      subject,
      category:'Aurore — Content Factory',
      author:'Aurore',
      created,
      pdfUrl:clean(doc?.pdf_url),
      status:statusLabel,
      statusKey,
      raw:doc,
      deposant:null,
      search:[title,level,klass,subject,'Aurore','Content Factory',statusLabel,statusKey].join(' ').toLocaleLowerCase('fr')
    };
  }

  function appliquerFiltres(){
    const q=STATE.query.trim().toLocaleLowerCase('fr');
    const filtered=STATE.documents.filter(doc=>{
      if(q && !doc.search.includes(q)) return false;
      if(STATE.source && doc.source!==STATE.source) return false;
      if(STATE.level && doc.level!==STATE.level) return false;
      if(STATE.subject && doc.subject!==STATE.subject) return false;
      return true;
    });
    filtered.sort((a,b)=>{
      if(STATE.sort==='oldest') return timestamp(a.created)-timestamp(b.created);
      if(STATE.sort==='az') return a.title.localeCompare(b.title,'fr',{sensitivity:'base'});
      if(STATE.sort==='za') return b.title.localeCompare(a.title,'fr',{sensitivity:'base'});
      return timestamp(b.created)-timestamp(a.created) || Number(b.id||0)-Number(a.id||0);
    });
    STATE.filtered=filtered;
  }

  function renderCards(){
    const list=document.getElementById('adminPendingV2List');
    if(!list) return;
    appliquerFiltres();
    setText('adminPendingV2Visible', STATE.filtered.length);
    if(!STATE.filtered.length){
      list.innerHTML='<div class="admin-pending-v2-empty"><strong>Aucun document ne correspond à votre sélection.</strong><span>Modifiez la recherche ou les filtres pour afficher les documents en attente.</span></div>';
      return;
    }

    list.innerHTML=STATE.filtered.map(doc=>{
      const mark=doc.source==='aurora'?'✦':'▣';
      const klass=doc.klass ? '<span>Classe : '+esc(doc.klass)+'</span>' : '';
      const author=doc.source==='aurora'
        ? '<span>Auteur : Aurore</span>'
        : '<span>Auteur : '+esc(doc.author)+'</span>';
      const pdfAction=doc.pdfUrl
        ? '<button type="button" class="admin-btn ghost" data-action="open-pdf" data-key="'+esc(doc.key)+'">Ouvrir le PDF</button>'
        : '<button type="button" class="admin-btn ghost" disabled>PDF indisponible</button>';
      const communityActions=doc.source==='community'
        ? '<button type="button" class="admin-btn valider" data-action="validate" data-key="'+esc(doc.key)+'">Valider</button>' +
          '<button type="button" class="admin-btn refuser" data-action="reject" data-key="'+esc(doc.key)+'">Refuser / supprimer</button>'
        : '';
      return '<article class="admin-pending-v2-card" data-key="'+esc(doc.key)+'">' +
        '<div class="admin-pending-v2-card-mark" aria-hidden="true">'+mark+'</div>' +
        '<div class="admin-pending-v2-card-main">' +
          '<div class="admin-pending-v2-card-head">' +
            '<div>' +
              '<span class="admin-pending-v2-source" data-source="'+esc(doc.source)+'">'+esc(doc.sourceLabel)+'</span>' +
              '<h3 class="admin-pending-v2-title">'+esc(doc.title)+'</h3>' +
            '</div>' +
            '<span class="admin-pending-v2-id">#'+esc(doc.id ?? '—')+'</span>' +
          '</div>' +
          '<div class="admin-pending-v2-meta">' +
            '<span>'+esc(doc.level)+'</span>' +
            klass +
            '<span>'+esc(doc.subject)+'</span>' +
            '<span>'+esc(doc.category)+'</span>' +
          '</div>' +
          '<div class="admin-pending-v2-meta">' +
            author +
            '<span>'+esc(formatDate(doc.created))+'</span>' +
          '</div>' +
          '<div class="admin-pending-v2-status">'+esc(doc.status)+'</div>' +
          '<div class="admin-pending-v2-actions">' + pdfAction + communityActions + '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    list.querySelectorAll('[data-action]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const doc=STATE.documents.find(item=>item.key===btn.dataset.key);
        if(doc) executerAction(doc,btn.dataset.action,btn);
      });
    });
  }

  async function executerAction(doc,action,button){
    if(action==='open-pdf'){
      if(!doc.pdfUrl) return;
      const cible={
        id:doc.id,
        Titre:doc.title,
        Fichier_url:doc.pdfUrl,
        Telechargement_autorise:doc.source==='community' ? doc.raw?.Telechargement_autorise!==false : false
      };
      if(typeof window.ouvrirLecteurPDF==='function') window.ouvrirLecteurPDF(cible);
      else window.open(doc.pdfUrl,'_blank','noopener,noreferrer');
      return;
    }

    if(doc.source!=='community') return;

    button.disabled=true;
    try{
      let deposant=doc.deposant || null;
      if(!deposant && typeof recupererDeposants==='function' && doc.id!=null){
        try{
          const map=await recupererDeposants([doc.id]);
          deposant=map.get(doc.id) || null;
        }catch(_){}
      }
      const actionStub={remove(){}};
      if(action==='validate' && typeof validerDepot==='function'){
        await validerDepot(doc.id,actionStub,doc.title,deposant);
      }else if(action==='reject' && typeof refuserDepot==='function'){
        await refuserDepot(doc.id,actionStub,doc.title,deposant);
      }else{
        throw new Error('Action administrative indisponible');
      }
      await chargerDocumentsEnAttenteAdminV2();
    }catch(err){
      console.error('[ADMIN][ATTENTE v2] action impossible',err);
      button.disabled=false;
      alert('L’action administrative n’a pas pu être effectuée pour le moment. Veuillez réessayer.');
    }
  }

  async function recupererSources(){
    const headers=typeof headersAdmin==='function' ? headersAdmin() : {};
    const [communityResult,auroreResult]=await Promise.allSettled([
      fetch(\`${SUPABASE_URL}/rest/v1/Document?select=*&Publie=eq.false&order=id.desc\`,{headers,cache:'no-store'}),
      fetch(\`${SUPABASE_URL}/rest/v1/rpc/admin_list_aurora_generated_documents\`,{
        method:'POST',
        headers:{...headers,'Content-Type':'application/json'},
        body:'{}',
        cache:'no-store'
      })
    ]);

    let community=[];
    let aurore=[];
    const errors=[];

    if(communityResult.status==='fulfilled' && communityResult.value.ok){
      community=await communityResult.value.json();
    }else{
      errors.push('Les dépôts communautaires ne sont pas disponibles.');
      console.warn('[ADMIN][ATTENTE v2] communauté indisponible',communityResult.reason || communityResult.value?.status);
    }

    if(auroreResult.status==='fulfilled' && auroreResult.value.ok){
      aurore=await auroreResult.value.json();
    }else{
      errors.push('Les documents Aurore ne sont pas disponibles.');
      console.warn('[ADMIN][ATTENTE v2] Aurore indisponible',auroreResult.reason || auroreResult.value?.status);
    }

    return {community:Array.isArray(community)?community:[],aurore:Array.isArray(aurore)?aurore:[],errors};
  }

  async function chargerDeposantsBestEffort(docs){
    if(!Array.isArray(docs) || !docs.length || typeof recupererDeposants!=='function') return new Map();
    try{
      return await recupererDeposants(docs.map(d=>d.id).filter(v=>v!=null));
    }catch(err){
      console.warn('[ADMIN][ATTENTE v2] déposants indisponibles',err);
      return new Map();
    }
  }

  async function chargerDocumentsEnAttenteAdminV2(){
    const list=document.getElementById('adminPendingV2List');
    if(!list) return;
    STATE.loading=true;
    list.innerHTML='<div class="admin-pending-v2-empty"><strong>Chargement des documents en attente…</strong><span>Les deux circuits sont consultés séparément puis réunis uniquement pour l’affichage.</span></div>';
    try{
      const sources=await recupererSources();
      const deposants=await chargerDeposantsBestEffort(sources.community);
      STATE.documents=[
        ...sources.community.map(doc=>normaliserCommunaute(doc,deposants.get(doc.id)||null)),
        ...sources.aurore.map(normaliserAurore)
      ];
      STATE.documents.sort((a,b)=>timestamp(b.created)-timestamp(a.created) || Number(b.id||0)-Number(a.id||0));
      populateSelect('adminPendingV2Level',STATE.documents.map(d=>d.level),'Tous les niveaux');
      populateSelect('adminPendingV2Subject',STATE.documents.map(d=>d.subject),'Toutes les matières');
      applyUiState();
      updateSummary();
      const note=document.getElementById('adminPendingV2Note');
      if(note){
        note.textContent=sources.errors.length
          ? sources.errors.join(' ')
          : 'Les documents Aurore et Communauté restent distincts dans leurs circuits ; cette page les réunit seulement pour le contrôle administratif.';
        note.style.display='block';
      }
    }catch(err){
      console.error('[ADMIN][ATTENTE v2] chargement',err);
      list.innerHTML='<div class="admin-pending-v2-error"><strong>Impossible de charger les documents en attente.</strong><br>Veuillez actualiser la page puis réessayer.</div>';
      STATE.documents=[];
      updateSummary();
    }finally{
      STATE.loading=false;
    }
  }

  function updateSummary(){
    const total=STATE.documents.length;
    const community=STATE.documents.filter(d=>d.source==='community').length;
    const aurore=STATE.documents.filter(d=>d.source==='aurora').length;
    setText('adminPendingV2Total',total);
    setText('adminPendingV2Community',community);
    setText('adminPendingV2Aurora',aurore);
  }

  function applyUiState(){
    const search=document.getElementById('adminPendingV2Search');
    const source=document.getElementById('adminPendingV2Source');
    const level=document.getElementById('adminPendingV2Level');
    const subject=document.getElementById('adminPendingV2Subject');
    const sort=document.getElementById('adminPendingV2Sort');
    if(search) search.value=STATE.query;
    if(source) source.value=STATE.source;
    if(level) level.value=STATE.level;
    if(subject) subject.value=STATE.subject;
    if(sort) sort.value=STATE.sort;
    renderCards();
  }

  function resetState(){
    STATE.documents=[];
    STATE.filtered=[];
    STATE.query='';
    STATE.source='';
    STATE.level='';
    STATE.subject='';
    STATE.sort='recent';
    updateSummary();
    ['adminPendingV2Search','adminPendingV2Source','adminPendingV2Level','adminPendingV2Subject'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.value='';
    });
    const sort=document.getElementById('adminPendingV2Sort');
    if(sort) sort.value='recent';
  }

  function bind(){
    const search=document.getElementById('adminPendingV2Search');
    const source=document.getElementById('adminPendingV2Source');
    const level=document.getElementById('adminPendingV2Level');
    const subject=document.getElementById('adminPendingV2Subject');
    const sort=document.getElementById('adminPendingV2Sort');
    const refresh=document.getElementById('adminPendingV2Refresh');
    const back=document.getElementById('adminPendingV2Back');

    search?.addEventListener('input',e=>{STATE.query=e.target.value||'';renderCards();});
    source?.addEventListener('change',e=>{STATE.source=e.target.value||'';renderCards();});
    level?.addEventListener('change',e=>{STATE.level=e.target.value||'';renderCards();});
    subject?.addEventListener('change',e=>{STATE.subject=e.target.value||'';renderCards();});
    sort?.addEventListener('change',e=>{STATE.sort=e.target.value||'recent';renderCards();});
    refresh?.addEventListener('click',()=>chargerDocumentsEnAttenteAdminV2());
    back?.addEventListener('click',()=>{
      if(history.state?.aurasterNavigation && history.state.ecranAuraster==='screen-admin-pending'){
        history.back();
      }else if(typeof afficherEcran==='function'){
        afficherEcran('screen-admin');
      }
    });
  }

  window.chargerDocumentsEnAttenteAdminV2=chargerDocumentsEnAttenteAdminV2;

  window.chargerCompteurDocumentsEnAttenteAdmin=async function(){
    try{
      const sources=await recupererSources();
      const total=sources.community.length+sources.aurore.length;
      const el=document.getElementById('tabCountAttente');
      if(el) el.textContent=String(total);
      return total;
    }catch(err){
      console.warn('[ADMIN][ATTENTE v2] compteur',err);
      return 0;
    }
  };

  window.ouvrirDocumentsEnAttenteAdmin=async function(){
    if(typeof session==='undefined' || !session || session.role!=='admin'){
      alert('Cette page est réservée aux administrateurs.');
      return;
    }
    if(typeof afficherEcran!=='function'){
      console.error('[ADMIN][ATTENTE v2] navigation Aurore indisponible');
      return;
    }
    resetState();
    afficherEcran('screen-admin-pending');
    window.scrollTo({top:0,behavior:'auto'});
    await chargerDocumentsEnAttenteAdminV2();
  };

  function init(){
    bind();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();