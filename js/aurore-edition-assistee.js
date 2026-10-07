/* Aurore — Édition assistée : atelier séquentiel, sans canevas de prévisualisation */
(function(){
  'use strict';
  const state={mode:'list',course:null,courses:[],selected:null,loading:false};
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
  function systemBlock(role,title){const start=role===START_ROLE;return {id:start?'system-start':'system-end',role,type:role,locked:true,content:{title:String(title||'Nouveau document')},generation:{status:'system',page_number:start?1:null,page_path:null,page_url:null,updated_at:null,error:null},created_at:new Date().toISOString()};}
  function ensureCourseStructure(course){
    if(!course||typeof course!=='object')return course;
    course.theme_color=normalizeThemeColor(course.theme_color);
    const blocks=Array.isArray(course.blocks)?course.blocks:[];
    const start=blocks.find(b=>b?.role===START_ROLE)||systemBlock(START_ROLE,course.title);
    const end=blocks.find(b=>b?.role===END_ROLE)||systemBlock(END_ROLE,course.title);
    const middle=blocks.filter(b=>b?.role!==START_ROLE&&b?.role!==END_ROLE);
    course.blocks=[start,...middle,end];
    return course;
  }
  function isSystemBlock(b){return b?.role===START_ROLE||b?.role===END_ROLE||b?.locked===true&&(/^system-(start|end)$/.test(String(b?.id||'')));}
  function contentBlocks(course=state.course){return (Array.isArray(course?.blocks)?course.blocks:[]).filter(b=>!isSystemBlock(b));}

  function newCourse(title){
    const id=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():uid('course');
    return {id,title:String(title||'Nouveau cours').trim()||'Nouveau cours',status:'editing',
      metadata:{schema:'aurore-assisted-course-v4',editor:'edition_assistee',origin:'assisted_editor'},
      theme_color:DEFAULT_THEME_COLOR,
      blocks:[systemBlock(START_ROLE,title),systemBlock(END_ROLE,title)],generation:{pages:[],updated_at:null}};
  }
  function block(type){
    const b={id:uid('block'),type,content:{},generation:{status:'not_generated',page_number:null,page_path:null,page_url:null,updated_at:null,error:null},created_at:new Date().toISOString()};
    if(type==='paragraph')b.content={text:''};
    if(type==='point')b.content={text:'Nouvel élément de cours.'};
    if(type==='exercise')b.content={statement:'Nouvel exercice.',hint:''};
    if(type==='graphique')b.content={json:{id:uid('graph'),instrument:'function2d',expression:'x^2'}};
    if(type==='wikimedia-image')b.content={imageUrl:'',thumbUrl:'',title:'',caption:'',sourceUrl:'',author:'',license:'',query:''};
    return b;
  }
  function activeBlocks(){return Array.isArray(state.course?.blocks)?state.course.blocks:[]}
  function pageNumberFor(b){const blocks=activeBlocks();if(b?.role===START_ROLE)return 1;if(b?.role===END_ROLE)return blocks.length;const i=blocks.findIndex(x=>x.id===b.id);return i<0?null:i+1}
  function setStatus(t){const e=document.getElementById('assistedStatus');if(e)e.textContent=t}

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
    r.insertAdjacentHTML('beforeend',dialogHtml('Nouveau cours','<label class="ae-dialog-field">Nom du cours<input id="aeNewCourseTitle" value="Nouveau cours" maxlength="180"></label>','<button class="admin-btn primary" id="aeCreateConfirm">Créer le cours</button>'));
    document.getElementById('aeClose').onclick=()=>document.getElementById('aeModal')?.remove();
    document.getElementById('aeCreateConfirm').onclick=async()=>{
      const title=document.getElementById('aeNewCourseTitle').value.trim();
      const c=newCourse(title);ensureCourseStructure(c);state.course=c;state.mode='workspace';state.selected=null;
      renderWorkspace();
      void persistCourse(true,false);
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
    state.mode='workspace';state.selected=null;renderWorkspace();
  }

  function normalizeContent(type,v){
    const x=v&&typeof v==='object'&&!Array.isArray(v)?clone(v):{};
    if(type==='graphique') return {json:x};
    if(type==='paragraph'||type==='point') return {text:String(x.text??x.content??x.body??'')};
    if(type==='exercise') return {statement:String(x.statement??x.question??x.enonce??x.content??''),hint:String(x.hint??'')};
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
    if(b.type==='point'&&!String(b.content?.text||'').trim())errors.push('Le contenu du point est vide.');
    if(b.type==='exercise'&&!String(b.content?.statement||'').trim())errors.push('L’énoncé est vide.');
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

  function labelFor(b){return b.type==='paragraph'?'Paragraphe':b.type==='point'?'Point de cours':b.type==='exercise'?'Exercice':b.type==='graphique'?'Graphique JSON':'Image Wikimedia'}
  function mainText(b){return b.type==='exercise'?b.content?.statement||'':b.type==='graphique'?JSON.stringify(b.content?.json||{},null,2):b.content?.text||b.content?.caption||b.content?.title||''}

  function systemBlockCard(b,i){
    const start=b.role===START_ROLE;
    const page=start?1:activeBlocks().length;
    const title=start?'Bloc de début · première page':'Bloc de fin · dernière page';
    const text=start?'Page d’ouverture automatique du document. Elle sera intégrée lors de la construction/fusion du document complet.':'Dernière page automatique du document. Elle sera intégrée lors de la construction/fusion du document complet.';
    return '<article class="ae-block ae-system-block" data-block="'+esc(b.id)+'">'+
      '<header class="ae-block-head"><div><span class="ae-block-number">'+String(page).padStart(2,'0')+'</span><strong>'+esc(title)+'</strong><small>Page système · verrouillée</small></div><span class="ae-block-state ok">Automatique</span></header>'+
      '<div class="ae-system-content"><strong>'+esc(state.course?.title||'Document')+'</strong><span>'+esc(text)+'</span></div>'+
      '<div class="ae-block-result"><button class="admin-btn ghost" data-preview-block="'+esc(b.id)+'">Prévisualiser</button><span>Cette page n’est pas envoyée au moteur de génération des pages centrales.</span></div>'+
      '</article>';
  }

  function blockCard(b,i){
    if(isSystemBlock(b))return systemBlockCard(b,i);
    const v=validateBlock(b), gen=b.generation||{},page=pageNumberFor(b);
    let editor='';
    if(b.type==='graphique')editor='<textarea class="ae-inline-json" data-edit-json="'+esc(b.id)+'" aria-label="JSON du graphique">'+esc(JSON.stringify(b.content?.json||{},null,2))+'</textarea>';
    else if(b.type==='exercise')editor='<textarea data-edit-text="'+esc(b.id)+'" aria-label="Énoncé de l’exercice">'+esc(b.content?.statement||'')+'</textarea>';
    else if(b.type==='wikimedia-image')editor=b.content?.imageUrl?'<div class="ae-selected-image"><img src="'+esc(b.content.imageUrl)+'" alt="'+esc(b.content.title||'Image Wikimedia')+'"><div><strong>'+esc(b.content.title||'Image Wikimedia')+'</strong><small>'+esc(b.content.license||'Licence à vérifier')+'</small></div></div>':'<div class="ae-image-pick-empty">Ajoutez une image Wikimedia avec le bouton dédié.</div>';
    else editor='<textarea data-edit-text="'+esc(b.id)+'" aria-label="Contenu du bloc">'+esc(b.content?.text||'')+'</textarea>';
    return '<article class="ae-block '+(state.selected===b.id?'is-selected':'')+'" data-block="'+esc(b.id)+'">'+
      '<header class="ae-block-head"><div><span class="ae-block-number">'+String(i+1).padStart(2,'0')+'</span><strong>'+esc(labelFor(b))+'</strong><small>'+esc(b.validation?.ok?'Bloc valide':'À valider')+'</small></div><span class="ae-block-state '+(v.ok?'ok':'bad')+'">'+(v.ok?'Valide':'À corriger')+'</span></header>'+
      '<div class="ae-block-editor">'+editor+'</div>'+
      '<div class="ae-block-toolbar"><button class="admin-btn ghost" data-preview-block="'+esc(b.id)+'">Prévisualiser</button><button class="admin-btn ghost" data-json-block="'+esc(b.id)+'">JSON</button><button class="admin-btn ghost" data-copy-block="'+esc(b.id)+'">Copier</button><button class="admin-btn ghost" data-duplicate-block="'+esc(b.id)+'">Dupliquer</button>'+(b.type==='paragraph'?'<button class="admin-btn ghost" data-clear-paragraph="'+esc(b.id)+'">Vider</button>':'')+'<button class="admin-btn danger" data-delete-block="'+esc(b.id)+'">Supprimer</button><button class="admin-btn primary" data-validate-block="'+esc(b.id)+'">Valider & générer la page</button></div>'+
      '<div class="ae-block-result">'+(gen.status==='ready'&&gen.page_url?'<span class="ae-generated-ok">✓ Page '+page+' générée seule</span><button class="admin-btn ghost" data-preview-block="'+esc(b.id)+'">Visualiser</button><a class="admin-btn ghost" href="'+esc(gen.page_url)+'" download="aurore-page-'+page+'.pdf">Télécharger</a>':gen.status==='generating'?'<div class="ae-generation-progress" role="status" aria-live="polite"><div class="ae-generation-progress-top"><span data-progress-label>'+esc(gen.progress_label||'Génération de la page…')+'</span><strong data-progress-pct>'+Math.round(Number(gen.progress||8))+'%</strong></div><div class="ae-progress-track"><span data-progress-bar style="width:'+Math.max(8,Math.min(100,Number(gen.progress||8)))+'%"></span></div><small>Progression indicative · la page est en cours de génération.</small></div>':gen.status==='error'?'<span class="ae-generated-error">Erreur : '+esc(gen.error||'génération impossible')+'</span>':b.type==='graphique'&&v.ok?'<span>JSON validé · la construction graphique reste destinée au moteur GeoGebra/LuaLaTeX.</span>':'<span>Aucune page générée pour ce bloc.</span>')+'</div>'+
      (v.errors.length?'<div class="ae-block-errors">'+v.errors.map(x=>'• '+esc(x)).join('<br>')+'</div>':'')+
      (b.type==='paragraph'?'<div class="ae-inline-add-row"><button type="button" class="ae-inline-add" data-add-paragraph-after="'+esc(b.id)+'">＋ Insérer un paragraphe ici</button></div>':'')+
      '</article>';
  }

  function renderWorkspace(){
    const r=root();if(!r||!state.course)return;
    validateCourse();
    ensureCourseStructure(state.course);
    r.innerHTML='<div class="ae-shell ae-workspace"><header class="ae-head"><div><button class="admin-btn ghost" id="aeBack">← Mes cours</button><span class="ae-kicker">Atelier de production séquentielle</span><h3><input id="aeCourseTitle" value="'+esc(state.course.title)+'"></h3><p>Le bloc de début et le bloc de fin sont automatiques. Tous les blocs que tu ajoutes sont placés entre les deux et chaque bloc central génère uniquement sa propre page.</p></div><span class="ae-status" id="assistedStatus">'+(state.course.validation?.ok?'Structure valide':'À compléter')+'</span></header>'+
      '<div class="ae-top-options"><div class="ae-top-options-title"><span class="ae-kicker">Options du document</span><strong>Couleur d’accent</strong><small>Elle sera utilisée pour les bordures, repères et éléments mathématiques de la page.</small></div><label class="ae-color-field"><span class="ae-color-swatch" style="background:'+normalizeThemeColor(state.course.theme_color)+'"></span><select id="aeThemeColor" aria-label="Couleur d’accent du document">'+themeColorOptions()+'</select></label></div>'+
      '<div class="ae-workbar"><button class="admin-btn primary" id="aeAddP">＋ Paragraphe</button><button class="admin-btn ghost" id="aeAddPoint">＋ Point de cours</button><button class="admin-btn ghost" id="aeAddEx">＋ Exercice</button><button class="admin-btn ghost" id="aeAddGraph">＋ Graphique JSON</button><button class="admin-btn ghost" id="aeAddWiki">＋ Image Wikimedia</button><button class="admin-btn ghost" id="aeSave">Enregistrer le cours</button></div>'+
      '<div class="ae-sequence-meta"><span>'+contentBlocks().length+' bloc(s) de contenu · 1 début · 1 fin</span><span>Ordre de génération : début → contenu → fin</span></div>'+
      '<section class="ae-block-stack">'+(activeBlocks().length?activeBlocks().map(blockCard).join(''):'<div class="ae-empty"><strong>Le cours est vide.</strong><span>Ajoute un paragraphe pour commencer. Le bloc suivant sera automatiquement placé dessous.</span></div>')+'</section>'+
      '<footer class="ae-work-footer">Les pages sont produites bloc par bloc. La fusion du document complet reste séparée du travail d’édition.</footer></div><div class="ae-modal-host" id="aeModalHost"></div>';
    bindWorkspace();
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
    document.getElementById('aeSave').onclick=()=>persistCourse(false,true);
    root().querySelectorAll('[data-edit-text]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editText);if(b){if(b.type==='exercise')b.content.statement=el.value;else b.content.text=el.value;validateCourse();}});
    root().querySelectorAll('[data-edit-json]').forEach(el=>el.onchange=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editJson);if(!b)return;try{b.content=normalizeContent('graphique',JSON.parse(el.value));validateBlock(b);renderWorkspace();}catch(_){setStatus('JSON graphique invalide.')}});

    root().querySelectorAll('[data-preview-block]').forEach(x=>x.onclick=()=>previewBlock(x.dataset.previewBlock));
    root().querySelectorAll('[data-json-block]').forEach(x=>x.onclick=()=>jsonDialog(x.dataset.jsonBlock));
    root().querySelectorAll('[data-copy-block]').forEach(x=>x.onclick=()=>copyBlock(x.dataset.copyBlock));
    root().querySelectorAll('[data-duplicate-block]').forEach(x=>x.onclick=()=>duplicateBlock(x.dataset.duplicateBlock));
    root().querySelectorAll('[data-delete-block]').forEach(x=>x.onclick=()=>deleteBlock(x.dataset.deleteBlock));
    root().querySelectorAll('[data-clear-paragraph]').forEach(x=>x.onclick=()=>clearParagraph(x.dataset.clearParagraph));
    root().querySelectorAll('[data-add-paragraph-after]').forEach(x=>x.onclick=()=>addParagraphAfter(x.dataset.addParagraphAfter));
    root().querySelectorAll('[data-validate-block]').forEach(x=>x.onclick=()=>generateBlock(x.dataset.validateBlock));
  }

  function addBlock(type){
    ensureCourseStructure(state.course);
    const b=block(type),blocks=activeBlocks(),endIndex=blocks.findIndex(x=>x.role===END_ROLE);
    if(endIndex<0)blocks.push(systemBlock(END_ROLE,state.course.title));
    const idx=Math.max(0,blocks.findIndex(x=>x.role===END_ROLE));
    blocks.splice(idx,0,b);state.selected=b.id;validateCourse();renderWorkspace();setStatus('Bloc ajouté au milieu du document, avant la page de fin.');
  }
  function addParagraphAfter(id){
    ensureCourseStructure(state.course);
    const blocks=activeBlocks(),idx=blocks.findIndex(x=>x.id===id),source=idx>=0?blocks[idx]:null;
    if(!source||source.type!=='paragraph'||isSystemBlock(source))return;
    const b=block('paragraph');b.content={text:''};blocks.splice(idx+1,0,b);
    state.selected=b.id;validateCourse();renderWorkspace();setStatus('Paragraphe inséré à cet emplacement.');
    requestAnimationFrame(()=>root()?.querySelector('[data-edit-text="'+CSS.escape(b.id)+'"]')?.focus());
  }
  function clearParagraph(id){
    const b=activeBlocks().find(x=>x.id===id);
    if(!b||b.type!=='paragraph'||isSystemBlock(b))return;
    b.content={text:''};
    b.generation={status:'not_generated',page_number:null,page_path:null,page_url:null,updated_at:null,error:null};
    state.selected=b.id;validateCourse();renderWorkspace();setStatus('Paragraphe vidé.');
    requestAnimationFrame(()=>root()?.querySelector('[data-edit-text="'+CSS.escape(b.id)+'"]')?.focus());
  }
  function duplicateBlock(id){
    const b=activeBlocks().find(x=>x.id===id);if(!b||isSystemBlock(b)){if(isSystemBlock(b))setStatus('Les pages de début et de fin sont automatiques et verrouillées.');return;}
    const copy=clone(b);copy.id=uid('block');copy.generation={status:'not_generated',page_number:null,page_path:null,page_url:null,updated_at:null,error:null};
    if(copy.type==='graphique')copy.content.json.id=uid('graph');
    const i=activeBlocks().findIndex(x=>x.id===id);state.course.blocks.splice(i+1,0,copy);state.selected=copy.id;renderWorkspace();
  }
  function deleteBlock(id){
    const b=activeBlocks().find(x=>x.id===id);if(isSystemBlock(b)){setStatus('Les pages de début et de fin sont automatiques et verrouillées.');return;}
    state.course.blocks=activeBlocks().filter(x=>x.id!==id);if(state.selected===id)state.selected=null;ensureCourseStructure(state.course);renderWorkspace();setStatus('Bloc supprimé.');
  }

  function openBlockModal(title,body){
    const host=document.getElementById('aeModalHost');if(!host)return;
    host.innerHTML='<div class="ae-modal"><div class="ae-dialog"><header><div><span class="ae-kicker">'+esc(title)+'</span></div><button class="admin-btn ghost" id="aeModalClose">Fermer</button></header>'+body+'</div></div>';
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

  async function renderAssistedPdfPreview(url,canvasId,loadingId){
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
      const page=await pdf.getPage(1);if(!canvas.isConnected)return;
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

  async function previewBlock(id){
    const b=activeBlocks().find(x=>x.id===id);if(!b)return;
    if(isSystemBlock(b)){
      const start=b.role===START_ROLE;
      const body='<div class="ae-block-preview ae-system-preview"><span class="ae-preview-badge">'+(start?'Bloc de début':'Bloc de fin')+'</span><strong>'+esc(state.course?.title||'Document')+'</strong><div class="ae-preview-text">'+esc(start?'Première page automatique du document.':'Dernière page automatique du document.')+'</div><small>Cette page est conservée comme page système et n’est pas générée comme une page de contenu indépendante.</small></div>';
      openBlockModal(start?'Prévisualisation de la page de début':'Prévisualisation de la page de fin',body);return;
    }
    const gen=b.generation||{};
    if(b.type==='graphique'&&!gen.page_url){
      const url=await graphPreviewUrl(b);
      if(url){
        const body='<div class="ae-page-preview"><div class="ae-page-preview-meta"><strong>'+esc(b.content?.json?.title||'Graphique')+'</strong><span>Prévisualisation visuelle · asset GeoGebra</span></div><img class="ae-preview-image" src="'+esc(url)+'" alt="Prévisualisation du graphique"><div class="ae-page-preview-actions"><a class="admin-btn primary" href="'+esc(url)+'" target="_blank" rel="noopener">Ouvrir</a></div></div>';
        openBlockModal('Prévisualisation du graphique',body);
      }else{
        openBlockModal('Prévisualisation du graphique','<div class="ae-block-preview"><span class="ae-preview-badge">Graphique validé</span><strong>Prévisualisation visuelle indisponible pour le moment.</strong><div class="ae-preview-text">L’asset GeoGebra n’est pas encore disponible. Le JSON reste accessible uniquement avec le bouton « JSON » du bloc.</div></div>');
      }
      return;
    }
    if(gen.page_url){
      const page=pageNumberFor(b),url=String(gen.page_url),canvasId='aePdfCanvas_'+String(id).replace(/[^a-zA-Z0-9_-]/g,'_'),loadingId=canvasId+'_loading';
      const body='<div class="ae-page-preview"><div class="ae-page-preview-meta"><strong>Page '+page+' · '+esc(labelFor(b))+'</strong><span>Rendu PDF.js · page 1 du fragment</span></div><div class="ae-page-preview-canvas-wrap"><div id="'+loadingId+'" class="ae-preview-loading">Préparation de la visualisation…</div><canvas id="'+canvasId+'" class="ae-page-preview-canvas" aria-label="Prévisualisation de la page '+page+'"></canvas></div><div class="ae-page-preview-actions"><a class="admin-btn primary" href="'+esc(url)+'" download="aurore-page-'+page+'.pdf">Télécharger</a><a class="admin-btn ghost" href="'+esc(url)+'" target="_blank" rel="noopener">Ouvrir</a></div></div>';
      openBlockModal('Prévisualisation de la page générée',body);
      await renderAssistedPdfPreview(url,canvasId,loadingId);
      return;
    }
    const t=mainText(b);
    let body='<div class="ae-block-preview"><strong>'+esc(labelFor(b))+'</strong><div class="ae-preview-text">'+esc(t||'Bloc vide')+'</div></div>';
    if(b.type==='wikimedia-image'&&b.content?.imageUrl)body='<div class="ae-block-preview"><strong>Image Wikimedia sélectionnée</strong><img class="ae-preview-image" src="'+esc(b.content.imageUrl)+'" alt="'+esc(b.content.title||'Image Wikimedia')+'"><small>'+esc(b.content.license||'')+'</small></div>';
    openBlockModal('Prévisualisation du bloc',body);
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
      const payload={id:state.course.id,created_by:user.id,title:state.course.title,editor_version:'edition-assistee-v4',pages:{schema:'aurore-assisted-course-v4',course:state.course}};
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

    // The old 360-character cut created very short artificial pages.
    // Prefer semantic paragraph/sentence boundaries and let each generated
    // block use most of an A4 page before creating the next page.
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
        ?{statement:part,hint:i===0?b.content?.hint:''}
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
          block:b,
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
      b.generation={
        ...(b.generation||{}),
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

  function wiki(){
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
      out.querySelectorAll('[data-wiki]').forEach(btn=>btn.onclick=()=>{const d=JSON.parse(btn.dataset.wiki),b=block('wikimedia-image');b.content=d;state.course.blocks.push(b);state.selected=b.id;document.getElementById('aeModalHost').innerHTML='';renderWorkspace();setStatus('Image Wikimedia ajoutée en bas du cours.')});
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