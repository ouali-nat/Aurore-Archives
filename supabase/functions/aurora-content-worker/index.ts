import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonrepair } from "https://esm.sh/jsonrepair@3.13.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")!;const SR=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const ANON=Deno.env.get("SUPABASE_ANON_KEY")!;
const DS=Deno.env.get("DEEPSEEK_API_KEY");
const GK=Deno.env.get("GEMINI_API_KEY")||Deno.env.get("GOOGLE_API_KEY")||Deno.env.get("GOOGLE_GENERATIVE_AI_API_KEY");
const GM=String(Deno.env.get("GEMINI_CONTENT_MODEL")||"gemini-3.8-flash").trim();
const GLM=String(Deno.env.get("GEMINI_LIGHT_MODEL")||"gemini-3.5-flash-lite").trim();
const CFA=Deno.env.get("CLOUDFLARE_ACCOUNT_ID");const CFT=Deno.env.get("CLOUDFLARE_AI_TOKEN");const CFM="@cf/meta/llama-3.1-8b-instruct-fast";
const CFM_FALLBACK="@cf/meta/llama-3.1-8b-instruct-fp8";
const MIN_WORDS=3000;
const TARGET_MIN_WORDS=3200;
const TARGET_MAX_WORDS=4000;
const MIN_VISUALS=3;
function editorialProfile(j:any){
  const s=String(j?.subject||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const context=(s+" "+String(j?.title||"")+" "+String(j?.prompt||"")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const t=String(j?.document_type||"").toLowerCase();
  let profile="general";
  if(/math|mathematique|mathematics|algebre|geometrie|calcul|fonction|courbe|limite|derivee|derive|integrale|equation|logarithme|log|\\bln\\b|exponentielle|trigonometrie|complexe|vecteur|repere/.test(context)) profile="scientifique";
  else if(/svt|biologie|cellule|organite|membrane|genetique|ecologie|corps humain|physiologie|microbiologie|sciences de la vie/.test(context)) profile="biologie";
  else if(/physique|chimie|science de la terre|geologie/.test(s)) profile="experimental";
  else if(/anglais|english|espagnol|allemand|arabe|langue/.test(s)) profile="langues";
  else if(/francais|litterature|litteraire/.test(s)) profile="francais_litterature";
  else if(/histoire|geographie|education civique/.test(s)) profile="histoire_geographie";
  else if(/informatique|programmation|algorithmique|numerique/.test(s)) profile="informatique";
  else if(/technique|technologie|electronique|mecanique/.test(s)) profile="technique";
  const assessment=/devoir|examen|evaluation|controle|epreuve|quiz/.test(t);
  const mode=assessment?"evaluation":/exercice|entrainement/.test(t)?"entrainement":/fiche|revision/.test(t)?"revision":"cours";
  const instruction:any={biologie:"Profil SVT/biologie obligatoire. Construis un vrai cours de biologie, pas un cours scientifique générique : introduction du vivant et problématique → repères et vocabulaire → organisation biologique → structures et fonctions → observation/microscopie ou documents scientifiques → comparaison et mise en relation → bilan des notions → activités d'analyse de schéma/document → exercices de compréhension et d'application → corrigés. Pour un chapitre sur la cellule, privilégie dans cet ordre : notion de cellule → cellule procaryote/eucaryote → organisation générale → membrane, cytoplasme et noyau → principaux organites et fonctions → cellule animale/végétale → observation au microscope → bilan. N'invente pas de démonstrations mathématiques. N'utilise aucun graphique GeoGebra sauf si le sujet demande réellement une donnée biologique quantitative ; pour une structure biologique, utilise un schéma/une illustration documentaire. Limite les exercices à quelques activités intégrées au fil du cours puis regroupe un court entraînement final.",scientifique:"Profil scientifique obligatoire. Organise le cours dans cet ordre logique quand le sujet le permet : prérequis → notions fondamentales → définitions → propriétés/théorèmes → démonstration ou justification → méthode pas à pas → exemples calculés → interprétation → exercices progressifs → problème d'approfondissement → corrigés. Utilise les formules LaTeX uniquement dans les expressions mathématiques. Ne force pas des graphiques s'ils ne sont pas pertinents.",experimental:"Profil expérimental obligatoire. Organise le cours autour de : situation-problème → phénomène → observation → hypothèse/interprétation → loi ou principe → grandeurs et unités → protocole ou méthode expérimentale → résultats/tableau → exploitation → application → exercices → corrigés. N'utilise des formules que lorsqu'elles sont réellement nécessaires.",langues:"Profil langues obligatoire. Organise le document autour de : objectifs communicatifs → vocabulaire contextualisé → expressions utiles → point de grammaire → exemples en contexte → compréhension/lecture ou écoute décrite → dialogue ou interaction → activité de production → exercice de réemploi → correction/answers. N'insère jamais de démonstration mathématique, de théorème ou de formule artificielle. Les exemples doivent rester dans la langue étudiée avec traduction/explication si utile.",francais_litterature:"Profil français/littérature obligatoire. Organise le document autour de : contexte et repères → support ou extrait → compréhension/observation → notions littéraires → procédés et indices → analyse détaillée → interprétation → problématique → méthode de commentaire/dissertation selon le sujet → activité d'application → corrigé et analyse. Privilégie les citations courtes, l'argumentation et l'analyse plutôt que les listes mécaniques.",histoire_geographie:"Profil histoire-géographie obligatoire. Organise le document autour de : repères → contexte spatial/temporel → acteurs et territoires → événements ou phénomènes → causes → déroulement/organisation → conséquences → documents/sources à analyser → chronologie ou tableau si utile → synthèse → activités → corrigés. Décris les cartes de façon pédagogique si une carte graphique n'est pas disponible.",informatique:"Profil informatique obligatoire. Organise le document autour de : objectif/problème → concepts fondamentaux → vocabulaire technique → logique/algorithme → exemple pas à pas → code ou commandes dans des blocs dédiés → explication ligne par ligne → erreurs fréquentes → exercice de mise en pratique → corrigé. N'utilise pas de formules mathématiques sans nécessité.",technique:"Profil technique obligatoire. Organise le document autour de : objectif → matériel/composants → prérequis et sécurité → principe de fonctionnement → procédure étape par étape → schéma/tableau si utile → contrôle/diagnostic → application → exercice pratique → corrigé. Privilégie les consignes opératoires et les résultats attendus.",general:"Structure pédagogique générale progressive, mais adapte réellement les exemples, activités et exercices à la matière sans importer artificiellement une structure scientifique."};
  return {profile,mode,instruction:instruction[profile]||instruction.general};
}const db=createClient(URL,SR,{auth:{autoRefreshToken:false,persistSession:false}});const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...H,"Content-Type":"application/json"}});
const SCHEMA={title:"string",introduction:"string",learning_objectives:["string"],sections:[{title:"string",objective:"string",content:["string"],formula:"string",graphs:[{instrument:"function2d|parametric2d|parametric3d|surface3d|geometry3d",title:"string",expression:"string",x_expression:"string",y_expression:"string",z_expression:"string",parameter:"t",t_min:"number",t_max:"number",x_label:"string",y_label:"string",z_label:"string",x_min:"number",x_max:"number",y_min:"number",y_max:"number",z_min:"number",z_max:"number",grid:"boolean",axes:"boolean",points:[["number","number"]],points_of_interest:[{x:"number",y:"number",z:"number",label:"string"}],objects:[{type:"point|vector|line|plane|sphere|cylinder|cone|polygon|cube|prism|pyramid|tetrahedron",name:"string",points:["[x,y,z]"],from:"[x,y,z]",to:"[x,y,z]",radius:"number",height:"number"}],asymptotes:[{type:"vertical|horizontal",value:"number"}],style:"geogebra"}],visuals:[{type:"wikimedia",purpose:"illustration|schema|photo|historical|experimental",query:"string",required:"boolean",priority:"required|recommended|optional",caption:"string"}],exercises:[{question:"string",hint:"string",formula:"string"}]}],corrections:[{exercise_number:"number",solution:"string",formula:"string"}]};
const GRAPH_INSTRUMENTS=new Set(["function2d","parametric2d","parametric3d","surface3d","geometry3d"]);
function normalizeGraphInstrument(g:any){
  const x=g&&typeof g==="object"?g:{};
  const aliases:any={"function":"function2d","graph":"function2d","courbe":"function2d","parametric":"parametric2d","parametric2d":"parametric2d","parametric3d":"parametric3d","surface":"surface3d","surface3d":"surface3d","geometry3d":"geometry3d","geometrie3d":"geometry3d","3d":"geometry3d"};
  const raw=String(x.instrument||x.graph_type||"").toLowerCase().trim();
  const normalized=aliases[raw]||raw;
  const objects=Array.isArray(x.objects)?x.objects:[];
  const points2=Array.isArray(x.points)&&x.points.some((p:any)=>Array.isArray(p)&&p.length===2);
  const points3=Array.isArray(x.points)&&x.points.some((p:any)=>Array.isArray(p)&&p.length>=3);
  const poi3=Array.isArray(x.points_of_interest)&&x.points_of_interest.some((p:any)=>Number.isFinite(Number(p?.z)));
  const hasObjects=objects.some((o:any)=>o&&typeof o==="object"&&["point","vector","line","plane","sphere","cylinder","cone","polygon","cube","prism","pyramid","tetrahedron"].includes(String(o?.type||"").toLowerCase()));
  const hasExpression=String(x.expression||"").trim();
  const hasX=String(x.x_expression||"").trim(),hasY=String(x.y_expression||"").trim(),hasZ=String(x.z_expression||"").trim();
  const valid:any={
    function2d:()=>!!hasExpression||points2||Array.isArray(x.asymptotes)&&x.asymptotes.length>0,
    parametric2d:()=>!!hasX&&!!hasY,
    parametric3d:()=>!!hasX&&!!hasY&&!!hasZ,
    surface3d:()=>!!hasExpression,
    geometry3d:()=>hasObjects||points3||poi3
  };
  if(normalized&&valid[normalized]&&valid[normalized]())return {
    ...x,
    instrument:normalized,
    title:String(x.title||"Graphique"),
    expression:String(x.expression||"").trim(),
    x_expression:String(x.x_expression||"").trim(),
    y_expression:String(x.y_expression||"").trim(),
    z_expression:String(x.z_expression||"").trim(),
    parameter:(/^[xyz]$/i.test(String(x.parameter||""))?"t":String(x.parameter||"t").trim())||"t",
    t_min:Number.isFinite(Number(x.t_min))?Number(x.t_min):0,
    t_max:Number.isFinite(Number(x.t_max))?Number(x.t_max):2*Math.PI,
    x_min:Number.isFinite(Number(x.x_min))?Number(x.x_min):-10,
    x_max:Number.isFinite(Number(x.x_max))?Number(x.x_max):10,
    y_min:Number.isFinite(Number(x.y_min))?Number(x.y_min):-10,
    y_max:Number.isFinite(Number(x.y_max))?Number(x.y_max):10,
    z_min:Number.isFinite(Number(x.z_min))?Number(x.z_min):-10,
    z_max:Number.isFinite(Number(x.z_max))?Number(x.z_max):10,
    points:Array.isArray(x.points)?x.points:[],
    points_of_interest:Array.isArray(x.points_of_interest)?x.points_of_interest:[],
    objects:Array.isArray(x.objects)?x.objects:[],
    style:"geogebra"
  };
  if(raw)return null;
  if(objects.length&&hasObjects)return {...x,instrument:"geometry3d",style:"geogebra"};
  if(hasZ&&hasX&&hasY)return {...x,instrument:"parametric3d",style:"geogebra"};
  if(hasX&&hasY)return {...x,instrument:points3||poi3?"parametric3d":"parametric2d",style:"geogebra"};
  if(hasExpression)return {...x,instrument:String(x.z_label||"").trim()||points3||poi3?"surface3d":"function2d",style:"geogebra"};
  if(points3||poi3)return {...x,instrument:"geometry3d",style:"geogebra"};
  if(points2||Array.isArray(x.asymptotes)&&x.asymptotes.length)return {...x,instrument:"function2d",style:"geogebra"};
  return null;
}
function normalizeVisualPlan(v:any){
  const x=v&&typeof v==="object"?v:{};
  const type=String(x.type||"wikimedia").toLowerCase().trim();
  if(type!=="wikimedia")return null;
  const priorityRaw=String(x.priority||"recommended").toLowerCase().trim();
  const priority=priorityRaw==="required"||x.required===true?"required":priorityRaw==="optional"?"optional":"recommended";
  const purposeRaw=String(x.purpose||"illustration").toLowerCase().trim();
  const purposes=new Set(["illustration","schema","photo","historical","experimental"]);
  return {type:"wikimedia",purpose:purposes.has(purposeRaw)?purposeRaw:"illustration",query:String(x.query||"").trim().slice(0,240),required:priority==="required",priority,caption:String(x.caption||"").trim().slice(0,280)};
}

function aiSelection(j:any){
  const raw=j?.instructions?.ai?.selected;
  const selected=Array.isArray(raw)?raw.map((x:any)=>String(x||"").toLowerCase().trim()).filter((x:string)=>x==="gemini"||x==="llama"):[];
  return selected.length?Array.from(new Set(selected)):[ "llama" ];
}
function aiMode(j:any){const t=String(j?.document_type||"").toLowerCase();if(/qcm|quiz|questionnaire/.test(t))return "qcm";if(/exercice|entrainement/.test(t))return "exercices";if(/devoir|evaluation|controle|examen|epreuve/.test(t))return "evaluation";return "course";}
const GEMINI_GRAPH={instrument:{type:"STRING"},title:{type:"STRING"},expression:{type:"STRING"},x_expression:{type:"STRING"},y_expression:{type:"STRING"},z_expression:{type:"STRING"},parameter:{type:"STRING"},t_min:{type:"NUMBER"},t_max:{type:"NUMBER"},x_min:{type:"NUMBER"},x_max:{type:"NUMBER"},y_min:{type:"NUMBER"},y_max:{type:"NUMBER"},z_min:{type:"NUMBER"},z_max:{type:"NUMBER"}};
const GEMINI_VISUAL={type:{type:"STRING"},purpose:{type:"STRING"},query:{type:"STRING"},required:{type:"BOOLEAN"},priority:{type:"STRING"},caption:{type:"STRING"}};
const GEMINI_SCHEMA:any={type:"OBJECT",properties:{title:{type:"STRING"},introduction:{type:"STRING"},learning_objectives:{type:"ARRAY",items:{type:"STRING"}},sections:{type:"ARRAY",items:{type:"OBJECT",properties:{title:{type:"STRING"},objective:{type:"STRING"},content:{type:"ARRAY",items:{type:"STRING"}},formula:{type:"STRING"},graphs:{type:"ARRAY",items:{type:"OBJECT",properties:GEMINI_GRAPH}},visuals:{type:"ARRAY",items:{type:"OBJECT",properties:GEMINI_VISUAL}},exercises:{type:"ARRAY",items:{type:"OBJECT",properties:{question:{type:"STRING"},hint:{type:"STRING"},formula:{type:"STRING"}}}}}}},corrections:{type:"ARRAY",items:{type:"OBJECT",properties:{exercise_number:{type:"NUMBER"},solution:{type:"STRING"},formula:{type:"STRING"}}}}},required:["title","introduction","sections","corrections"]};
const LLAMA_SCHEMA:any={type:"object",properties:{title:{type:"string"},introduction:{type:"string"},learning_objectives:{type:"array",items:{type:"string"}},sections:{type:"array",items:{type:"object",properties:{title:{type:"string"},objective:{type:"string"},content:{type:"array",items:{type:"string"}},exercises:{type:"array",items:{type:"object",properties:{question:{type:"string"},hint:{type:"string"},formula:{type:"string"}},required:["question"]}}},required:["title","content"]}},corrections:{type:"array",items:{type:"object",properties:{exercise_number:{type:"number"},solution:{type:"string"},formula:{type:"string"}},required:["exercise_number","solution"]}}},required:["title","introduction","sections","corrections"]};
const GEMINI_LIGHT_SCHEMA:any={type:"OBJECT",properties:{
  title:{type:"STRING"},
  introduction:{type:"STRING"},
  learning_objectives:{type:"ARRAY",items:{type:"STRING"}},
  sections:{type:"ARRAY",minItems:4,items:{type:"OBJECT",properties:{
    title:{type:"STRING"},
    objective:{type:"STRING"},
    content:{type:"ARRAY",minItems:1,items:{type:"STRING"}},
    formula:{type:"STRING"},
    exercises:{type:"ARRAY",items:{type:"OBJECT",properties:{
      question:{type:"STRING"},hint:{type:"STRING"},formula:{type:"STRING"}
    },required:["question"]}}
  },required:["title","content"]}},
  corrections:{type:"ARRAY",items:{type:"OBJECT",properties:{
    exercise_number:{type:"NUMBER"},solution:{type:"STRING"},formula:{type:"STRING"}
  },required:["exercise_number","solution"]}}
},required:["title","introduction","sections","corrections"]};

function graphRequirements(j:any){
  const c=(String(j?.title||"")+" "+String(j?.prompt||"")+" "+String(j?.subject||"")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const required:string[]=[]; const add=(x:string)=>{if(!required.includes(x))required.push(x);};
  const param2d=/courbe parametree|trajectoire parametree|equations parametriques/.test(c);
  const param3d=/courbe parametree 3d|trajectoire spatiale|helice 3d|helice/.test(c);
  const math=/math|mathematique|algebre|geometr|calcul|fonction|courbe|derive|limite|integrale|trigonometrie/.test(c);
  if(param2d)add("parametric2d");
  if(param3d)add("parametric3d");
  if(/surface 3d|surface de|z\s*=/.test(c) && math)add("surface3d");
  if(/solide|cube|pyramide|prisme|tetraedre|sphere|cylindre|cone|geometrie dans l'espace|geometrie 3d/.test(c) && math)add("geometry3d");
  if(/conique|ellipse|parabole|hyperbole/.test(c))add("function2d");
  const explicitFunction=/fonction|derivee|derive|variations?|limite|tangente|integrale|trigonometrie|logarithme|exponentielle/.test(c);
  if(math && (explicitFunction || (!param2d&&!param3d&&/courbe/.test(c))))add("function2d");
  if(/graphique obligatoire|graphique|courbe experimentale|evolution graphique|representation graphique/.test(c) && /physique|chimie|svt|biologie|science/.test(c))add("function2d");
  return required;
}

function graphRequirementSatisfied(graphs:any[],required:string[]){
  const present=new Set<string>();
  for(const raw of Array.isArray(graphs)?graphs:[]){const g=normalizeGraphInstrument(raw);if(g?.instrument)present.add(g.instrument);}
  return {present:Array.from(present),missing:required.filter(x=>!present.has(x))};
}
function buildAuthorPrompt(j:any){
  const p=editorialProfile(j), graphReq=graphRequirements(j);
  return `Produis le support pédagogique complet d'Aurore en JSON strict, directement destiné aux élèves. Le document final DOIT contenir au moins ${MIN_WORDS} mots ; vise ${TARGET_MIN_WORDS} à ${TARGET_MAX_WORDS} mots sans remplissage artificiel. Vise 5 à 8 sections réellement développées : explications, exemples guidés, transitions, erreurs fréquentes et mise en relation des notions. Respecte les activités explicitement demandées et fournis un corrigé correspondant à chacune. Toute mathématique doit être en LaTeX. Le pipeline exige au moins ${MIN_VISUALS} illustrations Wikimedia utiles, chacune avec query et caption, maximum 3 par section et 8 au total. Les courbes/constructions restent dans sections[].graphs. GRAPHIQUES REQUIS : ${graphReq.length?graphReq.join(", "):"aucun instrument imposé"}. Tout instrument requis doit apparaître avec des paramètres valides. DEMANDE:${j.prompt||j.title} MATIERE:${j.subject||""} NIVEAU:${j.level||""} CLASSE:${j.class_name||""} TYPE:${j.document_type} PROFIL:${p.profile} MODE:${p.mode} CONSIGNES:${p.instruction} SCHEMA:${JSON.stringify(SCHEMA)}`;
}
async function callGeminiText(prompt:string,light=false){
  if(!GK)throw Error("GEMINI_API_KEY manquant");
  const model=light?String(GLM||"gemini-3.5-flash-lite"):String(GM||"gemini-3.8-flash");
  const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{
    method:"POST",
    headers:{"Content-Type":"application/json","x-goog-api-key":GK},
    body:JSON.stringify({
      contents:[{role:"user",parts:[{text:prompt}]}],
      generationConfig:{temperature:light?.12:.22,maxOutputTokens:light?8000:14000,responseMimeType:"application/json",responseSchema:light?GEMINI_LIGHT_SCHEMA:GEMINI_SCHEMA}
    })
  });
  const body:any=await r.json().catch(function(){return null;});
  if(!r.ok)throw Error(body?.error?.message||("Gemini HTTP "+r.status));
  const text=(body?.candidates?.[0]?.content?.parts||[]).map(function(p:any){return p?.text||"";}).join("\n").trim();
  if(!text)throw Error("Gemini réponse vide");
  return {text:text,model:body?.modelVersion||model};
}
async function gemini(j:any){
  const r=await callGeminiText(buildAuthorPrompt(j),false);
  const d=normalize(parse(r.text),j);
  if(!valid(d))throw Error("Gemini a renvoyé un manuscrit vide ou incomplet");
  d._provider={name:"gemini",model:r.model,status:"completed"};
  d._editorial={status:"completed",engine:r.model,provider:"gemini"};
  return d;
}
function fallbackFromPlainText(raw:string,j:any){
  const text=String(raw||"").trim();
  const cleanLine=(s:string)=>String(s||"")
    .replace(/\r/g,"")
    .replace(/^\s*[-*]\s+/,"")
    .replace(/^\s*#{1,6}\s*/,"")
    .replace(/\*\*/g,"")
    .replace(/\*([^*]+)\*/g,"$1")
    .trim();

  const lines=text.split("\n").map(cleanLine).filter(Boolean);
  const titleLine=lines.find(x=>/^(titre|title)\s*:/i.test(x));
  const title=String((titleLine||"").replace(/^(titre|title)\s*:\s*/i,"").trim()||j.title||"Ressource Aurore");
  let introduction="";
  const sections:any[]=[];
  const corrections:any[]=[];
  let current:any=null;
  let mode="content";
  let correctionCounter=0;

  const newSection=(name:string)=>{
    current={title:cleanLine(name)||"Section",objective:"",content:[],formula:"",graphs:[],visuals:[],exercises:[]};
    sections.push(current);
    mode="content";
  };

  for(const line of lines){
    if(/^(titre|title)\s*:/i.test(line)) continue;
    if(/^(introduction|présentation|presentation)\s*:?[\s]*$/i.test(line)){mode="intro";continue;}
    if(/^(exercices?|activités?|questions?)\s*:?[\s]*$/i.test(line)){if(!current)newSection("Cours");mode="exercise";continue;}
    if(/^(corrigés?|corriges?|solutions?)\s*:?[\s]*$/i.test(line)){mode="correction";continue;}

    const heading=line.match(/^(?:#{1,6}\s*)?(.+)$/);
    const sectionHeading=line.match(/^(?:section|chapitre|partie)\s+\d+\s*[:.)-]?\s*(.+)$/i);
    if(sectionHeading){newSection(sectionHeading[1]);continue;}
    if(/^#{1,6}\s+/.test(line) && !/^(?:#\s*intro|##\s*exerc)/i.test(line)){newSection(line.replace(/^#{1,6}\s*/,""));continue;}

    const numbered=line.match(/^\d+[.)-]\s*(.+)$/);
    if(mode==="exercise"&&numbered){
      if(!current)newSection("Cours");
      current.exercises.push({question:numbered[1],hint:"",formula:""});
      continue;
    }
    if(mode==="correction"&&numbered){
      correctionCounter++;
      corrections.push({exercise_number:correctionCounter,solution:numbered[1],formula:""});
      continue;
    }
    if(mode==="intro"){introduction+=(introduction?" ":"")+line;continue;}
    if(!current)newSection("Cours");
    if(mode==="correction"){
      correctionCounter++;
      corrections.push({exercise_number:correctionCounter,solution:line,formula:""});
    }else{
      current.content.push(line);
    }
  }

  if(!sections.length)newSection("Cours");
  if(!introduction) introduction=sections[0]?.content?.slice(0,2).join(" ")||"Support pédagogique généré par Aurore.";
  return normalize({title,introduction,learning_objectives:[],sections,corrections},j);
}
async function runLlamaText(model:string,prompt:string,maxTokens:number){
  if(!CFA||!CFT) throw Error("Cloudflare Llama indisponible");
  const endpoint="https://api.cloudflare.com/client/v4/accounts/"+CFA+"/ai/run/"+model;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),80000);
  try{
    const r=await fetch(endpoint,{
      method:"POST",
      headers:{Authorization:"Bearer "+CFT,"Content-Type":"application/json"},
      body:JSON.stringify({
        messages:[
          {role:"system",content:"Moteur de production autonome Aurore. Produis uniquement le contenu pédagogique demandé."},
          {role:"user",content:prompt}
        ],
        max_tokens:maxTokens,
        temperature:0.15
      }),
      signal:controller.signal
    });
    const p:any=await r.json().catch(()=>null);
    if(!r.ok) throw Error("Llama HTTP "+r.status+(p?.errors?.[0]?.message?": "+p.errors[0].message:""));
    const raw=String(p?.result?.response||"").trim();
    if(!raw) throw Error("Llama réponse vide");
    return raw;
  }catch(e){
    if(controller.signal.aborted) throw Error("Llama timeout après 80 s");
    throw e;
  }finally{
    clearTimeout(timeout);
  }
}

async function llamaFull(j:any){
  const p=editorialProfile(j), graphReq=graphRequirements(j);
  const prompt=[
    "Tu es le seul moteur IA de ce document Aurore. Aucun autre modèle ne complètera ton travail.",
    "Produis le document COMPLET. Le PDF final doit contenir au moins "+MIN_WORDS+" mots et viser "+TARGET_MIN_WORDS+" à "+TARGET_MAX_WORDS+" mots utiles.",
    "Développe réellement les notions, les exemples, les transitions et les erreurs fréquentes. Vise 5 à 8 sections substantielles.",
    "Utilise de préférence un JSON conforme au schéma fourni, sans markdown. Si le JSON échoue, produis un texte structuré avec Titre:, Introduction:, sections numérotées, Exercices: et Corrigés:.",
    "Toute mathématique doit être en LaTeX.",
    "Le pipeline ajoutera au moins "+MIN_VISUALS+" illustrations Wikimedia utiles.",
    graphReq.length?"GRAPHIQUES OBLIGATOIRES : "+graphReq.join(", ")+". Ils doivent être présents dans sections[].graphs avec des paramètres valides.":"Aucun instrument graphique spécifique n'est imposé.",
    "PROFIL : "+p.profile,
    "CONSIGNES : "+p.instruction,
    "DEMANDE : "+String(j.prompt||j.title||""),
    "MATIERE : "+String(j.subject||""),
    "NIVEAU : "+String(j.level||""),
    "CLASSE : "+String(j.class_name||""),
    "TYPE : "+String(j.document_type||""),
    "SCHEMA : "+JSON.stringify(SCHEMA)
  ].join("\n");
  let raw="",model=CFM;
  try{raw=await runLlamaText(CFM,prompt,9500);}catch(first){model=CFM_FALLBACK;raw=await runLlamaText(CFM_FALLBACK,prompt,9500);}
  let d:any; try{d=normalize(parse(raw),j);}catch{d=fallbackFromPlainText(raw,j);}
  if(!valid(d))d=fallbackFromPlainText(raw,j);
  if(!valid(d))throw Error("Llama a renvoyé un manuscrit vide ou incomplet");
  d._provider={name:"llama",model,status:"completed"};
  d._editorial={status:"completed",engine:model,provider:"llama"};
  return d;
}
function requestedActivityCount(j:any){
  const p=String(j?.prompt||"").toLowerCase();
  const q=p.match(/(?:ajoute|ajouter|présente|propose)[^\\n]{0,80}?(\\d+)\\s+questions?/i);
  const e=p.match(/(\\d+)\\s+exercices?/i);
  const questions=q?Number(q[1]):0;
  const exercises=e?Number(e[1]):0;
  return {questions,exercises,total:questions+exercises};
}
function parse(t:string){t=t.trim().replace(/^```json\s*/i,"").replace(/```$/i,"");try{return JSON.parse(t)}catch(first){try{return JSON.parse(jsonrepair(t))}catch{const a=t.indexOf("{"),b=t.lastIndexOf("}");if(a>=0&&b>a){try{return JSON.parse(jsonrepair(t.slice(a,b+1)))}catch{}}throw first}}}
function normalizeMathSegment(v:any){
  let s=String(v??"");
  s=s.replace(/\\\\+/g,"\\");
  s=s.replace(/∞/g,"\\infty").replace(/ℝ/g,"\\mathbb{R}").replace(/≈/g,"\\approx").replace(/≤/g,"\\le").replace(/≥/g,"\\ge").replace(/≠/g,"\\ne").replace(/∈/g,"\\in");
  s=s.replace(/\\infy\\b/g,"\\infty");
  s=s.replace(/\\mathrm\\{quad\\}/g,"\\quad");
  s=s.replace(/\\text\\{mathbb\\{R\\}\\}/g,"\\mathbb{R}");
  s=s.replace(/\\text\\{R\\}/g,"\\mathbb{R}");
  if((s.match(/\\left\\b/g)||[]).length!==(s.match(/\\right\\b/g)||[]).length){
    s=s.replace(/\\left\\b/g,"").replace(/\\right\\b/g,"");
  }
  s=s.replace(/\\^([A-Za-z0-9+\\-])/g,"^{$1}");
  s=s.replace(/_([A-Za-z0-9])/g,"_{$1}");
  return s;
}
function validateMathSegment(v:any){
  const s=String(v??"");
  const left=(s.match(/\\left\\b/g)||[]).length;
  const right=(s.match(/\\right\\b/g)||[]).length;
  if(left!==right)return false;
  let depth=0,escaped=false;
  for(const ch of s){
    if(ch==="{"&&!escaped)depth++;
    else if(ch==="}"&&!escaped){depth--;if(depth<0)return false}
    if(ch==="\\\\"&&!escaped)escaped=true; else escaped=false;
  }
  return depth===0;
}
function normalizeMathText(v:any){
  const s=String(v??"");
  const out:string[]=[];
  let text="",i=0;
  const flush=()=>{if(text){out.push(text);text=""}};
  const math=(raw:string)=>{const m=normalizeMathSegment(raw);out.push(validateMathSegment(m)?("$"+m+"$"):raw);};
  while(i<s.length){
    let open="",close="";
    if(s.startsWith("\\(",i)){open="\\(";close="\\)";}
    else if(s.startsWith("\\[",i)){open="\\[";close="\\]";}
    else if(s.startsWith("$$",i)){open="$$";close="$$";}
    else if(s[i]==="$"){open="$";close="$";}
    if(open){
      const j=s.indexOf(close,i+open.length);
      if(j>=0){flush();math(s.slice(i+open.length,j));i=j+close.length;continue}
    }
    text+=s[i++];
  }
  flush();
  return out.join("");
}
function normalize(d:any,j:any){d=d&&typeof d==='object'?d:{};d.title=String(d.title||j.title);d.introduction=normalizeMathText(d.introduction||"");d.learning_objectives=Array.isArray(d.learning_objectives)?d.learning_objectives.map(normalizeMathText):[];let formulaBudget=10;d.sections=Array.isArray(d.sections)?d.sections:[];const profileNow=editorialProfile(j).profile;
d.sections=d.sections.map((s:any)=>{const sf=s.formula&&formulaBudget>0?normalizeMathSegment(s.formula):"";if(sf)formulaBudget--;const rawGraphs=Array.isArray(s.graphs)?s.graphs:[];const rawVisuals=Array.isArray(s.visuals)?s.visuals:[];const normalizedVisuals=rawVisuals.map(normalizeVisualPlan).filter((v:any)=>!!v).slice(0,3);const normalizedGraphs=rawGraphs.map(normalizeGraphInstrument).filter((g:any)=>!!g);const keepGraphs=normalizedGraphs.length>0;return {title:String(s.title||"Section"),objective:normalizeMathText(s.objective||""),content:Array.isArray(s.content)?s.content.map(normalizeMathText):[],formula:sf,graphs:keepGraphs?normalizedGraphs:[],visuals:normalizedVisuals,exercises:Array.isArray(s.exercises)?s.exercises.map((q:any)=>{const f=q.formula&&formulaBudget>0?normalizeMathSegment(q.formula):"";if(f)formulaBudget--;return {question:normalizeMathText(q.question||""),hint:normalizeMathText(q.hint||""),formula:f}}):[]}});d.corrections=Array.isArray(d.corrections)?d.corrections.map((c:any,i:number)=>{const f=c.formula&&formulaBudget>0?normalizeMathSegment(c.formula):"";if(f)formulaBudget--;return {exercise_number:Number(c.exercise_number)||i+1,solution:normalizeMathText(c.solution||""),formula:f}}):[];d._factory={...(d._factory||{}),formula_render_budget:10,math_policy:"LaTeX obligatoire",math_normalizer:"deterministic-v4"};return d}
function count(d:any){const a=[d.introduction,...d.learning_objectives,...d.sections.flatMap((s:any)=>[s.title,s.objective,...s.content,...s.exercises.flatMap((q:any)=>[q.question,q.hint,q.formula])]),...d.corrections.flatMap((c:any)=>[c.solution,c.formula])];return a.join(" ").split(/\s+/).filter(Boolean).length}
function valid(d:any){return !!d&&typeof d==='object'&&String(d.title||'').trim().length>0&&String(d.introduction||'').trim().length>0&&Array.isArray(d.sections)&&d.sections.length>0&&d.sections.some((s:any)=>Array.isArray(s.content)&&s.content.some((x:any)=>String(x||'').trim().length>0))}

function qualityGate(j:any,d:any){
  const reasons:string[]=[], words=count(d), sections=Array.isArray(d?.sections)?d.sections.length:0;
  const activities=Array.isArray(d?.sections)?d.sections.reduce((n:number,s:any)=>n+(Array.isArray(s?.exercises)?s.exercises.length:0),0):0;
  const corrections=Array.isArray(d?.corrections)?d.corrections.length:0, mode=editorialProfile(j).mode;
  const minSections=/cours|fiche|revision/.test(mode)?5:3;
  const visuals=Array.isArray(d?.sections)?d.sections.flatMap((s:any)=>Array.isArray(s?.visuals)?s.visuals:[]):[];
  const usableVisuals=visuals.filter((v:any)=>String(v?.query||"").trim()&&String(v?.caption||"").trim()).length;
  const requiredGraphs=graphRequirements(j), graphState=graphRequirementSatisfied(Array.isArray(d?.sections)?d.sections.flatMap((s:any)=>Array.isArray(s?.graphs)?s.graphs:[]):[],requiredGraphs);
  const requested=requestedActivityCount(j), minActivities=requested.total>0?requested.total:(mode==="cours"?2:1);
  if(words<MIN_WORDS)reasons.push("manuscrit trop court ("+words+" mots, minimum "+MIN_WORDS+")");
  if(sections<minSections)reasons.push("structure trop courte ("+sections+" sections, minimum "+minSections+")");
  if(activities<minActivities)reasons.push("activités insuffisantes ("+activities+", minimum "+minActivities+")");
  if(corrections<activities)reasons.push("corrigés incomplets ("+corrections+" pour "+activities+" activités)");
  if(usableVisuals<MIN_VISUALS)reasons.push("illustrations insuffisantes ("+usableVisuals+", minimum "+MIN_VISUALS+")");
  if(graphState.missing.length)reasons.push("graphiques requis absents : "+graphState.missing.join(", "));
  const badCorrection=Array.isArray(d?.corrections)&&d.corrections.some((x:any)=>!String(x?.solution||"").trim()||!Number.isFinite(Number(x?.exercise_number)));
  if(badCorrection)reasons.push("corrigé invalide");
  return {ok:reasons.length===0,reasons,stats:{word_count:words,sections,activities,corrections,visuals:usableVisuals,min_visuals:MIN_VISUALS,required_graphs:requiredGraphs,present_graphs:graphState.present,missing_graphs:graphState.missing,requested}};
}
async function geminiRepair(j:any,d:any,gate:any){
  const req=graphRequirements(j);
  const prompt=`Révise entièrement ce manuscrit Aurore et retourne le DOCUMENT COMPLET. Minimum ${MIN_WORDS} mots, cible ${TARGET_MIN_WORDS}-${TARGET_MAX_WORDS}. Raisons : ${gate.reasons.join(" ; ")}. Développe les notions sans répétitions artificielles, restaure les activités et leurs corrigés, ajoute au moins ${MIN_VISUALS} illustrations Wikimedia pertinentes avec query et caption. GRAPHIQUES REQUIS : ${req.length?req.join(", "):"aucun"}. Tous les instruments requis doivent être présents et valides. Respecte le schéma JSON.\nDEMANDE:\n${j.prompt||j.title}\nMANUSCRIT:\n${JSON.stringify(d)}\nSCHEMA:\n${JSON.stringify(SCHEMA)}`;
  const r=await callGeminiText(prompt,false), x=normalize(parse(r.text),j);
  if(!valid(x))throw Error("Gemini correction : manuscrit vide ou incomplet");
  x._provider={name:"gemini",model:r.model,status:"completed"};
  x._editorial={status:"completed",engine:r.model,provider:"gemini"};
  return x;
}
async function llamaRepair(j:any,d:any,gate:any){
  const req=graphRequirements(j), p=editorialProfile(j);
  const prompt=[
    "Tu es le seul moteur IA de correction de ce document Aurore. Retourne le DOCUMENT COMPLET.",
    "Minimum "+MIN_WORDS+" mots ; cible "+TARGET_MIN_WORDS+"-"+TARGET_MAX_WORDS+" mots pédagogiques.",
    "Conserve le contenu correct mais développe explications, exemples, transitions et erreurs fréquentes.",
    "Le pipeline exige au moins "+MIN_VISUALS+" directives Wikimedia avec query et caption.",
    req.length?"Graphiques obligatoires : "+req.join(", ")+". Chaque instrument requis doit être présent et valide.":"Aucun instrument graphique imposé.",
    "Utilise de préférence le schéma JSON fourni ; sinon texte structuré avec Titre:, Introduction:, sections, Exercices: et Corrigés:.",
    "Profil : "+p.profile,
    "Consignes : "+p.instruction,
    "Raisons du rejet : "+gate.reasons.join(" ; "),
    "DEMANDE : "+String(j.prompt||j.title||""),
    "SCHEMA : "+JSON.stringify(SCHEMA),
    "MANUSCRIT : "+JSON.stringify(d)
  ].join("\n");
  let raw="",model=CFM;
  try{raw=await runLlamaText(CFM,prompt,10000);}catch(first){model=CFM_FALLBACK;raw=await runLlamaText(CFM_FALLBACK,prompt,10000);}
  let x:any; try{x=normalize(parse(raw),j);}catch{x=fallbackFromPlainText(raw,j);}
  if(!valid(x))throw Error("Llama correction : manuscrit vide ou incomplet");
  if(count(x)<MIN_WORDS)x=await llamaExpandUntilReady(j,x);
  x._provider={name:"llama",model,status:"completed"};
  x._editorial={status:"completed",engine:model,provider:"llama"};
  return x;
}
async function llamaExpansionPass(j:any,d:any,pass:number){
  const sections=(d.sections||[]).map((sec:any,i:number)=>({index:i,title:sec.title,content:(sec.content||[]).slice(-4)}));
  const prompt=[
    "Tu es le moteur Llama autonome d'Aurore. N'écris PAS un nouveau cours résumé.",
    "Ajoute du contenu pédagogique substantiel au manuscrit existant sans supprimer ce qui existe.",
    "Objectif de ce passage : ajouter environ 900 à 1300 mots, répartis sur les sections existantes.",
    "Pour chaque section, fournis 2 à 4 paragraphes nouveaux de 120 à 180 mots, non redondants, avec exemples guidés, explications, transitions, erreurs fréquentes ou interprétations utiles selon le sujet.",
    "Tu peux ajouter une nouvelle section seulement si elle est nécessaire pour assurer une progression de 5 à 8 sections.",
    "Ne réécris pas les exercices/corrigés existants ; enrichis le cours.",
    "Réponds uniquement en JSON : {\"additions\":[{\"section_index\":0,\"content\":[\"paragraphe\",\"paragraphe\"]}]}",
    "Passage "+pass+". Sujet : "+String(j.prompt||j.title||""),
    "Sections existantes : "+JSON.stringify(sections)
  ].join("\n");
  let raw="";
  try{raw=await runLlamaText(CFM,prompt,6500);}
  catch(first){raw=await runLlamaText(CFM_FALLBACK,prompt,6500);}
  let parsed:any;
  try{parsed=parse(raw);}catch{return d;}
  const adds=Array.isArray(parsed?.additions)?parsed.additions:[];
  for(const item of adds){
    const idx=Number(item?.section_index);
    if(!Number.isInteger(idx)||idx<0||idx>=d.sections.length)continue;
    const content=Array.isArray(item?.content)?item.content.map((x:any)=>normalizeMathText(x)).filter((x:string)=>x.trim()):[];
    d.sections[idx].content=[...(d.sections[idx].content||[]),...content];
  }
  return d;
}
async function llamaExpandUntilReady(j:any,d:any){
  let x=d;
  for(let pass=1;pass<=3 && count(x)<MIN_WORDS;pass++){
    x=await llamaExpansionPass(j,x,pass);
  }
  x._factory={...(x._factory||{}),llama_expansion:{passes:3,word_count:count(x),minimum:MIN_WORDS}};
  return x;
}
async function generateContent(j:any){const selected=aiSelection(j),providers:any={},warnings:string[]=[];let d:any=null;const order=aiMode(j)==="qcm"&&selected.includes("llama")?["llama",...selected.filter((x:string)=>x!=="llama")]:selected;for(const name of order){try{d=name==="gemini"?await gemini(j):name==="llama"?await llamaFull(j):await deepseek(j);providers[name]={status:"completed",model:d?._provider?.model||d?._editorial?.engine||name};break}catch(e){providers[name]={status:"failed",reason:String(e)};warnings.push(`${name}: ${String(e)}`);}}if(!d)throw Error("Aucun moteur IA sélectionné n'est disponible. "+warnings.join(" | "));d._factory={...(d._factory||{}),ai_selection:selected,ai_mode:aiMode(j),ai_providers:providers,provider_warnings:warnings};return d;}
function ensureGraphPlan(j:any,d:any){
  const required=graphRequirements(j);
  if(!required.length)return d;
  const sections=Array.isArray(d.sections)?d.sections:[];
  if(!sections.length)return d;
  const flat=()=>sections.flatMap((sec:any)=>Array.isArray(sec.graphs)?sec.graphs:[]);
  const present=()=>new Set(flat().map((g:any)=>normalizeGraphInstrument(g)?.instrument).filter(Boolean));
  const pi=Math.PI, safe=(g:any)=>normalizeGraphInstrument(g);
  const make=(instrument:string)=>{
    if(instrument==="parametric2d")return safe({instrument,title:"Exemple de courbe paramétrée plane",x_expression:"cos(t)",y_expression:"sin(t)",parameter:"t",t_min:0,t_max:2*pi,x_min:-1.5,x_max:1.5,y_min:-1.5,y_max:1.5,grid:true,axes:true,style:"geogebra"});
    if(instrument==="parametric3d")return safe({instrument,title:"Exemple de trajectoire paramétrée dans l'espace",x_expression:"cos(t)",y_expression:"sin(t)",z_expression:"t",parameter:"t",t_min:0,t_max:2*pi,x_min:-1.5,x_max:1.5,y_min:-1.5,y_max:1.5,z_min:0,z_max:2*pi,grid:true,axes:true,style:"geogebra"});
    if(instrument==="surface3d")return safe({instrument,title:"Exemple de surface : z=f(x,y)",expression:"x^2-y^2",x_min:-3,x_max:3,y_min:-3,y_max:3,z_min:-9,z_max:9,grid:true,axes:true,style:"geogebra"});
    if(instrument==="geometry3d")return safe({instrument,title:"Construction géométrique dans l'espace",objects:[
      {type:"cube",name:"Cube ABCDEFGH",points:["[0,0,0]","[2,0,0]","[2,2,0]","[0,2,0]","[0,0,2]","[2,0,2]","[2,2,2]","[0,2,2]"]}
    ],x_min:-1,x_max:3,y_min:-1,y_max:3,z_min:-1,z_max:3,grid:true,axes:true,style:"geogebra"});
    return safe({instrument:"function2d",title:"Exemple de courbe fonctionnelle",expression:"x^2",x_min:-3,x_max:3,y_min:-1,y_max:10,grid:true,axes:true,style:"geogebra"});
  };
  const seen=present();
  for(const inst of required){
    if(seen.has(inst))continue;
    const g=make(inst);
    if(!g)continue;
    const idx=Math.min(required.indexOf(inst),sections.length-1);
    sections[idx].graphs=Array.isArray(sections[idx].graphs)?sections[idx].graphs:[];
    sections[idx].graphs.push(g);
    seen.add(inst);
  }
  d._factory={...(d._factory||{}),graph_plan:{required,present:Array.from(seen),minimum_required:required.length}};
  return d;
}

function ensureVisualPlan(j:any,d:any){
  const profile=editorialProfile(j).profile, sections=Array.isArray(d.sections)?d.sections:[];
  const hints:any={biologie:"biology anatomy structure diagram",experimental:"science experiment apparatus phenomenon diagram",scientifique:"mathematics geometry educational diagram",langues:"language learning communication illustration",francais_litterature:"French literature historical cultural illustration",histoire_geographie:"historical geography map territory illustration",informatique:"computer science algorithm software diagram",technique:"technical engineering mechanism diagram",general:"educational explanatory diagram"};
  const suffixes=["labeled diagram","structure or process diagram","application or observation illustration"];
  const flat=()=>sections.flatMap((s:any)=>Array.isArray(s.visuals)?s.visuals:[]);
  for(const sec of sections)sec.visuals=Array.isArray(sec.visuals)?sec.visuals.map(normalizeVisualPlan).filter((v:any)=>!!v).slice(0,3):[];
  if(!sections.length){d.sections=[{title:String(j.title||"Notion principale"),objective:"",content:[],formula:"",graphs:[],visuals:[],exercises:[]}];sections.push(d.sections[0]);}
  let all=flat(),n=0;
  while(all.length<MIN_VISUALS&&n<12){
    const idx=Math.min(n,sections.length-1),sec=sections[idx];
    const title=String(sec?.title||j.title||"Notion").replace(/\s+/g," ").trim().slice(0,120);
    const content=Array.isArray(sec?.content)?String(sec.content.slice(0,2).join(" ")).replace(/\s+/g," ").trim().slice(0,120):"";
    const query=(title+" "+content+" "+(hints[profile]||hints.general)+" "+suffixes[n%suffixes.length]).trim().slice(0,240);
    const purpose=profile==="experimental"?"experimental":profile==="biologie"?"schema":"illustration";
    const caption=("Illustration documentaire liée à « "+title+" » pour clarifier la notion étudiée.").slice(0,280);
    const target=sections[idx];
    if((target.visuals||[]).length<3)target.visuals.push(normalizeVisualPlan({type:"wikimedia",purpose,query,required:true,priority:"required",caption}));
    all=flat();n++;
  }
  all=flat().filter((v:any)=>String(v?.query||"").trim()&&String(v?.caption||"").trim());
  for(let i=0;i<all.length;i++)if(i<MIN_VISUALS){all[i].required=true;all[i].priority="required";}
  for(const sec of sections)sec.visuals=(sec.visuals||[]).slice(0,3);
  d._factory={...(d._factory||{}),visual_plan:{planned:flat().length,usable:all.length,required:all.filter((v:any)=>v.required||v.priority==="required").length,minimum:MIN_VISUALS,profile,status:all.length>=MIN_VISUALS?"pass":"blocked"}};
  return d;
}
function html(d:any){const e=(v:any)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");return`<html><body><h1>${e(d.title)}</h1><p>${e(d.introduction)}</p>${d.sections.map((s:any,i:number)=>`<section><h2>${i+1}. ${e(s.title)}</h2>${s.content.map((p:string)=>`<p>${e(p)}</p>`).join("")}${s.formula?`<p>${e(s.formula)}</p>`:""}${s.exercises.map((q:any,n:number)=>`<div><b>Exercice ${n+1}</b><p>${e(q.question)}</p><p>${e(q.hint)}</p>${q.formula?`<p>Formule : ${e(q.formula)}</p>`:""}</div>`).join("")}</section>`).join("")}<section><h2>Corrigés détaillés</h2>${d.corrections.map((c:any)=>`<div><b>Exercice ${c.exercise_number}</b><p>${e(c.solution)}</p>${c.formula?`<p>Formule : ${e(c.formula)}</p>`:""}</div>`).join("")}</section></body></html>`}
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response('ok',{headers:H});if(req.method!=='POST')return out({error:'Méthode non autorisée'},405);const a=req.headers.get('Authorization');if(!a?.startsWith('Bearer '))return out({error:'Authentification requise'},401);const internal=a===`Bearer ${SR}`;let userId:string|null=null;if(!internal){const u=createClient(URL,ANON,{global:{headers:{Authorization:a}},auth:{autoRefreshToken:false,persistSession:false}});const me=await u.auth.getUser();if(me.error||!me.data.user)return out({error:'Session invalide'},401);userId=me.data.user.id;}let b:any;try{b=await req.json()}catch{return out({error:'JSON invalide'},400)}const requestedId=Number(b?.job_id||0);if(!internal&&(!Number.isSafeInteger(requestedId)||requestedId<1))return out({error:'job_id invalide'},400);if(requestedId&&(!Number.isSafeInteger(requestedId)||requestedId<1))return out({error:'job_id invalide'},400);if(requestedId&&!internal){const own=await db.from('aurora_content_jobs').select('id').eq('id',requestedId).eq('created_by',userId).maybeSingle();if(own.error||!own.data)return out({error:'Job introuvable'},404);}const cl=await db.rpc('aurora_claim_content_job',{p_job_id:requestedId||null});if(cl.error)return out({error:cl.error.message},500);if(!cl.data)return out({ok:true,internal,processed:false,status:'idle',message:'Aucun job de contenu disponible.'},200);const j=cl.data;try{
    let d=await generateContent(j);
    d=ensureVisualPlan(j,d);
    d=ensureGraphPlan(j,d);
    if(!valid(d))throw Error('QA contenu: manuscrit vide après traitement IA');
    let gate=qualityGate(j,d);
    if(!gate.ok){
      const provider=String(d?._provider?.name||"").toLowerCase();
      if(provider==="gemini")d=await geminiRepair(j,d,gate);
      else if(provider==="llama")d=await llamaRepair(j,d,gate);
      else throw Error("QA contenu bloquante : moteur IA inconnu.");
      d=ensureVisualPlan(j,d);
      d=ensureGraphPlan(j,d);
      gate=qualityGate(j,d);
      if(!gate.ok)throw Error("QA contenu bloquante après correction : "+gate.reasons.join(" | "));
    }
    d.qa={...gate.stats,warnings:[]};
    if(d.qa.exercises>3)d.qa.warnings.push('Plus de 3 exercices : regrouper les compétences en problèmes globaux');const themeColor=String(j?.instructions?.theme_color||'').trim();if(themeColor)d._aurore_design={...(d._aurore_design||{}),theme_color:themeColor,version:1};const payload={...d};const editorialStatus=d?._editorial?.status||'failed';const pdfEligible=editorialStatus==='completed';const ins=await db.from('aurora_generated_documents').insert({job_id:j.id,created_by:j.created_by,title:d.title||j.title,subject:j.subject,level:j.level,class_name:j.class_name,document_type:j.document_type,source_format:'html',source_content:html(d),content_json:payload,pdf_path:null,pdf_url:null,version:1,status:pdfEligible?'review':'draft',validation_notes:`Moteur IA autonome : ${d?._provider?.name||'unknown'} (${d?._provider?.model||'inconnu'}), sans dépendance à un autre modèle. ${d.qa.word_count} mots · ${d.qa.sections} sections · ${d.qa.exercises} exercices · ${d.qa.corrections} corrigés. ${pdfEligible?'':'PDF bloqué : édition Luna non terminée. '}Budget formules PDF: 10. Politique mathématique : LaTeX obligatoire. Visuels : plan Wikimedia validé, maximum 3 par section et 8 par document. Production serveur : le navigateur n'est pas requis après la mise en file.`,metadata:{pipeline:(d?._provider?.name||'unknown')+' -> deterministic normalization -> aurora-content-renderer-ggb',qa:d.qa,editorial:d._editorial||{},math_policy:'latex-required',aurore_design:d._aurore_design||{}}}).select().single();if(ins.error)throw Error(ins.error.message);await db.from('aurora_content_jobs').update({status:'review',generated_document_id:ins.data.id,error_message:null,updated_at:new Date().toISOString()}).eq('id',j.id);return out({ok:true,job_id:j.id,generated_document_id:ins.data.id,status:pdfEligible?'review':'draft',pipeline:(d?._provider?.name||'unknown')+' -> deterministic normalization -> renderer',qa:d.qa,content_validated:true,content_json_saved:true,pdf_eligible:pdfEligible,server_side:internal})}catch(e){const m=String(e);const attempts=Number(j?.metadata?.content_worker_failure_count||0)+1;const retry=attempts<=3;if(retry){await db.from('aurora_content_jobs').update({status:'queued',error_message:m,metadata:{...(j.metadata||{}),content_worker_failure_count:attempts,content_worker_last_error:m,content_worker_requeued_at:new Date().toISOString()},updated_at:new Date().toISOString()}).eq('id',j.id)}else{await db.rpc('aurora_finish_content_job',{p_job_id:j.id,p_status:'failed',p_error:m})}return out({ok:false,error:m,job_id:j.id,requeued:retry,failure_count:attempts},retry?503:500)}});