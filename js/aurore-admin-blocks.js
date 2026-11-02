/* Gestion locale des blocs du tableau de bord : ordre et visibilité, sans toucher aux données métier. */
(function(){
  'use strict';
  const KEY='aurore_admin_dashboard_blocks_v1';
  const grid=document.getElementById('adminCategoryGrid');
  if(!grid)return;
  let state={order:[],hidden:[]};
  try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');state={order:Array.isArray(saved.order)?saved.order:[],hidden:Array.isArray(saved.hidden)?saved.hidden:[]};}catch(_){}
  const hiddenSet=new Set(state.hidden);
  // Deux indicateurs complémentaires reprennent les compteurs réels déjà chargés par l'administration.
  function synchroniserCompteur(sourceId,targetId){
    const source=document.getElementById(sourceId),target=document.getElementById(targetId);
    if(source&&target&&target.textContent!==source.textContent)target.textContent=source.textContent;
  }
  function synchroniserStatistiques(){
    synchroniserCompteur('tabCountAttente','statDocumentsAttente');
    synchroniserCompteur('tabCountPublies','statDocumentsPublies');
  }
  synchroniserStatistiques();
  const compteurObserver=new MutationObserver(synchroniserStatistiques);
  ['tabCountAttente','tabCountPublies'].forEach(id=>{const node=document.getElementById(id);if(node)compteurObserver.observe(node,{childList:true,characterData:true,subtree:true});});
  const toolbar=document.createElement('div');toolbar.className='admin-dashboard-tools';
  const showBtn=document.createElement('button');showBtn.type='button';showBtn.className='admin-show-hidden';showBtn.textContent='Afficher les éléments masqués';showBtn.hidden=false;
  const hiddenList=document.createElement('div');hiddenList.className='admin-hidden-list';hiddenList.hidden=true;
  toolbar.appendChild(showBtn);
  const statsGrid=grid.parentNode.querySelector('.stats-grid');
  if(statsGrid)statsGrid.parentNode.insertBefore(toolbar,statsGrid);
  else grid.parentNode.insertBefore(toolbar,grid);
  toolbar.parentNode.insertBefore(hiddenList,toolbar.nextSibling);

  function persist(){
    state.order=Array.from(grid.querySelectorAll(':scope > .admin-category-item')).map(w=>w.dataset.blockKey).filter(Boolean);
    state.hidden=Array.from(hiddenSet);
    try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_){}
  }
  function labelOf(card){return card.querySelector('.admin-category-title')?.textContent?.trim()||card.dataset.tab||'Bloc';}
  function syncVisibility(){
    grid.querySelectorAll(':scope > .admin-category-item').forEach(w=>{w.hidden=hiddenSet.has(w.dataset.blockKey)||!!w.querySelector('.admin-category-card')?.hidden;});
    renderHidden();
  }
  function renderHidden(){
    hiddenList.replaceChildren();
    const items=Array.from(grid.querySelectorAll(':scope > .admin-category-item')).filter(w=>hiddenSet.has(w.dataset.blockKey));
    showBtn.hidden=false;
    showBtn.textContent=items.length?'Afficher les éléments masqués ('+items.length+')':'Afficher les éléments masqués';
    if(!items.length){const empty=document.createElement('div');empty.className='admin-hidden-item';empty.textContent='Aucun bloc masqué pour le moment.';hiddenList.appendChild(empty);}
    items.forEach(w=>{
      const row=document.createElement('div');row.className='admin-hidden-item';
      const name=document.createElement('strong');name.textContent=labelOf(w.querySelector('.admin-category-card'));
      const restore=document.createElement('button');restore.type='button';restore.textContent='Réafficher';
      restore.addEventListener('click',()=>{hiddenSet.delete(w.dataset.blockKey);persist();syncVisibility();});
      row.append(name,restore);hiddenList.appendChild(row);
    });
  }
  showBtn.addEventListener('click',()=>{hiddenList.hidden=!hiddenList.hidden;showBtn.setAttribute('aria-expanded',String(!hiddenList.hidden));});

  function moveTo(wrapper){
    const all=Array.from(grid.querySelectorAll(':scope > .admin-category-item'));
    const current=all.indexOf(wrapper)+1;
    const raw=window.prompt('Nouvelle position du bloc (1 à '+all.length+') :',String(current));
    if(raw===null)return;
    const position=Number.parseInt(raw,10);
    if(!Number.isInteger(position)||position<1||position>all.length){window.alert('Indique une position comprise entre 1 et '+all.length+'.');return;}
    const others=all.filter(x=>x!==wrapper);
    const before=others[position-1]||null;
    grid.insertBefore(wrapper,before);
    persist();syncVisibility();
  }
  function wrapCard(card){
    if(!card||card.dataset.managedBlock==='1')return;
    const key=card.dataset.tab||card.id||'bloc-'+Math.random().toString(36).slice(2,8);
    const wrapper=document.createElement('div');wrapper.className='admin-category-item';wrapper.dataset.blockKey=key;wrapper.setAttribute('role','presentation');
    card.parentNode.insertBefore(wrapper,card);wrapper.appendChild(card);card.dataset.managedBlock='1';
    const trigger=document.createElement('button');trigger.type='button';trigger.className='admin-block-menu-trigger';trigger.setAttribute('aria-label','Options du bloc '+labelOf(card));trigger.setAttribute('aria-expanded','false');trigger.textContent='⋯';
    const menu=document.createElement('div');menu.className='admin-block-menu';menu.hidden=true;
    const hide=document.createElement('button');hide.type='button';hide.textContent='Masquer ce bloc';
    hide.addEventListener('click',()=>{hiddenSet.add(key);menu.hidden=true;trigger.setAttribute('aria-expanded','false');persist();syncVisibility();});
    const move=document.createElement('button');move.type='button';move.textContent='Déplacer à la position…';
    move.addEventListener('click',()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');moveTo(wrapper);});
    menu.append(hide,move);
    trigger.addEventListener('click',e=>{e.stopPropagation();const open=menu.hidden;grid.querySelectorAll('.admin-block-menu').forEach(m=>m.hidden=true);grid.querySelectorAll('.admin-block-menu-trigger').forEach(b=>b.setAttribute('aria-expanded','false'));menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));});
    wrapper.append(trigger,menu);
    if(!state.order.includes(key))state.order.push(key);
  }
  let arranging=false;
  function arrange(){
    if(arranging)return;
    arranging=true;
    try{
      Array.from(grid.children).filter(el=>el.matches('.admin-category-card')).forEach(wrapCard);
      const wrappers=Array.from(grid.querySelectorAll(':scope > .admin-category-item'));
      const sorted=wrappers.slice().sort((a,b)=>{const ai=state.order.indexOf(a.dataset.blockKey),bi=state.order.indexOf(b.dataset.blockKey);return (ai<0?9999:ai)-(bi<0?9999:bi);});
      if(sorted.some((w,i)=>w!==wrappers[i]))sorted.forEach(w=>grid.appendChild(w));
      syncVisibility();
    }finally{arranging=false;}
  }
  arrange();
  const observer=new MutationObserver(()=>arrange());
  observer.observe(grid,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  document.addEventListener('click',e=>{if(!e.target.closest('.admin-category-item')){grid.querySelectorAll('.admin-block-menu').forEach(m=>m.hidden=true);grid.querySelectorAll('.admin-block-menu-trigger').forEach(b=>b.setAttribute('aria-expanded','false'));}});
  window.addEventListener('storage',e=>{if(e.key!==KEY)return;try{const v=JSON.parse(e.newValue||'{}');state={order:Array.isArray(v.order)?v.order:[],hidden:Array.isArray(v.hidden)?v.hidden:[]};hiddenSet.clear();state.hidden.forEach(k=>hiddenSet.add(k));arrange();}catch(_){}});
})();
