(function(){'use strict';
function init(){
 const cf=document.querySelector('.admin-tab-panel[data-panel="content-factory"]');
 const form=document.getElementById('cfAdminCreateForm');
 const grid=document.querySelector('.admin-category-grid');
 if(!cf||!grid||document.getElementById('admin-tab-aurora-request'))return;
 const legacyBox=form?.closest('.cf-create-box');
 if(legacyBox){
   legacyBox.hidden=true;
   legacyBox.setAttribute('data-legacy-editor-hidden','true');
 }
 const card=document.createElement('button');
 card.type='button';card.className='admin-tab admin-category-card';card.dataset.tab='aurora-request';card.setAttribute('role','tab');
 card.innerHTML='<span aria-hidden="true" class="admin-category-icon">✦</span><span class="admin-category-title">Espace éditorial ChatGPT</span><span class="admin-category-desc">Créer, organiser et valider les demandes</span>';
 grid.appendChild(card);
 const panel=document.createElement('div');
 panel.className='admin-tab-panel';panel.dataset.panel='aurora-request';panel.id='admin-tab-aurora-request';
 panel.innerHTML='<div class="aurora-request-head"><div><span class="admin-overview-kicker">Aurore · édition</span><h3>Espace éditorial ChatGPT</h3></div><nav class="aurora-editorial-nav" aria-label="Navigation éditoriale"><button type="button" class="aurora-editorial-nav-item active" data-editorial-nav="workspace">Espace éditorial</button><button type="button" class="aurora-editorial-nav-item" data-editorial-nav="documents">Documents à prendre en charge</button></nav></div><div id="auroraRequestFormHost"></div>';
 cf.parentNode.insertBefore(panel,cf);
 function show(target){
   const detail=document.getElementById('adminDetail');
   if(detail)detail.style.display='block';
   document.querySelectorAll('.admin-tab-panel').forEach(p=>p.style.display=p===target?'block':'none');
   document.querySelectorAll('.admin-tab').forEach(b=>b.classList.toggle('active',b===card));
 }
 card.addEventListener('click',()=>show(panel));
 const editorialNav=(target)=>{
   const buttons=panel.querySelectorAll('[data-editorial-nav]');
   buttons.forEach(b=>b.classList.toggle('active',b.dataset.editorialNav===target));
   if(target!=='documents')return;
   const documentTab=[...document.querySelectorAll('.admin-tab')].find(b=>/documents?\s+(en\s+attente|à\s+prendre\s+en\s+charge)/i.test((b.textContent||'').trim()));
   if(documentTab){documentTab.click();return;}
   const pendingPanel=document.querySelector('.admin-tab-panel[data-panel="attente"],.admin-tab-panel[data-panel="documents"]');
   if(pendingPanel)show(pendingPanel);
 };
 panel.querySelectorAll('[data-editorial-nav]').forEach(b=>b.addEventListener('click',()=>editorialNav(b.dataset.editorialNav)));
 const cfCard=document.querySelector('.admin-tab[data-tab="content-factory"]');
 if(cfCard)cfCard.addEventListener('click',()=>show(cf));
 const style=document.createElement('style');style.id='aurora-admin-separation-v3';style.textContent='.aurora-request-head{margin-bottom:16px;padding:18px 20px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:18px;background:var(--admin-panel-bg,color-mix(in srgb,currentColor 3%,transparent));display:flex;align-items:center;justify-content:space-between;gap:18px}.aurora-request-head h3{margin:4px 0 0}.aurora-editorial-nav{display:flex;gap:5px;align-items:center;padding:4px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:12px;background:color-mix(in srgb,currentColor 4%,transparent);overflow:auto}.aurora-editorial-nav-item{border:0;border-radius:9px;padding:8px 11px;background:transparent;color:inherit;font:inherit;font-size:.66rem;font-weight:800;white-space:nowrap;cursor:pointer;opacity:.68}.aurora-editorial-nav-item:hover,.aurora-editorial-nav-item.active{background:var(--admin-card-bg,color-mix(in srgb,currentColor 8%,transparent));opacity:1}@media(max-width:720px){.aurora-request-head{display:block}.aurora-editorial-nav{margin-top:12px;width:100%}.aurora-editorial-nav-item{flex:1}}';
 document.head.appendChild(style);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();