import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{autoRefreshToken:false,persistSession:false}});
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, x-aurore-gpt-key, authorization","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const MEMORY_SCHEMA="aurora-editorial-memory-1";

const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});

async function sha256(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
}

function text(v:unknown,max=500){return String(v??"").trim().slice(0,max);}
function normalizedSubject(v:unknown){return text(v,200).toLowerCase().replace(/\s+/g," ");}

async function authenticate(req:Request){
  const rawKey=req.headers.get("x-aurore-gpt-key")||"";
  if(!rawKey)throw new Error("Clé éditoriale Aurore manquante.");
  const keyHash=await sha256(rawKey);
  const {data,error}=await db.from("aurora_gpt_ingest_keys").select("id,active").eq("key_hash",keyHash).eq("active",true).maybeSingle();
  if(error||!data)throw new Error("Clé éditoriale Aurore invalide.");
  return data.id;
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return reply({ok:false,error:"Méthode POST requise."},405);

  let keyId:number;
  try{
    keyId=await authenticate(req);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return reply({ok:false,error:message},401);
  }

  try{
    const payload=await req.json();
    const subject=text(payload?.subject||payload?.classification?.matiere,200);
    const documentType=text(payload?.document_type,120)||"cours";
    if(!subject)return reply({ok:false,error:"La matière est obligatoire pour récupérer le contrat éditorial."},400);

    const mathRequired=normalizedSubject(subject).includes("math");

    const {data:general,error:generalError}=await db.from("aurora_editorial_memory")
      .select("id,rule_key,version,title,priority,mandatory,content")
      .eq("active",true).order("priority",{ascending:false});
    if(generalError)throw generalError;
    if(!general?.length)return reply({ok:false,error:"Aucune mémoire éditoriale générale active n’est disponible."},503);

    let math:any[]=[];
    if(mathRequired){
      const {data:mathData,error:mathError}=await db.from("aurora_math_editorial_memory")
        .select("id,rule_key,version,title,priority,mandatory,content")
        .eq("active",true).order("priority",{ascending:false});
      if(mathError)throw mathError;
      math=mathData||[];
      if(!math.length)return reply({ok:false,error:"La mémoire Mathématiques est requise mais indisponible."},503);
    }

    const token=crypto.randomUUID();
    const tokenHash=await sha256(token);
    const generalIds=general.map((x:any)=>Number(x.id));
    const mathIds=math.map((x:any)=>Number(x.id));
    const generalVersion=Math.max(...general.map((x:any)=>Number(x.version)||0),0);
    const mathVersion=math.length?Math.max(...math.map((x:any)=>Number(x.version)||0),0):null;
    const bundle={schema:MEMORY_SCHEMA,subject,document_type:documentType,general,math:mathRequired?math:[]};
    const bundleHash=await sha256(JSON.stringify(bundle));
    const expiresAt=new Date(Date.now()+30*60*1000).toISOString();

    const {data:session,error:sessionError}=await db.from("aurora_editorial_memory_sessions").insert({
      token_hash:tokenHash,
      requested_subject:subject,
      requested_document_type:documentType,
      requires_math:mathRequired,
      general_rule_ids:generalIds,
      math_rule_ids:mathIds,
      general_memory_version:generalVersion||null,
      math_memory_version:mathVersion,
      bundle_sha256:bundleHash,
      consumer:"aurore-assistant",
      expires_at:expiresAt,
      metadata:{memory_schema:MEMORY_SCHEMA,key_id:keyId}
    }).select("session_id,retrieved_at,expires_at").single();
    if(sessionError||!session)throw sessionError||new Error("Impossible d’ouvrir la session mémoire.");

    await db.from("aurora_gpt_ingest_keys").update({last_used_at:new Date().toISOString()}).eq("id",keyId);

    return reply({
      ok:true,
      memory_schema:MEMORY_SCHEMA,
      session_id:session.session_id,
      memory_session_token:token,
      requested_subject:subject,
      requested_document_type:documentType,
      requires_math:mathRequired,
      retrieved_at:session.retrieved_at,
      expires_at:session.expires_at,
      general_memory_version:generalVersion,
      math_memory_version:mathVersion,
      bundle_sha256:bundleHash,
      general_memory:general,
      math_memory:mathRequired?math:[]
    });
  }catch(error){
    console.error("aurora-editorial-memory:",error);
    const message=error instanceof Error?error.message:String(error);
    return reply({ok:false,error:message},500);
  }
});