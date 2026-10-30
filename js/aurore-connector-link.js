(function () {
  "use strict";

  const param = "aurore_connector_pair";
  const storageKey = "aurore_connector_pair_pending";
  const url = new URL(window.location.href);
  let pair = url.searchParams.get(param);
  try {
    if (pair && /^[A-Za-z0-9_-]{40,100}$/.test(pair)) {
      window.sessionStorage.setItem(storageKey, pair);
    } else {
      pair = window.sessionStorage.getItem(storageKey) || "";
    }
  } catch (_) {}
  if (!pair || !/^[A-Za-z0-9_-]{40,100}$/.test(pair)) return;

  let lastToken = "";
  let busy = false;
  let finished = false;
  let rounds = 0;
  let timer = null;
  let failures = 0;
  let nextAttemptAt = 0;

  function notice(message, error) {
    let node = document.getElementById("auroreConnectorLinkNotice");
    if (!node) {
      node = document.createElement("div");
      node.id = "auroreConnectorLinkNotice";
      node.setAttribute("role", "status");
      node.style.cssText = "position:fixed;left:16px;right:16px;bottom:18px;z-index:2147483000;padding:14px 16px;border-radius:12px;background:#242132;color:#fff;box-shadow:0 8px 28px #0004;font:14px/1.5 system-ui,sans-serif";
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.style.borderLeft = error ? "4px solid #dc6262" : "4px solid #65b891";
  }

  function clearPairFromUrl() {
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete(param);
      window.history.replaceState(window.history.state, "", clean.pathname + clean.search + clean.hash);
    } catch (_) {}
  }

  function expiryMs(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1000000000000 ? n : n * 1000;
  }

  function publishFreshSession(current) {
    try {
      if (typeof session !== "undefined") {
        session = {
          ...(session || {}),
          access_token: current.access_token,
          refresh_token: current.refresh_token || session?.refresh_token || "",
          expires_at: expiryMs(current.expires_at) || (Date.now() + Number(current.expires_in || 3600) * 1000)
        };
      }
    } catch (_) {}
  }

  async function refreshGlobalSession(client) {
    let old = null;
    try {
      if (typeof session !== "undefined" && session && session.refresh_token) old = session;
    } catch (_) {}
    if (!old) return null;

    const apiUrl = typeof SUPABASE_URL !== "undefined"
      ? SUPABASE_URL
      : "https://tdeotqfsbvouresfhkab.supabase.co";
    const apiKey = typeof SUPABASE_ANON_KEY !== "undefined" ? SUPABASE_ANON_KEY : "";
    if (!apiKey) return null;

    try {
      const response = await fetch(apiUrl + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ refresh_token: old.refresh_token }),
        cache: "no-store"
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data.access_token || !data.refresh_token) return null;
      let current = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
        expires_in: data.expires_in || 3600
      };

      // Synchronise également le SDK utilisé par les autres fonctions du site,
      // pour qu'il ne tente pas de réutiliser l'ancien refresh token.
      if (client && client.auth && typeof client.auth.setSession === "function") {
        try {
          const synced = await client.auth.setSession({
            access_token: current.access_token,
            refresh_token: current.refresh_token
          });
          if (!synced?.error && synced?.data?.session?.access_token) current = synced.data.session;
        } catch (_) {}
      }
      publishFreshSession(current);
      return {
        access_token: current.access_token,
        refresh_token: current.refresh_token || "",
        expires_at: current.expires_at || null
      };
    } catch (_) {
      return null;
    }
  }

  // Le jeton REST de la page peut rester en mémoire après expiration. On lit
  // d'abord le client Supabase, puis on renouvelle aussi le jeton du site si sa
  // session distincte n'est plus synchronisée avec le SDK.
  async function freshSession(forceRefresh) {
    const client = window.AURORE_SUPABASE_AUTH;
    if (client && client.auth) {
      let result = null;
      try {
        result = forceRefresh
          ? await client.auth.refreshSession()
          : await client.auth.getSession();
      } catch (_) {}

      const current = result && result.data && result.data.session;
      if (current && current.access_token) {
        const expires = expiryMs(current.expires_at);
        if (!forceRefresh && expires && expires <= Date.now() + 60000) {
          const renewed = await freshSession(true);
          if (renewed) return renewed;
        } else if (!expires || expires > Date.now() + 10000) {
          publishFreshSession(current);
          return {
            access_token: current.access_token,
            refresh_token: current.refresh_token || "",
            expires_at: current.expires_at || null
          };
        }
      }
    }

    const legacy = (() => {
      try { return typeof session !== "undefined" && session?.access_token ? session : null; }
      catch (_) { return null; }
    })();
    if (!legacy?.refresh_token) return null;
    const expires = expiryMs(legacy.expires_at);
    if (!forceRefresh && (!expires || expires > Date.now() + 60000)) {
      return {
        access_token: legacy.access_token,
        refresh_token: legacy.refresh_token || "",
        expires_at: legacy.expires_at || null
      };
    }
    return refreshGlobalSession(client);
  }

  async function sendPairing(current) {
    return fetch("https://aurore-connector.vercel.app/archives/complete-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pair,
        accessToken: current.access_token,
        refreshToken: current.refresh_token || "",
        expiresAt: current.expires_at || null
      }),
      cache: "no-store"
    });
  }

  function scheduleRetry() {
    failures += 1;
    nextAttemptAt = Date.now() + Math.min(30000, 1000 * Math.pow(2, Math.min(failures - 1, 5)));
  }

  async function attempt() {
    if (finished || busy || rounds++ > 960 || Date.now() < nextAttemptAt) {
      if (rounds > 960 && timer) {
        clearInterval(timer);
        notice("Le lien de connexion a expiré. Reviens à la conversation et génère un nouveau lien.", true);
      }
      return;
    }

    let current = null;
    try { current = await freshSession(false); } catch (_) {}
    if (!current || !current.access_token || current.access_token === lastToken) return;

    busy = true;
    try {
      let response = await sendPairing(current);

      // Une ancienne session est la cause fréquente du HTTP 401 pendant la
      // liaison. Renouvelle-la une fois et rejoue le même lien, sans le recréer.
      if (response.status === 401) {
        const refreshed = await freshSession(true);
        if (refreshed && refreshed.access_token && refreshed.access_token !== current.access_token) {
          current = refreshed;
          response = await sendPairing(current);
        }
      }

      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        finished = true;
        lastToken = current.access_token;
        failures = 0;
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        clearPairFromUrl();
        notice("Aurore Archives est connectée. Tu peux revenir à la conversation pour continuer.", false);
        if (timer) clearInterval(timer);
        return;
      }

      notice(result.error || "Connexion impossible. Reviens à la conversation et vérifie la session Aurore ID.", true);
      if (response.status === 410) {
        finished = true;
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        if (timer) clearInterval(timer);
        return;
      }

      // Pour un refus définitif, attendre un nouveau jeton ou un nouveau lien.
      // Pour une erreur serveur, appliquer un délai progressif et réessayer.
      if (response.status >= 500 || response.status === 429) {
        lastToken = "";
        scheduleRetry();
      } else {
        lastToken = current.access_token;
      }
    } catch (_) {
      notice("La connexion au plugin n'a pas pu être vérifiée. Vérifie le réseau et réessaie.", true);
      lastToken = "";
      scheduleRetry();
    } finally {
      busy = false;
    }
  }

  const start = () => {
    attempt();
    timer = window.setInterval(attempt, 500);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
