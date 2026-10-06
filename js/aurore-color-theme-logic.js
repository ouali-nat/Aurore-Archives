(function(){
  const COLOR_THEME_KEY='auraster-color-theme';

  // Palette finale : 13 couleurs d'origine conservées (différence nette entre elles)
  // + 5 nuances nouvelles, toutes à plus de ~28 de distance perceptuelle (ΔE Lab) des autres.
  const VALID_COLOR_THEMES=["violet","rouge","vert","bleu","orange","rose","lime","bordeaux","azur","jaune","olive","chocolat","sauge","magenta","petrole-cuivre","prune-rouge","rose-sable","sarcelle-creme"];

  // Couleurs retirées car trop proches d'une autre (ΔE < 18) → équivalent conservé.
  // Un ancien choix enregistré est converti automatiquement.
  const RETIREES={"indigo":"violet","emeraude":"vert","corail":"rouge","terre-orange":"orange","nuit-peche":"petrole-cuivre"};

  // Nouvelles nuances : [primaire, secondaire, forte]
  const NOUVELLES={
    jaune:['#D9A406','#FCD34D','#8A6100'],
    olive:['#6B7A2A','#A7B85F','#4A5520'],
    chocolat:['#8A4A1C','#D49A6A','#5C300F'],
    sauge:['#6E9A7E','#B5D3BF','#4A7A5C'],
    magenta:['#D946EF','#F0ABFC','#A21CAF']
  };

  // Noms courts : une seule couleur dominante par choix (celle de la pastille).
  const NOMS={"violet":"Violet","rouge":"Rouge","vert":"Vert","bleu":"Bleu","orange":"Orange","rose":"Rose","lime":"Citron vert","bordeaux":"Bordeaux","azur":"Azur","jaune":"Jaune","olive":"Olive","chocolat":"Chocolat","sauge":"Sauge","magenta":"Magenta","petrole-cuivre":"Pétrole","prune-rouge":"Prune","rose-sable":"Rose poudré","sarcelle-creme":"Sarcelle"};

  const META={"violet":"#6D28D9","rouge":"#B91C1C","vert":"#15803D","bleu":"#1D4ED8","orange":"#C85C0D","rose":"#BE185D","lime":"#65A30D","bordeaux":"#8B1E3F","azur":"#0369A1","jaune":"#A87B05","olive":"#4A5520","chocolat":"#5C300F","sauge":"#4A7A5C","magenta":"#A21CAF","petrole-cuivre":"#104C64","prune-rouge":"#341A2C","rose-sable":"#EFC1B5","sarcelle-creme":"#0D6B70"};

  function fermerFlyoutCouleur(){
    const flyout=document.getElementById('colorThemeFlyout');
    const bouton=document.getElementById('colorThemeBtn');
    if(flyout){ flyout.classList.remove('open'); flyout.setAttribute('aria-hidden','true'); }
    if(bouton) bouton.setAttribute('aria-expanded','false');
  }

  function appliquerCouleurSite(choix){
    if(RETIREES[choix]) choix=RETIREES[choix];
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
    if(meta) meta.setAttribute('content',META[choix]||META.violet);
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

  // Met la liste des pastilles en accord avec la palette finale :
  // retire les couleurs trop proches, ajoute les nouvelles nuances.
  function synchroniserPastilles(){
    Object.keys(RETIREES).forEach(k=>{
      document.querySelectorAll('[data-color-choice="'+k+'"]').forEach(b=>b.remove());
    });
    const zone=document.getElementById('colorThemeFlyoutScroll');
    if(!zone) return;
    const avant=zone.querySelector('[data-color-choice="petrole-cuivre"]');
    Object.keys(NOUVELLES).forEach(k=>{
      if(zone.querySelector('[data-color-choice="'+k+'"]')) return;
      const b=document.createElement('button');
      b.type='button';
      b.className='theme-color-swatch';
      b.setAttribute('aria-pressed','false');
      b.setAttribute('data-color-choice',k);
      b.setAttribute('title',NOMS[k]);
      zone.insertBefore(b,avant||null);
    });
    // Titres au survol = noms courts.
    zone.querySelectorAll('.theme-color-swatch').forEach(btn=>{
      const n=NOMS[btn.dataset.colorChoice]; if(n) btn.setAttribute('title',n);
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

  // Correctifs de cohérence (palette lisible, mots du hero, rapidité, nouvelles nuances).
  function injectThemeFixes(){
    if(document.getElementById('aurore-color-theme-fixes')) return;
    const style=document.createElement('style');
    style.id='aurore-color-theme-fixes';
    let css='';

    // 1) Nouvelles nuances : variables de thème + pastille dégradée comme les autres couleurs simples.
    Object.keys(NOUVELLES).forEach(k=>{
      const c=NOUVELLES[k];
      css+='html[data-color-theme="'+k+'"]{--theme-primary:'+c[0]+';--theme-secondary:'+c[1]+';--theme-strong:'+c[2]+';}\n';
      css+='.theme-color-swatch[data-color-choice="'+k+'"]{background:linear-gradient(135deg,'+c[2]+','+c[1]+')!important;}\n';
    });

    // 2) Palettes mixtes restantes : pastille à UNE couleur (la dominante réellement appliquée).
    //    L'anneau gris garde visibles les teintes très sombres ou très claires.
    const MIXTES={'petrole-cuivre':'#104C64','prune-rouge':'#341A2C','rose-sable':'#EFC1B5','sarcelle-creme':'#0D6B70'};
    Object.keys(MIXTES).forEach(k=>{
      css+='.theme-color-swatch[data-color-choice="'+k+'"],.profile-theme-option[data-color-choice="'+k+'"] .profile-theme-swatch{background:'+MIXTES[k]+'!important;}\n';
      css+='.theme-color-swatch[data-color-choice="'+k+'"]:not([aria-pressed="true"]){box-shadow:0 0 0 1px rgba(150,150,160,.6),0 3px 8px rgba(0,0,0,.18)!important;}\n';
    });

    // 3) Lisibilité en mode sombre : Pétrole et Prune étaient presque invisibles sur fond
    //    sombre (liens, bordures, accents). Teintes éclaircies en mode sombre uniquement.
    css+='html[data-color-theme="petrole-cuivre"][data-theme="dark"]{--theme-primary:#3A9BC1;--theme-strong:#1B6E92;}\n';
    css+='html[data-color-theme="prune-rouge"][data-theme="dark"]{--theme-primary:#B5456F;--theme-secondary:#E4586A;--theme-strong:#8E2F57;}\n';

    // 4) Mots du hero : le mot d'accent et l'étiquette suivent la couleur choisie
    //    (avant : violet fixe en mode clair, crème pour les palettes à fond clair).
    css+='html[data-color-theme]{--hero-word-light:var(--theme-strong);--hero-word-dark:color-mix(in srgb,var(--theme-secondary) 86%,#fff);}\n';
    const MOTS={ // [mode clair, mode sombre]
      'petrole-cuivre':['#104C64','#D59D80'],
      'prune-rouge':['#7A2F63','#E4586A'],
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

    // 5) Rapidité : aucune transition pendant le changement de couleur.
    css+='html.color-switching *,html.color-switching *::before,html.color-switching *::after{transition:none!important;}\n';
    style.textContent=css;
    document.head.appendChild(style);
  }

  function init(){
    injectColorPickerDesign();
    injectThemeFixes();
    synchroniserPastilles();
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
