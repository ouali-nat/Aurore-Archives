import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RENDER_TOKEN = Deno.env.get("AURORA_LUALATEX_RENDER_TOKEN") || "";
const GEO_GEBRA_RENDERER_VERSION = 5;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-aurore-render-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function decodeBase64(v: string) {
  const s = String(v || "").replace(/^data:image\/png;base64,/i, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length < 100) throw new Error("Image GeoGebra invalide");
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const GRAPH_INSTRUMENTS = new Set(["function2d","complex_plane","parametric2d","parametric3d","surface3d","geometry2d","geometry3d"]);
function detectGraphInstrument(g: any) {
  const x = g && typeof g === "object" ? g : {};
  const aliases: Record<string,string> = { function:"function2d", graph:"function2d", courbe:"function2d", parametric:"parametric2d", parametric2d:"parametric2d", parametric3d:"parametric3d", surface:"surface3d", surface3d:"surface3d", geometry3d:"geometry3d", geometrie3d:"geometry3d", "3d":"geometry3d" };
  const raw = String(x.instrument || x.graph_type || "").toLowerCase().trim(), normalized = aliases[raw] || raw;
  const objects = Array.isArray(x.objects) ? x.objects : [];
  const points2 = Array.isArray(x.points) && x.points.some((p:any)=>Array.isArray(p)&&p.length===2);
  const points3 = Array.isArray(x.points) && x.points.some((p:any)=>Array.isArray(p)&&p.length>=3);
  const poi3 = Array.isArray(x.points_of_interest) && x.points_of_interest.some((p:any)=>Number.isFinite(Number(p?.z)));
  const hasObjects = objects.some((o:any)=>o && typeof o==="object" && ["point","vector","line","plane","sphere","cylinder","cone","polygon","cube","prism","pyramid","tetrahedron"].includes(String(o?.type||"").toLowerCase()));
  const hasExpression = String(x.expression || "").trim(), hasX = String(x.x_expression || "").trim(), hasY = String(x.y_expression || "").trim(), hasZ = String(x.z_expression || "").trim();
  const valid: Record<string,()=>boolean> = {
    function2d:()=>!!hasExpression || points2 || (Array.isArray(x.asymptotes)&&x.asymptotes.length>0),
    complex_plane:()=>points2 || !!hasExpression,
    geometry2d:()=>hasObjects || points2,
    parametric2d:()=>!!hasX&&!!hasY,
    parametric3d:()=>!!hasX&&!!hasY&&!!hasZ,
    surface3d:()=>!!hasExpression,
    geometry3d:()=>hasObjects||points3||poi3
  };
  if(normalized && valid[normalized]?.()) return normalized;
  if(raw) return null;
  if(objects.length && hasObjects) return "geometry3d";
  if(hasZ&&hasX&&hasY) return "parametric3d";
  if(hasX&&hasY) return points3||poi3 ? "parametric3d" : "parametric2d";
  if(hasExpression) return String(x.z_label||"").trim()||points3||poi3 ? "surface3d" : "function2d";
  if(points3||poi3) return "geometry3d";
  if(points2||(Array.isArray(x.asymptotes)&&x.asymptotes.length)) return "function2d";
  return null;
}
function geogebraImageReady(g:any) {
  const path=String(g?.geogebra_image_path||"").trim(), source=String(g?.geogebra_image_source||"").toLowerCase();
  if(!path||source!=="geogebra") return false;
  const instrument=detectGraphInstrument(g); if(!instrument||!GRAPH_INSTRUMENTS.has(instrument)) return false;
  const objects=Array.isArray(g?.objects)?g.objects:[], solid=objects.some((o:any)=>["sphere","cylinder","cone","cube","prism","pyramid","tetrahedron"].includes(String(o?.type||"").toLowerCase()));
  if(Number(g?.geogebra_renderer_version||0)<GEO_GEBRA_RENDERER_VERSION) return false;
  return true;
}
function graphEntries(content:any) {
  const out:any[]=[]; let i=0;
  const push=(g:any,owner:any)=>{out.push({graph_index:i,graph:g,owner});i++;};
  for(const [sectionIndex,s] of (Array.isArray(content?.sections)?content.sections:[]).entries()){
    for(const g of Array.isArray(s?.graphs)?s.graphs:[]) push(g,{kind:"section",sectionIndex});
    for(const [exerciseIndex,e] of (Array.isArray(s?.exercises)?s.exercises:[]).entries()){
      for(const g of Array.isArray(e?.statement_graphs)?e.statement_graphs:[]) push(g,{kind:"statement",sectionIndex,exerciseIndex});
      for(const g of Array.isArray(e?.correction_graphs)?e.correction_graphs:[]) push(g,{kind:"correction",sectionIndex,exerciseIndex});
    }
  }
  for(const [correctionIndex,corr] of (Array.isArray(content?.corrections)?content.corrections:[]).entries()){
    for(const g of Array.isArray(corr?.graphs)?corr.graphs:[]) push(g,{kind:"top_correction",correctionIndex});
  }
  return out;
}
function graphList(content:any) {
  return graphEntries(content).filter((entry:any)=>!geogebraImageReady(entry.graph)).map((entry:any)=>{
    const g=entry.graph, instrument=detectGraphInstrument(g);
    return instrument ? {graph_index:entry.graph_index,instrument,title:String(g?.title||"Graphique"),expression:String(g?.expression||""),x_expression:String(g?.x_expression||""),y_expression:String(g?.y_expression||""),z_expression:String(g?.z_expression||""),parameter:String(g?.parameter||"t"),t_min:Number(g?.t_min),t_max:Number(g?.t_max),x_min:Number(g?.x_min),x_max:Number(g?.x_max),y_min:Number(g?.y_min),y_max:Number(g?.y_max),z_min:Number(g?.z_min),z_max:Number(g?.z_max),z_label:String(g?.z_label||""),asymptotes:Array.isArray(g?.asymptotes)?g.asymptotes:[],points:Array.isArray(g?.points)?g.points:[],points_of_interest:Array.isArray(g?.points_of_interest)?g.points_of_interest:[],objects:Array.isArray(g?.objects)?g.objects:[]} : null;
  }).filter(Boolean);
}
function setGraphImage(content:any,index:number,path:string) {
  const c=structuredClone(content||{});
  const entry=graphEntries(c).find((item:any)=>item.graph_index===index);
  if(!entry) throw new Error("Graphique #"+(index+1)+" introuvable dans le document");
  const g=entry.graph;
  g.geogebra_image_path=path;
  g.geogebra_image_source="geogebra";
  g.geogebra_renderer_version=GEO_GEBRA_RENDERER_VERSION;
  g.geogebra_image_updated_at=new Date().toISOString();
  return c;
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"Méthode non autorisée"},405);

  const renderToken=req.headers.get("x-aurore-render-token")||"", bearer=req.headers.get("Authorization")||"";
  const serverMode=!!RENDER_TOKEN && renderToken===RENDER_TOKEN;
  let userId:string|null=null;
  let isAdmin=false;

  if(!serverMode){
    if(!bearer.startsWith("Bearer ")) return json({error:"Authentification requise"},401);
    const uc=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:bearer}},auth:{autoRefreshToken:false,persistSession:false}});
    const user=await uc.auth.getUser();
    if(user.error||!user.data.user) return json({error:"Session invalide"},401);
    userId=user.data.user.id;
    const {data:profile}=await admin.from("Profils").select("role").eq("id",userId).maybeSingle();
    isAdmin=/^(admin|administrateur)$/i.test(String(profile?.role||""));
  }

  try{
    const b=await req.json(), action=String(b?.action||"upload");
    if(serverMode&&action!=="server-upload"&&action!=="prepare"&&action!=="register-validation"&&action!=="get-editorial"&&action!=="list-editorial-jobs") return json({error:"Action serveur GeoGebra non autorisée"},403);

    if(action==="upload-assisted-graph"){
      if(serverMode||!userId) return json({error:"Cette action exige une session utilisateur authentifiée"},403);
      const courseId=String(b?.course_id||"").trim(), blockId=String(b?.block_id||"").trim();
      const graph=b?.graph&&typeof b.graph==="object"&&!Array.isArray(b.graph)?b.graph:null;
      if(!courseId||!blockId||!graph) return json({error:"course_id, block_id et graph sont obligatoires"},400);
      const instrument=detectGraphInstrument(graph);
      if(!instrument||!GRAPH_INSTRUMENTS.has(instrument)) return json({error:"Construction GeoGebra invalide ou instrument non pris en charge"},400);
      const {data:course,error:courseError}=await admin.from("aurora_assisted_courses").select("id,created_by").eq("id",courseId).eq("created_by",userId).maybeSingle();
      if(courseError) throw new Error("Vérification du cours impossible: "+courseError.message);
      if(!course) return json({error:"Cours introuvable ou accès refusé"},404);
      const bytes=decodeBase64(String(b?.png_base64||""));
      if(bytes.length>12*1024*1024) return json({error:"PNG GeoGebra trop volumineux"},413);
      if(bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71) return json({error:"Le fichier GeoGebra doit être un PNG"},400);
      const safeBlockId=blockId.replace(/[^A-Za-z0-9_-]/g,"-").slice(0,100)||"graph";
      const path="aurora-content/"+userId+"/assisted/"+courseId+"/blocks/"+safeBlockId+"/graph-"+Date.now()+".png";
      const up=await admin.storage.from("Pdfs").upload(path,bytes,{contentType:"image/png",cacheControl:"31536000",upsert:false});
      if(up.error) throw new Error("Storage GeoGebra: "+up.error.message);
      return json({ok:true,path,bytes:bytes.length,renderer_version:GEO_GEBRA_RENDERER_VERSION});
    }

    if(action==="list-editorial-jobs"){
      if(!serverMode) return json({error:"Action serveur GeoGebra réservée au renderer"},403);
      const {data:rows,error:je}=await admin.from("aurora_content_jobs")
        .select("id,title,subject,level,class_name,document_type,status,generated_document_id,metadata")
        .eq("status","draft")
        .is("generated_document_id",null)
        .limit(100);
      if(je) return json({error:"Lecture des tâches éditoriales: "+je.message},500);
      const jobs=(rows||[]).filter((job:any)=>{
        const wf=job?.metadata?.workflow;
        return (wf?.stage==="redaction" || wf?.stage==="production_en_cours") && wf?.editorial_content && typeof wf.editorial_content==="object";
      }).map((job:any)=>({
        id:job.id,title:job.title,subject:job.subject,level:job.level,class_name:job.class_name,
        document_type:job.document_type,status:job.status,generated_document_id:job.generated_document_id
      }));
      return json({ok:true,jobs,server_mode:true});
    }

    if(action==="get-editorial"){
      if(!serverMode) return json({error:"Action serveur GeoGebra réservée au renderer"},403);
      const jobId=Number(b?.job_id);
      if(!Number.isSafeInteger(jobId)||jobId<1) return json({error:"job_id obligatoire"},400);
      const {data:job,error:je}=await admin.from("aurora_content_jobs")
        .select("id,title,subject,level,class_name,document_type,status,generated_document_id,metadata")
        .eq("id",jobId).maybeSingle();
      if(je||!job) return json({error:"Tâche Content Factory introuvable"},404);
      const wf=job?.metadata?.workflow;
      if(job.status!=="draft" || job.generated_document_id!==null || (wf?.stage!=="redaction" && wf?.stage!=="production_en_cours") || !wf?.editorial_content || typeof wf.editorial_content!=="object"){
        return json({error:"Tâche éditoriale non éligible à la validation GeoGebra D",job_id:jobId},409);
      }
      return json({
        ok:true,
        job:{
          id:job.id,title:job.title,subject:job.subject,level:job.level,class_name:job.class_name,
          document_type:job.document_type,status:job.status,generated_document_id:job.generated_document_id
        },
        editorial_content:wf.editorial_content,
        server_mode:true
      });
    }

    if(action==="register-validation"){
      const jobId=Number(b?.job_id), sha=String(b?.content_sha256||"").toLowerCase().trim();
      const graphCount=Number(b?.graph_count), validatedGraphCount=Number(b?.validated_graph_count);
      const status=String(b?.status||"").toLowerCase().trim();
      if(!Number.isSafeInteger(jobId)||jobId<1) return json({error:"job_id obligatoire"},400);
      if(status!=="pass" && status!=="fail") return json({error:"Le statut de validation doit être pass ou fail"},400);
      if(!Number.isSafeInteger(graphCount)||graphCount<1) return json({error:"graph_count invalide"},400);
      if(!Number.isSafeInteger(validatedGraphCount)||validatedGraphCount<0||validatedGraphCount>graphCount) return json({error:"validated_graph_count invalide"},400);
      if(status==="pass" && validatedGraphCount!==graphCount) return json({error:"Une validation pass exige que tous les graphiques soient validés"},400);
      const {data:job,error:je}=await admin.from("aurora_content_jobs").select("id,metadata").eq("id",jobId).maybeSingle();
      if(je||!job) return json({error:"Tâche Content Factory introuvable"},404);
      const editorial=job?.metadata?.workflow?.editorial_content;
      if(!editorial || typeof editorial!=="object") return json({error:"Contenu éditorial introuvable dans la tâche"},409);
      const {data:canonicalSha,error:shaError}=await admin.rpc("aurora_jsonb_sha256",{p_content:editorial});
      if(shaError || !canonicalSha || !/^[0-9a-f]{64}$/.test(String(canonicalSha))) {
        return json({error:"Impossible de calculer l’empreinte canonique Supabase du contenu éditorial",details:shaError?.message||"hash absent"},500);
      }
      const actual=String(canonicalSha).toLowerCase();
      if(sha && actual!==sha) return json({error:"Empreinte du contenu éditorial différente",expected:actual,received:sha},409);
      const report=b?.report&&typeof b.report==="object"?b.report:{};
      const validatedAt=new Date().toISOString();
      const {data:row,error:ie}=await admin.from("aurora_geogebra_renderer_validations").upsert({
        job_id:jobId,content_sha256:actual,renderer_contract_version:GEO_GEBRA_RENDERER_VERSION,
        status,graph_count:graphCount,validated_graph_count:validatedGraphCount,report,validated_at:validatedAt
      },{onConflict:"job_id,content_sha256,renderer_contract_version"}).select("id,job_id,content_sha256,renderer_contract_version,status,graph_count,validated_graph_count,validated_at").single();
      if(ie) return json({error:"Enregistrement de validation: "+ie.message},500);

      const currentMetadata=job?.metadata && typeof job.metadata==="object" ? structuredClone(job.metadata) : {};
      const workflow=currentMetadata?.workflow && typeof currentMetadata.workflow==="object" ? currentMetadata.workflow : {};
      workflow.geogebra_renderer_validation={
        status,renderer_contract_version:GEO_GEBRA_RENDERER_VERSION,content_sha256:actual,
        graph_count:graphCount,validated_graph_count:validatedGraphCount,report,validated_at:validatedAt
      };
      currentMetadata.workflow=workflow;
      const {error:me}=await admin.from("aurora_content_jobs").update({metadata:currentMetadata}).eq("id",jobId);
      if(me) return json({error:"Persistance du diagnostic GeoGebra dans la tâche: "+me.message},500);

      return json({ok:true,validation:row,content_sha256:actual,server_mode:true});
    }

    const id=Number(b?.generated_document_id);
    if(!Number.isSafeInteger(id)||id<1) return json({error:"generated_document_id obligatoire"},400);

    let query=admin.from("aurora_generated_documents").select("id,created_by,status,content_json,title,version,metadata").eq("id",id);
    if(userId && !isAdmin) query=query.eq("created_by",userId);
    const {data:doc,error:de}=await query.maybeSingle();
    if(de||!doc) return json({error:"Document généré introuvable"},404);
    if(!["generated","review","approved"].includes(doc.status)) return json({error:"Rendu impossible depuis "+doc.status},409);

    if(action==="prepare") return json({ok:true,generated_document_id:id,graphs:graphList(doc.content_json),server_mode:serverMode});

    const index=Number(b?.graph_index);
    if(!Number.isSafeInteger(index)||index<0) return json({error:"graph_index obligatoire"},400);
    const bytes=decodeBase64(String(b?.png_base64||""));
    if(bytes.length>12*1024*1024) return json({error:"PNG GeoGebra trop volumineux"},413);
    if(bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71) return json({error:"Le fichier GeoGebra doit être un PNG"},400);

    const ownerPath=serverMode?"server":String(userId);
    const path="aurora-content/"+ownerPath+"/"+id+"/geogebra/graph-"+(index+1)+"-"+Date.now()+".png";
    const up=await admin.storage.from("Pdfs").upload(path,bytes,{contentType:"image/png",cacheControl:"31536000",upsert:false});
    if(up.error) throw new Error("Storage GeoGebra: "+up.error.message);

    const content=setGraphImage(doc.content_json,index,path);
    const metadata={...(doc.metadata||{}),geogebra:{source:serverMode?"GeoGebra Apps API — GitHub renderer":"GeoGebra Apps API",graph_index:index,updated_at:new Date().toISOString(),path,renderer_version:GEO_GEBRA_RENDERER_VERSION}};
    let updateQuery=admin.from("aurora_generated_documents").update({content_json:content,metadata}).eq("id",id);
    if(userId && !isAdmin) updateQuery=updateQuery.eq("created_by",userId);
    const {error:ue}=await updateQuery;
    if(ue) throw new Error("Mise à jour du document: "+ue.message);
    const pub=admin.storage.from("Pdfs").getPublicUrl(path);
    return json({ok:true,generated_document_id:id,graph_index:index,path,url:pub.data.publicUrl,bytes:bytes.length,server_mode:serverMode});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});