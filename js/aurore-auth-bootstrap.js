// Client Supabase dédié à OAuth Google. Le reste du site conserve ses appels REST.
  // flowType pkce + échange manuel du code OAuth dans index.html.
  function creerClientAuthGoogle() {
    return window.supabase.createClient(
      "https://tdeotqfsbvouresfhkab.supabase.co",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkZW90cWZzYnZvdXJlc2Zoa2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NjM4NzMsImV4cCI6MjEwMDUzOTg3M30.l_a1lI_QRy7BTq1fGjiA9n7LCdu7BwR2TTI5pkA70SU",
      { auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, storage: window.localStorage } }
    );
  }

  // État global explicite : une page visuellement chargée n'implique pas que
  // le moteur OAuth est prêt. Tous les appels partagent une seule préparation.
  window.__AURORE_AUTH_GOOGLE_STATE = 'loading';
  window.__AURORE_AUTH_GOOGLE_ERROR = null;
  window.__AURORE_AUTH_GOOGLE_READY = false;

  let AURORE_SUPABASE_AUTH = window.supabase?.createClient ? creerClientAuthGoogle() : null;
  let __auroreSupabaseFallbackPromise = null;
  let __auroreSupabaseAuthPromise = null;

  function emettreEtatAuthGoogle(type, detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent(type, { detail }));
    } catch (_) {}
  }

  function chargerScriptSupabase(url, delaiMs = 5000) {
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

  async function attendreSdkSupabasePrincipal(delaiMs = 4000) {
    if (window.supabase?.createClient) return true;
    const debut = Date.now();
    while (!window.supabase?.createClient && Date.now() - debut < delaiMs) {
      if (window.__AURORE_SUPABASE_SDK_FAILED) break;
      await new Promise(r => setTimeout(r, 80));
    }
    return !!window.supabase?.createClient;
  }

  function assurerClientAuthGoogle() {
    if (AURORE_SUPABASE_AUTH) return Promise.resolve(AURORE_SUPABASE_AUTH);

    // Aucun appel concurrent ne doit relancer une seconde préparation PKCE.
    if (__auroreSupabaseAuthPromise) return __auroreSupabaseAuthPromise;

    __auroreSupabaseAuthPromise = (async () => {
      await attendreSdkSupabasePrincipal();

      if (!window.supabase?.createClient) {
        if (!__auroreSupabaseFallbackPromise) {
          __auroreSupabaseFallbackPromise = chargerScriptSupabase(
            'https://unpkg.com/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js'
          );
        }
        try {
          await __auroreSupabaseFallbackPromise;
        } catch (e) {
          console.error('[Google OAuth] CDN principal et secours indisponibles :', e);
        }
      }

      if (window.supabase?.createClient && !AURORE_SUPABASE_AUTH) {
        AURORE_SUPABASE_AUTH = creerClientAuthGoogle();
      }

      if (!AURORE_SUPABASE_AUTH) {
        throw new Error('Le moteur de connexion Google n’est pas disponible.');
      }

      return AURORE_SUPABASE_AUTH;
    })().catch(error => {
      // Après un échec, une nouvelle tentative doit pouvoir repartir proprement.
      __auroreSupabaseAuthPromise = null;
      __auroreSupabaseFallbackPromise = null;
      throw error;
    });

    return __auroreSupabaseAuthPromise;
  }

  // Préparation anticipée : le bouton reste verrouillé jusqu'à ce que ce
  // client soit réellement disponible. En cas d'échec réseau, le bouton
  // redevient utilisable pour déclencher une nouvelle tentative.
  window.__AURORE_AUTH_GOOGLE_READY_PROMISE = assurerClientAuthGoogle()
    .then(client => {
      window.__AURORE_AUTH_GOOGLE_STATE = 'ready';
      window.__AURORE_AUTH_GOOGLE_READY = true;
      window.__AURORE_AUTH_GOOGLE_ERROR = null;
      emettreEtatAuthGoogle('aurore-auth-google-ready', { client });
      return client;
    })
    .catch(error => {
      window.__AURORE_AUTH_GOOGLE_STATE = 'failed';
      window.__AURORE_AUTH_GOOGLE_READY = false;
      window.__AURORE_AUTH_GOOGLE_ERROR = error;
      emettreEtatAuthGoogle('aurore-auth-google-failed', { error });
      console.warn('[Google OAuth] Préparation anticipée indisponible :', error);
      return null;
    });

  window.auroreAuthGoogleEstPret = () => window.__AURORE_AUTH_GOOGLE_READY === true;
