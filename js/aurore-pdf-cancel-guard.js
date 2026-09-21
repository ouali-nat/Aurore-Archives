/* Aurore — garde d’annulation des rendus PDF + bouton admin.
   Le rendu PDF serveur continue hors navigateur, mais l’administration peut
   demander son arrêt. Le worker GitHub s’arrête au prochain point de contrôle
   Supabase et ne peut plus committer le PDF après une annulation. */
(function () {
  'use strict';

  window.addEventListener('unhandledrejection', function (event) {
    const r = event.reason;
    const message = String(r?.message || r || '');
    if (/rendering\s+cancelled|RenderingCancelled/i.test(message)) {
      event.preventDefault();
    }
  });

  const SUPA = () => (
    typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL
      ? SUPABASE_URL
      : 'https://tdeotqfsbvouresfhkab.supabase.co'
  );

  const ANON = () => {
    try {
      if (typeof anon === 'function') return anon();
    } catch (_) {}
    return typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';
  };

  const TOKEN = () => (
    typeof session !== 'undefined' && session?.access_token
      ? session.access_token
      : ''
  );

  const IS_ADMIN = () => (
    typeof session !== 'undefined' && session?.role === 'admin'
  );

  function headers() {
    return {
      apikey: ANON(),
      Authorization: 'Bearer ' + TOKEN(),
      'Content-Type': 'application/json'
    };
  }

  function ensureStyles() {
    if (document.getElementById('aurore-pdf-cancel-admin-styles')) return;
    const s = document.createElement('style');
    s.id = 'aurore-pdf-cancel-admin-styles';
    s.textContent = [
      '.aurore-pdf-cancel-button{border:1px solid rgba(185,28,28,.28)!important;',
      'background:rgba(185,28,28,.07)!important;color:#b91c1c!important;',
      'font-weight:800!important;cursor:pointer}',
      '.aurore-pdf-cancel-button:hover{background:rgba(185,28,28,.13)!important}',
      '.aurore-pdf-cancel-button:disabled{opacity:.6!important;cursor:wait!important}',
      '.aurore-pdf-cancel-note{display:block;margin-top:6px;font-size:.68rem;',
      'color:#b91c1c;line-height:1.4}'
    ].join('');
    document.head.appendChild(s);
  }

  function activeRowsOrdered(rows) {
    const active = (Array.isArray(rows) ? rows : []).filter(row => {
      const state = row?.metadata?.lualatex_status;
      return state === 'processing' || state === 'queued';
    });
    const processing = active.filter(row => row.metadata?.lualatex_status === 'processing');
    const queued = active
      .filter(row => row.metadata?.lualatex_status === 'queued')
      .sort((a, b) => {
        const ax = new Date(a.metadata?.lualatex_requested_at || a.created_at || 0).getTime();
        const bx = new Date(b.metadata?.lualatex_requested_at || b.created_at || 0).getTime();
        return ax - bx;
      });
    return [...processing, ...queued];
  }

  function decorate(rows) {
    if (!IS_ADMIN()) return;
    const root = document.getElementById('aurorePdfProdList');
    if (!root) return;

    const cards = [...root.querySelectorAll(
      '.aurore-pdf-prod-card.is-processing,.aurore-pdf-prod-card.is-queued'
    )];
    const ordered = activeRowsOrdered(rows);

    ordered.forEach((row, index) => {
      const card = cards[index];
      if (!card) return;
      const actions = card.querySelector('.aurore-pdf-prod-actions');
      if (!actions) return;

      let button = actions.querySelector('[data-aurore-pdf-cancel]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'admin-btn aurore-pdf-cancel-button';
        button.dataset.aurorePdfCancel = String(row.id);
        button.textContent = 'Annuler';
        button.title = 'Annuler cette génération PDF';
        actions.appendChild(button);
      }

      const oldNote = card.querySelector('.aurore-pdf-cancel-note');
      if (!oldNote) {
        const note = document.createElement('span');
        note.className = 'aurore-pdf-cancel-note';
        note.textContent = 'L’annulation arrêtera la production serveur au prochain contrôle.';
        const stage = card.querySelector('.aurore-pdf-prod-stage');
        if (stage) stage.appendChild(note);
      }
    });
  }

  async function refreshButtons() {
    if (!IS_ADMIN()) return;
    const token = TOKEN();
    if (!token) return;
    try {
      const url = SUPA() +
        '/rest/v1/aurora_generated_documents' +
        '?select=id,title,created_at,metadata' +
        '&order=created_at.asc&limit=100';
      const r = await fetch(url, {
        cache: 'no-store',
        headers: { apikey: ANON(), Authorization: 'Bearer ' + token }
      });
      if (!r.ok) return;
      const rows = await r.json();
      decorate(rows);
    } catch (e) {
      console.warn('[Aurore PDF cancel]', e);
    }
  }

  async function cancelPdf(button) {
    const id = Number(button?.dataset?.aurorePdfCancel || 0);
    if (!Number.isSafeInteger(id) || id < 1) return;
    if (!IS_ADMIN()) return;

    const ok = window.confirm(
      'Annuler la génération PDF de ce document ?\n\n' +
      'La production serveur sera interrompue dès son prochain point de contrôle.'
    );
    if (!ok) return;

    button.disabled = true;
    button.textContent = 'Annulation…';

    try {
      const r = await fetch(
        SUPA() + '/rest/v1/rpc/aurora_cancel_pdf_generation',
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ p_generated_document_id: id }),
          cache: 'no-store'
        }
      );
      const raw = await r.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch (_) {}

      if (!r.ok) {
        throw new Error(data?.message || data?.error || raw || ('HTTP ' + r.status));
      }

      button.textContent = 'Annulée';
      button.disabled = true;

      if (typeof toast === 'function') {
        toast(
          'Génération annulée',
          'Le PDF #' + id + ' ne sera plus poursuivi ni commité.',
          'success'
        );
      }

      setTimeout(refreshButtons, 500);
      setTimeout(refreshButtons, 2500);
    } catch (e) {
      button.disabled = false;
      button.textContent = 'Annuler';
      alert('Impossible d’annuler cette génération. ' + (e?.message || e));
    }
  }

  document.addEventListener('click', function (event) {
    const button = event.target?.closest?.('[data-aurore-pdf-cancel]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void cancelPdf(button);
  }, true);

  let mutationObserver = null;

  function observeProductionList() {
    const root = document.getElementById('aurorePdfProdList');
    if (!root || mutationObserver) return;
    mutationObserver = new MutationObserver(function () {
      // Content Factory peut reconstruire les cartes après chaque synchronisation.
      // Réappliquer le bouton immédiatement évite le clignotement « Annuler ».
      void refreshButtons();
    });
    mutationObserver.observe(root, { childList: true, subtree: true });
  }

  function boot() {
    ensureStyles();
    observeProductionList();
    refreshButtons();
    window.setInterval(refreshButtons, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
