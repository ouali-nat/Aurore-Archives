  // Client Supabase dédié à OAuth Google. Le reste du site conserve ses appels REST.
  // flowType implicit permet au navigateur de récupérer directement le retour OAuth
  // dans le fragment, sans exiger un serveur/callback PKCE supplémentaire.
  function creerClientAuthGoogle() {
    return window.supabase.createClient(
      "https://tdeotqfsbvouresfhkab.supabase.co",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkZW90cWZzYnZvdXJlc2Zoa2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NjM4NzMsImV4cCI6MjEwMDUzOTg3M30.l_a1lI_QRy7BTq1fGjiA9n7LCdu7BwR2TTI5pkA70SU",
      // detectSessionInUrl: false — volontaire. Le code gère lui-même l'échange
      // du ?code=... via exchangeCodeForSession() plus bas dans ce fichier.
      // Laisser le SDK sur true créait une course : le SDK consommait le
      // code_verifier PKCE automatiquement à la création du client, avant que
      // l'appel manuel n'arrive — d'où l'erreur "code verifier not found in
      // storage" (Google OAuth), intermittente selon la vitesse d'exécution
      // de la page (extensions, trackers, navigation normale vs privée).
      { auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, storage: window.localStorage } }
    );
  }
  let AURORE_SUPABASE_AUTH = window.supabase ? creerClientAuthGoogle() : null;

  // Sur certains réseaux mobiles, le CDN jsdelivr est bloqué ou trop lent au
  // chargement initial de la page : la librairie Supabase n'est alors pas
  // encore prête et AURORE_SUPABASE_AUTH reste null. Plutôt que d'abandonner
  // immédiatement, on retente ici avec un second CDN de secours (unpkg), et on
  // ne signale l'échec qu'après avoir vraiment épuisé les deux options.
  // Timeout explicite : certains blocages réseau (DNS filtrant, pare-feu)
  // ne déclenchent ni onload ni onerror — la requête reste juste en attente
  // indéfiniment. Sans ce délai, un CDN de secours filtré de la même façon
  // bloquerait la connexion Google pour toujours au lieu d'échouer proprement.
  function chargerScriptSupabase(url, delaiMs = 8000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      let fini = false;
      const minuteur = setTimeout(() => {
        if (fini) return;
        fini = true;
        reject(new Error('Délai dépassé (' + delaiMs + 'ms) : ' + url));
      }, delaiMs);
      s.src = url;
      s.onload = () => { if (fini) return; fini = true; clearTimeout(minuteur); resolve(); };
      s.onerror = () => { if (fini) return; fini = true; clearTimeout(minuteur); reject(new Error('Échec de chargement : ' + url)); };
      document.head.appendChild(s);
    });
  }

  async function assurerClientAuthGoogle() {
    if (AURORE_SUPABASE_AUTH) return AURORE_SUPABASE_AUTH;
    if (!window.supabase) {
      try {
        await chargerScriptSupabase('https://unpkg.com/@supabase/supabase-js@2');
      } catch (e) {
        console.error('[Google OAuth] CDN de secours indisponible :', e);
      }
    }
    if (window.supabase && !AURORE_SUPABASE_AUTH) {
      AURORE_SUPABASE_AUTH = creerClientAuthGoogle();
    }
    return AURORE_SUPABASE_AUTH;
  }
