/* Aurore — Gestion de parcours / référentiel pédagogique */
(function(){
  'use strict';
  if(typeof window==='undefined' || window.__auroreAdminParcoursLoaded) return;
  window.__auroreAdminParcoursLoaded=true;

  const NODE_TABLE='aurore_pedagogical_nodes';
  const SUBJECT_TABLE='aurore_pedagogical_subjects';
  const LINK_TABLE='aurore_pedagogical_node_subjects';
  const CHILD_BUCKETS=['sousNiveaux','troncCommuns','series','classes','enfants'];

  const state={
    nodes:[],subjects:[],links:[],
    selectedNodeId:null,search:'',subjectSearch:'',
    expanded:new Set(),treeScale:1,panX:0,panY:0,loading:false,loaded:false
  };

  const esc=v=>{
    const d=document.createElement('div');
    d.textContent=String(v==null?'':v);
    return d.innerHTML;
  };
  const slugify=v=>String(v||'').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120)||'item';

  function uuid(){
    try{
      if(window.crypto && typeof window.crypto.randomUUID==='function') return window.crypto.randomUUID();
      const a=new Uint8Array(16);
      window.crypto.getRandomValues(a);
      a[6]=(a[6]&15)|64; a[8]=(a[8]&63)|128;
      const h=[...a].map(x=>x.toString(16).padStart(2,'0')).join('');
      return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
    }catch(_){
      return '00000000-0000-4000-8000-'+Math.floor(Math.random()*1e12).toString(16).padStart(12,'0');
    }
  }

  function supaUrl(){
    try{return SUPABASE_URL}catch(_){return 'https://tdeotqfsbvouresfhkab.supabase.co'}
  }
  function anonKey(){
    try{return SUPABASE_ANON_KEY}catch(_){return ''}
  }
  function currentSession(){
    try{return typeof session!=='undefined'?session:null}catch(_){return null}
  }
  function isAdmin(){
    return String(currentSession()?.role||'').toLowerCase()==='admin';
  }
  async function getAdminToken(){
    const s=currentSession();
    if(s?.access_token) return s.access_token;
    if(typeof assurerClientAuthGoogle==='function'){
      const client=await assurerClientAuthGoogle();
      const got=await client?.auth?.getSession();
      const remote=got?.data?.session;
      if(remote?.access_token){
        try{
          if(typeof session!=='undefined'){
            session={...(session||{}),access_token:remote.access_token,refresh_token:remote.refresh_token||'',expires_at:remote.expires_at?remote.expires_at*1000:0};
          }
          if(typeof sauvegarderSession==='function') sauvegarderSession();
        }catch(_){}
        return remote.access_token;
      }
    }
    return null;
  }
  async function api(path,options={},admin){
    const headers={apikey:anonKey(),...(options.headers||{})};
    if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json';
    if(admin){
      const token=await getAdminToken();
      if(!token) throw new Error('Session administrateur absente ou expirée.');
      headers.Authorization='Bearer '+token;
    }else{
      const s=currentSession();
      if(s?.access_token) headers.Authorization='Bearer '+s.access_token;
    }
    const res=await fetch(supaUrl()+path,{...options,headers,cache:'no-store'});
    const raw=await res.text();
    let data=null;
    try{data=raw?JSON.parse(raw):null}catch(_){data=raw}
    if(!res.ok) throw new Error(data?.message||data?.hint||data?.error_description||data?.error||raw||('HTTP '+res.status));
    return data;
  }
  function status(message,kind){
    const el=document.getElementById('parcoursStatus');
    if(!el)return;
    el.className='parcours-status '+(kind||'info');
    el.textContent=message||'';
    el.hidden=!message;
  }
  function legacyCatalog(){
    try{
      if(Array.isArray(window.AURORE_CATALOG_NIVEAUX)) return window.AURORE_CATALOG_NIVEAUX;
    }catch(_){}
    try{
      if(typeof NIVEAUX!=='undefined' && Array.isArray(NIVEAUX)) return NIVEAUX;
    }catch(_){}
    return [];
  }
  function childObjects(node){
    const out=[];
    CHILD_BUCKETS.forEach(bucket=>{
      const arr=Array.isArray(node?.[bucket])?node[bucket]:[];
      arr.forEach((child,index)=>{
        if(child && typeof child==='object' && String(child.id||child.nom||'').trim()){
          out.push({node:child,bucket,index});
        }
      });
    });
    return out;
  }
  function inferType(node,bucket,isRoot){
    if(isRoot)return 'pathway';
    if(node?.type==='groupe')return 'group';
    if(node?.type==='serie')return 'series';
    if(bucket==='classes' || bucket==='troncCommuns')return 'class';
    if(/^semestre\s/i.test(String(node?.nom||'')))return 'semester';
    if(/\bannée\b/i.test(String(node?.nom||'')))return 'year';
    if(bucket==='series')return 'series';
    if(node?.type==='arbre')return 'branch';
    if(bucket==='sousNiveaux')return 'level';
    return 'branch';
  }
  function flattenLegacy(roots){
    const nodes=[],subjects=[],subjectByKey=new Map(),links=[];
    function walk(node,parent,order,bucket,path,isRoot){
      const legacyId=String(node?.id||slugify(node?.nom||'item')).trim();
      const key='legacy:'+path.concat(legacyId).join('/');
      const id=uuid();
      const parentId=parent?.id||null;
      const compat={
        legacy_id:legacyId,
        type:node?.type||null,
        sigle:node?.sigle||null,
        accent:node?.accent||null,
        desc:node?.desc||null,
        dbNiveaux:Array.isArray(node?.dbNiveaux)?node.dbNiveaux.slice():[],
        serie:node?.serie||null,
        parent_bucket:bucket||null
      };
      nodes.push({
        id,parent_id:parentId,node_key:key,legacy_path:key.slice(7),
        name:String(node?.nom||legacyId).trim(),node_type:inferType(node,bucket,isRoot),
        slug:slugify(legacyId),sort_order:order,active:true,source:'legacy',
        metadata:{compat}
      });
      const self=nodes[nodes.length-1];
      (Array.isArray(node?.matieres)?node.matieres:[]).forEach((m,i)=>{
        const name=String(m?.nom||'').trim();
        if(!name)return;
        const subjectKey=slugify(name);
        if(!subjectByKey.has(subjectKey)){
          const sid=uuid();
          subjectByKey.set(subjectKey,{
            id:sid,subject_key:subjectKey,name,
            code:String(m?.mono||''),sort_order:subjectByKey.size,
            active:true,source:'legacy',
            metadata:{mono:String(m?.mono||'')}
          });
          subjects.push(subjectByKey.get(subjectKey));
        }
        links.push({node_id:self.id,subject_id:subjectByKey.get(subjectKey).id,sort_order:i});
      });
      childObjects(node).forEach(item=>walk(item.node,self,item.index,item.bucket,path.concat(legacyId),false));
    }
    roots.forEach((root,index)=>walk(root,null,index,null,[],true));
    return {nodes,subjects,links};
  }
  async function insertBatches(table,rows,admin){
    for(let i=0;i<rows.length;i+=100){
      const chunk=rows.slice(i,i+100);
      if(!chunk.length)continue;
      await api('/rest/v1/'+table,{
        method:'POST',
        headers:{'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates,return=minimal'},
        body:JSON.stringify(chunk)
      },admin);
    }
  }
  async function seedLegacy(){
    if(!isAdmin()) throw new Error('Cette initialisation est réservée aux administrateurs.');
    const roots=legacyCatalog();
    if(!roots.length) throw new Error('Le catalogue NIVEAUX actuel est introuvable.');
    const flat=flattenLegacy(roots);
    const byDepth=new Map();
    flat.nodes.forEach(node=>{
      const depth=(node.legacy_path.match(/\//g)||[]).length;
      if(!byDepth.has(depth))byDepth.set(depth,[]);
      byDepth.get(depth).push(node);
    });
    const depths=[...byDepth.keys()].sort((a,b)=>a-b);
    for(const depth of depths)await insertBatches(NODE_TABLE,byDepth.get(depth),true);
    await insertBatches(SUBJECT_TABLE,flat.subjects,true);
    await insertBatches(LINK_TABLE,flat.links,true);
    return flat;
  }

  function childrenOf(parentId,activeOnly){
    return state.nodes.filter(n=>(n.parent_id||null)===(parentId||null)&&(!activeOnly||n.active))
      .sort((a,b)=>(Number(a.sort_order)-Number(b.sort_order))||a.name.localeCompare(b.name,'fr'));
  }
  function nodeById(id){return state.nodes.find(n=>n.id===id)||null}
  function pathFor(id){
    const out=[];let cur=nodeById(id),guard=0;
    while(cur&&guard++<100){out.unshift(cur);cur=nodeById(cur.parent_id)}
    return out;
  }
  function subjectsOf(nodeId,activeOnly){
    const ids=new Set(state.links.filter(l=>l.node_id===nodeId).map(l=>l.subject_id));
    return state.subjects.filter(s=>ids.has(s.id)&&(!activeOnly||s.active))
      .sort((a,b)=>(Number(a.sort_order)-Number(b.sort_order))||a.name.localeCompare(b.name,'fr'));
  }
  function typeLabel(type){
    return ({pathway:'Parcours',level:'Niveau',group:'Groupe',series:'Série',class:'Classe',domain:'Domaine',formation:'Formation',year:'Année',semester:'Semestre',branch:'Branche',other:'Élément'})[type]||'Élément';
  }
  function filterNodeIds(){
    const q=state.search.trim().toLocaleLowerCase('fr-FR');
    if(!q)return null;
    const keep=new Set();
    state.nodes.forEach(n=>{
      const hay=[n.name,typeLabel(n.node_type)].concat(subjectsOf(n.id,false).map(s=>s.name)).join(' ').toLocaleLowerCase('fr-FR');
      if(hay.includes(q))pathFor(n.id).forEach(x=>keep.add(x.id));
    });
    return keep;
  }

  function showInlineActions(card,node){
    document.querySelectorAll('.parcours-node-actions').forEach(x=>x.remove());
    const box=document.createElement('div');
    box.className='parcours-node-actions';
    [['Modifier',()=>openNodeModal(node)],['Ajouter un enfant',()=>openNodeModal(null,node)],
      [node.active?'Désactiver':'Réactiver',()=>toggleNode(node)]].forEach(pair=>{
      const b=document.createElement('button');
      b.type='button';b.textContent=pair[0];
      b.addEventListener('click',()=>{box.remove();pair[1]();});
      box.appendChild(b);
    });
    card.appendChild(box);
  }
  function attachLongPress(el,fn){
    let timer=null;
    const clear=()=>{if(timer){clearTimeout(timer);timer=null}};
    el.addEventListener('pointerdown',e=>{
      if(e.pointerType==='mouse'&&e.button!==0)return;
      clear();timer=setTimeout(()=>{timer=null;fn();},560);
    });
    el.addEventListener('pointermove',clear);
    ['pointerup','pointercancel','pointerleave'].forEach(ev=>el.addEventListener(ev,clear));
  }
  function renderTreeNode(node,depth,filter){
    const children=childrenOf(node.id,true).filter(x=>!filter||filter.has(x.id));
    const opened=filter?true:state.expanded.has(node.id);
    const wrap=document.createElement('div');wrap.className='parcours-tree-branch';wrap.dataset.depth=String(depth);
    const card=document.createElement('div');card.className='parcours-node-card'+(state.selectedNodeId===node.id?' is-selected':'');card.dataset.nodeId=node.id;
    const toggle=document.createElement(children.length?'button':'span');
    toggle.className=children.length?'parcours-node-toggle':'parcours-node-toggle spacer';toggle.type='button';toggle.textContent=children.length?(opened?'−':'+'):'';
    if(children.length){
      toggle.setAttribute('aria-label',opened?'Réduire':'Développer');
      toggle.addEventListener('click',e=>{e.stopPropagation();if(opened)state.expanded.delete(node.id);else state.expanded.add(node.id);renderTree();});
    }
    const main=document.createElement('button');main.type='button';main.className='parcours-node-main';
    main.innerHTML='<span class="parcours-node-name">'+esc(node.name)+'</span><span class="parcours-node-meta"><span class="parcours-type-pill">'+esc(typeLabel(node.node_type))+'</span><span>'+children.length+' enfant'+(children.length>1?'s':'')+'</span><span>'+subjectsOf(node.id,true).length+' matière'+(subjectsOf(node.id,true).length>1?'s':'')+'</span></span>';
    main.addEventListener('click',()=>{state.selectedNodeId=node.id;renderTree();renderInspector();});
    const action=document.createElement('button');action.type='button';action.className='parcours-node-action';action.setAttribute('aria-label','Actions');action.textContent='⋯';
    action.addEventListener('click',e=>{e.stopPropagation();state.selectedNodeId=node.id;renderTree();renderInspector();showInlineActions(card,node);});
    card.append(toggle,main,action);
    attachLongPress(card,()=>{state.selectedNodeId=node.id;renderTree();renderInspector();showInlineActions(card,node);});
    wrap.appendChild(card);
    if(children.length&&opened){
      const childrenWrap=document.createElement('div');childrenWrap.className='parcours-tree-children';
      children.forEach(child=>childrenWrap.appendChild(renderTreeNode(child,depth+1,filter)));
      wrap.appendChild(childrenWrap);
    }
    return wrap;
  }
  function renderTree(){
    const root=document.getElementById('parcoursTreeRoot');if(!root)return;
    const filter=filterNodeIds();root.innerHTML='';
    state.nodes.filter(n=>!n.parent_id&&n.active)
      .sort((a,b)=>(Number(a.sort_order)-Number(b.sort_order))||a.name.localeCompare(b.name,'fr'))
      .forEach(rootNode=>root.appendChild(renderTreeNode(rootNode,0,filter)));
    if(!root.children.length)root.innerHTML='<div class="parcours-empty">Aucun parcours actif.</div>';
    applyTransform();
  }

  function renderInspector(){
    const el=document.getElementById('parcoursInspector');if(!el)return;
    const node=nodeById(state.selectedNodeId);
    if(!node){
      el.innerHTML='<div class="parcours-inspector-empty"><strong>Sélectionne une branche</strong><span>Appuie sur un nœud ou maintiens-le quelques instants pour afficher ses actions.</span></div>';
      return;
    }
    const kids=childrenOf(node.id,true),subs=subjectsOf(node.id,true),path=pathFor(node.id);
    el.innerHTML='<div class="parcours-inspector-head"><div><span class="parcours-kicker">Élément sélectionné</span><h4>'+esc(node.name)+'</h4><p>'+esc(typeLabel(node.node_type))+' · '+(node.active?'actif':'inactif')+'</p></div><div class="parcours-inspector-actions"><button type="button" class="admin-btn primary" id="parcoursEditSelected">Modifier</button><button type="button" class="admin-btn ghost" id="parcoursAddChildSelected">Ajouter</button></div></div><div class="parcours-breadcrumb">'+path.map(x=>'<span>'+esc(x.name)+'</span>').join('<b>›</b>')+'</div><div class="parcours-inspector-grid"><div><span class="parcours-kicker">Enfants</span><strong>'+kids.length+'</strong></div><div><span class="parcours-kicker">Matières actives</span><strong>'+subs.length+'</strong></div><div><span class="parcours-kicker">Source</span><strong>'+esc(node.source==='legacy'?'Catalogue actuel':'Administration')+'</strong></div></div><div class="parcours-inspector-block"><div class="parcours-block-head"><div><span class="parcours-kicker">Enfants directs</span><p>Chaque branche peut recevoir ses propres éléments.</p></div></div><div class="parcours-child-list">'+(kids.length?kids.map(x=>'<button type="button" class="parcours-child-row" data-jump="'+x.id+'"><span><strong>'+esc(x.name)+'</strong><small>'+esc(typeLabel(x.node_type))+'</small></span><span>›</span></button>').join(''):'<div class="parcours-empty">Aucun enfant actif.</div>')+'</div></div><div class="parcours-inspector-block"><div class="parcours-block-head"><div><span class="parcours-kicker">Matières associées</span><p>Active ou retire une matière de cette branche.</p></div></div><div class="parcours-subject-assign-search"><input id="parcoursAssignSearch" type="search" placeholder="Rechercher une matière…" value="'+esc(state.subjectSearch)+'"></div><div class="parcours-subject-checks" id="parcoursSubjectChecks"></div></div><div class="parcours-danger-line"><button type="button" class="admin-btn ghost" id="parcoursToggleSelected">'+(node.active?'Désactiver cet élément':'Réactiver cet élément')+'</button></div>';
    document.getElementById('parcoursEditSelected').onclick=()=>openNodeModal(node);
    document.getElementById('parcoursAddChildSelected').onclick=()=>openNodeModal(null,node);
    document.getElementById('parcoursToggleSelected').onclick=()=>toggleNode(node);
    el.querySelectorAll('[data-jump]').forEach(b=>b.addEventListener('click',()=>{state.selectedNodeId=b.dataset.jump;renderTree();renderInspector();}));
    const q=state.subjectSearch.trim().toLocaleLowerCase('fr-FR'),assigned=new Set(subs.map(s=>s.id));
    const checkWrap=document.getElementById('parcoursSubjectChecks');
    state.subjects.slice().sort((a,b)=>(Number(a.sort_order)-Number(b.sort_order))||a.name.localeCompare(b.name,'fr'))
      .filter(s=>!q||s.name.toLocaleLowerCase('fr-FR').includes(q)).forEach(subject=>{
        const label=document.createElement('label');label.className='parcours-subject-check'+(!subject.active?' is-inactive':'');
        const input=document.createElement('input');input.type='checkbox';input.checked=assigned.has(subject.id);input.disabled=!subject.active;
        input.addEventListener('change',()=>setSubjectLink(node.id,subject.id,input.checked));
        label.append(input,document.createTextNode(subject.name));checkWrap.appendChild(label);
      });
    if(!checkWrap.children.length)checkWrap.innerHTML='<div class="parcours-empty">Aucune matière correspondante.</div>';
    document.getElementById('parcoursAssignSearch').addEventListener('input',e=>{state.subjectSearch=e.target.value;renderInspector();});
  }

  async function setSubjectLink(nodeId,subjectId,checked){
    try{
      if(checked){
        const order=state.links.filter(l=>l.node_id===nodeId).length;
        await api('/rest/v1/'+LINK_TABLE,{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({node_id:nodeId,subject_id:subjectId,sort_order:order})},true);
      }else{
        await api('/rest/v1/'+LINK_TABLE+'?node_id=eq.'+encodeURIComponent(nodeId)+'&subject_id=eq.'+encodeURIComponent(subjectId),{method:'DELETE'},true);
      }
      await loadData();state.selectedNodeId=nodeId;renderInspector();status('Matières mises à jour.','ok');
    }catch(err){status('Association impossible : '+(err?.message||err),'error');renderInspector();}
  }

  function bucketFor(parent,type){
    if(!parent)return null;
    if(parent.node_type==='group')return type==='series'?'series':'troncCommuns';
    if(parent.node_type==='series')return 'classes';
    if(parent.node_type==='pathway'||parent.node_type==='level')return 'sousNiveaux';
    return 'enfants';
  }
  function compatOf(node){
    const metadata=node?.metadata&&typeof node.metadata==='object'?node.metadata:{};
    return metadata.compat&&typeof metadata.compat==='object'?{...metadata.compat}:{};
  }
  function descendantsOf(id){
    const out=new Set([id]);let changed=true;
    while(changed){
      changed=false;
      state.nodes.forEach(n=>{if(n.parent_id&&out.has(n.parent_id)&&!out.has(n.id)){out.add(n.id);changed=true;}});
    }
    return out;
  }
  function openNodeModal(node,parent){
    if(!isAdmin()){status('Cette gestion est réservée aux administrateurs.','error');return;}
    document.querySelectorAll('.parcours-modal-overlay').forEach(x=>x.remove());
    const overlay=document.createElement('div');overlay.className='parcours-modal-overlay';
    const box=document.createElement('div');box.className='parcours-modal';
    const editing=!!node,invalidParents=editing?descendantsOf(node.id):new Set();
    const parentId=editing?(node.parent_id||''):(parent?.id||'');
    const typeValue=node?.node_type||((parent?.node_type==='group')?'series':(parent?.node_type==='series'?'class':'branch'));
    const parents=state.nodes.slice().sort((a,b)=>(Number(a.sort_order)-Number(b.sort_order))||a.name.localeCompare(b.name,'fr')).filter(x=>x.active&&!invalidParents.has(x.id));
    box.innerHTML='<div class="parcours-modal-kicker">Gestion de parcours</div><h3>'+(editing?'Modifier un élément':'Ajouter un élément')+'</h3><p>La désactivation masque l’élément sans effacer les documents déjà classés.</p><div class="parcours-form"><label><span>Nom</span><input id="parcoursNodeName" maxlength="180" value="'+esc(node?.name||'')+'" autofocus></label><label><span>Type</span><select id="parcoursNodeType"><option value="pathway">Parcours</option><option value="level">Niveau</option><option value="group">Groupe</option><option value="series">Série</option><option value="class">Classe</option><option value="domain">Domaine</option><option value="formation">Formation</option><option value="year">Année</option><option value="semester">Semestre</option><option value="branch">Branche</option><option value="other">Élément</option></select></label><label><span>Parent</span><select id="parcoursNodeParent"><option value="">Racine</option>'+parents.map(x=>'<option value="'+x.id+'">'+esc(typeLabel(x.node_type))+' · '+esc(x.name)+'</option>').join('')+'</select></label><label><span>Description</span><textarea id="parcoursNodeDesc" maxlength="500">'+esc(compatOf(node).desc||'')+'</textarea></label><label><span>Ordre</span><input id="parcoursNodeOrder" type="number" min="0" max="9999" value="'+Number(node?.sort_order||0)+'"></label></div><div class="parcours-modal-actions"><button type="button" class="admin-btn ghost" id="parcoursModalCancel">Annuler</button><button type="button" class="admin-btn primary" id="parcoursModalSave">Enregistrer</button></div><div id="parcoursModalError" class="parcours-status error" hidden></div>';
    overlay.appendChild(box);document.body.appendChild(overlay);
    box.querySelector('#parcoursNodeType').value=typeValue;
    box.querySelector('#parcoursNodeParent').value=parentId;
    box.querySelector('#parcoursModalCancel').onclick=()=>overlay.remove();
    box.querySelector('#parcoursModalSave').onclick=async()=>{
      const name=box.querySelector('#parcoursNodeName').value.trim(),type=box.querySelector('#parcoursNodeType').value,parentValue=box.querySelector('#parcoursNodeParent').value||null,desc=box.querySelector('#parcoursNodeDesc').value.trim(),order=Math.max(0,Math.min(9999,Number(box.querySelector('#parcoursNodeOrder').value)||0)),er=box.querySelector('#parcoursModalError');
      er.hidden=true;
      if(!name){er.hidden=false;er.textContent='Le nom est obligatoire.';return;}
      if(node?.id&&parentValue===node.id){er.hidden=false;er.textContent='Un élément ne peut pas être son propre parent.';return;}
      try{
        const parentRow=parentValue?nodeById(parentValue):null,bucket=bucketFor(parentRow,type);
        if(editing){
          const compat={...compatOf(node),parent_bucket:bucket,desc};
          if(type==='group')compat.type='groupe';
          else if(type==='series')compat.type='serie';
          else if(type==='branch')compat.type='arbre';
          else if(['level','pathway','class','domain','formation','year','semester','other'].includes(type)&&['groupe','serie','arbre'].includes(compat.type))compat.type=null;
          await api('/rest/v1/'+NODE_TABLE+'?id=eq.'+encodeURIComponent(node.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({name,node_type:type,parent_id:parentValue,slug:slugify(name),sort_order:order,metadata:{...(node.metadata||{}),compat},updated_at:new Date().toISOString()})},true);
          state.selectedNodeId=node.id;
        }else{
          const id=uuid(),compat={legacy_id:null,type:type==='group'?'groupe':type==='series'?'serie':type==='branch'?'arbre':null,sigle:null,accent:null,desc,dbNiveaux:[],serie:null,parent_bucket:bucket};
          await api('/rest/v1/'+NODE_TABLE,{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({id,node_key:'admin:'+id,name,node_type:type,parent_id:parentValue,slug:slugify(name),sort_order:order,active:true,source:'admin',metadata:{compat}})},true);
          state.selectedNodeId=id;
        }
        overlay.remove();await loadData();status(editing?'Élément modifié.':'Élément ajouté.','ok');
      }catch(err){er.hidden=false;er.textContent='Enregistrement impossible : '+(err?.message||err);}
    };
  }
  async function toggleNode(node){
    if(!isAdmin())return;
    if(node.active&&!window.confirm('Désactiver « '+node.name+' » ? Les documents existants resteront conservés.'))return;
    try{
      await api('/rest/v1/'+NODE_TABLE+'?id=eq.'+encodeURIComponent(node.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:!node.active,updated_at:new Date().toISOString()})},true);
      await loadData();state.selectedNodeId=node.id;status('Élément '+(node.active?'désactivé':'réactivé')+'.','ok');
    }catch(err){status('Modification impossible : '+(err?.message||err),'error');}
  }

  function openSubjectModal(subject){
    if(!isAdmin()){status('Cette gestion est réservée aux administrateurs.','error');return;}
    document.querySelectorAll('.parcours-modal-overlay').forEach(x=>x.remove());
    const overlay=document.createElement('div');overlay.className='parcours-modal-overlay';
    const box=document.createElement('div');box.className='parcours-modal';
    box.innerHTML='<div class="parcours-modal-kicker">Référentiel des matières</div><h3>'+(subject?'Modifier la matière':'Ajouter une matière')+'</h3><p>La matière peut être associée à une ou plusieurs branches du parcours.</p><div class="parcours-form"><label><span>Nom</span><input id="parcoursSubjectName" maxlength="180" value="'+esc(subject?.name||'')+'" autofocus></label><label><span>Code court</span><input id="parcoursSubjectCode" maxlength="30" value="'+esc(subject?.code||'')+'"></label></div><div class="parcours-modal-actions"><button type="button" class="admin-btn ghost" id="parcoursModalCancel">Annuler</button><button type="button" class="admin-btn primary" id="parcoursModalSave">Enregistrer</button></div><div id="parcoursModalError" class="parcours-status error" hidden></div>';
    overlay.appendChild(box);document.body.appendChild(overlay);
    box.querySelector('#parcoursModalCancel').onclick=()=>overlay.remove();
    box.querySelector('#parcoursModalSave').onclick=async()=>{
      const name=box.querySelector('#parcoursSubjectName').value.trim(),code=box.querySelector('#parcoursSubjectCode').value.trim(),er=box.querySelector('#parcoursModalError');
      er.hidden=true;
      if(!name){er.hidden=false;er.textContent='Le nom est obligatoire.';return;}
      try{
        const payload={name,subject_key:slugify(name),code,updated_at:new Date().toISOString()};
        if(subject)await api('/rest/v1/'+SUBJECT_TABLE+'?id=eq.'+encodeURIComponent(subject.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(payload)},true);
        else await api('/rest/v1/'+SUBJECT_TABLE,{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({...payload,id:uuid(),sort_order:state.subjects.length,active:true,source:'admin',metadata:{}})},true);
        overlay.remove();await loadData();status(subject?'Matière modifiée.':'Matière ajoutée.','ok');
      }catch(err){er.hidden=false;er.textContent='Enregistrement impossible : '+(err?.message||err);}
    };
  }
  async function toggleSubject(subject){
    if(subject.active&&!window.confirm('Désactiver la matière « '+subject.name+' » ? Les associations seront conservées.'))return;
    try{
      await api('/rest/v1/'+SUBJECT_TABLE+'?id=eq.'+encodeURIComponent(subject.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({active:!subject.active,updated_at:new Date().toISOString()})},true);
      await loadData();status('Matière '+(subject.active?'désactivée':'réactivée')+'.','ok');
    }catch(err){status('Modification impossible : '+(err?.message||err),'error');}
  }

  function renderSubjects(){
    const list=document.getElementById('parcoursSubjectList');if(!list)return;
    const q=state.subjectSearch.trim().toLocaleLowerCase('fr-FR');
    const subjects=state.subjects.slice().sort((a,b)=>(Number(a.sort_order)-Number(b.sort_order))||a.name.localeCompare(b.name,'fr')).filter(s=>!q||(s.name+' '+(s.code||'')).toLocaleLowerCase('fr-FR').includes(q));
    list.innerHTML='';
    if(!subjects.length){list.innerHTML='<div class="parcours-empty">Aucune matière trouvée.</div>';return;}
    subjects.forEach(subject=>{
      const row=document.createElement('div');row.className='parcours-subject-row'+(!subject.active?' is-inactive':'');
      row.innerHTML='<div><strong>'+esc(subject.name)+'</strong><small>'+esc(subject.code||'Sans code')+' · '+(subject.active?'active':'inactive')+'</small></div><div class="parcours-subject-row-actions"><button type="button" class="admin-btn ghost" data-edit>Modifier</button><button type="button" class="admin-btn ghost" data-toggle>'+(subject.active?'Désactiver':'Réactiver')+'</button></div>';
      row.querySelector('[data-edit]').onclick=()=>openSubjectModal(subject);row.querySelector('[data-toggle]').onclick=()=>toggleSubject(subject);list.appendChild(row);
    });
  }

  function rebuildLegacyCatalog(){
    if(!state.loaded||!state.nodes.length)return;
    const activeNodes=state.nodes.filter(n=>n.active),activeSubjects=state.subjects.filter(s=>s.active),subjectById=new Map(activeSubjects.map(s=>[s.id,s])),linksByNode=new Map();
    activeNodes.forEach(n=>{});
    state.links.forEach(link=>{
      const subject=subjectById.get(link.subject_id);
      if(subject){if(!linksByNode.has(link.node_id))linksByNode.set(link.node_id,[]);linksByNode.get(link.node_id).push({nom:subject.name,mono:subject.code||subject.metadata?.mono||subject.name.slice(0,2)});}
    });
    const objects=new Map();
    activeNodes.forEach(n=>{
      const compat=compatOf(n),obj={id:compat.legacy_id||n.node_key,nom:n.name};
      if(compat.type)obj.type=compat.type;
      if(compat.sigle)obj.sigle=compat.sigle;
      if(compat.accent)obj.accent=compat.accent;
      if(compat.desc)obj.desc=compat.desc;
      if(Array.isArray(compat.dbNiveaux)&&compat.dbNiveaux.length)obj.dbNiveaux=compat.dbNiveaux.slice();
      if(compat.serie)obj.serie=compat.serie;
      const mats=linksByNode.get(n.id)||[];if(mats.length)obj.matieres=mats;
      objects.set(n.id,obj);
    });
    activeNodes.forEach(n=>{
      const parent=n.parent_id?objects.get(n.parent_id):null;if(!parent)return;
      const compat=compatOf(n);let bucket=compat.parent_bucket;
      if(!CHILD_BUCKETS.includes(bucket))bucket=bucketFor(n.parent_id?nodeById(n.parent_id):null,n.node_type)||'enfants';
      if(!Array.isArray(parent[bucket]))parent[bucket]=[];
      parent[bucket].push(objects.get(n.id));
    });
    const roots=activeNodes.filter(n=>!n.parent_id).map(n=>objects.get(n.id)).filter(Boolean);
    try{if(typeof NIVEAUX!=='undefined'&&Array.isArray(NIVEAUX))NIVEAUX.splice(0,NIVEAUX.length,...roots);}catch(_){}
    window.AURORE_CATALOG_NIVEAUX=roots;
    try{window.dispatchEvent(new CustomEvent('aurore:catalog-updated',{detail:{nodes:activeNodes.length,subjects:activeSubjects.length}}));}catch(_){}
  }

  async function loadData(){
    if(state.loading)return;
    state.loading=true;
    try{
      const admin=isAdmin();
      let nodesPath='/rest/v1/'+NODE_TABLE+'?select=*&order=sort_order.asc,created_at.asc';
      let subjectsPath='/rest/v1/'+SUBJECT_TABLE+'?select=*&order=sort_order.asc,name.asc';
      const linksPath='/rest/v1/'+LINK_TABLE+'?select=*';
      if(!admin){nodesPath+='&active=eq.true';subjectsPath+='&active=eq.true';}
      let nodes=await api(nodesPath,{},admin),subjects=await api(subjectsPath,{},admin),links=await api(linksPath,{},admin);
      if(admin&&Array.isArray(nodes)&&!nodes.length){
        status('Première initialisation : import de la structure actuelle du site…','info');
        await seedLegacy();
        nodes=await api(nodesPath,{},true);subjects=await api(subjectsPath,{},true);links=await api(linksPath,{},true);
      }
      state.nodes=Array.isArray(nodes)?nodes:[];state.subjects=Array.isArray(subjects)?subjects:[];state.links=Array.isArray(links)?links:[];state.loaded=true;
      state.nodes.filter(n=>!n.parent_id&&n.active).forEach(n=>state.expanded.add(n.id));
      rebuildLegacyCatalog();renderAll();status('', 'info');
    }catch(err){console.error('[Aurore parcours]',err);status('Impossible de charger le référentiel : '+(err?.message||err),'error');}
    finally{state.loading=false;}
  }

  function renderAll(){
    renderTree();renderInspector();renderSubjects();
    const active=state.nodes.filter(n=>n.active);
    const ids={
      parcoursStatBranches:active.filter(n=>['pathway','group','branch','domain','formation'].includes(n.node_type)).length,
      parcoursStatClasses:active.filter(n=>n.node_type==='class').length,
      parcoursStatSubjects:state.subjects.filter(s=>s.active).length,
      parcoursStatNodes:active.length,
      parcoursStatInactive:state.nodes.length-active.length,
      tabCountParcours:active.length
    };
    Object.keys(ids).forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=ids[id];});
    const importer=document.getElementById('parcoursImportLegacy');if(importer)importer.hidden=state.nodes.length>0;
  }
  function applyTransform(){
    const stage=document.getElementById('parcoursTreeStage');if(!stage)return;
    stage.style.transform='translate3d('+state.panX+'px,'+state.panY+'px,0) scale('+state.treeScale+')';
    const value=document.getElementById('parcoursZoomValue');if(value)value.textContent=Math.round(state.treeScale*100)+'%';
  }
  function zoom(delta,cx,cy){
    const old=state.treeScale,next=Math.max(.55,Math.min(1.65,old+delta));if(next===old)return;
    const ratio=next/old;state.panX=(Number(cx)||0)-(Number(cx||0)-state.panX)*ratio;state.panY=(Number(cy)||0)-(Number(cy||0)-state.panY)*ratio;state.treeScale=next;applyTransform();
  }
  function initPanZoom(){
    const vp=document.getElementById('parcoursTreeViewport');if(!vp||vp.dataset.ready==='1')return;vp.dataset.ready='1';
    const pointers=new Map();let sx=0,sy=0,p0x=0,p0y=0,d0=0,sc0=1;
    vp.addEventListener('pointerdown',e=>{
      if(e.target.closest('.parcours-node-card'))return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size===1){sx=e.clientX;sy=e.clientY;p0x=state.panX;p0y=state.panY;}
      if(pointers.size===2){const a=[...pointers.values()];d0=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1;sc0=state.treeScale;}
      try{vp.setPointerCapture(e.pointerId);}catch(_){}
    });
    vp.addEventListener('pointermove',e=>{
      if(!pointers.has(e.pointerId))return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size===1){state.panX=p0x+(e.clientX-sx);state.panY=p0y+(e.clientY-sy);applyTransform();}
      else{const a=[...pointers.values()],d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||d0;state.treeScale=Math.max(.55,Math.min(1.65,sc0*(d/d0)));applyTransform();}
    });
    const end=e=>{pointers.delete(e.pointerId);if(!pointers.size){try{vp.releasePointerCapture(e.pointerId);}catch(_){}}};
    vp.addEventListener('pointerup',end);vp.addEventListener('pointercancel',end);
    vp.addEventListener('wheel',e=>{e.preventDefault();const r=vp.getBoundingClientRect();zoom(e.deltaY>0?-0.08:0.08,e.clientX-r.left,e.clientY-r.top);},{passive:false});
    document.getElementById('parcoursZoomOut')?.addEventListener('click',()=>zoom(-0.1));
    document.getElementById('parcoursZoomIn')?.addEventListener('click',()=>zoom(0.1));
    document.getElementById('parcoursZoomReset')?.addEventListener('click',()=>{state.treeScale=1;state.panX=0;state.panY=0;applyTransform();});
  }
  function initUI(){
    const panel=document.getElementById('auroreParcoursAdmin');if(!panel||panel.dataset.ready==='1')return;panel.dataset.ready='1';
    document.getElementById('parcoursSearch')?.addEventListener('input',e=>{state.search=e.target.value;renderTree();});
    document.getElementById('parcoursSubjectSearch')?.addEventListener('input',e=>{state.subjectSearch=e.target.value;renderSubjects();renderInspector();});
    document.getElementById('parcoursAddRoot')?.addEventListener('click',()=>openNodeModal());
    document.getElementById('parcoursAddSubject')?.addEventListener('click',()=>openSubjectModal());
    document.getElementById('parcoursRefresh')?.addEventListener('click',loadData);
    document.getElementById('parcoursImportLegacy')?.addEventListener('click',async()=>{
      try{
        if(!isAdmin())throw new Error('Cette action est réservée aux administrateurs.');
        const rows=await api('/rest/v1/'+NODE_TABLE+'?select=id&limit=1',{},true);
        if(rows?.length){status('Le référentiel contient déjà des éléments : import initial déjà effectué.','info');return;}
        await seedLegacy();await loadData();status('Structure actuelle importée.','ok');
      }catch(err){status('Import impossible : '+(err?.message||err),'error');}
    });
    initPanZoom();
    const parcoursTab=document.querySelector('.admin-tab[data-tab="parcours"]');
    parcoursTab?.addEventListener('click',()=>{setTimeout(()=>{if(isAdmin())loadData();},0);});
  }
  function init(){initUI();loadData();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();