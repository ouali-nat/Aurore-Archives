(function(){'use strict';
function init(){
 const cf=document.querySelector('.admin-tab-panel[data-panel="content-factory"]');
 const form=document.getElementById('cfAdminCreateForm');
 const grid=document.querySelector('.admin-category-grid');
 if(!cf||!form||!grid||document.getElementById('admin-tab-aurora-request'))return;
 const card=document.createElement('button');
 card.type='button';card.className='admin-tab admin-category-card';card.dataset.tab='aurora-request';card.setAttribute('role','tab');
 card.innerHTML='<span aria-hidden="true" class="admin-category-icon">✦</span><span class="admin-category-title">Demande de production</span><span class="admin-category-desc">Préparer une nouvelle ressource Aurore</span>';
 grid.appendChild(card);
 const panel=document.createElement('div');
 panel.className='admin-tab-panel';panel.dataset.panel='aurora-request';panel.id='admin-tab-aurora-request';
 panel.innerHTML='<div class="aurora-request-head"><span class="admin-overview-kicker">Aurore</span><h3>Demande de production</h3><p>Prépare une ressource à produire. La demande est ensuite transmise au circuit Aurore et reste soumise au contrôle humain.</p></div><div id="auroraRequestFormHost"></div>';
 cf.parentNode.insertBefore(panel,cf);
 document.getElementById('auroraRequestFormHost').appendChild(form.closest('.cf-create-box')||form);
 function show(target){
   document.querySelectorAll('.admin-tab-panel').forEach(p=>p.style.display=p===target?'block':'none');
   document.querySelectorAll('.admin-tab').forEach(b=>b.classList.toggle('active',b===card));
 }
 card.addEventListener('click',function(){show(panel)});
 const cfCard=document.querySelector('.admin-tab[data-tab="content-factory"]');
 if(cfCard)cfCard.addEventListener('click',function(){show(cf)});
 const style=document.createElement('style');style.id='aurora-admin-separation-v1';style.textContent='.aurora-request-head{margin-bottom:16px;padding:20px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:18px;background:color-mix(in srgb,currentColor 3%,transparent)}.aurora-request-head h3{margin:4px 0 6px}.aurora-request-head p{margin:0;max-width:760px;font-size:.76rem;line-height:1.5;opacity:.7}.aurora-request-head .admin-overview-kicker{font-size:.62rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase;opacity:.55}#admin-tab-aurora-request .cf-create-box{margin-top:0}';
 document.head.appendChild(style);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();