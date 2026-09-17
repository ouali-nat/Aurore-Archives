(function(){
'use strict';
const FOLDER_TABLE='cases_personnelles',ASSIGN_TABLE='documents_cases_personnelles',PRIVATE_TABLE='documents_personnels_prives',MAX_FOLDERS=10,PRIVE_TAILLE_MAX=104857600;let folders=[],folderAssignments=[],privateDocs=[],draggedFolderId=null;
const esc=v=>typeof escapeTextePersonnel==='function'?escapeTextePersonnel(v==null?'':String(v)):String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const uid=()=>session?.id?String(session.id):'';
async function api(table,o={}){if(!session?.access_token)throw new Error('SESSION_ABSENTE');const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}${o.query?'?'+o.query:''}`,{method:o.method||'GET',headers:{...headersAdmin(),'Content-Type':'application/json',...(o.headers||{})},body:o.body?JSON.stringify(o.body):undefined,cache:'no-store'});if(!r.ok)throw new Error(`${table} HTTP ${r.status} ${await r.text().catch(()=> '')}`);return r.status===204?'':await r.text();}
const lk=()=>`aurore_cases_personnelles_${uid()}`,ak=()=>`aurore_cases_documents_${uid()}`;const read=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}};const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
function normF(a){return(Array.isArray(a)?a:[]).filter(x=>x&&x.id!=null).map((x,i)=>({id:String(x.id),name:String(x.name||'Sans nom').trim().slice(0,60)||'Sans nom',position:Number.isFinite(+x.position)?+x.position:i})).sort((a,b)=>a.position-b.position)}
function normA(a){return(Array.isArray(a)?a:[]).filter(x=>x&&x.document_id!=null&&x.case_id!=null).map(x=>({document_id:String(x.document_id),case_id:String(x.case_id)}))}
function normP(a){return(Array.isArray(a)?a:[]).filter(x=>x&&x.id!=null&&x.case_id!=null).map(x=>({id:String(x.id),case_id:String(x.case_id),titre:String(x.titre||'Document').trim().slice(0,150)||'Document',fichier_url:String(x.fichier_url||''),taille_octets:Number(x.taille_octets)||0,type_fichier:x.type_fichier||null,created_at:x.created_at||null}))}
const pk=()=>`aurore_cases_documents_prives_${uid()}`;
async function load(){
  if(!uid())return;
  const localFolders=normF(read(lk(),[]));
  let foldersLoaded=false;
  try{
    const raw=await api(FOLDER_TABLE,{query:`select=id,name,position,created_at&user_id=eq.${encodeURIComponent(uid())}&order=position.asc,created_at.asc`});
    const serverFolders=normF(raw?JSON.parse(raw):[]);
    if(serverFolders.length){
      folders=serverFolders; write(lk(),folders);
    }else if(localFolders.length){
      // Une réponse vide peut arriver pendant la restauration de session/RLS.
      // Ne jamais remplacer des cases connues par une case par défaut.
      folders=localFolders;
    }else{
      await createFolder('À classer',true);
    }
    foldersLoaded=true;
  }catch(e){
    folders=localFolders;
    if(!folders.length){folders=[{id:'local-default',name:'À classer',position:0}];write(lk(),folders);}
  }
  try{
    const raw=await api(ASSIGN_TABLE,{query:`select=document_id,case_id&user_id=eq.${encodeURIComponent(uid())}`});
    const serverAssignments=normA(raw?JSON.parse(raw):[]);
    const localAssignments=normA(read(ak(),[]));
    // En cas de réponse vide transitoire, conserver les affectations locales.
    folderAssignments=serverAssignments.length?serverAssignments:localAssignments;
    write(ak(),folderAssignments);
  }catch(e){folderAssignments=normA(read(ak(),[]));}
  try{
    const raw=await api(PRIVATE_TABLE,{query:`select=id,case_id,titre,fichier_url,taille_octets,type_fichier,created_at&user_id=eq.${encodeURIComponent(uid())}&order=created_at.asc`});
    const serverPrivate=normP(raw?JSON.parse(raw):[]);
    const localPrivate=normP(read(pk(),[]));
    privateDocs=serverPrivate.length?serverPrivate:localPrivate;
    write(pk(),privateDocs);
  }catch(e){privateDocs=normP(read(pk(),[]));}
  render();
}
function render(){const grid=document.getElementById('personalFolderGrid');if(!grid)return;document.getElementById('personalFolderCount').textContent=String(folders.length);grid.innerHTML='';folders.forEach(f=>{const c=document.createElement('article');c.className='personal-folder';c.draggable=true;c.dataset.folderId=f.id;const n=folderAssignments.filter(a=>a.case_id===f.id).length+privateDocs.filter(x=>x.case_id===f.id).length;c.innerHTML=`<div class="personal-folder-top"><div class="personal-folder-icon">▱</div><button type="button" class="personal-folder-menu" aria-label="Options">⋯</button></div><div class="personal-folder-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="personal-folder-count">${n} document${n>1?'s':''}</div><div class="personal-folder-hint">Glisser pour déplacer</div>`;c.addEventListener('click',e=>{if(!e.target.closest('.personal-folder-menu'))openFolder(f)});c.querySelector('.personal-folder-menu').addEventListener('click',e=>{e.stopPropagation();folderMenu(f)});c.addEventListener('dragstart',()=>{draggedFolderId=f.id;c.classList.add('dragging')});c.addEventListener('dragend',()=>{draggedFolderId=null;c.classList.remove('dragging');grid.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'))});c.addEventListener('dragover',e=>{e.preventDefault();if(draggedFolderId!==f.id)c.classList.add('drag-over')});c.addEventListener('dragleave',()=>c.classList.remove('drag-over'));c.addEventListener('drop',e=>{e.preventDefault();c.classList.remove('drag-over');if(draggedFolderId&&draggedFolderId!==f.id)reorder(draggedFolderId,f.id)});grid.appendChild(c)});if(folders.length<MAX_FOLDERS){const b=document.createElement('button');b.type='button';b.className='personal-folder-create';b.innerHTML=`<span class="personal-folder-create-icon">＋</span><strong>Créer une case</strong><span>Encore ${MAX_FOLDERS-folders.length} emplacement${MAX_FOLDERS-folders.length>1?'s':''}</span>`;b.onclick=()=>dialog('create');grid.appendChild(b)}}
async function createFolder(name,quiet=false){
  if(folders.length>=MAX_FOLDERS){if(!quiet)alert('Vous avez atteint la limite de 10 cases.');return}
  const clean=String(name||'').trim().replace(/\s+/g,' ').slice(0,60);
  if(!clean)return;
  if(folders.some(f=>f.name.toLocaleLowerCase('fr')===clean.toLocaleLowerCase('fr'))){if(!quiet)alert('Une case porte déjà ce nom.');return}
  if(!quiet && typeof window.auroreAfficherVeuillezPatienter==='function'){
    window.auroreAfficherVeuillezPatienter('Création de votre case en cours…');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  }
  try{
    const raw=await api(FOLDER_TABLE,{method:'POST',headers:{Prefer:'return=representation'},body:{user_id:uid(),name:clean,position:folders.length}});
    const r=raw?JSON.parse(raw):[];
    if(!r[0])throw 0;
    folders=normF([...folders,r[0]]);
    write(lk(),folders);
  }catch(e){
    if(quiet){
      folders=[...folders,{id:'local-'+Date.now().toString(36),name:clean,position:folders.length}];
      write(lk(),folders);
    }else{
      alert('Impossible de créer la case. Exécutez d’abord le SQL fourni.');
      return;
    }
  }finally{
    if(!quiet && typeof window.auroreCacherVeuillezPatienter==='function') window.auroreCacherVeuillezPatienter();
  }
  render();
}
async function renameFolder(f,name){const clean=String(name||'').trim().replace(/\s+/g,' ').slice(0,60);if(!clean)return;if(folders.some(x=>x.id!==f.id&&x.name.toLocaleLowerCase('fr')===clean.toLocaleLowerCase('fr'))){alert('Une autre case porte déjà ce nom.');return}try{await api(FOLDER_TABLE,{method:'PATCH',query:`id=eq.${encodeURIComponent(f.id)}&user_id=eq.${encodeURIComponent(uid())}`,body:{name:clean}})}catch(e){if(!String(f.id).startsWith('local-')){alert('Impossible de renommer cette case pour le moment.');return}}f.name=clean;write(lk(),folders);render()}
async function deleteFolder(f){if(!confirm(`Supprimer la case « ${f.name} » ? Les documents ne seront pas supprimés.`))return;try{await api(FOLDER_TABLE,{method:'DELETE',query:`id=eq.${encodeURIComponent(f.id)}&user_id=eq.${encodeURIComponent(uid())}`})}catch(e){if(!String(f.id).startsWith('local-')){alert('Impossible de supprimer cette case pour le moment.');return}}folders=folders.filter(x=>x.id!==f.id);folderAssignments=folderAssignments.filter(x=>x.case_id!==f.id);write(lk(),folders);write(ak(),folderAssignments);render();closeFolder()}
async function reorder(a,b){const i=folders.findIndex(x=>x.id===a),j=folders.findIndex(x=>x.id===b);if(i<0||j<0)return;const arr=[...folders],m=arr.splice(i,1)[0];arr.splice(j,0,m);arr.forEach((x,k)=>x.position=k);folders=arr;write(lk(),folders);render();try{await Promise.all(folders.filter(x=>!String(x.id).startsWith('local-')).map(x=>api(FOLDER_TABLE,{method:'PATCH',query:`id=eq.${encodeURIComponent(x.id)}&user_id=eq.${encodeURIComponent(uid())}`,body:{position:x.position}})))}catch(e){console.warn('[Cases] ordre:',e)}}
function folderMenu(f){
  let menu=document.getElementById('personalFolderMenuPopover');
  if(!menu){
    menu=document.createElement('div');menu.id='personalFolderMenuPopover';menu.className='personal-folder-menu-popover';
    menu.innerHTML=`<div class="personal-folder-menu-title"></div><button type="button" data-folder-share>↗ Partager la section</button><button type="button" data-folder-rename>✎ Renommer</button><button type="button" data-folder-delete>⌫ Supprimer</button>`;
    document.body.appendChild(menu);
    menu.addEventListener('click',e=>{e.stopPropagation();});
    menu.querySelector('[data-folder-share]').addEventListener('click',()=>{const id=menu.dataset.folderId;const target=folders.find(x=>String(x.id)===String(id));menu.classList.remove('show');if(target)window.aurorePartagerSection?.(target)});
    menu.querySelector('[data-folder-rename]').addEventListener('click',()=>{const id=menu.dataset.folderId;const target=folders.find(x=>String(x.id)===String(id));menu.classList.remove('show');if(target)dialog('rename',target)});
    menu.querySelector('[data-folder-delete]').addEventListener('click',()=>{const id=menu.dataset.folderId;const target=folders.find(x=>String(x.id)===String(id));menu.classList.remove('show');if(target)deleteFolder(target)});
    document.addEventListener('click',()=>menu.classList.remove('show'));
    document.addEventListener('keydown',e=>{if(e.key==='Escape')menu.classList.remove('show')});
  }
  menu.dataset.folderId=f.id;menu.querySelector('.personal-folder-menu-title').textContent=f.name;
  const source=document.querySelector(`[data-folder-id="${CSS.escape(String(f.id))}"] .personal-folder-menu`);
  if(source){const r=source.getBoundingClientRect();menu.style.left=Math.min(window.innerWidth-220,Math.max(12,r.right-205))+'px';menu.style.top=Math.min(window.innerHeight-130,r.bottom+8)+'px';}
  menu.classList.add('show');
}
function dialog(mode,f=null){let d=document.getElementById('personalFolderDialog');if(!d){d=document.createElement('div');d.id='personalFolderDialog';d.className='personal-folder-dialog';d.innerHTML=`<section class="personal-folder-dialog-card"><h3 id="pfdTitle"></h3><p id="pfdText"></p><input id="pfdInput" maxlength="60" autocomplete="off"><div class="personal-folder-message" id="pfdMsg"></div><div class="personal-folder-dialog-actions"><button type="button" id="pfdCancel">Annuler</button><button type="button" class="primary" id="pfdOk">Continuer</button></div></section>`;document.body.appendChild(d);d.onclick=e=>{if(e.target===d)d.classList.remove('show')};d.querySelector('#pfdCancel').onclick=()=>d.classList.remove('show')}d.dataset.mode=mode;d.dataset.folderId=f?.id||'';d.querySelector('#pfdTitle').textContent=mode==='rename'?'Renommer la case':'Créer une case';d.querySelector('#pfdText').textContent=mode==='rename'?`Modifiez le nom de « ${f.name} ».`:'Donnez un nom à votre case. Vous pourrez le modifier plus tard.';d.querySelector('#pfdInput').value=mode==='rename'?f.name:'';d.querySelector('#pfdOk').onclick=async()=>{const v=d.querySelector('#pfdInput').value.trim();if(!v){d.querySelector('#pfdMsg').className='personal-folder-message err';d.querySelector('#pfdMsg').textContent='Entrez un nom.';return}d.querySelector('#pfdOk').disabled=true;try{if(mode==='rename')await renameFolder(f,v);else await createFolder(v);d.classList.remove('show')}finally{d.querySelector('#pfdOk').disabled=false}};d.classList.add('show');setTimeout(()=>d.querySelector('#pfdInput').focus(),20)}
function picker(){let p=document.getElementById('folderDocumentPicker');if(p)return p;p=document.createElement('div');p.id='folderDocumentPicker';p.className='folder-document-picker';p.innerHTML=`<section class="folder-document-picker-card"><div class="folder-document-picker-head"><div><h3>Ranger ce document</h3><p id="fdpTitle"></p></div><button type="button" class="folder-document-close">×</button></div><div class="folder-document-list" id="folderDocumentList"></div></section>`;document.body.appendChild(p);p.onclick=e=>{if(e.target===p)p.classList.remove('show')};p.querySelector('.folder-document-close').onclick=()=>p.classList.remove('show');return p}
async function chooseDoc(doc){if(!session){const signup=document.getElementById('accessSignupBtn');if(signup)signup.click();setTimeout(()=>document.getElementById('showLoginBtn')?.click(),30);const m=document.getElementById('loginMessage');if(m){m.textContent='Connectez-vous pour ranger vos documents dans vos cases personnelles.';m.className='access-message ok';m.style.display='block'}return}if(!doc?.id)return;if(!folders.length){await load();}const p=picker(),list=p.querySelector('#folderDocumentList');p.querySelector('#fdpTitle').textContent=doc.Titre||'Document';list.innerHTML='';const current=folderAssignments.find(x=>x.document_id===String(doc.id));folders.forEach(f=>{const b=document.createElement('button');b.type='button';b.className='folder-document-option'+(current?.case_id===f.id?' is-current':'');b.innerHTML=`<strong>▱ ${esc(f.name)}</strong><span>${current?.case_id===f.id?'Actuellement ici':'Ajouter ici'}</span>`;b.onclick=()=>assign(doc,f);list.appendChild(b)});if(current){const b=document.createElement('button');b.type='button';b.className='folder-document-option';b.innerHTML='<strong>× Retirer de la case</strong><span>Sans classement</span>';b.onclick=()=>removeAssignment(doc);list.appendChild(b)}p.classList.add('show')}
async function assign(doc,f){
  const did=String(doc.id),fid=String(f.id),old=folderAssignments.find(x=>x.document_id===did);
  if(!session?.id||!doc?.id||!f?.id)return;
  folderAssignments=folderAssignments.filter(x=>x.document_id!==did);folderAssignments.push({document_id:did,case_id:fid});write(ak(),folderAssignments);
  try{await api(ASSIGN_TABLE,{method:'DELETE',query:`user_id=eq.${encodeURIComponent(uid())}&document_id=eq.${encodeURIComponent(doc.id)}`});await api(ASSIGN_TABLE,{method:'POST',headers:{Prefer:'return=minimal'},body:{user_id:uid(),document_id:Number(doc.id),case_id:f.id}});}catch(e){folderAssignments=folderAssignments.filter(x=>x.document_id!==did);if(old)folderAssignments.push(old);write(ak(),folderAssignments);console.error('[Cases] affectation',e);alert('Impossible de ranger ce document. Vérifiez le SQL des cases et réessayez.');return;}
  document.getElementById('folderDocumentPicker')?.classList.remove('show');render();await openFolder(f);
}

async function removeAssignment(doc){
  const did=String(doc.id),old=folderAssignments.find(x=>x.document_id===did);
  folderAssignments=folderAssignments.filter(x=>x.document_id!==did);
  write(ak(),folderAssignments);
  try{
    await api(ASSIGN_TABLE,{method:'DELETE',query:`user_id=eq.${encodeURIComponent(uid())}&document_id=eq.${encodeURIComponent(doc.id)}`,headers:{'Prefer':'return=minimal'}});
  }catch(e){
    if(old)folderAssignments.push(old);
    write(ak(),folderAssignments);
    console.error('[Cases] retrait',e);
    alert('Impossible de retirer ce document de sa case.');
    return;
  }
  document.getElementById('folderDocumentPicker')?.classList.remove('show');
  render();
  const current=folders.find(x=>old&&x.id===old.case_id);
  if(current) await openFolder(current);
}

function findDoc(id){for(const src of [documentsCourants,documentsRecentsCourants,MES_DOCUMENTS_PERSONNELS])if(Array.isArray(src)){const d=src.find(x=>String(x.id)===String(id));if(d)return d}return null}

async function recupererDocsDesCases(ids){
  const wanted=[...new Set((ids||[]).map(String).filter(Boolean))];
  if(!wanted.length)return [];
  const connus=new Map();
  wanted.forEach(id=>{const d=findDoc(id);if(d)connus.set(String(id),d)});
  const manquants=wanted.filter(id=>!connus.has(id));
  if(manquants.length){
    try{
      const raw=await api('Document',{query:`select=*&id=in.(${manquants.map(id=>id.replace(/[^0-9]/g,'')).filter(Boolean).join(',')})`});
      const docs=raw?JSON.parse(raw):[];
      (Array.isArray(docs)?docs:[]).forEach(d=>connus.set(String(d.id),d));
    }catch(e){console.warn('[Cases] métadonnées documents:',e)}
  }
  return wanted.map(id=>connus.get(id)||{id});
}

async function uploaderDocumentPrive(fichier,titre,caseId){
  if(!session?.id) throw new Error('SESSION_ABSENTE');
  if(!fichier) throw new Error('FICHIER_MANQUANT');
  const estPdf=fichier.type==='application/pdf'||/\.pdf$/i.test(fichier.name||'');
  if(!estPdf) throw new Error('FORMAT_INVALIDE');
  if(fichier.size>PRIVE_TAILLE_MAX) throw new Error('FICHIER_TROP_LOURD');
  const nomPropre='perso_'+uid()+'_'+Date.now()+'_'+String(fichier.name||'document.pdf').replace(/[^a-zA-Z0-9._-]/g,'_');
  const up=await fetch(`${R2_WORKER_URL}/${nomPropre}`,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:fichier});
  if(!up.ok) throw new Error('STOCKAGE_HTTP_'+up.status);
  const url=`${R2_PUBLIC_URL}/${nomPropre}`;
  const raw=await api(PRIVATE_TABLE,{method:'POST',headers:{Prefer:'return=representation'},body:{user_id:uid(),case_id:caseId,titre:String(titre||fichier.name||'Document').trim().slice(0,150),fichier_url:url,taille_octets:fichier.size||0,type_fichier:fichier.type||'application/pdf'}});
  const rows=raw?JSON.parse(raw):[];
  if(!rows[0]) throw new Error('ENREGISTREMENT_ECHEC');
  const doc=normP([rows[0]])[0];
  privateDocs=[...privateDocs,doc];
  write(pk(),privateDocs);
  return doc;
}
async function supprimerDocumentPrive(doc){
  if(!confirm(`Supprimer définitivement « ${doc.titre} » ? Cette action est irréversible.`))return;
  const old=privateDocs;
  privateDocs=privateDocs.filter(x=>x.id!==doc.id);
  write(pk(),privateDocs);
  try{
    await api(PRIVATE_TABLE,{method:'DELETE',query:`id=eq.${encodeURIComponent(doc.id)}&user_id=eq.${encodeURIComponent(uid())}`,headers:{Prefer:'return=minimal'}});
  }catch(e){
    privateDocs=old;write(pk(),privateDocs);
    console.error('[Cases] suppression document privé',e);
    alert('Impossible de supprimer ce document pour le moment.');
    return;
  }
  render();
  const f=folders.find(x=>x.id===doc.case_id);
  if(f) await openFolder(f); else closeFolder();
}
function toggleUploadPanel(p,f){
  const panel=p.querySelector('#pfuPanel');if(!panel)return;
  if(!panel.hidden){panel.hidden=true;panel.innerHTML='';return}
  panel.hidden=false;
  const options=folders.map(x=>`<option value="${esc(x.id)}" ${x.id===f.id?'selected':''}>${esc(x.name)}</option>`).join('');
  panel.innerHTML=`<div class="personal-upload-card"><h4>Ajouter un document</h4><div class="personal-upload-row"><label for="pfuSection">Section</label><select id="pfuSection">${options}</select></div><div class="personal-upload-row"><label for="pfuTitre">Nom du document</label><input type="text" id="pfuTitre" maxlength="150" placeholder="Ex. Cours de mathématiques" autocomplete="off"></div><div class="personal-upload-row"><label for="pfuFichier">Fichier</label><input type="file" id="pfuFichier" accept="application/pdf"></div><small class="personal-upload-note">Format PDF uniquement, 100 Mo maximum. Ce document reste privé, sauf si vous partagez la section (toujours en lecture seule pour vos visiteurs).</small><div class="personal-folder-message" id="pfuMsg"></div><div class="personal-upload-actions"><button type="button" id="pfuCancel">Annuler</button><button type="button" class="primary" id="pfuOk">Déposer</button></div></div>`;
  panel.querySelector('#pfuCancel').onclick=()=>{panel.hidden=true;panel.innerHTML=''};
  panel.querySelector('#pfuFichier').addEventListener('change',e=>{
    const t=panel.querySelector('#pfuTitre');
    if(t&&!t.value.trim()){const fn=e.target.files[0]?.name||'';t.value=fn.replace(/\.pdf$/i,'')}
  });
  panel.querySelector('#pfuOk').onclick=async()=>{
    const msg=panel.querySelector('#pfuMsg'),btn=panel.querySelector('#pfuOk');
    const caseId=panel.querySelector('#pfuSection').value;
    const titre=panel.querySelector('#pfuTitre').value.trim();
    const fichier=panel.querySelector('#pfuFichier').files[0];
    msg.className='personal-folder-message';msg.textContent='';
    if(!caseId){msg.className='personal-folder-message err';msg.textContent='Choisissez une section.';return}
    if(!titre){msg.className='personal-folder-message err';msg.textContent='Indiquez un nom pour ce document.';return}
    if(!fichier){msg.className='personal-folder-message err';msg.textContent='Sélectionnez un fichier PDF.';return}
    const estPdf=fichier.type==='application/pdf'||/\.pdf$/i.test(fichier.name||'');
    if(!estPdf){msg.className='personal-folder-message err';msg.textContent='Seul le format PDF est accepté.';return}
    if(fichier.size>PRIVE_TAILLE_MAX){msg.className='personal-folder-message err';msg.textContent='Ce fichier dépasse la taille maximale de 100 Mo.';return}
    btn.disabled=true;btn.textContent='Envoi en cours…';
    try{
      const doc=await uploaderDocumentPrive(fichier,titre,caseId);
      panel.hidden=true;panel.innerHTML='';
      render();
      const dest=folders.find(x=>x.id===doc.case_id)||f;
      await openFolder(dest);
    }catch(e){
      console.error('[Cases] dépôt personnel',e);
      msg.className='personal-folder-message err';
      msg.textContent=e&&e.message==='FICHIER_TROP_LOURD'?'Ce fichier dépasse la taille maximale de 100 Mo.':e&&e.message==='FORMAT_INVALIDE'?'Seul le format PDF est accepté.':'Impossible de déposer ce document pour le moment. Réessayez.';
      btn.disabled=false;btn.textContent='Déposer';
    }
  };
}
async function openFolder(f){
  const p=document.getElementById('personalCaseContent');if(!p)return;
  const a=folderAssignments.filter(x=>x.case_id===f.id);
  const pDocs=privateDocs.filter(x=>x.case_id===f.id);
  const total=a.length+pDocs.length;
  const dejaOuvert=document.getElementById('screen-personal-case')?.classList.contains('active');
  p.innerHTML=`<div class="personal-section-detail-head"><div><span class="personal-section-kicker">Section personnelle</span><h3>▱ ${esc(f.name)}</h3><p>${total} document${total!==1?'s':''} · présentation Aurore</p></div><div class="personal-section-detail-actions"><button type="button" data-section-upload class="personal-section-upload">＋ Ajouter un document</button><button type="button" data-section-share class="personal-section-share">↗ Partager</button><button type="button" data-section-close class="personal-section-close">← Retour</button></div></div><div id="pfuPanel" class="personal-upload-panel" hidden></div><div class="personal-section-detail-toolbar"><span>Vos documents</span><small>La même présentation que la bibliothèque Aurore</small></div><div id="pfdList" class="doc-list personal-section-doc-list"></div>`;
  p.querySelector('[data-section-share]')?.addEventListener('click',()=>window.aurorePartagerSection?.(f));
  p.querySelector('[data-section-close]')?.addEventListener('click',closeFolder);
  p.querySelector('[data-section-upload]')?.addEventListener('click',()=>toggleUploadPanel(p,f));
  if(!dejaOuvert) afficherEcran('screen-personal-case'); else window.scrollTo({top:0,behavior:'smooth'});
  const list=p.querySelector('#pfdList');
  if(!total){
    list.innerHTML='<div class="doc-empty"><div class="icon-wrap">▱</div><h3>Cette section est vide</h3><p>Utilisez « Case » sur un document pour le ranger ici, ou ajoutez directement un document depuis votre appareil avec « ＋ Ajouter un document ».</p></div>';
  }else{
    list.innerHTML='<div class="personal-empty">Chargement des documents…</div>';
    let docs=[];
    if(a.length){try{docs=await recupererDocsDesCases(a.map(x=>x.document_id));}catch(e){list.innerHTML='<div class="doc-empty"><h3>Impossible de charger cette section</h3><p>Veuillez réessayer dans quelques instants.</p></div>';return}}
    list.innerHTML='';
    docs.forEach((d,i)=>{
      const r=document.createElement('article');r.className='doc-row aurore-personal-document-row';r.dataset.documentIndex=String(i);r._auroreDocument=d;
      const ok=d.Fichier_url && d.Telechargement_autorise!==false;
      const contexte=[d.Niveau&&`Niveau : ${d.Niveau}`,d.Classe&&`Classe : ${d.Classe}`,d.Filiere&&`Filière : ${d.Filiere}`,d['Matière']&&`Matière : ${d['Matière']||d.Genre}`].filter(Boolean).join(' · ');
      const titre=obtenirTitreDocument(d);
      r.innerHTML=`<div class="info"><div class="icon-wrap">${ICONS.file}</div><div class="doc-main-info"><div class="titre" title="${echapperHtmlPub(titre)}">${echapperHtmlPub(titre)}</div><div class="meta">${echapperHtmlPub(contexte||'Document de votre section')}${ok?'':' · Lecture seule'}</div>${tailleBadgeMarkup(d.Fichier_url)}</div></div><div class="doc-actions"><button type="button" class="dl" data-section-read>${ok?'Lire':'Voir'}</button>${ok?'<button type="button" class="dl" data-section-download>Télécharger maintenant</button>':''}<button type="button" class="dl doc-action-soft" data-section-fav>♡ Favori</button><button type="button" class="dl doc-action-soft doc-action-folder" data-section-case>▣ Case</button><button type="button" class="dl doc-action-soft" data-section-remove>Retirer</button><div class="doc-share-wrap"><button type="button" class="doc-more-btn" data-document-more="1" aria-label="Options de partage" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg></button></div></div>`;
      r.querySelector('[data-section-read]')?.addEventListener('click',()=>ouvrirLecteurPDF(d));
      r.querySelector('[data-section-download]')?.addEventListener('click',()=>telechargerDocumentAvecProgression(d));
      r.querySelector('[data-section-fav]')?.addEventListener('click',()=>basculerFavoriDocument(d,r.querySelector('[data-section-fav]')));
      r.querySelector('[data-section-case]')?.addEventListener('click',()=>window.ouvrirChoixCaseDocument?.(d));
      r.querySelector('[data-section-remove]')?.addEventListener('click',()=>removeAssignment(d));
      list.appendChild(r);
      if(d.Fichier_url&&typeof appliquerCouvertureSiLivre==='function')appliquerCouvertureSiLivre(r,d);
    });
    pDocs.forEach(doc=>{
      const r=document.createElement('article');r.className='doc-row aurore-personal-document-row';
      const fauxDoc={id:'prive-'+doc.id,Titre:doc.titre,Fichier_url:doc.fichier_url,Telechargement_autorise:true};
      r.innerHTML=`<div class="info"><div class="icon-wrap">${ICONS.file}</div><div class="doc-main-info"><div class="titre" title="${esc(doc.titre)}">${esc(doc.titre)}</div><div class="meta">Votre document déposé directement${tailleBadgeMarkup(doc.fichier_url)?' · ':''}</div>${tailleBadgeMarkup(doc.fichier_url)}</div></div><div class="doc-actions"><button type="button" class="dl" data-priv-read>Lire</button><button type="button" class="dl" data-priv-download>Télécharger</button><button type="button" class="dl doc-action-soft" data-priv-delete>Supprimer</button></div>`;
      r.querySelector('[data-priv-read]')?.addEventListener('click',()=>ouvrirLecteurPDF(fauxDoc));
      r.querySelector('[data-priv-download]')?.addEventListener('click',()=>telechargerDocumentAvecProgression(fauxDoc));
      r.querySelector('[data-priv-delete]')?.addEventListener('click',()=>supprimerDocumentPrive(doc));
      list.appendChild(r);
    });
  }
}
function closeFolder(){
  if(history.state && history.state.aurasterNavigation) history.back();
  else afficherEcran('screen-profil');
}
window.ouvrirChoixCaseDocument=chooseDoc;window.chargerCasesPersonnelles=load;window.rendreCasesPersonnelles=render;
function init(){
  document.getElementById('personalFolderCreate')?.addEventListener('click',()=>dialog('create'));
  // L'authentification est restaurée de façon asynchrone après DOMContentLoaded.
  // Ne pas charger les cases avant que session soit disponible : sinon on tombe
  // sur le cache/local fallback et les cases semblent disparaître après reconnexion.
  let essais=0;
  const attendreSession=()=>{
    if(session?.id){ load(); return; }
    if(essais++<80) setTimeout(attendreSession,250);
  };
  attendreSession();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.addEventListener('load',()=>{
  let essais=0;
  const recharger=()=>{
    if(session?.id){ load(); return; }
    if(essais++<40) setTimeout(recharger,250);
  };
  recharger();
});
})();
