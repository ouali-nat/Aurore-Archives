(function(){'use strict';function init(){const hero=document.querySelector('#screen-home .hero');if(!hero||hero.dataset.auroreHeroMorphReady==='1')return;hero.dataset.auroreHeroMorphReady='1';hero.classList.add('aurore-hero-morph');
function p(x,y){return Math.max(2,Math.min(98,x)).toFixed(2)+'% '+Math.max(2,Math.min(98,y)).toFixed(2)+'%'}
function poly(sides,round,rotation){const r=47,rad=rotation*Math.PI/180,v=[];for(let i=0;i<sides;i++){const a=rad+2*Math.PI*i/sides;v.push({x:50+r*Math.cos(a),y:50+r*Math.sin(a)})}const n=Math.max(1,Math.round(24/sides));const pts=[];for(let i=0;i<sides;i++){const a=v[(i+sides-1)%sides],c=v[i],b=v[(i+1)%sides],q={x:c.x+(a.x-c.x)*round,y:c.y+(a.y-c.y)*round},z={x:c.x+(b.x-c.x)*round,y:c.y+(b.y-c.y)*round};for(let j=0;j<n;j++){const t=j/n,m=1-t;pts.push(p(m*m*q.x+2*m*t*c.x+t*t*z.x,m*m*q.y+2*m*t*c.y+t*t*z.y))}}while(pts.length<24)pts.push(pts[pts.length-1]);return pts.slice(0,24).join(',')}
function bubbles(lobes,baseR,amp,width,rotation){const pts=[];for(let i=0;i<24;i++){const theta=rotation+i*(360/24),rad=theta*Math.PI/180;let bump=0;for(let L=0;L<lobes;L++){const lobeAngle=rotation+L*(360/lobes);let diff=((theta-lobeAngle+540)%360)-180;bump+=Math.exp(-(diff*diff)/(2*width*width))}const r=baseR+amp*bump;pts.push(p(50+r*Math.cos(rad),50+r*Math.sin(rad)))}return pts.join(',')}
const shapes=[
  {name:'circle',gen:function(){return poly(24,0,-90)}},
  {name:'triangle',gen:function(){return poly(3,.24,-90)}},
  {name:'square',gen:function(){return poly(4,.22,-45)}},
  {name:'cube',gen:function(){return poly(4,.12,-45)}},
  {name:'hexagon',gen:function(){return poly(6,.18,-90)}},
  {name:'octagon',gen:function(){return poly(8,.15,-90)}},
  {name:'dodecagon',gen:function(){return poly(12,.11,-90)}},
  {name:'polygon24',gen:function(){return poly(24,0,-90)}},
  {name:'drop',gen:function(){return poly(3,.28,-90)}},
  {name:'leaf',gen:function(){return poly(4,.42,-18)}},
  {name:'bubbles3',gen:function(){return bubbles(3,30,17,26,-90)}},
  {name:'bubbles5',gen:function(){return bubbles(5,32,13,20,-90)}},
  {name:'bubbles7',gen:function(){return bubbles(7,34,10,15,0)}}
];
let index=0,timer=0,cycles=0;const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
function apply(){const s=shapes[index];hero.dataset.shape=s.name;hero.style.setProperty('--hero-clip','polygon('+s.gen()+')');index=(index+1)%shapes.length}

/* --- Séparation du bandeau en 3 blocs distincts, qui animent puis fusionnent --- */
/* Rythme morphing : 1 s de transition + 0,3 s de respiration entre deux formes. */
const motif=hero.querySelector('.hero-motif');
if(motif&&!motif.querySelector('.hero-split-blob')){
  [1,2,3].forEach(function(n){
    const wrap=document.createElement('div');
    wrap.className='hero-split-blob';
    wrap.setAttribute('data-b',String(n));
    const core=document.createElement('div');
    core.className='hero-split-blob-core';
    wrap.appendChild(core);
    motif.appendChild(wrap);
  });
}
let splitTimerA=0,splitTimerB=0;
function splitAndMerge(){
  if(reduce.matches||document.hidden||!motif)return;
  hero.classList.add('is-split');
  clearTimeout(splitTimerA);
  splitTimerA=setTimeout(function(){hero.classList.add('is-floating')},1000);
  clearTimeout(splitTimerB);
  splitTimerB=setTimeout(function(){hero.classList.remove('is-floating');hero.classList.remove('is-split')},1000+2200);
}

/* --- Fin de cycle : une goutte d'eau écrit « Aurore » lettre après lettre en rebondissant --- */
/* Après la dernière forme, le bloc revient en cercle, puis une goutte tombe, éclabousse et
   « écrit » chaque lettre (révélation de gauche à droite + petit rebond), rebondit vers la
   lettre suivante, et ainsi de suite. Le mot reste affiché ~1,5 s puis s'efface en fondu,
   et le cycle de formes reprend. Aucun effet si « réduire les animations » est activé. */
const MOT='Aurore';
function injecterStyleEcriture(){
  if(document.getElementById('aurore-hero-write-style'))return;
  const s=document.createElement('style');s.id='aurore-hero-write-style';
  s.textContent=
    '.hero-aurore-write{position:absolute;left:0;right:0;top:0;bottom:0;z-index:6;display:flex;align-items:center;justify-content:center;pointer-events:none}'+
    '.hw-cell{position:relative;display:inline-block;padding:0 .015em}'+
    '.hw-letter{display:inline-block;font-family:"Snell Roundhand","Segoe Script","Brush Script MT","Lucida Handwriting","Apple Chancery","URW Chancery L",cursive;font-style:italic;font-weight:700;font-size:clamp(3.2rem,19vw,7.5rem);line-height:1.1;color:var(--hero-write-color,#fff);text-shadow:0 4px 18px rgba(0,0,0,.28),0 0 22px rgba(255,255,255,.35);clip-path:inset(-30% 100% -30% -10%);transform-origin:50% 100%;will-change:transform,clip-path}'+
    '.hw-drop{position:absolute;left:0;top:0;width:16px;height:22px;margin:-11px 0 0 -8px;border-radius:50% 50% 50% 50%/62% 62% 38% 38%;background:radial-gradient(circle at 35% 30%,#fff 0,#fff 10%,#c4ecff 30%,#58b8ff 72%,#1f84d8 100%);box-shadow:0 0 12px rgba(120,200,255,.75);opacity:0;will-change:transform}'+
    '.hw-ripple{position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;border:2px solid rgba(196,236,255,.95);opacity:0}'+
    '.aurore-hero-morph .hero-inner{transition:opacity .45s ease}'+
    '.aurore-hero-morph.is-writing .hero-inner{opacity:.08}'+
    '@media (prefers-reduced-motion:reduce){.hero-aurore-write{display:none}}';
  (document.head||document.documentElement).appendChild(s);
}
function ecrireAurore(){
  return new Promise(function(done){
    if(reduce.matches||document.hidden){done();return}
    injecterStyleEcriture();
    const ov=document.createElement('div');ov.className='hero-aurore-write';ov.setAttribute('aria-hidden','true');
    const cells=[],letters=[];
    MOT.split('').forEach(function(ch){
      const c=document.createElement('span');c.className='hw-cell';
      const l=document.createElement('span');l.className='hw-letter';l.textContent=ch;
      c.appendChild(l);ov.appendChild(c);cells.push(c);letters.push(l);
    });
    const drop=document.createElement('div');drop.className='hw-drop';ov.appendChild(drop);
    hero.appendChild(ov);hero.classList.add('is-writing');
    let fini=false;
    function terminer(){
      if(fini)return;fini=true;
      hero.classList.remove('is-writing');
      try{ov.remove()}catch(e){}
      done();
    }
    const securite=setTimeout(terminer,12000);
    function A(el,kf,opt){
      try{const a=el.animate(kf,Object.assign({fill:'forwards'},opt));return a.finished.catch(function(){})}
      catch(e){return Promise.resolve()}
    }
    function tr(x,y,sx,sy){return 'translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px) scale('+sx+','+sy+')'}
    function pause(ms){return new Promise(function(r){setTimeout(r,ms)})}
    function ripple(x,y){
      const r=document.createElement('div');r.className='hw-ripple';r.style.left=x+'px';r.style.top=y+'px';ov.appendChild(r);
      A(r,[{transform:'scale(1,.35)',opacity:.95},{transform:'scale(9,3)',opacity:0}],{duration:650,easing:'ease-out'}).then(function(){try{r.remove()}catch(e){}});
    }
    function ecrireLettre(i){
      const l=letters[i];
      A(l,[{clipPath:'inset(-30% 100% -30% -10%)',transform:'translateY(-6px) scale(1,1)'},{clipPath:'inset(-30% -30% -30% -10%)',transform:'translateY(0) scale(1,1)'}],{duration:340,easing:'cubic-bezier(.3,.7,.3,1)'})
        .then(function(){return rebond(i)});
    }
    function rebond(i){
      return A(letters[i],[
        {transform:'translateY(0) scale(1,1)'},
        {transform:'translateY(-16px) scale(.94,1.08)',offset:.3},
        {transform:'translateY(0) scale(1.08,.9)',offset:.55},
        {transform:'translateY(-5px) scale(.98,1.03)',offset:.78},
        {transform:'translateY(0) scale(1,1)'}
      ],{duration:620,easing:'ease-out'});
    }
    (async function(){
      try{
        await pause(60);
        /* Positions en unités de mise en page (insensibles au zoom du site). */
        const H=ov.offsetHeight||240;
        const T=cells.map(function(c){return {x:c.offsetLeft+c.offsetWidth*0.42,y:c.offsetTop+c.offsetHeight*0.82}});
        const y0=Math.max(-30,T[0].y-H*0.6);
        /* Chute de la première goutte. */
        await A(drop,[
          {transform:tr(T[0].x,y0,.6,.6),opacity:0},
          {transform:tr(T[0].x,y0+24,.8,1.3),opacity:1,offset:.15},
          {transform:tr(T[0].x,T[0].y,.85,1.5),opacity:1}
        ],{duration:520,easing:'cubic-bezier(.5,0,.9,.6)'});
        for(let i=0;i<cells.length;i++){
          const a=T[i];
          ripple(a.x,a.y);
          ecrireLettre(i);
          if(i<cells.length-1){
            const b=T[i+1],apex=Math.min(a.y,b.y)-H*0.3;
            await A(drop,[
              {transform:tr(a.x,a.y,1.7,.45),easing:'cubic-bezier(.2,.7,.4,1)'},
              {transform:tr((a.x+b.x)/2,apex,.85,1.25),offset:.5,easing:'cubic-bezier(.6,0,.9,.5)'},
              {transform:tr(b.x,b.y,.9,1.4)}
            ],{duration:430});
          }else{
            /* Dernière lettre : la goutte s'écrase et se dissout dans l'écriture. */
            await A(drop,[{transform:tr(a.x,a.y,1.7,.45),opacity:1},{transform:tr(a.x,a.y+4,2.4,.1),opacity:0}],{duration:320,easing:'ease-out'});
          }
        }
        /* Petite vague finale sur tout le mot. */
        letters.forEach(function(_,i){setTimeout(function(){rebond(i)},i*70)});
        await pause(1900);
        await A(ov,[{opacity:1},{opacity:0}],{duration:600,easing:'ease-in'});
      }catch(e){}
      clearTimeout(securite);
      terminer();
    })();
  });
}

let writing=false;
function quandLibre(cb){if(hero.classList.contains('is-split')||hero.classList.contains('is-floating'))setTimeout(function(){quandLibre(cb)},250);else cb()}
function lancerEcriture(){
  writing=true;
  clearTimeout(timer);
  timer=setTimeout(function(){
    apply(); /* retour au cercle : forme la plus large pour écrire */
    setTimeout(function(){
      quandLibre(function(){
        ecrireAurore().then(function(){writing=false;schedule()});
      });
    },1000);
  },1300);
}

function schedule(){clearTimeout(timer);if(reduce.matches||document.hidden||writing)return;timer=setTimeout(function(){apply();cycles++;if(cycles%shapes.length===0){lancerEcriture();return}if(cycles%4===0)splitAndMerge();schedule()},1300)}
apply();index=0;cycles=0;schedule();
document.addEventListener('visibilitychange',schedule);
if(reduce.addEventListener)reduce.addEventListener('change',schedule)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init()})();

/* --- Chargeur de la barre latérale (CSS + JS) : garantit que le menu et sa poignée existent --- */
(function(){try{
  var v='20261005-sb1';
  ['css/aurore-sidebar.css','css/aurore-sidebar-extra.css'].forEach(function(h){
    if(document.querySelector('link[href*="'+h+'"]'))return;
    var l=document.createElement('link');l.rel='stylesheet';l.href='./'+h+'?v='+v;document.head.appendChild(l);
  });
  function addJs(){
    if(window.__auroreSidebarReady||document.querySelector('script[src*="aurore-sidebar.js"]'))return;
    var s=document.createElement('script');s.src='js/aurore-sidebar.js?v='+v;document.body.appendChild(s);
  }
  if(document.body)addJs();else document.addEventListener('DOMContentLoaded',addJs,{once:true});
}catch(e){}})();
