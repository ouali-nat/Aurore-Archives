import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const C = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const out=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...C,"Content-Type":"application/json"}});

const clean=(v:unknown)=>String(v??"").replace(/[\u0000-\u001F]/g," ").replace(/\s+/g," ").trim();

function validWikimedia(content:any){
  if(!String(content?.imageUrl||"").startsWith("https://upload.wikimedia.org/")) return false;
  if(!String(content?.sourceUrl||"").startsWith("https://commons.wikimedia.org/")) return false;
  const lic=clean(content?.license);
  if(!lic || /fair use|non-commercial|noncommercial|no derivatives/i.test(lic)) return false;
  return true;
}

function buildContent(courseTitle:string,pageNumber:number,block:any){
  const type=clean(block?.type||"paragraph").toLowerCase();
  const content=block?.content&&typeof block.content==="object"?block.content:{};
  const section:any={title:"Bloc "+String(pageNumber),content:[],exercises:[],graphs:[]};
  if(type==="paragraph") section.content=[String(content.text||"")];
  else if(type==="point") section.content=[String(content.text||"")];
  else if(type==="exercise") section.exercises=[{id:String(block?.id||""),statement:String(content.statement||""),hint:String(content.hint||"")}];
  else if(type==="graphique") section.graphs=[content.json&&typeof content.json==="object"?content.json:{}];
  else if(type==="wikimedia-image") section.content=["Illustration Wikimedia"];
  else throw new Error("Type de bloc non pris en charge : "+type);
  return {
    title:courseTitle,
    document_type:"page_assistee",
    source_format:"structured",
    sections:[section],
    assisted_block:{id:String(block?.id||""),type,content}
  };
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:C});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Authentification requise"},401);
  const token=auth.slice(7).trim();
  const me=await admin.auth.getUser(token);
  if(me.error||!me.data.user)return out({ok:false,error:"Session invalide"},401);
  const userId=me.data.user.id;

  let body:any;
  try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400);}
  const courseId=clean(body?.course_id),blockId=clean(body?.block_id);
  const pageNumber=Number(body?.page_number||0);
  const block=body?.block&&typeof body.block==="object"?body.block:null;
  if(!courseId||!blockId||!Number.isInteger(pageNumber)||pageNumber<1||!block){
    return out({ok:false,error:"course_id, block_id, page_number et block sont requis"},400);
  }

  const course=await admin.from("aurora_assisted_courses").select("id,created_by,title,pages").eq("id",courseId).eq("created_by",userId).maybeSingle();
  if(course.error)return out({ok:false,error:course.error.message},500);
  if(!course.data)return out({ok:false,error:"Cours d’édition introuvable ou accès refusé"},404);

  const type=clean(block.type||"paragraph").toLowerCase();
  const content=block.content&&typeof block.content==="object"?block.content:{};
  if(type==="paragraph"&&!clean(content.text))return out({ok:false,error:"Le paragraphe est vide."},400);
  if(type==="point"&&!clean(content.text))return out({ok:false,error:"Le contenu du point est vide."},400);
  if(type==="exercise"&&!clean(content.statement))return out({ok:false,error:"L’énoncé est vide."},400);
  if(type==="graphique"){
    const g=content.json;
    if(!g||typeof g!=="object"||Array.isArray(g))return out({ok:false,error:"Le JSON du graphique doit être un objet."},400);
    if(!clean(g.id)||!clean(g.instrument||g.graph_type))return out({ok:false,error:"Le graphique doit avoir un id unique et instrument/graph_type."},400);
    if(!clean(g.geogebra_image_path||g.graph_local_path))return out({ok:false,error:"Graphique validé, mais l’asset GeoGebra n’est pas encore disponible. Le JSON reste conservé."},409);
  }
  if(type==="wikimedia-image"&&!validWikimedia(content))return out({ok:false,error:"Image Wikimedia invalide ou licence non compatible."},400);

  const now=new Date().toISOString();
  const insertedJob=await admin.from("aurora_content_jobs").insert({
    created_by:userId,status:"queued",title:course.data.title||"Cours",subject:null,level:null,class_name:null,
    document_type:"page_assistee",source_format:"structured",prompt:"Édition assistée — rendu d’une page indépendante.",
    instructions:{assisted_page:true,classification:{category:"Édition assistée",resource_type:"cours"}},
    source_document_ids:[],metadata:{origin:"edition_assistee",assisted_page:{course_id:courseId,block_id:blockId,page_number:pageNumber,block_type:type}},
    created_at:now,updated_at:now
  }).select("id").single();
  if(insertedJob.error)return out({ok:false,error:"Création du job de rendu impossible : "+insertedJob.error.message},500);

  const jobId=Number(insertedJob.data.id);
  let contentJson:any;
  try{contentJson=buildContent(String(course.data.title||body.course_title||"Cours"),pageNumber,block);}
  catch(e){return out({ok:false,error:e instanceof Error?e.message:String(e)},400);}

  const metadata={
    origin:"edition_assistee",
    pipeline:"Édition assistée -> LuaLaTeX production",
    assisted_page:{course_id:courseId,block_id:blockId,page_number:pageNumber,block_type:type}
  };
  const insertedDoc=await admin.from("aurora_generated_documents").insert({
    job_id:jobId,created_by:userId,title:(course.data.title||"Cours")+" — Page "+String(pageNumber),
    subject:null,level:null,class_name:null,document_type:"page_assistee",source_format:"structured",source_content:null,
    content_json:contentJson,version:1,status:"generated",validation_notes:"Édition assistée — page indépendante.",
    metadata,theme_color:null,matiere:null
  }).select("id,status,metadata").single();
  if(insertedDoc.error)return out({ok:false,error:"Création du document de rendu impossible : "+insertedDoc.error.message},500);

  const generatedDocumentId=Number(insertedDoc.data.id);
  const queued=await fetch(URL_+"/functions/v1/aurora-lualatex-request",{
    method:"POST",
    headers:{"Authorization":"Bearer "+SERVICE,"Content-Type":"application/json","apikey":ANON,"X-Aurore-User-Authorization":auth},
    body:JSON.stringify({generated_document_id:generatedDocumentId})
  });
  let q:any={};
  try{q=await queued.json()}catch{q={error:"Réponse de mise en file invalide"}}
  if(!queued.ok||!q.ok){
    await admin.from("aurora_generated_documents").update({metadata:{...metadata,lualatex_status:"failed",lualatex_last_error:String(q?.error||"Mise en file LuaLaTeX impossible")},updated_at:new Date().toISOString()}).eq("id",generatedDocumentId);
    return out({ok:false,error:q?.error||("Mise en file HTTP "+queued.status),generated_document_id:generatedDocumentId},500);
  }

  return out({ok:true,mode:"lualatex-production",engine:"github-actions-lualatex-v1",generated_document_id:generatedDocumentId,job_id:jobId,page_number:pageNumber,status:"queued",queue_position:q.queue_position??null,queue_total:q.queue_total??null});
});