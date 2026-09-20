
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

  // Présentation uniquement visuelle : les couleurs deviennent de petits
  // carrés nets et compacts, sans modifier les boutons ni la logique de choix.
  function injectColorPickerDesign(){
    if(document.getElementById('aurore-color-picker-design')) return;
    const style=document.createElement('style');
    style.id='aurore-color-picker-design';
    style.textContent=`
      .color-theme-flyout{
        min-width:248px!important;
        padding:12px!important;
        border-radius:18px!important;
        border:1px solid var(--theme-border,var(--bordure))!important;
        background:color-mix(in srgb,var(--papier) 96%,var(--theme-primary,#8B5CF6) 4%)!important;
        box-shadow:0 18px 46px rgba(0,0,0,.28),0 0 0 1px color-mix(in srgb,var(--theme-primary,#8B5CF6) 7%,transparent)!important;
        backdrop-filter:blur(16px);
      }
      .color-theme-flyout-head{
        display:flex!important;
        align-items:center!important;
        justify-content:space-between!important;
        gap:12px!important;
        padding:2px 2px 10px!important;
        margin-bottom:2px!important;
        border-bottom:1px solid color-mix(in srgb,var(--bordure) 75%,transparent)!important;
      }
      .color-theme-flyout-head span{font-size:.68rem!important;font-weight:800!important;letter-spacing:.08em!important;text-transform:uppercase!important;color:var(--gris)!important;}
      .color-theme-flyout-head strong{font-size:.68rem!important;font-weight:800!important;color:var(--theme-primary,#8B5CF6)!important;}
      .color-theme-flyout-scroll{
        display:grid!important;
        grid-template-columns:repeat(6,minmax(0,1fr))!important;
        gap:8px!important;
        max-height:250px!important;
        overflow-y:auto!important;
        padding:8px 2px 3px!important;
      }
      .theme-color-swatch{
        appearance:none!important;
        width:28px!important;
        height:28px!important;
        min-width:28px!important;
        min-height:28px!important;
        justify-self:center!important;
        border-radius:7px!important;
        border:2px solid color-mix(in srgb,#fff 18%,transparent)!important;
        box-shadow:0 3px 8px rgba(0,0,0,.18),inset 0 0 0 1px rgba(255,255,255,.10)!important;
        transform:none!important;
        cursor:pointer!important;
        position:relative!important;
        transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease!important;
      }
      .theme-color-swatch:hover{transform:translateY(-2px) scale(1.04)!important;border-color:rgba(255,255,255,.78)!important;box-shadow:0 6px 13px rgba(0,0,0,.24),inset 0 0 0 1px rgba(255,255,255,.16)!important;}
      .theme-color-swatch:focus-visible{outline:2px solid var(--theme-primary,#8B5CF6)!important;outline-offset:3px!important;}
      .theme-color-swatch[aria-pressed="true"]{border-color:#fff!important;box-shadow:0 0 0 2px var(--theme-primary,#8B5CF6),0 5px 13px rgba(0,0,0,.24)!important;}
      .theme-color-swatch[aria-pressed="true"]::after{content:'✓';position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:.72rem;font-weight:900;text-shadow:0 1px 3px rgba(0,0,0,.5);}
      @media(max-width:430px){
        .color-theme-flyout{min-width:220px!important;padding:10px!important;}
        .color-theme-flyout-scroll{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:7px!important;}
        .theme-color-swatch{width:27px!important;height:27px!important;min-width:27px!important;min-height:27px!important;}
      }
    `;
    document.head.appendChild(style);
  }

  function init(){
    injectColorPickerDesign();
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
