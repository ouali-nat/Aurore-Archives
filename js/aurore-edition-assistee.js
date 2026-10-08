/* Aurore — Édition assistée : atelier séquentiel, sans canevas de prévisualisation */
(function(){
  'use strict';
  const state={mode:'list',course:null,courses:[],selected:null,loading:false,pdfLibPromise:null,canonicalPreview:{fingerprint:'',documentId:null,pdfUrl:null}};
  const PREVIEW_CACHE_MAX=6;
  const previewPdfCache=new Map();
  function cachedPreviewBuffer(url){const hit=previewPdfCache.get(url);if(!hit)return null;previewPdfCache.delete(url);previewPdfCache.set(url,hit);return hit;}
  function rememberPreviewBuffer(url,buffer){previewPdfCache.delete(url);previewPdfCache.set(url,buffer);while(previewPdfCache.size>PREVIEW_CACHE_MAX)previewPdfCache.delete(previewPdfCache.keys().next().value);}
  const THEME_COLORS=[
    {value:'#6D28D9',label:'Violet Aurore'},
    {value:'#2563EB',label:'Bleu'},
    {value:'#15803D',label:'Vert'},
    {value:'#C2410C',label:'Orange'},
    {value:'#A16207',label:'Ocre'},
    {value:'#0E7490',label:'Turquoise'},
    {value:'#BE123C',label:'Rose framboise'},
    {value:'#7C3AED',label:'Violet clair'}
  ];
  const DEFAULT_THEME_COLOR='#6D28D9';
  function normalizeThemeColor(v){
    const x=String(v??'').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(x)&&THEME_COLORS.some(c=>c.value===x)?x:DEFAULT_THEME_COLOR;
  }
  function themeColorOptions(){return THEME_COLORS.map(c=>'<option value="'+c.value+'"'+(normalizeThemeColor(state.course?.theme_color)===c.value?' selected':'')+'>'+esc(c.label)+'</option>').join('')}

  const esc=v=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const clone=v=>JSON.parse(JSON.stringify(v));
  const uid=p=>(p||'id')+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const root=()=>document.getElementById('assistedRoot');
  const client=()=>window.__auroreAssistedSb||(window.__auroreAssistedSb=window.supabase?.createClient?.(SUPABASE_URL,SUPABASE_ANON_KEY));
  function rowCourse(row){const p=row?.pages;return p?.course&&typeof p.course==='object'?p.course:(p&&typeof p==='object'&&Array.isArray(p.blocks)?p:null);}
  const START_ROLE='document-start',END_ROLE='document-end';
  function systemBlock(role,title){
    const start=role===START_ROLE;
    const end=role===END_ROLE;
    const courseTitle=String(title||'Nouveau document');
    return {
      id:start?'system-start':'system-end',
      role,type:role,locked:true,
      content:start
        ? {title:courseTitle,subtitle:'Bibliothèque numérique d’Aurore',author:'',institution:'',show_date:true}
        : {title:'Fin du document',subtitle:'Merci d’avoir consulté ce cours.',contact:'',show_qr:false},
      generation:{status:'system',page_number:start?1:null,page_path:null,page_url:null,updated_at:null,error:null},
      created_at:new Date().toISOString()
    };
  }
  function ensureDocumentPages(course){
    if(!course||typeof course!=='object')return course;
    course.document_pages=course.document_pages&&typeof course.document_pages==='object'?course.document_pages:{};
    course.document_pages.cover=course.document_pages.cover&&typeof course.document_pages.cover==='object'
      ?course.document_pages.cover:{enabled:true,title:String(course.title||'Nouveau document'),subtitle:'Bibliothèque numérique d’Aurore',author:'',institution:'',show_date:true};
    course.document_pages.toc=course.document_pages.toc&&typeof course.document_pages.toc==='object'
      ?course.document_pages.toc:{enabled:true,title:'Sommaire',subtitle:'Organisation du document',entries:[]};
    course.document_pages.toc.enabled=true;
    course.document_pages.toc.title='Sommaire';
    course.document_pages.toc.subtitle='Table des matières';
    course.document_pages.toc.entries=Array.isArray(course.document_pages.toc.entries)?course.document_pages.toc.entries:[];
    course.document_pages.toc.mode=course.document_pages.toc.mode==='manual'?'manual':'auto';
    ensureDefaultIntroduction(course);
    course.document_pages.end=course.document_pages.end&&typeof course.document_pages.end==='object'
      ?course.document_pages.end:{enabled:true,title:'Fin du document',subtitle:'Merci d’avoir consulté ce cours.',contact:'',show_qr:false};
    return course;
  }
  function syncSystemPages(course){
    ensureDocumentPages(course);
    const start=course.blocks?.find(b=>b?.role===START_ROLE);
    const end=course.blocks?.find(b=>b?.role===END_ROLE);
    if(start)start.content=clone(course.document_pages.cover);
    if(end)end.content=clone(course.document_pages.end);
    return course;
  }
  function ensureCourseStructure(course){
    if(!course||typeof course!=='object')return course;
    course.theme_color=normalizeThemeColor(course.theme_color);
    ensureDocumentPages(course);
    const blocks=Array.isArray(course.blocks)?course.blocks:[];
    const start=blocks.find(b=>b?.role===START_ROLE)||systemBlock(START_ROLE,course.title);
    const end=blocks.find(b=>b?.role===END_ROLE)||systemBlock(END_ROLE,course.title);
    const middle=blocks.filter(b=>b?.role!==START_ROLE&&b?.role!==END_ROLE);
    course.blocks=[start,...middle,end];
    ensureDefaultIntroduction(course);
    reorderPointBlocks(course);
    syncSystemPages(course);
    return course;
  }
  function isSystemBlock(b){return b?.role===START_ROLE||b?.role===END_ROLE||b?.locked===true&&(/^system-(start|end)$/.test(String(b?.id||'')));}
  function contentBlocks(course=state.course){return (Array.isArray(course?.blocks)?course.blocks:[]).filter(b=>!isSystemBlock(b));}

  function defaultIntroductionBlock(){
    return {
      id:uid('block'),
      type:'point',
      default_introduction:true,
      content:{title:'Introduction',text:'',color:DEFAULT_THEME_COLOR,rank:1},
      generation:{status:'not_generated',page_number:null,page_path:null,page_url:null,updated_at:null,error:null},
      created_at:new Date().toISOString()
    };
  }

  function isDefaultIntroduction(b){
    return b?.type==='point'&&b?.default_introduction===true;
  }

  function ensureDefaultIntroduction(course){
    if(!course||typeof course!=='object')return false;
    const blocks=Array.isArray(course.blocks)?course.blocks:[];
    let intro=blocks.find(isDefaultIntroduction);
    if(!intro){
      intro=blocks.find(b=>b?.type==='point'&&String(b?.content?.title||'').trim().toLowerCase()==='introduction');
      if(intro)intro.default_introduction=true;
    }
    let changed=false;
    if(!intro){
      intro=defaultIntroductionBlock();
      const startIndex=blocks.findIndex(b=>b?.role===START_ROLE);
      blocks.splice(startIndex>=0?startIndex+1:0,0,intro);
      changed=true;
    }
    if(!intro.content||typeof intro.content!=='object')intro.content={};
    if(String(intro.content.title||'').trim().toLowerCase()!=='introduction'&&!intro.content.title) {
      intro.content.title='Introduction';
      changed=true;
    }
    if(!Number.isFinite(Number(intro.content.rank))||Number(intro.content.rank)!==1){
      intro.content.rank=1;
      changed=true;
    }
    if(!String(intro.content.color||'').trim()){
      intro.content.color=DEFAULT_THEME_COLOR;
      changed=true;
    }
    const startIndex=blocks.findIndex(b=>b?.role===START_ROLE);
    const introIndex=blocks.indexOf(intro);
    const desiredIndex=startIndex>=0?startIndex+1:0;
    if(introIndex!==desiredIndex){
      blocks.splice(introIndex,1);
      blocks.splice(desiredIndex,0,intro);
      changed=true;
    }
    course.blocks=blocks;
    return changed;
  }

  function reorderPointBlocks(course=state.course){
    const blocks=Array.isArray(course?.blocks)?course.blocks:[];
    const points=blocks
      .map((b,index)=>({block:b,index,rank:Number.isFinite(Number(b?.content?.rank))&&Number(b.content.rank)>=1?Number(b.content.rank):Number.MAX_SAFE_INTEGER}))
      .filter(x=>x.block?.type==='point'&&!isDefaultIntroduction(x.block));
    if(points.length<2)return false;
    const ordered=points.slice().sort((a,b)=>a.rank-b.rank||a.index-b.index);
    let changed=false;
    points.forEach((slot,i)=>{
      if(blocks[slot.index]!==ordered[i].block){
        blocks[slot.index]=ordered[i].block;
        changed=true;
      }
    });
    course.blocks=blocks;
    return changed;
  }

  function newCourse(title){
    const id=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():uid('course');
    return {id,title:String(title||'Nouveau cours').trim()||'Nouveau cours',status:'editing',
      metadata:{schema:'aurore-assisted-course-v5',editor:'edition_assistee',origin:'assisted_editor'},
      document_pages:{
        cover:{enabled:true,title:String(title||'Nouveau cours'),subtitle:'Bibliothèque numérique d’Aurore',author:'',institution:'',show_date:true},
        toc:{enabled:true,title:'Sommaire',subtitle:'Organisation du document',entries:[]},
        end:{enabled:true,title:'Fin du document',subtitle:'Merci d’avoir consulté ce cours.',contact:'',show_qr:false}
      },
      theme_color:DEFAULT_THEME_COLOR,
      blocks:[systemBlock(START_ROLE,title),defaultIntroductionBlock(),systemBlock(END_ROLE,title)],
      generation:{pages:[],updated_at:null,system_preview:{fingerprint:'',pages:{cover:emptySystemPageState(),toc:emptySystemPageState(),end:emptySystemPageState()},status:'idle',progress:0,stage:'',error:null,updatedAt:null}}};
  }
  function block(type){
    const b={id:uid('block'),type,content:{},generation:{status:'not_generated',page_number:null,page_path:null,page_url:null,updated_at:null,error:null},created_at:new Date().toISOString()};
    if(type==='paragraph')b.content={text:''};
    if(type==='point'){const n=nextPointNumber();b.content={title:'Point de cours '+n,text:'',color:DEFAULT_THEME_COLOR,rank:n};}
    if(type==='exercise'){const n=nextExerciseNumber();b.content={title:'Exercice '+n,statement:'',hint:'',correction_title:'Corrigé '+n,correction:''};}
    if(type==='graphique')b.content={json:{id:uid('graph'),instrument:'function2d',expression:'x^2'}};
    if(type==='wikimedia-image')b.content={imageUrl:'',thumbUrl:'',title:'',caption:'',sourceUrl:'',author:'',license:'',query:''};
    return b;
  }
  function nextExerciseNumber(){
    return activeBlocks().filter(b=>b?.type==='exercise').length+1;
  }
  function nextPointNumber(){
    const ranks=activeBlocks()
      .filter(b=>b?.type==='point'&&!isDefaultIntroduction(b))
      .map(b=>Number(b?.content?.rank))
      .filter(Number.isFinite)
      .map(v=>Math.max(1,Math.floor(v)));
    return (ranks.length?Math.max(...ranks):0)+1;
  }
  function normalizePointColor(v){return /^#[0-9A-F]{6}$/i.test(String(v||''))?String(v).toUpperCase():DEFAULT_THEME_COLOR}
  function pointColorOptions(selected){
    return THEME_COLORS.map(x=>'<option value="'+x.value+'"'+(normalizePointColor(selected)===x.value?' selected':'')+'>'+esc(x.label)+'</option>').join('');
  }
  function activeBlocks(){return Array.isArray(state.course?.blocks)?state.course.blocks:[]}
  function pageNumberFor(b){const blocks=activeBlocks();if(b?.role===START_ROLE)return 1;if(b?.role===END_ROLE)return blocks.length+1;const i=blocks.findIndex(x=>x.id===b.id);return i<0?null:i+2}
  function setStatus(t){const e=document.getElementById('assistedStatus');if(e)e.textContent=t}
  function downloadablePdfParts(){
    const parts=[],seen=new Set();
    const add=(url,label,key)=>{
      const u=String(url||'').trim();if(!u)return;
      const k=String(key||u).trim();if(seen.has(k))return;
      seen.add(k);parts.push({url:u,label});
    };
    const pages=state.canonicalPreview?.pages||{};
    if(String(pages.cover?.status||'').toLowerCase()==='ready')add(pages.cover.pdfUrl,'Couverture','cover');
    if(String(pages.toc?.status||'').toLowerCase()==='ready')add(pages.toc.pdfUrl,'Sommaire','toc');
    for(const b of contentBlocks()){
      const g=b?.generation||{};
      if(String(g.status||'').toLowerCase()!=='ready'||!g.page_url)continue;
      add(g.page_url,'Page '+String(g.page_number||pageNumberFor(b)),g.flow_page_owner_id||g.page_url);
    }
    if(String(pages.end?.status||'').toLowerCase()==='ready')add(pages.end.pdfUrl,'Fin du document','end');
    return parts;
  }
  function refreshDownloadButton(){
    const btn=document.getElementById('aeDownloadPdfCurrent');if(!btn)return;
    const parts=downloadablePdfParts();
    btn.disabled=!parts.length;
    btn.textContent=parts.length?'Télécharger le PDF actuel ('+parts.length+' p.)':'Télécharger le PDF actuel';
    btn.title=parts.length?'Télécharger les pages déjà prêtes, dans leur ordre actuel.':'Aucune page PDF prête pour le moment.';
  }
  async function loadPdfLib(){
    if(globalThis.PDFLib?.PDFDocument)return globalThis.PDFLib;
    if(state.pdfLibPromise)return state.pdfLibPromise;
    state.pdfLibPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
      s.async=true;
      s.onload=()=>globalThis.PDFLib?.PDFDocument?resolve(globalThis.PDFLib):reject(new Error('Bibliothèque PDF indisponible.'));
      s.onerror=()=>reject(new Error('Chargement de la bibliothèque PDF impossible.'));
      document.head.appendChild(s);
    });
    return state.pdfLibPromise;
  }
  async function downloadCurrentPdf(){
    const parts=downloadablePdfParts();
    if(!parts.length){setStatus('Aucune page PDF n’est encore prête.');refreshDownloadButton();return;}
    try{
      setStatus('Assemblage du PDF actuel…');
      const {PDFDocument}=await loadPdfLib();
      const merged=await PDFDocument.create();
      for(let i=0;i<parts.length;i++){
        const p=parts[i];
        setStatus('Assemblage : '+p.label+' ('+(i+1)+'/'+parts.length+')…');
        const response=await fetch(p.url,{cache:'no-store'});
        if(!response.ok)throw new Error('Impossible de récupérer '+p.label+' (HTTP '+response.status+').');
        const source=await PDFDocument.load(await response.arrayBuffer());
        const copied=await merged.copyPages(source,source.getPageIndices());
        copied.forEach(page=>merged.addPage(page));
      }
      const bytes=await merged.save();
      const blob=new Blob([bytes],{type:'application/pdf'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      const safeTitle=String(state.course?.title||'aurore-cours').trim().replace(/[^\p{L}\p{N}_-]+/gu,'-')||'aurore-cours';
      a.href=url;a.download=safeTitle+'-etat-actuel.pdf';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      setStatus('PDF actuel téléchargé · '+parts.length+' élément(s) prêt(s).');
    }catch(e){
      setStatus('Échec du téléchargement : '+String(e?.message||e));
    }
  }

  async function loadCourses(){
    const c=client();
    if(!c){state.courses=[];return[]}
    const {data:{user}={}}=await c.auth.getUser();
    let q=c.from('aurora_assisted_courses').select('id,title,editor_version,pages,created_at,updated_at').order('updated_at',{ascending:false}).limit(50);
    if(user?.id) q=q.eq('created_by',user.id);
    const {data,error}=await q;
    if(error)throw error;
    state.courses=(Array.isArray(data)?data:[]).map(row=>{const cj=ensureCourseStructure(rowCourse(row)||newCourse(row.title));return {...row,status:row.editor_version||'editing',course_json:cj};});
    return state.courses;
  }

  function countPages(c){return contentBlocks(c?.course_json).filter(b=>b?.generation?.page_url).length}
  function formatDate(v){try{return new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))}catch(_){return''}}

  function renderList(){
    const r=root();if(!r)return;
    r.innerHTML=
      '<div class="ae-shell"><header class="ae-head"><div><span class="ae-kicker">Administration · Édition assistée</span><h3>Mes cours en édition</h3><p>Choisis un cours pour reprendre exactement où tu t’es arrêté, ou crée un nouveau cours.</p></div><span class="ae-status" id="assistedStatus">Prêt</span></header>'+
      '<div class="ae-list-actions"><button class="admin-btn primary" id="aeCreate">＋ Créer un cours</button><button class="admin-btn ghost" id="aeRefresh">↻ Actualiser</button></div>'+
      '<div class="ae-course-grid">'+
      (state.courses.length?state.courses.map(c=>{
        const cj=ensureCourseStructure(c.course_json||newCourse(c.title)),count=contentBlocks(cj).length,generated=countPages(c);
        return '<article class="ae-course-card"><div class="ae-course-card-top"><span class="ae-course-status">'+esc(c.status||'editing')+'</span><span>'+generated+' page(s)</span></div><h4>'+esc(c.title)+'</h4><p>'+count+' bloc(s) · dernière modification '+esc(formatDate(c.updated_at||c.created_at))+'</p><div class="ae-course-actions"><button class="admin-btn primary" data-open-course="'+esc(c.id)+'">Ouvrir</button><button class="admin-btn ghost" data-rename-course="'+esc(c.id)+'">Renommer</button></div></article>'
      }).join(''):'<div class="ae-empty"><strong>Aucun cours en édition.</strong><span>Crée ton premier cours pour ouvrir l’atelier.</span></div>')+
      '</div></div>';
    document.getElementById('aeCreate').onclick=()=>createCourseDialog();
    document.getElementById('aeRefresh').onclick=async()=>{try{setStatus('Actualisation…');await loadCourses();renderList();setStatus('Liste actualisée.')}catch(e){setStatus('Impossible d’actualiser.')}};
    r.querySelectorAll('[data-open-course]').forEach(b=>b.onclick=()=>openCourse(b.dataset.openCourse));
    r.querySelectorAll('[data-rename-course]').forEach(b=>b.onclick=()=>renameCourse(b.dataset.renameCourse));
  }

  function dialogHtml(title,body,actions){
    return '<div class="ae-modal" id="aeModal"><div class="ae-dialog"><header><div><span class="ae-kicker">'+esc(title)+'</span></div><button class="admin-btn ghost" id="aeClose">Fermer</button></header>'+body+'<footer>'+actions+'</footer></div></div>';
  }

  function createCourseDialog(){
    const r=root();if(!r)return;
    r.insertAdjacentHTML('beforeend',dialogHtml('Nouveau cours','<label class="ae-dialog-field">Nom du cours<input id="aeNewCourseTitle" value="Nouveau cours" maxlength="180"></label>','<button class="admin-btn primary" id="aeCreateConfirm">Créer et préparer l’aperçu</button>'));
    document.getElementById('aeClose').onclick=()=>document.getElementById('aeModal')?.remove();
    document.getElementById('aeCreateConfirm').onclick=async()=>{
      const title=document.getElementById('aeNewCourseTitle').value.trim();
      if(!title){setStatus('Le titre du document est obligatoire.');return;}
      const c=newCourse(title);ensureCourseStructure(c);state.course=c;state.mode='workspace';state.selected=null;
      await persistCourse(true,false);
      renderWorkspace();
      setStatus('Titre validé · préparation automatique des pages système…');
      void prepareSystemPreview({force:true});
    };
    document.getElementById('aeNewCourseTitle').focus();
  }

  async function renameCourse(id){
    const row=state.courses.find(x=>x.id===id);if(!row)return;
    state.course=ensureCourseStructure(row.course_json);
    const r=root();r?.insertAdjacentHTML('beforeend',dialogHtml('Renommer','<label class="ae-dialog-field">Nom du cours<input id="aeRenameTitle" value="'+esc(row.title)+'" maxlength="180"></label>','<button class="admin-btn primary" id="aeRenameConfirm">Enregistrer</button>'));
    document.getElementById('aeClose').onclick=()=>document.getElementById('aeModal')?.remove();
    document.getElementById('aeRenameConfirm').onclick=async()=>{
      const v=document.getElementById('aeRenameTitle').value.trim();
      if(!v)return;
      state.course.title=v;await persistCourse(true);document.getElementById('aeModal')?.remove();await loadCourses();renderList();
    };
  }

  async function openCourse(id){
    const row=state.courses.find(x=>x.id===id);if(!row)return;
    state.course=ensureCourseStructure(row.course_json||newCourse(row.title));
    state.course.title=String(state.course.title||row.title||'Nouveau cours');
    ensureCourseStructure(state.course);
    syncCanonicalPreviewFromCourse();
    state.mode='workspace';state.selected=null;renderWorkspace();
    if(String(state.course.title||'').trim()){
      const p=storedCanonicalPreview(),fp=canonicalPreviewFingerprint();
      if(p.fingerprint!==fp||!p.documentId||!['queued','processing','ready'].includes(String(p.status||'').toLowerCase())){
        void prepareSystemPreview({force:false});
      }else if(['queued','processing'].includes(String(p.status||'').toLowerCase())){
        void prepareSystemPreview({force:false});
      }
    }
  }

  function normalizeContent(type,v){
    const x=v&&typeof v==='object'&&!Array.isArray(v)?clone(v):{};
    if(type==='graphique') return {json:x};
    if(type==='paragraph') return {text:String(x.text??x.content??x.body??'')};
    if(type==='point') return {title:String(x.title??x.name??'Point de cours'),text:String(x.text??x.content??x.body??''),color:normalizePointColor(x.color),rank:Number.isFinite(Number(x.rank))?Number(x.rank):1};
    if(type==='exercise') return {title:String(x.title??x.name??'Exercice 1'),statement:String(x.statement??x.question??x.enonce??x.content??''),hint:String(x.hint??''),correction_title:String(x.correction_title??x.correctionTitle??'Corrigé 1'),correction:String(x.correction??'')};
    if(type==='wikimedia-image') return {
      imageUrl:String(x.imageUrl??x.url??''),
      thumbUrl:String(x.thumbUrl??x.thumburl??x.imageUrl??x.url??''),
      title:String(x.title??x.name??''),
      caption:String(x.caption??''),
      sourceUrl:String(x.sourceUrl??x.source_url??''),
      author:String(x.author??''),
      license:String(x.license??x.licence??''),
      query:String(x.query??'')
    };
    return x;
  }

  function blockPayload(b){
    if(b.type==='graphique')return b.content?.json||{};
    return b.content||{};
  }

  function validateBlock(b){
    const errors=[];
    if(b.type==='paragraph'&&!String(b.content?.text||'').trim())errors.push('Le paragraphe est vide.');
    if(b.type==='point'){
      if(!String(b.content?.title||'').trim())errors.push('Le nom du point de cours est obligatoire.');
      if(!String(b.content?.text||'').trim())errors.push('Le contenu du point est vide.');
      if(!Number.isFinite(Number(b.content?.rank))||Number(b.content.rank)<1)errors.push('Le rang du point doit être un entier positif.');
    }
    if(b.type==='exercise'){
      if(!String(b.content?.title||'').trim())errors.push('Le titre de l’exercice est obligatoire.');
      if(!String(b.content?.statement||'').trim())errors.push('L’énoncé est vide.');
    }
    if(b.type==='wikimedia-image'){
      if(!String(b.content?.imageUrl||'').startsWith('https://upload.wikimedia.org/'))errors.push('Aucune image Wikimedia valide n’est sélectionnée.');
      if(!String(b.content?.license||'').trim())errors.push('Licence Wikimedia absente.');
      if(!String(b.content?.sourceUrl||'').trim())errors.push('Source Wikimedia absente.');
    }
    if(b.type==='graphique'){
      const g=b.content?.json;
      if(!g||typeof g!=='object'||Array.isArray(g))errors.push('Le JSON du graphique doit être un objet.');
      else{
        if(!String(g.id||'').trim())errors.push('Le graphique doit avoir un id unique.');
        if(!String(g.instrument||g.graph_type||'').trim())errors.push('instrument ou graph_type est obligatoire.');
      }
    }
    b.validation={ok:!errors.length,errors,warnings:[]};
    return b.validation;
  }

  function validateCourse(){
    const bs=activeBlocks(),errors=[];
    if(!String(state.course?.title||'').trim())errors.push('Le nom du cours est obligatoire.');
    bs.forEach(validateBlock);
    const ids=new Set();
    bs.filter(b=>b.type==='graphique').forEach(b=>{const id=String(b.content?.json?.id||'');if(id){if(ids.has(id))errors.push('ID graphique dupliqué : '+id);ids.add(id)}});
    state.course.validation={ok:!errors.length,errors,warnings:[]};
    return state.course.validation;
  }

  function rebuildTocEntries(){
    ensureDocumentPages(state.course);
    if(state.course.document_pages.toc.mode==='manual')return;
    const previous=Array.isArray(state.course.document_pages.toc.entries)?state.course.document_pages.toc.entries:[];
    const byId=new Map(previous.map(x=>[String(x?.id||''),x]));
    const all=contentBlocks();
    const managed=all.filter(b=>String(b?.toc_entry_id||'').trim());
    const managedSet=new Set(managed);
    const source=managed.length?all.filter(b=>isDefaultIntroduction(b)||managedSet.has(b)):all;
    state.course.document_pages.toc.entries=source.map((b,i)=>{
      const key=String(b?.toc_entry_id||b.id||'');
      const old=byId.get(key)||byId.get(String(b.id))||{};
      return {
        id:String(b?.toc_entry_id||old.id||b.id),
        title:String(b.content?.title||old.title||labelFor(b)),
        type:b.type,
        enabled:old.enabled!==false,
        page:pageNumberFor(b)
      };
    });
  }
  function systemPayload(b){
    const start=b.role===START_ROLE;
    ensureDocumentPages(state.course);
    return clone(start?state.course.document_pages.cover:state.course.document_pages.end);
  }
  function tocPayload(){
    ensureDocumentPages(state.course);rebuildTocEntries();
    return clone(state.course.document_pages.toc);
  }

  function labelFor(b){return b.type==='paragraph'?'Paragraphe':b.type==='point'?'Point de cours':b.type==='exercise'?'Exercice':b.type==='graphique'?'Graphique JSON':'Image Wikimedia'}
  function mainText(b){return b.type==='exercise'?b.content?.statement||'':b.type==='graphique'?JSON.stringify(b.content?.json||{},null,2):b.content?.text||b.content?.caption||b.content?.title||''}

  function systemBlockCard(b,i){
    const startPage=b.role===START_ROLE;
    const page=startPage?1:pageNumberFor(b);
    const title=startPage?'Première page · couverture':'Dernière page · mentions, crédits et vérification';
    const subtitle=startPage?'Présentation canonique du document Aurore':'Dernière page canonique de la production Aurore';
    const summary=startPage
      ? '<strong>Document pédagogique</strong><span>'+esc(state.course.title||'Nouveau cours')+'</span><span>Logo Aurore · identité visuelle officielle · format A4</span>'
      : '<strong>Mentions · crédits · vérification</strong><span>Identité de l’édition · QR de vérification · droits & réutilisation</span><span>Page générée par le même renderer que le document final.</span>';
    return '<article class="ae-block ae-system-block" data-block="'+esc(b.id)+'">'+
      '<header class="ae-block-head"><div><span class="ae-block-number">'+String(page).padStart(2,'0')+'</span><strong>'+esc(title)+'</strong><small>'+esc(subtitle)+' · système</small></div><span class="ae-block-state ok">Prévisualisable</span></header>'+
      '<div class="ae-system-content">'+summary+'</div>'+
      '<div class="ae-canonical-preview-progress" data-canonical-preview-role="'+esc(b.role)+'">'+canonicalPreviewProgressMarkup(b.role,startPage?'Aperçu automatique de la couverture':'Aperçu automatique de la page finale')+'</div>'+
      '<div class="ae-block-toolbar"><button class="admin-btn ghost" data-regenerate-page="'+esc(b.id)+'">↻ Régénérer la page</button><button class="admin-btn ghost" data-preview-block="'+esc(b.id)+'">Prévisualiser</button><button class="admin-btn ghost" data-json-system="'+esc(b.id)+'">JSON</button></div>'+
      '<div class="ae-block-result"><span>Aperçu = fragment PDF réellement produit indépendamment par le renderer rapide Aurore.</span></div>'+
      '</article>';
  }

  function tocSystemCard(){
    ensureDocumentPages(state.course);rebuildTocEntries();
    const cfg=state.course.document_pages.toc;
    return '<article class="ae-block ae-system-block ae-toc-system"><header class="ae-block-head"><div><span class="ae-block-number">02</span><strong>Sommaire</strong><small>Page système · indépendante · prévisualisable</small></div><span class="ae-block-state ok">Prévisualisable</span></header>'+
      '<div class="ae-system-content"><strong>Sommaire</strong><span>Table des matières éditable, rendue en fragment PDF indépendant.</span>'+
      '<div class="ae-toc-outline">'+cfg.entries.map((e,i)=>'<span><b>'+String(i+1).padStart(2,'0')+'</b>'+esc(e.title||('Entrée '+(i+1)))+'<em>p. '+esc(e.page??'—')+'</em></span>').join('')+'</div></div>'+
      '<div class="ae-canonical-preview-progress" data-canonical-preview-role="toc">'+canonicalPreviewProgressMarkup('toc','Aperçu du sommaire')+'</div>'+
      '<div class="ae-block-toolbar"><button class="admin-btn ghost" data-regenerate-page="toc">↻ Régénérer la page</button><button class="admin-btn ghost" id="aePreviewToc">Prévisualiser</button><button class="admin-btn ghost" id="aeClearToc">Effacer le contenu</button><button class="admin-btn ghost" id="aeTocJsonInline">Ajouter / valider JSON</button><button class="admin-btn ghost" id="aeCopyTocJson">Copier JSON</button></div>'+
      '<div class="ae-block-result"><span>Les pages sont recalculées à partir de la position réelle de chaque bloc ; aucune page saisie dans le JSON ne reste figée.</span></div></article>';
  }

  function blockCard(b,i){
    if(isSystemBlock(b))return systemBlockCard(b,i);
    const v=validateBlock(b), gen=b.generation||{},page=pageNumberFor(b);
    let editor='';
    if(b.type==='graphique')editor='<textarea class="ae-inline-json" data-edit-json="'+esc(b.id)+'" aria-label="JSON du graphique">'+esc(JSON.stringify(b.content?.json||{},null,2))+'</textarea>';
    else if(b.type==='point')editor='<div class="ae-structured-editor ae-point-editor"><div class="ae-editor-grid"><label>Nom du point<input data-edit-point-title="'+esc(b.id)+'" value="'+esc(b.content?.title||'')+'" maxlength="140"></label><label>Rang<input type="number" min="1" step="1" data-edit-point-rank="'+esc(b.id)+'" value="'+esc(b.content?.rank||1)+'"></label><label>Couleur<select data-edit-point-color="'+esc(b.id)+'">'+pointColorOptions(b.content?.color)+'</select></label></div><label>Contenu<textarea data-edit-text="'+esc(b.id)+'" aria-label="Contenu du point de cours">'+esc(b.content?.text||'')+'</textarea></label><div class="ae-point-style-preview"><span style="--point-color:'+esc(normalizePointColor(b.content?.color))+'"></span><strong>'+esc(b.content?.title||'Point de cours')+'</strong><i></i></div></div>';
    else if(b.type==='exercise')editor='<div class="ae-structured-editor ae-exercise-editor"><label>Titre de l’exercice<input data-edit-exercise-title="'+esc(b.id)+'" value="'+esc(b.content?.title||'')+'" maxlength="140"></label><label>Énoncé<textarea data-edit-exercise-statement="'+esc(b.id)+'" aria-label="Énoncé de l’exercice">'+esc(b.content?.statement||'')+'</textarea></label><label>Indication<textarea class="ae-small-textarea" data-edit-exercise-hint="'+esc(b.id)+'" aria-label="Indication de l’exercice">'+esc(b.content?.hint||'')+'</textarea></label><div class="ae-correction-editor"><strong>Correction conditionnée à cet exercice</strong><label>Titre du corrigé<input data-edit-correction-title="'+esc(b.id)+'" value="'+esc(b.content?.correction_title||'')+'" maxlength="140"></label><textarea data-edit-correction="'+esc(b.id)+'" aria-label="Correction">'+esc(b.content?.correction||'')+'</textarea></div></div>';
    else if(b.type==='wikimedia-image')editor=b.content?.imageUrl?'<div class="ae-selected-image"><img src="'+esc(b.content.imageUrl)+'" alt="'+esc(b.content.title||'Image Wikimedia')+'"><div><strong>'+esc(b.content.title||'Image Wikimedia')+'</strong><small>'+esc(b.content.license||'Licence à vérifier')+'</small></div></div>':'<div class="ae-image-pick-empty">Ajoutez une image Wikimedia avec le bouton dédié.</div>';
    else editor='<textarea data-edit-text="'+esc(b.id)+'" aria-label="Contenu du bloc">'+esc(b.content?.text||'')+'</textarea>';
    return '<article class="ae-block '+(state.selected===b.id?'is-selected':'')+'" data-block="'+esc(b.id)+'">'+
      '<header class="ae-block-head"><div><span class="ae-block-number">'+String(page).padStart(2,'0')+'</span><strong>'+esc(labelFor(b))+'</strong><small>'+esc(b.validation?.ok?'Bloc valide':'À valider')+'</small></div><span class="ae-block-state '+(v.ok?'ok':'bad')+'">'+(v.ok?'Valide':'À corriger')+'</span></header>'+
      '<div class="ae-block-editor">'+editor+'</div>'+
      '<div class="ae-block-toolbar"><button class="admin-btn ghost" data-regenerate-page="'+esc(b.id)+'">↻ Régénérer la page</button><button class="admin-btn ghost" data-preview-block="'+esc(b.id)+'">Prévisualiser</button><button class="admin-btn ghost" data-json-block="'+esc(b.id)+'">JSON</button><button class="admin-btn ghost" data-copy-block="'+esc(b.id)+'">Copier JSON</button><button class="admin-btn ghost" data-duplicate-block="'+esc(b.id)+'">Dupliquer</button><button class="admin-btn ghost" data-clear-block="'+esc(b.id)+'">Vider</button><button class="admin-btn danger" data-delete-block="'+esc(b.id)+'">Supprimer</button><button class="admin-btn primary" data-validate-block="'+esc(b.id)+'">Valider & générer la page</button></div>'+
      '<div class="ae-block-result">'+(gen.status==='ready'&&gen.page_url?'<span class="ae-generated-ok">✓ Page '+page+' générée seule</span><button class="admin-btn ghost" data-preview-block="'+esc(b.id)+'">Visualiser</button><a class="admin-btn ghost" href="'+esc(gen.page_url)+'" download="aurore-page-'+page+'.pdf">Télécharger</a>':gen.status==='generating'?'<div class="ae-generation-progress" role="status" aria-live="polite"><div class="ae-generation-progress-top"><span data-progress-label>'+esc(gen.progress_label||'Génération de la page…')+'</span><strong data-progress-pct>'+Math.round(Number(gen.progress||8))+'%</strong></div><div class="ae-progress-track"><span data-progress-bar style="width:'+Math.max(8,Math.min(100,Number(gen.progress||8)))+'%"></span></div><small>Progression indicative · la page est en cours de génération.</small></div>':gen.status==='error'?'<span class="ae-generated-error">Erreur : '+esc(gen.error||'génération impossible')+'</span>':b.type==='graphique'&&v.ok?'<span>JSON validé · la construction graphique reste destinée au moteur GeoGebra/LuaLaTeX.</span>':'<span>Aucune page générée pour ce bloc.</span>')+'</div>'+
      (v.errors.length?'<div class="ae-block-errors">'+v.errors.map(x=>'• '+esc(x)).join('<br>')+'</div>':'')+
      '<div class="ae-inline-add-row"><label class="ae-inline-add-select"><span>Ajouter sous ce bloc</span><select data-insert-after="'+esc(b.id)+'"><option value="">Sélectionner…</option><option value="paragraph">Paragraphe</option><option value="point">Point de cours</option><option value="wikimedia-image">Image</option></select></label></div>'+
      '</article>';
  }

  function renderWorkspace(){
    const r=root();if(!r||!state.course)return;
    validateCourse();
    ensureCourseStructure(state.course);
    r.innerHTML='<div class="ae-shell ae-workspace"><header class="ae-head"><div><button class="admin-btn ghost" id="aeBack">← Mes cours</button><span class="ae-kicker">Atelier de production séquentielle</span><h3><input id="aeCourseTitle" value="'+esc(state.course.title)+'"></h3><p>Le bloc de début, le sommaire et le bloc de fin sont automatiques. Chaque bloc central génère uniquement son propre fragment PDF indépendant.</p></div><span class="ae-status" id="assistedStatus">'+(state.course.validation?.ok?'Structure valide':'À compléter')+'</span></header>'+
      '<div class="ae-top-options"><div class="ae-top-options-title"><span class="ae-kicker">Options du document</span><strong>Couleur d’accent</strong><small>Elle sera utilisée pour les bordures, repères et éléments mathématiques de la page.</small></div><label class="ae-color-field"><span class="ae-color-swatch" style="background:'+normalizeThemeColor(state.course.theme_color)+'"></span><select id="aeThemeColor" aria-label="Couleur d’accent du document">'+themeColorOptions()+'</select></label></div>'+
      '<div class="ae-workbar"><button class="admin-btn primary" id="aeAddP">＋ Paragraphe</button><button class="admin-btn ghost" id="aeAddPoint">＋ Point de cours</button><button class="admin-btn ghost" id="aeAddEx">＋ Exercice</button><button class="admin-btn ghost" id="aeAddGraph">＋ Graphique JSON</button><button class="admin-btn ghost" id="aeAddWiki">＋ Image Wikimedia</button><button class="admin-btn ghost" id="aeTocJson">Sommaire JSON</button><button class="admin-btn ghost" id="aeSave">Enregistrer le cours</button><button class="admin-btn primary" id="aeDownloadPdfCurrent" disabled>Télécharger le PDF actuel</button></div>'+
      '<div class="ae-sequence-meta"><span>'+contentBlocks().length+' bloc(s) de contenu · 1 début · 1 fin</span><span id="aeSystemPreviewOverall">Pages système indépendantes : '+systemPreviewOverallFromPages(state.canonicalPreview?.pages||{}).ready+'/3 prêtes · '+systemPreviewOverallFromPages(state.canonicalPreview?.pages||{}).progress+'%</span></div>'+
      '<section class="ae-block-stack">'+(activeBlocks().find(b=>b?.role===START_ROLE)?blockCard(activeBlocks().find(b=>b?.role===START_ROLE),0):'')+tocSystemCard()+(contentBlocks().length?contentBlocks().map((b,i)=>blockCard(b,i+2)).join(''):'<div class="ae-empty"><strong>Le cours est vide.</strong><span>Ajoute un paragraphe pour commencer. La couverture et le sommaire resteront toujours présents.</span></div>')+(activeBlocks().find(b=>b?.role===END_ROLE)?blockCard(activeBlocks().find(b=>b?.role===END_ROLE),activeBlocks().length-1):'')+'</section>'+
      '<footer class="ae-work-footer">Les pages PDF déjà prêtes peuvent être téléchargées à tout moment. Le téléchargement peut rester partiel pendant la progression.</footer></div><div class="ae-modal-host" id="aeModalHost"></div>';
    bindWorkspace();
  }

  async function regeneratePage(ref){
    ensureCourseStructure(state.course);
    const isToc=ref==='toc';
    const b=isToc?null:activeBlocks().find(x=>x.id===ref);
    if(!isToc&&!b)return;
    if(isToc||isSystemBlock(b)){
      const kind=isToc?'toc':systemPageKey(b.role);
      const current=state.canonicalPreview?.pages?.[kind]||emptySystemPageState();
      if(String(current.status||'').toLowerCase()==='processing'){
        setStatus(systemPageLabel(kind)+' est déjà en cours de régénération.');
        return;
      }
      setStatus('Régénération de '+systemPageLabel(kind)+'…');
      try{
        await requestIndependentSystemPage(kind,{force:true});
        renderWorkspace();
        setStatus(systemPageLabel(kind)+' régénéré et enregistré.');
      }catch(e){
        renderWorkspace();
        setStatus('Échec de régénération : '+String(e?.message||e));
      }
      return;
    }
    await generateBlock(ref);
  }

  function bindWorkspace(){
    document.getElementById('aeBack').onclick=()=>{state.mode='list';state.course=null;loadCourses().then(renderList)};
    document.getElementById('aeCourseTitle').onchange=e=>{state.course.title=e.target.value.trim()||'Nouveau cours';};
    const themeSelect=document.getElementById('aeThemeColor');
    if(themeSelect)themeSelect.onchange=async e=>{
      state.course.theme_color=normalizeThemeColor(e.target.value);
      const swatch=themeSelect.closest('.ae-color-field')?.querySelector('.ae-color-swatch');
      if(swatch)swatch.style.background=state.course.theme_color;
      await persistCourse(true);
      setStatus('Couleur du document enregistrée.');
    };
    document.getElementById('aeAddP').onclick=()=>addBlock('paragraph');
    document.getElementById('aeAddPoint').onclick=()=>addBlock('point');
    document.getElementById('aeAddEx').onclick=()=>addBlock('exercise');
    document.getElementById('aeAddGraph').onclick=()=>addBlock('graphique');
    document.getElementById('aeAddWiki').onclick=wiki;
    document.getElementById('aeTocJson').onclick=()=>jsonTocDialog();
    const tocTitleInput=document.getElementById('aeTocTitle');
    if(tocTitleInput)tocTitleInput.oninput=e=>{state.course.document_pages.toc.title=e.target.value;};
    const tocSubtitleInput=document.getElementById('aeTocSubtitle');
    if(tocSubtitleInput)tocSubtitleInput.oninput=e=>{state.course.document_pages.toc.subtitle=e.target.value;};
    document.getElementById('aePreviewToc').onclick=()=>previewToc();
    document.getElementById('aeClearToc')?.addEventListener('click',clearTocContent);
    document.getElementById('aeTocJsonInline').onclick=()=>jsonTocDialog();
    document.getElementById('aeSave').onclick=()=>persistCourse(false,true);
    const downloadBtn=document.getElementById('aeDownloadPdfCurrent');
    if(downloadBtn)downloadBtn.onclick=()=>downloadCurrentPdf();
    refreshDownloadButton();
    root().querySelectorAll('[data-edit-point-title]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editPointTitle);if(b){b.content.title=el.value;validateCourse();}});
    root().querySelectorAll('[data-edit-point-rank]').forEach(el=>el.onchange=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editPointRank);if(b){b.content.rank=Math.max(1,parseInt(el.value||'1',10));reorderPointBlocks(state.course);validateCourse();renderWorkspace();setStatus(isDefaultIntroduction(b)?'L’Introduction reste toujours au début du cours.':'Position du point mise à jour selon son rang.');}});
    root().querySelectorAll('[data-edit-point-color]').forEach(el=>el.onchange=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editPointColor);if(b){b.content.color=normalizePointColor(el.value);renderWorkspace();}});
    root().querySelectorAll('[data-edit-exercise-title]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editExerciseTitle);if(b)b.content.title=el.value;});
    root().querySelectorAll('[data-edit-exercise-statement]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editExerciseStatement);if(b){b.content.statement=el.value;validateCourse();}});
    root().querySelectorAll('[data-edit-exercise-hint]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editExerciseHint);if(b)b.content.hint=el.value;});
    root().querySelectorAll('[data-edit-correction-title]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editCorrectionTitle);if(b)b.content.correction_title=el.value;});
    root().querySelectorAll('[data-edit-correction]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editCorrection);if(b)b.content.correction=el.value;});
    root().querySelectorAll('[data-edit-text]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editText);if(b){if(b.type==='exercise')b.content.statement=el.value;else b.content.text=el.value;validateCourse();}});
    root().querySelectorAll('[data-edit-json]').forEach(el=>el.onchange=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editJson);if(!b)return;try{b.content=normalizeContent('graphique',JSON.parse(el.value));validateBlock(b);renderWorkspace();}catch(_){setStatus('JSON graphique invalide.')}});

    root().querySelectorAll('[data-json-system]').forEach(x=>x.onclick=()=>jsonSystemDialog(x.dataset.jsonSystem));
    root().querySelectorAll('[data-regenerate-page]').forEach(x=>x.onclick=()=>regeneratePage(x.dataset.regeneratePage));
    root().querySelectorAll('[data-preview-block]').forEach(x=>x.onclick=()=>previewBlock(x.dataset.previewBlock));
    root().querySelectorAll('[data-json-block]').forEach(x=>x.onclick=()=>jsonDialog(x.dataset.jsonBlock));
    root().querySelectorAll('[data-copy-block]').forEach(x=>x.onclick=()=>copyBlock(x.dataset.copyBlock));
    root().querySelectorAll('[data-duplicate-block]').forEach(x=>x.onclick=()=>duplicateBlock(x.dataset.duplicateBlock));
    root().querySelectorAll('[data-delete-block]').forEach(x=>x.onclick=()=>deleteBlock(x.dataset.deleteBlock));
    root().querySelectorAll('[data-clear-block]').forEach(x=>x.onclick=()=>clearBlock(x.dataset.clearBlock));
    document.getElementById('aeCopyTocJson')?.addEventListener('click',copyTocJson);
    root().querySelectorAll('[data-insert-after]').forEach(x=>x.onchange=async()=>{const type=x.value;x.value='';if(type)await insertBlockAfter(x.dataset.insertAfter,type);});
    root().querySelectorAll('[data-validate-block]').forEach(x=>x.onclick=()=>generateBlock(x.dataset.validateBlock));
  }

  function addBlock(type){
    ensureCourseStructure(state.course);
    const b=block(type),blocks=activeBlocks(),endIndex=blocks.findIndex(x=>x.role===END_ROLE);
    if(endIndex<0)blocks.push(systemBlock(END_ROLE,state.course.title));
    const idx=Math.max(0,blocks.findIndex(x=>x.role===END_ROLE));
    blocks.splice(idx,0,b);state.selected=b.id;validateCourse();renderWorkspace();setStatus('Bloc ajouté au milieu du document, avant la page de fin.');
  }
  async function insertBlockAfter(id,type){
    ensureCourseStructure(state.course);
    const blocks=activeBlocks(),idx=blocks.findIndex(x=>x.id===id),source=idx>=0?blocks[idx]:null;
    if(!source||isSystemBlock(source))return;
    if(!['paragraph','point','wikimedia-image'].includes(type))return;
    const b=block(type);
    blocks.splice(idx+1,0,b);
    state.selected=b.id;
    validateCourse();
    renderWorkspace();
    setStatus(type==='wikimedia-image'?'Image insérée : sélectionne maintenant son illustration.':type==='point'?'Point de cours inséré sous le bloc sélectionné.':'Paragraphe inséré sous le bloc sélectionné.');
    if(type==='wikimedia-image'){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      wiki(b.id);
    }else{
      requestAnimationFrame(()=>root()?.querySelector(type==='point'?'[data-edit-text="'+CSS.escape(b.id)+'"]':'[data-edit-text="'+CSS.escape(b.id)+'"]')?.focus());
    }
  }

  function addParagraphAfter(id){
    ensureCourseStructure(state.course);
    const blocks=activeBlocks(),idx=blocks.findIndex(x=>x.id===id),source=idx>=0?blocks[idx]:null;
    if(!source||source.type!=='paragraph'||isSystemBlock(source))return;
    const b=block('paragraph');b.content={text:''};blocks.splice(idx+1,0,b);
    state.selected=b.id;validateCourse();renderWorkspace();setStatus('Paragraphe inséré à cet emplacement.');
    requestAnimationFrame(()=>root()?.querySelector('[data-edit-text="'+CSS.escape(b.id)+'"]')?.focus());
  }
  function resetBlockContent(b){
    if(!b||isSystemBlock(b))return;
    if(b.type==='paragraph')b.content={text:''};
    else if(b.type==='point')b.content={
      title:String(b.content?.title||'Point de cours'),
      text:'',
      color:normalizePointColor(b.content?.color),
      rank:Number.isFinite(Number(b.content?.rank))?Math.max(1,Number(b.content.rank)):1
    };
    else if(b.type==='exercise')b.content={
      title:String(b.content?.title||'Exercice 1'),
      statement:'',
      hint:'',
      correction_title:String(b.content?.correction_title||'Corrigé 1'),
      correction:''
    };
    else if(b.type==='graphique')b.content={json:{}};
    else if(b.type==='wikimedia-image')b.content={imageUrl:'',thumbUrl:'',title:'',caption:'',sourceUrl:'',author:'',license:'',query:''};
    else b.content={text:''};
    b.generation={status:'not_generated',page_number:null,page_path:null,page_url:null,updated_at:null,error:null};
    return b;
  }

  function clearBlock(id){
    const b=activeBlocks().find(x=>x.id===id);
    if(!b||isSystemBlock(b))return;
    resetBlockContent(b);
    state.selected=b.id;
    validateCourse();
    void persistCourse(true,false);
    renderWorkspace();
    setStatus('Contenu du bloc vidé. Tu peux maintenant coller son JSON.');
    requestAnimationFrame(()=>{
      const selector=b.type==='graphique'
        ?'[data-edit-json="'+CSS.escape(b.id)+'"]'
        :'[data-edit-text="'+CSS.escape(b.id)+'"]';
      root()?.querySelector(selector)?.focus();
    });
  }
  function duplicateBlock(id){
    const b=activeBlocks().find(x=>x.id===id);if(!b||isSystemBlock(b)){if(isSystemBlock(b))setStatus('Les pages de début et de fin sont automatiques et verrouillées.');return;}
    const copy=clone(b);copy.id=uid('block');copy.generation={status:'not_generated',page_number:null,page_path:null,page_url:null,updated_at:null,error:null};
    if(copy.default_introduction){delete copy.default_introduction;copy.content={...copy.content,title:'Point de cours',rank:Math.max(1,...contentBlocks().filter(x=>x.type==='point'&&!isDefaultIntroduction(x)).map(x=>Number(x.content?.rank)||1))+1};}
    if(copy.toc_entry_id)copy.toc_entry_id=''; 
    if(copy.type==='graphique')copy.content.json.id=uid('graph');
    const i=activeBlocks().findIndex(x=>x.id===id);state.course.blocks.splice(i+1,0,copy);reorderPointBlocks(state.course);state.selected=copy.id;renderWorkspace();
  }
  function deleteBlock(id){
    const b=activeBlocks().find(x=>x.id===id);if(isSystemBlock(b)){setStatus('Les pages de début et de fin sont automatiques et verrouillées.');return;}
    if(isDefaultIntroduction(b)){setStatus('L’Introduction est obligatoire et reste toujours au début du cours.');return;}
    state.course.blocks=activeBlocks().filter(x=>x.id!==id);if(state.selected===id)state.selected=null;ensureCourseStructure(state.course);reorderPointBlocks(state.course);renderWorkspace();setStatus('Bloc supprimé.');
  }

  function openBlockModal(title,body){
    const host=document.getElementById('aeModalHost');if(!host)return;
    host.innerHTML='<div class="ae-modal"><div class="ae-dialog"><header><div><span class="ae-kicker">'+esc(title)+'</span></div><button class="admin-btn ghost" id="aeModalClose">Fermer</button></header><div class="ae-dialog-body">'+body+'</div></div></div>';
    document.getElementById('aeModalClose').onclick=()=>host.innerHTML='';
  }

  async function graphPreviewUrl(b){
    const g=b.content?.json||{};
    const direct=String(g.geogebra_image_url||g.image_url||g.preview_url||'').trim();
    if(direct)return direct;
    const path=String(g.geogebra_image_path||g.graph_local_path||'').trim();
    if(!path)return null;
    if(/^https:\/\//i.test(path))return path;
    const c=client();if(!c)return null;
    try{
      const r=await c.storage.from('Pdfs').createSignedUrl(path,600);
      return r.data?.signedUrl||null;
    }catch(_){return null}
  }


  function canonicalPreviewFingerprint(){
    if(!state.course)return '';
    const snapshot=clone(state.course);
    delete snapshot.updated_at;
    if(snapshot.generation)delete snapshot.generation;
    for(const b of Array.isArray(snapshot.blocks)?snapshot.blocks:[]){
      if(b&&b.generation)delete b.generation;
      if(b&&b.validation)delete b.validation;
    }
    return JSON.stringify(snapshot);
  }

  function emptySystemPageState(){return {documentId:null,pdfUrl:null,status:'idle',progress:0,stage:'',error:null,updatedAt:null};}
  function normalizedSystemPages(p){
    const source=p&&typeof p.pages==='object'?p.pages:{};
    return {cover:{...emptySystemPageState(),...(source.cover||{})},toc:{...emptySystemPageState(),...(source.toc||{})},end:{...emptySystemPageState(),...(source.end||{})}};
  }
  function storedCanonicalPreview(){
    const p=state.course?.generation?.system_preview;
    return p&&typeof p==='object'?p:{};
  }
  function systemPageKey(key){return key===START_ROLE?'cover':key===END_ROLE?'end':'toc';}
  function systemPageLabel(key){return key==='cover'?'Aperçu de la couverture':key==='toc'?'Aperçu du sommaire':'Aperçu de la page finale';}
  function canonicalPreviewIsFresh(){const fp=canonicalPreviewFingerprint();return Boolean(fp&&state.canonicalPreview?.fingerprint===fp);}
  function systemPreviewOverallFromPages(pages){
    const entries=Object.values(pages||{});
    const progress=entries.length?Math.round(entries.reduce((a,p)=>a+Math.max(0,Math.min(100,Number(p?.progress||0))),0)/entries.length):0;
    const ready=entries.filter(p=>String(p?.status||'').toLowerCase()==='ready'&&Number(p?.progress||0)>=100).length;
    const error=entries.some(p=>String(p?.status||'').toLowerCase()==='error');
    return {progress,ready,status:ready===3?'ready':error?'error':entries.some(p=>['processing','queued'].includes(String(p?.status||'').toLowerCase()))?'processing':'idle',stage:ready===3?'Trois pages système indépendantes prêtes.':ready+'/3 pages système prêtes.'};
  }
  function syncCanonicalPreviewFromCourse(){
    const p=storedCanonicalPreview(),pages=normalizedSystemPages(p),overall=systemPreviewOverallFromPages(pages);
    state.canonicalPreview={fingerprint:String(p.fingerprint||''),pages,status:overall.status,progress:Number(p.progress??overall.progress),stage:String(p.stage||overall.stage||''),error:String(p.error||'')||null,updatedAt:p.updatedAt||null};
    updateCanonicalPreviewUi();
  }
  function canonicalPreviewProgressMarkup(key,label){
    const kind=systemPageKey(key),p=state.canonicalPreview?.pages?.[kind]||emptySystemPageState(),fresh=canonicalPreviewIsFresh();
    const visible=fresh?p:{...emptySystemPageState(),stage:'Cette version doit être régénérée.'};
    const status=String(visible.status||'idle').toLowerCase(),pct=Math.max(0,Math.min(100,Number(visible.progress||0)));
    const ready=status==='ready'&&pct>=100;
    return '<div class="ae-generation-progress ae-canonical-progress" data-canonical-preview="'+esc(kind)+'" data-canonical-preview-kind="'+esc(kind)+'" data-preview-status="'+esc(status)+'"><div class="ae-generation-progress-top"><span data-canonical-preview-stage>'+esc(label)+' · '+esc(visible.stage||'Préparation…')+'</span><strong data-canonical-preview-pct>'+Math.round(pct)+'%</strong></div><div class="ae-progress-track"><span data-canonical-preview-bar style="width:'+pct+'%"></span></div><small data-canonical-preview-detail>'+esc(ready?'PDF de page prêt · fragment indépendant réutilisable.':status==='processing'?'Rendu indépendant en cours.':status==='queued'?'Page système créée · rendu prêt à démarrer.':status==='error'?'La génération de cette page a échoué.':'Prévisualisation indépendante à générer.')+'</small></div>';
  }
  function updateCanonicalPreviewUi(){
    const fresh=canonicalPreviewIsFresh(),pages=state.canonicalPreview?.pages||normalizedSystemPages({});
    refreshDownloadButton();
    root()?.querySelectorAll('[data-canonical-preview]').forEach(el=>{
      const kind=el.dataset.canonicalPreviewKind||'cover',p=fresh?(pages[kind]||emptySystemPageState()):emptySystemPageState();
      const status=String(p.status||'idle').toLowerCase(),pct=Math.max(0,Math.min(100,Number(p.progress||0)));
      const label=el.querySelector('[data-canonical-preview-stage]'),bar=el.querySelector('[data-canonical-preview-bar]'),pctEl=el.querySelector('[data-canonical-preview-pct]'),detail=el.querySelector('[data-canonical-preview-detail]');
      if(bar)bar.style.width=pct+'%';if(pctEl)pctEl.textContent=Math.round(pct)+'%';
      if(label)label.textContent=systemPageLabel(kind)+' · '+String(p.stage||'Prévisualisation indépendante à générer.');
      if(detail)detail.textContent=p.error||((status==='ready'&&pct>=100)?'PDF de page prêt · fragment indépendant réutilisable.':status==='processing'?'Rendu indépendant en cours.':status==='queued'?'Page système créée · rendu prêt à démarrer.':fresh?'Prévisualisation indépendante à lancer.':'Cette version du document doit être régénérée.');
      el.dataset.previewStatus=status;
    });
    const overall=systemPreviewOverallFromPages(pages),head=document.getElementById('aeSystemPreviewOverall');
    if(head)head.textContent='Pages système indépendantes : '+overall.ready+'/3 prêtes · '+overall.progress+'%';
  }
  function setSystemPageState(kind,patch,{persist=false}={}){
    const pages=normalizedSystemPages(state.canonicalPreview),nextPage={...pages[kind],...patch,updatedAt:new Date().toISOString()},nextPages={...pages,[kind]:nextPage},overall=systemPreviewOverallFromPages(nextPages);
    const next={...state.canonicalPreview,pages:nextPages,status:overall.status,progress:overall.progress,stage:overall.stage,error:nextPage.error||state.canonicalPreview.error||null,updatedAt:new Date().toISOString()};
    state.canonicalPreview=next;
    if(state.course)state.course.generation={...(state.course.generation||{}),system_preview:{...next}};
    updateCanonicalPreviewUi();
    if(persist)void persistCourse(true,false);
  }
  async function independentSystemPageStatus(documentId){
    const token=(typeof session!=='undefined'&&session?.access_token)||await freshToken();
    const r=await fetch(SUPABASE_URL+'/functions/v1/aurora-assisted-system-page',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_ANON_KEY},body:JSON.stringify({mode:'status',generated_document_id:Number(documentId)})});
    const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={error:t}};if(!r.ok||!d.ok)throw new Error(d.error||('Statut page système HTTP '+r.status));return d;
  }
  async function requestIndependentSystemPage(kind,{force=false}={}){
    ensureDocumentPages(state.course);
    const fp=canonicalPreviewFingerprint(),current=state.canonicalPreview?.pages?.[kind]||emptySystemPageState();
    const token=(typeof session!=='undefined'&&session?.access_token)||await freshToken();
    const theme=normalizeThemeColor(state.course.theme_color);

    async function renderIndependent(documentId){
      setSystemPageState(kind,{documentId,status:'processing',progress:12,stage:'Rendu indépendant en cours',error:null},{persist:true});
      const r=await fetch(SUPABASE_URL+'/functions/v1/aurora-assisted-system-page',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+token,
          'apikey':SUPABASE_ANON_KEY
        },
        body:JSON.stringify({
          mode:'render',
          generated_document_id:Number(documentId),
          theme_color:theme
        })
      });
      const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={error:t}};
      if(!r.ok||!d.ok)throw new Error(d.error||('Rendu page système HTTP '+r.status));
      const pdfUrl=d.page_url||d.pdf_url||null;
      setSystemPageState(kind,{status:'ready',progress:100,stage:'PDF de page prêt',pdfUrl,error:null},{persist:true});
      return d;
    }

    if(!force&&canonicalPreviewIsFresh()&&current.documentId){
      const existing=String(current.status||'').toLowerCase();
      if(existing==='ready'&&current.pdfUrl)return current;
      if(['queued','processing'].includes(existing)){
        return await renderIndependent(current.documentId);
      }
    }

    const b=kind==='cover'?activeBlocks().find(x=>x?.role===START_ROLE):kind==='end'?activeBlocks().find(x=>x?.role===END_ROLE):null;
    const pageData=kind==='toc'?tocPayload():clone(kind==='cover'?state.course.document_pages.cover:state.course.document_pages.end);
    if(kind==='end')pageData.page_number=pageNumberFor(b);
    setSystemPageState(kind,{status:'processing',progress:5,stage:'Création du fragment indépendant',error:null},{persist:true});

    const create=await fetch(SUPABASE_URL+'/functions/v1/aurora-assisted-system-page',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+token,
        'apikey':SUPABASE_ANON_KEY
      },
      body:JSON.stringify({
        mode:'create',
        course_id:state.course.id,
        page_kind:kind,
        title:state.course.title,
        theme_color:theme,
        page_data:pageData
      })
    });
    const ct=await create.text();let cd={};try{cd=ct?JSON.parse(ct):{}}catch(_){cd={error:ct}};
    if(!create.ok||!cd.ok)throw new Error(cd.error||('Création page système HTTP '+create.status));
    const documentId=Number(cd.generated_document_id||0);
    if(!documentId)throw new Error('Identifiant de page système absent.');

    setSystemPageState(kind,{documentId,status:'processing',progress:8,stage:'Fragment créé · rendu indépendant en cours'},{persist:true});
    return await renderIndependent(documentId);
  }
  async function prepareSystemPreview({force=false}={}){
    ensureCourseStructure(state.course);
    const title=String(state.course?.title||'').trim();if(!title){setStatus('Le titre du document est obligatoire.');return null;}
    const fp=canonicalPreviewFingerprint(),base={fingerprint:fp,pages:normalizedSystemPages({}),status:'processing',progress:0,stage:'Préparation de 3 pages indépendantes',error:null,updatedAt:new Date().toISOString()};
    if(force||!canonicalPreviewIsFresh()){state.canonicalPreview=base;if(state.course)state.course.generation={...(state.course.generation||{}),system_preview:{...base}};updateCanonicalPreviewUi();await persistCourse(true,false);}
    const kinds=['cover','toc','end'];
    const results=await Promise.all(kinds.map(kind=>requestIndependentSystemPage(kind,{force})));
    setStatus('Pages système générées indépendamment · couverture, sommaire et page finale disponibles.');
    return {pages:results};
  }

  function loadPdfJsForAssistedPreview(){
    if(typeof pdfjsLib!=='undefined'){
      try{pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'}catch(_){}
      return Promise.resolve(pdfjsLib);
    }
    if(window.__AURORE_PDFJS_ASSISTED_PROMISE)return window.__AURORE_PDFJS_ASSISTED_PROMISE;
    window.__AURORE_PDFJS_ASSISTED_PROMISE=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.async=true;
      script.onload=()=>{
        try{pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'}catch(_){}
        resolve(pdfjsLib);
      };
      script.onerror=()=>{
        window.__AURORE_PDFJS_ASSISTED_PROMISE=null;
        reject(new Error('PDF.js indisponible.'));
      };
      document.head.appendChild(script);
    });
    return window.__AURORE_PDFJS_ASSISTED_PROMISE;
  }

  async function renderAssistedPdfPreview(url,canvasId,loadingId,pageNumber=1){
    const canvas=document.getElementById(canvasId),loading=document.getElementById(loadingId);if(!canvas)return;
    try{
      const pdfjs=await loadPdfJsForAssistedPreview();if(!canvas.isConnected)return;
      if(loading)loading.textContent='Chargement de la page…';
      let buffer=cachedPreviewBuffer(url);
      if(!buffer){
        const response=await fetch(url,{cache:'force-cache'});
        if(!response.ok)throw new Error('HTTP '+response.status);
        buffer=await response.arrayBuffer();if(!buffer.byteLength)throw new Error('PDF vide.');
        rememberPreviewBuffer(url,buffer);
      }
      const pdf=await pdfjs.getDocument({data:new Uint8Array(buffer.slice(0)),stopAtErrors:false}).promise;
      const requestedPage=Number(pageNumber||1);
      const actualPage=requestedPage<=0?pdf.numPages:Math.min(requestedPage,pdf.numPages);
      const page=await pdf.getPage(Math.max(1,actualPage));if(!canvas.isConnected)return;
      const wrap=canvas.parentElement,targetWidth=Math.max(320,Math.min(760,(wrap?.clientWidth||760)-24)),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:targetWidth/base.width});
      const ratio=Math.min(window.devicePixelRatio||1,1.75);
      canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=Math.round(viewport.width)+'px';canvas.style.height=Math.round(viewport.height)+'px';
      const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('Canvas indisponible.');
      await page.render({canvasContext:ctx,viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:null}).promise;
      if(loading)loading.remove();
      const schedule=window.requestIdleCallback?cb=>window.requestIdleCallback(cb,{timeout:900}):cb=>setTimeout(cb,0);
      schedule(async()=>{
        if(!canvas.isConnected||!wrap)return;
        const textLayer=document.createElement('div');
        textLayer.className='ae-pdf-text-layer';textLayer.setAttribute('aria-label','Texte sélectionnable de la page');
        textLayer.style.width=Math.round(viewport.width)+'px';textLayer.style.height=Math.round(viewport.height)+'px';wrap.appendChild(textLayer);
        try{
          const tc=await page.getTextContent();if(!canvas.isConnected){textLayer.remove();return;}
          if(typeof pdfjs.renderTextLayer==='function'){
            const task=pdfjs.renderTextLayer({textContent:tc,container:textLayer,viewport});if(task?.promise)await task.promise;
          }else{
            for(const item of tc.items||[]){
              if(!canvas.isConnected)break;
              const span=document.createElement('span');span.textContent=item.str||'';
              const tx=item.transform||[1,0,0,1,0,0],p=viewport.convertToViewportPoint(tx[4],tx[5]),fs=Math.max(6,Math.abs(tx[3]||10));
              span.style.left=p[0]+'px';span.style.top=(p[1]-fs)+'px';span.style.fontSize=fs+'px';textLayer.appendChild(span);
            }
          }
        }catch(_){textLayer.remove();}
      });
    }catch(e){
      if(canvas.isConnected){
        const host=canvas.parentElement;
        if(host)host.innerHTML='<div class="ae-preview-render-error"><strong>Prévisualisation indisponible</strong><span>Le PDF a bien été généré. Ouvre-le ou télécharge-le pour le consulter.</span></div>';
      }
    }
  }

  async function progressivePreviewBlock(id){
    ensureCourseStructure(state.course);
    const current=activeBlocks().find(x=>x.id===id);if(!current||isSystemBlock(current))return;

    const currentIndex=activeBlocks().findIndex(x=>x.id===id);
    const previous=activeBlocks().slice(0,currentIndex).filter(b=>!isSystemBlock(b));
    const allSteps=[];
    const cover=activeBlocks().find(x=>x?.role===START_ROLE);
    const toc=activeBlocks().find(x=>x?.role==='document-toc');
    const coverState=state.canonicalPreview?.pages?.cover;
    const tocState=state.canonicalPreview?.pages?.toc;

    if(cover&&coverState?.pdfUrl)allSteps.push({kind:'pdf',label:'Page 1 · Couverture',url:coverState.pdfUrl,number:1,status:'ready',source:cover});
    if(tocState?.pdfUrl)allSteps.push({kind:'pdf',label:'Page 2 · Sommaire',url:tocState.pdfUrl,number:2,status:'ready',source:toc});

    for(const b of previous){
      const page=pageNumberFor(b),url=String(b?.generation?.page_url||'').trim();
      if(url)allSteps.push({kind:'pdf',label:'Page '+page+' · '+labelFor(b),url,number:page,status:'ready',source:b});
      else allSteps.push({kind:'pending',label:'Page '+page+' · '+labelFor(b),number:page,status:'pending',source:b});
    }

    const currentPage=pageNumberFor(current),currentUrl=String(current?.generation?.page_url||'').trim();
    if(currentUrl){
      allSteps.push({kind:'pdf',label:'Page '+currentPage+' · '+labelFor(current)+' · bloc actuel',url:currentUrl,number:currentPage,status:'ready',source:current,current:true});
    }else if(current.type==='graphique'){
      const graphUrl=await graphPreviewUrl(current);
      if(graphUrl)allSteps.push({kind:'image',label:'Page '+currentPage+' · Graphique · bloc actuel',url:graphUrl,number:currentPage,status:'current-image',source:current,current:true});
      else allSteps.push({kind:'pending',label:'Page '+currentPage+' · '+labelFor(current)+' · bloc actuel',number:currentPage,status:'current-pending',source:current,current:true});
    }else if(current.type==='wikimedia-image'&&current.content?.imageUrl){
      allSteps.push({kind:'image',label:'Page '+currentPage+' · Image Wikimedia · bloc actuel',url:current.content.imageUrl,number:currentPage,status:'current-image',source:current,current:true});
    }else{
      allSteps.push({kind:'text',label:'Page '+currentPage+' · '+labelFor(current)+' · bloc actuel',number:currentPage,status:'current-draft',source:current,current:true});
    }

    const readyCount=allSteps.filter(x=>x.kind==='pdf').length;
    const totalCount=allSteps.length;
    const body='<div class="ae-progressive-preview">'+
      '<div class="ae-page-preview-meta"><strong>Progression du document jusqu’au bloc '+currentPage+'</strong><span>'+readyCount+' page(s) PDF déjà produite(s) · '+totalCount+' étape(s) affichée(s)</span></div>'+
      '<div class="ae-progressive-preview-note">La prévisualisation suit l’ordre réel du document : couverture → sommaire → blocs précédents → bloc actuel. Les blocs futurs restent volontairement hors de cette vue.</div>'+
      '<div class="ae-progressive-preview-stack">'+
        allSteps.map((step,i)=>{
          const b=step.source,page=step.number;
          if(step.kind==='pdf'){
            const canvasId='aeProgressivePdf_'+String(id).replace(/[^a-zA-Z0-9_-]/g,'_')+'_'+i,loadingId=canvasId+'_loading';
            return '<section class="ae-progressive-page '+(step.current?'is-current':'')+'" data-progressive-index="'+i+'">'+
              '<header><strong>'+esc(step.label)+'</strong><span>'+esc(step.current?'Bloc actuellement sélectionné':'Bloc précédent / page déjà produite')+'</span></header>'+
              '<div class="ae-page-preview-canvas-wrap"><div id="'+loadingId+'" class="ae-preview-loading">Chargement de la page PDF…</div><canvas id="'+canvasId+'" class="ae-page-preview-canvas" aria-label="'+esc(step.label)+'"></canvas></div>'+
            '</section>';
          }
          if(step.kind==='image'){
            return '<section class="ae-progressive-page is-current"><header><strong>'+esc(step.label)+'</strong><span>Prévisualisation visuelle du bloc actuel</span></header><div class="ae-progressive-draft"><img class="ae-preview-image" src="'+esc(step.url)+'" alt="'+esc(labelFor(b))+'"></div></section>';
          }
          if(step.kind==='text'){
            return '<section class="ae-progressive-page is-current"><header><strong>'+esc(step.label)+'</strong><span>Bloc actuel · PDF pas encore généré</span></header><div class="ae-progressive-draft"><pre>'+esc(mainText(b)||'Bloc vide')+'</pre></div></section>';
          }
          return '<section class="ae-progressive-page '+(step.current?'is-current':'')+' is-pending"><header><strong>'+esc(step.label)+'</strong><span>'+esc(step.current?'Bloc actuel · en attente de génération':'Bloc précédent · PDF non encore généré')+'</span></header><div class="ae-progressive-pending">Cette page n’est pas encore disponible en PDF. La progression conserve néanmoins sa position réelle dans le document.</div></section>';
        }).join('')+
      '</div>'+
      '<div class="ae-page-preview-actions"><button class="admin-btn primary" id="aeCloseProgressivePreview">Fermer</button></div>'+
    '</div>';

    openBlockModal('Prévisualisation progressive du document',body);
    document.getElementById('aeCloseProgressivePreview')?.addEventListener('click',()=>document.getElementById('aeModalHost').innerHTML='');

    for(const [i,step] of allSteps.entries()){
      if(step.kind!=='pdf')continue;
      const canvasId='aeProgressivePdf_'+String(id).replace(/[^a-zA-Z0-9_-]/g,'_')+'_'+i;
      const loadingId=canvasId+'_loading';
      if(document.getElementById(canvasId))await renderAssistedPdfPreview(step.url,canvasId,loadingId,1);
    }
    setStatus('Prévisualisation progressive prête : pages antérieures + bloc actuel.');
  }

  async function previewBlock(id){
    const b=activeBlocks().find(x=>x.id===id);if(!b)return;

    if(isSystemBlock(b)){
      const kind=systemPageKey(b.role),canvasId='aeSystemPreview_'+kind+'_'+String(b.id).replace(/[^a-zA-Z0-9_-]/g,'_'),loadingId=canvasId+'_loading';
      const title=systemPageLabel(kind);
      const body='<div class="ae-page-preview"><div class="ae-page-preview-meta"><strong>'+esc(title)+'</strong><span>PDF indépendant · renderer rapide Aurore · fragment d’une seule page</span></div>'+canonicalPreviewProgressMarkup(kind,title)+'<div class="ae-page-preview-canvas-wrap"><div id="'+loadingId+'" class="ae-preview-loading">Préparation de la page indépendante…</div><canvas id="'+canvasId+'" class="ae-page-preview-canvas" aria-label="'+esc(title)+'"></canvas></div><div class="ae-page-preview-actions"><button class="admin-btn primary" id="aeCloseCanonicalPreview">Fermer</button></div></div>';
      openBlockModal(title,body);
      document.getElementById('aeCloseCanonicalPreview')?.addEventListener('click',()=>document.getElementById('aeModalHost').innerHTML='');
      setStatus('Génération indépendante de la page système…');
      try{
        const result=await requestIndependentSystemPage(kind,{force:false});
        const url=result?.pdf_url||result?.pdfUrl||state.canonicalPreview?.pages?.[kind]?.pdfUrl;
        if(!url)throw new Error('PDF de page indépendante indisponible.');
        if(!document.getElementById(canvasId))return;
        const actions=document.querySelector('#aeModalHost .ae-page-preview-actions');
        if(actions)actions.insertAdjacentHTML('beforeend','<a class="admin-btn ghost" href="'+esc(url)+'" target="_blank" rel="noopener">Ouvrir le PDF</a>');
        await renderAssistedPdfPreview(url,canvasId,loadingId,1);
        setStatus('Prévisualisation indépendante prête.');
      }catch(e){
        const host=document.getElementById('aeModalHost');if(host){const box=host.querySelector('.ae-page-preview-canvas-wrap');if(box)box.innerHTML='<div class="ae-preview-render-error"><strong>Aperçu indépendant indisponible</strong><span>'+esc(String(e?.message||e))+'</span></div>';}
        setStatus('Aperçu indépendant indisponible.');
      }
      return;
    }
    await progressivePreviewBlock(id);
  }

  async function previewToc(){
    ensureDocumentPages(state.course);rebuildTocEntries();
    const canvasId='aeIndependentTocPreview',loadingId=canvasId+'_loading';
    const body='<div class="ae-page-preview"><div class="ae-page-preview-meta"><strong>Page 2 · Sommaire</strong><span>PDF indépendant · renderer rapide Aurore · fragment d’une seule page</span></div>'+canonicalPreviewProgressMarkup('toc','Génération du sommaire')+'<div class="ae-page-preview-canvas-wrap"><div id="'+loadingId+'" class="ae-preview-loading">Préparation du sommaire indépendant…</div><canvas id="'+canvasId+'" class="ae-page-preview-canvas" aria-label="Prévisualisation exacte du sommaire"></canvas></div><div class="ae-page-preview-actions"><button class="admin-btn primary" id="aeCloseCanonicalTocPreview">Fermer</button></div></div>';
    openBlockModal('Prévisualisation exacte du sommaire',body);
    document.getElementById('aeCloseCanonicalTocPreview')?.addEventListener('click',()=>document.getElementById('aeModalHost').innerHTML='');
    setStatus('Génération indépendante du sommaire…');
    try{
      const result=await requestIndependentSystemPage('toc',{force:false});
      const url=result?.pdf_url||result?.pdfUrl||state.canonicalPreview?.pages?.toc?.pdfUrl;
      if(!url)throw new Error('PDF du sommaire indépendant indisponible.');
      if(!document.getElementById(canvasId))return;
      const actions=document.querySelector('#aeModalHost .ae-page-preview-actions');
      if(actions)actions.insertAdjacentHTML('beforeend','<a class="admin-btn ghost" href="'+esc(url)+'" target="_blank" rel="noopener">Ouvrir le PDF</a>');
      await renderAssistedPdfPreview(url,canvasId,loadingId,1);
      setStatus('Sommaire indépendant prêt.');
    }catch(e){
      const host=document.getElementById('aeModalHost');if(host){const box=host.querySelector('.ae-page-preview-canvas-wrap');if(box)box.innerHTML='<div class="ae-preview-render-error"><strong>Sommaire indisponible</strong><span>'+esc(String(e?.message||e))+'</span></div>';}
      setStatus('Sommaire indépendant indisponible.');
    }
  }

  function clearTocContent(){
    ensureDocumentPages(state.course);
    state.course.document_pages.toc={...state.course.document_pages.toc,mode:'manual',entries:[]};
    state.canonicalPreview={...state.canonicalPreview,fingerprint:'',documentId:null,pdfUrl:null,status:'idle',progress:0,stage:'Sommaire effacé · aperçu à régénérer.',error:null};
    state.course.generation={...(state.course.generation||{}),system_preview:{...state.canonicalPreview}};
    void persistCourse(true,false);
    renderWorkspace();
    setStatus('Contenu du sommaire effacé. Les blocs existants sont conservés pour éviter toute perte de travail.');
  }

  function copyTocJson(){
    const txt=JSON.stringify(tocPayload(),null,2);
    navigator.clipboard?.writeText(txt).then(
      ()=>setStatus('JSON du sommaire copié.'),
      ()=>setStatus('Copie du sommaire indisponible.')
    );
  }

  function tocEntryBlockType(type){
    const t=String(type||'section').trim().toLowerCase();
    if(['paragraph','paragraphe','texte','text'].includes(t))return 'paragraph';
    if(['exercise','exercice','problem','probleme'].includes(t))return 'exercise';
    if(['graphique','graph','graphique-json','json'].includes(t))return 'graphique';
    if(['wikimedia-image','image','illustration','wikimedia'].includes(t))return 'wikimedia-image';
    return 'point';
  }

  function syncBlocksFromToc(entries){
    ensureCourseStructure(state.course);
    const incoming=Array.isArray(entries)?clone(entries):[];
    const introIndex=incoming.findIndex(e=>String(e?.id||'').trim()==='toc-introduction'||String(e?.title||'').trim().toLowerCase()==='introduction');
    let normalized;
    if(introIndex>=0){
      const introEntry={...(incoming.splice(introIndex,1)[0]||{}),id:'toc-introduction',title:'Introduction',type:'point',enabled:true};
      normalized=[introEntry,...incoming];
    }else{
      normalized=[{id:'toc-introduction',title:'Introduction',type:'point',enabled:true},...incoming];
    }
    const middle=contentBlocks();
    const existingBySource=new Map(
      middle
        .filter(b=>String(b?.toc_entry_id||'').trim())
        .map(b=>[String(b.toc_entry_id),b])
    );
    const managedIds=new Set();
    const synced=[];
    normalized.forEach((entry,i)=>{
      let sourceId=String(entry?.id||('toc-'+(i+1))).trim();
      if(!sourceId)sourceId='toc-'+(i+1);
      if(managedIds.has(sourceId))sourceId='toc-'+(i+1)+'-'+uid('entry').slice(-6);
      const title=String(entry?.title||'').trim()||'Point de cours '+(i+1);
      const type=tocEntryBlockType(entry?.type);
      let b=sourceId==='toc-introduction'
        ?middle.find(isDefaultIntroduction)
        :existingBySource.get(sourceId);
      if(!b){
        b=block(type);
        b.toc_entry_id=sourceId;
      }
      b.type=type;
      if(type==='point'){
        b.content={
          ...b.content,
          title:sourceId==='toc-introduction'?'Introduction':title,
          text:String(b.content?.text||''),
          color:normalizePointColor(b.content?.color),
          rank:sourceId==='toc-introduction'?1:i+1
        };
        if(sourceId==='toc-introduction')b.default_introduction=true;
      }else if(type==='exercise'){
        b.content={
          ...b.content,
          title,
          statement:String(b.content?.statement||''),
          hint:String(b.content?.hint||''),
          correction_title:String(b.content?.correction_title||('Corrigé '+(i+1))),
          correction:String(b.content?.correction||'')
        };
      }else if(type==='paragraph'){
        b.content={text:String(b.content?.text||'')};
      }else if(type==='graphique'){
        b.content={json:b.content?.json&&typeof b.content.json==='object'?b.content.json:{}};
      }else if(type==='wikimedia-image'){
        b.content={...(b.content||{}),title:String(b.content?.title||title)};
      }
      managedIds.add(sourceId);
      synced.push(b);
    });
    const firstManagedIndex=middle.reduce((min,b,i)=>{
      return String(b?.toc_entry_id||'').trim()&&managedIds.has(String(b.toc_entry_id))?Math.min(min,i):min;
    },Number.POSITIVE_INFINITY);
    const anchor=Number.isFinite(firstManagedIndex)?firstManagedIndex:0;
    const before=middle.slice(0,anchor).filter(b=>!managedIds.has(String(b?.toc_entry_id||'')));
    const after=middle.slice(anchor).filter(b=>!managedIds.has(String(b?.toc_entry_id||'')));
    const start=activeBlocks().find(b=>b?.role===START_ROLE)||systemBlock(START_ROLE,state.course.title);
    const end=activeBlocks().find(b=>b?.role===END_ROLE)||systemBlock(END_ROLE,state.course.title);
    state.course.blocks=[start,...before,...synced,...after,end];
    ensureCourseStructure(state.course);
    reorderPointBlocks(state.course);
    rebuildTocEntries();
  }

  function jsonTocDialog(){
    const payload=tocPayload();
    openBlockModal('JSON du sommaire','<textarea id="aeDialogJson" class="ae-dialog-json" spellcheck="false">'+esc(JSON.stringify(payload,null,2))+'</textarea><div class="ae-dialog-actions"><button class="admin-btn ghost" id="aeClearTocInDialog">Effacer le contenu</button><button class="admin-btn ghost" id="aeCopyTocInDialog">Copier JSON</button><button class="admin-btn primary" id="aeApplyJson">Valider et créer les blocs</button></div>');
    document.getElementById('aeClearTocInDialog').onclick=clearTocContent;
    document.getElementById('aeCopyTocInDialog').onclick=()=>copyTocJson();
    document.getElementById('aeApplyJson').onclick=async()=>{
      try{
        const v=JSON.parse(document.getElementById('aeDialogJson').value);
        if(!v||typeof v!=='object'||!Array.isArray(v.entries))throw new Error('Le JSON doit contenir un tableau entries.');
        const entries=v.entries.map((e,i)=>{
          if(!e||typeof e!=='object'||Array.isArray(e))throw new Error('Chaque entrée doit être un objet JSON.');
          const title=String(e.title??'').trim();
          if(!title)throw new Error('Chaque entrée doit avoir un title.');
          return {id:String(e.id||'toc-'+(i+1)),title,type:String(e.type||'section'),enabled:e.enabled!==false};
        });
        syncBlocksFromToc(entries);
        state.course.document_pages.toc={...state.course.document_pages.toc,...v,mode:'auto',entries:state.course.document_pages.toc.entries};
        await persistCourse(true,false);
        renderWorkspace();
        setStatus(entries.length+' bloc(s) de cours préparé(s) à partir du sommaire. Colle maintenant le JSON de texte de chaque bloc.');
      }catch(e){
        setStatus('JSON du sommaire invalide : '+String(e?.message||e));
      }
    };
  }

  function systemBlockCardPlaceholder(){}

  function jsonSystemDialog(id){
    const b=activeBlocks().find(x=>x.id===id);if(!b)return;
    const payload=systemPayload(b);
    openBlockModal('JSON de la page système','<textarea id="aeDialogJson" class="ae-dialog-json">'+esc(JSON.stringify(payload,null,2))+'</textarea><div class="ae-dialog-actions"><button class="admin-btn primary" id="aeApplyJson">Appliquer le JSON</button></div>');
    document.getElementById('aeApplyJson').onclick=()=>{
      try{
        const v=JSON.parse(document.getElementById('aeDialogJson').value);
        if(b.role===START_ROLE)state.course.document_pages.cover={...state.course.document_pages.cover,...v};
        else state.course.document_pages.end={...state.course.document_pages.end,...v};
        syncSystemPages(state.course);renderWorkspace();setStatus('JSON de la page appliqué.');
      }catch(_){setStatus('JSON invalide.')}
    };
  }

  function jsonDialog(id){
    const b=activeBlocks().find(x=>x.id===id);if(!b)return;
    const payload=blockPayload(b);
    openBlockModal('JSON du bloc','<textarea id="aeDialogJson" class="ae-dialog-json">'+esc(JSON.stringify(payload,null,2))+'</textarea><div class="ae-dialog-actions"><button class="admin-btn primary" id="aeApplyJson">Appliquer le JSON</button></div>');
    document.getElementById('aeApplyJson').onclick=()=>{try{const v=JSON.parse(document.getElementById('aeDialogJson').value);b.content=normalizeContent(b.type,v);validateCourse();document.getElementById('aeModalHost').innerHTML='';renderWorkspace();setStatus('JSON appliqué au bloc.')}catch(_){setStatus('JSON invalide.')}};
  }

  async function copyBlock(id){
    const b=activeBlocks().find(x=>x.id===id);if(!b)return;
    const txt=JSON.stringify(blockPayload(b),null,2);
    try{await navigator.clipboard.writeText(txt);setStatus('JSON copié.')}catch(_){setStatus('Copie indisponible.')}
  }

  async function persistCourse(silent,refreshList=false){
    ensureCourseStructure(state.course);
    const c=client();if(!c){localStorage.setItem('aurore_assisted_course',JSON.stringify(state.course));if(!silent)setStatus('Brouillon local enregistré.');return;}
    try{
      state.course.updated_at=new Date().toISOString();
      const {data:{user}={}}=await c.auth.getUser();if(!user)throw new Error('Session administrateur absente.');
      const payload={id:state.course.id,created_by:user.id,title:state.course.title,editor_version:'edition-assistee-v5',pages:{schema:'aurore-assisted-course-v5',course:state.course}};
      const {error}=await c.from('aurora_assisted_courses').upsert(payload,{onConflict:'id'});if(error)throw error;
      if(!silent)setStatus('Cours enregistré.');
      if(refreshList)await loadCourses();
    }catch(e){localStorage.setItem('aurore_assisted_course',JSON.stringify(state.course));if(!silent)setStatus('Supabase indisponible · brouillon local conservé.');}
  }

  function updateGenerationProgress(id,value,label){
    const card=root()?.querySelector('[data-block="'+CSS.escape(id)+'"]');
    const bar=card?.querySelector('[data-progress-bar]'),pct=card?.querySelector('[data-progress-pct]'),lab=card?.querySelector('[data-progress-label]');
    if(bar)bar.style.width=Math.max(0,Math.min(100,value))+'%';
    if(pct)pct.textContent=Math.round(value)+'%';
    if(lab)lab.textContent=label||'Génération…';
  }
  function startGenerationProgress(id){
    let value=8;
    const phases=[['Préparation…',18],['Validation du bloc…',28],['Génération du PDF…',62],['Finalisation…',82],['Vérification…',90]];
    let phase=0;
    return setInterval(()=>{if(value<90){value=Math.min(90,value+(value<60?2:1));if(phase<phases.length&&value>=phases[phase][1])phase++;const label=phases[Math.min(phase,phases.length-1)]?.[0]||'Génération…';updateGenerationProgress(id,value,label);}},500);
  }

  function splitLongBlock(b){
    if(!['paragraph','point','exercise'].includes(b.type))return [];
    const raw=b.type==='exercise'?String(b.content?.statement||''):String(b.content?.text||'');
    const source=raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').trim();
    if(!source)return [];

    // Découpage sémantique de secours uniquement lorsque le renderer refuse
    // un bloc trop long : on privilégie paragraphes, phrases puis espaces.
    const target=3000;
    const maxChunk=3600;
    const sentenceRx=/([.!?]+(?:["’'»)]*)?)(\s+|$)/g;

    function splitUnit(unit){
      const text=unit.trim();
      if(text.length<=maxChunk)return [text];
      const out=[];
      let rest=text;
      while(rest.length>maxChunk){
        let cut=-1;
        sentenceRx.lastIndex=0;
        let m;
        while((m=sentenceRx.exec(rest))){
          const end=m.index+m[1].length;
          if(end<=target)cut=end;
          else break;
        }
        if(cut<160){
          const window=rest.slice(0,target+1);
          const ws=window.lastIndexOf(' ');
          cut=ws>=160?ws:Math.min(target,rest.length);
        }
        if(cut<=0||cut>=rest.length)break;
        out.push(rest.slice(0,cut).trim());
        rest=rest.slice(cut).trim();
      }
      if(rest)out.push(rest);
      return out;
    }

    const units=source.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
    const chunks=[];
    let current='';
    for(const unit of units){
      for(const piece of splitUnit(unit)){
        if(!current){current=piece;continue;}
        const candidate=current+'\n\n'+piece;
        if(candidate.length<=maxChunk){
          current=candidate;
        }else{
          chunks.push(current.trim());
          current=piece;
        }
      }
    }
    if(current)chunks.push(current.trim());
    if(chunks.length<2)return [];

    const depth=Number(b.generation?.autoSplitDepth||0)+1;
    return chunks.map((part,i)=>{
      const n=block(b.type);
      n.content=b.type==='exercise'
        ?{title:String(b.content?.title||'Exercice '+(i+1)),statement:part,hint:i===0?b.content?.hint:'',correction_title:i===0?String(b.content?.correction_title||'Corrigé '+(i+1)):'',correction:i===0?String(b.content?.correction||''):''}
        :b.type==='point'
          ?{title:String(b.content?.title||'Point de cours '+(i+1)),text:part,color:normalizePointColor(b.content?.color),rank:Number(b.content?.rank)||i+1}
          :{text:part};
      n.generation={
        status:'not_generated',
        page_number:null,
        page_path:null,
        page_url:null,
        error:null,
        autoSplitDepth:depth
      };
      return n;
    });
  }

  async function waitForAssistedDocument(b,documentId){
    const c=client();if(!c)throw new Error('Session Supabase indisponible.');
    const started=Date.now(),timeout=4*60*1000;
    while(Date.now()-started<timeout){
      const {data,error}=await c.from('aurora_generated_documents')
        .select('id,status,pdf_path,pdf_url,metadata,pdf_diagnostic')
        .eq('id',documentId)
        .maybeSingle();
      if(error)throw error;
      const row=data||{};
      const md=row.metadata&&typeof row.metadata==='object'?row.metadata:{};
      const status=String(md.lualatex_status||'').toLowerCase();
      const pct=Math.max(0,Math.min(99,Number(md.lualatex_progress??0)));
      updateGenerationProgress(b.id,pct,md.lualatex_stage||'Génération du PDF…');
      if((status==='completed'||String(md.production_status||'')==='page_pdf_ready')&&String(row.pdf_url||'').trim()){
        return {page_path:row.pdf_path,page_url:row.pdf_url,bytes:row.pdf_diagnostic?.bytes||null,metadata:md};
      }
      if(status==='failed'||status==='cancelled'){
        throw new Error(String(md.lualatex_last_error||'La génération du PDF a échoué.'));
      }
      await new Promise(resolve=>setTimeout(resolve,1800));
    }
    throw new Error('La génération du PDF n’a pas terminé dans le délai prévu.');
  }

  function flowBlocksFor(id){
    const all=activeBlocks();
    const index=all.findIndex(b=>b?.id===id);
    if(index<0)return [];
    const current=all[index];
    const flowable=(b)=>['paragraph','point'].includes(String(b?.type||'').toLowerCase())&&!isSystemBlock(b);
    // Un même flux éditorial peut enchaîner points et paragraphes.
    // Les exercices, graphiques et images restent des unités indépendantes.
    if(!flowable(current))return [current];

    let start=index;
    while(start>0&&flowable(all[start-1]))start--;

    let end=index;
    while(end<all.length-1&&flowable(all[end+1]))end++;

    return all.slice(start,end+1);
  }

  function flowRenderBlockFor(id){
    const blocks=flowBlocksFor(id);
    if(blocks.length<=1)return blocks[0]||null;
    const first=clone(blocks[0]);
    first.flow_blocks=blocks.map(b=>clone(b));
    first.generation={
      ...(first.generation||{}),
      flow_companion_ids:blocks.slice(1).map(b=>b.id)
    };
    return first;
  }

  async function generateBlock(id){
    ensureCourseStructure(state.course);
    const b=activeBlocks().find(x=>x.id===id);if(!b)return;
    if(isSystemBlock(b)){setStatus('Les pages de début et de fin sont automatiques : seule une page de contenu centrale peut être générée ici.');return;}
    const v=validateBlock(b);if(!v.ok){renderWorkspace();setStatus('Bloc invalide : corrige les éléments signalés.');return;}
    if(b.type==='graphique'&&!b.content?.json?.geogebra_image_path&&!b.content?.json?.graph_local_path&&!b.content?.json?.geogebra_image_url&&!b.content?.json?.image_url&&!b.content?.json?.preview_url){
      await persistCourse(true);setStatus('JSON graphique valide, mais aucun asset visuel n’est encore disponible.');return;
    }
    b.generation={...(b.generation||{}),status:'generating',page_number:pageNumberFor(b),progress:10,progress_label:'Préparation de la page…',error:null,updated_at:new Date().toISOString()};
    renderWorkspace();updateGenerationProgress(b.id,10,'Préparation de la page…');setStatus('Préparation du rendu de la page…');
    try{
      const token=(typeof session!=='undefined'&&session?.access_token)||await freshToken();
      if(!token)throw new Error('Session administrateur absente.');
      updateGenerationProgress(b.id,20,'Envoi au renderer de page…');
      const r=await fetch(SUPABASE_URL+'/functions/v1/aurora-assisted-page-v2',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_ANON_KEY},
        body:JSON.stringify({
          course_id:state.course.id,
          course_title:state.course.title,
          block_id:b.id,
          page_number:pageNumberFor(b),
          block:flowRenderBlockFor(b.id),
          theme_color:normalizeThemeColor(state.course.theme_color)
        })
      });
      const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={error:t}};
      if(!r.ok||!d.ok)throw new Error(d.error||('Rendu HTTP '+r.status));
      const documentId=Number(d.generated_document_id||0);
      if(!documentId)throw new Error('Le renderer n’a pas fourni l’identifiant du document.');
      b.generation={...(b.generation||{}),generated_document_id:documentId,job_id:d.job_id||null,progress:5,progress_label:'Rendu de page mis en file',status:'generating',updated_at:new Date().toISOString()};
      await persistCourse(true,false);
      if(!d.page_url)throw new Error('Le renderer a terminé sans fournir l’URL de la page.');
      const flowGroup=flowBlocksFor(b.id);
      const sharedGeneration={
        status:'ready',
        page_number:d.page_number||pageNumberFor(b),
        generated_document_id:documentId,
        job_id:d.job_id||null,
        page_path:d.page_path||null,
        page_url:d.page_url,
        updated_at:new Date().toISOString(),
        progress:100,
        progress_label:'Page prête — visualisation disponible',
        bytes:d.bytes||null,
        qa:{engine:d.engine||'pdf-lib-course-page-v2',status:'completed',details:d.qa||null},
        error:null
      };
      flowGroup.forEach(part=>{
        part.generation={...(part.generation||{}),...sharedGeneration,flow_page_owner_id:b.id};
      });
      b.generation={
        ...(b.generation||{}),
        ...sharedGeneration,
        page_number:d.page_number||pageNumberFor(b),
        generated_document_id:documentId,
        job_id:d.job_id||null,
        page_path:d.page_path||null,
        page_url:d.page_url,
        updated_at:new Date().toISOString(),
        progress:100,
        progress_label:'Page prête — visualisation disponible',
        bytes:d.bytes||null,
        qa:{engine:d.engine||'pdf-lib-course-page-v2',status:'completed',details:d.qa||null},
        error:null
      };
      await persistCourse(true,false);
      renderWorkspace();
      setStatus('Page '+(b.generation.page_number||pageNumberFor(b))+' générée et enregistrée.');
    }catch(e){
      const msg=String(e?.message||e);
      if(/ASSISTED_PAGE_TOO_LONG|dépasse une seule page|depasse une seule page|exceeds one page|single page/i.test(msg) && Number(b.generation?.autoSplitDepth||0)<4){
        const pieces=splitLongBlock(b);
        if(pieces.length>1){
          const blocks=activeBlocks(),at=blocks.findIndex(x=>x.id===b.id);
          if(at>=0){
            pieces.forEach((p,i)=>{p.created_at=new Date().toISOString();blocks.splice(at+i,0,p)});
            blocks.splice(at+pieces.length,1);
            state.selected=pieces[0].id;
            await persistCourse(true);
            renderWorkspace();
            setStatus('Bloc trop long : '+pieces.length+' blocs successifs ont été créés. Génération en cours…');
            for(const p of pieces)await generateBlock(p.id);
            return;
          }
        }
      }
      b.generation={...(b.generation||{}),status:'error',page_number:pageNumberFor(b),updated_at:new Date().toISOString(),progress:0,progress_label:'Échec',error:msg};
      await persistCourse(true);
      renderWorkspace();setStatus('Échec de génération : '+msg);
    }
  }

  async function freshToken(){
    if(typeof rafraichirSession==='function'&&typeof session!=='undefined'&&session?.refresh_token){try{if(await rafraichirSession())return session.access_token}catch(_){}}
    const c=client();if(!c)throw new Error('Session indisponible.');
    const s=await c.auth.getSession();if(s.data?.session?.access_token)return s.data.session.access_token;
    throw new Error('Session administrateur expirée.');
  }

  function wiki(afterId=null){
    const host=document.getElementById('aeModalHost');if(!host)return;
    host.innerHTML='<div class="ae-modal"><div class="ae-dialog ae-wiki-dialog"><header><div><span class="ae-kicker">Wikimedia Commons</span><h4>Choisir une image</h4></div><button class="admin-btn ghost" id="aeWikiClose">Fermer</button></header><div class="ae-wiki-search"><input id="aeWikiQ" placeholder="Ex. cellule animale, volcan, Newton…"><button class="admin-btn primary" id="aeWikiGo">Rechercher</button></div><div id="aeWikiResults" class="ae-wiki-results"></div></div></div>';
    document.getElementById('aeWikiClose').onclick=()=>host.innerHTML='';
    document.getElementById('aeWikiGo').onclick=searchWiki;
    document.getElementById('aeWikiQ').onkeydown=e=>{if(e.key==='Enter')searchWiki()};
  }

  async function searchWiki(){
    const q=document.getElementById('aeWikiQ')?.value.trim(),out=document.getElementById('aeWikiResults');if(!q||!out)return;
    out.textContent='Recherche…';
    try{
      const u='https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch='+encodeURIComponent(q)+'&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|size|mime|thumbmime|extmetadata&iiurlwidth=520&format=json&origin=*';
      const r=await fetch(u);if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();const pages=Object.values(d?.query?.pages||{});
      const usable=pages.filter(p=>{const i=p?.imageinfo?.[0]||{},m=i.extmetadata||{},lic=String(m?.LicenseShortName?.value||m?.UsageTerms?.value||'').toLowerCase();return String(i.url||'').startsWith('https://upload.wikimedia.org/')&&!/fair use|non-commercial|no derivatives/.test(lic)&&['image/jpeg','image/png'].includes(String(i.mime||'').toLowerCase())});
      out.innerHTML=usable.map(p=>{const i=p.imageinfo?.[0]||{},m=i.extmetadata||{},title=String(p.title||'').replace(/^File:/,'');const d={imageUrl:i.url||'',thumbUrl:i.thumburl||i.url||'',title,caption:String(m?.ImageDescription?.value||title).replace(/<[^>]+>/g,''),sourceUrl:i.descriptionurl||('https://commons.wikimedia.org/wiki/'+encodeURIComponent(p.title)),author:String(m?.Artist?.value||'').replace(/<[^>]+>/g,''),license:String(m?.LicenseShortName?.value||m?.UsageTerms?.value||'').replace(/<[^>]+>/g,''),query:q};return '<article class="ae-wiki-card"><img src="'+esc(d.thumbUrl)+'" alt=""><div><strong>'+esc(d.title)+'</strong><small>'+esc(d.author||'Auteur non renseigné')+'</small><small>'+esc(d.license||'Licence à vérifier')+'</small></div><button class="admin-btn primary" data-wiki="'+esc(JSON.stringify(d))+'">Choisir</button></article>'}).join('')||'<div class="ae-empty">Aucune image exploitable trouvée.</div>';
      out.querySelectorAll('[data-wiki]').forEach(btn=>btn.onclick=()=>{const d=JSON.parse(btn.dataset.wiki),b=block('wikimedia-image');b.content=d;const blocks=activeBlocks(),anchorIndex=afterId?blocks.findIndex(x=>x.id===afterId):-1;if(anchorIndex>=0)blocks.splice(anchorIndex+1,0,b);else blocks.push(b);state.selected=b.id;document.getElementById('aeModalHost').innerHTML='';renderWorkspace();setStatus('Image Wikimedia ajoutée en bas du cours.')});
    }catch(e){out.textContent='Recherche Wikimedia indisponible.'}
  }

  async function init(){
    const r=root();if(!r)return;
    const card=document.querySelector('.admin-tab[data-tab="edition-assistee"]'),panel=document.querySelector('.admin-tab-panel[data-panel="edition-assistee"]');
    if(card&&panel)card.addEventListener('click',async()=>{const detail=document.getElementById('adminDetail');if(detail)detail.style.display='block';document.querySelectorAll('.admin-tab-panel').forEach(p=>p.style.display=p===panel?'block':'none');document.querySelectorAll('.admin-tab').forEach(b=>b.classList.toggle('active',b===card));state.mode='list';state.course=null;renderList();try{setStatus('Chargement des cours…');await loadCourses();renderList();setStatus('Liste prête.')}catch(e){setStatus('Impossible de charger la liste des cours.')}});
    renderList();
    requestAnimationFrame(async()=>{
      try{setStatus('Chargement des cours…');await loadCourses();renderList();setStatus('Liste prête.')}
      catch(_){setStatus('Impossible de charger la liste des cours.')}
    });
  }
  window.AuroreAssistedEditor={init,render:()=>state.mode==='workspace'?renderWorkspace():renderList,getState:()=>state.course,toContentJson:()=>state.course};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();