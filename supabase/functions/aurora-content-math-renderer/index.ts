import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { mathjax } from "npm:mathjax-full@3.2.2/js/mathjax.js";
import { TeX } from "npm:mathjax-full@3.2.2/js/input/tex.js";
import { SVG } from "npm:mathjax-full@3.2.2/js/output/svg.js";
import { liteAdaptor } from "npm:mathjax-full@3.2.2/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "npm:mathjax-full@3.2.2/js/handlers/html.js";
import { AllPackages } from "npm:mathjax-full@3.2.2/js/input/tex/AllPackages.js";
import { Resvg, initWasm } from "npm:@resvg/resvg-wasm@2.6.2";
import PDFKit from "npm:pdfkit@0.16.0";
import SVGtoPDF from "npm:svg-to-pdfkit@0.1.8";
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
const MATH_EM_PX=15.07;
const MATH_EX_PX=7.54;
const MATH_RASTER_SCALE=3;
function normalizeMathColorCommands(source:string){
  return String(source??"").replace(/\\(textcolor|color|pagecolor)\s*\[HTML\]\s*\{([0-9a-f]{6})\}/gi,(_match,name,hex)=>{
    const h=String(hex).toLowerCase();
    const channels=[0,2,4].map(i=>(parseInt(h.slice(i,i+2),16)/255).toFixed(3));
    return "\\"+String(name)+"[rgb]{"+channels.join(",")+"}";
  });
}
function assertMathJaxNoErrors(markup:string){
  if(/mjx-merror|data-mml-node=["']merror["']/i.test(String(markup||""))){
    throw new Error("LaTeX invalide : MathJax a détecté une expression non interprétable.");
  }
}
const MATH_MAX_RASTER_PX=8000;
let ready:any=null;
async function engine(){
  if(ready)return ready;
  const a=liteAdaptor();
  RegisterHTMLHandler(a);
  const h=mathjax.document("",{
    InputJax:new TeX({packages:AllPackages}),
    OutputJax:new SVG({fontCache:"local"})
  });
  const w=await fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm");
  if(!w.ok)throw Error(`Resvg WASM HTTP ${w.status}`);
  await initWasm(await w.arrayBuffer());
  ready={h,a};
  return ready;
}
let vectorReady:any=null;
async function vectorEngine(){
  if(vectorReady)return vectorReady;
  const a=liteAdaptor();
  RegisterHTMLHandler(a);
  const h=mathjax.document("",{
    InputJax:new TeX({packages:AllPackages}),
    OutputJax:new SVG({fontCache:"none"})
  });
  vectorReady={h,a};
  return vectorReady;
}
function svgPdfBytes(svg:string,widthPx:number,heightPx:number):Promise<Uint8Array>{
  const widthPt=Math.max(1,widthPx*0.75),heightPt=Math.max(1,heightPx*0.75);
  const safeSvg=svg.replace(/currentColor/g,"#171717")
    .replace(/(<svg\b[^>]*?)\swidth="[^"]*"/i,(_m,head)=>head+' width="'+widthPt+'pt"')
    .replace(/(<svg\b[^>]*?)\sheight="[^"]*"/i,(_m,head)=>head+' height="'+heightPt+'pt"');
  return new Promise((resolve,reject)=>{
    let doc:any;
    const chunks:Uint8Array[]=[];
    try{
      doc=new (PDFKit as any)({size:[widthPt,heightPt],margin:0,compress:true});
      doc.on("data",(chunk:any)=>chunks.push(new Uint8Array(chunk)));
      doc.on("error",(error:any)=>reject(error));
      doc.on("end",()=>{
        const total=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
        const bytes=new Uint8Array(total);let offset=0;
        for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
        resolve(bytes);
      });
      (SVGtoPDF as any)(doc,safeSvg,0,0,{width:widthPt,height:heightPt,preserveAspectRatio:"xMidYMid meet"});
      doc.end();
    }catch(error){reject(error);}
  });
}
async function formulaVector(s:string,pxPerEx=MATH_EX_PX,displayMode=true){
  const {h,a}=await vectorEngine();
  const unit=Math.max(6,Math.min(10,Number(pxPerEx)||MATH_EX_PX));
  const node=h.convert(normalizeMathColorCommands(s),{display:displayMode,em:MATH_EM_PX,ex:unit});
  const markup=a.innerHTML(node);
  assertMathJaxNoErrors(markup);
  const start=markup.search(/<svg\b/i);
  if(start<0)throw Error("MathJax SVG vectoriel vide");
  const tags=/<\/?svg\b[^>]*>/gi;tags.lastIndex=start;let depth=0,m:RegExpExecArray|null,svg:string|null=null;
  while((m=tags.exec(markup))){
    if(/^<\/svg\b/i.test(m[0]))depth--;
    else if(!/\/\s*>$/.test(m[0]))depth++;
    if(depth===0){svg=markup.slice(start,tags.lastIndex);break;}
  }
  if(!svg)throw Error("SVG vectoriel incomplet");
  const wMatch=svg.match(/width="([\d.]+)ex"/),hMatch=svg.match(/height="([\d.]+)ex"/);
  const exWidth=wMatch?Math.max(1,parseFloat(wMatch[1])):10;
  const exHeight=hMatch?Math.max(1,parseFloat(hMatch[1])):3;
  const naturalPxW=exWidth*unit,naturalPxH=exHeight*unit;
  const pdf=await svgPdfBytes(svg,naturalPxW,naturalPxH);
  return {pdf,natural_pt_width:naturalPxW*0.75,natural_pt_height:naturalPxH*0.75};
}
async function formula(s:string,pxPerEx=MATH_EX_PX,requestedRasterScale=MATH_RASTER_SCALE){
  const {h,a}=await engine();
  const unit=Math.max(6,Math.min(10,Number(pxPerEx)||MATH_EX_PX));
  const n=h.convert(normalizeMathColorCommands(s),{
    display:true,
    em:MATH_EM_PX,
    ex:unit
  });
  const markup=a.innerHTML(n);
  assertMathJaxNoErrors(markup);
  // Extract the complete root SVG, correctly handling nested <svg> elements.
  function extractSvg(source:string){
    const start=source.search(/<svg\b/i);
    if(start<0)return null;
    const tags=/<\/?svg\b[^>]*>/gi;
    tags.lastIndex=start;
    let depth=0,m:RegExpExecArray|null;
    while((m=tags.exec(source))){
      if(/^<\/svg\b/i.test(m[0]))depth--;
      else if(!/\/\s*>$/.test(m[0]))depth++;
      if(depth===0)return source.slice(start,tags.lastIndex);
    }
    return null;
  }
  const rawSvg=extractSvg(markup);
  if(!rawSvg)throw Error("MathJax SVG vide");
  const svg=rawSvg.replace(/currentColor/g,"#171717");
  const wMatch=svg.match(/width="([\d.]+)ex"/);
  const hMatch=svg.match(/height="([\d.]+)ex"/);
  const exWidth=wMatch?Math.max(1,parseFloat(wMatch[1])):10;
  const exHeight=hMatch?Math.max(1,parseFloat(hMatch[1])):3;
  const naturalPxW=exWidth*unit;
  const naturalPxH=exHeight*unit;
  const requestedScale=Number(requestedRasterScale);
  const scale=Number.isFinite(requestedScale)?Math.max(1,Math.min(3,requestedScale)):MATH_RASTER_SCALE;
  const rasterWidth=Math.min(
    MATH_MAX_RASTER_PX,
    Math.max(24,Math.round(naturalPxW*scale))
  );
  const png=new Uint8Array(
    new Resvg(svg,{fitTo:{mode:"width",value:rasterWidth}}).render().asPng()
  );
  return {
    png,
    natural_pt_width:naturalPxW*0.75,
    natural_pt_height:naturalPxH*0.75,
    raster_scale:rasterWidth/Math.max(1,naturalPxW)
  };
}
function safe(g:any,x:number){let s=String(g?.expression??"").trim().replace(/^\s*(?:f\s*\(x\)|y)\s*=\s*/i,"").replace(/−/g,"-").replace(/π/g,"pi").replace(/√\s*\(/g,"sqrt(").replace(/²/g,"^2").replace(/³/g,"^3").replace(/\s+/g,"");if(!/^[0-9xX+\-*/^().,a-zA-Z_]+$/.test(s))return null;s=s.replace(/([0-9.)xX])([xX(])/g,"$1*$2").replace(/\^/g,"**").replace(/\bpi\b/g,"Math.PI").replace(/\bsqrt\b/g,"Math.sqrt").replace(/\bsin\b/g,"Math.sin").replace(/\bcos\b/g,"Math.cos").replace(/\btan\b/g,"Math.tan").replace(/\bexp\b/g,"Math.exp").replace(/\bln\b/g,"Math.log").replace(/\blog\b/g,"Math.log10").replace(/\bx\b/gi,"("+x+")");try{return Number(Function(`return (${s})`)())}catch{return null}}
async function graphLocal(g:any){const W=1200,H=680,P=92,xmin=Number.isFinite(Number(g.x_min))?Number(g.x_min):-5,xmax=Number.isFinite(Number(g.x_max))?Number(g.x_max):5,ymin=Number.isFinite(Number(g.y_min))?Number(g.y_min):-5,ymax=Number.isFinite(Number(g.y_max))?Number(g.y_max):5,X=(x:number)=>P+(x-xmin)/(xmax-xmin)*(W-2*P),Y=(y:number)=>H-P-(y-ymin)/(ymax-ymin)*(H-2*P);let d="";for(let i=0;i<=800;i++){const x=xmin+(xmax-xmin)*i/800,y=safe(g,x);if(Number.isFinite(y)&&y>=ymin&&y<=ymax)d+=(d?` L ${X(x)} ${Y(y)}`:`M ${X(x)} ${Y(y)}`)}const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="white"/><line x1="${X(0)}" y1="${P}" x2="${X(0)}" y2="${H-P}" stroke="#222" stroke-width="4"/><line x1="${P}" y1="${Y(0)}" x2="${W-P}" y2="${Y(0)}" stroke="#222" stroke-width="4"/><path d="${d}" fill="none" stroke="#2f6fed" stroke-width="5"/></svg>`;return new Uint8Array(new Resvg(svg,{fitTo:{mode:"width",value:1500}}).render().asPng())}
const enc=(b:Uint8Array)=>{let s="";const step=0x8000;for(let i=0;i<b.length;i+=step)s+=String.fromCharCode(...b.subarray(i,i+step));return btoa(s)};
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:C});
  if(req.method!=="POST")return json({error:"Méthode non autorisée"},405);
  if(!req.headers.get("Authorization")?.startsWith("Bearer "))return json({error:"Authentification requise"},401);
  let body:any;try{body=await req.json()}catch{return json({error:"JSON invalide"},400)}
  try{
    if(body?.kind==="graph")return json({ok:true,png_base64:enc(await graphLocal(body.graph||{}))});
    const incoming=Array.isArray(body?.formulas)?body.formulas:[body?.formula];
    if(body?.format==="pdf-vector"){
      const items=incoming.map((item:any)=>typeof item==="string"
        ?{latex:item,display:true}
        :{latex:String(item?.latex??item?.formula??""),display:item?.display!==false})
        .filter((item:any)=>item.latex.trim());
      if(!items.length)return json({error:"Aucune formule"},400);
      const vectorResults:any[]=[];
      for(const item of items){
        const rendered=await formulaVector(item.latex,body?.px_per_ex,item.display);
        vectorResults.push({
          pdf_base64:enc(rendered.pdf),bytes:rendered.pdf.length,
          natural_pt_width:rendered.natural_pt_width,
          natural_pt_height:rendered.natural_pt_height,
          format:"vector-pdf",display:item.display
        });
      }
      return json({ok:true,renderer:"mathjax-svg-to-vector-pdf-v1",results:vectorResults});
    }
    const list=incoming.filter((x:any)=>typeof x==="string"&&x.trim());
    if(!list.length)return json({error:"Aucune formule"},400);
    const out:any[]=[];
    for(const f of list){
      const rendered=await formula(f,body?.px_per_ex,body?.raster_scale);
      out.push({
        png_base64:enc(rendered.png),bytes:rendered.png.length,
        natural_pt_width:rendered.natural_pt_width,
        natural_pt_height:rendered.natural_pt_height,
        raster_scale:rendered.raster_scale
      });
    }
    return json({ok:true,renderer:"mathjax-v3-11.3pt-natural-size",results:out});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});
