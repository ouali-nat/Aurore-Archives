  // ---------- RÉCLAMATIONS / SIGNALEMENTS (droits d'auteur) ----------
  // Nécessite la table "Signalements" (déjà créée avec ses policies RLS — voir
  // SQL fourni précédemment : insertion publique, lecture/écriture admin
  // uniquement via la fonction is_admin()).
  async function chargerReclamationsAdmin() {
    const list = document.getElementById('adminListReclamations');
    list.innerHTML = '<p class="admin-empty">Chargement…</p>';
    try {
      // On n'affiche que les réclamations non traitées : dès qu'un signalement
      // est marqué "traité", il disparaît de cette liste (mais reste en base).
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Signalements?select=*&statut=neq.traite&order=id.desc`, { headers: headersAdmin() });
      if (!res.ok) {
        if (res.status === 404 || res.status === 400) {
          list.innerHTML = '<p class="admin-empty">Aucune réclamation pour l\'instant.</p>';
          majCompteurOnglet('tabCountReclamations', 0);
          return;
        }
        throw new Error("Statut HTTP " + res.status);
      }
      const data = await res.json();
      majCompteurOnglet('tabCountReclamations', data ? data.length : 0);
      if (!data || data.length === 0) {
        list.innerHTML = '<p class="admin-empty">Aucune réclamation pour l\'instant.</p>';
        actualiserOutilsAdminApresChargement('reclamations', ADMIN_COLLECTION_CONFIG.reclamations, {statuts:[]});
        return;
      }
      list.innerHTML = '';
      data.forEach((r, i) => {
        const card = document.createElement('div');
        card.className = 'admin-card';
        card.dataset.adminId = String(r.id ?? '');
        card.dataset.adminTitle = String(r.document_titre || ('Document #' + r.document_id));
        card.dataset.adminStatus = String(r.statut || '');
        card.dataset.adminSearch = [r.document_titre, r.document_id, r.motif, r.statut, r.nom, r.email, r.details].filter(v => v != null).join(' ');
        card.dataset.adminSortValue = String(r.id ?? '0');
        card.style.animationDelay = (i * 0.04) + 's';
        // Un signalement n'est pas un document : conserver le signalement lui-même
        // évite une ReferenceError qui interrompait tout le rendu de la liste admin.
        card._auroreSignalement = r;
        card.innerHTML = `
          <div class="admin-card-icon">${ICONS.warning}</div>
          <div class="admin-card-body">
            <div class="titre">${echapperHtmlPub(r.document_titre || ('Document #' + r.document_id))}</div>
            <div class="meta">
              <b>${echapperHtmlPub(r.motif || '')}</b> · Statut : ${echapperHtmlPub(r.statut || 'nouveau')}<br>
              Signalé par ${echapperHtmlPub(r.nom || 'anonyme')} (${echapperHtmlPub(r.email || 'sans email')})<br>
              ${r.details ? echapperHtmlPub(r.details) : ''}
            </div>
            <div class="admin-actions">
              <button class="admin-btn ghost" data-action="ouvrir">Ouvrir le document</button>
              <button class="admin-btn refuser" data-action="retirer">Retirer le document</button>
              <button class="admin-btn ghost" data-action="traite">Marquer traité</button>
            </div>
          </div>
        `;
        card.querySelector('[data-action="ouvrir"]').addEventListener('click', async () => {
          try {
            if (!r.document_id) {
              alert("Ce signalement ne contient pas d'identifiant de document. Le document associé ne peut pas être ouvert automatiquement.");
              return;
            }
            const dres = await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${encodeURIComponent(r.document_id)}&select=id,Fichier_url,Titre,Telechargement_autorise`, { headers: HEADERS });
            if (!dres.ok) throw new Error('HTTP ' + dres.status);
            const ddata = await dres.json();
            // Reste à l'intérieur d'Aurore : ouverture via le lecteur PDF
            // interne, jamais via un nouvel onglet / lecteur externe.
            if (ddata && ddata[0] && ddata[0].Fichier_url) {
              ouvrirLecteurPDF({
                id: ddata[0].id,
                Titre: ddata[0].Titre || r.document_titre || 'Document',
                Fichier_url: ddata[0].Fichier_url,
                Telechargement_autorise: ddata[0].Telechargement_autorise
              });
            } else {
              alert("Le document associé est introuvable (peut-être déjà retiré).");
            }
          } catch(e) {
            console.error('[Réclamations] ouverture du document', e);
            alert("Impossible d'ouvrir le document pour le moment. Vérifiez que le PDF associé existe encore.");
          }
        });
        card.querySelector('[data-action="retirer"]').addEventListener('click', async () => {
          if (!confirm("Retirer définitivement le document concerné par cette réclamation ?")) return;
          try {
            const dres = await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${r.document_id}`, { method:'DELETE', headers: { ...headersAdmin(), 'Prefer':'return=representation' } });
            if (!dres.ok) throw new Error('HTTP ' + dres.status);
            await marquerReclamation(r.id, 'traite');
            chargerReclamationsAdmin();
            chargerDocumentsPublies();
          } catch(e) { alert("Le retrait du document n’a pas pu être effectué pour le moment. Veuillez réessayer."); }
        });
        card.querySelector('[data-action="traite"]').addEventListener('click', async () => {
          if (!confirm("Marquer ce signalement comme traité ? Il disparaîtra de la liste des réclamations en attente.")) return;
          await marquerReclamation(r.id, 'traite');
          // Rechargement complet depuis Supabase pour refléter fidèlement l'état
          // en base (évite tout doublon ou incohérence visuelle).
          await chargerReclamationsAdmin();
        });
        list.appendChild(card);
      });
      actualiserOutilsAdminApresChargement('reclamations', ADMIN_COLLECTION_CONFIG.reclamations, {statuts:data.map(r=>r.statut)});
    } catch (err) {
      list.innerHTML = `<p class="admin-empty">Impossible de charger ces éléments pour le moment. Veuillez réessayer dans quelques instants.</p>`;
    }
  }

  async function marquerReclamation(id, statut) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/Signalements?id=eq.${id}`, {
        method: 'PATCH',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ statut })
      });
    } catch(e) { console.error('[Réclamations] mise à jour du statut échouée', e); }
  }

