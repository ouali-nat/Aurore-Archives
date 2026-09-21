(function () {
  "use strict";
  const params = new URLSearchParams(window.location.search);
  const generatedId = params.get("verify_document");
  if (!/^\d+$/.test(String(generatedId || ""))) return;
  const ENDPOINT = "https://tdeotqfsbvouresfhkab.supabase.co/functions/v1/aurora-document-verify?id=" + encodeURIComponent(generatedId);
  const style = document.createElement("style");
  style.id = "aurore-document-verifier-style";
  style.textContent = `
    .aurore-verify-layer{position:fixed;inset:0;z-index:999999;overflow:auto;background:radial-gradient(circle at 10% 10%,color-mix(in srgb,var(--couleur-principale,#C85C0D) 9%,transparent),transparent 34%),var(--fond,#f7f7f8);font-family:inherit;color:var(--encre,#16181d)}
    .aurore-verify-shell{min-height:100%;display:grid;place-items:center;padding:24px;box-sizing:border-box}
    .aurore-verify-card{width:min(760px,100%);border:1px solid color-mix(in srgb,var(--couleur-principale,#C85C0D) 20%,var(--bordure,rgba(0,0,0,.12)));border-radius:28px;background:color-mix(in srgb,var(--card-bg,#fff) 96%,transparent);box-shadow:0 24px 90px rgba(0,0,0,.15);overflow:hidden}
    .aurore-verify-top{padding:22px 22px 16px;border-bottom:1px solid var(--bordure,rgba(0,0,0,.08));display:flex;align-items:center;gap:16px}
    .aurore-verify-logo{width:72px;height:72px;border-radius:18px;border:1px solid color-mix(in srgb,var(--couleur-principale,#C85C0D) 22%,var(--bordure,rgba(0,0,0,.08)));display:grid;place-items:center;background:#fff;overflow:hidden;flex:0 0 auto}
    .aurore-verify-logo img{max-width:58px;max-height:58px}
    .aurore-verify-kicker{font-size:.68rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--couleur-principale,#C85C0D)}
    .aurore-verify-brand{font-size:1.18rem;font-weight:900;margin-top:3px}
    .aurore-verify-body{padding:24px 22px}
    .aurore-verify-state{display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border-radius:999px;background:color-mix(in srgb,var(--couleur-principale,#C85C0D) 9%,white);color:var(--couleur-principale,#C85C0D);font-size:.72rem;font-weight:900}
    .aurore-verify-title{font-size:clamp(1.55rem,4vw,2.2rem);line-height:1.12;margin:14px 0 8px}
    .aurore-verify-message{font-size:.93rem;line-height:1.65;color:var(--gris,#667085);margin:0 0 18px}
    .aurore-verify-location{padding:14px;border-radius:17px;border:1px solid var(--bordure,rgba(0,0,0,.09));background:var(--fond-secondaire,#fafafa);margin:16px 0}
    .aurore-verify-label{font-size:.65rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;opacity:.64;margin-bottom:7px}
    .aurore-verify-crumbs{display:flex;flex-wrap:wrap;gap:7px;font-size:.82rem;font-weight:800;align-items:center}
    .aurore-verify-crumbs span{padding:6px 9px;border-radius:10px;background:var(--card-bg,#fff);border:1px solid var(--bordure,rgba(0,0,0,.08))}
    .aurore-verify-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}
    .aurore-verify-meta span{font-size:.68rem;padding:6px 8px;border-radius:9px;background:color-mix(in srgb,var(--couleur-principale,#C85C0D) 7%,white);font-weight:800}
    .aurore-verify-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:20px}
    .aurore-verify-actions a,.aurore-verify-actions button{appearance:none;border:0;border-radius:13px;padding:11px 14px;font:inherit;font-size:.78rem;font-weight:900;cursor:pointer;text-decoration:none}
    .aurore-verify-primary{background:var(--couleur-principale,#C85C0D);color:#fff}
    .aurore-verify-secondary{background:var(--card-bg,#fff);color:var(--encre,#16181d);border:1px solid var(--bordure,rgba(0,0,0,.12)) !important}
    .aurore-verify-foot{padding:14px 22px;border-top:1px solid var(--bordure,rgba(0,0,0,.08));font-size:.64rem;color:var(--gris,#7a8290);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .aurore-verify-loading{opacity:.72}
    .aurore-verify-error .aurore-verify-state{background:rgba(185,28,28,.09);color:#b91c1c}
    .aurore-verify-unpublished .aurore-verify-state{background:rgba(180,83,9,.10);color:#b45309}
    @media(max-width:520px){.aurore-verify-shell{padding:12px}.aurore-verify-card{border-radius:22px}.aurore-verify-top{padding:17px}.aurore-verify-body{padding:20px 17px}.aurore-verify-foot{padding:12px 17px}.aurore-verify-logo{width:60px;height:60px}.aurore-verify-logo img{max-width:48px;max-height:48px}}
  `;
  document.head.appendChild(style);
  const layer = document.createElement("div");
  layer.className = "aurore-verify-layer";
  layer.innerHTML = `
    <div class="aurore-verify-shell"><section class="aurore-verify-card aurore-verify-loading">
      <header class="aurore-verify-top"><div class="aurore-verify-logo"><img src="https://pub-0433751d08eb49fcafb7355ef0bf42ab.r2.dev/site-logo-auraster" alt="Aurore"></div><div><div class="aurore-verify-kicker">Section Archives</div><div class="aurore-verify-brand">Vérification publique</div></div></header>
      <div class="aurore-verify-body"><div class="aurore-verify-state">Vérification en cours…</div><h1 class="aurore-verify-title">Contrôle de l’édition Aurore</h1><p class="aurore-verify-message">Aurore vérifie la publication publique et l’intégrité du fichier associé à cette référence.</p></div>
      <footer class="aurore-verify-foot"><span>AURORA · Référence #${generatedId}</span><span>© Aurore — Section Archives</span></footer>
    </section></div>`;
  document.body.appendChild(layer);
  const card = layer.querySelector(".aurore-verify-card");
  const body = layer.querySelector(".aurore-verify-body");
  function esc(value) { const d=document.createElement("div"); d.textContent=String(value==null?"":value); return d.innerHTML; }
  function back() { if (window.history.length > 1) window.history.back(); else window.location.href="/"; }
  function render(result) {
    card.classList.remove("aurore-verify-loading","aurore-verify-error","aurore-verify-unpublished");
    const status = result.status || "error";
    if (status === "published") {
      const d = result.document || {}; const path = Array.isArray(result.publication && result.publication.path) ? result.publication.path : [];
      body.innerHTML = `
        <div class="aurore-verify-state">✓ Document publié et vérifié</div>
        <h1 class="aurore-verify-title">${esc(d.title || "Document Aurore")}</h1>
        <p class="aurore-verify-message">Cette édition est présente dans la bibliothèque publique Aurore et son fichier PDF répond au contrôle d’intégrité.</p>
        <div class="aurore-verify-location"><div class="aurore-verify-label">Lieu exact de publication</div><div class="aurore-verify-crumbs">${path.map(function(x,i){return (i?'<span aria-hidden="true">›</span>':'')+'<span>'+esc(x)+'</span>';}).join("")}</div></div>
        <div class="aurore-verify-meta">${d.id?'<span>Document public #'+esc(d.id)+'</span>':''}${d.version?'<span>Version '+esc(d.version)+'</span>':''}${d.subject?'<span>'+esc(d.subject)+'</span>':''}</div>
        <div class="aurore-verify-actions"><a class="aurore-verify-primary" href="${esc(result.publication.url)}">Ouvrir le document</a><button type="button" class="aurore-verify-secondary" data-back>Retour à Aurore</button></div>`;
    } else if (status === "unpublished") {
      card.classList.add("aurore-verify-unpublished"); const d = result.document || {};
      body.innerHTML = `
        <div class="aurore-verify-state">• Document non publié</div>
        <h1 class="aurore-verify-title">${esc(d.title || "Édition Aurore")}</h1>
        <p class="aurore-verify-message">Cette édition existe dans le système éditorial Aurore, mais elle n’est pas encore disponible dans la bibliothèque publique. Le QR reste valide et pourra être rescanné après publication.</p>
        <div class="aurore-verify-meta">${d.version?'<span>Version '+esc(d.version)+'</span>':''}<span>Référence AUR #${esc(generatedId)}</span></div>
        <div class="aurore-verify-actions"><button type="button" class="aurore-verify-secondary" data-back>Retour à Aurore</button></div>`;
    } else if (status === "corrupt") {
      card.classList.add("aurore-verify-error"); const d = result.document || {};
      body.innerHTML = `
        <div class="aurore-verify-state">! Document corrompu</div>
        <h1 class="aurore-verify-title">Le fichier publié ne passe pas le contrôle</h1>
        <p class="aurore-verify-message">${esc(result.message || "Aurore a détecté un problème avec le fichier associé à cette édition.")}</p>
        <div class="aurore-verify-meta"><span>Document public #${esc(d.id || "")}</span><span>Référence AUR #${esc(generatedId)}</span></div>
        <div class="aurore-verify-actions"><button type="button" class="aurore-verify-secondary" data-back>Retour à Aurore</button></div>`;
    } else {
      card.classList.add("aurore-verify-error");
      body.innerHTML = `<div class="aurore-verify-state">! Vérification indisponible</div><h1 class="aurore-verify-title">Aurore ne peut pas confirmer cette édition</h1><p class="aurore-verify-message">${esc(result.message || "Le service de vérification est temporairement indisponible.")}</p><div class="aurore-verify-meta"><span>Référence AUR #${esc(generatedId)}</span></div><div class="aurore-verify-actions"><button type="button" class="aurore-verify-secondary" data-back>Retour à Aurore</button></div>`;
    }
    layer.querySelectorAll("[data-back]").forEach(function(btn){btn.addEventListener("click",back);});
  }
  fetch(ENDPOINT,{cache:"no-store"}).then(async function(response){const result=await response.json().catch(function(){return {};});if(!response.ok && !result.status) throw new Error(result.message || "Vérification indisponible.");return result;}).then(render).catch(function(error){render({status:"error",message:error && error.message ? error.message : "Vérification temporairement indisponible."});});
})();