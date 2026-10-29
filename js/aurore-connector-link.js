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

  async function attempt() {
    if (finished || busy || rounds++ > 960) {
      if (rounds > 960 && timer) clearInterval(timer);
      return;
    }
    let current = null;
    try {
      if (typeof session !== "undefined" && session && session.access_token) current = session;
    } catch (_) {}
    if (!current || !current.access_token || current.access_token === lastToken) return;

    busy = true;
    lastToken = current.access_token;
    try {
      const response = await fetch("https://aurore-connector.vercel.app/archives/complete-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pair: pair,
          accessToken: current.access_token,
          refreshToken: current.refresh_token || "",
          expiresAt: current.expires_at || null
        }),
        cache: "no-store"
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        finished = true;
        try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
        clearPairFromUrl();
        notice("Aurore Archives est reliée au plugin. Retourne dans ChatGPT pour continuer.", false);
        if (timer) clearInterval(timer);
      } else {
        notice(result.error || "Connexion au plugin impossible. Reviens dans ChatGPT et génère un nouveau lien.", true);
        if (response.status === 410) {
          finished = true;
          try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
          if (timer) clearInterval(timer);
        }
      }
    } catch (_) {
      notice("La connexion au plugin n'a pas pu être vérifiée. Vérifie le réseau et réessaie.", true);
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