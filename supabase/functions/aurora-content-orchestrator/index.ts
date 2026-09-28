import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});
const clean=(v,max=8000)=>String(v==null?"":v).trim().slice(0,max);
const URL=Deno.env.get("SUPABASE_URL")||"";
const ANON=Deno.env.get("SUPABASE_ANON_KEY")||"";
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const PROTOCOL="aurore-content-orchestrator-v1";
const EDITOR_ENGINE="ChatGPT";

async function auth(req){
  const h=req.headers.get("Authorization")||"";
  if(!h.startsWith("Bearer "))throw new Error("Session administrateur absente.");
  if(!URL||!ANON||!SERVICE_ROLE)throw new Error("Configuration Supabase interne absente.");
  const r=await fetch(URL+"/auth/v1/user",{headers:{Authorization:h,apikey:ANON}});
  if(!r.ok)throw new Error("Session Supabase invalide ou expirée.");
  const user=await r.json();
  const pr=await fetch(URL+"/rest/v1/Profils?id=eq."+encodeURIComponent(user.id)+"&select=role",{headers:{apikey:SERVICE_ROLE,Authorization:"Bearer "+SERVICE_ROLE}});
  if(!pr.ok)throw new Error("Vérification du rôle administrateur impossible.");
  const rows=await pr.json().catch(()=>[]);
  if(!rows[0]||String(rows[0].role||"").toLowerCase()!=="admin")throw new Error("Accès administrateur requis.");
  return user;
}

function buildBrief(action,task,context){
  const chapter=context.chapter&&typeof context.chapter==="object"?context.chapter:{},workflow=context.workflow&&typeof context.workflow==="object"?context.workflow:{};
  if(action==="discover_chapters")return ["Aurore — éditeur ChatGPT","Tâche : "+clean(task.id,80),"Classe : "+clean(task.class_name,200),"Matière : "+clean(task.subject,200),"","Propose 4 à 16 chapitres plausibles et distincts adaptés à la classe et à la matière.","Ne génère aucun PDF et ne lance aucun moteur de rendu.","Retourne uniquement le JSON {chapters:[{id,title,description,order}]}."].join("\n");
  if(action==="build_editorial_proposal")return ["Aurore — proposition éditoriale ChatGPT","Tâche : "+clean(task.id,80),"Classe : "+clean(task.class_name,200),"Matière : "+clean(task.subject,200),"Chapitre : "+clean(chapter.title,220),"","Prépare uniquement la proposition éditoriale.","Retourne uniquement le JSON avec title, document_type, description, objectives, content_plan, exercise_plan et tools.","Ne génère aucun PDF et ne lance aucun moteur de rendu."].join("\n");
  return ["Aurore — révision éditoriale ChatGPT","Tâche : "+clean(task.id,80),"Classe : "+clean(task.class_name,200),"Matière : "+clean(task.subject,200),"Chapitre : "+clean((workflow.selected_chapter||{}).title,220),"Demande : "+clean(workflow.revision_request,1200),"","Révise la proposition courante et retourne uniquement la proposition complète au même format JSON.","Ne génère aucun PDF et ne lance aucun moteur de rendu."].join("\n");
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{status:204,headers:CORS});
  if(req.method!=="POST")return reply({ok:false,error:"Méthode POST requise."},405);
  try{
    await auth(req);
    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action,80);
    const task=body?.task&&typeof body.task==="object"?body.task:{};
    const context=body?.context&&typeof body.context==="object"?body.context:{};
    if(!["discover_chapters","build_editorial_proposal","revise_editorial_proposal"].includes(action))return reply({ok:false,protocol:PROTOCOL,error:"Action inconnue."},400);
    if(!clean(task.class_name,200)||!clean(task.subject,200))return reply({ok:false,protocol:PROTOCOL,error:"class_name et subject sont obligatoires."},400);
    return reply({ok:true,protocol:PROTOCOL,task_id:body?.task_id||task.id||null,action,status:"awaiting_external_editor",editor:{provider:EDITOR_ENGINE,mode:"external_conversation",pdf_generation:false},result:{brief:buildBrief(action,task,context),requires_chatgpt_response:true},presentation:action==="discover_chapters"?{component:"chapter_import",selection:"single",title:"Importer les chapitres proposés par ChatGPT"}:{component:"editorial_proposal_import",actions:["edit","request_revision","reject","validate"],title:"Importer la proposition éditoriale ChatGPT"}});
  }catch(error){
    return reply({ok:false,protocol:PROTOCOL,status:"failed",error:clean(error instanceof Error?error.message:error,1600)},500);
  }
});
