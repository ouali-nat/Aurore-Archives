import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SR = KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GB = (Deno.env.get("GOTENBERG_URL") || "").replace(/\/$/, "");
const GT = Deno.env.get("GOTENBERG_TOKEN") || "";
const admin = createClient(URL_, SR, {auth:{autoRefreshToken:false,persistSession:false}});
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
const esc=(x:any)=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function math(x:any){let s=String(x??"");s=s.replace(/\$\$([\s\S]*?)\$\$/g,"\\[$1\\]");s=s.replace(/\$([^$\n]+)\$/g,"\\($1\\)");return s;}
function inline(x:any){const p=math(x).split(/(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g);return p.map((v,i)=>i%2?v:esc(v)).join("");}
function para(x:any){return "<p>"+inline(x)+"</p>";}
async function signed(path:string){if(!path)return "";const r=await admin.storage.from("Pdfs").createSignedUrl(path,3600);return r.data?.signedUrl||"";}
async function html(d:any){
  const q=d||{}, sections=Array.isArray(q.sections)?q.sections:[], graphs:any[]=[];
  for(const s of sections) for(const g of (Array.isArray(s.graphs)?s.graphs:[])){const u=await signed(g.geogebra_image_path);if(u)graphs.push({g,u});}
  let body="";
  if(q.introduction)body+="<section><h2>Introduction</h2>"+para(q.introduction)+"</section>";
  if(Array.isArray(q.learning_objectives)&&q.learning_objectives.length)body+="<section><h2>Objectifs d'apprentissage</h2><ul>"+q.learning_objectives.map((x:any)=>"<li>"+inline(x)+"</li>").join("")+"</ul></section>";
  for(const s of sections){
    body+="<section><h2>"+esc(s.title||"Section")+"</h2>";
    if(s.objective)body+='<div class="note"><b>Objectif :</b> '+inline(s.objective)+"</div>";
    if(s.formula)body+='<div class="formula">\\['+String(s.formula)+"\\]</div>";
    for(const x of (Array.isArray(s.content)?s.content:[]))body+=para(x);
    for(const z of graphs.filter(v=>(Array.isArray(s.graphs)?s.graphs:[]).indexOf(v.g)>=0))body+='<figure><img src="'+esc(z.u)+'"><figcaption>'+esc(z.g.title||"Graphique")+"</figcaption></figure>";
    if(Array.isArray(s.exercises)&&s.exercises.length){
      body+="<h3>Exercices</h3>";
      s.exercises.forEach((e:any,i:number)=>{body+='<div class="exercise"><b>Exercice '+(i+1)+"</b>"+para(e.question||"")+(e.hint?'<div class="hint"><b>Indication :</b> '+inline(e.hint)+"</div>":"")+(e.formula?'<div class="formula">\\['+String(e.formula)+"\\]</div>":"")+"</div>";});
    }
    body+="</section>";
  }
  if(Array.isArray(q.corrections)&&q.corrections.length){
    body+='<section><h2>Corrigés</h2>';
    q.corrections.forEach((c:any)=>{body+='<div class="correction"><b>Corrigé — exercice '+esc(c.exercise_number||"")+"</b>"+(c.formula?'<div class="formula">\\['+String(c.formula)+"\\]</div>":"")+para(c.solution||"")+"</div>";});
    body+="</section>";
  }
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>'+esc(q.title||"Aurore")+'</title><style>'+
  '@page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans",sans-serif;color:#17221b;font-size:11pt;line-height:1.5;-webkit-print-color-adjust:exact}'+
  '.cover{min-height:250mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}.brand{font-weight:800;letter-spacing:.12em;color:#167044}.cover h1{font-size:27pt;color:#0e4029;line-height:1.1}'+
  'h2{font-size:18pt;color:#0e4029;border-bottom:2px solid #86b59a;padding-bottom:3mm;margin:10mm 0 5mm;break-after:avoid}h3{color:#17633e}p{margin:0 0 4mm}li{margin:1.5mm 0}'+
  '.note,.hint{padding:3mm 4mm;border-left:3px solid #6cae88;background:#f1f8f3;margin:3mm 0 5mm}.formula{text-align:center;margin:5mm 0;break-inside:avoid}'+
  '.exercise,.correction{border:1px solid #c7d9cd;border-radius:4mm;padding:4mm 5mm;margin:5mm 0;break-inside:avoid}.correction{background:#fbfdfb}figure{text-align:center;break-inside:avoid}figure img{max-width:100%;max-height:110mm}figcaption{font-size:9pt;color:#5f6e65}'+
  '</style><script>window.status="loading";window.MathJax={tex:{inlineMath:[["\\(","\\)"],["$","$"]],displayMath:[["\\[","\\]"],["$$","$$"]]},svg:{fontCache:"global"}};</script><script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script></head><body>'+
  '<div class="cover"><div class="brand">AURORE — SECTION ARCHIVES</div><h1>'+esc(q.title||"Document pédagogique")+'</h1><p>Document pédagogique généré par Aurora</p></div><main>'+body+'</main>'+
  '<script>(async()=>{try{await MathJax.startup.promise;await MathJax.typesetPromise();if(document.fonts)await document.fonts.ready;}finally{window.status="ready";}})();</script></body></html>';
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:C});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  if(!GB)return out({ok:false,error:"GOTENBERG_URL manquant dans les secrets Supabase."},503);
  if(!SR)return out({ok:false,error:"Clé serveur Supabase manquante."},500);
  try{
    const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
    if(!token)return out({ok:false,error:"Session absente."},401);
    const auth=createClient(URL_,SR,{global:{headers:{Authorization:"Bearer "+token}},auth:{autoRefreshToken:false,persistSession:false}});
    const me=await auth.auth.getUser(token);if(me.error||!me.data.user)return out({ok:false,error:"Session invalide."},401);
    const p=await req.json(),id=Number(p.generated_document_id);if(!Number.isFinite(id))return out({ok:false,error:"ID invalide."},400);
    const d=await admin.from("aurora_generated_documents").select("id,title,content_json,metadata").eq("id",id).maybeSingle();if(d.error||!d.data)return out({ok:false,error:"Document introuvable."},404);
    const h=await html(d.data.content_json||{});
    const f=new FormData();f.append("files",new Blob([h],{type:"text/html"}),"index.html");f.append("preferCssPageSize","true");f.append("printBackground","true");f.append("waitForExpression","window.status === 'ready'");f.append("waitDelay","500ms");f.append("generateDocumentOutline","true");f.append("failOnConsoleExceptions","true");
    const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),135000);let r:Response;try{r=await fetch(GB+"/forms/chromium/convert/html",{method:"POST",headers:{"x-pdf-service-token":GT,"Gotenberg-Output-Filename":"aurore-"+id+".pdf"},body:f,signal:ac.signal});}finally{clearTimeout(tm);}
    if(!r.ok)return out({ok:false,error:"Gotenberg HTTP "+r.status+": "+(await r.text()).slice(0,1000)},502);
    const pdf=new Uint8Array(await r.arrayBuffer());if(pdf.length<1000)return out({ok:false,error:"PDF invalide renvoyé par Gotenberg."},502);
    const path="aurora-content-generated/"+me.data.user.id+"/"+id+".pdf";
    const up=await admin.storage.from("Pdfs").upload(path,pdf,{contentType:"application/pdf",upsert:true,cacheControl:"3600"});if(up.error)return out({ok:false,error:up.error.message},500);
    const su=await admin.storage.from("Pdfs").createSignedUrl(path,2592000);if(su.error)return out({ok:false,error:su.error.message},500);
    const meta={...(d.data.metadata||{}),pdf_engine:"gotenberg+chromium+mathjax-svg-v1",pdf_generated_at:new Date().toISOString(),pdf_bytes:pdf.length};
    const db=await admin.from("aurora_generated_documents").update({pdf_path:path,pdf_url:su.data.signedUrl,metadata:meta,pdf_diagnostic:{ok:true,engine:"gotenberg+chromium+mathjax-svg-v1",bytes:pdf.length}}).eq("id",id);if(db.error)return out({ok:false,error:db.error.message},500);
    return out({ok:true,pdf_url:su.data.signedUrl,bytes:pdf.length,engine:"gotenberg+chromium+mathjax-svg-v1"});
  }catch(e){return out({ok:false,error:e instanceof Error?e.message:String(e)},500);}
});
