import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")!,KEYS=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}"),ADMIN_KEY=KEYS.default,TOKEN=Deno.env.get("AURORA_LUALATEX_RENDER_TOKEN")!;
const db=createClient(URL,ADMIN_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-aurore-render-token","Access-Control-Allow-Methods":"POST,OPTIONS"};
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C});
 if(req.method!=="POST")return out({error:"Méthode non autorisée"},405);
 if(!TOKEN||req.headers.get("x-aurore-render-token")!==TOKEN)return out({error:"Authentification invalide"},401);
 let body:any;try{body=await req.json()}catch{return out({error:"JSON invalide"},400)}
 const id=Number(body?.document_id);if(!Number.isSafeInteger(id)||id<1)return out({error:"document_id invalide"},400);
 const failureReason=String(body?.error||"Échec du rendu LuaLaTeX").slice(0,1000);
 const {data:doc,error:de}=await db.from("aurora_generated_documents").select("id,status,metadata").eq("id",id).maybeSingle();
 if(de)return out({error:de.message},500);if(!doc)return out({error:"Document introuvable"},404);
 const metadata=doc.metadata&&typeof doc.metadata==="object"?doc.metadata:{};const now=new Date().toISOString();
 if(metadata.lualatex_cancel_requested===true){
   const nextMetadata={...metadata,lualatex_requested:false,lualatex_retry_at:null,lualatex_status:"cancelled",lualatex_last_error:null,lualatex_failed_at:null,lualatex_stage:"Génération annulée par l’administration",lualatex_cancelled_at:now,lualatex_cancel_requested:false,lualatex_progress:0,production_status:"cancelled",production_status_updated_at:now};
   const {error:ue}=await db.from("aurora_generated_documents").update({metadata:nextMetadata,updated_at:now}).eq("id",id);
   if(ue)return out({error:ue.message},500);
   const attemptId=Number(metadata.production_attempt_id||0);
   if(Number.isSafeInteger(attemptId)&&attemptId>0){await db.from("aurora_generated_document_production_attempts").update({status:"cancelled",finished_at:now,error_message:null,metadata:{cancel_requested_at:now,renderer_may_still_be_stopping:true},updated_at:now}).eq("id",attemptId);}
   return out({ok:true,document_id:id,action:"cancelled",failure_count:Number(metadata.lualatex_failure_count||0)});
 }
 const failureCount=Number(metadata.lualatex_failure_count||0)+1;
 const nextMetadata={...metadata,lualatex_failure_count:failureCount,lualatex_last_error:failureReason,lualatex_failed_at:now,lualatex_status:"failed",lualatex_requested:false,lualatex_retry_at:null,lualatex_progress:0,lualatex_stage:"Génération arrêtée après échec — régénération manuelle disponible",lualatex_engine:"github-actions-lualatex-v1",production_status:"failed",production_status_updated_at:now};
 const {error:ue}=await db.from("aurora_generated_documents").update({metadata:nextMetadata,updated_at:now}).eq("id",id);
 if(ue)return out({error:ue.message},500);
 const attemptId=Number(metadata.production_attempt_id||0);
 let attemptHistoryUpdated=true;
 let attemptHistoryError="";
 if(Number.isSafeInteger(attemptId)&&attemptId>0){
   const {error:attemptError}=await db.from("aurora_generated_document_production_attempts").update({status:"failed",finished_at:now,error_message:failureReason,metadata:{failure_recorded_at:now,failure_source:"aurora-lualatex-fail"},updated_at:now}).eq("id",attemptId);
   if(attemptError){
     // The document itself is already durably marked failed above. Do not turn
     // this secondary history-write problem into another HTTP 500.
     attemptHistoryUpdated=false;
     attemptHistoryError=attemptError.message;
     console.error("Production attempt history update failed:", attemptError.message);
   }
 }
 return out({
   ok:true,
   document_id:id,
   action:"failed",
   failure_count:failureCount,
   automatic_retry:false,
   admin_regeneration_available:true,
   attempt_history_updated:attemptHistoryUpdated,
   ...(attemptHistoryError?{attempt_history_error:attemptHistoryError}:{}),
 });
});