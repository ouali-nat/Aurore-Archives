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

  // Le SDK Supabase est chargé en async pour que le navigateur puisse afficher
  // Aurore et traiter rapidement le retour Google. On attend brièvement son
  // chargement principal ; si le CDN reste bloqué, on bascule vers unpkg.
  function chargerScriptSupabase(url, delaiMs = 7000) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      let fini = false;
      const minuteur = setTimeout(() => {
        if (fini) return;
        fini = true;
        reject(new Error('Délai dépassé (' + delaiMs + 'ms) : ' + url));
      }, delaiMs);
      s.src = url;
      s.onload = () => {
        if (fini) return;
        fini = true;
        clearTimeout(minuteur);
        resolve();
      };
      s.onerror = () => {
        if (fini) return;
        fini = true;
        clearTimeout(minuteur);
        reject(new Error('Échec de chargement : ' + url));
      };
      document.head.appendChild(s);
    });
  }

  async function attendreSdkSupabasePrincipal(delaiMs = 4500) {
    if (window.supabase) return true;
    const debut = Date.now();
    while (!window.supabase && Date.now() - debut < delaiMs) {
      if (window.__AURORE_SUPABASE_SDK_FAILED) break;
      await new Promise(r => setTimeout(r, 80));
    }
    return !!window.supabase;
  }

  let __auroreSupabaseFallbackPromise = null;
  async function assurerClientAuthGoogle() {
    if (AURORE_SUPABASE_AUTH) return AURORE_SUPABASE_AUTH;

    await attendreSdkSupabasePrincipal();

    if (!window.supabase) {
      if (!__auroreSupabaseFallbackPromise) {
        __auroreSupabaseFallbackPromise = chargerScriptSupabase('https://unpkg.com/@supabase/supabase-js@2');
      }
      try {
        await __auroreSupabaseFallbackPromise;
      } catch (e) {
        console.error('[Google OAuth] CDN principal et secours indisponibles :', e);
      }
    }

    if (window.supabase && !AURORE_SUPABASE_AUTH) {
      AURORE_SUPABASE_AUTH = creerClientAuthGoogle();
    }
    return AURORE_SUPABASE_AUTH;
  }
