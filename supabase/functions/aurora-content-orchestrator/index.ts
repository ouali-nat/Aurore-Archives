import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});
const clean=(v,max=8000)=>String(v==null?"":v).trim().slice(0,max);
const URL=Deno.env.get("SUPABASE_URL")||"";
const ANON=Deno.env.get("SUPABASE_ANON_KEY")||"";
const PROTOCOL="aurore-content-orchestrator-v1";
const MODEL="deepseek-flash";

async function auth(req){
  const h=req.headers.get("Authorization")||"";
  if(!h.startsWith("Bearer "))throw new Error("Session administrateur absente.");
  if(!URL||!ANON)throw new Error("Configuration Supabase interne absente.");
  const r=await fetch(URL+"/auth/v1/user",{headers:{Authorization:h,apikey:ANON}});
  if(!r.ok)throw new Error("Session Supabase invalide ou expirée.");
}

function buildPrompt(action,b){
  const task=b&&typeof b.task==="object"?b.task:{};
  const context=b&&typeof b.context==="object"?b.context:{};
  const example=action==="discover_chapters"
    ?"{"chapters":[{"id":"chapitre-1","title":"Titre","description":"Description","order":1}]}"
    :"{"title":"Titre","document_type":"cours","description":"Description","objectives":["Objectif"],"content_plan":["Partie 1"],"exercise_plan":{"count":8,"correction":true},"tools":{"latex":true,"geogebra":false}}";
  let p="Tu es Aurore, une assistante générale utilisée sur plusieurs sites. Tu n'es pas une professeure de mathématiques par défaut.\n";
  p+="La classe et la matière sont des données directrices : ne les remplace jamais par une autre discipline.\n";
  p+="Tu es ici un éditeur pédagogique et organisateur de production. Tu prépares une ressource avant sa rédaction complète et avant son PDF.\n";
  p+="Les réponses sont des PROPOSITIONS soumises à validation humaine. Ne génère pas de PDF, ne lance aucun outil graphique, ne révèle jamais ta chaîne de pensée privée.\n";
  p+="Retourne UNIQUEMENT un objet JSON valide. N'invente pas de caractère officiel à un programme scolaire sans source fournie.\n";
  p+="PROTOCOLE: "+PROTOCOL+"\nACTION: "+action+"\nTÂCHE:\n"+JSON.stringify(task)+"\nCONTEXTE:\n"+JSON.stringify(context)+"\nJSON ATTENDU:\n"+example+"\n";
  if(action==="discover_chapters")p+="Propose 4 à 16 chapitres plausibles et distincts adaptés à la classe et à la matière. Indique qu'il s'agit de propositions à valider.";
  if(action==="build_editorial_proposal")p+="Transforme la classe, la matière et le chapitre choisi en brief éditorial précis. Ne rédige pas le cours complet. Donne titre, type, description, objectifs, plan, exercices et outils réellement utiles.";
  if(action==="revise_editorial_proposal")p+="Révise la proposition courante selon la demande de l'administrateur et retourne la proposition complète révisée.";
  return p;
}

async function callAI(prompt){
  const key=clean(Deno.env.get("DEEPSEEK_API_KEY"),10000);
  if(!key)throw new Error("DEEPSEEK_API_KEY absente des secrets Supabase.");
  const r=await fetch("https://api.deepseek.com/chat/completions",{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},
    body:JSON.stringify({
      model:MODEL,
      messages:[{role:"system",content:prompt},{role:"user",content:"Produis maintenant le JSON demandé, sans commentaire hors JSON."}],
      thinking:{type:"disabled"},reasoning_effort:"none",temperature:0.2,max_tokens:3000,
      response_format:{type:"json_object"},stream:false
    })
  });
  const raw=await r.text();
  if(!r.ok)throw new Error("DeepSeek HTTP "+r.status+": "+raw.slice(0,900));
  let data;try{data=JSON.parse(raw)}catch(_){throw new Error("Réponse DeepSeek illisible.");}
  const text=String(data&&data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content||"").trim();
  if(!text)throw new Error("DeepSeek a retourné un JSON vide.");
  let result;try{result=JSON.parse(text)}catch(_){throw new Error("La sortie JSON de l'éditeur est invalide.");}
  return {result,model:String(data.model||MODEL),usage:data.usage||{},finish_reason:data.choices&&data.choices[0]&&data.choices[0].finish_reason||null};
}

function validate(action,r){
  if(!r||typeof r!=="object"||Array.isArray(r))throw new Error("Résultat éditorial invalide.");
  if(action==="discover_chapters"){
    if(!Array.isArray(r.chapters)||r.chapters.length<1||r.chapters.length>16)throw new Error("La liste des chapitres est invalide.");
    r.chapters=r.chapters.slice(0,16).map(function(x,i){
      let id=clean(x&&x.id,100).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"chapitre-"+(i+1);
      return {id:id,title:clean(x&&x.title,220)||"Chapitre "+(i+1),description:clean(x&&x.description,500),order:Number.isFinite(Number(x&&x.order))?Number(x.order):i+1};
    });
    return;
  }
  ["title","description"].forEach(function(k){if(!clean(r[k],700))throw new Error("Champ éditorial manquant : "+k+".")});
  if(!Array.isArray(r.objectives)||!r.objectives.length)throw new Error("Les objectifs éditoriaux sont obligatoires.");
  if(!Array.isArray(r.content_plan)||!r.content_plan.length)throw new Error("Le plan de contenu est obligatoire.");
  r.objectives=r.objectives.slice(0,12).map(x=>clean(x,400)).filter(Boolean);
  r.content_plan=r.content_plan.slice(0,20).map(x=>clean(x,400)).filter(Boolean);
  const ep=r.exercise_plan&&typeof r.exercise_plan==="object"?r.exercise_plan:{};
  r.exercise_plan={count:Math.max(0,Math.min(30,Number(ep.count)||0)),correction:ep.correction!==false};
  const t=r.tools&&typeof r.tools==="object"?r.tools:{};
  r.tools={latex:t.latex===true,geogebra:t.geogebra===true};
}

Deno.serve(async function(req){
  if(req.method==="OPTIONS")return new Response("ok",{status:204,headers:CORS});
  if(req.method!=="POST")return reply({ok:false,error:"Méthode POST requise."},405);
  try{
    await auth(req);
    const b=await req.json().catch(()=>({}));
    const action=clean(b.action,80);
    if(["discover_chapters","build_editorial_proposal","revise_editorial_proposal"].indexOf(action)<0)return reply({ok:false,error:"Action inconnue."},400);
    const task=b.task&&typeof b.task==="object"?b.task:{};
    if(!clean(task.class_name,200)||!clean(task.subject,200))return reply({ok:false,error:"class_name et subject sont obligatoires."},400);
    if(action!=="discover_chapters"&&!(task.chapter&&typeof task.chapter==="object"))return reply({ok:false,error:"Le chapitre choisi est obligatoire."},400);
    const started=Date.now();
    const out=await callAI(buildPrompt(action,b));
    validate(action,out.result);
    return reply({
      ok:true,protocol:PROTOCOL,task_id:b.task_id||null,action:action,status:"completed",result:out.result,
      presentation:action==="discover_chapters"
        ?{component:"chapter_selector",selection:"single",title:"Chapitres proposés à valider"}
        :{component:"editorial_proposal",actions:["edit","request_revision","reject","validate"],title:"Proposition éditoriale à valider"},
      provenance:{provider:"deepseek",model:out.model,usage:out.usage,finish_reason:out.finish_reason,generated_at:new Date().toISOString(),elapsed_ms:Date.now()-started}
    });
  }catch(e){
    const msg=clean(e instanceof Error?e.message:e,1600);
    const m=msg.match(/HTTP (\d{3})/);const code=m?Number(m[1]):500;
    return reply({ok:false,protocol:PROTOCOL,error:msg,status:"failed"},code>=400&&code<500?code:500);
  }
});