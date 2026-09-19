
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
    return normalizeSource(s).split(/(\\\\\[[\s\S]*?\\\\\]|\\\\\([\s\S]*?\\\\\))/g)
      .map((v,i)=>i%2?v:escapeHtml(v)).join('');
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
      const remainingLatex=body?(/\\\\[|\\\\(|\\\\]|\\\\\\)/.test(body.textContent||'')):false;
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
})();