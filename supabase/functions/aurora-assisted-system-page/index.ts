import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import QRCode from "npm:qrcode@1.5.4";

const URL=Deno.env.get("SUPABASE_URL")!, SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(URL,SERVICE,{auth:{autoRefreshToken:false,persistSession:false}});
const LOGO_URL="https://pub-0433751d08eb49fcafb7355ef0bf42ab.r2.dev/site-logo-auraster";
const FONT_URLS:any={regular:"https://raw.githubusercontent.com/go-fonts/latin-modern/main/lmroman10regular/lmroman10-regular.otf",bold:"https://raw.githubusercontent.com/go-fonts/latin-modern/main/lmroman10bold/lmroman10-bold.otf",sans:"https://raw.githubusercontent.com/go-fonts/latin-modern/main/lmsans10regular/lmsans10-regular.otf",sansBold:"https://raw.githubusercontent.com/go-fonts/latin-modern/main/lmsans10bold/lmsans10-bold.otf"};
const H:any={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...H,"Content-Type":"application/json"}});
const clean=(v:any)=>String(v??"").normalize("NFC").replace(/[\u0000-\u001F]/g," ").replace(/\s+/g," ").trim();
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
const hex=(v:any)=>{const h=String(v??"").trim().toUpperCase();return /^#[0-9A-F]{6}$/.test(h)?h:"#6D28D9"};
const mix=(h:string,a:number)=>{const s=hex(h).slice(1),c=[0,2,4].map(i=>parseInt(s.slice(i,i+2),16)),q=c.map(x=>Math.round(x+(255-x)*a));return "#"+q.map(x=>x.toString(16).padStart(2,"0")).join("")};
const rgbh=(h:string)=>{const s=hex(h).slice(1);return rgb(parseInt(s.slice(0,2),16)/255,parseInt(s.slice(2,4),16)/255,parseInt(s.slice(4,6),16)/255)};
const FONT_CACHE=new Map<string,Promise<Uint8Array>>();let LOGO_CACHE:Promise<Uint8Array>|null=null;
async function bytes(url:string){const r=await fetch(url);if(!r.ok)throw new Error("Ressource indisponible : HTTP "+r.status);return new Uint8Array(await r.arrayBuffer())}
async function fbytes(k:string){const x=FONT_CACHE.get(k);if(x)return x;const p=bytes(FONT_URLS[k]);FONT_CACHE.set(k,p);return p}
async function fonts(pdf:any){const [r,b,s,sb]=await Promise.all([fbytes("regular"),fbytes("bold"),fbytes("sans"),fbytes("sansBold")]);return{regular:await pdf.embedFont(r,{subset:false}),bold:await pdf.embedFont(b,{subset:false}),sans:await pdf.embedFont(s,{subset:false}),sansBold:await pdf.embedFont(sb,{subset:false})}}
async function logo(pdf:any){if(!LOGO_CACHE)LOGO_CACHE=bytes(LOGO_URL);const b=await LOGO_CACHE;if(b[0]===137&&b[1]===80)return pdf.embedPng(b);if(b[0]===255&&b[1]===216)return pdf.embedJpg(b);throw new Error("Logo Aurore invalide")}
function rounded(p:any,x:number,y:number,w:number,h:number,r:number,fill:any,border?:any,bw=.5){p.drawSvgPath("M "+r+" 0 H "+(w-r)+" A "+r+" "+r+" 0 0 1 "+w+" "+r+" V "+(h-r)+" A "+r+" "+r+" 0 0 1 "+(w-r)+" "+h+" H "+r+" A "+r+" "+r+" 0 0 1 0 "+(h-r)+" V "+r+" A "+r+" "+r+" 0 0 1 "+r+" 0 Z",{x,y:y+h,color:fill,borderColor:border||fill,borderWidth:border?bw:0})}
function decor(p:any,c:string){p.drawRectangle({x:0,y:0,width:595,height:842,color:rgbh(mix(c,.965))});p.drawCircle({x:606,y:832,size:72,color:rgbh(mix(c,.90))});p.drawCircle({x:-10,y:770,size:48,color:rgbh(mix(c,.94))});p.drawCircle({x:598,y:565,size:26,color:rgbh(mix(c,.955))});p.drawCircle({x:-8,y:425,size:34,color:rgbh(mix(c,.955))});p.drawCircle({x:604,y:122,size:38,color:rgbh(mix(c,.945))});p.drawLine({start:{x:28,y:70},end:{x:28,y:777},thickness:1.45,color:rgbh(mix(c,.60))});p.drawCircle({x:28,y:777,size:4.3,color:rgbh(mix(c,.60))});p.drawCircle({x:28,y:70,size:4.3,color:rgbh(mix(c,.72))})}
function hf(p:any,n:number,f:any,l:any,c:string){const s=l?Math.min(17/(l.width||17),17/(l.height||17)):0;if(l)p.drawImage(l,{x:39,y:805,width:l.width*s,height:l.height*s});p.drawText("Aurore — Section Archives",{x:413,y:807,font:f.sans,size:9.5,color:rgbh(mix(c,.18))});p.drawLine({start:{x:39,y:795},end:{x:556,y:795},thickness:.55,color:rgbh(mix(c,.72))});p.drawLine({start:{x:39,y:43},end:{x:556,y:43},thickness:.55,color:rgbh(mix(c,.82))});p.drawText("Aurore — Section Archives",{x:39,y:27,font:f.sans,size:9.5,color:rgbh("#777985")});p.drawText("Page "+n,{x:517,y:27,font:f.sans,size:9.5,color:rgbh("#777985")})}
function wrap(t:string,f:any,z:number,max:number){const ws=clean(t).split(" ").filter(Boolean),o:string[]=[];let line="";for(const w of ws){const q=line?line+" "+w:w;if(!line||f.widthOfTextAtSize(q,z)<=max)line=q;else{o.push(line);line=w}}if(line)o.push(line);return o}
function cover(p:any,f:any,l:any,c:string,title:string,d:any){rounded(p,54,176,487,500,18,rgbh("#ECECED"),rgbh("#BFC0C3"),.7);p.drawText("AURORE · SECTION ARCHIVES",{x:77,y:625,font:f.sansBold,size:9.2,color:rgbh("#5C5D65")});p.drawText("Document pédagogique",{x:77,y:591,font:f.sansBold,size:16,color:rgbh(mix(c,.15))});rounded(p,77,505,372,68,15,rgbh(mix(c,.90)),rgbh(mix(c,.76)),.5);let y=551;for(const line of wrap(title,f.sansBold,23,340).slice(0,3)){p.drawText(line,{x:92,y,font:f.sansBold,size:23,color:rgbh(mix(c,.20))});y-=28}y=470;for(const line of wrap(clean(d.subtitle)||"Bibliothèque numérique d’Aurore",f.regular,11.5,360).slice(0,3)){p.drawText(line,{x:92,y,font:f.regular,size:11.5,color:rgbh("#4F5057")});y-=18}if(clean(d.author))p.drawText(clean(d.author),{x:92,y:387,font:f.sansBold,size:10.5,color:rgbh("#4F5057")});if(clean(d.institution))p.drawText(clean(d.institution),{x:92,y:368,font:f.regular,size:10.2,color:rgbh("#5B5C64")});if(d.show_date!==false)p.drawText(new Intl.DateTimeFormat("fr-FR",{dateStyle:"long"}).format(new Date()),{x:92,y:344,font:f.regular,size:9.7,color:rgbh("#777985")});p.drawText("Bibliothèque numérique d’Aurore",{x:77,y:220,font:f.regular,size:9.7,color:rgbh("#777985")});if(l){const s=Math.min(84/(l.width||84),84/(l.height||84));p.drawImage(l,{x:428,y:232,width:l.width*s,height:l.height*s})}}
function toc(p:any,f:any,c:string,entries:any[]){rounded(p,60,112,475,650,16,rgbh("#ECEDEE"),rgbh("#BFC0C3"),.6);rounded(p,78,706,150,28,9,rgbh(mix(c,.90)),rgbh(mix(c,.82)),.4);p.drawText("Sommaire",{x:91,y:715,font:f.sansBold,size:11,color:rgbh(mix(c,.18))});p.drawText("Table des matières",{x:80,y:678,font:f.sansBold,size:16,color:rgbh("#404149")});const safe=Array.isArray(entries)?entries.filter(e=>e&&clean(e.title)):[];let y=642;if(!safe.length)p.drawText("Aucun bloc de contenu pour le moment.",{x:94,y:610,font:f.regular,size:11.2,color:rgbh("#777985")});safe.slice(0,24).forEach((e,i)=>{const lines=wrap(e.title,f.regular,11.2,350),h=lines.slice(0,2).length*17+12;if(y-h<150)return;lines.slice(0,2).forEach((line,j)=>p.drawText(line,{x:94,y:y-j*17,font:f.regular,size:11.2,color:rgbh("#33343B")}));p.drawLine({start:{x:430,y:y-3},end:{x:494,y:y-3},thickness:.6,color:rgbh("#BDBEC2")});p.drawText(String(Math.max(1,Number(e.page)||i+3)),{x:508,y:y-6,font:f.sansBold,size:10.5,color:rgbh(mix(c,.18))});y-=h});p.drawText("Les numéros de page seront recalculés lors de la fusion finale.",{x:80,y:134,font:f.regular,size:8.6,color:rgbh("#777985")})}
async function ending(p:any,f:any,l:any,c:string,title:string,id:number){rounded(p,60,98,475,666,16,rgbh("#ECEDEE"),rgbh("#BFC0C3"),.6);rounded(p,80,714,250,29,9,rgbh(mix(c,.90)),rgbh(mix(c,.82)),.4);p.drawText("Mentions · crédits · vérification",{x:93,y:723,font:f.sansBold,size:10.4,color:rgbh(mix(c,.18))});p.drawText("Édition Aurore",{x:82,y:672,font:f.sansBold,size:21,color:rgbh("#404149")});p.drawText(title,{x:82,y:643,font:f.sans,size:11.5,color:rgbh(mix(c,.22))});p.drawLine({start:{x:82,y:624},end:{x:184,y:624},thickness:1.15,color:rgbh(c)});rounded(p,82,500,430,104,11,rgbh(mix(c,.96)),rgbh(mix(c,.82)),.5);p.drawText("IDENTITÉ DE L'ÉDITION",{x:96,y:580,font:f.sansBold,size:8.6,color:rgbh(mix(c,.18))});p.drawText("Identifiant : "+id,{x:96,y:557,font:f.sans,size:8.8,color:rgbh("#55565E")});p.drawText("Version : 1 · Page système assistée",{x:96,y:538,font:f.sans,size:8.8,color:rgbh("#55565E")});rounded(p,82,330,430,138,12,rgbh("#FFFFFF"),rgbh(mix(c,.68)),.6);p.drawText("VÉRIFICATION & PUBLICATION",{x:96,y:441,font:f.sansBold,size:8.6,color:rgbh(mix(c,.18))});p.drawText("Cette page est un aperçu de l'édition assistée.",{x:96,y:417,font:f.regular,size:10.2,color:rgbh("#4B4C54")});p.drawText("La fusion finale recalculera l'identité et le QR de publication.",{x:96,y:398,font:f.regular,size:9.5,color:rgbh("#66676F")});const u=await QRCode.toDataURL("https://aurore-section-archives.com/",{margin:0,width:220,errorCorrectionLevel:"M"}),b=u.split(",")[1],bin=atob(b),a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);const q=await p.doc.embedPng(a);p.drawImage(q,{x:421,y:347,width:68,height:68});rounded(p,82,208,430,92,11,rgbh(mix(c,.985)),rgbh(mix(c,.86)),.45);p.drawText("DROITS & RÉUTILISATION",{x:96,y:277,font:f.sansBold,size:8.5,color:rgbh(mix(c,.18))});let y=255;for(const line of wrap("Cette édition constitue une création éditoriale d'Aurore. Les éléments tiers conservent leurs propres licences et conditions d'utilisation.",f.regular,9.3,390).slice(0,3)){p.drawText(line,{x:96,y,font:f.regular,size:9.3,color:rgbh("#4F5057")});y-=14}if(l){const s=Math.min(46/(l.width||46),46/(l.height||46));p.drawImage(l,{x:466,y:154,width:l.width*s,height:l.height*s})}}
async function update(id:number,kind:string,patch:any){const q=await admin.from("aurora_generated_documents").select("metadata").eq("id",id).maybeSingle();const m=q.data?.metadata&&typeof q.data.metadata==="object"?q.data.metadata:{};await admin.from("aurora_generated_documents").update({metadata:{...m,...patch},updated_at:new Date().toISOString()}).eq("id",id)}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Authentification requise"},401);
  const me=await admin.auth.getUser(auth.slice(7).trim());
  if(me.error||!me.data.user)return out({ok:false,error:"Session utilisateur invalide"},401);
  const uid=me.data.user.id;
  let body:any;try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400)}
  const mode=clean(body?.mode).toLowerCase(),id=Number(body?.generated_document_id||0);
  if(mode==="status"){
    if(!Number.isInteger(id)||id<1)return out({ok:false,error:"generated_document_id requis"},400);
    const q=await admin.from("aurora_generated_documents").select("id,created_by,pdf_path,pdf_url,metadata,updated_at").eq("id",id).maybeSingle();
    if(q.error)return out({ok:false,error:q.error.message},500);
    if(!q.data||q.data.created_by!==uid)return out({ok:false,error:"Accès refusé"},403);
    const m=q.data.metadata&&typeof q.data.metadata==="object"?q.data.metadata:{};
    return out({ok:true,generated_document_id:id,page_kind:m.system_page_kind||null,pdf_path:q.data.pdf_path||null,pdf_url:q.data.pdf_url||null,status:m.fast_page_status||"processing",progress:clamp(Number(m.fast_page_progress||0)),stage:m.fast_page_stage||"Préparation",error:m.fast_page_last_error||null,updated_at:q.data.updated_at||null});
  }

  const courseId=clean(body?.course_id),kind=clean(body?.page_kind).toLowerCase(),title=clean(body?.title)||"Nouveau cours";
  if(!["cover","toc","end"].includes(kind))return out({ok:false,error:"page_kind(cover|toc|end) requis"},400);

  if(mode==="create"){
    if(!courseId)return out({ok:false,error:"course_id requis"},400);
    const data=body?.page_data&&typeof body.page_data==="object"?body.page_data:{};
    const color=hex(body?.theme_color);
    const now=new Date().toISOString();

    // Le schéma de production exige qu’un generated_document soit rattaché
    // à un aurora_content_jobs existant. Ce job reste un artefact d’édition
    // assistée : il ne passe pas par le renderer LuaLaTeX.
    const job=await admin.from("aurora_content_jobs").insert({
      created_by:uid,
      status:"queued",
      title,
      subject:clean(data.subject)||null,
      level:clean(data.level)||null,
      class_name:clean(data.class_name)||null,
      document_type:"page_assistee",
      source_format:"structured",
      prompt:"Édition assistée — rendu d’une page système indépendante.",
      instructions:{
        assisted_system_page:true,
        page_kind:kind,
        course_id:courseId,
        independent_renderer:true,
        no_lualatex:true
      },
      source_document_ids:[],
      metadata:{
        origin:"edition_assistee",
        assisted_system_page:{
          course_id:courseId,
          page_kind:kind
        }
      },
      created_at:now,
      updated_at:now
    }).select("id").single();
    if(job.error)return out({ok:false,error:"Création du job de page système impossible : "+job.error.message},500);

    const jobId=Number(job.data.id);
    const ins=await admin.from("aurora_generated_documents").insert({
      job_id:jobId,
      created_by:uid,
      title,
      document_type:"page_assistee",
      source_format:"structured",
      source_content:null,
      content_json:{title,system_page:{kind,page_data:data}},
      version:1,status:"generated",
      validation_notes:"Page système indépendante de l’édition assistée · aperçu uniquement.",
      metadata:{origin:"edition_assistee",assisted_system_page:true,system_page_kind:kind,preview_only:true,publishable:false,
        fast_page_status:"queued",fast_page_progress:0,fast_page_stage:"Page système créée · rendu indépendant prêt à démarrer",fast_page_created_at:now},
      theme_color:color,matiere:clean(data.subject)||null
    }).select("id").single();
    if(ins.error){
      await admin.from("aurora_content_jobs").update({
        status:"rejected",
        error_message:ins.error.message,
        updated_at:new Date().toISOString()
      }).eq("id",jobId).eq("created_by",uid);
      return out({ok:false,error:"Création de la page système impossible : "+ins.error.message},500);
    }
    return out({
      ok:true,
      mode:"create",
      generated_document_id:Number(ins.data.id),
      job_id:jobId,
      page_kind:kind,
      progress:0
    });
  }

  if(mode!=="render"){
    return out({ok:false,error:"mode create|render|status requis"},400);
  }
  if(!Number.isInteger(id)||id<1)return out({ok:false,error:"generated_document_id requis pour le rendu"},400);
  const row=await admin.from("aurora_generated_documents").select("id,created_by,title,metadata,content_json").eq("id",id).maybeSingle();
  if(row.error)return out({ok:false,error:row.error.message},500);
  if(!row.data||row.data.created_by!==uid)return out({ok:false,error:"Accès refusé"},403);
  const metadata=row.data.metadata&&typeof row.data.metadata==="object"?row.data.metadata:{};
  if(metadata.assisted_system_page!==true)return out({ok:false,error:"Document non reconnu comme page système assistée"},409);
  const data=row.data.content_json?.system_page?.page_data&&typeof row.data.content_json.system_page.page_data==="object"?row.data.content_json.system_page.page_data:{};
  const renderKind=clean(row.data.content_json?.system_page?.kind||metadata.system_page_kind).toLowerCase();
  if(!["cover","toc","end"].includes(renderKind))return out({ok:false,error:"Type de page système invalide"},409);

  try{
    await update(id,renderKind,{fast_page_status:"processing",fast_page_progress:8,fast_page_stage:"Rendu indépendant démarré",fast_page_started_at:new Date().toISOString(),fast_page_last_error:null});
    const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
    const [f,l]=await Promise.all([fonts(pdf),logo(pdf)]);
    await update(id,renderKind,{fast_page_progress:35,fast_page_stage:"Ressources Aurore prêtes"});
    const p=pdf.addPage([595,842]);(p as any).doc=pdf;decor(p,hex(body?.theme_color||row.data.theme_color));
    const color=hex(body?.theme_color||row.data.theme_color);
    const pageNo=renderKind==="cover"?1:renderKind==="toc"?2:Math.max(3,Number(data.page_number)||3);
    hf(p,pageNo,f,l,color);
    if(renderKind==="cover")cover(p,f,l,color,row.data.title,data);
    else if(renderKind==="toc")toc(p,f,color,Array.isArray(data.entries)?data.entries:[]);
    else await ending(p,f,l,color,row.data.title,id);
    await update(id,renderKind,{fast_page_progress:72,fast_page_stage:"PDF indépendant construit"});
    const bin=new Uint8Array(await pdf.save({useObjectStreams:false}));
    const path="aurora-assisted-system-pages/"+uid+"/"+id+"/"+renderKind+".pdf";
    const up=await admin.storage.from("Pdfs").upload(path,bin,{contentType:"application/pdf",upsert:true});if(up.error)throw new Error(up.error.message);
    await update(id,renderKind,{fast_page_progress:90,fast_page_stage:"PDF téléversé"});
    const su=await admin.storage.from("Pdfs").createSignedUrl(path,604800);if(su.error)throw new Error(su.error.message);
    const pdfUrl=su.data?.signedUrl||null;
    await admin.from("aurora_generated_documents").update({
      pdf_path:path,pdf_url:pdfUrl,updated_at:new Date().toISOString(),
      metadata:{...metadata,origin:"edition_assistee",assisted_system_page:true,system_page_kind:renderKind,preview_only:true,publishable:false,
        fast_page_pdf:true,fast_page_pdf_engine:"pdf-lib-system-page-v2",fast_page_status:"completed",fast_page_progress:100,
        fast_page_stage:"Page PDF prête · indépendante du renderer LuaLaTeX",fast_page_updated_at:new Date().toISOString(),fast_page_last_error:null}
    }).eq("id",id).eq("created_by",uid);
    return out({ok:true,mode:"render",generated_document_id:id,page_kind:renderKind,page_url:pdfUrl,page_path:path,bytes:bin.length,progress:100,engine:"pdf-lib-system-page-v2"});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await update(id,renderKind,{fast_page_status:"failed",fast_page_progress:0,fast_page_stage:"Échec de génération",fast_page_last_error:msg});
    return out({ok:false,generated_document_id:id,page_kind:renderKind,error:msg},500);
  }
});