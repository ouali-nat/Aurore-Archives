  // ---------- ESPACE ADMINISTRATEUR ----------
  // Le bouton "Espace administrateur" n'est déjà visible que pour les e-mails
  // dont le profil a role = 'admin' (voir afficherUtilisateurConnecte). La vraie
  // protection des données se fait par les policies RLS sur Supabase, qui
  // vérifient le jeton envoyé — voir les instructions de configuration.
  document.getElementById('btnAdmin').addEventListener('click', () => {
    document.getElementById('breadcrumb').innerHTML = '';
    afficherEcran('screen-admin');
    document.getElementById('adminPanel').style.display = 'block';
    chargerStatsAdmin();
    chargerDepotsEnAttente();
    chargerDocumentsPublies();
    actualiserBoutonRepublicationAdmin();
  });

  // Navigation par onglets du tableau de bord (purement visuel — ne touche
  // à aucune donnée, se contente d'afficher/masquer les panneaux déjà chargés).
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const cible = tab.getAttribute('data-tab');
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.toggle('active', p.getAttribute('data-panel') === cible));
      const grille = document.getElementById('adminCategoryGrid');
      const detail = document.getElementById('adminDetail');
      if (grille) grille.style.display = 'none';
      if (detail) detail.style.display = 'block';
      // Historique : on empile une entrée dédiée à cette fiche pour que le
      // bouton Retour (Android/mobile) referme d'abord la fiche et revienne
      // aux blocs de catégories, avant de quitter le tableau de bord. Voir le
      // gestionnaire "popstate" plus bas (même principe que le lecteur PDF).
      if (!navigationParPopState) {
        try { history.pushState({ ...creerSnapshotNavigation('screen-admin', window.scrollY), adminDetail:true }, '', location.href); } catch(e) {}
      }
      if (cible === 'reclamations') chargerReclamationsAdmin();
      if (cible === 'connexions') chargerDernieresConnexions();
      if (cible === 'visiteurs') chargerVisiteursAnonymesAdmin();
      if (cible === 'service-client') chargerServiceClientConfig();
      if (cible === 'utilisateurs') chargerUtilisateursAdmin();
      if (cible === 'doublons') chargerDoublonsAdmin();
      if (cible === 'content-factory' && typeof window.chargerAuroraContentFactoryAdmin === 'function') window.chargerAuroraContentFactoryAdmin();
    });
  });

  function fermerFicheAdmin() {
    const grille = document.getElementById('adminCategoryGrid');
    const detail = document.getElementById('adminDetail');
    if (detail) detail.style.display = 'none';
    if (grille) grille.style.display = 'grid';
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));
  }

  // Bouton de retour : dépile l'entrée d'historique ouverte par la fiche, ce
  // qui referme la fiche via le gestionnaire "popstate" (comportement identique
  // au bouton Retour physique, pour rester cohérent).
  document.getElementById('adminDetailBack')?.addEventListener('click', () => {
    if (history.state && history.state.adminDetail) { history.back(); return; }
    fermerFicheAdmin();
  });

  document.getElementById('adminUsersRefresh')?.addEventListener('click', chargerUtilisateursAdmin);

  // ---------- GESTION DES UTILISATEURS ----------
  // Lecture des seuls profils réellement enregistrés dans public."Profils".
  // La promotion passe exclusivement par le RPC serveur existant :
  // promouvoir_utilisateur_admin(utilisateur_id uuid). Aucune écriture directe
  // de la colonne role n'est effectuée ici.
  const PROPRIETAIRE_ADMIN_ID = '19621106-98f5-4a09-9f72-8c4fc8ae2219';
  const PROPRIETAIRE_ADMIN_EMAIL = 'oualikevin9@gmail.com';

  function estProprietaireAdmin() {
    return !!session && session.id === PROPRIETAIRE_ADMIN_ID;
  }

  function formaterDateInscriptionUtilisateur(profil) {
    const valeur = profil && profil.created_at ? profil.created_at : null;
    if (!valeur) return 'Date d’inscription non disponible';
    const d = new Date(valeur);
    if (Number.isNaN(d.getTime())) return 'Date d’inscription non disponible';
    return d.toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).replace(' à ', ', ');
  }

  function afficherMessageUtilisateurs(texte, type='') {
    const msg = document.getElementById('adminUsersMessage');
    if (!msg) return;
    msg.textContent = texte || '';
    msg.className = 'form-msg admin-user-message' + (type ? ' ' + type : '');
    msg.style.display = texte ? 'block' : 'none';
  }

  async function promouvoirUtilisateurAdmin(utilisateurId, bouton) {
    if (!estProprietaireAdmin()) {
      afficherMessageUtilisateurs('Seul le compte propriétaire peut promouvoir un utilisateur en administrateur.', 'err');
      return;
    }
    if (!utilisateurId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(utilisateurId)) {
      afficherMessageUtilisateurs('Identifiant utilisateur invalide.', 'err');
      return;
    }
    if (bouton) { bouton.disabled = true; bouton.textContent = 'Promotion…'; }
    afficherMessageUtilisateurs('Promotion en cours…');
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/promouvoir_utilisateur_admin`, {
        method: 'POST',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ utilisateur_id: utilisateurId })
      });
      const detail = await res.text().catch(() => '');
      if (!res.ok) throw new Error(detail || ('HTTP ' + res.status));
      afficherMessageUtilisateurs('Utilisateur promu administrateur avec succès.', 'ok');
      await chargerUtilisateursAdmin();
    } catch (err) {
      console.error('[Gestion utilisateurs] promotion', err);
      afficherMessageUtilisateurs('La promotion de cet utilisateur n’a pas pu être effectuée pour le moment. Veuillez réessayer.', 'err');
      if (bouton) { bouton.disabled = false; bouton.textContent = 'Promouvoir administrateur'; }
    }
  }

  async function retrograderUtilisateurAdmin(utilisateurId, bouton) {
    if (!estProprietaireAdmin()) {
      afficherMessageUtilisateurs('Seul le compte propriétaire peut rétrograder un administrateur.', 'err');
      return;
    }
    if (!utilisateurId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(utilisateurId)) {
      afficherMessageUtilisateurs('Identifiant utilisateur invalide.', 'err');
      return;
    }
    if (utilisateurId === PROPRIETAIRE_ADMIN_ID) {
      afficherMessageUtilisateurs('Le compte propriétaire ne peut pas être rétrogradé.', 'err');
      return;
    }
    if (!window.confirm('Voulez-vous vraiment rétrograder cet administrateur en utilisateur ?')) return;

    if (bouton) { bouton.disabled = true; bouton.textContent = 'Rétrogradation…'; }
    afficherMessageUtilisateurs('Rétrogradation en cours…');
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/retrograder_utilisateur_admin`, {
        method: 'POST',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ utilisateur_id: utilisateurId })
      });
      const detail = await res.text().catch(() => '');
      if (!res.ok) throw new Error(detail || ('HTTP ' + res.status));
      afficherMessageUtilisateurs('Administrateur rétrogradé en utilisateur avec succès.', 'ok');
      await chargerUtilisateursAdmin();
    } catch (err) {
      console.error('[Gestion utilisateurs] rétrogradation', err);
      afficherMessageUtilisateurs('La rétrogradation de cet administrateur n’a pas pu être effectuée pour le moment. Veuillez réessayer.', 'err');
      if (bouton) { bouton.disabled = false; bouton.textContent = 'Rétrograder en utilisateur'; }
    }
  }

  async function basculerBannissementUtilisateurAdmin(utilisateurId, bannir, bouton) {
    if (!session || session.role !== 'admin') { afficherMessageUtilisateurs('Cette action est réservée aux administrateurs.', 'err'); return; }
    if (!utilisateurId || utilisateurId === PROPRIETAIRE_ADMIN_ID) { afficherMessageUtilisateurs('Ce compte ne peut pas être banni.', 'err'); return; }
    const action = bannir ? 'bannir' : 'réautoriser';
    if (!confirm(`Voulez-vous vraiment ${action} cet utilisateur ?${bannir ? '\n\nIl ne pourra plus accéder au site avec ce compte.' : ''}`)) return;
    if(bouton){bouton.disabled=true;bouton.textContent=bannir?'Bannissement…':'Réactivation…';}
    afficherMessageUtilisateurs(`${bannir?'Bannissement':'Réactivation'} en cours…`);
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/rpc/bannir_utilisateur_admin`,{method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json'},body:JSON.stringify({utilisateur_id:utilisateurId,bannir})});
      const detail=await res.text().catch(()=> '');
      if(!res.ok)throw new Error(detail||('HTTP '+res.status));
      afficherMessageUtilisateurs(bannir?'Utilisateur banni avec succès.':'Utilisateur réautorisé avec succès.','ok');
      await chargerUtilisateursAdmin();
    }catch(err){
      console.error('[Gestion utilisateurs] bannissement',err);
      afficherMessageUtilisateurs(`Impossible de ${bannir?'bannir':'réautoriser'} cet utilisateur pour le moment.`, 'err');
      if(bouton){bouton.disabled=false;bouton.textContent=bannir?'Bannir l’utilisateur':'Autoriser l’accès';}
    }
  }

  async function chargerUtilisateursAdmin() {
    const list = document.getElementById('adminUsersList');
    if (!list) return;
    if (!session || session.role !== 'admin') {
      list.innerHTML = '<div class="admin-user-empty">Cette action est réservée aux administrateurs.</div>';
      return;
    }
    list.innerHTML = '<div class="admin-user-loading">Chargement des utilisateurs…</div>';
    afficherMessageUtilisateurs('');
    try {
      // Ce projet n'initialise aucun client JavaScript Supabase (pas de createClient) :
      // tous les appels Supabase existants utilisent l'API REST avec SUPABASE_URL,
      // SUPABASE_ANON_KEY et headersAdmin(). On appelle donc la RPC via son endpoint
      // REST, en réutilisant exactement le client/configuration déjà présents.
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lister_profils_admin`, {
        method: 'POST',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
        body: '{}'
      });
      const detail = await res.text().catch(() => '');
      if (!res.ok) throw new Error(detail || ('HTTP ' + res.status));
      let profils = [];
      try { profils = detail ? JSON.parse(detail) : []; } catch (parseErr) {
        throw new Error('Réponse invalide reçue pour la liste des utilisateurs.');
      }
      const listeProfils = Array.isArray(profils) ? profils : [];
      majCompteurOnglet('tabCountUtilisateurs', listeProfils.length);
      if (!listeProfils.length) {
        list.innerHTML = '<div class="admin-user-empty">Aucun utilisateur inscrit pour le moment.</div>';
        actualiserOutilsAdminApresChargement('utilisateurs', ADMIN_COLLECTION_CONFIG.utilisateurs, {roles:[]});
        return;
      }
      const proprietaire = estProprietaireAdmin();
      let statutsBannissement = new Map();
      try {
        const banRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lister_statuts_bannissement_admin`, { method:'POST', headers:{...headersAdmin(),'Content-Type':'application/json'}, body:'{}' });
        if(banRes.ok){ const bans=await banRes.json().catch(()=>[]); (Array.isArray(bans)?bans:[]).forEach(b=>statutsBannissement.set(String(b.id),b.banni===true)); }
      } catch(e) { console.warn('[Gestion utilisateurs] statuts de bannissement',e); }
      list.innerHTML = '';
      // Le RPC propriétaire retourne les informations complètes de Profils.
      // Cela évite de dépendre d'une policy RLS qui ne les rend visibles
      // qu'après promotion d'un utilisateur.
      let profilsScolaires = new Map();
      try {
        const detailRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lister_profils_admin_details`, {
          method: 'POST',
          headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
          body: '{}'
        });
        if (detailRes.ok) {
          const rows = await detailRes.json();
          const lignesDetails = Array.isArray(rows) ? rows : [];
          lignesDetails.forEach(r => { if (r && r.id) profilsScolaires.set(String(r.id), r); });
          console.info('[Admin utilisateurs] Profils détaillés reçus :', lignesDetails.length,
            'IDs associés :', [...profilsScolaires.keys()]);
        } else {
          console.warn('[Admin utilisateurs] RPC détaillée indisponible', detailRes.status);
        }
      } catch (e) { console.warn('[Admin utilisateurs] informations détaillées indisponibles', e); }

      listeProfils.forEach(profil => {
        const scolaire = { ...profil, ...(profilsScolaires.get(String(profil.id)) || {}) };
        const card = document.createElement('article');
        card.className = 'admin-user-card';
        card.dataset.adminId = String(profil.id || '');
        card.dataset.adminTitle = String(profil.nom || '');
        card.dataset.adminEmail = String(profil.email || '');
        card.dataset.adminRole = String(profil.role || '');
        card.dataset.adminCreated = String(profil.created_at || '');
        card.dataset.adminSearch = [
          scolaire.nom, scolaire.prenom, scolaire.email, scolaire.role, scolaire.created_at,
          scolaire.lycee, scolaire.niveau, scolaire.classe, scolaire.filiere,
          scolaire.discipline, scolaire.fonction, scolaire.enfant_informations
        ].filter(v => v != null && String(v).trim()).join(' ');
        const nom = profil.nom || 'Nom non renseigné';
        const email = profil.email || 'E-mail non renseigné';
        const roleAdmin = String(scolaire.role || profil.role || '').toLowerCase() === 'admin';
        const banni = statutsBannissement.get(String(profil.id)) === true;
        card.classList.add('admin-user-card');
        card.innerHTML = `
          <div class="admin-user-main">
            <div class="admin-user-name">${echapperHtmlPub(nom)}</div>
            <div class="admin-user-email">${echapperHtmlPub(email)}</div>
            <div class="admin-user-school">
              ${scolaire.prenom ? `<span>Prénom : ${echapperHtmlPub(scolaire.prenom)}</span>` : ''}
              ${scolaire.lycee ? `<span>Établissement : ${echapperHtmlPub(scolaire.lycee)}</span>` : ''}
              ${scolaire.niveau ? `<span>Niveau : ${echapperHtmlPub(scolaire.niveau)}</span>` : ''}
              ${scolaire.classe ? `<span>Classe : ${echapperHtmlPub(scolaire.classe)}</span>` : ''}
              ${scolaire.filiere ? `<span>Filière : ${echapperHtmlPub(scolaire.filiere)}</span>` : ''}
              ${scolaire.discipline ? `<span>Discipline : ${echapperHtmlPub(scolaire.discipline)}</span>` : ''}
              ${scolaire.fonction ? `<span>Fonction : ${echapperHtmlPub(scolaire.fonction)}</span>` : ''}
              ${scolaire.enfant_informations ? `<span>Enfant : ${echapperHtmlPub(scolaire.enfant_informations)}</span>` : ''}
            </div>
            <div class="admin-user-meta">
              <span class="role-badge ${roleAdmin ? 'admin' : 'eleve'}">${roleAdmin ? 'Administrateur' : echapperHtmlPub(libelleRole(scolaire.role || profil.role || 'eleve'))}</span>
              ${banni ? '<span class="admin-user-status-banned">● Compte banni</span>' : ''}
              <span class="admin-user-date">${echapperHtmlPub(formaterDateInscriptionUtilisateur(profil))}</span>
            </div>
          </div>
          <div class="admin-user-actions"></div>`;
        const actions = card.querySelector('.admin-user-actions');
        if (roleAdmin) {
          if (profil.id === PROPRIETAIRE_ADMIN_ID) {
            const statut = document.createElement('span');
            statut.className = 'role-badge admin';
            statut.textContent = 'Compte propriétaire';
            actions.appendChild(statut);
          } else if (proprietaire) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'admin-btn primary';
            btn.textContent = 'Rétrograder en utilisateur';
            btn.addEventListener('click', () => retrograderUtilisateurAdmin(profil.id, btn));
            actions.appendChild(btn);
          } else {
            const statut = document.createElement('span');
            statut.className = 'role-badge admin';
            statut.textContent = 'Déjà administrateur';
            actions.appendChild(statut);
          }
        } else if (proprietaire) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'admin-btn primary';
          btn.textContent = 'Promouvoir administrateur';
          btn.addEventListener('click', () => promouvoirUtilisateurAdmin(profil.id, btn));
          actions.appendChild(btn);
        }
        if (profil.id !== PROPRIETAIRE_ADMIN_ID) {
          const banBtn = document.createElement('button');
          banBtn.type='button';
          banBtn.className='admin-btn ghost admin-user-ban' + (banni ? ' is-banned' : '');
          banBtn.textContent = banni ? 'Autoriser l’accès' : 'Bannir l’utilisateur';
          banBtn.addEventListener('click',()=>basculerBannissementUtilisateurAdmin(profil.id, !banni, banBtn));
          actions.appendChild(banBtn);
        }
        list.appendChild(card);
      });
      actualiserOutilsAdminApresChargement('utilisateurs', ADMIN_COLLECTION_CONFIG.utilisateurs, {roles:listeProfils.map(p=>p.role)});
    } catch (err) {
      console.error('[Gestion utilisateurs] chargement', err);
      majCompteurOnglet('tabCountUtilisateurs', 0);
      list.innerHTML = `<div class="admin-user-empty">Impossible de charger la liste des utilisateurs pour le moment. Veuillez réessayer dans quelques instants.</div>`;
    }
  }

  // Calcule et affiche les statistiques : connexions réussies, utilisateurs
  // inscrits, date de dernière connexion. Lit uniquement les tables
  // "Connexions" et "Profils" — aucune donnée d'authentification n'est modifiée.
  async function chargerStatsAdmin() {
    const elConnexions = document.getElementById('statConnexions');
    const elUtilisateurs = document.getElementById('statUtilisateurs');
    const elDerniere = document.getElementById('statDerniereConnexion');
    const elVisiteurs = document.getElementById('statVisiteursAnonymes');
    elConnexions.textContent = '…';
    elUtilisateurs.textContent = '…';
    elDerniere.textContent = '…';
    if (elVisiteurs) elVisiteurs.textContent = '…';

    try {
      const resConnexions = await fetch(`${SUPABASE_URL}/rest/v1/Connexions?select=id`, {
        headers: { ...headersAdmin(), 'Prefer': 'count=exact', 'Range': '0-0' }
      });
      const rangeConnexions = resConnexions.headers.get('content-range');
      elConnexions.textContent = rangeConnexions ? rangeConnexions.split('/')[1] : '0';
    } catch (e) {
      elConnexions.textContent = '—';
      console.error('[Stats admin] connexions', e);
    }

    try {
      // Comptage via RPC dédié (compter_profils_admin, SECURITY DEFINER) plutôt
      // qu'un GET direct sur "Profils" : avec la RLS en place (chacun ne voit
      // que sa propre ligne), un GET direct ne comptait jusqu'ici que le profil
      // de l'admin connecté lui-même (toujours 1), quel que soit le nombre réel
      // d'inscrits. Le RPC vérifie lui-même que l'appelant est bien admin avant
      // de renvoyer un simple entier — voir le SQL fourni séparément.
      const resProfils = await fetch(`${SUPABASE_URL}/rest/v1/rpc/compter_profils_admin`, {
        method: 'POST',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!resProfils.ok) throw new Error("Statut HTTP " + resProfils.status);
      const total = await resProfils.json();
      elUtilisateurs.textContent = (typeof total === 'number') ? total : '0';
    } catch (e) {
      elUtilisateurs.textContent = '—';
      console.error('[Stats admin] utilisateurs (RPC compter_profils_admin manquant ou accès refusé ?)', e);
    }

    try {
      const resDerniere = await fetch(`${SUPABASE_URL}/rest/v1/Connexions?select=date,nom&order=date.desc&limit=1`, {
        headers: headersAdmin()
      });
      if (!resDerniere.ok) throw new Error("Statut HTTP " + resDerniere.status);
      const data = await resDerniere.json();
      if (data && data.length > 0) {
        const d = new Date(data[0].date);
        const formatee = d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
        elDerniere.textContent = data[0].nom ? `${formatee} — ${data[0].nom}` : formatee;
      } else {
        elDerniere.textContent = '—';
      }
    } catch (e) {
      elDerniere.textContent = '—';
      console.error('[Stats admin] dernière connexion', e);
    }

    if (elVisiteurs) {
      try {
        // Comptage via RPC dédié (compter_visites_anonymes, SECURITY DEFINER) :
        // la table "Visites_anonymes" n'a aucune policy SELECT, donc un GET
        // direct renverrait toujours 0 même pour un admin — voir le SQL fourni
        // séparément.
        const resVisiteurs = await fetch(`${SUPABASE_URL}/rest/v1/rpc/compter_visites_anonymes`, {
          method: 'POST',
          headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (!resVisiteurs.ok) throw new Error("Statut HTTP " + resVisiteurs.status);
        const totalVisiteurs = await resVisiteurs.json();
        elVisiteurs.textContent = (typeof totalVisiteurs === 'number') ? totalVisiteurs : '0';
      } catch (e) {
        elVisiteurs.textContent = '—';
        console.error('[Stats admin] visiteurs anonymes (RPC compter_visites_anonymes manquant ou accès refusé ?)', e);
      }
    }
  }

  // Liste des visiteurs non connectés les plus récents (RPC dédié
  // lister_visites_anonymes_recentes, lecture seule, admin uniquement — voir
  // le SQL fourni séparément pour la table "Visites_anonymes" et ses RPC).
  async function chargerVisiteursAnonymesAdmin() {
    const list = document.getElementById('adminListVisiteurs');
    if (!list) return;
    list.innerHTML = '<p class="admin-empty">Chargement…</p>';
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/lister_visites_anonymes_recentes`, {
        method: 'POST',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ limite: 300 })
      });
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      const data = await res.json();
      if (!data || data.length === 0) {
        list.innerHTML = '<p class="admin-empty">Aucun visiteur non connecté enregistré pour le moment.</p>';
        return;
      }
      list.innerHTML = '';
      data.forEach((v, i) => {
        const card = document.createElement('div');
        card.className = 'admin-card';
        card.style.animationDelay = (i * 0.04) + 's';
        const d = new Date(v.created_at);
        const formatee = d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
        const contexte = v.contexte === 'tentative_telechargement' ? 'A voulu télécharger' : 'Visite';
        const doc = v.document_titre ? ` — « ${v.document_titre} »` : '';
        card.innerHTML = `
          <div class="admin-card-icon">${ICONS.user}</div>
          <div class="admin-card-body">
            <div class="titre">${contexte}${doc}</div>
            <div class="meta">${formatee}</div>
          </div>
        `;
        list.appendChild(card);
      });
    } catch (err) {
      list.innerHTML = `<p class="admin-empty">Impossible de charger ces éléments pour le moment. Veuillez réessayer dans quelques instants.</p>`;
      console.error('[Admin visiteurs] chargement', err);
    }
  }

  // Liste des 300 dernières connexions (table "Connexions" déjà utilisée par
  // enregistrerConnexion() et par chargerStatsAdmin() ci-dessus) — aucune
  // nouvelle table, aucune donnée modifiée, lecture seule.
  async function chargerDernieresConnexions() {
    const list = document.getElementById('adminListConnexions');
    list.innerHTML = '<p class="admin-empty">Chargement…</p>';
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Connexions?select=nom,email,date&order=date.desc&limit=300`, { headers: headersAdmin() });
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      const data = await res.json();
      if (!data || data.length === 0) {
        list.innerHTML = '<p class="admin-empty">Aucune connexion enregistrée pour le moment.</p>';
        return;
      }
      list.innerHTML = '';
      data.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'admin-card';
        card.style.animationDelay = (i * 0.04) + 's';
        const d = new Date(c.date);
        const formatee = d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
        card.innerHTML = `
          <div class="admin-card-icon">${ICONS.user}</div>
          <div class="admin-card-body">
            <div class="titre">${c.nom || 'Nom inconnu'}</div>
            <div class="meta">${c.email || 'e-mail inconnu'}<br>${formatee}</div>
          </div>
        `;
        list.appendChild(card);
      });
    } catch (err) {
      list.innerHTML = `<p class="admin-empty">Impossible de charger ces éléments pour le moment. Veuillez réessayer dans quelques instants.</p>`;
    }
  }

  // Choisit une icône représentative selon la catégorie du document (purement
  // décoratif, n'affecte aucune donnée).
  function iconePourCategorie(doc) {
    const cat = doc['Catégorie'] || '';
    if (cat === 'Livres') return ICONS.book;
    if (cat === 'Devoirs') return ICONS.checklist;
    return ICONS.document;
  }

  function majCompteurOnglet(id, n) {
    const el = document.getElementById(id);
    if (el) el.textContent = n;
  }

  // Récupère, pour une liste d'ids de documents, l'identité du compte
  // authentifié qui a effectué chaque dépôt (table "Depots_deposants",
  // réservée à l'administrateur par RLS — voir schéma fourni). Renvoie une
  // Map(document_id -> {user_id, nom, email}). Échoue silencieusement (Map
  // vide) tant que la migration SQL n'a pas été appliquée, sans casser
  // l'affichage des dépôts eux-mêmes.
  async function recupererDeposants(idsDocuments) {
    const carte = new Map();
    const ids = (idsDocuments || []).filter(id => id !== null && id !== undefined);
    if (ids.length === 0) return carte;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Depots_deposants?select=document_id,user_id,nom,email&document_id=in.(${ids.join(',')})`, { headers: headersAdmin() });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.warn(`[Depots_deposants] Lecture refusée — HTTP ${res.status} ${res.statusText}. Détail : ${detail}. Cause probable : la table "Depots_deposants" n'existe pas encore côté Supabase, ou sa policy RLS de lecture ne couvre pas le compte admin actuellement connecté. Tous les dépôts afficheront "information non disponible" tant que ce n'est pas corrigé côté Supabase (aucune action prise ici).`);
        return carte;
      }
      const rows = await res.json();
      console.log(`[Depots_deposants] ${rows.length} entrée(s) récupérée(s) pour ${ids.length} document(s) demandé(s).`);
      (rows || []).forEach(r => carte.set(r.document_id, { user_id: r.user_id, nom: r.nom, email: r.email }));
    } catch (e) {
      console.warn('[Depots_deposants] Erreur réseau lors de la lecture (table jointe non consultée) :', e.message);
    }
    return carte;
  }

  function ligneCompteDeposant(deposant) {
    if (!deposant || (!deposant.nom && !deposant.email)) {
      return 'Compte du déposant : information non disponible';
    }
    return `Compte du déposant : ${deposant.nom || 'nom inconnu'} (${deposant.email || 'e-mail inconnu'})`;
  }

  // Envoie une notification personnelle au déposant (visible uniquement par
  // lui, voir RLS de la table "Notifications" dans le schéma fourni). N'échoue
  // jamais la validation/le refus qui l'entoure : purement informatif.
  async function notifierDeposant(deposant, { titreDocument, statut, message }) {
    if (!deposant || !deposant.user_id) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Notifications`, {
        method: 'POST',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ user_id: deposant.user_id, titre_document: titreDocument || null, statut, message })
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.warn('[Notifications] envoi échoué :', res.status, detail);
      }
    } catch (e) {
      console.warn('[Notifications] erreur réseau lors de l\'envoi :', e);
    }
  }

  // ---------- OUTILS ADMIN : recherche, tri, filtres et pagination ----------
  const ADMIN_PAGE_SIZE = 8;
  const ADMIN_PENDING_PAGE_SIZE = 20;
  const adminCollectionStates = {};

  function normaliserAdminTexte(valeur) {
    return String(valeur == null ? '' : valeur).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function valeurAdminDate(valeur) {
    const t = Date.parse(String(valeur || ''));
    return Number.isFinite(t) ? t : null;
  }

  function remplirOptionsAdminSelect(id, valeurs, premier) {
    const select = document.getElementById(id);
    if (!select) return;
    const uniques = [...new Set((valeurs || []).map(v => String(v || '').trim()).filter(Boolean))]
      .sort((a,b) => normaliserAdminTexte(a).localeCompare(normaliserAdminTexte(b), 'fr'));
    const ancienne = select.value;
    select.innerHTML = '';
    const base = document.createElement('option'); base.value=''; base.textContent=premier; select.appendChild(base);
    uniques.forEach(v => { const o=document.createElement('option'); o.value=v; o.textContent=v; select.appendChild(o); });
    if (uniques.includes(ancienne)) select.value=ancienne;
  }

  function initialiserCollectionAdmin(key, options) {
    const list = document.getElementById(options.listId);
    if (!list) return;
    const state = adminCollectionStates[key] || { page:1, query:'', sort:'recent', filters:{} };
    adminCollectionStates[key] = state;
    const toolbar = document.getElementById(options.toolbarId);
    const search = document.getElementById(options.searchId);
    const sort = document.getElementById(options.sortId);
    const pager = options.pagerId ? document.getElementById(options.pagerId) : null;
    if (!toolbar || !search || !sort) return;

    const controls = options.filterIds || {};
    Object.entries(controls).forEach(([field,id]) => {
      const el=document.getElementById(id); if (!el || el.dataset.adminBound==='1') return;
      el.dataset.adminBound='1'; el.addEventListener('change',()=>{state.filters[field]=el.value;state.page=1;appliquerCollectionAdmin(key,options);});
    });
    if (search.dataset.adminBound!=='1') { search.dataset.adminBound='1'; search.addEventListener('input',()=>{state.query=search.value;state.page=1;appliquerCollectionAdmin(key,options);}); }
    if (sort.dataset.adminBound!=='1') { sort.dataset.adminBound='1'; sort.addEventListener('change',()=>{state.sort=sort.value;state.page=1;appliquerCollectionAdmin(key,options);}); }
    appliquerCollectionAdmin(key,options);
  }

  function appliquerCollectionAdmin(key, options) {
    const list=document.getElementById(options.listId), pager=document.getElementById(options.pagerId);
    if (!list) return;
    const state=adminCollectionStates[key] || (adminCollectionStates[key]={page:1,query:'',sort:'recent',filters:{}});
    const cards=[...list.querySelectorAll(options.cardSelector || '.admin-card')];
    const q=normaliserAdminTexte(state.query);
    const getSearch=card=>normaliserAdminTexte(card.dataset.adminSearch || card.textContent);
    let visibles=cards.filter(card=>{
      if(q && !getSearch(card).includes(q)) return false;
      for(const [field,value] of Object.entries(state.filters || {})) { if(!value) continue; const key = field==='categorie' ? 'adminCategory' : 'admin'+field.charAt(0).toUpperCase()+field.slice(1); if(normaliserAdminTexte(card.dataset[key] || '') !== normaliserAdminTexte(value)) return false; }
      return true;
    });
    const sort=state.sort;
    visibles.sort((a,b)=>{
      if(sort==='az' || sort==='za') { const c=normaliserAdminTexte(a.dataset.adminTitle).localeCompare(normaliserAdminTexte(b.dataset.adminTitle),'fr'); return sort==='za'?-c:c; }
      if(sort==='statusaz') return normaliserAdminTexte(a.dataset.adminStatus).localeCompare(normaliserAdminTexte(b.dataset.adminStatus),'fr');
      if(sort==='roleaz') return normaliserAdminTexte(a.dataset.adminRole).localeCompare(normaliserAdminTexte(b.dataset.adminRole),'fr');
      if(sort==='oldest' || sort==='recent') {
        const av=options.dateField==='created' ? (valeurAdminDate(a.dataset.adminCreated) ?? (Number(a.dataset.adminId)||0)) : (Number(a.dataset.adminSortValue)||0);
        const bv=options.dateField==='created' ? (valeurAdminDate(b.dataset.adminCreated) ?? (Number(b.dataset.adminId)||0)) : (Number(b.dataset.adminSortValue)||0);
        return sort==='oldest'?av-bv:bv-av;
      }
      if(sort==='niveau') return normaliserAdminTexte(a.dataset.adminLevel).localeCompare(normaliserAdminTexte(b.dataset.adminLevel),'fr');
      if(sort==='classe') return normaliserAdminTexte(a.dataset.adminClass).localeCompare(normaliserAdminTexte(b.dataset.adminClass),'fr');
      if(sort==='matiere') return normaliserAdminTexte(a.dataset.adminSubject).localeCompare(normaliserAdminTexte(b.dataset.adminSubject),'fr');
      return 0;
    });
    // Reorder only the cards already rendered; their event listeners remain attachés.
    visibles.forEach(card=>list.appendChild(card));
    cards.filter(c=>!visibles.includes(c)).forEach(c=>{c.style.display='none';});
    // Administration : pas de pagination. Tous les résultats filtrés restent
    // dans une seule liste verticale ; le navigateur gère naturellement le
    // défilement, même lorsque la liste devient longue.
    const total=visibles.length;
    const start=0, end=total;
    visibles.forEach(card=>{card.style.display='';});
    let empty=list.querySelector('.admin-filter-empty');
    if(!total && cards.length){ if(!empty){empty=document.createElement('div');empty.className='admin-filter-empty';list.appendChild(empty);} empty.textContent='Aucun résultat ne correspond à votre recherche ou à vos filtres.'; }
    else if(empty) empty.remove();
    if(pager) pager.innerHTML='';
  }

  function actualiserTriAdminSelect(id, optionData={}) {
    const select=document.getElementById(id); if(!select) return;
    const valeur=select.value;
    const base=[['recent','Plus récent'],['oldest','Plus ancien'],['az','A → Z'],['za','Z → A']];
    if((optionData.niveaux||[]).some(v=>String(v||'').trim())) base.push(['niveau','Niveau A → Z']);
    if((optionData.classes||[]).some(v=>String(v||'').trim())) base.push(['classe','Classe A → Z']);
    if((optionData.matieres||[]).some(v=>String(v||'').trim())) base.push(['matiere','Matière A → Z']);
    if((optionData.statuts||[]).some(v=>String(v||'').trim())) base.push(['statusaz','Statut A → Z']);
    if((optionData.roles||[]).some(v=>String(v||'').trim())) base.push(['roleaz','Rôle A → Z']);
    select.innerHTML='';
    base.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;select.appendChild(o);});
    select.value=base.some(x=>x[0]===valeur)?valeur:'recent';
  }

  function actualiserOutilsAdminApresChargement(key, options, optionData={}) {
    if(optionData.niveaux && options.filterIds.niveau) remplirOptionsAdminSelect(options.filterIds.niveau, optionData.niveaux, 'Tous les niveaux');
    if(optionData.classes && options.filterIds.classe) remplirOptionsAdminSelect(options.filterIds.classe, optionData.classes, 'Toutes les classes');
    if(optionData.matieres && options.filterIds.matiere) remplirOptionsAdminSelect(options.filterIds.matiere, optionData.matieres, 'Toutes les matières');
    if(optionData.categories && options.filterIds.categorie) remplirOptionsAdminSelect(options.filterIds.categorie, optionData.categories, 'Toutes les catégories');
    if(optionData.statuts && options.filterIds.statut) remplirOptionsAdminSelect(options.filterIds.statut, optionData.statuts, 'Tous les statuts');
    if(optionData.roles && options.filterIds.role) remplirOptionsAdminSelect(options.filterIds.role, optionData.roles, 'Tous les rôles');
    actualiserTriAdminSelect(options.sortId, optionData);
    const sortEl=document.getElementById(options.sortId);
    const state=adminCollectionStates[key] || (adminCollectionStates[key]={page:1,query:'',sort:'recent',filters:{}});
    if(sortEl && ![...sortEl.options].some(o=>o.value===state.sort)) state.sort='recent';
    if(sortEl) sortEl.value=state.sort;
    initialiserCollectionAdmin(key,options);
  }

  const ADMIN_COLLECTION_CONFIG = {
    attente:{toolbarId:'adminToolbarAttente',searchId:'adminSearchAttente',sortId:'adminSortAttente',listId:'adminList',pagerId:null,pageSize:Infinity,filterIds:{niveau:'adminFilterNiveauAttente',classe:'adminFilterClasseAttente',matiere:'adminFilterMatiereAttente',categorie:'adminFilterCategorieAttente'}},
    publies:{toolbarId:'adminToolbarPublies',searchId:'adminSearchPublies',sortId:'adminSortPublies',listId:'adminListPublies',pagerId:null,pageSize:Infinity,filterIds:{niveau:'adminFilterNiveauPublies',classe:'adminFilterClassePublies',matiere:'adminFilterMatierePublies',categorie:'adminFilterCategoriePublies'}},
    reclamations:{toolbarId:'adminToolbarReclamations',searchId:'adminSearchReclamations',sortId:'adminSortReclamations',listId:'adminListReclamations',pagerId:null,pageSize:Infinity,filterIds:{statut:'adminFilterStatutReclamations'}},
    utilisateurs:{toolbarId:'adminToolbarUtilisateurs',searchId:'adminSearchUtilisateurs',sortId:'adminSortUtilisateurs',listId:'adminUsersList',pagerId:null,pageSize:Infinity,filterIds:{role:'adminFilterRoleUtilisateurs'},cardSelector:'.admin-user-card',dateField:'created'}
  };

  function actualiserResumeDepotsAttente(data) {
    const docs = Array.isArray(data) ? data : [];
    const total = docs.length;
    const categories = new Set(docs.map(d => String(d?.['Catégorie'] || d?.Genre || '').trim()).filter(Boolean));
    const auteurs = new Set(docs.map(d => String(d?.Auteur || '').trim().toLocaleLowerCase('fr')).filter(Boolean));
    const dernier = docs[0] || null;
    const totalEl=document.getElementById('adminPendingTotal');
    const catEl=document.getElementById('adminPendingCategories');
    const dernierEl=document.getElementById('adminPendingDernier');
    const auteursEl=document.getElementById('adminPendingAuteurs');
    if(totalEl) totalEl.textContent=String(total);
    if(catEl) catEl.textContent=String(categories.size);
    if(dernierEl) dernierEl.textContent=dernier ? String(dernier.Titre || 'Sans titre').slice(0,28) : '—';
    if(auteursEl) auteursEl.textContent=String(auteurs.size);
    const breakdown=document.getElementById('adminPendingBreakdown');
    if(!breakdown) return;
    const compte=new Map();
    docs.forEach(d=>{const c=String(d?.['Catégorie'] || d?.Genre || 'Non classé').trim() || 'Non classé';compte.set(c,(compte.get(c)||0)+1);});
    breakdown.innerHTML='';
    [...compte.entries()].sort((a,b)=>b[1]-a[1]||normaliserAdminTexte(a[0]).localeCompare(normaliserAdminTexte(b[0]),'fr')).slice(0,8).forEach(([cat,n])=>{
      const b=document.createElement('button'); b.type='button'; b.className='admin-pending-breakdown-chip'; b.innerHTML=`<span>${echapperHtmlPub(cat)}</span><b>${n}</b>`;
      b.title='Afficher uniquement cette catégorie';
      b.addEventListener('click',()=>{
        const select=document.getElementById('adminFilterNiveauAttente');
        const mat=document.getElementById('adminFilterMatiereAttente');
        const catSelect=document.getElementById('adminFilterCategorieAttente');
        if(select) select.value=''; if(mat) mat.value=''; if(catSelect) catSelect.value=cat;
        const state=adminCollectionStates.attente || (adminCollectionStates.attente={page:1,query:'',sort:'recent',filters:{}});
        state.filters.categorie=cat; state.page=1;
        appliquerCollectionAdmin('attente',ADMIN_COLLECTION_CONFIG.attente);
      });
      breakdown.appendChild(b);
    });
  }

  function actualiserResumeDepotsPublies(data) {
    const docs = Array.isArray(data) ? data : [];
    const total = docs.length;
    const categories = new Set(docs.map(d => String(d?.['Catégorie'] || d?.Genre || '').trim()).filter(Boolean));
    const auteurs = new Set(docs.map(d => String(d?.Auteur || '').trim().toLocaleLowerCase('fr')).filter(Boolean));
    const dernier = docs[0] || null;
    const totalEl=document.getElementById('adminPublishedTotal');
    const catEl=document.getElementById('adminPublishedCategories');
    const dernierEl=document.getElementById('adminPublishedDernier');
    const auteursEl=document.getElementById('adminPublishedAuteurs');
    if(totalEl) totalEl.textContent=String(total);
    if(catEl) catEl.textContent=String(categories.size);
    if(dernierEl) dernierEl.textContent=dernier ? String(dernier.Titre || 'Sans titre').slice(0,28) : '—';
    if(auteursEl) auteursEl.textContent=String(auteurs.size);
    const breakdown=document.getElementById('adminPublishedBreakdown');
    if(!breakdown) return;
    const compte=new Map();
    docs.forEach(d=>{const c=String(d?.['Catégorie'] || d?.Genre || 'Non classé').trim() || 'Non classé';compte.set(c,(compte.get(c)||0)+1);});
    breakdown.innerHTML='';
    [...compte.entries()].sort((a,b)=>b[1]-a[1]||normaliserAdminTexte(a[0]).localeCompare(normaliserAdminTexte(b[0]),'fr')).slice(0,8).forEach(([cat,n])=>{
      const b=document.createElement('button'); b.type='button'; b.className='admin-pending-breakdown-chip'; b.innerHTML=`<span>${echapperHtmlPub(cat)}</span><b>${n}</b>`;
      b.title='Afficher uniquement cette catégorie';
      b.addEventListener('click',()=>{
        const catSelect=document.getElementById('adminFilterCategoriePublies');
        if(catSelect) catSelect.value=cat;
        const state=adminCollectionStates.publies || (adminCollectionStates.publies={page:1,query:'',sort:'recent',filters:{}});
        state.filters.categorie=cat; state.page=1;
        appliquerCollectionAdmin('publies',ADMIN_COLLECTION_CONFIG.publies);
      });
      breakdown.appendChild(b);
    });
  }

