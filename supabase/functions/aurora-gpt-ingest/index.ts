import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{autoRefreshToken:false,persistSession:false}});
const SCHEMA_VERSION="aurora-editorial-1";
const DOCUMENTARY_VISUAL_PLAN_SCHEMA="documentary-visual-plan-1";
const GEOGEBRA_VISUAL_PLAN_SCHEMA="geogebra-visual-plan-1";
const EXERCISE_GEOGEBRA_PLAN_SCHEMA="exercise-geogebra-plan-1";
const MAX_BODY_BYTES=2500000;
const MAX_TEXT=2000000;
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, x-aurore-gpt-key, authorization","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const EXERCISE_LEAK_MARKERS=["développement complémentaire","pour une dérivée","pour une intégrale","pour une loi binomiale","pour un tableau de signes","pour une approximation normale"];
function normalizeDocumentType(v:unknown){
  return String(v??"").trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
}
function resolveProfile(v:unknown){
  const t=normalizeDocumentType(v);
  if(t.includes("exercice")||t.includes("devoir")||t.includes("corrigé de devoir")||t==="corrigé"||t==="corrige")return {kind:"exercices",version:"exercise-sheet-v2"};
  if(t==="cours"||t.startsWith("cours ")||t.includes("fiche de cours")||t.includes("fiches cours")||t.includes("fiche de revision")||t.includes("fiche revision")||t.includes("resume")||t.includes("document pedagogique")||t==="course")return {kind:"cours",version:"course-v2"};
  return {kind:"document",version:"document-v1"};
}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");}
function text(v:unknown,max=500){return String(v??"").trim().slice(0,max);}
function nullable(v:unknown,max=500){const x=text(v,max);return x||null;}
function validColor(v:unknown){const x=text(v,32);return !x||/^#[0-9a-fA-F]{6}$/.test(x);}
function normalizeForGraphMatch(v:unknown){
  return String(v??"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"");
}
const MATH_GRAPHABLE_PATTERN=/(fonction|courbe|droite|parabole|ellipse|hyperbole|conique|transformation|translation|rotation|symetrie|homothetie|intersection|tangente|asymptote|suite|systeme|repere|geometrie analytique|lieu geometrique|surface|parametrique|3d)/i;
const SUPPORTED_GRAPH_INSTRUMENTS=new Set(["function2d","complex_plane","parametric2d","parametric3d","surface3d","geometry2d","geometry3d"]);
function normalizeGraphInstrument(v:unknown){
  const raw=String(v??"").trim().toLowerCase();
  const aliases:any={function2d:"function2d",function:"function2d",graph:"function2d",courbe:"function2d",complex_plane:"complex_plane",parametric:"parametric2d",parametric2d:"parametric2d",parametric3d:"parametric3d",surface3d:"surface3d",geometry2d:"geometry2d",vector2d:"geometry2d",plan2d:"geometry2d",geometry3d:"geometry3d",geometrie3d:"geometry3d","3d":"geometry3d"};
  return aliases[raw]||raw;
}
function validateMathVisualPlan(content:any,subject:any,profile:any){
  if(profile.kind!=="cours"||!normalizeForGraphMatch(subject).includes("math")) return {enabled:false,graphable_sections:0,planned_graphs:0};
  const plan=(content.visual_plan&&typeof content.visual_plan==="object"?content.visual_plan:null)
    || (content.metadata&&typeof content.metadata==="object"&&content.metadata.visual_plan&&typeof content.metadata.visual_plan==="object"?content.metadata.visual_plan:null);
  if(!plan) throw new Error("Cours de mathématiques : visual_plan obligatoire.");
  if(plan.schema_version!=="math-visual-plan-1") throw new Error("Cours de mathématiques : visual_plan.schema_version invalide.");
  if(!Array.isArray(plan.decisions)) throw new Error("Cours de mathématiques : visual_plan.decisions doit être un tableau.");
  const graphMap=new Map<string,{section:number,graph:any}>();
  let plannedGraphs=0;
  for(let sectionIndex=0;sectionIndex<content.sections.length;sectionIndex++){
    const section=content.sections[sectionIndex];
    const sectionText=normalizeForGraphMatch([section.title,...(Array.isArray(section.content)?section.content:[])].join(" "));
    const graphable=MATH_GRAPHABLE_PATTERN.test(sectionText);
    const decision=plan.decisions.find((d:any)=>Number(d?.section_number)===sectionIndex+1);
    if(!graphable) continue;
    if(!decision) throw new Error(`Cours de mathématiques : décision graphique manquante pour la section ${sectionIndex+1}.`);
    const choice=String(decision.decision||"").trim().toLowerCase();
    if(choice!=="build"&&choice!=="not_needed") throw new Error(`Section ${sectionIndex+1} : decision doit être build ou not_needed.`);
    if(choice==="not_needed"){
      if(String(decision.rationale||"").trim().length<8) throw new Error(`Section ${sectionIndex+1} : rationale obligatoire lorsque la construction est écartée.`);
      continue;
    }
    if(!Array.isArray(decision.graph_ids)||decision.graph_ids.length<1) throw new Error(`Section ${sectionIndex+1} : build exige au moins un graph_id.`);
    for(const graphIdRaw of decision.graph_ids){
      const graphId=String(graphIdRaw||"").trim();
      if(!graphId) throw new Error(`Section ${sectionIndex+1} : graph_id vide interdit.`);
      if(graphMap.has(graphId)) throw new Error(`graph_id dupliqué : ${graphId}.`);
      const graphs=Array.isArray(section.graphs)?section.graphs:[];
      const graph=graphs.find((g:any)=>String(g?.id||"").trim()===graphId);
      if(!graph) throw new Error(`Section ${sectionIndex+1} : graph_id ${graphId} introuvable dans sections[${sectionIndex}].graphs.`);
      const instrument=normalizeGraphInstrument(graph.instrument||graph.graph_type);
      if(!SUPPORTED_GRAPH_INSTRUMENTS.has(instrument)) throw new Error(`Graphique ${graphId} : instrument GeoGebra non supporté (${instrument||"absent"}).`);
      if(String(graph.title||"").trim().length<1||String(graph.purpose||"").trim().length<3) throw new Error(`Graphique ${graphId} : title et purpose sont obligatoires.`);
      const source=String(graph.expression||graph.mathematical_source||graph.x_expression||"").trim();
      const pointData=Array.isArray(graph.points)?graph.points.length:0;
      const objects=Array.isArray(graph.objects)?graph.objects:[];
      const parametric2d=String(graph.x_expression||"").trim()&&String(graph.y_expression||"").trim();
      const parametric3d=String(graph.x_expression||"").trim()&&String(graph.y_expression||"").trim()&&String(graph.z_expression||"").trim();
      const geometry2dTypes=new Set(["point","vector","line","segment","ray","polygon"]);
      const validConstruction=(instrument==="function2d"||instrument==="complex_plane") ? Boolean(source||pointData||Array.isArray(graph.asymptotes)&&graph.asymptotes.length) : instrument==="parametric2d" ? Boolean(parametric2d) : instrument==="parametric3d" ? Boolean(parametric3d) : instrument==="surface3d" ? Boolean(source) : instrument==="geometry2d" ? Boolean(objects.some((o:any)=>geometry2dTypes.has(String(o?.type||"").toLowerCase()))||pointData) : Boolean(objects.length||pointData);
      if(!validConstruction) throw new Error(`Graphique ${graphId} : données de construction insuffisantes pour ${instrument}.`);
      for(const key of ["x_min","x_max","y_min","y_max","z_min","z_max","t_min","t_max"]){
        if(graph[key]!==undefined&&graph[key]!==null&&(!Number.isFinite(Number(graph[key])))) throw new Error(`Graphique ${graphId} : ${key} doit être numérique.`);
      }
      const ranges=[["x_min","x_max"],["y_min","y_max"],["z_min","z_max"],["t_min","t_max"]];
      for(const [a,b] of ranges) if(graph[a]!==undefined&&graph[b]!==undefined&&Number(graph[b])<=Number(graph[a])) throw new Error(`Graphique ${graphId} : ${a}<${b} est requis.`);
      graphMap.set(graphId,{section:sectionIndex+1,graph});
      plannedGraphs++;
    }
  }
  for(let sectionIndex=0;sectionIndex<content.sections.length;sectionIndex++){
    const graphs=Array.isArray(content.sections[sectionIndex]?.graphs)?content.sections[sectionIndex].graphs:[];
    for(const graph of graphs){
      const graphId=String(graph?.id||"").trim();
      if(!graphId) throw new Error(`Section ${sectionIndex+1} : chaque graphique doit avoir un id stable.`);
      if(!graphMap.has(graphId)) throw new Error(`Graphique ${graphId} : présent dans le document mais absent du plan de construction.`);
    }
  }
  return {enabled:true,graphable_sections:content.sections.filter((s:any)=>MATH_GRAPHABLE_PATTERN.test(normalizeForGraphMatch([s.title,...(Array.isArray(s.content)?s.content:[])].join(" ")))).length,planned_graphs:plannedGraphs};
}

function validateGeoGebraVisualPlan(content:any,subject:any,profile:any){
  const isCourse=profile.kind==="cours";
  const isMath=normalizeForGraphMatch(subject).includes("math");
  if(!isCourse||isMath) return {enabled:false,planned_graphs:0,non_math:false};
  const graphCount=content.sections.reduce((n:number,s:any)=>n+(Array.isArray(s?.graphs)?s.graphs.length:0),0);
  if(graphCount<1) return {enabled:false,planned_graphs:0,non_math:true};
  const plan=(content.geogebra_plan&&typeof content.geogebra_plan==="object"?content.geogebra_plan:null)
    || (content.metadata&&typeof content.metadata==="object"&&content.metadata.geogebra_plan&&typeof content.metadata.geogebra_plan==="object"?content.metadata.geogebra_plan:null);
  if(!plan) throw new Error("Cours non mathématique avec GeoGebra : geogebra_plan obligatoire lorsque sections[].graphs est utilisé.");
  if(plan.schema_version!==GEOGEBRA_VISUAL_PLAN_SCHEMA) throw new Error("Cours avec GeoGebra : geogebra_plan.schema_version invalide.");
  if(!Array.isArray(plan.decisions)||plan.decisions.length!==content.sections.length) throw new Error("Cours avec GeoGebra : une décision GeoGebra est requise pour chaque section.");
  const decisionMap=new Map<number,any>();
  for(const d of plan.decisions){
    const n=Number(d?.section_number);
    if(!Number.isInteger(n)||n<1||n>content.sections.length) throw new Error("geogebra_plan : section_number invalide.");
    if(decisionMap.has(n)) throw new Error("geogebra_plan : section_number dupliqué.");
    decisionMap.set(n,d);
  }
  const allGraphIds=new Map<string,{section:number,graph:any}>();
  let plannedGraphs=0;
  const geometry2dTypes=new Set(["point","vector","line","segment","ray","polygon"]);
  for(let sectionIndex=0;sectionIndex<content.sections.length;sectionIndex++){
    const section=content.sections[sectionIndex];
    const decision=decisionMap.get(sectionIndex+1);
    if(!decision) throw new Error(`Cours avec GeoGebra : décision manquante pour la section ${sectionIndex+1}.`);
    const choice=String(decision.decision||"").trim().toLowerCase();
    const graphs=Array.isArray(section?.graphs)?section.graphs:[];
    if(choice!=="build"&&choice!=="not_needed") throw new Error(`Section ${sectionIndex+1} : décision GeoGebra doit être build ou not_needed.`);
    if(choice==="not_needed"){
      if(graphs.length>0) throw new Error(`Section ${sectionIndex+1} : not_needed ne peut pas contenir de graphique GeoGebra.`);
      if(String(decision.rationale||"").trim().length<8) throw new Error(`Section ${sectionIndex+1} : rationale obligatoire lorsque GeoGebra est écarté.`);
      continue;
    }
    if(!Array.isArray(decision.graph_ids)||decision.graph_ids.length<1) throw new Error(`Section ${sectionIndex+1} : build exige au moins un graph_id.`);
    if(decision.graph_ids.length!==graphs.length) throw new Error(`Section ${sectionIndex+1} : les graph_ids doivent couvrir exactement tous les graphiques de la section.`);
    const seen=new Set<string>();
    for(const graphIdRaw of decision.graph_ids){
      const graphId=String(graphIdRaw||"").trim();
      if(!graphId) throw new Error(`Section ${sectionIndex+1} : graph_id vide interdit.`);
      if(seen.has(graphId)||allGraphIds.has(graphId)) throw new Error(`graph_id dupliqué : ${graphId}.`);
      seen.add(graphId);
      const graph=graphs.find((g:any)=>String(g?.id||"").trim()===graphId);
      if(!graph) throw new Error(`Section ${sectionIndex+1} : graph_id ${graphId} introuvable dans sections[${sectionIndex}].graphs.`);
      const instrument=normalizeGraphInstrument(graph.instrument||graph.graph_type);
      if(!SUPPORTED_GRAPH_INSTRUMENTS.has(instrument)) throw new Error(`Graphique ${graphId} : instrument GeoGebra non supporté (${instrument||"absent"}).`);
      if(String(graph.title||graph.name||"").trim().length<1||String(graph.purpose||"").trim().length<3) throw new Error(`Graphique ${graphId} : title/name et purpose sont obligatoires.`);
      const source=String(graph.expression||graph.mathematical_source||"").trim();
      const pointData=Array.isArray(graph.points)?graph.points.length:0;
      const objects=Array.isArray(graph.objects)?graph.objects:[];
      const xExpr=String(graph.x_expression||"").trim();
      const yExpr=String(graph.y_expression||"").trim();
      const zExpr=String(graph.z_expression||"").trim();
      const validConstruction=instrument==="function2d"||instrument==="complex_plane" ? Boolean(source||pointData||Array.isArray(graph.asymptotes)&&graph.asymptotes.length)
        : instrument==="parametric2d" ? Boolean(xExpr&&yExpr)
        : instrument==="parametric3d" ? Boolean(xExpr&&yExpr&&zExpr)
        : instrument==="surface3d" ? Boolean(source)
        : instrument==="geometry2d" ? Boolean(objects.some((o:any)=>geometry2dTypes.has(String(o?.type||"").toLowerCase()))||pointData)
        : Boolean(objects.length||pointData);
      if(!validConstruction) throw new Error(`Graphique ${graphId} : données de construction insuffisantes pour ${instrument}.`);
      for(const key of ["x_min","x_max","y_min","y_max","z_min","z_max","t_min","t_max"]){
        if(graph[key]!==undefined&&graph[key]!==null&&!Number.isFinite(Number(graph[key]))) throw new Error(`Graphique ${graphId} : ${key} doit être numérique.`);
      }
      const ranges=[["x_min","x_max"],["y_min","y_max"],["z_min","z_max"],["t_min","t_max"]];
      for(const [a,b] of ranges) if(graph[a]!==undefined&&graph[b]!==undefined&&Number(graph[b])<=Number(graph[a])) throw new Error(`Graphique ${graphId} : ${a}<${b} est requis.`);
      allGraphIds.set(graphId,{section:sectionIndex+1,graph});
      plannedGraphs++;
    }
  }
  for(let sectionIndex=0;sectionIndex<content.sections.length;sectionIndex++){
    const graphs=Array.isArray(content.sections[sectionIndex]?.graphs)?content.sections[sectionIndex].graphs:[];
    for(const graph of graphs){
      const graphId=String(graph?.id||"").trim();
      if(!graphId) throw new Error(`Section ${sectionIndex+1} : chaque graphique doit avoir un id stable.`);
      if(!allGraphIds.has(graphId)) throw new Error(`Graphique ${graphId} : présent dans le document mais absent du geogebra_plan.`);
    }
  }
  if(plannedGraphs>24) throw new Error("Maximum 24 graphiques/constructions GeoGebra par document.");
  return {enabled:true,schema_version:GEOGEBRA_VISUAL_PLAN_SCHEMA,planned_graphs:plannedGraphs,non_math:true};
}

function validateDocumentaryVisualPlan(content:any,subject:any,profile:any){
  const isCourse=profile.kind==="cours";
  const isMath=normalizeForGraphMatch(subject).includes("math");
  if(!isCourse||isMath){
    if(isMath&&isCourse){
      for(const section of content.sections||[]){
        if(Array.isArray(section?.visuals)&&section.visuals.length>0){
          throw new Error("Cours de mathématiques : les illustrations documentaires Wikimedia sont interdites. Utilisez le plan GeoGebra pour les représentations mathématiques.");
        }
      }
    }
    return {enabled:false,math:isMath,planned_visuals:0};
  }
  const plan=(content.visual_plan&&typeof content.visual_plan==="object"?content.visual_plan:null)
    || (content.metadata&&typeof content.metadata==="object"&&content.metadata.visual_plan&&typeof content.metadata.visual_plan==="object"?content.metadata.visual_plan:null);
  if(!plan) throw new Error("Cours non mathématique : visual_plan documentaire obligatoire.");
  if(plan.schema_version!==DOCUMENTARY_VISUAL_PLAN_SCHEMA) throw new Error("Cours non mathématique : visual_plan.schema_version invalide.");
  if(!Array.isArray(plan.decisions)||plan.decisions.length!==content.sections.length) throw new Error("Cours non mathématique : une décision documentaire est requise pour chaque section.");
  const decisionMap=new Map<number,any>();
  for(const d of plan.decisions){
    const n=Number(d?.section_number);
    if(!Number.isInteger(n)||n<1||n>content.sections.length) throw new Error("visual_plan : section_number invalide.");
    if(decisionMap.has(n)) throw new Error("visual_plan : section_number dupliqué.");
    decisionMap.set(n,d);
  }
  const allVisualIds=new Map<string,{section:number,visual:any}>();
  let plannedVisuals=0;
  let buildSections=0;
  for(let sectionIndex=0;sectionIndex<content.sections.length;sectionIndex++){
    const section=content.sections[sectionIndex];
    const decision=decisionMap.get(sectionIndex+1);
    if(!decision) throw new Error(`Cours non mathématique : décision documentaire manquante pour la section ${sectionIndex+1}.`);
    const choice=String(decision.decision||"").trim().toLowerCase();
    if(choice!=="build"&&choice!=="not_needed") throw new Error(`Section ${sectionIndex+1} : decision documentaire doit être build ou not_needed.`);
    const visuals=Array.isArray(section.visuals)?section.visuals:[];
    for(const v of visuals){
      if(!v||typeof v!=="object") throw new Error(`Section ${sectionIndex+1} : visuel documentaire invalide.`);
      if(String(v.type||"wikimedia").toLowerCase()!=="wikimedia") throw new Error(`Section ${sectionIndex+1} : les visuels documentaires doivent utiliser type=wikimedia.`);
      const id=String(v.id||"").trim();
      if(!id) throw new Error(`Section ${sectionIndex+1} : chaque visuel documentaire doit avoir un id stable.`);
      if(allVisualIds.has(id)) throw new Error(`visual_id dupliqué : ${id}.`);
      if(String(v.query||"").trim().length<4) throw new Error(`Visuel ${id} : query obligatoire.`);
      if(String(v.title||"").trim().length<2) throw new Error(`Visuel ${id} : title obligatoire.`);
      if(String(v.caption||"").trim().length<4) throw new Error(`Visuel ${id} : caption pédagogique obligatoire.`);
      const purpose=String(v.purpose||"").trim().toLowerCase();
      if(!["illustration","schema","photo","experimental","comparison"].includes(purpose)) throw new Error(`Visuel ${id} : purpose invalide.`);
      const required=v.required===true||["1","true","yes","oui"].includes(String(v.required??"").trim().toLowerCase())||String(v.priority||"").trim().toLowerCase()==="required";
      if(!required) throw new Error(`Visuel ${id} : required=true est obligatoire pour une illustration planifiée.`);
      allVisualIds.set(id,{section:sectionIndex+1,visual:v});
    }
    if(choice==="not_needed"){
      if(visuals.length>0) throw new Error(`Section ${sectionIndex+1} : not_needed ne peut pas contenir de visuel.`);
      if(String(decision.rationale||"").trim().length<8) throw new Error(`Section ${sectionIndex+1} : rationale obligatoire lorsque l'illustration est écartée.`);
      continue;
    }
    buildSections++;
    if(!Array.isArray(decision.visual_ids)||decision.visual_ids.length<1) throw new Error(`Section ${sectionIndex+1} : build exige au moins un visual_id.`);
    const seenInDecision=new Set<string>();
    for(const rawId of decision.visual_ids){
      const id=String(rawId||"").trim();
      if(!id) throw new Error(`Section ${sectionIndex+1} : visual_id vide interdit.`);
      if(seenInDecision.has(id)) throw new Error(`Section ${sectionIndex+1} : visual_id ${id} dupliqué dans la décision.`);
      seenInDecision.add(id);
      const entry=allVisualIds.get(id);
      if(!entry) throw new Error(`Section ${sectionIndex+1} : visual_id ${id} introuvable dans la section.`);
      if(entry.section!==sectionIndex+1) throw new Error(`Visual ${id} : un visual ne peut être référencé que par sa propre section.`);
      plannedVisuals++;
    }
    if(seenInDecision.size!==visuals.length) throw new Error(`Section ${sectionIndex+1} : tous les visuels déclarés doivent être référencés exactement une fois dans visual_plan.`);
  }
  if(buildSections<1||allVisualIds.size<1) throw new Error("Cours non mathématique : au moins une illustration documentaire est obligatoire.");
  if(allVisualIds.size>8) throw new Error("Cours non mathématique : maximum 8 illustrations documentaires par document.");
  for(const [id,entry] of allVisualIds){
    const referenced=plan.decisions.some((d:any)=>Array.isArray(d?.visual_ids)&&d.visual_ids.some((x:any)=>String(x||"").trim()===id));
    if(!referenced) throw new Error(`Visuel ${id} : présent dans le document mais absent du visual_plan.`);
  }
  return {enabled:true,schema_version:DOCUMENTARY_VISUAL_PLAN_SCHEMA,planned_visuals:plannedVisuals,sections_with_visuals:buildSections};
}

function isMathOrPhysicsChemistry(subject:any){
  const s=normalizeForGraphMatch(subject);
  return s.includes("math")||s.includes("physique")||s.includes("chimie")||s.includes("sciences physiques")||/\bpc\b/.test(s);
}
function validateExerciseGeoGebraPlan(content:any,subject:any,profile:any){
  if(profile.kind!=="exercices") return {enabled:false,planned_graphs:0};
  const supported=isMathOrPhysicsChemistry(subject);
  const sections=Array.isArray(content.sections)?content.sections:[];
  let totalExercises=0;
  let sectionGraphs=0;
  let graphCount=0;
  for(const section of sections){
    if(Array.isArray(section?.graphs)) sectionGraphs+=section.graphs.length;
    if(!Array.isArray(section?.exercises)) continue;
    for(const ex of section.exercises){
      totalExercises++;
      if(Array.isArray(ex?.statement_graphs)) graphCount+=ex.statement_graphs.length;
      if(Array.isArray(ex?.correction_graphs)) graphCount+=ex.correction_graphs.length;
    }
  }
  const corrections=Array.isArray(content.corrections)?content.corrections:[];
  for(const correction of corrections){
    if(Array.isArray(correction?.graphs)) graphCount+=correction.graphs.length;
  }
  if(!supported){
    if(sectionGraphs>0||graphCount>0) throw new Error("Série d’exercices : les constructions GeoGebra sont actuellement réservées aux Mathématiques et à la Physique-Chimie.");
    return {enabled:false,planned_graphs:0,subject_supported:false};
  }
  if(sectionGraphs>0){
    throw new Error("Série Math/Physique-Chimie : les nouveaux graphiques doivent être rattachés à un exercice via statement_graphs ou correction_graphs.");
  }
  const plan=(content.exercise_geogebra_plan&&typeof content.exercise_geogebra_plan==="object"?content.exercise_geogebra_plan:null)
    || (content.metadata&&typeof content.metadata==="object"&&content.metadata.exercise_geogebra_plan&&typeof content.metadata.exercise_geogebra_plan==="object"?content.metadata.exercise_geogebra_plan:null);
  if(!plan) throw new Error("Série Math/Physique-Chimie : exercise_geogebra_plan obligatoire.");
  if(plan.schema_version!==EXERCISE_GEOGEBRA_PLAN_SCHEMA) throw new Error("Série Math/Physique-Chimie : exercise_geogebra_plan.schema_version invalide.");
  if(!Array.isArray(plan.decisions)||plan.decisions.length!==totalExercises) throw new Error("Série Math/Physique-Chimie : une décision GeoGebra est requise pour chaque exercice.");
  const decisionMap=new Map<number,any>();
  for(const d of plan.decisions){
    const n=Number(d?.exercise_number);
    if(!Number.isInteger(n)||n<1||n>totalExercises||decisionMap.has(n)) throw new Error("exercise_geogebra_plan : exercise_number invalide ou dupliqué.");
    decisionMap.set(n,d);
  }
  const allGraphIds=new Set<string>();
  const referenced=new Set<string>();
  let plannedGraphs=0;
  const validateChannel=(exerciseNumber:number,kind:"statement"|"correction",decision:any,graphs:any[])=>{
    const choice=String(decision?.decision||"").trim().toLowerCase();
    if(choice!=="build"&&choice!=="not_needed") throw new Error(`Exercice ${exerciseNumber} : décision GeoGebra ${kind} doit être build ou not_needed.`);
    if(!Array.isArray(graphs)) throw new Error(`Exercice ${exerciseNumber} : ${kind}_graphs doit être un tableau.`);
    if(choice==="not_needed"){
      if(graphs.length>0) throw new Error(`Exercice ${exerciseNumber} : ${kind} est not_needed mais contient des graphiques.`);
      if(String(decision?.rationale||"").trim().length<8) throw new Error(`Exercice ${exerciseNumber} : rationale obligatoire pour ${kind}/not_needed.`);
      return;
    }
    if(!Array.isArray(decision?.graph_ids)||decision.graph_ids.length<1) throw new Error(`Exercice ${exerciseNumber} : build exige au moins un graph_id pour ${kind}.`);
    if(decision.graph_ids.length!==graphs.length) throw new Error(`Exercice ${exerciseNumber} : les graph_ids de ${kind} doivent couvrir exactement ses graphiques.`);
    const local=new Set<string>();
    for(const rawId of decision.graph_ids){
      const id=String(rawId||"").trim();
      if(!id||local.has(id)||referenced.has(id)) throw new Error(`graph_id GeoGebra dupliqué ou vide : ${id||"(vide)"}.`);
      local.add(id);
      const graph=graphs.find((g:any)=>String(g?.id||"").trim()===id);
      if(!graph) throw new Error(`Exercice ${exerciseNumber} : graph_id ${id} introuvable dans ${kind}_graphs.`);
      if(allGraphIds.has(id)) throw new Error(`graph_id GeoGebra dupliqué : ${id}.`);
      allGraphIds.add(id);
      const instrument=normalizeGraphInstrument(graph.instrument||graph.graph_type);
      if(!SUPPORTED_GRAPH_INSTRUMENTS.has(instrument)) throw new Error(`Graphique ${id} : instrument GeoGebra non supporté (${instrument||"absent"}).`);
      if(String(graph.title||graph.name||"").trim().length<1||String(graph.purpose||"").trim().length<3) throw new Error(`Graphique ${id} : title/name et purpose sont obligatoires.`);
      const source=String(graph.expression||graph.mathematical_source||"").trim();
      const points=Array.isArray(graph.points)?graph.points.length:0;
      const objects=Array.isArray(graph.objects)?graph.objects:[];
      const x=String(graph.x_expression||"").trim();
      const y=String(graph.y_expression||"").trim();
      const z=String(graph.z_expression||"").trim();
      const geo2d=new Set(["point","vector","line","segment","ray","polygon"]);
      const constructionOk=
        (instrument==="function2d"||instrument==="complex_plane") ? Boolean(source||points||(Array.isArray(graph.asymptotes)&&graph.asymptotes.length))
        : instrument==="parametric2d" ? Boolean(x&&y)
        : instrument==="parametric3d" ? Boolean(x&&y&&z)
        : instrument==="surface3d" ? Boolean(source)
        : instrument==="geometry2d" ? Boolean(points||objects.some((o:any)=>geo2d.has(String(o?.type||"").toLowerCase())))
        : Boolean(points||objects.length);
      if(!constructionOk) throw new Error(`Graphique ${id} : données de construction insuffisantes pour ${instrument}.`);
      for(const key of ["x_min","x_max","y_min","y_max","z_min","z_max","t_min","t_max"]){
        if(graph[key]!==undefined&&graph[key]!==null&&!Number.isFinite(Number(graph[key]))) throw new Error(`Graphique ${id} : ${key} doit être numérique.`);
      }
      for(const [a,b] of [["x_min","x_max"],["y_min","y_max"],["z_min","z_max"],["t_min","t_max"]]){
        if(graph[a]!==undefined&&graph[b]!==undefined&&Number(graph[b])<=Number(graph[a])) throw new Error(`Graphique ${id} : ${a}<${b} est requis.`);
      }
      referenced.add(id);
      plannedGraphs++;
    }
  };
  let exerciseNumber=0;
  for(const section of sections){
    for(const ex of (Array.isArray(section?.exercises)?section.exercises:[])){
      exerciseNumber++;
      const decision=decisionMap.get(exerciseNumber);
      if(!decision) throw new Error(`exercise_geogebra_plan : décision manquante pour l’exercice ${exerciseNumber}.`);
      const statementGraphs=Array.isArray(ex?.statement_graphs)?ex.statement_graphs:[];
      const correctionGraphs=Array.isArray(ex?.correction_graphs)?ex.correction_graphs:[];
      let topCorrectionGraphs:any[]=[];
      const matches=corrections.filter((c:any)=>Number(c?.exercise_number)===exerciseNumber);
      if(matches.length>1) throw new Error(`Exercice ${exerciseNumber} : plusieurs corrections structurées sont rattachées au même exercice.`);
      if(matches.length===1&&Array.isArray(matches[0]?.graphs)) topCorrectionGraphs=matches[0].graphs;
      if(correctionGraphs.length>0&&topCorrectionGraphs.length>0) throw new Error(`Exercice ${exerciseNumber} : choisir correction_graphs ou corrections[].graphs, pas les deux.`);
      validateChannel(exerciseNumber,"statement",decision.statement||{},statementGraphs);
      validateChannel(exerciseNumber,"correction",decision.correction||{},correctionGraphs.length>0?correctionGraphs:topCorrectionGraphs);
    }
  }
  if(plannedGraphs>24) throw new Error("Série Math/Physique-Chimie : maximum 24 constructions GeoGebra par document.");
  return {enabled:true,schema_version:EXERCISE_GEOGEBRA_PLAN_SCHEMA,planned_graphs:plannedGraphs,subject_supported:true,total_exercises:totalExercises};
}

function validateEditorialContent(content:any,profile:any,instructions:any,subjectForValidation:any=null){
  if(!content||typeof content!=="object"||Array.isArray(content))throw new Error("content_json doit être un objet JSON.");
  if(typeof content.title!=="string"||!content.title.trim())throw new Error("content_json.title est obligatoire.");
  if(!Array.isArray(content.sections)||content.sections.length<1||content.sections.length>30)throw new Error("content_json.sections doit contenir de 1 à 30 sections.");
  let visuals=0,graphs=0,exercises=0;
  const longSectionContents:string[]=[];
  for(const s of content.sections){
    if(!s||typeof s!=="object"||!String(s.title||"").trim())throw new Error("Chaque section doit avoir un titre.");
    if(Array.isArray(s.visuals)){
      if(s.visuals.length>3)throw new Error("Maximum 3 visuels par section.");
      visuals+=s.visuals.length;
      for(const v of s.visuals)if(String(v?.type||"wikimedia").toLowerCase()!=="wikimedia")throw new Error("Les visuels documentaires doivent utiliser type=wikimedia.");
    }
    if(Array.isArray(s.graphs))graphs+=s.graphs.length;
    if(Array.isArray(s.content)){
      for(const item of s.content){
        const raw=text(item,20000).toLowerCase();
        if(raw.length>=160)longSectionContents.push(raw);
        if(profile.kind==="exercices"&&EXERCISE_LEAK_MARKERS.some(marker=>raw.includes(marker))){
          throw new Error(`Section ${String(s.title)} : contenu générique de cours interdit dans un PDF d'exercices.`);
        }
      }
    }
    if(Array.isArray(s.exercises)){
      exercises+=s.exercises.length;
      for(let i=0;i<s.exercises.length;i++){
        const ex=s.exercises[i]||{};
        const statement=ex.question||ex.statement||ex.enonce||ex.content||"";
        const correction=ex.solution||ex.correction||ex.details||"";
        if(profile.kind==="exercices"&&!text(statement,20000))throw new Error(`Exercice ${i+1} de la section ${String(s.title)} : énoncé obligatoire.`);
        if(profile.kind==="exercices"&&instructions.paired_corrections&&!text(correction,20000))throw new Error(`Exercice ${i+1} de la section ${String(s.title)} : corrigé apparié obligatoire.`);
        if(profile.kind==="exercices"){
          const low=text(correction,50000).toLowerCase();
          const hits=EXERCISE_LEAK_MARKERS.reduce((n,marker)=>n+(low.includes(marker)?1:0),0);
          if(low.includes("développement complémentaire")||hits>=3){
            throw new Error(`Exercice ${i+1} de la section ${String(s.title)} : corrigé contaminé par un bloc générique de cours.`);
          }
        }
      }
    }
  }
  if(visuals>8)throw new Error("Maximum 8 visuels documentaires par document.");
  if(graphs>24)throw new Error("Maximum 24 graphiques/constructions par document.");
  const graphPlan=validateMathVisualPlan(content, subjectForValidation, profile);
  const geogebraPlan=validateGeoGebraVisualPlan(content, subjectForValidation, profile);
  const exerciseGeogebraPlan=validateExerciseGeoGebraPlan(content, subjectForValidation, profile);
  const documentaryPlan=validateDocumentaryVisualPlan(content, subjectForValidation, profile);
  if(profile.kind==="exercices"&&exercises<1)throw new Error("Un document d'exercices doit contenir au moins un exercice structuré.");
  if(profile.kind==="exercices"&&longSectionContents.length!==new Set(longSectionContents).size)throw new Error("Contenu de section dupliqué entre plusieurs exercices.");
  if(JSON.stringify(content).length>MAX_TEXT)throw new Error("content_json dépasse la taille maximale autorisée.");
  return {sections:content.sections.length,visuals,graphs,exercises:content.sections.reduce((n:number,s:any)=>n+(Array.isArray(s.exercises)?s.exercises.length:0),0),corrections:Array.isArray(content.corrections)?content.corrections.length:0,graph_plan:graphPlan,geogebra_plan:geogebraPlan,exercise_geogebra_plan:exerciseGeogebraPlan,documentary_visual_plan:documentaryPlan};
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return reply({ok:false,error:"Méthode POST requise."},405);
  try{
    const contentLength=Number(req.headers.get("content-length")||0);
    if(contentLength>MAX_BODY_BYTES)return reply({ok:false,error:"Payload éditorial trop volumineux."},413);
    const rawKey=req.headers.get("x-aurore-gpt-key")||"";
    if(!rawKey)return reply({ok:false,error:"Clé éditoriale Aurore manquante."},401);
    const keyHash=await sha256(rawKey);
    const {data:keyRow,error:keyError}=await db.from("aurora_gpt_ingest_keys").select("id,active").eq("key_hash",keyHash).eq("active",true).maybeSingle();
    if(keyError||!keyRow)return reply({ok:false,error:"Clé éditoriale Aurore invalide."},401);
    let createdBy:string|null=null;
    const authHeader=req.headers.get("Authorization")||"";
    if(authHeader.startsWith("Bearer ")){
      const token=authHeader.slice(7).trim();if(!token)return reply({ok:false,error:"Jeton Authorization vide."},401);
      const {data:authData,error:authError}=await db.auth.getUser(token);if(authError||!authData.user)return reply({ok:false,error:"Session Authorization invalide."},401);
      createdBy=authData.user.id;
    }
    const payload=await req.json();
    const content=payload?.content_json;
    const memorySessionId=text(payload.memory_session_id,100);
    const memorySessionToken=text(payload.memory_session_token,200);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memorySessionId)||!memorySessionToken){
      return reply({ok:false,error:"Session mémoire obligatoire : récupérez la mémoire puis transmettez session_id et memory_session_token."},428);
    }
    const title=text(payload.title||content.title,300);if(!title)return reply({ok:false,error:"Le titre est obligatoire."},400);
    const themeColor=text(payload.theme_color||payload.classification?.theme_color,32);if(!validColor(themeColor))return reply({ok:false,error:"theme_color doit être une couleur hexadécimale #RRGGBB."},400);
    const ingestId=text(payload.ingest_id||crypto.randomUUID(),120);
    const rawJobId=payload.job_id;
    const jobId=rawJobId===undefined||rawJobId===null||String(rawJobId).trim()===""?null:Number(rawJobId);
    if(jobId!==null&&(!Number.isSafeInteger(jobId)||jobId<1))return reply({ok:false,error:"job_id doit être un entier positif."},400);
    const subject=nullable(payload.subject||payload.classification?.matiere);
    const level=nullable(payload.level||payload.classification?.niveau);
    const className=nullable(payload.class_name||payload.classification?.classe);
    const documentType=nullable(payload.document_type,120)||"cours";
    const profile=resolveProfile(documentType);
    const memorySubject=String(subject||"").trim().toLowerCase().replace(/\s+/g," ");
    const memoryRequiresMath=memorySubject.includes("math");
    const memoryTokenHash=await sha256(memorySessionToken);
    const {data:memorySession,error:memorySessionError}=await db.from("aurora_editorial_memory_sessions")
      .select("session_id,requested_subject,requires_math,general_rule_ids,math_rule_ids,expires_at,used_at,bundle_sha256")
      .eq("session_id",memorySessionId).eq("token_hash",memoryTokenHash).is("used_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
    if(memorySessionError||!memorySession)return reply({ok:false,error:"Session mémoire absente, expirée, déjà consommée ou jeton invalide. Récupérez de nouveau la mémoire éditoriale avant l’ingestion."},428);
    const generalMemoryCount=Array.isArray(memorySession.general_rule_ids)?memorySession.general_rule_ids.length:0;
    const mathMemoryCount=Array.isArray(memorySession.math_rule_ids)?memorySession.math_rule_ids.length:0;
    if(generalMemoryCount<1)return reply({ok:false,error:"Mémoire éditoriale générale non récupérée."},428);
    if(memoryRequiresMath&&(!memorySession.requires_math||mathMemoryCount<1))return reply({ok:false,error:"Mémoire Mathématiques non récupérée pour ce document."},428);
    const incomingInstructions=payload.instructions&&typeof payload.instructions==="object"?payload.instructions:{};
    const editorialInstructions={
      ...incomingInstructions,
      paired_corrections:profile.kind==="exercices" ? incomingInstructions.paired_corrections!==false : false,
      profile:{kind:profile.kind,version:profile.version,lock:true,document_type:profile.kind==="exercices"?"exercices":documentType},
      exercise_sheet_intro:profile.kind==="exercices"
        ? (incomingInstructions.exercise_sheet_intro||"Énoncés indépendants, consignes précises, calculs justifiés et corrigés exclusivement liés aux questions posées.")
        : undefined
    };
    const counts=validateEditorialContent(content,profile,editorialInstructions,subject);
    const prompt=nullable(payload.prompt,4000);
    const classification=payload.classification&&typeof payload.classification==="object"?payload.classification:{};
    const contentHash=await sha256(JSON.stringify(content));
    const {data:result,error}=await db.rpc("aurora_ingest_editorial_document",{
      p_ingest_id:ingestId,p_created_by:createdBy,p_title:title,p_subject:subject,p_level:level,p_class_name:className,p_document_type:documentType,p_prompt:prompt,p_content_json:content,
      p_instructions:{...editorialInstructions,origin:"gpt_editorial_ingest",producer:"ChatGPT",human_review_required:true,manual_publication_only:true,lualatex_requested:false,schema_version:SCHEMA_VERSION,category:nullable(classification.categorie,100)||"Documents",domaine:nullable(classification.domaine,200),formation:nullable(classification.formation,200),specialite:nullable(classification.specialite,200),annee:nullable(classification.annee,100),semestre:nullable(classification.semestre,100),filiere:nullable(classification.filiere,200),theme_color:themeColor||"#C85C0D"},
      p_metadata:{origin:"gpt_editorial_ingest",producer:"ChatGPT",schema_version:SCHEMA_VERSION,content_sha256:contentHash,human_review_required:true,manual_publication_only:true,source:"chatgpt_editor",counts,aurore_profile:{kind:profile.kind,version:profile.version,lock:true,source:"document_type"},memory_session_id:memorySessionId,memory_schema:"aurora-editorial-memory-2",memory_gate_requested:true,memory_bundle_sha256:memorySession.bundle_sha256||null},
      p_domaine:nullable(classification.domaine,200),p_formation:nullable(classification.formation,200),p_specialite:nullable(classification.specialite,200),p_annee:nullable(classification.annee,100),p_semestre:nullable(classification.semestre,100),p_filiere:nullable(classification.filiere,200),p_matiere:subject,p_theme_color:themeColor||"#C85C0D",p_job_id:jobId
    });
    if(error){
      const message=String(error.message||error);
      if(message.toLowerCase().includes("mémoire éditoriale")||message.toLowerCase().includes("mémoire mathématique")){
        return reply({ok:false,error:message},428);
      }
      throw error;
    }
    await db.from("aurora_gpt_ingest_keys").update({last_used_at:new Date().toISOString()}).eq("id",keyRow.id);
    const out=Array.isArray(result)?result[0]:result;
    if(!out?.ok)throw new Error("Le contrat d’ingestion éditoriale a refusé le document.");
    return reply({ok:true,duplicate:out.duplicate===true,generated_document_id:out.generated_document_id,job_id:out.job_id,status:out.status,version:out.version,schema_version:SCHEMA_VERSION,content_sha256:contentHash,message:out.duplicate?"Document éditorial déjà intégré : aucune duplication créée.":"Document éditorial reçu. Il est en contrôle administratif; le rendu PDF reste séparé."},out.duplicate?200:201);
  }catch(error){console.error("aurora-gpt-ingest:",error);return reply({ok:false,error:error instanceof Error?error.message:String(error)},500);}
});