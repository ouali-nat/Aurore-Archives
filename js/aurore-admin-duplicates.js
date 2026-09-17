  // ---------- DÉTECTION DES DOUBLONS PUBLIÉS ----------
  // Analyse volontairement déclenchée par l'administrateur. Les documents sont
  // comparés par SHA-256 du contenu réel. Aucun document n'est supprimé pendant
  // l'analyse.
  const adminDuplicateHashCache = new Map();

  async function recupererDocumentPubliesPourDoublons() {
    const params = new URLSearchParams();
    params.set('select','id,Titre,Niveau,Filiere,Classe,"Matière","Catégorie",Genre,Auteur,Fichier_url,Publie');
    params.set('Publie','eq.true');
    params.set('order','id.desc');
    params.set('limit','5000');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/Document?${params.toString()}`, {headers: headersAdmin(), cache:'no-store'});
    if(!res.ok){
      const detail=await res.text().catch(()=> '');
      throw new Error('Lecture des documents publiés impossible (HTTP '+res.status+'). '+detail);
    }
    return await res.json();
  }

  async function tailleEtHashDocumentDoublon(doc){
    if(!doc || !doc.Fichier_url) return {taille:0,hash:null};
    const cacheKey=String(doc.Fichier_url);
    if(adminDuplicateHashCache.has(cacheKey)) return adminDuplicateHashCache.get(cacheKey);
    const octets=await recupererOctetsPDF(doc.Fichier_url);
    const blob=new Blob([octets]);
    const hash=await empreinteSha256(blob);
    const result={taille:blob.size,hash};
    adminDuplicateHashCache.set(cacheKey,result);
    return result;
  }

  function afficherGroupesDoublonsAdmin(groupes, erreurs=0){
    const list=document.getElementById('adminDuplicatesList');
    const count=document.getElementById('tabCountDoublons');
    if(count) count.textContent=String(groupes.reduce((n,g)=>n+g.documents.length,0));
    if(!list) return;
    if(!groupes.length){
      list.innerHTML='<div class="admin-duplicate-empty success">Aucun doublon strict détecté parmi les documents publiés.</div>' +
        (erreurs ? `<div class="admin-duplicate-note">${erreurs} document(s) n’ont pas pu être vérifiés. Ils ne sont pas déclarés doublons par prudence.</div>` : '');
      return;
    }
    list.innerHTML='';
    groupes.forEach((g,idx)=>{
      const wrap=document.createElement('div');
      wrap.className='admin-duplicate-group';
      const docs=g.documents;
      wrap.innerHTML=`<div class="admin-duplicate-group-head"><div><strong>Doublon #${idx+1}</strong><span>${docs.length} exemplaires · ${formaterTailleTelechargement(g.taille)}</span></div><span class="admin-duplicate-hash">SHA-256 : ${g.hash.slice(0,16)}…</span></div><div class="admin-duplicate-items"></div>`;
      const items=wrap.querySelector('.admin-duplicate-items');
      docs.forEach(doc=>{
        const item=document.createElement('div');
        item.className='admin-duplicate-item';
        item.innerHTML=`<div class="admin-duplicate-item-main"><strong>${echapperHtmlPub(doc.Titre||'Sans titre')}</strong><span>${echapperHtmlPub([doc.Niveau,doc.Classe,doc['Matière']||doc.Genre].filter(Boolean).join(' · ')||'Informations non renseignées')}</span><small>${echapperHtmlPub(nomFichierExactDepuisUrl(doc.Fichier_url))}</small></div><div class="admin-duplicate-item-actions"><button type="button" class="admin-btn ghost js-open-pdf-in-site">Ouvrir dans Aurore</button><button type="button" class="admin-btn refuser" data-duplicate-delete="1">Exclure du site</button></div>`;
        item.querySelector('[data-duplicate-delete="1"]').addEventListener('click',()=>exclureDoublonAdmin(doc.id,doc.Titre,wrap));
        item.querySelector('.js-open-pdf-in-site')?.addEventListener('click',()=>{
          const cible={...doc,id:doc.id,Titre:doc.Titre||'Document',Fichier_url:doc.Fichier_url,Telechargement_autorise:doc.Telechargement_autorise!==false};
          if(!cible.Fichier_url){alert('Le fichier PDF de ce document est introuvable.');return;}
          if(typeof window.ouvrirLecteurPDF==='function')window.ouvrirLecteurPDF(cible);
        });
        items.appendChild(item);
      });
      list.appendChild(wrap);
    });
    if(erreurs){
      const note=document.createElement('div'); note.className='admin-duplicate-note';
      note.textContent=`${erreurs} document(s) n’ont pas pu être vérifiés (réseau ou fichier inaccessible). Ils ne sont pas déclarés doublons par prudence.`;
      list.prepend(note);
    }
  }

  async function chargerDoublonsAdmin(){
    const list=document.getElementById('adminDuplicatesList');
    const status=document.getElementById('adminDuplicatesStatus');
    const btn=document.getElementById('adminDuplicatesRefresh');
    if(!list||!status) return;
    if(btn) btn.disabled=true;
    list.innerHTML='<div class="admin-duplicate-empty">Analyse des documents publiés…</div>';
    status.textContent='Récupération des documents publiés…';
    adminDuplicateHashCache.clear();
    try{
      const docs=await recupererDocumentPubliesPourDoublons();
      if(!docs.length){
        afficherGroupesDoublonsAdmin([]);
        status.textContent='Analyse terminée : aucun document publié à analyser.';
        return;
      }

      // Regroupement progressif par taille : les tailles sont calculées depuis
      // les octets réellement récupérés, donc aucun HEAD/CORS particulier n'est
      // requis pour décider si deux fichiers sont candidats.
      const parTaille=new Map();
      let erreurs=0;
      for(let i=0;i<docs.length;i++){
        const doc=docs[i];
        status.textContent=`Lecture des fichiers ${i+1}/${docs.length}…`;
        try{
          const info=await tailleEtHashDocumentDoublon(doc);
          doc.__dupSize=info.taille;
          doc.__dupHash=info.hash;
          if(!parTaille.has(String(info.taille))) parTaille.set(String(info.taille),[]);
          parTaille.get(String(info.taille)).push(doc);
        }catch(e){
          erreurs++;
          console.warn('[Doublons admin] document non vérifiable',doc.id,e);
        }
      }

      const parHash=new Map();
      for(const arr of parTaille.values()){
        if(arr.length<2) continue;
        for(const doc of arr){
          if(!doc.__dupHash) continue;
          if(!parHash.has(doc.__dupHash)) parHash.set(doc.__dupHash,[]);
          parHash.get(doc.__dupHash).push(doc);
        }
      }
      const groupes=[];
      for(const [hash,arr] of parHash.entries()){
        if(arr.length>1) groupes.push({taille:Number(arr[0].__dupSize)||0,hash,documents:arr});
      }
      groupes.sort((a,b)=>b.documents.length-a.documents.length || b.taille-a.taille);
      afficherGroupesDoublonsAdmin(groupes,erreurs);
      status.textContent=groupes.length
        ? `${groupes.length} groupe(s) de doublons stricts détecté(s).`
        : (erreurs ? `Analyse terminée : aucun doublon confirmé. ${erreurs} document(s) n’ont pas pu être vérifiés.` : 'Analyse terminée : aucun doublon strict détecté.');
    }catch(e){
      console.error('[Doublons admin]',e);
      list.innerHTML=`<div class="admin-duplicate-empty error">Impossible d’analyser les documents publiés. ${echapperHtmlPub(e.message||'Erreur inconnue.')}</div>`;
      status.textContent='Analyse impossible.';
    }finally{if(btn) btn.disabled=false;}
  }

  async function exclureDoublonAdmin(id,titre,groupCard){
    if(!confirm(`Exclure « ${titre||'ce document'} » du site ?\n\nLe document sera simplement dépublié. Il ne sera PAS supprimé de la base de données ni du stockage.`)) return;
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/Document?id=eq.${encodeURIComponent(id)}`,{
        method:'PATCH',
        headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=representation'},
        body:JSON.stringify({Publie:false})
      });
      const text=await res.text();
      if(!res.ok) throw new Error(text||('HTTP '+res.status));
      let data=[]; try{data=JSON.parse(text)||[]}catch(e){}
      if(!data.length) throw new Error('Aucune modification effectuée. Vérifie la policy UPDATE.');
      await chargerDoublonsAdmin();
      await chargerDocumentsPublies();
    }catch(e){
      console.error('[Exclusion doublon]',e);
      alert('Le document n’a pas pu être exclu du site pour le moment. Vérifie les permissions administrateur puis réessaie.');
    }
  }

  document.getElementById('adminDuplicatesRefresh')?.addEventListener('click',chargerDoublonsAdmin);

