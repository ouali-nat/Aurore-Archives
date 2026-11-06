(function () {
  "use strict";
  var hero = document.getElementById("enelesHomeHero") || document.getElementById("enelesMemoryHero");
  if (!hero || hero.dataset.enelesResizeReady === "1") return;
  hero.dataset.enelesResizeReady = "1";

  var isMemory = hero.id === "enelesMemoryHero";
  var hiddenKey = isMemory ? "eneles:memory-hero-hidden" : "eneles:home-hero-hidden";
  var sizeKey = isMemory ? "eneles:memory-hero-size-v1" : "eneles:archives-hero-size-v1";
  var controlRow = hero.previousElementSibling;
  if (!controlRow || !controlRow.classList.contains("eneles-hero-controls")) {
    controlRow = document.createElement("div");
    controlRow.className = "eneles-hero-controls";
    hero.parentNode.insertBefore(controlRow, hero);
  }

  controlRow.classList.add(isMemory ? "eneles-memory-hero-controls" : "eneles-archives-hero-controls");
  var trigger = controlRow.querySelector("#enelesHeroMenuTrigger") || controlRow.querySelector(".eneles-hero-menu-trigger");
  if (!trigger) {
    trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "eneles-hero-toggle eneles-hero-menu-trigger";
    controlRow.appendChild(trigger);
  }
  trigger.id = "enelesHeroMenuTrigger";
  trigger.classList.add("eneles-hero-menu-trigger");
  trigger.textContent = "•••";
  trigger.setAttribute("aria-label", "Options de l’accueil");
  trigger.setAttribute("title", "Options de l’accueil");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");

  var shell = document.createElement("div");
  shell.className = "eneles-hero-resize-shell " + (isMemory ? "eneles-memory-hero-shell" : "eneles-archives-hero-shell");
  hero.parentNode.insertBefore(shell, hero);
  shell.appendChild(hero);

  var menu = document.createElement("div");
  menu.className = "eneles-hero-options-menu";
  menu.id = "enelesHeroOptionsMenu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Réglages de l’accueil");
  menu.hidden = true;
  menu.innerHTML =
    '<div class="eneles-hero-menu-head">' +
      '<span class="eneles-hero-menu-mark" aria-hidden="true">E</span>' +
      '<span class="eneles-hero-menu-heading"><strong>Réglages de l’accueil</strong><small>Personnalisez votre espace</small></span>' +
      '<button type="button" class="eneles-hero-menu-close" data-hero-close aria-label="Fermer">×</button>' +
    '</div>' +
    '<button type="button" class="eneles-hero-option" data-hero-action="visibility">' +
      '<span class="eneles-hero-option-icon" aria-hidden="true">◉</span>' +
      '<span class="eneles-hero-option-copy"><strong class="eneles-hero-option-title">Masquer l’accueil</strong><small>Afficher ou masquer le bloc d’accueil</small></span>' +
    '</button>' +
    '<button type="button" class="eneles-hero-option" data-hero-action="resize">' +
      '<span class="eneles-hero-option-icon resize-icon" aria-hidden="true">⤢</span>' +
      '<span class="eneles-hero-option-copy"><strong class="eneles-hero-option-title">Redimensionner l’accueil</strong><small>Ajuster la largeur et la hauteur avec les poignées</small></span>' +
    '</button>';
  document.body.appendChild(menu);
  trigger.setAttribute("aria-controls", menu.id);

  var toolbar = document.createElement("div");
  toolbar.className = "eneles-hero-resize-toolbar";
  toolbar.hidden = true;
  toolbar.innerHTML = '<span class="eneles-resize-status"><i aria-hidden="true"></i><span><strong>Redimensionnement actif</strong><small>Faites glisser une poignée sur les bords ou les angles</small></span></span><button type="button" data-hero-resize-done>Terminer</button>';
  document.body.appendChild(toolbar);

  var directions = [
    ["n", "Haut"], ["s", "Bas"], ["e", "Droite"], ["w", "Gauche"],
    ["ne", "Angle supérieur droit"], ["nw", "Angle supérieur gauche"],
    ["se", "Angle inférieur droit"], ["sw", "Angle inférieur gauche"]
  ];
  var handles = document.createElement("div");
  handles.className = "eneles-hero-resize-handles";
  handles.hidden = true;
  directions.forEach(function (item) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "eneles-hero-resize-handle handle-" + item[0];
    button.dataset.edge = item[0];
    button.setAttribute("aria-label", "Redimensionner depuis : " + item[1]);
    button.setAttribute("title", item[1]);
    button.setAttribute("aria-hidden", "true");
    handles.appendChild(button);
  });
  document.body.appendChild(handles);

  var hidden = false, resizing = false, customSize = false;
  var xOffset = 0, yOffset = 0, activePointer = null, drag = null, saved = null;
  try {
    hidden = localStorage.getItem(hiddenKey) === "1";
    saved = JSON.parse(localStorage.getItem(sizeKey) || "null");
  } catch (_) {}

  function parentWidth() {
    return Math.max(280, shell.parentElement ? shell.parentElement.clientWidth : window.innerWidth);
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function applyOffset() { shell.style.transform = "translate(" + xOffset + "px," + yOffset + "px)"; }

  function applySavedSize() {
    if (!saved || !Number.isFinite(Number(saved.widthRatio)) || !Number.isFinite(Number(saved.height))) return;
    var pw = parentWidth();
    var maxWidth = Math.max(280, Math.min(window.innerWidth - 24, pw + 120));
    var width = clamp(Number(saved.widthRatio) * pw, 280, maxWidth);
    var minimumHeight = Math.max(300, contentMinHeight());
    var height = clamp(Number(saved.height), minimumHeight, Math.max(minimumHeight, window.innerHeight * 1.5));
    xOffset = Number(saved.xRatio || 0) * pw;
    yOffset = Number(saved.y || 0);
    if (Number.isFinite(Number(saved.flowMarginBottom))) shell.style.marginBottom = Number(saved.flowMarginBottom) + "px";
    var parentLeft = shell.parentElement.getBoundingClientRect().left;
    var centeredLeft = parentLeft + (pw - width) / 2;
    xOffset = clamp(xOffset, 12 - centeredLeft, window.innerWidth - 12 - centeredLeft - width);
    shell.style.width = width + "px";
    shell.style.height = height + "px";
    shell.classList.add("has-custom-size");
    customSize = true;
    applyOffset();
  }

  function positionHandles() {
    if (!resizing || handles.hidden) return;
    var rect = shell.getBoundingClientRect();
    handles.style.setProperty("left", rect.left + "px", "important");
    handles.style.setProperty("top", rect.top + "px", "important");
    handles.style.setProperty("width", rect.width + "px", "important");
    handles.style.setProperty("height", rect.height + "px", "important");
  }

  function saveSize() {
    var rect = shell.getBoundingClientRect(), pw = parentWidth();
    saved = { widthRatio: rect.width / pw, height: rect.height, xRatio: xOffset / pw, y: yOffset,
      flowMarginBottom: parseFloat(shell.style.marginBottom || window.getComputedStyle(shell).marginBottom) || 0 };
    try { localStorage.setItem(sizeKey, JSON.stringify(saved)); } catch (_) {}
    customSize = true;
  }

  function contentMinHeight() {
    var inner = hero.querySelector(".hero-inner"), computed = window.getComputedStyle(hero);
    var padding = (parseFloat(computed.paddingTop) || 0) + (parseFloat(computed.paddingBottom) || 0);
    return Math.max(300, (inner ? inner.scrollHeight : 220) + padding + 12);
  }

  window.enelesSetHeroVisible = function (visible) {
    hidden = !visible;
    if (hidden) stopResize();
    setVisibility();
    try { localStorage.setItem(hiddenKey, hidden ? "1" : "0"); } catch (_) {}
    return !hidden;
  };
  window.enelesIsHeroVisible = function () { return !hidden; };

  function closeMenu() {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("is-open");
  }
  function openMenu() {
    menu.hidden = false;
    menu.style.setProperty("position", "fixed", "important");
    menu.style.setProperty("top", "0px", "important");
    menu.style.setProperty("left", "0px", "important");
    menu.style.setProperty("right", "auto", "important");
    var anchor = trigger.getBoundingClientRect();
    var menuRect = menu.getBoundingClientRect();
    var left = clamp(anchor.right - menuRect.width, 12, window.innerWidth - menuRect.width - 12);
    var top = clamp(anchor.bottom + 8, 12, window.innerHeight - menuRect.height - 12);
    menu.style.setProperty("left", left + "px", "important");
    menu.style.setProperty("top", top + "px", "important");
    trigger.setAttribute("aria-expanded", "true");
    trigger.classList.add("is-open");
  }
  function setVisibility() {
    hero.hidden = hidden;
    hero.setAttribute("aria-hidden", String(hidden));
    shell.classList.toggle("is-hidden", hidden);
    var visibility = menu.querySelector('[data-hero-action="visibility"] .eneles-hero-option-title');
    if (visibility) visibility.textContent = hidden ? "Afficher l’accueil" : "Masquer l’accueil";
    var resizeOption = menu.querySelector('[data-hero-action="resize"]');
    if (resizeOption) {
      resizeOption.disabled = hidden;
      resizeOption.setAttribute("aria-disabled", String(hidden));
    }
    if (hidden) stopResize();
  }
  function stopResize() {
    resizing = false;
    shell.classList.remove("is-resizing");
    handles.hidden = true;
    toolbar.hidden = true;
    handles.querySelectorAll("button").forEach(function (button) {
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    });
    if (customSize) saveSize();
  }
  function startResize() {
    if (hidden) return;
    closeMenu();
    resizing = true;
    shell.classList.add("is-resizing");
    handles.hidden = false;
    toolbar.hidden = false;
    positionHandles();
    handles.querySelectorAll("button").forEach(function (button) {
      button.setAttribute("aria-hidden", "false");
      button.tabIndex = 0;
    });
    if (!customSize) {
      var rect = shell.getBoundingClientRect();
      shell.style.width = rect.width + "px";
      shell.style.height = rect.height + "px";
      shell.classList.add("has-custom-size");
      customSize = true;
      xOffset = 0;
      yOffset = 0;
    }
  }
  function beginDrag(event) {
    if (!resizing || event.button > 0) return;
    var rect = shell.getBoundingClientRect(), handle = event.currentTarget;
    event.preventDefault();
    activePointer = event.pointerId;
    drag = {
      pointerId: event.pointerId, edge: handle.dataset.edge || "",
      startX: event.clientX, startY: event.clientY,
      width: rect.width, height: rect.height, xOffset: xOffset, yOffset: yOffset,
      marginBottom: parseFloat(window.getComputedStyle(shell).marginBottom) || 0
    };
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== activePointer) return;
    var dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    var edge = drag.edge;
    var east = edge.indexOf("e") !== -1, west = edge.indexOf("w") !== -1;
    var north = edge.indexOf("n") !== -1, south = edge.indexOf("s") !== -1;
    var minWidth = Math.min(280, Math.max(220, window.innerWidth - 24));
    var maxWidth = Math.max(minWidth, Math.min(window.innerWidth - 24, parentWidth() + 120));
    var width = drag.width + (east ? dx : (west ? -dx : 0));
    var height = drag.height + (south ? dy : (north ? -dy : 0));
    var heroMinimum = contentMinHeight();
    width = clamp(width, minWidth, maxWidth);
    height = clamp(height, heroMinimum, Math.max(heroMinimum, window.innerHeight * 1.5));
    var actualWidthChange = width - drag.width;
    var actualHeightChange = height - drag.height;
    xOffset = drag.xOffset + (east ? actualWidthChange / 2 : (west ? -actualWidthChange / 2 : 0));
    yOffset = drag.yOffset + (north ? -actualHeightChange : 0);
    if (north) shell.style.marginBottom = (drag.marginBottom - actualHeightChange) + "px";
    var parentRect = shell.parentElement.getBoundingClientRect();
    var centeredLeft = parentRect.left + (parentWidth() - width) / 2;
    xOffset = clamp(xOffset, 12 - centeredLeft, window.innerWidth - 12 - centeredLeft - width);
    shell.style.width = width + "px";
    shell.style.height = height + "px";
    applyOffset();
    positionHandles();
  }
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== activePointer)) return;
    drag = null;
    activePointer = null;
    saveSize();
  }

  trigger.addEventListener("click", function (event) {
    event.stopPropagation();
    if (menu.hidden) openMenu(); else closeMenu();
  });
  menu.addEventListener("click", function (event) {
    if (event.target.closest("[data-hero-close]")) { closeMenu(); return; }
    var action = event.target.closest("[data-hero-action]");
    if (!action || action.disabled) return;
    if (action.dataset.heroAction === "visibility") {
      hidden = !hidden;
      stopResize();
      setVisibility();
      try { localStorage.setItem(hiddenKey, hidden ? "1" : "0"); } catch (_) {}
      closeMenu();
    } else if (action.dataset.heroAction === "resize") {
      startResize();
    }
  });
  toolbar.querySelector("[data-hero-resize-done]").addEventListener("click", stopResize);
  handles.querySelectorAll("button").forEach(function (button) {
    button.tabIndex = -1;
    button.addEventListener("pointerdown", beginDrag);
  });
  window.addEventListener("pointermove", moveDrag, { passive: false });
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  window.addEventListener("scroll", positionHandles, true);
  document.addEventListener("pointerdown", function (event) {
    if (!controlRow.contains(event.target) && !menu.contains(event.target) &&
        !toolbar.contains(event.target) && !handles.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeMenu();
      if (resizing) stopResize();
    }
  });
  window.addEventListener("resize", function () {
    if (resizing) { positionHandles(); return; }
    if (!customSize || !saved) return;
    // Recalcule la taille depuis ses proportions mémorisées, sans écraser
    // les dimensions choisies lorsque le téléphone change d'orientation.
    applySavedSize();
  });

  var style = document.createElement("style");
  style.id = "eneles-hero-controls-styles";
  style.textContent = [
    ".eneles-hero-resize-shell{position:relative;display:block;width:100%;max-width:none;min-width:0;margin-inline:auto;box-sizing:border-box;transform:translate(0,0)}",
    ".eneles-archives-hero-shell{width:calc(100% + clamp(0px,8vw,120px))}",
    ".eneles-memory-hero-shell{width:calc(100% - 4mm)}",
    ".eneles-hero-controls{position:relative!important;display:flex!important;justify-content:flex-end!important;align-items:center!important;gap:8px!important;width:100%!important;min-width:0!important;margin:0 0 8px!important;padding:0!important;z-index:30!important}",
    ".eneles-hero-menu-trigger{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:42px!important;min-width:42px!important;height:38px!important;min-height:38px!important;margin:0!important;padding:0!important;border:1px solid color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 35%,var(--bordure,rgba(120,110,140,.25)))!important;border-radius:12px!important;background:var(--surface,rgba(255,255,255,.82))!important;color:var(--text,#282333)!important;box-shadow:0 5px 16px rgba(35,20,60,.12)!important;font-size:17px!important;font-weight:800!important;letter-spacing:2px!important;line-height:1!important;cursor:pointer!important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}",
    ".eneles-hero-menu-trigger:hover,.eneles-hero-menu-trigger.is-open{transform:translateY(-1px);box-shadow:0 8px 20px rgba(35,20,60,.16)!important}",
    "html body #screen-home .eneles-hero-menu-trigger{display:inline-flex!important;position:relative!important;right:auto!important;top:auto!important;float:none!important;margin:0!important;width:42px!important;min-width:42px!important;height:38px!important;min-height:38px!important;padding:0!important;background:var(--papier,#fff)!important;color:var(--encre,#282333)!important;border:1px solid var(--bordure,rgba(130,110,160,.25))!important;border-radius:12px!important}",
    ".eneles-archives-hero-controls .eneles-hero-menu-trigger{background:var(--papier,#fff)!important;color:var(--encre,#282333)!important;border-color:var(--bordure,rgba(130,110,160,.25))!important}",
    ".eneles-archives-hero-controls .eneles-hero-options-menu{background:var(--papier,#fff)!important;color:var(--encre,#282333)!important;border-color:var(--bordure,rgba(130,110,160,.25))!important}",
    ".eneles-archives-hero-controls .eneles-hero-resize-toolbar{background:var(--papier,#fff)!important;color:var(--encre,#282333)!important;border-color:var(--bordure,rgba(130,110,160,.25))!important}",
    ".eneles-hero-options-menu{position:absolute!important;top:calc(100% + 7px)!important;right:0!important;z-index:1000!important;display:grid!important;gap:5px!important;width:min(290px,calc(100vw - 32px))!important;padding:8px!important;border:1px solid var(--border,var(--bordure,rgba(130,110,160,.25)))!important;border-radius:15px!important;background:var(--surface,#fff)!important;color:var(--text,#292333)!important;box-shadow:0 16px 38px rgba(25,15,45,.2)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important}",
    ".eneles-hero-options-menu[hidden],.eneles-hero-resize-toolbar[hidden],.eneles-hero-resize-handles[hidden]{display:none!important}",
    ".eneles-hero-option{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:3px!important;width:100%!important;min-height:46px!important;padding:10px 12px!important;border:0!important;border-radius:10px!important;background:transparent!important;color:inherit!important;text-align:left!important;font:inherit!important;cursor:pointer!important}",
    ".eneles-hero-option:hover,.eneles-hero-option:focus-visible{background:color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 10%,transparent)!important;outline:none}",
    ".eneles-hero-option small{font-size:11px!important;opacity:.65!important}",
    ".eneles-hero-option:disabled{opacity:.4!important;cursor:not-allowed!important}",
    ".eneles-hero-resize-toolbar{position:fixed!important;top:12px!important;right:12px!important;z-index:99999!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;width:min(390px,calc(100vw - 24px))!important;margin:0!important;padding:8px 10px!important;border:1px solid color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 30%,transparent)!important;border-radius:12px!important;background:var(--surface,#fff)!important;color:var(--text,#282333)!important;box-shadow:0 12px 32px rgba(0,0,0,.2)!important;font-size:12px!important}",
    ".eneles-hero-resize-toolbar button{flex:0 0 auto!important;border:0!important;border-radius:9px!important;padding:7px 11px!important;background:var(--theme-primary,var(--accent,#7c3aed))!important;color:#fff!important;font:inherit!important;font-weight:700!important;cursor:pointer!important}",
    "html body #screen-home .eneles-hero-resize-shell>#enelesHomeHero.hero,html body[data-page=home] .eneles-hero-resize-shell>#enelesMemoryHero.eneles-memory-hero.hero.aurore-hero-morph{width:100%!important;max-width:100%!important;min-width:0!important;position:relative!important;left:auto!important;right:auto!important;transform:none!important;margin:0!important;box-sizing:border-box!important}",
    "html body #screen-home .eneles-hero-resize-shell.has-custom-size>#enelesHomeHero.hero,html body[data-page=home] .eneles-hero-resize-shell.has-custom-size>#enelesMemoryHero.eneles-memory-hero.hero.aurore-hero-morph{width:100%!important;height:100%!important;min-height:0!important;max-height:none!important;box-sizing:border-box!important}",
    ".eneles-hero-resize-shell.is-resizing{outline:1px dashed color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 65%,transparent);outline-offset:7px}",
    ".eneles-hero-resize-handles{position:absolute!important;inset:0!important;z-index:80!important;pointer-events:none!important}",
    ".eneles-hero-resize-handle{position:absolute!important;display:block!important;width:22px!important;height:22px!important;min-width:22px!important;min-height:22px!important;margin:0!important;padding:0!important;border:2px solid #fff!important;border-radius:50%!important;background:var(--theme-primary,var(--accent,#7c3aed))!important;box-shadow:0 1px 8px rgba(0,0,0,.32)!important;pointer-events:auto!important;touch-action:none!important;cursor:move!important}",
    ".eneles-hero-resize-handle.handle-n{top:-11px!important;left:calc(50% - 11px)!important;cursor:ns-resize!important;width:34px!important;height:12px!important;min-height:12px!important;border-radius:9px!important}",
    ".eneles-hero-resize-handle.handle-s{bottom:-11px!important;left:calc(50% - 11px)!important;cursor:ns-resize!important;width:34px!important;height:12px!important;min-height:12px!important;border-radius:9px!important}",
    ".eneles-hero-resize-handle.handle-e{right:-11px!important;top:calc(50% - 11px)!important;cursor:ew-resize!important;width:12px!important;height:34px!important;min-width:12px!important;border-radius:9px!important}",
    ".eneles-hero-resize-handle.handle-w{left:-11px!important;top:calc(50% - 11px)!important;cursor:ew-resize!important;width:12px!important;height:34px!important;min-width:12px!important;border-radius:9px!important}",
    ".eneles-hero-resize-handle.handle-ne{top:-11px!important;right:-11px!important;cursor:nesw-resize!important}",
    ".eneles-hero-resize-handle.handle-nw{top:-11px!important;left:-11px!important;cursor:nwse-resize!important}",
    ".eneles-hero-resize-handle.handle-se{bottom:-11px!important;right:-11px!important;cursor:nwse-resize!important}",
    ".eneles-hero-resize-handle.handle-sw{bottom:-11px!important;left:-11px!important;cursor:nesw-resize!important}",
    ".eneles-hero-resize-handle:focus-visible{outline:3px solid var(--theme-secondary,#c4b5fd)!important;outline-offset:3px!important}",
    "@media(max-width:640px){.eneles-archives-hero-shell{width:100%}.eneles-hero-menu-trigger{width:40px!important;min-width:40px!important;height:36px!important;min-height:36px!important}.eneles-hero-resize-handle{width:26px!important;height:26px!important;min-width:26px!important;min-height:26px!important}.eneles-hero-resize-handle.handle-n,.eneles-hero-resize-handle.handle-s{width:42px!important;height:18px!important;min-height:18px!important}.eneles-hero-resize-handle.handle-e,.eneles-hero-resize-handle.handle-w{width:18px!important;height:42px!important;min-width:18px!important}}",
    ".eneles-hero-menu-head{display:flex!important;align-items:center!important;gap:10px!important;padding:8px 8px 12px!important;border-bottom:1px solid color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 18%,transparent)!important;margin-bottom:3px!important}",
    ".eneles-hero-menu-mark{display:grid!important;place-items:center!important;flex:0 0 36px!important;width:36px!important;height:36px!important;border-radius:12px!important;background:linear-gradient(145deg,var(--theme-primary,var(--accent,#7c3aed)),var(--theme-secondary,var(--accent-light,#b58cff)))!important;color:#fff!important;font-size:17px!important;font-weight:900!important;box-shadow:0 5px 14px color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 25%,transparent)!important}",
    ".eneles-hero-menu-heading{display:grid!important;gap:3px!important;min-width:0!important;flex:1!important}.eneles-hero-menu-heading strong{font-size:13px!important;font-weight:850!important;letter-spacing:-.01em!important}.eneles-hero-menu-heading small{font-size:10px!important;opacity:.62!important}",
    ".eneles-hero-menu-close{display:grid!important;place-items:center!important;flex:0 0 30px!important;width:30px!important;height:30px!important;border:0!important;border-radius:9px!important;background:color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 9%,transparent)!important;color:inherit!important;font-size:20px!important;line-height:1!important}",
    ".eneles-hero-options-menu{width:min(330px,calc(100vw - 28px))!important;padding:12px!important;border-radius:18px!important;background:var(--surface,var(--papier,#fff))!important;color:var(--text,var(--encre,#292333))!important;border:1px solid color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 22%,var(--border,rgba(130,110,160,.2)))!important;box-shadow:0 20px 48px rgba(30,18,52,.22),0 3px 10px rgba(30,18,52,.08)!important}",
    ".eneles-hero-option{display:flex!important;flex-direction:row!important;align-items:center!important;gap:11px!important;min-height:64px!important;padding:10px!important;border-radius:13px!important}",
    ".eneles-hero-option-icon{display:grid!important;place-items:center!important;flex:0 0 38px!important;width:38px!important;height:38px!important;border-radius:12px!important;background:color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 12%,transparent)!important;color:var(--theme-primary,var(--accent,#7c3aed))!important;font-size:19px!important;font-weight:800!important}",
    ".eneles-hero-option-icon.resize-icon{background:color-mix(in srgb,var(--theme-secondary,var(--accent-light,#b58cff)) 20%,transparent)!important;color:var(--theme-primary,var(--accent,#7c3aed))!important}",
    ".eneles-hero-option-copy{display:grid!important;gap:4px!important;min-width:0!important;text-align:left!important}.eneles-hero-option-copy strong{font-size:12px!important;font-weight:800!important}.eneles-hero-option-copy small{font-size:10px!important;line-height:1.35!important;opacity:.64!important}",
    ".eneles-hero-resize-toolbar{top:auto!important;right:12px!important;bottom:calc(14px + env(safe-area-inset-bottom,0px))!important;left:12px!important;width:auto!important;max-width:520px!important;margin-inline:auto!important;padding:11px 13px!important;border-radius:16px!important;background:var(--surface,var(--papier,#fff))!important;color:var(--text,var(--encre,#292333))!important;border:1px solid color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 24%,transparent)!important;box-shadow:0 16px 38px rgba(25,15,45,.22)!important}",
    ".eneles-resize-status{display:flex!important;align-items:center!important;gap:9px!important;min-width:0!important}.eneles-resize-status>i{display:block!important;flex:0 0 9px!important;width:9px!important;height:9px!important;border-radius:50%!important;background:var(--theme-primary,var(--accent,#7c3aed))!important;box-shadow:0 0 0 4px color-mix(in srgb,var(--theme-primary,var(--accent,#7c3aed)) 14%,transparent)!important}.eneles-resize-status>span{display:grid!important;gap:3px!important}.eneles-resize-status strong{font-size:11px!important;font-weight:850!important}.eneles-resize-status small{font-size:10px!important;opacity:.65!important;line-height:1.3!important}",
    ".eneles-hero-resize-handle{width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important;border:3px solid #fff!important;box-shadow:0 2px 12px rgba(0,0,0,.38)!important;z-index:82!important}",
    ".eneles-hero-resize-handle.handle-n,.eneles-hero-resize-handle.handle-s{width:48px!important;height:18px!important;min-width:48px!important;min-height:18px!important;border-radius:12px!important}",
    ".eneles-hero-resize-handle.handle-e,.eneles-hero-resize-handle.handle-w{width:18px!important;height:48px!important;min-width:18px!important;min-height:48px!important;border-radius:12px!important}",
    ".eneles-hero-resize-shell.is-resizing{outline:2px dashed var(--theme-primary,var(--accent,#7c3aed))!important;outline-offset:8px!important}",
    ".eneles-hero-resize-handles{z-index:100!important;overflow:visible!important}",
    "@media(max-width:640px){.eneles-hero-options-menu{right:0!important;width:min(330px,calc(100vw - 28px))!important}.eneles-hero-resize-toolbar{left:10px!important;right:10px!important;bottom:calc(10px + env(safe-area-inset-bottom,0px))!important;padding:10px!important}.eneles-hero-resize-handle.handle-n,.eneles-hero-resize-handle.handle-s{width:48px!important;height:20px!important;min-height:20px!important}.eneles-hero-resize-handle.handle-e,.eneles-hero-resize-handle.handle-w{width:20px!important;height:48px!important;min-width:20px!important}}",
    "@media(prefers-reduced-motion:reduce){.eneles-hero-menu-trigger{transition:none!important}}"
  ].join("\n");
  style.textContent += [
    ".eneles-hero-options-menu{position:fixed!important;top:0;left:0;right:auto;z-index:2147483000!important;max-height:min(75vh,520px)!important;overflow:auto!important;overscroll-behavior:contain!important}",
    ".eneles-hero-resize-toolbar{z-index:2147483000!important;}",
    ".eneles-hero-resize-handles{position:fixed!important;inset:auto!important;right:auto!important;bottom:auto!important;width:0;height:0;z-index:2147483001!important;overflow:visible!important;pointer-events:none!important;transform:none!important}",
    ".eneles-hero-resize-handle{position:absolute!important;display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;touch-action:none!important;appearance:none!important;-webkit-appearance:none!important;z-index:2147483002!important}",
    ".eneles-hero-resize-handle.handle-n{top:-16px!important;left:calc(50% - 27px)!important;width:54px!important;height:32px!important;min-width:54px!important;min-height:32px!important;border-radius:14px!important;cursor:ns-resize!important}",
    ".eneles-hero-resize-handle.handle-s{bottom:-16px!important;left:calc(50% - 27px)!important;width:54px!important;height:32px!important;min-width:54px!important;min-height:32px!important;border-radius:14px!important;cursor:ns-resize!important}",
    ".eneles-hero-resize-handle.handle-e{right:-16px!important;top:calc(50% - 27px)!important;width:32px!important;height:54px!important;min-width:32px!important;min-height:54px!important;border-radius:14px!important;cursor:ew-resize!important}",
    ".eneles-hero-resize-handle.handle-w{left:-16px!important;top:calc(50% - 27px)!important;width:32px!important;height:54px!important;min-width:32px!important;min-height:54px!important;border-radius:14px!important;cursor:ew-resize!important}",
    ".eneles-hero-resize-handle.handle-ne{top:-16px!important;right:-16px!important;width:34px!important;height:34px!important;min-width:34px!important;min-height:34px!important;cursor:nesw-resize!important}",
    ".eneles-hero-resize-handle.handle-nw{top:-16px!important;left:-16px!important;width:34px!important;height:34px!important;min-width:34px!important;min-height:34px!important;cursor:nwse-resize!important}",
    ".eneles-hero-resize-handle.handle-se{bottom:-16px!important;right:-16px!important;width:34px!important;height:34px!important;min-width:34px!important;min-height:34px!important;cursor:nwse-resize!important}",
    ".eneles-hero-resize-handle.handle-sw{bottom:-16px!important;left:-16px!important;width:34px!important;height:34px!important;min-width:34px!important;min-height:34px!important;cursor:nesw-resize!important}",
    "@media(max-width:640px){.eneles-hero-resize-handle{border-width:3px!important;box-shadow:0 3px 14px rgba(0,0,0,.42)!important}.eneles-hero-options-menu{width:min(330px,calc(100vw - 24px))!important}}"
  ].join("\n");
  document.head.appendChild(style);
  // Les styles de l'en-tête sont parfois chargés tardivement par un autre
  // script. Replacer ce correctif après leur chargement pour garder la main.
  function raiseHeroControlsStyles() {
    if (style.parentNode) style.parentNode.removeChild(style);
    document.head.appendChild(style);
  }
  if (document.readyState === "complete") raiseHeroControlsStyles();
  else window.addEventListener("load", raiseHeroControlsStyles, { once: true });

  if (saved) applySavedSize();
  setVisibility();
})();
