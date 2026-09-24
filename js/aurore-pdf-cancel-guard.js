/* Aurore — garde d’annulation des rendus PDF.
   Le bouton « Annuler la génération » appartient désormais au flux Content Factory.
   Cette garde ne crée plus un second bouton concurrent : elle stabilise simplement
   le même bouton pendant les reconstructions/pollings des deux zones admin. */
(function () {
  'use strict';

  window.addEventListener('unhandledrejection', function (event) {
    const r = event.reason;
    const message = String(r?.message || r || '');
    if (/rendering\s+cancelled|RenderingCancelled/i.test(message)) {
      event.preventDefault();
    }
  });

  function ensureStyles() {
    if (document.getElementById('aurore-pdf-cancel-admin-styles')) return;
    const s = document.createElement('style');
    s.id = 'aurore-pdf-cancel-admin-styles';
    s.textContent = [
      '.cf-pdf-cancel-static{min-width:155px!important}',
      '.cf-pdf-cancel-static:disabled{opacity:.8!important;cursor:wait!important}',
      '.aurore-pdf-cancel-note{display:block;margin-top:6px;font-size:.68rem;',
      'color:#b91c1c;line-height:1.4}'
    ].join('');
    document.head.appendChild(s);
  }

  function actionBusy(id, kind) {
    const set = window.__aurorePdfActionBusy;
    return set instanceof Set && set.has(String(kind) + ':' + String(id));
  }

  function cancelRequested(id) {
    const set = window.__aurorePdfCancelRequested;
    return set instanceof Set && set.has(Number(id));
  }

  function ensureCancelButton(card, id) {
    if (!card) return null;
    const actions = card.querySelector('.cf-admin-actions-stable, .aurore-pdf-prod-actions');
    if (!actions) return null;

    let button = actions.querySelector('[data-cf-cancel="' + CSS.escape(String(id)) + '"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'admin-btn danger cf-pdf-cancel-static';
      button.dataset.cfCancel = String(id);
      button.textContent = 'Annuler la génération';
      button.title = 'Annuler cette génération PDF';
      actions.appendChild(button);
    }
    return button;
  }

  function syncContentFactory() {
    const root = document.getElementById('adminContentFactoryList');
    if (!root) return;

    root.querySelectorAll('[data-generated-document-id]').forEach(card => {
      const id = Number(card.dataset.generatedDocumentId || 0);
      if (!id) return;

      const render = card.querySelector('[data-cf-render="' + CSS.escape(String(id)) + '"]');
      const stage = card.querySelector('.cf-admin-generation-state');
      const text = String(stage?.textContent || '') + ' ' + String(render?.textContent || '');
      const localRunning =
        actionBusy(id, 'render') ||
        /génération|régénération|lualatex|mise en file|préparation/i.test(text);

      const cancel = card.querySelector('[data-cf-cancel="' + CSS.escape(String(id)) + '"]');
      if (localRunning || cancelRequested(id)) {
        const b = ensureCancelButton(card, id);
        if (b) {
          b.disabled = cancelRequested(id);
          b.textContent = cancelRequested(id) ? 'Annulation demandée…' : 'Annuler la génération';
          if (cancelRequested(id)) b.setAttribute('aria-busy', 'true');
          else b.removeAttribute('aria-busy');
        }
      } else if (cancel && !card.classList.contains('is-processing')) {
        cancel.remove();
      }
    });
  }

  function syncProductionCenter() {
    const root = document.getElementById('aurorePdfProdList');
    if (!root) return;

    root.querySelectorAll('.aurore-pdf-prod-card').forEach(card => {
      const id = Number(card.dataset.productionId || 0);
      if (!id) return;

      const active =
        card.classList.contains('is-processing') ||
        card.classList.contains('is-queued') ||
        actionBusy(id, 'render') ||
        cancelRequested(id);

      const cancel = card.querySelector('[data-cf-cancel="' + CSS.escape(String(id)) + '"]');
      if (active) {
        const b = ensureCancelButton(card, id);
        if (b) {
          b.disabled = cancelRequested(id);
          b.textContent = cancelRequested(id) ? 'Annulation demandée…' : 'Annuler la génération';
          if (cancelRequested(id)) b.setAttribute('aria-busy', 'true');
          else b.removeAttribute('aria-busy');
        }
      } else if (cancel) {
        cancel.remove();
      }
    });
  }

  function sync() {
    try {
      syncContentFactory();
      syncProductionCenter();
    } catch (e) {
      console.warn('[Aurore PDF cancel guard]', e);
    }
  }

  function boot() {
    ensureStyles();
    sync();

    const observer = new MutationObserver(function () {
      sync();
    });

    const roots = [
      document.getElementById('adminContentFactoryList'),
      document.getElementById('aurorePdfProdList')
    ].filter(Boolean);

    roots.forEach(root => observer.observe(root, { childList: true, subtree: true }));

    window.setInterval(sync, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();