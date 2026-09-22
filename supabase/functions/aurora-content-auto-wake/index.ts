import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS_RAW=Deno.env.get("SUPABASE_SECRET_KEYS")||"";
let SECRET_KEY="";try{SECRET_KEY=String(JSON.parse(SECRET_KEYS_RAW||"{}")?.default||"").trim();}catch(_){}
const LEGACY_SR=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"").trim();
const SR=SECRET_KEY||LEGACY_SR;
const db=createClient(URL,SR,{auth:{autoRefreshToken:false,persistSession:false}});
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, authorization, apikey","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:C});
  if(req.method!=="POST")return json({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!SR||auth!==("Bearer "+SR))return json({ok:false,error:"Accès interne requis"},401);
  let body:any={};try{body=await req.json();}catch(_){}
  const jobId=Number(body?.job_id||0);
  if(jobId&&!Number.isSafeInteger(jobId))return json({ok:false,error:"job_id invalide"},400);
  let query=db.from("aurora_content_jobs").select("id,status,generated_document_id,updated_at").limit(1);
  if(jobId)query=query.eq("id",jobId);else query=query.is("generated_document_id",null).in("status",["queued","processing"]).order("created_at",{ascending:true});
  const {data:job,error}=await query.maybeSingle();
  if(error)return json({ok:false,error:error.message},500);
  if(!job)return json({ok:true,editorial_required:false,processed:false,status:"idle",message:"Aucune demande éditoriale en attente."});
  if(job.generated_document_id)return json({ok:true,editorial_required:false,ready_for_pdf:true,job_id:job.id,generated_document_id:job.generated_document_id,status:job.status,message:"Le contenu éditorial est déjà intégré. Le rendu PDF peut être lancé séparément."});
  return json({ok:true,editorial_required:true,ready_for_pdf:false,job_id:job.id,status:job.status,message:"La demande est enregistrée et attend l’éditeur ChatGPT. Aucun moteur de contenu automatique n’est lancé."});
});