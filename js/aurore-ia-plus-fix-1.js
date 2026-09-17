
/* Correctif ciblé du menu + : chaque action ouvre son sélecteur dédié. */
(function(){
  const wrap=document.getElementById('auroreIAPlusWrap');
  const menu=document.getElementById('auroreIAPlusMenu');
  const imageInput=document.getElementById('auroreIAImageInput');
  const pdfInput=document.getElementById('auroreIAPdfInput');
  if(!wrap||!menu||!imageInput||!pdfInput) return;

  menu.addEventListener('click',function(e){
    const btn=e.target.closest('button[data-ia-file-kind]');
    if(!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const kind=btn.getAttribute('data-ia-file-kind');
    if(kind==='camera'){
      imageInput.setAttribute('capture','environment');
      imageInput.click();
    }else if(kind==='image'){
      imageInput.removeAttribute('capture');
      imageInput.click();
    }else if(kind==='pdf'){
      pdfInput.click();
    }

    const plus=document.getElementById('auroreIAPlus');
    if(plus){
      plus.setAttribute('aria-expanded','false');
    }
    menu.hidden=true;
  },true);
})();
