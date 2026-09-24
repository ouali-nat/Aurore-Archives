
(function(){
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = v => {
    const d=document.createElement('div');
    d.textContent=String(v==null?'':v);
    return d.innerHTML;
  };
  const supa = () => typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '';
  const anon = () => typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';

  const stages = [
    ['source','Source Supabase'],
    ['latex','Délimiteurs LaTeX'],
    ['html','HTML avant MathJax'],
    ['mathjax','MathJax + SVG'],
    ['pdf','PDF existant'],
    ['chromium','Chromium / Gotenberg'],
    ['geogebra','Images GeoGebra'],
    ['conclusion','Conclusion']
  ];

  let report = {};
  let running = false;

  function setStatus(text,state){
    const el=$('aurorePdfLabStatus');
    if(el){
      el.textContent=text;
      el.dataset.state=state||'pending';
    }
  }

  function renderStages(){
    const host=$('aurorePdfLabStages');
    if(!host)return;
    host.innerHTML=stages.map(([key,label])=>{
      const r=report[key]||{state:'pending',message:'Non testé.'};
      return '<article class="aurore-pdf-lab-stage" data-state="'+esc(r.state)+'">'+
        '<div class="aurore-pdf-lab-stage-head"><strong>'+esc(label)+'</strong><span>'+esc(r.state==='ok'?'OK':r.state==='warn'?'À vérifier':r.state==='fail'?'Échec':'Non testé')+'</span></div>'+
        '<p>'+esc(r.message||'')+'</p>'+
        (r.detail?'<details><summary>Détails</summary><pre>'+esc(r.detail)+'</pre></details>':'')+
      '</article>';
    }).join('');
  }

  function setStage(key,state,message,detail){
    report[key]={state,message,detail:detail||''};
    renderStages();
  }

  function log(msg){
    const p=$('aurorePdfLabReport');
    if(p) p.textContent=JSON.stringify(report,null,2);
  }

  async function auth(){
    if(typeof assurerClientAuthGoogle==='function'){
      const c=await assurerClientAuthGoogle();
      if(c){
        const s=await c.auth.getSession();
        if(!s.error && s.data?.session?.access_token)return s.data.session;
      }
    }
    if(typeof session!=='undefined' && session?.access_token){
      return {access_token:session.access_token,user:{id:session.id,email:session.email}};
    }
    throw new Error('Aucune session Supabase active.');
  }

  async function readJson(res){
    const text=await res.text();
    let data=null;
    try{data=text?JSON.parse(text):null}catch(_){}
    return {status:res.status,ok:res.ok,text,data};
  }

    function normalizeSource(value){
    return String(value??'')
      .replace(/\$\$([\s\S]*?)\$\$/g,'\\[$1\\]')
      .replace(/\$([^$\n]+)\$/g,'\\($1\\)');
  }
  function inspectLatex(value){
    const raw=String(value??'');
    const dollars=(raw.match(/\$\$/g)||[]).length;
    const singles=(raw.match(/(^|[^$])\$([^$\n]+)\$/g)||[]).length;
    const displayOpen=(raw.match(/\\\[/g)||[]).length;
    const displayClose=(raw.match(/\\\]/g)||[]).length;
    const inlineOpen=(raw.match(/\\\(/g)||[]).length;
    const inlineClose=(raw.match(/\\\)/g)||[]).length;
    const unclosed=(dollars%2)!==0 || displayOpen!==displayClose || inlineOpen!==inlineClose;
    return {
      dollars,
      display:displayOpen,
      displayEnd:displayClose,
      inline:inlineOpen,
      inlineEnd:inlineClose,
      singleMathPairs:singles,
      balanced:!unclosed
    };
  }
  function collectTextAndMath(content){
    const chunks=[];
    const push=v=>{if(typeof v==='string' && v.trim())chunks.push(v);};
    const walk=v=>{
      if(typeof v==='string'){push(v);return;}
      if(Array.isArray(v)){v.forEach(walk);return;}
      if(v&&typeof v==='object'){
        ['introduction','objective','formula','title','question','hint','solution'].forEach(k=>{
          if(typeof v[k]==='string')push(v[k]);
        });
        Object.keys(v).forEach(k=>{
          if(!['introduction','objective','formula','title','question','hint','solution'].includes(k))walk(v[k]);
        });
      }
    };
    walk(content||{});
    return chunks;
  }

  function escapeHtml(s){
    return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function inlineMathHtml(s){
    return escapeHtml(normalizeSource(s));
  }


  function buildTestHtml(doc){
    const q=doc?.content_json&&typeof doc.content_json==='object'?doc.content_json:{};
    const texts=collectTextAndMath(q);
    const body=texts.slice(0,30).map((x,i)=>'<p data-lab-index="'+i+'">'+inlineMathHtml(x)+'</p>').join('');
    const mathJaxConfig=JSON.stringify({
      tex:{
        inlineMath:[['\\\\(','\\\\)'],['$','$']],
        displayMath:[['\\\\[','\\\\]'],['$$','$$']]
      },
      svg:{fontCache:'global'}
    });
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Aurore PDF Lab</title>'+
      '<style>body{font-family:Arial,"Noto Sans",sans-serif;color:#17221b;font-size:11pt;line-height:1.5;margin:18mm}p{margin:0 0 4mm}.formula{text-align:center;margin:5mm 0}</style>'+
      '<script>window.__AURORE_MATHJAX_STATUS="loading";window.MathJax='+mathJaxConfig+';</script>'+
      '<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script></head><body>'+
      '<h1>'+escapeHtml(q.title||doc?.title||'Document pédagogique')+'</h1><main>'+body+'</main>'+
      '<div id="aurore-mathjax-sentinel" aria-hidden="true"></div>'+
      '<script>(async()=>{try{if(!window.MathJax)throw new Error("MathJax global absent.");await MathJax.startup.promise;await MathJax.typesetPromise(document.body);if(document.fonts?.ready)await document.fonts.ready;document.documentElement.setAttribute("data-mathjax-ready","true");window.__AURORE_MATHJAX_STATUS="ready";}catch(e){window.__AURORE_MATHJAX_STATUS="error:"+String(e&&e.message||e);}})();</script>'+
      '</body></html>';
  }

  async function testMathJax(html){
    const frame=document.createElement('iframe');
    frame.setAttribute('aria-hidden','true');
    frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;opacity:0;pointer-events:none;border:0;';
    document.body.appendChild(frame);
    try{
      const fdoc=frame.contentDocument;
      const fwin=frame.contentWindow;
      if(!fdoc||!fwin)throw new Error('Document iframe inaccessible.');
      fdoc.open();fdoc.write(html);fdoc.close();
      const started=performance.now();
      let lastStatus='';
      while(performance.now()-started<20000){
        await new Promise(r=>setTimeout(r,100));
        lastStatus=String(fwin.__AURORE_MATHJAX_STATUS||'');
        if(lastStatus.startsWith('error:'))throw new Error(lastStatus.slice(6));
        if(lastStatus==='ready')break;
      }
      const status=String(fwin.__AURORE_MATHJAX_STATUS||'');
      const root=fdoc.documentElement;
      const body=fdoc.body;
      const svgCount=body?body.querySelectorAll('mjx-container svg').length:0;
      const mathCount=body?body.querySelectorAll('mjx-container').length:0;
      const sentinel=!!fdoc.getElementById('aurore-mathjax-sentinel');
      const bodyText=body?.textContent||'';
      const remainingLatex=['\\\\[','\\\\(','\\\\]','\\\\)'].some(token=>bodyText.includes(token));
      if(status!=='ready'){
        return {state:'fail',message:'MathJax n’a pas terminé son rendu dans le délai de 20 s.',detail:'status='+status+'; dernier_status='+lastStatus+'; svg='+svgCount+'; containers='+mathCount};
      }
      if(!root||root.getAttribute('data-mathjax-ready')!=='true'){
        return {state:'fail',message:'MathJax a signalé la fin du rendu mais le marqueur de fin est absent.',detail:'status='+status+'; sentinel='+sentinel+'; svg='+svgCount+'; containers='+mathCount};
      }
      if(mathCount===0){
        return {state:'fail',message:'MathJax est chargé mais aucune expression n’a été transformée en conteneur mathématique.',detail:'svg='+svgCount+'; containers='+mathCount+'; remainingLatex='+remainingLatex};
      }
      return {state:'ok',message:'MathJax a terminé et le DOM contient '+svgCount+' SVG mathématiques.',detail:'status='+status+'; svg='+svgCount+'; containers='+mathCount+'; remainingLatex='+remainingLatex};
    }finally{
      frame.remove();
    }
  }

  async function run(){
    if(running)return;
    running=true;
    report={};
    renderStages();
    setStatus('Analyse en cours…','pending');

    try{
      const id=Math.max(1,Number($('aurorePdfLabId')?.value||21));
      if(!Number.isFinite(id))throw new Error('Document ID invalide.');
      const s=await auth();
      const token=s.access_token;
      if(!token)throw new Error('JWT utilisateur absent.');

      const headers={'apikey':anon(),'Authorization':'Bearer '+token};

      const url=supa()+'/rest/v1/aurora_generated_documents?select=id,title,status,pdf_path,pdf_url,content_json,metadata,pdf_diagnostic,updated_at&id=eq.'+encodeURIComponent(id);
      const res=await fetch(url,{headers,cache:'no-store'});
      const x=await readJson(res);
      if(!x.ok)throw new Error('Supabase HTTP '+x.status+': '+(x.text||''));
      const doc=Array.isArray(x.data)?x.data[0]:null;
      if(!doc)throw new Error('Document #'+id+' introuvable.');

      $('aurorePdfLabPath').textContent='Document #'+id+' — '+(doc.title||'sans titre');

      const content=doc.content_json&&typeof doc.content_json==='object'?doc.content_json:{};
      const chunks=collectTextAndMath(content);
      const sample=chunks.join('\n');
      const latex=inspectLatex(sample);
      setStage('source','ok','Source Supabase lue sans modification.',JSON.stringify({
        id:doc.id,title:doc.title,status:doc.status,sections:Array.isArray(content.sections)?content.sections.length:0,
        pdf_path:doc.pdf_path||null,pdf_url:!!doc.pdf_url,content_keys:Object.keys(content)
      },null,2));

      setStage('latex',latex.balanced?'ok':'fail',
        latex.balanced?'Les délimiteurs LaTeX détectés sont équilibrés.':'Délimiteurs LaTeX déséquilibrés détectés.',
        JSON.stringify(latex,null,2));

      const html=buildTestHtml(doc);
      setStage('html','ok','HTML de test construit avant MathJax.',html.slice(0,12000));

      try{
        const m=await testMathJax(html);
        setStage('mathjax',m.state,m.message,m.detail);
      }catch(e){
        setStage('mathjax','fail','Le test MathJax réel dans iframe a échoué.',String(e?.message||e));
      }

      let pdfState='warn',pdfMessage='Aucune référence PDF enregistrée.',pdfDetail=JSON.stringify({
        pdf_path:doc.pdf_path||null,pdf_url:doc.pdf_url||null
      },null,2);

      if(doc.pdf_url){
        try{
          const pr=await fetch(doc.pdf_url,{method:'GET',headers:{Range:'bytes=0-15'},cache:'no-store'});
          const buf=await pr.arrayBuffer();
          const bytes=new Uint8Array(buf);
          const signature=String.fromCharCode(...bytes.slice(0,4));
          const len=Number(pr.headers.get('content-length')||buf.byteLength||0);
          if(signature==='%PDF' || (pr.status===206 && signature==='%PDF')){
            pdfState='ok';
            pdfMessage='PDF existant accessible et sa signature commence par %PDF.';
            pdfDetail='HTTP '+pr.status+'; bytes_lus='+buf.byteLength+'; content-length='+len+'; signature='+signature;
          }else{
            pdfState='fail';
            pdfMessage='Une URL PDF existe mais la réponse ne commence pas par %PDF.';
            pdfDetail='HTTP '+pr.status+'; bytes_lus='+buf.byteLength+'; signature='+signature;
          }
        }catch(e){
          pdfMessage='Référence PDF présente mais lecture réseau non vérifiable depuis le navigateur.';
          pdfDetail=String(e?.message||e);
        }
      }
      setStage('pdf',pdfState,pdfMessage,pdfDetail);

      setStage('chromium','warn',
        'Non câblé côté navigateur : le rendu Chromium/Gotenberg de production exige le secret serveur PDF_SERVICE_TOKEN/GOTENBERG_TOKEN.',
        'Aucun secret n’est exposé ni envoyé par ce laboratoire. La fonction de production reste inchangée.');

      let graphCount=0;
      const walkGraphs=v=>{
        if(Array.isArray(v)){v.forEach(walkGraphs);return;}
        if(v&&typeof v==='object'){
          if(Array.isArray(v.graphs))graphCount+=v.graphs.length;
          Object.keys(v).forEach(k=>walkGraphs(v[k]));
        }
      };
      walkGraphs(content);
      setStage('geogebra',graphCount
        ?'warn':'ok',
        graphCount
          ? graphCount+' graphique(s) GeoGebra référencé(s), mais les URL signées ne sont pas générées côté navigateur.'
          :'Aucun graphique GeoGebra référencé dans le contenu.',
        graphCount
          ?'La vérification live des images est volontairement non câblée : les URL signées Storage doivent être générées côté serveur.'
          :'Aucun chemin GeoGebra à tester.');

      const failed=Object.values(report).filter(r=>r.state==='fail').length;
      const warnings=Object.values(report).filter(r=>r.state==='warn').length;
      const conclusion=failed
        ? 'Le laboratoire a trouvé au moins un point bloquant reproductible. Consultez les détails de l’étape en échec.'
        : warnings
          ? 'La chaîne locale Source → LaTeX → HTML → MathJax est exploitable, mais certaines étapes serveur restent volontairement non câblées.'
          : 'Les contrôles disponibles dans le navigateur sont passés.';
      setStage('conclusion',failed?'fail':warnings?'warn':'ok',conclusion,
        JSON.stringify({document_id:id,failed,warnings,generated_at:new Date().toISOString()},null,2));

      log();
      setStatus(failed?'Blocage détecté':warnings?'Analyse terminée — partielle':'Analyse terminée',''+(failed?'fail':warnings?'warn':'ok'));
    }catch(e){
      setStage('conclusion','fail','Analyse interrompue avant la fin.',String(e?.message||e));
      setStatus('Échec de l’analyse','fail');
      log();
    }finally{
      running=false;
    }
  }

  function openPdf(){
    const id=Math.max(1,Number($('aurorePdfLabId')?.value||21));
    if(typeof ouvrirLecteurPDF==='function'){
      ouvrirLecteurPDF(id);
      return;
    }
    const u=$('aurorePdfLabPath')?.dataset?.pdfUrl;
    if(u)window.open(u,'_blank','noopener');
  }

  function exportReport(){
    const payload={generated_at:new Date().toISOString(),report};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='aurore-pdf-lab-rapport.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  // Délégation de clic : le laboratoire reste fonctionnel même si le panneau admin
  // est initialisé après le chargement du script ou si le routeur reconstruit son contenu.
  document.addEventListener('click',function(e){
    const target=e.target?.closest?.('#aurorePdfLabRun,#aurorePdfLabOpen,#aurorePdfLabExport');
    if(!target)return;
    if(target.id==='aurorePdfLabRun'){e.preventDefault();run().catch(err=>{setStatus('Échec de l’analyse','fail');setStage('conclusion','fail','Analyse interrompue.',String(err?.message||err));log();});}
    else if(target.id==='aurorePdfLabOpen'){e.preventDefault();openPdf();}
    else if(target.id==='aurorePdfLabExport'){e.preventDefault();exportReport();}
  });


  function ensureProductionActionStyles(){
    if(document.getElementById('aurorePdfProductionActionStyles'))return;
    const s=document.createElement('style');s.id='aurorePdfProductionActionStyles';
    s.textContent='.aurore-pdf-prod-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.aurore-pdf-prod-actions .admin-btn{font-size:.72rem;min-height:34px;padding:0 11px}@media(max-width:600px){.aurore-pdf-prod-actions{width:100%;justify-content:flex-start}.aurore-pdf-prod-actions .admin-btn{flex:1 1 auto}}';
    document.head.appendChild(s);
  }

  function initLab(){
    renderStages();
  }

  // Le panneau du laboratoire est présent dans index.html avant ce script.
  // On initialise après le DOM sans observer le DOM en continu : renderStages()
  // modifie innerHTML et un MutationObserver provoquerait une boucle infinie.
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',initLab,{once:true});
  }else{
    initLab();
  }

  // ===== Aurore — centre de production LuaLaTeX =====
  const queueState={lastHash:"",polling:false,known:{},cardSignatures:{},queuedPositions:{}};
  function qEsc(v){const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML}
  function qToken(){return typeof session!=='undefined'&&session?.access_token?session.access_token:''}
  function qHeaders(){return {apikey:anon(),Authorization:'Bearer '+qToken()}}
  function qDate(v){if(!v)return '—';try{return new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(v))}catch{return '—'}}
  function qDuration(a,b){
    if(!a)return '—';
    const ms=Math.max(0,(new Date(b||Date.now())-new Date(a))); const sec=Math.floor(ms/1000);
    const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
    return h?(h+' h '+String(m).padStart(2,'0')+' min'):(m?(m+' min '+String(s).padStart(2,'0')+' s'):(s+' s'));
  }
  function ensureProductionUI(){
    return !!document.getElementById('aurorePdfProductionCenter');
  }
  function toast(title,message,state='info'){
    let wrap=document.getElementById('aurorePdfToastWrap');
    if(!wrap){wrap=document.createElement('div');wrap.id='aurorePdfToastWrap';document.body.appendChild(wrap)}
    const el=document.createElement('div');el.className='aurore-pdf-toast '+state;
    el.innerHTML='<strong>'+qEsc(title)+'</strong><span>'+qEsc(message)+'</span>';wrap.appendChild(el);
    requestAnimationFrame(()=>el.classList.add('show'));setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),300)},5200);
  }
  function productionSignature(x){
    const m=x.metadata&&typeof x.metadata==='object'?x.metadata:{};
    const ls=String(m.lualatex_status||'');
    const ps=String(m.production_status||'');
    const cancel=m.lualatex_cancel_requested===true;
    const theme=String(m.aurore_design?.theme_color||m.theme_color||x.theme_color||'#6D28D9').toUpperCase();
    return JSON.stringify([
      x.id,x.job_id,x.title,x.status,x.pdf_url,x.pdf_path,x.version,x.published_document_id,
      x.subject,x.matiere,x.level,x.class_name,x.document_type,x.domaine,x.formation,x.specialite,
      x.annee,x.semestre,x.filiere,x.source_format,theme,m.origin,m.source,m.producer,ls,ps,cancel
    ]);
  }
  function productionDynamicState(x){
    const m=x.metadata&&typeof x.metadata==='object'?x.metadata:{};
    const ls=String(m.lualatex_status||'');
    const ps=String(m.production_status||'');
    const proc=ps==='processing'||ls==='processing',wait=ps==='queued'||ls==='queued',done=ps==='pdf_ready'||ls==='completed',fail=ps==='failed'||ls==='failed';
    const p=done?100:(wait?0:(Number.isFinite(Number(m.lualatex_progress))?Math.max(0,Math.min(100,Number(m.lualatex_progress))):(x.pdf_url?100:0)));
    const requested=m.lualatex_requested_at||x.created_at;
    const started=m.lualatex_started_at||m.lualatex_claimed_at||requested;
    const completed=m.lualatex_completed_at||((done||fail)?x.updated_at:null);
    const statusLabel=proc?'GÉNÉRATION EN COURS':wait?'EN ATTENTE':fail?'ÉCHEC':x.status==='published'?'PUBLIÉ':x.status==='approved'?'VALIDÉ':x.status==='review'?'À CONTRÔLER':done?'PDF TERMINÉ':x.pdf_url?'PDF DISPONIBLE':'À PRODUIRE';
    const stage=proc?(m.lualatex_stage||'Génération en cours…'):wait?'En attente du document précédent…':fail?(m.lualatex_last_error||'Une nouvelle tentative peut être lancée.'):x.status==='published'?'Document publié — aucune régénération autorisée':x.status==='approved'?'PDF validé — une régénération imposera une nouvelle validation':x.status==='review'&&x.pdf_url?'PDF prêt — contrôle humain requis':done?'PDF enregistré dans Aurore':x.pdf_url?'PDF disponible — contrôle humain requis':'Prêt à lancer le rendu PDF';
    const timeLine=wait?'Demandée à '+qDate(requested):proc?'Lancée à '+qDate(started)+' · '+qDuration(started):done?'Lancée à '+qDate(started)+' · terminée à '+qDate(completed)+' · durée '+qDuration(started,completed):'Créé le '+qDate(x.created_at);
    const footer=wait?'Position '+String(queueState.queuedPositions?.[String(x.id)]||'—')+' dans la file':proc?'Temps écoulé : '+qDuration(started):done?'Production terminée':fail?'Production en échec':'Suivi du document';
    return {m,ls,ps,proc,wait,done,fail,p,statusLabel,stage,timeLine,footer};
  }
  function buildProductionCard(x){
    const m=x.metadata&&typeof x.metadata==='object'?x.metadata:{},d=productionDynamicState(x);
    const theme=String(m.aurore_design?.theme_color||m.theme_color||x.theme_color||'#6D28D9').toUpperCase();
    const classification=[x.domaine,x.formation,x.specialite,x.annee,x.semestre,x.filiere,x.matiere||x.subject,x.class_name,x.level].filter(Boolean).join(' · ');
    const busySet=window.__aurorePdfActionBusy instanceof Set?window.__aurorePdfActionBusy:new Set();
    const cancelSet=window.__aurorePdfCancelRequested instanceof Set?window.__aurorePdfCancelRequested:new Set();
    const busy=k=>busySet.has(k+':'+String(x.id));
    const cancelBusy=cancelSet.has(Number(x.id))||d.m.lualatex_cancel_requested===true||busy('cancel');
    const canRender=['generated','review','approved'].includes(x.status)&&!d.proc&&!d.wait&&!d.m.lualatex_cancel_requested;
    const canValidate=x.status==='review'&&!!x.pdf_url&&!d.proc&&!d.wait&&!d.m.lualatex_cancel_requested;
    const canReject=['review','approved'].includes(x.status)&&!d.proc&&!d.wait&&!d.m.lualatex_cancel_requested;
    const canPublish=['approved','review'].includes(x.status)&&!!x.pdf_url&&!d.proc&&!d.wait&&!d.m.lualatex_cancel_requested;
    const cells=[
      ['Date',qDate(x.created_at)],['Classe',x.class_name||'—'],['Niveau',x.level||'—'],['Matière',x.matiere||x.subject||'—'],
      ['Type',x.document_type||'—'],['Version',x.version||'—'],['Origine',m.origin||m.source||m.producer||'Aurore'],['Statut',d.statusLabel]
    ];
    const actions=[];
    if(x.pdf_url)actions.push('<a class="admin-btn ghost" href="'+qEsc(x.pdf_url)+'" target="_blank" rel="noopener">Ouvrir le PDF actuel</a>');
    if(d.proc||d.wait)actions.push('<button type="button" class="admin-btn danger cf-pdf-cancel-static" data-cf-cancel="'+qEsc(x.id)+'" '+(cancelBusy?'disabled aria-busy="true"':'')+'>'+ (cancelBusy?'Annulation demandée…':'Annuler la génération') +'</button>');
    if(canRender)actions.push('<button type="button" class="admin-btn primary" data-cf-render="'+qEsc(x.id)+'" data-has-pdf="'+(x.pdf_url?'1':'0')+'" data-theme-color="'+qEsc(theme)+'" '+(busy('render')?'disabled aria-busy="true"':'')+'>'+ (busy('render')?(x.pdf_url?'Régénération…':'Génération…'):(x.status==='approved'?'Régénérer · revalider':x.pdf_url?'Régénérer':'Générer le PDF')) +'</button>');
    if(canValidate)actions.push('<button type="button" class="admin-btn valider" data-cf-validate="'+qEsc(x.id)+'" '+(busy('validate')?'disabled aria-busy="true"':'')+'>'+ (busy('validate')?'Validation…':'Valider') +'</button>');
    if(canReject)actions.push('<button type="button" class="admin-btn refuser" data-cf-reject="'+qEsc(x.id)+'" '+(busy('reject')?'disabled aria-busy="true"':'')+'>Rejeter</button>');
    if(canPublish)actions.push('<button type="button" class="admin-btn primary" data-cf-publish="'+qEsc(x.id)+'" '+(busy('publish')?'disabled aria-busy="true"':'')+'>'+ (busy('publish')?'Publication…':'Publier') +'</button>');
    if(x.published_document_id)actions.push('<button type="button" class="admin-btn ghost" disabled>Publié #'+qEsc(x.published_document_id)+'</button>');
    const cls=d.proc?'is-processing ':d.wait?'is-queued ':d.done?'is-completed ':d.fail?'is-failed ':'';
    return '<article class="aurore-pdf-prod-card '+cls+'" style="--prod-theme:'+qEsc(theme)+'" data-production-id="'+qEsc(x.id)+'">'+
      '<div class="aurore-pdf-prod-accent"></div><div class="aurore-pdf-prod-body">'+
      '<div class="aurore-pdf-prod-card-top"><div><span class="aurore-pdf-prod-source">Aurore · Content Factory</span><h4 class="aurore-pdf-prod-title">'+qEsc(x.title||'Document pédagogique')+'</h4></div><span class="aurore-pdf-prod-id">Document #'+qEsc(x.id)+(x.job_id?' · Job #'+qEsc(x.job_id):'')+'</span></div>'+
      '<div class="aurore-pdf-prod-status-line"><span class="aurore-pdf-prod-status '+(d.proc?'status-processing':d.wait?'status-queued':d.done?'status-completed':d.fail?'status-failed':'status-review')+'">'+qEsc(d.statusLabel)+'</span><span class="aurore-pdf-prod-time" data-prod-time>'+qEsc(d.timeLine)+'</span></div>'+
      '<div class="aurore-pdf-prod-stage" data-prod-stage>'+qEsc(d.stage)+'</div>'+
      '<div class="aurore-pdf-prod-progress"><div class="aurore-pdf-prod-bar"><i data-prod-bar style="width:'+d.p+'%"></i></div><span data-prod-percent>'+d.p+'%</span></div>'+
      '<div class="aurore-pdf-prod-grid">'+cells.map(([k,v])=>'<div><b>'+qEsc(k)+'</b><span>'+qEsc(v)+'</span></div>').join('')+'</div>'+
      (classification?'<div class="aurore-pdf-prod-classification">'+qEsc(classification)+'</div>':'')+
      '<div class="aurore-pdf-prod-theme"><span class="aurore-pdf-prod-theme-dot" style="background:'+qEsc(theme)+'"></span><div><b>Couleur du document</b><small>'+qEsc(theme)+' · identité enregistrée pour ce rendu</small></div></div>'+
      '<div class="aurore-pdf-prod-footer"><span data-prod-footer>'+qEsc(d.footer)+'</span><div class="aurore-pdf-prod-actions">'+actions.join('')+'</div></div>'+
      '</div></article>';
  }
  function syncProductionCard(card,x){
    const d=productionDynamicState(x);
    card.classList.remove('is-processing','is-queued','is-completed','is-failed');
    if(d.proc)card.classList.add('is-processing');else if(d.wait)card.classList.add('is-queued');else if(d.done)card.classList.add('is-completed');else if(d.fail)card.classList.add('is-failed');
    const status=card.querySelector('.aurore-pdf-prod-status');
    if(status){
      status.textContent=d.statusLabel;
      status.className='aurore-pdf-prod-status '+(d.proc?'status-processing':d.wait?'status-queued':d.done?'status-completed':d.fail?'status-failed':'status-review');
    }
    const time=card.querySelector('[data-prod-time]');if(time)time.textContent=d.timeLine;
    const stage=card.querySelector('[data-prod-stage]');if(stage)stage.textContent=d.stage;
    const bar=card.querySelector('[data-prod-bar]');if(bar)bar.style.width=d.p+'%';
    const percent=card.querySelector('[data-prod-percent]');if(percent)percent.textContent=d.p+'%';
    const footer=card.querySelector('[data-prod-footer]');if(footer)footer.textContent=d.footer;
    const cancel=card.querySelector('[data-cf-cancel]');
    const busySet=window.__aurorePdfActionBusy instanceof Set?window.__aurorePdfActionBusy:new Set();
    const cancelSet=window.__aurorePdfCancelRequested instanceof Set?window.__aurorePdfCancelRequested:new Set();
    const cancelBusy=cancelSet.has(Number(x.id))||d.m.lualatex_cancel_requested===true||busySet.has('cancel:'+String(x.id));
    if(cancel){cancel.disabled=cancelBusy;if(cancelBusy){cancel.textContent='Annulation demandée…';cancel.setAttribute('aria-busy','true')}else{cancel.textContent='Annuler la génération';cancel.removeAttribute('aria-busy')}}
    card.querySelectorAll('[data-cf-render],[data-cf-validate],[data-cf-reject],[data-cf-publish]').forEach(btn=>{
      const type=btn.hasAttribute('data-cf-render')?'render':btn.hasAttribute('data-cf-validate')?'validate':btn.hasAttribute('data-cf-reject')?'reject':'publish';
      const key=type+':'+String(x.id);
      if(busySet.has(key)||btn.dataset.actionBusy==='1'){btn.disabled=true;return}
      btn.disabled=false;
    });
  }
  function renderProduction(rows){
    ensureProductionUI();
    // Le centre « Production & validation PDF » est réservé aux documents
    // dont un fichier PDF existe réellement. Un document sans PDF reste dans
    // le sas de production et ne doit pas apparaître ici simplement parce
    // qu'un job ou un statut de rendu existe.
    const tracked=rows.filter(x=>!x.metadata?.admin_deleted&&(!x.metadata?.lualatex_cancelled_hidden)&& (!!x.pdf_url||!!x.pdf_path));
    const active=tracked.filter(x=>['queued','processing'].includes(x.metadata?.lualatex_status));
    const processing=active.filter(x=>x.metadata?.lualatex_status==='processing');
    const queued=active.filter(x=>x.metadata?.lualatex_status==='queued')
      .sort((a,b)=>new Date(a.metadata?.lualatex_requested_at||a.created_at)-new Date(b.metadata?.lualatex_requested_at||b.created_at));
    const finished=tracked.filter(x=>!['queued','processing'].includes(x.metadata?.lualatex_status))
      .sort((a,b)=>new Date(b.metadata?.lualatex_completed_at||b.updated_at||b.created_at)-new Date(a.metadata?.lualatex_completed_at||a.updated_at||a.created_at)).slice(0,12);
    queueState.queuedPositions={};queued.forEach((x,i)=>queueState.queuedPositions[String(x.id)]=i+1);
    const summary=document.getElementById('aurorePdfProdSummary');
    if(summary)summary.textContent=active.length?(processing.length+' en cours · '+queued.length+' en attente · '+finished.length+' document(s) récent(s)'):(finished.length+' document(s) · aucune production en cours');
    const list=document.getElementById('aurorePdfProdList');if(!list)return;
    const ordered=[...processing,...queued,...finished];
    if(!ordered.length){
      if(!list.querySelector('.aurore-pdf-prod-empty'))list.innerHTML='<div class="aurore-pdf-prod-empty">Aucun document à suivre pour le moment.</div>';
      queueState.cardSignatures={};
      return;
    }
    list.querySelector('.aurore-pdf-prod-empty')?.remove();
    const wanted=new Set(ordered.map(x=>String(x.id)));
    list.querySelectorAll('[data-production-id]').forEach(card=>{if(!wanted.has(String(card.dataset.productionId)))card.remove()});
    const nextSignatures={};
    for(const x of ordered){
      const id=String(x.id),sig=productionSignature(x);
      let card=list.querySelector('[data-production-id="'+CSS.escape(id)+'"]');
      if(!card||queueState.cardSignatures[id]!==sig){
        const holder=document.createElement('div');
        holder.innerHTML=buildProductionCard(x).trim();
        const fresh=holder.firstElementChild;
        if(card)card.replaceWith(fresh);else list.appendChild(fresh);
        card=fresh;
      }
      nextSignatures[id]=sig;
      syncProductionCard(card,x);
      list.appendChild(card);
    }
    queueState.cardSignatures=nextSignatures;
  }
  async function pollProductionQueue(){
    if(queueState.polling)return;queueState.polling=true;
    try{
      const token=qToken();if(!token)return;
      const r=await fetch(supa()+'/rest/v1/aurora_generated_documents?select=id,job_id,title,status,created_at,updated_at,subject,matiere,level,class_name,document_type,domaine,formation,specialite,annee,semestre,filiere,theme_color,version,source_format,metadata,pdf_url,pdf_path&order=created_at.desc&limit=100',{headers:qHeaders(),cache:'no-store'});
      if(!r.ok)return;
      const rows=await r.json();if(!Array.isArray(rows))return;
      renderProduction(rows);
      const initialState=Object.keys(queueState.known).length===0;
      for(const x of rows){
        const m=x.metadata||{},key=String(x.id),prev=queueState.known[key]||'';
        const now=String(m.lualatex_status||'');
        if(!initialState&&prev!==now){
          if(now==='queued')toast('PDF en attente','« '+x.title+' » a été placé dans la file.','info');
          else if(now==='processing')toast('Génération PDF','« '+x.title+' » est en cours de génération.','info');
          else if(now==='completed')toast('PDF prêt','« '+x.title+' » est prêt.','success');
          else if(now==='failed')toast('Génération interrompue','« '+x.title+' » nécessite une nouvelle tentative.','error');
        }
        queueState.known[key]=now;
      }
    }catch(e){console.warn('[Aurore PDF queue]',e)}finally{queueState.polling=false}
  }
  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('[data-cf-render]');if(!b)return;
    const title=b.closest('.cf-admin-card')?.querySelector('.cf-admin-title')?.textContent?.trim()||'Document PDF';
    toast('Production PDF','« '+title+' » est ajouté à la file.','info');
  },true);
  // Les actions PDF sont routées exclusivement par Content Factory Admin.

  function productionCenterVisible(){
    const center=document.getElementById('aurorePdfProductionCenter');
    if(!center || document.visibilityState!=='visible') return false;
    return !!(center.offsetWidth || center.offsetHeight || center.getClientRects().length);
  }
  function initProductionQueue(){
    ensureProductionUI();
    ensureProductionActionStyles();
    if(productionCenterVisible()) pollProductionQueue();
    setInterval(()=>{if(productionCenterVisible()) pollProductionQueue()},3500);
    document.addEventListener('visibilitychange',()=>{if(productionCenterVisible()) pollProductionQueue()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initProductionQueue,{once:true});else initProductionQueue();

})();