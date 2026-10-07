import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken:false, persistSession:false } });

const LOGO_URL = "https://pub-0433751d08eb49fcafb7355ef0bf42ab.r2.dev/site-logo-auraster";
const MATH_URL = URL + "/functions/v1/aurora-content-math-renderer";

const H = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};
const out=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...H,"Content-Type":"application/json"}});

const clean=(v:any)=>String(v??"").normalize("NFC").replace(/[\u0000-\u001F]/g," ").replace(/\s+/g," ").trim();

function proseText(v:any){
  const s=String(v??"").replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim();
  return s.split(/\n{2,}/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
}

function latexInput(v:any){
  return String(v??"").normalize("NFC").replace(/[≠≤≥∞≈∈∉×÷±πℝℕℤℚ→⇔⇒⊂⊄]/g,(c)=>{
    const m:any={
      "≠":"\\neq ","≤":"\\leq ","≥":"\\geq ","∞":"\\infty ","≈":"\\approx ",
      "∈":"\\in ","∉":"\\notin ","×":"\\times ","÷":"\\div ","±":"\\pm ",
      "π":"\\pi ","ℝ":"\\mathbb{R}","ℕ":"\\mathbb{N}","ℤ":"\\mathbb{Z}","ℚ":"\\mathbb{Q}",
      "→":"\\to ","⇔":"\\Longleftrightarrow ","⇒":"\\Rightarrow ","⊂":"\\subset ","⊄":"\\nsubset "
    };
    return m[c]||c;
  });
}

function normalizeUnicodeMathText(v:any){
  const src=String(v??"");
  const saved:string[]=[];
  const protectedText=src.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g,(c)=>{
    const token="AURORASUP"+saved.length+"TOKEN";
    saved.push(c);
    return token;
  });
  const normalized=protectedText.normalize("NFKD").normalize("NFC");
  let outText=normalized;
  saved.forEach((c,i)=>{outText=outText.replace("AURORASUP"+i+"TOKEN",c)});
  return outText;
}

function stripInlineDelimiters(s:string){
  return String(s||"").replace(/^\s*\\\(|\s*\\\)$/g,"").replace(/^\s*\\\[|\s*\\\]$/g,"").trim();
}

type Run={kind:"text"|"math"|"display"; value:string; image?:any; width?:number; height?:number};

function parseRuns(raw:string):Run[]{
  const s=normalizeUnicodeMathText(raw);
  const runs:Run[]=[];
  let i=0, buf="";
  const pushText=()=>{if(buf){runs.push({kind:"text",value:buf});buf=""}};
  while(i<s.length){
    if(s.startsWith("$$",i)){
      const e=s.indexOf("$$",i+2);
      if(e>i+2){pushText();runs.push({kind:"display",value:s.slice(i+2,e)});i=e+2;continue}
    }
    if(s[i]==="$"){
      const e=s.indexOf("$",i+1);
      if(e>i+1){pushText();runs.push({kind:"math",value:s.slice(i+1,e)});i=e+1;continue}
    }
    if(s.startsWith("\\[",i)){
      const e=s.indexOf("\\]",i+2);
      if(e>i+2){pushText();runs.push({kind:"display",value:s.slice(i+2,e)});i=e+2;continue}
    }
    if(s.startsWith("\\(",i)){
      const e=s.indexOf("\\)",i+2);
      if(e>i+2){pushText();runs.push({kind:"math",value:s.slice(i+2,e)});i=e+2;continue}
    }
    if(s[i]==="\uE001"){
      const e=s.indexOf("\uE001",i+1);
      if(e>i+1){pushText();runs.push({kind:"math",value:s.slice(i+1,e)});i=e+1;continue}
    }
    buf+=s[i++];
  }
  pushText();
  return runs;
}

function rgbHex(hex:string){
  const h=hex.replace("#","");
  return rgb(parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255);
}
function mixWhite(hex:string,amount:number){
  const h=hex.replace("#","");
  const c=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));
  const q=c.map(x=>Math.round(x+(255-x)*amount));
  return "#" + q.map(x=>x.toString(16).padStart(2,"0")).join("");
}
function subjectColor(v:any){
  const k=clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const m:any={
    mathematiques:"#6D28D9",maths:"#6D28D9",physique:"#2563EB",chimie:"#7C3AED",
    francais:"#C2410C",histoire:"#A16207",svt:"#15803D",informatique:"#0E7490"
  };
  return m[k]||"#6D28D9";
}
function rounded(page:any,x:number,y:number,w:number,h:number,r:number,fill:any,border?:any,borderWidth=0.5){
  page.drawSvgPath(
    "M "+r+" 0 H "+(w-r)+" A "+r+" "+r+" 0 0 1 "+w+" "+r+" V "+(h-r)+
    " A "+r+" "+r+" 0 0 1 "+(w-r)+" "+h+" H "+r+" A "+r+" "+r+
    " 0 0 1 0 "+(h-r)+" V "+r+" A "+r+" "+r+" 0 0 1 "+r+" 0 Z",
    {x:x,y:y+h,color:fill,borderColor:border||fill,borderWidth:border?borderWidth:0}
  );
}
function escapePdfText(v:any){return String(v??"").replace(/\u0000/g,"")}

async function embedRaster(pdf:any,bytes:Uint8Array,label:string){
  if(!bytes||bytes.length<8)throw new Error("Image "+label+" vide.");
  if(bytes[0]===137&&bytes[1]===80){
    return await pdf.embedPng(bytes);
  }
  if(bytes[0]===255&&bytes[1]===216){
    return await pdf.embedJpg(bytes);
  }
  throw new Error("Image "+label+" : format non pris en charge.");
}

async function loadLogo(pdf:any){
  const r=await fetch(LOGO_URL);
  if(!r.ok)throw new Error("Logo Aurore indisponible (HTTP "+r.status+").");
  return await embedRaster(pdf,new Uint8Array(await r.arrayBuffer()),"logo Aurore");
}

async function loadFonts(pdf:any){
  const result:any={regular:null,bold:null};
  try{
    const [r,b]=await Promise.all([
      fetch("https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf"),
      fetch("https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf")
    ]);
    if(r.ok&&b.ok){
      const [rb,bb]=await Promise.all([r.arrayBuffer(),b.arrayBuffer()]);
      result.regular=await pdf.embedFont(new Uint8Array(rb),{subset:true});
      result.bold=await pdf.embedFont(new Uint8Array(bb),{subset:true});
      return result;
    }
  }catch(_){}
  result.regular=await pdf.embedFont(StandardFonts.Helvetica);
  result.bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  return result;
}

async function formulaImage(auth:string,pdf:any,source:string,qa:any,cache:Map<string,any>){
  const key=latexInput(stripInlineDelimiters(source)).trim();
  if(!key)return null;
  if(cache.has(key))return cache.get(key);
  qa.formulas_total++;
  try{
    const r=await fetch(MATH_URL,{
      method:"POST",
      headers:{Authorization:auth,"Content-Type":"application/json"},
      body:JSON.stringify({formula:key}),
      signal:AbortSignal.timeout(12000)
    });
    const z:any=await r.json().catch(()=>null);
    if(!r.ok||!z?.ok||!z.png_base64){qa.formulas_failed++;return null;}
    const bin=atob(z.png_base64),bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const image=await pdf.embedPng(bytes);
    cache.set(key,image);
    qa.formulas_ok++;
    return image;
  }catch(_){
    qa.formulas_failed++;
    return null;
  }
}

function isLikelyPlainMath(fragment:string){
  const s=fragment.trim();
  if(!s||s.length>180)return false;
  if(!/[=∈∉≤≥≠⇔⇒→⊂⊄]/.test(s))return false;
  const words=s.match(/[A-Za-zÀ-ÿ]{2,}/g)||[];
  const allowed=new Set(["lim","ln","log","exp","sin","cos","tan","max","min","inf","sup"]);
  return words.every(w=>allowed.has(w.toLowerCase()));
}

function parsePlainMath(text:string){
  const src=normalizeUnicodeMathText(text);
  const relation=/((?:∀\s*)?[A-Za-z](?:\s*[0-9]+)?\s*(?:∈|∉|⊂|⊄|=|≤|≥|≠|⇔|⇒|→)\s*(?:[A-Za-z0-9]+|\([^\n]{1,80}\))(?:\s*(?:∈|∉|⊂|⊄|=|≤|≥|≠|⇔|⇒|→)\s*(?:[A-Za-z0-9]+|\([^\n]{1,80}\)))*)/g;
  const out:Run[]=[];
  let last=0;
  for(const m of src.matchAll(relation)){
    const index=m.index??0, value=m[0];
    if(index<last)continue;
    if(index>last)out.push({kind:"text",value:src.slice(last,index)});
    out.push({kind:"math",value:value});
    last=index+value.length;
  }
  if(last<src.length)out.push({kind:"text",value:src.slice(last)});
  if(out.length===0)return [{kind:"text",value:src}];
  return out;
}

function mergePlainAndExplicit(raw:string){
  const explicit=parseRuns(raw);
  const out:Run[]=[];
  for(const part of explicit){
    if(part.kind==="text"){
      const plain=parsePlainMath(part.value);
      out.push(...plain);
    }else out.push(part);
  }
  return out;
}

function tokenTextWidth(font:any,size:number,text:string){return font.widthOfTextAtSize(escapePdfText(text),size)}

function splitTextTokens(value:string){
  const words=String(value||"").replace(/\s+/g," ").trim().split(" ").filter(Boolean);
  return words.map((word)=>({kind:"text",value:word}));
}

async function prepareRuns(runs:Run[],auth:string,pdf:any,fonts:any,qa:any,cache:Map<string,any>){
  const prepared:Run[]=[];
  for(const run of runs){
    if(run.kind==="text"){
      prepared.push(...splitTextTokens(run.value));
      continue;
    }
    const img=await formulaImage(auth,pdf,run.value,qa,cache);
    if(img){
      const targetH=run.kind==="display"?42:15.5;
      const scale=Math.min(1,targetH/(img.height||targetH));
      prepared.push({kind:run.kind,value:run.value,image:img,width:img.width*scale,height:img.height*scale});
    }else{
      const fallback=normalizeUnicodeMathText(run.value).replace(/[\\]/g,"").replace(/[{}]/g,"");
      prepared.push({kind:"text",value:fallback});
    }
  }
  return prepared;
}

function layoutInline(prepared:Run[],font:any,size:number,max:number){
  const lines:any[][]=[[]];
  let width=0;
  const addText=(v:string)=>{
    const w=tokenTextWidth(font,size,v);
    const space=lines[lines.length-1].length?tokenTextWidth(font,size," "):0;
    if(width+space+w>max&&lines[lines.length-1].length){
      lines.push([]);width=0;
    }
    const sp=lines[lines.length-1].length?tokenTextWidth(font,size," "):0;
    lines[lines.length-1].push({kind:"text",value:v,width:w,space:sp});
    width+=(lines[lines.length-1].length>1?space:0)+w;
  };
  const addMath=(r:Run)=>{
    const w=(r.width||0)+8;
    const space=lines[lines.length-1].length?4:0;
    if(width+space+w>max&&lines[lines.length-1].length){
      lines.push([]);width=0;
    }
    const sp=lines[lines.length-1].length?4:0;
    lines[lines.length-1].push({kind:"math",image:r.image,width:w,height:(r.height||0)+6,space:sp});
    width+=sp+w;
  };
  for(const r of prepared){if(r.kind==="text")addText(r.value);else if(r.kind==="math")addMath(r)}
  return lines.filter(x=>x.length);
}

function drawInlineLines(page:any,lines:any[],x:number,topY:number,font:any,borderColor:any,textColor:any,size=10.7,lineHeight=15.3){
  let y=topY;
  const boxPadX=4,boxPadY=3;
  for(const line of lines){
    let cx=x;
    const maxH=Math.max(size,...line.filter(t=>t.kind==="math").map(t=>t.height||size));
    for(const token of line){
      cx+=token.space||0;
      if(token.kind==="text"){
        page.drawText(escapePdfText(token.value),{x:cx,y:y-size+3,font,size,color:textColor});
        cx+=token.width;
      }else{
        const iw=Math.max(1,(token.width||10)-8), ih=Math.max(1,(token.height||10)-6);
        const by=y-maxH+3, bh=ih+boxPadY*2;
        rounded(page,cx-boxPadX,by,iw+boxPadX*2,bh,5,rgbHex("#FCFCFF"),borderColor,0.35);
        page.drawImage(token.image,{x:cx,y:by+boxPadY,width:iw,height:ih});
        cx+=iw+boxPadX*2;
      }
    }
    y-=lineHeight;
  }
  return y;
}

function drawParagraph(page:any,prepared:Run[],x:number,topY:number,width:number,font:any,color:string,qa:any){
  const size=10.7, lineHeight=15.4, inner=width-22;
  const inlineRuns=prepared.filter(r=>r.kind!=="display");
  const displayRuns=prepared.filter(r=>r.kind==="display");
  const lines=layoutInline(inlineRuns,font,size,inner);
  const displayHeight=displayRuns.length?displayRuns.reduce((n,r)=>n+(r.height||42)+20,0):0;
  const lineCount=Math.max(1,lines.length);
  const boxH=14+lineCount*lineHeight+displayHeight+10;
  return {lines,displayRuns,boxH};
}

function drawSoftDecor(page:any,color:string){
  const pale1=rgbHex(mixWhite(color,0.90));
  const pale2=rgbHex(mixWhite(color,0.94));
  page.drawCircle({x:571,y:814,size:10,color:pale1});
  page.drawCircle({x:557,y:799,size:5,color:pale2});
  page.drawCircle({x:30,y:28,size:13,color:pale1});
  page.drawCircle({x:48,y:41,size:5,color:pale2});
}

function headerFooter(page:any,pageNo:number,fonts:any,logo:any,color:string){
  const W=595,H=842;
  if(logo){
    const scale=Math.min(29/(logo.width||29),29/(logo.height||29));
    page.drawImage(logo,{x:39,y:805,width:logo.width*scale,height:logo.height*scale});
  }else{
    page.drawCircle({x:53,y:819,size:12,color:rgbHex(mixWhite(color,0.70))});
  }
  page.drawText("Aurore — Section Archives",{x:W-182,y:811,font:fonts.bold,size:8.4,color:rgbHex(mixWhite(color,0.18))});
  page.drawLine({start:{x:39,y:795},end:{x:W-39,y:795},thickness:0.55,color:rgbHex("#D7D7DE")});
  page.drawLine({start:{x:39,y:43},end:{x:W-39,y:43},thickness:0.55,color:rgbHex("#E4E4E8")});
  page.drawText("Aurore — Section Archives",{x:39,y:27,font:fonts.regular,size:7.6,color:rgbHex("#777985")});
  page.drawText("Page "+pageNo,{x:W-78,y:27,font:fonts.regular,size:7.6,color:rgbHex("#777985")});
}

function sectionLabel(page:any,label:string,x:number,y:number,fonts:any,color:string){
  const txt=clean(label);
  if(!txt)return;
  const w=Math.min(180,fonts.bold.widthOfTextAtSize(txt,8.5)+18);
  rounded(page,x,y-13,w,18,7,rgbHex(mixWhite(color,0.90)),rgbHex(mixWhite(color,0.66)),0.4);
  page.drawText(txt,{x:x+9,y:y-9,font:fonts.bold,size:8.5,color:rgbHex(mixWhite(color,0.15))});
}

function drawDisplayMath(page:any,run:Run,x:number,y:number,width:number,color:string){
  const h=Math.min(92,(run.height||42)+18);
  rounded(page,x,y-h,width,h,9,rgbHex("#FBFAFF"),rgbHex(mixWhite(color,0.60)),0.45);
  page.drawLine({start:{x:x,y:y-h+1.5},end:{x:x,y:y-1.5},thickness:1.5,color:rgbHex(color)});
  const iw=Math.min(width-36,run.width||width-36), ih=(run.height||42)*(iw/(run.width||iw));
  page.drawImage(run.image,{x:x+(width-iw)/2,y:y-h+(h-ih)/2,width:iw,height:ih});
  return y-h-7;
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Authentification requise"},401);
  const uc=createClient(URL,ANON,{global:{headers:{Authorization:auth}},auth:{autoRefreshToken:false,persistSession:false}});
  const me=await uc.auth.getUser();
  if(me.error||!me.data.user)return out({ok:false,error:"Session invalide"},401);

  let body:any;
  try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400);}
  const id=Number(body?.generated_document_id),pn=Number(body?.page_number);
  if(!Number.isInteger(id)||id<1||!Number.isInteger(pn)||pn<1)return out({ok:false,error:"generated_document_id et page_number requis"},400);

  const docRes=await admin.from("aurora_generated_documents").select("id,created_by,title,metadata").eq("id",id).maybeSingle();
  if(docRes.error)return out({ok:false,error:docRes.error.message},500);
  if(!docRes.data)return out({ok:false,error:"Document introuvable"},404);
  if(docRes.data.created_by&&docRes.data.created_by!==me.data.user.id)return out({ok:false,error:"Accès refusé"},403);

  const input=body?.content;
  if(!input||typeof input!=="object")return out({ok:false,error:"content structuré requis"},400);

  try{
    const pdf=await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fonts=await loadFonts(pdf);
    const logo=await loadLogo(pdf);
    const page=pdf.addPage([595,842]);
    const color=subjectColor(input.subject||input.matiere||docRes.data.metadata?.matiere||"");
    drawSoftDecor(page,color);
    headerFooter(page,pn,fonts,logo,color);

    const qa:any={
      formulas_total:0,formulas_ok:0,formulas_failed:0,
      graphs_total:0,graphs_ok:0,graphs_failed:0,
      images_total:0,images_ok:0,images_failed:0
    };
    const cache=new Map<string,any>();
    const X=48,W=499,bottom=54,top=780;
    let y=top;

    const sections=Array.isArray(input.sections)?input.sections.filter((s:any)=>s&&typeof s==="object"):[];
    const contentItems:string[]=[];
    const exerciseItems:any[]=[];
    const graphItems:any[]=[];
    const imageItems:any[]=[];
    if(sections.length){
      for(const section of sections){
        const texts=Array.isArray(section.content)?section.content:[section.content];
        for(const item of texts){
          if(item!=null&&String(item).trim())contentItems.push(String(item));
        }
        if(Array.isArray(section.exercises))exerciseItems.push(...section.exercises);
        if(Array.isArray(section.graphs))graphItems.push(...section.graphs);
        if(Array.isArray(section.images))imageItems.push(...section.images);
      }
    }
    if(Array.isArray(input.content))input.content.forEach((x:any)=>{if(String(x??"").trim())contentItems.push(String(x))});
    if(Array.isArray(input.exercises))exerciseItems.push(...input.exercises);
    if(Array.isArray(input.graphs))graphItems.push(...input.graphs);
    if(Array.isArray(input.images))imageItems.push(...input.images);

    if(input.assisted_block?.content?.text&&!contentItems.length)contentItems.push(String(input.assisted_block.content.text));

    const drawParagraphBlock=async(text:string)=>{
      const paragraphs=proseText(text);
      for(const para of paragraphs){
        const rawRuns=mergePlainAndExplicit(para);
        const prepared=await prepareRuns(rawRuns,auth,pdf,fonts,qa,cache);
        const inlinePrepared=prepared.filter((r:any)=>r.kind!=="display");
        const displayPrepared=prepared.filter((r:any)=>r.kind==="display");
        const lines=layoutInline(inlinePrepared,fonts.regular,10.7,W-22);
        const displayHeight=displayPrepared.reduce((n:number,r:any)=>n+Math.min(92,(r.height||42)+18)+7,0);
        const lineHeight=15.4;
        const boxH=14+Math.max(1,lines.length)*lineHeight+displayHeight+10;
        if(y-boxH<bottom)throw new Error("ASSISTED_PAGE_TOO_LONG: le bloc dépasse une seule page.");
        rounded(page,X-11,y-boxH,W+22,boxH,10,rgbHex("#F8F8FA"),rgbHex("#E3E3E8"),0.5);
        const startY=y-10-lineHeight/2;
        let yy=drawInlineLines(page,lines,X,startY,fonts.regular,rgbHex(mixWhite(color,0.14)),rgbHex("#202126"),10.7,lineHeight);
        for(const d of displayPrepared){
          yy=drawDisplayMath(page,d,X,yy-2,W,color);
        }
        y=y-boxH-8;
      }
    };

    for(const raw of contentItems){
      await drawParagraphBlock(raw);
    }

    for(const ex of exerciseItems){
      const statement=clean(ex?.statement||ex?.question||ex?.enonce||ex?.content||"");
      const hint=clean(ex?.hint||"");
      if(!statement)continue;
      if(y-28<bottom)throw new Error("ASSISTED_PAGE_TOO_LONG: exercice hors page.");
      sectionLabel(page,"Exercice",X,y,fonts,color); y-=25;
      await drawParagraphBlock(statement);
      if(hint){
        await drawParagraphBlock("Indication : "+hint);
      }
    }

    for(const image of imageItems){
      const url=String(image?.url||image?.imageUrl||"").trim();
      if(!url)continue;
      qa.images_total++;
      try{
        const r=await fetch(url,{signal:AbortSignal.timeout(12000)});
        if(!r.ok)throw new Error("HTTP "+r.status);
        const img=await embedRaster(pdf,new Uint8Array(await r.arrayBuffer()),"illustration");
        const iw=Math.min(450,img.width),ih=iw*(img.height/img.width);
        const h=Math.min(250,ih);
        const w=h===ih?iw:h*(img.width/img.height);
        const boxH=h+44;
        if(y-boxH<bottom)throw new Error("ASSISTED_PAGE_TOO_LONG: illustration hors page.");
        rounded(page,X-11,y-boxH,W+22,boxH,10,rgbHex("#FFFFFF"),rgbHex("#E5E5EA"),0.45);
        page.drawImage(img,{x:X+(W-w)/2,y:y-16-h,width:w,height:h});
        const caption=clean(image.caption||image.title||"");
        if(caption){
          const lines=proseText(caption);
          let cy=y-21-h;
          for(const line of lines.slice(0,2)){
            for(const wrd of splitTextTokens(line)){
              if(cy<bottom)break;
              page.drawText(wrd.value,{x:X+4,y:cy,font:fonts.regular,size:8,color:rgbHex("#707178")});
              cy-=11;
            }
          }
        }
        y-=boxH+8;qa.images_ok++;
      }catch(_){qa.images_failed++;}
    }

    for(const g of graphItems){
      qa.graphs_total++;
      try{
        const direct=String(g?.geogebra_image_url||g?.image_url||g?.preview_url||"").trim();
        let img:any=null;
        if(direct){
          const r=await fetch(direct,{signal:AbortSignal.timeout(12000)});
          if(r.ok)img=await embedRaster(pdf,new Uint8Array(await r.arrayBuffer()),"graphique");
        }else{
          const path=String(g?.geogebra_image_path||g?.graph_local_path||"").trim();
          if(path){
            const dl=await admin.storage.from("Pdfs").download(path);
            if(!dl.error&&dl.data)img=await embedRaster(pdf,new Uint8Array(await dl.data.arrayBuffer()),"graphique");
          }
        }
        if(!img)throw new Error("Asset graphique indisponible");
        const boxH=260;
        if(y-boxH<bottom)throw new Error("ASSISTED_PAGE_TOO_LONG: graphique hors page.");
        rounded(page,X-11,y-boxH,W+22,boxH,10,rgbHex("#FFFFFF"),rgbHex(mixWhite(color,0.72)),0.45);
        const iw=Math.min(450,img.width),ih=Math.min(222,iw*(img.height/img.width));
        const gy=y-15-ih;
        page.drawImage(img,{x:X+(W-iw)/2,y:gy,width:iw,height:ih});
        if(clean(g?.title)){
          page.drawText(clean(g.title).slice(0,100),{x:X+4,y:y-242,font:fonts.bold,size:8.5,color:rgbHex("#5B5D66")});
        }
        y-=boxH+8;qa.graphs_ok++;
      }catch(_){qa.graphs_failed++;}
    }

    const bytes=new Uint8Array(await pdf.save({useObjectStreams:false}));
    const path="aurora-content-pages/"+me.data.user.id+"/"+id+"/page-"+String(pn).padStart(4,"0")+".pdf";
    const up=await admin.storage.from("Pdfs").upload(path,bytes,{contentType:"application/pdf",upsert:true});
    if(up.error)return out({ok:false,generated_document_id:id,page_number:pn,error:up.error.message},500);
    const signed=await admin.storage.from("Pdfs").createSignedUrl(path,60*60*24*7);
    if(signed.error)return out({ok:false,error:signed.error.message},500);
    const pageUrl=signed.data?.signedUrl||null;
    const md=docRes.data.metadata&&typeof docRes.data.metadata==="object"?docRes.data.metadata:{};
    const patch={
      ...md,
      fast_page_pdf:true,
      fast_page_pdf_updated_at:new Date().toISOString(),
      fast_page_pdf_engine:"pdf-lib-course-page-v2",
      lualatex_status:"completed",
      lualatex_progress:100,
      lualatex_stage:"Page PDF générée instantanément",
      production_status:"page_pdf_ready",
      pdf_page_count:1
    };
    const saved=await admin.from("aurora_generated_documents").update({
      pdf_path:path,pdf_url:pageUrl,metadata:patch,updated_at:new Date().toISOString()
    }).eq("id",id).eq("created_by",me.data.user.id);
    if(saved.error)return out({ok:false,error:saved.error.message},500);
    return out({
      ok:true,mode:"instant-page",engine:"pdf-lib-course-page-v2",
      generated_document_id:id,page_number:pn,page_path:path,page_url:pageUrl,
      bytes:bytes.length,page_count:1,qa
    });
  }catch(e){
    return out({ok:false,generated_document_id:id,page_number:pn,error:e instanceof Error?e.message:String(e)},409);
  }
});
