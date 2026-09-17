
(function(){
  const COLOR_THEME_KEY='auraster-color-theme';
  const VALID_COLOR_THEMES=['violet','rouge','vert','bleu','jaune','orange','cyan','rose','indigo','turquoise','emeraude','lime','sarcelle','magenta','fuchsia','corail','bordeaux','pourpre','prune','or','ambre','menthe','azur','lavande','safran'];

  function appliquerCouleurSite(choix){
    if(!VALID_COLOR_THEMES.includes(choix)) choix='violet';
    document.documentElement.setAttribute('data-color-theme',choix);
    try{localStorage.setItem(COLOR_THEME_KEY,choix);}catch(e){}
    document.querySelectorAll('.profile-theme-option, .theme-color-swatch').forEach(btn=>{
      btn.setAttribute('aria-pressed',btn.dataset.colorChoice===choix?'true':'false');
    });
    const noms={violet:'Violet',rouge:'Rouge',vert:'Vert',bleu:'Bleu',jaune:'Jaune',orange:'Orange',cyan:'Cyan',rose:'Rose',indigo:'Indigo',turquoise:'Turquoise',emeraude:'Émeraude',lime:'Citron vert',sarcelle:'Sarcelle',magenta:'Magenta',fuchsia:'Fuchsia',corail:'Corail',bordeaux:'Bordeaux',pourpre:'Pourpre',prune:'Prune',or:'Or',ambre:'Ambre',menthe:'Menthe',azur:'Azur',lavande:'Lavande',safran:'Safran'};
    const label=document.getElementById('profileThemeCurrent');
    if(label) label.textContent=noms[choix]||'Violet';
    const flyoutLabel=document.getElementById('colorThemeFlyoutCurrent');
    if(flyoutLabel) flyoutLabel.textContent=noms[choix]||'Violet';
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta){
      const couleurs={
        violet:'#6D28D9',rouge:'#B91C1C',vert:'#15803D',
        bleu:'#1D4ED8',jaune:'#B77900',orange:'#C85C0D',cyan:'#0E7490',rose:'#BE185D',
        indigo:'#4338CA',turquoise:'#0F766E',emeraude:'#047857',lime:'#65A30D',sarcelle:'#0F766E',magenta:'#C026D3',fuchsia:'#A21CAF',corail:'#E85D4A',bordeaux:'#8B1E3F',pourpre:'#7E22CE',prune:'#6B21A8',or:'#B7791F',ambre:'#D97706',menthe:'#059669',azur:'#0369A1',lavande:'#7C3AED',safran:'#CA8A04'
      };
      meta.setAttribute('content',couleurs[choix]||couleurs.violet);
    }
  }

  // ---- Panneau glissant "Couleur du site", ancré près du sélecteur de thème ----
  function fermerFlyoutCouleur(){
    const flyout=document.getElementById('colorThemeFlyout');
    const bouton=document.getElementById('colorThemeBtn');
    if(flyout){ flyout.classList.remove('open'); flyout.setAttribute('aria-hidden','true'); }
    if(bouton) bouton.setAttribute('aria-expanded','false');
  }
  function ouvrirFlyoutCouleur(){
    const flyout=document.getElementById('colorThemeFlyout');
    const bouton=document.getElementById('colorThemeBtn');
    if(flyout){ flyout.classList.add('open'); flyout.setAttribute('aria-hidden','false'); }
    if(bouton) bouton.setAttribute('aria-expanded','true');
  }
  function initFlyoutCouleur(){
    const bouton=document.getElementById('colorThemeBtn');
    const flyout=document.getElementById('colorThemeFlyout');
    if(!bouton || !flyout) return;
    bouton.addEventListener('click',(e)=>{
      e.stopPropagation();
      if(flyout.classList.contains('open')) fermerFlyoutCouleur();
      else ouvrirFlyoutCouleur();
    });
    // Un choix de couleur referme immédiatement le panneau.
    flyout.querySelectorAll('.theme-color-swatch').forEach(btn=>{
      btn.addEventListener('click',()=>{ fermerFlyoutCouleur(); });
    });
    document.addEventListener('click',(e)=>{
      if(!flyout.classList.contains('open')) return;
      if(flyout.contains(e.target) || bouton.contains(e.target)) return;
      fermerFlyoutCouleur();
    });
    document.addEventListener('keydown',(e)=>{
      if(e.key==='Escape') fermerFlyoutCouleur();
    });
  }

  function init(){
    const boutons=document.querySelectorAll('.profile-theme-option, .theme-color-swatch');
    boutons.forEach(btn=>btn.addEventListener('click',()=>appliquerCouleurSite(btn.dataset.colorChoice)));
    initFlyoutCouleur();
    // Depuis la page Profil, un raccourci fait remonter la page et ouvre
    // directement le panneau glissant du sélecteur de couleurs.
    document.getElementById('profileOuvrirCouleurs')?.addEventListener('click',()=>{
      window.scrollTo({top:0,behavior:'smooth'});
      setTimeout(ouvrirFlyoutCouleur, 320);
    });
    let choix='violet';
    try{choix=localStorage.getItem(COLOR_THEME_KEY)||'violet';}catch(e){}
    appliquerCouleurSite(choix);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
