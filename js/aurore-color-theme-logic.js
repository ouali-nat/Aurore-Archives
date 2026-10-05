(function(){
  const COLOR_THEME_KEY='auraster-color-theme';
  const VALID_COLOR_THEMES=['violet','rouge','vert','bleu','jaune','orange','cyan','rose','indigo','turquoise','emeraude','lime','sarcelle','magenta','fuchsia','corail','bordeaux','pourpre','prune','or','ambre','menthe','azur','lavande','safran'];

  // Couleur réellement appliquée au site (= --theme-primary) pour chaque choix.
  // Les pastilles de la palette sont des aplats de cette couleur : ce qu'on voit
  // est exactement ce qui sera appliqué (plus de dégradés qui « mêlent » deux teintes).
  const PALETTE={
    violet:'#8B5CF6',rouge:'#DC2626',vert:'#2FA66A',bleu:'#3B82F6',jaune:'#D5A51B',orange:'#E8791A',
    cyan:'#0891B2',rose:'#DB2777',indigo:'#6366F1',turquoise:'#14B8A6',emeraude:'#10B981',lime:'#84CC16',
    sarcelle:'#0D9488',magenta:'#D946EF',fuchsia:'#C026D3',corail:'#F06A57',bordeaux:'#9F1239',
    pourpre:'#9333EA',prune:'#7E22CE',or:'#B8860B',ambre:'#F59E0B',menthe:'#34D399',azur:'#0EA5E9',
    lavande:'#A78BFA',safran:'#EAB308'
  };

  function fermerFlyoutCouleur(){
    const flyout=document.getElementById('colorThemeFlyout');
    const bouton=document.getElementById('colorThemeBtn');
    if(flyout){ flyout.classList.remove('open'); flyout.setAttribute('aria-hidden','true'); }
    if(bouton) bouton.setAttribute('aria-expanded','false');
  }

  function appliquerCouleurSite(choix){
    if(!VALID_COLOR_THEMES.includes(choix)) choix='violet';
    const root=document.documentElement;
    // Palette fermée d'abord (moins de pixels à repeindre), puis transitions
    // coupées le temps du changement : sinon des centaines d'éléments animent
    // leur fond/ombre en même temps, ce qui rend l'application lente.
    fermerFlyoutCouleur();
    root.classList.add('color-switching');
    root.setAttribute('data-color-theme',choix);
    const fin=()=>root.classList.remove('color-switching');
    requestAnimationFrame(()=>requestAnimationFrame(fin));
    setTimeout(fin,1000);
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
        indigo:'#4338CA',turquoise:'#0F766E',emeraude:'#047857',lime:'#65A30D',sarcelle:'#0F766E',magenta:'#C026D3',fuchsia:'#A21CAF',corail:'#E85D4A',bordeaux:'#8B1E3F',pourpre:'#7E22CE',prune:'#6B21A8',or:'#8A6508',ambre:'#D97706',menthe:'#059669',azur:'#0369A1',lavande:'#7C3AED',safran:'#CA8A04'
      };
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

  // Correctifs de cohérence : pastilles unies, couleurs jumelles distinguées,
  // éléments du hero / liens / cartes qui restaient violets en mode clair,
  // et coupure des transitions pendant le changement de couleur.
  function injectThemeFixes(){
    if(document.getElementById('aurore-color-theme-fixes')) return;
    const style=document.createElement('style');
    style.id='aurore-color-theme-fixes';
    // Spécificité : deux :not(#…) donnent le poids d'un ID, nécessaire pour passer
    // devant les règles génériques du mode clair (aurore-theme-foundation.css).
    const L='html[data-color-theme][data-theme="light"]:not(#aurTf1):not(#aurTf2)';
    let css='';
    // 1) Pastilles : aplat de la couleur réellement appliquée.
    Object.keys(PALETTE).forEach(k=>{
      css+='.theme-color-swatch[data-color-choice="'+k+'"],.profile-theme-option[data-color-choice="'+k+'"] .profile-theme-swatch{background:'+PALETTE[k]+'!important;}\n';
    });
    // 2) Couleurs qui se confondaient (mêmes teintes) : violet/lavande, émeraude/menthe, jaune/or.
    css+='html[data-color-theme="lavande"]{--theme-primary:#A78BFA;--theme-secondary:#DDD6FE;--theme-strong:#7C3AED;}\n';
    css+='html[data-color-theme="menthe"]{--theme-primary:#34D399;--theme-secondary:#A7F3D0;--theme-strong:#059669;}\n';
    css+='html[data-color-theme="or"]{--theme-primary:#B8860B;--theme-secondary:#E6C35C;--theme-strong:#8A6508;}\n';
    // 3) Hero : mots d'accent et filet suivent la couleur choisie en mode clair.
    css+='html[data-color-theme][data-theme="light"] #screen-home .hero.aurore-hero-morph h1 .accentword{color:var(--theme-strong)!important;-webkit-text-fill-color:var(--theme-strong)!important;background:none!important;}\n';
    css+='html[data-color-theme][data-theme="light"] .hero .accentword{color:var(--theme-strong)!important;-webkit-text-fill-color:var(--theme-strong)!important;}\n';
    css+='html[data-color-theme][data-theme="light"] .hero .hero-rule{background:linear-gradient(90deg,var(--theme-strong),var(--theme-secondary))!important;}\n';
    // 4) Mode clair : liens, fil d\'Ariane, cartes, boutons et blocs qui gardaient le violet fixe.
    css+=L+' a,'+L+' .link,'+L+' .breadcrumb button,'+L+' .breadcrumb-btn{color:var(--theme-strong)!important;}\n';
    css+=L+' .sublevel-card,'+L+' .structure-pill,'+L+' .home-choice,'+L+' .shortcut-btn,'+L+' .breadcrumb-btn,'+L+' .admin-tab.active{border-color:var(--theme-primary)!important;}\n';
    css+=L+' .structure-pill,'+L+' .home-choice,'+L+' .shortcut-btn,'+L+' .breadcrumb-btn,'+L+' .admin-tab.active{background:var(--theme-soft)!important;}\n';
    css+=L+' .go,'+L+' .btn-primary,'+L+' .btn-deposer,'+L+' .admin-btn.primary,'+L+' .access-btn{border-color:var(--theme-strong)!important;}\n';
    css+=L+' .btn-primary,'+L+' .btn-deposer,'+L+' .access-btn{background:var(--theme-primary)!important;}\n';
    css+=L+' .upload-progress{background:var(--theme-soft)!important;border-color:var(--theme-primary)!important;}\n';
    css+=L+' .service-client-card{background:linear-gradient(135deg,color-mix(in srgb,var(--theme-primary) 7%,#fff),#fff)!important;border-color:var(--theme-border)!important;}\n';
    css+=L+' .service-client-link{border-color:var(--theme-border)!important;}\n';
    css+=L+' .service-client-kicker,'+L+' .service-client-link span{color:var(--theme-strong)!important;}\n';
    // 5) Rapidité : aucune transition pendant le changement de couleur.
    css+='html.color-switching *,html.color-switching *::before,html.color-switching *::after{transition:none!important;}\n';
    style.textContent=css;
    document.head.appendChild(style);
  }

  function init(){
    injectColorPickerDesign();
    injectThemeFixes();
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
