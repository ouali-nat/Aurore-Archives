import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{autoRefreshToken:false,persistSession:false}});
const SCHEMA_VERSION="aurora-editorial-1";
const MAX_BODY_BYTES=2500000;
const MAX_TEXT=2000000;
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, x-aurore-gpt-key, authorization","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");}
function text(v:unknown,max=500){return String(v??"").trim().slice(0,max);}
function nullable(v:unknown,max=500){const x=text(v,max);return x||null;}
function validColor(v:unknown){const x=text(v,32);return !x||/^#[0-9a-fA-F]{6}$/.test(x);}
function validateEditorialContent(content:any){
  if(!content||typeof content!=="object"||Array.isArray(content))throw new Error("content_json doit être un objet JSON.");
  if(typeof content.title!=="string"||!content.title.trim())throw new Error("content_json.title est obligatoire.");
  if(!Array.isArray(content.sections)||content.sections.length<1||content.sections.length>30)throw new Error("content_json.sections doit contenir de 1 à 30 sections.");
  let visuals=0,graphs=0;
  for(const s of content.sections){
    if(!s||typeof s!=="object"||!String(s.title||"").trim())throw new Error("Chaque section doit avoir un titre.");
    if(Array.isArray(s.visuals)){
      if(s.visuals.length>3)throw new Error("Maximum 3 visuels par section.");
      visuals+=s.visuals.length;
      for(const v of s.visuals)if(String(v?.type||"wikimedia").toLowerCase()!=="wikimedia")throw new Error("Les visuels documentaires doivent utiliser type=wikimedia.");
    }
    if(Array.isArray(s.graphs))graphs+=s.graphs.length;
  }
  if(visuals>8)throw new Error("Maximum 8 visuels documentaires par document.");
  if(graphs>24)throw new Error("Maximum 24 graphiques/constructions par document.");
  if(JSON.stringify(content).length>MAX_TEXT)throw new Error("content_json dépasse la taille maximale autorisée.");
  return {sections:content.sections.length,visuals,graphs,exercises:content.sections.reduce((n:number,s:any)=>n+(Array.isArray(s.exercises)?s.exercises.length:0),0),corrections:Array.isArray(content.corrections)?content.corrections.length:0};
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return reply({ok:false,error:"Méthode POST requise."},405);
  try{
    const contentLength=Number(req.headers.get("content-length")||0);
    if(contentLength>MAX_BODY_BYTES)return reply({ok:false,error:"Payload éditorial trop volumineux."},413);
    const rawKey=req.headers.get("x-aurore-gpt-key")||"";
    if(!rawKey)return reply({ok:false,error:"Clé éditoriale Aurore manquante."},401);
    const keyHash=await sha256(rawKey);
    const {data:keyRow,error:keyError}=await db.from("aurora_gpt_ingest_keys").select("id,active").eq("key_hash",keyHash).eq("active",true).maybeSingle();
    if(keyError||!keyRow)return reply({ok:false,error:"Clé éditoriale Aurore invalide."},401);
    let createdBy:string|null=null;
    const authHeader=req.headers.get("Authorization")||"";
    if(authHeader.startsWith("Bearer ")){
      const token=authHeader.slice(7).trim();if(!token)return reply({ok:false,error:"Jeton Authorization vide."},401);
      const {data:authData,error:authError}=await db.auth.getUser(token);if(authError||!authData.user)return reply({ok:false,error:"Session Authorization invalide."},401);
      createdBy=authData.user.id;
    }
    const payload=await req.json();
    const content=payload?.content_json;
    const counts=validateEditorialContent(content);
    const title=text(payload.title||content.title,300);if(!title)return reply({ok:false,error:"Le titre est obligatoire."},400);
    const themeColor=text(payload.theme_color||payload.classification?.theme_color,32);if(!validColor(themeColor))return reply({ok:false,error:"theme_color doit être une couleur hexadécimale #RRGGBB."},400);
    const ingestId=text(payload.ingest_id||crypto.randomUUID(),120);
    const subject=nullable(payload.subject||payload.classification?.matiere);
    const level=nullable(payload.level||payload.classification?.niveau);
    const className=nullable(payload.class_name||payload.classification?.classe);
    const documentType=nullable(payload.document_type,120)||"cours";
    const prompt=nullable(payload.prompt,4000);
    const classification=payload.classification&&typeof payload.classification==="object"?payload.classification:{};
    const contentHash=await sha256(JSON.stringify(content));
    const {data:result,error}=await db.rpc("aurora_ingest_editorial_document",{
      p_ingest_id:ingestId,p_created_by:createdBy,p_title:title,p_subject:subject,p_level:level,p_class_name:className,p_document_type:documentType,p_prompt:prompt,p_content_json:content,
      p_instructions:{origin:"gpt_editorial_ingest",producer:"ChatGPT",human_review_required:true,manual_publication_only:true,lualatex_requested:false,schema_version:SCHEMA_VERSION,category:nullable(classification.categorie,100)||"Documents",domaine:nullable(classification.domaine,200),formation:nullable(classification.formation,200),specialite:nullable(classification.specialite,200),annee:nullable(classification.annee,100),semestre:nullable(classification.semestre,100),filiere:nullable(classification.filiere,200),theme_color:themeColor||"#C85C0D"},
      p_metadata:{origin:"gpt_editorial_ingest",producer:"ChatGPT",schema_version:SCHEMA_VERSION,content_sha256:contentHash,human_review_required:true,manual_publication_only:true,source:"chatgpt_editor",counts},
      p_domaine:nullable(classification.domaine,200),p_formation:nullable(classification.formation,200),p_specialite:nullable(classification.specialite,200),p_annee:nullable(classification.annee,100),p_semestre:nullable(classification.semestre,100),p_filiere:nullable(classification.filiere,200),p_matiere:subject,p_theme_color:themeColor||"#C85C0D"
    });
    if(error)throw error;
    await db.from("aurora_gpt_ingest_keys").update({last_used_at:new Date().toISOString()}).eq("id",keyRow.id);
    const out=Array.isArray(result)?result[0]:result;
    if(!out?.ok)throw new Error("Le contrat d’ingestion éditoriale a refusé le document.");
    return reply({ok:true,duplicate:out.duplicate===true,generated_document_id:out.generated_document_id,job_id:out.job_id,status:out.status,version:out.version,schema_version:SCHEMA_VERSION,content_sha256:contentHash,message:out.duplicate?"Document éditorial déjà intégré : aucune duplication créée.":"Document éditorial reçu. Il est en contrôle administratif; le rendu PDF reste séparé."},out.duplicate?200:201);
  }catch(error){console.error("aurora-gpt-ingest:",error);return reply({ok:false,error:error instanceof Error?error.message:String(error)},500);}
});