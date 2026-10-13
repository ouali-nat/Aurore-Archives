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
const TITLE_SEQUENCE_COLORS=["#2563EB","#DC2626","#15803D","#C2410C","#7C3AED","#0E7490","#A16207","#BE185D"];
const BLOCK_GAP=16;
const BOX_RADIUS=11;
const BOX_PAD_TOP=11;
const BOX_PAD_BOTTOM=11;
const POINT_SPINE_X=12;
const POINT_BOX_X=88;
const POINT_SIDE_GAP=7;
const POINT_MAX_W=454;
const MATH_DISPLAY_BASE_H=24;
const MATH_EX_PX=7.54;
const MATH_RASTER_SCALE=3;
const MATH_INLINE_PAD_X=7;
const MATH_INLINE_GAP=12;
const MATH_INLINE_PAD_Y=3.5;
const FONT_URLS={
  regular:"https://raw.githubusercontent.com/google/fonts/main/ofl/tinos/Tinos-Regular.ttf",
  bold:"https://raw.githubusercontent.com/google/fonts/main/ofl/tinos/Tinos-Bold.ttf",
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
  // Garder les commandes LaTeX originales : ne pas supprimer gras, symboles,
  // fractions, racines, indices, exposants ou séparateurs de matrices.
  const source=String(v??"").normalize("NFC");
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

type Run={kind:"text"|"math"|"display"; value:string; image?:any; pdfPage?:any; width?:number; height?:number};

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

const VECTOR_FNS:Record<string,(x:number)=>number>={sin:Math.sin,cos:Math.cos,tan:Math.tan,exp:Math.exp,ln:Math.log,sqrt:Math.sqrt,abs:Math.abs};
function compileVectorExpr(src:string):(x:number)=>number{
  const text=String(src||"").replace(/\s+/g,"").replace(/\*\*/g,"^").replace(/−/g,"-").replace(/π/g,"pi");
  if(!text||text.length>120)throw new Error("expression vide ou trop longue");
  const tokens:string[]=text.match(/\d+\.?\d*|\.\d+|[a-z]+|[-+*/^()]/g)||[];
  if(tokens.join("")!==text)throw new Error("caractère non autorisé");
  let i=0;const peek=()=>tokens[i],next=()=>tokens[i++];
  function primary():(x:number)=>number{
    const t=next();if(t===undefined)throw new Error("expression incomplète");
    if(/^[\d.]/.test(t)){const v=Number(t);if(!Number.isFinite(v))throw new Error("nombre invalide");return()=>v}
    if(t==="x")return(x)=>x;if(t==="pi")return()=>Math.PI;if(t==="e")return()=>Math.E;
    if(t==="("){const f=add();if(next()!==")")throw new Error("parenthèse manquante");return f}
    if(VECTOR_FNS[t]){if(next()!=="(")throw new Error("fonction sans parenthèse");const f=add();if(next()!==")")throw new Error("parenthèse manquante");const fn=VECTOR_FNS[t];return(x)=>fn(f(x))}
    throw new Error("terme interdit "+t);
  }
  function pow():(x:number)=>number{const f=primary();if(peek()==="^"){next();const r=unary();return(x)=>Math.pow(f(x),r(x))}return f}
  function unary():(x:number)=>number{if(peek()==="-"){next();const f=unary();return(x)=>-f(x)}if(peek()==="+"){next();return unary()}return pow()}
  function mul():(x:number)=>number{let f=unary();while(peek()==="*"||peek()==="/"){const op=next(),r=unary(),l=f;f=op==="*"?(x)=>l(x)*r(x):(x)=>l(x)/r(x)}return f}
  function add():(x:number)=>number{let f=mul();while(peek()==="+"||peek()==="-"){const op=next(),r=mul(),l=f;f=op==="+"?(x)=>l(x)+r(x):(x)=>l(x)-r(x)}return f}
  const f=add();if(i<tokens.length)throw new Error("expression mal formée");return f;
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
  // Deux polices seulement, sous-ensemblées aux glyphes effectivement utilisés.
  const [regular,bold]=await Promise.all([
    fetchFontBytes("regular",FONT_URLS.regular),
    fetchFontBytes("bold",FONT_URLS.bold)
  ]);
  const regularFont=await pdf.embedFont(regular,{subset:true});
  const boldFont=await pdf.embedFont(bold,{subset:true});
  return {regular:regularFont,bold:boldFont,sans:regularFont,sansBold:boldFont};
}
function noteFormulaFailure(qa:any,key:string,reason:string){
  if(!Array.isArray(qa.formula_errors))qa.formula_errors=[];
  if(qa.formula_errors.length<8)qa.formula_errors.push({formula:key.slice(0,100),reason:String(reason||"Échec inconnu").slice(0,180)});
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
function readableLatexFallback(source:string){
  let value=normalizeUnicodeMathText(source);
  value=value
    .replace(/\\(?:left|right)\\?/g,"")
    .replace(/\\text\s*\{([^{}]*)\}/g,"$1")
    .replace(/\\mathrm\s*\{([^{}]*)\}/g,"$1")
    .replace(/\\mathbb\s*\{([A-Za-z])\}/g,"$1")
    .replace(/\\mathcal\s*\{([A-Za-z])\}/g,"$1")
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,"($1)/($2)");
  const symbols:any={
    Omega:"Ω",omega:"ω",varnothing:"∅",emptyset:"∅",infty:"∞",
    bigcup:"⋃",bigcap:"⋂",cup:"∪",cap:"∩",subseteq:"⊆",subset:"⊂",
    notin:"∉",in:"∈",leq:"≤",geq:"≥",neq:"≠",approx:"≈",
    times:"×",cdot:"·",pm:"±",to:"→",Rightarrow:"⇒",Longleftrightarrow:"⇔",
    forall:"∀",exists:"∃",alpha:"α",beta:"β",gamma:"γ",delta:"δ",
    lambda:"λ",mu:"μ",pi:"π",sigma:"σ",varphi:"φ",phi:"φ"
  };
  value=value.replace(/\\([A-Za-z]+)\b/g,(whole,command)=>symbols[command]||command);
  value=value.replace(/\\[,;:!]/g," ").replace(/[{}]/g,"");
  return value.replace(/\s+/g," ").trim();
}
async function prepareRuns(runs:Run[],auth:string,pdf:any,_fonts:any,qa:any,cache:Map<string,any>){
  // MathJax génère un petit PDF vectoriel par formule; aucune formule n'est rasterisée en PNG.
  const descriptorsByIndex=runs.map(run=>run.kind==="text"?null:{
    latex:latexInput(stripInlineDelimiters(run.value)).trim(),
    display:run.kind==="display"
  });
  const keysByIndex=descriptorsByIndex.map(item=>item?JSON.stringify(item):"");
  const uniqueKeys=Array.from(new Set(keysByIndex.filter(Boolean)));
  const pendingKeys:string[]=[];
  const resolvePending=new Map<string,(page:any)=>void>();
  for(const key of uniqueKeys){
    if(cache.has(key))continue;
    let resolvePage:(page:any)=>void=()=>{};
    cache.set(key,new Promise(resolve=>{resolvePage=resolve as any;}));
    pendingKeys.push(key);
    resolvePending.set(key,resolvePage);
  }
  const settleFailure=(key:string,reason:string)=>{
    qa.formulas_failed++;
    noteFormulaFailure(qa,key,reason);
    resolvePending.get(key)?.(null);
  };
  if(pendingKeys.length){
    qa.formulas_total+=pendingKeys.length;
    try{
      const response=await fetch(MATH_URL,{
        method:"POST",
        headers:{Authorization:auth,"Content-Type":"application/json"},
        body:JSON.stringify({formulas:pendingKeys.map(key=>JSON.parse(key)),px_per_ex:MATH_EX_PX,format:"pdf-vector"}),
        signal:AbortSignal.timeout(30000)
      });
      const payload:any=await response.json().catch(()=>null);
      if(!response.ok||!payload?.ok||!Array.isArray(payload?.results)){
        const reason=!response.ok?"math vector renderer HTTP "+response.status:String(payload?.error||"Réponse du moteur mathématique vectoriel invalide");
        for(const key of pendingKeys)settleFailure(key,reason);
      }else{
        for(let i=0;i<pendingKeys.length;i++){
          const key=pendingKeys[i],result=payload.results[i];
          const pdfBase64=typeof result?.pdf_base64==="string"?result.pdf_base64:null;
          if(!pdfBase64){settleFailure(key,"PDF vectoriel absent pour la formule "+String(i+1)+"/"+String(pendingKeys.length));continue;}
          try{
            const binary=atob(pdfBase64),bytes=new Uint8Array(binary.length);
            for(let j=0;j<binary.length;j++)bytes[j]=binary.charCodeAt(j);
            const embeddedPages=await pdf.embedPdf(bytes);
            const embeddedPage=embeddedPages?.[0];
            if(!embeddedPage)throw new Error("Le PDF de formule ne contient aucune page.");
            qa.formulas_ok++;
            resolvePending.get(key)?.({
              pdfPage:embeddedPage,
              width:Number(result?.natural_pt_width)||embeddedPage.width,
              height:Number(result?.natural_pt_height)||embeddedPage.height
            });
          }catch(error){
            settleFailure(key,String((error as any)?.message||error));
          }
        }
      }
    }catch(error){
      const reason=String((error as any)?.message||error);
      for(const key of pendingKeys)settleFailure(key,reason);
    }
  }
  const pagesByKey=new Map<string,any>();
  await Promise.all(uniqueKeys.map(async key=>pagesByKey.set(key,await cache.get(key))));
  return runs.map((run,index)=>{
    if(run.kind==="text")return {kind:"text",value:run.value} as Run;
    const key=keysByIndex[index],rendered=key?pagesByKey.get(key):null;
    if(rendered?.pdfPage)return {kind:run.kind,value:run.value,pdfPage:rendered.pdfPage,width:rendered.width,height:rendered.height} as Run;
    // Erreur de rendu exceptionnelle : conserver le code LaTeX brut,
    // au lieu de le remplacer par une pseudo-formule ou une image.
    const raw=String(run.value||"").trim();
    return {kind:run.kind,value:raw,width:Math.max(24,raw.length*5.5),height:18} as Run;
  });
}

function layoutInline(prepared:Run[],font:any,size:number,max:number){
  const lines:any[][]=[[]];let width=0;
  const spaceWidth=tokenTextWidth(font,size," ");
  const startLine=()=>{lines.push([]);width=0;};

  const addWord=(word:string)=>{
    const cleanWord=String(word||"");
    if(!cleanWord)return;
    const wordWidth=tokenTextWidth(font,size,cleanWord);
    const space=lines[lines.length-1].length?spaceWidth:0;

    // A word/token wider than the inner box must itself be split so that
    // no prose, URL or math fallback can escape the rounded container.
    if(wordWidth>max){
      if(lines[lines.length-1].length)startLine();
      let chunk="";
      let chunkWidth=0;
      for(const ch of Array.from(cleanWord)){
        const cw=tokenTextWidth(font,size,ch);
        if(chunk&&chunkWidth+cw>max){
          lines[lines.length-1].push({
            kind:"text",value:chunk,width:chunkWidth,space:lines[lines.length-1].length?spaceWidth:0
          });
          width+=chunkWidth+(lines[lines.length-1].length>1?spaceWidth:0);
          startLine();
          chunk=ch;chunkWidth=cw;
        }else{
          chunk+=ch;chunkWidth+=cw;
        }
      }
      if(chunk){
        lines[lines.length-1].push({
          kind:"text",value:chunk,width:chunkWidth,space:lines[lines.length-1].length?spaceWidth:0
        });
        width+=chunkWidth+(lines[lines.length-1].length>1?spaceWidth:0);
      }
      return;
    }

    if(width+space+wordWidth>max&&lines[lines.length-1].length){
      startLine();
    }
    const sp=lines[lines.length-1].length?spaceWidth:0;
    lines[lines.length-1].push({kind:"text",value:cleanWord,width:wordWidth,space:sp});
    width+=sp+wordWidth;
  };

  const addText=(v:string)=>{
    const words=String(v??"").replace(/\s+/g," ").trim().split(" ").filter(Boolean);
    for(const word of words)addWord(word);
  };

  const addMath=(r:Run)=>{
    const naturalW=Math.max(8,Number(r.width)||Number(r.pdfPage?.width)||24);
    const naturalH=Math.max(8,Number(r.height)||Number(r.pdfPage?.height)||18);
    const available=Math.max(12,max-MATH_INLINE_PAD_X*2);
    const scale=Math.min(1,available/naturalW);
    const drawW=naturalW*scale,drawH=naturalH*scale;
    const outerW=Math.min(Math.max(24,max),drawW+MATH_INLINE_PAD_X*2);
    const outerH=Math.max(20,drawH+MATH_INLINE_PAD_Y*2);
    const space=lines[lines.length-1].length?MATH_INLINE_GAP:0;
    if(width+space+outerW>max&&lines[lines.length-1].length)startLine();
    const sp=lines[lines.length-1].length?MATH_INLINE_GAP:0;
    lines[lines.length-1].push({kind:"math",value:r.value,pdfPage:r.pdfPage,drawW,drawH,width:outerW,height:outerH,space:sp});
    width+=sp+outerW;
  };
  for(const r of prepared){if(r.kind==="text")addText(r.value);else if(r.kind==="math")addMath(r);}
  return lines.filter(x=>x.length);
}
function inlineLineAdvance(line:any[],size=TEXT_SIZE,lineHeight=LINE_HEIGHT){
  const maxMathBoxH=Math.max(
    0,
    ...line.filter(t=>t.kind==="math").map(t=>Math.max(20,t.height||10))
  );
  return Math.max(lineHeight,maxMathBoxH);
}

function drawInlineLines(page:any,lines:any[],x:number,topY:number,width:number,font:any,borderColor:any,textColor:any,size=TEXT_SIZE,lineHeight=LINE_HEIGHT){
  let y=topY;
  const boxPadX=MATH_INLINE_PAD_X,boxPadY=MATH_INLINE_PAD_Y;

  for(const line of lines){
    const advance=inlineLineAdvance(line,size,lineHeight);
    const lineWidth=line.reduce(
      (sum:number,token:any)=>sum+(token.space||0)+(token.width||0),0
    );
    // Prose lines follow a normal editorial left edge; only a line made solely of inline math stays centered.
    const pureMath=line.length>0&&line.every((token:any)=>token.kind==="math");
    const startX=pureMath?x+Math.max(0,(width-lineWidth)/2):x;
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
        const bh=Math.max(20,token.height||20),outerW=Math.max(24,token.width||24),by=lineCenter-bh/2;
        rounded(page,cx,by,outerW,bh,6,rgbHex("#FBFBFC"),rgbHex("#C7C9D0"),0.45);
        if(token.pdfPage){
          page.drawPage(token.pdfPage,{x:cx+boxPadX,y:lineCenter-(token.drawH||12)/2,width:token.drawW||outerW-2*boxPadX,height:token.drawH||bh-2*boxPadY});
        }else{
          const raw=String(token.value||""),fallbackSize=8;
          page.drawText(escapePdfText(raw),{x:cx+boxPadX,y:lineCenter-fallbackSize*0.34,font,size:fallbackSize,color:textColor});
        }
        cx+=outerW;
      }
    }
    y-=advance;
  }
  return y;
}

const AURORE_BUBBLE_PALETTES: Array<[string,string,string]> = [
  ["8B5CF6","C084FC","6D28D9"],
  ["E05260","FF8A96","C93648"],
  ["2FA66A","75D89C","198754"],
  ["3B82F6","7DB3FF","1D4ED8"],
  ["D5A51B","F5D36B","B77900"],
  ["E8791A","FFB36B","C85C0D"],
  ["0891B2","67E8F9","0E7490"],
  ["DB2777","F9A8D4","BE185D"],
  ["6366F1","A5B4FC","4338CA"],
  ["14B8A6","67E8F9","0F766E"],
  ["10B981","6EE7B7","047857"],
  ["84CC16","BEF264","4D7C0F"],
  ["0D9488","5EEAD4","115E59"],
  ["D946EF","F0ABFC","A21CAF"],
  ["C026D3","F0ABFC","86198F"],
  ["F06A57","FFB4A8","C2412D"],
  ["9F1239","FB7185","881337"],
  ["9333EA","D8B4FE","6B21A8"],
  ["7E22CE","C084FC","581C87"],
  ["D4A017","F6D365","9A6700"],
  ["F59E0B","FCD34D","B45309"],
  ["10B981","A7F3D0","047857"],
  ["0EA5E9","7DD3FC","0369A1"],
  ["8B5CF6","DDD6FE","6D28D9"],
  ["EAB308","FDE68A","A16207"],
  ["2563EB","93C5FD","1E3A8A"],
  ["0F4C5C","67E8F9","0B3440"],
  ["0284C7","38BDF8","075985"],
  ["0EA5E9","BAE6FD","0369A1"],
  ["64748B","CBD5E1","334155"],
  ["52525B","D4D4D8","27272A"],
  ["16A34A","86EFAC","166534"],
  ["047857","A7F3D0","065F46"],
  ["65A30D","BEF264","3F6212"],
  ["84CC16","D9F99D","4D7C0F"],
  ["F97316","FED7AA","C2410C"],
  ["D97706","FCD34D","92400E"],
  ["C2410C","FDBA74","9A3412"],
  ["E11D48","FDA4AF","9F1239"],
  ["8B5CF6","E9D5FF","6D28D9"],
  ["6366F1","C7D2FE","3730A3"],
  ["0891B2","CFFAFE","155E75"],
  ["B7791F","FEF3C7","854D0E"],
  ["92400E","D6B38C","451A03"],
  ["0D9488","99F6E4","0F5257"]
];
function resolveBubblePalette(hex:string){
  const raw=(normalizeHexColor(hex)||"#6D28D9").toUpperCase();
  const match=AURORE_BUBBLE_PALETTES.find(([primary,secondary,strong])=>
    [primary,secondary,strong].some(value=>("#"+value)===raw)
  );
  return match
    ? {primary:"#"+match[0],secondary:"#"+match[1],strong:"#"+match[2]}
    : {primary:raw,secondary:raw,strong:raw};
}
function drawSoftDecor(page:any,color:string,pageNo=1){
  const W=595,H=842;
  const palette=resolveBubblePalette(color);
  const p1=palette.primary,p2=palette.secondary,ps=palette.strong;
  page.drawRectangle({x:0,y:0,width:W,height:H,color:rgbHex(mixWhite(p1,0.965))});
  const odd=pageNo%2===1;
  const halo=(cx:number,cy:number,radii:number[],col:string,base:number)=>{
    radii.forEach((r,i)=>page.drawCircle({x:cx,y:cy,size:r,color:rgbHex(col),opacity:base+i*0.018}));
  };
  const ring=(cx:number,cy:number,r:number,col:string,w:number,op:number)=>{
    page.drawCircle({x:cx,y:cy,size:r,borderColor:rgbHex(col),borderWidth:w,borderOpacity:op});
  };
  const big=odd?{cx:W-18,cy:H-26}:{cx:W-18,cy:70};
  const small=odd?{cx:W-8,cy:96}:{cx:W-8,cy:H-110};
  halo(big.cx,big.cy,[150,118,88,60],p2,0.07);
  ring(big.cx,big.cy,172,p2,0.8,0.40);
  ring(big.cx,big.cy,140,p1,0.5,0.30);
  halo(small.cx,small.cy,[58,40,24],p1,0.07);
  ring(small.cx,small.cy,74,p2,0.6,0.35);
  page.drawCircle({x:44,y:H+4,size:36,color:rgbHex(p2),opacity:0.16});
  ring(44,H+4,52,p1,0.6,0.35);
  page.drawCircle({x:64,y:-2,size:32,color:rgbHex(p1),opacity:0.13});
  ring(64,-2,46,p2,0.6,0.35);
  const curveY=odd?H-330:H-250;
  page.drawSvgPath("M 0 0 C -46 60, -52 150, -8 230",{x:W-2,y:curveY,borderColor:rgbHex(ps),borderWidth:0.7,borderOpacity:0.28});
  page.drawSvgPath("M 0 0 C -30 50, -34 120, -4 190",{x:W-2,y:curveY-18,borderColor:rgbHex(p2),borderWidth:0.5,borderOpacity:0.30});
  for(let i=0;i<7;i++){
    const r=2.6-i*0.28;
    page.drawCircle({x:W-14-i*0.4,y:(odd?H-420:H-340)-i*17,size:Math.max(0.9,r),color:rgbHex(ps),opacity:0.30-i*0.03});
  }
  page.drawCircle({x:W-30,y:odd?H-296:H-216,size:5,color:rgbHex(p2),opacity:0.35});
  page.drawCircle({x:30,y:odd?186:H-190,size:3.2,color:rgbHex(p2),opacity:0.28});
}
function headerFooter(page:any,pageNo:number,fonts:any,logo:any,color:string){
  if(logo){
    const scale=Math.min(17/(logo.width||17),17/(logo.height||17));
    page.drawImage(logo,{x:39,y:805,width:logo.width*scale,height:logo.height*scale});
  }
  const accent=rgbHex(mixWhite(color,0.25));
  const label="Section Archives";
  const lw=fonts.sans.widthOfTextAtSize(label,9.6);
  page.drawText(label,{x:556-lw,y:807,font:fonts.sans,size:9.6,color:accent});
  page.drawCircle({x:556-lw-9,y:811.4,size:2.2,color:rgbHex(color)});
  page.drawLine({start:{x:39,y:795},end:{x:556,y:795},thickness:0.6,color:rgbHex(mixWhite(color,0.72))});
  page.drawLine({start:{x:39,y:795},end:{x:99,y:795},thickness:1.8,color:rgbHex(mixWhite(color,0.30))});
  const cx=297.5,cy=34,num=String(pageNo);
  page.drawLine({start:{x:150,y:cy},end:{x:cx-16,y:cy},thickness:0.6,color:rgbHex(mixWhite(color,0.65))});
  page.drawLine({start:{x:cx+16,y:cy},end:{x:445,y:cy},thickness:0.6,color:rgbHex(mixWhite(color,0.65))});
  page.drawCircle({x:150,y:cy,size:1.8,color:rgbHex(mixWhite(color,0.40))});
  page.drawCircle({x:445,y:cy,size:1.8,color:rgbHex(mixWhite(color,0.40))});
  page.drawCircle({x:cx,y:cy,size:11,color:rgbHex(mixWhite(color,0.90)),borderColor:rgbHex(mixWhite(color,0.30)),borderWidth:0.8});
  const nw=fonts.sansBold.widthOfTextAtSize(num,9);
  page.drawText(num,{x:cx-nw/2,y:cy-3.1,font:fonts.sansBold,size:9,color:rgbHex(color)});
  const foot="Aurore — Section Archives";
  const fw=fonts.sans.widthOfTextAtSize(foot,8);
  page.drawText(foot,{x:cx-fw/2,y:14,font:fonts.sans,size:8,color:rgbHex("#8A8C97")});
}
function sectionLabel(page:any,label:string,x:number,y:number,fonts:any,color:string){
  const txt=clean(label);
  if(!txt)return;
  const w=Math.min(180,fonts.sansBold.widthOfTextAtSize(txt,8.5)+18);
  rounded(page,x,y-13,w,18,7,rgbHex(mixWhite(color,0.90)),rgbHex(mixWhite(color,0.82)),0.4);
  page.drawText(txt,{x:x+9,y:y-9,font:fonts.sansBold,size:8.5,color:rgbHex(mixWhite(color,0.18))});
}

// Les titres d’exercice et de corrigé s’adaptent à leur texte, sans couper les libellés.
function adaptiveExerciseLabelLayout(label:string,fonts:any,x:number){
  const txt=clean(label);
  const maxWidth=Math.max(120,595-x-26);
  const wrapped=wrap(txt,fonts.sansBold,8.5,maxWidth-18);
  const lines=wrapped.length?wrapped:[txt];
  const widths=lines.map((line:string)=>fonts.sansBold.widthOfTextAtSize(line,8.5));
  const width=lines.length>1?maxWidth:Math.min(maxWidth,Math.max(66,Math.ceil(Math.max(0,...widths))+18));
  const height=Math.max(18,lines.length*10+8);
  return {lines,width,height,drop:height+13};
}
function drawAdaptiveExerciseLabel(page:any,label:string,x:number,y:number,fonts:any,color:string,layout?:any){
  const m=layout||adaptiveExerciseLabelLayout(label,fonts,x);
  rounded(page,x,y-(m.height-5),m.width,m.height,7,
    rgbHex(mixWhite(color,0.90)),rgbHex(mixWhite(color,0.82)),0.4);
  for(let i=0;i<m.lines.length;i++){
    page.drawText(escapePdfText(m.lines[i]),{
      x:x+9,y:y-9-i*10,font:fonts.sansBold,size:8.5,
      color:rgbHex(mixWhite(color,0.18))
    });
  }
  return m;
}

let DISPLAY_FORMULA_FONT:any=null;
function displayMathMetrics(run:Run,width:number){
  const maxW=Math.max(80,width-28),padX=12,padY=7;
  const naturalW=Math.max(8,Number(run.width)||Number(run.pdfPage?.width)||180);
  const naturalH=Math.max(8,Number(run.height)||Number(run.pdfPage?.height)||24);
  const scale=Math.min(1,maxW/naturalW),drawW=naturalW*scale,drawH=naturalH*scale;
  return {cardW:Math.min(width,Math.max(40,drawW+padX*2)),cardH:drawH+padY*2,padX,padY,maxW,drawW,drawH};
}
function drawDisplayMath(page:any,run:Run,x:number,topY:number,width:number,color:string){
  const m=displayMathMetrics(run,width),cardW=m.cardW,cardH=m.cardH,x0=x+(width-cardW)/2,y0=topY-cardH;
  rounded(page,x0,y0,cardW,cardH,7,rgbHex("#FBFBFC"),rgbHex("#C7C9D0"),0.5);
  if(run.pdfPage){
    page.drawPage(run.pdfPage,{x:x0+(cardW-m.drawW)/2,y:y0+(cardH-m.drawH)/2,width:m.drawW,height:m.drawH});
  }else{
    page.drawText(escapePdfText(String(run.value||"")),{x:x0+m.padX,y:y0+m.padY+4,font:DISPLAY_FORMULA_FONT,size:8,color:rgbHex("#292B31")});
  }
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
  const userId=me.data.user.id; const activeProfile=await admin.from("Profils").select("role,banni").eq("id",userId).maybeSingle(); if(activeProfile.error||!activeProfile.data||activeProfile.data.banni===true)return out({ok:false,error:"Compte suspendu ou profil non autorisé"},403); const isAdmin=/^(admin|administrateur)$/i.test(String(activeProfile.data.role||""));
  if(internalUserId&&internalUserId!==userId)return out({ok:false,error:"Identité utilisateur incohérente"},403);
  let body:any;try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400);}
  const id=Number(body?.generated_document_id),pn=Number(body?.page_number);
  if(!Number.isInteger(id)||id<1||!Number.isInteger(pn)||pn<1)return out({ok:false,error:"generated_document_id et page_number requis"},400);
  const docRes=await admin.from("aurora_generated_documents").select("id,created_by,title,metadata").eq("id",id).maybeSingle();
  if(docRes.error)return out({ok:false,error:docRes.error.message},500);
  if(!docRes.data)return out({ok:false,error:"Document introuvable"},404);
  if(docRes.data.created_by!==userId&&!isAdmin)return out({ok:false,error:"Accès refusé"},403); if(!docRes.data.created_by&&!isAdmin)return out({ok:false,error:"Accès refusé"},403); const assetOwnerId=String(docRes.data.created_by||userId);
  const input=body?.content;
  if(!input||typeof input!=="object")return out({ok:false,error:"content structuré requis"},400); const hasForeignAssetPath=(v:any):boolean=>{if(Array.isArray(v))return v.some(hasForeignAssetPath);if(!v||typeof v!=="object")return false;for(const k of ["geogebra_image_path","graph_local_path"]){const path=(v as any)[k];if(typeof path==="string"&&path.trim()&&(!path.startsWith(`aurora-content/${assetOwnerId}/`)||path.includes("..")))return true;}return Object.values(v).some(hasForeignAssetPath);}; if(hasForeignAssetPath(input))return out({ok:false,error:"Chemin GeoGebra non autorisé"},403);
  try{
    const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
    const [fonts,logo]=await Promise.all([loadFonts(pdf),loadLogo(pdf)]);
    DISPLAY_FORMULA_FONT=fonts.regular;
    let page=pdf.addPage([595,842]);
    const railPages:any[]=[page];
    let flowPageNo=pn;
    const color=normalizeHexColor(input.theme_color)||subjectColor(input.subject||input.matiere||docRes.data.metadata?.matiere||"");
    drawSoftDecor(page,color,pn);headerFooter(page,pn,fonts,logo,color);
    const qa:any={formula_renderer:"mathjax-svg-to-vector-pdf-v1",formula_pngs:0,formulas_total:0,formulas_ok:0,formulas_failed:0,formula_errors:[],graphs_total:0,graphs_ok:0,graphs_failed:0,images_total:0,images_ok:0,images_failed:0,scenes_total:0,scenes_ok:0,scenes_failed:0,scene_errors:[]};
    const cache=new Map<string,any>();const X=72,W=449,bottom=67,top=770;let y=top;
    const sections=Array.isArray(input.sections)?input.sections.filter((s:any)=>s&&typeof s==="object"):[];
    const contentItems:any[]=[];const exerciseItems:any[]=[];const graphItems:any[]=[];const imageItems:any[]=[];const vectorSceneItems:any[]=[];
    const orderedFlowItems:any[]=[];
    const pointAnchors:any[]=[];
    const titleAnchors:any[]=[];
    let titleColorCursor=0;
    const nextTitleColor=()=>TITLE_SEQUENCE_COLORS[titleColorCursor++%TITLE_SEQUENCE_COLORS.length];
    // Keep adjacent paragraphs in the same chapter, but draw their chapter heading only once.
    let lastRenderedPointLabel="";
    if(sections.length)for(const section of sections){
      const texts=Array.isArray(section.content)?section.content:[section.content];
      const blockId=String(section.assisted_block_id||section.block_id||section.assisted_block?.id||"");
      if(section.point&&typeof section.point==="object"){
        const p=section.point;
        const title=clean(p.title||"Point de cours"),rank=Math.max(1,Number(p.rank)||1),body=extractStructuredText(p.text||"").trim();
        const pointItem={__aurore_point:true,title,rank,color:normalizeHexColor(p.color)||color,text:body};
        if(title||body){contentItems.push(pointItem);orderedFlowItems.push({kind:"content",value:pointItem,blockId});}
      }else{
        for(const item of texts){
          const normalized=extractStructuredText(item).trim();
          if(normalized){contentItems.push(normalized);orderedFlowItems.push({kind:"content",value:normalized,blockId});}
        }
      }
      if(Array.isArray(section.exercises)){
        exerciseItems.push(...section.exercises);
        for(const exercise of section.exercises)orderedFlowItems.push({kind:"exercise",value:exercise,blockId:String(blockId||exercise?.exercise_id||exercise?.id||"")});
      }
      if(Array.isArray(section.graphs)){
        graphItems.push(...section.graphs);
        for(const graph of section.graphs)orderedFlowItems.push({kind:"graph",value:graph,blockId});
      }
      if(Array.isArray(section.images)){
        imageItems.push(...section.images);
        for(const image of section.images)orderedFlowItems.push({kind:"image",value:image,blockId});
      }
      if(Array.isArray(section.vector_scenes)){
        vectorSceneItems.push(...section.vector_scenes);
        for(const scene of section.vector_scenes)orderedFlowItems.push({kind:"scene",value:scene,blockId});
      }
    }
    // Le contrat courant envoie les mêmes contenus dans sections (structure éditoriale)
    // et dans les tableaux racine (compatibilité historique). Ne jamais consommer les deux :
    // cela réimprime les chapitres et exercices sur les pages suivantes.
    if(!sections.length){
      if(Array.isArray(input.content))input.content.forEach((x:any)=>{const normalized=extractStructuredText(x).trim();if(normalized)contentItems.push(normalized)});
      if(Array.isArray(input.exercises))exerciseItems.push(...input.exercises);
      if(Array.isArray(input.graphs))graphItems.push(...input.graphs);
      if(Array.isArray(input.images))imageItems.push(...input.images);
      if(Array.isArray(input.vector_scenes))vectorSceneItems.push(...input.vector_scenes);
    }
    if(input.assisted_block?.content?.text&&!contentItems.length){
      const normalized=extractStructuredText(input.assisted_block.content.text).trim();
      if(normalized)contentItems.push(normalized);
    }
    const useOrderedAssistedFlow=input.assisted_block?.mixed_flow===true
      &&Array.isArray(input.assisted_block?.flow_block_ids)
      &&input.assisted_block.flow_block_ids.length>1
      &&orderedFlowItems.length>1;
    const BOX_X=X-10,BOX_W=W+32;
    const PARA_X=X+18,PARA_W=W-6;
    const POINT_X=POINT_BOX_X,POINT_W=POINT_MAX_W;
    
    
const newFlowPage=()=>{
      page=pdf.addPage([595,842]);
      railPages.push(page);
      flowPageNo++;
      drawSoftDecor(page,color,flowPageNo);
      headerFooter(page,flowPageNo,fonts,logo,color);
      y=top;
    };
    const ensureSpace=(height:number)=>{
      if(y-height<bottom)newFlowPage();
    };
    const flowPageMap:Record<string,number>={};
    const flowPageEndMap:Record<string,number>={};
    const markFlowBlockPage=(blockId:any)=>{const key=String(blockId||"").trim();if(!key)return;if(!Object.prototype.hasOwnProperty.call(flowPageMap,key))flowPageMap[key]=flowPageNo;flowPageEndMap[key]=flowPageNo;};
    const drawContentBlock=async(text:any,blockId?:any)=>{
      if(text&&typeof text==="object"&&text.__aurore_point){
        const title=String(text.title||"Point de cours"),body=String(text.text||"");
        const accent=normalizeHexColor(text.color)||color;
        const sequenceTitleColor=nextTitleColor();
        const titleAccent=accent.toUpperCase()==="#6D28D9"?sequenceTitleColor:accent;
        const rank=Math.max(1,Number(text.rank)||1);
        const label=(rank+". "+title).trim();
        const repeatedPointTitle=label===lastRenderedPointLabel;
        lastRenderedPointLabel=label;
        // Géométrie unique du bloc paragraphe : le calcul des lignes et le dessin
        // utilisent exactement la même largeur pour empêcher tout débordement.
        const titleX=28;
        const bodyX=POINT_BOX_X;
        const bodyW=POINT_MAX_W;
        const bodyTextW=bodyW;
        const pointItems:any[]=[];
        for(const para of proseText(body)){
          const prepared=await prepareRuns(mergePlainAndExplicit(para),auth,pdf,fonts,qa,cache);
          let inlineChunk:Run[]=[];
          const flush=()=>{
            if(!inlineChunk.length)return;
            const lines=layoutInline(inlineChunk,fonts.regular,TEXT_SIZE,bodyTextW);
            if(lines.length)pointItems.push({kind:"inline",lines});
            inlineChunk=[];
          };
          for(const run of prepared){
            if(run.kind==="display"){flush();pointItems.push({kind:"display",run,metrics:displayMathMetrics(run,bodyTextW)});}
            else inlineChunk.push(run);
          }
          flush();
        }
        if(!pointItems.length)pointItems.push({kind:"inline",lines:[]});
        let cursor=0;
        let continuation=false;
        // A single point can contain several paragraphs: its heading is pending
        // only until the first body fragment is actually drawn.
        let pointTitlePending=!repeatedPointTitle;
        while(cursor<pointItems.length){
           const remainingPage=Math.max(0,y-bottom);
           const titleFontSize=12.6,titleLineHeight=15.5,titlePadY=8;
           const titleMaxW=Math.max(120,BOX_W-46);
           const titleLines=wrap(label,fonts.sansBold,titleFontSize,titleMaxW-24);
           const titleMeasuredW=Math.max(0,...titleLines.map((line:string)=>fonts.sansBold.widthOfTextAtSize(line,titleFontSize)));
           const titleW=Math.min(BOX_W-22,Math.max(120,Math.ceil(titleMeasuredW)+24));
           const showPointTitle=!continuation&&pointTitlePending;
           const titleH=showPointTitle?Math.max(30,titlePadY*2+titleLines.length*titleLineHeight):0;
           const separatorGap=showPointTitle?12:0;
           const availableContent=Math.max(0,remainingPage-titleH-separatorGap-BOX_PAD_TOP-BOX_PAD_BOTTOM-6);
           const fragment:any[]=[];let used=0;const gap=7;
           const addPointItem=(item:any)=>{
             const itemH=item.kind==="inline"?item.lines.reduce((n:number,line:any)=>n+inlineLineAdvance(line,TEXT_SIZE,LINE_HEIGHT),0):item.metrics.cardH;
             const g=fragment.length?gap:0;
             if(used+g+itemH>availableContent)return false;
             fragment.push(item);used+=g+itemH;return true;
           };
           const first=pointItems[cursor];
           let splitThisPage=false;
           if(first?.kind==="inline"&&first.lines.length){
             const fit:number[]=[];let lineUsed=0;
             for(let li=0;li<first.lines.length;li++){
               const lh=inlineLineAdvance(first.lines[li],TEXT_SIZE,LINE_HEIGHT);
               if(lineUsed+lh<=availableContent){fit.push(li);lineUsed+=lh;}else break;
             }
             if(fit.length<first.lines.length){
               if(fit.length>0){
                 const firstPart={...first,lines:first.lines.slice(0,fit.length)};
                 const continuationPart={...first,lines:first.lines.slice(fit.length)};
                 fragment.push(firstPart);
                 used=lineUsed;
                 pointItems.splice(cursor,1,firstPart,continuationPart);
                 cursor++;
                 splitThisPage=true;
               }
             }else if(addPointItem(first)){cursor++;}
           }else if(first&&addPointItem(first)){cursor++;}
           if(fragment.length===0){newFlowPage();continue;}
           markFlowBlockPage(blockId);
           // Consume the heading only after a non-empty fragment fits this page.
           // If a new page was needed before drawing any text, keep the heading pending.
           pointTitlePending=false;

           const bodyH=Math.max(36,BOX_PAD_TOP+used+BOX_PAD_BOTTOM);
           const titleY=y-titleH;
           const bodyDrop=6;
           const bodyY=continuation
             ? y-bodyH-bodyDrop
             : y-titleH-separatorGap-bodyH-bodyDrop;
           const editorialRule=rgbHex(mixWhite(titleAccent,0.22));
           const titleFill=rgbHex("#E0E1E3");

           // Le titre n'existe qu'au début du point. Une suite coupée devient
           // volontairement un bloc paragraphe autonome sur la page suivante.
           if(showPointTitle){
             titleAnchors.push({page,y:y-titleH/2,targetX:titleX,color:accent});
             rounded(page,titleX,y-titleH,titleW,titleH,8,titleFill,rgbHex("#BFC1C5"),0.45);
              page.drawCircle({x:titleX+6.4,y:y-titleH/2,size:2.4,color:rgbHex(titleAccent)});
             for(let i=0;i<titleLines.length;i++){
               page.drawText(escapePdfText(titleLines[i]),{
                 x:titleX+12,
                 y:y-titlePadY-titleLineHeight*(i+1)+2.8,
                 font:fonts.sansBold,size:titleFontSize,color:rgbHex(titleAccent)
               });
             }
           }

           
           if(showPointTitle){
             const ruleY=bodyY+bodyH+separatorGap/2;
              // Filet fin, soulignement coloré court et point terminal.
              page.drawLine({start:{x:26,y:ruleY},end:{x:572,y:ruleY},thickness:0.7,color:editorialRule});
              page.drawLine({start:{x:26,y:ruleY},end:{x:96,y:ruleY},thickness:2.4,color:rgbHex(mixWhite(accent,0.06))});
              page.drawCircle({x:572,y:ruleY,size:2.4,color:rgbHex(mixWhite(accent,0.12))});
              pointAnchors.push({page,y:titleY,x:titleX,color:titleAccent,topY:y-titleH,bottomY:bodyY,ruleY,boxX:bodyX,boxW:bodyW});
            }
            rounded(page,bodyX,bodyY,bodyW,bodyH,11,rgbHex("#F7F7F9"),rgbHex("#D0D1D6"),0.5);
let childY=bodyY+bodyH-BOX_PAD_TOP;
           for(const item of fragment){
             if(item.kind==="inline"){
               drawInlineLines(page,item.lines,bodyX,childY,bodyTextW,fonts.regular,accent,rgbHex("#202126"),TEXT_SIZE,LINE_HEIGHT);
               childY-=item.lines.reduce((n:any,line:any)=>n+inlineLineAdvance(line,TEXT_SIZE,LINE_HEIGHT),0)+gap;
             }else{
               drawDisplayMath(page,item.run,bodyX,childY,bodyTextW,color);
               childY-=item.metrics.cardH+gap;
             }
           }
           y-=titleH+separatorGap+bodyH+BLOCK_GAP;

           if(splitThisPage&&cursor<pointItems.length){
             newFlowPage();
             continuation=true;
           }else if(cursor<pointItems.length&&y-bottom<LINE_HEIGHT+BOX_PAD_TOP+BOX_PAD_BOTTOM){
             newFlowPage();
             continuation=true;
           }
        }
        return;
      }
      const paragraphs=proseText(String(text||""));
      const preparedItems=await Promise.all(paragraphs.map(async para=>{
        const prepared=await prepareRuns(mergePlainAndExplicit(para),auth,pdf,fonts,qa,cache);
        const items:any[]=[];let inlineChunk:Run[]=[];
        const flushInline=()=>{
          if(!inlineChunk.length)return;
          const lines=layoutInline(inlineChunk,fonts.regular,TEXT_SIZE,PARA_W);
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
      // Chaque entrée correspond à un paragraphe indépendant :
      // s'il est terminé, le paragraphe suivant peut utiliser le bas de page.
      // Si le paragraphe courant est coupé, sa suite reprend impérativement page suivante.
      for(const items of preparedItems){
        let cursor=0;
        while(cursor<items.length){
          const remainingPage=Math.max(0,y-bottom);
          const availableContent=Math.max(0,remainingPage-BOX_PAD_TOP-BOX_PAD_BOTTOM);
          const fragment:any[]=[];
          let used=0;
          let splitParagraphHere=false;
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
                const firstPart={...first,lines:first.lines.slice(0,fit.length)};
                const continuationPart={...first,lines:first.lines.slice(fit.length)};
                fragment.push(firstPart);
                used=lineUsed;
                items.splice(cursor,1,firstPart,continuationPart);
                cursor++;
                splitParagraphHere=true;
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
          markFlowBlockPage(blockId);
          const boxH=Math.max(36,BOX_PAD_TOP+used+BOX_PAD_BOTTOM);
          
          let childY=y-BOX_PAD_TOP;
          for(const item of fragment){
            if(item.kind==="inline"){
              drawInlineLines(page,item.lines,PARA_X,childY,PARA_W,fonts.regular,color,rgbHex("#202126"),TEXT_SIZE,LINE_HEIGHT);
              childY-=item.lines.reduce((n:any,line:any)=>n+inlineLineAdvance(line,TEXT_SIZE,LINE_HEIGHT),0)+innerGap;
            }else{
              drawDisplayMath(page,item.run,X,childY,W-18,color);
              childY-=item.metrics.cardH+innerGap;
            }
          }
          y-=boxH+BLOCK_GAP;
          if(cursor<items.length&&splitParagraphHere){
            newFlowPage();
          }else if(cursor<items.length&&y-bottom<LINE_HEIGHT+BOX_PAD_TOP+BOX_PAD_BOTTOM){
            newFlowPage();
          }
        }
      }
    };
    const drawImageBlock=async(image:any,blockId?:any)=>{
      const url=String(image?.url||image?.imageUrl||"").trim();
      if(!url)return;
      qa.images_total++;
      try{
        const r=await fetch(url,{signal:AbortSignal.timeout(12000)});
        if(!r.ok)throw new Error("HTTP "+r.status);
        const img=await embedRaster(pdf,new Uint8Array(await r.arrayBuffer()),"illustration");
        const iw=Math.min(450,img.width),ih=iw*(img.height/img.width);
        const h=Math.min(250,ih);
        const w=h===ih?iw:h*(img.width/img.height);
        const boxH=h+44;
        if(y-boxH<bottom)newFlowPage();
        markFlowBlockPage(blockId);
        rounded(page,BOX_X,y-boxH,BOX_W,boxH,11,rgbHex("#E8E8EA"),rgbHex("#A7A8AD"),0.5);
        page.drawImage(img,{x:X+(W-w)/2,y:y-16-h,width:w,height:h});
        const caption=clean(image.caption||image.title||"");
        if(caption){
          const capLines=wrap(caption,fonts.regular,8,W-8).slice(0,2);
          let cy=y-29-h;
          for(const cl of capLines){
            page.drawText(escapePdfText(cl),{x:X+4,y:cy,font:fonts.regular,size:8,color:rgbHex("#707178")});
            cy-=11;
          }
        }
        y-=boxH+8;qa.images_ok++;
      }catch(_){qa.images_failed++;}
    };

    const drawGraphBlock=async(g:any,blockId?:any)=>{
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
        const scale=Math.min(1,450/img.width,222/img.height);
        const iw=img.width*scale,ih=img.height*scale;
        const title=clean(g?.title).slice(0,100);
        // La hauteur suit l'image réelle : aucun cadre de 260 pt réservé artificiellement.
        const boxH=Math.max(48,15+ih+(title?14:0)+12);
        if(y-boxH<bottom)newFlowPage();
        markFlowBlockPage(blockId);
        rounded(page,X-11,y-boxH,W+22,boxH,10,rgbHex("#E8E8EA"),rgbHex("#A7A8AD"),0.5);
        const gy=y-15-ih;
        page.drawImage(img,{x:X+(W-iw)/2,y:gy,width:iw,height:ih});
        if(title){
          page.drawText(title,{x:X+4,y:gy-14,font:fonts.bold,size:8.5,color:rgbHex("#5B5D66")});
        }
        y-=boxH+8;qa.graphs_ok++;
      }catch(_){qa.graphs_failed++;}
    };

    const drawVectorSceneBlock=async(entry:any,blockId?:any)=>{
      qa.scenes_total++;
      try{
        const sc=entry?.scene;
        const types=["axes","plot","line","arrow","rect","circle","polygon","arc","text","dim"];
        const finite=(v:any,lo=-5000,hi=5000)=>typeof v==="number"&&Number.isFinite(v)&&v>=lo&&v<=hi;
        const point=(v:any)=>Array.isArray(v)&&v.length===2&&finite(v[0])&&finite(v[1]);
        if(!sc||typeof sc!=="object"||sc.version!==1||!finite(sc.width,20,2000)||!finite(sc.height,20,2000)||!Array.isArray(sc.elements)||!sc.elements.length||sc.elements.length>300)throw new Error("JSON de scène invalide.");
        let axes:any=null;
        for(let i=0;i<sc.elements.length;i++){
          const el=sc.elements[i];if(!el||typeof el!=="object"||!types.includes(el.t))throw new Error("Type d’élément vectoriel non autorisé.");
          if(el.t==="axes"){axes=el;if(!point(el.origin)||!point(el.size)||!point(el.x)||!point(el.y)||el.x[0]===el.x[1]||el.y[0]===el.y[1])throw new Error("Repère invalide.")}
          else if(el.t==="plot"){if(!axes)throw new Error("Un tracé fonctionnel exige un repère préalable.");if(!finite(el.from,-1e4,1e4)||!finite(el.to,-1e4,1e4)||el.from>=el.to)throw new Error("Intervalle de tracé invalide.");compileVectorExpr(el.expr)}
          else if(["line","arrow","dim"].includes(el.t)&&(!point(el.p1)||!point(el.p2)))throw new Error("Segment vectoriel invalide.");
          else if(el.t==="rect"&&(!point(el.at)||!point(el.size)))throw new Error("Rectangle invalide.");
          else if(el.t==="circle"&&(!point(el.c)||!finite(el.r,.1,2000)))throw new Error("Cercle invalide.");
          else if(el.t==="polygon"&&(!Array.isArray(el.points)||el.points.length<3||el.points.length>60||!el.points.every(point)))throw new Error("Polygone invalide.");
          else if(el.t==="arc"&&(!point(el.c)||!finite(el.r,.1,2000)||!finite(el.from,-720,720)||!finite(el.to,-720,720)))throw new Error("Arc invalide.");
          else if(el.t==="text"&&(!point(el.at)||!clean(el.text)||String(el.text).length>120))throw new Error("Texte de schéma invalide.");
          if(el.dash!==undefined&&!["solid","dashed","dotted"].includes(el.dash))throw new Error("Type de trait invalide.");
          if(el.w!==undefined&&!finite(el.w,.2,6))throw new Error("Épaisseur invalide.");
          if(el.fill!==undefined&&!/^#[0-9a-fA-F]{6}$/.test(String(el.fill)))throw new Error("Couleur de remplissage invalide.");
          if(el.tone!==undefined&&!["ink","soft"].includes(el.tone))throw new Error("Tonalité invalide.");
        }
        const scale=Math.min(1.2,(W-44)/sc.width,170/sc.height),sceneW=sc.width*scale,sceneH=sc.height*scale,cardH=sceneH+56;
        if(y-cardH<bottom)newFlowPage();
        rounded(page,X-11,y-cardH,W+22,cardH,10,rgbHex("#F0F0F2"),rgbHex("#B6B7BD"),.5);
        if(clean(entry.title))page.drawText(clean(entry.title).slice(0,95),{x:X+4,y:y-19,font:fonts.sansBold,size:9,color:rgbHex("#34343A")});
        if(clean(entry.caption))page.drawText(clean(entry.caption).slice(0,125),{x:X+4,y:y-32,font:fonts.sans,size:7.2,color:rgbHex("#707178")});
        const ox=X+(W-sceneW)/2,oy=y-42;
        const P=(a:number[])=>({x:ox+a[0]*scale,y:oy-a[1]*scale});
        const ink=(el:any)=>rgbHex(el.tone==="soft"?"#8A8A8A":"#17171B");
        const dash=(el:any)=>el.dash==="dashed"?[5,3]:el.dash==="dotted"?[1.2,2.6]:undefined;
        const segment=(a:number[],b:number[],el:any)=>{const A=P(a),B=P(b);page.drawLine({start:A,end:B,thickness:Math.max(.4,(Number(el.w)||1.1)*scale),color:ink(el),dashArray:dash(el)})};
        const arrowHead=(a:number[],b:number[],el:any)=>{
          const A=P(a),B=P(b),ang=Math.atan2(B.y-A.y,B.x-A.x),L=6;
          const h1=[b[0]-L/scale*Math.cos(ang-.43),b[1]+L/scale*Math.sin(ang-.43)];
          const h2=[b[0]-L/scale*Math.cos(ang+.43),b[1]+L/scale*Math.sin(ang+.43)];
          segment(b,h1,el);segment(b,h2,el);
        };
        const label=(v:string,at:number[],sz=7)=>{const q=P(at);page.drawText(clean(v).slice(0,120),{x:q.x,y:q.y,font:fonts.sans,size:Math.max(5,Math.min(11,sz*scale)),color:rgbHex("#3B3B42")})};
        let currentAxes:any=null;
        for(const el of sc.elements){
          if(el.t==="axes"){
            currentAxes=el;const [x0,y0]=el.origin,[ww,hh]=el.size;
            segment([x0,y0],[x0+ww,y0],el);segment([x0,y0],[x0,y0+hh],el);
            arrowHead([x0,y0],[x0+ww+2,y0],el);arrowHead([x0,y0],[x0,y0+hh+2],el);
            if(el.xlabel)label(el.xlabel,[x0+ww-2,y0-12],8);if(el.ylabel)label(el.ylabel,[x0-12,y0+hh-4],8);
          }else if(el.t==="plot"){
            if(!currentAxes)throw new Error("Repère manquant.");
            const fn=compileVectorExpr(el.expr),[xa,xb]=currentAxes.x,[ya,yb]=currentAxes.y,[x0,y0]=currentAxes.origin,[ww,hh]=currentAxes.size;
            const samples=Math.max(2,Math.min(240,Math.floor(Number(el.samples)||120)));let last:number[]|null=null;
            for(let k=0;k<=samples;k++){const x=el.from+(el.to-el.from)*k/samples,val=fn(x);
              if(!Number.isFinite(val)||Math.abs(val)>1e8){last=null;continue}
              const q=[x0+(x-xa)/(xb-xa)*ww,y0+(val-ya)/(yb-ya)*hh];if(last)segment(last,q,el);last=q;
            }
          }else if(el.t==="line"||el.t==="arrow"||el.t==="dim"){
            segment(el.p1,el.p2,el);if(el.t==="arrow"||el.t==="dim")arrowHead(el.p1,el.p2,el);
            if(el.t==="dim"){arrowHead(el.p2,el.p1,el);if(el.text)label(String(el.text),[(el.p1[0]+el.p2[0])/2,(el.p1[1]+el.p2[1])/2-4],7)}
          }else if(el.t==="rect"){
            const a=P(el.at),b=P([el.at[0]+el.size[0],el.at[1]+el.size[1]]);
            page.drawRectangle({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y),...(el.fill?{color:rgbHex(el.fill)}:{}),borderColor:ink(el),borderWidth:Math.max(.4,(Number(el.w)||1)*scale),...(dash(el)?{borderDashArray:dash(el)}:{})});
          }else if(el.t==="circle"){
            const c=P(el.c);page.drawCircle({x:c.x,y:c.y,size:Math.max(.6,2*Number(el.r)*scale),borderColor:ink(el),borderWidth:Math.max(.4,(Number(el.w)||1)*scale),...(el.fill?{color:rgbHex(el.fill)}:{})});
          }else if(el.t==="polygon"){
            const pts=el.points as number[][];for(let k=0;k<pts.length;k++)segment(pts[k],pts[(k+1)%pts.length],el);
          }else if(el.t==="arc"){
            const pts:number[][]=[];const steps=Math.max(8,Math.min(100,Math.ceil(Math.abs(el.to-el.from)/5)));
            for(let k=0;k<=steps;k++){const a=(Number(el.from)+(Number(el.to)-Number(el.from))*k/steps)*Math.PI/180;pts.push([el.c[0]+el.r*Math.cos(a),el.c[1]+el.r*Math.sin(a)])}
            for(let k=1;k<pts.length;k++)segment(pts[k-1],pts[k],el);
          }else if(el.t==="text")label(String(el.text),el.at,Number(el.size)||7);
        }
        y-=cardH+8;qa.scenes_ok++;
      }catch(error){
        qa.scenes_failed++;
        const message=String(error?.message||error).slice(0,200);
        if(Array.isArray(qa.scene_errors)&&qa.scene_errors.length<8)qa.scene_errors.push(message);
        throw new Error("Échec du schéma vectoriel : "+message);
      }
    };
    const drawExerciseBlock=async(ex:any,blockId?:any)=>{
      const title=clean(ex?.title||"Exercice");
      const statement=clean(ex?.statement||ex?.question||ex?.enonce||ex?.content||"");
      const hint=clean(ex?.hint||"");
      const correctionTitle=clean(ex?.correction_title||"Corrigé");
      const correction=clean(ex?.correction||"");
      if(!statement)return;
      const exerciseTitleColor=nextTitleColor();
      const exerciseLabel=adaptiveExerciseLabelLayout(title,fonts,X);
      ensureSpace(exerciseLabel.drop+50);
      markFlowBlockPage(blockId);
      titleAnchors.push({page,y:y-exerciseLabel.height/2,targetX:X,color:exerciseTitleColor});
      drawAdaptiveExerciseLabel(page,title,X,y,fonts,exerciseTitleColor,exerciseLabel);
      y-=exerciseLabel.drop;
      await drawContentBlock(statement,blockId);
      if(hint)await drawContentBlock("Indication : "+hint,blockId);
      if(correction){
        const correctionLabel=adaptiveExerciseLabelLayout(correctionTitle,fonts,X);
        // Le corrigé reste sous l’énoncé s’il tient dans l’espace disponible.
        // Sinon, seul le corrigé passe à la page suivante.
        ensureSpace(correctionLabel.drop+50);
        markFlowBlockPage(blockId);
        titleAnchors.push({page,y:y-correctionLabel.height/2,targetX:X,color:exerciseTitleColor});
        drawAdaptiveExerciseLabel(page,correctionTitle,X,y,fonts,exerciseTitleColor,correctionLabel);
        y-=correctionLabel.drop;
        await drawContentBlock(correction,blockId);
      }
    };
    // Pour les flux mixtes, respecter exactement l'ordre des blocs de l'éditeur.
    if(useOrderedAssistedFlow){
      for(let flowIndex=0;flowIndex<orderedFlowItems.length;flowIndex++){
        const item=orderedFlowItems[flowIndex];
        const blockId=String(item.blockId||"");
        if(item.kind==="content"){
          const raw=item.value;
          const isIntroduction=!!(raw&&typeof raw==="object"&&raw.__aurore_point&&clean(raw.title).toLowerCase()==="introduction");
          if(isIntroduction&&y!==top)newFlowPage();
          await drawContentBlock(raw,blockId);
          if(isIntroduction&&flowIndex<orderedFlowItems.length-1)newFlowPage();
        }else if(item.kind==="exercise"){
          await drawExerciseBlock(item.value,blockId);
        }else if(item.kind==="image"){
          await drawImageBlock(item.value,blockId);
        }else if(item.kind==="graph"){
          await drawGraphBlock(item.value,blockId);
        }else if(item.kind==="scene"){
          await drawVectorSceneBlock(item.value,blockId);
        }
      }
    }else{
      for(let contentIndex=0;contentIndex<contentItems.length;contentIndex++){
        const raw=contentItems[contentIndex];
        const isIntroduction=!!(raw&&typeof raw==="object"&&raw.__aurore_point&&clean(raw.title).toLowerCase()==="introduction");
        if(isIntroduction&&y!==top)newFlowPage();
        await drawContentBlock(raw);
        if(isIntroduction){
          const hasFollowingMaterial=
            contentItems.slice(contentIndex+1).length>0||
            exerciseItems.length>0||
            graphItems.length>0||
            imageItems.length>0;
          if(hasFollowingMaterial)newFlowPage();
        }
      }
    }

    if(!useOrderedAssistedFlow)for(const ex of exerciseItems)await drawExerciseBlock(ex);
    
    if(!useOrderedAssistedFlow)for(const image of imageItems)await drawImageBlock(image);
    if(!useOrderedAssistedFlow)for(const graph of graphItems)await drawGraphBlock(graph);
    if(!useOrderedAssistedFlow)for(const scene of vectorSceneItems)await drawVectorSceneBlock(scene);

    // Rail éditorial continu : une seule ligne verticale par page,
    // avec de courts raccords horizontaux vers les titres rencontrés.
    const anchorsByPage=new Map<any,any[]>();
    for(const a of titleAnchors){
      const list=anchorsByPage.get(a.page)||[];
      list.push(a);
      anchorsByPage.set(a.page,list);
    }
    const railX=POINT_SPINE_X;
    const railTop=792;
    const railBottom=42;
    for(const p of railPages){
      p.drawLine({
        start:{x:railX,y:railTop},
        end:{x:railX,y:railBottom},
        thickness:3.0,
        color:rgbHex(mixWhite(color,0.10))
      });
      p.drawCircle({x:railX,y:railTop,size:4.6,color:rgbHex(mixWhite(color,0.06))});
      p.drawCircle({x:railX,y:railTop,size:1.6,color:rgbHex("#FFFFFF")});
      p.drawCircle({x:railX,y:railBottom,size:4.6,color:rgbHex(mixWhite(color,0.06))});
      p.drawCircle({x:railX,y:railBottom,size:1.6,color:rgbHex("#FFFFFF")});
    }
    for(const [p,list] of anchorsByPage){
      for(const a of list){
        const tickColor=rgbHex(mixWhite(a.color||color,0.06));
        const endX=Math.max(railX+10,Number(a.targetX||72)-POINT_SIDE_GAP);
        p.drawLine({
          start:{x:railX,y:a.y},
          end:{x:endX,y:a.y},
          thickness:1.8,
          color:tickColor
        });
        p.drawCircle({x:endX,y:a.y,size:3.1,color:tickColor});
      }
    }

    const bytes=new Uint8Array(await pdf.save({useObjectStreams:true}));
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
      bytes:bytes.length,page_count:flowPageNo-pn+1,flow_page_map:flowPageMap,flow_page_end_map:flowPageEndMap,qa
    });
  }catch(e){
    return out({ok:false,generated_document_id:id,page_number:pn,error:e instanceof Error?e.message:String(e)},409);
  }
});