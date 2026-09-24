import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")!;
const LEGACY_SR=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"").trim();
let SECRET_KEY="";try{SECRET_KEY=String(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")?.default||"").trim();}catch(_){}
const SR=SECRET_KEY||LEGACY_SR;
let PUBLISHABLE="";try{PUBLISHABLE=String(JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}")?.default||"").trim();}catch(_){}
const ANON=String(Deno.env.get("SUPABASE_ANON_KEY")||"").trim();
const db=createClient(URL,SR,{auth:{autoRefreshToken:false,persistSession:false}});
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, authorization, apikey","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
const keyOk=(req:Request)=>{const k=req.headers.get("apikey")?.trim()||"";return !!k&&[PUBLISHABLE,ANON].filter(Boolean).includes(k);};
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C});
 if(req.method!=="POST")return json({ok:false,error:"Méthode non autorisée"},405);
 if(!keyOk(req))return json({ok:false,error:"Authentification interne invalide"},401);
 if(!SR)return json({ok:false,error:"Configuration serveur incomplète"},503);
 let body:any={};try{body=await req.json();}catch(_){}
 const jobId=Number(body?.job_id||0);
 if(jobId&&!Number.isSafeInteger(jobId))return json({ok:false,error:"job_id invalide"},400);
 let q=db.from("aurora_content_jobs").select("id,status,generated_document_id,updated_at").limit(1);
 if(jobId)q=q.eq("id",jobId);else q=q.is("generated_document_id",null).eq("status","queued").order("created_at",{ascending:true});
 const {data:job,error}=await q.maybeSingle();
 if(error)return json({ok:false,error:error.message},500);
 if(!job)return json({ok:true,dispatched:false,status:"idle",message:"Aucune demande de contenu en attente."});
 if(job.generated_document_id)return json({ok:true,ready_for_pdf:true,editorial_required:false,job_id:job.id,generated_document_id:job.generated_document_id,status:job.status,message:"Le contenu éditorial est déjà intégré."});
 if(job.status!=="queued")return json({ok:true,dispatched:false,job_id:job.id,status:job.status,message:"Le job est déjà pris en charge."});
 EdgeRuntime.waitUntil((async()=>{
   try{
     const r=await fetch(`${URL}/functions/v1/aurora-content-worker`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${SR}`},body:JSON.stringify({job_id:job.id})});
     const txt=await r.text();
     if(!r.ok)throw new Error(`content-worker HTTP ${r.status}: ${txt.slice(0,1000)}`);
     console.log("[aurora-content-auto-wake] worker dispatched",txt.slice(0,1200));
   }catch(e){console.error("[aurora-content-auto-wake] worker failed",e);}
 })());
 return json({ok:true,dispatched:true,job_id:job.id,status:job.status,message:"Demande transmise au moteur éditorial Aurore."});
});