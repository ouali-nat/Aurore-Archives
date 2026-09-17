
(function(){
  'use strict';
  var deferredPrompt=null;
  var installBtn=document.getElementById('pwaInstallBtn');
  var hint=document.getElementById('pwaInstallHint');
  var hintBtn=document.getElementById('pwaInstallHintBtn');
  function estInstallee(){return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;}
  function afficher(){if(estInstallee())return;if(installBtn)installBtn.style.display='inline-flex';}
  function masquer(){if(installBtn)installBtn.style.display='none';if(hint)hint.style.display='none';}
  function lancerInstallation(){
    if(!deferredPrompt){
      if(hint)hint.style.display='block';
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function(){deferredPrompt=null;masquer();}).catch(function(){deferredPrompt=null;});
  }
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferredPrompt=e;afficher();});
  window.addEventListener('appinstalled',function(){deferredPrompt=null;masquer();});
  if(installBtn)installBtn.addEventListener('click',lancerInstallation);
  if(hintBtn)hintBtn.addEventListener('click',function(){lancerInstallation();});
  if(!estInstallee()) setTimeout(function(){if(deferredPrompt)afficher();},1200);
  if('serviceWorker' in navigator){
    window.addEventListener('load',function(){
      navigator.serviceWorker.getRegistrations().then(function(regs){
        return Promise.all(regs.map(function(reg){ return reg.unregister(); }));
      }).catch(function(){ return []; }).then(function(){
        return navigator.serviceWorker.register('./sw.js?v=20260907', {scope:'./', updateViaCache:'none'});
      }).then(function(reg){
        console.log('[Aurore PWA] Service worker actif.',reg.scope);
      }).catch(function(err){console.warn('[Aurore PWA] Service worker indisponible :',err);});
    });
  }
})();
