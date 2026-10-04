(function(){
'use strict';
if(typeof window==='undefined'||window.__auroreEditorialTaskAdmin)return;
window.__auroreEditorialTaskAdmin=true;

const PROTOCOL='aurore-chatgpt-editor-v2';
const EDITOR='ChatGPT';
const AI_WORKSPACE_SECTIONS=['CLAUDE','GPT','GROK'];
const AI_WORKSPACE_LABELS={CLAUDE:'Claude',GPT:'GPT',GROK:'Grok'};
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
const C_EXECUTION_CONTRACT_VERSION='c-plan-guardrails-v2';
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
    'POUR les documents de mathématiques, physique ou chimie, exécuter le préflight canonique public.aurora_scientific_preflight et bloquer l’ingestion selon le préflight scientifique canonique gradué : Primaire 400, Collège 500, Lycée et Supérieur 1200 éléments LaTeX, avec 2 constructions GeoGebra et 3 sites sources distincts ; signaler précisément les métriques et les manques à l’éditeur.',
    'LAISSER le PDF manuel : aucune génération PDF automatique depuis D.'
  ],
  prohibitedBeforeCompletion:[
    'passer directement CX vers documents_en_attente sans production éditoriale persistée',
    'déclarer D terminé sans generated_document_id confirmé',
    'lancer automatiquement LuaLaTeX ou une autre génération PDF',
    'insérer un document scientifique dans Documents en attente sans avoir obtenu un préflight scientifique valide selon le niveau, avec les constructions GeoGebra et les sources distinctes requises'
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
    'SI un champ obligatoire est vide, SIGNALER le manque à l’IA éditrice et lui demander de le compléter à partir du contexte réel déjà persisté.',
    'RECONTROLER le plan après complétion IA ; si un champ reste vide ou générique, BLOQUER toute écriture et toute migration C → CX.',
    'RELIRE la proposition écrite et vérifier tous les champs obligatoires ainsi que la cohérence avec la tâche.',
    'NE_DECLARER_TERMINE_QU_APRES_VERIFICATION_PERSISTANTE : ne déclarer la tâche traitée qu’après relecture du contenu persistant.',
    'NE_JAMAIS_LANCER_LE_PDF_AUTOMATIQUEMENT : la validation C prépare uniquement l’étape suivante.'
  ],
  prohibitedBeforeCompletion:[
    'répondre que la tâche est traitée sans avoir écrit workflow.proposal',
    'demander à l’administrateur de remplir le plan à la place de ChatGPT',
    'insérer en base un plan C incomplet en espérant le compléter après coup',
    'migrer C → CX si la complétion IA n’a pas ramené tous les champs obligatoires à un état valide',
    'inventer une tâche ou un chapitre absent de Supabase',
    'passer stage à edition_ready sans contrôle de complétude',
    'lancer une génération PDF depuis C'
  ]
};
const esc=v=>{const d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML};
const normalizeEditorialTitle=v=>String(v??'').trim().replace(/[‐‑‒–—―−-]+/g,' ').replace(/\s{2,}/g,' ').trim();
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
  const rows=await rest('/rest/v1/aurora_content_jobs?select=id,status,title,subject,level,class_name,document_type,generated_document_id,metadata,created_at,updated_at&order=updated_at.desc&limit=500');
  return (Array.isArray(rows)?rows:[]).filter(t=>['aurore-chatgpt-editor-v2','aurore-chatgpt-editor-v1'].includes(t?.metadata?.workflow?.protocol));
}
async function listRevisionDocuments(){
  const rows=await rpc('aurora_list_editorial_revision_documents',{});
  return Array.isArray(rows)?rows:[];
}
async function createNewDProductionFromRevision(id){
  const result=await rpc('aurora_create_new_d_production_from_revision',{p_generated_document_id:Number(id)});
  if(!result?.ok||!Number(result?.new_job_id))throw new Error(result?.error||'La nouvelle production D n’a pas été créée par Supabase.');
  return result;
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
  const catalog=window.AURORE_CATALOG_NIVEAUX;
  if(Array.isArray(catalog))return catalog;
  return typeof NIVEAUX!=='undefined'&&Array.isArray(NIVEAUX)?NIVEAUX:[];
}
function rootNodeName(picker){const n=editorClassificationRoots().find(x=>x.id===picker?.value);return String(n?.nom||'').trim();}
async function updateJob(id,patch,status){
  const row=await getJob(id);if(!row)throw new Error('Tâche introuvable.');
  const metadata=workflowMetadata(row.metadata,patch);
  const body={metadata,updated_at:new Date().toISOString()};if(status)body.status=status;
  await rest('/rest/v1/aurora_content_jobs?id=eq.'+encodeURIComponent(Number(id)),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(body)});
  return getJob(id);
}
const A_RESOURCE_TYPES=['QCM','Cours','Fiche de révision','Série d’exercices'];
const A_THEME_PALETTE=[
  ['Violet','#6D28D9'],['Rouge','#C93648'],['Vert','#198754'],['Bleu','#1D4ED8'],['Jaune','#B77900'],['Orange','#C85C0D'],
  ['Cyan','#0E7490'],['Rose','#BE185D'],['Indigo','#4338CA'],['Turquoise','#0F766E'],['Émeraude','#047857'],['Citron vert','#4D7C0F'],
  ['Sarcelle','#115E59'],['Magenta','#A21CAF'],['Fuchsia','#86198F'],['Corail','#C2412D'],['Bordeaux','#881337'],['Pourpre','#6B21A8'],
  ['Prune','#581C87'],['Or','#9A6700'],['Ambre','#B45309'],['Menthe','#047857'],['Azur','#0369A1'],['Lavande','#6D28D9'],
  ['Safran','#A16207'],['Nuit','#1E3A8A'],['Marine','#0B3440'],['Océan','#075985'],['Ciel','#0369A1'],['Ardoise','#334155'],
  ['Graphite','#27272A'],['Forêt','#166534'],['Sapin','#065F46'],['Pomme','#3F6212'],['Pistache','#4D7C0F'],['Pêche','#C2410C'],
  ['Abricot','#92400E'],['Terracotta','#9A3412'],['Framboise','#9F1239'],['Mauve','#6D28D9'],['Pervenche','#3730A3'],['Glacier','#155E75'],
  ['Sable','#854D0E'],['Cacao','#451A03'],['Lagune','#0F5257']
];
function normalizeAThemeColor(v){return /^#[0-9a-f]{6}$/i.test(String(v||''))?String(v).toUpperCase():'#6D28D9';}
function aProfile(resourceType){
  const raw=String(resourceType||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[-_]+/g,' ');
  if(raw==='serie d exercices'||raw==='serie exercices') return {kind:'exercices',version:'exercise-sheet-v2',lock:true,document_type:'Série d’exercices',paired_corrections:true};
  if(raw==='cours') return {kind:'cours',version:'course-v2',lock:true,document_type:'Cours'};
  if(raw==='fiche de revision') return {kind:'cours',version:'course-v2',lock:true,document_type:'Fiche de révision'};
  if(raw==='qcm') return {kind:'document',version:'document-v1',lock:true,document_type:'QCM',subtype:'qcm'};
  return {kind:'document',version:'document-v1',lock:true,document_type:resourceType||'Document'};
}
async function createTask(form){
  const className=String(form.className||'').trim(),subject=String(form.subject||'').trim(),documentType=String(form.documentType||'').trim();
  const level=String(form.level||className||'').trim();
  const path=Array.isArray(form.path)?form.path.map(x=>String(x||'').trim()).filter(Boolean):[];
  const location=String(form.location||path.join(' · ')||className||'').trim();
  const prompt=String(form.prompt||'').trim(),reference=String(form.reference||'').trim();
  const themeColor=normalizeAThemeColor(form.themeColor||'#6D28D9');
  const id=Number(await rpc('aurora_create_content_job',{
    p_title:'Document en préparation',p_subject:subject,p_level:level,p_class_name:className,p_document_type:documentType,
    p_prompt:prompt||'Tâche éditoriale. ChatGPT est l’éditeur canonique : récupération, recherche, chapitres, plan de production puis rédaction finale.',
    p_instructions:{
      source:'admin_editorial_task',origin:'gpt_editorial_queue',queue:'manual',document_type:documentType,rights_confirmed:true,
      reference:reference||null,theme_color:themeColor,editorial:{role:'editor',engine:EDITOR,schema_version:'aurora-editorial-2',status:'waiting_chatgpt'},
      profile:aProfile(documentType),classification:{level,location,class_name:className,subject,document_type:documentType,path},
      workflow:{protocol:PROTOCOL,stage:'initiale',proposal_version:0,user_validated:false,chatgpt_claimed:false,manual_pdf_only:true,manual_pdf_launch_required:true,auto_pdf_launch:false,editorial_engine:EDITOR,
        execution_contract:A_EXECUTION_CONTRACT,execution_contract_acknowledged:false,completion_guard:A_EXECUTION_CONTRACT_VERSION,a_context_required:true,b_context_required:true,title_generated_by_editor:true,title_policy:'no_hyphen_or_dash'}
    }
  }));
  if(!Number.isSafeInteger(id)||id<1)throw new Error('Identifiant de tâche invalide.');
  return updateJob(id,{reference,theme_color:themeColor,resource_type:documentType,prompt,stage:'initiale',
    chatgpt_claimed:false,chatgpt_claimed_at:null,chapters:null,selected_chapter:null,proposal:null,proposal_version:0,user_validated:false,rejected:false,revision_requested:false,admin_validation:null,
    classification:{level,location,class_name:className,subject,document_type:documentType,path},
    execution_contract:A_EXECUTION_CONTRACT,execution_contract_acknowledged:false,completion_guard:A_EXECUTION_CONTRACT_VERSION,a_context_required:true,b_context_required:true},'draft');
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
function chapterOptionsForWorkflow(w){
  const raw=w&&w.chapter_options;
  if(Array.isArray(raw))return raw;
  if(raw&&typeof raw==='object'&&Array.isArray(raw.options))return raw.options;
  return [];
}
function aContextReady(t){
  const w=t.metadata?.workflow||{},a=w.context_assimilation;
  if(!a||typeof a!=='object')return false;
  const required=[t.title,t.subject,t.level,t.class_name,t.document_type];
  const snapshot=typeof a.snapshot==='string'?a.snapshot.trim():(a.snapshot&&typeof a.snapshot==='object'?JSON.stringify(a.snapshot):'');
  const summary=typeof a.summary==='string'?a.summary.trim():(a.summary&&typeof a.summary==='object'?JSON.stringify(a.summary):'');
  return a.acknowledged===true&&snapshot.length>=80&&summary.length>=60
    &&required.every(x=>String(x||'').trim()&&snapshot.includes(String(x).trim()));
}
function aResearchReady(t){
  const w=t.metadata?.workflow||{},r=aResearchFor(t);
  const options=chapterOptionsForWorkflow(w);
  const findings=String(r.findings||r.constats||'').trim();
  const methodology=String(r.methodology||r.method||'').trim();
  const sources=[...(Array.isArray(r.source_urls)?r.source_urls:[]),...(Array.isArray(r.sources)?r.sources:[])]
    .map(x=>typeof x==='string'?x:(x&&typeof x==='object'?(x.url||x.href||x.source_url||''):String(x||'')))
    .map(x=>String(x||'').trim()).filter(Boolean);
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
  const options=chapterOptionsForWorkflow(w);
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
  if(s==='redaction'||(s==='production_en_cours'&&!['gpt','claude','grok'].includes(String(w.ai_treatment?.provider||'').toLowerCase())))return'D';
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
const D_AI_ENDPOINT='/functions/v1/aurora-editorial-ai';
const D_AI_PROVIDER_LABELS={gpt:'GPT',claude:'Claude',grok:'Grok'};
let D_AI_PROVIDERS=[['gpt','GPT'],['claude','Claude'],['grok','Grok']];
function dAiSetProviders(list){
  const ids=Array.isArray(list)?list.map(x=>String(x?.id||x).toLowerCase()).filter(x=>D_AI_PROVIDER_LABELS[x]):[];
  D_AI_PROVIDERS=(ids.length?ids:['gpt','claude','grok']).map(id=>[id,D_AI_PROVIDER_LABELS[id]]);
}
async function loadDAiProviders(){
  try{
    const tokenValue=await token();
    const r=await fetch(SUPABASE_URL+D_AI_ENDPOINT,{method:'GET',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+tokenValue},cache:'no-store'});
    const raw=await r.text(); let data=null; try{data=raw?JSON.parse(raw):null}catch(_){}
    if(r.ok&&Array.isArray(data?.providers)) dAiSetProviders([['gpt','GPT'],...data.providers.filter(x=>['claude','grok'].includes(String(x?.id||'').toLowerCase()))]);
  }catch(_){}
}

function dAiTreatment(t){
  const a=t?.metadata?.workflow?.ai_treatment;
  return a&&typeof a==='object'?a:null;
}
function dAiCanStart(t){
  const w=t?.metadata?.workflow||{},a=dAiTreatment(t);
  if(!t||t.generated_document_id)return false;
  if(!['redaction','production_en_cours'].includes(w.stage||''))return false;
  if(['handed_off','in_progress','new_production'].includes(String(w.revision_status||'')))return false;
  if(a?.status==='processing')return false;
  return w.admin_validation?.status==='validated' && w.proposal_status==='validated_for_editing';
}
function dAiProviderFor(t){
  const a=dAiTreatment(t),saved=String(a?.provider||'').toLowerCase();
  if(D_AI_PROVIDERS.some(([id])=>id===saved))return saved;
  try{
    const p=String(localStorage.getItem('aurore_d_ai_provider')||'').toLowerCase();
    if(D_AI_PROVIDERS.some(([id])=>id===p))return p;
  }catch(_){}
  return D_AI_PROVIDERS[0]?.[0]||'grok';
}
function dAiIsStale(t){
  const a=dAiTreatment(t);
  if(a?.status!=='processing')return false;
  const at=Date.parse(String(a?.updated_at||a?.started_at||'')); 
  return Number.isFinite(at) && Date.now()-at>12*60*1000;
}
function dAiCardMarkup(t){
  const w=t?.metadata?.workflow||{},a=dAiTreatment(t),provider=dAiProviderFor(t);
  const processing=a?.status==='processing';
  const stale=dAiIsStale(t);
  const failed=a?.status==='failed';
  const legacyBlocked=!!t.generated_document_id||['handed_off','in_progress','new_production'].includes(String(w.revision_status||''));
  if(legacyBlocked&&!processing){
    return '<div class="editor-ai-treatment editor-ai-legacy"><div class="editor-ai-line"><span>Production existante</span><strong>Reprise protégée via l’historique / révision</strong></div></div>';
  }
  const pct=Math.max(0,Math.min(100,Number(a?.progress)||0));
  const label=String(a?.label||a?.stage||'').trim();
  const error=String(a?.error||'').trim();
  const activeProcessing=processing&&!stale;
  const actionable=failed||stale||(!processing&&dAiCanStart(t));
  return '<div class="editor-ai-treatment '+(activeProcessing?'is-processing':failed?'is-failed':stale?'is-stale':'')+'">'+
    '<div class="editor-ai-head"><span>Production IA</span><strong>'+(activeProcessing?'Traitement en cours':stale?'Traitement bloqué — reprise possible':failed?'Traitement bloqué':'Choisir le moteur')+'</strong></div>'+
    '<div class="editor-ai-controls">'+
      '<select class="editor-ai-provider" data-ai-provider-job="'+esc(t.id)+'" aria-label="Moteur IA pour la tâche '+esc(t.id)+'" '+(activeProcessing?'disabled':'')+'>'+
        D_AI_PROVIDERS.map(([value,label])=>'<option value="'+value+'" '+(provider===value?'selected':'')+'>'+label+'</option>').join('')+
      '</select>'+
      '<button type="button" class="admin-btn '+(activeProcessing?'ghost':'primary')+'" data-ai-start="'+esc(t.id)+'" '+(!actionable||activeProcessing?'disabled':'')+'>'+(activeProcessing?'Traitement…':stale?'Reprendre':failed?'Relancer':'Traiter')+'</button>'+
    '</div>'+
    ((processing||failed)?'<div class="editor-ai-progress" role="status" aria-live="polite">'+
      '<div class="editor-ai-progress-head"><span>'+esc(label||'Traitement IA')+'</span><strong data-ai-percent-job="'+esc(t.id)+'">'+pct+'%</strong></div>'+
      '<div class="editor-ai-progress-track" aria-hidden="true"><span data-ai-progress-job="'+esc(t.id)+'" style="width:'+pct+'%"></span></div>'+
      (error?'<small class="editor-ai-error">'+esc(error)+'</small>':'')+
    '</div>':'')+
  '</div>';
}
async function claimGptTask(jobId){
  const id=Number(jobId);if(!Number.isInteger(id)||id<=0)throw new Error('Tâche GPT invalide.');
  const runId='d-gpt-'+id+'-'+crypto.randomUUID();
  const data=await rpc('aurora_claim_gpt_editorial_task',{p_job_id:id,p_run_id:runId});
  if(data?.ok!==true)throw new Error(data?.error||'La tâche n’a pas pu être récupérée par GPT.');
  return data;
}
async function startDaiTreatment(jobId,provider){
  const id=Number(jobId),p=String(provider||'').toLowerCase();
  if(!Number.isInteger(id)||id<=0)throw new Error('Tâche D invalide.');
  if(!D_AI_PROVIDERS.some(([id])=>id===p))throw new Error('Moteur IA invalide ou non configuré.');
  if(p==='gpt') return claimGptTask(id);
  const tokenValue=await token();
  const r=await fetch(SUPABASE_URL+D_AI_ENDPOINT,{
    method:'POST',
    headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+tokenValue,'Content-Type':'application/json'},
    body:JSON.stringify({job_id:id,provider:p})
  });
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null}catch(_){}
  if(!r.ok||data?.ok===false)throw new Error(data?.error||raw||('Le traitement IA n’a pas démarré (HTTP '+r.status+').'));
  try{localStorage.setItem('aurore_d_ai_provider',p)}catch(_){}
  return data;
}
function stopDAiPolling(){
  try{if(window.__auroreDAiTimer){clearInterval(window.__auroreDAiTimer);window.__auroreDAiTimer=null}}catch(_){}
}
function startDAiPolling(root,state){
  stopDAiPolling();
  if(!['D',...AI_WORKSPACE_SECTIONS].includes(state?.section))return;
  const tick=async()=>{
    try{
      const fresh=await listJobs();
      const byId=new Map(fresh.map(t=>[Number(t.id),t]));
      let changed=false,stillRunning=false;
      for(const current of (state.tasks||[])){
        if(!current?.id)continue;
        const next=byId.get(Number(current.id));
        if(next) {
          const old=JSON.stringify(current?.metadata?.workflow?.ai_treatment||null);
          const now=JSON.stringify(next?.metadata?.workflow?.ai_treatment||null);
          if(old!==now)changed=true;
          current.metadata=next.metadata;
          current.generated_document_id=next.generated_document_id;
          current.status=next.status;
          current.updated_at=next.updated_at;
          const ai=next.metadata?.workflow?.ai_treatment;
          if(ai?.status==='processing')stillRunning=true;
        }
      }
      root.querySelectorAll('[data-ai-progress-job]').forEach(bar=>{
        const id=Number(bar.dataset.aiProgressJob),t=byId.get(id),ai=dAiTreatment(t),pct=Math.max(0,Math.min(100,Number(ai?.progress)||0));
        bar.style.width=pct+'%';
        const out=root.querySelector('[data-ai-percent-job="'+id+'"]');if(out)out.textContent=pct+'%';
      });
      root.querySelectorAll('[data-ai-start]').forEach(btn=>{
        const id=Number(btn.dataset.aiStart),t=byId.get(id),ai=dAiTreatment(t);
        if(ai?.status==='processing'){btn.disabled=true;btn.textContent='Traitement…'}
      });
      if(changed){
        const activeIds=new Set([...root.querySelectorAll('[data-ai-start]')].map(x=>Number(x.dataset.aiStart)));
        const leaving=[...activeIds].some(id=>byId.get(id)?.generated_document_id||byId.get(id)?.metadata?.workflow?.stage==='production_terminee');
        if(leaving){await chargerEspaceEditorialChatGPT(state.section);return;}
        render(root,state);
      }
      if(!stillRunning)stopDAiPolling();
    }catch(_){}
  };
  tick();
  window.__auroreDAiTimer=setInterval(tick,2500);
}

function aiWorkspaceCard(t,section){
  const a=dAiTreatment(t),label=AI_WORKSPACE_LABELS[section]||section,processing=a?.status==='processing',failed=a?.status==='failed',pct=Math.max(0,Math.min(100,Number(a?.progress)||0));
  return '<article class="editor-pro-card ai-workspace-card"><div class="editor-pro-top"><span class="editor-pro-id">#'+esc(t.id)+'</span><span class="editor-pro-pill '+(failed?'warning':'ready')+'">'+esc(label)+'</span></div><h4>'+esc(t.class_name||t.level||'Classe')+'</h4><strong class="editor-pro-subject">'+esc(t.subject||'Matière')+'</strong><p>'+esc(t.title||'Document')+'<br><small>'+(processing?'Traitement en cours':'Traitement à reprendre')+'</small></p><div class="editor-ai-progress"><div class="editor-ai-progress-head"><span>'+esc(a?.label||'Espace '+label)+'</span><strong>'+pct+'%</strong></div><div class="editor-ai-progress-track"><span style="width:'+pct+'%"></span></div></div><div class="editor-pro-bottom"><span>'+esc(t.document_type||'cours')+'</span><button type="button" class="admin-btn primary" data-editor-open="'+esc(t.id)+'">Ouvrir</button>'+(failed?'<button type="button" class="admin-btn ghost" data-ai-retry="'+esc(t.id)+'">Reprendre</button>':'')+'</div></article>';
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
      : section==='D'
        ? (w.stage==='production_terminee'?'Production terminée · document en attente':'Production finale')
        : 'Classe + matière : première étape du parcours éditorial';
  const actions=section==='D'
    ? '<div class="editor-ai-inline">'+dAiCardMarkup(t)+'</div>'
    : '';
  const revisionButton=section==='D'&&t.generated_document_id&&w.stage==='production_terminee'
    ? '<button type="button" class="admin-btn ghost" data-revision-job="'+esc(t.id)+'">Envoyer en E — réviser</button>'
    : '';
  return '<article class="editor-pro-card"><div class="editor-pro-top"><span class="editor-pro-id">#'+esc(t.id)+'</span><span class="editor-pro-pill '+esc(s.tone)+'">'+esc(s.label)+'</span></div><h4>'+esc(t.class_name||t.level||'Classe')+'</h4><strong class="editor-pro-subject">'+esc(t.subject||'Matière')+'</strong><p>'+esc(desc)+'</p>'+actions+'<div class="editor-pro-bottom"><span>'+esc(t.document_type||'cours')+'</span><button type="button" class="admin-btn ghost" data-editor-open="'+esc(t.id)+'">Ouvrir</button>'+revisionButton+'</div></article>';
}
function revisionTaskCard(r){
  const when=r.revision_requested_at?new Date(r.revision_requested_at).toLocaleString('fr-FR'):'—';
  return '<article class="editor-pro-card"><div class="editor-pro-top"><span class="editor-pro-id">PDF #'+esc(r.generated_document_id)+'</span><span class="editor-pro-pill warning">Révision demandée</span></div><h4>'+esc(r.class_name||r.level||'Classe')+'</h4><strong class="editor-pro-subject">'+esc(r.subject||'Matière')+'</strong><p>'+esc(r.title||'Document')+'<br><small>Demandée le '+esc(when)+(r.revision_reason?' · '+esc(r.revision_reason):'')+'</small></p><div class="editor-pro-bottom"><span>'+esc(r.document_type||'cours')+'</span><button type="button" class="admin-btn primary" data-revision-begin="'+esc(r.generated_document_id)+'">Créer la nouvelle D</button></div></article>';
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
  const stored=chapterOptionsForWorkflow(w);
  if(!stored.length&&Array.isArray(w.chapters)&&w.chapters.length)stored.push(...w.chapters);
  if(stored.length)return stored.map(x=>typeof x==='string'?{title:x,description:'',source:'Proposition enregistrée dans la tâche.'}:x).filter(x=>x&&String(x.title||x.name||'').trim());
  const key=String(t.id)+"|"+String(t.subject||"").toLowerCase()+"|"+String(t.class_name||t.level||"").toLowerCase();
  return CHAPTER_PROPOSALS[key]||[];
}
function chaptersMarkup(t){
  const w=t.metadata?.workflow||{},r=aResearchFor(t);
  const saved=Array.isArray(w.selected_chapters)
    ? w.selected_chapters
    : (chapterOptionsForWorkflow(w).length?[]:(Array.isArray(w.chapters)?w.chapters:[]));
  const proposals=chapterProposalsFor(t);
  if(!aResearchReady(t))return'<div class="editor-c-plan-context warning"><span>Recherche non vérifiée</span><strong>La carte B ne peut pas proposer de sélection.</strong><small>La recherche, les sources et les propositions doivent être persistées dans Supabase avant l’entrée en B.</small></div>';
  if(!proposals.length)return'<div class="editor-empty">Aucune proposition structurée disponible après recherche. La tâche doit rester hors de B.</div>';
  const selected=new Set(saved.map(x=>String(x.title||x.name||x)));
  const sources=[...(Array.isArray(r.source_urls)?r.source_urls:[]),...(Array.isArray(r.sources)?r.sources:[])]
    .map(x=>typeof x==='string'?x:(x&&typeof x==='object'?(x.url||x.href||x.source_url||''):String(x||'')))
    .map(x=>String(x||'').trim()).filter(Boolean);
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
const C_PLAN_FIELD_LABELS={
  researchMethod:'Méthode de recherche',curricularBasis:'Base curriculaire / programme',researchFindings:'Constats utiles à la production',sources:'Sources / URLs',
  title:'Titre du document',chapter:'Chapitres / unité traitée',objectives:'Objectifs pédagogiques',competencies:'Compétences visées',prerequisites:'Prérequis',
  progression:'Progression pédagogique',architecture:'Architecture / plan détaillé',productionStrategy:'Stratégie de production',content:'Contenu à couvrir',
  methods:'Méthodes pédagogiques',activities:'Activités d’apprentissage',examples:'Exemples / applications',situations:'Situations / problèmes',
  exercises:'Exercices',corrections:'Corrigés / solutions',differentiation:'Différenciation / adaptations',evaluation:'Évaluation prévue',
  volume:'Volume pédagogique',duration:'Durée indicative',resources:'Ressources / illustrations',mathGeoGebra:'Mathématiques / GeoGebra',
  technicalNeeds:'Besoins techniques',pdfFormat:'Format PDF',pdfOrientation:'Orientation PDF',pdfPagination:'Pagination PDF',pdfThemeColor:'Couleur thème PDF',
  pdfLayout:'Mise en page PDF',pdfFonts:'Polices / typographie PDF',pdfHeaders:'En-têtes / pieds de page PDF',pdfResources:'Ressources PDF / QR / annexes',
  quality:'Contrôle qualité attendu',notes:'Notes éditoriales'
};
const C_AI_COMPLETION_VERSION='c-ai-completion-guard-v1';
const C_AI_ENDPOINT='/functions/v1/aurora-gemini-next';
const C_AI_PLACEHOLDERS=['à compléter','a completer','à préciser','a preciser','à renseigner','a renseigner','n/a','na','non défini','non defini','non renseigné','non renseigne','à déterminer','a determiner'];
const cAIText=v=>String(v??'').trim();
const cAIPlaceholder=v=>{
  const n=cAIText(v).toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return C_AI_PLACEHOLDERS.includes(n);
};
const cAIContext=(t,p,missing)=>{
  const w=t.metadata?.workflow||{};
  const selected=selectedChaptersFor(t).map(x=>cAIText(x?.title||x?.name||x)).filter(Boolean);
  const take=(v,n)=>cAIText(v).slice(0,n||160);
  const core=['title','chapter','objectives','competencies','progression','architecture','productionStrategy','content','methods','activities','examples','situations','exercises','corrections','evaluation','resources','technicalNeeds','pdfLayout','pdfFonts','pdfHeaders','pdfResources','quality','notes'];
  const plan={};
  core.forEach(k=>{if(!missing.includes(k)&&cAIText(p[k]))plan[k]=take(p[k],k==='content'||k==='progression'||k==='architecture'||k==='productionStrategy'||k==='quality'?220:150)});
  return {
    task:{id:t.id,title:t.title,subject:t.subject,level:t.level,class_name:t.class_name,document_type:t.document_type},
    selected_chapters:selected,
    research:{
      method:take(p.researchMethod||w.chapter_research?.methodology||w.chapter_research?.method,360),
      findings:take(p.researchFindings||w.chapter_research?.findings,500),
      sources:take(p.sources||w.chapter_research?.sources||w.chapter_research?.source_urls,650)
    },
    plan
  };
};
const parseCAIResponse=raw=>{
  const s=String(raw||'').trim();
  const first=s.indexOf('{'),last=s.lastIndexOf('}');
  if(first<0||last<=first)throw new Error('L’IA éditrice n’a pas fourni un JSON exploitable.');
  const parsed=JSON.parse(s.slice(first,last+1));
  const fields=parsed&&typeof parsed.fields==='object'&&parsed.fields?parsed.fields:parsed;
  if(!fields||typeof fields!=='object'||Array.isArray(fields))throw new Error('Réponse de complétion IA invalide.');
  return fields;
};
async function cAIRequest(t,p,missing){
  const ctx=cAIContext(t,p,missing);
  const wanted=missing.map(k=>k+' — '+(C_PLAN_FIELD_LABELS[k]||k)).join('\n');
  const prompt=[
    'Tu es l’IA éditrice d’Aurore pour la Section C.',
    'Tous les champs obligatoires du plan C doivent être remplis avant toute insertion en base et avant toute migration C vers CX.',
    'Complète UNIQUEMENT les champs actuellement manquants listés ci-dessous.',
    'Ne modifie aucun champ déjà rempli.',
    'Utilise exclusivement le contexte réel fourni. N’invente ni chapitre, ni classe, ni source, ni information curriculaire.',
    'Chaque valeur doit être directement exploitable dans un document pédagogique réel.',
    'N’utilise jamais une formule vide ou générique comme « à compléter », « à préciser », « N/A » ou équivalent.',
    'Pour notes, écris une vraie note éditoriale contextualisée. Pour pdfFonts, pdfHeaders et pdfResources, donne des choix techniques concrets.',
    'Pour sources, conserve uniquement les sources réellement fournies dans le contexte ; ne fabrique aucune URL.',
    'Réponds uniquement avec un objet JSON valide de la forme {"fields":{"clé":"valeur"}}.',
    '',
    'CHAMPS MANQUANTS :',
    wanted,
    '',
    'CONTEXTE RÉEL :',
    JSON.stringify(ctx)
  ].join('\n');
  const tokenValue=await token();
  const r=await fetch(SUPABASE_URL+C_AI_ENDPOINT,{
    method:'POST',
    headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+tokenValue,'Content-Type':'application/json'},
    body:JSON.stringify({message:prompt,conversationContext:[]})
  });
  const raw=await r.text();
  let data=null;try{data=raw?JSON.parse(raw):null}catch(_){}
  if(!r.ok)throw new Error(data?.error||raw||('IA éditrice HTTP '+r.status));
  if(!data?.text)throw new Error('L’IA éditrice n’a renvoyé aucun complément.');
  return parseCAIResponse(data.text);
}
async function completeCPlanWithAI(t,p,missing,setStatus){
  const requested=[...new Set(missing)].filter(k=>C_PLAN_REQUIRED_FIELDS.includes(k));
  let current={...p};
  const completed=[],unresolved=[];
  if(!requested.length)return {plan:current,audit:{version:C_AI_COMPLETION_VERSION,status:'already_complete',missing_before:[],completed_fields:[],unresolved_fields:[],completed_at:new Date().toISOString()}};
  for(let i=0;i<requested.length;i+=6){
    const batch=requested.slice(i,i+6);
    if(typeof setStatus==='function')setStatus('L’IA éditrice complète : '+batch.map(k=>C_PLAN_FIELD_LABELS[k]||k).join(', ')+'…');
    let fields=null;
    for(let attempt=0;attempt<2&&!fields;attempt++){
      try{fields=await cAIRequest(t,current,batch)}catch(_){}
    }
    if(!fields){unresolved.push(...batch);continue}
    batch.forEach(k=>{
      const value=cAIText(fields[k]);
      if(value&&!cAIPlaceholder(value)){current[k]=value;completed.push(k)}else unresolved.push(k);
    });
  }
  const finalGuard=cPlanCompleteness(t,current);
  return {plan:current,audit:{
    version:C_AI_COMPLETION_VERSION,status:finalGuard.ok?'completed':'blocked',
    missing_before:requested,completed_fields:[...new Set(completed)],
    unresolved_fields:[...new Set([...unresolved,...finalGuard.missing])],
    completed_at:new Date().toISOString()
  }};
}
function cGuardMarkup(t,p){
  const check=cPlanCompleteness(t,p);
  const label=check.ok?'Contrôle de complétude : prêt à être relu par l’administrateur.':'Contrôle de complétude : champs manquants à compléter par l’IA éditrice.';
  const detail=check.ok?'Tous les champs obligatoires sont présents. La validation administrative reste distincte.':'Éléments manquants : '+check.missing.map(x=>x==='selected_chapters'?'chapitres B':x==='chapter_alignment'?'alignement chapitre B/C':x==='research_source'?'au moins une source':x==='quality_detail'?'contrôle qualité détaillé':(C_PLAN_FIELD_LABELS[x]||x)).join(', ')+'.';
  return '<div class="editor-c-plan-context '+(check.ok?'':'warning')+'"><span>Garde-fou '+C_EXECUTION_CONTRACT_VERSION+'</span><strong>'+esc(label)+'</strong><small>'+esc(detail)+'</small><small data-c-ai-status>Lors de l’enregistrement et de la migration, l’IA éditrice complète les champs manquants. Si un champ reste incomplet, aucune écriture du plan et aucune migration C → CX ne sont autorisées.</small></div>';
}
function planForm(t,section){
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
    '</div><div class="editor-plan-actions"><button type="button" class="admin-btn ghost" data-plan-save="'+esc(t.id)+'">Enregistrer les modifications</button><button type="button" class="admin-btn ghost danger" data-plan-reject="'+esc(t.id)+'">Rejeter / demander une révision</button>'+
    (section==='CX'
      ? '<div class="editor-cx-validation"><div class="editor-cx-validation-head"><span>Validation CX</span><strong>Le plan est contrôlé avant son passage en D.</strong><small>Les vérifications doivent être confirmées dans cette étape. Aucun PDF n’est lancé.</small></div><div class="editor-validation-grid">'+
        ['coherence','completeness','curriculum','technical'].map((k,i)=>'<label class="editor-check"><input type="checkbox" data-admin-check="'+k+'"><span>'+['Cohérence avec la sélection B','Complétude du plan C','Conformité pédagogique / programme','Paramètres techniques et PDF vérifiés'][i]+'</span></label>').join('')+
        '</div><label class="editor-field wide"><span>Note de validation CX</span><textarea data-admin-notes rows="2" placeholder="Observations éventuelles avant passage en D…"></textarea></label><div class="editor-plan-actions"><button type="button" class="admin-btn primary" data-plan-validate="'+esc(t.id)+'">Valider en CX → passer en D</button></div></div>'
      : '<button type="button" class="admin-btn primary" data-plan-validate="'+esc(t.id)+'">Enregistrer le plan → passer en CX</button>')+
    '</div></div>';
}
function editorialContentFor(t){
  const w=t.metadata?.workflow||{},p=proposalFor(t),saved=w.editorial_content&&typeof w.editorial_content==='object'?w.editorial_content:{};
  return {title:normalizeEditorialTitle(saved.title||p.title||t.title||''),introduction:saved.introduction||'',content:saved.content||p.content||'',methods:saved.methods||p.methods||'',examples:saved.examples||p.examples||'',activities:saved.activities||p.activities||'',exercises:saved.exercises||p.exercises||'',corrections:saved.corrections||p.corrections||'',differentiation:saved.differentiation||p.differentiation||'',evaluation:saved.evaluation||p.evaluation||'',synthesis:saved.synthesis||'',notes:saved.notes||''};
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
  if(section==='C'||section==='CX')return d+meta+'<h5 class="editor-detail-title">Plan complet de production</h5>'+planForm(t,section);
  if(section==='D'||AI_WORKSPACE_SECTIONS.includes(section))return d+meta+'<h5 class="editor-detail-title">'+(section==='D'?'Production autorisée / suivi de rédaction':'Travail éditorial dans l’espace '+AI_WORKSPACE_LABELS[section])+'</h5>'+productionReadyMarkup(t);
  const researchReady=aResearchReady(t),r=aResearchFor(t),options=chapterOptionsForWorkflow(w);
  return d+meta+'<div class="editor-a-start"><strong>'+esc(researchReady?'Recherche et propositions persistées : la tâche peut passer en B.':'Cette tâche attend notre récupération et sa recherche documentaire.')+'</strong><span>'+esc(researchReady?'La migration sera effectuée seulement après une nouvelle lecture de Supabase et une vérification des sources et chapitres.':'Aucune migration vers B ne doit être faite tant que la recherche, ses sources et les propositions de chapitres ne sont pas écrites dans la tâche.')+'</span>'+(researchReady?'<div class="editor-plan-actions"><button type="button" class="admin-btn primary" data-a-promote="'+esc(t.id)+'">Transférer en B après vérification</button></div>':'')+'</div>';
}
function persistEditorialPosition(state){
  try{
    const allowed=['A','B','C','CX','D','E',...AI_WORKSPACE_SECTIONS];
    const payload={section:allowed.includes(state?.section)?state.section:'A',pages:{A:0,B:0,C:0,CX:0,D:0,E:0,CLAUDE:0,GPT:0,GROK:0}};
    Object.keys(payload.pages).forEach(k=>payload.pages[k]=Math.max(0,Number(state?.pages?.[k])||0));
    window.__auroreEditorialActiveSection=payload.section;
    window.__auroreEditorialActivePages=payload.pages;
    sessionStorage.setItem('aurore_editorial_position_v1',JSON.stringify(payload));
  }catch(_){}
}
function readEditorialPosition(){
  try{
    const raw=sessionStorage.getItem('aurore_editorial_position_v1');
    const p=raw?JSON.parse(raw):null;
    if(!p)return {section:'A',pages:{A:0,B:0,C:0,CX:0,D:0,E:0,CLAUDE:0,GPT:0,GROK:0}};
    const allowed=['A','B','C','CX','D','E',...AI_WORKSPACE_SECTIONS];
    const section=allowed.includes(p.section)?p.section:'A';
    const pages={A:0,B:0,C:0,CX:0,D:0,E:0,CLAUDE:0,GPT:0,GROK:0};
    Object.keys(pages).forEach(k=>pages[k]=Math.max(0,Number(p.pages?.[k])||0));
    return {section,pages};
  }catch(_){return {section:'A',pages:{A:0,B:0,C:0,CX:0,D:0,E:0,CLAUDE:0,GPT:0,GROK:0}};}
}
function render(root,state){
  persistEditorialPosition(state);
  const all=state.tasks, groups={A:[],B:[],C:[],CX:[],D:[],CLAUDE:[],GPT:[],GROK:[]};
  all.forEach(t=>{
    const g=classify(t);
    if(!g)return;
    // Une ancienne source E déjà transmise à une nouvelle production D
    // reste uniquement dans l'historique et ne doit jamais réapparaître en D.
    const w=t.metadata?.workflow||{};
    const archivedRevision=w.revision_status==='handed_off'
      || w.stage==='revision_archive'
      || w.pending_admin_surface==='revision_history'
      || w.production_status==='historical_revision_source';
    if(g==='D'&&archivedRevision)return;
    const ai=dAiTreatment(t),engine=String(ai?.provider||'').toUpperCase();
    if(['CLAUDE','GPT','GROK'].includes(engine)){
      if(ai?.status==='processing'||ai?.status==='failed') groups[engine].push(t);
      return;
    }
    groups[g].push(t);
  });
  const active=state.section||'A',items=active==='E'?(state.revisions||[]):(groups[active]||[]),page=state.pages[active]||0,visible=paginate(items,page);
  root.innerHTML=
  '<div class="editor-hub">'+
    '<div class="editor-hub-head"><div><span class="editor-kicker">Parcours éditorial</span><h3>Gestion des documents</h3><p>Un seul parcours, de la demande jusqu’à l’édition finale. Aucun PDF n’est lancé automatiquement.</p></div><button type="button" class="admin-btn ghost" id="editorRefresh">↻ Actualiser</button></div>'+
    '<nav class="editor-main-nav" aria-label="Étapes du parcours éditorial">'+
      ['A','B','C','CX','D','E',...AI_WORKSPACE_SECTIONS].map(k=>'<button type="button" class="editor-main-nav-item '+(active===k?'active':'')+'" data-editor-section="'+k+'"><span>'+k+'</span><strong>'+({A:'Tâches',B:'Chapitres',C:'Production',CX:'Plans traités',D:'Édition finale',E:'À réviser',CLAUDE:'Claude',GPT:'GPT',GROK:'Grok'}[k])+'</strong><em>'+((k==='E'?(state.revisions||[]):groups[k]).length)+'</em></button>').join('')+
      '<button type="button" class="editor-main-nav-link" data-editor-documents>Documents en attente <span>→</span></button>'+
    '</nav>'+
    '<section class="editor-page">'+
      '<div class="editor-page-title"><div><span class="editor-step">Section '+active+'</span><h4>'+({A:'Tâches à créer',B:'Chapitres disponibles',C:'Plan complet de production',CX:'Plans C déjà traités',D:'Édition finale / suivi de production',E:'Documents à réviser',CLAUDE:'Espace Claude',GPT:'Espace GPT',GROK:'Espace Grok'}[active])+'</h4><p>'+({A:'Crée ici les demandes avec une sélection claire et agrandie du niveau, du parcours, de la classe et de la matière.',B:'Chaque tâche récupérée présente les chapitres disponibles pour le document.',C:'Les tâches non encore traitées en C sont construites ici.',CX:'Cette zone conserve les documents dont le travail C est déjà traité et vérifié. Le plan reste consultable et modifiable avant la suite.',D:'Les documents passés après CX arrivent ici pour la rédaction finale. Aucun PDF n’est lancé automatiquement.',E:'Les documents demandés en révision sont conservés ici avec leur historique. « Reprendre en D » les remet explicitement dans la rédaction finale.'}[active])+'</p></div><span class="editor-page-count">'+items.length+' document'+(items.length>1?'s':'')+'</span></div>'+
      (active==='A'?'<form id="editorACreateForm" class="cf-admin-create-form cf-rebuild-form editor-a-create-form" novalidate>'+
  '<section class="cf-rebuild-card" aria-label="Identification"><div class="cf-rebuild-title"><span class="cf-rebuild-no">01</span><div><strong>La ressource</strong><small>Ce que tu veux faire produire</small></div></div>'+
  '<div class="cf-route-note">Le titre est généré par l’éditeur pédagogique à partir du sujet, du niveau, de la classe et du contenu réellement produit. Aucun titre n’est demandé ici.</div>'+
  '<div class="cf-rebuild-grid" style="margin-top:10px"><label class="cf-rebuild-field"><span>Type de ressource</span><select id="editorACreateResourceType"><option value="">Choisir un type…</option></select></label>'+
  '<label class="cf-rebuild-field"><span>Source pédagogique <em>(optionnel)</em></span><input id="editorACreateReference" type="text" placeholder="Manuel, chapitre, programme…"></label></div></section>'+
  '<section class="cf-rebuild-card" aria-label="Classement scolaire"><div class="cf-rebuild-title"><span class="cf-rebuild-no">02</span><div><strong>Le parcours scolaire</strong><small>Choisis le niveau, le parcours/emplacement puis la matière. Les valeurs sont issues du catalogue Aurore.</small></div></div>'+
  '<div class="cf-rebuild-grid-2"><label class="cf-rebuild-field"><span>Niveau</span><div id="editorACreateCascade"><select id="editorACreateLevelPicker"><option value="">Choisir un niveau…</option></select><div class="editor-mobile-picker" id="editorACreatePathPickerWrap"><select id="editorACreatePathPicker" disabled><option value="">Choisis d’abord un niveau…</option></select><button type="button" class="editor-mobile-picker-trigger" id="editorACreatePathPickerTrigger" disabled aria-haspopup="listbox" aria-expanded="false"><span>Choisis d’abord un niveau…</span><b>⌄</b></button><div class="editor-mobile-picker-menu" id="editorACreatePathPickerMenu" hidden><div class="editor-mobile-picker-options" id="editorACreatePathPickerOptions"></div></div></div></div></label>'+
  '<label class="cf-rebuild-field"><span>Matière</span><div class="editor-mobile-picker" id="editorACreateSubjectWrap"><select id="editorACreateSubject" disabled><option value="">Choisis d’abord un parcours…</option></select><button type="button" class="editor-mobile-picker-trigger" id="editorACreateSubjectTrigger" disabled aria-haspopup="listbox" aria-expanded="false"><span>Choisis d’abord un parcours…</span><b>⌄</b></button><div class="editor-mobile-picker-menu" id="editorACreateSubjectMenu" hidden><div class="editor-mobile-picker-options" id="editorACreateSubjectOptions"></div></div></div></label></div>'+
  '<div class="cf-route-note" id="editorACreateClassificationSummary">Aucun parcours sélectionné.</div></section>'+
  '<section class="cf-rebuild-card" aria-label="Consigne"><div class="cf-rebuild-title"><span class="cf-rebuild-no">03</span><div><strong>Le contenu</strong><small>Donne à ChatGPT la consigne éditoriale de départ</small></div></div>'+
  '<label class="cf-rebuild-field"><span>Consigne de génération</span><textarea id="editorACreatePrompt" required>Crée une fiche de révision sur le sujet indiqué avec cours, exercices et corrigés.</textarea></label></section>'+
  '<section class="cf-rebuild-card" aria-label="Édition pédagogique"><div class="cf-rebuild-title"><span class="cf-rebuild-no">04</span><div><strong>Éditeur pédagogique</strong><small>Le contenu est préparé par ChatGPT avant de poursuivre dans le parcours Aurore.</small></div></div>'+
  '<div class="cf-route-note">Éditeur actif : ChatGPT · schéma éditorial aurora-editorial-2 · contrôle humain obligatoire avant tout rendu ou publication.</div></section>'+
  '<section class="cf-rebuild-card" aria-label="Identité du PDF"><div class="cf-rebuild-title"><span class="cf-rebuild-no">05</span><div><strong>L’identité du PDF</strong><small>Choisis la couleur mémorisée avec cette tâche et pour la suite du rendu.</small></div></div>'+
  '<div class="cf-rebuild-field"><span>Couleur dominante</span><div class="cf-rebuild-theme editor-a-theme-picker"><button type="button" class="cf-theme-color-button cf-theme-color-square" id="editorAThemeToggle" aria-haspopup="true" aria-expanded="false" title="Choisir la couleur du PDF" aria-label="Choisir la couleur du PDF"><span id="editorAThemePreview" aria-hidden="true"></span></button>'+
  '<output id="editorAThemeValue">#6D28D9</output><input id="editorAThemeColor" type="color" value="#6D28D9" aria-label="Couleur personnalisée">'+
  '<div class="cf-create-theme-palette" id="editorAThemePalette" hidden><div class="cf-create-theme-swatches" id="editorAThemeSwatches" aria-label="Palette Aurore des couleurs de PDF"></div></div></div></div></section>'+
  '<section class="cf-rebuild-card" aria-label="Validation"><label class="cf-rebuild-rights"><input id="editorACreateRights" type="checkbox"><span><strong>Autoriser la production</strong><span>Je confirme que cette demande peut être utilisée par Aurore pour préparer la ressource et la soumettre au contrôle avant publication.</span></span></label>'+
  '<div class="cf-rebuild-actions"><button class="admin-btn primary" id="editorCreate" type="submit">Créer la tâche</button><span class="cf-rebuild-msg" id="editorACreateMsg" aria-live="polite"></span></div></section>'+
  '<section class="cf-form-layout-admin editor-a-form-layout" id="editorAFormLayoutAdmin" aria-label="Réglage de la forme du formulaire Section A"><div><strong>Forme du formulaire — Section A</strong><small>Réglage réservé à l’administration. Tu peux élargir horizontalement le formulaire et la zone Matière.</small></div>'+
  '<label>Largeur du formulaire <output id="editorAFormWidthOutput">1320 px</output><input id="editorAFormWidthRange" type="range" min="600" max="1600" step="20" value="1320"></label>'+
  '<label>Largeur de la zone Matière <output id="editorASubjectWidthOutput">620 px</output><input id="editorASubjectWidthRange" type="range" min="220" max="700" step="10" value="620"></label>'+
  '<button class="admin-btn ghost" id="editorAFormLayoutSave" type="button">Enregistrer la forme</button><span class="cf-form-layout-msg editor-a-layout-msg" id="editorAFormLayoutMsg" aria-live="polite"></span></section>'+
  '</form>':'')+
      '<div class="editor-block-label"><span>Bloc '+(page+1)+'</span><small>'+((page*PAGE_SIZE)+1)+'–'+Math.min((page+1)*PAGE_SIZE,items.length)+' sur '+items.length+'</small></div>'+
      '<div class="editor-card-grid">'+(visible.length?visible.map(t=>active==='E'?revisionTaskCard(t):AI_WORKSPACE_SECTIONS.includes(active)?aiWorkspaceCard(t,active):taskCard(t,active)).join(''):'<div class="editor-empty">Aucun document dans cette étape pour le moment.</div>')+'</div>'+
      pager(items.length,page,active)+
      '<section class="editor-detail" id="editorDetail" hidden></section>'+
    '</section>'+
  '</div>';
  bind(root,state);
  startDAiPolling(root,state);
}
function bind(root,state){
  root.querySelector('#editorRefresh')?.addEventListener('click',chargerEspaceEditorialChatGPT);
  root.querySelectorAll('[data-editor-section]').forEach(b=>b.addEventListener('click',()=>{
    state.section=b.dataset.editorSection;
    state.pages[state.section]=0;
    persistEditorialPosition(state);
    render(root,state);
  }));
  root.querySelector('[data-editor-documents]')?.addEventListener('click',()=>{
    const b=[...document.querySelectorAll('.admin-tab')].find(x=>x.dataset.tab==='attente');
    if(b)b.click();
  });
  root.querySelectorAll('[data-editor-page]').forEach(b=>b.addEventListener('click',()=>{const [k,p]=b.dataset.editorPage.split(':');state.section=k;state.pages[k]=Number(p);persistEditorialPosition(state);render(root,state)}));
  const form=root.querySelector('#editorACreateForm');
  const levelPicker=root.querySelector('#editorACreateLevelPicker');
  const routePicker=root.querySelector('#editorACreatePathPicker');
  const subjectPicker=root.querySelector('#editorACreateSubject');
  const resourcePicker=root.querySelector('#editorACreateResourceType');
  const classSummary=root.querySelector('#editorACreateClassificationSummary');
  let aPath=[],aRoutes=[];
  const renderAResourceTypes=()=>{
    if(!resourcePicker)return;
    const values=A_RESOURCE_TYPES;
    const current=resourcePicker.value;
    resourcePicker.innerHTML='<option value="">Choisir un type…</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
    resourcePicker.value=values.includes(current)?current:'';
  };
  const renderAPathPicker=()=>{
    const trigger=root.querySelector('#editorACreatePathPickerTrigger'),options=root.querySelector('#editorACreatePathPickerOptions');
    if(!trigger||!options)return;
    const enabled=!!aRoutes.length&&!!levelPicker?.value;
    trigger.disabled=!enabled;
    trigger.querySelector('span').textContent=routePicker?.value!==''&&aRoutes[Number(routePicker.value)]?aRoutes[Number(routePicker.value)].label:(enabled?'Choisir un parcours…':'Choisis d’abord un niveau…');
    options.innerHTML=enabled?aRoutes.map((x,i)=>'<button type="button" class="editor-mobile-picker-option '+(String(i)===String(routePicker.value)?'selected':'')+'" data-editor-route-option="'+i+'">'+esc(x.label)+'</button>').join(''):'<div class="editor-option-empty">Aucun parcours disponible.</div>';
  };
  const renderASubjectPicker=(names)=>{
    const trigger=root.querySelector('#editorACreateSubjectTrigger'),options=root.querySelector('#editorACreateSubjectOptions');
    if(!trigger||!options)return;
    const enabled=!!aPath.length&&!!names.length;
    trigger.disabled=!enabled;
    trigger.querySelector('span').textContent=subjectPicker?.value||(enabled?'Choisir une matière…':'Choisis d’abord un parcours…');
    options.innerHTML=enabled?names.map(x=>'<button type="button" class="editor-mobile-picker-option '+(x===subjectPicker.value?'selected':'')+'" data-editor-subject-option="'+esc(x)+'">'+esc(x)+'</button>').join(''):'<div class="editor-option-empty">Aucune matière disponible.</div>';
  };
  const syncASubjects=()=>{
    if(!subjectPicker)return;
    const leaf=aPath[aPath.length-1],raw=Array.isArray(leaf?.matieres)?leaf.matieres:(Array.isArray(MATIERES)?MATIERES:[]);
    const base=typeof matieresAvecAutres==='function'?matieresAvecAutres(raw):raw;
    const names=[...new Set(base.map(x=>typeof x==='string'?x:(x?.nom||'')).map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
    const current=subjectPicker.value;
    subjectPicker.innerHTML='<option value="">'+(names.length?'Choisir une matière…':'Aucune matière disponible…')+'</option>'+names.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
    subjectPicker.value=names.includes(current)?current:'';
    subjectPicker.disabled=!aPath.length||!names.length;
    renderASubjectPicker(names);
  };
  const syncAClassification=()=>{
    if(!levelPicker||!routePicker)return;
    const roots=editorClassificationRoots();
    const currentLevel=levelPicker.value;
    levelPicker.innerHTML='<option value="">Choisir un niveau…</option>'+roots.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.nom)+'</option>').join('');
    if(roots.some(n=>String(n.id)===String(currentLevel)))levelPicker.value=currentLevel;
    const rootNode=roots.find(n=>n.id===levelPicker.value)||null;
    aRoutes=rootNode?editorLeafRoutes(rootNode):[];
    routePicker.innerHTML='<option value="">'+(rootNode?'Choisir un parcours…':'Choisis d’abord un niveau…')+'</option>'+aRoutes.map((x,i)=>'<option value="'+i+'">'+esc(x.label)+'</option>').join('');
    routePicker.disabled=!rootNode||!aRoutes.length;
    const choice=aRoutes[Number(routePicker.value)];
    aPath=choice?[...choice.path]:(rootNode?[rootNode]:[]);
    renderAPathPicker();
    syncASubjects();
    if(classSummary){
      const labels=aPath.map(n=>String(n?.nom||'').trim()).filter(Boolean);
      classSummary.textContent=labels.length?labels.join(' · '):'Aucun parcours sélectionné.';
    }
  };
  const applyALayout=(rawWidth,rawSubject)=>{
     const w=root.querySelector('#editorAFormWidthRange'),sw=root.querySelector('#editorASubjectWidthRange'),wo=root.querySelector('#editorAFormWidthOutput'),swo=root.querySelector('#editorASubjectWidthOutput');
     const width=Math.max(600,Math.min(1600,Number(rawWidth)||1320));
     const subject=Math.max(220,Math.min(700,Number(rawSubject)||620));
     root.style.setProperty('--editor-a-form-width',width+'px');
     root.style.setProperty('--editor-a-subject-width',subject+'px');
     if(form){
       form.style.setProperty('--editor-a-form-width',width+'px');
       form.style.setProperty('--editor-a-subject-width',subject+'px');
       form.style.removeProperty('width');
       form.style.removeProperty('max-width');
       form.style.removeProperty('min-width');
       form.style.removeProperty('justify-self');
       const grid=form.querySelector('.cf-rebuild-grid-2');
       if(grid){
         grid.style.removeProperty('grid-template-columns');
         grid.style.removeProperty('min-width');
       }
     }
     if(w)w.value=String(width);
     if(sw)sw.value=String(subject);
     if(wo)wo.textContent=width+' px';
     if(swo)swo.textContent=subject+' px';
   };
   const loadALayout=async()=>{
     const w=root.querySelector('#editorAFormWidthRange'),sw=root.querySelector('#editorASubjectWidthRange');
     if(!w||!sw)return;
     try{
       const rows=await rest('/rest/v1/aurore_admin_interface_settings?select=setting_value&setting_key=eq.'+encodeURIComponent('content_factory_section_a_form'));
       const cfg=Array.isArray(rows)&&rows[0]?.setting_value?rows[0].setting_value:{};
       applyALayout(cfg.max_width_px,cfg.subject_width_px);
     }catch(_){ applyALayout(w.value,sw.value); }
   };
  const syncTheme=()=>{
    const input=root.querySelector('#editorAThemeColor'),value=root.querySelector('#editorAThemeValue'),preview=root.querySelector('#editorAThemePreview'),swatches=root.querySelector('#editorAThemeSwatches');
    const color=normalizeAThemeColor(input?.value||'#6D28D9');
    if(input)input.value=color;if(value)value.textContent=color;if(preview)preview.style.backgroundColor=color;
    swatches?.querySelectorAll('[data-editor-a-theme]').forEach(b=>b.classList.toggle('is-selected',normalizeAThemeColor(b.dataset.editorATheme)===color));
    return color;
  };
  const ensureThemePalette=()=>{
    const swatches=root.querySelector('#editorAThemeSwatches');if(!swatches)return;
    if(!swatches.children.length){
      swatches.innerHTML=A_THEME_PALETTE.map(([name,color])=>'<button type="button" class="cf-create-theme-swatch" data-editor-a-theme="'+color+'" title="'+esc(name)+'" aria-label="Choisir '+esc(name)+'" style="--cf-swatch:'+color+'"><span class="editor-a-theme-dot"></span><span class="editor-a-theme-name">'+esc(name)+'</span></button>').join('');
    }
  };
  if(form){
    renderAResourceTypes();syncAClassification();syncTheme();loadALayout();
    levelPicker?.addEventListener('change',()=>{aPath=[];syncAClassification()});
    routePicker?.addEventListener('change',()=>{const choice=aRoutes[Number(routePicker.value)];aPath=choice?[...choice.path]:aPath.slice(0,1);renderAPathPicker();syncASubjects();if(classSummary){const labels=aPath.map(n=>String(n?.nom||'').trim()).filter(Boolean);classSummary.textContent=labels.length?labels.join(' · '):'Aucun parcours sélectionné.';}});
    subjectPicker?.addEventListener('change',()=>{renderASubjectPicker([...subjectPicker.options].slice(1).map(o=>o.value).filter(Boolean))});
    root.querySelector('#editorACreatePathPickerTrigger')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const m=root.querySelector('#editorACreatePathPickerMenu');if(m)m.hidden=!m.hidden;root.querySelector('#editorACreateSubjectMenu')?.setAttribute('hidden','true')});
    root.querySelector('#editorACreatePathPickerOptions')?.addEventListener('click',e=>{const b=e.target?.closest?.('[data-editor-route-option]');if(!b)return;routePicker.value=b.dataset.editorRouteOption;routePicker.dispatchEvent(new Event('change',{bubbles:true}));root.querySelector('#editorACreatePathPickerMenu')?.setAttribute('hidden','true')});
    root.querySelector('#editorACreateSubjectTrigger')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const m=root.querySelector('#editorACreateSubjectMenu');if(m)m.hidden=!m.hidden;root.querySelector('#editorACreatePathPickerMenu')?.setAttribute('hidden','true')});
    root.querySelector('#editorACreateSubjectOptions')?.addEventListener('click',e=>{const b=e.target?.closest?.('[data-editor-subject-option]');if(!b)return;subjectPicker.value=b.dataset.editorSubjectOption;subjectPicker.dispatchEvent(new Event('change',{bubbles:true}));root.querySelector('#editorACreateSubjectMenu')?.setAttribute('hidden','true')});
    root.querySelector('#editorAThemeColor')?.addEventListener('input',syncTheme);
    root.querySelector('#editorAThemeToggle')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();ensureThemePalette();const p=root.querySelector('#editorAThemePalette');if(!p)return;p.hidden=!p.hidden;root.querySelector('#editorAThemeToggle')?.setAttribute('aria-expanded',String(!p.hidden));syncTheme();});
    root.querySelector('#editorAThemeColor')?.addEventListener('change',()=>{syncTheme();const p=root.querySelector('#editorAThemePalette');if(p)p.hidden=true;root.querySelector('#editorAThemeToggle')?.setAttribute('aria-expanded','false');});
    root.querySelector('#editorAThemeSwatches')?.addEventListener('click',e=>{const b=e.target?.closest?.('[data-editor-a-theme]');if(!b)return;e.preventDefault();const input=root.querySelector('#editorAThemeColor');if(input)input.value=normalizeAThemeColor(b.dataset.editorATheme);syncTheme();const p=root.querySelector('#editorAThemePalette');if(p)p.hidden=true;root.querySelector('#editorAThemeToggle')?.setAttribute('aria-expanded','false');});
    root.querySelector('#editorAFormWidthRange')?.addEventListener('input',e=>{
      const subject=Number(root.querySelector('#editorASubjectWidthRange')?.value)||620;
      applyALayout(e.target.value,subject);
    });
    root.querySelector('#editorASubjectWidthRange')?.addEventListener('input',e=>{
      const width=Number(root.querySelector('#editorAFormWidthRange')?.value)||1320;
      applyALayout(width,e.target.value);
    });
        root.querySelector('#editorAFormLayoutSave')?.addEventListener('click',async()=>{
      const btn=root.querySelector('#editorAFormLayoutSave'),msg=root.querySelector('#editorAFormLayoutMsg');
      const width=Math.max(600,Math.min(1600,Number(root.querySelector('#editorAFormWidthRange')?.value)||1320));
      const subject=Math.max(220,Math.min(700,Number(root.querySelector('#editorASubjectWidthRange')?.value)||620));
      if(btn)btn.disabled=true;if(msg)msg.textContent='Enregistrement…';
      try{
        const body={setting_key:'content_factory_section_a_form',setting_value:{max_width_px:width,subject_width_px:subject},updated_at:new Date().toISOString()};
        await rest('/rest/v1/aurore_admin_interface_settings?setting_key=eq.'+encodeURIComponent('content_factory_section_a_form'),{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(body)});
        const rows=await rest('/rest/v1/aurore_admin_interface_settings?select=setting_value&setting_key=eq.'+encodeURIComponent('content_factory_section_a_form'));
        const saved=Array.isArray(rows)&&rows[0]?.setting_value?rows[0].setting_value:null;
        if(Number(saved?.max_width_px)!==width||Number(saved?.subject_width_px)!==subject)throw new Error('La valeur enregistrée n’a pas pu être vérifiée.');
        applyALayout(width,subject);
        if(msg)msg.textContent='Forme enregistrée et vérifiée.';
      }catch(e){if(msg)msg.textContent='Impossible d’enregistrer la forme : '+(e.message||e);}
      finally{if(btn)btn.disabled=false;}
    });
    form?.addEventListener('submit',async e=>{e.preventDefault();
      const resourceType=(resourcePicker?.value||'').trim(),reference=(root.querySelector('#editorACreateReference')?.value||'').trim(),prompt=(root.querySelector('#editorACreatePrompt')?.value||'').trim(),subject=(subjectPicker?.value||'').trim(),rights=!!root.querySelector('#editorACreateRights')?.checked,themeColor=normalizeAThemeColor(root.querySelector('#editorAThemeColor')?.value||'#6D28D9');
      const level=rootNodeName(levelPicker),className=String(aPath[aPath.length-1]?.nom||'').trim(),path=aPath.map(n=>String(n?.nom||'').trim()).filter(Boolean),location=path.join(' · ');
      if(!resourceType||!level||!className||!subject||!prompt||!rights){const msg=root.querySelector('#editorACreateMsg');if(msg){msg.dataset.state='error';msg.textContent='Complète le type, le classement, la consigne et l’autorisation de production.';}return}
      const b=root.querySelector('#editorCreate'),msg=root.querySelector('#editorACreateMsg');if(b)b.disabled=true;
      try{await createTask({documentType:resourceType,reference,prompt,themeColor,subject,level,className,path,location});if(msg){msg.dataset.state='ok';msg.textContent='✓ Tâche enregistrée dans la Section A.'}await chargerEspaceEditorialChatGPT(state.section)}catch(e){if(msg){msg.dataset.state='error';msg.textContent='Impossible de créer la tâche : '+(e.message||e)}}finally{if(b)b.disabled=false}
    });
  }
  
  root.querySelectorAll('[data-revision-begin]').forEach(b=>b.addEventListener('click',async()=>{
    const id=Number(b.dataset.revisionBegin);if(!id)return;
    b.disabled=true;b.textContent='Création de la D…';
    try{
      const result=await createNewDProductionFromRevision(id);
      alert('Nouvelle production D créée (#'+result.new_job_id+'). Le contenu sera réécrit avant son passage dans Documents en attente. Aucun PDF n’a été lancé.');
      await chargerEspaceEditorialChatGPT('D');
    }catch(e){alert(e.message||e);b.disabled=false;b.textContent='Reprendre en D'}
  }));
  root.querySelectorAll('[data-ai-retry]').forEach(b=>b.addEventListener('click',async()=>{
    const id=Number(b.dataset.aiRetry),t=(state.tasks||[]).find(x=>Number(x.id)===id),provider=String(t?.metadata?.workflow?.ai_treatment?.provider||'').toLowerCase();
    if(!provider)return;b.disabled=true;b.textContent='Reprise…';
    try{await startDaiTreatment(id,provider);await chargerEspaceEditorialChatGPT(provider.toUpperCase())}catch(e){b.disabled=false;b.textContent='Reprendre';alert(e.message||e)}
  }));
  root.querySelectorAll('[data-ai-provider-job]').forEach(sel=>sel.addEventListener('change',e=>{
    try{const value=String(e.target.value||'').toLowerCase();if(D_AI_PROVIDERS.some(([id])=>id===value))localStorage.setItem('aurore_d_ai_provider',value)}catch(_){}
  }));
  root.querySelectorAll('[data-ai-start]').forEach(b=>b.addEventListener('click',async()=>{
    const id=Number(b.dataset.aiStart),sel=root.querySelector('[data-ai-provider-job="'+id+'"]'),provider=String(sel?.value||dAiProviderFor((state.tasks||[]).find(x=>Number(x.id)===id))||'grok').toLowerCase();
    if(b.disabled)return;
    b.disabled=true;b.textContent='Démarrage…';
    try{
      await startDaiTreatment(id,provider);
      await chargerEspaceEditorialChatGPT(provider.toUpperCase());
    }catch(e){
      b.disabled=false;b.textContent='Traiter';
      alert(e.message||e);
    }
  }));
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
      await chargerEspaceEditorialChatGPT(state.section);
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
      const available=new Set(chapterOptionsForWorkflow(fw).map(x=>String(x?.title||x?.name||x)));
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
      await chargerEspaceEditorialChatGPT(state.section)
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
  const persistPlan=async({targetStage,targetStatus}={})=>{
    const fresh=await getJob(t.id);
    if(!fresh)throw new Error('Tâche introuvable.');
    const fw=fresh.metadata?.workflow||{};
    const selected=Array.isArray(fw.selected_chapters)?fw.selected_chapters:(Array.isArray(fw.chapters)?fw.chapters:[]);
    if(!selected.length)throw new Error('Le plan ne peut pas être enregistré : aucun chapitre validé en section B.');
    let p=collectPlan();
    let guard=cPlanCompleteness(fresh,p);
    const setGuardStatus=message=>{
      const el=d.querySelector('[data-c-ai-status]');
      if(el)el.textContent=message;
    };
    let completionAudit={version:C_AI_COMPLETION_VERSION,status:'already_complete',missing_before:[],completed_fields:[],unresolved_fields:[],completed_at:new Date().toISOString()};
    if(!guard.ok){
      const completed=await completeCPlanWithAI(fresh,p,guard.missing,setGuardStatus);
      p=completed.plan;
      completionAudit=completed.audit;
      guard=cPlanCompleteness(fresh,p);
      if(!guard.ok){
        setGuardStatus('Écriture et migration bloquées : '+guard.missing.map(x=>C_PLAN_FIELD_LABELS[x]||x).join(', ')+' restent incomplets après intervention de l’IA éditrice.');
        throw new Error('Garde-fou C : l’IA éditrice n’a pas réussi à compléter tous les champs obligatoires. Champs/contrôles manquants : '+guard.missing.map(x=>C_PLAN_FIELD_LABELS[x]||x).join(', '));
      }
    }
    setGuardStatus('Garde-fou C validé : tous les champs obligatoires sont complets. Écriture autorisée.');
    const stage=targetStage||fw.stage||'proposition_editoriale';
    const status=targetStatus||fw.proposal_status||'plan_editing';
    const updated=await updateJob(t.id,{
      proposal:p,
      proposal_version:Number(fw.proposal_version||0)+1,
      proposal_status:status,
      stage,
      rejected:false,
      revision_requested:false,
      user_validated:false,
      revision_note:p.revisionNotes||fw.revision_note||'',
      c_completion_guard:completionAudit,
      execution_contract:C_EXECUTION_CONTRACT,
      execution_contract_acknowledged:true,
      completion_guard:C_EXECUTION_CONTRACT_VERSION,
      ...(stage==='proposal_review'?{admin_validation:null}:{}),
      manual_pdf_launch_required:true,
      auto_pdf_launch:false
    });
    const verified=await getJob(t.id);
    const verifiedPlan=verified?.metadata?.workflow?.proposal;
    const verifiedGuard=verified?cPlanCompleteness(verified,proposalFor(verified)):null;
    if(!verified||!verifiedPlan||!verifiedGuard?.ok)throw new Error('Garde-fou C : le plan complet n’a pas pu être confirmé après écriture dans Supabase.');
    return verified;
  };
  d.querySelector('[data-plan-save]')?.addEventListener('click',async()=>{
    const button=d.querySelector('[data-plan-save]');if(button)button.disabled=true;
    try{
      const fresh=await getJob(t.id);
      const currentStage=fresh?.metadata?.workflow?.stage||(state.section==='CX'?'proposal_review':'proposition_editoriale');
      const updated=await persistPlan({targetStage:currentStage,targetStatus:'plan_editing'});
      if(!updated?.metadata?.workflow?.proposal)throw new Error('Le plan n’a pas pu être confirmé après enregistrement.');
      alert('Plan complet enregistré. Le garde-fou C est validé.');
      await chargerEspaceEditorialChatGPT(state.section)
    }catch(e){alert(e.message||e)}finally{if(button)button.disabled=false}
  });
  d.querySelector('[data-plan-reject]')?.addEventListener('click',async()=>{
    const reason=d.querySelector('[data-plan-field="revisionNotes"]')?.value.trim()||'';
    if(!reason&&!confirm('Aucune demande de révision n’est renseignée. Rejeter quand même cette carte ?'))return;
    try{
      await updateJob(t.id,{stage:'revision_requested',proposal_status:'revision_requested',rejected:true,revision_requested:true,revision_note:reason,user_validated:false});
      await chargerEspaceEditorialChatGPT(state.section)
    }catch(e){alert(e.message||e)}
  });
  d.querySelector('[data-plan-validate]')?.addEventListener('click',async()=>{
    const button=d.querySelector('[data-plan-validate]');if(button)button.disabled=true;
    try{
      if(state.section==='CX'){
        const refreshed=await persistPlan({targetStage:'proposal_review',targetStatus:'plan_editing'});
        if(refreshed?.metadata?.workflow?.stage!=='proposal_review')throw new Error('Garde-fou C : le plan complet n’a pas pu être confirmé avant la validation CX.');
        const checks={};d.querySelectorAll('[data-admin-check]').forEach(x=>checks[x.dataset.adminCheck]=x.checked);
        if(!Object.values(checks).every(Boolean))throw new Error('Validation CX bloquée : toutes les vérifications doivent être confirmées.');
        const notes=d.querySelector('[data-admin-notes]')?.value.trim()||'';
        const fresh=await getJob(t.id),stage=fresh?.metadata?.workflow?.stage;
        if(!fresh||!['proposal_review','admin_validation','edition_ready'].includes(stage))throw new Error('Validation CX bloquée : la tâche n’est plus dans l’étape de validation.');
        const migrated=await updateJob(t.id,{stage:'redaction',editor_ready:true,chatgpt_editable:true,user_validated:true,proposal_status:'validated_for_editing',production_status:'ready_for_editing',production_started_at:null,admin_validation:{...checks,notes,status:'validated',validated_at:new Date().toISOString()},auto_pdf_launch:false,manual_pdf_launch_required:true,execution_contract:D_EXECUTION_CONTRACT,execution_contract_acknowledged:true,completion_guard:D_EXECUTION_CONTRACT_VERSION},'draft');
        if(migrated?.metadata?.workflow?.stage!=='redaction')throw new Error('La migration CX → D n’a pas pu être confirmée après relecture de Supabase.');
      }else{
        const updated=await persistPlan({targetStage:'proposal_review',targetStatus:'ready_for_admin_validation'});
        const wf=updated?.metadata?.workflow||{};
        if(wf.stage!=='proposal_review'||wf.proposal_status!=='ready_for_admin_validation')throw new Error('Le passage C → CX n’a pas pu être confirmé après relecture de Supabase.');
      }
      await chargerEspaceEditorialChatGPT(state.section);
    }catch(e){alert(e.message||e)}finally{if(button)button.disabled=false}
  });

  const collectEditorial=()=>{
    const e=editorialContentFor(t);
    const map={editorTitle:'title',editorIntroduction:'introduction',editorContent:'content',editorMethods:'methods',editorExamples:'examples',editorActivities:'activities',editorExercises:'exercises',editorCorrections:'corrections',editorDifferentiation:'differentiation',editorEvaluation:'evaluation',editorSynthesis:'synthesis',editorNotes:'notes'};
    d.querySelectorAll('[data-plan-field]').forEach(el=>{const key=map[el.dataset.planField];if(key)e[key]=el.value.trim()});
    return e;
  };
  function parseExerciseEditorialValue(raw,field){
    if(Array.isArray(raw))return raw;
    const text=String(raw||'').trim();
    if(!text)return [];
    try{
      const parsed=JSON.parse(text);
      if(Array.isArray(parsed))return parsed;
      if(parsed&&Array.isArray(parsed.exercises))return parsed.exercises;
    }catch(_){}
    const matches=[...text.matchAll(/(?:^|\n)\s*(?:exercice|exercise)\s*(\d+)\s*[:.\-–—]?\s*/gi)];
    if(matches.length){
      return matches.map((m,i)=>{
        const end=i+1<matches.length?matches[i+1].index:text.length;
        const body=text.slice(m.index+m[0].length,end).trim();
        return field==='corrections'
          ? {exercise_number:Number(m[1]),correction:body}
          : {exercise_number:Number(m[1]),title:'Exercice '+m[1],statement:body};
      });
    }
    const chunks=text.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
    return chunks.map((body,i)=>field==='corrections'
      ? {exercise_number:i+1,correction:body}
      : {exercise_number:i+1,title:'Exercice '+(i+1),statement:body});
  }
  function exerciseEditorialPayload(e,t){
    const exercises=parseExerciseEditorialValue(e.exercises,'exercises');
    const corrections=parseExerciseEditorialValue(e.corrections,'corrections');
    const byNumber=new Map();
    corrections.forEach((c,i)=>{
      const n=Number(c?.exercise_number||c?.number||i+1);
      byNumber.set(n,String(c?.correction||c?.solution||c?.details||c?.content||'').trim());
    });
    const normalized=exercises.map((x,i)=>{
      const n=Number(x?.exercise_number||x?.number||i+1);
      return {
        exercise_number:n,
        title:String(x?.title||('Exercice '+n)).trim(),
        statement:String(x?.statement||x?.question||x?.enonce||x?.content||'').trim(),
        correction:String(x?.correction||x?.solution||x?.details||byNumber.get(n)||'').trim(),
        difficulte:x?.difficulte||x?.difficulty||null,
        competences:Array.isArray(x?.competences)?x.competences:[],
        statement_graphs:Array.isArray(x?.statement_graphs)?x.statement_graphs:[],
        correction_graphs:Array.isArray(x?.correction_graphs)?x.correction_graphs:[],
        metadata:x?.metadata&&typeof x.metadata==='object'?x.metadata:{}
      };
    });
    const subject=String(t?.subject||'');
    const supported=/(math|mathematiques|mathématiques|physique|chimie|sciences physiques|(^|\s)pc(\s|$))/i.test(subject);
    const decisions=normalized.map((x,i)=>({
      exercise_number:i+1,
      statement:x.statement_graphs.length
        ? {decision:'build',graph_ids:x.statement_graphs.map(g=>String(g?.id||'')).filter(Boolean)}
        : {decision:'not_needed',rationale:supported?'Aucune construction GeoGebra explicite n’est présente dans l’énoncé final.':'Aucune construction GeoGebra n’est requise pour cet énoncé.'},
      correction:x.correction_graphs.length
        ? {decision:'build',graph_ids:x.correction_graphs.map(g=>String(g?.id||'')).filter(Boolean)}
        : {decision:'not_needed',rationale:supported?'Aucune construction GeoGebra explicite n’est présente dans le corrigé final.':'Aucune construction GeoGebra n’est requise pour ce corrigé.'}
    }));
    const plan={schema_version:'exercise-geogebra-plan-1',decisions};
    return {
      title:e.title,
      subject,
      sections:normalized.map(x=>({
        title:x.title,
        content:[x.statement],
        exercises:[x],
        corrections:[{exercise_number:x.exercise_number,exercise_id:'exercise-'+x.exercise_number,content:x.correction,graphs:x.correction_graphs}],
        graphs:[]
      })),
      corrections:normalized.map(x=>({exercise_number:x.exercise_number,exercise_id:'exercise-'+x.exercise_number,content:x.correction,graphs:x.correction_graphs})),
      exercise_geogebra_plan:plan,
      metadata:{exercise_geogebra_plan:plan}
    };
  }
  const editorialPayload=(e,t=null)=>{
    const rawType=String(t?.document_type||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
    if(rawType==='serie d exercices'||rawType==='serie exercices')return exerciseEditorialPayload(e,t);
    return {title:e.title,sections:[
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
  ].filter(x=>x.content||x.title==='Contenu du cours')};
  };
  function dDocumentProfile(t){
    const raw=String(t?.document_type||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
    if(raw==='qcm')return {kind:'document',version:'document-v1',lock:true,document_type:'QCM',subtype:'qcm'};
    if(raw==='cours')return {kind:'cours',version:'course-v2',lock:true,document_type:'Cours'};
    if(raw==='fiche de revision')return {kind:'cours',version:'course-v2',lock:true,document_type:'Fiche de révision'};
    if(raw==='serie d exercices'||raw==='serie exercices')return {kind:'exercices',version:'exercise-sheet-v2',lock:true,document_type:'Série d’exercices'};
    return aProfile(t?.document_type||'Document');
  }
  const SCIENTIFIC_LATEX_DENSITY_VERSION='scientific-preflight-1';
  const SCIENTIFIC_LATEX_DENSITY_MIN=400;
  function isScientificDocument(t){
    const subject=String(t?.subject||'').toLocaleLowerCase('fr').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
    return /(^|[^a-z])(maths|mathematiques|mathematique|physique|chimie|sciences physiques|pc)([^a-z]|$)/i.test(subject)
      || subject.includes('physique-chimie')
      || subject.includes('physique chimie');
  }
  async function scientificLatexDensityGuard(t,e){
    if(!isScientificDocument(t)){
      return {
        required:false,
        ok:true,
        status:'not_required',
        contract_version:SCIENTIFIC_LATEX_DENSITY_VERSION,
        minimum_elements:SCIENTIFIC_LATEX_DENSITY_MIN,
        converted_elements:null,
        message:'Garde-fou scientifique LaTeX non requis pour cette matière.'
      };
    }
    const result=await rpc('aurora_scientific_preflight',{
      p_subject:t.subject,
      p_document_type:t.document_type||'cours',
      p_content_json:editorialPayload(e,t)
    });
    const report=(result&&typeof result==='object')?result:{};
    const metrics=report.metrics&&typeof report.metrics==='object'?report.metrics:{};
    const count=Number(metrics.latex_conversion_elements||0);
    const minimum=Number(metrics.minimum_latex_conversion_elements||SCIENTIFIC_LATEX_DENSITY_MIN);
    const failures=Array.isArray(report.failures)?report.failures.filter(Boolean).map(String):[];
    const densityFailure=failures.find(x=>/(?:MATH|SCI)-LATEX-400/.test(x));
    const message=densityFailure||failures[0]||(
      report.status==='pass'
        ? 'Préflight scientifique validé.'
        : 'Préflight scientifique bloqué : correction éditoriale requise avant insertion.'
    );
    return {
      ...report,
      required:true,
      ok:report.status==='pass' && count>=minimum,
      status:report.status||'blocked',
      contract_version:report.contract_version||SCIENTIFIC_LATEX_DENSITY_VERSION,
      minimum_elements:minimum,
      converted_elements:count,
      missing_elements:Math.max(0,minimum-count),
      failures,
      message
    };
  }
  const saveEditorial=async()=>{
    const e=collectEditorial();
    e.title=normalizeEditorialTitle(e.title);
    if(!e.title)throw new Error('Le titre final est obligatoire.');
    if(!e.content)throw new Error('Le contenu final est obligatoire.');
    const updated=await updateJob(t.id,{editorial_content:{...e,updated_at:new Date().toISOString(),editor:EDITOR,source_plan_version:Number(t.metadata?.workflow?.proposal_version||0)},stage:'production_en_cours',production_status:'editorial_in_progress',execution_contract:D_EXECUTION_CONTRACT,execution_contract_acknowledged:true,completion_guard:D_EXECUTION_CONTRACT_VERSION,auto_pdf_launch:false,manual_pdf_launch_required:true},'draft');
    if(updated?.metadata?.workflow?.stage!=='production_en_cours')throw new Error('L’édition D n’a pas pu être confirmée après relecture de Supabase.');
    return {updated,e};
  };
  d.querySelector('[data-d-save]')?.addEventListener('click',async()=>{
    const button=d.querySelector('[data-d-save]');if(button)button.disabled=true;
    try{await saveEditorial();alert('Édition enregistrée dans la tâche D.');await chargerEspaceEditorialChatGPT(state.section)}catch(e){alert(e.message||e)}finally{if(button)button.disabled=false}
  });
  d.querySelector('[data-d-finish]')?.addEventListener('click',async()=>{
    const button=d.querySelector('[data-d-finish]');if(button)button.disabled=true;
    try{
      const {e}=await saveEditorial();
      const fresh=await getJob(t.id),fw=fresh?.metadata?.workflow||{};
      if(!fresh||!fw.editorial_content?.updated_at)throw new Error('Garde-fou D : la production éditoriale n’est pas persistée.');
      const latexGuard=await scientificLatexDensityGuard(fresh,e);
      await updateJob(t.id,{scientific_latex_density:{...latexGuard,checked_at:new Date().toISOString(),editor:EDITOR}});
      if(latexGuard.required&&!latexGuard.ok){
        const detail=Array.isArray(latexGuard.failures)&&latexGuard.failures.length
          ? latexGuard.failures.join(' ')
          : (latexGuard.message||'Préflight scientifique non satisfait.');
        throw new Error(detail);
      }
      const revisionNo=Number(fw.revision_no||0);
      const ingestId='AUR-D-'+t.id+'-v'+Number(fw.proposal_version||1)+(revisionNo>0?'-R'+revisionNo:'');
      const dProfile=dDocumentProfile(t);
      const payload={ingest_id:ingestId,job_id:Number(t.id),title:e.title,subject:t.subject,level:t.level,class_name:t.class_name,document_type:t.document_type||'Cours',content_json:editorialPayload(e),instructions:{category:'Documents',source:'Aurore — Section D',workflow_stage:'edition',manual_pdf_launch_required:true,profile:dProfile},metadata:{origin:'Aurore — Section D',source_job_id:t.id,chapter:proposalFor(fresh).chapter,workflow_stage:'edition',auto_pdf_launch:false,manual_pdf_launch_only:true,aurore_profile:dProfile},matiere:t.subject,theme_color:proposalFor(fresh).pdfThemeColor||'#6D28D9'};
      const isExerciseProfile=dProfile?.kind==='exercices'&&dProfile?.version==='exercise-sheet-v2';
      const ingested=isExerciseProfile
        ? await rpc('aurora_ingest_exercise_series_editorial',{p_payload:{
            ingest_id:ingestId,content_job_id:Number(t.id),title:e.title,subject:t.subject,level:t.level,class_name:t.class_name,
            matiere:t.subject,prompt:e.content||'',filiere:t.metadata?.filiere||'',
            profile:dProfile,presentation:{type:'exercise_series',sequence:['title','toc','exercise','correction'],compact_text:true,formula_priority:true,detailed_corrections:true},
            content_json:editorialPayload(e,t),
            metadata:{origin:'gpt_editorial_ingest',source_job_id:t.id,workflow_stage:'edition',auto_pdf_launch:false,manual_pdf_launch_only:true,aurore_profile:dProfile}
          }})
        : await rpc('aurora_connector_ingest_editorial_document',{p_payload:payload});
      const docId=Number(ingested?.generated_document_id);
      if(!Number.isSafeInteger(docId)||docId<1)throw new Error('Le pont éditorial n’a pas retourné de generated_document_id.');
      const done=await updateJob(t.id,{stage:'production_terminee',production_status:'editorial_completed',production_completed_at:new Date().toISOString(),generated_document_id:docId,pending_admin_surface:'documents_en_attente',editorial_ingest_id:ingestId,auto_pdf_launch:false,manual_pdf_launch_required:true,execution_contract:D_EXECUTION_CONTRACT,completion_guard:D_EXECUTION_CONTRACT_VERSION},'review');
      if(done?.metadata?.workflow?.generated_document_id!==docId||done?.metadata?.workflow?.stage!=='production_terminee')throw new Error('Garde-fou D : la production terminée n’a pas été confirmée.');
      alert('Édition terminée : document envoyé vers « Documents en attente ». PDF non lancé.');
      await chargerEspaceEditorialChatGPT(state.section);
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
      await chargerEspaceEditorialChatGPT(state.section)
    }catch(e){alert(e.message||e)}
  });
  d.querySelector('[data-admin-reject]')?.addEventListener('click',async()=>{
    const notes=d.querySelector('[data-admin-notes]')?.value.trim()||'';
    try{await updateJob(t.id,{stage:'revision_requested',admin_validation:{status:'rejected',notes,updated_at:new Date().toISOString()},revision_requested:true,rejected:false});await chargerEspaceEditorialChatGPT(state.section)}catch(e){alert(e.message||e)}
  });
}
function injectStyle(){
  if(document.getElementById('aurore-editorial-v2-styles'))return;
  const s=document.createElement('style');s.id='aurore-editorial-v2-styles';s.textContent=`
#auroreEditorialTaskAdmin .editor-a-create-form{width:min(var(--editor-a-form-width,1320px),100%) !important;max-width:var(--editor-a-form-width,1320px) !important;min-width:0 !important;justify-self:center !important;margin-left:auto !important;margin-right:auto !important;box-sizing:border-box;display:grid;gap:14px}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-grid-2{grid-template-columns:minmax(0,1fr) minmax(0,var(--editor-a-subject-width,620px)) !important;min-width:0 !important}
#auroreEditorialTaskAdmin,#auroreEditorialTaskAdmin .editor-hub,#auroreEditorialTaskAdmin .editor-page{min-width:0;max-width:100%;box-sizing:border-box}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-grid,
#auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-grid-2,
#auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-card,
#auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-field{min-width:0}
@media(max-width:720px){
 #auroreEditorialTaskAdmin .editor-a-create-form{width:100% !important;max-width:100% !important;min-width:0 !important;margin-left:0 !important;margin-right:0 !important}
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-card,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-title,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-title>div,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-field,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-field>span,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-rights,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-rights>span{min-width:0;max-width:100%;box-sizing:border-box}
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-title{display:flex;flex-wrap:wrap;overflow-wrap:anywhere}
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-title>div{flex:1 1 0}
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-field>span,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-title small,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-rights span{overflow-wrap:anywhere;word-break:break-word}
 #auroreEditorialTaskAdmin .editor-a-create-form .editor-a-form-layout{grid-template-columns:1fr !important;min-width:0 !important;width:100% !important;max-width:100% !important;overflow:hidden}
 #auroreEditorialTaskAdmin .editor-a-create-form .editor-a-form-layout>div,
 #auroreEditorialTaskAdmin .editor-a-create-form .editor-a-form-layout>label{min-width:0;width:100%;max-width:100%;box-sizing:border-box}
 #auroreEditorialTaskAdmin .editor-a-create-form .editor-a-form-layout output{float:none;margin-left:6px}
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-palette{left:0;right:0;width:auto;max-width:100%;box-sizing:border-box}
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-swatches{grid-template-columns:repeat(2,minmax(0,1fr));min-width:0}
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-swatch{min-width:0}
 #auroreEditorialTaskAdmin .editor-a-create-form .editor-a-theme-name{min-width:0}
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-grid,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-grid-2{grid-template-columns:1fr !important}
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-card,
 #auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-field,
 #auroreEditorialTaskAdmin .editor-a-create-form input,
 #auroreEditorialTaskAdmin .editor-a-create-form select,
 #auroreEditorialTaskAdmin .editor-a-create-form textarea{width:100%;max-width:100%;min-width:0;box-sizing:border-box}
 #auroreEditorialTaskAdmin .editor-a-create-form .editor-a-form-layout{width:100%;max-width:100%;box-sizing:border-box;margin-left:0;margin-right:0}
 #auroreEditorialTaskAdmin .editor-a-create-form .editor-a-form-layout input[type=range]{width:100%;min-width:0}
}
#auroreEditorialTaskAdmin .editor-a-create-form .editor-a-theme-picker{position:relative;z-index:30;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:7px;overflow:visible}
#auroreEditorialTaskAdmin .editor-a-create-form .editor-a-theme-picker .cf-theme-color-button{flex:0 0 auto}
#auroreEditorialTaskAdmin .editor-a-create-form #editorAThemeValue{font-size:.68rem;font-weight:850;color:var(--theme-primary,#6D28D9);margin-left:0}
#auroreEditorialTaskAdmin .editor-a-create-form #editorAThemeColor{width:42px;height:34px;padding:2px;border:1px solid var(--theme-border,var(--editor-border));border-radius:9px;background:var(--editor-surface);color:inherit;cursor:pointer;opacity:1;pointer-events:auto;box-sizing:border-box}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-palette{position:absolute;left:0;top:calc(100% + 9px);width:min(560px,calc(100vw - 32px));max-height:min(390px,calc(100vh - 170px));overflow:auto;box-sizing:border-box;padding:14px;border:1px solid var(--theme-border,var(--editor-border));border-radius:17px;background:var(--editor-surface);color:var(--editor-text);box-shadow:0 22px 55px var(--theme-shadow,rgba(0,0,0,.18));backdrop-filter:blur(12px);z-index:10050}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-palette[hidden]{display:none!important}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-swatches{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-swatch{display:flex;align-items:center;gap:8px;min-height:44px;padding:7px 8px;border:1px solid var(--editor-border);border-radius:11px;background:color-mix(in srgb,var(--editor-surface) 92%,var(--theme-primary,#6D28D9));color:var(--editor-text);cursor:pointer;text-align:left;box-sizing:border-box;transition:transform .16s,background .16s,border-color .16s,box-shadow .16s}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-swatch:hover{transform:translateY(-1px);border-color:var(--theme-primary,#6D28D9);background:color-mix(in srgb,var(--editor-surface) 84%,var(--theme-primary,#6D28D9))}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-swatch.is-selected{border-color:var(--theme-primary,#6D28D9);box-shadow:0 0 0 2px var(--theme-soft,color-mix(in srgb,var(--theme-primary,#6D28D9) 15%,transparent))}
#auroreEditorialTaskAdmin .editor-a-create-form .editor-a-theme-dot{width:24px;height:24px;flex:0 0 24px;border-radius:7px;background:var(--cf-swatch);box-shadow:inset 0 0 0 1px rgba(255,255,255,.32),0 1px 3px rgba(0,0,0,.16)}
#auroreEditorialTaskAdmin .editor-a-create-form .editor-a-theme-name{font-size:.62rem;font-weight:800;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-theme-color-square #editorAThemePreview{background:var(--editor-a-selected-theme,#6D28D9);border-radius:7px}
#auroreEditorialTaskAdmin .editor-a-form-layout{display:grid;grid-template-columns:minmax(190px,1.2fr) minmax(170px,1fr) minmax(170px,1fr) auto;align-items:end;gap:12px;margin:0;padding:15px 16px;border:1px solid color-mix(in srgb,var(--theme-primary,#6D28D9) 22%,var(--editor-border));border-radius:17px;background:color-mix(in srgb,var(--theme-primary,#6D28D9) 6%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-a-form-layout strong{display:block;font-size:.75rem}
#auroreEditorialTaskAdmin .editor-a-form-layout small{display:block;margin-top:3px;font-size:.62rem;line-height:1.45;opacity:.68}
#auroreEditorialTaskAdmin .editor-a-form-layout label{font-size:.62rem;font-weight:850}
#auroreEditorialTaskAdmin .editor-a-form-layout output{float:right;font-size:.64rem;color:var(--theme-primary,#6D28D9)}
#auroreEditorialTaskAdmin .editor-a-form-layout input[type=range]{display:block;width:100%;margin-top:9px;accent-color:var(--theme-primary,#6D28D9)}
#auroreEditorialTaskAdmin .editor-a-layout-msg{grid-column:1/-1;font-size:.65rem;opacity:.75}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-card{overflow:visible}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-rebuild-theme{position:relative;display:block;z-index:40}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-palette{position:absolute;left:0;top:calc(100% + 8px);width:min(420px,calc(100vw - 28px));max-height:320px;overflow:auto;box-sizing:border-box;padding:12px;border:1px solid color-mix(in srgb,var(--theme-primary,#6D28D9) 24%,var(--editor-border));border-radius:16px;background:var(--editor-surface);color:inherit;box-shadow:0 18px 48px rgba(0,0,0,.18);backdrop-filter:blur(10px)}

#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-palette{top:calc(100% + 8px);z-index:2000;border-color:color-mix(in srgb,var(--theme-primary,#6D28D9) 24%,var(--editor-border));background:var(--editor-surface);color:inherit}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-theme-color-square #editorAThemePreview{background:#6D28D9;border-radius:7px}
#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-swatch.is-selected{border-color:var(--theme-primary,#6D28D9);box-shadow:0 0 0 2px color-mix(in srgb,var(--theme-primary,#6D28D9) 22%,transparent)}
#auroreEditorialTaskAdmin .editor-a-create-form #editorAThemeValue{font-size:.68rem;font-weight:850;color:var(--theme-primary,#6D28D9);margin-left:3px}
#auroreEditorialTaskAdmin{--editor-surface:var(--card-bg,#fff);--editor-surface-soft:color-mix(in srgb,currentColor 3%,transparent);--editor-border:color-mix(in srgb,currentColor 12%,transparent);--editor-text:currentColor;--editor-accent:#1D4ED8;color:var(--editor-text);display:grid;gap:16px}
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
@media(min-width:721px){#auroreEditorialTaskAdmin .editor-create-card{grid-template-columns:minmax(260px,.45fr) minmax(560px,2.4fr);}}
#auroreEditorialTaskAdmin .editor-create-card{display:grid;grid-template-columns:minmax(240px,.45fr) minmax(560px,2.4fr);gap:18px;align-items:end;padding:22px;border-radius:18px;border:1px solid color-mix(in srgb,var(--editor-accent) 18%,var(--editor-border));background:linear-gradient(135deg,color-mix(in srgb,var(--editor-accent) 10%,var(--editor-surface)),var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-create-card h5{margin:5px 0 6px;font-size:.95rem}
#auroreEditorialTaskAdmin .editor-create-fields{display:grid;grid-template-columns:minmax(145px,.35fr) minmax(560px,4fr) auto;gap:12px;align-items:start}
#auroreEditorialTaskAdmin .editor-picker-progress{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
#auroreEditorialTaskAdmin .editor-picker-progress span{padding:5px 8px;border-radius:999px;border:1px solid var(--editor-border);font-size:.55rem;font-weight:900;opacity:.5}
#auroreEditorialTaskAdmin .editor-picker-progress span.active{opacity:1;border-color:var(--editor-accent);background:color-mix(in srgb,var(--editor-accent) 10%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-picker-progress span.done{opacity:.8}
#auroreEditorialTaskAdmin .editor-picker-stage-note{font-size:.58rem;line-height:1.4;opacity:.58;margin-bottom:8px}
#auroreEditorialTaskAdmin .editor-picker-actions{display:flex;justify-content:space-between;gap:8px;margin-top:8px}
#auroreEditorialTaskAdmin .editor-classification-panel{width:min(760px,calc(100vw - 48px));max-width:calc(100vw - 48px);right:auto;left:50%;transform:translateX(-50%);padding:18px}
#auroreEditorialTaskAdmin .editor-option{min-height:46px;white-space:normal;line-height:1.25}
#auroreEditorialTaskAdmin .editor-option-scroll{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));max-height:310px}
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
#auroreEditorialTaskAdmin .editor-create-fields #editorCreate{min-height:41px}\n#auroreEditorialTaskAdmin .editor-mobile-picker{position:relative;min-width:0}
#auroreEditorialTaskAdmin .editor-mobile-picker-trigger{width:100%;min-height:41px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;border:1px solid var(--editor-border);border-radius:11px;background:var(--editor-surface);color:inherit;font:inherit;font-size:.67rem;font-weight:800;cursor:pointer;text-align:left}
#auroreEditorialTaskAdmin .editor-mobile-picker-trigger:disabled{opacity:.58;cursor:not-allowed}
#auroreEditorialTaskAdmin .editor-mobile-picker-trigger b{font-size:.8rem;opacity:.55}
#auroreEditorialTaskAdmin .editor-mobile-picker-menu{position:absolute;z-index:1300;left:0;right:0;top:calc(100% + 7px);padding:8px;border:1px solid color-mix(in srgb,var(--editor-accent) 22%,var(--editor-border));border-radius:13px;background:var(--editor-surface);box-shadow:0 18px 45px rgba(0,0,0,.18)}
#auroreEditorialTaskAdmin .editor-mobile-picker-menu[hidden]{display:none}
#auroreEditorialTaskAdmin .editor-mobile-picker-options{display:grid;gap:6px;max-height:280px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:2px}
#auroreEditorialTaskAdmin .editor-mobile-picker-option{width:100%;min-height:43px;border:1px solid var(--editor-border);border-radius:10px;background:color-mix(in srgb,currentColor 3%,var(--editor-surface));color:inherit;padding:8px 10px;font:inherit;font-size:.62rem;font-weight:800;cursor:pointer;text-align:left;white-space:normal;line-height:1.3}
#auroreEditorialTaskAdmin .editor-mobile-picker-option:hover,#auroreEditorialTaskAdmin .editor-mobile-picker-option.selected{border-color:var(--editor-accent);background:color-mix(in srgb,var(--editor-accent) 10%,var(--editor-surface))}
#auroreEditorialTaskAdmin #editorACreatePathPicker,#auroreEditorialTaskAdmin #editorACreateSubject{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;padding:0!important;border:0!important;overflow:hidden!important}

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
#auroreEditorialTaskAdmin .editor-ai-inline{margin-top:7px}
#auroreEditorialTaskAdmin .editor-ai-treatment{display:grid;gap:7px;padding:9px;border:1px solid color-mix(in srgb,var(--editor-accent) 16%,var(--editor-border));border-radius:12px;background:color-mix(in srgb,var(--editor-accent) 4%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-ai-treatment.is-processing{border-color:color-mix(in srgb,#2563EB 30%,var(--editor-border))}
#auroreEditorialTaskAdmin .editor-ai-treatment.is-failed{border-color:color-mix(in srgb,#DC2626 30%,var(--editor-border));background:color-mix(in srgb,#DC2626 4%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-ai-treatment.is-stale{border-color:color-mix(in srgb,#B45309 30%,var(--editor-border));background:color-mix(in srgb,#B45309 5%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-ai-treatment.editor-ai-legacy{opacity:.75}
#auroreEditorialTaskAdmin .editor-ai-head,.editor-ai-progress-head{display:flex;align-items:center;justify-content:space-between;gap:7px}
#auroreEditorialTaskAdmin .editor-ai-head span{font-size:.49rem;text-transform:uppercase;font-weight:950;letter-spacing:.06em;opacity:.52}
#auroreEditorialTaskAdmin .editor-ai-head strong{font-size:.57rem}
#auroreEditorialTaskAdmin .editor-ai-controls{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}
#auroreEditorialTaskAdmin .editor-ai-provider{min-width:0;font:inherit;font-size:.58rem;font-weight:850;color:inherit;background:var(--editor-surface);border:1px solid var(--editor-border);border-radius:8px;padding:6px 7px}
#auroreEditorialTaskAdmin .editor-ai-controls .admin-btn{font-size:.57rem;padding:7px 9px}
#auroreEditorialTaskAdmin .editor-ai-progress{display:grid;gap:4px}
#auroreEditorialTaskAdmin .editor-ai-progress-head span{font-size:.54rem;line-height:1.35;opacity:.68}
#auroreEditorialTaskAdmin .editor-ai-progress-head strong{font-size:.55rem}
#auroreEditorialTaskAdmin .editor-ai-progress-track{height:7px;overflow:hidden;border-radius:999px;background:color-mix(in srgb,currentColor 9%,transparent)}
#auroreEditorialTaskAdmin .editor-ai-progress-track>span{display:block;height:100%;border-radius:inherit;background:var(--editor-accent);transition:width .25s ease}
#auroreEditorialTaskAdmin .editor-ai-error{font-size:.5rem;line-height:1.4;color:#B91C1C}
@media(max-width:520px){#auroreEditorialTaskAdmin .editor-ai-controls{grid-template-columns:1fr}.editor-ai-controls .admin-btn{width:100%}}

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
#auroreEditorialTaskAdmin .editor-cx-validation{display:grid;gap:10px;padding:14px;border:1px solid color-mix(in srgb,var(--editor-accent) 20%,var(--editor-border));border-radius:15px;background:color-mix(in srgb,var(--editor-accent) 4%,var(--editor-surface))}
#auroreEditorialTaskAdmin .editor-cx-validation-head{display:grid;gap:4px}
#auroreEditorialTaskAdmin .editor-cx-validation-head span{font-size:.54rem;text-transform:uppercase;font-weight:950;letter-spacing:.07em;opacity:.55}
#auroreEditorialTaskAdmin .editor-cx-validation-head strong{font-size:.72rem}
#auroreEditorialTaskAdmin .editor-cx-validation-head small{font-size:.58rem;line-height:1.45;opacity:.62}
#auroreEditorialTaskAdmin .editor-validation-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
#auroreEditorialTaskAdmin .editor-validation-head h5{margin:5px 0;font-size:.84rem}
#auroreEditorialTaskAdmin .editor-validation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#auroreEditorialTaskAdmin .editor-check{display:flex;gap:8px;align-items:center;padding:11px;border:1px solid var(--editor-border);border-radius:12px;background:var(--editor-surface);font-size:.64rem;font-weight:800}
#auroreEditorialTaskAdmin .editor-check input{width:17px;height:17px;padding:0;accent-color:var(--editor-accent)}
#auroreEditorialTaskAdmin .editor-a-start{display:grid;gap:5px;padding:16px;border:1px dashed var(--editor-border);border-radius:14px}
#auroreEditorialTaskAdmin .editor-a-start strong{font-size:.72rem}
#auroreEditorialTaskAdmin .editor-a-start span{font-size:.62rem;opacity:.62}
#auroreEditorialTaskAdmin .danger{border-color:color-mix(in srgb,#DC2626 25%,var(--editor-border))!important}
@media(max-width:1050px){#auroreEditorialTaskAdmin .editor-create-fields{grid-template-columns:minmax(150px,.5fr) minmax(0,2fr)}.editor-create-fields .admin-btn{grid-column:1/-1}#auroreEditorialTaskAdmin .editor-card-grid{grid-template-columns:repeat(3,minmax(0,1fr))}#auroreEditorialTaskAdmin .editor-create-card{grid-template-columns:1fr}}
@media(max-width:720px){#auroreEditorialTaskAdmin .editor-classification-panel{position:relative;top:auto;left:auto;right:auto;width:auto;max-width:none;transform:none;margin-top:8px;box-shadow:none;max-height:68vh;overflow:auto}.editor-option-scroll{grid-template-columns:repeat(2,minmax(0,1fr));max-height:none;overflow:visible}}

@media(max-width:720px){#auroreEditorialTaskAdmin .editor-main-nav{overflow-x:auto}#auroreEditorialTaskAdmin .editor-main-nav-item{min-width:120px}#auroreEditorialTaskAdmin .editor-main-nav-link{margin-left:0}#auroreEditorialTaskAdmin .editor-page-title,#auroreEditorialTaskAdmin .editor-validation-head{display:block}#auroreEditorialTaskAdmin .editor-page-count{display:block;margin-top:8px}#auroreEditorialTaskAdmin .editor-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#auroreEditorialTaskAdmin .editor-detail-meta,#auroreEditorialTaskAdmin .editor-validation-grid{grid-template-columns:1fr 1fr}}
@media(max-width:520px){#auroreEditorialTaskAdmin .editor-hub-head{display:block}#auroreEditorialTaskAdmin .editor-main-nav{display:grid;grid-template-columns:1fr 1fr}#auroreEditorialTaskAdmin .editor-main-nav-link{grid-column:1/-1;text-align:left;border-left:0;border-top:1px solid var(--editor-border);padding-top:11px}#auroreEditorialTaskAdmin .editor-card-grid{grid-template-columns:1fr}#auroreEditorialTaskAdmin .editor-plan-grid,#auroreEditorialTaskAdmin .editor-detail-meta,#auroreEditorialTaskAdmin .editor-chapters-grid,#auroreEditorialTaskAdmin .editor-validation-grid{grid-template-columns:1fr}#auroreEditorialTaskAdmin .editor-plan-actions{justify-content:stretch}#auroreEditorialTaskAdmin .editor-plan-actions .admin-btn{flex:1}}
@media(max-width:760px){#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-swatches{grid-template-columns:repeat(3,minmax(0,1fr))}#auroreEditorialTaskAdmin .editor-a-create-form .cf-create-theme-palette{width:min(430px,calc(100vw - 24px));left:0;right:auto}#auroreEditorialTaskAdmin .editor-a-create-form #editorAThemeColor{width:40px}}
[data-theme="dark"] #auroreEditorialTaskAdmin{--editor-surface:#17171b;--editor-border:rgba(255,255,255,.13)}
[data-theme="light"] #auroreEditorialTaskAdmin{--editor-surface:#fff;--editor-border:rgba(0,0,0,.12)}
`;
  document.head.appendChild(s);
}
async function chargerEspaceEditorialChatGPT(preferredSection){
  const p=panel();if(!p)return false;injectStyle();
  let root=document.getElementById('auroreEditorialTaskAdmin');
  if(!root){root=document.createElement('div');root.id='auroreEditorialTaskAdmin';(document.getElementById('auroraRequestFormHost')||p).appendChild(root)}
  root.innerHTML='<div class="editor-empty">Chargement du parcours éditorial…</div>';
  try{
    const [tasks,revisions]=await Promise.all([listJobs(),listRevisionDocuments()]);
    await loadDAiProviders();
    const allowed=['A','B','C','CX','D','E',...AI_WORKSPACE_SECTIONS];
    const saved=readEditorialPosition();
    const active=allowed.includes(preferredSection)?preferredSection:(allowed.includes(window.__auroreEditorialActiveSection)?window.__auroreEditorialActiveSection:saved.section);
    const pages={...saved.pages,...(window.__auroreEditorialActivePages||{})};
    window.__auroreEditorialActiveSection=active;
    window.__auroreEditorialActivePages=pages;
    const state={tasks,revisions,section:active,pages};
    render(root,state);
    const count=document.getElementById('tabCountAuroraRequest');if(count)count.textContent=String(tasks.length);
    return true;
  }catch(e){root.innerHTML='<div class="editor-empty">Impossible de charger le parcours éditorial : '+esc(e.message||e)+'</div>';return false}
}
window.chargerEspaceEditorialChatGPT=chargerEspaceEditorialChatGPT;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{const p=panel();if(p){injectStyle();const host=document.getElementById('auroraRequestFormHost');if(host&&!document.getElementById('auroreEditorialTaskAdmin')){const root=document.createElement('div');root.id='auroreEditorialTaskAdmin';host.appendChild(root)}}},{once:true});else injectStyle();
})();