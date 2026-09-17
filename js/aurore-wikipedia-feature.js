(function(){
  const WIKI_LANG = 'fr';
  const WIKI_API = `https://${WIKI_LANG}.wikipedia.org/w/api.php`;
  const WIKI_REST = `https://${WIKI_LANG}.wikipedia.org/api/rest_v1/page/summary/`;
  const esc = (typeof echapperHtmlPub === 'function') ? echapperHtmlPub : (s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

  const ICONE_GLOBE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  const ICONE_ALERTE = (typeof ICONS !== 'undefined' && ICONS.warning) ? ICONS.warning : ICONE_GLOBE;

  /* ---------------------------------------------------------------
     RECHERCHE — écoute indépendante des champs globaux existants
     --------------------------------------------------------------- */
  let wikiDebounceTimer = null;
  let wikiAbortController = null;
  let wikiRequeteSeq = 0;
  const WIKI_TAILLE_PAGE = 12;
  let wikiTermeCourant = '';
  let wikiPagesAffichees = [];
  let wikiContinuationWiki = null;
  let wikiChargementEnCours = false;

  function normaliserWiki(v){
    return typeof normaliserRechercheSite === 'function'
      ? normaliserRechercheSite(v)
      : String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }

  function afficherEtatSectionWiki(html){
    const section = document.getElementById('wikiResultsSection');
    if(!section) return;
    section.style.display = 'block';
    section.innerHTML = `<div class="wiki-results-heading"><span class="wiki-globe-icon">${ICONE_GLOBE}</span><strong>Wikipédia</strong></div>` + html;
    const sub = document.getElementById('docsSubheading');
    if(sub) sub.style.display = 'block';
  }

  window.auroreReinitialiserSectionWikipedia = function(){
    if(wikiAbortController){ try{ wikiAbortController.abort(); }catch(e){} wikiAbortController = null; }
    wikiRequeteSeq++;
    wikiTermeCourant = '';
    wikiPagesAffichees = [];
    wikiContinuationWiki = null;
    wikiChargementEnCours = false;
    const section = document.getElementById('wikiResultsSection');
    if(section){ section.style.display = 'none'; section.innerHTML = ''; }
    const sub = document.getElementById('docsSubheading');
    if(sub) sub.style.display = 'none';
  };

  function construireCarteWikiHtml(p){
    const hasThumb = !!(p.thumbnail && p.thumbnail.source);
    const img = hasThumb
      ? `<img src="${esc(p.thumbnail.source)}" alt="" loading="lazy" decoding="async" width="${p.thumbnail.width||260}" height="${p.thumbnail.height||160}">`
      : `<span class="wiki-result-thumb-fallback">${ICONE_GLOBE}</span>`;
    const extrait = String(p.extract||'').replace(/\s+/g,' ').trim();
    return `<button type="button" class="wiki-result-card" data-wiki-titre="${esc(p.title)}">
      <div class="wiki-result-thumb-wrap">${img}</div>
      <div class="wiki-result-card-body">
        <span class="wiki-result-badge">Wikipédia</span>
        <strong>${esc(p.title)}</strong>
        ${extrait ? `<p>${esc(extrait)}</p>` : ''}
      </div>
    </button>`;
  }

  function attacherEcouteursWiki(){
    document.querySelectorAll('#wikiResultsSection [data-wiki-titre]').forEach(btn=>{
      btn.addEventListener('click', ()=> ouvrirArticleWikipedia(btn.getAttribute('data-wiki-titre')));
    });
    document.querySelectorAll('#wikiResultsSection .wiki-result-thumb-wrap img').forEach(img=>{
      img.addEventListener('error', function(){
        const wrap = img.closest('.wiki-result-thumb-wrap');
        if(wrap) wrap.innerHTML = `<span class="wiki-result-thumb-fallback">${ICONE_GLOBE}</span>`;
      }, { once:true });
    });
    const btnPlus = document.getElementById('wikiLoadMoreBtn');
    if(btnPlus) btnPlus.addEventListener('click', ()=> chargerLotWiki(wikiRequeteSeq, false));
    const btnRetry = document.getElementById('wikiRetryBtn');
    if(btnRetry) btnRetry.addEventListener('click', ()=> chargerLotWiki(wikiRequeteSeq, false));
  }

  function rendreResultatsWiki(){
    const cartes = wikiPagesAffichees.map(construireCarteWikiHtml).join('');
    let pied = '';
    if(wikiChargementEnCours){
      pied = `<div class="wiki-load-more-wrap"><div class="wiki-inline-state"><span class="wiki-spinner"></span> Chargement de résultats supplémentaires…</div></div>`;
    }else if(wikiContinuationWiki){
      pied = `<div class="wiki-load-more-wrap"><button type="button" class="wiki-load-more-btn" id="wikiLoadMoreBtn">Voir plus de résultats</button></div>`;
    }
    afficherEtatSectionWiki(`<div class="wiki-results-grid">${cartes}</div>${pied}`);
    attacherEcouteursWiki();
  }

  async function chargerLotWiki(jeton, estPremierLot){
    if(wikiChargementEnCours) return;
    wikiChargementEnCours = true;
    if(!estPremierLot) rendreResultatsWiki();
    if(wikiAbortController){ try{ wikiAbortController.abort(); }catch(e){} }
    wikiAbortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    try{
      const params = new URLSearchParams({
        action:'query', generator:'search', gsrsearch:wikiTermeCourant, gsrlimit:String(WIKI_TAILLE_PAGE), gsrnamespace:'0',
        prop:'pageimages|extracts', exintro:'1', explaintext:'1', exchars:'170',
        piprop:'thumbnail', pithumbsize:'240', format:'json', origin:'*', redirects:'1'
      });
      if(wikiContinuationWiki){
        Object.keys(wikiContinuationWiki).forEach(k=> params.set(k, wikiContinuationWiki[k]));
      }
      const res = await fetch(`${WIKI_API}?${params.toString()}`, { signal: wikiAbortController?.signal, cache:'no-store' });
      if(jeton !== wikiRequeteSeq) return;
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      if(jeton !== wikiRequeteSeq) return;
      const pages = (data && data.query && data.query.pages) ? Object.values(data.query.pages) : [];
      pages.sort((a,b)=> (a.index||0) - (b.index||0));
      const dejaVus = new Set(wikiPagesAffichees.map(p=>p.pageid));
      pages.forEach(p=>{ if(!dejaVus.has(p.pageid)){ wikiPagesAffichees.push(p); dejaVus.add(p.pageid); } });
      wikiContinuationWiki = (data && data.continue) ? data.continue : null;
      wikiChargementEnCours = false;
      if(!wikiPagesAffichees.length){
        afficherEtatSectionWiki(`<div class="wiki-inline-state">Aucun résultat Wikipédia pour « ${esc(wikiTermeCourant)} ».</div>`);
        return;
      }
      rendreResultatsWiki();
    }catch(err){
      wikiChargementEnCours = false;
      if(err && err.name === 'AbortError') return;
      if(jeton !== wikiRequeteSeq) return;
      if(!wikiPagesAffichees.length){
        afficherEtatSectionWiki(`<div class="wiki-inline-state">Recherche Wikipédia momentanément indisponible.</div>`);
      }else{
        const cartes = wikiPagesAffichees.map(construireCarteWikiHtml).join('');
        afficherEtatSectionWiki(`<div class="wiki-results-grid">${cartes}</div><div class="wiki-load-more-wrap"><div class="wiki-inline-state">Chargement impossible. <button type="button" class="wiki-load-more-btn" id="wikiRetryBtn">Réessayer</button></div></div>`);
        attacherEcouteursWiki();
      }
    }finally{
      if(jeton === wikiRequeteSeq) wikiAbortController = null;
    }
  }

  async function auroreRechercherWikipedia(termeBrut){
    const terme = String(termeBrut||'').trim();
    const jeton = ++wikiRequeteSeq;
    if(wikiAbortController){ try{ wikiAbortController.abort(); }catch(e){} wikiAbortController = null; }
    if(terme.length < 2){
      window.auroreReinitialiserSectionWikipedia();
      return;
    }
    wikiTermeCourant = terme;
    wikiPagesAffichees = [];
    wikiContinuationWiki = null;
    wikiChargementEnCours = false;
    afficherEtatSectionWiki(`<div class="wiki-inline-state"><span class="wiki-spinner"></span> Recherche sur Wikipédia…</div>`);
    await chargerLotWiki(jeton, true);
  }

  function programmerRechercheWiki(valeur){
    clearTimeout(wikiDebounceTimer);
    const v = String(valeur||'');
    if(!v.trim()){
      window.auroreReinitialiserSectionWikipedia();
      return;
    }
    wikiDebounceTimer = setTimeout(()=> auroreRechercherWikipedia(v), 320);
  }

  ['headerSearchInput','homeSearchInput'].forEach(id=>{
    const input = document.getElementById(id);
    if(!input) return;
    input.addEventListener('input', e => programmerRechercheWiki(e.target.value));
    input.addEventListener('keydown', e => { if(e.key==='Enter'){ clearTimeout(wikiDebounceTimer); auroreRechercherWikipedia(e.target.value); } });
  });

  /* ---------------------------------------------------------------
     PAGE ENCYCLOPÉDIQUE — ouverture, construction, fermeture
     --------------------------------------------------------------- */
  let wikiArticleJeton = 0;
  let wikiRetourAppui = null; // fonction à rappeler pour "Réessayer"

  function fermerArticleWikipediaReel(){
    wikiArticleJeton++;
    const overlay = document.getElementById('wikiViewerOverlay');
    if(!overlay) return;
    overlay.classList.remove('wiki-open');
    overlay.style.display = 'none';
    const body = document.getElementById('wikiViewerBody');
    if(body) body.innerHTML = '<span id="wikiViewerTitreLive" class="visually-hidden-aurore"></span>';
  }
  window.auroreFermerArticleWikipedia = fermerArticleWikipediaReel;

  function demanderFermetureArticleWikipedia(){
    if(history.state && history.state.wikiViewer){ history.back(); }
    else { fermerArticleWikipediaReel(); }
  }
  document.getElementById('wikiViewerFermer')?.addEventListener('click', demanderFermetureArticleWikipedia);
  document.getElementById('wikiViewerOverlay')?.addEventListener('keydown', e=>{
    if(e.key === 'Escape') demanderFermetureArticleWikipedia();
  });

  function squelettePageWiki(){
    return `<div class="wiki-skeleton">
      <div class="wiki-skeleton-block wiki-skeleton-hero"></div>
      <div class="wiki-skeleton-block wiki-skeleton-line" style="width:60%;height:26px;"></div>
      <div class="wiki-skeleton-block wiki-skeleton-line" style="width:90%;"></div>
      <div class="wiki-skeleton-block wiki-skeleton-line" style="width:80%;"></div>
      <div class="wiki-skeleton-block wiki-skeleton-line" style="width:70%;"></div>
    </div>`;
  }

  function etatWiki({icone, titre, texte, boutonTexte, boutonAction}){
    const body = document.getElementById('wikiViewerBody');
    if(!body) return;
    const btnId = 'wikiStateBtn_'+Math.random().toString(36).slice(2,8);
    body.innerHTML = `<div class="wiki-state">
      <div class="icon-wrap">${icone||ICONE_ALERTE}</div>
      <h3>${esc(titre||'')}</h3>
      <p>${esc(texte||'')}</p>
      ${boutonTexte ? `<button type="button" id="${btnId}">${esc(boutonTexte)}</button>` : ''}
    </div>`;
    if(boutonTexte && boutonAction) document.getElementById(btnId)?.addEventListener('click', boutonAction);
  }

  function nomFichierDepuisUrlImage(url){
    try{
      const propre = url.split('?')[0];
      const segs = propre.split('/').filter(Boolean);
      const dernier = segs[segs.length-1];
      const m = dernier.match(/^\d+px-(.+)$/);
      return decodeURIComponent(m ? m[1] : dernier);
    }catch(e){ return ''; }
  }
  function agrandirImageWiki(url){
    try{ return url.replace(/\/(\d+)px-([^\/]+)$/, (m,px,file)=> '/480px-'+file); }
    catch(e){ return url; }
  }
  function urlAbsolueWiki(src){
    if(!src) return '';
    if(src.startsWith('//')) return 'https:'+src;
    if(src.startsWith('/')) return `https://${WIKI_LANG}.wikipedia.org`+src;
    return src;
  }

  const SECTIONS_A_ARRETER = ['notes et references','references','reference','voir aussi','bibliographie','liens externes','articles connexes','annexes','sources','notes'];
  function normaliserTitreSection(t){
    return String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }

  function construireContenuArticle(doc, hero){
    const racine = doc.querySelector('.mw-parser-output') || doc.body;
    if(!racine) return { infoCards:[], sections:[], images:[] };

    racine.querySelectorAll('style,script,.mw-editsection,.reference,sup.reference,.noprint,.mw-empty-elt,.navbox,.ambox,.hatnote,.metadata,.sistersitebox,.portal-bar,.authority-control,.shortdescription,.mw-indicators,table.metadata,.reflist,ol.references,.mw-references-wrap,.mw-cite-backlink,.magnify,.printfooter,.catlinks,.geo-nondefault,.geo-multi-punct,.mw-collapsible').forEach(el=>el.remove());

    // ---- Bloc "Informations essentielles" à partir de l'infobox ----
    const infoCards = [];
    const infobox = racine.querySelector('.infobox');
    if(infobox){
      infobox.querySelectorAll('tr').forEach(tr=>{
        const th = tr.querySelector('th');
        const td = tr.querySelector('td');
        if(!th || !td) return;
        const label = th.textContent.replace(/\s+/g,' ').trim();
        const value = td.textContent.replace(/\s+/g,' ').trim();
        if(label && value && value.length <= 160 && infoCards.length < 8) infoCards.push({label, value});
      });
      infobox.remove();
    }

    // ---- Images du corps de l'article (galerie) ----
    const images = [];
    const nomHeroFichier = hero && hero.src ? nomFichierDepuisUrlImage(hero.src) : '';
    racine.querySelectorAll('.thumb, figure, .image').forEach(conteneur=>{
      const img = conteneur.querySelector('img');
      if(!img) return;
      const src = urlAbsolueWiki(img.getAttribute('src')||'');
      if(!src) return;
      const nomFichier = nomFichierDepuisUrlImage(src);
      if(!nomFichier || nomFichier === nomHeroFichier) { conteneur.remove(); return; }
      if(images.some(i=>i.nomFichier === nomFichier)) { conteneur.remove(); return; }
      if(images.length >= 6) { conteneur.remove(); return; }
      const legendeEl = conteneur.querySelector('.thumbcaption');
      const legende = legendeEl ? legendeEl.textContent.replace(/\s+/g,' ').trim() : '';
      images.push({
        src: agrandirImageWiki(src),
        legende,
        nomFichier,
        lienCommons: nomFichier ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(nomFichier)}` : ''
      });
      conteneur.remove();
    });

    // ---- Sections structurées (titres, paragraphes, listes, citations) ----
    const sections = [];
    let longueurCumulee = 0;
    let arreter = false;
    Array.from(racine.children).forEach(el=>{
      if(arreter) return;
      const tag = el.tagName;
      if(tag === 'H2' || tag === 'H3' || tag === 'H4'){
        const texte = el.textContent.replace(/\s+/g,' ').trim();
        if(SECTIONS_A_ARRETER.includes(normaliserTitreSection(texte))){ arreter = true; return; }
        if(texte) sections.push({ type: tag==='H2' ? 'h2' : 'h3', texte });
        return;
      }
      if(tag === 'P'){
        const texte = el.textContent.replace(/\s+/g,' ').trim();
        if(texte){ sections.push({ type:'p', texte }); longueurCumulee += texte.length; }
        return;
      }
      if(tag === 'UL' || tag === 'OL'){
        const items = Array.from(el.querySelectorAll(':scope > li')).map(li=>li.textContent.replace(/\s+/g,' ').trim()).filter(Boolean);
        if(items.length){ sections.push({ type: tag==='UL' ? 'ul' : 'ol', items }); longueurCumulee += items.join('').length; }
        return;
      }
      if(tag === 'BLOCKQUOTE'){
        const texte = el.textContent.replace(/\s+/g,' ').trim();
        if(texte) sections.push({ type:'quote', texte });
        return;
      }
      // DIV/SECTION : on explore un seul niveau pour les paragraphes/listes qui y sont parfois enveloppés.
      if(tag === 'DIV' || tag === 'SECTION'){
        Array.from(el.children).forEach(sousEl=>{
          if(arreter) return;
          if(sousEl.tagName === 'P'){
            const texte = sousEl.textContent.replace(/\s+/g,' ').trim();
            if(texte){ sections.push({ type:'p', texte }); longueurCumulee += texte.length; }
          } else if(sousEl.tagName === 'UL' || sousEl.tagName === 'OL'){
            const items = Array.from(sousEl.querySelectorAll(':scope > li')).map(li=>li.textContent.replace(/\s+/g,' ').trim()).filter(Boolean);
            if(items.length) sections.push({ type: sousEl.tagName==='UL' ? 'ul' : 'ol', items });
          }
        });
        return;
      }
      if(longueurCumulee > 7000) arreter = true;
    });

    return { infoCards, sections, images };
  }

  function rendreBlocsArticle(sections){
    return sections.map(s=>{
      if(s.type === 'h2') return `<h2>${esc(s.texte)}</h2>`;
      if(s.type === 'h3') return `<h3>${esc(s.texte)}</h3>`;
      if(s.type === 'p') return `<p>${esc(s.texte)}</p>`;
      if(s.type === 'quote') return `<blockquote>${esc(s.texte)}</blockquote>`;
      if(s.type === 'ul') return `<ul>${s.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`;
      if(s.type === 'ol') return `<ol>${s.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ol>`;
      return '';
    }).join('');
  }

  async function afficherDesambiguisation(titre){
    const body = document.getElementById('wikiViewerBody');
    if(!body) return;
    try{
      const params = new URLSearchParams({
        action:'query', generator:'links', titles:titre, gplnamespace:'0', gpllimit:'20',
        prop:'pageimages', piprop:'thumbnail', pithumbsize:'80', format:'json', origin:'*', redirects:'1'
      });
      const res = await fetch(`${WIKI_API}?${params.toString()}`, { cache:'no-store' });
      const data = await res.json();
      const pages = (data && data.query && data.query.pages) ? Object.values(data.query.pages).filter(p=>!p.missing) : [];
      if(!pages.length){
        etatWiki({ titre:'Plusieurs significations possibles', texte:`« ${titre} » peut désigner plusieurs choses sur Wikipédia. Essayez une recherche plus précise.`, boutonTexte:'Retour', boutonAction: demanderFermetureArticleWikipedia });
        return;
      }
      pages.sort((a,b)=> (a.index||0)-(b.index||0));
      const items = pages.slice(0,18).map(p=>`<button type="button" class="wiki-disambig-item" data-wiki-titre="${esc(p.title)}"><strong>${esc(p.title)}</strong></button>`).join('');
      body.innerHTML = `<div class="wiki-title-block"><h1>${esc(titre)}</h1><p>Cette page peut désigner plusieurs sujets. Choisissez celui que vous cherchez :</p></div>
        <div class="wiki-block"><div class="wiki-disambig-list">${items}</div></div>`;
      body.querySelectorAll('[data-wiki-titre]').forEach(btn=>{
        btn.addEventListener('click', ()=> ouvrirArticleWikipedia(btn.getAttribute('data-wiki-titre'), { pushHistory:false }));
      });
    }catch(e){
      etatWiki({ titre:'Impossible de charger les résultats', texte:'Veuillez réessayer dans quelques instants.', boutonTexte:'Réessayer', boutonAction: ()=>afficherDesambiguisation(titre) });
    }
  }

  async function ouvrirArticleWikipedia(titre, options){
    options = options || {};
    if(!titre) return;
    const jeton = ++wikiArticleJeton;
    const overlay = document.getElementById('wikiViewerOverlay');
    if(!overlay) return;

    overlay.style.display = 'block';
    requestAnimationFrame(()=> overlay.classList.add('wiki-open'));
    const body = document.getElementById('wikiViewerBody');
    if(body) body.innerHTML = squelettePageWiki();
    overlay.focus?.({ preventScroll:true });

    if(options.pushHistory !== false){
      try{
        if(typeof navigationParPopState !== 'undefined' && !navigationParPopState && typeof creerSnapshotNavigation === 'function'){
          const ecranActuel = document.querySelector('.screen.active')?.id || 'screen-home';
          history.pushState({ ...creerSnapshotNavigation(ecranActuel, window.scrollY), wikiViewer:true }, '', location.href);
        }
      }catch(e){}
    }

    let resume;
    try{
      const res = await fetch(`${WIKI_REST}${encodeURIComponent(titre.replace(/ /g,'_'))}?redirect=true`, { cache:'no-store' });
      if(jeton !== wikiArticleJeton) return;
      if(res.status === 404){
        etatWiki({ titre:'Article introuvable', texte:`Aucun article Wikipédia ne correspond à « ${titre} ».`, boutonTexte:'Retour', boutonAction: demanderFermetureArticleWikipedia });
        return;
      }
      if(!res.ok) throw new Error('HTTP '+res.status);
      resume = await res.json();
      if(jeton !== wikiArticleJeton) return;
    }catch(err){
      if(jeton !== wikiArticleJeton) return;
      etatWiki({ titre:'Impossible de charger cet article', texte:'Vérifiez votre connexion puis réessayez.', boutonTexte:'Réessayer', boutonAction: ()=>ouvrirArticleWikipedia(titre, { pushHistory:false }) });
      return;
    }

    if(resume.type === 'disambiguation'){
      await afficherDesambiguisation(resume.title || titre);
      return;
    }

    const titreReel = resume.title || titre;
    const description = resume.description || '';
    const presentation = (resume.extract || '').trim();
    const heroSrc = (resume.originalimage && resume.originalimage.source) || (resume.thumbnail && resume.thumbnail.source) || '';
    const hero = heroSrc ? { src: heroSrc } : null;
    const urlOriginal = (resume.content_urls && resume.content_urls.desktop && resume.content_urls.desktop.page) || `https://${WIKI_LANG}.wikipedia.org/wiki/${encodeURIComponent(titreReel.replace(/ /g,'_'))}`;

    let infoCards = [], sections = [], images = [];
    try{
      const params = new URLSearchParams({ action:'parse', page:titreReel, prop:'text', format:'json', origin:'*', redirects:'1', disabletoc:'1', disableeditsection:'1' });
      const res2 = await fetch(`${WIKI_API}?${params.toString()}`, { cache:'no-store' });
      if(jeton !== wikiArticleJeton) return;
      if(res2.ok){
        const data2 = await res2.json();
        const html = data2 && data2.parse && data2.parse.text && data2.parse.text['*'];
        if(html){
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const construit = construireContenuArticle(doc, hero);
          infoCards = construit.infoCards; sections = construit.sections; images = construit.images;
        }
      }
    }catch(e){ /* repli silencieux sur le seul résumé, voir ci-dessous */ }
    if(jeton !== wikiArticleJeton) return;

    const heroHtml = hero ? `<div class="wiki-hero-wrap"><img src="${esc(hero.src)}" alt="${esc(titreReel)}"></div>` : '';
    const infoHtml = infoCards.length ? `<div class="wiki-block"><span class="wiki-block-kicker">Informations essentielles</span><div class="wiki-info-grid">${infoCards.map(c=>`<div class="wiki-info-card"><span>${esc(c.label)}</span><strong>${esc(c.value)}</strong></div>`).join('')}</div></div>` : '';
    const presentationHtml = presentation ? `<div class="wiki-block"><span class="wiki-block-kicker">Présentation</span><div class="wiki-presentation-text">${presentation.split(/\n+/).map(p=>`<p>${esc(p)}</p>`).join('')}</div></div>` : '';
    const articleHtml = sections.length ? `<div class="wiki-block"><span class="wiki-block-kicker">Article</span><div class="wiki-article-content">${rendreBlocsArticle(sections)}</div></div>` : '';
    const galerieHtml = images.length ? `<div class="wiki-block"><span class="wiki-block-kicker">Images</span><div class="wiki-gallery">${images.map(img=>`<figure><img src="${esc(img.src)}" alt="${esc(img.legende||titreReel)}" loading="lazy">${img.legende ? `<figcaption>${esc(img.legende)}</figcaption>` : ''}</figure>`).join('')}</div></div>` : '';
    const creditsImages = images.filter(i=>i.lienCommons).map(i=>`<a href="${esc(i.lienCommons)}" target="_blank" rel="noopener noreferrer">${esc(i.nomFichier)}</a>`).join(' · ');
    const sourcesHtml = `<div class="wiki-block wiki-sources-block">
        <span class="wiki-block-kicker">Sources</span>
        <p>Le contenu de cette page provient de Wikipédia et Wikimedia Commons, disponibles sous licence Creative Commons BY-SA. Aurore n'est pas l'auteur de ce contenu et se contente de le présenter de façon plus lisible.</p>
        <div class="wiki-source-link-row"><a href="${esc(urlOriginal)}" target="_blank" rel="noopener noreferrer">↗ Voir l'article original sur Wikipédia</a></div>
        ${creditsImages ? `<div class="wiki-credits-list">Crédits images (Wikimedia Commons) : ${creditsImages}</div>` : ''}
      </div>`;

    const body2 = document.getElementById('wikiViewerBody');
    if(!body2) return;
    body2.innerHTML = `
      ${heroHtml}
      <div class="wiki-title-block"><h1>${esc(titreReel)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>
      ${infoHtml}
      ${presentationHtml}
      ${articleHtml}
      ${galerieHtml}
      ${sourcesHtml}
    `;
    const badge = document.getElementById('wikiViewerTitreLive');
    if(badge) badge.textContent = titreReel;
  }

})();
