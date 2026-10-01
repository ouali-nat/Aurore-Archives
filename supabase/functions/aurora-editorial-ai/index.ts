import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const XAI_KEY = Deno.env.get("XAI_API_KEY") || Deno.env.get("GROK_API_KEY") || Deno.env.get("AURORA_GROK_API_KEY") || "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("AURORA_CLAUDE_API_KEY") || "";
const GROK_MODEL = Deno.env.get("AURORA_GROK_MODEL") || "grok-4.3";
const CLAUDE_MODEL = Deno.env.get("AURORA_CLAUDE_MODEL") || "claude-sonnet-5-5";
const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

type Json = Record<string, any>;

const esc = (v:any) => String(v ?? "");
const isCourse = (t:any) => /cours|course|fiche de cours|fiche de revision|fiche revision/i.test(esc(t));
const isScientific = (s:any) => /math|physique|chimie|sciences physiques|\bpc\b|svt|biologie|science/i.test(
  esc(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"")
);
const isMath = (s:any) => /math/i.test(esc(s));
const isPhysicsChem = (s:any) => /physique|chimie|sciences physiques|\bpc\b/i.test(
  esc(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"")
);

function response(body:any, status=200){
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function cleanJsonText(raw:string){
  let s = String(raw || "").trim();
  if (s.startsWith("```")) s = s.replace(/^\`\`\`(?:json)?/i,"").replace(/\`\`\`$/,"").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("Le moteur IA n’a pas fourni un objet JSON exploitable.");
  return s.slice(a,b+1);
}

function safeText(v:any, max=18000){
  return esc(v).trim().slice(0,max);
}

function compactMemory(rows:any[], maxChars=22000){
  return rows.map(r => ({
    rule_key:r.rule_key, version:r.version, title:r.title, mandatory:r.mandatory === true, content:r.content
  })).reduce((acc:any[], item:any) => {
    const next = JSON.stringify([...acc,item]);
    if(next.length > maxChars) return acc;
    acc.push(item); return acc;
  }, []);
}

async function callRpc(name:string, args:any){
  const {data,error} = await db.rpc(name,args);
  if(error) throw new Error(error.message || ("RPC "+name+" indisponible."));
  return data;
}

async function patchState(jobId:number, runId:string, patch:Json, stage?:string, productionStatus?:string){
  const data = await callRpc("aurora_patch_editorial_ai_treatment", {
    p_job_id: jobId, p_run_id: runId, p_patch: patch,
    p_stage: stage ?? null, p_production_status: productionStatus ?? null
  });
  if(data?.ok === false) throw new Error(data.error || "Le suivi du traitement n’est plus actif.");
  return data;
}

function baseSchema(){
  const subsection = {
    type:"object", additionalProperties:false,
    required:["title","content","definition","properties","operations","reasoning","examples","applications"],
    properties:{
      title:{type:"string",minLength:10},
      content:{type:"array",minItems:4,maxItems:8,items:{type:"string",minLength:25}},
      definition:{type:"string",minLength:20},
      properties:{type:"string",minLength:20},
      operations:{type:"string",minLength:20},
      reasoning:{type:"string",minLength:20},
      examples:{type:"string",minLength:20},
      applications:{type:"string",minLength:20}
    }
  };
  const exercise = {
    type:"object", additionalProperties:false,
    required:["id","statement","hint"],
    properties:{
      id:{type:"string",minLength:2},
      statement:{type:"string",minLength:40},
      hint:{type:"string",minLength:10}
    }
  };
  const correction = {
    type:"object", additionalProperties:false,
    required:["exercise_id","content"],
    properties:{
      exercise_id:{type:"string",minLength:2},
      content:{type:"string",minLength:50}
    }
  };
  const graph = {
    type:"object", additionalProperties:false,
    required:["id","title","purpose","instrument","expression","x_min","x_max","y_min","y_max"],
    properties:{
      id:{type:"string",minLength:3},
      title:{type:"string",minLength:5},
      purpose:{type:"string",minLength:15},
      instrument:{type:"string",enum:["function2d","complex_plane","parametric2d","parametric3d","surface3d","geometry2d","geometry3d"]},
      expression:{type:"string",minLength:1},
      x_expression:{type:"string"},
      y_expression:{type:"string"},
      z_expression:{type:"string"},
      x_min:{type:"number"},x_max:{type:"number"},y_min:{type:"number"},y_max:{type:"number"},
      z_min:{type:"number"},z_max:{type:"number"},t_min:{type:"number"},t_max:{type:"number"}
    }
  };
  const visual = {
    type:"object", additionalProperties:false,
    required:["id","type","query","title","caption","purpose","required"],
    properties:{
      id:{type:"string",minLength:3}, type:{type:"string",const:"wikimedia"},
      query:{type:"string",minLength:4}, title:{type:"string",minLength:2},
      caption:{type:"string",minLength:4}, purpose:{type:"string",enum:["illustration","schema","photo","experimental","comparison"]},
      required:{type:"boolean",const:true}
    }
  };
  const section = {
    type:"object", additionalProperties:false,
    required:["title","content","subsections","graphs","visuals","exercises","corrections"],
    properties:{
      title:{type:"string",minLength:8},
      content:{type:"array",minItems:4,maxItems:10,items:{type:"string",minLength:30}},
      subsections:{type:"array",minItems:2,maxItems:4,items:subsection},
      graphs:{type:"array",maxItems:4,items:graph},
      visuals:{type:"array",maxItems:3,items:visual},
      exercises:{type:"array",maxItems:6,items:exercise},
      corrections:{type:"array",maxItems:6,items:correction}
    }
  };
  const decision = {
    type:"object", additionalProperties:false,
    required:["section_number","decision","rationale"],
    properties:{
      section_number:{type:"integer",minimum:1,maximum:30},
      decision:{type:"string",enum:["build","not_needed"]},
      rationale:{type:"string",minLength:8},
      visual_ids:{type:"array",items:{type:"string"}},
      graph_ids:{type:"array",items:{type:"string"}}
    }
  };
  return {
    type:"object", additionalProperties:false,
    required:["schema_version","title","introduction","course_profile","sources","visual_plan","geogebra_plan","synthesis","sections"],
    properties:{
      schema_version:{type:"string",const:"aurora-editorial-1"},
      title:{type:"string",minLength:3},
      introduction:{type:"string",minLength:450},
      course_profile:{
        type:"object",additionalProperties:false,
        required:["short_format","short_format_reason","no_visuals"],
        properties:{
          short_format:{type:"boolean",const:false},
          short_format_reason:{type:"string"},
          no_visuals:{type:"boolean",const:false}
        }
      },
      sources:{
        type:"array",items:{type:"string"},maxItems:12
      },
      visual_plan:{
        type:"object",additionalProperties:false,
        required:["schema_version","decisions"],
        properties:{
          schema_version:{type:"string",enum:["documentary-visual-plan-1","math-visual-plan-1"]},
          decisions:{type:"array",items:decision}
        }
      },
      geogebra_plan:{
        type:"object",additionalProperties:false,
        required:["schema_version","decisions"],
        properties:{
          schema_version:{type:"string",const:"geogebra-visual-plan-1"},
          decisions:{type:"array",items:decision}
        }
      },
      synthesis:{type:"string",minLength:120},
      sections:{type:"array",minItems:12,maxItems:30,items:section}
    }
  };
}

function taskContext(t:any, memories:any[]){
  const w=t.metadata?.workflow || {};
  const proposal=w.proposal || {};
  const research=w.chapter_research || {};
  return {
    task:{
      id:t.id,title:t.title,subject:t.subject,level:t.level,class_name:t.class_name,
      document_type:t.document_type,theme_color:t.theme_color || w.pdfThemeColor || "#6D28D9"
    },
    selected_chapters:w.selected_chapters || w.chapters || [],
    proposal,
    research,
    memory:memories,
    exact_rules:{
      no_invented_sources:true,
      course_standard_minimum_words:3000,
      introduction_minimum_characters:450,
      max_sections:30,
      scientific_lycee_latex_minimum:1200,
      scientific_geogebra_minimum:2,
      scientific_distinct_source_sites_minimum:3,
      documentary_visuals: "1 to 8 Wikimedia visuals for non-math courses",
      math_visual_schema:"math-visual-plan-1",
      documentary_visual_schema:"documentary-visual-plan-1",
      geogebra_visual_schema:"geogebra-visual-plan-1",
      scientific_implication_guard:"at least 1, no more than 8% of LaTeX element count, max 100"
    }
  };
}

function buildPrompt(ctx:any, repairFeedback:string){
  const t=ctx.task, scientific=isScientific(t.subject), math=isMath(t.subject), pc=isPhysicsChem(t.subject);
  const requirements=[
    "Rédige un document pédagogique réel, directement exploitable, pas un plan et pas un résumé.",
    "Réponds uniquement avec le JSON demandé, sans Markdown, sans commentaire hors JSON.",
    "Le titre du JSON doit correspondre exactement au titre de la tâche.",
    "Le cours standard doit dépasser 3000 mots utiles en comptant uniquement introduction + sections[].content.",
    "Produis entre 12 et 24 sections pédagogiques distinctes. Aucune section ne doit être un remplissage générique.",
    "Chaque section non Introduction/Synthèse/Évaluation finale contient au moins deux sous-sections réellement développées.",
    "Chaque sous-section doit avoir un titre, au moins quatre éléments content, puis des champs disciplinaires réels : definition, properties, operations, reasoning, examples, applications.",
    "Introduis chaque notion avant de l’utiliser et recalcule réellement les résultats numériques, unités, relations et transformations.",
    "Utilise les délimiteurs LaTeX canoniques Aurore \\(...\\) et \\[...\\].",
    "Chaque formule doit être pédagogiquement utile et accompagnée de texte explicatif ; ne fabrique pas de formules décoratives.",
    "Évite les formulations répétitives et les modèles interdits comme « étude spécifique de ce sous-thème » ou « Résoudre un problème nouveau portant sur... ».",
    "Les exercices doivent avoir des énoncés concrets et les corrections doivent reprendre les données de leurs exercices, sans correction générique.",
    "Le document doit conserver la sélection de chapitres et le plan C comme base, sans inventer un autre programme."
  ];
  if(scientific){
    requirements.push(
      "Pour les sciences au lycée/supérieur, la couche scientifique doit produire au moins 1200 éléments LaTeX comptés par le préflight : nombreux raisonnements, égalités, unités, relations, calculs et notations authentiques, répartis naturellement.",
      "Ajoute au moins une implication réelle (\\Rightarrow, \\implies ou connecteur convertible) mais ne répète pas artificiellement les implications.",
      "Ajoute au moins deux constructions GeoGebra réellement utiles dans sections[].graphs avec instrument supporté, expressions et bornes numériques.",
      "Chaque construction GeoGebra doit être référencée dans geogebra_plan avec une décision build ; les sections sans construction utilisent not_needed avec une justification.",
      "Pour les mathématiques, utilise visual_plan.schema_version=math-visual-plan-1 et une décision pour chaque section. Construis réellement les graphiques lorsque la notion est graphable.",
      "Pour la Physique-Chimie, les graphiques doivent être réels et reliés à une relation physique/chimique ou à un calcul, pas décoratifs.",
      "Ajoute régulièrement des phrases de raisonnement avec « car », « en effet », « on obtient », « on vérifie », « puisque », « d’où » ou « autrement dit », directement dans sections[].content."
    );
  } else {
    requirements.push(
      "Pour un cours non mathématique, utilise visual_plan.schema_version=documentary-visual-plan-1 avec une décision pour chaque section.",
      "Inclue entre 1 et 8 visuels Wikimedia dans sections[].visuals, avec query, title, caption, purpose et required=true. Les queries doivent être documentaires et spécifiques au sujet.",
      "Chaque visuel Wikimedia build doit être référencé exactement une fois par visual_plan.decisions[].visual_ids."
    );
  }
  if(pc) requirements.push("Pour la Physique-Chimie, privilégie les lois, équations, unités SI, bilans dimensionnels, raisonnements et calculs explicites.");
  if(math) requirements.push("Pour les Mathématiques, privilégie démonstrations, calculs, propriétés, transformations algébriques et représentations GeoGebra utiles plutôt que de la prose pour augmenter artificiellement le volume.");
  return [
    "Tu es l’IA de production éditoriale d’Aurore — Section D.",
    ...requirements,
    "",
    "CONTEXTE PERSISTÉ Aurore :",
    JSON.stringify(ctx),
    "",
    repairFeedback ? "RETOUR DES CONTRÔLES À CORRIGER :\n"+repairFeedback : "",
    "",
    "SCHEMA EXACT ATTENDU :",
    JSON.stringify(baseSchema())
  ].join("\n");
}

async function callGrok(prompt:string){
  if(!XAI_KEY) throw new Error("Clé xAI/Grok non configurée dans les secrets de la fonction.");
  const body={
    model:GROK_MODEL,
    messages:[
      {role:"system",content:"Tu produis des documents pédagogiques structurés pour Aurore. Respecte strictement le JSON Schema, les garde-fous scientifiques et les sources fournies."},
      {role:"user",content:prompt}
    ],
    temperature:0.25,
    response_format:{type:"json_schema",json_schema:{name:"aurore_editorial_document",strict:true,schema:baseSchema()}},
    max_tokens:50000
  };
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),110000);
  try{
    const r=await fetch("https://api.x.ai/v1/chat/completions",{
      method:"POST",
      headers:{"Authorization":"Bearer "+XAI_KEY,"Content-Type":"application/json"},
      body:JSON.stringify(body),signal:ctrl.signal
    });
    const txt=await r.text();
    let data:any=null; try{data=JSON.parse(txt);}catch{}
    if(!r.ok) throw new Error(data?.error?.message || txt.slice(0,900) || ("Grok HTTP "+r.status));
    const content=data?.choices?.[0]?.message?.content;
    if(!content) throw new Error("Grok n’a renvoyé aucun contenu.");
    return {content:JSON.parse(cleanJsonText(content)),usage:data?.usage||null,model:GROK_MODEL};
  } finally { clearTimeout(timeout); }
}

async function callClaude(prompt:string){
  if(!ANTHROPIC_KEY) throw new Error("Clé Anthropic/Claude non configurée dans les secrets de la fonction.");
  const body={
    model:CLAUDE_MODEL,max_tokens:50000,
    system:"Tu produis des documents pédagogiques structurés pour Aurore. Retourne uniquement le JSON final, sans Markdown, et respecte strictement le schéma, les garde-fous et les sources fournies.",
    messages:[{role:"user",content:prompt}]
  };
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),110000);
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{
        "x-api-key":ANTHROPIC_KEY,
        "anthropic-version":"2023-06-01",
        "content-type":"application/json"
      },
      body:JSON.stringify(body),signal:ctrl.signal
    });
    const txt=await r.text();
    let data:any=null; try{data=JSON.parse(txt);}catch{}
    if(!r.ok) throw new Error(data?.error?.message || txt.slice(0,900) || ("Claude HTTP "+r.status));
    const content=(Array.isArray(data?.content)?data.content:[]).find((x:any)=>x?.type==="text")?.text;
    if(!content) throw new Error("Claude n’a renvoyé aucun contenu.");
    return {content:JSON.parse(cleanJsonText(content)),usage:data?.usage||null,model:CLAUDE_MODEL};
  } finally { clearTimeout(timeout); }
}

function validateShape(content:any, t:any){
  if(!content || typeof content!=="object") throw new Error("content_json invalide.");
  if(String(content.title||"").trim()!==String(t.title||"").trim()) throw new Error("Le titre généré ne correspond pas à la tâche.");
  if(!Array.isArray(content.sections) || content.sections.length<12 || content.sections.length>30) throw new Error("Le cours doit comporter entre 12 et 30 sections.");
  if(String(content.introduction||"").trim().length<450) throw new Error("Introduction trop courte.");
  if(String(content.synthesis||"").trim().length<120) throw new Error("Synthèse disciplinaire trop courte.");
  const bad:string[]=[];
  content.sections.forEach((s:any,i:number)=>{
    if(!Array.isArray(s.content)||s.content.length<4) bad.push("section "+(i+1)+" : content insuffisant");
    if(!Array.isArray(s.subsections)||s.subsections.length<2) bad.push("section "+(i+1)+" : 2 sous-sections requises");
    if(Array.isArray(s.subsections)) s.subsections.forEach((sub:any,j:number)=>{
      const fields=["title","content","definition","properties","operations","reasoning","examples","applications"];
      for(const k of fields) if(!sub?.[k] || (typeof sub[k]==="string" && sub[k].trim().length<10) || (k==="content" && (!Array.isArray(sub[k])||sub[k].length<4))) bad.push(`section ${i+1} sous-section ${j+1} : ${k} absent`);
    });
  });
  if(bad.length) throw new Error(bad.slice(0,8).join(" ; "));
  if(isMath(t.subject)){
    if(content.visual_plan?.schema_version!=="math-visual-plan-1") throw new Error("visual_plan math-visual-plan-1 obligatoire.");
  } else if(isCourse(t.document_type)){
    if(content.visual_plan?.schema_version!=="documentary-visual-plan-1") throw new Error("visual_plan documentaire obligatoire.");
    if(!Array.isArray(content.visual_plan?.decisions)||content.visual_plan.decisions.length!==content.sections.length) throw new Error("Une décision documentaire est requise pour chaque section.");
    const visualCount=content.sections.reduce((n:number,s:any)=>n+(Array.isArray(s.visuals)?s.visuals.length:0),0);
    if(visualCount<1 || visualCount>8) throw new Error("Un cours documentaire doit contenir 1 à 8 visuels Wikimedia.");
  }
  if(isScientific(t.subject)){
    const g=content.sections.reduce((n:number,s:any)=>n+(Array.isArray(s.graphs)?s.graphs.length:0),0);
    if(g<2) throw new Error("Au moins deux constructions GeoGebra sont requises pour ce document scientifique.");
  }
}

function feedbackFromReports(reports:any[]){
  const parts:string[]=[];
  for(const r of reports){
    if(!r) continue;
    if(r.status && r.status!=="pass") parts.push(JSON.stringify(r.failures||r.issues||r));
  }
  return parts.join("\n").slice(0,14000);
}

async function validateContent(content:any,t:any){
  validateShape(content,t);
  const words=await callRpc("aurora_count_editorial_words",{p_content:content,p_document_type:t.document_type});
  if(isCourse(t.document_type) && Number(words||0)<3000) throw new Error("COURSE_VOLUME: "+words+" mots utiles, minimum 3000.");
  const reports:any[]=[];
  if(isScientific(t.subject)){
    const preflight=await callRpc("aurora_scientific_preflight",{
      p_subject:t.subject,p_document_type:t.document_type,p_content_json:content,
      p_level:t.level,p_class_name:t.class_name,p_research:t.metadata?.workflow?.chapter_research||{}
    });
    reports.push(preflight);
    if(preflight?.status!=="pass") throw new Error("SCIENTIFIC_PREFLIGHT: "+JSON.stringify(preflight.failures||preflight));
    const structure=await callRpc("aurora_scientific_editorial_structure_guard",{
      p_subject:t.subject,p_document_type:t.document_type,p_content_json:content
    });
    reports.push(structure);
    if(structure?.status!=="pass") throw new Error("SCIENTIFIC_STRUCTURE: "+JSON.stringify(structure.issues||structure));
    const reasoning=await callRpc("aurora_validate_scientific_reasoning_quality",{
      p_subject:t.subject,p_document_type:t.document_type,p_level:t.level,p_class_name:t.class_name,p_content_json:content
    });
    reports.push(reasoning);
    if(reasoning?.status!=="pass") throw new Error("SCIENTIFIC_REASONING: "+JSON.stringify(reasoning.failures||reasoning));
  }
  if(isCourse(t.document_type)){
    const quality=await callRpc("aurora_validate_course_quality",{
      p_content:content,p_title:t.title,p_subject:t.subject,p_document_type:t.document_type,
      p_metadata:{course_quality:{format_profile:"standard_course"}}
    });
    reports.push(quality);
    if(quality?.passed!==true) throw new Error("COURSE_QUALITY: "+JSON.stringify(quality));
  }
  return {reports,words:Number(words||0)};
}

function deriveEditorialPreview(content:any){
  const all=Array.isArray(content.sections)?content.sections:[];
  const joined=all.flatMap((s:any)=>Array.isArray(s.content)?s.content:[]).join("\n\n");
  return {
    title:content.title||"",
    introduction:content.introduction||"",
    content:joined.slice(0,60000),
    synthesis:content.synthesis||"",
    notes:"Généré par traitement IA Section D ; contenu canonique conservé dans le document ingéré.",
    updated_at:new Date().toISOString()
  };
}

async function loadJobForRun(jobId:number,runId:string){
  const {data:rows,error}=await db.from("aurora_content_jobs")
    .select("id,title,subject,level,class_name,document_type,generated_document_id,theme_color,prompt,instructions,domaine,formation,specialite,annee,semestre,filiere,metadata")
    .eq("id",jobId).limit(1);
  if(error)throw new Error(error.message);
  const t=rows?.[0];
  if(!t)throw new Error("Tâche introuvable.");
  const ai=t.metadata?.workflow?.ai_treatment;
  if(String(ai?.run_id||"")!==String(runId||""))throw new Error("Ce traitement n’est plus le traitement actif.");
  return t;
}

async function scheduleStep(jobId:number,runId:string,action:string){
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),9000);
  try{
    const r=await fetch(SUPABASE_URL+"/functions/v1/aurora-editorial-ai",{
      method:"POST",
      headers:{"Authorization":"Bearer "+SERVICE_ROLE,"Content-Type":"application/json"},
      body:JSON.stringify({internal:true,job_id:jobId,run_id:runId,action}),
      signal:ctrl.signal
    });
    const txt=await r.text();
    if(!r.ok)throw new Error(txt||("Étape "+action+" HTTP "+r.status));
    return txt;
  }finally{clearTimeout(timeout);}
}

async function failTreatment(jobId:number,runId:string,message:string,progress=68){
  try{
    await patchState(jobId,runId,{status:"failed",progress,stage:"error",step:"error",label:"Traitement bloqué",error:safeText(message,16000),finished_at:new Date().toISOString()},undefined,"editorial_error");
  }catch(_){}
}

async function loadMemoriesForTask(t:any){
  const [generalRes,structureRes,mathRes]=await Promise.all([
    db.from("aurora_editorial_memory").select("rule_key,version,title,mandatory,content").eq("active",true).order("priority",{ascending:false}),
    db.from("aurora_editorial_structure_memory").select("rule_key,version,title,mandatory,content").eq("active",true).order("priority",{ascending:false}),
    db.from("aurora_math_editorial_memory").select("rule_key,version,title,mandatory,content").eq("active",true).order("priority",{ascending:false})
  ]);
  if(generalRes.error)throw new Error(generalRes.error.message);
  if(structureRes.error)throw new Error(structureRes.error.message);
  if(mathRes.error)throw new Error(mathRes.error.message);
  return [
    ...compactMemory(generalRes.data||[],12000),
    ...compactMemory(structureRes.data||[],8000),
    ...(isMath(t.subject)?compactMemory(mathRes.data||[],12000):[])
  ];
}

function buildTaskContextForWorker(t:any,memories:any[]){
  return {...taskContext(t,memories),task:{...taskContext(t,memories).task,metadata:t.metadata}};
}

async function actionGenerate(jobId:number,provider:string,runId:string){
  const t=await loadJobForRun(jobId,runId),w=t.metadata?.workflow||{},ai=w.ai_treatment||{};
  if(ai.status!=="processing"||ai.step!=="generate")return;
  const memories=await loadMemoriesForTask(t);
  const ctx=buildTaskContextForWorker(t,memories);
  await patchState(jobId,runId,{progress:18,stage:"prompt",step:"generate",label:"Lecture du dossier C et préparation du moteur "+provider,model:provider==="grok"?GROK_MODEL:CLAUDE_MODEL});
  const result=provider==="grok"?await callGrok(buildPrompt(ctx,"")):await callClaude(buildPrompt(ctx,""));
  await patchState(jobId,runId,{progress:54,stage:"persist_editorial_content",step:"generate_persist",label:"Persistance du contenu produit",usage:result.usage,model:result.model,attempt:1});
  const persisted=await callRpc("aurora_persist_d_ai_editorial_content",{p_job_id:jobId,p_run_id:runId,p_content_json:result.content});
  if(persisted?.ok!==true)throw new Error(persisted?.error||"La persistance du contenu éditorial a échoué.");
  await patchState(jobId,runId,{progress:60,stage:"validation",step:"validate",label:"Contrôles Aurore du contenu généré",attempt:1,usage:result.usage,model:result.model});
  EdgeRuntime.waitUntil(scheduleStep(jobId,runId,"validate"));
}

async function actionValidate(jobId:number,provider:string,runId:string){
  const t=await loadJobForRun(jobId,runId),w=t.metadata?.workflow||{},ai=w.ai_treatment||{};
  if(ai.status!=="processing"||!["validate","validate2"].includes(String(ai.step||"")))return;
  const content=w.editorial_content;
  if(!content)throw new Error("Contenu éditorial persistant absent.");
  try{
    const checked=await validateContent(content,t);
    await patchState(jobId,runId,{
      progress:84,stage:"ready_for_ingest",step:"ingest",label:"Tous les contrôles Aurore sont validés",
      word_count:checked.words,
      checks:checked.reports.map((x:any)=>({status:x?.status,passed:x?.passed,contract_version:x?.contract_version||x?.schema_version,metrics:x?.metrics||null})),
      last_validation_error:null
    });
    EdgeRuntime.waitUntil(scheduleStep(jobId,runId,"ingest"));
  }catch(err){
    const feedback=safeText(err?.message||err,14000);
    const attempt=Number(ai.attempt)||1;
    if(attempt>=2){
      await failTreatment(jobId,runId,feedback,72);
      return;
    }
    await patchState(jobId,runId,{progress:52,stage:"repair_required",step:"repair",label:"Contrôle non validé : correction ciblée demandée",attempt:1,last_validation_error:feedback});
    EdgeRuntime.waitUntil(scheduleStep(jobId,runId,"repair"));
  }
}

async function actionRepair(jobId:number,provider:string,runId:string){
  const t=await loadJobForRun(jobId,runId),w=t.metadata?.workflow||{},ai=w.ai_treatment||{};
  if(ai.status!=="processing"||ai.step!=="repair")return;
  const memories=await loadMemoriesForTask(t);
  const ctx=buildTaskContextForWorker(t,memories);
  const feedback=safeText(ai.last_validation_error||"Le contrôle Aurore demande une correction ciblée.",14000);
  await patchState(jobId,runId,{progress:56,stage:"repair",step:"repair",label:"Correction ciblée par "+provider,attempt:2});
  const result=provider==="grok"?await callGrok(buildPrompt(ctx,feedback)):await callClaude(buildPrompt(ctx,feedback));
  await patchState(jobId,runId,{progress:62,stage:"persist_editorial_content",step:"repair_persist",label:"Persistance de la version corrigée",usage:result.usage,model:result.model,attempt:2});
  const persisted=await callRpc("aurora_persist_d_ai_editorial_content",{p_job_id:jobId,p_run_id:runId,p_content_json:result.content});
  if(persisted?.ok!==true)throw new Error(persisted?.error||"La persistance de la correction éditoriale a échoué.");
  await patchState(jobId,runId,{progress:67,stage:"validation",step:"validate2",label:"Second passage des contrôles Aurore",attempt:2,usage:result.usage,model:result.model});
  EdgeRuntime.waitUntil(scheduleStep(jobId,runId,"validate"));
}

function buildIngestPayload(t:any,w:any,content:any,provider:string,runId:string,wordCount:number){
  const ingestId=("AUR-D-AI-"+t.id+"-"+provider+"-"+Date.now().toString(36)).slice(0,120);
  return {
    ingestId,
    payload:{
      ingest_id:ingestId,job_id:String(t.id),title:t.title,subject:t.subject,level:t.level,class_name:t.class_name,
      document_type:t.document_type,prompt:t.prompt||null,content_json:content,instructions:t.instructions||{},
      metadata:{
        origin:"gpt_editorial_ingest",connector_mode:true,ai_provider:provider,
        ai_model:provider==="grok"?GROK_MODEL:CLAUDE_MODEL,ai_run_id:runId,ai_word_count:wordCount,
        workflow_source:"section_D_multimodel",manual_pdf_launch_required:true,auto_pdf_launch:false,
        pending_admin_surface:"documents_en_attente"
      },
      matiere:t.subject,theme_color:t.theme_color||w.proposal?.pdfThemeColor||"#6D28D9",
      domaine:t.domaine||null,formation:t.formation||null,specialite:t.specialite||null,
      annee:t.annee||null,semestre:t.semestre||null,filiere:t.filiere||null
    }
  };
}

async function actionIngest(jobId:number,provider:string,runId:string){
  const t=await loadJobForRun(jobId,runId),w=t.metadata?.workflow||{},ai=w.ai_treatment||{};
  if(ai.status!=="processing"||ai.step!=="ingest")return;
  const content=w.editorial_content;
  if(!content)throw new Error("Contenu éditorial final absent avant ingestion.");
  const wordCount=Number(ai.word_count)||Number((await callRpc("aurora_count_editorial_words",{p_content:content,p_document_type:t.document_type}))||0);
  await patchState(jobId,runId,{progress:90,stage:"ingest",step:"ingest",label:"Ingestion officielle du document",word_count:wordCount});
  const {ingestId,payload}=buildIngestPayload(t,w,content,provider,runId,wordCount);
  const ingested=await callRpc("aurora_connector_ingest_editorial_document",{p_payload:payload});
  const documentId=Number(ingested?.generated_document_id||ingested?.document_id||ingested?.id);
  if(!Number.isFinite(documentId)||documentId<=0)throw new Error("L’ingestion officielle n’a pas retourné de generated_document_id.");
  const {data:doc,error:docError}=await db.from("aurora_generated_documents")
    .select("id,status,pdf_path,pdf_url").eq("id",documentId).limit(1).maybeSingle();
  if(docError)throw new Error(docError.message);
  if(!doc||String(doc.status||"").toLowerCase()!=="review"||doc.pdf_path||doc.pdf_url)throw new Error("Le document ingéré n’est pas dans l’état review sans PDF attendu.");
  const finalized=await callRpc("aurora_finalize_editorial_ai_treatment",{p_job_id:jobId,p_run_id:runId,p_generated_document_id:documentId,p_ingest_id:ingestId});
  if(finalized?.ok!==true)throw new Error(finalized?.error||"Finalisation D impossible.");
}

async function runInternalAction(jobId:number,provider:string,runId:string,action:string){
  try{
    if(!["generate","validate","repair","ingest"].includes(action))throw new Error("Étape de traitement inconnue.");
    if(action==="generate")await actionGenerate(jobId,provider,runId);
    else if(action==="validate")await actionValidate(jobId,provider,runId);
    else if(action==="repair")await actionRepair(jobId,provider,runId);
    else await actionIngest(jobId,provider,runId);
  }catch(err){
    await failTreatment(jobId,runId,err?.message||err);
  }
}

async function authenticateAdmin(req:Request){
  const auth=req.headers.get("Authorization")||"";
  const token=auth.replace(/^Bearer\s+/i,"").trim();
  if(!token)throw new Error("Session administrateur absente.");
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!user)throw new Error("Session administrateur invalide.");
  const {data:profile,error:profileError}=await db.from("Profils").select("role,banni").eq("id",user.id).maybeSingle();
  if(profileError)throw new Error(profileError.message);
  if(profile?.banni===true||profile?.role!=="admin")throw new Error("Accès administrateur requis.");
  return user;
}
function isInternalRequest(req:Request){
  return Boolean(SERVICE_ROLE)&&req.headers.get("Authorization")==="Bearer "+SERVICE_ROLE;
}

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:CORS});
  if(req.method!=="POST") return response({error:"Méthode non autorisée."},405);
  try{
    await authenticateAdmin(req);
    const body=await req.json();
    const jobId=Number(body?.job_id);
    const provider=String(body?.provider||"").trim().toLowerCase();
    if(!Number.isInteger(jobId)||jobId<=0) return response({error:"job_id invalide."},400);
    if(!["grok","claude"].includes(provider)) return response({error:"Choisis Grok ou Claude."},400);
    const runId="d-ai-"+jobId+"-"+provider+"-"+crypto.randomUUID();
    const started=await callRpc("aurora_begin_editorial_ai_treatment",{p_job_id:jobId,p_provider:provider,p_run_id:runId});
    if(started?.ok!==true) return response({
      ok:false,status:started?.status||"blocked",error:started?.error||"Traitement non démarré.",
      run_id:started?.run_id||null,provider:started?.provider||provider,progress:started?.progress||0
    },started?.status==="already_processing"?409:400);

    EdgeRuntime.waitUntil(processJob(jobId,provider,runId));
    return response({ok:true,status:"processing",job_id:jobId,provider,run_id:runId,progress:3},202);
  }catch(err){
    return response({error:safeText(err?.message||err,3000)},403);
  }
});
