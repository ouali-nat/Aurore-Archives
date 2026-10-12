import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const URL=Deno.env.get("SUPABASE_URL")!, ANON=Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(URL,SERVICE,{auth:{autoRefreshToken:false,persistSession:false}});
const MATH=`${URL}/functions/v1/aurora-content-math-renderer`;
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...H,"Content-Type":"application/json"}});
const U:Record<string,string>={"≠":"\\\\ne","≤":"\\\\le","≥":"\\\\ge","∞":"\\\\infty","≈":"\\\\approx","∈":"\\\\in","×":"\\\\times","÷":"\\\\div","±":"\\\\pm","π":"\\\\pi","ℝ":"\\\\mathbb{R}","ℕ":"\\\\mathbb{N}","ℤ":"\\\\mathbb{Z}","→":"\\\\to"};
const tex=(s:string)=>String(s||"").normalize("NFC").replace(/[≠≤≥∞≈∈×÷±πℝℕℤ→]/g,c=>U[c]||c);
const segs=(s:string)=>{const a=String(s||"").normalize("NFC"),o:any[]=[];let i=0,b="";const push=(k:string,v:string)=>v&&o.push({k,v});while(i<a.length){if(a[i]==="$"){const d=a[i+1]==="$",e=a.indexOf(d?"$$":"$",i+(d?2:1));if(e>=0){push("t",b);b="";push("m",a.slice(i+(d?2:1),e));i=e+(d?2:1);continue}}b+=a[i++]}push("t",b);return o};
const clean=(s:any)=>String(s??"").replace(/[\u0000-\u001f]/g," ").replace(/\s+/g," ").trim();
const wrap=(s:string,f:any,z:number,w:number)=>{const a=clean(s).split(" ").filter(Boolean),o:string[]=[];let c="";for(const x of a){const n=c?c+" "+x:x;if(f.widthOfTextAtSize(n,z)<=w)c=n;else{if(c)o.push(c);c=x}}if(c)o.push(c);return o};

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 if(req.method!=="POST")return json({ok:false,error:"Méthode non autorisée"},405);
 const auth=req.headers.get("Authorization");if(!auth?.startsWith("Bearer "))return json({ok:false,error:"Authentification requise"},401);
 const uc=createClient(URL,ANON,{global:{headers:{Authorization:auth}},auth:{autoRefreshToken:false,persistSession:false}});
 const us=await uc.auth.getUser();if(us.error||!us.data.user)return json({ok:false,error:"Session invalide"},401);
 let b:any;try{b=await req.json()}catch{return json({ok:false,error:"JSON invalide"},400)}
 const id=Number(b?.generated_document_id),pn=Number(b?.page_number);if(!Number.isInteger(id)||id<1||!Number.isInteger(pn)||pn<1||pn>200)return json({ok:false,error:"generated_document_id et page_number (1–200) requis"},400);
 const {data:doc,error}=await admin.from("aurora_generated_documents").select("id,created_by,title,status").eq("id",id).maybeSingle();
 if(error)return json({ok:false,error:error.message},500);
 if(!doc)return json({ok:false,error:"Document introuvable"},404);
 const {data:profile}=await admin.from("Profils").select("role,banni").eq("id",us.data.user.id).maybeSingle();
 if(!profile||profile.banni===true)return json({ok:false,error:"Compte suspendu ou profil non autorisé"},403);
 const isAdmin=/^(admin|administrateur)$/i.test(String(profile.role||""));
 if(doc.created_by!==us.data.user.id&&!isAdmin)return json({ok:false,error:"Accès refusé"},403);
 if(!doc.created_by&&!isAdmin)return json({ok:false,error:"Accès refusé"},403);
 if(!["generated","review","approved"].includes(doc.status))return json({ok:false,error:"Le rendu est interdit dans cet état"},409);
 const assetOwnerId=String(doc.created_by||us.data.user.id);
 const input=b?.content;if(!input||typeof input!=="object")return json({ok:false,error:"content structuré requis"},400);
 try{
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const [fr,fb]=await Promise.all([fetch("https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf"),fetch("https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf")]);
  if(!fr.ok||!fb.ok)throw Error("Noto Sans indisponible");
  const [rba,bba]=await Promise.all([fr.arrayBuffer(),fb.arrayBuffer()]);
  const reg=await pdf.embedFont(new Uint8Array(rba),{subset:true}),bold=await pdf.embedFont(new Uint8Array(bba),{subset:true});
  let p=pdf.addPage([595,842]),y=790;const X=48,W=499;
  const qa:any={formulas_total:0,formulas_ok:0,formulas_failed:0,graphs_total:0,graphs_ok:0,graphs_failed:0,tables_total:0,lists_total:0,asset_bytes:{font_source_bytes:rba.byteLength+bba.byteLength,logo_source_bytes:0,formula_png_source_bytes:0,image_source_bytes:0,geogebra_source_bytes:0,total_source_bytes:0}};
  const cache=new Map<string,any>();
  const next=()=>{p=pdf.addPage([595,842]);y=790;p.drawText("AURORE — SECTION ARCHIVES",{x:X,y:812,font:bold,size:8.5,color:rgb(.12,.43,.28)})};
  const ensure=(h:number)=>{if(y-h<52)next()};
  async function formula(s:string){const k=tex(s).trim();if(cache.has(k))return cache.get(k);qa.formulas_total++;const r=await fetch(MATH,{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({formula:k,raster_scale:2}),signal:AbortSignal.timeout(25000)});let z:any;try{z=await r.json()}catch{z=null}if(!r.ok||!z?.ok||!z.png_base64){qa.formulas_failed++;return null}const q=atob(z.png_base64),u=new Uint8Array(q.length);for(let i=0;i<q.length;i++)u[i]=q.charCodeAt(i);qa.asset_bytes.formula_png_source_bytes+=u.length;const im=await pdf.embedPng(u);const rasterScale=Number(z.raster_scale)||2;const naturalPxW=im.width/rasterScale;const baselineRasterWidth=Math.min(8000,Math.max(96,Math.round(naturalPxW*3)));const result={image:im,displayWidth:baselineRasterWidth/8};cache.set(k,result);qa.formulas_ok++;return result}
  async function paragraph(s:string,size=10.5,font=reg){for(const z of segs(s)){if(z.k==="t"){for(const line of wrap(z.v,font,size,W)){ensure(size+8);p.drawText(line,{x:X,y:y-size,font,size,color:rgb(.07,.1,.08)});y-=size+8}}else{const result=await formula(z.v);if(result){const im=result.image;let w=Number(result.displayWidth)||im.width/8,h=w*im.height/im.width,sc=Math.min(1,470/w,20/h);w*=sc;h*=sc;ensure(h+8);p.drawImage(im,{x:X,y:y-h+2,width:w,height:h});y-=h+8}else{ensure(18);p.drawText("[formule]",{x:X,y:y-11,font,size:10,color:rgb(.45,.12,.12)});y-=18}}}}
  p.drawText("AURORE — SECTION ARCHIVES",{x:X,y:y-10,font:bold,size:9,color:rgb(.12,.43,.28)});y-=32;
  await paragraph(clean(input.title||doc.title||"Document pédagogique"),21,bold);y-=7;
  const content=Array.isArray(input.content)?input.content.map(String):[String(input.content||"")];
  for(const raw of content){
   if(raw.trim()==="")continue;
   if(/^\\begin\{(itemize|enumerate)\}/.test(raw)||/^\\item\s*/.test(raw)){qa.lists_total++;await paragraph("• "+raw.replace(/^\\item\s*/,""),10.5);continue}
   if(/^\\begin\{tabular/.test(raw)||raw.trim()==="\\hline"){qa.tables_total++;continue}
   if(/^\\(end\{center\}|end\{tabular\})/.test(raw)||/^\\begin\{center\}/.test(raw)||/^\\includegraphics/.test(raw))continue;
   await paragraph(raw);
  }
  for(const g of Array.isArray(input.graphs)?input.graphs:[]){
   qa.graphs_total++;
   if(g?.geogebra_image_path){const graphPath=String(g.geogebra_image_path);if(!graphPath.startsWith(`aurora-content/${assetOwnerId}/`))return json({ok:false,error:"Chemin GeoGebra non autorisé"},403);const dl=await admin.storage.from("Pdfs").download(graphPath);if(!dl.error&&dl.data){const q=new Uint8Array(await dl.data.arrayBuffer());qa.asset_bytes.geogebra_source_bytes+=q.length;let im:any;if(q[0]===137&&q[1]===80)im=await pdf.embedPng(q);else if(q[0]===255&&q[1]===216)im=await pdf.embedJpg(q);if(im){let w=Math.min(450,im.width),h=w*im.height/im.width;if(h>260){h=260;w=h*im.width/im.height}ensure(h+28);p.drawImage(im,{x:X+(W-w)/2,y:y-h,width:w,height:h});y-=h+20;qa.graphs_ok++;}}}
   if(qa.graphs_ok<qa.graphs_total){qa.graphs_failed++}
  }
  qa.asset_bytes.total_source_bytes=qa.asset_bytes.font_source_bytes+qa.asset_bytes.logo_source_bytes+qa.asset_bytes.formula_png_source_bytes+qa.asset_bytes.image_source_bytes+qa.asset_bytes.geogebra_source_bytes;
  pdf.setSubject("AURORE_ASSET_BYTES:"+JSON.stringify(qa.asset_bytes));
  const out=new Uint8Array(await pdf.save({useObjectStreams:true}));
  qa.asset_bytes.final_pdf_bytes=out.length;
  const expectedPath=`aurora-content-pages/${us.data.user.id}/${id}/page-${String(pn).padStart(4,"0")}.pdf`;const path=String(b?.page_path||expectedPath);if(path!==expectedPath)return json({ok:false,error:"Chemin de page non autorisé"},403);if(out.length>40*1024*1024)return json({ok:false,error:"PDF trop volumineux (maximum 40 Mo)"},413);
  const up=await admin.storage.from("Pdfs").upload(path,out,{contentType:"application/pdf",upsert:true});if(up.error)return json({ok:false,error:up.error.message},500);
  const signed=await admin.storage.from("Pdfs").createSignedUrl(path,60*60*24*7);
  if(signed.error)return json({ok:false,error:signed.error.message},500);
  return json({ok:true,generated_document_id:id,page_number:pn,page_path:path,page_url:signed.data?.signedUrl||null,bytes:out.length,size_mib:Number((out.length/1048576).toFixed(2)),target_max_bytes:4*1024*1024,within_4_mib:out.length<=4*1024*1024,asset_breakdown:qa.asset_bytes,qa,engine:"pdf-lib+fontkit+NotoSans-page-v4-compact"});
 }catch(e){return json({ok:false,generated_document_id:id,page_number:pn,error:e instanceof Error?e.message:String(e)},500)}
});