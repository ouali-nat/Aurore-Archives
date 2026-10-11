/* Aurore — Fiches de révision et scènes vectorielles via aurora-assisted-sheet */
(function(){
  'use strict';
  if(window.__auroreAssistedSheetUiLoaded)return;
  window.__auroreAssistedSheetUiLoaded=true;
  const FN='aurora-assisted-sheet';
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const ficheExample={
    title:'Fonctions et équations',
    subtitle:'Relations essentielles · interprétation · méthode',
    mode:'nb',
    page_number:1,
    essentials:[
      {title:'Définition',text:'Commencer par identifier les objets et les hypothèses.'},
      {title:'Méthode',text:'Justifier chaque étape et vérifier le résultat.'}
    ],
    formulas:[
      {title:'Fonction affine',latex:'f(x)=ax+b',legend:[{s:'a',m:'coefficient directeur'},{s:'b',m:'ordonnée à l’origine'}],condition:'x réel',trap:'Le signe de a détermine le sens de variation.'},
      {title:'Discriminant',latex:'\\Delta=b^2-4ac',legend:[{s:'a',m:'coefficient de x²'},{s:'b',m:'coefficient de x'},{s:'c',m:'terme constant'}],condition:'ax²+bx+c=0',trap:'Distinguer Δ positif, nul ou négatif.'},
      {title:'Dérivée',latex:'(x^n)\'=nx^{n-1}',legend:[{s:'n',m:'exposant réel adapté au domaine'}],condition:'Règle de puissance',trap:'Vérifier le domaine de définition.'}
    ],
    table:{title:'Signe du discriminant',columns:['Condition','Racines réelles','Conséquence'],rows:[['Δ > 0','Deux','Deux solutions distinctes'],['Δ = 0','Une double','Une solution double'],['Δ < 0','Aucune','Aucune solution réelle']]},
    scene:{version:1,width:260,height:170,elements:[{t:'axes',origin:[30,22],size:[200,125],x:[-3,3],y:[-2,5],xlabel:'x',ylabel:'y'},{t:'plot',expr:'x^2-1',from:-2.2,to:2.2,w:1.8,label:{text:'y = x² − 1',at:1.6,dy:-12}}]},
    selftest:['Quels sont les cas possibles pour le discriminant ?','Que représente le coefficient directeur ?','Comment contrôler le domaine de définition ?']
  };
  const sceneExample={title:'Schéma vectoriel — fonction carrée',caption:'Exemple modifiable de courbe dans un repère',mode:'nb',page_number:2,scene:{version:1,width:260,height:170,elements:[{t:'axes',origin:[30,22],size:[200,125],x:[-3,3],y:[-2,5],xlabel:'x',ylabel:'y'},{t:'plot',expr:'x^2-1',from:-2.2,to:2.2,w:1.8,label:{text:'y = x² − 1',at:1.6,dy:-12}}]}};
  function uiStateFor(course){
    const courseId=String(course?.id||'');
    let s=window.__auroreAssistedSheetUiState;
    if(!s||s.course_id!==courseId){
      s=window.__auroreAssistedSheetUiState={course_id:courseId,kind:'fiche',color:'nb',title:String(course?.title||'Fiche de révision'),json:'',initialized:false,block_id:null,fingerprint:'',busy:false,progress:0,progress_label:'En attente',message:'',ok:false,pdf_url:''};
    }
    return s;
  }
  function currentCourse(){try{return window.AuroreAssistedEditor?.getState?.()||null}catch(_){return null}}
  async function token(){
    const c=window.__auroreAssistedSb;
    if(c?.auth?.getSession){const r=await c.auth.getSession();if(r.data?.session?.access_token)return r.data.session.access_token;}
    try{if(typeof session!=='undefined'&&session?.access_token)return session.access_token}catch(_){}
    const client=window.supabase?.createClient?.(SUPABASE_URL,SUPABASE_ANON_KEY);
    if(client){const r=await client.auth.getSession();if(r.data?.session?.access_token)return r.data.session.access_token;}
    throw new Error('Session expirée. Reconnecte-toi à l’administration.');
  }
  async function call(body){
    const t=await token();
    const r=await fetch(SUPABASE_URL+'/functions/v1/'+FN,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+t,'apikey':SUPABASE_ANON_KEY},body:JSON.stringify(body)});
    const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch(_){d={error:raw||'Réponse non JSON'};}
    if(!r.ok)throw new Error(d.error||('Erreur HTTP '+r.status));
    if(d.ok===false)throw new Error(d.error||(d.errors?.length?d.errors.join(' · '):'La demande a été refusée.'));
    return d;
  }
  function mount(){
    const root=document.getElementById('assistedRoot');if(!root)return;
    const course=currentCourse();
    if(!course||!course.id||!root.querySelector('.ae-workspace')){root.querySelector('#aeAssistedSheetPanel')?.remove();return;}
    if(root.querySelector('#aeAssistedSheetPanel'))return;
    const formState=uiStateFor(course);
    const panel=document.createElement('section');panel.id='aeAssistedSheetPanel';
    panel.style.cssText='margin:20px 0;padding:18px;border:1px solid var(--border,#ddd);border-radius:14px;background:var(--card-bg,transparent);';
    panel.innerHTML='<div style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap"><div><span class="ae-kicker">Blocs du cours</span><h3 style="margin:4px 0 6px">Fiche de révision ou schéma vectoriel</h3><p style="margin:0;max-width:720px">Le contenu JSON est ajouté comme bloc dans le cours. Une fiche est placée à la fin par défaut ; tu peux ensuite ajouter d’autres blocs en dessous, puis télécharger le document complet dans l’ordre de la séquence.</p></div><span id="aeSheetBadge" class="ae-status">Prêt</span></div>'+
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:16px">'+
    '<label>Type de page<select id="aeSheetKind" style="display:block;width:100%;margin-top:6px;padding:10px;border-radius:8px"><option value="fiche">Fiche de révision</option><option value="scene">Schéma vectoriel</option></select></label>'+
    '<label>Couleur du PDF<select id="aeSheetColor" style="display:block;width:100%;margin-top:6px;padding:10px;border-radius:8px"><option value="nb">Noir et blanc</option><option value="color">Couleur</option></select></label>'+
    '<label>Titre du document<input id="aeSheetTitle" maxlength="180" value="'+esc(course.title||'Fiche de révision')+'" style="display:block;width:100%;margin-top:6px;padding:10px;border-radius:8px;box-sizing:border-box"></label></div>'+
    '<label style="display:block;margin-top:12px">Contenu JSON <small>(modifiable ; le bouton « Charger un exemple » fournit une base valide)</small><textarea id="aeSheetJson" spellcheck="false" style="display:block;width:100%;min-height:300px;margin-top:6px;padding:12px;border-radius:8px;box-sizing:border-box;font:12px/1.5 monospace;white-space:pre;overflow:auto"></textarea></label>'+
    '<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px"><span id="aeSheetProgressLabel">En attente</span><strong id="aeSheetProgressPct">0%</strong></div><div id="aeSheetProgress" role="progressbar" aria-label="Progression de la génération du PDF" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="height:10px;width:100%;background:var(--border,#e5e7eb);border-radius:999px;overflow:hidden"><div id="aeSheetProgressFill" style="height:100%;width:0%;background:var(--accent,#6D28D9);border-radius:999px;transition:width .25s ease"></div></div></div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="admin-btn ghost" id="aeSheetExample" type="button">Charger un exemple</button><button class="admin-btn primary" id="aeSheetGenerate" type="button">Ajouter au cours et générer</button><a id="aeSheetOpen" class="admin-btn ghost" target="_blank" rel="noopener noreferrer" style="display:none">Ouvrir la page du cours</a></div>'+
    '<div id="aeSheetMessage" role="status" aria-live="polite" style="margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere"></div>';
    const workspace=root.querySelector('.ae-workspace');
    const toolbar=workspace.querySelector('.ae-workbar');
    if(toolbar&&toolbar.parentNode)toolbar.parentNode.insertBefore(panel,toolbar.nextSibling);else workspace.appendChild(panel);
    const $=id=>document.getElementById(id);
    const saveDraft=()=>{
      formState.kind=$('aeSheetKind')?.value||formState.kind;
      formState.color=$('aeSheetColor')?.value||formState.color;
      formState.title=$('aeSheetTitle')?.value??formState.title;
      formState.json=$('aeSheetJson')?.value??formState.json;
    };
    const setProgress=(value,label)=>{
      const pct=Math.max(0,Math.min(100,Math.round(Number(value)||0)));
      formState.progress=pct;formState.progress_label=label||'En cours…';
      const fill=$('aeSheetProgressFill'),bar=$('aeSheetProgress'),pctNode=$('aeSheetProgressPct'),labelNode=$('aeSheetProgressLabel');
      if(fill)fill.style.width=pct+'%';
      if(bar)bar.setAttribute('aria-valuenow',String(pct));
      if(pctNode)pctNode.textContent=pct+'%';
      if(labelNode)labelNode.textContent=formState.progress_label;
    };
    const setMessage=(msg,ok=false)=>{
      formState.message=String(msg||'');formState.ok=!!ok;
      if($('aeSheetMessage'))$('aeSheetMessage').textContent=formState.message;
      if($('aeSheetBadge'))$('aeSheetBadge').textContent=ok?'Terminé':(formState.busy?'En cours…':(msg?'À vérifier':'Prêt'));
    };
    const content=()=>{
      let v;try{v=JSON.parse($('aeSheetJson').value)}catch(e){throw new Error('JSON invalide : '+e.message)}
      if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Le JSON doit être un objet.');
      v.mode=$('aeSheetColor').value;v.title=$('aeSheetTitle').value.trim()||v.title||'Fiche de révision';
      return v;
    };
    const fingerprint=(v)=>JSON.stringify({course_id:String(currentCourse()?.id||''),kind:$('aeSheetKind').value,title:$('aeSheetTitle').value,theme_color:currentCourse()?.theme_color||'#6D28D9',content:v});
    const setExample=()=>{
      const kind=$('aeSheetKind').value,example=kind==='fiche'?ficheExample:sceneExample;
      $('aeSheetJson').value=JSON.stringify(example,null,2);
      formState.kind=kind;formState.color=$('aeSheetColor').value;formState.title=String(currentCourse()?.title||'Fiche de révision');
      $('aeSheetTitle').value=formState.title;formState.json=$('aeSheetJson').value;
      formState.block_id=null;formState.fingerprint='';formState.pdf_url='';
      if($('aeSheetOpen'))$('aeSheetOpen').style.display='none';
      $('aeSheetGenerate').textContent='Ajouter au cours et générer';
      setProgress(0,'En attente');
      setMessage('Exemple chargé. Adapte le JSON puis ajoute ce bloc au cours.');
      formState.initialized=true;
    };
    $('aeSheetKind').addEventListener('change',setExample);
    $('aeSheetColor').addEventListener('change',()=>{
      try{const v=JSON.parse($('aeSheetJson').value);v.mode=$('aeSheetColor').value;$('aeSheetJson').value=JSON.stringify(v,null,2)}catch(_){}
      saveDraft();
    });
    $('aeSheetJson').addEventListener('input',saveDraft);
    $('aeSheetTitle').addEventListener('input',saveDraft);
    $('aeSheetExample').addEventListener('click',setExample);
    $('aeSheetGenerate').addEventListener('click',async()=>{
      if(formState.busy)return;
      formState.busy=true;saveDraft();
      $('aeSheetGenerate').disabled=true;$('aeSheetExample').disabled=true;
      $('aeSheetKind').disabled=true;$('aeSheetColor').disabled=true;$('aeSheetTitle').disabled=true;$('aeSheetJson').disabled=true;
      if($('aeSheetOpen'))$('aeSheetOpen').style.display='none';
      let fp='';
      try{
        const c=content();fp=fingerprint(c);saveDraft();
        setProgress(3,'Contrôle du contenu…');setMessage('Validation de la fiche ou du schéma…');
        const kind=$('aeSheetKind').value;
        const check=await call({mode:'validate',page_kind:kind,content:c});
        if(!check.ok)throw new Error((check.errors||['Contenu invalide']).join('\n'));
        setProgress(12,'Contenu validé');
        const editor=window.AuroreAssistedEditor;
        if(typeof editor?.upsertAssistedContentBlock!=='function'||typeof editor?.generateAssistedContentBlock!=='function')throw new Error('Recharge l’éditeur de cours avant de générer ce bloc.');
        const type=kind==='fiche'?'fiche-revision':'vector-scene';
        setProgress(19,'Insertion du bloc dans le cours…');
        const saved=await editor.upsertAssistedContentBlock(type,c,formState.block_id);
        formState.block_id=saved.block_id;formState.fingerprint=fp;formState.pdf_url='';formState.ok=false;
        $('aeSheetGenerate').textContent='Mise à jour dans le cours…';
        setProgress(32,'Bloc enregistré · préparation du PDF…');
        const d=await editor.generateAssistedContentBlock(formState.block_id);
        const url=String(d.page_url||'');
        if(d.status!=='ready'||!url)throw new Error(d.error||'Le bloc est enregistré dans le cours, mais sa page PDF n’est pas prête. Tu peux le sélectionner dans la séquence et relancer sa génération.');
        formState.pdf_url=url;
        if($('aeSheetOpen')){$('aeSheetOpen').href=url;$('aeSheetOpen').style.display='inline-flex';$('aeSheetOpen').textContent='Ouvrir la page du cours';}
        setProgress(100,'Page intégrée au cours');
        $('aeSheetGenerate').textContent='Mettre à jour dans le cours';
        setMessage((kind==='fiche'?'Fiche de révision':'Schéma vectoriel')+' ajouté au cours à la page '+String(d.page_number||'—')+'. Tu peux ajouter d’autres blocs en dessous.',true);
      }catch(e){
        const msg=String(e?.message||e);setMessage(msg);setProgress(formState.progress,'Génération interrompue');
        $('aeSheetGenerate').textContent=formState.block_id?'Reprendre la génération dans le cours':'Ajouter au cours et générer';
      }finally{
        formState.busy=false;
        if($('aeSheetGenerate'))$('aeSheetGenerate').disabled=false;
        if($('aeSheetExample'))$('aeSheetExample').disabled=false;
        if($('aeSheetKind'))$('aeSheetKind').disabled=false;
        if($('aeSheetColor'))$('aeSheetColor').disabled=false;
        if($('aeSheetTitle'))$('aeSheetTitle').disabled=false;
        if($('aeSheetJson'))$('aeSheetJson').disabled=false;
        if($('aeSheetBadge')&&$('aeSheetBadge').textContent!=='Terminé')$('aeSheetBadge').textContent='À vérifier';
        saveDraft();
      }
    });
    if(formState.initialized){
      $('aeSheetKind').value=formState.kind;$('aeSheetColor').value=formState.color;$('aeSheetTitle').value=formState.title;$('aeSheetJson').value=formState.json;
      if(formState.pdf_url&&$('aeSheetOpen')){$('aeSheetOpen').href=formState.pdf_url;$('aeSheetOpen').style.display='inline-flex';}
      $('aeSheetGenerate').textContent=formState.block_id?'Mettre à jour dans le cours':'Ajouter au cours et générer';
      $('aeSheetGenerate').disabled=formState.busy;$('aeSheetExample').disabled=formState.busy;
      $('aeSheetKind').disabled=formState.busy;$('aeSheetColor').disabled=formState.busy;$('aeSheetTitle').disabled=formState.busy;$('aeSheetJson').disabled=formState.busy;
      setProgress(formState.progress,formState.progress_label);setMessage(formState.message,formState.ok);
    }else{
      $('aeSheetKind').value=formState.kind;$('aeSheetColor').value=formState.color;$('aeSheetTitle').value=formState.title;setExample();
    }
  }
  const observer=new MutationObserver(()=>{try{mount()}catch(e){console.error('[Aurore assisted sheet]',e)}});
  function start(){observer.observe(document.getElementById('assistedRoot')||document.body,{childList:true,subtree:true});mount();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();