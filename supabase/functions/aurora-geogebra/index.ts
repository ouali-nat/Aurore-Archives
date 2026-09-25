import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RENDER_TOKEN = Deno.env.get("AURORA_LUALATEX_RENDER_TOKEN") || "";
const GEO_GEBRA_RENDERER_VERSION = 3;

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

  if(!serverMode){
    if(!bearer.startsWith("Bearer ")) return json({error:"Authentification requise"},401);
    const uc=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:bearer}},auth:{autoRefreshToken:false,persistSession:false}});
    const user=await uc.auth.getUser();
    if(user.error||!user.data.user) return json({error:"Session invalide"},401);
    userId=user.data.user.id;
  }

  try{
    const b=await req.json(), id=Number(b?.generated_document_id), action=String(b?.action||"upload");
    if(!Number.isSafeInteger(id)||id<1) return json({error:"generated_document_id obligatoire"},400);
    if(serverMode&&action!=="server-upload"&&action!=="prepare") return json({error:"Action serveur GeoGebra non autorisée"},403);

    let query=admin.from("aurora_generated_documents").select("id,created_by,status,content_json,title,version,metadata").eq("id",id);
    if(userId) query=query.eq("created_by",userId);
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
    if(userId) updateQuery=updateQuery.eq("created_by",userId);
    const {error:ue}=await updateQuery;
    if(ue) throw new Error("Mise à jour du document: "+ue.message);
    const pub=admin.storage.from("Pdfs").getPublicUrl(path);
    return json({ok:true,generated_document_id:id,graph_index:index,path,url:pub.data.publicUrl,bytes:bytes.length,server_mode:serverMode});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});