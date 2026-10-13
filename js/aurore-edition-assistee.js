/* Aurore — Édition assistée : atelier séquentiel, sans canevas de prévisualisation */
(function(){
  'use strict';
  const state={mode:'list',course:null,courses:[],selected:null,loading:false,pdfBatchRunning:false,pdfFinalizing:false,finalPdfArtifact:null,ghostscriptModulePromise:null,ghostscriptInstance:null,ghostscriptFailureUntil:0,ghostscriptFailureMessage:'',pdfBatchProgress:{percent:0,label:'En attente de génération',targetCount:0,activeTargetIndex:0,completedTargets:0},pdfLibPromise:null,modalViewport:null,canonicalPreview:{fingerprint:'',documentId:null,pdfUrl:null}};
  const PREVIEW_CACHE_MAX=6;
  const PDF_PART_CACHE_DB='aurore-pdf-part-cache-v3';
  const PDF_PART_CACHE_STORE='optimized-parts';
  let pdfPartCacheDbPromise=null;
  let pdfCompressionQueue=Promise.resolve();
  const pdfPartMemoryCache=new Map();
  const pdfPartOptimizationJobs=new Map();
  const previewPdfCache=new Map();
  function cachedPreviewBuffer(url){const hit=previewPdfCache.get(url);if(!hit)return null;previewPdfCache.delete(url);previewPdfCache.set(url,hit);return hit;}
  function rememberPreviewBuffer(url,buffer){previewPdfCache.delete(url);previewPdfCache.set(url,buffer);while(previewPdfCache.size>PREVIEW_CACHE_MAX)previewPdfCache.delete(previewPdfCache.keys().next().value);}
  const THEME_COLORS=[
    {value:'#6D28D9',label:'Violet Aurore'},
    {value:'#2563EB',label:'Bleu'},
    {value:'#DC2626',label:'Rouge'},
    {value:'#15803D',label:'Vert'},
    {value:'#C2410C',label:'Orange'},
    {value:'#A16207',label:'Ocre'},
    {value:'#0E7490',label:'Turquoise'},
    {value:'#BE123C',label:'Rose framboise'},
    {value:'#BE185D',label:'Rose profond'},
    {value:'#7C3AED',label:'Violet clair'},
    {value:'#4338CA',label:'Indigo'},
    {value:'#0284C7',label:'Bleu ciel'},
    {value:'#0891B2',label:'Cyan'},
    {value:'#059669',label:'Émeraude'},
    {value:'#C026D3',label:'Magenta'},
    {value:'#DB2777',label:'Rose'},
    {value:'#475569',label:'Ardoise'},
    {value:'#52525B',label:'Gris graphite'},
    {value:'#65A30D',label:'Vert citron'},
    {value:'#92400E',label:'Marron'},
    {value:'#9F1239',label:'Bordeaux'}
  ];
  const POINT_SEQUENCE_COLORS=['#2563EB','#DC2626','#15803D','#C2410C','#7C3AED','#0E7490','#A16207','#BE185D'];
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
  function normalizeDuplicateBlockIds(course){
    const source=Array.isArray(course?.blocks)?course.blocks:[];
    const introductions=source.filter(isDefaultIntroduction);
    const keepIntroduction=introductions.find(b=>String(b?.content?.text||'').trim())||introductions[0]||null;
    const filtered=source.filter(b=>!isDefaultIntroduction(b)||b===keepIntroduction);
    const seen=new Map(),out=[];
    for(const b of filtered){
      if(!b||typeof b!=='object')continue;
      let id=String(b.id||'').trim();
      if(!id){id=uid('block');b.id=id;}
      const previous=seen.get(id);
      if(previous){
        const sameType=String(previous.type||'')===String(b.type||'');
        const sameContent=JSON.stringify(previous.content||{})===JSON.stringify(b.content||{});
        if(sameType&&sameContent)continue;
        b.id=uid('block');
        delete b.toc_entry_id;
        b.generation={status:'not_generated',page_number:null,page_path:null,page_url:null,updated_at:null,error:null};
        id=String(b.id);
      }
      seen.set(id,b);
      out.push(b);
    }
    course.blocks=out;
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
    // Les anciens blocs éditoriaux peuvent encore stocker un paragraphe comme
    // une chaîne directe dans content, alors que l’éditeur et le renderer lisent
    // content.text. Normaliser à l’ouverture évite le faux message « paragraphe vide »
    // et empêche la prévisualisation/la génération d’écraser ce texte par une chaîne vide.
    for(const b of middle){
      if(String(b?.type||'').toLowerCase()==='paragraph'){
        b.content=normalizeContent('paragraph',b.content);
      }
    }
    course.blocks=[start,...middle,end];
    normalizeDuplicateBlockIds(course);
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
    if(type==='point'){const n=nextPointNumber();b.content={title:'Point de cours '+n,text:'',color:defaultPointColor(n),rank:n};}
    if(type==='exercise'){const n=nextExerciseNumber();b.content={title:'Exercice '+n,statement:'',hint:'',correction_title:'Corrigé '+n,correction:''};}
    if(type==='graphique')b.content={json:{id:uid('graph'),instrument:'function2d',expression:'x^2'}};
    if(type==='vector-scene')b.content={json:{title:'Schéma vectoriel',caption:'Exemple modifiable : une fonction dans un repère.',mode:'nb',scene:{version:1,width:260,height:170,elements:[{t:'axes',origin:[30,22],size:[200,125],x:[-3,3],y:[-1,5],xlabel:'x',ylabel:'y'},{t:'plot',expr:'x^2',from:-2,to:2,w:1.7}]}}};
    if(type==='fiche-revision')b.content={json:{title:'Fiche de révision',subtitle:'À personnaliser selon le chapitre',mode:'nb',page_number:1,essentials:[{title:'Notion clé',text:'Définition ou propriété à retenir.'}],formulas:[{title:'Relation fondamentale',latex:'f(x)=ax+b',legend:[{s:'a',m:'coefficient directeur'},{s:'b',m:'ordonnée à l’origine'}],condition:'Fonction affine',trap:'Vérifier les conditions d’application.'}],table:null,scene:null,selftest:['Quelle propriété faut-il retenir ?']}};
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
  function defaultPointColor(rank){return POINT_SEQUENCE_COLORS[(Math.max(0,Math.floor(Number(rank)||1)-1))%POINT_SEQUENCE_COLORS.length]}
  function pointColorOptions(selected){
    return THEME_COLORS.map(x=>'<option value="'+x.value+'"'+(normalizePointColor(selected)===x.value?' selected':'')+'>'+esc(x.label)+'</option>').join('');
  }
  function activeBlocks(){return Array.isArray(state.course?.blocks)?state.course.blocks:[]}
  function tocPageCount(entriesOverride){
    const configured=Array.isArray(entriesOverride)?entriesOverride:(Array.isArray(state.course?.document_pages?.toc?.entries)?state.course.document_pages.toc.entries:[]);
    const enabled=configured.filter(e=>e&&e.enabled!==false&&String(e.title||'').trim());
    return Math.max(1,Math.ceil(enabled.length/10));
  }
  function generationIsReady(g){
    return String(g?.status||"").toLowerCase()==="ready"&&!!String(g?.page_url||"").trim();
  }
  function pageCountForGroup(group,owner){
    const ready=group.filter(item=>generationIsReady(item?.generation));
    if(ready.length===group.length&&ready.length){
      const unique=new Map();
      for(const item of ready){
        const url=String(item?.generation?.page_url||'').trim();
        if(url&&!unique.has(url))unique.set(url,Math.max(1,Math.floor(Number(item?.generation?.page_count)||1)));
      }
      if(unique.size)return [...unique.values()].reduce((sum,count)=>sum+count,0);
    }
    const g=owner?.generation||{};
    return generationIsReady(g)&&Number(g.page_count)>0?Math.floor(Number(g.page_count)):Math.max(1,group.length);
  }
  function pageNumberFor(b,tocPages=tocPageCount()){
    const blocks=activeBlocks();
    if(b?.role===START_ROLE)return 1;
    const firstContentPage=Math.max(3,Number(tocPages||1)+2);
    const renderable=contentBlocks().filter(hasRenderableContent);
    const covered=new Set();
    let physicalPage=firstContentPage;
    if(b?.role===END_ROLE){
      for(const candidate of renderable){
        if(covered.has(String(candidate.id)))continue;
        const raw=renderableFlowBlocksFor(candidate.id);
        const group=raw.length?raw:[candidate];
        const owner=group[0]||candidate;
        for(const item of group)covered.add(String(item.id));
        const g=owner.generation||{};
        physicalPage+=pageCountForGroup(group,owner);
      }
      return physicalPage;
    }
    const targetId=String(b?.id||"");
    if(!targetId)return null;
    for(const candidate of renderable){
      if(covered.has(String(candidate.id)))continue;
      const raw=renderableFlowBlocksFor(candidate.id);
      const group=raw.length?raw:[candidate];
      const owner=group[0]||candidate;
      const g=owner.generation||{};
      const startStored=Number(g.page_number||physicalPage);
      const targetIndex=group.findIndex(item=>String(item.id)===targetId);
      for(const item of group)covered.add(String(item.id));
      if(targetIndex>=0){
        const map= g.flow_page_map&&typeof g.flow_page_map==="object" ? Number(g.flow_page_map[targetId]) : 0;
        if(generationIsReady(g)&&Number.isFinite(map)&&map>=startStored)return physicalPage+(map-startStored);
        const targetGeneration=group[targetIndex]?.generation||{};
        const targetStored=Number(targetGeneration.page_number||0);
        if(targetIndex>0&&targetGeneration.independent_regeneration===true
          &&Number.isFinite(targetStored)&&targetStored>=startStored&&startStored>0){
          return physicalPage+(targetStored-startStored);
        }
        if(targetIndex>0&&group.every(item=>generationIsReady(item?.generation))){
          const precedingUrls=new Set();let offset=0;
          for(const item of group.slice(0,targetIndex)){
            const itemGeneration=item?.generation||{},url=String(itemGeneration.page_url||'').trim();
            if(url&&!precedingUrls.has(url)){
              precedingUrls.add(url);
              offset+=Math.max(1,Math.floor(Number(itemGeneration.page_count)||1));
            }
          }
          if(precedingUrls.size&&group.some((item,index)=>index>0&&String(item?.generation?.page_url||'')!==String(owner?.generation?.page_url||''))){
            return physicalPage+offset;
          }
        }
        return physicalPage+Math.max(0,targetIndex);
      }
      physicalPage+=pageCountForGroup(group,owner);
    }
    const index=blocks.findIndex(item=>String(item?.id||"")===targetId);
    return index<0?null:physicalPage;
  }
  function pageNumberForEnd(b,tocPages=tocPageCount()){
    if(!b)return null;
    if(b?.role===START_ROLE)return 1;
    if(b?.role===END_ROLE)return pageNumberFor(b,tocPages);
    const group=renderableFlowBlocksFor(b.id),owner=group[0]||b,g=owner.generation||{};
    const start=Number(g.page_number||pageNumberFor(owner,tocPages));
    const end=g.flow_page_end_map&&typeof g.flow_page_end_map==="object"?Number(g.flow_page_end_map[String(b.id)]):0;
    if(generationIsReady(g)&&Number.isFinite(end)&&end>=start)return pageNumberFor(owner,tocPages)+(end-start);
    if(generationIsReady(g)&&String(owner.id)===String(b.id)&&Number(g.page_count)>0)return pageNumberFor(owner,tocPages)+Math.floor(Number(g.page_count))-1;
    return pageNumberFor(b,tocPages);
  }
  function isRepeatedDefaultIntroduction(b,course=state.course){
    if(!b||isDefaultIntroduction(b))return false;
    const title=String(b?.content?.title||'').trim();
    if(!/^introduction(?:\s|$)/i.test(title))return false;
    const intro=(Array.isArray(course?.blocks)?course.blocks:[]).find(isDefaultIntroduction);
    const introText=String(intro?.content?.text||'').trim();
    return Boolean(introText&&String(b?.content?.text||'').trim()===introText);
  }
  function hasMeaningfulPayload(value){
    if(value==null)return false;
    if(typeof value==='string')return value.trim().length>0;
    if(typeof value==='number')return Number.isFinite(value);
    if(typeof value==='boolean')return value;
    if(Array.isArray(value))return value.length>0;
    if(typeof value==='object')return Object.values(value).some(hasMeaningfulPayload);
    return false;
  }
  function hasRenderableContent(b){
    if(!b||isSystemBlock(b)||isRepeatedDefaultIntroduction(b))return false;
    const c=b.content&&typeof b.content==='object'?b.content:{};
    const type=String(b.type||'').toLowerCase();
    if(type==='paragraph'||type==='point')return Boolean(String(c.text||'').trim());
    if(type==='exercise')return Boolean(String(c.statement||c.question||'').trim()||String(c.correction||'').trim());
    if(type==='graphique'){
      const g=c.json&&typeof c.json==='object'&&!Array.isArray(c.json)?c.json:{};
      return Object.keys(g).length>0;
    }
    if(type==='wikimedia-image'){
      return ['imageUrl','thumbUrl','title','caption','sourceUrl','author','license','query'].some(key=>hasMeaningfulPayload(c[key]));
    }
    if(type==='vector-scene'){
      const scene=c.json&&typeof c.json==='object'&&!Array.isArray(c.json)?c.json:{};
      return Object.keys(scene).length>0;
    }
    if(type==='fiche-revision'){
      const fiche=c.json&&typeof c.json==='object'&&!Array.isArray(c.json)?c.json:{};
      return Object.entries(fiche).some(([key,value])=>
        !['title','subtitle','mode','page_number'].includes(key)&&hasMeaningfulPayload(value));
    }
    return hasMeaningfulPayload(c.text)||hasMeaningfulPayload(c.content)||hasMeaningfulPayload(c.json);
  }
  function setStatus(t){const e=document.getElementById('assistedStatus');if(e)e.textContent=t}
  function downloadablePdfParts(){
    const parts=[],seen=new Set();
    const add=(url,label,key)=>{
      const u=String(url||'').trim();if(!u)return;
      const k=String(u).trim();
      if(!k||seen.has(k))return;
      seen.add(k);parts.push({url:u,label});
    };
    const pages=state.canonicalPreview?.pages||{};
    if(canonicalPreviewIsFresh('cover')&&String(pages.cover?.status||'').toLowerCase()==='ready')add(pages.cover.pdfUrl,'Couverture','cover');
    if(canonicalPreviewIsFresh('toc')&&String(pages.toc?.status||'').toLowerCase()==='ready')add(pages.toc.pdfUrl,'Sommaire','toc');
    for(const b of contentBlocks()){
      const g=b?.generation||{};
      if(String(g.status||'').toLowerCase()!=='ready'||!g.page_url)continue;

      // Le PDF du flux contigu est la source canonique du document final.
      // Ignorer ses aperçus indépendants évite de recommencer un chapitre
      // déjà présent dans le PDF de flux, même si le bloc a été régénéré seul.
      const group=renderableFlowBlocksFor(b.id);
      if(group.length>1){
        const owner=group[0];
        const ownerGeneration=owner?.generation||{};
        const ownerReady=String(ownerGeneration.status||'').toLowerCase()==='ready'
          &&!!String(ownerGeneration.page_url||'').trim()
          &&ownerGeneration.independent_regeneration!==true
          &&generationHasFlow(ownerGeneration);
        if(ownerReady&&generationContainsBlock(ownerGeneration,b.id)){
          if(String(b.id)===String(owner.id)){
            add(ownerGeneration.page_url,'Flux du cours à partir de la page '+String(pageNumberFor(owner)),owner.id);
          }
          continue;
        }
      }

      // Une page indépendante reste utilisable tant qu'aucun flux propriétaire
      // ne prouve qu'il contient exactement ce segment du document.
      add(g.page_url,'Page '+String(g.page_number||pageNumberFor(b)),g.flow_page_owner_id||g.page_url);
    }
    if(canonicalPreviewIsFresh('end')&&String(pages.end?.status||'').toLowerCase()==='ready')add(pages.end.pdfUrl,'Fin du document','end');
    return parts;
  }
  function refreshDownloadButton(){
    const btn=document.getElementById('aeDownloadPdfCurrent');
    if(btn){
      const parts=downloadablePdfParts();
      btn.disabled=!parts.length;
      btn.textContent=parts.length?'Télécharger les pages prêtes ('+parts.length+' fragment(s))':'Télécharger les pages prêtes';
      btn.title=parts.length?'Télécharger les fragments PDF déjà prêts, même si le document reste incomplet.':'Aucune page PDF prête pour le moment.';
    }
    refreshCompleteDownloadButton();
  }
  function fullPdfReadiness(){
    const parts=[],missing=[],covered=new Set(),seenUrls=new Set();
    const pages=state.canonicalPreview?.pages||{};
    const isReadyPdf=g=>String(g?.status||'').toLowerCase()==='ready'
      &&!!String(g?.page_url||'').trim();
    const isReadySystem=(kind,p)=>canonicalPreviewIsFresh(kind)
      &&String(p?.status||'').toLowerCase()==='ready'
      &&Number(p?.progress||0)>=100
      &&!!String(p?.pdfUrl||'').trim();
    const add=(url,label)=>{
      const u=String(url||'').trim();
      if(!u||seenUrls.has(u))return;
      seenUrls.add(u);
      parts.push({url:u,label});
    };
    for(const kind of ['cover','toc']){
      const p=pages[kind];
      if(isReadySystem(kind,p))add(p.pdfUrl,kind==='cover'?'Couverture':'Sommaire');
      else missing.push(kind==='cover'?'Couverture à générer ou à régénérer':'Sommaire à générer ou à régénérer');
    }

    for(const b of contentBlocks()){
      if(covered.has(String(b.id)))continue;
      if(!hasRenderableContent(b)){covered.add(String(b.id));continue;}
      const group=renderableFlowBlocksFor(b.id);
      const safeGroup=group.length?group:[b];
      const ids=safeGroup.map(part=>String(part?.id||''));
      const owner=safeGroup[0];
      if(safeGroup.length>1){
        const canonical=safeGroup
          .map(part=>part?.generation||{})
          .find(g=>{
            const flowIds=generationFlowIds(g);
            return isReadyPdf(g)
              &&g.independent_regeneration!==true
              &&generationHasFlow(g)
              &&String(g.flow_page_owner_id||'')===String(owner.id)
              &&flowIds.length===ids.length
              &&ids.every((id,index)=>flowIds[index]===id);
          });
        if(canonical){
          add(canonical.page_url,'Flux de contenu à partir de la page '+String(pageNumberFor(owner)));
          ids.forEach(id=>covered.add(id));
          continue;
        }

        // Les données peuvent encore contenir un flux historique produit avant que
        // les médias soient séparés du texte. Si chaque bloc du segment possède
        // un PDF confirmé, on conserve ces fragments même lorsque ses anciennes
        // flow_block_ids ne correspondent plus aux groupes actuels. Les URL
        // identiques sont dédupliquées par add(), sans assembler le même PDF deux fois.
        const readyFragments=safeGroup.every(part=>isReadyPdf(part?.generation))
          &&new Set(safeGroup.map(part=>String(part?.generation?.page_url||'').trim())).size===safeGroup.length;
        if(readyFragments){
          safeGroup.forEach(part=>{
            add(part.generation.page_url,'Page '+String(part.generation.page_number||pageNumberFor(part)));
            covered.add(String(part.id));
          });
          continue;
        }

        missing.push('Séquence « '+String(owner?.content?.title||labelFor(owner))+' » incomplète : générer le flux depuis son premier bloc ou compléter le PDF distinct de chaque bloc manquant.');
        ids.forEach(id=>covered.add(id));
        continue;
      }

      const g=b?.generation||{};
      // Un bloc désormais autonome peut porter des métadonnées de flux anciennes.
      // Le statut ready + une URL PDF restent la preuve de disponibilité du fragment.
      if(isReadyPdf(g)){
        add(g.page_url,'Page '+String(g.page_number||pageNumberFor(b)));
      }else{
        missing.push('Page de contenu « '+String(b?.content?.title||labelFor(b))+' » à générer ou à régénérer');
      }
      covered.add(String(b.id));
    }

    if(isReadySystem('end',pages.end))add(pages.end.pdfUrl,'Fin du document');
    else missing.push('Page de fin à générer ou à régénérer');
    return {parts,missing,complete:missing.length===0&&parts.length>0};
  }
  function finalPdfArtifactMatches(parts){
    const artifact=state.finalPdfArtifact;
    return Boolean(artifact&&artifact.blob&&artifact.fingerprint===finalPdfFingerprint(parts));
  }
  function refreshCompleteDownloadButton(){
    const btn=document.getElementById('aeDownloadPdfComplete'),note=document.getElementById('aeCompleteDownloadNote'),finalizeBtn=document.getElementById('aeFinalizePdf');
    if(!btn&&!note&&!finalizeBtn)return;
    const readiness=fullPdfReadiness(),artifactReady=readiness.complete&&finalPdfArtifactMatches(readiness.parts);
    if(btn){btn.disabled=!artifactReady;btn.title=artifactReady
      ?'Télécharger le PDF complet fusionné et vérifié ; les fragments ont été optimisés individuellement avant la fusion.'
      :'Le PDF téléchargeable sera activé après fusion et vérification de toutes les pages.';
      btn.textContent='Télécharger le PDF complet';}
    const optimizationNeedsRetry=Boolean(artifactReady&&Array.isArray(state.finalPdfArtifact?.optimizationErrors)&&state.finalPdfArtifact.optimizationErrors.length);
    if(finalizeBtn){
      finalizeBtn.disabled=!readiness.complete||(artifactReady&&!optimizationNeedsRetry)||state.pdfBatchRunning||state.pdfFinalizing;
      finalizeBtn.textContent=artifactReady?(optimizationNeedsRetry?'Réessayer compression + fusion':'PDF final prêt'):'Fusionner et vérifier le PDF final';
      finalizeBtn.title=optimizationNeedsRetry?'Relancer la compression des fragments en échec et refaire la fusion, sans régénérer les pages existantes.'
        :artifactReady?'Le PDF final est prêt au téléchargement.'
        :readiness.complete?'Optimiser les fragments individuellement si nécessaire, puis fusionner et vérifier le document. Aucune compression ne sera relancée après la fusion.'
        :'Cette étape sera disponible lorsque toutes les pages seront prêtes.';
    }
    if(note)note.textContent=artifactReady?finalPdfArtifactDescription(state.finalPdfArtifact)
      :readiness.complete?'Toutes les pages sont prêtes. Les fragments sont contrôlés et optimisés individuellement avant la fusion finale.'
      :'En attente : '+readiness.missing.slice(0,4).join(' · ')+(readiness.missing.length>4?' · et '+(readiness.missing.length-4)+' autre(s) élément(s)':'')+'.';
  }
  async function loadPdfLib(){
    if(globalThis.PDFLib?.PDFDocument)return globalThis.PDFLib;
    if(state.pdfLibPromise)return state.pdfLibPromise;
    state.pdfLibPromise=(async()=>{
      const sources=[
        'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
        'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
      ];
      const failures=[];
      for(const src of sources){
        try{
          await new Promise((resolve,reject)=>{
            const script=document.createElement('script');
            let settled=false;
            const finish=(error)=>{
              if(settled)return;
              settled=true;
              clearTimeout(timer);
              script.onload=null;
              script.onerror=null;
              if(error){script.remove();reject(error);}
              else if(globalThis.PDFLib?.PDFDocument)resolve();
              else{script.remove();reject(new Error('Le script chargé ne fournit pas PDFLib.PDFDocument.'));}
            };
            const timeoutMs=src.includes('cdnjs.cloudflare.com')?10000:7000;
            const timer=setTimeout(()=>finish(new Error('Délai dépassé pendant le chargement de '+new URL(src).hostname+'.')),timeoutMs);
            script.src=src;
            script.async=true;
            script.crossOrigin='anonymous';
            script.onload=()=>finish();
            script.onerror=()=>finish(new Error('Échec réseau pour '+new URL(src).hostname+'.'));
            document.head.appendChild(script);
          });
          if(globalThis.PDFLib?.PDFDocument)return globalThis.PDFLib;
        }catch(error){
          failures.push(String(error?.message||error));
        }
      }
      throw new Error('Impossible de charger la bibliothèque PDF. Vérifie la connexion, puis réessaie. '+failures.join(' | '));
    })();
    try{
      return await state.pdfLibPromise;
    }catch(error){
      // Une tentative échouée ne doit pas condamner les clics suivants :
      // le prochain téléchargement doit pouvoir retenter les CDN.
      state.pdfLibPromise=null;
      throw error;
    }
  }
  function formatPdfSize(value){
    const bytes=Math.max(0,Number(value)||0);
    if(bytes<1024)return bytes+' octet(s)';
    const units=['Ko','Mo','Go'];
    let size=bytes/1024,index=0;
    while(size>=1024&&index<units.length-1){size/=1024;index++;}
    return size.toLocaleString('fr-FR',{maximumFractionDigits:1})+' '+units[index];
  }
  function finalPdfArtifactDescription(artifact){
    const pages=Number(artifact?.pageCount)||0,size=formatPdfSize(artifact?.size);
    const fragments=Number(artifact?.optimizedFragmentCount)||0,reduction=Number(artifact?.compressionPercent)||0;
    const errors=Array.isArray(artifact?.optimizationErrors)?artifact.optimizationErrors:[];
    let detail=fragments+' fragment(s) ont été compressés et vérifiés individuellement avant la fusion.';
    if(reduction>0)detail+=' Réduction cumulée des fragments : '+reduction+' % avant assemblage.';
    else detail+=' Les fragments sans gain ont été conservés dans leur version d’origine.';
    if(errors.length){detail+=' La compression individuelle n’a pas abouti pour '+errors.length+' fragment(s) ; leurs fichiers sources restent utilisables.';detail+=' Diagnostic de compression : '+String(errors[0]||'erreur non détaillée').slice(0,420)+'.';}
    return 'PDF complet fusionné et vérifié · '+pages+' page(s) · '+size+'. '+detail+' Aucune compression globale n’est lancée après la fusion.';
  }
  function finalPdfFingerprint(parts){
    const pages=state.canonicalPreview?.pages||{};
    const payload=JSON.stringify({
      courseId:String(state.course?.id||state.course?.course_id||''),
      title:String(state.course?.title||''),
      documentPages:state.course?.document_pages||{},
      blocks:contentBlocks().map(b=>({
        id:String(b?.id||''),type:String(b?.type||''),content:b?.content||{},
        status:String(b?.generation?.status||''),url:String(b?.generation?.page_url||''),
        updatedAt:String(b?.generation?.updated_at||'')
      })),
      system:['cover','toc','end'].map(kind=>[kind,pages[kind]?.pdfUrl||'',pages[kind]?.updatedAt||'',pages[kind]?.status||'']),
      parts:(parts||[]).map(p=>[String(p.url||''),String(p.label||'')])
    });
    let h1=2166136261,h2=2246822519;
    for(let i=0;i<payload.length;i++){
      const code=payload.charCodeAt(i);
      h1=Math.imul(h1^code,16777619);
      h2=Math.imul(h2+code,3266489917);
    }
    return payload.length+':'+(h1>>>0).toString(16)+(h2>>>0).toString(16);
  }
  function withPdfTimeout(promise,timeoutMs,label){
    let timer=null;
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(String(label||'Opération PDF interrompue')+' (délai maximal '+Math.round(timeoutMs/1000)+' s).')),timeoutMs);
    });
    return Promise.race([Promise.resolve(promise),timeout]).finally(()=>{if(timer)clearTimeout(timer);});
  }
  const GHOSTSCRIPT_RUNTIME_CANDIDATES=[
    {label:'jsDelivr',scriptUrl:'https://cdn.jsdelivr.net/npm/@wasm-zoo/ghostscript@0.7.2/browser-ghostscript.js',baseUrl:'https://cdn.jsdelivr.net/npm/@wasm-zoo/ghostscript@0.7.2/'},
    {label:'unpkg',scriptUrl:'https://unpkg.com/@wasm-zoo/ghostscript@0.7.2/browser-ghostscript.js',baseUrl:'https://unpkg.com/@wasm-zoo/ghostscript@0.7.2/'}
  ];
  async function loadGhostscriptClassicRuntime(scriptUrl){
    const current=globalThis.WasmZooGhostscript;
    if(typeof current?.loadHosted==='function')return current;
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      let settled=false,timer=null;
      const finish=error=>{
        if(settled)return;
        settled=true;
        if(timer)clearTimeout(timer);
        script.onload=null;script.onerror=null;
        if(error){script.remove();reject(error);return;}
        const api=globalThis.WasmZooGhostscript;
        if(typeof api?.loadHosted==='function')resolve(api);
        else{script.remove();reject(new Error('Le script chargé ne fournit pas WasmZooGhostscript.loadHosted().'));}
      };
      timer=setTimeout(()=>finish(new Error('Délai dépassé au chargement du runtime Ghostscript depuis '+new URL(scriptUrl).hostname+'.')),12000);
      script.src=scriptUrl;
      script.async=true;
      script.crossOrigin='anonymous';
      script.onload=()=>finish();
      script.onerror=()=>finish(new Error('Échec réseau lors du chargement du runtime Ghostscript depuis '+new URL(scriptUrl).hostname+'.'));
      document.head.appendChild(script);
    });
    return globalThis.WasmZooGhostscript;
  }
  async function loadGhostscriptModule(){
    if(state.ghostscriptModulePromise)return state.ghostscriptModulePromise;
    if(Number(state.ghostscriptFailureUntil)>Date.now())throw new Error(state.ghostscriptFailureMessage||'Le moteur de compression est temporairement indisponible ; le PDF source sera conservé.');
    state.ghostscriptModulePromise=(async()=>{
      const failures=[];
      for(const source of GHOSTSCRIPT_RUNTIME_CANDIDATES){
        let gs=null;
        const probeLogs=[];
        try{
          const api=await loadGhostscriptClassicRuntime(source.scriptUrl);
          if(typeof api?.loadHosted!=='function')throw new Error('Le runtime ne fournit pas loadHosted().');
          // Le paquet WASM Zoo documente ce chargeur classique pour les déploiements
          // statiques : le wrapper, le worker et le fichier WASM restent des URL distinctes.
          gs=api.loadHosted({baseUrl:source.baseUrl});
          if(typeof gs?.load!=='function'||typeof gs?.exec!=='function')throw new Error('Le runtime chargé ne fournit pas load()/exec().');
          await withPdfTimeout(Promise.resolve().then(()=>gs.load()),90000,'Téléchargement du moteur WebAssembly depuis '+source.label);
          // Sonde réelle : elle vérifie aussi que le worker peut charger gs-core.js,
          // pas seulement que le fichier .wasm répond au réseau.
          const probe=await withPdfTimeout(Promise.resolve().then(()=>gs.exec(['--version'],{
            timeoutMs:45000,
            onLog:event=>{
              const line=String(event?.stream||'')+': '+String(event?.message||'');
              probeLogs.push(line);
              if(probeLogs.length>12)probeLogs.shift();
            }
          })),50000,'Test du moteur Ghostscript depuis '+source.label);
          if(Number(probe?.exitCode??0)!==0)throw new Error('La sonde Ghostscript a renvoyé le code '+String(probe?.exitCode)+'.');
          state.ghostscriptInstance=gs;
          state.ghostscriptFailureUntil=0;
          state.ghostscriptFailureMessage='';
          return gs;
        }catch(error){
          try{gs?.dispose?.();}catch(_){}
          const detail=String(error?.message||error||'Erreur inconnue').slice(0,360);
          const logs=probeLogs.length?' · sortie moteur : '+probeLogs.slice(-5).join(' | ').slice(0,260):'';
          failures.push(source.label+' : '+detail+logs);
        }
      }
      throw new Error('Initialisation du moteur de compression impossible. Les deux hébergeurs du moteur ont échoué. '+failures.join(' || ').slice(0,900));
    })();
    try{
      return await state.ghostscriptModulePromise;
    }catch(error){
      state.ghostscriptModulePromise=null;
      state.ghostscriptFailureUntil=Date.now()+30000;
      state.ghostscriptFailureMessage=String(error?.message||error).slice(0,900);
      throw error;
    }
  }
  async function getGhostscriptInstance(){
    if(state.ghostscriptInstance)return state.ghostscriptInstance;
    if(Number(state.ghostscriptFailureUntil)>Date.now())throw new Error(state.ghostscriptFailureMessage||'Le moteur de compression est temporairement indisponible ; le PDF source sera conservé.');
    return await loadGhostscriptModule();
  }
  async function compressPdfWithGhostscript(bytes){
    const gs=await getGhostscriptInstance();
    const logs=[];
    try{
      const result=await withPdfTimeout(Promise.resolve().then(()=>gs.exec([
        '-dSAFER','-sDEVICE=pdfwrite','-dCompatibilityLevel=1.4',
        '-dDownsampleColorImages=false','-dDownsampleGrayImages=false','-dDownsampleMonoImages=false',
        '-sColorConversionStrategy=LeaveColorUnchanged',
        '-dPassThroughJPEGImages=true','-dPassThroughJPXImages=true',
        '-dNOPAUSE','-dQUIET','-dBATCH','-dDetectDuplicateImages=true',
        '-dCompressFonts=true','-dSubsetFonts=true',
        '-sOutputFile=/out/aurore-final.pdf',
        '-c','<< /ColorImageDict << /QFactor 0.15 /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> /GrayImageDict << /QFactor 0.15 /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> >> setdistillerparams',
        '-f','/input.pdf'
      ],{
        files:[{name:'/input.pdf',data:asPdfBytes(bytes)}],
        dirs:['/out'],
        outputs:['/out/aurore-final.pdf'],
        timeoutMs:60000,
        onLog:event=>{
          const line=String(event?.stream||'')+': '+String(event?.message||'');
          logs.push(line);
          if(logs.length>16)logs.shift();
        }
      })),65000,'La compression individuelle dépasse le délai prévu ; le fragment PDF source sera conservé');
      if(Number(result?.exitCode??0)!==0)throw new Error('Ghostscript a terminé avec le code '+String(result?.exitCode)+'.');
      const output=(result?.files||[]).find(file=>String(file?.name||'').replace(/\\/g,'/').endsWith('/aurore-final.pdf')&&file?.data);
      if(!output)throw new Error('Le moteur n’a fourni aucun PDF compressé.');
      const compressed=asPdfBytes(output.data);
      if(!hasPdfSignature(compressed))throw new Error('Le résultat du moteur de compression n’est pas un PDF valide.');
      return compressed;
    }catch(error){
      // Chaque exec WASM Zoo utilise un Worker isolé : l’échec d’un PDF ne rend pas
      // le runner inutilisable pour les fragments suivants. Évite le cooldown global,
      // qui transformait une panne locale en une série d’échecs pour tous les fragments.
      const cause=String(error?.message||error||'Erreur Ghostscript inconnue').slice(0,500);
      const detail=logs.length?' · dernières sorties Ghostscript : '+logs.slice(-8).join(' | ').slice(0,500):'';
      throw new Error('Compression du fragment par Ghostscript impossible : '+cause+detail);
    }
  }
  function asPdfBytes(value){
    if(value instanceof Uint8Array)return value;
    if(value instanceof ArrayBuffer)return new Uint8Array(value);
    if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
    return new Uint8Array(value||[]);
  }
  function hasPdfSignature(value){
    const bytes=asPdfBytes(value);
    return bytes.byteLength>=5&&String.fromCharCode(bytes[0],bytes[1],bytes[2],bytes[3],bytes[4])==='%PDF-';
  }
  function openPdfPartCache(){
    if(typeof indexedDB==='undefined')return Promise.resolve(null);
    if(pdfPartCacheDbPromise)return pdfPartCacheDbPromise;
    pdfPartCacheDbPromise=new Promise(resolve=>{
      let request;
      try{request=indexedDB.open(PDF_PART_CACHE_DB,1);}catch(_){resolve(null);return;}
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(PDF_PART_CACHE_STORE))db.createObjectStore(PDF_PART_CACHE_STORE,{keyPath:'url'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>resolve(null);
      request.onblocked=()=>resolve(null);
    });
    return pdfPartCacheDbPromise;
  }
  async function readOptimizedPdfPart(url){
    const key=String(url||'').trim();if(!key)return null;
    if(pdfPartMemoryCache.has(key))return pdfPartMemoryCache.get(key);
    const db=await openPdfPartCache();if(!db)return null;
    return await new Promise(resolve=>{
      let request;
      try{request=db.transaction(PDF_PART_CACHE_STORE,'readonly').objectStore(PDF_PART_CACHE_STORE).get(key);}
      catch(_){resolve(null);return;}
      request.onsuccess=()=>{
        const value=request.result;
        if(!value){resolve(null);return;}
        resolve({...value,bytes:value.bytes?asPdfBytes(value.bytes):null});
      };
      request.onerror=()=>resolve(null);
    });
  }
  async function writeOptimizedPdfPart(record){
    if(!record?.url)return false;
    const url=String(record.url),bytes=record.bytes?asPdfBytes(record.bytes):null;
    const stored={...record,bytes:bytes?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):null};
    const db=await openPdfPartCache();
    if(db){
      const saved=await new Promise(resolve=>{
        try{
          const tx=db.transaction(PDF_PART_CACHE_STORE,'readwrite');
          tx.objectStore(PDF_PART_CACHE_STORE).put(stored);
          tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false);
        }catch(_){resolve(false);}
      });
      if(saved){pdfPartMemoryCache.delete(url);return true;}
    }
    pdfPartMemoryCache.set(url,{...record,bytes:record.compressed&&bytes?new Uint8Array(bytes):null});
    return false;
  }
  async function deleteOptimizedPdfPart(url){
    const key=String(url||'').trim();if(!key)return;
    pdfPartMemoryCache.delete(key);
    const db=await openPdfPartCache();if(!db)return;
    await new Promise(resolve=>{
      try{
        const tx=db.transaction(PDF_PART_CACHE_STORE,'readwrite');
        tx.objectStore(PDF_PART_CACHE_STORE).delete(key);
        tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false);
      }catch(_){resolve(false);}
    });
  }
  async function fetchOriginalPdfPart(part,timeoutMs=60000){
    const controller=typeof AbortController==='function'?new AbortController():null;
    let timer=null;
    try{
      const request=fetch(part.url,{cache:'no-store',...(controller?{signal:controller.signal}:{})});
      const timeout=new Promise((_,reject)=>{
        timer=setTimeout(()=>{
          try{controller?.abort();}catch(_){}
          reject(new Error('Délai dépassé après '+Math.round(timeoutMs/1000)+' s lors du téléchargement de « '+part.label+' ». Le fragment reste intact : relance uniquement la fusion.'));
        },timeoutMs);
      });
      const response=await Promise.race([request,timeout]);
      if(!response.ok)throw new Error('Impossible de récupérer '+part.label+' (HTTP '+response.status+').');
      const bytes=await Promise.race([response.arrayBuffer(),timeout]);
      if(!bytes||bytes.byteLength<5)throw new Error(part.label+' a renvoyé un fichier vide ou trop court pour être un PDF.');
      return bytes;
    }catch(error){
      if(error?.name==='AbortError')throw new Error('Téléchargement interrompu pour « '+part.label+' ». Réessaie la fusion ; les pages générées restent intactes.');
      throw error;
    }finally{if(timer)clearTimeout(timer);}
  }
  function enqueuePdfCompression(bytes){
    const task=pdfCompressionQueue.then(()=>compressPdfWithGhostscript(bytes),()=>compressPdfWithGhostscript(bytes));
    pdfCompressionQueue=task.then(()=>undefined,()=>undefined);
    return task;
  }
  async function optimizePdfPart(part,{force=false}={}){
    const url=String(part?.url||'').trim(),label=String(part?.label||'fragment PDF');
    if(!url)return {url,attempted:false,compressed:false,compressionError:'URL du fragment PDF manquante.'};
    const running=pdfPartOptimizationJobs.get(url);if(running)return running;
    const job=(async()=>{
      try{
        if(force)await deleteOptimizedPdfPart(url);
        else{
          const cached=await readOptimizedPdfPart(url);
          // Ne jamais rendre une erreur de compression définitive : une nouvelle fusion doit pouvoir réessayer après un échec transitoire du moteur WASM.
          if(cached&&cached.attempted&&!cached.compressionError)return cached;
        }
        const originalBuffer=await fetchOriginalPdfPart({url,label}),original=asPdfBytes(originalBuffer);
        if(!hasPdfSignature(original))throw new Error('Le fragment source ne possède pas une signature PDF valide.');
        const {PDFDocument}=await loadPdfLib();
        const sourceDocument=await withPdfTimeout(PDFDocument.load(original),20000,'Vérification du PDF source');
        const pageCount=sourceDocument.getPageCount();
        if(!pageCount)throw new Error('Le fragment source ne contient aucune page.');
        let compressedBytes=null,compressionError='',note='';
        try{
          const candidate=asPdfBytes(await enqueuePdfCompression(original));
          if(candidate.byteLength<original.byteLength){
            if(!hasPdfSignature(candidate))throw new Error('Le résultat de la compression individuelle n’est pas un PDF valide.');
            const compactDocument=await withPdfTimeout(PDFDocument.load(candidate),20000,'Vérification du PDF compressé');
            if(compactDocument.getPageCount()!==pageCount)throw new Error('La compression individuelle a modifié la pagination ('+compactDocument.getPageCount()+' au lieu de '+pageCount+').');
            compressedBytes=candidate;
          }else note='La compression individuelle n’a pas permis de réduire la taille ; le PDF source est conservé.';
        }catch(error){compressionError=String(error?.message||error||'Erreur de compression individuelle inconnue').slice(0,240);}
        const record={url,attempted:true,compressed:!!compressedBytes,bytes:compressedBytes?new Uint8Array(compressedBytes):new Uint8Array(original),
          originalSize:original.byteLength,size:compressedBytes?compressedBytes.byteLength:original.byteLength,pageCount,compressionError,note,updatedAt:new Date().toISOString()};
        await writeOptimizedPdfPart(record);return record;
      }catch(error){
        return {url,attempted:false,compressed:false,bytes:null,originalSize:null,size:null,pageCount:null,
          compressionError:String(error?.message||error||'Optimisation individuelle impossible').slice(0,240),updatedAt:new Date().toISOString()};
      }
    })();
    pdfPartOptimizationJobs.set(url,job);
    try{return await job;}finally{if(pdfPartOptimizationJobs.get(url)===job)pdfPartOptimizationJobs.delete(url);}
  }
  function pdfOptimizationMetadata(result){
    if(!result)return {status:'pending',compressed:false,error:null};
    const failed=!!result.compressionError;
    return {status:result.compressed?'compressed':failed?'original_preserved':result.attempted?'checked':'pending',
      compressed:!!result.compressed,original_bytes:Number(result.originalSize)||null,optimized_bytes:Number(result.size)||Number(result.originalSize)||null,
      page_count:Number(result.pageCount)||null,error:failed?String(result.compressionError).slice(0,420):null,updated_at:result.updatedAt||new Date().toISOString()};
  }
  async function fetchFinalPdfPart(part,timeoutMs=60000){
    const cached=await readOptimizedPdfPart(part?.url);
    if(cached?.attempted&&cached.bytes){const bytes=asPdfBytes(cached.bytes);if(hasPdfSignature(bytes))return bytes;}
    return await fetchOriginalPdfPart(part,timeoutMs);
  }
  async function preparePdfPartCompression(parts){
    const unique=[],seen=new Set();
    for(const part of parts||[]){const url=String(part?.url||'').trim();if(url&&!seen.has(url)){seen.add(url);unique.push(part);}}
    const summary={originalBytes:0,optimizedInputBytes:0,compressedCount:0,unchangedCount:0,errors:[]};
    for(let i=0;i<unique.length;i++){
      const part=unique[i];
      setPdfBatchProgress('Compression individuelle avant fusion · '+(i+1)+'/'+unique.length+' : '+part.label,87+Math.round(((i+1)/Math.max(1,unique.length))*7));
      setStatus('Contrôle et optimisation individuelle du fragment « '+part.label+' » ('+(i+1)+'/'+unique.length+')…');
      await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
      let result;try{result=await optimizePdfPart(part);}catch(error){result={attempted:false,compressed:false,compressionError:String(error?.message||error)};}
      if(result.compressed){summary.compressedCount++;summary.originalBytes+=Number(result.originalSize)||0;summary.optimizedInputBytes+=Number(result.size)||0;}
      else{summary.unchangedCount++;summary.originalBytes+=Number(result.originalSize)||0;summary.optimizedInputBytes+=Number(result.originalSize)||0;}
      if(result.compressionError)summary.errors.push(String(part.label||'Fragment PDF')+': '+String(result.compressionError).slice(0,420));
    }
    summary.compressionPercent=summary.originalBytes>0?Math.max(0,Math.round((1-summary.optimizedInputBytes/summary.originalBytes)*100)):0;
    return summary;
  }
  async function buildFinalPdfArtifact(parts){
    if(!Array.isArray(parts)||!parts.length)throw new Error('Aucune partie PDF n’est disponible pour la fusion finale.');
    setPdfBatchProgress('Optimisation individuelle des fragments avant fusion…',86);
    setStatus('Chaque fragment PDF est contrôlé et optimisé séparément avant assemblage.');
    const optimization=await preparePdfPartCompression(parts);
    setPdfBatchProgress('Fragments individuels traités · préparation du moteur de fusion…',95);
    setStatus('Assemblage des fragments PDF optimisés, sans compression globale après fusion…');
    const {PDFDocument}=await loadPdfLib(),merged=await PDFDocument.create();
    let physicalPages=0;
    for(let i=0;i<parts.length;i++){
      const part=parts[i],stage='Fusion PDF · '+(i+1)+'/'+parts.length+' : '+part.label;
      setPdfBatchProgress(stage,95+Math.round(((i+1)/parts.length)*3));setStatus(stage+'…');
      await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
      const bytes=asPdfBytes(await fetchFinalPdfPart(part));
      if(!hasPdfSignature(bytes))throw new Error('Le fichier récupéré pour « '+part.label+' » ne commence pas par une signature PDF valide.');
      let source;
      try{source=await withPdfTimeout(PDFDocument.load(bytes),30000,'Vérification du fragment '+part.label);}
      catch(error){throw new Error('Le PDF de « '+part.label+' » est illisible : '+String(error?.message||error).slice(0,180));}
      const sourceIndices=source.getPageIndices();
      if(!sourceIndices.length)throw new Error(part.label+' ne contient aucune page PDF exploitable.');
      const copied=await merged.copyPages(source,sourceIndices);copied.forEach(page=>merged.addPage(page));physicalPages+=copied.length;
    }
    if(physicalPages<parts.length||merged.getPageCount()!==physicalPages)throw new Error('Le nombre de pages physiques fusionnées est incohérent : '+merged.getPageCount()+' page(s) pour '+physicalPages+' page(s) copiée(s).');
    setPdfBatchProgress('Enregistrement du PDF fusionné…',99);
    const finalBytes=asPdfBytes(await merged.save({useObjectStreams:true}));
    if(!hasPdfSignature(finalBytes))throw new Error('Le moteur de fusion n’a pas produit de fichier PDF valide.');
    setPdfBatchProgress('Vérification du PDF final · lecture et pagination…',99);
    let verified;
    try{verified=await withPdfTimeout(PDFDocument.load(finalBytes),30000,'Vérification du PDF final');}
    catch(error){throw new Error('Le PDF fusionné est illisible : '+String(error?.message||error).slice(0,200));}
    if(verified.getPageCount()!==physicalPages)throw new Error('Le contrôle final détecte '+verified.getPageCount()+' page(s), au lieu de '+physicalPages+' après fusion.');
    const blob=new Blob([finalBytes],{type:'application/pdf'});
    return {fingerprint:finalPdfFingerprint(parts),blob,size:blob.size,pageCount:physicalPages,
      optimizedFragmentCount:optimization.compressedCount||0,unchangedFragmentCount:optimization.unchangedCount||0,
      originalPartsSize:optimization.originalBytes||0,optimizedPartsSize:optimization.optimizedInputBytes||0,
      compressionPercent:optimization.compressionPercent||0,optimizationErrors:(optimization.errors||[]).slice(0,12),
      createdAt:new Date().toISOString(),compressionEngine:'per-fragment-before-merge'};
  }
  async function finalizePdfAssembly(){
    if(state.pdfBatchRunning||state.pdfFinalizing)return;
    const readiness=fullPdfReadiness();
    if(!readiness.complete){setStatus('Fusion impossible : '+readiness.missing.slice(0,4).join(' · '));refreshCompleteDownloadButton();return;}
    state.pdfFinalizing=true;refreshDownloadButton();
    try{
      const artifact=await buildFinalPdfArtifact(readiness.parts);
      state.finalPdfArtifact=artifact;
      setPdfBatchProgress('Terminé · '+artifact.pageCount+' page(s) fusionnées et vérifiées · '+formatPdfSize(artifact.size)+'.',100);
      setStatus(finalPdfArtifactDescription(artifact));
    }catch(error){
      state.finalPdfArtifact=null;setPdfBatchProgress('Fusion à relancer · '+String(error?.message||error).slice(0,110),99);
      setStatus('Les fragments sont prêts, mais la fusion ou la vérification a échoué : '+String(error?.message||error));
    }finally{state.pdfFinalizing=false;renderPdfBatchProgress();refreshDownloadButton();}
  }
  async function downloadCurrentPdf(complete=false){
    if(complete){
      const readiness=fullPdfReadiness();
      if(!readiness.complete){
        setStatus('Téléchargement complet bloqué : '+readiness.missing.slice(0,4).join(' · '));
        refreshDownloadButton();
        return;
      }
      const artifact=state.finalPdfArtifact;
      if(!artifact||artifact.fingerprint!==finalPdfFingerprint(readiness.parts)){
        setStatus('Les pages sont prêtes, mais le PDF final doit encore être fusionné et vérifié.');
        refreshDownloadButton();
        return;
      }
      const url=URL.createObjectURL(artifact.blob),a=document.createElement('a');
      const safeTitle=String(state.course?.title||'aurore-cours').trim().replace(/[^\p{L}\p{N}_-]+/gu,'-')||'aurore-cours';
      a.href=url;a.download=safeTitle+'-document-complet.pdf';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      setStatus('PDF complet téléchargé · '+artifact.pageCount+' page(s) · '+formatPdfSize(artifact.size)+'. Les fragments ont été optimisés individuellement avant la fusion.');
      return;
    }
    const parts=downloadablePdfParts();
    if(!parts.length){setStatus('Aucune page PDF n’est encore prête.');refreshDownloadButton();return;}
    try{
      setStatus('Assemblage des pages PDF prêtes…');
      const {PDFDocument}=await loadPdfLib();
      const merged=await PDFDocument.create();
      let physicalPages=0;
      for(let i=0;i<parts.length;i++){
        const p=parts[i];
        setStatus('Assemblage : '+p.label+' ('+(i+1)+'/'+parts.length+')…');
        const source=await PDFDocument.load(await fetchFinalPdfPart(p));
        const sourceIndices=source.getPageIndices();
        if(!sourceIndices.length)throw new Error(p.label+' ne contient aucune page PDF.');
        const copied=await merged.copyPages(source,sourceIndices);
        copied.forEach(page=>merged.addPage(page));
        physicalPages+=copied.length;
      }
      const bytes=await merged.save({useObjectStreams:true});
      const blob=new Blob([bytes],{type:'application/pdf'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      const safeTitle=String(state.course?.title||'aurore-cours').trim().replace(/[^\p{L}\p{N}_-]+/gu,'-')||'aurore-cours';
      a.href=url;a.download=safeTitle+'-etat-actuel.pdf';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      setStatus('Fragments PDF téléchargés · '+physicalPages+' page(s) physique(s) disponibles.');
    }catch(e){
      setStatus('Échec du téléchargement : '+String(e?.message||e));
    }
  }

  async function generateAllPages(){
    if(state.pdfBatchRunning||!state.course)return;
    state.pdfBatchRunning=true;
    state.finalPdfArtifact=null;
    state.pdfBatchProgress={percent:0,label:'Inventaire des pages à générer…',targetCount:0,activeTargetIndex:0,completedTargets:0};
    renderWorkspace();
    renderPdfBatchProgress();
    const failures=[];
    const addFailure=message=>{
      const value=String(message||'').trim();
      if(value&&!failures.includes(value))failures.push(value);
    };
    const titleFor=b=>String(b?.content?.title||b?.content?.json?.title||labelFor(b)||b?.type||'Bloc sans titre');
    const markGroupError=(group,message)=>{
      for(const part of group){
        if(!part||!hasRenderableContent(part))continue;
        part.generation={
          ...(part.generation||{}),
          status:'error',
          progress:0,
          progress_label:'Échec — contenu à corriger ou PDF absent',
          error:String(message||'Le rendu de ce bloc n’a pas été confirmé.'),
          updated_at:new Date().toISOString()
        };
      }
    };
    const buildTargets=()=>{
      const targets=[],seen=new Set();
      for(const block of contentBlocks()){
        const id=String(block?.id||'');
        if(!id||seen.has(id))continue;
        // Marquer toute la séquence avant de filtrer les blocs vides.
        // Le rendu est détenu par le premier bloc réellement rendable, pas
        // nécessairement par le premier élément structurel de la séquence.
        const rawGroup=flowBlocksFor(id);
        const allMembers=rawGroup.length?rawGroup:[block];
        allMembers.forEach(part=>{
          const memberId=String(part?.id||'');
          if(memberId)seen.add(memberId);
        });
        const group=allMembers.filter(hasRenderableContent);
        if(!group.length)continue;
        const owner=group[0];
        targets.push({id:String(owner.id),blockIds:group.map(part=>String(part.id))});
      }
      return targets;
    };
    try{
      await persistCourse(true,false);
      let targets=buildTargets();
      let blockCursor=0;
      targets=targets.map(target=>{
        const item={...target,startIndex:blockCursor};
        blockCursor+=target.blockIds.length;
        return item;
      });
      const totalBlockCount=blockCursor;
      const expectedIds=new Set(contentBlocks().filter(hasRenderableContent).map(block=>String(block.id)));
      const scheduledIds=new Set(targets.flatMap(target=>target.blockIds));
      const uncovered=[...expectedIds].filter(id=>!scheduledIds.has(id));
      if(uncovered.length){
        throw new Error('Inventaire incomplet : '+uncovered.length+' bloc(s) avec contenu ne sont rattachés à aucun rendu ('+uncovered.slice(0,6).join(', ')+'). Aucun résultat incomplet ne sera déclaré prêt.');
      }
      const rangeLabel=target=>{
        const first=target.startIndex+1;
        const last=Math.min(totalBlockCount,target.startIndex+target.blockIds.length);
        return first===last?'bloc '+first+'/'+totalBlockCount:'blocs '+first+'–'+last+'/'+totalBlockCount;
      };
      const rangePercent=(target,completed=false)=>totalBlockCount
        ?Math.round(((target.startIndex+(completed?target.blockIds.length:0))/totalBlockCount)*82):82;
      state.pdfBatchProgress={...(state.pdfBatchProgress||{}),targetCount:totalBlockCount,targetSequenceCount:targets.length,activeTargetIndex:0,activeTargetSize:1,completedTargets:0,percent:0};
      setPdfBatchProgress(totalBlockCount
        ?'Inventaire terminé · '+totalBlockCount+' bloc(s) de contenu dans '+targets.length+' séquence(s) de rendu.'
        :'Aucun bloc de contenu rendable · contrôle des pages système.',0);
      if(!totalBlockCount)setStatus('Aucun bloc de contenu non vide : les pages système vont être régénérées.');

      for(let i=0;i<targets.length;i++){
        const target=targets[i];
        const block=activeBlocks().find(item=>String(item?.id||'')===target.id);
        // Un bloc long peut être remplacé par plusieurs fragments durant sa génération.
        // Dans ce cas generateBlock s'occupe déjà des fragments ; on ne signale pas
        // faussement l'ancien identifiant comme une page manquante.
        if(!block||!hasRenderableContent(block)){
          state.pdfBatchProgress.completedTargets=target.startIndex+target.blockIds.length;
          setPdfBatchProgress('Séquence '+rangeLabel(target)+' · contenu réorganisé pendant le rendu.',rangePercent(target,true));
          continue;
        }
        state.pdfBatchProgress.activeTargetIndex=target.startIndex;
        state.pdfBatchProgress.activeTargetSize=target.blockIds.length;
        setPdfBatchProgress('Précontrôle '+rangeLabel(target)+' · '+titleFor(block),rangePercent(target));

        const currentGroup=renderableFlowBlocksFor(block.id);
        const invalid=currentGroup.map(part=>({part,validation:validateBlock(part)})).filter(x=>!x.validation.ok);
        if(invalid.length){
          const message=invalid.map(item=>
            titleFor(item.part)+': '+(item.validation.errors||['validation impossible']).join(' ')).join(' · ');
          markGroupError(currentGroup,message);
          addFailure(message);
          state.pdfBatchProgress.completedTargets=target.startIndex+target.blockIds.length;
          setPdfBatchProgress('Séquence '+rangeLabel(target)+' en erreur · contenu à corriger.',rangePercent(target,true));
          setStatus('Précontrôle '+rangeLabel(target)+' : contenu à corriger — '+message.slice(0,260));
          continue;
        }

        state.pdfBatchProgress.activeTargetIndex=target.startIndex;
        state.pdfBatchProgress.activeTargetSize=target.blockIds.length;
        setPdfBatchProgress('Rendu '+rangeLabel(target)+' · '+titleFor(block),rangePercent(target));
        setStatus('Génération des pages de contenu '+rangeLabel(target)+' : '+titleFor(block)+'…');
        await generateBlock(block.id);

        const stillExists=activeBlocks().find(item=>String(item?.id||'')===target.id);
        if(stillExists){
          const checkGroup=renderableFlowBlocksFor(stillExists.id);
          const notReady=checkGroup.filter(part=>
            String(part?.generation?.status||'').toLowerCase()!=='ready'
            ||!String(part?.generation?.page_url||'').trim());
          if(notReady.length){
            for(const part of notReady){
              addFailure(titleFor(part)+' : '+String(part?.generation?.error||'PDF non confirmé après la génération.'));
            }
          }
          if(checkGroup.length>1){
            const expectedIds=checkGroup.map(part=>String(part.id));
            const ownerGeneration=stillExists.generation||{};
            const actualIds=generationFlowIds(ownerGeneration);
            const canonical=ownerGeneration.independent_regeneration!==true
              &&String(ownerGeneration.flow_page_owner_id||'')===String(stillExists.id)
              &&actualIds.length===expectedIds.length
              &&expectedIds.every((expected,index)=>actualIds[index]===expected)
              &&generationIsReady(ownerGeneration);
            const readyFragments=checkGroup.every(part=>{
              const generation=part?.generation||{};
              return String(generation.status||'').toLowerCase()==='ready'
                &&!!String(generation.page_url||'').trim();
            })&&new Set(checkGroup.map(part=>String(part?.generation?.page_url||'').trim())).size===checkGroup.length;
            if(!canonical&&!readyFragments){
              const detail='Couverture PDF incohérente : '+expectedIds.length+' bloc(s) attendus, '+actualIds.length+' confirmé(s), et tous les fragments indépendants ne sont pas prêts.';
              addFailure('Séquence « '+titleFor(stillExists)+' » : '+detail);
              markGroupError(checkGroup,detail);
              await persistCourse(true,false);
            }
          }
        }
        state.pdfBatchProgress.completedTargets=target.startIndex+target.blockIds.length;
        setPdfBatchProgress('Séquence '+rangeLabel(target)+(failures.length?' traitée · contrôle des erreurs en cours.':' rendue et vérifiée.'),rangePercent(target,true));
      }

      // Contrôle du contenu actuel après les générations et éventuels découpages automatiques.
      const unresolvedContent=contentBlocks().filter(hasRenderableContent).filter(block=>
        String(block?.generation?.status||'').toLowerCase()!=='ready'
        ||!String(block?.generation?.page_url||'').trim());
      for(const block of unresolvedContent){
        addFailure(titleFor(block)+' : '+String(block?.generation?.error||'page non générée ou URL PDF absente.'));
      }

      // Les pages système sont générées EN DERNIER : la génération d’un bloc long
      // peut insérer des fragments et modifier la pagination ainsi que le sommaire.
      setPdfBatchProgress('Mise à jour du sommaire, de la couverture et de la page de fin…',86);
      setStatus('Mise à jour finale du sommaire et génération de la couverture et de la page de fin…');
      try{
        rebuildTocEntries();
        await persistCourse(true,false);
        await prepareSystemPreview({force:false});
      }catch(error){
        addFailure('Pages système : '+String(error?.message||error));
      }

      setPdfBatchProgress('Contrôle des PDF, des liens et de la pagination…',86);
      const systemPages=state.canonicalPreview?.pages||{};
      for(const kind of ['cover','toc','end']){
        const page=systemPages[kind]||{};
        if(String(page.status||'').toLowerCase()!=='ready'
          ||!String(page.pdfUrl||'').trim()
          ||!canonicalPreviewIsFresh(kind)){
          addFailure((kind==='cover'?'Couverture':kind==='toc'?'Sommaire':'Page de fin')
            +' : PDF absent, non prêt ou pagination périmée.');
        }
      }
      await persistCourse(true,false);
      const readiness=fullPdfReadiness();
      if(readiness.complete){
        state.finalPdfArtifact=null;
        state.pdfFinalizing=true;
        refreshDownloadButton();
        try{
          state.finalPdfArtifact=await buildFinalPdfArtifact(readiness.parts);
        }catch(error){
          state.finalPdfArtifact=null;
          addFailure('Fusion et vérification du PDF final : '+String(error?.message||error));
        }finally{
          state.pdfFinalizing=false;
        }
      }
      const artifactReady=readiness.complete&&finalPdfArtifactMatches(readiness.parts);
      const pending=[...new Set([...failures,...readiness.missing,...(!artifactReady&&readiness.complete?['Fusion et vérification du PDF final à terminer ou à relancer.']:[])])];
      if(readiness.complete&&artifactReady){
        const artifact=state.finalPdfArtifact;
        setPdfBatchProgress('Terminé · '+artifact.pageCount+' pages fusionnées et vérifiées · PDF final '+formatPdfSize(artifact.size)+'.',100);
        setStatus(finalPdfArtifactDescription(artifact)+' Le bouton « Télécharger le PDF complet » est activé.');
      }else if(readiness.complete){
        const finalizationErrors=failures.filter(item=>String(item).includes('Fusion et vérification du PDF final'));
        setPdfBatchProgress('Pages prêtes · fusion à terminer ('+Math.max(1,finalizationErrors.length)+' point(s)).',99);
        setStatus('Toutes les pages sont prêtes, mais le PDF final n’a pas encore passé la vérification : '
          +(finalizationErrors.length?finalizationErrors.join(' · '):'la fusion doit être relancée.')
          +' Utilise « Fusionner et vérifier le PDF final » pour relancer uniquement cette étape.');
      }else{
        setPdfBatchProgress('Vérification terminée · document incomplet ('+pending.length+' point(s) à corriger).',99);
        setStatus('Document NON prêt — des pages ou liens ne sont pas confirmés : '+pending.slice(0,8).join(' · ')
          +(pending.length>8?' · et '+(pending.length-8)+' autre(s) élément(s) à vérifier':''));
      }
    }catch(error){
      setPdfBatchProgress('Arrêt sur erreur · '+String(error?.message||error).slice(0,150),state.pdfBatchProgress?.percent||0);
      setStatus('Échec de la génération générale : '+String(error?.message||error));
    }finally{
      state.pdfBatchRunning=false;
      renderWorkspace();
      renderPdfBatchProgress();
      refreshDownloadButton();
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
        return '<article class="ae-course-card"><div class="ae-course-card-top"><span class="ae-course-status">'+esc(c.status||'editing')+'</span><span>'+generated+' page(s)</span></div><h4>'+esc(c.title)+'</h4><p>'+count+' bloc(s) · dernière modification '+esc(formatDate(c.updated_at||c.created_at))+'</p><div class="ae-course-actions"><button class="admin-btn primary" data-open-course="'+esc(c.id)+'">Ouvrir</button><button class="admin-btn ghost" data-rename-course="'+esc(c.id)+'">Renommer</button><button class="admin-btn danger" data-delete-course="'+esc(c.id)+'">Supprimer</button></div></article>'
      }).join(''):'<div class="ae-empty"><strong>Aucun cours en édition.</strong><span>Crée ton premier cours pour ouvrir l’atelier.</span></div>')+
      '</div></div>';
    document.getElementById('aeCreate').onclick=()=>createCourseDialog();
    document.getElementById('aeRefresh').onclick=async()=>{try{setStatus('Actualisation…');await loadCourses();renderList();setStatus('Liste actualisée.')}catch(e){setStatus('Impossible d’actualiser.')}};
    r.querySelectorAll('[data-open-course]').forEach(b=>b.onclick=()=>openCourse(b.dataset.openCourse));
    r.querySelectorAll('[data-rename-course]').forEach(b=>b.onclick=()=>renameCourse(b.dataset.renameCourse));
    r.querySelectorAll('[data-delete-course]').forEach(b=>b.onclick=()=>deleteCourse(b.dataset.deleteCourse));
  }

  async function deleteCourse(id){
    const courseId=String(id||state.course?.id||'').trim();
    if(!courseId){setStatus('Aucun cours sélectionné pour la suppression.');return;}
    const row=state.courses.find(c=>String(c.id)===courseId);
    const title=String(row?.title||(String(state.course?.id)===courseId?state.course?.title:'')||'ce cours');
    if(typeof window.confirm==='function'&&!window.confirm('Supprimer définitivement le cours « '+title+' » de l’éditeur assisté ? Cette action supprime le brouillon, pas les documents/PDF déjà générés.'))return;
    const c=client();
    if(!c){setStatus('Suppression impossible : session Supabase indisponible.');return;}
    try{
      const {data:{user}={}}=await c.auth.getUser();
      if(!user?.id)throw new Error('Session administrateur absente.');
      const {data,error}=await c.from('aurora_assisted_courses').delete().eq('id',courseId).eq('created_by',user.id).select('id');
      if(error)throw error;
      if(!Array.isArray(data)||!data.some(x=>String(x.id)===courseId))throw new Error('Aucun brouillon supprimé : cours introuvable ou accès refusé.');
      if(String(state.course?.id)===courseId){state.course=null;state.selected=null;state.mode='list';}
      try{const draft=JSON.parse(localStorage.getItem('aurore_assisted_course')||'null');if(String(draft?.id||'')===courseId)localStorage.removeItem('aurore_assisted_course');}catch(_){}
      await loadCourses();
      renderList();
      setStatus('Cours supprimé. Les documents/PDF déjà générés sont conservés.');
    }catch(e){setStatus('Suppression impossible : '+String(e?.message||e));}
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
      if(!canonicalPreviewIsFresh())void prepareSystemPreview({force:false});
    }
  }

  function normalizeContent(type,v){
    const x=v&&typeof v==='object'&&!Array.isArray(v)?clone(v):(type==='paragraph'&&typeof v==='string'?{text:v}:{});
    if(['graphique','vector-scene','fiche-revision'].includes(type)) return {json:x};
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
    if(['graphique','vector-scene','fiche-revision'].includes(b.type))return b.content?.json||{};
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
      // Dans l’éditeur assisté, le corrigé dépend de l’exercice et doit être
      // présent avant de déclarer la génération complète.
      if(String(b.content?.statement||'').trim()&&!String(b.content?.correction||'').trim()&&b.generation?.split_exercise_continuation!==true){
        errors.push('Le corrigé de cet exercice est obligatoire : la page ne peut pas être déclarée complète sans lui.');
      }
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
    if(b.type==='vector-scene'){
      const sc=b.content?.json?.scene;
      const kinds=['axes','plot','line','arrow','rect','circle','polygon','arc','text','dim'];
      if(!b.content?.json||typeof b.content.json!=='object'||Array.isArray(b.content.json))errors.push('Le JSON du schéma doit être un objet.');
      else if(!sc||typeof sc!=='object'||Array.isArray(sc))errors.push('Le schéma doit contenir scene, un objet vectoriel.');
      else{
        if(sc.version!==1)errors.push('scene.version doit valoir 1.');
        if(!Number.isFinite(Number(sc.width))||sc.width<20||sc.width>2000||!Number.isFinite(Number(sc.height))||sc.height<20||sc.height>2000)errors.push('scene.width et scene.height doivent être comprises entre 20 et 2000.');
        if(!Array.isArray(sc.elements)||!sc.elements.length||sc.elements.length>300)errors.push('scene.elements doit contenir de 1 à 300 éléments.');
        else if(sc.elements.some(el=>!el||!kinds.includes(el.t)))errors.push('Un élément utilise un type inconnu. Types autorisés : '+kinds.join(', ')+'.');
      }
    }
    if(b.type==='fiche-revision'){
      const f=b.content?.json;
      if(!f||typeof f!=='object'||Array.isArray(f))errors.push('Le JSON de la fiche doit être un objet.');
      else{
        if(!String(f.title||'').trim())errors.push('Le titre de la fiche est obligatoire.');
        if(!Array.isArray(f.formulas)||!f.formulas.length||f.formulas.length>48)errors.push('La fiche doit comporter de 1 à 48 formules/relations.');
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

  function tocTitleForBlock(block,index,oldEntry,exerciseNumber){
    const content=block?.content&&typeof block.content==='object'?block.content:{};
    const type=String(block?.type||'').toLowerCase();
    const explicit=[block?.toc_title,content.toc_title,content.title,content.json?.title]
      .map(value=>String(value||'').trim()).find(Boolean);
    if(explicit)return explicit;
    if(oldEntry&&String(oldEntry.type||'').toLowerCase()===type
      &&String(oldEntry.title||'').trim()
      &&String(oldEntry.title).trim()!==String(labelFor(block)))return String(oldEntry.title).trim();
    if(type==='point')return 'Point de cours '+String(content.rank||index+1);
    if(type==='exercise')return 'Exercice '+String(exerciseNumber||1);
    if(type==='paragraph'){
      const raw=extractStructuredText(content.text||'')
        .replace(/^\s{0,3}#{1,6}\s*/gm,'')
        .replace(/[\t ]+/g,' ')
        .split(/\r?\n/)
        .map(line=>line.replace(/[*_]/g,'').trim())
        .find(Boolean)||'';
      const sentence=raw.split(/[.!?]\s+/)[0].trim();
      if(sentence)return sentence.length>78?sentence.slice(0,75).trimEnd()+'…':sentence;
    }
    return String(labelFor(block)||'Bloc '+String(index+1));
  }

  function rebuildTocEntries(){
    ensureDocumentPages(state.course);
    if(state.course.document_pages.toc.mode==='manual')return;
    const previous=Array.isArray(state.course.document_pages.toc.entries)?state.course.document_pages.toc.entries:[];
    const byId=new Map(previous.map(x=>[String(x?.id||''),x]));
    // En mode automatique, un ancien toc_entry_id ne doit jamais masquer d’autres
    // points, exercices, paragraphes ou schémas présents dans le document.
    const source=contentBlocks().filter(hasRenderableContent);
    let exerciseNumber=0;
    const pending=source.map((b,index)=>{
      const key=String(b?.toc_entry_id||b.id||'');
      const old=byId.get(key)||byId.get(String(b.id))||{};
      const isExercise=String(b?.type||'').toLowerCase()==='exercise';
      if(isExercise)exerciseNumber++;
      return {block:b,entry:{
        id:String(b?.toc_entry_id||b.id||old.id||''),
        title:tocTitleForBlock(b,index,old,isExercise?exerciseNumber:0),
        type:b.type,
        enabled:old.enabled!==false
      }};
    });
    const plannedPages=tocPageCount(pending.map(x=>x.entry));
    state.course.document_pages.toc.entries=pending.map(({block,entry})=>({...entry,page:pageNumberFor(block,plannedPages)}));
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

  function labelFor(b){return b.type==='paragraph'?'Paragraphe':b.type==='point'?'Point de cours':b.type==='exercise'?'Exercice':b.type==='graphique'?'Graphique GeoGebra':b.type==='vector-scene'?'Schéma vectoriel':b.type==='fiche-revision'?'Fiche de révision':'Image Wikimedia'}
  function mainText(b){return b.type==='exercise'?b.content?.statement||'':['graphique','vector-scene','fiche-revision'].includes(b.type)?JSON.stringify(b.content?.json||{},null,2):b.content?.text||b.content?.caption||b.content?.title||''}

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
    const tocPages=tocPageCount(cfg.entries),tocRange=tocPages>1?'02–'+String(tocPages+1).padStart(2,'0'):'02';
    return '<article class="ae-block ae-system-block ae-toc-system"><header class="ae-block-head"><div><span class="ae-block-number">'+tocRange+'</span><strong>Sommaire</strong><small>Page système · '+(tocPages>1?tocPages+' pages PDF':'indépendante')+' · prévisualisable</small></div><span class="ae-block-state ok">Prévisualisable</span></header>'+
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
    if(['graphique','vector-scene','fiche-revision'].includes(b.type))editor='<label class="ae-json-editor-label">'+esc(labelFor(b))+' · JSON modifiable</label><textarea class="ae-inline-json" data-edit-json="'+esc(b.id)+'" aria-label="JSON de '+esc(labelFor(b))+'">'+esc(JSON.stringify(b.content?.json||{},null,2))+'</textarea>';
    else if(b.type==='point')editor='<div class="ae-structured-editor ae-point-editor"><div class="ae-editor-grid"><label>Nom du point<input data-edit-point-title="'+esc(b.id)+'" value="'+esc(b.content?.title||'')+'" maxlength="140"></label><label>Rang<input type="number" min="1" step="1" data-edit-point-rank="'+esc(b.id)+'" value="'+esc(b.content?.rank||1)+'"></label><label>Couleur<select data-edit-point-color="'+esc(b.id)+'">'+pointColorOptions(b.content?.color)+'</select></label></div><label>Contenu<textarea data-edit-text="'+esc(b.id)+'" aria-label="Contenu du point de cours">'+esc(b.content?.text||'')+'</textarea></label><div class="ae-point-style-preview"><span style="--point-color:'+esc(normalizePointColor(b.content?.color))+'"></span><strong>'+esc(b.content?.title||'Point de cours')+'</strong><i></i></div></div>';
    else if(b.type==='exercise')editor='<div class="ae-structured-editor ae-exercise-editor"><label>Titre de l’exercice<input data-edit-exercise-title="'+esc(b.id)+'" value="'+esc(b.content?.title||'')+'" maxlength="140"></label><label>Énoncé<textarea data-edit-exercise-statement="'+esc(b.id)+'" aria-label="Énoncé de l’exercice">'+esc(b.content?.statement||'')+'</textarea></label><label>Indication<textarea class="ae-small-textarea" data-edit-exercise-hint="'+esc(b.id)+'" aria-label="Indication de l’exercice">'+esc(b.content?.hint||'')+'</textarea></label><div class="ae-correction-editor"><strong>Correction conditionnée à cet exercice</strong><label>Titre du corrigé<input data-edit-correction-title="'+esc(b.id)+'" value="'+esc(b.content?.correction_title||'')+'" maxlength="140"></label><textarea data-edit-correction="'+esc(b.id)+'" aria-label="Correction">'+esc(b.content?.correction||'')+'</textarea></div></div>';
    else if(b.type==='wikimedia-image'){
      const hasImage=String(b.content?.imageUrl||'').trim().startsWith('https://upload.wikimedia.org/');
      editor='<div class="ae-wikimedia-editor">'+(hasImage
        ?'<div class="ae-selected-image"><img src="'+esc(b.content.imageUrl)+'" alt="'+esc(b.content.title||'Image Wikimedia')+'"><div><strong>'+esc(b.content.title||'Image Wikimedia')+'</strong><small>'+esc(b.content.license||'Licence à vérifier')+'</small></div></div>'
        :'<div class="ae-image-pick-empty">Aucune image sélectionnée. Lance une recherche pour choisir une illustration.</div>')+
        '<button type="button" class="admin-btn ghost ae-wiki-open-picker" data-search-wikimedia="'+esc(b.id)+'">'+(hasImage?'↻ Rechercher / remplacer l’image':'＋ Choisir une image Wikimedia')+'</button></div>';
    }
    else editor='<textarea data-edit-text="'+esc(b.id)+'" aria-label="Contenu du bloc">'+esc(b.content?.text||'')+'</textarea>';
    return '<article class="ae-block '+(state.selected===b.id?'is-selected':'')+'" data-block="'+esc(b.id)+'">'+
      '<header class="ae-block-head"><div><span class="ae-block-number">'+String(page).padStart(2,'0')+'</span><strong>'+esc(labelFor(b))+'</strong><small>'+esc(b.validation?.ok?'Bloc valide':'À valider')+'</small></div><span class="ae-block-state '+(v.ok?'ok':'bad')+'">'+(v.ok?'Valide':'À corriger')+'</span></header>'+
      '<div class="ae-block-editor">'+editor+'</div>'+
      '<div class="ae-block-toolbar"><button class="admin-btn ghost" data-regenerate-page="'+esc(b.id)+'">↻ Régénérer la page</button><button class="admin-btn ghost" data-preview-block="'+esc(b.id)+'">Prévisualiser</button><button class="admin-btn ghost" data-json-block="'+esc(b.id)+'">JSON</button><button class="admin-btn ghost" data-copy-block="'+esc(b.id)+'">Copier JSON</button><button class="admin-btn ghost" data-duplicate-block="'+esc(b.id)+'">Dupliquer</button><button class="admin-btn ghost" data-clear-block="'+esc(b.id)+'">Vider</button><button class="admin-btn danger" data-delete-block="'+esc(b.id)+'">Supprimer</button><button type="button" class="admin-btn primary" data-validate-block="'+esc(b.id)+'">Valider & générer la page</button></div>'+
      '<div class="ae-block-result">'+(gen.status==='ready'&&gen.page_url?'<span class="ae-generated-ok" title="Ce fragment est prêt, mais ne confirme pas à lui seul toute la séquence.">✓ Page '+page+' prête seule · séquence à vérifier</span><button class="admin-btn ghost" data-preview-block="'+esc(b.id)+'">Visualiser</button><button type="button" class="admin-btn ghost" data-download-block="'+esc(b.id)+'">Télécharger</button>':gen.status==='generating'?'<div class="ae-generation-progress" role="status" aria-live="polite"><div class="ae-generation-progress-top"><span data-progress-label>'+esc(gen.progress_label||'Génération de la page…')+'</span><strong data-progress-pct>'+Math.round(Number(gen.progress||8))+'%</strong></div><div class="ae-progress-track"><span data-progress-bar style="width:'+Math.max(8,Math.min(100,Number(gen.progress||8)))+'%"></span></div><small>Progression indicative · la page est en cours de génération.</small></div>':gen.status==='error'?'<span class="ae-generated-error">Erreur : '+esc(gen.error||'génération impossible')+'</span>':b.type==='graphique'&&v.ok?'<span>JSON validé · la construction graphique reste destinée au moteur GeoGebra/LuaLaTeX.</span>':'<span>Aucune page générée pour ce bloc.</span>')+'</div>'+
      (v.errors.length?'<div class="ae-block-errors">'+v.errors.map(x=>'• '+esc(x)).join('<br>')+'</div>':'')+
      '<div class="ae-inline-add-row"><label class="ae-inline-add-select"><span>Ajouter sous ce bloc</span><select data-insert-after="'+esc(b.id)+'"><option value="">Sélectionner…</option><option value="paragraph">Paragraphe</option><option value="point">Point de cours</option><option value="exercise">Exercice</option><option value="graphique">Graphique GeoGebra</option><option value="vector-scene">Schéma vectoriel</option><option value="fiche-revision">Fiche de révision</option><option value="wikimedia-image">Image</option></select></label></div>'+
      '</article>';
  }

  function renderWorkspace(){
    const r=root();if(!r||!state.course)return;
    const previousModalHost=document.getElementById('aeModalHost');
    if(previousModalHost){closeAssistedModal();previousModalHost.remove();}
    validateCourse();
    ensureCourseStructure(state.course);
    r.innerHTML='<div class="ae-shell ae-workspace"><header class="ae-head"><div><button class="admin-btn ghost" id="aeBack">← Mes cours</button><button class="admin-btn danger" id="aeDeleteCourseInside">Supprimer ce cours</button><span class="ae-kicker">Atelier de production séquentielle</span><h3><input id="aeCourseTitle" value="'+esc(state.course.title)+'"></h3><p>Le bloc de début, le sommaire et le bloc de fin sont automatiques. L’ordre des blocs centraux détermine leur ordre dans le PDF final : une fiche est ajoutée à la fin par défaut, mais tu peux encore ajouter des blocs en dessous.</p></div><span class="ae-status" id="assistedStatus">'+(state.course.validation?.ok?'Structure valide':'À compléter')+'</span></header>'+
      '<div class="ae-top-options"><div class="ae-top-options-title"><span class="ae-kicker">Options du document</span><strong>Couleur d’accent</strong><small>Elle sera utilisée pour les bordures, repères et éléments mathématiques de la page.</small></div><label class="ae-color-field"><span class="ae-color-swatch" style="background:'+normalizeThemeColor(state.course.theme_color)+'"></span><select id="aeThemeColor" aria-label="Couleur d’accent du document">'+themeColorOptions()+'</select></label></div>'+
      '<div class="ae-workbar"><button class="admin-btn primary" id="aeAddP">＋ Paragraphe</button><button class="admin-btn ghost" id="aeAddPoint">＋ Point de cours</button><button class="admin-btn ghost" id="aeAddEx">＋ Exercice</button><button class="admin-btn ghost" id="aeAddGraph">＋ Graphique GeoGebra</button><button class="admin-btn ghost" id="aeAddVector">＋ Schéma vectoriel</button><button class="admin-btn ghost" id="aeAddFiche">＋ Fiche de révision</button><button class="admin-btn ghost" id="aeAddWiki">＋ Image Wikimedia</button><button class="admin-btn ghost" id="aeTocJson">Sommaire JSON</button><button class="admin-btn ghost" id="aeSave">Enregistrer le cours</button><button class="admin-btn primary" id="aeDownloadPdfCurrent" disabled>Télécharger le PDF actuel</button></div>'+
      '<div class="ae-sequence-meta"><span>'+contentBlocks().length+' bloc(s) de contenu · 1 début · 1 fin</span><span id="aeSystemPreviewOverall">Pages système indépendantes : '+systemPreviewOverallFromPages(state.canonicalPreview?.pages||{}).ready+'/3 prêtes · '+systemPreviewOverallFromPages(state.canonicalPreview?.pages||{}).progress+'%</span></div>'+
      '<section class="ae-block-stack">'+(activeBlocks().find(b=>b?.role===START_ROLE)?blockCard(activeBlocks().find(b=>b?.role===START_ROLE),0):'')+tocSystemCard()+(contentBlocks().length?contentBlocks().map((b,i)=>blockCard(b,i+2)).join(''):'<div class="ae-empty"><strong>Le cours est vide.</strong><span>Ajoute un paragraphe pour commencer. La couverture et le sommaire resteront toujours présents.</span></div>')+(activeBlocks().find(b=>b?.role===END_ROLE)?blockCard(activeBlocks().find(b=>b?.role===END_ROLE),activeBlocks().length-1):'')+'</section>'+
      '<div class="ae-workbar ae-complete-download"><div style="display:grid;gap:4px;flex:1;min-width:220px"><strong>Document final</strong><small id="aeCompleteDownloadNote" style="opacity:.68;line-height:1.4">Chaque fragment est contrôlé et optimisé individuellement, puis le PDF complet est fusionné et vérifié sans compression globale finale.</small></div><button class="admin-btn ghost" id="aeGenerateAllPages"'+(state.pdfBatchRunning?' disabled':'')+'>Générer / régénérer toutes les pages</button><button class="admin-btn ghost" id="aeFinalizePdf" disabled>Fusionner et vérifier le PDF final</button><button class="admin-btn primary" id="aeDownloadPdfComplete" disabled>Télécharger le PDF complet</button></div>'+
      '<div id="aePdfBatchProgress" style="display:grid;gap:6px;margin:10px 0 14px;padding:12px 14px;border:1px solid #D1D5DB;border-radius:10px;background:rgba(148,163,184,.07)" aria-live="polite"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><strong id="aePdfBatchProgressLabel" style="font-size:13px;line-height:1.4">'+esc(state.pdfBatchProgress?.label||'En attente de génération')+'</strong><span id="aePdfBatchProgressPercent" style="font-variant-numeric:tabular-nums;font-weight:700">'+Math.max(0,Math.min(100,Math.round(Number(state.pdfBatchProgress?.percent)||0)))+'%</span></div><div id="aePdfBatchProgressTrack" role="progressbar" aria-label="Progression de la génération totale" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.max(0,Math.min(100,Math.round(Number(state.pdfBatchProgress?.percent)||0)))+'" style="height:9px;border-radius:999px;overflow:hidden;background:#E5E7EB"><div id="aePdfBatchProgressBar" style="height:100%;width:'+Math.max(0,Math.min(100,Math.round(Number(state.pdfBatchProgress?.percent)||0)))+'%;border-radius:999px;background:#2563EB;transition:width .25s ease"></div></div><small id="aePdfBatchProgressDetail" style="opacity:.72;line-height:1.4">Les pages sont rendues une par une pour préserver les sauvegardes et éviter les conflits.</small></div>'+
      '<footer class="ae-work-footer">Le bouton supérieur permet de récupérer les fragments déjà prêts. En fin d’éditeur, « Télécharger le document complet » assemble la couverture, le sommaire, tous les blocs et la page finale, uniquement quand toutes les parties sont vérifiées.</footer></div><div class="ae-modal-host" id="aeModalHost"></div>';
    prepareAssistedModalHost();
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
    await generateBlock(ref,{forceSingleBlock:true});
  }

  async function blockDownloadPartsThrough(targetBlock,mode='current'){
    const requestedTargetPage=Number(mode==="previous"?pageNumberForEnd(targetBlock):pageNumberFor(targetBlock));
    const parts=[],seenPages=new Set();
    const blocks=activeBlocks();
    const byId=new Map(blocks.map(b=>[String(b.id),b]));
    const isReady=g=>String(g?.status||'').toLowerCase()==='ready'&&!!String(g?.page_url||'').trim();

    const targetSegment=flowSegmentFor(targetBlock.id);
    const targetSegmentIds=new Set(targetSegment.map(b=>String(b?.id||'')));
    const flowOwner=targetSegment[0]||targetBlock;
    const flowOwnerGeneration=flowOwner?.generation||{};
    let preferCanonicalFlow=mode==='previous'
      &&targetSegment.length>1
      &&isReady(flowOwnerGeneration)
      &&flowOwnerGeneration.independent_regeneration!==true
      &&generationCoversThrough(flowOwnerGeneration,targetSegment,targetBlock.id);
    let canonicalFlowPageCount=0;
    if(preferCanonicalFlow){
      const mappedStart=Number(flowOwnerGeneration.flow_page_map?.[String(flowOwner.id)]||flowOwnerGeneration.page_number||pageNumberFor(flowOwner));
      const mappedEnd=Number(flowOwnerGeneration.flow_page_end_map?.[String(targetBlock.id)]||flowOwnerGeneration.flow_page_map?.[String(targetBlock.id)]||0);
      const mappedCount=mappedEnd>=mappedStart?mappedEnd-mappedStart+1:0;
      if(mappedCount>0)canonicalFlowPageCount=mappedCount;
      if(!canonicalFlowPageCount){
        try{canonicalFlowPageCount=await assistedPdfPageCount(flowOwnerGeneration.page_url)}catch(_){canonicalFlowPageCount=0}
        if(!Number.isInteger(canonicalFlowPageCount)||canonicalFlowPageCount<1){
          canonicalFlowPageCount=Math.max(1,requestedTargetPage-Number(pageNumberFor(flowOwner))+1);
        }
      }
    }

    const add=(url,label,pageNumber,sourcePage=1)=>{
      const u=String(url||'').trim(),n=Number(pageNumber),sourceIndex=Math.floor(Number(sourcePage)||1);
      if(!u||!Number.isInteger(n)||n<1||n>requestedTargetPage||seenPages.has(n))return;
      if(!Number.isInteger(sourceIndex)||sourceIndex<1)return;
      seenPages.add(n);
      parts.push({url:u,label,pageNumber:n,sourcePage:sourceIndex});
    };

    const pages=state.canonicalPreview?.pages||{};
    if(String(pages.cover?.status||'').toLowerCase()==='ready')add(pages.cover.pdfUrl,'Couverture',1,1);
    if(String(pages.toc?.status||'').toLowerCase()==='ready')add(pages.toc.pdfUrl,'Sommaire',2,1);

    for(const b of contentBlocks()){
      const n=Number(pageNumberFor(b));
      if(!Number.isInteger(n)||n>requestedTargetPage)continue;

      if(preferCanonicalFlow&&targetSegmentIds.has(String(b.id))){
        if(String(b.id)!==String(flowOwner.id))continue;
        const ownerPage=Number(pageNumberFor(flowOwner));
        for(let sourcePage=1;sourcePage<=canonicalFlowPageCount;sourcePage++){
          const actualPage=ownerPage+sourcePage-1;
          if(actualPage>requestedTargetPage)break;
          add(flowOwnerGeneration.page_url,'Page '+actualPage+' · flux assisté',actualPage,sourcePage);
        }
        continue;
      }

      const g=b?.generation||{};
      if(!isReady(g)){
        const blockSegment=flowSegmentFor(b.id);
        const blockFlowOwner=blockSegment[0]||b;
        const blockFlowGeneration=blockFlowOwner?.generation||{};
        if(isReady(blockFlowGeneration)&&generationContainsBlock(blockFlowGeneration,b.id)){
          const ownerPage=Number(pageNumberFor(blockFlowOwner));
          add(blockFlowGeneration.page_url,'Page '+n+' · flux assisté',n,Math.max(1,n-ownerPage+1));
        }
        continue;
      }
      if(String(b.id)===String(targetBlock.id)&&g.independent_regeneration===true){
        add(g.page_url,'Page '+n,n,1);
        continue;
      }
      const blockSegment=flowSegmentFor(b.id);
      const blockFlowOwner=blockSegment[0]||b;
      const blockFlowGeneration=blockFlowOwner?.generation||{};
      if(isReady(blockFlowGeneration)&&generationContainsBlock(blockFlowGeneration,b.id)){
        const ownerPage=Number(pageNumberFor(blockFlowOwner));
        add(blockFlowGeneration.page_url,'Page '+n+' · flux assisté',n,Math.max(1,n-ownerPage+1));
        continue;
      }
      const ownerId=String(g.flow_page_owner_id||'').trim();
      const owner=ownerId?byId.get(ownerId):null;
      const ownerGeneration=owner?.generation||{};
      const ownerReady=isReady(ownerGeneration)&&ownerGeneration.independent_regeneration!==true&&generationContainsBlock(ownerGeneration,b.id);
      if(ownerId&&ownerReady){
        const ownerPage=Number(pageNumberFor(owner));
        add(ownerGeneration.page_url,'Page '+n+' · flux assisté',n,Math.max(1,n-ownerPage+1));
      }else if(g.independent_regeneration===true||!ownerId){
        add(g.page_url,'Page '+n,n,1);
      }else{
        const ownerPage=owner?Number(pageNumberFor(owner)):n;
        add(g.page_url,'Page '+n,n,Math.max(1,n-ownerPage+1));
      }
    }

    const endBlock=blocks.find(b=>b?.role===END_ROLE);
    if(endBlock&&Number(pageNumberFor(endBlock))<=requestedTargetPage&&String(pages.end?.status||'').toLowerCase()==='ready'){
      add(pages.end.pdfUrl,'Fin du document',pageNumberFor(endBlock),1);
    }
    parts.sort((a,b)=>a.pageNumber-b.pageNumber);
    const targetPage=preferCanonicalFlow&&parts.length?Math.max(...parts.map(x=>Number(x.pageNumber)||0)):requestedTargetPage;
    return {targetPage,parts};
  }

  function blockDownloadRangeComplete(parts,targetPage){
    const ready=new Set(parts.map(x=>Number(x.pageNumber)));
    for(let n=1;n<=Number(targetPage);n++)if(!ready.has(n))return false;
    return true;
  }

  function showBlockDownloadFeedback(message,kind='info'){
    let note=document.getElementById('aeBlockDownloadFeedback');
    if(!note){
      note=document.createElement('div');
      note.id='aeBlockDownloadFeedback';
      note.setAttribute('role','status');
      note.setAttribute('aria-live','polite');
      document.documentElement.appendChild(note);
    }
    const palette=kind==='error'
      ?{bg:'#fff1f0',ink:'#8b1b13',border:'#d92d20'}
      :kind==='warning'
        ?{bg:'#fff8e6',ink:'#7a4b00',border:'#d99a16'}
        :kind==='success'
          ?{bg:'#eaf8ef',ink:'#14532d',border:'#168149'}
          :{bg:'#f7f5ff',ink:'#292344',border:'#6d28d9'};
    note.textContent=String(message||'');
    note.style.cssText='position:fixed!important;left:50%!important;right:auto!important;top:auto!important;bottom:calc(14px + env(safe-area-inset-bottom,0px))!important;transform:translateX(-50%)!important;z-index:2147483647!important;display:block!important;visibility:visible!important;opacity:1!important;pointer-events:none!important;width:min(92vw,560px)!important;max-width:92vw!important;max-height:28vh!important;overflow:auto!important;box-sizing:border-box!important;padding:13px 15px!important;border:1px solid '+palette.border+'!important;border-left:5px solid '+palette.border+'!important;border-radius:14px!important;background:'+palette.bg+'!important;color:'+palette.ink+'!important;box-shadow:0 12px 36px rgba(0,0,0,.22)!important;font:600 14px/1.45 system-ui,sans-serif!important;white-space:normal!important;overflow-wrap:anywhere!important;';
    if(note.__timer)clearTimeout(note.__timer);
    note.__timer=setTimeout(()=>{if(note.isConnected)note.remove();},kind==='progress'?20000:12000);
  }

  async function downloadBlockPdf(targetBlock,mode='current'){
    const target=await blockDownloadPartsThrough(targetBlock,mode);
    const current=target.parts.find(x=>Number(x.pageNumber)===Number(target.targetPage));
    if(!current)throw new Error('La page de ce bloc n’est pas encore prête.');

    let parts=[current];
    if(mode==='previous'){
      parts=target.parts.filter(x=>Number(x.pageNumber)<=Number(target.targetPage));
      if(!parts.length)throw new Error('Aucune page PDF n’est disponible pour l’assemblage.');
      if(!parts.some(x=>Number(x.pageNumber)===Number(target.targetPage)))throw new Error('La page actuelle de ce bloc n’est pas prête.');
    }

    const expectedCount=Number(target.targetPage);
    const availablePages=new Set(parts.map(p=>Number(p.pageNumber)));
    const missingPages=[];
    const missingSourcePages=[];
    if(mode==='previous')for(let n=1;n<=expectedCount;n++)if(!availablePages.has(n))missingPages.push(n);
    setStatus(mode==='previous'
      ? 'Assemblage des pages disponibles jusqu’à '+target.targetPage+'…'
      : 'Préparation de la page '+target.targetPage+'…');
    showBlockDownloadFeedback(mode==='previous'
      ? 'Assemblage des pages jusqu’à la page '+target.targetPage+'…'
      : 'Préparation de la page '+target.targetPage+'…','progress');

    const {PDFDocument}=await loadPdfLib();
    const merged=await PDFDocument.create();
    const sourceDocuments=new Map();
    const copiedSourcePages=new Map();

    for(let i=0;i<parts.length;i++){
      const p=parts[i];
      setStatus('Assemblage : '+p.label+' ('+(i+1)+'/'+parts.length+')…');
      let source=sourceDocuments.get(p.url);
      if(!source){
        const response=await fetch(p.url,{cache:'no-store'});
        if(!response.ok)throw new Error('Impossible de récupérer '+p.label+' (HTTP '+response.status+').');
        source=await PDFDocument.load(await response.arrayBuffer());
        sourceDocuments.set(p.url,source);
      }
      const sourceCount=source.getPageCount();
      let sourceIndex=Number(p.sourcePage||1)-1;
      if(sourceIndex<0||sourceIndex>=sourceCount){
        // Certains rendus de flux regroupent plusieurs blocs sur un seul feuillet.
        // Dans ce cas, réutiliser le feuillet unique une seule fois au lieu d'annuler
        // tout le téléchargement « Pages 1 à N ».
        if(sourceCount===1){
          sourceIndex=0;
        }else if(mode==='previous'){
          missingSourcePages.push(p.label+' (page source '+(sourceIndex+1)+' absente)');
          if(!missingPages.includes(Number(p.pageNumber)))missingPages.push(Number(p.pageNumber));
          continue;
        }else{
          throw new Error(p.label+' : la page demandée ('+(sourceIndex+1)+') est absente du PDF source ('+sourceCount+' page(s)).');
        }
      }
      let copiedIndices=copiedSourcePages.get(p.url);
      if(!copiedIndices){copiedIndices=new Set();copiedSourcePages.set(p.url,copiedIndices);}
      if(copiedIndices.has(sourceIndex))continue;
      const copied=await merged.copyPages(source,[sourceIndex]);
      copied.forEach(page=>merged.addPage(page));
      copiedIndices.add(sourceIndex);
    }

    if(!merged.getPageCount())throw new Error('Aucun feuillet exploitable n’a pu être assemblé. Vérifie que les PDF des pages précédentes sont générés.');
    const bytes=await merged.save({useObjectStreams:true});
    const blob=new Blob([bytes],{type:'application/pdf'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const safeTitle=String(state.course?.title||'aurore-cours').trim().replace(/[^\p{L}\p{N}_-]+/gu,'-')||'aurore-cours';
    a.href=url;
    a.download=mode==='previous'
      ? safeTitle+'-pages-1-a-'+target.targetPage+'.pdf'
      : safeTitle+'-page-'+target.targetPage+'.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Garder l’URL assez longtemps pour les navigateurs mobiles qui préparent
    // le téléchargement du blob de façon différée.
    setTimeout(()=>URL.revokeObjectURL(url),30000);

    missingPages.sort((a,b)=>a-b);
    const warnings=[];
    if(missingPages.length)warnings.push('pages non générées/indisponibles : '+missingPages.join(', '));
    if(missingSourcePages.length)warnings.push('fragments PDF incomplets : '+missingSourcePages.join(', '));
    const message=mode==='previous'
      ?(warnings.length
        ?'PDF téléchargé jusqu’à la page '+target.targetPage+', mais incomplet — '+warnings.join(' ; ')+'.'
        :'Pages 1 à '+target.targetPage+' téléchargées.')
      :'Page '+target.targetPage+' téléchargée.';
    setStatus(message);
    showBlockDownloadFeedback(message,warnings.length?'warning':'success');
  }

  function closeBlockDownloadChoice(result=null){
    const overlay=document.getElementById('aeBlockDownloadChoiceOverlay');
    if(!overlay)return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden','true');
    const resolver=overlay.__auroreResolve;
    overlay.__auroreResolve=null;
    overlay.__auroreViewportState=null;
    if(typeof resolver==='function')resolver(result);
    requestAnimationFrame(()=>overlay.remove());
  }

  async function askBlockDownloadChoice(block,intent="download"){
    let overlay=document.getElementById('aeBlockDownloadChoiceOverlay');
    if(!overlay){
      initBlockDownloadChoice();
      overlay=document.getElementById('aeBlockDownloadChoiceOverlay');
    }
    if(!overlay)return Promise.resolve(null);

    const current=Number(pageNumberFor(block));
    const target=await blockDownloadPartsThrough(block,"previous");
    const endPage=Number(target.targetPage||pageNumberForEnd(block));
    const previousReady=endPage>1&&target.parts.some(x=>x.pageNumber<endPage);
    const currentReady=target.parts.some(x=>x.pageNumber===current);

    const currentBtn=overlay.querySelector('[data-ae-download-mode="current"]');
    const previousBtn=overlay.querySelector('[data-ae-download-mode="previous"]');
    const currentLabel=overlay.querySelector('[data-ae-download-current-label]');
    const previousLabel=overlay.querySelector('[data-ae-download-previous-label]');
    const description=overlay.querySelector('[data-ae-download-description]');

    if(currentLabel)currentLabel.textContent='Page '+current+' uniquement';
    if(previousLabel)previousLabel.textContent='Pages 1 à '+endPage;
    if(currentBtn)currentBtn.disabled=!currentReady;
    if(previousBtn)previousBtn.disabled=current<=1||!currentReady;
    if(description){
      description.textContent=intent==="preview"
        ? (currentReady
          ? (endPage>current
            ? "Choisis d’ouvrir cette page seule dans le lecteur ou les pages précédentes jusqu’à la fin de ce bloc."
            : "Ouvre cette page dans le lecteur PDF intégré.")
          : "La page n’est pas encore prête en PDF. Génère d’abord ce bloc.")
        : (current<=1
          ? "Ce bloc est sur la première page disponible."
          : previousReady
            ? "Les pages PDF disponibles jusqu’à la fin de ce bloc seront réunies dans l’ordre."
            : "Aucune page précédente n’est prête : génère les blocs précédents pour les inclure.");
    }
    // Garder la page à sa position : pas de verrouillage du body ni de focus automatique,
    // qui peuvent provoquer un défilement brutal sur certains navigateurs mobiles.
    const kicker=overlay.querySelector("[data-ae-operation-kicker]");
    const heading=overlay.querySelector("[data-ae-operation-title]");
    if(kicker)kicker.textContent=intent==="preview"?"Prévisualisation":"Téléchargement";
    if(heading)heading.textContent=intent==="preview"?"Que souhaitez-vous prévisualiser ?":"Que souhaitez-vous télécharger ?";
    const currentSmall=currentBtn?.querySelector("small");
    const previousSmall=previousBtn?.querySelector("small");
    if(currentSmall)currentSmall.textContent=intent==="preview"?"Ouvrir uniquement cette page dans le lecteur intégré.":"Uniquement la page de ce bloc.";
    if(previousSmall)previousSmall.textContent=intent==="preview"?"Ouvrir le PDF jusqu’à la fin de ce bloc dans le lecteur intégré.":"Toutes les pages précédentes jusqu’à ce bloc.";
    overlay.__auroreViewportState={scrollY:window.scrollY||0};
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden','false');
    return new Promise(resolve=>{overlay.__auroreResolve=resolve;});
  }

  function initBlockDownloadChoice(){
    if(document.getElementById('aeBlockDownloadChoiceOverlay'))return;

    const overlay=document.createElement('div');
    overlay.id='aeBlockDownloadChoiceOverlay';
    overlay.className='ae-block-download-choice-overlay';
    overlay.setAttribute('aria-hidden','true');
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.innerHTML=`
      <div class="ae-block-download-choice-card">
        <div class="ae-block-download-choice-head">
          <div>
            <div class="ae-block-download-choice-kicker" data-ae-operation-kicker>Téléchargement</div>
            <h3 data-ae-operation-title>Que souhaitez-vous télécharger ?</h3>
            <p data-ae-download-description></p>
          </div>
          <button type="button" class="ae-block-download-choice-close" aria-label="Fermer">×</button>
        </div>
        <div class="ae-block-download-choice-options">
          <button type="button" class="ae-block-download-choice-option" data-ae-download-mode="current">
            <span class="ae-block-download-choice-icon">1</span>
            <span><strong data-ae-download-current-label>Page actuelle uniquement</strong><small>Uniquement la page de ce bloc.</small></span>
          </button>
          <button type="button" class="ae-block-download-choice-option" data-ae-download-mode="previous">
            <span class="ae-block-download-choice-icon">1–N</span>
            <span><strong data-ae-download-previous-label>Pages 1 à N</strong><small>Toutes les pages précédentes jusqu’à ce bloc.</small></span>
          </button>
        </div>
        <button type="button" class="ae-block-download-choice-cancel">Annuler</button>
      </div>`;

    // Sortir la fenêtre de la sous-arborescence du body : elle reste fixée au viewport
    // même si le contenu de la page utilise un contexte de transformation/défilement.
    overlay.style.cssText='position:fixed!important;inset:0!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;z-index:2147483000!important;display:flex!important;align-items:center!important;justify-content:center!important;transform:none!important;contain:none!important;';
    document.documentElement.appendChild(overlay);
    overlay.addEventListener('click',e=>{if(e.target===overlay)closeBlockDownloadChoice(null);});
    overlay.querySelector('.ae-block-download-choice-close')?.addEventListener('click',()=>closeBlockDownloadChoice(null));
    overlay.querySelector('.ae-block-download-choice-cancel')?.addEventListener('click',()=>closeBlockDownloadChoice(null));
    overlay.querySelectorAll('[data-ae-download-mode]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        if(btn.disabled)return;
        const mode=btn.getAttribute('data-ae-download-mode')==='previous'?'previous':'current';
        closeBlockDownloadChoice(mode);
      });
    });
    overlay.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();closeBlockDownloadChoice(null);}
    });
  }

  function bindWorkspace(){
    document.getElementById('aeBack').onclick=()=>{state.mode='list';state.course=null;loadCourses().then(renderList)};
    document.getElementById('aeDeleteCourseInside').onclick=()=>deleteCourse(state.course?.id);
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
    document.getElementById('aeAddVector').onclick=()=>addBlock('vector-scene');
    document.getElementById('aeAddFiche').onclick=()=>addBlock('fiche-revision');
    document.getElementById('aeAddWiki').onclick=()=>wiki();
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
    if(downloadBtn)downloadBtn.onclick=()=>downloadCurrentPdf(false);
    const completeDownloadBtn=document.getElementById('aeDownloadPdfComplete');
    if(completeDownloadBtn)completeDownloadBtn.onclick=()=>downloadCurrentPdf(true);
    const finalizePdfBtn=document.getElementById('aeFinalizePdf');
    if(finalizePdfBtn)finalizePdfBtn.onclick=()=>void finalizePdfAssembly();
    const generateAllBtn=document.getElementById('aeGenerateAllPages');
    if(generateAllBtn)generateAllBtn.onclick=()=>void generateAllPages();
    refreshDownloadButton();
    root().oninput=()=>{if(state.finalPdfArtifact){state.finalPdfArtifact=null;refreshCompleteDownloadButton();}};
    root().onchange=()=>{if(state.finalPdfArtifact){state.finalPdfArtifact=null;refreshCompleteDownloadButton();}};
    root().querySelectorAll('[data-edit-point-title]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editPointTitle);if(b){b.content.title=el.value;validateCourse();}});
    root().querySelectorAll('[data-edit-point-rank]').forEach(el=>el.onchange=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editPointRank);if(b){b.content.rank=Math.max(1,parseInt(el.value||'1',10));reorderPointBlocks(state.course);validateCourse();renderWorkspace();setStatus(isDefaultIntroduction(b)?'L’Introduction reste toujours au début du cours.':'Position du point mise à jour selon son rang.');}});
    root().querySelectorAll('[data-edit-point-color]').forEach(el=>el.onchange=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editPointColor);if(b){b.content.color=normalizePointColor(el.value);renderWorkspace();}});
    root().querySelectorAll('[data-edit-exercise-title]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editExerciseTitle);if(b)b.content.title=el.value;});
    root().querySelectorAll('[data-edit-exercise-statement]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editExerciseStatement);if(b){b.content.statement=el.value;validateCourse();}});
    root().querySelectorAll('[data-edit-exercise-hint]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editExerciseHint);if(b)b.content.hint=el.value;});
    root().querySelectorAll('[data-edit-correction-title]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editCorrectionTitle);if(b)b.content.correction_title=el.value;});
    root().querySelectorAll('[data-edit-correction]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editCorrection);if(b)b.content.correction=el.value;});
    root().querySelectorAll('[data-edit-text]').forEach(el=>el.oninput=()=>{const b=activeBlocks().find(x=>x.id===el.dataset.editText);if(b){if(b.type==='exercise')b.content.statement=el.value;else b.content.text=el.value;validateCourse();}});
    root().querySelectorAll('[data-edit-json]').forEach(el=>el.onchange=()=>{
      const b=activeBlocks().find(x=>x.id===el.dataset.editJson);if(!b)return;
      try{
        b.content=normalizeContent(b.type,JSON.parse(el.value));
        b.jsonEditorInvalid=false;
        validateBlock(b);
        // Important: ne pas reconstruire toute la carte au blur du textarea.
        // Sinon le bouton cliqué est détruit avant son événement click et sa
        // génération/progression ne démarre jamais.
        const card=el.closest('.ae-block');
        const head=card?.querySelector('.ae-block-head');
        const small=head?.querySelector('small');
        const badge=head?.querySelector('.ae-block-state');
        if(small)small.textContent=b.validation?.ok?'Bloc valide':'À valider';
        if(badge){badge.classList.toggle('ok',!!b.validation?.ok);badge.classList.toggle('bad',!b.validation?.ok);badge.textContent=b.validation?.ok?'Valide':'À corriger';}
      }catch(_){b.jsonEditorInvalid=true;setStatus('JSON invalide pour « '+labelFor(b)+' ». Corrige-le avant de générer la page.');}
    });

    root().querySelectorAll('[data-json-system]').forEach(x=>x.onclick=()=>jsonSystemDialog(x.dataset.jsonSystem));
    root().querySelectorAll('[data-regenerate-page]').forEach(x=>{
      x.type='button';
      x.onclick=async e=>{
        e.preventDefault();
        e.stopPropagation();
        if(x.dataset.regenerating==='true')return;
        x.dataset.regenerating='true';
        const originalLabel=x.textContent;
        x.disabled=true;
        x.textContent='Régénération…';
        try{
          await regeneratePage(x.dataset.regeneratePage);
        }catch(err){
          setStatus('La régénération a échoué : '+String(err?.message||err));
        }finally{
          x.dataset.regenerating='false';
          if(x.isConnected){
            x.disabled=false;
            x.textContent=originalLabel;
          }
        }
      };
    });
    root().querySelectorAll('[data-preview-block]').forEach(x=>x.onclick=()=>previewBlock(x.dataset.previewBlock));
    root().querySelectorAll('[data-download-block]').forEach(x=>x.onclick=async()=>{
      const b=activeBlocks().find(v=>String(v.id)===String(x.dataset.downloadBlock));
      if(!b)return;
      const mode=await askBlockDownloadChoice(b);
      if(!mode)return;
      x.disabled=true;
      try{await downloadBlockPdf(b,mode);}
      catch(e){setStatus('Échec du téléchargement : '+String(e?.message||e));}
      finally{x.disabled=false;}
    });
    root().querySelectorAll('[data-json-block]').forEach(x=>x.onclick=()=>jsonDialog(x.dataset.jsonBlock));
    root().querySelectorAll('[data-copy-block]').forEach(x=>x.onclick=()=>copyBlock(x.dataset.copyBlock));
    root().querySelectorAll('[data-duplicate-block]').forEach(x=>x.onclick=()=>duplicateBlock(x.dataset.duplicateBlock));
    root().querySelectorAll('[data-delete-block]').forEach(x=>x.onclick=()=>deleteBlock(x.dataset.deleteBlock));
    root().querySelectorAll('[data-clear-block]').forEach(x=>x.onclick=()=>clearBlock(x.dataset.clearBlock));
    document.getElementById('aeCopyTocJson')?.addEventListener('click',copyTocJson);
    root().querySelectorAll('[data-insert-after]').forEach(x=>x.onchange=async()=>{const type=x.value;x.value='';if(type)await insertBlockAfter(x.dataset.insertAfter,type);});
    root().querySelectorAll('[data-search-wikimedia]').forEach(x=>x.onclick=()=>wiki(x.dataset.searchWikimedia,true));
    root().querySelectorAll('[data-validate-block]').forEach(x=>x.onclick=()=>generateBlock(x.dataset.validateBlock));
  }

  function addBlock(type){
    ensureCourseStructure(state.course);
    const b=block(type),blocks=activeBlocks();
    let endIndex=blocks.findIndex(x=>x?.role===END_ROLE);
    if(endIndex<0){blocks.push(systemBlock(END_ROLE,state.course.title));endIndex=blocks.length-1;}
    blocks.splice(endIndex,0,b);
    state.selected=b.id;validateCourse();renderWorkspace();
    setStatus(type==='fiche-revision'?'Fiche ajoutée à la fin du contenu. Modifie son JSON puis génère-la ; tu pourras ajouter des blocs en dessous.':type==='vector-scene'?'Schéma vectoriel ajouté à la fin du contenu. Modifie son JSON puis génère la page.':'Bloc ajouté à la fin du contenu, sous les blocs déjà présents.');
  }
  async function insertBlockAfter(id,type){
    ensureCourseStructure(state.course);
    const blocks=activeBlocks(),idx=blocks.findIndex(x=>x.id===id),source=idx>=0?blocks[idx]:null;
    if(!source||isSystemBlock(source))return;
    if(!['paragraph','point','exercise','graphique','vector-scene','fiche-revision','wikimedia-image'].includes(type))return;
    const b=block(type);
    blocks.splice(idx+1,0,b);
    state.selected=b.id;
    validateCourse();
    renderWorkspace();
    setStatus(type==='wikimedia-image'?'Image insérée : sélectionne maintenant son illustration.':type==='graphique'?'Graphique GeoGebra inséré sous le bloc sélectionné : renseigne ou colle son JSON GeoGebra.':type==='vector-scene'?'Schéma vectoriel inséré sous le bloc sélectionné : modifie son JSON.':type==='fiche-revision'?'Fiche de révision insérée sous le bloc sélectionné. Tu peux continuer à ajouter des blocs dessous.':type==='exercise'?'Exercice inséré sous le bloc sélectionné.':type==='point'?'Point de cours inséré sous le bloc sélectionné.':'Paragraphe inséré sous le bloc sélectionné.');
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
    else if(['graphique','vector-scene','fiche-revision'].includes(b.type))b.content={json:{}};
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
      const selector=['graphique','vector-scene','fiche-revision'].includes(b.type)
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

  function prepareAssistedModalHost(){
    const host=document.getElementById('aeModalHost');
    if(host&&host.parentElement!==document.body)document.body.appendChild(host);
    return host;
  }

  function activateAssistedModal(host){
    if(state.modalViewport)closeAssistedModal();
    state.modalViewport={scrollY:window.scrollY||0,bodyOverflow:document.body.style.overflow||''};
    document.body.style.overflow='hidden';
    const modal=host?.querySelector('.ae-modal');
    modal?.addEventListener('click',e=>{if(e.target===modal)closeAssistedModal();});
  }

  function closeAssistedModal(){
    const host=document.getElementById('aeModalHost');
    if(host)host.innerHTML='';
    const saved=state.modalViewport;
    if(!saved)return;
    state.modalViewport=null;
    document.body.style.overflow=saved.bodyOverflow||'';
    requestAnimationFrame(()=>window.scrollTo(0,saved.scrollY||0));
  }

  function openBlockModal(title,body){
    const host=prepareAssistedModalHost();if(!host)return;
    if(state.modalViewport)closeAssistedModal();
    host.innerHTML='<div class="ae-modal"><div class="ae-dialog"><header><div><span class="ae-kicker">'+esc(title)+'</span></div><button class="admin-btn ghost" id="aeModalClose">Fermer</button></header><div class="ae-dialog-body">'+body+'</div></div></div>';
    activateAssistedModal(host);
    document.getElementById('aeModalClose').onclick=()=>closeAssistedModal();
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


  function systemPageFingerprint(kind){
    if(!state.course)return '';
    ensureDocumentPages(state.course);
    let pageData;
    if(kind==='toc'){
      pageData=tocPayload();
    }else if(kind==='end'){
      const endBlock=activeBlocks().find(b=>b?.role===END_ROLE);
      pageData=clone(state.course.document_pages.end);
      pageData.page_number=pageNumberFor(endBlock);
    }else{
      pageData=clone(state.course.document_pages.cover);
    }
    return JSON.stringify({
      schema:'aurore-assisted-system-page-v2',
      kind,
      title:String(state.course.title||''),
      theme_color:normalizeThemeColor(state.course.theme_color),
      page_data:pageData
    });
  }
  function canonicalPreviewFingerprint(){
    if(!state.course)return '';
    return JSON.stringify({
      cover:systemPageFingerprint('cover'),
      toc:systemPageFingerprint('toc'),
      end:systemPageFingerprint('end')
    });
  }

  function emptySystemPageState(){return {documentId:null,pdfUrl:null,status:'idle',progress:0,stage:'',error:null,updatedAt:null,fingerprint:''};}
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
  function canonicalPreviewIsFresh(kind){
    if(!state.course||!state.canonicalPreview)return false;
    if(kind){
      const page=state.canonicalPreview.pages?.[kind];
      return Boolean(page?.fingerprint&&page.fingerprint===systemPageFingerprint(kind));
    }
    return ['cover','toc','end'].every(key=>canonicalPreviewIsFresh(key));
  }
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
    const kind=systemPageKey(key),p=state.canonicalPreview?.pages?.[kind]||emptySystemPageState(),fresh=canonicalPreviewIsFresh(kind);
    const visible=fresh?p:{...emptySystemPageState(),stage:'Cette version doit être régénérée.'};
    const status=String(visible.status||'idle').toLowerCase(),pct=Math.max(0,Math.min(100,Number(visible.progress||0)));
    const ready=status==='ready'&&pct>=100;
    return '<div class="ae-generation-progress ae-canonical-progress" data-canonical-preview="'+esc(kind)+'" data-canonical-preview-kind="'+esc(kind)+'" data-preview-status="'+esc(status)+'"><div class="ae-generation-progress-top"><span data-canonical-preview-stage>'+esc(label)+' · '+esc(visible.stage||'Préparation…')+'</span><strong data-canonical-preview-pct>'+Math.round(pct)+'%</strong></div><div class="ae-progress-track"><span data-canonical-preview-bar style="width:'+pct+'%"></span></div><small data-canonical-preview-detail>'+esc(ready?'PDF de page prêt · fragment indépendant réutilisable.':status==='processing'?'Rendu indépendant en cours.':status==='queued'?'Page système créée · rendu prêt à démarrer.':status==='error'?'La génération de cette page a échoué.':'Prévisualisation indépendante à générer.')+'</small></div>';
  }
  function updateCanonicalPreviewUi(){
    const pages=state.canonicalPreview?.pages||normalizedSystemPages({});
    refreshDownloadButton();
    root()?.querySelectorAll('[data-canonical-preview]').forEach(el=>{
      const kind=el.dataset.canonicalPreviewKind||'cover',fresh=canonicalPreviewIsFresh(kind),p=fresh?(pages[kind]||emptySystemPageState()):emptySystemPageState();
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
    const pages=normalizedSystemPages(state.canonicalPreview);
    const nextPage={...pages[kind],...patch,updatedAt:new Date().toISOString()};
    if(patch.status==='ready')nextPage.fingerprint=systemPageFingerprint(kind);
    const nextPages={...pages,[kind]:nextPage},overall=systemPreviewOverallFromPages(nextPages);
    const next={...state.canonicalPreview,fingerprint:canonicalPreviewFingerprint(),pages:nextPages,status:overall.status,progress:overall.progress,stage:overall.stage,error:nextPage.error||state.canonicalPreview.error||null,updatedAt:new Date().toISOString()};
    state.canonicalPreview=next;
    if(state.course)state.course.generation={...(state.course.generation||{}),system_preview:{...next}};
    updateCanonicalPreviewUi();
    if(persist)void persistCourse(true,false);
  }
  async function independentSystemPageStatus(documentId){
    const token=await freshToken();
    const r=await fetch(SUPABASE_URL+'/functions/v1/aurora-assisted-system-page',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_ANON_KEY},body:JSON.stringify({mode:'status',generated_document_id:Number(documentId)})});
    const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={error:t}};if(!r.ok||!d.ok)throw new Error(d.error||('Statut page système HTTP '+r.status));return d;
  }
  async function requestIndependentSystemPage(kind,{force=false}={}){
    ensureDocumentPages(state.course);
    const fp=systemPageFingerprint(kind),current=state.canonicalPreview?.pages?.[kind]||emptySystemPageState();
    const token=await freshToken();
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
      if(!pdfUrl)throw new Error('Le renderer de page système n’a fourni aucune URL PDF.');
      // Ne télécharge pas le PDF dans le téléphone juste pour le compresser à chaque génération.
      // L'optimisation éventuelle est différée à l'assemblage final, où le fragment doit déjà être lu.
      const deferredOptimization={status:'deferred_to_final_assembly',compressed:false,original_bytes:Number(d.bytes)||null,optimized_bytes:null,page_count:1,error:null};
      setSystemPageState(kind,{status:'ready',progress:100,stage:'PDF prêt · optimisation différée à la fusion finale',pdfUrl,pdfOptimization:deferredOptimization,fingerprint:fp,error:null},{persist:true});
      return {...d,pdf_optimization:deferredOptimization};
    }

    if(!force&&canonicalPreviewIsFresh(kind)&&current.documentId){
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
    const kinds=['cover','toc','end'];
    if(!force&&kinds.every(kind=>canonicalPreviewIsFresh(kind))){
      const pages=state.canonicalPreview?.pages||normalizedSystemPages({});
      setStatus('Couverture, sommaire et page finale déjà prêts · PDF existants réutilisés.');
      return {pages:kinds.map(kind=>pages[kind])};
    }
    const fp=canonicalPreviewFingerprint();
    const base={...state.canonicalPreview,fingerprint:fp,pages:normalizedSystemPages(state.canonicalPreview),status:'processing',progress:0,stage:'Vérification des pages système indépendantes',error:null,updatedAt:new Date().toISOString()};
    state.canonicalPreview=base;
    if(state.course)state.course.generation={...(state.course.generation||{}),system_preview:{...base}};
    updateCanonicalPreviewUi();
    await persistCourse(true,false);
    const results=await Promise.all(kinds.map(kind=>requestIndependentSystemPage(kind,{force})));
    setStatus('Vérification des pages système terminée · les pages valides ont été réutilisées.');
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

  async function assistedPdfPageCount(url){
    const pdfjs=await loadPdfJsForAssistedPreview();
    let buffer=cachedPreviewBuffer(url);
    if(!buffer){
      const response=await fetch(url,{cache:'force-cache'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      buffer=await response.arrayBuffer();if(!buffer.byteLength)throw new Error('PDF vide.');
      rememberPreviewBuffer(url,buffer);
    }
    const pdf=await pdfjs.getDocument({data:new Uint8Array(buffer.slice(0)),stopAtErrors:false}).promise;
    return Math.max(1,Number(pdf.numPages||1));
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

  async function progressivePreviewBlock(id,mode="previous"){
    ensureCourseStructure(state.course);
    const current=activeBlocks().find(x=>x.id===id);if(!current||isSystemBlock(current))return;

    const currentIndex=activeBlocks().findIndex(x=>x.id===id);
    const previous=activeBlocks().slice(0,currentIndex).filter(b=>!isSystemBlock(b));
    const allSteps=[];
    const currentGeneration=current.generation||{};
    const targetSegment=flowSegmentFor(current.id);
    const targetSegmentIds=new Set(targetSegment.map(b=>String(b?.id||'')));
    const targetFlowOwner=targetSegment[0]||current;
    const targetFlowOwnerGeneration=targetFlowOwner?.generation||{};
    const preferTargetFlow=currentGeneration.independent_regeneration===true
      &&targetSegment.length>1
      &&String(targetFlowOwner.id)!==String(current.id)
      &&String(targetFlowOwnerGeneration.status||'').toLowerCase()==='ready'
      &&!!String(targetFlowOwnerGeneration.page_url||'').trim()
      &&targetFlowOwnerGeneration.independent_regeneration!==true
      &&generationCoversThrough(targetFlowOwnerGeneration,targetSegment,current.id);
    const cover=activeBlocks().find(x=>x?.role===START_ROLE);
    const toc=activeBlocks().find(x=>x?.role==='document-toc');
    const coverState=state.canonicalPreview?.pages?.cover;
    const tocState=state.canonicalPreview?.pages?.toc;

    if(cover&&coverState?.pdfUrl)allSteps.push({kind:'pdf',label:'Page 1 · Couverture',url:coverState.pdfUrl,number:1,status:'ready',source:cover});
    if(tocState?.pdfUrl)allSteps.push({kind:'pdf',label:'Page 2 · Sommaire',url:tocState.pdfUrl,number:2,status:'ready',source:toc});

    const previewSeenOwners=new Set(),previewSeenUrls=new Set();
    for(const b of previous){
      if(preferTargetFlow&&targetSegmentIds.has(String(b.id))){
        if(String(b.id)!==String(targetFlowOwner.id))continue;
        const page=pageNumberFor(targetFlowOwner),url=String(targetFlowOwnerGeneration.page_url||'').trim();
        if(url&&!previewSeenUrls.has(url)){
          const owner=String(targetFlowOwnerGeneration.flow_page_owner_id||targetFlowOwner.id);
          previewSeenOwners.add(owner);
          previewSeenUrls.add(url);
          allSteps.push({kind:'pdf',label:'Page '+page+' · flux assisté',url,number:page,status:'ready',source:targetFlowOwner,flow_contains_current:true});
        }
        continue;
      }
      const blockSegment=flowSegmentFor(b.id);
      const blockFlowOwner=blockSegment[0]||b;
      const blockFlowGeneration=blockFlowOwner?.generation||{};
      if(generationContainsBlock(blockFlowGeneration,b.id)){
        if(String(b.id)!==String(blockFlowOwner.id))continue;
        const flowUrl=String(blockFlowGeneration.page_url||'').trim();
        if(flowUrl&&!previewSeenUrls.has(flowUrl)){
          previewSeenOwners.add(String(blockFlowOwner.id));
          previewSeenUrls.add(flowUrl);
          allSteps.push({kind:'pdf',label:'Page '+String(pageNumberFor(blockFlowOwner))+' · flux assisté',url:flowUrl,number:pageNumberFor(blockFlowOwner),status:'ready',source:blockFlowOwner,flow_contains_current:generationContainsBlock(blockFlowGeneration,current.id)});
        }
        continue;
      }
      const page=pageNumberFor(b),url=String(b?.generation?.page_url||'').trim();
      const owner=String(b?.generation?.flow_page_owner_id||'').trim();
      if(url&&previewSeenUrls.has(url))continue;
      if(owner&&previewSeenOwners.has(owner))continue;
      if(owner)previewSeenOwners.add(owner);
      if(url)previewSeenUrls.add(url);
      if(url)allSteps.push({kind:'pdf',label:'Page '+page+' · '+labelFor(b),url,number:page,status:'ready',source:b});
      else allSteps.push({kind:'pending',label:'Page '+page+' · '+labelFor(b),number:page,status:'pending',source:b});
    }

    const currentPage=Number(pageNumberFor(current)),targetThroughPage=Number(mode==="previous"?pageNumberForEnd(current):currentPage),currentUrl=String(current?.generation?.page_url||'').trim();
    const currentOwner=String(current?.generation?.flow_page_owner_id||'').trim();
    if(!preferTargetFlow&&currentUrl&&!(previewSeenUrls.has(currentUrl)|| (currentOwner&&previewSeenOwners.has(currentOwner)))){
      if(currentOwner)previewSeenOwners.add(currentOwner);
      previewSeenUrls.add(currentUrl);
      allSteps.push({kind:'pdf',label:'Page '+currentPage+' · '+labelFor(current)+' · bloc actuel',url:currentUrl,number:currentPage,status:'ready',source:current,current:true});
    }else if(!preferTargetFlow&&current.type==='graphique'){
      const graphUrl=await graphPreviewUrl(current);
      if(graphUrl)allSteps.push({kind:'image',label:'Page '+currentPage+' · Graphique · bloc actuel',url:graphUrl,number:currentPage,status:'current-image',source:current,current:true});
      else allSteps.push({kind:'pending',label:'Page '+currentPage+' · '+labelFor(current)+' · bloc actuel',number:currentPage,status:'current-pending',source:current,current:true});
    }else if(!preferTargetFlow&&current.type==='wikimedia-image'&&current.content?.imageUrl){
      allSteps.push({kind:'image',label:'Page '+currentPage+' · Image Wikimedia · bloc actuel',url:current.content.imageUrl,number:currentPage,status:'current-image',source:current,current:true});
    }else if(!preferTargetFlow){
      allSteps.push({kind:'text',label:'Page '+currentPage+' · '+labelFor(current)+' · bloc actuel',number:currentPage,status:'current-draft',source:current,current:true});
    }

    const readyCount=allSteps.filter(x=>x.kind==='pdf').length;
    const totalCount=allSteps.length;
    // Une même URL peut représenter un flux PDF multi-pages. La prévisualisation
    // doit afficher chaque page physique une seule fois, au lieu de repeindre la page 1
    // pour chaque bloc compagnon. Pour une prévisualisation progressive, on limite le
    // flux au nombre de pages déjà atteintes par le bloc courant.
    const expandedSteps=[];
    const expandedPdfUrls=new Set();
    for(const step of allSteps){
      if(step.kind!=='pdf'||!step.url){
        expandedSteps.push(step);
        continue;
      }
      if(expandedPdfUrls.has(step.url))continue;
      expandedPdfUrls.add(step.url);
      const count=await assistedPdfPageCount(step.url);
      const base=Number(step.number||1);
      const isFlow=generationHasFlow(step.source?.generation)||Number(step.source?.generation?.page_count||0)>1;
      const limit=isFlow?Math.min(count,Math.max(1,targetThroughPage-base+1)):Math.min(count,1);
      for(let p=1;p<=limit;p++){
        expandedSteps.push({
          ...step,
          number:base+p-1,
          pdf_page_index:p,
          current:step.flow_contains_current?p===limit:!!step.current,
          label:isFlow?'Page '+String(base+p-1)+' · flux assisté':'Page '+String(base+p-1)+' · '+String(step.label||'PDF')
        });
      }
    }
    const selectedSteps=mode==="current"
      ? expandedSteps.filter(step=>Number(step.number)===currentPage)
      : expandedSteps;
    allSteps.length=0;
    allSteps.push(...selectedSteps);

    const body='<div class="ae-progressive-preview">'+
      '<div class="ae-page-preview-meta"><strong>'+(mode==="current"?"Page PDF "+currentPage:"Progression du document jusqu’à la page "+targetThroughPage)+'</strong><span>'+readyCount+' page(s) PDF déjà produite(s) · '+totalCount+' étape(s) source affichée(s)</span></div>'+
      '<div class="ae-progressive-preview-note">'+(mode==="current"?"Seule la page physique associée au bloc sélectionné est ouverte dans le lecteur intégré.":"La prévisualisation suit l’ordre réel du document, de la couverture à la fin physique du bloc sélectionné. Les blocs suivants restent hors de cette vue.")+'</div>'+
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

    openBlockModal(mode==='current'?'Prévisualisation de la page '+currentPage:'Prévisualisation du document jusqu’à la page '+targetThroughPage,body);
    document.getElementById('aeCloseProgressivePreview')?.addEventListener('click',()=>closeAssistedModal());
    const modalHost=document.getElementById('aeModalHost');
    const previewBody=modalHost?.querySelector('.ae-dialog-body');
    const currentSections=modalHost?.querySelectorAll('.ae-progressive-page.is-current');
    const currentSection=currentSections?.[currentSections.length-1];
    if(previewBody&&currentSection)requestAnimationFrame(()=>{
      if(!previewBody.isConnected||!currentSection.isConnected)return;
      const delta=currentSection.getBoundingClientRect().top-previewBody.getBoundingClientRect().top;
      previewBody.scrollTop=Math.max(0,previewBody.scrollTop+delta-10);
    });

    for(const [i,step] of allSteps.entries()){
      if(step.kind!=='pdf')continue;
      const canvasId='aeProgressivePdf_'+String(id).replace(/[^a-zA-Z0-9_-]/g,'_')+'_'+i;
      const loadingId=canvasId+'_loading';
      if(document.getElementById(canvasId))await renderAssistedPdfPreview(step.url,canvasId,loadingId,Number(step.pdf_page_index||1));
    }
    setStatus(mode==='current'?'Prévisualisation intégrée prête : page '+currentPage+'.':'Prévisualisation intégrée prête : pages jusqu’à '+targetThroughPage+'.');
  }

  async function previewGraphBlock(id){
    const b=activeBlocks().find(x=>String(x.id)===String(id));
    if(!b||b.type!=='graphique')return;
    if(b.jsonEditorInvalid){setStatus('JSON graphique invalide. Corrige-le avant la prévisualisation.');return;}
    const suffix=String(id).replace(/[^a-zA-Z0-9_-]/g,'_');
    const imageId='aeGraphPreviewImage_'+suffix,loadingId='aeGraphPreviewLoading_'+suffix;
    const body='<div class="ae-page-preview">'+
      '<div class="ae-page-preview-meta"><strong>Graphique GeoGebra · aperçu avant génération</strong><span>Construction réelle depuis le JSON · aucune page PDF requise</span></div>'+
      '<div class="ae-page-preview-canvas-wrap"><div id="'+loadingId+'" class="ae-preview-loading">Construction du graphique GeoGebra…</div><img id="'+imageId+'" alt="Prévisualisation du graphique GeoGebra" style="display:none;width:100%;max-width:100%;height:auto;max-height:70vh;object-fit:contain;margin:0 auto"></div>'+
      '</div>';
    openBlockModal('Prévisualisation du graphique',body);
    setStatus('Construction de l’aperçu GeoGebra…');
    try{
      const exportPNG=window.auroraGeoGebraRenderer?.exportPNG;
      if(typeof exportPNG!=='function')throw new Error('Le moteur GeoGebra n’est pas chargé. Recharge Aurore puis réessaie.');
      const pngBase64=await exportPNG(clone(b.content?.json||{}));
      const image=document.getElementById(imageId);
      if(!image)return;
      const raw=String(pngBase64||'').replace(/^data:image\/png;base64,/i,'');
      if(!raw)throw new Error('GeoGebra n’a retourné aucune image.');
      image.src='data:image/png;base64,'+raw;
      image.style.display='block';
      document.getElementById(loadingId)?.remove();
      setStatus('Prévisualisation GeoGebra prête.');
    }catch(e){
      const loading=document.getElementById(loadingId);
      if(loading)loading.innerHTML='<strong>Prévisualisation indisponible</strong><span>'+esc(String(e?.message||e))+'</span>';
      setStatus('Prévisualisation GeoGebra impossible : '+String(e?.message||e));
    }
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

    const segment=flowSegmentFor(id),owner=segment[0]||b,ownerGeneration=owner.generation||{};
    const ownReady=String(b.generation?.status||'').toLowerCase()==='ready'&&!!String(b.generation?.page_url||'').trim();
    const flowReady=String(ownerGeneration.status||'').toLowerCase()==='ready'
      &&!!String(ownerGeneration.page_url||'').trim()
      &&generationContainsBlock(ownerGeneration,b.id);
    if(ownReady||flowReady){
      const mode=await askBlockDownloadChoice(b,"preview");
      if(!mode)return;
      await progressivePreviewBlock(id,mode);
      return;
    }
    if(b.type==='graphique'){
      await previewGraphBlock(id);
      return;
    }
    await progressivePreviewBlock(id,"previous");
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
    if(['vector-scene','schema-vectoriel','schéma-vectoriel'].includes(t))return 'vector-scene';
    if(['fiche-revision','fiche de revision','fiche de révision'].includes(t))return 'fiche-revision';
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
      }else if(type==='vector-scene'||type==='fiche-revision'){
        b.content={json:b.content?.json&&typeof b.content.json==='object'&&!Array.isArray(b.content.json)?b.content.json:{}};
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
    document.getElementById('aeApplyJson').onclick=()=>{try{const v=JSON.parse(document.getElementById('aeDialogJson').value);b.content=normalizeContent(b.type,v);validateCourse();closeAssistedModal();renderWorkspace();setStatus('JSON appliqué au bloc.')}catch(_){setStatus('JSON invalide.')}};
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

  function renderPdfBatchProgress(){
    const p=state.pdfBatchProgress||{};
    const percent=Math.max(0,Math.min(100,Math.round(Number(p.percent)||0)));
    const label=document.getElementById('aePdfBatchProgressLabel');
    const pct=document.getElementById('aePdfBatchProgressPercent');
    const bar=document.getElementById('aePdfBatchProgressBar');
    const track=document.getElementById('aePdfBatchProgressTrack');
    const detail=document.getElementById('aePdfBatchProgressDetail');
    if(label)label.textContent=String(p.label||'En attente de génération');
    if(pct)pct.textContent=percent+'%';
    if(bar)bar.style.width=percent+'%';
    if(track)track.setAttribute('aria-valuenow',String(percent));
    if(detail){
      const count=Number(p.targetCount)||0;
      const start=Math.max(0,Number(p.activeTargetIndex)||0);
      const size=Math.max(1,Number(p.activeTargetSize)||1);
      const end=Math.min(count,start+size);
      detail.textContent=state.pdfBatchRunning
        ?(count?(size>1
          ?'Rendu séquentiel · blocs '+(start+1)+'–'+end+' sur '+count+' · ces blocs contigus sont envoyés ensemble au renderer.'
          :'Rendu séquentiel · bloc '+(start+1)+' sur '+count+' · les pages système seront contrôlées à la fin.')
          :'Inventaire des blocs avant le lancement du rendu…')
        :(percent>=100?'PDF final vérifié : toutes les pages attendues sont fusionnées et le nombre de pages est contrôlé.':percent>=95?String(p.label||'Finalisation du PDF en cours…')+' Les fragments sont optimisés avant l’assemblage ; aucune compression globale ne sera lancée après la fusion.':'Les pages sont rendues une par une pour préserver les sauvegardes et éviter les conflits.');
      const optimizationErrors=Array.isArray(state.finalPdfArtifact?.optimizationErrors)?state.finalPdfArtifact.optimizationErrors:[];
      if(!state.pdfBatchRunning&&percent>=100&&optimizationErrors.length){
        detail.textContent='PDF final vérifié, mais compression individuelle en échec pour '+optimizationErrors.length+' fragment(s). Diagnostic : '+String(optimizationErrors[0]||'erreur inconnue').slice(0,420)+'. Tu peux relancer la compression sans régénérer les pages.';
      }
    }
  }
  function setPdfBatchProgress(label,percent){
    state.pdfBatchProgress={...(state.pdfBatchProgress||{}),label:String(label||'Génération…'),percent:Math.max(0,Math.min(100,Math.round(Number(percent)||0)))};
    renderPdfBatchProgress();
  }
  function updateGenerationProgress(id,value,label){
    const card=root()?.querySelector('[data-block="'+CSS.escape(id)+'"]');
    const bar=card?.querySelector('[data-progress-bar]'),pct=card?.querySelector('[data-progress-pct]'),lab=card?.querySelector('[data-progress-label]');
    if(bar)bar.style.width=Math.max(0,Math.min(100,value))+'%';
    if(pct)pct.textContent=Math.round(value)+'%';
    if(lab)lab.textContent=label||'Génération…';
    if(state.pdfBatchRunning&&Number(state.pdfBatchProgress?.targetCount)>0){
      const p=state.pdfBatchProgress,total=Math.max(1,Number(p.targetCount)||1);
      const idx=Math.max(0,Math.min(total-1,Number(p.activeTargetIndex)||0));
      const size=Math.max(1,Math.min(total-idx,Number(p.activeTargetSize)||1));
      const fraction=Math.max(0,Math.min(100,Number(value)||0))/100;
      p.percent=Math.max(0,Math.min(82,Math.round(((idx+fraction*size)/total)*82)));
      const first=idx+1,last=Math.min(total,idx+size);
      p.label=(size>1?'Séquence · blocs '+first+'–'+last+'/'+total:'Bloc '+first+'/'+total)+' · '+String(label||'Rendu en cours');
      renderPdfBatchProgress();
    }
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
      if(b.type==='exercise'){
        const originalTitle=String(b.content?.title||'Exercice');
        n.content={
          title:i===0?originalTitle:originalTitle+' — suite',
          statement:part,
          hint:i===0?b.content?.hint:'',
          correction_title:i===chunks.length-1?String(b.content?.correction_title||'Corrigé'):'',
          correction:i===chunks.length-1?String(b.content?.correction||''):''
        };
      }else if(b.type==='point'&&i===0){
        n.content={
          title:String(b.content?.title||'Point de cours'),
          text:part,
          color:normalizePointColor(b.content?.color),
          rank:Number(b.content?.rank)||1
        };
      }else{
        // Une suite de point continue comme paragraphe : le titre original
        // ne doit pas être redessiné sur chaque fragment.
        if(b.type==='point')n.type='paragraph';
        n.content={text:part};
      }
      n.generation={
        status:'not_generated',
        page_number:null,
        page_path:null,
        page_url:null,
        error:null,
        autoSplitDepth:depth,
        split_exercise_continuation:b.type==='exercise'&&i<chunks.length-1
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

  function isAssistedFlowableBlock(b){
    if(!b||isSystemBlock(b)||isDefaultIntroduction(b)||isRepeatedDefaultIntroduction(b))return false;
    const type=String(b.type||'').toLowerCase();
    const content=b.content&&typeof b.content==='object'?b.content:{};
    // Tous ces éléments suivent le flux vertical : le renderer les place dans
    // l'espace disponible et ne passe à la page suivante qu'en cas de manque réel.
    if(type==='paragraph'||type==='point')return Boolean(String(content.text||'').trim());
    if(type==='exercise')return Boolean(String(content.statement||'').trim());
    if(type==='graphique'){
      const g=content.json&&typeof content.json==='object'&&!Array.isArray(content.json)?content.json:{};
      return Boolean(String(g.geogebra_image_path||g.graph_local_path||g.geogebra_image_url||g.image_url||g.preview_url||'').trim());
    }
    if(type==='vector-scene'){
      const j=content.json&&typeof content.json==='object'&&!Array.isArray(content.json)?content.json:{};
      const scene=j.scene&&typeof j.scene==='object'&&!Array.isArray(j.scene)?j.scene:{};
      return Array.isArray(scene.elements)&&scene.elements.length>0;
    }
    if(type==='wikimedia-image')return String(content.imageUrl||'').startsWith('https://upload.wikimedia.org/')
      &&String(content.sourceUrl||'').startsWith('https://commons.wikimedia.org/')
      &&Boolean(String(content.license||'').trim());
    return false;
  }

  function flowSegmentFor(id){
    const all=activeBlocks();
    const index=all.findIndex(b=>String(b?.id||'')===String(id||''));
    if(index<0)return [];
    const current=all[index];
    if(!isAssistedFlowableBlock(current))return [current];
    let start=index,end=index;
    while(start>0&&isAssistedFlowableBlock(all[start-1]))start--;
    while(end<all.length-1&&isAssistedFlowableBlock(all[end+1]))end++;
    return all.slice(start,end+1);
  }

  function flowBlocksFor(id){
    const all=activeBlocks();
    const index=all.findIndex(b=>String(b?.id||'')===String(id||''));
    if(index<0)return [];
    const current=all[index];
    // Les paragraphes, exercices, graphiques et images validés suivent un même flux paginé.
    if(!isAssistedFlowableBlock(current))return [current];
    let start=index;
    while(start>0&&isAssistedFlowableBlock(all[start-1]))start--;
    let end=index;
    while(end<all.length-1&&isAssistedFlowableBlock(all[end+1]))end++;
    return all.slice(start,end+1);
  }

  function renderableFlowBlocksFor(id){
    return flowBlocksFor(id).filter(hasRenderableContent);
  }

  function generationFlowIds(generation){
    return Array.isArray(generation?.flow_block_ids)
      ?generation.flow_block_ids.map(id=>String(id||'')).filter(Boolean)
      :[];
  }
  function generationHasFlow(generation){
    const ids=generationFlowIds(generation);
    return ids.length>1&&String(generation?.flow_page_owner_id||'')===ids[0];
  }
  function generationContainsBlock(generation,blockId){
    return generationHasFlow(generation)&&generationFlowIds(generation).includes(String(blockId||''));
  }
  function generationCoversThrough(generation,segment,targetId){
    const ids=generationFlowIds(generation);
    if(!generationHasFlow(generation)||!Array.isArray(segment)||segment.length<=1)return false;
    const targetIndex=segment.findIndex(block=>String(block?.id||'')===String(targetId||''));
    if(targetIndex<0||ids.length<targetIndex+1)return false;
    return segment.slice(0,targetIndex+1).every((block,index)=>ids[index]===String(block?.id||''));
  }

  function flowRenderBlockFor(id){
    const blocks=renderableFlowBlocksFor(id);
    if(blocks.length<=1)return blocks[0]||null;
    const first=clone(blocks[0]);
    first.flow_blocks=blocks.map(b=>clone(b));
    first.generation={
      ...(first.generation||{}),
      flow_companion_ids:blocks.slice(1).map(b=>b.id)
    };
    return first;
  }

  function assistedPageFunctionUrl(){
    const host=String(window.location?.hostname||'').toLowerCase();
    const fixedProductionHosts=new Set([
      'aurore-section-archives.com',
      'aurore-section-archives-j95aybwok-ouali1.vercel.app',
      'aurore-section-archivescom.vercel.app'
    ]);
    // Preview et production doivent valider exactement le même moteur et le même contrat.
    return SUPABASE_URL+'/functions/v1/aurora-assisted-page-v3';
  }
  function syncBlockEditorBeforeGenerate(b){
    const ui=root();
    if(!ui||!b)return;
    const field=Array.from(ui.querySelectorAll('[data-edit-text]'))
      .find(el=>String(el.dataset.editText||'')===String(b.id));
    if(b.type==='paragraph'){
      let value=field?String(field.value??''):'';
      if(!value.trim()&&typeof b.content==='string')value=b.content;
      if(!value.trim()&&b.content&&typeof b.content==='object'&&!Array.isArray(b.content)){
        value=String(b.content.text??b.content.content??b.content.body??'');
      }
      const trimmed=value.trim();
      // A complete paragraph JSON pasted into the text area is not paragraph
      // prose. Read its raw content field first so LaTeX backslashes such as
      // \\nu, \\frac and \\lambda are preserved even if the JSON was malformed.
      if(trimmed.startsWith('{')&&trimmed.endsWith('}')){
        const rawContent=trimmed.match(/"content"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"[A-Za-z_][\w-]*"\s*:|\}\s*$)/);
        if(rawContent){
          value=rawContent[1].replace(/\\\\/g,'\\').replace(/\\"/g,'"');
        }else{
          try{
            const parsed=JSON.parse(trimmed);
            if(parsed&&typeof parsed==='object'&&String(parsed.type||'').toLowerCase()==='paragraph'){
              const inner=parsed.content;
              if(typeof inner==='string')value=inner;
              else if(inner&&typeof inner==='object')value=String(inner.text??inner.content??inner.body??value);
            }
          }catch(_){}
        }
      }
      b.content={...(b.content&&typeof b.content==='object'&&!Array.isArray(b.content)?b.content:{}),text:value};
    }
  }

  async function generateBlock(id,options={}){
    ensureCourseStructure(state.course);
    const b=activeBlocks().find(x=>x.id===id);if(!b)return;
    // Synchronize the visible editor before validation; mobile paste/blur can
    // otherwise leave stale empty state and make the button appear inert.
    syncBlockEditorBeforeGenerate(b);
    if(isSystemBlock(b)){setStatus('Les pages de début et de fin sont automatiques : seule une page de contenu centrale peut être générée ici.');return;}
    if(['graphique','vector-scene','fiche-revision'].includes(b.type)&&b.jsonEditorInvalid){setStatus('JSON invalide. Corrige-le avant de générer la page.');return;}
    const v=validateBlock(b);
    if(!v.ok){
      // Do not rebuild the whole workspace on validation failure: that destroys
      // the active textarea and looks like the generate button ignored the click.
      const ui=root();
      const card=Array.from(ui?.querySelectorAll('[data-block]')||[])
        .find(el=>String(el.dataset.block||'')===String(b.id));
      if(card){
        const head=card.querySelector('.ae-block-head');
        const small=head?.querySelector('small');
        const badge=head?.querySelector('.ae-block-state');
        if(small)small.textContent='À valider';
        if(badge){badge.classList.toggle('ok',false);badge.classList.toggle('bad',true);badge.textContent='À corriger';}
        const errors=card.querySelector('.ae-block-errors');
        if(errors)errors.innerHTML=v.errors.map(x=>'• '+esc(x)).join('<br>');
      }
      setStatus('Bloc invalide : '+v.errors.join(' '));
      return;
    }

    // Un seul bloc propriétaire génère un flux contigu. Cliquer un bloc compagnon
    // ne recrée jamais le même PDF : on réutilise le propriétaire du flux.
    const flowGroup=renderableFlowBlocksFor(b.id);
    const flowOwner=flowGroup[0]||b;
    const forceSingleBlock=options?.forceSingleBlock===true;
    const skipCpuFallback=options?.skipCpuFallback===true;
    // Garder l'état des PDF déjà confirmés avant de commencer une nouvelle tentative.
    // Un échec CPU du flux ne doit pas invalider les fragments qui existaient déjà.
    const priorGenerationSnapshot=new Map(flowGroup.map(part=>[String(part?.id||''),clone(part?.generation||{})]));
    // Après un HTTP 546, isoler le point/la section au prochain essai :
    // reconstruire tout le flux contigu répète le calcul coûteux et peut
    // faire échouer à nouveau une page pourtant rendable seule.
    const priorGenerationError=String(b.generation?.error||'');
    const forceIsolatedRetry=['paragraph','point'].includes(String(b.type||'').toLowerCase())
      &&/(?:HTTP\s*546|CPU_TIME_LIMIT_EXCEEDED|CPU\s+Time\s+exceeded|CPU\s+time\s+limit)/i.test(priorGenerationError);
    // Un HTTP 546 ne prouve pas que le PDF précédent est absent.
    // Ne supprimer les références qu'en l'absence d'un fragment PDF identifiable.
    const hasPriorPdfReference=!!String(b.generation?.page_url||'').trim()
      &&!!String(b.generation?.page_path||'').trim()
      &&!!String(b.generation?.generated_document_id||'').trim();
    if(/(?:HTTP\s*546|CPU_TIME_LIMIT_EXCEEDED|CPU\s+Time\s+exceeded|CPU\s+time\s+limit)/i.test(priorGenerationError)
      &&!hasPriorPdfReference){
      b.generation={
        ...(b.generation||{}),
        generated_document_id:null,
        job_id:null,
        page_path:null,
        page_url:null,
        bytes:null,
        flow_block_ids:[],
        flow_page_owner_id:null,
        independent_regeneration:false,
        error:null
      };
    }
    const isFlowCompanion=(flowGroup.length>1&&flowOwner.id!==b.id)||forceIsolatedRetry||forceSingleBlock;
    if(isFlowCompanion){
      const ownerGeneration=flowOwner.generation||{};
      if(String(flowOwner.id)!==String(b.id)&&String(ownerGeneration.status||'').toLowerCase()==='generating'){
        state.selected=b.id;
        renderWorkspace();
        setStatus('Le flux de cette séquence est déjà en cours de génération par son premier bloc.');
        return;
      }

      // Un bloc compagnon est régénérable indépendamment.
      // Le PDF déjà porté par le premier bloc reste intact ; seul le bloc cliqué
      // repasse par le renderer assisté en mode « bloc unique ».
      b.generation={
        ...(b.generation||{}),
        status:'generating',
        page_number:pageNumberFor(b),
        progress:10,
        progress_label:'Régénération du bloc…',
        error:null,
        updated_at:new Date().toISOString(),
        flow_page_owner_id:flowOwner.id
      };
      state.selected=b.id;
      renderWorkspace();
      updateGenerationProgress(b.id,10,'Régénération du bloc…');
      setStatus('Régénération indépendante du bloc sélectionné…');
    }

    b.generation={...(b.generation||{}),status:'generating',page_number:pageNumberFor(b),progress:10,progress_label:'Préparation de la page…',error:null,updated_at:new Date().toISOString()};
    renderWorkspace();updateGenerationProgress(b.id,10,'Préparation de la page…');setStatus('Préparation du rendu de la page…');
    try{
      const token=await freshToken();
      if(!token)throw new Error('Session administrateur absente.');
      if(b.type==='fiche-revision'){
        const fiche=clone(b.content?.json||{});
        fiche.page_number=pageNumberFor(b);
        fiche.mode=fiche.mode==='color'?'color':'nb';
        const theme=normalizeThemeColor(state.course.theme_color);
        const fingerprint=JSON.stringify({content:fiche,theme_color:theme});
        const callSheet=async(payload)=>{
          let requestToken=token;
          const send=()=>fetch(SUPABASE_URL+'/functions/v1/aurora-assisted-sheet',{
            method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+requestToken,'apikey':SUPABASE_ANON_KEY},body:JSON.stringify(payload)
          });
          let response=await send();
          if(response.status===401){
            requestToken=await freshToken(true);
            response=await send();
          }
          const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{}}catch(_){data={error:raw}};
          if(!response.ok||data.ok===false)throw new Error(data.error||(data.errors||[]).join('\\n')||('Rendu de fiche HTTP '+response.status));
          return data;
        };
        updateGenerationProgress(b.id,22,'Validation du JSON de la fiche…');
        const check=await callSheet({mode:'validate',page_kind:'fiche',content:fiche});
        if(!check.ok)throw new Error((check.errors||['JSON de fiche invalide']).join('\\n'));
        let docId=String(b.generation?.sheet_fingerprint||'')===fingerprint?Number(b.generation?.generated_document_id||0):0;
        if(!docId){
          updateGenerationProgress(b.id,34,'Enregistrement de la fiche…');
          const created=await callSheet({mode:'create',course_id:String(state.course.id),page_kind:'fiche',title:String(fiche.title||'Fiche de révision'),theme_color:theme,content:fiche});
          docId=Number(created.generated_document_id||0);
          if(!docId)throw new Error('Identifiant de fiche manquant après son enregistrement.');
        }
        updateGenerationProgress(b.id,65,'Génération de la fiche PDF…');
        const rendered=await callSheet({mode:'render',generated_document_id:docId,theme_color:theme});
        if(!rendered.page_url)throw new Error('Le moteur de fiche n’a fourni aucun lien PDF.');
        updateGenerationProgress(b.id,94,'PDF prêt — aucune copie locale pour compression');
        setStatus('Fiche rendue côté serveur ; son optimisation sera faite au moment de la fusion finale.');
        const pdfOptimization={status:'deferred_to_final_assembly',compressed:false,original_bytes:Number(rendered.bytes)||null,optimized_bytes:null,page_count:Number(rendered.page_count)||1,error:null};
        b.generation={...(b.generation||{}),status:'ready',page_number:pageNumberFor(b),generated_document_id:docId,job_id:null,page_path:rendered.page_path||null,page_url:rendered.page_url,updated_at:new Date().toISOString(),progress:100,progress_label:'Fiche prête — optimisation différée à la fusion finale',bytes:rendered.bytes||null,page_count:rendered.page_count||1,sheet_fingerprint:fingerprint,flow_block_ids:[],independent_regeneration:false,pdf_optimization:pdfOptimization,qa:{engine:rendered.engine||'pdf-lib-sheet-v1',status:'completed'},error:null};
        await persistCourse(true,false);
        renderWorkspace();
        setStatus('Fiche de révision générée et intégrée à la séquence du document.');
        return;
      }
      const graphBlocksToPrepare=(isFlowCompanion?[b]:flowGroup)
        .filter(part=>String(part?.type||'').toLowerCase()==='graphique'
          &&!String(part?.content?.json?.geogebra_image_path||part?.content?.json?.graph_local_path||'').trim());
      for(const graphBlock of graphBlocksToPrepare){
        const graph=clone(graphBlock.content?.json||{});
        if(!graph||typeof graph!=='object'||Array.isArray(graph))throw new Error('Le JSON du graphique est invalide.');
        updateGenerationProgress(graphBlock.id,20,'Construction du graphique GeoGebra…');
        setStatus('Construction du graphique GeoGebra dans le flux…');
        const exportPNG=window.auroraGeoGebraRenderer?.exportPNG;
        if(typeof exportPNG!=='function')throw new Error('Le moteur GeoGebra n’est pas chargé. Recharge la page puis réessaie.');
        const pngBase64=await exportPNG(graph);
        if(!pngBase64)throw new Error('GeoGebra n’a retourné aucune image pour le graphique '+String(graph.title||graphBlock.id)+'.');
        updateGenerationProgress(graphBlock.id,38,'Enregistrement du graphique GeoGebra…');
        const upload=await fetch(SUPABASE_URL+'/functions/v1/aurora-geogebra',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_ANON_KEY},
          body:JSON.stringify({action:'upload-assisted-graph',course_id:String(state.course.id),block_id:String(graphBlock.id),graph,png_base64:pngBase64})
        });
        const uploadText=await upload.text();let uploadData={};try{uploadData=uploadText?JSON.parse(uploadText):{}}catch(_){uploadData={error:uploadText}};
        if(!upload.ok||!uploadData.ok||!String(uploadData.path||'').trim())throw new Error(uploadData.error||('Enregistrement du graphique HTTP '+upload.status));
        graphBlock.content.json={...graph,geogebra_image_path:String(uploadData.path),geogebra_image_source:'geogebra',geogebra_renderer_version:Number(uploadData.renderer_version||5),geogebra_image_updated_at:new Date().toISOString()};
        await persistCourse(true,false);
      }
      updateGenerationProgress(b.id,50,'Envoi au renderer de page…');
      const r=await fetch(assistedPageFunctionUrl(),{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_ANON_KEY},
        body:JSON.stringify({
          course_id:state.course.id,
          course_title:state.course.title,
          block_id:b.id,
          page_number:pageNumberFor(b),
          single_block:isFlowCompanion,
          block:isFlowCompanion?clone(b):flowRenderBlockFor(b.id),
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
      const reportedFlowIds=Array.isArray(d.flow_block_ids)?d.flow_block_ids.map(id=>String(id||'')).filter(Boolean):[];
      const persistedFlowIds=reportedFlowIds.length?reportedFlowIds:[b.id];
      const expectedFlowIds=(isFlowCompanion?[b]:flowGroup).map(part=>String(part?.id||'')).filter(Boolean);
      if(!isFlowCompanion&&expectedFlowIds.length>1
        &&(persistedFlowIds.length!==expectedFlowIds.length
          ||!expectedFlowIds.every((expected,index)=>persistedFlowIds[index]===expected))){
        throw new Error('Le PDF a été créé, mais le renderer n’a pas confirmé tous les blocs de la séquence dans le bon ordre. Regénère la séquence depuis son premier bloc.');
      }
      updateGenerationProgress(b.id,94,'PDF prêt — aucune copie locale pour compression');
      setStatus('Page produite et stockée par le moteur serveur ; aucune compression ne télécharge une copie sur ton téléphone.');
      const pdfOptimization={status:'server_optimized_when_assisted',compressed:false,original_bytes:Number(d.bytes)||null,optimized_bytes:null,page_count:Math.max(1,Number(d.page_count)||1),error:null};
      const resultFlowIds=new Set(persistedFlowIds);
      const resultFlowGroup=activeBlocks().filter(part=>resultFlowIds.has(String(part?.id||'')));
      if(!resultFlowGroup.length)resultFlowGroup.push(b);
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
        flow_block_ids:persistedFlowIds,
        page_count:Math.max(1,Number(d.page_count)||1),
        pdf_optimization:pdfOptimizationMetadata(pdfOptimization),
        flow_page_map:d.flow_page_map&&typeof d.flow_page_map==='object'?d.flow_page_map:null,
        flow_page_end_map:d.flow_page_end_map&&typeof d.flow_page_end_map==='object'?d.flow_page_end_map:null,
        independent_regeneration:isFlowCompanion,
        qa:{engine:d.engine||'pdf-lib-course-page-v2',status:'completed',details:d.qa||null},
        error:null
      };
      resultFlowGroup.forEach(part=>{
        part.generation={
          ...(part.generation||{}),
          ...sharedGeneration,
          flow_page_owner_id:isFlowCompanion?null:b.id,
          independent_regeneration:isFlowCompanion
        };
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
        page_count:Math.max(1,Number(d.page_count)||1),
        pdf_optimization:pdfOptimizationMetadata(pdfOptimization),
        flow_page_map:d.flow_page_map&&typeof d.flow_page_map==='object'?d.flow_page_map:null,
        flow_page_end_map:d.flow_page_end_map&&typeof d.flow_page_end_map==='object'?d.flow_page_end_map:null,
        qa:{engine:d.engine||'pdf-lib-course-page-v2',status:'completed',details:d.qa||null},
        error:null
      };
      await persistCourse(true,false);
      renderWorkspace();
      setStatus(isFlowCompanion&&flowGroup.length>1
        ?'Page '+(b.generation.page_number||pageNumberFor(b))+' générée seule. Le document final attend encore les autres blocs de la séquence, sauf s’ils possèdent déjà chacun un PDF distinct.'
        :'Page '+(b.generation.page_number||pageNumberFor(b))+' générée et enregistrée.');
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
            setStatus('Bloc trop long : '+pieces.length+' blocs successifs ont été créés. Génération de toutes les pages…');
            for(let i=0;i<pieces.length;i++){
              await generateBlock(pieces[i].id);
              const generated=activeBlocks().find(x=>String(x.id)===String(pieces[i].id));
              if(String(generated?.generation?.status||'').toLowerCase()!=='ready'){
                setStatus('La suite reste à générer : fragment '+(i+1)+' sur '+pieces.length+' en échec.');
                return;
              }
            }
            setStatus(b.type==='exercise'?'Toutes les pages de l’exercice sont générées, avec la suite et le corrigé final.':'Toutes les pages du bloc découpé et ses continuations sont générées.');
            return;
          }
        }
      }
      const cpuLimitFailure=/(?:CPU_TIME_LIMIT_EXCEEDED|CPU\s+Time\s+exceeded|CPU\s+time\s+limit|HTTP\s*546)/i.test(msg);
      if(!skipCpuFallback&&!isFlowCompanion&&flowGroup.length>1&&cpuLimitFailure){
        const retryIds=[];
        flowGroup.forEach(part=>{
          const partId=String(part?.id||'');
          if(!partId)return;
          const prior=priorGenerationSnapshot.get(partId)||{};
          // Une ancienne URL PDF avec chemin et document liés reste réutilisable même
          // si une tentative CPU précédente a laissé le statut en erreur.
          const hasReusablePdf=!!String(prior.page_url||'').trim()
            &&!!String(prior.page_path||'').trim()
            &&!!String(prior.generated_document_id||'').trim();
          if(hasReusablePdf){
            // Le PDF confirmé est conservé même si le rendu regroupé échoue.
            part.generation={
              ...prior,
              status:'ready',
              progress:100,
              progress_label:'PDF existant conservé après limite CPU',
              error:null,
              updated_at:new Date().toISOString()
            };
            return;
          }
          retryIds.push(partId);
          part.generation={
            ...(part.generation||{}),
            status:'error',
            page_number:pageNumberFor(part),
            updated_at:new Date().toISOString(),
            progress:0,
            progress_label:'Reprise indépendante après limite CPU',
            error:msg,
            flow_page_owner_id:null
          };
        });
        await persistCourse(true);
        renderWorkspace();
        if(!retryIds.length){
          setStatus('Le flux complet a dépassé la limite CPU ; les PDF déjà prêts ont été conservés. Aucune régénération inutile n’a été lancée. Le contrôle final indiquera uniquement les pages réellement manquantes.');
          return;
        }
        const failedLabels=[];
        let successCount=0;
        for(let i=0;i<retryIds.length;i++){
          const retryId=retryIds[i];
          const part=activeBlocks().find(x=>String(x.id)===retryId);
          if(!part)continue;
          setStatus('Limite CPU détectée : rendu indépendant du bloc '+(i+1)+'/'+retryIds.length+'…');
          await generateBlock(retryId,{forceSingleBlock:true,skipCpuFallback:true});
          const completed=activeBlocks().find(x=>String(x.id)===retryId);
          if(String(completed?.generation?.status||'').toLowerCase()==='ready'&&String(completed?.generation?.page_url||'').trim()){
            successCount++;
          }else if(completed){
            failedLabels.push(String(completed.content?.title||labelFor(completed)||('bloc '+(i+1))));
          }
        }
        await persistCourse(true,false);
        renderWorkspace();
        if(failedLabels.length){
          setStatus('Reprise bloc par bloc terminée : '+successCount+' bloc(s) confirmé(s). '+failedLabels.length+' bloc(s) restent en échec : '+failedLabels.slice(0,3).join(' · ')+'. La vérification finale reste obligatoire.');
        }else{
          setStatus('Séquence reprise en '+successCount+' rendu(s) indépendant(s) après la limite CPU. La vérification finale contrôle encore chaque bloc avant de déclarer le document complet.');
        }
        return;
      }
      const errorFlow=isFlowCompanion?[b]:renderableFlowBlocksFor(b.id);
      errorFlow.forEach(part=>{
        part.generation={
          ...(part.generation||{}),
          status:'error',
          page_number:pageNumberFor(part),
          updated_at:new Date().toISOString(),
          progress:0,
          progress_label:'Échec',
          error:msg,
          flow_page_owner_id:b.id
        };
      });
      await persistCourse(true);
      renderWorkspace();setStatus('Échec de génération : '+msg);
    }
  }

  function hasFreshAccessToken(token,minLifetimeSeconds=45){
    try{
      const part=String(token||'').split('.')[1];if(!part)return false;
      const payload=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=')));
      return Number(payload.exp)>Math.floor(Date.now()/1000)+minLifetimeSeconds;
    }catch(_){return false;}
  }
  async function freshToken(forceRefresh=false){
    const current=typeof session!=='undefined'?String(session?.access_token||''):'';
    if(!forceRefresh&&hasFreshAccessToken(current,90))return current;
    if(typeof rafraichirSession==='function'&&typeof session!=='undefined'&&session?.refresh_token){
      try{
        const refreshed=await rafraichirSession();
        if(refreshed?.ok&&hasFreshAccessToken(session?.access_token,30))return session.access_token;
        if(!forceRefresh&&refreshed?.transient&&hasFreshAccessToken(current,30))return current;
      }catch(_){
        if(!forceRefresh&&hasFreshAccessToken(current,30))return current;
      }
    }
    const c=client();
    if(c){
      try{
        const s=await c.auth.getSession(),cached=s.data?.session?.access_token;
        if(!forceRefresh&&hasFreshAccessToken(cached,90))return cached;
        const renewal=await c.auth.refreshSession();
        const renewed=renewal.data?.session?.access_token;
        if(!renewal.error&&hasFreshAccessToken(renewed,30))return renewed;
      }catch(_){}
    }
    const fallback=typeof session!=='undefined'?String(session?.access_token||''):'';
    if(hasFreshAccessToken(fallback,30))return fallback;
    throw new Error('Session administrateur expirée ou jeton invalide. Reconnecte-toi puis relance la génération.');
  }

  let wikiInsertAfterId=null;
  let wikiReplaceTargetNext=false;
  let wikiCurrentQuery='';
  let wikiContinuation=null;
  let wikiRequestSequence=0;
  let wikiLoading=false;
  let wikiResultEntries=[];
  let wikiSeenFiles=new Set();

  function wiki(afterId=null,replaceExisting=false){
    const host=prepareAssistedModalHost();if(!host)return;
    if(state.modalViewport)closeAssistedModal();
    wikiInsertAfterId=afterId?String(afterId):null;
    const initialTarget=wikiInsertAfterId?activeBlocks().find(x=>String(x.id)===wikiInsertAfterId):null;
    wikiReplaceTargetNext=Boolean(initialTarget&&initialTarget.type==='wikimedia-image'&&(replaceExisting||!String(initialTarget.content?.imageUrl||'').trim()));
    wikiCurrentQuery='';wikiContinuation=null;wikiRequestSequence=0;wikiLoading=false;wikiResultEntries=[];wikiSeenFiles=new Set();
    host.innerHTML='<div class="ae-modal"><div class="ae-dialog ae-wiki-dialog"><header><div><span class="ae-kicker">Wikimedia Commons</span><h4>Choisir une ou plusieurs images</h4></div><button class="admin-btn ghost" id="aeWikiClose">Fermer</button></header><div class="ae-wiki-search"><input id="aeWikiQ" placeholder="Ex. cellule animale, volcan, Newton…" autocomplete="off"><button class="admin-btn primary" id="aeWikiGo">Rechercher</button></div><div id="aeWikiSelectionStatus" class="ae-wiki-selection-status" aria-live="polite">Lance une recherche, puis ajoute une ou plusieurs images sans fermer cette fenêtre.</div><div id="aeWikiResults" class="ae-wiki-results" aria-live="polite"></div><div id="aeWikiPagination" class="ae-wiki-pagination" hidden><button type="button" class="admin-btn ghost" id="aeWikiLoadMore">Charger plus d’images</button></div></div></div>';
    activateAssistedModal(host);
    document.getElementById('aeWikiClose').onclick=async()=>{
      closeAssistedModal();
      await persistCourse(true,false);
      renderWorkspace();
    };
    document.getElementById('aeWikiGo').onclick=()=>searchWiki(false);
    document.getElementById('aeWikiQ').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchWiki(false)}};
    document.getElementById('aeWikiLoadMore').onclick=()=>searchWiki(true);
    const modal=host.querySelector('.ae-modal');
    modal?.addEventListener('click',e=>{
      if(e.target===modal)void persistCourse(true,false).then(()=>renderWorkspace());
    });
    document.getElementById('aeWikiQ').focus({preventScroll:true});
  }

  function wikiImageFromPage(p,q){
    const i=p?.imageinfo?.[0]||{},m=i.extmetadata||{};
    const license=String(m?.LicenseShortName?.value||m?.UsageTerms?.value||'').replace(/<[^>]+>/g,'').trim();
    const mime=String(i.mime||'').toLowerCase();
    const imageUrl=String(i.url||'');
    const sourceUrl=String(i.descriptionurl||('https://commons.wikimedia.org/wiki/'+encodeURIComponent(p.title||'')));
    if(!imageUrl.startsWith('https://upload.wikimedia.org/')||!['image/jpeg','image/png'].includes(mime)||!license||!sourceUrl||/fair use|non-commercial|no derivatives/i.test(license))return null;
    const title=String(p.title||'').replace(/^File:/,'');
    return {
      imageUrl,thumbUrl:String(i.thumburl||imageUrl),title,
      caption:String(m?.ImageDescription?.value||title).replace(/<[^>]+>/g,'').trim(),
      sourceUrl,
      author:String(m?.Artist?.value||'').replace(/<[^>]+>/g,'').trim(),
      license,query:q
    };
  }

  function renderWikiResults(){
    const out=document.getElementById('aeWikiResults');
    if(!out)return;
    out.innerHTML=wikiResultEntries.map((d,i)=>'<button type="button" class="ae-wiki-card" data-wiki-index="'+i+'" aria-label="Sélectionner '+esc(d.title)+'"><img loading="lazy" src="'+esc(d.thumbUrl)+'" alt=""><span class="ae-wiki-card-copy"><strong>'+esc(d.title)+'</strong><small>'+esc(d.author||'Auteur non renseigné')+'</small><small>'+esc(d.license||'Licence à vérifier')+'</small></span><span class="ae-wiki-card-action">Choisir cette image</span></button>').join('')||'<div class="ae-empty">Aucune image exploitable dans ce lot. Tu peux charger le lot suivant ou reformuler la recherche.</div>';
    out.querySelectorAll('[data-wiki-index]').forEach(btn=>btn.onclick=async()=>{
      if(btn.disabled)return;
      const d=wikiResultEntries[Number(btn.dataset.wikiIndex)];
      if(!d)return;
      let selectedBlock=null;
      const blocks=activeBlocks();
      if(wikiReplaceTargetNext&&wikiInsertAfterId){
        const target=blocks.find(x=>String(x.id)===wikiInsertAfterId);
        if(target&&target.type==='wikimedia-image'){
          target.content=d;selectedBlock=target;
        }
      }
      wikiReplaceTargetNext=false;
      if(!selectedBlock){
        selectedBlock=block('wikimedia-image');selectedBlock.content=d;
        const anchorIndex=wikiInsertAfterId?blocks.findIndex(x=>String(x.id)===wikiInsertAfterId):-1;
        if(anchorIndex>=0)blocks.splice(anchorIndex+1,0,selectedBlock);
        else blocks.push(selectedBlock);
      }
      wikiInsertAfterId=String(selectedBlock.id);
      state.selected=selectedBlock.id;
      validateCourse();
      btn.disabled=true;
      btn.classList.add('is-selected');
      const action=btn.querySelector('.ae-wiki-card-action');
      if(action)action.textContent='Sélectionnée ✓';
      const status=document.getElementById('aeWikiSelectionStatus');
      if(status)status.textContent='Image sélectionnée : '+d.title+'. Tu peux relancer une recherche ou charger davantage d’images.';
      await persistCourse(true,false);
      setStatus('Image Wikimedia sélectionnée et enregistrée.');
    });
  }

  async function searchWiki(loadMore=false){
    const input=document.getElementById('aeWikiQ'),out=document.getElementById('aeWikiResults');
    const q=String(input?.value||'').trim();
    if(!q||!out||wikiLoading)return;
    const reset=!loadMore||q!==wikiCurrentQuery;
    if(reset){
      wikiCurrentQuery=q;wikiContinuation=null;wikiResultEntries=[];wikiSeenFiles=new Set();
      out.scrollTop=0;
    }
    const requestId=++wikiRequestSequence;
    wikiLoading=true;
    const searchBtn=document.getElementById('aeWikiGo'),moreBtn=document.getElementById('aeWikiLoadMore'),status=document.getElementById('aeWikiSelectionStatus');
    if(searchBtn)searchBtn.disabled=true;
    if(moreBtn)moreBtn.disabled=true;
    if(reset)out.innerHTML='<div class="ae-empty">Recherche Wikimedia en cours…</div>';
    if(status)status.textContent=reset?'Recherche de nouvelles images…':'Chargement d’images supplémentaires…';
    try{
      const params=new URLSearchParams({
        action:'query',generator:'search',gsrsearch:q,gsrnamespace:'6',gsrlimit:'50',
        prop:'imageinfo',iiprop:'url|size|mime|thumbmime|extmetadata',iiurlwidth:'520',format:'json'
      });
      if(!reset&&wikiContinuation&&typeof wikiContinuation==='object'){
        Object.entries(wikiContinuation).forEach(([key,value])=>params.set(key,String(value)));
      }
      params.set('origin','*');
      const response=await fetch('https://commons.wikimedia.org/w/api.php?'+params.toString(),{cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const data=await response.json();
      if(requestId!==wikiRequestSequence)return;
      const pages=Object.values(data?.query?.pages||{});
      for(const p of pages){
        const image=wikiImageFromPage(p,q);
        const key=String(p?.title||image?.imageUrl||'');
        if(image&&key&&!wikiSeenFiles.has(key)){wikiSeenFiles.add(key);wikiResultEntries.push(image);}
      }
      wikiContinuation=data?.continue&&typeof data.continue==='object'&&Object.keys(data.continue).length?data.continue:null;
      const previousScroll=reset?0:out.scrollTop;
      renderWikiResults();
      out.scrollTop=previousScroll;
      const pagination=document.getElementById('aeWikiPagination');
      if(pagination)pagination.hidden=!wikiContinuation;
      if(status){
        const count=wikiResultEntries.length;
        status.textContent=count?count+' image(s) disponibles. Tu peux en ajouter plusieurs puis relancer une recherche.':'Aucun résultat compatible pour ce lot.';
      }
      if(!wikiResultEntries.length&&!wikiContinuation)out.innerHTML='<div class="ae-empty">Aucune image JPEG/PNG compatible trouvée. Essaie une requête plus précise.</div>';
    }catch(e){
      if(requestId===wikiRequestSequence){
        out.innerHTML='<div class="ae-empty">Recherche Wikimedia indisponible. Réessaie ou modifie la requête.</div>';
        if(status)status.textContent='Échec de la recherche : '+String(e?.message||e);
      }
    }finally{
      if(requestId===wikiRequestSequence){
        wikiLoading=false;
        if(searchBtn)searchBtn.disabled=false;
        if(moreBtn)moreBtn.disabled=!wikiContinuation;
      }
    }
  }

  // Filet de sécurité global : les boutons système restent actifs même si la carte
  // est reconstruite par l'éditeur ou si un autre binding local échoue.
  document.addEventListener('click',function(e){
    const button=e.target?.closest?.('[data-regenerate-page]');
    if(!button)return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if(button.dataset.regenerating==='true')return;
    const ref=button.dataset.regeneratePage;
    if(!ref){setStatus('Action impossible : identifiant de page absent.');return;}
    button.dataset.regenerating='true';
    button.disabled=true;
    const originalLabel=button.textContent;
    button.textContent='Régénération…';
    setStatus('Clic reçu · lancement de la régénération de '+(ref==='system-start'?'la couverture':ref==='system-end'?'la page finale':ref==='toc'?'du sommaire':'la page')+'…');
    Promise.resolve().then(()=>regeneratePage(ref)).catch(err=>{
      const message=String(err?.message||err||'Erreur inconnue');
      setStatus('La régénération a échoué : '+message);
      if(button.isConnected)button.textContent='Échec · Réessayer';
    }).finally(()=>{
      button.dataset.regenerating='false';
      if(button.isConnected){
        button.disabled=false;
        if(button.textContent==='Régénération…')button.textContent=originalLabel;
      }
    });
  },true);

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
  async function upsertAssistedContentBlock(type,json,existingId){
    if(!state.course?.id)throw new Error('Ouvre un cours avant d’ajouter une fiche ou un schéma.');
    if(!['fiche-revision','vector-scene'].includes(type))throw new Error('Type de bloc assisté non pris en charge.');
    ensureCourseStructure(state.course);
    const next=clone(json&&typeof json==='object'&&!Array.isArray(json)?json:{});
    let b=existingId?activeBlocks().find(x=>String(x?.id||'')===String(existingId)):null;
    if(b&&(isSystemBlock(b)||b.type!==type))b=null;
    const isNew=!b;
    let changed=isNew;
    if(!b){
      b=block(type);
      b.content={json:next};
      const endIndex=activeBlocks().findIndex(x=>x?.role===END_ROLE);
      activeBlocks().splice(endIndex>=0?endIndex:activeBlocks().length,0,b);
    }else{
      changed=JSON.stringify(b.content?.json||{})!==JSON.stringify(next);
      if(changed){
        b.content={...(b.content||{}),json:next};
        b.generation={status:'not_generated',page_number:null,page_path:null,page_url:null,updated_at:null,error:null};
      }
    }
    const selectionChanged=state.selected!==b.id;
    state.selected=b.id;
    ensureCourseStructure(state.course);
    validateCourse();
    if(changed)await persistCourse(true,false);
    if(changed||selectionChanged)renderWorkspace();
    if(isNew)setStatus(type==='fiche-revision'?'Fiche ajoutée à la fin du contenu. La génération va démarrer.':'Schéma vectoriel ajouté à la fin du contenu. La génération va démarrer.');
    return {block_id:String(b.id),type,changed};
  }
  async function generateAssistedContentBlock(id){
    const blockId=String(id||'');
    if(!blockId)throw new Error('Identifiant de bloc absent.');
    if(!activeBlocks().some(x=>String(x?.id||'')===blockId))throw new Error('Le bloc à générer n’existe plus dans ce cours.');
    await generateBlock(blockId);
    const b=activeBlocks().find(x=>String(x?.id||'')===blockId);
    const g=b?.generation||{};
    return {block_id:blockId,type:b?.type||'',status:String(g.status||''),page_url:String(g.page_url||''),page_number:g.page_number||pageNumberFor(b),error:String(g.error||''),generated_document_id:g.generated_document_id||null};
  }
  window.AuroreAssistedEditor={init,render:()=>state.mode==='workspace'?renderWorkspace():renderList,getState:()=>state.course,toContentJson:()=>state.course,upsertAssistedContentBlock,generateAssistedContentBlock};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();