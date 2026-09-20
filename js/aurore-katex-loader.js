
  // Appliqué le plus tôt possible pour éviter un flash du mauvais thème au
  // chargement. Version minimale ; la logique complète (boutons, suivi du
  // système en direct) est reprise plus bas une fois le DOM prêt.
  (function(){
    try {
      var choix = localStorage.getItem('auraster-theme') || 'systeme';
      var affiche = choix === 'systeme'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'clair' : 'sombre')
        : choix;
      // Le CSS du thème clair cible [data-theme="light"] (voir plus bas) : on
      // traduit donc la valeur ici, au moment précis où l'attribut est posé.
      document.documentElement.setAttribute('data-theme', affiche === 'clair' ? 'light' : 'dark');
      document.documentElement.setAttribute('data-theme-choix', choix);
      var couleurChoisie = localStorage.getItem('auraster-color-theme') || 'violet';
      var couleursAutorisees = ['violet','rouge','vert','bleu','jaune','orange','cyan','rose','indigo','turquoise','emeraude','lime','sarcelle','magenta','fuchsia','corail','bordeaux','pourpre','prune','or','ambre','menthe','azur','lavande','safran'];
      document.documentElement.setAttribute('data-color-theme', couleursAutorisees.indexOf(couleurChoisie) >= 0 ? couleurChoisie : 'violet');
    } catch (e) {}
  })();
