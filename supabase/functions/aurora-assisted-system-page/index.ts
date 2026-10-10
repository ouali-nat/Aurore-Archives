import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, clip, endPath, moveTo, lineTo, closePath, appendBezierCurve } from "npm:pdf-lib@1.17.1";
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
function wrap(s:string,font:any,size:number,max:number){
  const words=clean(s).split(" ").filter(Boolean),lines:string[]=[];
  let line="";
  for(const word of words){
    const next=line?line+" "+word:word;
    if(font.widthOfTextAtSize(next,size)<=max||!line) line=next;
    else { lines.push(line); line=word; }
  }
  if(line) lines.push(line);
  return lines;
}
function rounded(p:any,x:number,y:number,w:number,h:number,r:number,fill:any,border?:any,bw=.5){p.drawSvgPath("M "+r+" 0 H "+(w-r)+" A "+r+" "+r+" 0 0 1 "+w+" "+r+" V "+(h-r)+" A "+r+" "+r+" 0 0 1 "+(w-r)+" "+h+" H "+r+" A "+r+" "+r+" 0 0 1 0 "+(h-r)+" V "+r+" A "+r+" "+r+" 0 0 1 "+r+" 0 Z",{x,y:y+h,color:fill,borderColor:border||fill,borderWidth:border?bw:0})}
function decor(p:any,c:string,kind:string){
  const W=595,H=842;
  p.drawRectangle({x:0,y:0,width:W,height:H,color:rgbh(mix(c,.975))});
  const isEnd=kind==="end";
  const cx=isEnd?W-8:W-18,cy=isEnd?76:H-22;
  // Halos discrets et anneaux fins, comme les pages de contenu.
  for(const q of [
    {r:168,col:mix(c,.965),op:.34},
    {r:132,col:mix(c,.94),op:.30},
    {r:96,col:mix(c,.92),op:.24},
    {r:62,col:mix(c,.89),op:.18}
  ]){
    p.drawCircle({x:cx,y:cy,size:q.r,color:rgbh(q.col),opacity:q.op});
    p.drawCircle({x:cx,y:cy,size:q.r,borderColor:rgbh(mix(c,.68)),borderWidth:.65,borderOpacity:.32});
  }
  const opposite=isEnd?{x:26,y:H-70}:{x:25,y:76};
  p.drawCircle({x:opposite.x,y:opposite.y,size:48,color:rgbh(mix(c,.95)),opacity:.28});
  p.drawCircle({x:opposite.x,y:opposite.y,size:64,color:rgbh(mix(c,.78)),opacity:.14,borderColor:rgbh(mix(c,.60)),borderWidth:.6,borderOpacity:.30});
  p.drawCircle({x:W-22,y:isEnd?H-265:H-340,size:5,color:rgbh(mix(c,.15)),opacity:.45});
  p.drawCircle({x:W-34,y:isEnd?H-300:H-375,size:3.5,color:rgbh(mix(c,.26)),opacity:.36});
  p.drawCircle({x:W-16,y:isEnd?H-330:H-405,size:2.5,color:rgbh(mix(c,.36)),opacity:.32});
  for(let i=0;i<5;i++){
    p.drawCircle({x:31+i*12,y:isEnd?180:190+i*4,size:1.8,color:rgbh(mix(c,.20)),opacity:.35});
  }
}
function hf(p:any,n:number,f:any,l:any,c:string){
  if(l){
    const s=Math.min(17/(l.width||17),17/(l.height||17));
    p.drawImage(l,{x:39,y:805,width:l.width*s,height:l.height*s});
  }
  const label="Section Archives",lw=f.sans.widthOfTextAtSize(label,9.6);
  p.drawText(label,{x:556-lw,y:807,font:f.sans,size:9.6,color:rgbh(mix(c,.24))});
  p.drawCircle({x:556-lw-9,y:811.4,size:2.2,color:rgbh(c)});
  p.drawLine({start:{x:39,y:795},end:{x:556,y:795},thickness:.6,color:rgbh(mix(c,.72))});
  p.drawLine({start:{x:39,y:795},end:{x:99,y:795},thickness:1.8,color:rgbh(mix(c,.30))});
  const cx=297.5,cy=34,num=String(n);
  p.drawLine({start:{x:150,y:cy},end:{x:cx-16,y:cy},thickness:.6,color:rgbh(mix(c,.65))});
  p.drawLine({start:{x:cx+16,y:cy},end:{x:445,y:cy},thickness:.6,color:rgbh(mix(c,.65))});
  p.drawCircle({x:150,y:cy,size:1.8,color:rgbh(mix(c,.40))});
  p.drawCircle({x:445,y:cy,size:1.8,color:rgbh(mix(c,.40))});
  p.drawCircle({x:cx,y:cy,size:11,color:rgbh(mix(c,.91)),borderColor:rgbh(mix(c,.32)),borderWidth:.8});
  const nw=f.sansBold.widthOfTextAtSize(num,9);
  p.drawText(num,{x:cx-nw/2,y:cy-3.1,font:f.sansBold,size:9,color:rgbh(c)});
  const foot="Aurore — Section Archives",fw=f.sans.widthOfTextAtSize(foot,8);
  p.drawText(foot,{x:cx-fw/2,y:14,font:f.sans,size:8,color:rgbh("#898B94")});
}
// ── Direction « nuit éditoriale » : cartes à fond sombre teinté du thème ──
const dk=(h:string,f:number)=>{const s=hex(h).slice(1);return "#"+[0,2,4].map(i=>Math.round(parseInt(s.slice(i,i+2),16)*f).toString(16).padStart(2,"0")).join("")};
const INK="#F4F4FA",INK2="#D0D1DD",INK3="#A9ABBE";
function clipRounded(p:any,x:number,y:number,w:number,h:number,r:number,draw:()=>void){
  const k=r*0.5523;
  p.pushOperators(pushGraphicsState(),moveTo(x+r,y),lineTo(x+w-r,y),
    appendBezierCurve(x+w-r+k,y,x+w,y+r-k,x+w,y+r),lineTo(x+w,y+h-r),
    appendBezierCurve(x+w,y+h-r+k,x+w-r+k,y+h,x+w-r,y+h),lineTo(x+r,y+h),
    appendBezierCurve(x+r-k,y+h,x,y+h-r+k,x,y+h-r),lineTo(x,y+r),
    appendBezierCurve(x,y+r-k,x+r-k,y,x+r,y),closePath(),clip(),endPath());
  draw();
  p.pushOperators(popGraphicsState());
}
// Carte sombre : fond teinté du thème, halos et anneaux concentriques coupés par les bords.
function darkCard(p:any,x:number,y:number,w:number,h:number,r:number,c:string,scale=0.55){
  const base=dk(c,.26);
  rounded(p,x+3,y-4,w,h,r,rgbh(mix(c,.80)));
  rounded(p,x,y,w,h,r,rgbh(base),rgbh(dk(c,.62)),.8);
  const R=Math.min(w,h)*scale;
  clipRounded(p,x,y,w,h,r,()=>{
    [[1,.10],[.74,.12],[.50,.15]].forEach(([k,o])=>p.drawCircle({x:x+w,y:y+h,size:R*k,color:rgbh(mix(c,.05)),opacity:o}));
    [1.22,.92].forEach((k,i)=>p.drawCircle({x:x+w,y:y+h,size:R*k,borderColor:rgbh("#FFFFFF"),borderWidth:.6,borderOpacity:.16-i*.04}));
    p.drawCircle({x:x,y:y,size:R*.52,color:rgbh(mix(c,.05)),opacity:.10});
    p.drawCircle({x:x,y:y,size:R*.78,borderColor:rgbh("#FFFFFF"),borderWidth:.6,borderOpacity:.12});
  });
}
const lift=(c:string,a:number)=>mix(dk(c,.26),a);
function chip(p:any,f:any,c:string,x:number,y:number,w:number,h:number,label:string,size:number){
  rounded(p,x,y,w,h,8,rgbh(lift(c,.12)),rgbh(mix(c,.35)),.5);
  p.drawCircle({x:x+14,y:y+h/2,size:3,color:rgbh(mix(c,.55))});
  p.drawText(label,{x:x+25,y:y+h/2-3,font:f.sansBold,size,color:rgbh(INK)});
}
function cover(p:any,f:any,l:any,c:string,title:string,d:any){
  darkCard(p,52,498,491,278,19,c);
  p.drawRectangle({x:52,y:536,width:4,height:211,color:rgbh(mix(c,.40))});
  chip(p,f,c,74,735,214,25,"AURORE · SECTION ARCHIVES",8.8);
  const panelX=74,panelY=578,panelW=354,panelH=145;
  rounded(p,panelX,panelY,panelW,panelH,13,rgbh(lift(c,.07)),rgbh(mix(c,.30)),.6);
  p.drawText("DOCUMENT PÉDAGOGIQUE",{x:90,y:699,font:f.sansBold,size:8.7,color:rgbh(mix(c,.58))});
  p.drawLine({start:{x:90,y:688},end:{x:149,y:688},thickness:1.6,color:rgbh(mix(c,.45))});
  let ty=669;
  for(const line of wrap(title,f.sansBold,21,320).slice(0,3)){
    p.drawText(line,{x:90,y:ty,font:f.sansBold,size:21,color:rgbh(INK)});
    ty-=25;
  }
  const logoX=443,logoY=604,logoS=80;
  p.drawCircle({x:logoX+logoS/2,y:logoY+logoS/2,size:52,borderColor:rgbh(mix(c,.45)),borderWidth:.7,borderOpacity:.45});
  rounded(p,logoX,logoY,logoS,logoS,14,rgbh("#FFFFFF"),rgbh(mix(c,.45)),.65);
  p.drawCircle({x:logoX+logoS/2,y:logoY+logoS/2,size:34,color:rgbh(mix(c,.96)),opacity:.7});
  if(l){
    const s=Math.min(63/(l.width||63),63/(l.height||63));
    p.drawImage(l,{x:logoX+(logoS-l.width*s)/2,y:logoY+(logoS-l.height*s)/2,width:l.width*s,height:l.height*s});
  }
  const metaParts=[clean(d.subtitle),clean(d.subject)||clean(d.matiere),clean(d.level),clean(d.class_name)].filter(Boolean);
  const meta=metaParts.join(" · ")||"Bibliothèque numérique d’Aurore";
  let sy=560;
  for(const line of wrap(meta,f.regular,9.8,445).slice(0,2)){
    p.drawText(line,{x:75,y:sy,font:f.regular,size:9.8,color:rgbh(INK2)});
    sy-=14;
  }
  if(clean(d.author)||clean(d.institution)){
    const extra=[clean(d.author),clean(d.institution)].filter(Boolean).join(" · ");
    p.drawText(wrap(extra,f.sansBold,8.3,445)[0]||"",{x:75,y:526,font:f.sansBold,size:8.3,color:rgbh(INK2)});
  }
  p.drawText("Bibliothèque numérique d’Aurore",{x:75,y:509,font:f.regular,size:8.8,color:rgbh(INK3)});
  p.drawText("Une édition pédagogique mise en forme avec Aurore",{x:75,y:55,font:f.sans,size:8.6,color:rgbh("#898B94")});
}
function toc(p:any,f:any,c:string,entries:any[],part=1,total=1){
  const X=60,W=475,bottom=100,H=650;
  darkCard(p,X,bottom,W,H,18,c,.34);
  p.drawRectangle({x:X,y:bottom+28,width:3,height:H-56,color:rgbh(mix(c,.40))});
  const chipTitle=String(part+1).padStart(2,"0")+" · "+(part>1?"SOMMAIRE · SUITE":"SOMMAIRE");
  chip(p,f,c,80,704,part>1?210:142,26,chipTitle,9.2);
  p.drawText(part>1?"Table des matières · suite":"Table des matières",{x:89,y:670,font:f.sansBold,size:20,color:rgbh(INK)});
  p.drawLine({start:{x:90,y:654},end:{x:162,y:654},thickness:1.9,color:rgbh(mix(c,.45))});
  p.drawText(part>1?"Suite de l’organisation du document":"Organisation du document",{x:90,y:638,font:f.regular,size:9.4,color:rgbh(INK3)});
  const safe=Array.isArray(entries)?entries.filter(e=>e&&clean(e.title)&&e.enabled!==false):[];
  let y=620;
  if(!safe.length){
    rounded(p,88,566,421,44,9,rgbh(lift(c,.08)),rgbh(mix(c,.30)),.4);
    p.drawText("Aucun bloc de contenu pour le moment.",{x:102,y:583,font:f.regular,size:10.5,color:rgbh(INK2)});
  }else{
    safe.forEach((e:any,i:number)=>{
      const lines=wrap(e.title,f.regular,10.2,278).slice(0,2);
      const h=Math.max(29,lines.length*14+8);
      const rowY=y-h+2,centerY=rowY+(h-4)/2;
      rounded(p,87,rowY,423,h-4,7,rgbh(lift(c,i%2===0?.06:.10)),rgbh(lift(c,.18)),.35);
      p.drawCircle({x:101,y:centerY,size:2.3,color:rgbh(mix(c,.55))});
      lines.forEach((line:string,j:number)=>p.drawText(line,{x:111,y:y-12-j*14,font:f.regular,size:10.2,color:rgbh(INK)}));
      p.drawLine({start:{x:397,y:centerY},end:{x:470,y:centerY},thickness:.45,color:rgbh(mix(c,.35))});
      p.drawCircle({x:470,y:centerY,size:1.5,color:rgbh(mix(c,.50))});
      const page=String(Math.max(1,Number(e.page)||((part-1)*10+i+total+2)));
      p.drawCircle({x:493,y:centerY,size:9.4,color:rgbh(mix(c,.86)),borderColor:rgbh(mix(c,.55)),borderWidth:.45});
      const pw=f.sansBold.widthOfTextAtSize(page,8.5);
      p.drawText(page,{x:493-pw/2,y:centerY-2.8,font:f.sansBold,size:8.5,color:rgbh(dk(c,.40))});
      y-=h;
    });
  }
  p.drawLine({start:{x:90,y:124},end:{x:505,y:124},thickness:.45,color:rgbh(mix(c,.35))});
  p.drawCircle({x:90,y:124,size:1.8,color:rgbh(mix(c,.55))});
  p.drawText(total>1?"Sommaire · page "+part+"/"+total+" — numéros recalculés lors de la fusion finale.":"Les numéros seront recalculés lors de la fusion finale.",{x:98,y:111,font:f.regular,size:8.2,color:rgbh(INK3)});
}
async function ending(p:any,pdf:any,f:any,l:any,c:string,title:string,id:number,d:any){
  const X=76,W=443,bottom=92,H=660;
  darkCard(p,X,bottom,W,H,17,c,.36);
  p.drawRectangle({x:X,y:bottom+22,width:3,height:H-44,color:rgbh(mix(c,.40))});
  chip(p,f,c,92,691,235,29,"MENTIONS · CRÉDITS · VÉRIFICATION",8.9);
  p.drawText("Édition Aurore",{x:94,y:654,font:f.sansBold,size:20,color:rgbh(INK)});
  const titleLines=wrap(clean(title),f.sans,10.5,385).slice(0,2);
  let titleY=628;
  for(const line of titleLines){p.drawText(line,{x:94,y:titleY,font:f.sans,size:10.5,color:rgbh(mix(c,.62))});titleY-=14;}
  p.drawLine({start:{x:94,y:596},end:{x:171,y:596},thickness:1.7,color:rgbh(mix(c,.45))});
  p.drawCircle({x:171,y:596,size:2.1,color:rgbh(mix(c,.45))});

  rounded(p,94,492,407,92,11,rgbh(lift(c,.07)),rgbh(mix(c,.30)),.5);
  p.drawCircle({x:110,y:561,size:3,color:rgbh(mix(c,.55))});
  p.drawText("IDENTITÉ DE L'ÉDITION",{x:120,y:558,font:f.sansBold,size:8.6,color:rgbh(mix(c,.58))});
  p.drawText("Identifiant : "+id,{x:108,y:539,font:f.sans,size:8.6,color:rgbh(INK2)});
  p.drawText("Version : 1 · Page système assistée",{x:108,y:522,font:f.sans,size:8.6,color:rgbh(INK2)});
  const info=[clean(d.subject)||clean(d.matiere),clean(d.level),clean(d.class_name)].filter(Boolean).join(" · ");
  if(info)p.drawText(wrap(info,f.sans,8.4,370)[0]||"",{x:108,y:505,font:f.sans,size:8.4,color:rgbh(INK2)});

  rounded(p,94,319,407,153,12,rgbh(lift(c,.11)),rgbh(mix(c,.34)),.65);
  p.drawCircle({x:110,y:446,size:3,color:rgbh(mix(c,.55))});
  p.drawText("VÉRIFICATION & PUBLICATION",{x:120,y:443,font:f.sansBold,size:8.6,color:rgbh(mix(c,.58))});
  const msg1=wrap("Veuillez scanner le QR code pour vérifier cette édition.",f.regular,9.4,278).slice(0,2);
  let my=420;for(const line of msg1){p.drawText(line,{x:108,y:my,font:f.regular,size:9.4,color:rgbh(INK)});my-=13;}
  const msg2=wrap("La fusion finale recalculera l’identité et le QR de publication.",f.regular,8.6,278).slice(0,2);
  my=390;for(const line of msg2){p.drawText(line,{x:108,y:my,font:f.regular,size:8.6,color:rgbh(INK3)});my-=12;}
  // Le QR reste sur une tuile claire : zone de silence indispensable à la lecture.
  rounded(p,424,350,70,70,10,rgbh("#FFFFFF"),rgbh(mix(c,.50)),.6);
  const u=await QRCode.toDataURL("https://aurore-section-archives.com/",{margin:0,width:220,errorCorrectionLevel:"M"});
  const b=u.split(",")[1],bin=atob(b),a=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);
  const q=await pdf.embedPng(a);
  p.drawImage(q,{x:430,y:356,width:58,height:58});

  rounded(p,94,191,407,118,10,rgbh(lift(c,.05)),rgbh(mix(c,.28)),.45);
  p.drawCircle({x:110,y:284,size:3,color:rgbh(mix(c,.55))});
  p.drawText("DROITS & RÉUTILISATION",{x:120,y:281,font:f.sansBold,size:8.5,color:rgbh(mix(c,.58))});
  p.drawLine({start:{x:108,y:267},end:{x:167,y:267},thickness:1,color:rgbh(mix(c,.45))});
  const rights="Cette édition constitue une création éditoriale d’Aurore. Les connaissances générales et formules restent réutilisables sous réserve des droits applicables aux éléments tiers.";
  let ry=250;
  for(const line of wrap(rights,f.regular,8.8,374).slice(0,3)){p.drawText(line,{x:108,y:ry,font:f.regular,size:8.8,color:rgbh(INK2)});ry-=12.5}
  p.drawText("Les ressources tierces conservent leurs licences et conditions d'utilisation.",{x:108,y:210,font:f.sans,size:7.6,color:rgbh(INK3)});
  p.drawText("Assistance éditoriale : Aurore · Couleur dominante : "+c.slice(1),{x:94,y:166,font:f.sans,size:8,color:rgbh(INK3)});
}
async function update(id:number,requestedKind:string,patch:any){const q=await admin.from("aurora_generated_documents").select("metadata").eq("id",id).maybeSingle();const m=q.data?.metadata&&typeof q.data.metadata==="object"?q.data.metadata:{};await admin.from("aurora_generated_documents").update({metadata:{...m,...patch},updated_at:new Date().toISOString()}).eq("id",id)}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Authentification requise"},401);
  const me=await admin.auth.getUser(auth.slice(7).trim());
  if(me.error||!me.data.user)return out({ok:false,error:"Session utilisateur invalide"},401);
  const uid=me.data.user.id; const activeProfile=await admin.from("Profils").select("banni").eq("id",uid).maybeSingle(); if(activeProfile.error||!activeProfile.data||activeProfile.data.banni===true)return out({ok:false,error:"Compte suspendu ou profil non autorisé"},403);
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

  // page_kind est obligatoire à la création seulement.
  // En mode render, le document créé reste la source de vérité.
  const courseId=clean(body?.course_id);
  const requestedKind=clean(body?.page_kind).toLowerCase();
  const title=clean(body?.title)||"Nouveau cours";

  if(mode==="create"){
    if(!courseId)return out({ok:false,error:"course_id requis"},400);
    if(!["cover","toc","end"].includes(requestedKind))return out({ok:false,error:"page_kind(cover|toc|end) requis pour mode=create"},400);
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
        page_kind:requestedKind,
        course_id:courseId,
        independent_renderer:true,
        no_lualatex:true
      },
      source_document_ids:[],
      metadata:{
        origin:"edition_assistee",
        assisted_system_page:{
          course_id:courseId,
          page_kind:requestedKind
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
      content_json:{title,system_page:{kind:requestedKind,page_data:data}},
      version:1,status:"generated",
      validation_notes:"Page système indépendante de l’édition assistée · aperçu uniquement.",
      metadata:{origin:"edition_assistee",assisted_system_page:true,system_page_kind:requestedKind,preview_only:true,publishable:false,
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
      page_kind:requestedKind,
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
  const renderKind=clean(row.data.content_json?.system_page?.kind||metadata.system_page_kind||requestedKind).toLowerCase();
  if(!["cover","toc","end"].includes(renderKind))return out({ok:false,error:"Type de page système invalide"},409);
  if(requestedKind&&requestedKind!==renderKind)return out({ok:false,error:"page_kind incohérent avec le document : attendu "+renderKind+", reçu "+requestedKind},409);

  try{
    await update(id,renderKind,{fast_page_status:"processing",fast_page_progress:8,fast_page_stage:"Rendu indépendant démarré",fast_page_started_at:new Date().toISOString(),fast_page_last_error:null});
    const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
    const [f,l]=await Promise.all([fonts(pdf),logo(pdf)]);
    await update(id,renderKind,{fast_page_progress:35,fast_page_stage:"Ressources Aurore prêtes"});
    const color=hex(body?.theme_color||row.data.theme_color);
    const pageNo=renderKind==="cover"?1:renderKind==="toc"?2:Math.max(3,Number(data.page_number)||3);
    if(renderKind==="toc"){
      const entries=(Array.isArray(data.entries)?data.entries:[]).filter((e:any)=>e&&clean(e.title)&&e.enabled!==false);
      const pageSize=10,chunks:any[][]=[];
      for(let i=0;i<entries.length;i+=pageSize)chunks.push(entries.slice(i,i+pageSize));
      if(!chunks.length)chunks.push([]);
      for(let i=0;i<chunks.length;i++){
        const page=pdf.addPage([595,842]);
        decor(page,color,renderKind);
        hf(page,pageNo+i,f,l,color);
        toc(page,f,color,chunks[i],i+1,chunks.length);
      }
    }else{
      const p=pdf.addPage([595,842]);decor(p,color,renderKind);
      if(renderKind!=="cover")hf(p,pageNo,f,l,color);
      if(renderKind==="cover")cover(p,f,l,color,row.data.title,data);
      else await ending(p,pdf,f,l,color,row.data.title,id,data);
    }
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
        fast_page_pdf:true,fast_page_pdf_engine:"pdf-lib-system-page-v3",fast_page_status:"completed",fast_page_progress:100,fast_page_page_count:pdf.getPageCount(),
        fast_page_stage:"Page PDF prête · indépendante du renderer LuaLaTeX",fast_page_updated_at:new Date().toISOString(),fast_page_last_error:null}
    }).eq("id",id).eq("created_by",uid);
    return out({ok:true,mode:"render",generated_document_id:id,page_kind:renderKind,page_url:pdfUrl,page_path:path,bytes:bin.length,page_count:pdf.getPageCount(),progress:100,engine:"pdf-lib-system-page-v3"});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await update(id,renderKind,{fast_page_status:"failed",fast_page_progress:0,fast_page_stage:"Échec de génération",fast_page_last_error:msg});
    return out({ok:false,generated_document_id:id,page_kind:renderKind,error:msg},500);
  }
});