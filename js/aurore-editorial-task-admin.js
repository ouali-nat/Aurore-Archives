(function(){
'use strict';
if(typeof window==='undefined'||window.__auroreEditorialTaskAdmin)return;
window.__auroreEditorialTaskAdmin=true;

const PROTOCOL='aurore-chatgpt-editor-v2';
const EDITOR='ChatGPT';
const PAGE_SIZE=10;
const A_EXECUTION_CONTRACT_VERSION='a-recovery-guardrails-v1';
const A_EXECUTION_CONTRACT={
  version:A_EXECUTION_CONTRACT_VERSION,
  rule:'NE_PAS_PASSER_EN_B_AVANT_ASSIMILATION_ECRITE_ET_VERIFICATION',
  sequence:[
    'RECUPERER la tâche réelle depuis Supabase, jamais une tâche inventée ou un exemple.',
    'LIRE le contexte complet : titre, matière, niveau, classe, type de document, classification et métadonnées utiles.',
    'ASSIMILER ce contexte et l’écrire dans workflow.context_assimilation avant toute poursuite.',
    'RECHERCHER et recouper les ressources pertinentes pour cette tâche précise.',
    'ECRIRE workflow.chapter_research avec méthode, base, constats et sources.',
    'ECRIRE workflow.chapter_options à partir de cette recherche, sans utiliser une proposition statique comme preuve de recherche.',
    'RELIRE la tâche persistée depuis Supabase et vérifier contexte + recherche + sources + propositions.',
    'SEULEMENT APRÈS cette vérification autoriser le stage chapitres_proposes.'
  ],
  prohibitedBeforeCompletion:[
    'dire que la tâche A est traitée sans assimilation et écriture persistées',
    'passer en B avec une recherche absente ou générique non reliée à la tâche',
    'passer en B sans sources persistées',
    'passer en B sans propositions de chapitres persistées',
    'utiliser la conversation comme substitut à workflow.context_assimilation'
  ]
};
const B_EXECUTION_CONTRACT_VERSION='b-selection-guardrails-v1';
const B_EXECUTION_CONTRACT={
  version:B_EXECUTION_CONTRACT_VERSION,
  rule:'NE_PAS_PASSER_EN_C_AVANT_LECTURE_ASSIMILATION_ET_SELECTION_PERSISTEES',
  sequence:[
    'RELIRE depuis Supabase le contexte A, la recherche et les propositions.',
    'ASSIMILER le dossier de recherche avant toute sélection.',
    'CHOISIR explicitement un ou plusieurs chapitres à partir des propositions persistées.',
    'ECRIRE la sélection dans workflow.selected_chapters, workflow.chapters et workflow.selected_chapter.',
    'RELIRE la sélection persistée et vérifier qu’elle appartient aux propositions de B.',
    'SEULEMENT APRÈS cette vérification autoriser le stage proposition_editoriale.'
  ],
  prohibitedBeforeCompletion:[
    'construire C à partir d’un chapitre absent des propositions B',
    'déclarer la sélection enregistrée sans relecture Supabase',
    'passer en C sans acknowledgement du contexte et de la recherche B',
    'remplacer les données persistées par une réponse conversationnelle'
  ]
};
const C_PLAN_REQUIRED_FIELDS=['researchMethod','curricularBasis','researchFindings','sources','title','chapter','objectives','competencies','prerequisites','progression','architecture','productionStrategy','content','methods','activities','examples','situations','exercises','corrections','differentiation','evaluation','volume','duration','resources','mathGeoGebra','technicalNeeds','pdfFormat','pdfOrientation','pdfPagination','pdfThemeColor','pdfLayout','pdfFonts','pdfHeaders','pdfResources','quality','notes'];
const C_EXECUTION_CONTRACT_VERSION='c-plan-guardrails-v1';
const D_EXECUTION_CONTRACT_VERSION='d-editorial-production-v1';
const D_EXECUTION_CONTRACT={
  version:D_EXECUTION_CONTRACT_VERSION,
  rule:'CX_VALIDE_VERS_D_PUIS_PRODUCTION_EDITE_VERS_DOCUMENTS_EN_ATTENTE',
  sequence:[
    'RELIRE la fiche C validée depuis Supabase avant toute édition.',
    'PASSER de CX à D avec stage redaction uniquement après validation persistée du plan.',
    'EDITER le contenu final à partir de workflow.proposal et le persister dans workflow.editorial_content.',
    'RELIRE la production éditoriale persistée avant de la déclarer terminée.',
    'INGESTER la production via public.aurora_connector_ingest_editorial_document(jsonb).',
    'VERIFIER le generated_document_id et le statut review après ingestion.',
    'POUR les documents de mathématiques, physique ou chimie, bloquer l’ingestion si moins de 400 éléments convertibles/convertis en LaTeX sont détectés et signaler le manque à l’éditeur.',
    'LAISSER le PDF manuel : aucune génération PDF automatique depuis D.'
  ],
  prohibitedBeforeCompletion:[
    'passer directement CX vers documents_en_attente sans production éditoriale persistée',
    'déclarer D terminé sans generated_document_id confirmé',
    'lancer automatiquement LuaLaTeX ou une autre génération PDF',
    'insérer un document scientifique dans Documents en attente sans avoir atteint le seuil LaTeX de 400 éléments'
  ]
};
const C_EXECUTION_CONTRACT={
  version:C_EXECUTION_CONTRACT_VERSION,
  rule:'NE_PAS_REVENIR_DANS_LA_DISCUSSION_AVANT_ECRITURE_ET_VERIFICATION',
  sequence:[
    'RECUPERER les tâches réellement présentes dans la section C depuis Supabase.',
    'LIRE le contexte complet : classe, matière, type, chapitre sélectionné en B et métadonnées.',
    'ASSIMILER le contexte avant toute rédaction : niveau, objectifs, contraintes curriculaires et besoins techniques.',
    'RECHERCHER et recouper les bases pédagogiques pertinentes avant de construire le plan.',
    'REMPLIR ET ENRICHIR workflow.proposal dans la carte C existante, sans créer une réponse parallèle dans la conversation.',
    'RELIRE la proposition écrite et vérifier tous les champs obligatoires ainsi que la cohérence avec la tâche.',
    'NE_DECLARER_TERMINE_QU_APRES_VERIFICATION_PERSISTANTE : ne déclarer la tâche traitée qu’après relecture du contenu persistant.',
    'NE_JAMAIS_LANCER_LE_PDF_AUTOMATIQUEMENT : la validation C prépare uniquement l’étape suivante.'
  ],
  prohibitedBeforeCompletion:[
    'répondre que la tâche est traitée sans avoir écrit workflow.proposal',
    'demander à l’administrateur de remplir le plan à la place de ChatGPT',
    'inventer une tâche ou un chapitre absent de Supabase',
    'passer stage à edition_ready sans contrôle de complétude',
    'lancer une génération PDF depuis C'
  ]
};
const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML};
const panel=()=>document.querySelector('.admin-tab-panel[data-panel="aurora-request"]');

async function token(){
  if(typeof assurerClientAuthGoogle!=='function')throw new Error('Client Supabase indisponible.');
  const client=await assurerClientAuthGoogle();
  let s=(await client.auth.getSession())?.data?.session||null;
  if(!s?.access_token)throw new Error('Session administrateur expirée.');
  if(s.expires_at&&Date.now()>=s.expires_at*1000-60000){
    const r=await client.auth.refreshSession();
    if(r.error||!r.data?.session)throw(r.error||new Error('Impossible de rafraîchir la session.'));
    s=r.data.session;
  }
  return s.access_token;
}
async function rest(path,options={}){
  const headers={apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+await token(),...(options.headers||{})};
  const fetcher=typeof adminInventoryFetch==='function'?adminInventoryFetch:fetch;
  const r=await fetcher(SUPABASE_URL+path,{...options,headers,cache:'no-store'});
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null}catch(_){data=raw}
  if(!r.ok)throw new Error(data?.message||data?.error||raw||('HTTP '+r.status));
  return data;
}
async function rpc(name,body){return rest('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})}
async function getJob(id){
  const rows=await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(id))+'&select=id,status,title,subject,level,class_name,document_type,metadata,created_at,updated_at');
  return Array.isArray(rows)?rows[0]||null:null;
}
async function listJobs(){
  const rows=await rest('/rest/v1/aurora_content_jobs?select=id,status,title,subject,level,class_name,document_type,metadata,created_at,updated_at&order=updated_at.desc&limit=500');
  return (Array.isArray(rows)?rows:[]).filter(t=>['aurore-chatgpt-editor-v2','aurore-chatgpt-editor-v1'].includes(t?.metadata?.workflow?.protocol));
}
function workflowMetadata(existing,patch){
  const m=existing&&typeof existing==='object'?existing:{};
  const w=m.workflow&&typeof m.workflow==='object'?m.workflow:{};
  return {...m,manual_publication_only:true,pdf_launch_mode:'manual',manual_pdf_launch_required:true,auto_pdf_launch:false,
    editorial_engine:EDITOR,workflow:{...w,...patch,protocol:PROTOCOL,editorial_engine:EDITOR,updated_at:new Date().toISOString()}};
}
function siteEditorialCatalog(){
  const out=[];
  const seen=new Set();
  const add=(classe,matieres,context='')=>{
    if(!classe||!Array.isArray(matieres)||!matieres.length)return;
    const subjects=matieres.map(x=>typeof x==='string'?x:(x&&x.nom)||'').map(x=>String(x).trim()).filter(Boolean);
    if(!subjects.length)return;
    const key=classe+'|'+subjects.join('|');
    if(seen.has(key))return; seen.add(key);
    out.push({classe,subjects,context});
  };
  const walk=(node,context='')=>{
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node))return node.forEach(x=>walk(x,context));
    const ctx=node.nom||context;
    if(node.classes) node.classes.forEach(x=>add(x.nom,x.matieres,ctx));
    if(node.troncCommuns) node.troncCommuns.forEach(x=>add(x.nom,x.matieres,ctx));
    if(node.sousNiveaux) node.sousNiveaux.forEach(x=>walk(x,ctx));
    if(node.series) node.series.forEach(x=>walk(x,ctx));
    if(node.enfants) node.enfants.forEach(x=>walk(x,ctx));
    if(node.matieres&&node.nom&&!node.classes&&!node.troncCommuns) add(node.nom,node.matieres,ctx);
  };
  if(typeof NIVEAUX!=='undefined') walk(NIVEAUX);
  return out;
}
function catalogOptions(){
  const catalog=siteEditorialCatalog();
  const byClass=new Map();
  catalog.forEach(x=>{
    const prev=byClass.get(x.classe)||new Set();
    x.subjects.forEach(s=>prev.add(s)); byClass.set(x.classe,prev);
  });
  return [...byClass.entries()].map(([classe,set])=>({classe,subjects:[...set].sort((a,b)=>a.localeCompare(b,'fr'))})).sort((a,b)=>a.classe.localeCompare(b.classe,'fr'));
}
function editorChildren(node){
  if(!node)return null;
  if(Array.isArray(node.sousNiveaux))return node.sousNiveaux;
  if(Array.isArray(node.troncCommuns))return [...node.troncCommuns,...(Array.isArray(node.series)?node.series:[])];
  if(Array.isArray(node.series))return node.series;
  if(Array.isArray(node.classes))return node.classes;
  if(Array.isArray(node.enfants))return node.enfants;
  return null;
}
function editorIsLeaf(node){return editorChildren(node)===null;}
function editorLeafRoutes(root){
  const out=[];
  const walk=(node,path,display)=>{
    if(!node)return;
    const nextPath=[...path,node];
    const isSerie=node.type==='serie';
    const nextDisplay=isSerie?display:[...display,String(node.nom||'').trim()].filter(Boolean);
    const kids=editorChildren(node);
    if(!kids){out.push({leaf:node,path:nextPath,label:nextDisplay.join(' · ')});return;}
    for(const child of kids)walk(child,nextPath,nextDisplay);
  };
  walk(root,[],[]);
  const seen=new Set();
  return out.filter(x=>{
    const key=String(x.path.map(n=>n.id||n.nom).join('/'));
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
function editorClassificationRoots(){
  return Array.isArray(NIVEAUX)?NIVEAUX:[];
}
async function updateJob(id,patch,status){
  const row=await getJob(id);if(!row)throw new Error('Tâche introuvable.');
  const metadata=workflowMetadata(row.metadata,patch);
  const body={metadata,updated_at:new Date().toISOString()};if(status)body.status=status;
  await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(id)),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(body)});
  return getJob(id);
}
async function createTask(className,subject,documentType,classification={}){
  const level=String(classification.level||className||'').trim();
  const path=Array.isArray(classification.path)?classification.path.map(x=>String(x||'').trim()).filter(Boolean):[];
  const location=String(classification.location||path.join(' · ')||className||'').trim();
  const id=Number(await rpc('aurora_create_content_job',{
    p_title:'À organiser — '+className+' — '+subject+' — '+documentType,p_subject:subject,p_level:level,p_class_name:className,
    p_document_type:documentType,p_prompt:'Tâche éditoriale minimale. ChatGPT est l’éditeur canonique : récupération, chapitres, plan de production puis rédaction finale.',
    p_instructions:{source:'admin_editorial_task',origin:'gpt_editorial_queue',queue:'manual',category:'Documents',document_type:documentType,rights_confirmed:true,
      theme_color:'#6D28D9',editorial:{role:'editor',engine:EDITOR,schema_version:'aurora-editorial-2',status:'waiting_chatgpt'},
      classification:{level,location,class_name:className,subject,document_type:documentType,path},
      workflow:{protocol:PROTOCOL,stage:'initiale',proposal_version:0,user_validated:false,chatgpt_claimed:false,
        manual_pdf_only:true,manual_pdf_launch_required:true,auto_pdf_launch:false,editorial_engine:EDITOR,
        execution_contract:A_EXECUTION_CONTRACT,execution_contract_acknowledged:false,completion_guard:A_EXECUTION_CONTRACT_VERSION,
        a_context_required:true,b_context_required:true}}
  }));
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Identifiant de tâche invalide.');
  return updateJob(id,{stage:'initiale',chatgpt_claimed:false,chatgpt_claimed_at:null,chapters:null,selected_chapter:null,proposal:null,proposal_version:0,user_validated:false,rejected:false,revision_requested:false,admin_validation:null,execution_contract:A_EXECUTION_CONTRACT,execution_contract_acknowledged:false,completion_guard:A_EXECUTION_CONTRACT_VERSION,
    a_context_required:true,b_context_required:true},'draft');
}
const textValue=v=>{
  if(v==null)return '';
  if(Array.isArray(v))return v.map(x=>typeof x==='object'?(x.title||x.name||JSON.stringify(x)):x).join('\n');
  if(typeof v==='object')return Object.entries(v).map(([k,x])=>k+': '+(typeof x==='object'?JSON.stringify(x):x)).join('\n');
  return String(v);
};
const proposalFor=(t)=>{
  const w=t.metadata?.workflow||{},p=w.proposal&&typeof w.proposal==='object'?{...w.proposal}:{};
  const selected=Array.isArray(w.selected_chapters)?w.selected_chapters:[];
  return {
    ...p,
    title:p.title||p.titre||t.title||'',
    chapter:p.chapter||p.chapitre||(selected.length?selected.map(x=>x?.title||x?.name||textValue(x)).join('\\n'):w.selected_chapter?.title||textValue(w.selected_chapter)||''),
    researchMethod:textValue(p.researchMethod||p.research_method||w.chapter_research?.methodology),
    curricularBasis:textValue(p.curricularBasis||p.curricular_basis||p.programme||w.chapter_research?.basis),
    researchFindings:textValue(p.researchFindings||p.research_findings||p.recherche||w.chapter_research?.findings),
    sources:textValue(p.sources||p.source_urls||w.chapter_research?.source_urls),
    objectives:textValue(p.objectives||p.objectifs),
    competencies:textValue(p.competencies||p.competences),
    prerequisites:textValue(p.prerequisites||p.prerequis),
    progression:textValue(p.progression||p.sequence||p.progression_pedagogique),
    architecture:textValue(p.architecture||p.structure||p.plan),
    productionStrategy:textValue(p.productionStrategy||p.production_strategy||p.strategie_production||p.strategy),
    content:textValue(p.content||p.contenu||p.sections),
    methods:textValue(p.methods||p.methodes),
    activities:textValue(p.activities||p.activites),
    examples:textValue(p.examples||p.exemples),
    situations:textValue(p.situations||p.problems||p.problemes),
    exercises:textValue(p.exercises||p.exercices),
    corrections:textValue(p.corrections||p.corriges),
    differentiation:textValue(p.differentiation||p.differenciation),
    evaluation:textValue(p.evaluation||p.assessment||p.evaluations),
    volume:textValue(p.volume||p.pedagogical_volume),
    duration:textValue(p.duration||p.duree),
    resources:textValue(p.resources||p.ressources),
    mathGeoGebra:textValue(p.mathGeoGebra||p.math_geogebra||p.geogebra||p.math),
    technicalNeeds:textValue(p.technicalNeeds||p.technical_needs||p.besoins_techniques),
    pdfFormat:p.pdfFormat||p.pdf_format||'A4',
    pdfOrientation:p.pdfOrientation||p.pdf_orientation||'Portrait',
    pdfPagination:p.pdfPagination||p.pdf_pagination||'Pagination continue',
    pdfThemeColor:p.pdfThemeColor||p.theme_color||t.metadata?.theme_color||'#6D28D9',
    pdfLayout:textValue(p.pdfLayout||p.pdf_layout||p.layout),
    pdfFonts:textValue(p.pdfFonts||p.pdf_fonts||p.fonts),
    pdfHeaders:textValue(p.pdfHeaders||p.pdf_headers||p.headers),
    pdfResources:textValue(p.pdfResources||p.pdf_resources),
    quality:textValue(p.quality||p.qa||p.controle_qualite),
    notes:textValue(p.notes||p.editorial_notes),
    revisionNotes:textValue(p.revisionNotes||p.revision_notes||w.revision_note)
  };
};
const stageInfo={
  initiale:{label:'En attente de récupération',tone:'waiting'},
  chapitres_proposes:{label:'Chapitres proposés',tone:'chapters'},
  chapitre_selectionne:{label:'Chapitres sélectionnés',tone:'chapters'},
  proposition_editoriale:{label:'Construction en cours',tone:'plan'},
  proposal_review:{label:'Plan à valider',tone:'plan'},
  revision_requested:{label:'Révision demandée',tone:'warning'},
  admin_validation:{label:'Validation administrative',tone:'admin'},
  edition_ready:{label:'Prêt pour l’édition',tone:'ready'}
};
function aResearchFor(t){
  const w=t.metadata?.workflow||{},r=w.chapter_research;
  return r&&typeof r==='object'?r:{};
}
function aContextReady(t){
  const w=t.metadata?.workflow||{},a=w.context_assimilation;
  if(!a||typeof a!=='object')return false;
  const required=[t.title,t.subject,t.level,t.class_name,t.document_type];
  const snapshot=String(a.snapshot||'').trim();
  const summary=String(a.summary||'').trim();
  return a.acknowledged===true&&snapshot.length>=80&&summary.length>=60
    &&required.every(x=>String(x||'').trim()&&snapshot.includes(String(x).trim()));
}
function aResearchReady(t){
  const w=t.metadata?.workflow||{},r=aResearchFor(t);
  const options=Array.isArray(w.chapter_options)?w.chapter_options:[];
  const findings=String(r.findings||'').trim();
  const methodology=String(r.methodology||r.method||'').trim();
  const sources=Array.isArray(r.source_urls)?r.source_urls.filter(Boolean):[];
  return aContextReady(t)
    &&String(r.status||'').toLowerCase()==='researched'
    &&findings.length>=40
    &&methodology.length>=10
    &&sources.length>=1
    &&options.length>=1
    &&options.every(x=>String(x?.title||x?.name||x||'').trim());
}
function bSelectionReady(t){
  const w=t.metadata?.workflow||{},selected=Array.isArray(w.selected_chapters)?w.selected_chapters:[];
  const options=Array.isArray(w.chapter_options)?w.chapter_options:[];
  const allowed=new Set(options.map(x=>String(x?.title||x?.name||x)));
  return w.b_context_assimilation?.acknowledged===true
    &&selected.length>0
    &&selected.every(x=>allowed.has(String(x?.title||x?.name||x)));
}
function classify(t){
  const w=t.metadata?.workflow||{},s=w.stage||'initiale';
  if(['chapitres_proposes','chapitre_selectionne'].includes(s)&&aResearchReady(t))return'B';
  if(!w.chatgpt_claimed&&['initiale','chapitres_demandes'].includes(s))return'A';
  if(['proposition_editoriale','revision_requested'].includes(s))return'C';
  if(['proposal_review','admin_validation','edition_ready'].includes(s))return'CX';
  if(['redaction','production_en_cours','production_terminee','pdf_ready'].includes(s))return'D';
  return null;
}
async function promoteAtoB(id){
  const fresh=await getJob(id);
  if(!fresh)throw new Error('Tâche A introuvable.');
  const w=fresh.metadata?.workflow||{};
  if(!['initiale','chapitres_demandes'].includes(w.stage||'initiale'))throw new Error('Cette tâche n’est plus dans A.');
  if(!aResearchReady(fresh))throw new Error('Migration A→B bloquée : la recherche persistée, ses sources et les propositions de chapitres doivent être complètes et vérifiables.');
  const promoted=await updateJob(fresh.id,{
    stage:'chapitres_proposes',
    chatgpt_claimed:true,
    chatgpt_claimed_at:new Date().toISOString(),
    proposal_status:'chapters_ready',
    research_verified_at:new Date().toISOString(),
    research_verification:'persisted_and_checked',
    execution_contract:B_EXECUTION_CONTRACT,
    execution_contract_acknowledged:true,
    completion_guard:B_EXECUTION_CONTRACT_VERSION,
    manual_pdf_launch_required:true,
    auto_pdf_launch:false
  },'draft');
  if(!promoted?.metadata?.workflow||promoted.metadata.workflow.stage!=='chapitres_proposes'||!aResearchReady(promoted)){
    throw new Error('La migration A→B n’a pas pu être confirmée après relecture de Supabase.');
  }
  return promoted;
}
function taskCard(t,section){
  const w=t.metadata?.workflow||{},s=stageInfo[w.stage]||{label:w.stage||t.status,tone:'waiting'};
  const ch=Array.isArray(w.chapters)?w.chapters:[];
  const pv=w.proposal&&typeof w.proposal==='object'?w.proposal:null;
  const desc=section==='B'
    ? (ch.length?ch.slice(0,3).map(x=>x.title||x.name||textValue(x)).join(' · ')+(ch.length>3?'…':''):'Recherche / chapitres à proposer')
    : section==='C'||section==='CX'
      ? (pv?.productionStrategy||pv?.title||(
          Array.isArray(w.selected_chapters)&&w.selected_chapters.length
            ? 'Chapitres retenus : '+w.selected_chapters.map(x=>x?.title||x?.name||textValue(x)).join(' · ')
            : w.selected_chapter?.title||w.selected_chapter||''
        )||'Carte de production à construire')
      : section==='CX'
        ? (pv?'Plan C traité · consultable et modifiable':'Plan C traité')
      : section==='D'
        ? (w.stage==='edition_ready'?'Plan validé · prêt pour la production':'Production finale')
        : 'Classe + matière : première étape du parcours éditorial';

    return '<article class="editor-pro-card"><div class="editor-pro-top"><span class="editor-pro-id">#'+esc(t.id)+'</span><span class="editor-pro-pill '+esc(s.tone)+'">'+esc(s.label)+'</span></div><h4>'+esc(t.class_name||t.level||'Classe')+'</h4><strong class="editor-pro-subject">'+esc(t.subject||'Matière')+'</strong><p>'+esc(desc)+'</p><div class="editor-pro-bottom"><span>'+esc(t.document_type||'cours')+'</span><button type="button" class="admin-btn ghost" data-editor-open="'+esc(t.id)+'">Ouvrir</button></div></article>';
}
function paginate(items,page){
  return items.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
}
function pager(total,page,key){
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));if(pages<=1)return '';
  return '<div class="editor-block-pager">'+Array.from({length:pages},(_,i)=>'<button type="button" class="admin-btn '+(i===page?'primary':'ghost')+'" data-editor-page="'+key+':'+i+'">Bloc '+(i+1)+'</button>').join('')+'</div>';
}
const CHAPTER_PROPOSALS={
  "219|mathématiques|terminale c":[
    {title:"Suites numériques",description:"Récurrence, convergence, suites usuelles, suites définies par récurrence et théorèmes de comparaison.",source:"Curriculum MENAPLN — Mathématiques, Terminales C/E (2022)."},
    {title:"Nombres complexes",description:"Formes algébrique, trigonométrique et exponentielle, conjugué, module, argument, Moivre/Euler, équations et interprétation géométrique.",source:"Curriculum MENAPLN + Faso e-education."},
    {title:"Arithmétique dans ℤ",description:"Divisibilité, PGCD/PPCM, Bézout, Gauss, congruences et problèmes arithmétiques.",source:"Curriculum MENAPLN — Mathématiques, Terminales C/E (2022)."},
    {title:"Fonctions numériques : limites, continuité et étude",description:"Limites, continuité, dérivation, variations, extrema, asymptotes et étude complète de fonctions.",source:"Curriculum MENAPLN + Faso e-education."},
    {title:"Fonctions logarithme, exponentielle et puissance",description:"Définitions, propriétés, équations/inéquations, dérivées, primitives, croissance comparée et applications.",source:"Faso e-education — Mathématiques Terminale."},
    {title:"Équations différentielles linéaires",description:"Équations du premier et du second ordre sans second membre, conditions initiales et applications de modélisation.",source:"Curriculum MENAPLN + Faso e-education."},
    {title:"Calcul intégral",description:"Primitives, intégrale d’une fonction continue, propriétés, valeurs moyennes, aires et applications.",source:"Curriculum MENAPLN + Faso e-education."},
    {title:"Transformations du plan et similitudes",description:"Transformations, similitudes directes et configurations géométriques du plan.",source:"Curriculum MENAPLN + Faso e-education — similitudes directes."},
    {title:"Probabilités et variables aléatoires",description:"Vocabulaire des probabilités, calculs de probabilités, conditionnement/indépendance et variables aléatoires.",source:"Curriculum MENAPLN + Faso e-education."},
    {title:"Courbes planes",description:"Courbes paramétrées du plan et étude de leurs propriétés dans le cadre du programme.",source:"Curriculum MENAPLN — Mathématiques Terminales C/E."},
    {title:"Calcul vectoriel et géométrie",description:"Calcul vectoriel et configurations géométriques, avec résolution de problèmes du plan et de l’espace.",source:"Curriculum MENAPLN — Mathématiques Terminales C/E."},
    {title:"Statistiques",description:"Organisation, traitement et interprétation des données statistiques au niveau Terminale C.",source:"Curriculum MENAPLN — Mathématiques Terminales C/E."},
    {title:"Matrices et applications",description:"Matrices, opérations et applications comme outil de résolution et de modélisation.",source:"Curriculum MENAPLN — Mathématiques Terminales C/E."}
  ],
  "220|français|terminale c":[
    {title:"Le commentaire composé",description:"Analyse du sujet, problématique, axes, procédés, plan et rédaction d’un commentaire composé.",source:"Curriculum MENAPLN — Français séries C/D (2022) + Faso e-education."},
    {title:"Le récit : narration et analyse romanesque",description:"Histoire/narration, narrateur, héros, focalisation, sommaire, ellipse, schémas narratif et actanciel.",source:"Curriculum MENAPLN — Français séries C/D (2022)."},
    {title:"Littérature française du XXe siècle",description:"Étude des grands courants explicitement retenus : surréalisme, absurde et existentialisme.",source:"Curriculum MENAPLN — Français séries C/D (2022)."},
    {title:"Littérature africaine des indépendances à nos jours",description:"Évolution, œuvres et problématiques de la littérature africaine contemporaine, notamment la désillusion/désenchantement.",source:"Curriculum MENAPLN — Français séries C/D (2022)."},
    {title:"L’œuvre romanesque et la fiche de lecture",description:"Lecture intégrale, analyse structurée d’une œuvre romanesque et production d’une fiche de lecture.",source:"Curriculum MENAPLN — Français séries C/D (2022)."},
    {title:"La dissertation littéraire",description:"Analyse du sujet, problématique, recherche des idées, types de plans, raisonnements, argumentation et rédaction.",source:"Curriculum MENAPLN + Faso e-education."},
    {title:"Le résumé de texte et la discussion",description:"Résumé d’un texte de 600 à 800 mots, reformulation, articulation logique et rédaction d’une discussion.",source:"Curriculum MENAPLN — Français séries C/D (2022)."},
    {title:"La poésie : lecture méthodique et versification",description:"Lecture méthodique, versification, procédés poétiques, tons et interprétation d’une œuvre poétique.",source:"Curriculum MENAPLN + Faso e-education."},
    {title:"Le théâtre : dramaturgie et lecture d’œuvre",description:"Acte, scène, dialogue, réplique, tirade, monologue, didascalie, dramaturgie et étude d’une œuvre théâtrale.",source:"Curriculum MENAPLN — Français séries C/D (2022)."},
    {title:"Histoire littéraire : symbolisme et Parnasse",description:"Repères historiques et esthétiques, caractéristiques, auteurs et exploitation dans l’analyse littéraire.",source:"Curriculum MENAPLN — Français séries C/D (2022)."},
    {title:"Le nouveau roman et les évolutions du récit",description:"Repères sur le nouveau roman et mise en relation avec les transformations de l’écriture narrative.",source:"Curriculum MENAPLN — Français séries C/D (2022)."},
    {title:"Préparation intégrée aux épreuves du baccalauréat",description:"Mobilisation des compétences de résumé, dissertation, commentaire composé, lecture d’œuvre et expression.",source:"Curriculum MENAPLN — compétences terminales C/D."}
  ]
};
function chapterProposalsFor(t){
  const w=t.metadata?.workflow||{};
  const stored=Array.isArray(w.chapter_options)&&w.chapter_options.length
    ? w.chapter_options
    : (Array.isArray(w.chapters)&&w.chapters.length ? w.chapters : []);
  if(stored.length)return stored.map(x=>typeof x==='string'?{title:x,description:'',source:'Proposition enregistrée dans la tâche.'}:x).filter(x=>x&&String(x.title||x.name||'').trim());
  const key=String(t.id)+"|"+String(t.subject||"").toLowerCase()+"|"+String(t.class_name||t.level||"").toLowerCase();
  return CHAPTER_PROPOSALS[key]||[];
}
function chaptersMarkup(t){
  const w=t.metadata?.workflow||{},r=aResearchFor(t);
  const saved=Array.isArray(w.selected_chapters)
    ? w.selected_chapters
    : (Array.isArray(w.chapter_options)?[]:(Array.isArray(w.chapters)?w.chapters:[]));
  const proposals=chapterProposalsFor(t);
  if(!aResearchReady(t))return'<div class="editor-c-plan-context warning"><span>Recherche non vérifiée</span><strong>La carte B ne peut pas proposer de sélection.</strong><small>La recherche, les sources et les propositions doivent être persistées dans Supabase avant l’entrée en B.</small></div>';
  if(!proposals.length)return'<div class="editor-empty">Aucune proposition structurée disponible après recherche. La tâche doit rester hors de B.</div>';
  const selected=new Set(saved.map(x=>String(x.title||x.name||x)));
  const sources=Array.isArray(r.source_urls)?r.source_urls:[];
  return '<div class="editor-chapter-source"><span>Dossier de recherche ayant autorisé A → B</span><small><strong>Méthode :</strong> '+esc(r.methodology||r.method||'—')+' · <strong>Base :</strong> '+esc(r.basis||'—')+' · <strong>Constats :</strong> '+esc(r.findings||'—')+'</small><small><strong>Sources :</strong> '+esc(sources.join(' · '))+'</small></div>'+
    '<button type="button" class="admin-btn ghost editor-chapters-toggle" data-chapters-toggle>Choisir les chapitres <span>＋</span></button>'+
    '<div class="editor-chapters-selection" hidden><div class="editor-chapters-choice">'+proposals.map((x,i)=>'<label class="editor-chapter-choice"><input type="checkbox" data-chapter-choice="'+i+'" '+(selected.has(x.title)?'checked':'')+'><span><strong>'+esc(x.title)+'</strong><small>'+esc(x.description)+'</small><em>'+esc(x.source)+'</em></span></label>').join('')+'</div>'+
    '<div class="editor-plan-actions"><button type="button" class="admin-btn primary" data-chapters-save="'+esc(t.id)+'">Enregistrer la sélection et passer à l’étape suivante</button></div></div>';
}
function field(label,key,value,wide){
  return '<label class="editor-field '+(wide?'wide':'')+'"><span>'+label+'</span><textarea data-plan-field="'+key+'" rows="'+(wide?4:2)+'">'+esc(value)+'</textarea></label>';
}
function selectedChaptersFor(t){
  const w=t.metadata?.workflow||{};
  return Array.isArray(w.selected_chapters)?w.selected_chapters:(Array.isArray(w.chapters)?w.chapters:[]);
}
function cPlanCompleteness(t,p){
  const missing=C_PLAN_REQUIRED_FIELDS.filter(k=>!String(p?.[k]??'').trim());
  const selected=selectedChaptersFor(t);
  const chapterNames=selected.map(x=>String(x?.title||x?.name||x||'').trim()).filter(Boolean);
  if(!chapterNames.length)missing.unshift('selected_chapters');
  if(p?.chapter&&chapterNames.length){
    const normalized=String(p.chapter).toLocaleLowerCase('fr');
    const matches=chapterNames.some(x=>normalized.includes(x.toLocaleLowerCase('fr'))||x.toLocaleLowerCase('fr').includes(normalized));
    if(!matches)missing.unshift('chapter_alignment');
  }
  const researchSourceCount=String(p?.sources||'').split(/\n|\r?\n/).map(x=>x.trim()).filter(Boolean).length;
  if(researchSourceCount<1)missing.unshift('research_source');
  if(String(p?.quality||'').trim().length<40)missing.unshift('quality_detail');
  return {ok:missing.length===0,missing:[...new Set(missing)],selectedCount:chapterNames.length,sourceCount:researchSourceCount};
}
function cGuardMarkup(t,p){
  const check=cPlanCompleteness(t,p);
  const label=check.ok?'Contrôle de complétude : prêt à être relu par l’administrateur.':'Contrôle de complétude : la carte ne peut pas être déclarée prête.';
  const detail=check.ok?'La proposition contient les éléments de recherche, de production et de PDF requis. La validation administrative reste distincte.':'Éléments encore manquants : '+check.missing.map(x=>x==='selected_chapters'?'chapitres B':x==='chapter_alignment'?'alignement chapitre B/C':x==='research_source'?'au moins une source':x==='quality_detail'?'contrôle qualité détaillé':x).join(', ')+'.';
  return '<div class="editor-c-plan-context '+(check.ok?'':'warning')+'"><span>Garde-fou '+C_EXECUTION_CONTRACT_VERSION+'</span><strong>'+esc(label)+'</strong><small>'+esc(detail)+' Aucun retour conversationnel ne doit être considéré comme terminé avant écriture et vérification de cette carte.</small></div>';
}
function planForm(t){
  const p=proposalFor(t),research=t.metadata?.workflow?.chapter_research&&typeof t.metadata.workflow.chapter_research==='object'?t.metadata.workflow.chapter_research:{};
  const selected=Array.isArray(t.metadata?.workflow?.selected_chapters)
    ? t.metadata.workflow.selected_chapters
    : (Array.isArray(t.metadata?.workflow?.chapters)?t.metadata.workflow.chapters:[]);
  const selectedMarkup=selected.length
    ? '<div class="editor-c-plan-context"><span>Base de travail issue de la section B</span><strong>'+esc(selected.map(x=>x?.title||x?.name||textValue(x)).join(' · '))+'</strong><small>La sélection B est conservée telle quelle. Le plan C explique comment cette matière sera transformée en document final, sans lancer de rédaction ni de PDF.</small></div>'
    : '<div class="editor-c-plan-context warning"><span>Base de travail manquante</span><strong>Aucun chapitre sélectionné</strong><small>La carte peut être préparée, mais elle ne doit pas être validée en C tant qu’un chapitre n’est pas sélectionné en B.</small></div>';
  const researchStatus=research.status||p.researchFindings||p.sources?'Recherche documentaire présente':'Recherche documentaire à renseigner';
  const sourceCount=Array.isArray(research.source_urls)?research.source_urls.length:(p.sources?String(p.sources).split('\\n').filter(Boolean).length:0);
  return '<div class="editor-plan-form">'+selectedMarkup+cGuardMarkup(t,p)+
    '<div class="editor-c-research"><div><span class="editor-section-kicker">Dossier de recherche</span><strong>'+esc(researchStatus)+'</strong><small>'+sourceCount+' source'+(sourceCount>1?'s':'')+' enregistrée'+(sourceCount>1?'s':'')+'. Les sources, constats et bases curriculaires sont éditables avant validation.</small></div></div>'+
    '<div class="editor-plan-grid editor-research-grid">'+
    field('Méthode de recherche','researchMethod',p.researchMethod,true)+field('Base curriculaire / programme','curricularBasis',p.curricularBasis,true)+field('Constats utiles à la production','researchFindings',p.researchFindings,true)+field('Sources / URLs (une par ligne)','sources',p.sources,true)+
    '</div><div class="editor-plan-divider">Stratégie pédagogique et contenu</div><div class="editor-plan-grid">'+
    field('Titre du document','title',p.title,true)+field('Chapitres / unité traitée','chapter',p.chapter,true)+field('Objectifs pédagogiques','objectives',p.objectives,true)+field('Compétences visées','competencies',p.competencies,true)+field('Prérequis','prerequisites',p.prerequisites,true)+field('Progression pédagogique','progression',p.progression,true)+
    field('Architecture / plan détaillé','architecture',p.architecture,true)+field('Stratégie de production','productionStrategy',p.productionStrategy,true)+field('Contenu à couvrir','content',p.content,true)+field('Méthodes pédagogiques','methods',p.methods,true)+field('Activités d’apprentissage','activities',p.activities,true)+field('Exemples / applications','examples',p.examples,true)+
    field('Situations / problèmes','situations',p.situations,true)+field('Exercices','exercises',p.exercises,true)+field('Corrigés / solutions','corrections',p.corrections,true)+field('Différenciation / adaptations','differentiation',p.differentiation,true)+field('Évaluation prévue','evaluation',p.evaluation,true)+
    field('Volume pédagogique','volume',p.volume)+field('Durée indicative','duration',p.duration)+field('Ressources / illustrations','resources',p.resources,true)+field('Mathématiques / GeoGebra','mathGeoGebra',p.mathGeoGebra,true)+field('Besoins techniques','technicalNeeds',p.technicalNeeds,true)+
    '</div><div class="editor-plan-divider">Paramètres du PDF et contrôle qualité</div><div class="editor-plan-grid editor-pdf-grid">'+
    field('Format','pdfFormat',p.pdfFormat)+field('Orientation','pdfOrientation',p.pdfOrientation)+field('Pagination','pdfPagination',p.pdfPagination)+field('Couleur thème','pdfThemeColor',p.pdfThemeColor)+field('Mise en page','pdfLayout',p.pdfLayout,true)+field('Polices / typographie','pdfFonts',p.pdfFonts,true)+field('En-têtes / pieds de page','pdfHeaders',p.pdfHeaders,true)+field('Ressources PDF / QR / annexes','pdfResources',p.pdfResources,true)+field('Contrôle qualité attendu','quality',p.quality,true)+field('Notes éditoriales','notes',p.notes,true)+field('Demandes de révision','revisionNotes',p.revisionNotes,true)+
    '</div><div class="editor-plan-actions"><button type="button" class="admin-btn ghost" data-plan-save="'+esc(t.id)+'">Enregistrer les modifications</button><button type="button" class="admin-btn ghost danger" data-plan-reject="'+esc(t.id)+'">Rejeter / demander une révision</button><button type="button" class="admin-btn primary" data-plan-validate="'+esc(t.id)+'">Valider le plan et passer à la production</button></div></div>';
}
function editorialContentFor(t){
  const w=t.metadata?.workflow||{},p=proposalFor(t),saved=w.editorial_content&&typeof w.editorial_content==='object'?w.editorial_content:{};
  return {title:saved.title||p.title||t.title||'',introduction:saved.introduction||'',content:saved.content||p.content||'',methods:saved.methods||p.methods||'',examples:saved.examples||p.examples||'',activities:saved.activities||p.activities||'',exercises:saved.exercises||p.exercises||'',corrections:saved.corrections||p.corrections||'',differentiation:saved.differentiation||p.differentiation||'',evaluation:saved.evaluation||p.evaluation||'',synthesis:saved.synthesis||'',notes:saved.notes||''};
}
function productionReadyMarkup(t){
  const w=t.metadata?.workflow||{},p=proposalFor(t),e=editorialContentFor(t);
  const hasSaved=Boolean(w.editorial_content?.updated_at);
  return '<div class="editor-validation-wrap"><div class="editor-validation-head"><div><span class="editor-step">Section D · édition finale</span><h5>'+esc(t.title||'Document')+'</h5><p>La fiche C validée est la référence. L’édition finale doit être persistée avant l’envoi vers « Documents en attente ». Le PDF reste manuel.</p></div><span class="editor-pro-pill '+(hasSaved?'ready':'admin')+'">'+(hasSaved?'Édition enregistrée':'À éditer')+'</span></div>'+
    '<div class="editor-c-ready-grid"><div><span>Chapitre</span><strong>'+esc(p.chapter||'—')+'</strong></div><div><span>Objectifs</span><strong>'+esc(p.objectives||'—')+'</strong></div><div><span>Architecture</span><strong>'+esc(p.architecture||'—')+'</strong></div><div><span>PDF</span><strong>Manuel uniquement</strong></div></div>'+
    '<div class="editor-plan-grid">'+
    field('Titre final','editorTitle',e.title,true)+field('Introduction / situation de départ','editorIntroduction',e.introduction,true)+field('Contenu du cours','editorContent',e.content,true)+field('Méthodes / démarches','editorMethods',e.methods,true)+field('Exemples / applications','editorExamples',e.examples,true)+field('Activités','editorActivities',e.activities,true)+field('Exercices','editorExercises',e.exercises,true)+field('Corrigés / solutions','editorCorrections',e.corrections,true)+field('Différenciation','editorDifferentiation',e.differentiation,true)+field('Évaluation','editorEvaluation',e.evaluation,true)+field('Synthèse / à retenir','editorSynthesis',e.synthesis,true)+field('Notes éditoriales','editorNotes',e.notes,true)+
    '</div><div class="editor-plan-actions"><button type="button" class="admin-btn ghost" data-d-save="'+esc(t.id)+'">Enregistrer l’édition</button><button type="button" class="admin-btn primary" data-d-finish="'+esc(t.id)+'">Terminer l’édition → Documents en attente</button></div></div>';
}
function detail(t,section){
  const w=t.metadata?.workflow||{},d='<div class="editor-detail-head"><div><span class="editor-step">Section '+section+' · tâche #'+esc(t.id)+'</span><h4>'+esc(t.class_name||t.level||'')+' · '+esc(t.subject||'')+'</h4><p>État : <strong>'+esc((stageInfo[w.stage]||{}).label||w.stage||t.status)+'</strong></p></div><button type="button" class="admin-btn ghost" data-editor-close>Fermer</button></div>';
  const sourceUrls=Array.isArray(w.chapter_research?.source_urls)?w.chapter_research.source_urls:[];
  const meta='<div class="editor-detail-meta"><div><span>Identité</span><strong>'+esc(t.title||'')+'</strong></div><div><span>Type</span><strong>'+esc(t.document_type||'cours')+'</strong></div><div><span>Recherche</span><strong>'+esc(sourceUrls.length||((w.proposal?.sources?String(w.proposal.sources).split('\\n').filter(Boolean).length:0)))+' source(s)</strong></div><div><span>Version du plan</span><strong>'+esc(w.proposal_version||0)+'</strong></div></div>';
  if(section==='B')return d+meta+'<h5 class="editor-detail-title">Chapitres disponibles</h5>'+chaptersMarkup(t);
  if(section==='C'||section==='CX')return d+meta+'<h5 class="editor-detail-title">Plan complet de production</h5>'+planForm(t);
  if(section==='D')return d+meta+'<h5 class="editor-detail-title">Production autorisée / suivi de rédaction</h5>'+productionReadyMarkup(t);
  const researchReady=aResearchReady(t),r=aResearchFor(t),options=Array.isArray(w.chapter_options)?w.chapter_options:[];
  return d+meta+'<div class="editor-a-start"><strong>'+esc(researchReady?'Recherche et propositions persistées : la tâche peut passer en B.':'Cette tâche attend notre récupération et sa recherche documentaire.')+'</strong><span>'+esc(researchReady?'La migration sera effectuée seulement après une nouvelle lecture de Supabase et une vérification des sources et chapitres.':'Aucune migration vers B ne doit être faite tant que la recherche, ses sources et les propositions de chapitres ne sont pas écrites dans la tâche.')+'</span>'+(researchReady?'<div class="editor-plan-actions"><button type="button" class="admin-btn primary" data-a-promote="'+esc(t.id)+'">Transférer en B après vérification</button></div>':'')+'</div>';
}
function render(root,state){
  const all=state.tasks, groups={A:[],B:[],C:[],CX:[],D:[]};
  all.forEach(t=>{const g=classify(t);if(g)groups[g].push(t)});
  const active=state.section||'A',items=groups[active],page=state.pages[active]||0,visible=paginate(items,page);
  root.innerHTML=
  '<div class="editor-hub">'+
    '<div class="editor-hub-head"><div><span class="editor-kicker">Parcours éditorial</span><h3>Gestion des documents</h3><p>Un seul parcours, de la demande jusqu’à l’édition finale. Aucun PDF n’est lancé automatiquement.</p></div><button type="button" class="admin-btn ghost" id="editorRefresh">↻ Actualiser</button></div>'+
    '<nav class="editor-main-nav" aria-label="Étapes du parcours éditorial">'+
      ['A','B','C','CX','D'].map(k=>'<button type="button" class="editor-main-nav-item '+(active===k?'active':'')+'" data-editor-section="'+k+'"><span>'+k+'</span><strong>'+({A:'Tâches',B:'Chapitres',C:'Production',CX:'Plans traités',D:'Édition finale'}[k])+'</strong><em>'+groups[k].length+'</em></button>').join('')+
      '<button type="button" class="editor-main-nav-link" data-editor-documents>Documents en attente <span>→</span></button>'+
    '</nav>'+
    '<section class="editor-page">'+
      '<div class="editor-page-title"><div><span class="editor-step">Section '+active+'</span><h4>'+({A:'Tâches à créer',B:'Chapitres disponibles',C:'Plan complet de production',CX:'Plans C déjà traités',D:'Édition finale / suivi de production'}[active])+'</h4><p>'+({A:'Crée ici les demandes avec une sélection claire et agrandie du niveau, du parcours, de la classe et de la matière.',B:'Chaque tâche récupérée présente les chapitres disponibles pour le document.',C:'Les tâches non encore traitées en C sont construites ici.',CX:'Cette zone conserve les documents dont le travail C est déjà traité et vérifié. Le plan reste consultable et modifiable avant la suite.',D:'Les documents passés après CX arrivent ici pour la rédaction finale. Aucun PDF n’est lancé automatiquement.'}[active])+'</p></div><span class="editor-page-count">'+items.length+' document'+(items.length>1?'s':'')+'</span></div>'+
      (active==='A'?'<div class="editor-create-card"><div><span class="editor-step">Créer</span><h5>Nouvelle demande</h5><p>Le classement reprend exactement le cheminement du formulaire de dépôt : niveau → parcours/emplacement → classe → matière. Les choix restent ouverts pendant le défilement et aucune valeur libre n’est acceptée.</p></div><div class="editor-create-fields"><label>Type<select id="editorType"><option value="cours">Cours</option><option value="exercices">Exercices</option><option value="qcm">QCM</option><option value="fiches">Fiches</option></select></label><div class="editor-classification"><button type="button" class="editor-classification-trigger" id="editorClassificationTrigger" aria-expanded="false"><span id="editorClassificationSummary">Choisir le niveau et l’emplacement…</span><span aria-hidden="true">⌄</span></button><div class="editor-classification-panel" id="editorClassificationPanel" hidden><div class="editor-classification-section"><span class="editor-classification-label">1 · Niveau</span><div class="editor-option-scroll" id="editorRootOptions"></div></div><div class="editor-classification-section" id="editorRouteSection" hidden><span class="editor-classification-label">2 · Parcours / emplacement</span><div class="editor-option-scroll" id="editorRouteOptions"></div></div><div class="editor-classification-section" id="editorSubjectSection" hidden><span class="editor-classification-label">3 · Matière</span><div class="editor-option-scroll" id="editorSubjectOptions"></div></div></div></div><button type="button" class="admin-btn primary" id="editorCreate">Créer la tâche</button></div></div>':'')+
      '<div class="editor-block-label"><span>Bloc '+(page+1)+'</span><small>'+((page*PAGE_SIZE)+1)+'–'+Math.min((page+1)*PAGE_SIZE,items.length)+' sur '+items.length+'</small></div>'+
      '<div class="editor-card-grid">'+(visible.length?visible.map(t=>taskCard(t,active)).join(''):'<div class="editor-empty">Aucun document dans cette étape pour le moment.</div>')+'</div>'+
      pager(items.length,page,active)+
      '<section class="editor-detail" id="editorDetail" hidden></section>'+
    '</section>'+
  '</div>';
  bind(root,state);
}
function bind(root,state){
  root.querySelector('#editorRefresh')?.addEventListener('click',chargerEspaceEditorialChatGPT);
  root.querySelectorAll('[data-editor-section]').forEach(b=>b.addEventListener('click',()=>{state.section=b.dataset.editorSection;state.pages[state.section]=0;render(root,state)}));
  root.querySelector('[data-editor-documents]')?.addEventListener('click',()=>{
    const b=[...document.querySelectorAll('.admin-tab')].find(x=>x.dataset.tab==='attente');
    if(b)b.click();
  });
  root.querySelectorAll('[data-editor-page]').forEach(b=>b.addEventListener('click',()=>{const [k,p]=b.dataset.editorPage.split(':');state.section=k;state.pages[k]=Number(p);render(root,state)}));
  const pickerState={root:null,route:null,subject:''};
  const pickerPanel=root.querySelector('#editorClassificationPanel');
  const pickerTrigger=root.querySelector('#editorClassificationTrigger');
  const summary=root.querySelector('#editorClassificationSummary');
  const rootOptions=root.querySelector('#editorRootOptions');
  const routeSection=root.querySelector('#editorRouteSection');
  const routeOptions=root.querySelector('#editorRouteOptions');
  const subjectSection=root.querySelector('#editorSubjectSection');
  const subjectOptions=root.querySelector('#editorSubjectOptions');
  const renderSubjects=()=>{
    if(!subjectOptions||!subjectSection)return;
    const leaf=pickerState.route?.leaf;
    const raw=Array.isArray(leaf?.matieres)?leaf.matieres:(Array.isArray(MATIERES)?MATIERES:[]);
    const base=typeof matieresAvecAutres==='function'?matieresAvecAutres(raw):raw;
    const names=[...new Set(base.map(x=>typeof x==='string'?x:(x?.nom||'')).map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
    subjectOptions.innerHTML=names.length?names.map(x=>'<button type="button" class="editor-option '+(pickerState.subject===x?'selected':'')+'" data-editor-subject="'+esc(x)+'">'+esc(x)+'</button>').join(''):'<div class="editor-option-empty">Aucune matière disponible pour ce parcours.</div>';
    subjectSection.hidden=!pickerState.route||!names.length;
  };
  const updateSummary=()=>{
    const path=pickerState.route?.path||[];
    const labels=path.map(n=>String(n?.nom||'').trim()).filter(Boolean);
    if(pickerState.subject)labels.push(pickerState.subject);
    summary.textContent=labels.length?labels.join(' · '):'Choisir le niveau et l’emplacement…';
    pickerTrigger?.setAttribute('aria-expanded',String(!pickerPanel.hidden));
  };
  const renderRoutes=()=>{
    if(!routeOptions||!routeSection)return;
    const routes=pickerState.root?editorLeafRoutes(pickerState.root):[];
    routeOptions.innerHTML=routes.length?routes.map((x,i)=>'<button type="button" class="editor-option '+(pickerState.route===x?'selected':'')+'" data-editor-route="'+i+'">'+esc(x.label)+'</button>').join(''):'';
    routeSection.hidden=!pickerState.root;
    renderSubjects();
  };
  const renderRoots=()=>{
    if(!rootOptions)return;
    const roots=editorClassificationRoots();
    rootOptions.innerHTML=roots.map(x=>'<button type="button" class="editor-option '+(pickerState.root?.id===x.id?'selected':'')+'" data-editor-root="'+esc(x.id)+'">'+esc(x.nom)+'</button>').join('');
    renderRoutes();
  };
  renderRoots();
  pickerTrigger?.addEventListener('click',e=>{
    e.preventDefault();
    if(pickerPanel)pickerPanel.hidden=!pickerPanel.hidden;
    updateSummary();
  });
  rootOptions?.addEventListener('click',e=>{
    const b=e.target?.closest?.('[data-editor-root]');if(!b)return;
    const n=editorClassificationRoots().find(x=>x.id===b.dataset.editorRoot);if(!n)return;
    pickerState.root=n;pickerState.route=null;pickerState.subject='';renderRoots();updateSummary();
  });
  routeOptions?.addEventListener('click',e=>{
    const b=e.target?.closest?.('[data-editor-route]');if(!b)return;
    const routes=pickerState.root?editorLeafRoutes(pickerState.root):[],choice=routes[Number(b.dataset.editorRoute)];if(!choice)return;
    pickerState.route=choice;pickerState.subject='';renderRoutes();updateSummary();
  });
  subjectOptions?.addEventListener('click',e=>{
    const b=e.target?.closest?.('[data-editor-subject]');if(!b)return;
    pickerState.subject=String(b.dataset.editorSubject||'');renderSubjects();updateSummary();
  });
  root.querySelector('#editorCreate')?.addEventListener('click',async()=>{
    const typ=(root.querySelector('#editorType')?.value||'').trim(),cls=String(pickerState.route?.leaf?.nom||'').trim(),sub=pickerState.subject.trim();
    if(!cls||!sub||!pickerState.root||!pickerState.route||!['cours','exercices','qcm','fiches'].includes(typ)){alert('Choisis un type, un niveau, un parcours/emplacement et une matière dans le sélecteur.');return}
    const b=root.querySelector('#editorCreate');b.disabled=true;
    const path=(pickerState.route.path||[]).map(n=>String(n?.nom||'').trim()).filter(Boolean);
    try{await createTask(cls,sub,typ,{level:pickerState.root.nom,location:path.join(' · '),path});await chargerEspaceEditorialChatGPT()}catch(e){alert('Impossible de créer la tâche : '+(e.message||e))}finally{b.disabled=false}
  });
  
  root.querySelectorAll('[data-editor-open]').forEach(b=>b.addEventListener('click',async()=>{
    const t=await getJob(Number(b.dataset.editorOpen));if(!t)return;
    const d=root.querySelector('#editorDetail');d.hidden=false;d.innerHTML=detail(t,state.section);bindDetail(d,t,state);
    d.scrollIntoView({behavior:'smooth',block:'nearest'});
  }));
}
function bindDetail(d,t,state){
  d.querySelector('[data-editor-close]')?.addEventListener('click',()=>{d.hidden=true});
  d.querySelector('[data-a-promote]')?.addEventListener('click',async()=>{
    const button=d.querySelector('[data-a-promote]');if(button)button.disabled=true;
    try{
      await promoteAtoB(Number(t.id));
      alert('Recherche vérifiée et tâche transférée en B.');
      await chargerEspaceEditorialChatGPT();
    }catch(e){
      alert(e.message||e);
      if(button)button.disabled=false;
    }
  });
  d.querySelector('[data-chapters-toggle]')?.addEventListener('click',()=>{
    const box=d.querySelector('.editor-chapters-selection'),btn=d.querySelector('[data-chapters-toggle]');
    if(!box||!btn)return; box.hidden=!box.hidden; btn.innerHTML=box.hidden?'Choisir les chapitres <span>＋</span>':'Masquer les chapitres <span>−</span>';
  });
  d.querySelector('[data-chapters-save]')?.addEventListener('click',async()=>{
    const proposals=chapterProposalsFor(t),selected=[];
    d.querySelectorAll('[data-chapter-choice]').forEach(el=>{
      if(el.checked&&proposals[Number(el.dataset.chapterChoice)])selected.push(proposals[Number(el.dataset.chapterChoice)])
    });
    if(!selected.length){alert('Sélectionne au moins un chapitre avant d’enregistrer.');return}
    const button=d.querySelector('[data-chapters-save]');
    if(button)button.disabled=true;
    try{
      const fresh=await getJob(t.id);
      if(!fresh||!aResearchReady(fresh))throw new Error('Garde-fou B : le contexte et la recherche A ne sont pas suffisamment persistés et vérifiés.');
      const fw=fresh.metadata?.workflow||{};
      const available=new Set((Array.isArray(fw.chapter_options)?fw.chapter_options:[]).map(x=>String(x?.title||x?.name||x)));
      if(!selected.every(x=>available.has(String(x?.title||x?.name||x))))throw new Error('Garde-fou B : une sélection ne provient pas des propositions persistées.');
      const updated=await updateJob(t.id,{
        chapters:selected,
        selected_chapters:selected,
        selected_chapter:selected[0]||null,
        b_context_assimilation:{
          acknowledged:true,
          acknowledged_at:new Date().toISOString(),
          source_stage:fw.stage,
          summary:'Contexte A, recherche, sources et propositions relus avant sélection.',
          selected_from_persisted_options:selected.map(x=>x.title||x.name||String(x))
        },
        execution_contract:B_EXECUTION_CONTRACT,
        execution_contract_acknowledged:true,
        completion_guard:B_EXECUTION_CONTRACT_VERSION,
        stage:'proposition_editoriale',
        proposal_status:'awaiting_chatgpt_plan',
        rejected:false,
        revision_requested:false
      });
      const uw=updated?.metadata?.workflow||{};
      if(!bSelectionReady(updated))throw new Error('Garde-fou B : la sélection n’a pas pu être confirmée après relecture de Supabase.');
      if(uw.stage!=='proposition_editoriale')throw new Error('Garde-fou B : la transition vers C n’a pas été confirmée.');
      await chargerEspaceEditorialChatGPT()
    }catch(e){
      if(button)button.disabled=false;
      alert(e.message||e)
    }
  });
  const collectPlan=()=>{
    const p=proposalFor(t);
    d.querySelectorAll('[data-plan-field]').forEach(el=>p[el.dataset.planField]=el.value.trim());
    return p;
  };
  const selectedChapters=()=>{
    const w=t.metadata?.workflow||{};
    return Array.isArray(w.selected_chapters)?w.selected_chapters:(Array.isArray(w.chapters)?w.chapters:[]);
  };
  const persistPlan=async(statusStage='proposal_review',status='ready_for_admin_validation')=>{
    const selected=selectedChapters();
    if(!selected.length)throw new Error('Le plan ne peut pas être enregistré : aucun chapitre validé en section B.');
    const p=collectPlan();
    const guard=cPlanCompleteness(t,p);
    if(!guard.ok)throw new Error('Garde-fou C : plan incomplet. Champs/contrôles manquants : '+guard.missing.join(', '));
    return updateJob(t.id,{
      proposal:p,
      proposal_version:Number(t.metadata?.workflow?.proposal_version||0)+1,
      proposal_status:status,
      stage:statusStage,
      rejected:false,
      revision_requested:false,
      user_validated:statusStage==='edition_ready',
      revision_note:statusStage==='edition_ready'?'':(p.revisionNotes||t.metadata?.workflow?.revision_note||''),
      manual_pdf_launch_required:true,
      auto_pdf_launch:false
    });
  };
  d.querySelector('[data-plan-save]')?.addEventListener('click',async()=>{
    const button=d.querySelector('[data-plan-save]');if(button)button.disabled=true;
    try{
      const updated=await persistPlan();
      if(!updated?.metadata?.workflow?.proposal)throw new Error('Le plan n’a pas pu être confirmé après enregistrement.');
      alert('Plan enregistré et prêt pour validation.');
      await chargerEspaceEditorialChatGPT()
    }catch(e){alert(e.message||e)}finally{if(button)button.disabled=false}
  });
  d.querySelector('[data-plan-reject]')?.addEventListener('click',async()=>{
    const reason=d.querySelector('[data-plan-field="revisionNotes"]')?.value.trim()||'';
    if(!reason&&!confirm('Aucune demande de révision n’est renseignée. Rejeter quand même cette carte ?'))return;
    try{
      await updateJob(t.id,{stage:'revision_requested',proposal_status:'revision_requested',rejected:true,revision_requested:true,revision_note:reason,user_validated:false});
      await chargerEspaceEditorialChatGPT()
    }catch(e){alert(e.message||e)}
  });
  d.querySelector('[data-plan-validate]')?.addEventListener('click',async()=>{
    const button=d.querySelector('[data-plan-validate]');if(button)button.disabled=true;
    try{
      const updated=await persistPlan('edition_ready','validated_for_editing');
      const wf=updated?.metadata?.workflow||{};
      if(wf.stage!=='edition_ready'||wf.proposal_status!=='validated_for_editing')throw new Error('La validation du plan n’a pas pu être confirmée.');
      const migrated=await updateJob(t.id,{user_validated:true,editor_ready:true,chatgpt_editable:true,auto_pdf_launch:false,manual_pdf_launch_required:true,proposal_status:'validated_for_editing',stage:'redaction',production_status:'ready_for_editing',production_started_at:null,execution_contract:D_EXECUTION_CONTRACT,execution_contract_acknowledged:true,completion_guard:D_EXECUTION_CONTRACT_VERSION},'draft');
      if(migrated?.metadata?.workflow?.stage!=='redaction')throw new Error('La migration CX → D n’a pas pu être confirmée après relecture de Supabase.');
      await chargerEspaceEditorialChatGPT();
    }catch(e){alert(e.message||e)}finally{if(button)button.disabled=false}
  });

  const collectEditorial=()=>{
    const e=editorialContentFor(t);
    const map={editorTitle:'title',editorIntroduction:'introduction',editorContent:'content',editorMethods:'methods',editorExamples:'examples',editorActivities:'activities',editorExercises:'exercises',editorCorrections:'corrections',editorDifferentiation:'differentiation',editorEvaluation:'evaluation',editorSynthesis:'synthesis',editorNotes:'notes'};
    d.querySelectorAll('[data-plan-field]').forEach(el=>{const key=map[el.dataset.planField];if(key)e[key]=el.value.trim()});
    return e;
  };
  const editorialPayload=e=>({title:e.title,sections:[
    {title:'Introduction et situation de départ',content:e.introduction},
    {title:'Contenu du cours',content:e.content},
    {title:'Méthodes et démarches',content:e.methods},
    {title:'Exemples et applications',content:e.examples},
    {title:'Activités',content:e.activities},
    {title:'Exercices',content:e.exercises,exercises:String(e.exercises||'').split(/\\n+/).map(x=>x.trim()).filter(Boolean)},
    {title:'Corrigés et solutions',content:e.corrections},
    {title:'Différenciation',content:e.differentiation},
    {title:'Évaluation',content:e.evaluation},
    {title:'Synthèse',content:e.synthesis}
  ].filter(x=>x.content||x.title==='Contenu du cours')});
  const LATEX_CONVERSION_GUARD_VERSION='d-scientific-latex-400-v1';
  const LATEX_CONVERSION_GUARD_MIN=400;
  function isScientificDocument(t){
    const subject=String(t?.subject||'').toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    return /(^|[^a-z])(maths|mathematiques|mathematique|physique|chimie)([^a-z]|$)/i.test(subject)
      || subject.includes('physique-chimie')
      || subject.includes('physique chimie');
  }
  function latexConversionGuard(t,e){
    if(!isScientificDocument(t))return {required:false,ok:true,count:null,minimum:LATEX_CONVERSION_GUARD_MIN,version:LATEX_CONVERSION_GUARD_VERSION};
    const text=Object.entries(e||{}).filter(([k])=>k!=='title').map(([,v])=>String(v||'')).join('\n');
    const elements=[];
    const pushMatches=(re,label)=>{
      const matches=text.match(re)||[];
      matches.forEach(x=>elements.push({label,raw:x}));
    };
    // Éléments déjà explicitement balisés en LaTeX : ils sont considérés comme convertis.
    pushMatches(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g,'latex');
    // Éléments mathématiques encore écrits en notation courante et convertibles en LaTeX.
    pushMatches(/(?:[A-Za-zÀ-ÿ](?:[_^][A-Za-z0-9]+)?|\d+(?:[,.]\d+)?)\s*(?:=|≈|≠|≤|≥|<|>|→|↔|\+|−|-|×|÷|\/|\^|√)\s*(?:[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9_.,^()]*)(?:\s*(?:=|≈|≠|≤|≥|<|>|→|↔|\+|−|-|×|÷|\/|\^|√)\s*(?:[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9_.,^()]*)+)*/g,'convertible_formula');
    pushMatches(/\b(?:sin|cos|tan|ln|log|exp|lim|sqrt|racine|intégrale|derivee|dérivée)\s*(?:[_^{(][^\n]{1,80})/gi,'convertible_function');
    pushMatches(/\b\d+(?:[,.]\d+)?\s*(?:×|x|\*|·)\s*10(?:\^|\s*\^\s*)[-+]?\d+/g,'scientific_notation');
    pushMatches(/\b\d+(?:[,.]\d+)?\s*(?:mol|g|kg|m|cm|mm|L|mL|K|Pa|J|N|V|A|Ω|Hz|s)\b/g,'scientific_quantity');
    // Déduplique les mêmes segments détectés par plusieurs familles de motifs.
    const seen=new Set(),unique=[];
    elements.forEach(item=>{
      const key=item.label+'|'+item.raw.trim();
      if(!seen.has(key)){seen.add(key);unique.push(item);}
    });
    const count=unique.length;
    return {required:true,ok:count>=LATEX_CONVERSION_GUARD_MIN,count,minimum:LATEX_CONVERSION_GUARD_MIN,version:LATEX_CONVERSION_GUARD_VERSION,
      status:count>=LATEX_CONVERSION_GUARD_MIN?'passed':'blocked',
      message:count>=LATEX_CONVERSION_GUARD_MIN
        ?'Garde-fou scientifique LaTeX validé : '+count+' éléments convertibles/convertis détectés (minimum '+LATEX_CONVERSION_GUARD_MIN+').'
        :'Insertion bloquée : '+count+' éléments convertibles/convertis en LaTeX détectés, alors que '+LATEX_CONVERSION_GUARD_MIN+' sont requis pour un document de mathématiques, physique ou chimie. Compléter la conversion LaTeX puis relancer la vérification.'
    };
  }
  const saveEditorial=async()=>{
    const e=collectEditorial();
    if(!e.title)throw new Error('Le titre final est obligatoire.');
    if(!e.content)throw new Error('Le contenu final est obligatoire.');
    const updated=await updateJob(t.id,{editorial_content:{...e,updated_at:new Date().toISOString(),editor:EDITOR,source_plan_version:Number(t.metadata?.workflow?.proposal_version||0)},stage:'production_en_cours',production_status:'editorial_in_progress',execution_contract:D_EXECUTION_CONTRACT,execution_contract_acknowledged:true,completion_guard:D_EXECUTION_CONTRACT_VERSION,auto_pdf_launch:false,manual_pdf_launch_required:true},'draft');
    if(updated?.metadata?.workflow?.stage!=='production_en_cours')throw new Error('L’édition D n’a pas pu être confirmée après relecture de Supabase.');
    return {updated,e};
  };
  d.querySelector('[data-d-save]')?.addEventListener('click',async()=>{
    const button=d.querySelector('[data-d-save]');if(button)button.disabled=true;
    try{await saveEditorial();alert('Édition enregistrée dans la tâche D.');await chargerEspaceEditorialChatGPT()}catch(e){alert(e.message||e)}finally{if(button)button.disabled=false}
  });
  d.querySelector('[data-d-finish]')?.addEventListener('click',async()=>{
    const button=d.querySelector('[data-d-finish]');if(button)button.disabled=true;
    try{
      const {e}=await saveEditorial();
      const fresh=await getJob(t.id),fw=fresh?.metadata?.workflow||{};
      if(!fresh||!fw.editorial_content?.updated_at)throw new Error('Garde-fou D : la production éditoriale n’est pas persistée.');
      const latexGuard=latexConversionGuard(fresh,e);
      if(latexGuard.required){
        await updateJob(t.id,{latex_conversion_guard:{...latexGuard,checked_at:new Date().toISOString(),editor:EDITOR}});
        if(!latexGuard.ok)throw new Error(latexGuard.message);
      }
      const ingestId='AUR-D-'+t.id+'-v'+Number(fw.proposal_version||1);
      const payload={ingest_id:ingestId,job_id:Number(t.id),title:e.title,subject:t.subject,level:t.level,class_name:t.class_name,document_type:t.document_type||'cours',content_json:editorialPayload(e),instructions:{category:'Documents',source:'Aurore — Section D',workflow_stage:'edition',manual_pdf_launch_required:true},metadata:{origin:'Aurore — Section D',source_job_id:t.id,chapter:proposalFor(fresh).chapter,workflow_stage:'edition',auto_pdf_launch:false,manual_pdf_launch_only:true},matiere:t.subject,theme_color:proposalFor(fresh).pdfThemeColor||'#6D28D9'};
      const ingested=await rpc('aurora_connector_ingest_editorial_document',{p_payload:payload});
      const docId=Number(ingested?.generated_document_id);
      if(!Number.isSafeInteger(docId)||docId<1)throw new Error('Le pont éditorial n’a pas retourné de generated_document_id.');
      const done=await updateJob(t.id,{stage:'production_terminee',production_status:'editorial_completed',production_completed_at:new Date().toISOString(),generated_document_id:docId,pending_admin_surface:'documents_en_attente',editorial_ingest_id:ingestId,auto_pdf_launch:false,manual_pdf_launch_required:true,execution_contract:D_EXECUTION_CONTRACT,completion_guard:D_EXECUTION_CONTRACT_VERSION},'review');
      if(done?.metadata?.workflow?.generated_document_id!==docId||done?.metadata?.workflow?.stage!=='production_terminee')throw new Error('Garde-fou D : la production terminée n’a pas été confirmée.');
      alert('Édition terminée : document envoyé vers « Documents en attente ». PDF non lancé.');
      await chargerEspaceEditorialChatGPT();
    }catch(e){alert(e.message||e)}finally{if(button)button.disabled=false}
  });

  d.querySelector('[data-admin-validate]')?.addEventListener('click',async()=>{
    const checks={};d.querySelectorAll('[data-admin-check]').forEach(x=>checks[x.dataset.adminCheck]=x.checked);
    const notes=d.querySelector('[data-admin-notes]')?.value.trim()||'';
    const all=Object.values(checks).every(Boolean);
    if(!all){alert('Toutes les validations administratives doivent être cochées avant de rendre le document prêt pour l’édition.');return}
    try{
      await updateJob(t.id,{
        stage:'edition_ready',
        editor_ready:true,
        chatgpt_editable:true,
        proposal_status:'validated_for_editing',
        admin_validation:{...checks,notes,status:'validated',validated_at:new Date().toISOString()}
      });
      await chargerEspaceEditorialChatGPT()
    }catch(e){alert(e.message||e)}
  });
  d.querySelector('[data-admin-reject]')?.addEventListener('click',async()=>{
    const notes=d.querySelector('[data-admin-notes]')?.value.trim()||'';
    try{await updateJob(t.id,{stage:'revision_requested',admin_validation:{status:'rejected',notes,updated_at:new Date().toISOString()},revision_requested:true,rejected:false});await chargerEspaceEditorialChatGPT()}catch(e){alert(e.message||e)}
  });
}
function injectStyle(){
  if(document.getElementById('aurore-editorial-v2-styles'))return;
  const s=document.createElement('style');s.id='aurore-editorial-v2-styles';s.textContent=`
#auroreEditorialTaskAdmin{--editor-surface:var(--card-bg,#fff);--editor-surface-soft:color-mix(in srgb,currentColor 3%,transparent);--editor-border:color-mix(in srgb,currentColor 12%,transparent);--editor-text:currentColor;--editor-accent:#6D28D9;color:var(--editor-text);display:grid;gap:16px}
#auroreEditorialTaskAdmin .editor-hub{display:grid;gap:14px}
#auroreEditorialTaskAdmin .editor-hub-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:4px 2px}
#auroreEditorialTaskAdmin .editor-kicker,#auroreEditorialTaskAdmin .editor-step{font-size:.62rem;font-weight:900;letter-spacing:.09em;text-transform:uppercase;opacity:.55}
#auroreEditorialTaskAdmin .editor-hub-head h3{margin:5px 0 6px;font-size:1.25rem}
#auroreEditorialTaskAdmin .editor-hub-head p,#auroreEditorialTaskAdmin .editor-page-title p,#auroreEditorialTaskAdmin .editor-create-card p,#auroreEditorialTaskAdmin .editor-validation-head p{margin:0;font-size:.72rem;line-height:1.5;opacity:.68}
#auroreEditorialTaskAdmin .editor-main-nav{display:flex;gap:5px;align-items:stretch;overflow:auto;padding:5px;border:1px solid var(--editor-border);border-radius:16px;background:var(--editor-surface-soft)}
#auroreEditorialTaskAdmin .editor-main-nav-item,#auroreEditorialTaskAdmin .editor-main-nav-link{border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;cursor:pointer}
#auroreEditorialTaskAdmin .editor-main-nav-item{min-width:132px;padding:10px 12px;display:grid;grid-template-columns:auto 1fr auto;gap:7px;align-items:center;text-align:left}
#auroreEditorialTaskAdmin .editor-main-nav-item span{font-size:.72rem;font-weight:950;opacity:.45}
#auroreEditorialTaskAdmin .editor-main-nav-item strong{font-size:.68rem;white-space:nowrap}
#auroreEditorialTaskAdmin .editor-main-nav-item em{font-style:normal;font-size:.58rem;font-weight:900;opacity:.6}
#auroreEditorialTaskAdmin .editor-main-nav-item:hover,#auroreEditorialTaskAdmin .editor-main-nav-item.active{background:color-mix(in srgb,var(--editor-accent) 10%,var(--editor-surface));box-shadow:0 5px 18px rgba(0,0,0,.05)}
#auroreEditorialTaskAdmin .editor-main-nav-item.active span{color:var(--editor-accent);opacity:1}
#auroreEditorialTaskAdmin .editor-main-nav-link{margin-left:auto;padding:10px 13px;font-size:.65rem;font-weight:900;white-space:nowrap;border-left:1px solid var(--editor-border);padding-left:16px}
#auroreEditorialTaskAdmin .editor-main-nav-link span{font-size:1rem}
#auroreEditorialTaskAdmin .editor-page{display:grid;gap:13px;padding:18px;border:1px solid var(--editor-border);border-radius:22px;background:var(--editor-surface)}
#auroreEditorialTaskAdmin .editor-page-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
#auroreEditorialTaskAdmin .editor-page-title h4{margin:5px 0 5px;font-size:1rem}
#auroreEditorialTaskAdmin .editor-page-count{font-size:.62rem;font-weight:900;opacity:.55;white-space:nowrap}
@media(min-width:721px){#auroreEditorialTaskAdmin .editor-create-card{grid-template-columns:minmax(260px,.7fr) minmax(0,1.8fr);}}
#auroreEditorialTaskAdmin .editor-create-card{display:grid;grid-template-columns:minmax(0,1fr) minmax(410px,1.1fr);gap:18px;align-items:end;padding:22px;border-radius:18px;border:1px solid color-mix(in srgb,var(--editor-accent) 18%,var(--editor-border));background:linear-gradient(135deg,color-mix(in srgb,var(--editor-accent) 10%,var(--editor-surface)),var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-create-card h5{margin:5px 0 6px;font-size:.95rem}
#auroreEditorialTaskAdmin .editor-create-fields{display:grid;grid-template-columns:minmax(150px,.55fr) minmax(360px,1.9fr) auto;gap:12px;align-items:start}
#auroreEditorialTaskAdmin .editor-classification{position:relative;min-width:0}
#auroreEditorialTaskAdmin .editor-classification-trigger{width:100%;min-height:41px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;border:1px solid var(--editor-border);border-radius:11px;background:var(--editor-surface);color:inherit;font:inherit;font-size:.67rem;font-weight:800;cursor:pointer;text-align:left}
#auroreEditorialTaskAdmin .editor-classification-trigger:hover{border-color:color-mix(in srgb,var(--editor-accent) 35%,var(--editor-border))}
#auroreEditorialTaskAdmin .editor-classification-panel{position:absolute;z-index:1200;left:0;right:0;top:calc(100% + 7px);padding:16px;border:1px solid color-mix(in srgb,var(--editor-accent) 22%,var(--editor-border));border-radius:15px;background:var(--editor-surface);box-shadow:0 18px 45px rgba(0,0,0,.18)}
#auroreEditorialTaskAdmin .editor-classification-panel[hidden]{display:none}
#auroreEditorialTaskAdmin .editor-classification-section{display:grid;gap:6px;margin-bottom:9px}
#auroreEditorialTaskAdmin .editor-classification-section:last-child{margin-bottom:0}
#auroreEditorialTaskAdmin .editor-classification-label{font-size:.58rem;font-weight:950;letter-spacing:.05em;text-transform:uppercase;opacity:.55}
#auroreEditorialTaskAdmin .editor-option-scroll{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;max-height:190px;overflow-y:auto;overflow-x:hidden;max-width:100%;padding:4px 2px 8px;scrollbar-width:thin;overscroll-behavior:contain}
#auroreEditorialTaskAdmin .editor-option-scroll::-webkit-scrollbar{height:6px}
#auroreEditorialTaskAdmin .editor-option{min-height:43px;border:1px solid var(--editor-border);border-radius:10px;background:color-mix(in srgb,currentColor 3%,var(--editor-surface));color:inherit;padding:8px 10px;font:inherit;font-size:.62rem;font-weight:800;cursor:pointer;text-align:left;white-space:nowrap}
#auroreEditorialTaskAdmin .editor-option:hover,#auroreEditorialTaskAdmin .editor-option.selected{border-color:var(--editor-accent);background:color-mix(in srgb,var(--editor-accent) 10%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-option-empty{padding:9px;font-size:.61rem;opacity:.55}
#auroreEditorialTaskAdmin .editor-create-fields label,#auroreEditorialTaskAdmin .editor-field{display:grid;gap:5px;font-size:.62rem;font-weight:850}
#auroreEditorialTaskAdmin .editor-create-fields select{font:inherit;color:inherit;background:var(--editor-surface);border:1px solid var(--editor-border);border-radius:11px;padding:10px 11px;min-height:41px}
#auroreEditorialTaskAdmin .editor-create-fields #editorCreate{min-height:41px}

#auroreEditorialTaskAdmin .editor-create-fields label,#auroreEditorialTaskAdmin .editor-field{display:grid;gap:5px;font-size:.62rem;font-weight:850}
#auroreEditorialTaskAdmin input,#auroreEditorialTaskAdmin textarea{font:inherit;color:inherit;background:var(--editor-surface);border:1px solid var(--editor-border);border-radius:11px;padding:10px 11px}
#auroreEditorialTaskAdmin textarea{resize:vertical;min-width:0;line-height:1.45;font-size:.68rem}
#auroreEditorialTaskAdmin .editor-block-label{display:flex;justify-content:space-between;align-items:center;font-size:.63rem}
#auroreEditorialTaskAdmin .editor-block-label span{font-weight:950}
#auroreEditorialTaskAdmin .editor-block-label small{opacity:.55}
#auroreEditorialTaskAdmin .editor-card-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
#auroreEditorialTaskAdmin .editor-pro-card{display:flex;flex-direction:column;gap:6px;min-height:170px;padding:13px;border:1px solid var(--editor-border);border-radius:16px;background:var(--editor-surface);box-shadow:0 5px 18px rgba(0,0,0,.035)}
#auroreEditorialTaskAdmin .editor-pro-top,.editor-pro-bottom{display:flex;align-items:center;justify-content:space-between;gap:7px}
#auroreEditorialTaskAdmin .editor-pro-id{font-size:.57rem;font-weight:950;opacity:.48}
#auroreEditorialTaskAdmin .editor-pro-pill{display:inline-flex;align-items:center;max-width:100%;padding:4px 7px;border-radius:999px;font-size:.5rem;font-weight:950;background:color-mix(in srgb,currentColor 7%,transparent)}
#auroreEditorialTaskAdmin .editor-pro-pill.waiting{background:color-mix(in srgb,#6D28D9 11%,transparent)}
#auroreEditorialTaskAdmin .editor-pro-pill.chapters{background:color-mix(in srgb,#2563EB 11%,transparent)}
#auroreEditorialTaskAdmin .editor-pro-pill.plan{background:color-mix(in srgb,#C2410C 11%,transparent)}
#auroreEditorialTaskAdmin .editor-pro-pill.warning{background:color-mix(in srgb,#B45309 13%,transparent)}
#auroreEditorialTaskAdmin .editor-pro-pill.admin{background:color-mix(in srgb,#7C3AED 12%,transparent)}
#auroreEditorialTaskAdmin .editor-pro-pill.ready{background:color-mix(in srgb,#16A34A 12%,transparent)}
#auroreEditorialTaskAdmin .editor-pro-card h4{margin:7px 0 0;font-size:.78rem}
#auroreEditorialTaskAdmin .editor-pro-subject{font-size:.67rem;opacity:.72}
#auroreEditorialTaskAdmin .editor-pro-card p{margin:5px 0 2px;font-size:.62rem;line-height:1.45;opacity:.66}
#auroreEditorialTaskAdmin .editor-pro-bottom{margin-top:auto;padding-top:8px}
#auroreEditorialTaskAdmin .editor-pro-bottom span{font-size:.53rem;padding:4px 6px;border-radius:7px;background:color-mix(in srgb,currentColor 6%,transparent)}
#auroreEditorialTaskAdmin .editor-block-pager{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;padding-top:5px}
#auroreEditorialTaskAdmin .editor-block-pager .admin-btn{font-size:.6rem}
#auroreEditorialTaskAdmin .editor-empty{grid-column:1/-1;padding:24px;text-align:center;border:1px dashed var(--editor-border);border-radius:15px;font-size:.68rem;opacity:.62}
#auroreEditorialTaskAdmin .editor-detail{padding:18px;border:1px solid color-mix(in srgb,var(--editor-accent) 20%,var(--editor-border));border-radius:18px;background:color-mix(in srgb,var(--editor-accent) 3%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-detail-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
#auroreEditorialTaskAdmin .editor-detail-head h4{margin:5px 0 4px;font-size:.95rem}
#auroreEditorialTaskAdmin .editor-detail-meta{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;margin-top:12px}
#auroreEditorialTaskAdmin .editor-detail-meta>div{padding:10px;border-radius:11px;background:color-mix(in srgb,currentColor 4%,transparent)}
#auroreEditorialTaskAdmin .editor-detail-meta span{display:block;font-size:.54rem;text-transform:uppercase;font-weight:900;opacity:.48}
#auroreEditorialTaskAdmin .editor-detail-meta strong{display:block;margin-top:4px;font-size:.64rem}
#auroreEditorialTaskAdmin .editor-detail-title{margin:16px 0 8px;font-size:.73rem}
#auroreEditorialTaskAdmin .editor-chapters-selection{display:grid;gap:10px;margin-top:10px}
#auroreEditorialTaskAdmin .editor-chapters-toggle{justify-self:start;font-weight:900}
#auroreEditorialTaskAdmin .editor-chapter-source{display:grid;gap:4px;margin-bottom:10px;padding:11px 12px;border-radius:12px;background:color-mix(in srgb,var(--editor-accent) 7%,transparent);border:1px solid color-mix(in srgb,var(--editor-accent) 15%,var(--editor-border))}
#auroreEditorialTaskAdmin .editor-chapter-source span{font-size:.61rem;font-weight:950}
#auroreEditorialTaskAdmin .editor-chapter-source small{font-size:.58rem;line-height:1.45;opacity:.68}
#auroreEditorialTaskAdmin .editor-chapters-choice{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#auroreEditorialTaskAdmin .editor-chapter-choice{display:grid;grid-template-columns:auto 1fr;gap:9px;align-items:start;padding:12px;border:1px solid var(--editor-border);border-radius:13px;background:var(--editor-surface);cursor:pointer}
#auroreEditorialTaskAdmin .editor-chapter-choice:hover{border-color:color-mix(in srgb,var(--editor-accent) 35%,var(--editor-border))}
#auroreEditorialTaskAdmin .editor-chapter-choice input{margin-top:3px;width:17px;height:17px;padding:0;accent-color:var(--editor-accent)}
#auroreEditorialTaskAdmin .editor-chapter-choice span{display:grid;gap:4px}
#auroreEditorialTaskAdmin .editor-chapter-choice strong{font-size:.67rem}
#auroreEditorialTaskAdmin .editor-chapter-choice small{font-size:.58rem;line-height:1.45;opacity:.65}
#auroreEditorialTaskAdmin .editor-chapter-choice em{font-size:.51rem;line-height:1.35;opacity:.45;font-style:normal}
#auroreEditorialTaskAdmin .editor-chapters-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
#auroreEditorialTaskAdmin .editor-chapter{padding:11px;border:1px solid var(--editor-border);border-radius:12px;background:var(--editor-surface)}
#auroreEditorialTaskAdmin .editor-chapter span{display:block;font-size:.5rem;font-weight:900;text-transform:uppercase;opacity:.45}
#auroreEditorialTaskAdmin .editor-chapter strong{display:block;margin-top:4px;font-size:.67rem}
#auroreEditorialTaskAdmin .editor-chapter small{display:block;margin-top:4px;font-size:.59rem;line-height:1.4;opacity:.62}
#auroreEditorialTaskAdmin .editor-plan-form{display:grid;gap:12px}
#auroreEditorialTaskAdmin .editor-c-plan-context{display:grid;gap:5px;padding:13px;border:1px solid color-mix(in srgb,#2563EB 18%,var(--editor-border));border-radius:13px;background:color-mix(in srgb,#2563EB 5%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-c-plan-context.warning{border-color:color-mix(in srgb,#B45309 24%,var(--editor-border));background:color-mix(in srgb,#B45309 6%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-c-plan-context span,#auroreEditorialTaskAdmin .editor-c-intent span{font-size:.54rem;text-transform:uppercase;font-weight:950;letter-spacing:.06em;opacity:.55}
#auroreEditorialTaskAdmin .editor-c-plan-context strong{font-size:.7rem;line-height:1.4}
#auroreEditorialTaskAdmin .editor-c-plan-context small{font-size:.58rem;line-height:1.45;opacity:.65}
#auroreEditorialTaskAdmin .editor-c-intent{display:grid;gap:5px;padding:13px;border-radius:13px;background:color-mix(in srgb,var(--editor-accent) 5%,var(--editor-surface));border:1px solid color-mix(in srgb,var(--editor-accent) 13%,var(--editor-border))}
#auroreEditorialTaskAdmin .editor-c-intent strong{font-size:.7rem}
#auroreEditorialTaskAdmin .editor-c-research{display:flex;justify-content:space-between;gap:12px;padding:14px 16px;border:1px solid color-mix(in srgb,#2563EB 18%,var(--editor-border));border-radius:15px;background:color-mix(in srgb,#2563EB 5%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-c-research>div{display:grid;gap:5px}
#auroreEditorialTaskAdmin .editor-section-kicker{font-size:.54rem;text-transform:uppercase;font-weight:950;letter-spacing:.07em;opacity:.55}
#auroreEditorialTaskAdmin .editor-c-research strong{font-size:.76rem}
#auroreEditorialTaskAdmin .editor-c-research small{font-size:.58rem;line-height:1.45;opacity:.65}
#auroreEditorialTaskAdmin .editor-c-ready-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
#auroreEditorialTaskAdmin .editor-c-ready-grid>div{display:grid;gap:5px;padding:11px;border-radius:12px;background:color-mix(in srgb,currentColor 4%,transparent)}
#auroreEditorialTaskAdmin .editor-c-ready-grid span{font-size:.52rem;text-transform:uppercase;font-weight:900;opacity:.48}
#auroreEditorialTaskAdmin .editor-c-ready-grid strong{font-size:.62rem;line-height:1.4}
#auroreEditorialTaskAdmin .editor-research-grid{margin-top:-3px}
@media(max-width:720px){#auroreEditorialTaskAdmin .editor-c-ready-grid{grid-template-columns:1fr 1fr}}
@media(max-width:520px){#auroreEditorialTaskAdmin .editor-c-ready-grid{grid-template-columns:1fr}}
#auroreEditorialTaskAdmin .editor-c-intent p{margin:0;font-size:.59rem;line-height:1.5;opacity:.66}
#auroreEditorialTaskAdmin .editor-plan-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
#auroreEditorialTaskAdmin .editor-plan-grid .wide{grid-column:1/-1}
#auroreEditorialTaskAdmin .editor-plan-divider{padding:8px 0;border-top:1px solid var(--editor-border);font-size:.58rem;text-transform:uppercase;font-weight:950;letter-spacing:.08em;opacity:.55}
#auroreEditorialTaskAdmin .editor-plan-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
#auroreEditorialTaskAdmin .editor-validation-wrap{display:grid;gap:12px}
#auroreEditorialTaskAdmin .editor-validation-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
#auroreEditorialTaskAdmin .editor-validation-head h5{margin:5px 0;font-size:.84rem}
#auroreEditorialTaskAdmin .editor-validation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#auroreEditorialTaskAdmin .editor-check{display:flex;gap:8px;align-items:center;padding:11px;border:1px solid var(--editor-border);border-radius:12px;background:var(--editor-surface);font-size:.64rem;font-weight:800}
#auroreEditorialTaskAdmin .editor-check input{width:17px;height:17px;padding:0;accent-color:var(--editor-accent)}
#auroreEditorialTaskAdmin .editor-a-start{display:grid;gap:5px;padding:16px;border:1px dashed var(--editor-border);border-radius:14px}
#auroreEditorialTaskAdmin .editor-a-start strong{font-size:.72rem}
#auroreEditorialTaskAdmin .editor-a-start span{font-size:.62rem;opacity:.62}
#auroreEditorialTaskAdmin .danger{border-color:color-mix(in srgb,#DC2626 25%,var(--editor-border))!important}
@media(max-width:1050px){#auroreEditorialTaskAdmin .editor-create-fields{grid-template-columns:1fr 1fr}.editor-create-fields .admin-btn{grid-column:1/-1}#auroreEditorialTaskAdmin .editor-card-grid{grid-template-columns:repeat(3,minmax(0,1fr))}#auroreEditorialTaskAdmin .editor-create-card{grid-template-columns:1fr}}
@media(max-width:720px){#auroreEditorialTaskAdmin .editor-classification-panel{position:relative;top:auto;left:auto;right:auto;margin-top:8px;box-shadow:none;max-height:68vh;overflow:auto}.editor-option-scroll{grid-template-columns:repeat(2,minmax(0,1fr));max-height:none;overflow:visible}}

@media(max-width:720px){#auroreEditorialTaskAdmin .editor-main-nav{overflow-x:auto}#auroreEditorialTaskAdmin .editor-main-nav-item{min-width:120px}#auroreEditorialTaskAdmin .editor-main-nav-link{margin-left:0}#auroreEditorialTaskAdmin .editor-page-title,#auroreEditorialTaskAdmin .editor-validation-head{display:block}#auroreEditorialTaskAdmin .editor-page-count{display:block;margin-top:8px}#auroreEditorialTaskAdmin .editor-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#auroreEditorialTaskAdmin .editor-detail-meta,#auroreEditorialTaskAdmin .editor-validation-grid{grid-template-columns:1fr 1fr}}
@media(max-width:520px){#auroreEditorialTaskAdmin .editor-hub-head{display:block}#auroreEditorialTaskAdmin .editor-main-nav{display:grid;grid-template-columns:1fr 1fr}#auroreEditorialTaskAdmin .editor-main-nav-link{grid-column:1/-1;text-align:left;border-left:0;border-top:1px solid var(--editor-border);padding-top:11px}#auroreEditorialTaskAdmin .editor-card-grid{grid-template-columns:1fr}#auroreEditorialTaskAdmin .editor-plan-grid,#auroreEditorialTaskAdmin .editor-detail-meta,#auroreEditorialTaskAdmin .editor-chapters-grid,#auroreEditorialTaskAdmin .editor-validation-grid{grid-template-columns:1fr}#auroreEditorialTaskAdmin .editor-plan-actions{justify-content:stretch}#auroreEditorialTaskAdmin .editor-plan-actions .admin-btn{flex:1}}
[data-theme="dark"] #auroreEditorialTaskAdmin{--editor-surface:#17171b;--editor-border:rgba(255,255,255,.13)}
[data-theme="light"] #auroreEditorialTaskAdmin{--editor-surface:#fff;--editor-border:rgba(0,0,0,.12)}
`;
  document.head.appendChild(s);
}
async function chargerEspaceEditorialChatGPT(){
  const p=panel();if(!p)return false;injectStyle();
  let root=document.getElementById('auroreEditorialTaskAdmin');
  if(!root){root=document.createElement('div');root.id='auroreEditorialTaskAdmin';(document.getElementById('auroraRequestFormHost')||p).appendChild(root)}
  root.innerHTML='<div class="editor-empty">Chargement du parcours éditorial…</div>';
  try{const tasks=await listJobs();const state={tasks,section:'A',pages:{A:0,B:0,C:0,CX:0,D:0}};render(root,state);const count=document.getElementById('tabCountAuroraRequest');if(count)count.textContent=String(tasks.length);return true}catch(e){root.innerHTML='<div class="editor-empty">Impossible de charger le parcours éditorial : '+esc(e.message||e)+'</div>';return false}
}
window.chargerEspaceEditorialChatGPT=chargerEspaceEditorialChatGPT;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{const p=panel();if(p){injectStyle();const host=document.getElementById('auroraRequestFormHost');if(host&&!document.getElementById('auroreEditorialTaskAdmin')){const root=document.createElement('div');root.id='auroreEditorialTaskAdmin';host.appendChild(root)}}},{once:true});else injectStyle();
})();