/* Chargement d'ouverture : boule à 4 trous qui tourne (style Pinterest).
 * À charger en script synchrone juste après le bloc #aurore-boot-overlay-early
 * dans index.html, pour que la boule soit en place avant le premier affichage. */
(function(){
  var ring = document.querySelector('.aurore-boot-ring');
  if(!ring) return;

  var css = [
    '.aurore-boot-ring{position:absolute;inset:0;border:0;border-radius:50%;',
    '  background:radial-gradient(circle at 34% 30%,#f3e8ff 0%,#a78bfa 38%,#6d28d9 100%);',
    '  box-shadow:0 0 26px rgba(139,92,246,.5),inset -6px -8px 14px rgba(40,10,90,.45);',
    '  animation:aurore-boot-spin 1.4s linear infinite}',
    '.aurore-boot-ring::after{display:none}',
    '.aurore-boot-ring i{position:absolute;width:12px;height:12px;border-radius:50%;',
    '  background:#0d0b1f;box-shadow:inset 0 2px 3px rgba(0,0,0,.7)}',
    '.aurore-boot-ring i:nth-child(1){top:4px;left:calc(50% - 6px)}',
    '.aurore-boot-ring i:nth-child(2){right:4px;top:calc(50% - 6px)}',
    '.aurore-boot-ring i:nth-child(3){bottom:4px;left:calc(50% - 6px)}',
    '.aurore-boot-ring i:nth-child(4){left:4px;top:calc(50% - 6px)}',
    '@media(prefers-reduced-motion:reduce){.aurore-boot-ring{animation:none!important}}'
  ].join('\n');

  var style = document.createElement('style');
  style.id = 'aurore-boot-ball-css';
  style.textContent = css;
  document.head.appendChild(style);

  /* Les 4 trous tournent avec la boule. */
  for(var i = 0; i < 4; i++){
    ring.appendChild(document.createElement('i'));
  }
})();
