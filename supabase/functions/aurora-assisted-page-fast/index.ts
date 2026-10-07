import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken:false, persistSession:false } });

const LOGO_URL = "https://pub-0433751d08eb49fcafb7355ef0bf42ab.r2.dev/site-logo-auraster";
const MATH_URL = URL + "/functions/v1/aurora-content-math-renderer";

const TEXT_SIZE=11.3;
const LINE_HEIGHT=16.1;
const BLOCK_GAP=12;
const BOX_RADIUS=11;
const BOX_PAD_TOP=11;
const BOX_PAD_BOTTOM=11;
const MATH_DISPLAY_BASE_H=24;
const MATH_EX_PX=7.54;
const MATH_RASTER_SCALE=3;
const MATH_BOX_PAD_X=7;
const MATH_INLINE_GAP=12;
const MATH_BOX_PAD_Y=3.5;
const FONT_URLS={
  regular:"https://raw.githubusercontent.com/go-fonts/latin-modern/main/lmroman10regular/lmroman10-regular.otf",
  bold:"https://raw.githubusercontent.com/go-fonts/latin-modern/main/lmroman10bold/lmroman10-bold.otf",
  sans:"https://raw.githubusercontent.com/go-fonts/latin-modern/main/lmsans10regular/lmsans10-regular.otf",
  sansBold:"https://raw.githubusercontent.com/go-fonts/latin-modern/main/lmsans10bold/lmsans10-bold.otf"
};
const FONT_BYTES_CACHE=new Map<string,Promise<Uint8Array>>();
let LOGO_BYTES_PROMISE:Promise<Uint8Array>|null=null;

const H = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};
const out=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...H,"Content-Type":"application/json"}});

const clean=(v:any)=>String(v??"").normalize("NFC").replace(/[\u0000-\u001F]/g," ").replace(/\s+/g," ").trim();

function extractStructuredText(v:any):string{
  if(v===null||v===undefined)return "";
  if(typeof v!=="string")return String(v);
  const raw=v.trim();
  if(!raw)return "";
  if((raw.startsWith("{")&&raw.endsWith("}"))||(raw.startsWith("[")&&raw.endsWith("]"))){
    try{
      const parsed=JSON.parse(raw);
      const candidate=(node:any):string=>{
        if(node===null||node===undefined)return "";
        if(typeof node==="string")return node;
        if(Array.isArray(node))return node.map(candidate).filter(Boolean).join("\n\n");
        if(typeof node!=="object")return String(node);
        if(typeof node.text==="string")return node.text;
        if(typeof node.body==="string")return node.body;
        if(typeof node.statement==="string")return node.statement;
        if(typeof node.question==="string")return node.question;
        if(typeof node.content==="string")return node.content;
        if(node.content&&typeof node.content==="object")return candidate(node.content);
        return "";
      };
      const extracted=candidate(parsed).trim();
      if(extracted)return extracted;
    }catch(_){}
  }
  return v;
}
function proseText(v:any){
  const s=extractStructuredText(v).replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim();
  return s.split(/\n{2,}/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
}

function latexInput(v:any){
  let source=normalizeUnicodeMathText(String(v??"")).normalize("NFC");
  source=source.replace(/\\{2,}(?=[A-Za-z{}])/g,"\\");
  source=source
    .replace(/\\(?:mathbf|boldsymbol|bm|pmb)\s*/g,"")
    .replace(/\\(?:bfseries|boldmath|bf)\b/g,"")
    .replace(/\\textbf\s*\{([^{}]*)\}/g,"\\text{$1}");
  return source.replace(/[≠≤≥∞≈∈∉×÷±πℝℕℤℚ→⇔⇒⊂⊄∀∃∧∨∅]/g,(c)=>{
    const m:any={
      "≠":"\\neq ","≤":"\\leq ","≥":"\\geq ","∞":"\\infty ","≈":"\\approx ",
      "∈":"\\in ","∉":"\\notin ","×":"\\times ","÷":"\\div ","±":"\\pm ","π":"\\pi ",
      "ℝ":"\\mathbb{R}","ℕ":"\\mathbb{N}","ℤ":"\\mathbb{Z}","ℚ":"\\mathbb{Q}",
      "→":"\\to ","⇔":"\\Longleftrightarrow ","⇒":"\\Rightarrow ","⊂":"\\subset ","⊄":"\\nsubset ",
      "∀":"\\forall ","∃":"\\exists ","∧":"\\land ","∨":"\\lor ","∅":"\\varnothing "
    };
    return m[c]||c;
  });
}

function normalizeUnicodeMathText(v:any){
  const src=String(v??"");
  const saved:string[]=[];
  const protectedText=src.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ℝℕℤℚ]/g,(c)=>{
    const token="AURORAUNI"+saved.length+"TOKEN";
    saved.push(c);
    return token;
  });
  const normalized=protectedText.normalize("NFKD").normalize("NFC");
  let outText=normalized;
  saved.forEach((c,i)=>{outText=outText.replace("AURORAUNI"+i+"TOKEN",c)});
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

function normalizeHexColor(value:any){
  const h=String(value??"").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(h)?h:null;
}
function rgbHex(hex:string){
  const h=(normalizeHexColor(hex)||"#6D28D9").replace("#","");
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

async function fetchLogoBytes(){
  if(LOGO_BYTES_PROMISE)return LOGO_BYTES_PROMISE;
  LOGO_BYTES_PROMISE=fetch(LOGO_URL).then(async r=>{
    if(!r.ok)throw new Error("Logo Aurore indisponible (HTTP "+r.status+").");
    return new Uint8Array(await r.arrayBuffer());
  });
  return LOGO_BYTES_PROMISE;
}
async function loadLogo(pdf:any){
  return await embedRaster(pdf,await fetchLogoBytes(),"logo Aurore");
}

async function fetchFontBytes(key:string,url:string){
  let task=FONT_BYTES_CACHE.get(key);
  if(task)return task;
  task=fetch(url).then(async r=>{
    if(!r.ok)throw new Error("Police "+key+" indisponible (HTTP "+r.status+")");
    return new Uint8Array(await r.arrayBuffer());
  });
  FONT_BYTES_CACHE.set(key,task);
  return task;
}
async function loadFonts(pdf:any){
  const [regular,bold,sans,sansBold]=await Promise.all([
    fetchFontBytes("regular",FONT_URLS.regular),
    fetchFontBytes("bold",FONT_URLS.bold),
    fetchFontBytes("sans",FONT_URLS.sans),
    fetchFontBytes("sansBold",FONT_URLS.sansBold)
  ]);
  return {
    regular:await pdf.embedFont(regular,{subset:false}),
    bold:await pdf.embedFont(bold,{subset:false}),
    sans:await pdf.embedFont(sans,{subset:false}),
    sansBold:await pdf.embedFont(sansBold,{subset:false})
  };
}
async function formulaImage(auth:string,pdf:any,source:string,qa:any,cache:Map<string,any>){
  const key=latexInput(stripInlineDelimiters(source)).trim();
  if(!key)return null;
  const cached=cache.get(key);
  if(cached){
    try{return await cached}catch(_){cache.delete(key);return null}
  }
  const task=(async()=>{
    qa.formulas_total++;
    try{
      const r=await fetch(MATH_URL,{
        method:"POST",
        headers:{Authorization:auth,"Content-Type":"application/json"},
        body:JSON.stringify({formula:key,px_per_ex:MATH_EX_PX}),
        signal:AbortSignal.timeout(12000)
      });
      const z:any=await r.json().catch(()=>null);
      const result=z?.results?.[0]||z;
      const pngBase64=typeof result?.png_base64==="string"?result.png_base64:null;
      if(!r.ok||!z?.ok||!pngBase64){qa.formulas_failed++;return null;}
      const bin=atob(pngBase64),bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      const image:any=await pdf.embedPng(bytes);
      image.__aurore_natural_pt_width=Number(result?.natural_pt_width)||0;
      image.__aurore_natural_pt_height=Number(result?.natural_pt_height)||0;
      image.__aurore_raster_scale=Number(result?.raster_scale)||1;
      qa.formulas_ok++;
      return image;
    }catch(_){
      qa.formulas_failed++;
      return null;
    }
  })();
  cache.set(key,task);
  return await task;
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

function wrap(s:string,font:any,size:number,max:number){
  const words=clean(s).split(" ").filter(Boolean),lines:string[]=[];
  let line="";
  for(const word of words){
    const next=line?line+" "+word:word;
    if(font.widthOfTextAtSize(next,size)<=max||!line){line=next}else{lines.push(line);line=word}
  }
  if(line)lines.push(line);
  return lines;
}

function tokenTextWidth(font:any,size:number,text:string){return font.widthOfTextAtSize(escapePdfText(text),size)}
function splitTextTokens(value:string){
  const words=String(value||"").replace(/\s+/g," ").trim().split(" ").filter(Boolean);
  return words.map((word)=>({kind:"text",value:word}));
}
async function prepareRuns(runs:Run[],auth:string,pdf:any,fonts:any,qa:any,cache:Map<string,any>){
  return await Promise.all(runs.map(async run=>{
    if(run.kind==="text")return {kind:"text",value:run.value} as Run;
    const img:any=await formulaImage(auth,pdf,run.value,qa,cache);
    if(img){
      const naturalW=Number(img.__aurore_natural_pt_width)||Math.max(8,img.width*0.75);
      const naturalH=Number(img.__aurore_natural_pt_height)||Math.max(8,img.height*0.75);
      return {kind:run.kind,value:run.value,image:img,width:naturalW,height:naturalH} as Run;
    }
    const fallback=normalizeUnicodeMathText(run.value).replace(/[\\]/g,"").replace(/[{}]/g,"");
    return {kind:"text",value:fallback} as Run;
  }));
}
function layoutInline(prepared:Run[],font:any,size:number,max:number){
  const lines:any[][]=[[]];let width=0;
  const addText=(v:string)=>{
    const w=tokenTextWidth(font,size,v);
    const space=lines[lines.length-1].length?tokenTextWidth(font,size," "):0;
    if(width+space+w>max&&lines[lines.length-1].length){lines.push([]);width=0;}
    const sp=lines[lines.length-1].length?tokenTextWidth(font,size," "):0;
    lines[lines.length-1].push({kind:"text",value:v,width:w,space:sp});
    width+=(lines[lines.length-1].length>1?space:0)+w;
  };
  const addMath=(r:Run)=>{
    const intrinsicW=Math.max(8,r.width||24),intrinsicH=Math.max(8,r.height||16),w=intrinsicW+14;
    const space=lines[lines.length-1].length?MATH_INLINE_GAP:0;
    if(width+space+w>max&&lines[lines.length-1].length){lines.push([]);width=0;}
    const sp=lines[lines.length-1].length?MATH_INLINE_GAP:0;
    lines[lines.length-1].push({kind:"math",image:r.image,width:w,height:intrinsicH+6,space:sp});
    width+=sp+w;
  };
  for(const r of prepared){if(r.kind==="text")addText(r.value);else if(r.kind==="math")addMath(r);}
  return lines.filter(x=>x.length);
}
function inlineLineAdvance(line:any[],size=TEXT_SIZE,lineHeight=LINE_HEIGHT){
  const maxMathBoxH=Math.max(
    0,
    ...line.filter(t=>t.kind==="math").map(t=>Math.max(
      20,
      (t.height||10)+MATH_BOX_PAD_Y*2
    ))
  );
  return Math.max(lineHeight,maxMathBoxH);
}

function drawInlineLines(page:any,lines:any[],x:number,topY:number,width:number,font:any,borderColor:any,textColor:any,size=TEXT_SIZE,lineHeight=LINE_HEIGHT){
  let y=topY;
  const boxPadX=MATH_BOX_PAD_X,boxPadY=MATH_BOX_PAD_Y;
  const frame=rgbHex("#C4C5C8"),fill=rgbHex("#EEEEEF");

  for(const line of lines){
    const advance=inlineLineAdvance(line,size,lineHeight);
    const lineWidth=line.reduce(
      (sum:number,token:any)=>sum+(token.space||0)+(token.width||0),0
    );
    const startX=x+Math.max(0,(width-lineWidth)/2);
    const lineCenter=y-advance/2;
    let cx=startX;

    for(const token of line){
      cx+=token.space||0;
      if(token.kind==="text"){
        const textHeight=Math.max(8,font.heightAtSize(size));
        const baseline=lineCenter-textHeight/2+size*0.22;
        page.drawText(escapePdfText(token.value),{
          x:cx,y:baseline,font,size,color:textColor
        });
        cx+=token.width;
      }else{
        const iw=Math.max(1,(token.width||14)-14);
        const ih=Math.max(1,(token.height||10)-6);
        const bh=Math.max(20,ih+boxPadY*2);
        const by=lineCenter-bh/2;
        const outerW=iw+boxPadX*2;
        rounded(page,cx-boxPadX,by,outerW,bh,7,fill,frame,0.45);
        page.drawImage(token.image,{
          x:cx,y:by+boxPadY,width:iw,height:ih
        });
        cx+=outerW;
      }
    }
    y-=advance;
  }
  return y;
}

function drawSoftDecor(page:any,color:string){
  const W=595,H=842;
  // Same very pale page tone as the normal editorial route (aurorepale).
  page.drawRectangle({x:0,y:0,width:W,height:H,color:rgbHex(mixWhite(color,0.96))});

  // Aurore production-style edge bubbles: large, pale and always behind content.
  page.drawCircle({x:606,y:832,size:72,color:rgbHex(mixWhite(color,0.89))});
  page.drawCircle({x:-10,y:770,size:48,color:rgbHex(mixWhite(color,0.935))});
  page.drawCircle({x:598,y:565,size:26,color:rgbHex(mixWhite(color,0.95))});
  page.drawCircle({x:-8,y:425,size:34,color:rgbHex(mixWhite(color,0.95))});
  page.drawCircle({x:604,y:122,size:38,color:rgbHex(mixWhite(color,0.94))});
  page.drawCircle({x:88,y:-2,size:58,color:rgbHex(mixWhite(color,0.945))});
  page.drawCircle({x:540,y:2,size:50,color:rgbHex(mixWhite(color,0.925))});
  page.drawCircle({x:20,y:55,size:16,color:rgbHex(mixWhite(color,0.965))});

  // Continuous page-level spine. It stays in the margin with a real gap
  // before the content frames, unlike the previous block-attached bar.
  const spine=rgbHex(mixWhite(color,0.60));
  const spineSoft=rgbHex(mixWhite(color,0.72));
  page.drawLine({start:{x:28,y:70},end:{x:28,y:777},thickness:1.45,color:spine});
  page.drawCircle({x:28,y:777,size:4.3,color:spine});
  page.drawCircle({x:28,y:70,size:4.3,color:spineSoft});
}
function headerFooter(page:any,pageNo:number,fonts:any,logo:any,color:string){
  const W=595,H=842;
  if(logo){
    const scale=Math.min(17/(logo.width||17),17/(logo.height||17));
    page.drawImage(logo,{x:39,y:805,width:logo.width*scale,height:logo.height*scale});
  }else{
    page.drawCircle({x:47,y:811,size:8.5,color:rgbHex(mixWhite(color,0.70))});
  }
  page.drawText("Aurore — Section Archives",{x:W-182,y:807,font:fonts.sans,size:9.5,color:rgbHex(mixWhite(color,0.18))});
  page.drawLine({start:{x:39,y:795},end:{x:W-39,y:795},thickness:0.55,color:rgbHex(mixWhite(color,0.72))});
  page.drawLine({start:{x:39,y:43},end:{x:W-39,y:43},thickness:0.55,color:rgbHex(mixWhite(color,0.82))});
  page.drawText("Aurore — Section Archives",{x:39,y:27,font:fonts.sans,size:9.5,color:rgbHex("#777985")});
  page.drawText("Page "+pageNo,{x:W-78,y:27,font:fonts.sans,size:9.5,color:rgbHex("#777985")});
  }

function sectionLabel(page:any,label:string,x:number,y:number,fonts:any,color:string){
  const txt=clean(label);
  if(!txt)return;
  const w=Math.min(180,fonts.sansBold.widthOfTextAtSize(txt,8.5)+18);
  rounded(page,x,y-13,w,18,7,rgbHex(mixWhite(color,0.90)),rgbHex(mixWhite(color,0.82)),0.4);
  page.drawText(txt,{x:x+9,y:y-9,font:fonts.sansBold,size:8.5,color:rgbHex(mixWhite(color,0.18))});
}

function displayMathMetrics(run:Run,width:number){
  const sourceW=Math.max(8,run.width||180);
  const sourceH=Math.max(8,run.height||MATH_DISPLAY_BASE_H);
  const maxW=Math.max(80,width-28);
  const scale=Math.min(1,maxW/sourceW);
  const iw=sourceW*scale,ih=sourceH*scale;
  const padX=12,padY=7;
  return {iw,ih,cardH:ih+padY*2,padX,padY};
}
function drawDisplayMath(page:any,run:Run,x:number,topY:number,width:number,color:string){
  const m=displayMathMetrics(run,width);
  const cardW=Math.min(width,Math.max(40,m.iw+m.padX*2)),cardH=m.cardH;
  const x0=x+(width-cardW)/2,y0=topY-cardH;
  rounded(page,x0,y0,cardW,cardH,9,rgbHex("#ECEDEE"),rgbHex("#C1C2C6"),0.5);
  page.drawImage(run.image,{x:x0+(cardW-m.iw)/2,y:y0+(cardH-m.ih)/2,width:m.iw,height:m.ih});
  return {cardW,cardH};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Authentification requise"},401);
  const bearer=auth.slice(7).trim();
  const internalUserId=req.headers.get("x-aurore-user-id")?.trim()||"";
  const me=await admin.auth.getUser(bearer);
  if(me.error||!me.data.user)return out({ok:false,error:"Session utilisateur invalide"},401);
  const userId=me.data.user.id;
  if(internalUserId&&internalUserId!==userId)return out({ok:false,error:"Identité utilisateur incohérente"},403);
  let body:any;try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400);}
  const id=Number(body?.generated_document_id),pn=Number(body?.page_number);
  if(!Number.isInteger(id)||id<1||!Number.isInteger(pn)||pn<1)return out({ok:false,error:"generated_document_id et page_number requis"},400);
  const docRes=await admin.from("aurora_generated_documents").select("id,created_by,title,metadata").eq("id",id).maybeSingle();
  if(docRes.error)return out({ok:false,error:docRes.error.message},500);
  if(!docRes.data)return out({ok:false,error:"Document introuvable"},404);
  if(docRes.data.created_by&&docRes.data.created_by!==userId)return out({ok:false,error:"Accès refusé"},403);
  const input=body?.content;
  if(!input||typeof input!=="object")return out({ok:false,error:"content structuré requis"},400);
  try{
    const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
    const [fonts,logo]=await Promise.all([loadFonts(pdf),loadLogo(pdf)]);
    let page=pdf.addPage([595,842]);
    let flowPageNo=pn;
    const color=normalizeHexColor(input.theme_color)||subjectColor(input.subject||input.matiere||docRes.data.metadata?.matiere||"");
    drawSoftDecor(page,color);headerFooter(page,pn,fonts,logo,color);
    const qa:any={formulas_total:0,formulas_ok:0,formulas_failed:0,graphs_total:0,graphs_ok:0,graphs_failed:0,images_total:0,images_ok:0,images_failed:0};
    const cache=new Map<string,any>();const X=72,W=449,bottom=67,top=770;let y=top;
    const sections=Array.isArray(input.sections)?input.sections.filter((s:any)=>s&&typeof s==="object"):[];
    const contentItems:any[]=[];const exerciseItems:any[]=[];const graphItems:any[]=[];const imageItems:any[]=[];
    if(sections.length)for(const section of sections){
      const texts=Array.isArray(section.content)?section.content:[section.content];
      if(section.point&&typeof section.point==="object"){
        const p=section.point;
        const title=clean(p.title||"Point de cours"),rank=Math.max(1,Number(p.rank)||1),body=extractStructuredText(p.text||"").trim();
        if(title||body)contentItems.push({__aurore_point:true,title,rank,color:normalizeHexColor(p.color)||color,text:body});
      }else{
        for(const item of texts){const normalized=extractStructuredText(item).trim();if(normalized)contentItems.push(normalized);}
      }
      if(Array.isArray(section.exercises))exerciseItems.push(...section.exercises);
      if(Array.isArray(section.graphs))graphItems.push(...section.graphs);
      if(Array.isArray(section.images))imageItems.push(...section.images);
    }
    if(Array.isArray(input.content))input.content.forEach((x:any)=>{const normalized=extractStructuredText(x).trim();if(normalized)contentItems.push(normalized)});
    if(Array.isArray(input.exercises))exerciseItems.push(...input.exercises);
    if(Array.isArray(input.graphs))graphItems.push(...input.graphs);
    if(Array.isArray(input.images))imageItems.push(...input.images);
    if(input.assisted_block?.content?.text&&!contentItems.length){const normalized=extractStructuredText(input.assisted_block.content.text).trim();if(normalized)contentItems.push(normalized);}
    const BOX_X=X-10,BOX_W=W+20;
    function grayBlock(page:any,x:number,y:number,w:number,h:number){
      rounded(page,x,y,w,h,BOX_RADIUS,rgbHex("#E6E6E7"),rgbHex("#B6B7BA"),0.5);
    }
    const newFlowPage=()=>{
      page=pdf.addPage([595,842]);
      flowPageNo++;
      drawSoftDecor(page,color);
      headerFooter(page,flowPageNo,fonts,logo,color);
      y=top;
    };
    const ensureSpace=(height:number)=>{
      if(y-height<bottom)newFlowPage();
    };
    const drawContentBlock=async(text:any)=>{
      if(text&&typeof text==="object"&&text.__aurore_point){
        const title=String(text.title||"Point de cours"),body=String(text.text||"");
        const accent=normalizeHexColor(text.color)||color;
        const rank=Math.max(1,Number(text.rank)||1);
        const label=(rank+". "+title).trim();
        ensureSpace(31);
        page.drawText(label,{x:X,y:y-15,font:fonts.bold,size:11,color:rgbHex(accent)});
        page.drawRectangle({x:X,y:y-22,width:W,height:2.2,color:rgbHex(accent)});
        y-=31;
        if(body)await drawContentBlock(body);
        return;
      }
      const paragraphs=proseText(String(text||""));
      const preparedItems=await Promise.all(paragraphs.map(async para=>{
        const prepared=await prepareRuns(mergePlainAndExplicit(para),auth,pdf,fonts,qa,cache);
        const items:any[]=[];let inlineChunk:Run[]=[];
        const flushInline=()=>{
          if(!inlineChunk.length)return;
          const lines=layoutInline(inlineChunk,fonts.regular,TEXT_SIZE,BOX_W-24);
          if(lines.length)items.push({kind:"inline",lines});
          inlineChunk=[];
        };
        for(const run of prepared){
          if(run.kind==="display"){flushInline();items.push({kind:"display",run,metrics:displayMathMetrics(run,W-18)});}
          else inlineChunk.push(run);
        }
        flushInline();
        return items;
      }));
      const innerGap=11;
      for(const items of preparedItems){
        let cursor=0;
        while(cursor<items.length){
          const remainingPage=Math.max(0,y-bottom);
          const availableContent=Math.max(0,remainingPage-BOX_PAD_TOP-BOX_PAD_BOTTOM);
          const fragment:any[]=[];
          let used=0;
          const addItem=(item:any)=>{
            const h=item.kind==="inline"
              ? item.lines.reduce((n:number,line:any)=>n+inlineLineAdvance(line,TEXT_SIZE,LINE_HEIGHT),0)
              : item.metrics.cardH;
            const gap=fragment.length?innerGap:0;
            if(used+gap+h>availableContent)return false;
            fragment.push(item);used+=gap+h;return true;
          };
          const first=items[cursor];
          if(first?.kind==="inline"&&first.lines.length){
            const availableLines=Math.max(0,availableContent-innerGap*(fragment.length?1:0));
            const fit:number[]=[];let lineUsed=0;
            for(let li=0;li<first.lines.length;li++){
              const lh=inlineLineAdvance(first.lines[li],TEXT_SIZE,LINE_HEIGHT);
              const gap=fit.length?0:0;
              if(lineUsed+gap+lh<=availableContent){fit.push(li);lineUsed+=lh;}else break;
            }
            if(fit.length<first.lines.length){
              if(fit.length>0){
                fragment.push({kind:"inline",lines:first.lines.slice(0,fit.length)});
                used=lineUsed;
                items[cursor]={...first,lines:first.lines.slice(fit.length)};
              }
            }else if(addItem(first)){
              cursor++;
            }
          }else if(first&&addItem(first)){
            cursor++;
          }
          if(fragment.length===0){
            newFlowPage();
            continue;
          }
          const boxH=Math.max(36,BOX_PAD_TOP+used+BOX_PAD_BOTTOM);
          grayBlock(page,BOX_X,y-boxH,BOX_W,boxH);
          let childY=y-BOX_PAD_TOP;
          for(const item of fragment){
            if(item.kind==="inline"){
              drawInlineLines(page,item.lines,BOX_X+12,childY,BOX_W-24,fonts.regular,color,rgbHex("#202126"),TEXT_SIZE,LINE_HEIGHT);
              childY-=item.lines.reduce((n:any,line:any)=>n+inlineLineAdvance(line,TEXT_SIZE,LINE_HEIGHT),0)+innerGap;
            }else{
              drawDisplayMath(page,item.run,X,childY,W-18,color);
              childY-=item.metrics.cardH+innerGap;
            }
          }
          y-=boxH+BLOCK_GAP;
          if(cursor<items.length&&y-bottom<LINE_HEIGHT+BOX_PAD_TOP+BOX_PAD_BOTTOM){newFlowPage();}
        }
      }
    };
    for(const raw of contentItems)await drawContentBlock(raw);
    for(const ex of exerciseItems){
      const title=clean(ex?.title||"Exercice"),statement=clean(ex?.statement||ex?.question||ex?.enonce||ex?.content||""),hint=clean(ex?.hint||""),correctionTitle=clean(ex?.correction_title||"Corrigé"),correction=clean(ex?.correction||"");
      if(!statement)continue;
      ensureSpace(53);
      sectionLabel(page,title,X,y,fonts,color);y-=25;
      await drawContentBlock(statement);
      if(hint)await drawContentBlock("Indication : "+hint);
      if(correction){
        ensureSpace(53);
        sectionLabel(page,correctionTitle,X,y,fonts,color);y-=25;
        await drawContentBlock(correction);
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
        rounded(page,BOX_X,y-boxH,BOX_W,boxH,11,rgbHex(mixWhite(color,0.988)),rgbHex(mixWhite(color,0.70)),0.45);
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
        rounded(page,X-11,y-boxH,W+22,boxH,10,rgbHex(mixWhite(color,0.988)),rgbHex(mixWhite(color,0.70)),0.45);
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
    const path="aurora-content-pages/"+userId+"/"+id+"/page-"+String(pn).padStart(4,"0")+".pdf";
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
      pdf_page_count:flowPageNo-pn+1
    };
    const saved=await admin.from("aurora_generated_documents").update({
      pdf_path:path,pdf_url:pageUrl,metadata:patch,updated_at:new Date().toISOString()
    }).eq("id",id).eq("created_by",userId);
    if(saved.error)return out({ok:false,error:saved.error.message},500);
    return out({
      ok:true,mode:"instant-page",engine:"pdf-lib-course-page-v2",
      generated_document_id:id,page_number:pn,page_path:path,page_url:pageUrl,
      bytes:bytes.length,page_count:flowPageNo-pn+1,qa
    });
  }catch(e){
    return out({ok:false,generated_document_id:id,page_number:pn,error:e instanceof Error?e.message:String(e)},409);
  }
});