// Client Supabase dédié à OAuth Google. Le reste du site conserve ses appels REST.
  // flowType pkce + échange manuel du code OAuth dans index.html.

  // ---------- Application Android (Capacitor) ----------
  // Google refuse la connexion dans une WebView. Dans l'appli, on ouvre donc
  // Google dans le navigateur du téléphone (onglet Chrome), puis Supabase
  // renvoie vers le lien profond ci-dessous qui rouvre l'appli avec ?code=...
  // Le site web classique (navigateur) n'est pas concerné : rien ne change.
  const AURORE_SCHEME_APP = 'app.vercel.aurore-section-archivescom.twa://auth';

  // Capacitor v6 peut exposer les plugins via le registre historique
  // (Capacitor.Plugins) ou via registerPlugin(). Utiliser les deux chemins
  // évite de perdre le retour OAuth selon la manière dont l'App est emballée.
  function aurorePluginNatif(nom) {
    try {
      const cap = window.Capacitor;
      if (!cap) return null;
      const legacy = cap.Plugins && cap.Plugins[nom];
      if (legacy) return legacy;
      if (typeof cap.registerPlugin === 'function') {
        return cap.registerPlugin(nom);
      }
    } catch (e) {
      console.warn('[Aurore Capacitor] Plugin ' + nom + ' indisponible :', e);
    }
    return null;
  }

  function auroreEstAppliNative() {
    try {
      return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (_) { return false; }
  }

  function auroreAdapterClientNatif(client) {
    if (!auroreEstAppliNative() || !client || !client.auth || client.auth.__auroreNatif) return client;
    const originale = client.auth.signInWithOAuth.bind(client.auth);
    client.auth.signInWithOAuth = async (credentials) => {
      const Browser = aurorePluginNatif('Browser');
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
    const App = aurorePluginNatif('App');
    const Browser = aurorePluginNatif('Browser');
    let retourNatifEnCours = false;

    async function traiterRetourGoogleNatif(lien) {
      lien = String(lien || '');
      if (!lien || lien.indexOf(AURORE_SCHEME_APP) !== 0) return false;
      if (retourNatifEnCours) return true;
      retourNatifEnCours = true;
      window.__auroreRetourGoogleRecu = true;

      try { Browser && Browser.close && Browser.close(); } catch (_) {}

      try {
        // Attendre explicitement le client OAuth avant de consommer le deep-link.
        const clientAuth = await assurerClientAuthGoogle();
        const cible = new URL(lien);
        const hashParams = new URLSearchParams((cible.hash || '').replace(/^#/, ''));
        const accessToken = hashParams.get('access_token') || cible.searchParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token') || cible.searchParams.get('refresh_token');

        // Retour implicite : les jetons reviennent directement dans le lien profond.
        if (accessToken && refreshToken && clientAuth?.auth) {
          const resultat = await clientAuth.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });

          if (resultat && resultat.error) {
            console.error('[Aurore OAuth Android] setSession:', resultat.error);
            window.dispatchEvent(new CustomEvent('aurore-google-auth-error', { detail: resultat.error }));
            return false;
          }

          const sessionNative = resultat?.data?.session;
          if (sessionNative?.access_token) {
            if (typeof window.auroreFinaliserConnexionGoogleNative === 'function') {
              return await window.auroreFinaliserConnexionGoogleNative(sessionNative);
            }

            // Secours pour une version ancienne du document encore en cache :
            // on réutilise le traitement implicite déjà présent dans index.html.
            const fragment = new URLSearchParams({
              access_token: sessionNative.access_token,
              refresh_token: sessionNative.refresh_token || refreshToken,
              expires_in: String(Math.max(
                60,
                (sessionNative.expires_at || Math.floor(Date.now() / 1000) + 3600) -
                Math.floor(Date.now() / 1000)
              ))
            });
            window.location.hash = fragment.toString();
            window.location.reload();
            return true;
          }

          return false;
        }

        // Secours : Supabase peut exceptionnellement renvoyer un code OAuth.
        const code = cible.searchParams.get('code');
        if (code && clientAuth?.auth?.exchangeCodeForSession) {
          const resultat = await clientAuth.auth.exchangeCodeForSession(code);

          if (resultat && resultat.error) {
            console.error('[Aurore OAuth Android] exchangeCodeForSession:', resultat.error);
            window.dispatchEvent(new CustomEvent('aurore-google-auth-error', { detail: resultat.error }));
            return false;
          }

          const sessionNative = resultat?.data?.session;
          if (sessionNative?.access_token) {
            if (typeof window.auroreFinaliserConnexionGoogleNative === 'function') {
              return await window.auroreFinaliserConnexionGoogleNative(sessionNative);
            }

            const fragment = new URLSearchParams({
              access_token: sessionNative.access_token,
              refresh_token: sessionNative.refresh_token || '',
              expires_in: String(Math.max(
                60,
                (sessionNative.expires_at || Math.floor(Date.now() / 1000) + 3600) -
                Math.floor(Date.now() / 1000)
              ))
            });
            window.location.hash = fragment.toString();
            window.location.reload();
            return true;
          }

          return false;
        }

        window.location.reload();
        return true;
      } catch (e) {
        console.error('[Aurore OAuth Android] traitement du lien profond impossible :', e);
        window.dispatchEvent(new CustomEvent('aurore-google-auth-error', { detail: e }));
        return false;
      }
    }

    if (App && App.addListener) {
      App.addListener('appUrlOpen', (event) => {
        traiterRetourGoogleNatif(event && event.url);
      });
    }

    // Cas où Android a démarré l’App directement avec le lien profond
    // pendant que l’application était complètement fermée.
    if (App && typeof App.getLaunchUrl === 'function') {
      App.getLaunchUrl()
        .then((resultat) => {
          const lien = resultat && resultat.url;
          if (lien && !window.__auroreRetourGoogleRecu) traiterRetourGoogleNatif(lien);
        })
        .catch((e) => console.warn('[Aurore OAuth Android] getLaunchUrl:', e));
    }

    // Onglet fermé sans terminer la connexion : on réarme la page.
    if (Browser && Browser.addListener) {
      Browser.addListener('browserFinished', () => {
        setTimeout(() => {
          if (!window.__auroreRetourGoogleRecu) window.location.reload();
        }, 1500);
      });
    }

    // Rejoue tout deep-link reçu avant le chargement du moteur OAuth.
    try {
      const pending=Array.isArray(window.__auroreNativeOAuthUrls)
        ? window.__auroreNativeOAuthUrls.splice(0)
        : [];
      pending.forEach(lien => setTimeout(() => traiterRetourGoogleNatif(lien), 0));
    } catch(e) {
      console.warn('[Aurore OAuth Android] file du lien profond indisponible :',e);
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
  window.AURORE_SUPABASE_AUTH = AURORE_SUPABASE_AUTH;
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
        throw new Error('Le moteur de connexion Google nest pas disponible.');
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
    if (!client?.auth?.signOut) throw new Error('Le moteur de déconnexion Google nest pas disponible.');
    return client.auth.signOut({ scope: 'local' });
  };
