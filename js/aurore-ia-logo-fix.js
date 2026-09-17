/* Aurora — synchronisation du logo réel avec le système de logo du site. */
(function(){
  'use strict';

  function getLogoUrl(){
    try {
      var stored=sessionStorage.getItem('aurore_logo_url');
      if(stored) return stored;
    } catch(_){}
    try {
      if(typeof window.AURORE_LOGO_URL==='function') return window.AURORE_LOGO_URL();
    } catch(_){}
    return 'https://pub-0433751d08eb49fcafb7355ef0bf42ab.r2.dev/site-logo-auraster';
  }

  function apply(){
    var url=getLogoUrl();
    if(!url) return;
    document.querySelectorAll('#auroreIAMark,.aurore-ia-welcome-mark,.aurore-ia-history-item-avatar,.aurore-ia-msg-avatar').forEach(function(container){
      if(!container || container.dataset.auroreLogoApplied==='1') return;
      var img=new Image();
      img.decoding='async';
      img.loading='eager';
      img.alt='';
      img.onload=function(){
        container.replaceChildren(img);
        container.dataset.auroreLogoApplied='1';
      };
      img.onerror=function(){
        container.dataset.auroreLogoApplied='0';
      };
      img.src=url;
    });
  }

  function start(){
    apply();
    [250,750,1500,3000].forEach(function(delay){ setTimeout(apply,delay); });
    try { new MutationObserver(apply).observe(document.body,{childList:true,subtree:true}); } catch(_){}
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
