/* Aurore — Édition assistée : atelier séquentiel, sans canevas de prévisualisation */
(function(){
  'use strict';
  const state={mode:'list',course:null,courses:[],selected:null,loading:false,pdfBatchRunning:false,pdfLibPromise:null,modalViewport:null,canonicalPreview:{fingerprint:'',documentId:null,pdfUrl:null}};
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
  function tocPageCount(entriesOverride){
    const configured=Array.isArray(entriesOverride)?entriesOverride:(Array.isArray(state.course?.document_pages?.toc?.entries)?state.course.document_pages.toc.entries:[]);
    const enabled=configured.filter(e=>e&&e.enabled!==false&&String(e.title||'').trim());
    return Math.max(1,Math.ceil(enabled.length/10));
  }
  function pageNumberFor(b,tocPages=tocPageCount()){
    const blocks=activeBlocks();
    if(b?.role===START_ROLE)return 1;
    if(b?.role===END_ROLE)return blocks.length+tocPages;
    const i=blocks.findIndex(x=>x.id===b.id);
    return i<0?null:i+tocPages+1;
  }
  function isRepeatedDefaultIntroduction(b,course=state.course){
    if(!b||isDefaultIntroduction(b))return false;
    const title=String(b?.content?.title||'').trim();
    if(!/^introduction(?:\s|$)/i.test(title))return false;
    const intro=(Array.isArray(course?.blocks)?course.blocks:[]).find(isDefaultIntroduction);
    const introText=String(intro?.content?.text||'').trim();
    return Boolean(introText&&String(b?.content?.text||'').trim()===introText);
  }
  function hasRenderableContent(b){
    if(!b||isSystemBlock(b)||isRepeatedDefaultIntroduction(b))return false;
    const c=b.content&&typeof b.content==='object'?b.content:{};
    const type=String(b.type||'').toLowerCase();
    if(type==='paragraph'||type==='point')return Boolean(String(c.text||'').trim());
    if(type==='exercise')return Boolean(String(c.statement||c.question||'').trim()||String(c.correction||'').trim());
    if(type==='graphique'){
      const g=c.json&&typeof c.json==='object'&&!Array.isArray(c.json)?c.json:{};
      return Boolean(String(g.geogebra_image_path||g.graph_local_path||g.expression||g.equation||g.instrument||'').trim());
    }
    if(type==='wikimedia-image')return String(c.imageUrl||'').startsWith('https://upload.wikimedia.org/');
    return Boolean(String(c.text||c.content||'').trim());
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
      const group=flowBlocksFor(b.id);
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
      const group=flowBlocksFor(b.id);
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

        const standalone=safeGroup.every(part=>{
          const g=part?.generation||{};
          return isReadyPdf(g)&&generationFlowIds(g).length<=1;
        })&&new Set(safeGroup.map(part=>String(part?.generation?.page_url||'').trim())).size===safeGroup.length;
        if(standalone){
          safeGroup.forEach(part=>{
            add(part.generation.page_url,'Page '+String(part.generation.page_number||pageNumberFor(part)));
            covered.add(String(part.id));
          });
          continue;
        }

        missing.push('Séquence « '+String(owner?.content?.title||labelFor(owner))+' » à générer intégralement depuis son premier bloc');
        ids.forEach(id=>covered.add(id));
        continue;
      }

      const g=b?.generation||{};
      const claimedFlowIds=generationFlowIds(g);
      if(isReadyPdf(g)&&claimedFlowIds.length<=1){
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
  function refreshCompleteDownloadButton(){
    const btn=document.getElementById('aeDownloadPdfComplete');
    const note=document.getElementById('aeCompleteDownloadNote');
    if(!btn&&!note)return;
    const readiness=fullPdfReadiness();
    if(btn){
      btn.disabled=!readiness.complete;
      btn.title=readiness.complete
        ?'Assembler et télécharger toutes les pages du document, de la couverture à la page finale.'
        :'Le téléchargement complet sera activé lorsque chaque page et chaque séquence PDF seront prêtes.';
      btn.textContent='Télécharger le document complet';
    }
    if(note){
      note.textContent=readiness.complete
        ?'Toutes les parties sont prêtes. Le téléchargement assemblera les pages physiques de chaque PDF dans l’ordre du document.'
        :'En attente : '+readiness.missing.slice(0,4).join(' · ')+(readiness.missing.length>4?' · et '+(readiness.missing.length-4)+' autre(s) élément(s)':'')+'.';
    }
  }
  async function loadPdfLib(){
    if(globalThis.PDFLib?.PDFDocument)return globalThis.PDFLib;
    if(state.pdfLibPromise)return state.pdfLibPromise;
    state.pdfLibPromise=(async()=>{
      const sources=[
        'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
        'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
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
            const timer=setTimeout(()=>finish(new Error('Délai dépassé pendant le chargement de '+new URL(src).hostname+'.')),12000);
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
  async function downloadCurrentPdf(complete=false){
    const readiness=complete?fullPdfReadiness():null;
    const parts=complete?(readiness?.parts||[]):downloadablePdfParts();
    if(complete&&!readiness?.complete){
      setStatus('Téléchargement complet bloqué : '+(readiness?.missing||['le document n’est pas complet']).slice(0,4).join(' · '));
      refreshDownloadButton();
      return;
    }
    if(!parts.length){setStatus('Aucune page PDF n’est encore prête.');refreshDownloadButton();return;}
    try{
      setStatus(complete?'Vérification et assemblage du document complet…':'Assemblage des pages PDF prêtes…');
      const {PDFDocument}=await loadPdfLib();
      const merged=await PDFDocument.create();
      let physicalPages=0;
      for(let i=0;i<parts.length;i++){
        const p=parts[i];
        setStatus('Assemblage : '+p.label+' ('+(i+1)+'/'+parts.length+')…');
        const response=await fetch(p.url,{cache:'no-store'});
        if(!response.ok)throw new Error('Impossible de récupérer '+p.label+' (HTTP '+response.status+').');
        const source=await PDFDocument.load(await response.arrayBuffer());
        const sourceIndices=source.getPageIndices();
        if(!sourceIndices.length)throw new Error(p.label+' ne contient aucune page PDF.');
        const copied=await merged.copyPages(source,sourceIndices);
        copied.forEach(page=>merged.addPage(page));
        physicalPages+=copied.length;
      }
      if(complete&&physicalPages<parts.length)throw new Error('Le nombre de pages physiques assemblées est incohérent.');
      const bytes=await merged.save();
      const blob=new Blob([bytes],{type:'application/pdf'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      const safeTitle=String(state.course?.title||'aurore-cours').trim().replace(/[^\p{L}\p{N}_-]+/gu,'-')||'aurore-cours';
      a.href=url;a.download=safeTitle+(complete?'-document-complet.pdf':'-etat-actuel.pdf');
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
      setStatus(complete
        ?'Document complet téléchargé · '+physicalPages+' page(s) physique(s).'
        :'Fragments PDF téléchargés · '+physicalPages+' page(s) physique(s) disponibles.');
    }catch(e){
      setStatus('Échec du téléchargement : '+String(e?.message||e));
    }
  }

  async function regenerateAllOptimizedPdfs(){
    if(state.pdfBatchRunning||!state.course)return;
    state.pdfBatchRunning=true;
    renderWorkspace();
    const failures=[];
    try{
      await persistCourse(true,false);
      if(!canonicalPreviewIsFresh()){
        try{await prepareSystemPreview({force:false});}
        catch(e){failures.push('Pages système : '+String(e?.message||e));}
      }
      const targets=[],seen=new Set();
      for(const b of contentBlocks()){
        const id=String(b?.id||'');
        if(!id||seen.has(id)||!hasRenderableContent(b))continue;
        const group=flowBlocksFor(id);
        const owner=group[0]||b;
        if(group.length>1){
          group.forEach(part=>seen.add(String(part?.id||'')));
          if(String(owner.id)===id)targets.push(owner);
        }else{
          seen.add(id);
          targets.push(b);
        }
      }
      for(let i=0;i<targets.length;i++){
        const targetId=String(targets[i]?.id||'');
        const b=activeBlocks().find(x=>String(x?.id||'')===targetId);
        if(!b||!hasRenderableContent(b))continue;
        setStatus('Régénération optimisée '+(i+1)+'/'+targets.length+' : '+String(b.content?.title||labelFor(b))+'…');
        await generateBlock(b.id);
        const updated=activeBlocks().find(x=>String(x?.id||'')===targetId);
        if(String(updated?.generation?.status||'').toLowerCase()!=='ready'||!String(updated?.generation?.page_url||'').trim()){
          failures.push(String(b.content?.title||labelFor(b)));
        }
      }
      if(failures.length){
        setStatus('Optimisation partielle : éléments à vérifier — '+failures.slice(0,4).join(' · ')+(failures.length>4?' · et '+(failures.length-4)+' autre(s)':''));
      }else{
        setStatus('Tous les PDF de contenu ont été régénérés avec compression optimisée. Télécharge maintenant le document complet.');
      }
    }catch(e){
      setStatus('Échec de la régénération optimisée : '+String(e?.message||e));
    }finally{
      state.pdfBatchRunning=false;
      renderWorkspace();
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
      // Dans l’éditeur assisté, le corrigé dépend de l’exercice et doit être
      // présent avant de déclarer la génération complète.
      if(String(b.content?.statement||'').trim()&&!String(b.content?.correction||'').trim()){
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
    const all=contentBlocks().filter(hasRenderableContent);
    const managed=all.filter(b=>String(b?.toc_entry_id||'').trim());
    const managedSet=new Set(managed);
    const source=managed.length?all.filter(b=>isDefaultIntroduction(b)||managedSet.has(b)):all;
    const pending=source.map(b=>{
      const key=String(b?.toc_entry_id||b.id||'');
      const old=byId.get(key)||byId.get(String(b.id))||{};
      return {block:b,entry:{
        id:String(b?.toc_entry_id||old.id||b.id),
        title:String(b.content?.title||old.title||labelFor(b)),
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

  function labelFor(b){return b.type==='paragraph'?'Paragraphe':b.type==='point'?'Point de cours':b.type==='exercise'?'Exercice':b.type==='graphique'?'Graphique GeoGebra':'Image Wikimedia'}
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
    if(b.type==='graphique')editor='<textarea class="ae-inline-json" data-edit-json="'+esc(b.id)+'" aria-label="JSON du graphique">'+esc(JSON.stringify(b.content?.json||{},null,2))+'</textarea>';
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
      '<div class="ae-block-result">'+(gen.status==='ready'&&gen.page_url?'<span class="ae-generated-ok">✓ Page '+page+' générée seule</span><button class="admin-btn ghost" data-preview-block="'+esc(b.id)+'">Visualiser</button><button type="button" class="admin-btn ghost" data-download-block="'+esc(b.id)+'">Télécharger</button>':gen.status==='generating'?'<div class="ae-generation-progress" role="status" aria-live="polite"><div class="ae-generation-progress-top"><span data-progress-label>'+esc(gen.progress_label||'Génération de la page…')+'</span><strong data-progress-pct>'+Math.round(Number(gen.progress||8))+'%</strong></div><div class="ae-progress-track"><span data-progress-bar style="width:'+Math.max(8,Math.min(100,Number(gen.progress||8)))+'%"></span></div><small>Progression indicative · la page est en cours de génération.</small></div>':gen.status==='error'?'<span class="ae-generated-error">Erreur : '+esc(gen.error||'génération impossible')+'</span>':b.type==='graphique'&&v.ok?'<span>JSON validé · la construction graphique reste destinée au moteur GeoGebra/LuaLaTeX.</span>':'<span>Aucune page générée pour ce bloc.</span>')+'</div>'+
      (v.errors.length?'<div class="ae-block-errors">'+v.errors.map(x=>'• '+esc(x)).join('<br>')+'</div>':'')+
      '<div class="ae-inline-add-row"><label class="ae-inline-add-select"><span>Ajouter sous ce bloc</span><select data-insert-after="'+esc(b.id)+'"><option value="">Sélectionner…</option><option value="paragraph">Paragraphe</option><option value="point">Point de cours</option><option value="exercise">Exercice</option><option value="graphique">Graphique GeoGebra</option><option value="wikimedia-image">Image</option></select></label></div>'+
      '</article>';
  }

  function renderWorkspace(){
    const r=root();if(!r||!state.course)return;
    const previousModalHost=document.getElementById('aeModalHost');
    if(previousModalHost){closeAssistedModal();previousModalHost.remove();}
    validateCourse();
    ensureCourseStructure(state.course);
    r.innerHTML='<div class="ae-shell ae-workspace"><header class="ae-head"><div><button class="admin-btn ghost" id="aeBack">← Mes cours</button><button class="admin-btn danger" id="aeDeleteCourseInside">Supprimer ce cours</button><span class="ae-kicker">Atelier de production séquentielle</span><h3><input id="aeCourseTitle" value="'+esc(state.course.title)+'"></h3><p>Le bloc de début, le sommaire et le bloc de fin sont automatiques. Chaque bloc central génère uniquement son propre fragment PDF indépendant.</p></div><span class="ae-status" id="assistedStatus">'+(state.course.validation?.ok?'Structure valide':'À compléter')+'</span></header>'+
      '<div class="ae-top-options"><div class="ae-top-options-title"><span class="ae-kicker">Options du document</span><strong>Couleur d’accent</strong><small>Elle sera utilisée pour les bordures, repères et éléments mathématiques de la page.</small></div><label class="ae-color-field"><span class="ae-color-swatch" style="background:'+normalizeThemeColor(state.course.theme_color)+'"></span><select id="aeThemeColor" aria-label="Couleur d’accent du document">'+themeColorOptions()+'</select></label></div>'+
      '<div class="ae-workbar"><button class="admin-btn primary" id="aeAddP">＋ Paragraphe</button><button class="admin-btn ghost" id="aeAddPoint">＋ Point de cours</button><button class="admin-btn ghost" id="aeAddEx">＋ Exercice</button><button class="admin-btn ghost" id="aeAddGraph">＋ Graphique GeoGebra</button><button class="admin-btn ghost" id="aeAddWiki">＋ Image Wikimedia</button><button class="admin-btn ghost" id="aeTocJson">Sommaire JSON</button><button class="admin-btn ghost" id="aeSave">Enregistrer le cours</button><button class="admin-btn primary" id="aeDownloadPdfCurrent" disabled>Télécharger le PDF actuel</button></div>'+
      '<div class="ae-sequence-meta"><span>'+contentBlocks().length+' bloc(s) de contenu · 1 début · 1 fin</span><span id="aeSystemPreviewOverall">Pages système indépendantes : '+systemPreviewOverallFromPages(state.canonicalPreview?.pages||{}).ready+'/3 prêtes · '+systemPreviewOverallFromPages(state.canonicalPreview?.pages||{}).progress+'%</span></div>'+
      '<section class="ae-block-stack">'+(activeBlocks().find(b=>b?.role===START_ROLE)?blockCard(activeBlocks().find(b=>b?.role===START_ROLE),0):'')+tocSystemCard()+(contentBlocks().length?contentBlocks().map((b,i)=>blockCard(b,i+2)).join(''):'<div class="ae-empty"><strong>Le cours est vide.</strong><span>Ajoute un paragraphe pour commencer. La couverture et le sommaire resteront toujours présents.</span></div>')+(activeBlocks().find(b=>b?.role===END_ROLE)?blockCard(activeBlocks().find(b=>b?.role===END_ROLE),activeBlocks().length-1):'')+'</section>'+
      '<div class="ae-workbar ae-complete-download"><div style="display:grid;gap:4px;flex:1;min-width:220px"><strong>Document final</strong><small id="aeCompleteDownloadNote" style="opacity:.68;line-height:1.4">Le téléchargement complet s’active lorsque toutes les pages sont prêtes. Les anciens fragments gardent leur taille jusqu’à leur régénération.</small></div><button class="admin-btn ghost" id="aeOptimizeAllPdf"'+(state.pdfBatchRunning?' disabled':'')+'>Régénérer tous les PDF (optimisés)</button><button class="admin-btn primary" id="aeDownloadPdfComplete" disabled>Télécharger le document complet</button></div>'+
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
    await generateBlock(ref);
  }

  async function blockDownloadPartsThrough(targetBlock,mode='current'){
    const requestedTargetPage=Number(pageNumberFor(targetBlock));
    const parts=[],seenPages=new Set();
    const blocks=activeBlocks();
    const byId=new Map(blocks.map(b=>[String(b.id),b]));
    const isReady=g=>String(g?.status||'').toLowerCase()==='ready'&&!!String(g?.page_url||'').trim();

    // Quand un bloc a été régénéré seul, le PDF de flux du segment peut déjà
    // contenir ce même bloc. Pour un assemblage « pages précédentes », on doit
    // garder le flux canonique et non juxtaposer son extrait puis son doublon isolé.
    const targetSegment=flowSegmentFor(targetBlock.id);
    const targetSegmentIds=new Set(targetSegment.map(b=>String(b?.id||'')));
    const flowOwner=targetSegment[0]||targetBlock;
    const flowOwnerGeneration=flowOwner?.generation||{};
    let preferCanonicalFlow=mode==='previous'
      &&targetSegment.length>1
      &&String(flowOwner.id)!==String(targetBlock.id)
      &&isReady(flowOwnerGeneration)
      &&flowOwnerGeneration.independent_regeneration!==true
      &&generationCoversThrough(flowOwnerGeneration,targetSegment,targetBlock.id);
    let canonicalFlowPageCount=0;
    if(preferCanonicalFlow){
      try{canonicalFlowPageCount=await assistedPdfPageCount(flowOwnerGeneration.page_url)}catch(_){canonicalFlowPageCount=0}
      // Si PDF.js est momentanément indisponible, ne pas revenir au PDF
      // autonome du bloc cible : c'est la cause du chapitre qui recommence.
      // Estimer les pages physiques nécessaires jusqu'à la page logique demandée.
      if(!Number.isInteger(canonicalFlowPageCount)||canonicalFlowPageCount<1){
        canonicalFlowPageCount=Math.max(1,requestedTargetPage-Number(pageNumberFor(flowOwner))+1);
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
        // Insérer toutes les pages physiques du flux une seule fois au niveau
        // de son propriétaire. Les PDF isolés des blocs compagnons sont ignorés.
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
      // En mode « page actuelle », un bloc régénéré seul doit garder son PDF
      // de travail. Le mode « pages précédentes » préfère le flux canonique.
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
      const ownerReady=isReady(ownerGeneration)
        &&ownerGeneration.independent_regeneration!==true
        &&generationContainsBlock(ownerGeneration,b.id);

      if(String(b.id)===String(targetBlock.id)&&g.independent_regeneration===true){
        add(g.page_url,'Page '+n,n,1);
        continue;
      }

      if(ownerId&&ownerReady){
        const ownerPage=Number(pageNumberFor(owner));
        add(ownerGeneration.page_url,'Page '+n,n,Math.max(1,n-ownerPage+1));
        continue;
      }

      if(g.independent_regeneration===true||!ownerId){
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
    const targetPage=preferCanonicalFlow&&parts.length
      ?Math.max(...parts.map(x=>Number(x.pageNumber)||0))
      :requestedTargetPage;
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

  async function askBlockDownloadChoice(block){
    let overlay=document.getElementById('aeBlockDownloadChoiceOverlay');
    if(!overlay){
      initBlockDownloadChoice();
      overlay=document.getElementById('aeBlockDownloadChoiceOverlay');
    }
    if(!overlay)return Promise.resolve(null);

    const target=await blockDownloadPartsThrough(block);
    const current=target.targetPage;
    const previousReady=current>1&&target.parts.some(x=>x.pageNumber<current);
    const currentReady=target.parts.some(x=>x.pageNumber===current);

    const currentBtn=overlay.querySelector('[data-ae-download-mode="current"]');
    const previousBtn=overlay.querySelector('[data-ae-download-mode="previous"]');
    const currentLabel=overlay.querySelector('[data-ae-download-current-label]');
    const previousLabel=overlay.querySelector('[data-ae-download-previous-label]');
    const description=overlay.querySelector('[data-ae-download-description]');

    if(currentLabel)currentLabel.textContent='Page '+current+' uniquement';
    if(previousLabel)previousLabel.textContent='Pages 1 à '+current;
    if(currentBtn)currentBtn.disabled=!currentReady;
    if(previousBtn)previousBtn.disabled=current<=1||!currentReady;
    if(description){
      description.textContent=current<=1
        ? 'Ce bloc est sur la première page disponible.'
        : previousReady
          ? 'Les pages PDF disponibles jusqu’à ce bloc seront réunies dans l’ordre.'
          : 'Aucune page précédente n’est prête : génère les blocs précédents pour les inclure.';
    }
    // Garder la page à sa position : pas de verrouillage du body ni de focus automatique,
    // qui peuvent provoquer un défilement brutal sur certains navigateurs mobiles.
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
            <div class="ae-block-download-choice-kicker">Téléchargement</div>
            <h3>Que souhaitez-vous télécharger ?</h3>
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
    const optimizeAllBtn=document.getElementById('aeOptimizeAllPdf');
    if(optimizeAllBtn)optimizeAllBtn.onclick=()=>void regenerateAllOptimizedPdfs();
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
    root().querySelectorAll('[data-edit-json]').forEach(el=>el.onchange=()=>{
      const b=activeBlocks().find(x=>x.id===el.dataset.editJson);if(!b)return;
      try{
        b.content=normalizeContent('graphique',JSON.parse(el.value));
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
      }catch(_){b.jsonEditorInvalid=true;setStatus('JSON graphique invalide. Corrige-le avant de générer la page.');}
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
    const b=block(type),blocks=activeBlocks(),endIndex=blocks.findIndex(x=>x.role===END_ROLE);
    if(endIndex<0)blocks.push(systemBlock(END_ROLE,state.course.title));
    const idx=Math.max(0,blocks.findIndex(x=>x.role===END_ROLE));
    blocks.splice(idx,0,b);state.selected=b.id;validateCourse();renderWorkspace();setStatus('Bloc ajouté au milieu du document, avant la page de fin.');
  }
  async function insertBlockAfter(id,type){
    ensureCourseStructure(state.course);
    const blocks=activeBlocks(),idx=blocks.findIndex(x=>x.id===id),source=idx>=0?blocks[idx]:null;
    if(!source||isSystemBlock(source))return;
    if(!['paragraph','point','exercise','graphique','wikimedia-image'].includes(type))return;
    const b=block(type);
    blocks.splice(idx+1,0,b);
    state.selected=b.id;
    validateCourse();
    renderWorkspace();
    setStatus(type==='wikimedia-image'?'Image insérée : sélectionne maintenant son illustration.':type==='graphique'?'Graphique GeoGebra inséré : renseigne ou colle son JSON GeoGebra.':type==='exercise'?'Exercice inséré sous le bloc sélectionné.':type==='point'?'Point de cours inséré sous le bloc sélectionné.':'Paragraphe inséré sous le bloc sélectionné.');
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
    const token=(typeof session!=='undefined'&&session?.access_token)||await freshToken();
    const r=await fetch(SUPABASE_URL+'/functions/v1/aurora-assisted-system-page',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':SUPABASE_ANON_KEY},body:JSON.stringify({mode:'status',generated_document_id:Number(documentId)})});
    const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch(_){d={error:t}};if(!r.ok||!d.ok)throw new Error(d.error||('Statut page système HTTP '+r.status));return d;
  }
  async function requestIndependentSystemPage(kind,{force=false}={}){
    ensureDocumentPages(state.course);
    const fp=systemPageFingerprint(kind),current=state.canonicalPreview?.pages?.[kind]||emptySystemPageState();
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
      setSystemPageState(kind,{status:'ready',progress:100,stage:'PDF de page prêt',pdfUrl,fingerprint:fp,error:null},{persist:true});
      return d;
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

  async function progressivePreviewBlock(id){
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
          allSteps.push({kind:'pdf',label:'Page '+String(pageNumberFor(blockFlowOwner))+' · flux assisté',url:flowUrl,number:pageNumberFor(blockFlowOwner),status:'ready',source:blockFlowOwner});
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

    const currentPage=pageNumberFor(current),currentUrl=String(current?.generation?.page_url||'').trim();
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
      const isFlow=generationHasFlow(step.source?.generation);
      const limit=isFlow?Math.min(count,Math.max(1,currentPage-base+1)):Math.min(count,1);
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
    allSteps.length=0;
    allSteps.push(...expandedSteps);

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
    setStatus('Prévisualisation progressive prête : pages antérieures + bloc actuel.');
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
    if(b.type==='graphique'&&!String(b.generation?.page_url||'').trim()){
      await previewGraphBlock(id);
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

  function isAssistedFlowableBlock(b){
    if(!b||isSystemBlock(b)||isDefaultIntroduction(b)||isRepeatedDefaultIntroduction(b))return false;
    const type=String(b.type||'').toLowerCase();
    const content=b.content&&typeof b.content==='object'?b.content:{};
    if(type==='paragraph'||type==='point')return Boolean(String(content.text||'').trim());
    if(type==='graphique'){
      const graph=content.json&&typeof content.json==='object'&&!Array.isArray(content.json)?content.json:{};
      // Le PNG peut encore manquer : la génération du flux le prépare avant le rendu.
      return Boolean(String(graph.id||'').trim()&&String(graph.instrument||graph.graph_type||'').trim());
    }
    if(type==='wikimedia-image'){
      return String(content.imageUrl||'').startsWith('https://upload.wikimedia.org/')
        &&Boolean(String(content.license||'').trim())
        &&String(content.sourceUrl||'').startsWith('https://commons.wikimedia.org/');
    }
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
    // Paragraphs, points, images et graphiques forment un flux vertical ordonné.
    // Les exercices et les blocs système continuent à le séparer.
    if(!isAssistedFlowableBlock(current))return [current];
    let start=index;
    while(start>0&&isAssistedFlowableBlock(all[start-1]))start--;
    let end=index;
    while(end<all.length-1&&isAssistedFlowableBlock(all[end+1]))end++;
    return all.slice(start,end+1);
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
    if(b.type==='graphique'&&b.jsonEditorInvalid){setStatus('JSON graphique invalide. Corrige-le avant de générer la page.');return;}
    const v=validateBlock(b);if(!v.ok){renderWorkspace();setStatus('Bloc invalide : corrige les éléments signalés.');return;}

    // Un seul bloc propriétaire génère un flux contigu. Cliquer un bloc compagnon
    // ne recrée jamais le même PDF : on réutilise le propriétaire du flux.
    const flowGroup=flowBlocksFor(b.id);
    const flowOwner=flowGroup[0]||b;
    const isFlowCompanion=flowGroup.length>1&&flowOwner.id!==b.id;
    if(isFlowCompanion){
      const ownerGeneration=flowOwner.generation||{};
      if(String(ownerGeneration.status||'').toLowerCase()==='generating'){
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
      const token=(typeof session!=='undefined'&&session?.access_token)||await freshToken();
      if(!token)throw new Error('Session administrateur absente.');
      const graphBlocksToPrepare=(isFlowCompanion?[b]:flowBlocksFor(b.id))
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
      const r=await fetch(SUPABASE_URL+'/functions/v1/aurora-assisted-page-v2',{
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
      const errorFlow=isFlowCompanion?[b]:flowBlocksFor(b.id);
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

  async function freshToken(){
    if(typeof rafraichirSession==='function'&&typeof session!=='undefined'&&session?.refresh_token){try{if(await rafraichirSession())return session.access_token}catch(_){}}
    const c=client();if(!c)throw new Error('Session indisponible.');
    const s=await c.auth.getSession();if(s.data?.session?.access_token)return s.data.session.access_token;
    throw new Error('Session administrateur expirée.');
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
  window.AuroreAssistedEditor={init,render:()=>state.mode==='workspace'?renderWorkspace():renderList,getState:()=>state.course,toContentJson:()=>state.course};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();