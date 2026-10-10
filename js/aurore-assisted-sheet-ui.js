/* Aurore — Fiches de révision et scènes vectorielles via aurora-assisted-sheet */
(function(){
  'use strict';
  if(window.__auroreAssistedSheetUiLoaded)return;
  window.__auroreAssistedSheetUiLoaded=true;
  const FN='aurora-assisted-sheet';
  const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const ficheExample={
    title:'Les formules à connaître',subtitle:'Gaz parfait · premier principe · capacités calorifiques',mode:'nb',page_number:11,
    essentials:[{title:'Gaz parfait',text:'Modèle valable à faible pression et haute température.'},{title:'Énergie conservée',text:'ΔU = W + Q : tout ce qui est reçu compte positif.'}],
    formulas:[
      {title:'Équation d’état',latex:'PV = nRT',legend:[{s:'P',m:'pression',u:'Pa'},{s:'V',m:'volume',u:'m^3'},{s:'n',m:'quantité de matière',u:'mol'},{s:'T',m:'température',u:'K'},{s:'R',m:'constante des gaz parfaits',v:'8{,}314',u:'J·mol⁻¹·K⁻¹'}],condition:'gaz parfait'},
      {title:'Premier principe',latex:'\\Delta U = W + Q',legend:[{s:'\\Delta U',m:'variation d’énergie interne',u:'J'},{s:'W',m:'travail reçu',u:'J'},{s:'Q',m:'chaleur reçue',u:'J'}],condition:'système fermé',trap:'Reçu par le système : positif.'},
      {title:'Énergie interne',latex:'\\Delta U = nC_v\\Delta T',legend:[{s:'C_v',m:'capacité à volume constant',u:'J.mol^-1.K^-1'},{s:'\\Delta T',m:'variation de température',u:'K'}],condition:'loi de Joule'}
    ],
    table:{title:'Transformations en un coup d’œil',columns:['Type','Constante','Travail','Bilan'],rows:[['Isochore','V = cste','W = 0','ΔU = Q'],['Isobare','P = cste','W = −PΔV','Q = ΔH'],['Isotherme','T = cste','ΔU = 0','Q = −W']]},
    scene:{version:1,width:260,height:170,elements:[{t:'axes',origin:[30,22],size:[200,125],x:[0,5],y:[0,5],xlabel:'V',ylabel:'P'},{t:'plot',expr:'4/x',from:1.1,to:4.6,w:1.8,label:{text:'isotherme',at:3.3,dy:-13}},{t:'line',p1:[48,82],p2:[205,82],dash:'dashed',w:1.6}]},
    selftest:['Signe de W lors d’une détente ?','Que vaut ΔU en isotherme ?','Cp − Cv = ?']
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
    if(!r.ok||d.ok===false)throw new Error(d.error||('Erreur HTTP '+r.status)+(d.errors?.length?': '+d.errors.join(' · '):''));
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
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="admin-btn ghost" id="aeSheetExample" type="button">Charger un exemple</button><button class="admin-btn ghost" id="aeSheetValidate" type="button">1. Valider</button><button class="admin-btn primary" id="aeSheetCreate" type="button">2. Créer la page</button><button class="admin-btn primary" id="aeSheetRender" type="button" disabled>3. Générer le PDF</button><button class="admin-btn ghost" id="aeSheetStatus" type="button" disabled>Actualiser le statut</button><a id="aeSheetOpen" class="admin-btn ghost" target="_blank" rel="noopener noreferrer" style="display:none">Ouvrir le PDF</a></div>'+
    '<div id="aeSheetMessage" role="status" aria-live="polite" style="margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere"></div>';
    const workspace=root.querySelector('.ae-workspace');
    const toolbar=workspace.querySelector('.ae-workbar');
    if(toolbar&&toolbar.parentNode)toolbar.parentNode.insertBefore(panel,toolbar.nextSibling);else workspace.appendChild(panel);
    const $=id=>panel.querySelector('#'+id);
    let documentId=null;
    const setMessage=(msg,ok=false)=>{ $('aeSheetMessage').textContent=msg; $('aeSheetBadge').textContent=ok?'Terminé':'En cours / à vérifier'; };
    const content=()=>{let v;try{v=JSON.parse($('aeSheetJson').value)}catch(e){throw new Error('JSON invalide : '+e.message)}v.mode=$('aeSheetColor').value;return v;};
    const setExample=()=>{$('aeSheetJson').value=JSON.stringify($('aeSheetKind').value==='fiche'?ficheExample:sceneExample,null,2);$('aeSheetRender').disabled=true;$('aeSheetStatus').disabled=true;documentId=null;$('aeSheetOpen').style.display='none';setMessage('Exemple chargé. Adapte le contenu, puis valide-le.');};
    $('aeSheetKind').addEventListener('change',setExample);
    $('aeSheetColor').addEventListener('change',()=>{try{const v=JSON.parse($('aeSheetJson').value);v.mode=$('aeSheetColor').value;$('aeSheetJson').value=JSON.stringify(v,null,2)}catch(_){}});
    $('aeSheetExample').addEventListener('click',setExample);
    $('aeSheetValidate').addEventListener('click',async()=>{if(busy)return;busy=true;try{const c=content();const d=await call({mode:'validate',page_kind:$('aeSheetKind').value,content:c});setMessage('Validation réussie.'+(d.warnings?.length?'\nAvertissements : '+d.warnings.join(' · '):''),true);}catch(e){setMessage(String(e.message||e));}finally{busy=false;}});
    $('aeSheetCreate').addEventListener('click',async()=>{if(busy)return;busy=true;try{const c=content();const check=await call({mode:'validate',page_kind:$('aeSheetKind').value,content:c});if(!check.ok)throw new Error((check.errors||['Contenu invalide']).join('\n'));const d=await call({mode:'create',course_id:String(currentCourse()?.id||''),page_kind:$('aeSheetKind').value,title:$('aeSheetTitle').value,theme_color:(currentCourse()?.theme_color||'#6D28D9'),content:c});documentId=Number(d.generated_document_id);if(!documentId)throw new Error('Identifiant de page manquant.');$('aeSheetRender').disabled=false;$('aeSheetStatus').disabled=false;$('aeSheetOpen').style.display='none';setMessage('Page créée (#'+documentId+'). Prête pour le rendu PDF.',true);}catch(e){setMessage(String(e.message||e));}finally{busy=false;}});
    $('aeSheetRender').addEventListener('click',async()=>{if(busy||!documentId)return;busy=true;$('aeSheetRender').disabled=true;try{const d=await call({mode:'render',generated_document_id:documentId,theme_color:currentCourse()?.theme_color||'#6D28D9'});const url=d.page_url||d.pdf_url;if(url){$('aeSheetOpen').href=url;$('aeSheetOpen').style.display='inline-flex';}setMessage('PDF généré. '+(d.page_count?'Pages : '+d.page_count+'. ':'')+(url?'Le lien de consultation est prêt.':'Aucun lien PDF retourné.'),Boolean(url));}catch(e){setMessage(String(e.message||e));}finally{busy=false;$('aeSheetRender').disabled=false;}});
    $('aeSheetStatus').addEventListener('click',async()=>{if(busy||!documentId)return;busy=true;try{const d=await call({mode:'status',generated_document_id:documentId});const url=d.pdf_url;if(url){$('aeSheetOpen').href=url;$('aeSheetOpen').style.display='inline-flex';}setMessage('Statut : '+(d.status||'inconnu')+' · '+(d.stage||'')+' · progression '+(d.progress??0)+'%'+(d.error?'\nErreur : '+d.error:'')+(url?'\nPDF disponible.':''),d.status==='completed');}catch(e){setMessage(String(e.message||e));}finally{busy=false;}});
    setExample();
  }
  const observer=new MutationObserver(()=>{try{mount()}catch(e){console.error('[Aurore assisted sheet]',e)}});
  function start(){observer.observe(document.getElementById('assistedRoot')||document.body,{childList:true,subtree:true});mount();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();