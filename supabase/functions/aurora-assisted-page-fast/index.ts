import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken:false, persistSession:false } });

const H = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};
const out=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...H,"Content-Type":"application/json"}});
const clean=(v:any)=>String(v??"").replace(/[\u0000-\u001F]/g," ").replace(/\s+/g," ").trim();
const latexEsc=(s:string)=>String(s||"").replace(/[≠≤≥∞≈∈×÷±πℝℕℤ→]/g,c=>({
  "≠":"\\ne","≤":"\\le","≥":"\\ge","∞":"\\infty","≈":"\\approx","∈":"\\in","×":"\\times","÷":"\\div","±":"\\pm","π":"\\pi","ℝ":"\\mathbb{R}","ℕ":"\\mathbb{N}","ℤ":"\\mathbb{Z}","→":"\\to"
}[c]||c));

function segments(s:string){
  const a=String(s||"").normalize("NFC"), o:any[]=[]; let i=0, text="";
  const push=(kind:string,value:string)=>{if(value)o.push({kind,value})};
  while(i<a.length){
    if(a[i]==="$"){
      const display=a[i+1]==="$", open=display?2:1, end=display?"$$":"$", e=a.indexOf(end,i+open);
      if(e>=0){push("text",text);text="";push(display?"display":"math",a.slice(i+open,e));i=e+end.length;continue;}
    }
    if(a[i]==="\uE001"){
      const e=a.indexOf("\uE001",i+1);
      if(e>=0){push("text",text);text="";push("math",a.slice(i+1,e));i=e+1;continue;}
    }
    if(a[i]==="\\" && a[i+1]==="("){
      const e=a.indexOf("\\)",i+2);
      if(e>=0){push("text",text);text="";push("math",a.slice(i+2,e));i=e+2;continue;}
    }
    if(a[i]==="\\" && a[i+1]==="["){
      const e=a.indexOf("\\]",i+2);
      if(e>=0){push("text",text);text="";push("display",a.slice(i+2,e));i=e+2;continue;}
    }
    text+=a[i++];
  }
  push("text",text);
  return o;
}

const wrap=(s:string,font:any,size:number,max:number)=>{
  const words=clean(s).split(" ").filter(Boolean), lines:string[]=[], paragraphs=String(s||"").split(/\n+/);
  for(const para of paragraphs){
    if(!para.trim()){lines.push("");continue;}
    let line="";
    for(const word of para.trim().split(/\s+/)){
      const next=line?line+" "+word:word;
      if(font.widthOfTextAtSize(next,size)<=max) line=next;
      else {if(line)lines.push(line);line=word;}
    }
    if(line)lines.push(line);
  }
  return lines;
};

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Authentification requise"},401);
  const uc=createClient(URL,ANON,{global:{headers:{Authorization:auth}},auth:{autoRefreshToken:false,persistSession:false}});
  const me=await uc.auth.getUser();
  if(me.error||!me.data.user)return out({ok:false,error:"Session invalide"},401);
  let body:any;try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400);}
  const id=Number(body?.generated_document_id), pn=Number(body?.page_number);
  if(!Number.isInteger(id)||id<1||!Number.isInteger(pn)||pn<1)return out({ok:false,error:"generated_document_id et page_number requis"},400);
  const {data:doc,error}=await admin.from("aurora_generated_documents").select("id,created_by,title,metadata").eq("id",id).maybeSingle();
  if(error)return out({ok:false,error:error.message},500);
  if(!doc)return out({ok:false,error:"Document introuvable"},404);
  if(doc.created_by&&doc.created_by!==me.data.user.id)return out({ok:false,error:"Accès refusé"},403);
  const input=body?.content;
  if(!input||typeof input!=="object")return out({ok:false,error:"content structuré requis"},400);

  try{
    const pdf=await PDFDocument.create();
    const reg=await pdf.embedFont(StandardFonts.Helvetica);
    const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    const page=pdf.addPage([595,842]);
    const X=48, W=499, bottom=52; let y=790;
    const qa:any={formulas_total:0,formulas_ok:0,formulas_failed:0,graphs_total:0,graphs_ok:0,graphs_failed:0,images_total:0,images_ok:0,images_failed:0};
    const cache=new Map<string,any>();
    const mathUrl=`${URL}/functions/v1/aurora-content-math-renderer`;

    const ensure=(h:number)=>{if(y-h<bottom)throw new Error("ASSISTED_PAGE_TOO_LONG: la page dépasse une seule page.");};
    async function formula(s:string){
      const key=latexEsc(s).trim(); if(cache.has(key))return cache.get(key);
      qa.formulas_total++;
      try{
        const r=await fetch(mathUrl,{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json"},body:JSON.stringify({formula:key}),signal:AbortSignal.timeout(12000)});
        const z=await r.json().catch(()=>null);
        if(!r.ok||!z?.ok||!z.png_base64){qa.formulas_failed++;return null;}
        const bin=atob(z.png_base64), bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
        const img=await pdf.embedPng(bytes); cache.set(key,img); qa.formulas_ok++; return img;
      }catch(_){qa.formulas_failed++;return null;}
    }

    async function drawTextBlock(s:string,size=10,font=reg){
      const parts=segments(s);
      const rendered=await Promise.all(parts.map((z:any)=>z.kind==="math"||z.kind==="display"?formula(z.value):Promise.resolve(null)));
      for(let i=0;i<parts.length;i++){
        const z=parts[i];
        if(z.kind==="text"){
          for(const line of wrap(z.value,font,size,W)){
            if(!line){y-=8;continue;}
            ensure(size+8);page.drawText(line,{x:X,y:y-size,font,size,color:rgb(0.08,0.10,0.09)});y-=size+8;
          }
        }else{
          const img=rendered[i];
          if(!img){ensure(20);page.drawText("[formule indisponible]",{x:X,y:y-11,font,size:9,color:rgb(0.55,0.2,0.2)});y-=18;continue;}
          let w=Math.min(455,img.width/7.5), h=(w/(img.width||1))*img.height;
          if(z.kind==="math"){const scale=Math.min(1,20/h);w*=scale;h*=scale;}
          ensure(h+10);page.drawImage(img,{x:z.kind==="display"?X+(W-w)/2:X,y:y-h+2,width:w,height:h});y-=h+10;
        }
      }
    }

    page.drawText("AURORE — SECTION ARCHIVES",{x:X,y:812,font:bold,size:8.5,color:rgb(0.12,0.43,0.28)});
    y-=12;
    await drawTextBlock(clean(input.title||doc.title||"Page pédagogique"),20,bold);
    y-=8;

    const content=Array.isArray(input.content)?input.content.map(String):[String(input.content||"")];
    for(const item of content){
      const raw=item.trim(); if(!raw)continue;
      await drawTextBlock(raw,10.5,reg); y-=4;
    }

    for(const image of Array.isArray(input.images)?input.images:[]){
      const url=String(image?.url||"").trim(); if(!url)continue;
      qa.images_total++;
      try{
        const r=await fetch(url,{signal:AbortSignal.timeout(12000)}); if(!r.ok)throw Error("HTTP "+r.status);
        const bytes=new Uint8Array(await r.arrayBuffer()); let img:any;
        if(bytes[0]===137&&bytes[1]===80)img=await pdf.embedPng(bytes);
        else if(bytes[0]===255&&bytes[1]===216)img=await pdf.embedJpg(bytes);
        else throw Error("Format image non pris en charge");
        let w=Math.min(450,img.width),h=w*img.height/img.width;if(h>250){h=250;w=h*img.width/img.height}
        ensure(h+28);page.drawImage(img,{x:X+(W-w)/2,y:y-h,width:w,height:h});y-=h+18;qa.images_ok++;
        const cap=clean(image.caption);if(cap){for(const line of wrap(cap,reg,8.5,W)){ensure(15);page.drawText(line,{x:X,y:y-8.5,font:reg,size:8.5,color:rgb(.3,.32,.3)});y-=12}}
      }catch(_){qa.images_failed++;}
    }

    for(const g of Array.isArray(input.graphs)?input.graphs:[]){
      qa.graphs_total++;
      try{
        const path=String(g?.geogebra_image_path||"").trim();
        if(!path)throw Error("Asset GeoGebra indisponible");
        const dl=await admin.storage.from("Pdfs").download(path);if(dl.error||!dl.data)throw Error("Asset GeoGebra indisponible");
        const bytes=new Uint8Array(await dl.data.arrayBuffer());let img:any;
        if(bytes[0]===137&&bytes[1]===80)img=await pdf.embedPng(bytes);
        else if(bytes[0]===255&&bytes[1]===216)img=await pdf.embedJpg(bytes);
        else throw Error("Format GeoGebra non pris en charge");
        let w=Math.min(450,img.width),h=w*img.height/img.width;if(h>250){h=250;w=h*img.width/img.height}
        ensure(h+28);page.drawImage(img,{x:X+(W-w)/2,y:y-h,width:w,height:h});y-=h+20;qa.graphs_ok++;
      }catch(_){qa.graphs_failed++;}
    }

    const bytes=await pdf.save({useObjectStreams:false});
    const path=`aurora-content-pages/${me.data.user.id}/${id}/page-${String(pn).padStart(4,"0")}.pdf`;
    const up=await admin.storage.from("Pdfs").upload(path,bytes,{contentType:"application/pdf",upsert:true});
    if(up.error)return out({ok:false,generated_document_id:id,page_number:pn,error:up.error.message},500);
    const signed=await admin.storage.from("Pdfs").createSignedUrl(path,60*60*24*7);
    if(signed.error)return out({ok:false,error:signed.error.message},500);
    const pageUrl=signed.data?.signedUrl||null;
    const md=doc.metadata&&typeof doc.metadata==="object"?doc.metadata:{};
    const patch={...md,fast_page_pdf:true,fast_page_pdf_updated_at:new Date().toISOString(),fast_page_pdf_engine:"pdf-lib-fast-page-v1",lualatex_status:"completed",lualatex_progress:100,lualatex_stage:"Page PDF générée instantanément",production_status:"page_pdf_ready",pdf_page_count:1};
    const saved=await admin.from("aurora_generated_documents").update({pdf_path:path,pdf_url:pageUrl,metadata:patch,updated_at:new Date().toISOString()}).eq("id",id).eq("created_by",me.data.user.id);
    if(saved.error)return out({ok:false,error:saved.error.message},500);
    return out({ok:true,mode:"instant-page",engine:"pdf-lib-fast-page-v1",generated_document_id:id,page_number:pn,page_path:path,page_url:pageUrl,bytes:bytes.length,page_count:1,qa});
  }catch(e){return out({ok:false,generated_document_id:id,page_number:pn,error:e instanceof Error?e.message:String(e)},409);}
});