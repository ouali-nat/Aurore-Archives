// ---------- DOCUMENTS (connecté à Supabase) ----------
  let documentsCourants = [];

  const SITE_PUBLIC_PAGE_SIZE = 10;
  function normaliserRechercheSite(v){
    return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }
  function valeurTexteDocument(doc){
    return normaliserRechercheSite([doc.Titre,doc.Auteur,doc.Niveau,doc.Filiere,doc.Classe,doc['Catégorie'],doc['Matière'],doc.Genre,doc.Source].filter(Boolean).join(' '));
  }
  function actualiserTriPublicDocuments(data){
    const select=document.getElementById('docSort'); if(!select) return;
    const current=select.value||'recent';
    const base=[['recent','Plus récent'],['oldest','Plus ancien'],['az','Titre A → Z'],['za','Titre Z → A']];
    if((data||[]).some(d=>String(d.Niveau||'').trim())) base.push(['niveau','Niveau A → Z']);
    if((data||[]).some(d=>String(d.Classe||'').trim())) base.push(['classe','Classe A → Z']);
    if((data||[]).some(d=>String(d['Matière']||'').trim())) base.push(['matiere','Matière A → Z']);
    select.innerHTML=base.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
    select.value=base.some(([v])=>v===current)?current:'recent';
  }
  function trierDocumentsClient(data) {
    const mode = document.getElementById('docSort')?.value || 'recent';
    const cle=(doc)=> mode==='niveau'?doc.Niveau : mode==='classe'?doc.Classe : mode==='matiere'?doc['Matière'] : doc.Titre;
    return [...(data || [])].sort((a,b) => {
      if (['az','za','niveau','classe','matiere'].includes(mode)) {
        const c=String(cle(a)||'').localeCompare(String(cle(b)||''),'fr',{sensitivity:'base'});
        return mode==='za' ? -c : c;
      }
      const idA = Number(a.id) || 0, idB = Number(b.id) || 0;
      return mode === 'oldest' ? idA-idB : idB-idA;
    });
  }

  function afficherPaginationSite(containerId,total,page,onChange){
    const el=document.getElementById(containerId); if(!el) return;
    const pages=Math.ceil(total/SITE_PUBLIC_PAGE_SIZE);
    el.innerHTML='';
    if(pages<=1) return;
    const add=(label,target,disabled=false,active=false)=>{
      const b=document.createElement('button'); b.type='button'; b.textContent=label; b.disabled=disabled; if(active)b.classList.add('active');
      b.addEventListener('click',()=>onChange(target)); el.appendChild(b);
    };
    add('‹',page-1,page<=1);
    const nums=[]; for(let i=1;i<=pages;i++){ if(i===1||i===pages||Math.abs(i-page)<=1) nums.push(i); }
    let prev=0; nums.forEach(n=>{ if(prev && n-prev>1){ const s=document.createElement('span'); s.textContent='…'; s.setAttribute('aria-hidden','true'); el.appendChild(s); } add(String(n),n,false,n===page); prev=n; });
    add('›',page+1,page>=pages);
  }

  // ---------- TAILLE DES DOCUMENTS ----------
  const TAILLES_DOCUMENTS_CACHE = new Map();
  const TAILLES_DOCUMENTS_PROMESSES = new Map();
  function tailleBadgeMarkup(url){if(!url)return '';return `<span class="document-size-badge" data-document-size data-size-url="${encodeURIComponent(String(url))}" data-size-state="loading" title="Taille du fichier"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg><span data-size-label>Calcul de la taille…</span></span>`;}
  async function obtenirTailleDocument(url){
    const key=String(url||'');
    if(!key)return 0;
    if(TAILLES_DOCUMENTS_CACHE.has(key))return TAILLES_DOCUMENTS_CACHE.get(key);
    if(TAILLES_DOCUMENTS_PROMESSES.has(key))return TAILLES_DOCUMENTS_PROMESSES.get(key);
    const promise=(async()=>{
      const urls=[];
      try{const cle=key.indexOf(R2_PUBLIC_URL + '/')===0?key.slice(R2_PUBLIC_URL.length+1):null;if(cle&&typeof R2_WORKER_URL!=='undefined'&&R2_WORKER_URL)urls.push(`${R2_WORKER_URL}/${cle}`);}catch(e){}
      urls.push(key);
      for(const cible of [...new Set(urls)]){
        try{
          const head=await fetch(cible,{method:'HEAD',cache:'no-store'});
          if(head.ok){
            const n=Number(head.headers.get('Content-Length')||0);
            if(Number.isFinite(n)&&n>0){TAILLES_DOCUMENTS_CACHE.set(key,n);return n;}
          }
        }catch(e){}
      }
      TAILLES_DOCUMENTS_CACHE.set(key,0);
      return 0;
    })();
    TAILLES_DOCUMENTS_PROMESSES.set(key,promise);
    try{return await promise}finally{TAILLES_DOCUMENTS_PROMESSES.delete(key)}
  }
  async function actualiserTaillesDocumentsDans(container=document){const nodes=container.querySelectorAll?container.querySelectorAll('[data-document-size]:not([data-size-done])'):[];for(const el of nodes){el.dataset.sizeDone='1';const label=el.querySelector('[data-size-label]');const encoded=el.getAttribute('data-size-url')||'';let url='';try{url=decodeURIComponent(encoded)}catch(e){url=encoded}if(!url){if(label)label.textContent='Taille indisponible';el.dataset.sizeState='error';continue}const taille=await obtenirTailleDocument(url);if(taille>0){if(label)label.textContent=formaterTailleTelechargement(taille);el.dataset.sizeState='ready';el.title='Taille du fichier : '+formaterTailleTelechargement(taille)}else{if(label)label.textContent='Taille indisponible';el.dataset.sizeState='error'}}}
  const OBSERVATEUR_TAILLES_DOCUMENTS=new MutationObserver(mutations=>{for(const m of mutations)m.addedNodes.forEach(node=>{if(node.nodeType===1&&(node.matches?.('[data-document-size]')||node.querySelector?.('[data-document-size]')))actualiserTaillesDocumentsDans(node)})});
  if(document.body)OBSERVATEUR_TAILLES_DOCUMENTS.observe(document.body,{childList:true,subtree:true});
  window.auroreActualiserTaillesDocumentsDans=actualiserTaillesDocumentsDans;

  // ---------- COUVERTURES DE LIVRES : PREMIÈRE PAGE DU PDF ----------
  // La couverture d'un livre est TOUJOURS la première page de son PDF, SAUF
  // si le document possède déjà une vraie image de couverture (voir plus bas
  // "Couverture_url" / "Cover_url" / "Miniature_url") : dans ce cas on
  // affiche directement cette image, sans jamais toucher au PDF — c'est la
  // méthode la plus rapide et la moins gourmande en données, exactement
  // comme sur les autres sites où les couvertures s'affichent instantanément.
  //
  // Pour les documents sans image dédiée, la première page du PDF est
  // rendue une seule fois puis conservée dans IndexedDB (pas localStorage :
  // localStorage plafonne à 5-10 Mo et, une fois ce quota atteint, chaque
  // nouvelle sauvegarde échouait SILENCIEUSEMENT — résultat, dès que la
  // bibliothèque grossissait un peu, le cache ne servait plus à rien et
  // TOUTES les couvertures étaient re-téléchargées et re-générées à chaque
  // visite. IndexedDB n'a pas cette limite basse et ne casse pas le reste
  // du site quand il est plein (favoris, "plus tard", thème, etc. utilisent
  // aussi localStorage et pouvaient être impactés par le même quota).
  const CACHE_COUVERTURES_PREMIERE_PAGE = new Map();
  const IDB_COUVERTURES_NOM = 'aurore-couvertures-db';
  const IDB_COUVERTURES_MAGASIN = 'couvertures';
  const ANCIENNE_CLEF_LOCALSTORAGE_COUVERTURES = 'aurore-couvertures-premiere-page-v1';

  let _idbCouverturesPromesse = null;
  function ouvrirIDBCouvertures() {
    if (_idbCouverturesPromesse) return _idbCouverturesPromesse;
    _idbCouverturesPromesse = new Promise((resolve) => {
      if (!('indexedDB' in window)) { resolve(null); return; }
      try {
        const req = indexedDB.open(IDB_COUVERTURES_NOM, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_COUVERTURES_MAGASIN)) {
            db.createObjectStore(IDB_COUVERTURES_MAGASIN);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return _idbCouverturesPromesse;
  }

  // Charge tout le cache existant en mémoire une seule fois au démarrage
  // (rapide : ce sont de petites vignettes), puis migre et supprime
  // l'ancien cache localStorage s'il existe encore, pour libérer sa place.
  async function initialiserCacheCouvertures() {
    const db = await ouvrirIDBCouvertures();
    if (db) {
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_COUVERTURES_MAGASIN, 'readonly');
          const store = tx.objectStore(IDB_COUVERTURES_MAGASIN);
          const req = store.openCursor();
          req.onsuccess = (e) => {
            const curseur = e.target.result;
            if (curseur) {
              CACHE_COUVERTURES_PREMIERE_PAGE.set(curseur.key, curseur.value);
              curseur.continue();
            } else resolve();
          };
          req.onerror = () => resolve();
        } catch (e) { resolve(); }
      });
    }

    // Migration ponctuelle depuis l'ancien cache localStorage, puis nettoyage.
    try {
      const ancien = localStorage.getItem(ANCIENNE_CLEF_LOCALSTORAGE_COUVERTURES);
      if (ancien) {
        const donnees = JSON.parse(ancien) || {};
        if (db) {
          const tx = db.transaction(IDB_COUVERTURES_MAGASIN, 'readwrite');
          const store = tx.objectStore(IDB_COUVERTURES_MAGASIN);
          Object.keys(donnees).forEach(clef => {
            if (!CACHE_COUVERTURES_PREMIERE_PAGE.has(clef)) {
              CACHE_COUVERTURES_PREMIERE_PAGE.set(clef, donnees[clef]);
            }
            try { store.put(donnees[clef], clef); } catch (e) {}
          });
        }
        localStorage.removeItem(ANCIENNE_CLEF_LOCALSTORAGE_COUVERTURES);
      }
    } catch (e) {}
  }
  const CACHE_COUVERTURES_PRET = initialiserCacheCouvertures();

  function clefCouverturePremierePage(doc) {
    return String(doc?.id ?? doc?.Fichier_url ?? '').trim();
  }

  function sauvegarderCouverturePremierePage(clef, dataUrl) {
    if (!clef || !dataUrl) return;
    // Écriture IndexedDB asynchrone, sans bloquer l'affichage ; chaque
    // vignette est écrite individuellement (pas de réécriture de tout le
    // cache à chaque nouvelle couverture, contrairement à l'ancien système).
    ouvrirIDBCouvertures().then(db => {
      if (!db) return;
      try {
        const tx = db.transaction(IDB_COUVERTURES_MAGASIN, 'readwrite');
        tx.objectStore(IDB_COUVERTURES_MAGASIN).put(dataUrl, clef);
      } catch (e) {}
    });
  }

  function couverturePremierePagePersistanteImmediate(doc) {
    const clef = clefCouverturePremierePage(doc);
    if (!clef) return null;
    return CACHE_COUVERTURES_PREMIERE_PAGE.get(clef) || null;
  }

  /*
   * ---------- COUVERTURES : PREMIÈRE PAGE UNIQUEMENT ----------
   *
   * Ancien problème : récupérerOctetsPDF() téléchargeait le PDF entier avant
   * de fabriquer une vignette. Pour un PDF de 50–200 Mo, cela consommait
   * inutilement le forfait mobile.
   *
   * Nouveau comportement :
   *   1. PDF.js reçoit directement l'URL du Worker v2.
   *   2. Le Worker prend en charge HTTP Range.
   *   3. PDF.js ne demande que les portions nécessaires pour obtenir la page 1.
   *   4. Une fois la page 1 rendue, elle est convertie en petite vignette JPEG.
   *   5. La vignette est conservée localement pour les visites suivantes.
   *
   * On ne précharge plus toutes les couvertures d'une liste : elles sont
   * demandées uniquement quand la ligne devient visible.
   */
  async function genererCouverturePremierePagePDF(doc) {
    const clef = clefCouverturePremierePage(doc);
    if (!clef || !doc?.Fichier_url) return null;

    const dejaEnCache = couverturePremierePagePersistanteImmediate(doc);
    if (dejaEnCache) {
      CACHE_COUVERTURES_PREMIERE_PAGE.set(clef, dejaEnCache);
      return dejaEnCache;
    }

    try {
      await chargerPdfJs();

      let source = String(doc.Fichier_url);
      try {
        const u = new URL(source, window.location.href);
        if (
          typeof R2_PUBLIC_URL !== 'undefined' &&
          u.href.indexOf(R2_PUBLIC_URL + '/') === 0
        ) {
          const cle = u.href.slice(R2_PUBLIC_URL.length + 1);
          source = `${R2_WORKER_URL}/${cle}`;
        }
      } catch(e) {}

      /*
       * PDF.js gère lui-même les requêtes Range.
       * 512 KiB est volontairement beaucoup plus petit que le PDF complet :
       * la couverture n'a besoin que des données nécessaires à la page 1.
       */
      const task = pdfjsLib.getDocument({
        url: source,
        rangeChunkSize: 256 * 1024,
        disableAutoFetch: true,
        disableRange: false,
        disableStream: false,
        stopAtErrors: false
      });

      const pdf = await task.promise;
      if (!pdf || !pdf.numPages) {
        throw new Error('PDF sans première page exploitable');
      }

      const page = await pdf.getPage(1);

      /*
       * Les couvertures sont affichées dans une vignette de 56x56 px CSS.
       * Même sur un écran très dense (2.5x), 140 px de large est largement
       * suffisant pour une netteté parfaite — inutile d'aller au-delà.
       * Avant : cible 180 px avec un plafond de scale à 0.75 (donc jusqu'à
       * 3-4x plus de pixels que nécessaire pour un carré de 56 px). Chaque
       * pixel en trop coûte du temps de rendu PDF et du poids de JPEG,
       * pour un résultat invisible une fois réduit à 56 px par le CSS.
       */
      const base = page.getViewport({scale:1});
      const largeurCible = 140;
      const scale = Math.min(
        0.45,
        largeurCible / Math.max(1, base.width)
      );
      const viewport = page.getViewport({scale});

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      const ctx = canvas.getContext('2d', {alpha:false});
      if (!ctx) throw new Error('Contexte canvas indisponible');

      await page.render({
        canvasContext:ctx,
        viewport
      }).promise;

      /*
       * JPEG léger : la couverture n'a pas besoin de la qualité du PDF.
       * 0.55 reste net sur une vignette de 56 px tout en réduisant nettement
       * le poids de chaque image comparé à 0.68.
       */
      const dataUrl = canvas.toDataURL('image/jpeg', 0.55);

      CACHE_COUVERTURES_PREMIERE_PAGE.set(clef, dataUrl);
      sauvegarderCouverturePremierePage(clef, dataUrl);

      try { page.cleanup?.(); } catch(e) {}
      try { pdf.cleanup?.(); } catch(e) {}
      try { pdf.destroy?.(); } catch(e) {}

      return dataUrl;
    } catch(e) {
      console.warn(
        '[Couverture livre] première page impossible pour',
        doc?.Titre,
        e
      );
      CACHE_COUVERTURES_PREMIERE_PAGE.delete(clef);
      return null;
    }
  }


  function appliquerImageCouverture(row, doc, url, estImageReelle = false) {
    if (!url || !row?.isConnected) return;
    const wrap = row.querySelector('.icon-wrap, .admin-card-icon, .personal-doc-cover');
    if (!wrap || !wrap.isConnected) return;

    wrap.classList.add('a-couverture');
    const titre = obtenirTitreDocument(doc);
    const alt = estImageReelle
      ? titre
      : `Première page — ${titre}`;

    // Une vraie image de couverture est chargée en lazy ; une vignette
    // déjà générée depuis le PDF est injectée immédiatement.
    const chargement = 'eager';
    const img = document.createElement('img');
    img.className = 'doc-cover-img';
    img.src = String(url);
    img.alt = alt;
    img.loading = chargement;
    img.decoding = 'async';
    img.fetchPriority = 'high';

    // Une erreur réseau ne doit jamais laisser la vignette invisible
    // (l'ancien CSS mettait l'image à opacity:0 pendant son apparition).
    img.addEventListener('load', () => { img.style.opacity = '1'; }, {once:true});
    img.addEventListener('error', () => {
      wrap.classList.remove('a-couverture');
      wrap.innerHTML = ICONS.file;
    }, {once:true});

    wrap.replaceChildren(img);
  }

  // Affichage prioritaire de la première page : aucune recherche Google,
  // aucune attente d'une API de couverture. Le cache local est injecté
  // immédiatement ; sinon le rendu PDF démarre sans délai.
  /*
   * File d'attente légère des couvertures.
   * Maximum 2 rendus simultanés : cela évite de lancer 10/20 téléchargements
   * Range en même temps lorsque la rubrique contient beaucoup de documents.
   */
  const COUVERTURES_FILE = [];
  const COUVERTURES_EN_COURS = new Set();
  const COUVERTURES_OBSERVER = ('IntersectionObserver' in window)
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;

          const row = entry.target;
          COUVERTURES_OBSERVER.unobserve(row);

          const doc = row.__auroreDocumentCouverture;
          if (!doc) return;

          COUVERTURES_FILE.push({row, doc});
          traiterFileCouvertures();
        });
      }, {
        root:null,
        rootMargin:'900px 0px',
        threshold:0.01
      })
    : null;

  let COUVERTURES_ACTIVES = 0;
  const COUVERTURES_CONCURRENCE = 4;

  function traiterFileCouvertures() {
    while (
      COUVERTURES_ACTIVES < COUVERTURES_CONCURRENCE &&
      COUVERTURES_FILE.length
    ) {
      const item = COUVERTURES_FILE.shift();
      if (!item?.row?.isConnected || !item.doc) continue;

      const clef = clefCouverturePremierePage(item.doc);
      if (!clef || COUVERTURES_EN_COURS.has(clef)) continue;

      const dejaConnue = couverturePremierePagePersistanteImmediate(item.doc);
      if (dejaConnue) {
        appliquerImageCouverture(item.row, item.doc, dejaConnue);
        continue;
      }

      COUVERTURES_EN_COURS.add(clef);
      COUVERTURES_ACTIVES++;

      genererCouverturePremierePagePDF(item.doc)
        .then(url => {
          if (url) appliquerImageCouverture(item.row, item.doc, url);
        })
        .catch(() => {})
        .finally(() => {
          COUVERTURES_EN_COURS.delete(clef);
          COUVERTURES_ACTIVES--;
          traiterFileCouvertures();
        });
    }
  }

  function appliquerCouvertureSiLivre(row, doc) {
    if (!row || !doc?.Fichier_url) return;

    // Pour la bibliothèque publique, la couverture est toujours un aperçu
    // fidèle de la PREMIÈRE PAGE du PDF. On ne remplace donc plus cette page
    // par une éventuelle image de couverture externe : le rendu reste
    // identique au document réellement consulté.
    row.__auroreDocumentCouverture = doc;

    // Google Drive présente les aperçus dès que les tuiles entrent dans la
    // vue. Ici on va un cran plus loin : toutes les tuiles de la page courante
    // sont mises en file immédiatement après leur insertion dans le DOM.
    // Cela évite le délai perceptible d'IntersectionObserver et conserve le
    // cache IndexedDB comme chemin instantané pour les visites suivantes.
    const dejaConnue = couverturePremierePagePersistanteImmediate(doc);
    if (dejaConnue) {
      appliquerImageCouverture(row, doc, dejaConnue);
      return;
    }

    if (!COUVERTURES_FILE.some(x => x.row === row)) {
      COUVERTURES_FILE.push({row, doc});
    }
    traiterFileCouvertures();
  }

  // Les couvertures de première page sont activées pour toutes les listes de
  // documents du site. La couverture correspond toujours à la première page du PDF.
  let COUVERTURES_PREMIERE_PAGE_ACTIVES = true;

  // Même aperçu pour les deux espaces d'administration : la première page du
  // PDF devient la vignette du document, sans modifier les actions métier.
  function appliquerCouvertureAdmin(card, doc) {
    if (!card || !doc?.Fichier_url) return;
    card.__auroreDocumentCouverture = doc;
    const dejaConnue = couverturePremierePagePersistanteImmediate(doc);
    if (dejaConnue) {
      appliquerImageCouverture(card, doc, dejaConnue);
      return;
    }
    if (!COUVERTURES_FILE.some(x => x.row === card)) COUVERTURES_FILE.push({row:card, doc});
    traiterFileCouvertures();
  }

  function obtenirTitreDocument(doc) {
    const valeurs = [
      doc?.Titre,
      doc?.titre,
      doc?.Title,
      doc?.title,
      doc?.Nom,
      doc?.nom,
      doc?.name
    ];
    const titre = valeurs.find(v => v != null && String(v).trim() !== '');
    return String(titre || 'Document sans titre').trim();
  }

  /* ---------- PARTAGE DES DOCUMENTS ---------- */
  // Le partage public ne doit jamais exposer directement l'URL du PDF/R2.
  // Le lien partagé reste sur le domaine Aurore afin que le récepteur arrive
  // sur le site et que les métadonnées Open Graph du site soient utilisées
  // par WhatsApp, notamment le logo déclaré dans og:image.
  function obtenirUrlDocumentPartage(doc) {
    const id = doc?.id ?? doc?.ID ?? doc?.document_id;
    if (id == null || String(id).trim() === '') return '';
    try {
      const url = new URL(location.origin + location.pathname);
      url.search = '';
      url.hash = '';
      url.searchParams.set('document', String(id));
      // Depuis l'espace personnel, le lien transporte aussi une intention
      // d'accès à l'espace partagé. Cela ne donne jamais accès à l'espace
      // privé : le visiteur doit accepter explicitement l'invitation.
      const boutonPersonnel = auroreBoutonMenuDocumentActif?.closest?.('#personalSpace .aurore-personal-document-row');
      if (boutonPersonnel && session?.id) {
        url.searchParams.set('sharedSpace', '1');
        url.searchParams.set('owner', String(session.id));
      }
      return url.href;
    } catch (_) {
      return `${location.origin}/?document=${encodeURIComponent(String(id))}`;
    }
  }

  function obtenirTextePartageDocument(doc) {
    const titre = obtenirTitreDocument(doc);
    return `${titre}\nConsultez ce document sur Aurore — Section Archives.`;
  }

  async function partagerDocument(doc) {
    const url = obtenirUrlDocumentPartage(doc);
    if (!url) { alert('Le lien de ce document n’est pas disponible pour le partage.'); return; }
    const title = obtenirTitreDocument(doc);
    const text = obtenirTextePartageDocument(doc);
    try {
      if (navigator.share) {
        await navigator.share({title, text, url});
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        alert('Lien du document copié. Vous pouvez maintenant le coller dans WhatsApp.');
      } else {
        window.prompt('Copiez le lien du document :', url);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(url);
          alert('Lien du document copié. Vous pouvez maintenant le partager.');
        } catch (_) {
          window.prompt('Copiez le lien du document :', url);
        }
      }
    }
  }

  function partagerDocumentWhatsApp(doc) {
    const url = obtenirUrlDocumentPartage(doc);
    if (!url) { alert('Le lien de ce document n’est pas disponible pour WhatsApp.'); return; }
    const texte = `${obtenirTextePartageDocument(doc)}\n${url}`;
    const wa = `https://wa.me/?text=${encodeURIComponent(texte)}`;
    window.open(wa, '_blank', 'noopener,noreferrer');
  }

  async function copierLienDocument(doc) {
    const url = obtenirUrlDocumentPartage(doc);
    if (!url) { alert('Le lien de ce document n’est pas disponible.'); return; }
    try {
      await navigator.clipboard.writeText(url);
      alert('Lien du document copié.');
    } catch (_) {
      window.prompt('Copiez le lien du document :', url);
    }
  }

  /* ---------- MENU DOCUMENT : PORTAIL GLOBAL ----------
   * Le menu n'est volontairement plus enfant de la carte.
   * Il est créé directement dans <body>, ce qui élimine les conflits avec
   * overflow, transform, z-index et les re-rendus de la liste.
   * (Utilisé par les cartes admin et l'espace personnel — inchangé.)
   */
  let auroreMenuDocumentActif = null;
  let auroreBoutonMenuDocumentActif = null;

  function obtenirMenuDocumentGlobal() {
    let menu = document.getElementById('auroreDocumentShareMenu');
    if (menu) return menu;

    menu = document.createElement('div');
    menu.id = 'auroreDocumentShareMenu';
    menu.className = 'doc-share-menu aurore-document-share-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = `
      <button type="button" data-share-document="1" role="menuitem"><span class="share-icon">${ICONS.share}</span><span>Partager</span></button>
      <button type="button" data-share-whatsapp="1" role="menuitem"><span class="share-icon">${ICONS.share}</span><span>Partager sur WhatsApp</span></button>
      <button type="button" data-copy-document-link="1" role="menuitem"><span class="share-icon">${ICONS.share}</span><span>Copier le lien</span></button>`;
    document.body.appendChild(menu);
    return menu;
  }

  function fermerMenusPartageDocuments() {
    const menu = document.getElementById('auroreDocumentShareMenu');
    if (menu) {
      menu.classList.remove('open');
      menu.setAttribute('aria-hidden', 'true');
    }
    document.querySelectorAll('.doc-share-menu.open').forEach(m => {
      if (m !== menu) m.classList.remove('open');
    });
    if (auroreBoutonMenuDocumentActif) {
      auroreBoutonMenuDocumentActif.setAttribute('aria-expanded', 'false');
    }
    auroreMenuDocumentActif = null;
    auroreBoutonMenuDocumentActif = null;
  }

  function ouvrirMenuPartageDocument(more) {
    if (!more) return false;
    const row = more.closest('.doc-row, .admin-card, .aurore-personal-document-row');
    const index = row ? Number(row.dataset.documentIndex) : -1;
    const doc = row?._auroreDocument || row?.__auroreDocumentCouverture || (Number.isInteger(index) ? documentsCourants?.[index] : null);
    if (!doc) {
      console.warn('[Aurore] Menu impossible : document introuvable.');
      return false;
    }

    const menu = obtenirMenuDocumentGlobal();
    const dejaOuvert = menu.classList.contains('open') && auroreBoutonMenuDocumentActif === more;
    fermerMenusPartageDocuments();
    if (dejaOuvert) return false;

    auroreMenuDocumentActif = doc;
    auroreBoutonMenuDocumentActif = more;

    // Affichage temporaire pour mesurer correctement le menu.
    menu.style.visibility = 'hidden';
    menu.style.left = '12px';
    menu.style.top = '12px';
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');

    const rect = more.getBoundingClientRect();
    const marge = 12;
    const largeur = Math.min(230, Math.max(180, window.innerWidth - marge * 2));
    menu.style.width = largeur + 'px';
    const hauteur = menu.getBoundingClientRect().height || 150;

    let left = rect.right - largeur;
    left = Math.max(marge, Math.min(left, window.innerWidth - largeur - marge));
    let top = rect.bottom + 8;
    if (top + hauteur > window.innerHeight - marge) top = rect.top - hauteur - 8;
    top = Math.max(marge, Math.min(top, window.innerHeight - hauteur - marge));

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.visibility = '';
    more.setAttribute('aria-expanded', 'true');
    return true;
  }

  window.auroreOuvrirMenuDocument = ouvrirMenuPartageDocument;

  /* ---------- MENU DOCUMENT : CARTE PDF (bibliothèque / livres / récents) ----------
   * Nouveau comportement demandé : dans la vignette de couverture PDF, seul le
   * bouton à trois points reste visible en permanence, à l'angle de la
   * couverture. Un clic dessus ouvre — juste en dessous de ce bouton, à
   * l'intérieur de la carte — un seul menu qui regroupe TOUTES les actions
   * (Lire, Télécharger, Favori, Plus tard, Case, Partager, Partager WhatsApp,
   * Copier le lien, Signaler). Chaque bouton du menu garde exactement le même
   * gestionnaire de clic qu'auparavant : rien n'est supprimé, seulement
   * regroupé et masqué tant que le menu n'est pas ouvert.
   * Ce mécanisme ne concerne que les cartes de la grille PDF publique
   * (.doc-row) ; les cartes admin et l'espace personnel continuent d'utiliser
   * le portail global ci-dessus, inchangé.
   */
  function fermerToutesCartesActionsDocument(exceptRow) {
    document.querySelectorAll('.doc-row.aurore-carte-menu-ouverte').forEach(r => {
      if (r === exceptRow) return;
      r.classList.remove('aurore-carte-menu-ouverte');
      r.querySelector(':scope > .doc-more-btn')?.setAttribute('aria-expanded', 'false');
    });
  }

  function fermerCarteActionsDocument(row) {
    if (!row) return;
    row.classList.remove('aurore-carte-menu-ouverte');
    row.querySelector(':scope > .doc-more-btn')?.setAttribute('aria-expanded', 'false');
  }

  function basculerCarteActionsDocument(row, moreBtn) {
    if (!row) return;
    const dejaOuverte = row.classList.contains('aurore-carte-menu-ouverte');
    fermerToutesCartesActionsDocument(row);
    fermerMenusPartageDocuments();
    row.classList.toggle('aurore-carte-menu-ouverte', !dejaOuverte);
    moreBtn?.setAttribute('aria-expanded', String(!dejaOuverte));
  }

  function fermerTouteInterfaceActionsDocument() {
    fermerMenusPartageDocuments();
    fermerToutesCartesActionsDocument(null);
  }

  // Un seul gestionnaire capture la chaîne complète : ouverture + actions.
  document.addEventListener('click', function(e) {
    const target = e.target instanceof Element ? e.target : e.target?.parentElement;
    const more = target?.closest?.('[data-document-more]');

    if (more) {
      e.preventDefault();
      e.stopPropagation();
      const carteRow = more.closest('.doc-row');
      const estCarteAdminOuPersonnelle = more.closest('.admin-card, .aurore-personal-document-row');
      if (carteRow && !estCarteAdminOuPersonnelle) {
        basculerCarteActionsDocument(carteRow, more);
      } else {
        ouvrirMenuPartageDocument(more);
      }
      return;
    }

    const action = target?.closest?.('#auroreDocumentShareMenu [data-share-document],#auroreDocumentShareMenu [data-share-whatsapp],#auroreDocumentShareMenu [data-copy-document-link]');
    if (action) {
      e.preventDefault();
      e.stopPropagation();

      // Garder la référence avant de fermer le menu.
      const documentData = auroreMenuDocumentActif;
      if (!documentData) return;
      fermerMenusPartageDocuments();

      if (action.hasAttribute('data-share-document')) {
        Promise.resolve(partagerDocument(documentData)).catch(err => console.warn('[Aurore] Partage:', err));
      } else if (action.hasAttribute('data-share-whatsapp')) {
        partagerDocumentWhatsApp(documentData);
      } else {
        Promise.resolve(copierLienDocument(documentData)).catch(err => console.warn('[Aurore] Copie:', err));
      }
      return;
    }

    if (
      !target?.closest?.('#auroreDocumentShareMenu') &&
      !target?.closest?.('.doc-row.aurore-carte-menu-ouverte .doc-actions')
    ) {
      fermerTouteInterfaceActionsDocument();
    }
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') fermerTouteInterfaceActionsDocument();
  });
  window.addEventListener('resize', fermerTouteInterfaceActionsDocument);
  window.addEventListener('scroll', fermerTouteInterfaceActionsDocument, true);

  // Bouton « trois points » posé à l'angle de la couverture, en dehors du
  // panneau d'actions (toujours visible, même quand le menu est fermé).
  function boutonPlusCarteDocumentMarkup() {
    return `<button type="button" class="doc-more-btn" data-document-more="1" aria-label="Options du document" aria-haspopup="true" aria-expanded="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="12" cy="19" r="1.8"></circle></svg></button>`;
  }

  // Panneau unique regroupant toutes les actions d'un document, ouvert par le
  // bouton ci-dessus. Les boutons ci-dessous portent exactement les mêmes
  // attributs data-* qu'auparavant : les gestionnaires de clic attachés par
  // rendreListeDocuments()/rendreRecentsAvecOutils() n'ont pas besoin de changer.
  function panneauActionsCarteDocumentMarkup(telechargementOk) {
    return `<div class="doc-actions" role="menu">
      <button type="button" class="dl" data-lire="1" role="menuitem"><span class="share-icon">${ICONS.eye || '▶'}</span><span>Lire</span></button>
      ${telechargementOk?`<button type="button" class="dl" data-telecharger-maintenant="1" role="menuitem"><span class="share-icon">⬇</span><span>Télécharger maintenant</span></button>`:''}
      <button type="button" class="dl" data-favori="1" aria-pressed="false" role="menuitem"><span class="share-icon">♡</span><span>Favori</span></button>
      <button type="button" class="dl" data-plus-tard="1" role="menuitem"><span class="share-icon">＋</span><span>Plus tard</span></button>
      <button type="button" class="dl" data-case="1" role="menuitem"><span class="share-icon">▣</span><span>Ranger dans une case</span></button>
      <button type="button" data-share-document="1" role="menuitem"><span class="share-icon">${ICONS.share}</span><span>Partager</span></button>
      <button type="button" data-share-whatsapp="1" role="menuitem"><span class="share-icon">${ICONS.share}</span><span>Partager sur WhatsApp</span></button>
      <button type="button" data-copy-document-link="1" role="menuitem"><span class="share-icon">${ICONS.share}</span><span>Copier le lien</span></button>
      <button type="button" class="dl" data-signaler="1" role="menuitem"><span class="share-icon">⚑</span><span>Signaler</span></button>
    </div>`;
  }

  // Branche les gestionnaires communs (Lire, Télécharger, Favori, Plus tard,
  // Case, Signaler, Partager, Partager WhatsApp, Copier le lien) sur un panneau
  // d'actions donné, puis referme la carte après toute action choisie.
  function brancherActionsCarteDocument(row, doc) {
    row.querySelector('[data-lire]')?.addEventListener('click',()=>ouvrirLecteurPDF(doc));
    row.querySelector('[data-telecharger-maintenant]')?.addEventListener('click',()=>telechargerDocumentAvecProgression(doc));
    row.querySelector('[data-signaler]')?.addEventListener('click',()=>ouvrirSignalement(doc));
    row.querySelector('[data-favori]')?.addEventListener('click',()=>basculerFavoriDocument(doc,row.querySelector('[data-favori]')));
    row.querySelector('[data-plus-tard]')?.addEventListener('click',()=>ajouterDocumentPlusTard(doc,row.querySelector('[data-plus-tard]')));
    row.querySelector('[data-case]')?.addEventListener('click',(e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(typeof window.ouvrirChoixCaseDocument==='function') window.ouvrirChoixCaseDocument(doc);
      // stopPropagation() ci-dessus empêche l'événement d'atteindre le
      // gestionnaire de fermeture posé sur .doc-actions : on referme donc
      // explicitement la carte ici.
      fermerCarteActionsDocument(row);
    });
    row.querySelector('[data-share-document]')?.addEventListener('click',()=>{
      Promise.resolve(partagerDocument(doc)).catch(err => console.warn('[Aurore] Partage:', err));
    });
    row.querySelector('[data-share-whatsapp]')?.addEventListener('click',()=>{
      partagerDocumentWhatsApp(doc);
    });
    row.querySelector('[data-copy-document-link]')?.addEventListener('click',()=>{
      Promise.resolve(copierLienDocument(doc)).catch(err => console.warn('[Aurore] Copie:', err));
    });
    // N'importe quelle action choisie referme le panneau de la carte.
    // (L'ouverture/fermeture du panneau via le bouton "trois points" est gérée
    // par le gestionnaire de clic délégué global, plus bas — inutile de la
    // dupliquer ici.)
    row.querySelector('.doc-actions')?.addEventListener('click', (e) => {
      if (e.target.closest('button')) fermerCarteActionsDocument(row);
    });
  }

  function rendreListeDocuments(content, data, afficherCouverturesRomans = false) {
    // Prépare PDF.js en parallèle de la construction de la liste : le rendu
    // de la première page peut ainsi démarrer dès que les lignes sont visibles.
    if (afficherCouverturesRomans && typeof chargerPdfJs === 'function') chargerPdfJs().catch(() => {});
    documentsCourants = Array.isArray(data) ? data : [];
    if (documentsCourants.length === 0) {
      content.innerHTML = `<div class="doc-empty friendly-empty"><div class="icon-wrap">${ICONS.folder}</div><h3>Aucun document disponible pour le moment.</h3><p>Cette rubrique sera enrichie progressivement.</p></div>`;
      return;
    }
    const list=document.createElement('div');
    list.className='doc-list';

    // IMPORTANT : la liste doit être attachée au DOM AVANT la création des
    // couvertures. Ainsi row.isConnected est vrai dès le premier document et
    // le rendu de la page 1 peut commencer immédiatement, sans attendre un
    // second passage ou une nouvelle intersection.
    content.innerHTML='';
    content.appendChild(list);

    trierDocumentsClient(documentsCourants).forEach(doc=>{
      const row=document.createElement('div');
      row.className='doc-row';
      row._auroreDocument = doc;
      const telechargementOk=doc.Telechargement_autorise!==false;
      const contexte=[
        doc.Niveau && `Niveau : ${doc.Niveau}`,
        doc.Filiere && `Filière : ${doc.Filiere}`,
        (doc['Catégorie']||doc.Type) && `Catégorie : ${doc['Catégorie']||doc.Type}`,
        doc.Genre && `Genre : ${doc.Genre}`
      ].filter(Boolean).join(' · ');
      const titreDocument = obtenirTitreDocument(doc);
      row.dataset.documentTitle = titreDocument;
      row.innerHTML=`
        <div class="info">
          <div class="icon-wrap">${ICONS.file}</div>
          <div class="doc-main-info">
            <div class="titre" title="${echapperHtmlPub(titreDocument)}">${echapperHtmlPub(titreDocument)}</div>
            <div class="meta">Déposé par ${doc.Auteur||'anonyme'}${telechargementOk?'':' · Lecture seule'}</div>
            ${contexte?`<div class="doc-context">${contexte}</div>`:''}
            ${tailleBadgeMarkup(doc.Fichier_url)}
          </div>
        </div>
        ${boutonPlusCarteDocumentMarkup()}
        ${panneauActionsCarteDocumentMarkup(telechargementOk)}`;
      brancherActionsCarteDocument(row, doc);
      actualiserEtatActionsDocument(row,doc);
      actualiserTaillesDocumentsDans(row);
      // La ligne doit être dans le DOM avant d'être observée par
      // IntersectionObserver : sinon certaines couvertures ne reçoivent jamais
      // le signal d'entrée dans la zone visible.
      list.appendChild(row);
      if (COUVERTURES_PREMIERE_PAGE_ACTIVES) appliquerCouvertureSiLivre(row,doc);
    });
  }

  async function allerDocuments(matiere) {
    // Les sections scolaires utilisent elles aussi la couverture de première page.
    COUVERTURES_PREMIERE_PAGE_ACTIVES = true;
    etat.matiere = matiere;
    const niveauLabel = (etat.classe?.dbNiveaux?.[0]) || (etat.feuilleArbre?.dbNiveaux?.[0]) || (etat.sousNiveau?.dbNiveaux?.[0]) || '';
    const serieLabel = etat.filiere ? ' — Série ' + etat.filiere : '';
    document.getElementById('docsTitle').textContent =
      `${etat.categorie.nom} — ${etat.serieChoisie?.nom || etat.feuilleArbre?.nom || etat.sousNiveau?.nom || niveauLabel}${serieLabel} — ${matiere.nom}`;
    majFilAriane();
    document.querySelector('#screen-docs .back-btn').setAttribute('data-back', 'matieres');
    afficherEcran('screen-docs');

    const content = document.getElementById('docsContent');
    content.innerHTML = '<p style="color:var(--gris); font-size:0.9rem;">Chargement des documents…</p>';

    let query = `Niveau=eq.${encodeURIComponent(niveauLabel)}&${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent(etat.categorie.nom)}&${encodeURIComponent('Matière')}=eq.${encodeURIComponent(matiere.nom)}&Publie=eq.true&order=id.desc`;
    if (etat.filiere) query += `&Filiere=eq.${encodeURIComponent(etat.filiere)}`;
    if (etat.division) query += `&Classe=eq.${encodeURIComponent(etat.division)}`;

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&${query}`, { headers: HEADERS });
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      const data = filtreSerieSiDisponible(await res.json());
      documentsCourants = Array.isArray(data) ? data : [];
      actualiserTriPublicDocuments(documentsCourants);
      docsPageCourante = 1;
      if(document.getElementById('docsSearch')) document.getElementById('docsSearch').value = '';
      afficherDocumentsPublicsAvecOutils();
    } catch (err) {
      content.innerHTML = `<div class="doc-empty"><div class="icon-wrap">${ICONS.warning}</div><h3>Impossible de charger les documents</h3><p>Le contenu n’a pas pu être récupéré pour le moment. Veuillez réessayer dans quelques instants.</p></div>`;
    }
  }

  let docsPageCourante = 1;
  function afficherDocumentsPublicsAvecOutils(){
    const content=document.getElementById('docsContent');
    const q=normaliserRechercheSite(document.getElementById('docsSearch')?.value||'');
    const filtered=(documentsCourants||[]).filter(doc=>!q||valeurTexteDocument(doc).includes(q));
    const sorted=trierDocumentsClient(filtered);
    const pages=Math.max(1,Math.ceil(sorted.length/SITE_PUBLIC_PAGE_SIZE));
    docsPageCourante=Math.min(docsPageCourante,pages);
    if(!sorted.length){ content.innerHTML='<div class="site-empty-filter">Aucun document ne correspond à votre recherche.</div>'; afficherPaginationSite('docsPager',0,1,()=>{}); return; }
    const start=(docsPageCourante-1)*SITE_PUBLIC_PAGE_SIZE;
    rendreListeDocuments(content, sorted.slice(start,start+SITE_PUBLIC_PAGE_SIZE), COUVERTURES_PREMIERE_PAGE_ACTIVES);
    afficherPaginationSite('docsPager',sorted.length,docsPageCourante,p=>{docsPageCourante=p;afficherDocumentsPublicsAvecOutils();});
  }
  document.getElementById('docSort').addEventListener('change', () => { docsPageCourante=1; afficherDocumentsPublicsAvecOutils(); });
  document.getElementById('docsSearch')?.addEventListener('input', () => { docsPageCourante=1; afficherDocumentsPublicsAvecOutils(); });

  // ---------- LIVRES ET ROMANS ----------
  function allerLivres() {
    // Prépare pdf.js pendant que l’utilisateur choisit le genre, afin que la première page soit rendue immédiatement après l’ouverture des livres.
    if (typeof chargerPdfJs === 'function') chargerPdfJs().catch(() => {});
    etat = { niveau:null, sousNiveau:null, serieChoisie:null, classe:null, categorie:null, filiere:null, division:null, matiere:null, cheminArbre:[], feuilleArbre:null };
    const grid = document.getElementById('genreGrid');
    grid.innerHTML = '';
    GENRES.forEach(g => {
      const card = document.createElement('button');
      card.className = 'matiere-card';
      card.style.setProperty('--accent', COULEURS.violet);
      card.innerHTML = `<div class="mono">${g.mono}</div><div class="nom">${g.nom}</div><span class="badge">…</span>`;
      card.onclick = () => allerDocumentsLivre(g);
      grid.appendChild(card);
    });
    document.getElementById('breadcrumb').innerHTML = '';
    afficherEcran('screen-livres');

    // NB : nécessite que la colonne "Genre" existe dans Document (voir migration
    // SQL fournie : ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "Genre" text;).
    fetch(`${SUPABASE_URL}/rest/v1/Document?select=Genre&${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent('Livres')}&Publie=eq.true`, { headers: HEADERS })
      .then(res => res.ok ? res.json() : [])
      .then(rows => {
        const compte = {};
        rows.forEach(r => { compte[r.Genre] = (compte[r.Genre] || 0) + 1; });
        grid.querySelectorAll('.matiere-card').forEach((card, i) => {
          const n = compte[GENRES[i].nom] || 0;
          card.querySelector('.badge').textContent = n + (n > 1 ? ' livres' : ' livre');
        });
      })
      .catch(() => {});
  }

  async function allerDocumentsLivre(genre) {
    // Les couvertures sont actives uniquement ici, dans l'emplacement Romans.
    COUVERTURES_PREMIERE_PAGE_ACTIVES = true;
    document.getElementById('docsTitle').textContent = `Livres et romans — ${genre.nom}`;
    document.querySelector('#screen-docs .back-btn').setAttribute('data-back', 'livres');
    afficherEcran('screen-docs');

    const content = document.getElementById('docsContent');
    content.innerHTML = '<p style="color:var(--gris); font-size:0.9rem;">Chargement des documents…</p>';

    const query = `${encodeURIComponent('Catégorie')}=eq.${encodeURIComponent('Livres')}&Genre=eq.${encodeURIComponent(genre.nom)}&Publie=eq.true`;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&${query}`, { headers: HEADERS });
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      const data = await res.json();
      // Les résultats utilisent eux aussi la première page comme couverture.
      COUVERTURES_PREMIERE_PAGE_ACTIVES = true;
      rendreListeDocuments(content, data, true);
    } catch (err) {
      content.innerHTML = `<div class="doc-empty"><div class="icon-wrap">${ICONS.warning}</div><h3>Impossible de charger les documents</h3><p>Le contenu n’a pas pu être récupéré pour le moment. Veuillez réessayer dans quelques instants.</p></div>`;
    }
  }

  document.getElementById('btnLivres').querySelector('.icon-wrap').innerHTML = ICONS.book;
  document.getElementById('btnLivres').addEventListener('click', allerLivres);

  // ---------- BOUTONS RETOUR GÉNÉRIQUES ----------
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cible=btn.getAttribute('data-back');
      // Les boutons explicitement marqués « home » vont toujours à l'accueil,
      // même si l'historique contient un écran précédent.
      if(cible==='home'){
        allerAccueil();
        return;
      }
      if (history.state && history.state.aurasterNavigation) {
        history.back();
        return;
      }
      if(cible==='level') afficherEcran('screen-level');
      else if(cible==='livres') afficherEcran('screen-livres');
      else if(cible==='matieres') afficherEcran('screen-matieres');
    });
  });

  // ---------- ÉCRAN DÉPÔT ----------
  document.getElementById('btnDeposer').addEventListener('click', () => {
    afficherEcran('screen-deposer');
    document.getElementById('breadcrumb').innerHTML = '';
    const connecte = !!session;
    document.getElementById('depotConnexionRequise').style.display = connecte ? 'none' : 'block';
    document.getElementById('depotFormCard').style.display = connecte ? 'block' : 'none';
  });
  document.getElementById('btnConnexionDepuisDepot').addEventListener('click', demarrerConnexionGoogle);

  // ---------- DOCUMENTS RÉCEMMENT PUBLIÉS (accueil → écran dédié) ----------
  // Lecture publique (comme tout document publié) filtrée sur la colonne
  // "Mis_en_avant" (sélection admin indépendante — voir migration SQL fournie
  // et basculerMiseEnAvantDocument()). Tant que cette colonne n'existe pas
  // encore côté Supabase, la requête échoue proprement et l'écran affiche
  // l'état vide plutôt que de casser la page.
  (function(){
    const card=document.getElementById('homeRecentsCta');
    if(!card) return;
    const open=()=>{
      document.getElementById('breadcrumb').innerHTML='';
      afficherEcran('screen-recents');
      chargerDocumentsRecents();
    };
    card.addEventListener('click',open);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
  })();

  function tagsClassementDocument(doc) {
    return [
      doc.Niveau && doc.Niveau !== 'Livres' ? doc.Niveau : null,
      doc.Filiere ? 'Série ' + doc.Filiere : null,
      doc['Catégorie'] || null,
      doc['Matière'] || doc.Genre || null
    ].filter(Boolean);
  }

  let documentsRecentsCourants = [];
  let recentsPageCourante = 1;
  function rendreRecentsAvecOutils(){
    const content=document.getElementById('recentsContent');
    const q=normaliserRechercheSite(document.getElementById('recentsSearch')?.value||'');
    const select=document.getElementById('recentsSort');
    const current=select?.value||'recent';

    if(select){
      const opts=[['recent','Plus récent'],['oldest','Plus ancien'],['az','Titre A → Z'],['za','Titre Z → A']];
      if((documentsRecentsCourants||[]).some(d=>String(d.Niveau||'').trim())) opts.push(['niveau','Niveau A → Z']);
      if((documentsRecentsCourants||[]).some(d=>String(d.Classe||'').trim())) opts.push(['classe','Classe A → Z']);
      if((documentsRecentsCourants||[]).some(d=>String(d['Matière']||'').trim())) opts.push(['matiere','Matière A → Z']);
      select.innerHTML=opts.map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
      select.value=opts.some(([v])=>v===current)?current:'recent';
    }

    const mode=select?.value||'recent';
    let data=(documentsRecentsCourants||[]).filter(doc=>!q||valeurTexteDocument(doc).includes(q));
    data.sort((a,b)=>{
      const cle=(doc)=> mode==='niveau'?doc.Niveau : mode==='classe'?doc.Classe : mode==='matiere'?doc['Matière'] : doc.Titre;
      if(['az','za','niveau','classe','matiere'].includes(mode)){
        const c=String(cle(a)||'').localeCompare(String(cle(b)||''),'fr',{sensitivity:'base'});
        return mode==='za'?-c:c;
      }
      const aId=Number(a.id)||0,bId=Number(b.id)||0;
      return mode==='oldest'?aId-bId:bId-aId;
    });

    const pages=Math.max(1,Math.ceil(data.length/SITE_PUBLIC_PAGE_SIZE));
    recentsPageCourante=Math.min(recentsPageCourante,pages);

    if(!data.length){
      content.innerHTML='<div class="site-empty-filter">Aucun document ne correspond à votre recherche.</div>';
      afficherPaginationSite('recentsPager',0,1,()=>{});
      return;
    }

    const startIndex=(recentsPageCourante-1)*SITE_PUBLIC_PAGE_SIZE;
    const list=document.createElement('div');
    // IMPORTANT : les documents récemment publiés utilisent exactement
    // le même composant que la bibliothèque publique (.doc-list / .doc-row).
    // Seules les actions propres à cette section sont conservées.
    list.className='doc-list';

    content.innerHTML='';
    content.appendChild(list);

    data.slice(startIndex,startIndex+SITE_PUBLIC_PAGE_SIZE).forEach(doc=>{
      const row=document.createElement('div');
      row.className='doc-row';
      const telechargementOk=doc.Telechargement_autorise!==false;
      const contexte=[
        doc.Niveau && `Niveau : ${doc.Niveau}`,
        doc.Filiere && `Filière : ${doc.Filiere}`,
        (doc['Catégorie']||doc.Type) && `Catégorie : ${doc['Catégorie']||doc.Type}`,
        doc.Genre && `Genre : ${doc.Genre}`
      ].filter(Boolean).join(' · ');
      const titreDocument=obtenirTitreDocument(doc);
      row.dataset.documentTitle=titreDocument;

      row.innerHTML=`
        <div class="info">
          <div class="icon-wrap">${ICONS.file}</div>
          <div class="doc-main-info">
            <div class="titre" title="${echapperHtmlPub(titreDocument)}">${echapperHtmlPub(titreDocument)}</div>
            <div class="meta">Déposé par ${echapperHtmlPub(doc.Auteur||'anonyme')}${telechargementOk?'':' · Lecture seule'}</div>
            ${contexte?`<div class="doc-context">${echapperHtmlPub(contexte)}</div>`:''}
            ${tailleBadgeMarkup(doc.Fichier_url)}
          </div>
        </div>
        ${boutonPlusCarteDocumentMarkup()}
        ${panneauActionsCarteDocumentMarkup(telechargementOk)}`;

      row._auroreDocument=doc;
      brancherActionsCarteDocument(row, doc);

      actualiserEtatActionsDocument(row,doc);
      list.appendChild(row);

      // Même vignette : première page réelle du PDF, comme dans la bibliothèque.
      if(doc.Fichier_url && typeof appliquerCouvertureSiLivre==='function'){
        appliquerCouvertureSiLivre(row,doc);
      }
    });

    afficherPaginationSite('recentsPager',data.length,recentsPageCourante,p=>{
      recentsPageCourante=p;
      rendreRecentsAvecOutils();
    });
  }

  async function chargerDocumentsRecents() {
    const content = document.getElementById('recentsContent');
    content.innerHTML = '<p class="admin-empty">Chargement…</p>';
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?select=*&Publie=eq.true&Mis_en_avant=eq.true&order=id.desc&limit=100`, { headers: HEADERS });
      if (!res.ok) throw new Error("Statut HTTP " + res.status);
      const data = await res.json();
      documentsRecentsCourants=Array.isArray(data)?data:[];
      recentsPageCourante=1;
      if(document.getElementById('recentsSearch')) document.getElementById('recentsSearch').value='';
      if(!documentsRecentsCourants.length){
        content.innerHTML = `<div class="doc-empty friendly-empty"><div class="icon-wrap">${ICONS.folder}</div><h3>Aucun document mis en avant pour le moment.</h3><p>Revenez bientôt : cette sélection est enrichie régulièrement par l'équipe d'${SITE_NOM}.</p></div>`;
        afficherPaginationSite('recentsPager',0,1,()=>{}); return;
      }
      rendreRecentsAvecOutils();
    } catch (err) {
      content.innerHTML = `<p class="admin-empty">Impossible de charger cette sélection pour le moment.</p>`;
    }
  }
  document.getElementById('recentsSearch')?.addEventListener('input',()=>{recentsPageCourante=1;rendreRecentsAvecOutils();});
  document.getElementById('recentsSort')?.addEventListener('change',()=>{recentsPageCourante=1;rendreRecentsAvecOutils();});

  let DOC_EN_APERCU = null;
  function ouvrirApercuDocument(doc) {
    DOC_EN_APERCU = doc;
    document.getElementById('apercuTitre').textContent = doc.Titre || 'Document';
    document.getElementById('apercuTags').innerHTML = tagsClassementDocument(doc).map(t => `<span class="tag">${t}</span>`).join('');
    document.getElementById('apercuMeta').textContent = `Déposé par ${doc.Auteur || 'anonyme'}${doc.Source ? ' · Source : ' + doc.Source : ''}`;
    document.getElementById('apercuOverlay').style.display = 'flex';
  }
  function fermerApercu() {
    document.getElementById('apercuOverlay').style.display = 'none';
    DOC_EN_APERCU = null;
  }
  document.getElementById('apercuFermer').addEventListener('click', fermerApercu);
  document.getElementById('apercuOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'apercuOverlay') fermerApercu();
  });
  document.getElementById('apercuConsulter').addEventListener('click', () => {
    const doc = DOC_EN_APERCU;
    fermerApercu();
    if (doc) ouvrirLecteurPDF(doc);
  });

  const selGenre = document.getElementById('f_genre');
  GENRES.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.nom; opt.textContent = g.nom;
    selGenre.appendChild(opt);
  });
  selGenre.insertAdjacentHTML('afterbegin', '<option value="">Choisir</option>');
