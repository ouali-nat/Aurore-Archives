
(function(){
  const KEY='aurore_floating_home_position_v1';
  const el=document.getElementById('auroreFloatingHome');
  if(!el)return;
  let dragging=false,startX=0,startY=0,startLeft=0,startTop=0,moved=false;
  function clamp(){
    const r=el.getBoundingClientRect();
    const maxX=Math.max(4,innerWidth-r.width-4),maxY=Math.max(4,innerHeight-r.height-4);
    const x=Math.min(maxX,Math.max(4,r.left));
    const y=Math.min(maxY,Math.max(4,r.top));
    el.style.left=x+'px';el.style.top=y+'px';el.style.right='auto';el.style.bottom='auto';
  }
  function save(){
    const r=el.getBoundingClientRect();
    try{localStorage.setItem(KEY,JSON.stringify({x:r.left/Math.max(1,innerWidth),y:r.top/Math.max(1,innerHeight)}));}catch(e){}
  }
  function centerAndSave(){
    el.classList.add('is-positioned');
    // Pour un centrage réel, on neutralise temporairement le transform de
    // centrage CSS : left/top doivent représenter le coin supérieur gauche
    // réel du bouton, notamment après une connexion.
    el.style.transform='none';
    const r=el.getBoundingClientRect();
    el.style.left=Math.round((innerWidth-r.width)/2)+'px';
    el.style.top=Math.round((innerHeight-r.height)/2)+'px';
    el.style.right='auto';el.style.bottom='auto';
    clamp();save();
  }
  function restore(){
    try{
      const p=JSON.parse(localStorage.getItem(KEY)||'null');
      if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)){
        requestAnimationFrame(()=>{
          el.classList.add('is-positioned');
          const r=el.getBoundingClientRect();
          el.style.left=Math.round(p.x*innerWidth)+'px';
          el.style.top=Math.round(p.y*innerHeight)+'px';
          el.style.right='auto';el.style.bottom='auto';clamp();
        });
      } else { requestAnimationFrame(centerAndSave); }
    }catch(e){ requestAnimationFrame(centerAndSave); }
  }
  function goHome(){
    try{
      const ecranAurora=document.getElementById('screen-aurore-ia');
      // Une fenêtre Aurora réduite est un élément persistant : revenir à
      // l'accueil ne doit surtout pas la fermer. On change uniquement
      // l'écran situé derrière elle. Le plein écran Aurora, lui, conserve
      // son comportement normal de fermeture vers l'accueil.
      if(ecranAurora?.classList.contains('is-mini')){
        if(typeof afficherEcran==='function')afficherEcran('screen-home');
        else document.getElementById('screen-home')?.classList.add('active');
        requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));
        return;
      }
      if(ecranAurora?.classList.contains('active')&&typeof window.auroreIAFermerVersAccueil==='function'){
        window.auroreIAFermerVersAccueil();
        return;
      }
      if(typeof afficherEcran==='function'){afficherEcran('screen-home');return;}
      document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
      document.getElementById('screen-home')?.classList.add('active');
      window.scrollTo({top:0,behavior:'smooth'});
    }catch(e){
      const home=document.getElementById('screen-home');
      if(home){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));home.classList.add('active');}
    }
  }
  el.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    dragging=true;moved=false;el.classList.add('dragging');el.setPointerCapture?.(e.pointerId);
    const r=el.getBoundingClientRect();startX=e.clientX;startY=e.clientY;startLeft=r.left;startTop=r.top;e.preventDefault();
  });
  el.addEventListener('pointermove',e=>{
    if(!dragging)return;
    const dx=e.clientX-startX,dy=e.clientY-startY;
    if(Math.abs(dx)>4||Math.abs(dy)>4)moved=true;
    el.style.left=Math.round(startLeft+dx)+'px';el.style.top=Math.round(startTop+dy)+'px';el.style.right='auto';el.style.bottom='auto';clamp();
  });
  const end=e=>{
    if(!dragging)return;dragging=false;el.classList.remove('dragging');
    try{el.releasePointerCapture?.(e.pointerId);}catch(_){}
    if(moved)save();
  };
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
  el.addEventListener('click',e=>{if(moved){moved=false;return;}goHome();});
  el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goHome();}});
  let lastCenteredSessionId='';
  function sessionId(){
    try{
      return (typeof session!=='undefined' && session) ? String(session.id||session.email||'') : '';
    }catch(e){return '';}
  }
  function showDragHint(){
    el.classList.add('show-drag-hint');
    clearTimeout(el._dragHintTimer);
    el._dragHintTimer=setTimeout(()=>el.classList.remove('show-drag-hint'),4200);
  }
  function centerOnConnection(id){
    id=String(id||'');
    if(!id || id===lastCenteredSessionId)return;
    lastCenteredSessionId=id;
    requestAnimationFrame(()=>{ centerAndSave(); showDragHint(); });
  }
  window.addEventListener('aurore:user-connected',e=>centerOnConnection(e.detail?.id||''));
  window.addEventListener('aurore:user-disconnected',()=>{ lastCenteredSessionId=''; });
  addEventListener('resize',()=>{clamp();save();},{passive:true});

  /* Si la session existe déjà au chargement, on considère cela comme une
     connexion : l'Accueil flottant démarre donc au centre, sans reprendre
     une ancienne position enregistrée. */
  const initialSessionId=sessionId();
  if(initialSessionId){
    requestAnimationFrame(()=>centerOnConnection(initialSessionId));
  }else{
    restore();
  }

  /* L'authentification peut être résolue après le chargement de ce script.
     On surveille uniquement l'apparition d'une nouvelle session pour garantir
     le centrage à chaque connexion, sans modifier le comportement du drag. */
  let sessionChecks=0;
  const detectConnection=()=>{
    const id=sessionId();
    if(id)centerOnConnection(id);
    if(sessionChecks++<40)setTimeout(detectConnection,250);
  };
  detectConnection();
})();
