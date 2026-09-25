import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")!,KEYS=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}"),ADMIN_KEY=KEYS.default,TOKEN=Deno.env.get("AURORA_LUALATEX_RENDER_TOKEN")!;
const db=createClient(URL,ADMIN_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-aurore-render-token","Access-Control-Allow-Methods":"POST,OPTIONS"};
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C});
 if(req.method!=="POST")return out({error:"Méthode non autorisée"},405);
 if(!TOKEN||req.headers.get("x-aurore-render-token")!==TOKEN)return out({error:"Authentification invalide"},401);
 let b:any;try{b=await req.json()}catch{return out({error:"JSON invalide"},400)}
 const id=Number(b?.document_id);if(!Number.isSafeInteger(id)||id<1)return out({error:"document_id invalide"},400);
 const progress=Math.max(0,Math.min(100,Number(b?.progress)||0)),stage=String(b?.stage||"").slice(0,160);
 const {data:doc,error}=await db.from("aurora_generated_documents").select("id,metadata,pdf_path,pdf_url").eq("id",id).maybeSingle();
 if(error)return out({error:error.message},500);
 if(!doc)return out({error:"Document introuvable"},404);
 const metadata=doc.metadata&&typeof doc.metadata==="object"?doc.metadata:{};
 if(metadata.lualatex_cancel_requested===true && progress<100)return out({ok:false,cancelled:true,document_id:id,error:"Génération annulée par l’administration."},409);
 const now=new Date().toISOString();
 const finalised=progress>=100;
 const metadataPatch:any={lualatex_status:finalised?"completed":"processing",production_status:finalised?"pdf_ready":"processing",lualatex_progress:progress,lualatex_stage:stage,lualatex_updated_at:now,lualatex_started_at:metadata.lualatex_started_at||now,production_status_updated_at:now};const externalPatch=b?.metadata_patch&&typeof b.metadata_patch==="object"?b.metadata_patch:{};
 if(finalised){metadataPatch.lualatex_completed_at=now;metadataPatch.lualatex_failed_at=null;metadataPatch.lualatex_last_error=null;metadataPatch.lualatex_requested=false;metadataPatch.lualatex_retry_at=null;}else metadataPatch.lualatex_completed_at=null;
 const mergedMetadata={...metadata,...metadataPatch,...externalPatch};
 const {error:ue}=await db.from("aurora_generated_documents").update({metadata:mergedMetadata,updated_at:now}).eq("id",id);
 if(ue)return out({error:ue.message},500);
 const attemptId=Number(mergedMetadata.production_attempt_id||0);
 let attemptHistoryUpdated=true,attemptHistoryError="";
 if(Number.isSafeInteger(attemptId)&&attemptId>0){
   const attemptPatch:any={status:finalised?"pdf_ready":"processing",metadata:{updated_by:"aurora-lualatex-progress",updated_at:now}};
   if(finalised){attemptPatch.finished_at=now;attemptPatch.pdf_path=(doc as any).pdf_path||null;attemptPatch.pdf_url=(doc as any).pdf_url||null;}
   const {error:ae}=await db.from("aurora_generated_document_production_attempts").update(attemptPatch).eq("id",attemptId);
   if(ae){attemptHistoryUpdated=false;attemptHistoryError=ae.message;console.error("Production attempt history update failed:",ae.message)}
 }
 return out({ok:true,document_id:id,progress,stage,started_at:metadataPatch.lualatex_started_at,completed_at:metadataPatch.lualatex_completed_at||null,production_status:metadataPatch.production_status,attempt_history_updated:attemptHistoryUpdated,...(attemptHistoryError?{attempt_history_error:attemptHistoryError}:{})});
});