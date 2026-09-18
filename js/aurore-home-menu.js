(function(){
  'use strict';
  const btn=document.getElementById('auroreHomeMenuBtn');
  const menu=document.getElementById('auroreHomeMenu');
  const historyBtn=document.getElementById('auroreHomeHistory');
  const resizeBtn=document.getElementById('auroreHomeResize');
  if(!btn||!menu)return;

  function ouvrir(){
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden','false');
    btn.setAttribute('aria-expanded','true');
  }
  function fermer(){
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden','true');
    btn.setAttribute('aria-expanded','false');
  }
  function ouvrirAurora(){
    if(typeof window.auroreOuvrirIA==='function') window.auroreOuvrirIA();
    else document.getElementById('auroreIAHeaderBtn')?.click();
  }
  function attendreAurora(fn){
    ouvrirAurora();
    let essais=0;
    const verifier=()=>{
      const e=document.getElementById('screen-aurore-ia');
      if(e?.classList.contains('active')||e?.classList.contains('is-mini')){fn();return;}
      if(++essais<20)requestAnimationFrame(verifier);
    };
    requestAnimationFrame(verifier);
  }
  btn.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    if(menu.classList.contains('is-open'))fermer();else ouvrir();
  });
  historyBtn?.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    fermer();
    attendreAurora(()=>document.getElementById('auroreIAMenuBtn')?.click());
  });
  resizeBtn?.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    fermer();
    attendreAurora(()=>{
      if(typeof window.auroreReduireIA==='function') window.auroreReduireIA();
      else document.getElementById('auroreIAMinimize')?.click();
    });
  });
  document.addEventListener('click',e=>{
    if(menu.classList.contains('is-open')&&!menu.contains(e.target)&&!btn.contains(e.target))fermer();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.classList.contains('is-open'))fermer();});
})();
