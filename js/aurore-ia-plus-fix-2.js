
(function(){
  const menu=document.getElementById('auroreIAPlusMenu');
  const imageInput=document.getElementById('auroreIAImageInput');
  const pdfInput=document.getElementById('auroreIAPdfInput');
  if(menu&&imageInput&&pdfInput){
    menu.addEventListener('click',function(e){
      const btn=e.target.closest('button[data-ia-file-kind]');
      if(!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const kind=btn.getAttribute('data-ia-file-kind');
      if(kind==='camera'){
        imageInput.setAttribute('capture','environment');
        imageInput.click();
      }else if(kind==='image'){
        imageInput.removeAttribute('capture');
        imageInput.click();
      }else if(kind==='pdf'){
        pdfInput.click();
      }
      const plus=document.getElementById('auroreIAPlus');
      if(plus) plus.setAttribute('aria-expanded','false');
      menu.hidden=true;
    },true);
  }

  /* Content Factory : même logique de classement que le dépôt de documents.
     Le correctif est isolé ici pour préserver le moteur Content Factory/PDF. */
  function initContentFactoryClassification(){
    const panel=document.querySelector('.admin-tab-panel[data-panel="content-factory"]');
    if(!panel||panel.dataset.classificationAligned==='1')return;
    const grid=panel.querySelector('.cf-create-grid');
    const level=document.getElementById('cfCreateLevel');
    const cls=document.getElementById('cfCreateClass');
    const subject=document.getElementById('cfCreateSubject');
    if(!grid||!level||!cls||!subject||typeof NIVEAUX==='undefined')return;
    panel.dataset.classificationAligned='1';

    const titleLabel=grid.querySelector('label:has(#cfCreateTitle)');
    const subjectLabel=grid.querySelector('label:has(#cfCreateSubject)');
    const levelLabel=grid.querySelector('label:has(#cfCreateLevel)');
    const classLabel=grid.querySelector('label:has(#cfCreateClass)');
    const promptLabel=grid.querySelector('label:has(#cfCreatePrompt)');
    if(!levelLabel||!classLabel||!subjectLabel)return;

    /* Le titre reste compatible avec le fonctionnement existant. */
    if(titleLabel)grid.appendChild(titleLabel);

    /* Le select interne reste présent pour enqueueCurrent(), mais la sélection
       visible du niveau utilise directement NIVEAUX comme le dépôt. */
    levelLabel.style.display='none';
    classLabel.style.display='none';
    const niveauLabel=document.createElement('label');
    niveauLabel.innerHTML='<span>Niveau</span><select id="cfCreateNiveauCascade"><option value="">Choisir un niveau</option></select>';
    grid.appendChild(niveauLabel);

    const filiereLabel=document.createElement('label');
    filiereLabel.innerHTML='<span>Filière</span><select id="cfCreateFiliere"><option value="">Choisir une filière disponible…</option></select>';
    grid.appendChild(filiereLabel);
    grid.appendChild(subjectLabel);

    const categoryLabel=document.createElement('label');
    categoryLabel.innerHTML='<span>Catégorie</span><select id="cfCreateCategory" required><option value="">Choisir une catégorie…</option><option value="Fiches cours">Fiches cours</option><option value="Devoir">Devoir</option><option value="Exercice">Exercice</option></select>';
    if(promptLabel)grid.insertBefore(categoryLabel,promptLabel);else grid.appendChild(categoryLabel);

    const root=document.getElementById('cfCreateNiveauCascade');
    const filiere=document.getElementById('cfCreateFiliere');
    const category=document.getElementById('cfCreateCategory');
    const customIds=['cfCreateLevelCustom','cfCreateClassCustom','cfCreateSubjectCustom'];
    customIds.forEach(id=>{const x=document.getElementById(id);if(x){x.style.display='none';x.value='';x.setAttribute('aria-hidden','true');}});

    function esc(v){const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML;}
    function children(node){
      if(!node)return null;
      if(Array.isArray(node.sousNiveaux))return node.sousNiveaux;
      if(Array.isArray(node.troncCommuns))return [...node.troncCommuns,...(Array.isArray(node.series)?node.series:[])];
      if(Array.isArray(node.series))return node.series;
      if(Array.isArray(node.classes))return node.classes;
      if(Array.isArray(node.enfants))return node.enfants;
      return null;
    }
    function leaf(node){return children(node)===null;}
    let path=[];

    function setHiddenSelect(sel,value){
      if(!sel)return;
      const v=String(value||'');
      let opt=[...sel.options].find(o=>o.value===v);
      if(!opt&&v){opt=document.createElement('option');opt.value=v;opt.textContent=v;sel.appendChild(opt);}
      sel.value=v;
    }
    function seriesValue(p){
      const s=p.find(n=>n&&n.type==='serie');
      const last=p[p.length-1];
      const common=last&&last.type==='classe-commune'&&['seconde-ti','seconde-ab3'].includes(last.id);
      return !common&&s?(s.serie||s.nom||''):'';
    }
    function subjectList(node){
      const raw=node?.matieres||((typeof MATIERES!=='undefined')?MATIERES:[]);
      return raw.map(m=>typeof m==='string'?m:(m?.nom||'')).map(x=>String(x||'').trim()).filter(Boolean);
    }
    function resolve(){
      const last=path[path.length-1]||null;
      const isLeaf=!!(last&&leaf(last));
      const f=seriesValue(path);
      const clsName=isLeaf?(last.nom||''):'';
      const levelValue=isLeaf?(last.dbNiveaux?.[0]||(path[0]?.id==='prescolaire'?'Préscolaire':last.nom||'')):'';
      setHiddenSelect(level,levelValue);
      setHiddenSelect(cls,clsName);
      if(filiere){
        filiere.innerHTML='<option value="">Choisir une filière disponible…</option>'+(f?`<option value="${esc(f)}">${esc(f)}</option>`:'');
        filiere.value=f;
      }
      const list=isLeaf?subjectList(last):[];
      subject.innerHTML='<option value="">Choisir une matière</option>'+list.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    }
    function render(){
      root.innerHTML='<option value="">Choisir un niveau</option>'+NIVEAUX.map(n=>`<option value="${esc(n.id)}">${esc(n.nom)}</option>`).join('');
      root.value=path[0]?.id||'';
      [...grid.querySelectorAll('[data-cf-cascade]')].forEach(x=>x.remove());
      let current=path[0]||null;
      let depth=1;
      while(current&&!leaf(current)){
        const kids=children(current)||[];
        const wrap=document.createElement('label');
        wrap.dataset.cfCascade='1';
        let label='Choix suivant';
        if(current.type==='serie')label='Classe';
        else if(current.type==='classe-commune')label='Classe';
        wrap.innerHTML=`<span>${label}</span><select><option value="">Choisir</option></select>`;
        const sel=wrap.querySelector('select');
        sel.innerHTML='<option value="">Choisir</option>'+kids.map(x=>`<option value="${esc(x.id)}">${esc(x.nom)}</option>`).join('');
        const chosen=path[depth]||null;
        sel.value=chosen?.id||'';
        sel.addEventListener('change',function(){
          const child=kids.find(x=>x.id===this.value)||null;
          path=path.slice(0,depth);
          if(child)path.push(child);
          render();
          resolve();
        });
        filiereLabel.before(wrap);
        if(!chosen)break;
        current=chosen;
        depth++;
      }
      resolve();
    }
    root.addEventListener('change',function(){
      path=[];
      const n=NIVEAUX.find(x=>x.id===this.value)||null;
      if(n)path=[n];
      render();
    });

    /* Enrichit uniquement la requête RPC Content Factory avec les métadonnées
       choisies. Les autres fetch (Supabase, PDF, upload, IA) restent inchangés. */
    const nativeFetch=window.fetch.bind(window);
    if(!window.__auroreCfMetadataFetchPatched){
      window.__auroreCfMetadataFetchPatched=true;
      window.fetch=async function(input,init){
        try{
          const url=typeof input==='string'?input:(input&&input.url)||'';
          if(/\/rest\/v1\/rpc\/aurora_create_content_job(?:\?|$)/.test(url)&&init?.body){
            const body=JSON.parse(init.body);
            const cat=category?.value||'';
            const fil=filiere?.value||'';
            body.p_document_type=cat||body.p_document_type||'document';
            const instructions=(body.p_instructions&&typeof body.p_instructions==='object')?body.p_instructions:{};
            body.p_instructions={...instructions,source:'admin_content_factory',queue:'sequential',category:cat||null,filiere:fil||null};
            init={...init,body:JSON.stringify(body)};
          }
        }catch(e){console.warn('[Content Factory] métadonnées non enrichies',e);}
        return nativeFetch(input,init);
      };
    }

    const launch=document.getElementById('cfCreateLaunch');
    if(launch&&!launch.dataset.cfCategoryGuard){
      launch.dataset.cfCategoryGuard='1';
      launch.addEventListener('click',function(e){
        if(!category?.value){
          e.stopImmediatePropagation();
          const msg=document.getElementById('cfCreateMsg');
          if(msg){msg.dataset.state='error';msg.textContent='Choisis une catégorie : Fiches cours, Devoir ou Exercice.';}
          category?.focus();
        }
      },true);
    }
    render();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initContentFactoryClassification,{once:true});
  else setTimeout(initContentFactoryClassification,0);
})();
