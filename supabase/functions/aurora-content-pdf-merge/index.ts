import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
const SUPA_URL=Deno.env.get("SUPABASE_URL")!,SR=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,ANON=Deno.env.get("SUPABASE_ANON_KEY")!;
const admin=createClient(SUPA_URL,SR,{auth:{autoRefreshToken:false,persistSession:false}});
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:C}); if(req.method!=="POST")return json({ok:false,error:"Méthode non autorisée"},405);
 const auth=req.headers.get("Authorization");if(!auth?.startsWith("Bearer "))return json({ok:false,error:"Authentification requise"},401);
 const uc=createClient(SUPA_URL,ANON,{global:{headers:{Authorization:auth}},auth:{autoRefreshToken:false,persistSession:false}});
 const u=await uc.auth.getUser();if(u.error||!u.data.user)return json({ok:false,error:"Session invalide"},401);
 let b:any;try{b=await req.json()}catch{return json({ok:false,error:"JSON invalide"},400)}
 const id=Number(b?.generated_document_id),paths=Array.isArray(b?.page_paths)?b.page_paths.map(String).filter(Boolean):[];
 if(!Number.isSafeInteger(id)||id<1)return json({ok:false,error:"generated_document_id obligatoire"},400);
 if(!paths.length)return json({ok:false,error:"page_paths obligatoire"},400); if(paths.length>200)return json({ok:false,error:"Trop de pages (maximum 200)"},400);
 const uid=u.data.user.id,prefix=`aurora-content-pages/${uid}/${id}/`;
 if(paths.some((p:string)=>!p.startsWith(prefix)||p.includes("..")))return json({ok:false,error:"Chemin de page non autorisé"},403);
 const {data:doc,error:de}=await admin.from("aurora_generated_documents").select("id,created_by,title,status").eq("id",id).maybeSingle();
 if(de)return json({ok:false,error:de.message},500);
 if(!doc)return json({ok:false,error:"Document introuvable"},404);
 const {data:profile}=await admin.from("Profils").select("role,banni").eq("id",uid).maybeSingle();
 if(!profile||profile.banni===true)return json({ok:false,error:"Compte suspendu ou profil non autorisé"},403);
 const isAdmin=/^(admin|administrateur)$/i.test(String(profile.role||""));
 if(doc.created_by!==uid&&!isAdmin)return json({ok:false,error:"Accès refusé"},403);
 if(!doc.created_by&&!isAdmin)return json({ok:false,error:"Accès refusé"},403);
 if(!["generated","review","approved"].includes(doc.status))return json({ok:false,error:"Fusion interdite dans cet état"},409);
 try{
  let fragment_bytes_total=0,merged_page_count=0,asset_metrics_fragments=0;
  const asset_bytes:any={font_source_bytes:0,logo_source_bytes:0,formula_png_source_bytes:0,formula_vector_pdf_source_bytes:0,image_source_bytes:0,geogebra_source_bytes:0,total_source_bytes:0};
  const merged=await PDFDocument.create();
  for(let i=0;i<paths.length;i++){
   const {data,error}=await admin.storage.from("Pdfs").download(paths[i]);
   if(error||!data)throw Error(`Page ${i+1} introuvable: ${error?.message||"fichier absent"}`);
   const sourceBytes=new Uint8Array(await data.arrayBuffer());fragment_bytes_total+=sourceBytes.length;
   const source=await PDFDocument.load(sourceBytes);merged_page_count+=source.getPageCount();
   const subject=String(source.getSubject()||"");
   if(subject.startsWith("AURORE_ASSET_BYTES:")){
    try{const metrics=JSON.parse(subject.slice("AURORE_ASSET_BYTES:".length));for(const key of Object.keys(asset_bytes)){const value=Number(metrics[key]);if(Number.isFinite(value))asset_bytes[key]+=value;}asset_metrics_fragments++;}catch{}
   }
   const ps=await merged.copyPages(source,source.getPageIndices());for(const p of ps)merged.addPage(p);
  }
  const out=new Uint8Array(await merged.save({useObjectStreams:true}));
  const expectedFinalPath=`aurora-content-generated/${uid}/${id}.pdf`;const finalPath=String(b?.pdf_path||expectedFinalPath);if(finalPath!==expectedFinalPath)return json({ok:false,error:"Chemin PDF non autorisé"},403);if(out.length>40*1024*1024)return json({ok:false,error:"PDF trop volumineux (maximum 40 Mo)"},413);
  const up=await admin.storage.from("Pdfs").upload(finalPath,out,{contentType:"application/pdf",upsert:true});if(up.error)throw Error("Sauvegarde PDF: "+up.error.message);
  const {data:signed,error:se}=await admin.storage.from("Pdfs").createSignedUrl(finalPath,60*60*24*30);
  if(se)throw Error("URL PDF: "+se.message);
  const within_4_mib=out.length<=4*1024*1024;
  const meta={engine:"pdf-lib+page-by-page-v4-vector-math",pages:merged_page_count,fragments:paths.length,bytes:out.length,size_mib:Number((out.length/1048576).toFixed(2)),fragment_bytes:fragment_bytes_total,asset_bytes,asset_metrics_fragments,asset_metrics_complete:asset_metrics_fragments===paths.length,target_max_bytes:4*1024*1024,within_4_mib,generated_at:new Date().toISOString()};
  const {error:ue}=await admin.from("aurora_generated_documents").update({pdf_path:finalPath,pdf_url:signed?.signedUrl||null,metadata:meta,pdf_diagnostic:{ok:true,stage:"MERGE",pages:merged_page_count,fragments:paths.length,bytes:out.length,fragment_bytes:fragment_bytes_total,asset_bytes,asset_metrics_fragments,asset_metrics_complete:asset_metrics_fragments===paths.length,within_4_mib,engine:"pdf-lib+page-by-page-v4-vector-math"}}).eq("id",id);
  if(ue)throw Error("Mise à jour Supabase: "+ue.message);
  return json({ok:true,generated_document_id:id,pages:merged_page_count,fragments:paths.length,bytes:out.length,size_mib:Number((out.length/1048576).toFixed(2)),fragment_bytes:fragment_bytes_total,asset_bytes,asset_metrics_fragments,asset_metrics_complete:asset_metrics_fragments===paths.length,target_max_bytes:4*1024*1024,within_4_mib,pdf_path:finalPath,pdf_url:signed?.signedUrl||null,metadata:meta});
 }catch(e){return json({ok:false,generated_document_id:id,error:e instanceof Error?e.message:String(e)},500)}
});