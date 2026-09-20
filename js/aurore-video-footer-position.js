
(function(){
  function placerVideoAvantService(){
    var video=document.getElementById('homeVideoSection');
    var service=document.querySelector('footer .service-client-card');
    if(!video||!service)return;
    var serviceWrap=service.closest('.wrap');
    if(!serviceWrap)return;
    if(video.parentElement!==serviceWrap.parentElement || video.nextElementSibling!==serviceWrap){
      serviceWrap.parentNode.insertBefore(video,serviceWrap);
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',placerVideoAvantService);
  else placerVideoAvantService();
  window.addEventListener('load',placerVideoAvantService);
})();
