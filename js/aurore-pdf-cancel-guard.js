
/* Aurore — erreurs de rendu PDF annulé : elles sont normales lorsqu'une
   page est quittée avant la fin de son rendu. Ne pas les afficher comme
   une erreur utilisateur. */
(function () {
  window.addEventListener('unhandledrejection', function (event) {
    const r = event.reason;
    const message = String(r?.message || r || '');
    if (/rendering\s+cancelled|RenderingCancelled/i.test(message)) {
      event.preventDefault();
    }
  });
})();
