(function(){
  const COLOR_THEME_KEY='auraster-color-theme';
  const VALID_COLOR_THEMES=["violet","rouge","vert","bleu","orange","rose","indigo","emeraude","lime","corail","bordeaux","azur","petrole-cuivre","nuit-peche","prune-rouge","terre-orange","rose-sable","sarcelle-creme"];

  // Noms courts : une seule couleur dominante par choix (celle de la pastille).
  const NOMS={"violet":"Violet","rouge":"Rouge","vert":"Vert","bleu":"Bleu","orange":"Orange","rose":"Rose","indigo":"Indigo","emeraude":"Émeraude","lime":"Citron vert","corail":"Corail","bordeaux":"Bordeaux","azur":"Azur","petrole-cuivre":"Pétrole","nuit-peche":"Nuit","prune-rouge":"Prune","terre-orange":"Orange terre","rose-sable":"Rose poudré","sarcelle-creme":"Sarcelle"};

  function fermerFlyoutCouleur(){
    const flyout=document.getElementById('colorThemeFlyout');
    const bouton=document.getElementById('colorThemeBtn');
    if(flyout){ flyout.classList.remove('open'); flyout.setAttribute('aria-hidden','true'); }
    if(bouton) bouton.setAttribute('aria-expanded','false');
  }

  function appliquerCouleurSite(choix){
    if(!VALID_COLOR_THEMES.includes(choix)) choix='violet';
    const root=document.documentElement;
    // Panneau fermé d'abord, puis transitions coupées le temps du changement :
    // sinon des centaines d'éléments animent fond/ombre/clip-path en même temps
    // et l'application de la couleur paraît lente.
    fermerFlyoutCouleur();
    root.classList.add('color-switching');
    root.setAttribute('data-color-theme',choix);
    const fin=()=>root.classList.remove('color-switching');
    requestAnimationFrame(()=>requestAnimationFrame(fin));
    setTimeout(fin,800);
    try{localStorage.setItem(COLOR_THEME_KEY,choix);}catch(e){}
    document.querySelectorAll('.profile-theme-option, .theme-color-swatch').forEach(btn=>{
      btn.setAttribute('aria-pressed',btn.dataset.colorChoice===choix?'true':'false');
    });
    const label=document.getElementById('profileThemeCurrent');
    if(label) label.textContent=NOMS[choix]||'Violet';
    const flyoutLabel=document.getElementById('colorThemeFlyoutCurrent');
    if(flyoutLabel) flyoutLabel.textContent=NOMS[choix]||'Violet';
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta){
      const couleurs={"violet":"#6D28D9","rouge":"#B91C1C","vert":"#15803D","bleu":"#1D4ED8","orange":"#C85C0D","rose":"#BE185D","indigo":"#4338CA","emeraude":"#047857","lime":"#65A30D","corail":"#E85D4A","bordeaux":"#8B1E3F","azur":"#0369A1","petrole-cuivre":"#104C64","nuit-peche":"#242F49","prune-rouge":"#341A2C","terre-orange":"#E57A2D","rose-sable":"#EFC1B5","sarcelle-creme":"#0D6B70"};
      meta.setAttribute('content',couleurs[choix]||couleurs.violet);
    }
  }

  // ---- Panneau glissant "Couleur du site", ancré près du sélecteur de thème ----
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

  // Correctifs de cohérence (palette lisible, mots du hero, rapidité).
  function injectThemeFixes(){
    if(document.getElementById('aurore-color-theme-fixes')) return;
    const style=document.createElement('style');
    style.id='aurore-color-theme-fixes';
    // 1) Les 6 palettes mixtes avaient des pastilles à 6 teintes en dégradé :
    //    on n'affiche plus qu'UNE couleur (la dominante réellement appliquée au site).
    //    L'anneau gris garde visibles les teintes très sombres ou très claires.
    const MIXTES={'petrole-cuivre':'#104C64','nuit-peche':'#242F49','prune-rouge':'#341A2C','terre-orange':'#E57A2D','rose-sable':'#EFC1B5','sarcelle-creme':'#0D6B70'};
    let css='';
    Object.keys(MIXTES).forEach(k=>{
      css+='.theme-color-swatch[data-color-choice="'+k+'"],.profile-theme-option[data-color-choice="'+k+'"] .profile-theme-swatch{background:'+MIXTES[k]+'!important;}\n';
      css+='.theme-color-swatch[data-color-choice="'+k+'"]:not([aria-pressed="true"]){box-shadow:0 0 0 1px rgba(150,150,160,.6),0 3px 8px rgba(0,0,0,.18)!important;}\n';
    });
    // 2) Mots du hero : le mot d'accent et l'étiquette suivent la couleur choisie
    //    (avant : violet fixe en mode clair, crème pour les palettes à fond clair).
    css+='html[data-color-theme]{--hero-word-light:var(--theme-strong);--hero-word-dark:color-mix(in srgb,var(--theme-secondary) 86%,#fff);}\n';
    const MOTS={ // [mode clair, mode sombre]
      'petrole-cuivre':['#104C64','#D59D80'],
      'nuit-peche':['#3B4F7E','#FFA586'],
      'prune-rouge':['#7A2F63','#E4586A'],
      'terre-orange':['#C5600F','#F0954F'],
      'rose-sable':['#B5705C','#EFC1B5'],
      'sarcelle-creme':['#0D6B70','#3FB8BE']
    };
    Object.keys(MOTS).forEach(k=>{
      css+='html[data-color-theme="'+k+'"]{--hero-word-light:'+MOTS[k][0]+';--hero-word-dark:'+MOTS[k][1]+';}\n';
    });
    const H='#screen-home .hero.aurore-hero-morph';
    css+='html[data-color-theme][data-theme="light"] '+H+' h1 .accentword,html[data-color-theme][data-theme="light"] .hero .accentword{color:var(--hero-word-light)!important;-webkit-text-fill-color:var(--hero-word-light)!important;background:none!important;}\n';
    css+='html[data-color-theme][data-theme="dark"] '+H+' h1 .accentword,html[data-color-theme][data-theme="dark"] .hero .accentword{color:var(--hero-word-dark)!important;-webkit-text-fill-color:var(--hero-word-dark)!important;background:none!important;}\n';
    css+='html[data-color-theme][data-theme="light"] '+H+' .eyebrow{color:var(--hero-word-light)!important;}\n';
    css+='html[data-color-theme][data-theme="dark"] '+H+' .eyebrow{color:var(--hero-word-dark)!important;}\n';
    // 3) Rapidité : aucune transition pendant le changement de couleur.
    css+='html.color-switching *,html.color-switching *::before,html.color-switching *::after{transition:none!important;}\n';
    style.textContent=css;
    document.head.appendChild(style);
  }

  function init(){
    injectColorPickerDesign();
    injectThemeFixes();
    // Les titres au survol reprennent les noms courts.
    document.querySelectorAll('.theme-color-swatch').forEach(btn=>{
      const n=NOMS[btn.dataset.colorChoice]; if(n) btn.setAttribute('title',n);
    });
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
