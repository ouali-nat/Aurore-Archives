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
  const sceneExample={title:'Schéma vectoriel — pression et volume',caption:'Représentation illustrative dans le plan (V, P)',mode:'nb',page_number:12,scene:{version:1,width:260,height:170,elements:[{t:'axes',origin:[30,22],size:[200,125],x:[0,5],y:[0,5],xlabel:'V',ylabel:'P'},{t:'plot',expr:'4/x',from:1.1,to:4.6,w:1.8,label:{text:'isotherme',at:3.3,dy:-13}},{t:'plot',expr:'2*(2/x)^1.4',from:1.25,to:3.4,dash:'dotted',w:1.6,tone:'soft',label:{text:'adiabatique',at:1.25,dx:-62,dy:-4}},{t:'line',p1:[48,82],p2:[205,82],dash:'dashed',w:1.6},{t:'text',at:[160,87],text:'isobare',size:7.5}]}};
  let busy=false;
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
    const panel=document.createElement('section');panel.id='aeAssistedSheetPanel';
    panel.style.cssText='margin:20px 0;padding:18px;border:1px solid var(--border,#ddd);border-radius:14px;background:var(--card-bg,transparent);';
    panel.innerHTML='<div style="display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap"><div><span class="ae-kicker">Rendus indépendants</span><h3 style="margin:4px 0 6px">Fiche de révision ou schéma vectoriel</h3><p style="margin:0;max-width:720px">Ces pages utilisent aurora-assisted-sheet et restent indépendantes du rendu séquentiel du cours.</p></div><span id="aeSheetBadge" class="ae-status">Prêt</span></div>'+
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:16px">'+
    '<label>Type de page<select id="aeSheetKind" style="display:block;width:100%;margin-top:6px;padding:10px;border-radius:8px"><option value="fiche">Fiche de révision</option><option value="scene">Schéma vectoriel</option></select></label>'+
    '<label>Couleur du PDF<select id="aeSheetColor" style="display:block;width:100%;margin-top:6px;padding:10px;border-radius:8px"><option value="nb">Noir et blanc</option><option value="color">Couleur</option></select></label>'+
    '<label>Titre du document<input id="aeSheetTitle" maxlength="180" value="'+esc(course.title||'Fiche de révision')+'" style="display:block;width:100%;margin-top:6px;padding:10px;border-radius:8px;box-sizing:border-box"></label></div>'+
    '<label style="display:block;margin-top:12px">Contenu JSON <small>(modifiable ; le bouton « Charger un exemple » fournit une base valide)</small><textarea id="aeSheetJson" spellcheck="false" style="display:block;width:100%;min-height:300px;margin-top:6px;padding:12px;border-radius:8px;box-sizing:border-box;font:12px/1.5 monospace;white-space:pre;overflow:auto"></textarea></label>'+
    '<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px"><span id="aeSheetProgressLabel">En attente</span><strong id="aeSheetProgressPct">0%</strong></div><div id="aeSheetProgress" role="progressbar" aria-label="Progression de la génération du PDF" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="height:10px;width:100%;background:var(--border,#e5e7eb);border-radius:999px;overflow:hidden"><div id="aeSheetProgressFill" style="height:100%;width:0%;background:var(--accent,#6D28D9);border-radius:999px;transition:width .25s ease"></div></div></div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="admin-btn ghost" id="aeSheetExample" type="button">Charger un exemple</button><button class="admin-btn primary" id="aeSheetGenerate" type="button">Générer le PDF</button><a id="aeSheetOpen" class="admin-btn ghost" target="_blank" rel="noopener noreferrer" style="display:none">Ouvrir le PDF</a></div>'+
    '<div id="aeSheetMessage" role="status" aria-live="polite" style="margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere"></div>';
    const workspace=root.querySelector('.ae-workspace');
    const toolbar=workspace.querySelector('.ae-workbar');
    if(toolbar&&toolbar.parentNode)toolbar.parentNode.insertBefore(panel,toolbar.nextSibling);else workspace.appendChild(panel);
    const $=id=>panel.querySelector('#'+id);
    let documentId=null,documentFingerprint='';
    const setProgress=(value,label)=>{
      const pct=Math.max(0,Math.min(100,Math.round(Number(value)||0)));
      $('aeSheetProgressFill').style.width=pct+'%';
      $('aeSheetProgress').setAttribute('aria-valuenow',String(pct));
      $('aeSheetProgressPct').textContent=pct+'%';
      $('aeSheetProgressLabel').textContent=label||'En cours…';
    };
    const setMessage=(msg,ok=false)=>{
      $('aeSheetMessage').textContent=msg;
      $('aeSheetBadge').textContent=ok?'Terminé':(busy?'En cours…':'À vérifier');
    };
    const content=()=>{let v;try{v=JSON.parse($('aeSheetJson').value)}catch(e){throw new Error('JSON invalide : '+e.message)}v.mode=$('aeSheetColor').value;return v;};
    const fingerprint=(v)=>JSON.stringify({course_id:String(currentCourse()?.id||''),kind:$('aeSheetKind').value,title:$('aeSheetTitle').value,theme_color:currentCourse()?.theme_color||'#6D28D9',content:v});
    const setExample=()=>{
      $('aeSheetJson').value=JSON.stringify($('aeSheetKind').value==='fiche'?ficheExample:sceneExample,null,2);
      documentId=null;documentFingerprint='';$('aeSheetOpen').style.display='none';
      $('aeSheetGenerate').textContent='Générer le PDF';
      setProgress(0,'En attente');
      setMessage('Exemple chargé. Adapte le contenu puis génère directement le PDF.');
    };
    $('aeSheetKind').addEventListener('change',setExample);
    $('aeSheetColor').addEventListener('change',()=>{
      try{const v=JSON.parse($('aeSheetJson').value);v.mode=$('aeSheetColor').value;$('aeSheetJson').value=JSON.stringify(v,null,2)}catch(_){}
    });
    $('aeSheetExample').addEventListener('click',setExample);
    async function renderWithProgress(id,theme){
      let stop=false;
      const poll=async()=>{
        while(!stop){
          try{
            const d=await call({mode:'status',generated_document_id:id});
            const remote=Math.max(0,Math.min(100,Number(d.progress)||0));
            if(d.status==='failed'&&d.error) setMessage('Le rendu rencontre une erreur : '+d.error);
            else if(remote>0) setProgress(Math.max(22,Math.min(96,22+remote*.73)),d.stage||'Génération du PDF…');
            if(d.pdf_url){
              $('aeSheetOpen').href=d.pdf_url;
              $('aeSheetOpen').style.display='inline-flex';
            }
          }catch(_){}
          if(!stop)await new Promise(resolve=>setTimeout(resolve,900));
        }
      };
      const pollPromise=poll();
      try{
        return await call({mode:'render',generated_document_id:id,theme_color:theme});
      }finally{
        stop=true;
        await pollPromise;
      }
    }
    $('aeSheetGenerate').addEventListener('click',async()=>{
      if(busy)return;
      busy=true;$('aeSheetGenerate').disabled=true;$('aeSheetExample').disabled=true;
      $('aeSheetOpen').style.display='none';
      let fp='';
      try{
        const c=content();fp=fingerprint(c);
        setProgress(3,'Contrôle du contenu…');setMessage('Validation de la fiche ou du schéma…');
        const check=await call({mode:'validate',page_kind:$('aeSheetKind').value,content:c});
        if(!check.ok)throw new Error((check.errors||['Contenu invalide']).join('\n'));
        setProgress(12,'Contenu validé');
        let id=documentId;
        if(!id||documentFingerprint!==fp){
          setProgress(19,'Enregistrement de la page…');
          const created=await call({mode:'create',course_id:String(currentCourse()?.id||''),page_kind:$('aeSheetKind').value,title:$('aeSheetTitle').value,theme_color:(currentCourse()?.theme_color||'#6D28D9'),content:c});
          id=Number(created.generated_document_id||0);
          if(!id)throw new Error('Identifiant de page manquant après la création.');
          documentId=id;documentFingerprint=fp;
        }
        $('aeSheetGenerate').textContent='Génération du PDF…';
        setProgress(23,'Préparation du moteur PDF…');
        const d=await renderWithProgress(id,currentCourse()?.theme_color||'#6D28D9');
        const url=d.page_url||d.pdf_url;
        if(!url)throw new Error('Le moteur a terminé sans retourner de lien PDF.');
        $('aeSheetOpen').href=url;$('aeSheetOpen').style.display='inline-flex';
        setProgress(100,'PDF prêt');
        $('aeSheetGenerate').textContent='Régénérer le PDF';
        setMessage('PDF généré avec succès · '+(d.page_count||1)+' page(s).',true);
      }catch(e){
        const msg=String(e?.message||e);
        setMessage(msg);
        setProgress(Number($('aeSheetProgress').getAttribute('aria-valuenow')||0),'Génération interrompue');
        $('aeSheetGenerate').textContent=documentId&&documentFingerprint===fp?'Reprendre le rendu':'Générer le PDF';
      }finally{
        busy=false;$('aeSheetGenerate').disabled=false;$('aeSheetExample').disabled=false;
        if($('aeSheetBadge').textContent!=='Terminé')$('aeSheetBadge').textContent='À vérifier';
      }
    });
    setExample();
  }
  const observer=new MutationObserver(()=>{try{mount()}catch(e){console.error('[Aurore assisted sheet]',e)}});
  function start(){observer.observe(document.getElementById('assistedRoot')||document.body,{childList:true,subtree:true});mount();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();