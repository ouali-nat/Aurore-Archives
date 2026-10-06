// Client Supabase dédié à OAuth Google. Le reste du site conserve ses appels REST.
  // flowType pkce + échange manuel du code OAuth dans index.html.

  // ---------- Application Android (Capacitor) ----------
  // Google refuse la connexion dans une WebView. Dans l'appli, on ouvre donc
  // Google dans le navigateur du téléphone (onglet Chrome), puis Supabase
  // renvoie vers le lien profond ci-dessous qui rouvre l'appli avec ?code=...
  // Le site web classique (navigateur) n'est pas concerné : rien ne change.
  const AURORE_SCHEME_APP = 'app.vercel.aurore_section_archivescom.twa://auth';

  function auroreEstAppliNative() {
    try {
      return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (_) { return false; }
  }

  function auroreAdapterClientNatif(client) {
    if (!auroreEstAppliNative() || !client || !client.auth || client.auth.__auroreNatif) return client;
    const originale = client.auth.signInWithOAuth.bind(client.auth);
    client.auth.signInWithOAuth = async (credentials) => {
      const Browser = window.Capacitor?.Plugins?.Browser;
      if (!Browser) return originale(credentials);
      const options = Object.assign({}, credentials && credentials.options, {
        redirectTo: AURORE_SCHEME_APP,
        skipBrowserRedirect: true
      });
      const res = await originale(Object.assign({}, credentials, { options }));
      if (res && res.error) return res;
      const url = res && res.data && res.data.url;
      if (!url) return { data: res && res.data, error: new Error('Adresse de connexion Google introuvable.') };
      window.__auroreRetourGoogleRecu = false;
      await Browser.open({ url });
      return res;
    };
    client.auth.__auroreNatif = true;
    return client;
  }

  // Retour depuis Google : on recharge le site avec les paramètres reçus
  // dans le lien profond. Sur Android natif, le flux client peut revenir avec
  // #access_token=... ; sur le web, le flux PKCE continue avec ?code=....
  (function brancherRetourGoogleNatif() {
    if (!auroreEstAppliNative()) return;
    const plugins = window.Capacitor.Plugins || {};
    const App = plugins.App;
    const Browser = plugins.Browser;
    if (App && App.addListener) {
      App.addListener('appUrlOpen', (event) => {
        const lien = (event && event.url) || '';
        if (lien.indexOf(AURORE_SCHEME_APP) !== 0) return;
        window.__auroreRetourGoogleRecu = true;
        try { Browser && Browser.close && Browser.close(); } catch (_) {}
        // Préserve à la fois la query (?code=...) et le fragment
        // (#access_token=...) : le natif utilise un flux client sans verifier PKCE.
        try {
          const cible = new URL(lien);
          const query = cible.search || '';
          const hash = cible.hash || '';
          if (!query && !hash) { window.location.reload(); return; }
          window.location.replace(window.location.origin + window.location.pathname + query + hash);
        } catch (_) {
          window.location.reload();
        }
      });
    }
    // Onglet fermé sans terminer la connexion : on réarme la page.
    if (Browser && Browser.addListener) {
      Browser.addListener('browserFinished', () => {
        setTimeout(() => {
          if (!window.__auroreRetourGoogleRecu) window.location.reload();
        }, 1500);
      });
    }
  })();

  function creerClientAuthGoogle() {
    // Web : PKCE reste inchangé.
    // Android natif : le retour revient par lien profond après un navigateur externe.
    // Dans ce contexte, on utilise le flux implicite côté client afin de ne pas
    // dépendre d'un code_verifier stocké dans le WebView avant de quitter l'appli.
    // Cette différence est strictement limitée à l'application native.
    const flowType = auroreEstAppliNative() ? 'implicit' : 'pkce';
    return auroreAdapterClientNatif(window.supabase.createClient(
      "https://tdeotqfsbvouresfhkab.supabase.co",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkZW90cWZzYnZvdXJlc2Zoa2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5NjM4NzMsImV4cCI6MjEwMDUzOTg3M30.l_a1lI_QRy7BTq1fGjiA9n7LCdu7BwR2TTI5pkA70SU",
      { auth: { flowType, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, storage: window.localStorage } }
    ));
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
            'https://unpkg.com/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'
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

  // Déconnexion explicite de la session Supabase Auth utilisée par Google OAuth.
  // Scope local : on ferme uniquement la session de cet appareil/navigateur.
  window.auroreDeconnecterGoogle = async () => {
    const client = await assurerClientAuthGoogle();
    if (!client?.auth?.signOut) throw new Error('Le moteur de déconnexion Google n’est pas disponible.');
    return client.auth.signOut({ scope: 'local' });
  };
