
/* Aurora : envoi tactile/clavier robuste.
   Le clic est converti en un unique submit du formulaire. Cela évite les
   conflits entre pointerdown/click sur Android et laisse toute la logique
   réseau dans le gestionnaire submit principal d'Aurora. */
(function(){
  const form=document.getElementById('auroreIAForm');
  const input=document.getElementById('auroreIAInput');
  const send=form?.querySelector('.aurore-ia-send');
  if(!form||!input||!send)return;
  send.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    if(send.disabled||!input.value.trim())return;
    if(typeof form.requestSubmit==='function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  });
})();
