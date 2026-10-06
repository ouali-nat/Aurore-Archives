/* Aurore — synchronisation des barres système mobile avec le thème du site. */
(function(){
  'use strict';
  function meta(name){
    return document.querySelector('meta[name="'+name+'"]');
  }
  function couleurTheme(){
    const root=document.documentElement;
    const css=getComputedStyle(root);
    const sombre=root.getAttribute('data-theme')==='dark';
    const forte=(css.getPropertyValue('--theme-strong')||'').trim();
    const primaire=(css.getPropertyValue('--theme-primary')||'').trim();
    const fond=(css.getPropertyValue('--fond')||'').trim();
    const fallback=document.querySelector('meta[name="theme-color"]')?.getAttribute('content')||'#090812';
    return {sombre,forte:forte||primaire||fallback,primaire:primaire||forte||fallback,fond:fond||fallback};
  }
  // Application Android (Capacitor) : la barre d'état native suit la couleur du thème.
  // Sans effet dans le navigateur ou si le plugin StatusBar n'est pas installé.
  function barreEtatNative(c){
    try{
      const cap=window.Capacitor;
      if(!cap||!cap.isNativePlatform||!cap.isNativePlatform())return;
      const sb=(cap.Plugins&&cap.Plugins.StatusBar)||null;
      if(!sb)return;
      if(sb.setBackgroundColor&&/^#[0-9a-f]{6}$/i.test(c.forte))sb.setBackgroundColor({color:c.forte});
      if(sb.setStyle)sb.setStyle({style:'DARK'});
    }catch(_){}
  }
  function synchroniser(){
    try{
      const c=couleurTheme();
      const theme=meta('theme-color');
      if(theme)theme.setAttribute('content',c.forte);
      const scheme=meta('color-scheme');
      if(scheme)scheme.setAttribute('content',c.sombre?'dark light':'light dark');
      const apple=meta('apple-mobile-web-app-status-bar-style');
      if(apple)apple.setAttribute('content',c.sombre?'black-translucent':'default');
      document.documentElement.style.setProperty('color-scheme',c.sombre?'dark':'light');
      barreEtatNative(c);
    }catch(_){}
  }
  const observer=new MutationObserver((mutations)=>{
    if(mutations.some(m=>m.type==='attributes'&&(m.attributeName==='data-theme'||m.attributeName==='data-color-theme'))){
      requestAnimationFrame(synchroniser);
    }
  });
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-color-theme']});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',synchroniser,{once:true});
  else synchroniser();
  window.addEventListener('pageshow',synchroniser,{passive:true});
})();
