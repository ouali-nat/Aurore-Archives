
(function(){
  let bound=false;
  function openModal(){
    const m=document.getElementById('aurore-history-confirm-modal');
    if(!m)return;
    m.classList.add('show');
    document.getElementById('auroreHistoryConfirmCancel')?.focus();
  }
  function closeModal(){
    document.getElementById('aurore-history-confirm-modal')?.classList.remove('show');
  }
  async function clear(){
    const btn=document.getElementById('auroreHistoryConfirmOk');
    if(btn){btn.disabled=true;btn.textContent='Suppression…';}
    try{
      if(typeof window.effacerToutHistoriqueTelechargements!=='function'){
        throw new Error('fonction indisponible');
      }
      const ok=await window.effacerToutHistoriqueTelechargements();
      if(!ok)throw new Error('suppression refusée');
      closeModal();
      if(typeof window.afficherCarteNotificationTelechargement==='function'){
        window.afficherCarteNotificationTelechargement('Historique des téléchargements effacé');
      }
    }catch(e){
      console.error('[Aurore] effacement historique',e);
      closeModal();
      const box=document.getElementById('personalDownloadsHistory');
      if(box)box.insertAdjacentHTML('afterbegin','<div class="personal-empty activity-error">Impossible d’effacer l’historique pour le moment. Vos données ont été conservées.</div>');
    }finally{
      if(btn){btn.disabled=false;btn.textContent='Effacer l’historique';}
    }
  }
  function bind(){
    const b=document.getElementById('personalClearDownloads');
    if(!b)return;
    if(!bound){
      bound=true;
      b.addEventListener('click',e=>{e.preventDefault();openModal();});
      document.getElementById('auroreHistoryConfirmCancel')?.addEventListener('click',closeModal);
      document.getElementById('auroreHistoryConfirmOk')?.addEventListener('click',clear);
      document.getElementById('aurore-history-confirm-modal')?.addEventListener('click',e=>{
        if(e.target.id==='aurore-history-confirm-modal')closeModal();
      });
    }
  }
  document.addEventListener('DOMContentLoaded',bind);
  setInterval(bind,800);
})();
