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
 panel.innerHTML='<div class="aurora-request-head"><span class="admin-overview-kicker">Aurore · édition</span><h3>Espace éditorial ChatGPT</h3><p>Le site gère les demandes et les validations. ChatGPT récupère les tâches directement via le connecteur Supabase et effectue le travail éditorial dans la conversation dédiée.</p></div><div id="auroraRequestFormHost"></div>';
 cf.parentNode.insertBefore(panel,cf);
 function show(target){
   const detail=document.getElementById('adminDetail');
   if(detail)detail.style.display='block';
   document.querySelectorAll('.admin-tab-panel').forEach(p=>p.style.display=p===target?'block':'none');
   document.querySelectorAll('.admin-tab').forEach(b=>b.classList.toggle('active',b===card));
 }
 card.addEventListener('click',()=>show(panel));
 const cfCard=document.querySelector('.admin-tab[data-tab="content-factory"]');
 if(cfCard)cfCard.addEventListener('click',()=>show(cf));
 const style=document.createElement('style');style.id='aurora-admin-separation-v2';style.textContent='.aurora-request-head{margin-bottom:16px;padding:20px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:18px;background:color-mix(in srgb,currentColor 3%,transparent)}.aurora-request-head h3{margin:4px 0 6px}.aurora-request-head p{margin:0;max-width:820px;font-size:.76rem;line-height:1.5;opacity:.7}';
 document.head.appendChild(style);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();