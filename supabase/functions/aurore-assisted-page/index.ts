import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL_, SERVICE, { auth:{autoRefreshToken:false,persistSession:false} });
const MATH = URL_ + "/functions/v1/aurora-content-math-renderer";
const C = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const out=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...C,"Content-Type":"application/json"}});

const clean=(v:any)=>String(v??"").replace(/[\u0000-\u001F]/g," ").replace(/\s+/g," ").trim();
const esc=(v:any)=>clean(v);
const splitMath=(s:string)=>{
  const src=String(s||"");const parts:{kind:"text"|"math";value:string}[]=[];let i=0,buf="";
  const push=(kind:"text"|"math",value:string)=>{if(value)parts.push({kind,value});};
  while(i<src.length){
    if(src[i]==="$"){
      const dbl=src[i+1]==="$";const end=src.indexOf(dbl?"$$":"$",i+(dbl?2:1));
      if(end>=0){push("text",buf);buf="";push("math",src.slice(i+(dbl?2:1),end));i=end+(dbl?2:1);continue;}
    }
    if(src[i]==="\\"&&src[i+1]==="("){
      const end=src.indexOf("\\)",i+2);
      if(end>=0){push("text",buf);buf="";push("math",src.slice(i+2,end));i=end+2;continue;}
    }
    buf+=src[i++];
  }
  push("text",buf);return parts;
};

async function mathPng(token:string,auth:string){
  const r=await fetch(MATH,{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({formula:String(token||"").trim()}),signal:AbortSignal.timeout(25000)});
  let d:any;try{d=await r.json()}catch{d=null}
  if(!r.ok||!d?.ok)throw new Error(d?.error||("Moteur math HTTP "+r.status));
  const b64=d.png_base64||(Array.isArray(d.results)&&d.results[0]?.png_base64);
  if(!b64)throw new Error("Le moteur math n’a retourné aucune image.");
  const raw=atob(b64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
}

function linesForText(font:any,text:string,size:number,maxWidth:number){
  const words=clean(text).split(" ").filter(Boolean),out:string[]=[];let cur="";
  for(const w of words){const next=cur?cur+" "+w:w;if(font.widthOfTextAtSize(next,size)<=maxWidth)cur=next;else{if(cur)out.push(cur);cur=w;}}
  if(cur)out.push(cur);return out;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:C});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Authentification requise"},401);
  const userClient=createClient(URL_,ANON,{global:{headers:{Authorization:auth}},auth:{autoRefreshToken:false,persistSession:false}});
  const me=await userClient.auth.getUser();
  if(me.error||!me.data.user)return out({ok:false,error:"Session invalide"},401);
  const userId=me.data.user.id;

  let body:any;try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400);}
  const courseId=String(body?.course_id||"").trim(),blockId=String(body?.block_id||"").trim();
  const pageNumber=Number(body?.page_number||0),block=body?.block||{};
  if(!courseId||!blockId||!Number.isInteger(pageNumber)||pageNumber<1||!block||typeof block!=="object")return out({ok:false,error:"course_id, block_id, page_number et block sont requis"},400);

  const course=await admin.from("aurora_assisted_courses").select("id,created_by,title,course_json").eq("id",courseId).eq("created_by",userId).maybeSingle();
  if(course.error)return out({ok:false,error:course.error.message},500);
  if(!course.data)return out({ok:false,error:"Cours d’édition introuvable ou accès refusé"},404);

  try{
    const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
    const [fr,fb]=await Promise.all([
      fetch("https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf"),
      fetch("https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf")
    ]);
    if(!fr.ok||!fb.ok)throw new Error("Polices Noto Sans indisponibles.");
    const [ra,ba]=await Promise.all([fr.arrayBuffer(),fb.arrayBuffer()]);
    const regular=await pdf.embedFont(new Uint8Array(ra),{subset:true}),bold=await pdf.embedFont(new Uint8Array(ba),{subset:true});

    const page=pdf.addPage([595,842]),W=495,X=50,TOP=785,BOTTOM=52;
    let y=TOP;
    const purple=rgb(0.27,0.10,0.56),purple2=rgb(0.55,0.36,0.86),ink=rgb(0.08,0.08,0.10),muted=rgb(0.40,0.40,0.44),soft=rgb(0.95,0.95,0.97),white=rgb(1,1,1);
    page.drawRectangle({x:0,y:0,width:595,height:842,color:rgb(0.995,0.995,1)});
    page.drawText("AURORE — SECTION ARCHIVES",{x:X,y:y,font:bold,size:8.5,color:purple});y-=17;
    page.drawLine({start:{x:X,y:y},end:{x:X+W,y:y},thickness:.8,color:purple2});y-=25;
    page.drawText(clean(body.course_title||course.data.title||"Cours"),{x:X,y:y,font:bold,size:10,color:muted});y-=24;

    const type=String(block.type||"paragraph");
    const content=block.content&&typeof block.content==="object"?block.content:{};
    let heading="",textValue="",jsonValue:any=null;
    if(type==="paragraph"){textValue=String(content.text||"");}
    else if(type==="point"){heading="Point de cours";textValue=String(content.text||"");}
    else if(type==="exercise"){heading="Exercice";textValue=String(content.statement||"");if(content.hint)textValue+="\n\nIndication : "+String(content.hint);}
    else if(type==="graphique"){heading="Graphique JSON";jsonValue=content.json||{};}
    else if(type==="wikimedia-image"){heading="Image Wikimedia";}

    if(heading){page.drawText(heading,{x:X,y:y,font:bold,size:15,color:purple});y-=27;}

    const drawRounded=(yy:number,h:number)=>{
      page.drawRectangle({x:X,y:yy-h,width:W,height:h,color:white,borderColor:rgb(.72,.69,.78),borderWidth:.6});
      page.drawRectangle({x:X,y:yy-h,width:4,height:h,color:purple});
    };

    const drawMathLine=async(math:string)=>{
      const bytes=await mathPng(math,auth);const im=await pdf.embedPng(bytes);
      let w=Math.min(455,im.width/7),h=w*im.height/im.width;
      if(h>75){h=75;w=h*im.width/im.height;}
      if(y-h-18<BOTTOM){throw new Error("Le bloc dépasse une seule page. Réduis le contenu du bloc.");}
      page.drawImage(im,{x:X+(W-w)/2,y:y-h+2,width:w,height:h});y-=h+13;
    };

    const drawTextWithMath=async(raw:string)=>{
      for(const part of splitMath(raw)){
        if(part.kind==="text"){
          const paragraphs=String(part.value).split(/\n\s*\n/).map(v=>v.trim()).filter(Boolean);
          for(const para of paragraphs){
            const lines=linesForText(regular,para,10.5,W-34);
            const h=lines.length*18+22;
            if(y-h<BOTTOM)throw new Error("Le bloc dépasse une seule page. Utilise plusieurs blocs successifs.");
            drawRounded(y,h);
            let cy=y-15;
            for(const line of lines){page.drawText(line,{x:X+15,y:cy,font:regular,size:10.5,color:ink});cy-=18;}
            y-=h+9;
          }
        }else await drawMathLine(part.value);
      }
    };

    if(type==="wikimedia-image"){
      const url=String(content.imageUrl||"").trim();
      if(!url.startsWith("https://upload.wikimedia.org/"))throw new Error("URL Wikimedia non autorisée.");
      const lic=clean(content.license);if(!lic||/fair use|non-commercial|noncommercial|no derivatives/i.test(lic))throw new Error("Licence Wikimedia absente ou non compatible.");
      const r=await fetch(url,{headers:{"User-Agent":"Aurore-Section-Archives/1.0"}});if(!r.ok)throw new Error("Image Wikimedia indisponible (HTTP "+r.status+").");
      const b=new Uint8Array(await r.arrayBuffer());let im:any;
      if(b[0]===137&&b[1]===80)im=await pdf.embedPng(b);else if(b[0]===255&&b[1]===216)im=await pdf.embedJpg(b);else throw new Error("Image Wikimedia : format non supporté.");
      let w=Math.min(455,im.width),h=w*im.height/im.width;if(h>420){h=420;w=h*im.width/im.height;}
      if(y-h-60<BOTTOM)throw new Error("Image trop grande pour une page.");drawRounded(y,h+55);page.drawImage(im,{x:X+(W-w)/2,y:y-h-12,width:w,height:h});y-=h+25;
      page.drawText(clean(content.title||"Image Wikimedia"),{x:X+15,y:y,font:bold,size:8.5,color:ink});y-=13;
      page.drawText("Licence : "+lic.slice(0,80),{x:X+15,y:y,font:regular,size:7.5,color:muted});y-=12;
      page.drawText("Source : Wikimedia Commons",{x:X+15,y:y,font:regular,size:7.5,color:muted});y-=19;
    }else if(type==="graphique"){
      const g=jsonValue;
      const path=String(g?.geogebra_image_path||g?.graph_local_path||"").trim();
      if(!path)throw new Error("Graphique validé, mais l’asset GeoGebra n’est pas encore disponible. Le JSON reste conservé.");
      const cleanPath=path.replace(/^\/+/,"");if(cleanPath.includes(".."))throw new Error("Chemin GeoGebra invalide.");
      const dl=await admin.storage.from("Pdfs").download(cleanPath);if(dl.error||!dl.data)throw new Error("Asset GeoGebra indisponible.");
      const b=new Uint8Array(await dl.data.arrayBuffer());let im:any;
      if(b[0]===137&&b[1]===80)im=await pdf.embedPng(b);else if(b[0]===255&&b[1]===216)im=await pdf.embedJpg(b);else throw new Error("Asset GeoGebra : format non supporté.");
      let w=Math.min(450,im.width),h=w*im.height/im.width;if(h>420){h=420;w=h*im.width/im.height;}
      if(y-h-35<BOTTOM)throw new Error("Graphique trop grand pour une page.");drawRounded(y,h+30);page.drawImage(im,{x:X+(W-w)/2,y:y-h-5,width:w,height:h});y-=h+18;
      page.drawText("Source : JSON GeoGebra · "+String(g.id||"sans id"),{x:X+15,y:y,font:regular,size:7.5,color:muted});y-=18;
    }else{
      await drawTextWithMath(textValue);
    }

    page.drawLine({start:{x:X,y:BOTTOM+18},end:{x:X+W,y:BOTTOM+18},thickness:.6,color:rgb(.78,.78,.82)});
    page.drawText("Aurore — Édition assistée · page "+pageNumber,{x:X,y:BOTTOM+4,font:regular,size:7,color:muted});
    const bytes=new Uint8Array(await pdf.save({useObjectStreams:false}));
    const path="aurora-assisted-pages/"+userId+"/"+courseId+"/page-"+String(pageNumber).padStart(4,"0")+"-"+blockId+".pdf";
    const up=await admin.storage.from("Pdfs").upload(path,bytes,{contentType:"application/pdf",upsert:true,cacheControl:"86400"});
    if(up.error)throw new Error(up.error.message);
    const signed=await admin.storage.from("Pdfs").createSignedUrl(path,60*60*24*7);
    if(signed.error)throw new Error(signed.error.message);
    return out({ok:true,course_id:courseId,block_id:blockId,page_number:pageNumber,page_path:path,page_url:signed.data?.signedUrl||"",bytes:bytes.length,engine:"aurore-assisted-page-v1"});
  }catch(e){
    return out({ok:false,course_id:courseId,block_id:blockId,page_number:pageNumber,error:e instanceof Error?e.message:String(e)},500);
  }
});