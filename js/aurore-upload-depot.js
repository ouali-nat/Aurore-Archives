  document.getElementById('f_categorie').addEventListener('change', function(){
    const estLivre = this.value === 'Livres';
    document.getElementById('f_cascade_wrap').style.display = estLivre ? 'none' : 'block';
    document.getElementById('f_matiere_wrap').style.display = estLivre ? 'none' : 'block';
    document.getElementById('f_genre_wrap').style.display = estLivre ? 'block' : 'none';
  });
  document.getElementById('f_genre_wrap').style.display = 'none';

  // ---------- CASCADE DYNAMIQUE DU FORMULAIRE DE DÉPÔT ----------
  // Réutilise EXACTEMENT l'arborescence NIVEAUX (même source de vérité que
  // l'exploration publique : allerNiveau / choisirSousNiveau / afficherNoeudArbre)
  // pour que dépôt et navigation ne divergent jamais. Un noeud est une "feuille"
  // s'il ne possède aucun des 4 tableaux d'enfants reconnus (sousNiveaux / series /
  // classes / enfants) ; dans ce cas on lit sa liste "matieres" (avec le même repli
  // que allerMatieres() : feuille.matieres, sinon la liste globale MATIERES).
  function enfantsDeNoeudDepot(noeud) {
    if (!noeud) return null;
    if (Array.isArray(noeud.sousNiveaux)) return noeud.sousNiveaux;
    if (Array.isArray(noeud.troncCommuns)) return [...noeud.troncCommuns, ...(Array.isArray(noeud.series) ? noeud.series : [])];
    if (Array.isArray(noeud.series))     return noeud.series;
    if (Array.isArray(noeud.classes))    return noeud.classes;
    if (Array.isArray(noeud.enfants))    return noeud.enfants;
    return null;
  }
  function estFeuilleDepot(noeud) { return enfantsDeNoeudDepot(noeud) === null; }

  // Chemin actuellement choisi dans le formulaire, du Niveau (racine de NIVEAUX)
  // jusqu'à la feuille (ou jusqu'au dernier niveau sélectionné si incomplet).
  let depotChemin = [];

  function rendreCascadeDepot() {
    const zone = document.getElementById('f_cascade');
    zone.innerHTML = '';

    const selRacine = document.createElement('select');
    selRacine.innerHTML = '<option value="">Choisir un niveau</option>' +
      NIVEAUX.map(n => `<option value="${n.id}">${n.nom}</option>`).join('');
    selRacine.value = depotChemin[0] ? depotChemin[0].id : '';
    selRacine.addEventListener('change', function(){
      const n = NIVEAUX.find(x => x.id === this.value) || null;
      depotChemin = n ? [n] : [];
      rendreCascadeDepot();
      resoudreCheminDepot();
    });
    zone.appendChild(selRacine);

    let courant = depotChemin[0] || null;
    let profondeur = 1;
    while (courant && !estFeuilleDepot(courant)) {
      const enfants = enfantsDeNoeudDepot(courant);
      const choisi = depotChemin[profondeur] || null;
      const sel = document.createElement('select');
      sel.dataset.profondeur = String(profondeur);
      sel.innerHTML = '<option value="">Choisir</option>' +
        enfants.map(e => `<option value="${e.id}">${e.nom}</option>`).join('');
      sel.value = choisi ? choisi.id : '';
      sel.addEventListener('change', function(){
        const p = parseInt(this.dataset.profondeur, 10);
        const enfant = enfants.find(x => x.id === this.value) || null;
        depotChemin = depotChemin.slice(0, p);
        if (enfant) depotChemin.push(enfant);
        rendreCascadeDepot();
        resoudreCheminDepot();
      });
      zone.appendChild(sel);
      if (!choisi) break;
      courant = choisi;
      profondeur++;
    }
  }

  // Met à jour les champs cachés Niveau/Filiere (colonnes Supabase existantes,
  // exactement le mapping déjà utilisé par le payload d'insertion) et repeuple
  // la liste des matières dès que le chemin atteint une feuille.
  function resoudreCheminDepot() {
    const dernier = depotChemin[depotChemin.length - 1] || null;
    const feuille = (dernier && estFeuilleDepot(dernier)) ? dernier : null;

    // Filiere : uniquement renseignée quand le chemin traverse un noeud de type
    // 'serie' (2nd cycle général/technique) — identique à etat.filiere côté exploration.
    const noeudSerie = depotChemin.find(n => n.type === 'serie');
    const estTroncCommun = Boolean(dernier && dernier.type === 'classe-commune' && ['seconde-ti', 'seconde-ab3'].includes(dernier.id));
    document.getElementById('f_filiere').value = (!estTroncCommun && noeudSerie) ? (noeudSerie.serie || '') : '';
    document.getElementById('f_niveau').value = feuille ? (feuille.dbNiveaux?.[0] || (depotChemin[0]?.id === 'prescolaire' ? 'Préscolaire' : feuille.nom)) : '';

    const selMatiere = document.getElementById('f_matiere');
    if (!feuille) {
      selMatiere.innerHTML = '<option value="">Choisir un niveau d\'abord</option>';
      return;
    }
    const liste = matieresAvecAutres(feuille.matieres || MATIERES);
    if (liste.length === 0) {
      selMatiere.innerHTML = '<option value="">Aucune matière renseignée pour le moment</option>';
      return;
    }
    selMatiere.innerHTML = '<option value="">Choisir</option>' +
      liste.map(m => `<option value="${m.nom}">${m.nom}</option>`).join('');
  }

  rendreCascadeDepot();
  resoudreCheminDepot();

  function normaliserDoublonValeur(valeur) {
    return String(valeur == null ? '' : valeur).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  // ---- Empreinte de contenu (SHA-256) pour la détection de doublons ----
  // Convertit un ArrayBuffer en chaîne hexadécimale, pour comparer deux
  // empreintes de façon simple et lisible dans les journaux de diagnostic.
  function bufferVersHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(o => o.toString(16).padStart(2, '0')).join('');
  }

  // Calcule l'empreinte SHA-256 du contenu réel d'un fichier (File ou Blob),
  // via l'API SubtleCrypto native du navigateur (aucune dépendance externe).
  // C'est cette empreinte — et non le nom du fichier — qui sert de critère
  // décisif pour détecter un doublon : deux fichiers dont le contenu binaire
  // est strictement identique produisent toujours la même empreinte, quels
  // que soient leur nom ou les métadonnées du dépôt (titre, matière, etc.).
  async function empreinteSha256(blob) {
    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return bufferVersHex(digest);
  }

  async function rechercherDoublonDocument({ titre, niveau, filiere, matiere, categorie, genre, fichier }) {
    // DÉPÔT RAPIDE : aucune lecture/téléchargement des anciens PDF ici.
    // L'ancienne vérification SHA-256 téléchargeait potentiellement plusieurs
    // documents publiés avant même de commencer l'envoi du nouveau fichier,
    // ce qui rendait le dépôt très lent sur mobile. La détection stricte par
    // contenu reste disponible dans l'outil de doublons administrateur.
    const params = new URLSearchParams();
    params.set('select', 'id,Titre,Niveau,Filiere,Classe,"Matière","Catégorie",Genre,Auteur,Fichier_url,Publie');
    params.set('Publie', 'eq.true');
    params.set('Titre', 'eq.' + titre);
    params.set('limit', '20');

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?${params.toString()}`, {
        headers: HEADERS,
        cache: 'no-store'
      });
      if (!res.ok) return null;
      const documents = await res.json();
      if (!Array.isArray(documents) || !documents.length) return null;

      const cible = {
        niveau: normaliserDoublonValeur(niveau),
        filiere: normaliserDoublonValeur(filiere),
        matiere: normaliserDoublonValeur(matiere),
        categorie: normaliserDoublonValeur(categorie),
        genre: normaliserDoublonValeur(genre)
      };
      return documents.find(doc =>
        normaliserDoublonValeur(doc.Niveau) === cible.niveau &&
        normaliserDoublonValeur(doc.Filiere) === cible.filiere &&
        normaliserDoublonValeur(doc['Matière']) === cible.matiere &&
        normaliserDoublonValeur(doc['Catégorie']) === cible.categorie &&
        (!cible.genre || normaliserDoublonValeur(doc.Genre) === cible.genre)
      ) || null;
    } catch (e) {
      // Fail-open : le dépôt ne doit jamais être ralenti/bloqué par le contrôle.
      console.warn('[Dépôt rapide] vérification indisponible', e);
      return null;
    }
  }

  // ---------- UPLOAD R2 OPTIMISÉ POUR MOBILE / GROS PDF ----------
  // Les fichiers < 80 MiB utilisent un PUT direct. Au-dessus, le navigateur
  // utilise le multipart R2 afin qu'aucune requête unique ne dépasse la limite
  // Worker et que plusieurs morceaux puissent être envoyés en parallèle.
  const R2_MULTIPART_SEUIL = 80 * 1024 * 1024;
  const R2_MULTIPART_TAILLE_PART = 8 * 1024 * 1024;
  const R2_MULTIPART_CONCURRENCE = 3;

  function xhrUploadR2(url, blob, contentType, onProgress, signal) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let termine = false;
      let reelDemarre = false;
      let chargeReel = 0;
      let totalReel = Math.max(0, Number(blob?.size) || 0);
      let dernierPercent = 0;
      let dernierCharge = 0;
      let dernierTemps = Date.now();
      let frame = 0;
      let minuteurFallback = 0;

      const finir = (fn, valeur) => {
        if (termine) return;
        termine = true;
        if (frame && typeof cancelAnimationFrame === 'function') {
          try { cancelAnimationFrame(frame); } catch(e) {}
        }
        if (minuteurFallback) {
          try { clearInterval(minuteurFallback); } catch(e) {}
        }
        fn(valeur);
      };

      if (signal) {
        if (signal.aborted) {
          try { xhr.abort(); } catch(e) {}
          return reject(new DOMException('Upload annulé','AbortError'));
        }
        signal.addEventListener('abort', () => {
          try { xhr.abort(); } catch(e) {}
        }, {once:true});
      }

      xhr.open('PUT', url, true);
      if (contentType) xhr.setRequestHeader('Content-Type', contentType);

      const pousser = (loaded, total, force = false) => {
        if (!onProgress) return;
        const t = Number(total) > 0 ? Number(total) : totalReel;
        const l = Math.max(0, Number(loaded) || 0);
        if (t > 0) {
          chargeReel = Math.max(chargeReel, Math.min(l, t));
          const pct = Math.max(0, Math.min(99.999, (chargeReel / t) * 100));
          if (force || pct > dernierPercent) {
            dernierPercent = pct;
            onProgress(chargeReel, t);
          }
        }
      };

      const demanderFrame = () => {
        if (frame || termine || !onProgress) return;
        const render = () => {
          frame = 0;
          pousser(chargeReel, totalReel);
        };
        if (typeof requestAnimationFrame === 'function') {
          frame = requestAnimationFrame(render);
        } else {
          frame = setTimeout(render, 16);
        }
      };

      /*
       * Certains WebView Android ne publient aucun progress event pendant
       * la phase de négociation / démarrage du flux.
       *
       * Ce minuteur n'invente pas d'octets : il anime seulement l'interface
       * jusqu'au premier événement réel. Dès que XHR fournit loaded/total,
       * la progression réelle reprend automatiquement.
       *
       * On s'arrête volontairement à 90 % pour ne jamais afficher "presque
       * terminé" si le réseau est réellement bloqué.
       */
      const debut = Date.now();
      const dureeVisuelle = Math.max(
        4000,
        Math.min(30000, Math.ceil(Math.max(1, totalReel) / (512 * 1024)) * 1000)
      );

      if (onProgress && totalReel > 0) {
        minuteurFallback = setInterval(() => {
          if (termine || reelDemarre) return;
          const elapsed = Date.now() - debut;
          const ratio = Math.min(0.90, 0.90 * (1 - Math.exp(-elapsed / dureeVisuelle)));
          const visuel = totalReel * ratio;
          pousser(visuel, totalReel);
        }, 16);
      }

      const traiterProgressionUpload = e => {
        if (!Number.isFinite(e?.loaded)) return;

        const loaded = Math.max(0, Number(e.loaded) || 0);
        const total = (
          e.lengthComputable &&
          Number.isFinite(e.total) &&
          Number(e.total) > 0
        ) ? Number(e.total) : totalReel;

        if (total > 0) totalReel = total;

        reelDemarre = loaded > 0;

        if (reelDemarre && minuteurFallback) {
          try { clearInterval(minuteurFallback); } catch(ignore) {}
          minuteurFallback = 0;
        }

        /*
         * XHR upload progress est la source de vérité : loaded correspond
         * aux octets réellement transmis. On pousse immédiatement la valeur,
         * puis requestAnimationFrame maintient l'affichage fluide entre deux
         * événements réseau.
         */
        pousser(loaded, totalReel, true);

        const maintenant = Date.now();
        const dt = (maintenant - dernierTemps) / 1000;
        if (dt >= 0.05 && typeof window.auroreUploadSpeedCallback === 'function') {
          const debit = Math.max(0, (chargeReel - dernierCharge) / dt);
          if (debit > 0) window.auroreUploadSpeedCallback(debit);
          dernierTemps = maintenant;
          dernierCharge = chargeReel;
        }

        demanderFrame();
      };

      /*
       * .onprogress est mieux pris en charge par certains WebView Android
       * que addEventListener('progress').
       */
      xhr.upload.onprogress = traiterProgressionUpload;

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (minuteurFallback) {
            try { clearInterval(minuteurFallback); } catch(e) {}
            minuteurFallback = 0;
          }
          if (onProgress && totalReel > 0) onProgress(totalReel, totalReel);
          finir(resolve, {
            ok:true,
            status:xhr.status,
            text:xhr.responseText||'',
            headers:xhr.getAllResponseHeaders()||''
          });
        } else {
          finir(resolve, {
            ok:false,
            status:xhr.status,
            text:xhr.responseText||''
          });
        }
      };

      xhr.onerror = () => finir(
        reject,
        new Error('Erreur réseau pendant l’envoi du fichier.')
      );

      xhr.onabort = () => finir(
        reject,
        new DOMException('Upload annulé','AbortError')
      );

      xhr.ontimeout = () => finir(
        reject,
        new Error('Le transfert a été interrompu : connexion trop longtemps inactive.')
      );

      /*
       * CORRECTIF « envoi bloqué à 0 % » : un timeout à 0 (illimité) faisait
       * qu'une connexion qui ne démarrait jamais (DNS/CORS/réseau bloqué,
       * aucun octet envoyé, aucun événement d'erreur déclenché) laissait la
       * promesse en attente pour toujours — l'interface restait figée à 0 %
       * sans jamais afficher de message. On fixe donc un timeout fini,
       * généreux et proportionnel à la taille du morceau, pour que
       * xhr.ontimeout (déjà géré plus bas) puisse se déclencher et informer
       * clairement l'utilisateur au lieu de bloquer silencieusement.
       */
      xhr.timeout = Math.max(30000, Math.ceil((Number(blob?.size) || 0) / (40 * 1024)) * 1000);

      try {
        xhr.send(blob);
      } catch(e) {
        finir(reject, e);
      }
    });
  }


  async function creerUploadR2Multipart(url, fichier, setProgress, setEtatConnexion, setAbort, setSpeed) {
    const base = String(url).split('?')[0];
    const controller = new AbortController();
    let uploadId = null;
    let annule = false;
    if (typeof setAbort === 'function') setAbort(() => { annule = true; controller.abort(); });

    const debut = Date.now();
    const taille = fichier.size;
    const nombreParts = Math.ceil(taille / R2_MULTIPART_TAILLE_PART);
    const progression = new Array(nombreParts).fill(0);
    let totalEnvoye = 0;
    let prochain = 0;
    const parts = [];

    const actualiser = () => {
      const pct = taille ? Math.min(99.999, (totalEnvoye / taille) * 100) : 0;
      setProgress(pct);
      const secondes = Math.max(.001, (Date.now() - debut) / 1000);
      const debit = totalEnvoye / secondes;
      if (typeof setSpeed === 'function' && debit > 0) {
        const mo = debit / (1024 * 1024);
        setSpeed(mo >= 1 ? mo.toFixed(1)+' Mo/s' : Math.round(debit/1024)+' Ko/s');
      }
    };

    try {
      setEtatConnexion?.('connexion');
      const create = await fetch(base + '?action=mpu-create', {
        method:'POST',
        headers:{'Content-Type':'application/pdf'},
        signal:controller.signal,
        cache:'no-store'
      });
      const createText = await create.text();
      if (!create.ok) throw new Error('Création du transfert multipart refusée (HTTP '+create.status+'). '+createText);
      let created;
      try { created = JSON.parse(createText); } catch(e) { throw new Error('Réponse multipart invalide du Worker.'); }
      uploadId = created.uploadId;
      if (!uploadId) throw new Error('Le Worker n’a pas fourni d’identifiant multipart.');
      setEtatConnexion?.('envoi');

      async function envoyerPart() {
        while (true) {
          if (controller.signal.aborted) throw new DOMException('Upload annulé','AbortError');
          const index = prochain++;
          if (index >= nombreParts) return;
          const debutPart = index * R2_MULTIPART_TAILLE_PART;
          const finPart = Math.min(taille, debutPart + R2_MULTIPART_TAILLE_PART);
          const blob = fichier.slice(debutPart, finPart);
          const partNumber = index + 1;
          const partUrl = base + '?action=mpu-uploadpart&uploadId=' + encodeURIComponent(uploadId) + '&partNumber=' + partNumber;
          const result = await xhrUploadR2(partUrl, blob, 'application/octet-stream', (loaded,total) => {
            totalEnvoye += loaded - progression[index];
            progression[index] = loaded;
            actualiser();
          }, controller.signal);
          if (!result.ok) throw new Error('Échec du morceau '+partNumber+' (HTTP '+result.status+'). '+result.text);
          let body;
          try { body = JSON.parse(result.text || '{}'); } catch(e) { body = {}; }
          if (!body.etag) throw new Error('Le Worker n’a pas retourné l’ETag du morceau '+partNumber+'.');
          parts.push({partNumber, etag:body.etag});
        }
      }

      await Promise.all(Array.from({length:Math.min(R2_MULTIPART_CONCURRENCE,nombreParts)}, () => envoyerPart()));
      parts.sort((a,b)=>a.partNumber-b.partNumber);
      if (controller.signal.aborted) throw new DOMException('Upload annulé','AbortError');

      const complete = await fetch(base + '?action=mpu-complete&uploadId=' + encodeURIComponent(uploadId), {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({parts}),
        signal:controller.signal,
        cache:'no-store'
      });
      const completeText = await complete.text();
      if (!complete.ok) throw new Error('Finalisation du transfert refusée (HTTP '+complete.status+'). '+completeText);
      setProgress(100);
      return {ok:true,status:complete.status,text:completeText};
    } catch(e) {
      annule = annule || e?.name === 'AbortError';
      if (uploadId) {
        try { await fetch(base + '?action=mpu-abort&uploadId=' + encodeURIComponent(uploadId), {method:'POST',cache:'no-store'}); } catch(ignore) {}
      }
      if (annule) throw new DOMException('Upload annulé','AbortError');
      throw e;
    }
  }

  function creerUploadR2AvecProgress(url, fichier, setProgress, setEtatConnexion, setAbort, setSpeed) {
    if (fichier.size > R2_MULTIPART_SEUIL) {
      return creerUploadR2Multipart(url, fichier, setProgress, setEtatConnexion, setAbort, setSpeed);
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      if (typeof setAbort === 'function') setAbort(() => xhr.abort());

      xhr.open('PUT', url, true);
      xhr.setRequestHeader('Content-Type', 'application/pdf');

      const taille = Math.max(0, Number(fichier.size) || 0);
      const debut = Date.now();
      let reelDemarre = false;
      let dernierCharge = 0;
      let dernierTemps = debut;
      let dernierPct = 0;
      let timer = 0;

      const setPct = valeur => {
        const pct = Math.max(0, Math.min(99.999, Number(valeur) || 0));
        if (pct >= dernierPct) {
          dernierPct = pct;
          setProgress(pct);
        }
      };

      /*
       * Fallback visuel ultra-fin :
       * il ne prétend pas mesurer les octets. Il évite seulement que l'interface
       * reste figée à 0 lorsque Android ne fournit pas encore XHR progress.
       */
      if (taille > 0) {
        const dureeVisuelle = Math.max(
          4000,
          Math.min(30000, Math.ceil(taille / (512 * 1024)) * 1000)
        );

        timer = setInterval(() => {
          if (reelDemarre) return;
          const elapsed = Date.now() - debut;
          const ratio = Math.min(0.90, 0.90 * (1 - Math.exp(-elapsed / dureeVisuelle)));
          setPct(ratio * 100);
          setEtatConnexion?.('envoi');
        }, 16);
      }

      setEtatConnexion?.('connexion');
      setSpeed?.('Connexion…');

      xhr.upload.addEventListener('progress', e => {
        if (!Number.isFinite(e.loaded)) return;

        reelDemarre = true;
        if (timer) {
          clearInterval(timer);
          timer = 0;
        }

        const total = e.lengthComputable && Number(e.total) > 0
          ? Number(e.total)
          : taille;

        if (total > 0) {
          setPct((Number(e.loaded) / total) * 100);
        }

        setEtatConnexion?.('envoi');

        const now = Date.now();
        const dt = (now - dernierTemps) / 1000;
        if (dt >= 0.10 && typeof setSpeed === 'function') {
          const debit = Math.max(
            0,
            (Number(e.loaded) - dernierCharge) / dt
          );

          if (debit > 0) {
            const mo = debit / (1024 * 1024);
            setSpeed(
              mo >= 1
                ? mo.toFixed(1) + ' Mo/s'
                : Math.round(debit / 1024) + ' Ko/s'
            );
          }

          dernierTemps = now;
          dernierCharge = Number(e.loaded);
        }
      });

      xhr.onload = () => {
        if (timer) {
          clearInterval(timer);
          timer = 0;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          setProgress(100);

          if (typeof setSpeed === 'function') {
            const duree = Math.max(
              0.001,
              (Date.now() - debut) / 1000
            );
            const debit = taille / duree;
            const mo = debit / (1024 * 1024);
            setSpeed(
              mo >= 1
                ? mo.toFixed(1) + ' Mo/s moyen'
                : Math.round(debit / 1024) + ' Ko/s moyen'
            );
          }

          resolve({
            ok:true,
            status:xhr.status,
            text:xhr.responseText||'',
            headers:xhr.getAllResponseHeaders()||''
          });
        } else {
          resolve({
            ok:false,
            status:xhr.status,
            text:xhr.responseText||''
          });
        }
      };

      xhr.onerror = () => {
        if (timer) clearInterval(timer);
        reject(new Error('Erreur réseau pendant l’envoi du fichier.'));
      };

      xhr.onabort = () => {
        if (timer) clearInterval(timer);
        reject(new DOMException('Upload annulé','AbortError'));
      };

      xhr.ontimeout = () => {
        if (timer) clearInterval(timer);
        reject(new Error('Le transfert a été interrompu : connexion trop longtemps inactive.'));
      };

      /*
       * CORRECTIF « envoi bloqué à 0 % » : voir explication détaillée dans
       * xhrUploadR2. Un timeout illimité empêchait toute erreur de remonter
       * si la connexion ne démarrait jamais — l'utilisateur restait bloqué
       * sur « 0.00 % / Préparation… » indéfiniment, sans message.
       */
      xhr.timeout = Math.max(30000, Math.ceil(taille / (40 * 1024)) * 1000);

      try {
        xhr.send(fichier);
      } catch(e) {
        if (timer) clearInterval(timer);
        reject(e);
      }
    });
  }


  document.getElementById('depotForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const btn = document.getElementById('f_submit');
    const msg = document.getElementById('f_msg');
    const debugBox = document.getElementById('depotDebug');
    const debugLog = document.getElementById('depotDebugLog');
    const progressBox = document.getElementById('depotProgress');
    const progressBar = document.getElementById('depotProgressBar');
    const progressPercent = document.getElementById('depotProgressPercent');
    const progressSpeed = document.getElementById('depotProgressSpeed');
    const progressTrack = progressBox ? progressBox.querySelector('[role=progressbar]') : null;
    const progressCancel = document.getElementById('depotProgressCancel');
    let annulationDemandee = false;
    let abortUpload = null;
    msg.className = 'form-msg'; msg.style.display = '';
    // Journal technique : réservé à l'administrateur (diagnostic), jamais montré
    // à un utilisateur normal. Les étapes restent tout de même tracées dans la
    // console navigateur via etape() pour le débogage si nécessaire.
    const estAdmin = !!(session && session.role === 'admin');
    debugBox.style.display = estAdmin ? 'block' : 'none';
    debugLog.innerHTML = '';

    function etape(texte, type) {
      const line = document.createElement('div');
      line.textContent = '• ' + texte;
      if (type === 'err') line.style.color = '#ff6b6b';
      if (type === 'ok') line.style.color = '#8fe3a8';
      debugLog.appendChild(line);
      console.log('[Dépôt Auraster]', texte);
    }

    const progressLabel = document.getElementById('depotProgressLabel');

    function afficherBoutonAnnulation(visible) {
      if (!progressCancel) return;
      progressCancel.style.display = visible ? 'inline-flex' : 'none';
      progressCancel.disabled = false;
    }

    function annulerEnvoi() {
      if (annulationDemandee) return;
      annulationDemandee = true;
      if (progressCancel) {
        progressCancel.disabled = true;
        progressCancel.innerHTML = '<span aria-hidden="true">×</span> Annulation…';
      }
      if (progressLabel) progressLabel.textContent = 'Annulation de l’envoi…';
      if (abortUpload) abortUpload();
    }

    progressCancel?.addEventListener('click', annulerEnvoi);

    function afficherProgression(valeur) {
      // Mise à jour très fine : on ne force plus la progression à un entier.
      // Le navigateur peut ainsi refléter les petits changements d'octets
      // immédiatement, sans attendre le passage au pourcentage suivant.
      const pct = Math.max(0, Math.min(100, Number(valeur) || 0));
      progressBox.classList.add('active');
      progressBox.setAttribute('aria-hidden', 'false');
      progressBar.style.width = pct.toFixed(2) + '%';
      progressPercent.textContent = pct >= 99.995 ? '100 %' : pct.toFixed(2) + ' %';
      if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(pct));
    }

    // Reflète l'état réel de la connexion pendant l'envoi, pour que
    // l'utilisateur comprenne pourquoi la barre ne bouge pas encore
    // (négociation avec le serveur avant que les octets ne partent) au lieu
    // de croire que le dépôt est bloqué.
    function afficherEtatConnexion(etat) {
      if (!progressLabel) return;
      if (etat === 'connexion') progressLabel.textContent = 'Connexion au serveur…';
      else if (etat === 'indetermine') progressLabel.textContent = 'Envoi en cours (durée non estimable)…';
      else if (etat === 'envoi') progressLabel.textContent = 'Envoi du document…';
    }

    function masquerProgression() {
      progressBox.classList.remove('active');
      progressBox.setAttribute('aria-hidden', 'true');
      progressBar.style.width = '0%';
      progressPercent.textContent = '0 %';
      if (progressTrack) progressTrack.setAttribute('aria-valuenow', '0');
      if (progressSpeed) progressSpeed.textContent = 'Préparation…';
      if (progressLabel) progressLabel.textContent = 'Envoi du document…';
      afficherBoutonAnnulation(false);
      if (progressCancel) progressCancel.innerHTML = '<span aria-hidden="true">×</span> Annuler l’envoi';
      annulationDemandee = false;
      abortUpload = null;
    }

    function echouer(texte) {
      msg.textContent = texte;
      msg.className = 'form-msg err';
      msg.style.display = '';
      etape(texte, 'err');
      masquerProgression();
      btn.disabled = false; btn.textContent = "Envoyer le document";
    }

    etape('Lecture des champs du formulaire…');
    const titre = document.getElementById('f_titre').value.trim();
    const niveau = document.getElementById('f_niveau').value;
    const categorie = document.getElementById('f_categorie').value;
    const filiere = document.getElementById('f_filiere').value;
    const matiere = document.getElementById('f_matiere').value;
    const genre = document.getElementById('f_genre').value;
    const auteur = document.getElementById('f_auteur').value.trim();
    const source = document.getElementById('f_source').value.trim();
    const certifieDroits = document.getElementById('f_certif_droits').checked;
    const fichier = document.getElementById('f_fichier').files[0];
    const estLivre = categorie === 'Livres';

    // ---- Validation manuelle (indépendante du navigateur) ----
    if (!titre) return echouer("Veuillez renseigner le titre du document.");
    if (!categorie) return echouer("Veuillez choisir une catégorie.");
    if (!auteur) return echouer("Merci d'indiquer votre nom.");
    if (estLivre && !genre) return echouer("Veuillez choisir un genre pour ce livre.");
    if (!estLivre && !niveau) return echouer("Veuillez sélectionner le niveau jusqu’à la dernière étape proposée.");
    if (!estLivre && !matiere) return echouer("Veuillez sélectionner une matière.");
    // Une filière/série est obligatoire uniquement lorsqu'elle existe réellement
    // dans le parcours choisi. Les troncs communs (Seconde TI et Seconde AB3)
    // sont des feuilles autonomes : ils ne doivent JAMAIS demander une série.
    // On teste explicitement le dernier noeud sélectionné afin d'éviter qu'un
    // état ancien/stale du formulaire puisse déclencher à tort la validation.
    const dernierNoeudDepot = depotChemin[depotChemin.length - 1] || null;
    const estTroncCommunDepot = Boolean(
      dernierNoeudDepot &&
      dernierNoeudDepot.type === 'classe-commune' &&
      ['seconde-ti', 'seconde-ab3'].includes(dernierNoeudDepot.id)
    );
    const filiereAttendue = !estLivre && !estTroncCommunDepot && Boolean(depotChemin.find(n => n.type === 'serie'));
    if (estTroncCommunDepot) {
      // Garantit qu'aucune ancienne valeur de série ne puisse partir vers Supabase.
      document.getElementById('f_filiere').value = '';
      etape('Tronc commun détecté (' + dernierNoeudDepot.nom + ') : aucune série n’est requise.', 'ok');
    }
    if (filiereAttendue && !filiere) return echouer("Veuillez sélectionner la série du second cycle.");
    if (!fichier) return echouer("Veuillez sélectionner un fichier PDF.");
    if (fichier.type !== 'application/pdf') return echouer("Le fichier doit être un PDF (type détecté : " + (fichier.type || 'inconnu') + ").");
    if (fichier.size > 200 * 1024 * 1024) return echouer("Le fichier dépasse 200 Mo.");
    if (!certifieDroits) return echouer("Veuillez confirmer la certification de vos droits avant d’envoyer le document.");

    etape('Champs valides : ' + JSON.stringify({titre, niveau, filiere, categorie, matiere, genre, auteur, source, certifieDroits, fichier: fichier.name}), 'ok');

    // Bloque immédiatement les doubles soumissions pendant la vérification puis l'envoi.
    btn.disabled = true; btn.textContent = "Vérification en cours…";

    // ---- Vérification anti-doublon AVANT tout upload ----
    etape('Vérification d’un éventuel document déjà enregistré…');
    let doublon = null;
    try {
      doublon = await rechercherDoublonDocument({ titre, niveau, filiere, matiere, categorie, genre, fichier });
    } catch (doublonErr) {
      // Fail-open : un souci technique sur la vérification elle-même (réseau,
      // policy, etc.) ne doit jamais bloquer un dépôt légitime. Seul un VRAI
      // doublon détecté doit bloquer l'envoi (voir plus bas).
      etape('Vérification anti-doublon indisponible (' + doublonErr.message + ') — le dépôt continue normalement.', 'err');
    }
    if (doublon) {
      return echouer(`Doublon détecté : ce fichier est déjà présent dans ${SITE_NOM} (contenu strictement identique à un document existant). Aucun nouveau dépôt n'a été créé. Vérifiez les documents existants avant de réessayer.`);
    }
    etape('Aucun doublon détecté : l’envoi peut commencer.', 'ok');

    btn.textContent = "Envoi en cours…";

    // ---- 1. Upload du PDF vers Cloudflare R2 via le Worker "lsnb-pdf-worker-v2" ----
    afficherProgression(0);
    afficherEtatConnexion('connexion');
    afficherBoutonAnnulation(true);
    const nomFichier = Date.now() + '_' + fichier.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    etape('Étape 1/5 — Envoi du fichier au Worker Cloudflare (bucket R2 "lsnb-documents"), fichier : ' + nomFichier);

    let uploadRes;
    try {
      uploadRes = await creerUploadR2AvecProgress(`${R2_WORKER_URL}/${nomFichier}`, fichier, afficherProgression, afficherEtatConnexion, fn => { abortUpload = fn; }, vitesse => { if (progressSpeed) progressSpeed.textContent = vitesse; });
    } catch (netErr) {
      if (annulationDemandee) {
        masquerProgression();
        msg.textContent = 'Envoi annulé. Aucun document n’a été enregistré.';
        msg.className = 'form-msg';
        btn.disabled = false; btn.textContent = "Envoyer le document";
        etape('Envoi annulé par l’utilisateur.', 'ok');
        return;
      }
      return echouer(netErr && netErr.message ? netErr.message : "Le transfert du fichier n’a pas pu démarrer. Vérifiez votre connexion puis réessayez.");
    }
    afficherBoutonAnnulation(false);
    abortUpload = null;

    const uploadText = uploadRes.text || '';
    if (!uploadRes.ok) {
      etape('Étape 2/5 — Envoi refusé par le Worker. Statut ' + uploadRes.status + '. Réponse : ' + uploadText, 'err');
      if (uploadRes.status === 415) {
        return echouer("Le Worker a refusé le fichier : seuls les PDF sont acceptés.");
      }
      if (uploadRes.status === 413) {
        return echouer("Le Worker a refusé le fichier : il dépasse la taille maximale acceptée côté serveur (Cloudflare Worker/R2). Si tu viens d'augmenter la limite à 200 Mo, vérifie que la configuration du Worker a bien été mise à jour côté Cloudflare, car cette limite serveur est indépendante de ce fichier index.html.");
      }
      return echouer("Le fichier n’a pas pu être envoyé vers le stockage. Veuillez réessayer dans quelques instants.");
    }
    etape('Étape 2/5 — Envoi au Worker réussi. Statut ' + uploadRes.status, 'ok');
    // ---- 3. URL publique (lecture directe depuis R2) ----
    const fichierUrl = `${R2_PUBLIC_URL}/${nomFichier}`;
    etape('Étape 3/5 — URL publique générée : ' + fichierUrl);

    // ---- Vérification finale avant envoi à Supabase : Niveau et Matière ne
    // doivent jamais être vides pour un Devoir ou un Document (la catégorie
    // Livres reste volontairement sans Niveau/Matière — non concernée ici).
    if (!estLivre && (!niveau || !niveau.trim())) {
      return echouer("Le niveau est manquant : impossible d'enregistrer ce document sans niveau. Merci de le sélectionner à nouveau.");
    }
    if (!estLivre && (!matiere || !matiere.trim())) {
      return echouer("La matière est manquante : impossible d'enregistrer ce document sans matière. Merci de la sélectionner à nouveau.");
    }

    // ---- 4. Insertion dans la table Document ----
    // CORRECTIF DÉPÔT ÉLÈVE (v2) : "Document.id" est un "bigint GENERATED ...
    // AS IDENTITY" (séquence "Document_id_seq") — Postgres/PostgREST refusent
    // qu'un client fournisse lui-même cette valeur (elle est calculée
    // uniquement au moment de l'INSERT, côté serveur). La v1 de ce correctif
    // (génération d'un UUID côté client) était donc incompatible avec ce type
    // de colonne et est abandonnée.
    // Le vrai problème reste le même qu'avant : la policy SELECT sur
    // "Document" n'autorise la lecture que des documents publiés, alors que
    // tout "RETURNING" déclenché par un INSERT (via "Prefer:
    // return=representation" OU "return=headers-only", qui reposent tous les
    // deux sur le même mécanisme RETURNING) est filtré par cette policy
    // SELECT — d'où le "403 / 42501" pour un document créé avec Publie=false.
    // Comme l'id est généré par la séquence côté serveur, aucune astuce
    // purement côté navigateur ne peut le connaître à l'avance : il faut une
    // lecture RETURNING qui échappe à la policy SELECT de l'élève.
    // La ligne n'est donc plus insérée par un POST direct sur
    // "/rest/v1/Document", mais via l'appel RPC "deposer_document_eleve" (voir
    // fonction SQL fournie séparément) : une fonction Postgres SECURITY
    // DEFINER, appartenant à un rôle propriétaire de la table (donc non
    // soumis à la RLS de "Document" par défaut, sans FORCE ROW LEVEL
    // SECURITY), qui exécute l'INSERT ... RETURNING "id" en interne et ne
    // renvoie que ce seul entier au client. Elle force elle-même Publie=false
    // et n'accepte d'être exécutée que par le rôle "authenticated" — aucune
    // policy RLS existante n'est modifiée, et l'élève ne gagne aucun accès en
    // lecture sur "Document" (il ne reçoit toujours qu'un entier, jamais la
    // ligne elle-même).
    const ligne = {
      Titre: titre,
      // Document.Niveau est NOT NULL en base : pour un livre (pas de niveau
      // scolaire pertinent), on renseigne une valeur dédiée plutôt que null,
      // pour satisfaire la contrainte sans affecter Devoirs/Documents.
      Niveau: estLivre ? 'Livres' : niveau,
      Classe: null,
      Filiere: (!estLivre && ['Seconde','Première','Terminale'].includes(niveau)) ? filiere : null,
      "Matière": estLivre ? null : matiere,
      "Catégorie": categorie,
      Auteur: auteur,
      Fichier_url: fichierUrl,
      Publie: false,
      // Colonnes ajoutées par la migration SQL fournie à l'utilisateur (voir
      // ALTER TABLE ... ADD COLUMN IF NOT EXISTS "Source"/"Droits_confirmes").
      // Nullable côté base : les anciens documents déposés avant cette migration
      // restent valides avec Source=null / Droits_confirmes=null, aucune
      // rétro-compatibilité à gérer côté lecture/affichage.
      Source: source || null,
      Droits_confirmes: certifieDroits
    };
    // La colonne dédiée "Genre" doit être ajoutée à la table Document via :
    //   ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "Genre" text;
    // Tant que cette migration n'a pas été exécutée côté Supabase, on n'envoie
    // la clé "Genre" QUE pour un livre (jamais pour Devoirs/Documents), afin que
    // ces deux catégories restent fonctionnelles même si la colonne n'existe pas
    // encore. Seul le dépôt d'un livre échouera proprement dans ce cas, avec un
    // message d'erreur explicite plutôt qu'une casse silencieuse.
    if (estLivre) ligne.Genre = genre;

    etape('Étape 4/5 — Insertion dans la table Document : ' + JSON.stringify(ligne));

    console.log("[AUTH DIAG]", {
      hasSession: !!session,
      email: session?.email,
      accessTokenLength: session?.access_token?.length,
      expiresAt: session?.expires_at,
      now: Date.now(),
      role: session?.role
    });

    // --- DIAGNOSTIC JWT (lecture seule, aucun affichage du token) ---
    function decoderPayloadJWT(token) {
      try {
        const partie = token.split('.')[1];
        const b64 = partie.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(b64));
      } catch (e) {
        return null;
      }
    }
    const payloadJWT = session?.access_token ? decoderPayloadJWT(session.access_token) : null;
    const jwtDiag = {
      hasAccessToken: !!session?.access_token,
      sessionEmail: session?.email,
      sessionRole: session?.role,
      jwtRole: payloadJWT?.role,
      jwtAud: payloadJWT?.aud,
      jwtExp: payloadJWT?.exp,
      jwtExpDate: payloadJWT?.exp ? new Date(payloadJWT.exp * 1000).toISOString() : null,
      isExpired: payloadJWT?.exp ? (Date.now() > payloadJWT.exp * 1000) : null
    };
    console.log("[JWT DIAG]", jwtDiag);
    etape('[JWT DIAG] ' + JSON.stringify(jwtDiag));
    // --- FIN DIAGNOSTIC JWT ---

    // S'assurer que le token n'est pas expiré juste avant l'insertion,
    // plutôt qu'au seul chargement de la page (cause identifiée du refus RLS
    // pour les utilisateurs connectés depuis un moment). Rafraîchissement
    // désormais inconditionnel (dès qu'un refresh_token est disponible),
    // plutôt que basé sur une marge fixe de 30 s : la vérification anti-
    // doublon et l'envoi du fichier (jusqu'à 200 Mo) peuvent à eux deux
    // prendre largement plus de temps que cette marge pour un compte élève
    // avec un gros fichier ou une connexion lente — c'est ce délai
    // supplémentaire, absent de l'ancien parcours de dépôt, qui laissait le
    // jeton expirer avant l'insertion et provoquait le refus RLS 403/42501
    // sur "Document" pour ces comptes alors que les tests administrateur
    // (fichiers plus petits, dépôt plus rapide) ne rencontraient pas la
    // fenêtre d'expiration.
    if (session && session.refresh_token) {
      const ok = await rafraichirSession();
      if (!ok && session && session.expires_at && Date.now() > session.expires_at - 30000) {
        session = null;
        sauvegarderSession();
        afficherUtilisateurConnecte();
        return echouer("Ta session a expiré. Reconnecte-toi avec Google puis réessaie de déposer.");
      }
    }
    // Vérification supplémentaire, en direct auprès de Supabase Auth : le
    // expires_at stocké côté client peut être imprécis (session restaurée
    // depuis sessionStorage, horloge locale, etc.) et laisser passer un
    // access_token que le serveur rejette déjà — cause identifiée du "403 —
    // new row violates row-level security policy" observé pour un compte
    // élève alors que le token semblait encore valide localement. On vérifie
    // donc réellement le token avant de l'utiliser pour l'INSERT, et on force
    // un rafraîchissement s'il est refusé, avant de l'utiliser dans les
    // en-têtes envoyés à Supabase.
    if (session && session.access_token) {
      // CORRECTIF : cet appel n'était pas protégé par try/catch. Un simple
      // incident réseau transitoire ici (après un upload potentiellement long)
      // faisait planter silencieusement toute la fonction de soumission :
      // aucune exception affichée, aucun message de succès ni d'erreur, le
      // bouton restant bloqué sur "Envoi en cours…" alors que le fichier était
      // déjà bien envoyé à 100 % vers R2 et que l'insertion Supabase, plus
      // bas, n'était jamais atteinte. On échoue désormais "ouvert" : un souci
      // purement réseau sur cette vérification proactive ne doit pas annuler
      // un dépôt par ailleurs valide — un vrai refus RLS sera de toute façon
      // détecté et traité par la nouvelle tentative après rafraîchissement,
      // plus bas, au moment de l'insertion réelle.
      let verif;
      try {
        verif = await recupererUtilisateur(session.access_token);
      } catch (verifErr) {
        etape('[DIAG] Vérification proactive du token impossible (' + verifErr.message + ') — le dépôt continue normalement.', 'err');
        verif = 'reseau-indisponible';
      }
      if (verif === null) {
        etape('Le token semblait valide localement mais a été refusé par Supabase Auth : nouvelle tentative de rafraîchissement.', 'err');
        const ok = await rafraichirSession();
        if (!ok) {
          session = null;
          sauvegarderSession();
          afficherUtilisateurConnecte();
          return echouer("Ta session a expiré. Reconnecte-toi avec Google puis réessaie de déposer.");
        }
      }
    }

    // --- DIAGNOSTIC TEMPORAIRE (fonction RPC "diagnostic_auth" créée côté
    // Supabase pour ce diagnostic — à retirer une fois l'investigation
    // terminée). Appelée avec les mêmes en-têtes que ceux qui seront utilisés
    // juste après pour l'INSERT (headersAdmin(), donc le jeton de la session
    // actuelle), afin de voir ce que Supabase reçoit réellement côté serveur
    // (auth.uid(), auth.role(), e-mail du JWT, aud) — à comparer avec
    // [JWT DIAG] ci-dessus. Purement informatif : un échec ici n'interrompt
    // jamais le dépôt, et rien d'autre n'est modifié (ni le payload, ni les
    // policies RLS).
    try {
      const diagRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/diagnostic_auth`, {
        method: 'POST',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
        body: '{}'
      });
      const diagText = await diagRes.text().catch(() => '');
      etape('[SUPABASE AUTH DIAG] ' + JSON.stringify({ status: diagRes.status, ok: diagRes.ok, body: diagText }), diagRes.ok ? 'ok' : 'err');
    } catch (diagErr) {
      etape('[SUPABASE AUTH DIAG] Appel impossible : ' + diagErr.message, 'err');
    }
    // --- FIN DIAGNOSTIC TEMPORAIRE ---

    // --- DIAGNOSTIC TEMPORAIRE (fonction RPC "diagnostic_insert_document"
    // créée côté Supabase pour ce diagnostic — à retirer une fois
    // l'investigation terminée). Appelée UNE SEULE FOIS, juste après
    // diagnostic_auth() et avant le véritable INSERT ci-dessous, avec
    // exactement les mêmes en-têtes (headersAdmin(), donc le jeton de la
    // session actuelle). Cet appel ne touche jamais "Document" directement :
    // c'est la fonction RPC elle-même, côté Supabase, qui est responsable de
    // simuler/vérifier l'insertion sans effet de bord réel. Purement
    // informatif : un échec ici n'interrompt jamais le dépôt, et rien d'autre
    // n'est modifié (ni le payload réel plus bas, ni les policies RLS).
    try {
      const diagInsertRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/diagnostic_insert_document`, {
        method: 'POST',
        headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
        body: '{}'
      });
      const diagInsertText = await diagInsertRes.text().catch(() => '');
      etape('[SUPABASE INSERT DIAG] ' + JSON.stringify({ status: diagInsertRes.status, ok: diagInsertRes.ok, body: diagInsertText }), diagInsertRes.ok ? 'ok' : 'err');
    } catch (diagInsertErr) {
      etape('[SUPABASE INSERT DIAG] Appel impossible : ' + diagInsertErr.message, 'err');
    }
    // --- FIN DIAGNOSTIC TEMPORAIRE ---

    // --- DIAGNOSTIC TEMPORAIRE (même RPC "diagnostic_insert_document", mise à
    // jour côté Supabase pour renvoyer en plus current_user, session_user,
    // auth_uid, auth_role, jwt_role, jwt_sub — à retirer une fois
    // l'investigation terminée). Appelée UNE SEULE FOIS, uniquement pour un
    // compte élève (jamais pour l'administrateur), avec les mêmes en-têtes
    // (headersAdmin(), donc le jeton de la session actuelle). Ne touche
    // jamais "Document" directement. Purement informatif : un échec ici
    // n'interrompt jamais le dépôt, et rien d'autre n'est modifié (ni le
    // payload réel, ni les policies RLS, ni aucune autre fonctionnalité).
    if (!estAdmin) {
      try {
        const diagInsertRes2 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/diagnostic_insert_document`, {
          method: 'POST',
          headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
          body: '{}'
        });
        const diagInsertText2 = await diagInsertRes2.text().catch(() => '');
        etape('[SUPABASE INSERT DIAG 2] ' + JSON.stringify({ status: diagInsertRes2.status, ok: diagInsertRes2.ok, body: diagInsertText2 }), diagInsertRes2.ok ? 'ok' : 'err');
      } catch (diagInsertErr2) {
        etape('[SUPABASE INSERT DIAG 2] Appel impossible : ' + diagInsertErr2.message, 'err');
      }
    }
    // --- FIN DIAGNOSTIC TEMPORAIRE ---

    // --- DIAGNOSTIC TEMPORAIRE (RPC "diagnostic_rls_check" — à retirer une
    // fois l'investigation terminée). Appelée UNE SEULE FOIS, uniquement pour
    // un compte élève (jamais pour l'administrateur), avec les mêmes en-têtes
    // (headersAdmin(), donc le jeton de la session actuelle). Ne touche
    // jamais "Document" directement. Purement informatif : un échec ici
    // n'interrompt jamais le dépôt, et rien d'autre n'est modifié (ni le
    // site, ni la base, ni les policies RLS).
    if (!estAdmin) {
      try {
        const rlsCheckRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/diagnostic_rls_check`, {
          method: 'POST',
          headers: { ...headersAdmin(), 'Content-Type': 'application/json' },
          body: '{}'
        });
        const rlsCheckText = await rlsCheckRes.text().catch(() => '');
        etape('[RLS CHECK] ' + JSON.stringify({ status: rlsCheckRes.status, ok: rlsCheckRes.ok, body: rlsCheckText }), rlsCheckRes.ok ? 'ok' : 'err');
      } catch (rlsCheckErr) {
        etape('[RLS CHECK] Appel impossible : ' + rlsCheckErr.message, 'err');
      }
    }
    // --- FIN DIAGNOSTIC TEMPORAIRE ---

    // --- DIAGNOSTIC TEMPORAIRE : détail de la requête POST (jamais de token/clé affiché) ---
    // Appel RPC (et non plus POST direct sur "/rest/v1/Document") : voir le
    // commentaire au-dessus de "const ligne". La fonction SQL
    // "deposer_document_eleve(payload jsonb)" attend l'objet "ligne" tel
    // quel sous la clé "payload" et renvoie uniquement l'id ("bigint") du
    // document créé.
    const insertUrl = `${SUPABASE_URL}/rest/v1/rpc/deposer_document_eleve`;
    // Pas de "Prefer: return=minimal" ici : contrairement à un POST direct
    // sur la table, cet appel RPC ne renvoie jamais la ligne "Document"
    // elle-même (donc aucun conflit possible avec la policy SELECT) — il
    // renvoie uniquement le scalaire "id" retourné par la fonction SQL, qui
    // est précisément la valeur dont on a besoin pour "Depots_deposants".
    // Mettre "return=minimal" supprimerait ce corps de réponse.
    const insertHeaders = { ...headersAdmin(), 'Content-Type': 'application/json' };
    const insertBody = JSON.stringify({ payload: ligne });
    etape('[REQ DIAG] ' + JSON.stringify({
      url: insertUrl,
      method: 'POST',
      hasAuthorizationHeader: !!insertHeaders['Authorization'],
      hasApikeyHeader: !!insertHeaders['apikey'],
      contentType: insertHeaders['Content-Type'],
      prefer: insertHeaders['Prefer'],
      body: insertBody
    }));
    // --- FIN DIAGNOSTIC TEMPORAIRE ---

    let insertRes;
    try {
      insertRes = await fetch(insertUrl, {
        method: 'POST',
        headers: insertHeaders,
        body: insertBody
      });
    } catch (netErr) {
      // --- DIAGNOSTIC TEMPORAIRE : distinguer CORS / réseau réel / hors-ligne ---
      etape('[DIAG] Type d\'erreur JS : ' + netErr.name + ' — ' + netErr.message, 'err');
      etape('[DIAG] navigator.onLine : ' + navigator.onLine, 'err');
      try {
        // Requête GET sans effet de bord, mode no-cors : si elle part sans exception,
        // le réseau atteint le serveur et le blocage vient du CORS ou des en-têtes.
        await fetch(`${SUPABASE_URL}/rest/v1/`, { method: 'GET', mode: 'no-cors' });
        etape('[DIAG] Sonde no-cors envoyée sans exception → le serveur est joignable, le blocage est probablement lié au CORS ou aux en-têtes apikey/Authorization.', 'err');
      } catch (sondeErr) {
        etape('[DIAG] Sonde no-cors également en échec (' + sondeErr.message + ') → panne réseau réelle, DNS, hors-ligne, ou domaine supabase.co bloqué (pare-feu / extension / connexion).', 'err');
      }
      // --- FIN DIAGNOSTIC TEMPORAIRE ---
      return echouer("L’enregistrement du document n’a pas pu être finalisé. Vérifiez votre connexion puis réessayez.");
    }

    let insertText = await insertRes.text().catch(() => '');

    // Repli de sécurité : la vérification anti-doublon puis l'upload du fichier
    // (jusqu'à 200 Mo) peuvent désormais prendre assez de temps pour que le
    // jeton, valide au moment du clic, devienne périmé pile avant l'insertion —
    // malgré la vérification d'expiration déjà faite plus haut (marge fixe de
    // 30 s, qui peut ne pas suffire sur une connexion lente). Si Supabase refuse
    // précisément avec le code RLS 42501, on tente UNE SEULE fois un
    // rafraîchissement de session puis on rejoue l'insertion avec le nouveau
    // jeton. Aucune policy n'est contournée : si le refus persiste avec un
    // jeton frais, c'est un vrai refus RLS et il est affiché tel quel plus bas.
    if (!insertRes.ok && insertRes.status === 403 && /42501/.test(insertText)) {
      // Fait apparaître exactement le même tableau de diagnostic que celui de
      // l'administration (même structure HTML #depotDebug/#depotDebugLog, même
      // style, même emplacement) pour un compte élève, mais uniquement lorsque
      // ce refus RLS précis ("403 / 42501" sur "Document") survient — jamais
      // affiché en temps normal pour un élève. Le journal (etape()) est de
      // toute façon déjà rempli depuis le début de la soumission ; on ne fait
      // ici que rendre la boîte visible, sans dupliquer ni recréer de tableau.
      if (!estAdmin) debugBox.style.display = 'block';
      etape('[DIAG] Refus RLS 403/42501 à l\'insertion — tentative de rafraîchissement du jeton puis une seule nouvelle tentative.', 'err');
      const rafraichi = await rafraichirSession();
      if (rafraichi) {
        const insertHeaders2 = { ...headersAdmin(), 'Content-Type': 'application/json' };
        try {
          const insertRes2 = await fetch(insertUrl, { method: 'POST', headers: insertHeaders2, body: insertBody });
          const insertText2 = await insertRes2.text().catch(() => '');
          etape('[DIAG] Nouvelle tentative après rafraîchissement — statut ' + insertRes2.status, insertRes2.ok ? 'ok' : 'err');
          insertRes = insertRes2;
          insertText = insertText2;
        } catch (retryErr) {
          etape('[DIAG] Échec réseau lors de la nouvelle tentative : ' + retryErr.message, 'err');
        }
      } else {
        etape('[DIAG] Rafraîchissement de session impossible (jeton de renouvellement absent ou expiré).', 'err');
      }
    }

    // --- DIAGNOSTIC TEMPORAIRE : détail complet de la réponse (jamais de token/clé) ---
    etape('[RES DIAG] ' + JSON.stringify({
      status: insertRes.status,
      statusText: insertRes.statusText,
      ok: insertRes.ok,
      body: insertText
    }));
    // --- FIN DIAGNOSTIC TEMPORAIRE ---

    if (!insertRes.ok) {
      etape('Étape 5/5 — Insertion échouée. Statut ' + insertRes.status + '. Réponse exacte : ' + insertText, 'err');
      return echouer("Le document n’a pas pu être enregistré pour le moment. Veuillez réessayer.");
    }

    etape('Étape 5/5 — Insertion réussie. Réponse : ' + insertText, 'ok');

    // La fonction SQL "deposer_document_eleve" renvoie uniquement le
    // scalaire "id" (bigint) du document créé — pas la ligne complète, donc
    // aucune lecture RLS-sensible n'a lieu ici. PostgREST renvoie un
    // scalaire nu (ex. "42"), d'où le parsing via Number(...) plutôt qu'un
    // JSON.parse suivi d'un accès de type "[0].id".
    const nouveauDocId = insertText && insertText.trim() !== '' ? Number(insertText.trim()) : null;
    if (Number.isFinite(nouveauDocId)) {
      // Conserve immédiatement une copie minimale côté compte. Ce cache ne
      // remplace pas Supabase : il garantit seulement que le dépôt reste
      // visible dans l'espace personnel si la lecture de Depots_deposants est
      // refusée par la RLS.
      memoriserDepotPersonnelLocal({
        id:nouveauDocId,Titre:titre,Auteur:auteur,Fichier_url:fichierUrl,
        Niveau:estLivre?'Livres':niveau,Filiere:(!estLivre&&['Seconde','Première','Terminale'].includes(niveau))?filiere:'',
        "Matière":estLivre?'':matiere,"Catégorie":categorie,Genre:estLivre?genre:'',Publie:false
      });
    }
    if (!Number.isFinite(nouveauDocId)) {
      etape('[DIAG] Réponse RPC inattendue — impossible d\'extraire l\'id du document créé : ' + insertText, 'err');
    }

    // ---- Enregistrement de l'identité du déposant (compte authentifié) ----
    // Dans une table séparée de "Document" (jamais lue par le public, RLS
    // réservée à l'administrateur — voir schéma fourni), pour ne jamais exposer
    // le nom/e-mail réel du compte via les lectures publiques déjà en place sur
    // les documents publiés. Purement informatif pour l'admin : un échec ici
    // n'annule jamais le dépôt, qui a déjà réussi juste au-dessus.
    try {
      if (nouveauDocId && session && session.id) {
        const resDeposant = await fetch(`${SUPABASE_URL}/rest/v1/Depots_deposants`, {
          method: 'POST',
          headers: { ...headersAdmin(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ document_id: nouveauDocId, user_id: session.id, nom: session.nom || null, email: session.email || null })
        });
        if (!resDeposant.ok) {
          const detail = await resDeposant.text().catch(() => '');
          console.warn('[Depots_deposants] enregistrement du déposant échoué (le dépôt reste valide) :', resDeposant.status, detail);
        }
      }
    } catch (eDeposant) {
      console.warn('[Depots_deposants] erreur réseau lors de l\'enregistrement du déposant (le dépôt reste valide) :', eDeposant);
    }

    // Le journal technique a rempli son rôle (diagnostic) : on le masque en cas de
    // succès pour que le message de remerciement soit net et immédiatement visible,
    // sans wall of text vert en dessous. En cas d'erreur (voir echouer()), le
    // journal reste affiché pour le débogage.
    debugBox.style.display = 'none';

    // Rafraîchit « Mes documents » avec le dépôt qui vient d'être enregistré,
    // sans toucher au chargeur lui-même : chargerDonneesEspacePersonnel()
    // n'était auparavant appelée qu'au clic sur « Actualiser » ou à
    // l'ouverture de l'espace personnel, donc un dépôt effectué pendant que
    // cet écran était déjà ouvert n'y apparaissait pas immédiatement.
    if (typeof session !== 'undefined' && session && session.id) {
      try { chargerDonneesEspacePersonnel(); } catch (eRefresh) { console.warn('[Dépôt] rafraîchissement espace personnel:', eRefresh); }
    }

    msg.innerHTML = "<strong>✅ Document bien reçu — merci !</strong><br>" +
      "Votre document a été enregistré avec succès et est désormais <strong>en attente de validation</strong> par l'administration. " +
      "Vous serez informé(e) dès qu'il sera validé et publié. " +
      `Merci sincèrement pour votre contribution à ${SITE_NOM} !`;
    msg.className = 'form-msg ok';
    msg.style.display = 'block';
    masquerProgression();
    msg.setAttribute('role', 'status');
    msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.reset();
    depotChemin = [];
    rendreCascadeDepot();
    resoudreCheminDepot();
    document.getElementById('f_genre_wrap').style.display = 'none';
    document.getElementById('f_cascade_wrap').style.display = 'block';
    document.getElementById('f_matiere_wrap').style.display = 'block';
    btn.disabled = false; btn.textContent = "Envoyer le document";
  });

