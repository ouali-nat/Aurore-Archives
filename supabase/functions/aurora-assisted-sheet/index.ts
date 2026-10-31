import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

// aurora-assisted-sheet — fiches de révision et scènes vectorielles pilotées par JSON.
// Indépendante des autres renderers : aucune fonction existante n'est modifiée.
const URL=Deno.env.get("SUPABASE_URL")!, SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON=Deno.env.get("SUPABASE_ANON_KEY")||"";
const admin=createClient(URL,SERVICE,{auth:{autoRefreshToken:false,persistSession:false}});
const LOGO_URL="https://pub-0433751d08eb49fcafb7355ef0bf42ab.r2.dev/site-logo-auraster";
const GF="https://raw.githubusercontent.com/go-fonts/latin-modern/main/";
const FONT_URLS:any={regular:GF+"lmroman10regular/lmroman10-regular.otf",bold:GF+"lmroman10bold/lmroman10-bold.otf",sans:GF+"lmsans10regular/lmsans10-regular.otf",sansBold:GF+"lmsans10bold/lmsans10-bold.otf",italic:GF+"lmroman10italic/lmroman10-italic.otf"};
const H:any={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type,x-retry-count,traceparent,tracestate,baggage","Access-Control-Allow-Methods":"POST,OPTIONS"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...H,"Content-Type":"application/json"}});
const clean=(v:any)=>String(v??"").normalize("NFC").replace(/[\u0000-\u001F]/g," ").replace(/\s+/g," ").trim();
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
const hex=(v:any)=>{const h=String(v??"").trim().toUpperCase();return /^#[0-9A-F]{6}$/.test(h)?h:"#6D28D9"};
const mix=(h:string,a:number)=>{const s=hex(h).slice(1),c=[0,2,4].map(i=>parseInt(s.slice(i,i+2),16));return "#"+c.map(x=>Math.round(x+(255-x)*a).toString(16).padStart(2,"0")).join("")};
const dk=(h:string,f:number)=>{const s=hex(h).slice(1);return "#"+[0,2,4].map(i=>Math.round(parseInt(s.slice(i,i+2),16)*f).toString(16).padStart(2,"0")).join("")};
const rgbh=(h:string)=>{const s=hex(h).slice(1);return rgb(parseInt(s.slice(0,2),16)/255,parseInt(s.slice(2,4),16)/255,parseInt(s.slice(4,6),16)/255)};
const GRAY="#E6E6E7",GRAY_IN="#EFEFF0",GRAY_ALT="#E1E1E3",GRAY_EDGE="#97989C",GRAY_SOFT="#C4C5C8",INK="#202126",INK2="#4B4C54",INK3="#6F717B";

// ───────────── Ressources ─────────────
const FONT_CACHE=new Map<string,Promise<Uint8Array>>();let LOGO_CACHE:Promise<Uint8Array>|null=null;
async function bytes(url:string){const r=await fetch(url);if(!r.ok)throw new Error("Ressource indisponible : HTTP "+r.status);return new Uint8Array(await r.arrayBuffer())}
async function fbytes(k:string){const x=FONT_CACHE.get(k);if(x)return x;const p=bytes(FONT_URLS[k]);FONT_CACHE.set(k,p);p.catch(()=>FONT_CACHE.delete(k));return p}
async function fonts(pdf:any){
  const [r,b,s,sb]=await Promise.all([fbytes("regular"),fbytes("bold"),fbytes("sans"),fbytes("sansBold")]);
  const f:any={regular:await pdf.embedFont(r,{subset:false}),bold:await pdf.embedFont(b,{subset:false}),sans:await pdf.embedFont(s,{subset:false}),sansBold:await pdf.embedFont(sb,{subset:false})};
  try{f.italic=await pdf.embedFont(await fbytes("italic"),{subset:false})}catch(_){f.italic=f.regular}
  return f;
}
async function logo(pdf:any){if(!LOGO_CACHE)LOGO_CACHE=bytes(LOGO_URL);const b=await LOGO_CACHE;if(b[0]===137&&b[1]===80)return pdf.embedPng(b);if(b[0]===255&&b[1]===216)return pdf.embedJpg(b);throw new Error("Logo Aurore invalide")}

// ───────────── Texte ─────────────
const GREEK:Record<string,string>={α:"alpha",β:"beta",γ:"gamma",δ:"delta",θ:"theta",λ:"lambda",μ:"mu",π:"pi",ρ:"rho",σ:"sigma",φ:"phi",ω:"omega"};
const REPL:Record<string,string>={"≈":"~","≥":">=","≤":"<=","≠":"!=","∫":"int","′":"'","⁻":"-","¹":"1","−":"-"};
// Les polices Latin Modern n'ont pas toutes les lettres grecques : repli lisible plutôt qu'un carré vide.
function fit(font:any,s:string){
  let set:Set<number>|null=null;try{const a=font.getCharacterSet?.();if(Array.isArray(a)&&a.length)set=new Set(a)}catch(_){}
  return Array.from(String(s)).map(ch=>{if(!set||set.has(ch.codePointAt(0)!))return ch;return GREEK[ch]||REPL[ch]||"?"}).join("");
}
// Unités : « J·mol⁻¹ » ou « J.mol^-1 » deviennent une seule chaîne avec exposants vrais.
function tidyUnit(u:string){return clean(u).replace(/⁻¹/g,"^-1").replace(/⁻²/g,"^-2").replace(/⁻³/g,"^-3").replace(/²/g,"^2").replace(/³/g,"^3").replace(/(\w)\.(?=[A-Za-z])/g,"$1·")}
function segs(s:string){
  const out:{t:string,k:"n"|"sup"|"sub"}[]=[];const re=/\^\{([^}]*)\}|\^(-?\d+)|_\{([^}]*)\}|_([A-Za-z0-9])/g;let i=0,m:RegExpExecArray|null;
  while((m=re.exec(s))){if(m.index>i)out.push({t:s.slice(i,m.index),k:"n"});if(m[1]!==undefined||m[2]!==undefined)out.push({t:m[1]??m[2],k:"sup"});else out.push({t:m[3]??m[4],k:"sub"});i=re.lastIndex}
  if(i<s.length)out.push({t:s.slice(i),k:"n"});return out;
}
function rw(font:any,s:string,size:number){let w=0;for(const g of segs(fit(font,s)))w+=font.widthOfTextAtSize(g.t,g.k==="n"?size:size*.68);return w}
function rich(p:any,font:any,x:number,y:number,s:string,size:number,color:string){
  for(const g of segs(fit(font,s))){const sz=g.k==="n"?size:size*.68,dy=g.k==="sup"?size*.4:g.k==="sub"?-size*.2:0;
    if(g.t)p.drawText(g.t,{x,y:y+dy,font,size:sz,color:rgbh(color)});x+=font.widthOfTextAtSize(g.t,sz)}
  return x;
}
function wrap(font:any,s:string,size:number,max:number){
  const words=clean(s).split(" ").filter(Boolean),lines:string[]=[];let line="";
  for(const w of words){const n=line?line+" "+w:w;if(rw(font,n,size)<=max||!line)line=n;else{lines.push(line);line=w}}
  if(line)lines.push(line);return lines;
}
function rounded(p:any,x:number,y:number,w:number,h:number,r:number,fill:any,border?:any,bw=.5){p.drawSvgPath("M "+r+" 0 H "+(w-r)+" A "+r+" "+r+" 0 0 1 "+w+" "+r+" V "+(h-r)+" A "+r+" "+r+" 0 0 1 "+(w-r)+" "+h+" H "+r+" A "+r+" "+r+" 0 0 1 0 "+(h-r)+" V "+r+" A "+r+" "+r+" 0 0 1 "+r+" 0 Z",{x,y:y+h,color:fill,borderColor:border||fill,borderWidth:border?bw:0})}

// ───────────── Expressions sûres (aucun eval) ─────────────
const FN:Record<string,(x:number)=>number>={sin:Math.sin,cos:Math.cos,tan:Math.tan,exp:Math.exp,ln:Math.log,sqrt:Math.sqrt,abs:Math.abs};
function compileExpr(src:string):(x:number)=>number{
  const s=String(src||"").replace(/\s+/g,"").replace(/\*\*/g,"^").replace(/−/g,"-").replace(/π/g,"pi");
  if(!s||s.length>120)throw new Error("expression vide ou trop longue");
  const tok:string[]=s.match(/\d+\.?\d*|\.\d+|[a-z]+|[-+*/^()]/g)||[];
  if(tok.join("")!==s)throw new Error("caractère non autorisé");
  let i=0;
  const peek=()=>tok[i],next=()=>tok[i++];
  function prim():(x:number)=>number{
    const t=next();if(t===undefined)throw new Error("expression incomplète");
    if(/^[\d.]/.test(t)){const v=Number(t);if(!Number.isFinite(v))throw new Error("nombre invalide");return()=>v}
    if(t==="x")return(x)=>x;if(t==="pi")return()=>Math.PI;if(t==="e")return()=>Math.E;
    if(t==="("){const e=add();if(next()!==")")throw new Error("parenthèse manquante");return e}
    if(FN[t]){if(next()!=="(")throw new Error("fonction sans parenthèse");const e=add();if(next()!==")")throw new Error("parenthèse manquante");const f=FN[t];return(x)=>f(e(x))}
    throw new Error("terme interdit « "+t+" »");
  }
  function unary():(x:number)=>number{if(peek()==="-"){next();const e=unary();return(x)=>-e(x)}if(peek()==="+"){next();return unary()}return pow()}
  function pow():(x:number)=>number{const b=prim();if(peek()==="^"){next();const e=unary();return(x)=>Math.pow(b(x),e(x))}return b}
  function mul():(x:number)=>number{let l=unary();while(peek()==="*"||peek()==="/"){const o=next(),r=unary(),a=l;l=o==="*"?(x)=>a(x)*r(x):(x)=>a(x)/r(x)}return l}
  function add():(x:number)=>number{let l=mul();while(peek()==="+"||peek()==="-"){const o=next(),r=mul(),a=l;l=o==="+"?(x)=>a(x)+r(x):(x)=>a(x)-r(x)}return l}
  const f=add();if(i<tok.length)throw new Error("expression mal formée");return f;
}

// ───────────── Validation des contrats JSON ─────────────
const DASHES=["solid","dashed","dotted"],EL=["axes","plot","line","arrow","rect","circle","polygon","arc","text","dim"];
const num=(v:any,lo=-5000,hi=5000)=>typeof v==="number"&&Number.isFinite(v)&&v>=lo&&v<=hi;
const pt=(v:any)=>Array.isArray(v)&&v.length===2&&num(v[0])&&num(v[1]);
function validateScene(sc:any,where="scène"){
  const e:string[]=[];
  if(!sc||typeof sc!=="object"||Array.isArray(sc))return[where+" : objet JSON attendu"];
  if(sc.version!==1)e.push(where+" : version doit valoir 1");
  if(!num(sc.width,20,2000)||!num(sc.height,20,2000))e.push(where+" : width et height doivent être entre 20 et 2000");
  if(!Array.isArray(sc.elements)||!sc.elements.length)e.push(where+" : elements doit être une liste non vide");
  else if(sc.elements.length>300)e.push(where+" : 300 éléments maximum");
  else{
    let hasAxes=false;
    sc.elements.forEach((el:any,i:number)=>{
      const n=where+" · élément "+(i+1);
      if(!el||typeof el!=="object"){e.push(n+" : objet attendu");return}
      if(!EL.includes(el.t)){e.push(n+" : type inconnu « "+clean(el.t)+" » (autorisés : "+EL.join(", ")+")");return}
      if(el.dash!==undefined&&!DASHES.includes(el.dash))e.push(n+" : dash doit être solid, dashed ou dotted");
      if(el.w!==undefined&&!num(el.w,.2,6))e.push(n+" : w entre 0,2 et 6");
      if(el.fill!==undefined&&!/^#[0-9A-Fa-f]{6}$/.test(String(el.fill)))e.push(n+" : fill doit être #RRGGBB");
      if(el.tone!==undefined&&!["ink","soft"].includes(el.tone))e.push(n+" : tone doit être ink ou soft");
      if(el.t==="axes"){hasAxes=true;
        if(!pt(el.origin)||!pt(el.size)||!pt(el.x)||!pt(el.y)||el.x[0]===el.x[1]||el.y[0]===el.y[1])e.push(n+" : axes exige origin, size, x et y (intervalles non nuls)")}
      if(el.t==="plot"){
        if(!hasAxes)e.push(n+" : plot exige un élément axes avant lui");
        if(!num(el.from,-1e4,1e4)||!num(el.to,-1e4,1e4)||el.from>=el.to)e.push(n+" : from < to requis");
        try{compileExpr(el.expr)}catch(x){e.push(n+" : expression refusée ("+(x as Error).message+")")}
        if(el.samples!==undefined&&!num(el.samples,2,240))e.push(n+" : samples entre 2 et 240");
      }
      if((el.t==="line"||el.t==="arrow"||el.t==="dim")&&(!pt(el.p1)||!pt(el.p2)))e.push(n+" : p1 et p2 doivent être [x, y]");
      if(el.t==="rect"&&(!pt(el.at)||!pt(el.size)))e.push(n+" : rect exige at et size");
      if(el.t==="circle"&&(!pt(el.c)||!num(el.r,.1,2000)))e.push(n+" : circle exige c et r");
      if(el.t==="polygon"&&(!Array.isArray(el.points)||el.points.length<3||el.points.length>60||!el.points.every(pt)))e.push(n+" : polygon exige 3 à 60 points [x, y]");
      if(el.t==="arc"&&(!pt(el.c)||!num(el.r,.1,2000)||!num(el.from,-720,720)||!num(el.to,-720,720)))e.push(n+" : arc exige c, r, from et to (degrés)");
      if(el.t==="text"&&(!pt(el.at)||!clean(el.text)||String(el.text).length>120))e.push(n+" : text exige at et un texte de 120 caractères maximum");
      if(el.t==="dim"&&!clean(el.text))e.push(n+" : dim exige un texte");
    });
  }
  return e;
}
const BAD_TEX=/\\(input|include|write|read|def|gdef|edef|let|catcode|require|href|url|class|style|cssId|html|unicode|newcommand|renewcommand)\b/i;
function texOk(s:any){const t=String(s??"").replace(/^\s*\$+|\$+\s*$/g,"").trim();return t&&t.length<=240&&!BAD_TEX.test(t)?t:null}
function validateFiche(c:any){
  const e:string[]=[],w:string[]=[];
  if(!c||typeof c!=="object"||Array.isArray(c))return{errors:["content : objet JSON attendu"],warnings:w,fiche:null};
  const L=(v:any,n:number)=>clean(v).slice(0,n);
  const f:any={title:L(c.title,80),subtitle:L(c.subtitle,140),mode:c.mode==="color"?"color":"nb",essentials:[],formulas:[],table:null,scene:null,selftest:[],page_number:Math.max(1,Math.min(999,Number(c.page_number)||11))};
  if(!f.title)e.push("title obligatoire");
  for(const [i,x] of (Array.isArray(c.essentials)?c.essentials:[]).slice(0,3).entries()){
    if(!clean(x?.title)||!clean(x?.text)){e.push("essentials["+i+"] : title et text obligatoires");continue}
    f.essentials.push({title:L(x.title,28),text:L(x.text,110)});
  }
  if((c.essentials?.length||0)>3)w.push("essentials : seuls les 3 premiers sont conservés");
  if(!Array.isArray(c.formulas)||!c.formulas.length)e.push("formulas : au moins une formule");
  else if(c.formulas.length>48)e.push("formulas : 48 maximum par fiche");
  else c.formulas.forEach((x:any,i:number)=>{
    const n="formulas["+i+"]";
    if(!clean(x?.title))e.push(n+" : title obligatoire");
    const tex=texOk(x?.latex);
    if(!tex)e.push(n+" : latex obligatoire (240 caractères max, sans $ ni commande interdite)");
    if(/\d,\d/.test(tex||"")&&!/\d\{,\}\d/.test(tex||""))w.push(n+" : virgule décimale dans latex — écrire 8{,}314 pour éviter l'espace");
    const legend:any[]=[];
    for(const [j,l] of (Array.isArray(x?.legend)?x.legend:[]).slice(0,5).entries()){
      const s=texOk(l?.s);if(!s||!clean(l?.m)){e.push(n+".legend["+j+"] : s (symbole LaTeX) et m (sens) obligatoires");continue}
      legend.push({s,m:L(l.m,40),u:tidyUnit(String(l.u??"")).slice(0,26),v:L(l.v,14)});
    }
    if((x?.legend?.length||0)>5)w.push(n+" : légende limitée à 5 symboles");
    if(tex)f.formulas.push({title:L(x.title,34),latex:tex,legend,condition:L(x.condition,26),trap:L(x.trap,70)});
  });
  if(c.table){
    const t=c.table,cols=Array.isArray(t.columns)?t.columns.map((v:any)=>L(v,16)):[];
    if(cols.length<2||cols.length>4)e.push("table.columns : 2 à 4 colonnes");
    else if(!Array.isArray(t.rows)||!t.rows.length||t.rows.length>20)e.push("table.rows : 1 à 20 lignes");
    else if(t.rows.some((r:any)=>!Array.isArray(r)||r.length!==cols.length))e.push("table.rows : chaque ligne doit avoir "+cols.length+" cellules");
    else f.table={title:L(t.title,40),columns:cols,rows:t.rows.map((r:any)=>r.map((v:any)=>L(v,24)))};
  }
  if(c.scene){const se=validateScene(c.scene,"scene");if(se.length)e.push(...se);else f.scene=c.scene}
  f.selftest=(Array.isArray(c.selftest)?c.selftest:[]).slice(0,3).map((q:any)=>{
    const value=(typeof q==="string"||typeof q==="number")?q:
      (q&&typeof q==="object"&&!Array.isArray(q)?(q.question??q.text??q.prompt??q.title??""):"");
    return L(value,48);
  }).filter(Boolean);
  return{errors:e,warnings:w,fiche:f};
}

// ───────────── Formules : rendu MathJax via la fonction existante ─────────────
async function mathMap(auth:string,pdf:any,list:string[]){
  const res=new Map<string,any>(),uniq=[...new Set(list)];
  for(let i=0;i<uniq.length;i+=10){
    const chunk=uniq.slice(i,i+10);
    const r=await fetch(URL+"/functions/v1/aurora-content-math-renderer",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json",apikey:ANON},body:JSON.stringify({formulas:chunk})});
    const j:any=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok||!Array.isArray(j.results)||j.results.length!==chunk.length)throw new Error("Rendu mathématique impossible : "+(j?.error||("HTTP "+r.status)));
    for(let k=0;k<chunk.length;k++){
      const b=j.results[k],bin=atob(b.png_base64),u=new Uint8Array(bin.length);for(let q=0;q<bin.length;q++)u[q]=bin.charCodeAt(q);
      res.set(chunk[k],{img:await pdf.embedPng(u),w:Number(b.natural_pt_width)||20,h:Number(b.natural_pt_height)||10});
    }
  }
  return res;
}

// ───────────── Page de base ─────────────
function accentOf(f:any,theme:string){return f.mode==="color"?theme:"#222222"}
function pageBase(pdf:any,F:any,l:any,n:number,mode:string,acc:string){
  const p=pdf.addPage([595,842]);
  p.drawRectangle({x:0,y:0,width:595,height:842,color:rgbh(mode==="color"?mix(acc,.975):"#FFFFFF")});
  if(l){const s=Math.min(17/(l.width||17),17/(l.height||17));p.drawImage(l,{x:39,y:805,width:l.width*s,height:l.height*s})}
  const label="Section Archives",lw=F.sans.widthOfTextAtSize(label,9);
  p.drawText(label,{x:556-lw,y:808,font:F.sans,size:9,color:rgbh(mode==="color"?mix(acc,.24):INK3)});
  p.drawLine({start:{x:39,y:795},end:{x:556,y:795},thickness:.6,color:rgbh(mode==="color"?mix(acc,.72):GRAY_SOFT)});
  p.drawLine({start:{x:39,y:795},end:{x:99,y:795},thickness:1.8,color:rgbh(acc)});
  const cx=297.5,cy=34,num=String(n);
  p.drawLine({start:{x:150,y:cy},end:{x:cx-16,y:cy},thickness:.6,color:rgbh(GRAY_SOFT)});
  p.drawLine({start:{x:cx+16,y:cy},end:{x:445,y:cy},thickness:.6,color:rgbh(GRAY_SOFT)});
  p.drawCircle({x:cx,y:cy,size:11,color:rgbh("#FFFFFF"),borderColor:rgbh(acc),borderWidth:.8});
  p.drawText(num,{x:cx-F.sansBold.widthOfTextAtSize(num,8.5)/2,y:cy-3,font:F.sansBold,size:8.5,color:rgbh(acc)});
  const foot="Aurore — Section Archives";p.drawText(foot,{x:cx-F.sans.widthOfTextAtSize(foot,7.5)/2,y:14,font:F.sans,size:7.5,color:rgbh("#898B94")});
  return p;
}
function chip(p:any,F:any,acc:string,x:number,y:number,label:string,size=7.2,h=18){
  const t=fit(F.sansBold,label),w=Math.ceil(F.sansBold.widthOfTextAtSize(t,size))+32;
  rounded(p,x,y,w,h,6,rgbh("#F3F3F4"),rgbh("#BFC1C5"),.45);
  p.drawCircle({x:x+11,y:y+h/2,size:2.3,color:rgbh(acc)});
  p.drawText(t,{x:x+20,y:y+h/2-2.5,font:F.sansBold,size,color:rgbh(dk(acc,.9))});
  return w;
}
function card(p:any,x:number,y:number,w:number,h:number,r:number,fill=GRAY,edge=GRAY_EDGE,shadow=true){
  if(shadow){rounded(p,x+2.2,y-2.2,w,h,r,rgbh("#D5D6D9"))}
  rounded(p,x,y,w,h,r,rgbh(fill),rgbh(edge),.5);
}
function text(p:any,font:any,s:string,x:number,y:number,size:number,color:string,maxW?:number,lead?:number){
  const lines=maxW?wrap(font,s,size,maxW):[clean(s)];let yy=y;
  for(const ln of lines){rich(p,font,x,yy,ln,size,color);yy-=lead||size*1.35}
  return yy;
}

// ───────────── Moteur de scène ─────────────
function drawScene(p:any,F:any,sc:any,ox:number,oy:number,s:number,acc:string){
  const P=(a:number[])=>({x:ox+a[0]*s,y:oy+a[1]*s});
  let ax:any=null;
  const col=(el:any)=>rgbh(el.tone==="soft"?"#8A8A8A":"#111111");
  const dash=(el:any)=>el.dash==="dashed"?[5,3]:el.dash==="dotted"?[1.2,2.6]:undefined;
  const poly=(pts:number[][],el:any,opts:any={})=>{ // chemin ouvert tracé en pdf (y vers le haut)
    const d=pts.map((q,i)=>(i?"L ":"M ")+(ox+q[0]*s)+" "+(-(oy+q[1]*s))).join(" ")+(opts.close?" Z":"");
    p.drawSvgPath(d,{x:0,y:0,borderColor:col(el),borderWidth:(el.w||1.1),borderDashArray:dash(el),...(opts.fill?{color:rgbh(opts.fill)}:{})});
  };
  const head=(a:number[],b:number[],el:any)=>{
    const A=P(a),B=P(b),ang=Math.atan2(B.y-A.y,B.x-A.x),L=6.5;
    const d="M "+B.x+" "+(-B.y)+" L "+(B.x-L*Math.cos(ang-.4))+" "+(-(B.y-L*Math.sin(ang-.4)))+" L "+(B.x-L*Math.cos(ang+.4))+" "+(-(B.y-L*Math.sin(ang+.4)))+" Z";
    p.drawSvgPath(d,{x:0,y:0,color:col(el),borderWidth:0});
  };
  const label=(t:string,at:number[],size:number,font:any,anchor="start",color="#111111")=>{
    const q=P(at),txt=clean(t).slice(0,120),w=rw(font,txt,size*Math.min(1,Math.max(.7,s)));
    rich(p,font,anchor==="middle"?q.x-w/2:anchor==="end"?q.x-w:q.x,q.y,txt,size*Math.min(1,Math.max(.7,s)),color);
  };
  for(const el of sc.elements){
    const t=el.t;
    if(t==="axes"){
      ax=el;const [x0,y0]=el.origin,[W,Hh]=el.size;
      poly([[x0,y0],[x0+W,y0]],el);poly([[x0,y0],[x0,y0+Hh]],el);
      head([x0,y0],[x0+W+2,y0],el);head([x0,y0],[x0,y0+Hh+2],el);
      if(el.xlabel)label(el.xlabel,[x0+W-2,y0-12],9,F.italic);
      if(el.ylabel)label(el.ylabel,[x0-12,y0+Hh-4],9,F.italic);
    }else if(t==="plot"){
      const f=compileExpr(el.expr),[xa,xb]=ax.x,[ya,yb]=ax.y,[x0,y0]=ax.origin,[W,Hh]=ax.size,n=Math.min(Number(el.samples)||120,240);
      const pts:number[][]=[];
      for(let k=0;k<=n;k++){const x=el.from+(el.to-el.from)*k/n,y=f(x);if(!Number.isFinite(y))continue;pts.push([x0+(x-xa)/(xb-xa)*W,y0+(y-ya)/(yb-ya)*Hh])}
      if(pts.length>1)poly(pts,{...el,w:el.w||1.5});
      if(el.label){const lx=Number(el.label.at),y=f(lx);if(Number.isFinite(y))label(String(el.label.text||""),[x0+(lx-xa)/(xb-xa)*W+(Number(el.label.dx)||4),y0+(y-ya)/(yb-ya)*Hh+(Number(el.label.dy)||5)],7.5,F.sans)}
    }else if(t==="line")poly([el.p1,el.p2],el);
    else if(t==="arrow"){poly([el.p1,el.p2],el);head(el.p1,el.p2,el)}
    else if(t==="rect"){const [x,y]=el.at,[w,h]=el.size;poly([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],el,{close:true,fill:el.fill})}
    else if(t==="circle"){const q=P(el.c);p.drawCircle({x:q.x,y:q.y,size:el.r*s,borderColor:col(el),borderWidth:el.w||1.1,borderDashArray:dash(el),...(el.fill?{color:rgbh(el.fill)}:{})})}
    else if(t==="polygon")poly(el.points,el,{close:true,fill:el.fill});
    else if(t==="arc"){const pts:number[][]=[];for(let k=0;k<=28;k++){const a=(el.from+(el.to-el.from)*k/28)*Math.PI/180;pts.push([el.c[0]+el.r*Math.cos(a),el.c[1]+el.r*Math.sin(a)])}poly(pts,el)}
    else if(t==="dim"){poly([el.p1,el.p2],{...el,w:.6});head(el.p1,el.p2,el);head(el.p2,el.p1,el);label(el.text,[(el.p1[0]+el.p2[0])/2,(el.p1[1]+el.p2[1])/2+4],7.5,F.sans,"middle")}
    else if(t==="text")label(el.text,el.at,Number(el.size)||8,el.font==="RI"?F.italic:F.sans,el.anchor||"start");
  }
}

// ───────────── Fiche de révision ─────────────
function formulaCard(p:any,F:any,M:Map<string,any>,acc:string,x:number,y:number,w:number,h:number,num:number,fx:any){
  card(p,x,y,w,h,9,GRAY_IN,GRAY_SOFT,false);
  p.drawRectangle({x,y:y+14,width:3,height:h-28,color:rgbh(acc)});
  p.drawCircle({x:x+17,y:y+h-14,size:8,color:rgbh("#FFFFFF"),borderColor:rgbh(acc),borderWidth:.6});
  const ns=String(num);p.drawText(ns,{x:x+17-F.sansBold.widthOfTextAtSize(ns,7.4)/2,y:y+h-16.6,font:F.sansBold,size:7.4,color:rgbh(acc)});
  p.drawText(fit(F.sansBold,fx.title),{x:x+31,y:y+h-17,font:F.sansBold,size:8,color:rgbh(INK)});
  const m=M.get(fx.latex),sc=Math.min(1.25,26/m.h,(w-50)/m.w),iw=m.w*sc,ih=m.h*sc;
  const bh=Math.max(30,ih+12),bw=iw+22,by=y+h-26-bh;
  rounded(p,x+14,by,bw,bh,6,rgbh("#FFFFFF"),rgbh(acc),1);
  p.drawImage(m.img,{x:x+14+11,y:by+(bh-ih)/2,width:iw,height:ih});
  // légende : symbole rendu en LaTeX + sens + (unité)
  let lx=x+14,ly=by-12;const maxX=x+w-14;let lines=1;
  fx.legend.forEach((l:any,i:number)=>{
    const sm=M.get(l.s),k=sm?Math.min(.8,9.5/sm.h):0,sw=sm?sm.w*k:0;
    const tail=" "+l.m+(l.v?" = "+l.v:"")+(l.u?" ("+l.u+")":"");
    const tw=rw(F.sans,tail,6.7),need=sw+2+tw+(i<fx.legend.length-1?9:0);
    if(lx+need>maxX&&lx>x+14&&lines<3){lx=x+14;ly-=11;lines++}
    if(sm)p.drawImage(sm.img,{x:lx,y:ly-2.2,width:sw,height:sm.h*k});
    rich(p,F.sans,lx+sw+2,ly,tail,6.7,INK2);
    lx+=need;
    if(i<fx.legend.length-1)p.drawCircle({x:lx-5,y:ly+2.2,size:.7,color:rgbh(INK3)});
  });
  if(fx.trap)text(p,F.sans,fx.trap,x+14,y+9,6.3,INK3,w-100,7.6);
  if(fx.condition){
    const t=fit(F.sansBold,fx.condition),tw=F.sansBold.widthOfTextAtSize(t,6)+14;
    rounded(p,x+w-tw-8,y+7,tw,12,5,rgbh("#FFFFFF"),rgbh(GRAY_SOFT),.4);
    p.drawText(t,{x:x+w-tw-1,y:y+10.6,font:F.sansBold,size:6,color:rgbh(dk(acc,.9))});
  }
}
async function buildFiche(pdf:any,F:any,l:any,auth:string,fiche:any,theme:string){
  const mode=fiche.mode,acc=accentOf(fiche,theme),fs=fiche.formulas;
  const tex:string[]=[];fs.forEach((x:any)=>{tex.push(x.latex);x.legend.forEach((y:any)=>tex.push(y.s))});
  const M=await mathMap(auth,pdf,tex);
  const chunks:any[][]=[];for(let i=0;i<fs.length;i+=6)chunks.push(fs.slice(i,i+6));
  const total=chunks.length;
  for(let pi=0;pi<total;pi++){
    const first=pi===0,last=pi===total-1,p=pageBase(pdf,F,l,fiche.page_number+pi,mode,acc);
    // En-tête
    if(first){
      card(p,40,712,515,76,14);p.drawRectangle({x:40,y:730,width:3.5,height:40,color:rgbh(acc)});
      chip(p,F,acc,58,764,"FICHE DE RÉVISION");
      text(p,F.sansBold,fiche.title,58,740,17,INK);
      if(fiche.subtitle)text(p,F.sans,fiche.subtitle,58,724,7.8,INK3,470);
    }else{
      card(p,40,742,515,46,12);p.drawRectangle({x:40,y:752,width:3.5,height:26,color:rgbh(acc)});
      chip(p,F,acc,58,764,"FICHE DE RÉVISION · SUITE");
      text(p,F.sansBold,fiche.title,58,750,12,INK);
    }
    let top=first?642:732;
    if(first&&fiche.essentials.length){
      const n=fiche.essentials.length,cw=(515-(n-1)*10)/n;
      fiche.essentials.forEach((e:any,i:number)=>{
        const x=40+i*(cw+10);card(p,x,652,cw,50,9,GRAY_IN,GRAY_SOFT,false);
        p.drawCircle({x:x+12,y:688,size:2.2,color:rgbh(acc)});
        p.drawText(fit(F.sansBold,e.title.toUpperCase()),{x:x+19,y:685.6,font:F.sansBold,size:7.2,color:rgbh(dk(acc,.9))});
        text(p,F.sans,e.text,x+12,672,6.8,INK2,cw-22,8.6);
      });
    }else if(first)top=700;
    const bw=(515-10)/2,bh=108;
    chunks[pi].forEach((fx:any,i:number)=>formulaCard(p,F,M,acc,40+(i%2)*(bw+10),top-bh-Math.floor(i/2)*(bh+8),bw,bh,pi*6+i+1,fx));
    if(last){
      const rowsY=top-bh-Math.floor((chunks[pi].length-1)/2)*(bh+8)-12; // haut libre sous les cartes
      const th=fiche.table?Math.max(125,52+fiche.table.rows.length*19):125;
      const stH=fiche.selftest.length?52+8:0;
      let cursor=rowsY;
      if(fiche.scene||fiche.table){
        const y0=cursor-th;
        if(fiche.scene){
          const sc=fiche.scene,cw=fiche.table?250:515;
          card(p,40,y0,cw,th,10,GRAY_IN,GRAY_SOFT,false);
          const k=Math.min((cw-28)/sc.width,(th-30)/sc.height,1.4);
          drawScene(p,F,sc,40+(cw-sc.width*k)/2,y0+14,k,acc);
        }
        if(fiche.table){
          const t=fiche.table,tx=fiche.scene?300:40,cw=fiche.scene?255:515;
          card(p,tx,y0,cw,th,10,GRAY_IN,GRAY_SOFT,false);
          if(t.title)p.drawText(fit(F.sansBold,t.title.toUpperCase()),{x:tx+14,y:y0+th-16,font:F.sansBold,size:7.2,color:rgbh(dk(acc,.9))});
          const nc=t.columns.length,c0=Math.min(70,(cw-28)*.28),cwid=(cw-28-c0)/(nc-1);
          const xs=t.columns.map((_:any,j:number)=>tx+14+(j===0?0:c0+(j-1)*cwid));
          t.columns.forEach((cn:string,j:number)=>p.drawText(fit(F.sansBold,cn),{x:xs[j]+(j===0?8:0),y:y0+th-32,font:F.sansBold,size:6.4,color:rgbh(INK3)}));
          t.rows.forEach((r:string[],i:number)=>{
            const yy=y0+th-54-i*19;
            rounded(p,tx+9,yy-5,cw-18,16,5,rgbh(i%2===0?"#FFFFFF":"#F7F7F8"),rgbh(GRAY_SOFT),.3);
            p.drawCircle({x:tx+16,y:yy+3,size:1.7,color:rgbh(acc)});
            r.forEach((cell:string,j:number)=>rich(p,j===0?F.sansBold:F.regular,xs[j]+(j===0?8:0),yy,cell,6.9,INK));
          });
        }
        cursor=y0-8;
      }
      if(fiche.selftest.length){
        const sy=Math.max(80,cursor-52);
        card(p,40,sy,515,52,10,GRAY_IN,GRAY_SOFT,false);
        chip(p,F,acc,52,sy+30,"AUTO-TEST · 30 SECONDES",6.4,16);
        const cwid=(515-24)/fiche.selftest.length;
        fiche.selftest.forEach((q:string,i:number)=>text(p,F.sans,(i+1)+". "+q,54+i*cwid,sy+14,6.9,INK2,cwid-10));
      }
    }
  }
  return total;
}

// ───────────── Page « scène » ─────────────
function buildScenePage(pdf:any,F:any,l:any,c:any,theme:string,mode:string){
  const acc=accentOf({mode},theme),p=pageBase(pdf,F,l,Math.max(1,Math.min(999,Number(c.page_number)||11)),mode,acc);
  const title=clean(c.title)||"Schéma",sc=c.scene;
  card(p,40,712,515,76,14);p.drawRectangle({x:40,y:730,width:3.5,height:40,color:rgbh(acc)});
  chip(p,F,acc,58,764,"SCHÉMA");text(p,F.sansBold,title,58,740,17,INK);
  if(clean(c.caption))text(p,F.sans,clean(c.caption).slice(0,160),58,724,7.8,INK3,470);
  const k=Math.min((515-40)/sc.width,600/sc.height,3),boxH=Math.min(640,sc.height*k+50),boxY=700-boxH;
  card(p,40,boxY,515,boxH,12,GRAY_IN,GRAY_SOFT,false);
  drawScene(p,F,sc,40+(515-sc.width*k)/2,boxY+(boxH-sc.height*k)/2,k,acc);
  return 1;
}

// ───────────── API ─────────────
async function update(id:number,patch:any){const q=await admin.from("aurora_generated_documents").select("metadata").eq("id",id).maybeSingle();const m=q.data?.metadata&&typeof q.data.metadata==="object"?q.data.metadata:{};await admin.from("aurora_generated_documents").update({metadata:{...m,...patch},updated_at:new Date().toISOString()}).eq("id",id)}
function normalizeContent(kind:string,content:any){
  if(kind==="fiche"){const v=validateFiche(content);return{errors:v.errors,warnings:v.warnings,normalized:v.fiche}}
  if(kind==="scene"){
    const errors=validateScene(content?.scene,"scene");
    return{errors,warnings:[] as string[],normalized:errors.length?null:{title:clean(content.title).slice(0,80),caption:clean(content.caption).slice(0,160),mode:content.mode==="color"?"color":"nb",page_number:Math.max(1,Math.min(999,Number(content.page_number)||11)),scene:content.scene}};
  }
  return{errors:["kind doit valoir fiche ou scene"],warnings:[] as string[],normalized:null};
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Authentification requise"},401);
  const me=await admin.auth.getUser(auth.slice(7).trim());
  if(me.error||!me.data.user)return out({ok:false,error:"Session utilisateur invalide"},401);
  const uid=me.data.user.id;
  const prof=await admin.from("Profils").select("banni").eq("id",uid).maybeSingle();
  if(prof.error||!prof.data||prof.data.banni===true)return out({ok:false,error:"Compte suspendu ou profil non autorisé"},403);
  let body:any;try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400)}
  if(JSON.stringify(body).length>200_000)return out({ok:false,error:"Contenu trop volumineux (200 Ko maximum)"},413);
  const mode=clean(body?.mode).toLowerCase(),id=Number(body?.generated_document_id||0);

  // validate : aucun enregistrement, renvoie les erreurs précises pour corriger le JSON
  if(mode==="validate"){
    const kind=clean(body?.page_kind).toLowerCase(),r=normalizeContent(kind,body?.content);
    return out({ok:r.errors.length===0,page_kind:kind,errors:r.errors,warnings:r.warnings,normalized:r.errors.length?null:r.normalized});
  }
  if(mode==="status"){
    if(!Number.isInteger(id)||id<1)return out({ok:false,error:"generated_document_id requis"},400);
    const q=await admin.from("aurora_generated_documents").select("id,created_by,pdf_path,pdf_url,metadata,updated_at").eq("id",id).maybeSingle();
    if(q.error)return out({ok:false,error:q.error.message},500);
    if(!q.data||q.data.created_by!==uid)return out({ok:false,error:"Accès refusé"},403);
    const m=q.data.metadata&&typeof q.data.metadata==="object"?q.data.metadata:{};
    return out({ok:true,generated_document_id:id,page_kind:m.sheet_page_kind||null,pdf_path:q.data.pdf_path||null,pdf_url:q.data.pdf_url||null,status:m.fast_page_status||"processing",progress:clamp(Number(m.fast_page_progress||0)),stage:m.fast_page_stage||"Préparation",error:m.fast_page_last_error||null,page_count:m.pdf_page_count||null,updated_at:q.data.updated_at||null});
  }
  if(mode==="create"){
    const courseId=clean(body?.course_id),kind=clean(body?.page_kind).toLowerCase();
    if(!courseId)return out({ok:false,error:"course_id requis"},400);
    // Vérifier l'existence et la propriété du cours avant toute insertion.
    const courseCheck=await admin.from("aurora_assisted_courses").select("id,created_by,title").eq("id",courseId).maybeSingle();
    if(courseCheck.error)return out({ok:false,error:"Vérification du cours impossible : "+courseCheck.error.message},500);
    if(!courseCheck.data)return out({ok:false,error:"Cours d’édition introuvable."},404);
    if(String(courseCheck.data.created_by||"")!==uid)return out({ok:false,error:"Ce cours ne vous appartient pas."},403);
    const r=normalizeContent(kind,body?.content);
    if(r.errors.length)return out({ok:false,error:"JSON invalide : "+r.errors[0],errors:r.errors,warnings:r.warnings},400);
    const title=clean(body?.title)||clean((r.normalized as any)?.title)||"Fiche de révision",color=hex(body?.theme_color),now=new Date().toISOString();
    const job=await admin.from("aurora_content_jobs").insert({created_by:uid,status:"queued",title,subject:null,level:null,class_name:null,document_type:"page_assistee",source_format:"structured",
      prompt:"Édition assistée — fiche ou schéma vectoriel indépendant.",instructions:{assisted_sheet_page:true,page_kind:kind,course_id:courseId,independent_renderer:true,no_lualatex:true},
      source_document_ids:[],metadata:{origin:"edition_assistee",assisted_sheet_page:{course_id:courseId,page_kind:kind}},created_at:now,updated_at:now}).select("id").single();
    if(job.error)return out({ok:false,error:"Création du job impossible : "+job.error.message},500);
    const jobId=Number(job.data.id);
    const ins=await admin.from("aurora_generated_documents").insert({job_id:jobId,created_by:uid,title,document_type:"page_assistee",source_format:"structured",source_content:null,
      content_json:{title,sheet_page:{kind:kind,content:r.normalized}},version:1,status:"generated",validation_notes:"Fiche ou schéma indépendant de l’édition assistée · aperçu uniquement.",
      metadata:{origin:"edition_assistee",assisted_sheet_page:true,sheet_page_kind:kind,preview_only:true,publishable:false,fast_page_status:"queued",fast_page_progress:0,fast_page_stage:"Page créée · rendu prêt à démarrer",fast_page_created_at:now},
      theme_color:color,matiere:null}).select("id").single();
    if(ins.error){await admin.from("aurora_content_jobs").update({status:"rejected",error_message:ins.error.message,updated_at:new Date().toISOString()}).eq("id",jobId).eq("created_by",uid);return out({ok:false,error:"Création de la page impossible : "+ins.error.message},500)}
    return out({ok:true,mode:"create",generated_document_id:Number(ins.data.id),job_id:jobId,page_kind:kind,warnings:r.warnings,progress:0});
  }
  if(mode!=="render")return out({ok:false,error:"mode validate|create|render|status requis"},400);
  if(!Number.isInteger(id)||id<1)return out({ok:false,error:"generated_document_id requis pour le rendu"},400);
  const row=await admin.from("aurora_generated_documents").select("id,created_by,title,metadata,content_json,theme_color").eq("id",id).maybeSingle();
  if(row.error)return out({ok:false,error:row.error.message},500);
  if(!row.data||row.data.created_by!==uid)return out({ok:false,error:"Accès refusé"},403);
  const metadata=row.data.metadata&&typeof row.data.metadata==="object"?row.data.metadata:{};
  if(metadata.assisted_sheet_page!==true)return out({ok:false,error:"Document non reconnu comme fiche ou schéma assisté"},409);
  const kind=clean(row.data.content_json?.sheet_page?.kind||metadata.sheet_page_kind).toLowerCase(),content=row.data.content_json?.sheet_page?.content;
  const re=normalizeContent(kind,kind==="scene"?content:content);
  if(re.errors.length||!re.normalized)return out({ok:false,error:"Contenu enregistré invalide : "+(re.errors[0]||"vide"),errors:re.errors},409);
  try{
    await update(id,{fast_page_status:"processing",fast_page_progress:8,fast_page_stage:"Rendu indépendant démarré",fast_page_started_at:new Date().toISOString(),fast_page_last_error:null});
    const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
    const [F,l]=await Promise.all([fonts(pdf),logo(pdf)]);
    await update(id,{fast_page_progress:30,fast_page_stage:"Ressources prêtes"});
    const theme=hex(body?.theme_color||row.data.theme_color);
    const pages=kind==="fiche"?await buildFiche(pdf,F,l,auth,re.normalized,theme):buildScenePage(pdf,F,l,re.normalized,theme,(re.normalized as any).mode);
    await update(id,{fast_page_progress:75,fast_page_stage:"PDF construit"});
    const bin=new Uint8Array(await pdf.save({useObjectStreams:true}));
    const path="aurora-assisted-sheet-pages/"+uid+"/"+id+"/"+kind+".pdf";
    const up=await admin.storage.from("Pdfs").upload(path,bin,{contentType:"application/pdf",upsert:true});if(up.error)throw new Error(up.error.message);
    const su=await admin.storage.from("Pdfs").createSignedUrl(path,604800);if(su.error)throw new Error(su.error.message);
    const pdfUrl=su.data?.signedUrl||null;
    await admin.from("aurora_generated_documents").update({pdf_path:path,pdf_url:pdfUrl,updated_at:new Date().toISOString(),
      metadata:{...metadata,fast_page_pdf:true,fast_page_pdf_engine:"pdf-lib-sheet-v1",pdf_page_count:pages,fast_page_status:"completed",fast_page_progress:100,fast_page_stage:"Page PDF prête",fast_page_updated_at:new Date().toISOString(),fast_page_last_error:null}
    }).eq("id",id).eq("created_by",uid);
    return out({ok:true,mode:"render",generated_document_id:id,page_kind:kind,page_url:pdfUrl,page_path:path,bytes:bin.length,progress:100,page_count:pages,engine:"pdf-lib-sheet-v1"});
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);
    await update(id,{fast_page_status:"failed",fast_page_progress:0,fast_page_stage:"Échec de génération",fast_page_last_error:msg});
    return out({ok:false,generated_document_id:id,page_kind:kind,error:msg},500);
  }
});
