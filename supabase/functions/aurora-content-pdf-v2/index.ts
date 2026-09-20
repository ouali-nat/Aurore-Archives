import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL_=Deno.env.get("SUPABASE_URL")!, KEYS=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}"), SR=KEYS.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"", BWR=(Deno.env.get("BROWSER_PDF_WORKER_URL")||"").replace(/\/$/,""), BWT=Deno.env.get("BROWSER_PDF_WORKER_TOKEN")||"", admin=createClient(URL_,SR,{auth:{autoRefreshToken:false,persistSession:false}});
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
const esc=(x:any)=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function canonicalMath(x:any){
  let s=String(x??"");
  s=s.replace(/\\\\+/g,"\\");
  s=s.replace(/\\infy\\b/g,"\\infty");
  s=s.replace(/\\mathrm\\{quad\\}/g,"\\quad");
  s=s.replace(/\\text\\{mathbb\\{R\\}\\}/g,"\\mathbb{R}");
  s=s.replace(/\\text\\{R\\}/g,"\\mathbb{R}");
  if((s.match(/\\left\\b/g)||[]).length!==(s.match(/\\right\\b/g)||[]).length){
    s=s.replace(/\\left\\b/g,"").replace(/\\right\\b/g,"");
  }
  s=s.replace(/\\^([A-Za-z0-9+\\-])/g,"^{$1}");
  s=s.replace(/_([A-Za-z0-9])/g,"_{$1}");
  return s.trim();
}
function math(x:any){
  let s=canonicalMath(x);
  s=s.replace(/\$\$([\s\S]*?)\$\$/g,"\\[$1\\]");
  s=s.replace(/\$([^$\n]+)\$/g,"\\($1\\)");
  return s;
}
function inline(x:any){const p=math(x).split(/(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g);return p.map((v,i)=>i%2?v:esc(v)).join("");}
function para(x:any){return "<p>"+inline(x)+"</p>";}
let MATHJAX_BUNDLE_CACHE = "";
async function mathjaxBundle(){
  if(MATHJAX_BUNDLE_CACHE) return MATHJAX_BUNDLE_CACHE;
  const urls=["https://cdn.jsdelivr.net/npm/mathjax@4/tex-mml-svg.js","https://cdnjs.cloudflare.com/ajax/libs/mathjax/4.0.0/tex-mml-svg.js"];
  let last="";
  for(const url of urls){
    try{
      const r=await fetch(url);
      if(r.ok){
        const js=await r.text();
        if(js.length>100000){
          MATHJAX_BUNDLE_CACHE=js.replaceAll("</script","<\\/script");
          return MATHJAX_BUNDLE_CACHE;
        }
        last="bundle trop court";
      }else last="HTTP "+r.status;
    }catch(e){ last=e instanceof Error?e.message:String(e); }
  }
  throw new Error("Impossible de charger MathJax côté serveur: "+last);
}
async function signed(path:string){if(!path)return "";const r=await admin.storage.from("Pdfs").createSignedUrl(path,3600);return r.data?.signedUrl||"";}
async function html(d:any){
  const MATHJAX_BUNDLE=await mathjaxBundle();
  const q=d||{},sections=Array.isArray(q.sections)?q.sections:[],graphs:any[]=[];
  for(const s of sections)for(const g of (Array.isArray(s.graphs)?s.graphs:[])){const u=await signed(g.geogebra_image_path);if(u)graphs.push({g,u});}
  let body="";
  if(q.introduction)body+="<section><h2>Introduction</h2>"+para(q.introduction)+"</section>";
  if(Array.isArray(q.learning_objectives)&&q.learning_objectives.length)body+="<section><h2>Objectifs d'apprentissage</h2><ul>"+q.learning_objectives.map((x:any)=>"<li>"+inline(x)+"</li>").join("")+"</ul></section>";
  for(const s of sections){
    body+="<section><h2>"+esc(s.title||"Section")+"</h2>";
    if(s.objective)body+='<div class="note"><b>Objectif :</b> '+inline(s.objective)+"</div>";
    if(s.formula)body+='<div class="formula">\\['+canonicalMath(s.formula)+"\\]</div>";
    for(const x of (Array.isArray(s.content)?s.content:[]))body+=para(x);
    for(const z of graphs.filter(v=>(Array.isArray(s.graphs)?s.graphs:[]).indexOf(v.g)>=0))body+='<figure><img src="'+esc(z.u)+'"><figcaption>'+esc(z.g.title||"Graphique")+"</figcaption></figure>";
    if(Array.isArray(s.exercises)&&s.exercises.length){body+="<h3>Exercices</h3>";s.exercises.forEach((e:any,i:number)=>{body+='<div class="exercise"><b>Exercice '+(i+1)+"</b>"+para(e.question||"")+(e.hint?'<div class="hint"><b>Indication :</b> '+inline(e.hint)+"</div>":"")+(e.formula?'<div class="formula">\\['+canonicalMath(e.formula)+"\\]</div>":"")+"</div>";});}
    body+="</section>";
  }
  if(Array.isArray(q.corrections)&&q.corrections.length){body+='<section><h2>Corrigés</h2>';q.corrections.forEach((c:any)=>{body+='<div class="correction"><b>Corrigé — exercice '+esc(c.exercise_number||"")+"</b>"+(c.formula?'<div class="formula">\\['+canonicalMath(c.formula)+"\\]</div>":"")+para(c.solution||"")+"</div>";});body+="</section>";}
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>'+esc(q.title||"Aurore")+'</title><style>@page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans",sans-serif;color:#17221b;font-size:11pt;line-height:1.5;-webkit-print-color-adjust:exact}.cover{min-height:250mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}.brand{font-weight:800;letter-spacing:.12em;color:#167044}.cover h1{font-size:27pt;color:#0e4029;line-height:1.1}h2{font-size:18pt;color:#0e4029;border-bottom:2px solid #86b59a;padding-bottom:3mm;margin:10mm 0 5mm;break-after:avoid}h3{color:#17633e}p{margin:0 0 4mm}li{margin:1.5mm 0}.note,.hint{padding:3mm 4mm;border-left:3px solid #6cae88;background:#f1f8f3;margin:3mm 0 5mm}.formula{text-align:center;margin:5mm 0;break-inside:avoid}.exercise,.correction{border:1px solid #c7d9cd;border-radius:4mm;padding:4mm 5mm;margin:5mm 0;break-inside:avoid}.correction{background:#fbfdfb}figure{text-align:center;break-inside:avoid}figure img{max-width:100%;max-height:110mm}figcaption{font-size:9pt;color:#5f6e65}</style><script>window.MathJax={tex:{inlineMath:[["\\(","\\)"],["$","$"]],displayMath:[["\\[","\\]"],["$$","$$"]]},svg:{fontCache:"global"}};</script><script>${MATHJAX_BUNDLE}</script></head><body><div class="cover"><div class="brand">AURORE — SECTION ARCHIVES</div><h1>'+esc(q.title||"Document pédagogique")+'</h1><p>Document pédagogique généré par Aurora</p></div><main>'+body+'</main><script>(async()=>{try{if(!window.MathJax?.startup?.promise)throw new Error("MathJax n’a pas terminé son initialisation.");await MathJax.startup.promise;await MathJax.typesetPromise(document.body);if(document.fonts?.ready)await document.fonts.ready;const __merr=document.querySelectorAll(".mjx-merror").length;if(__merr)throw new Error("MathJax a détecté "+__merr+" erreur(s) LaTeX.");window.status="ready";}catch(e){window.status="mathjax-error:"+String(e instanceof Error?e.message:e);throw e;}})();</script></body></html>';
}
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response(null,{headers:C});if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);if(!BWR||!BWT)return out({ok:false,error:"Configuration du Worker PDF manquante dans les secrets Supabase."},503);if(!SR)return out({ok:false,error:"Clé serveur Supabase manquante."},500);try{const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");if(!token)return out({ok:false,error:"Session absente."},401);const auth=createClient(URL_,SR,{global:{headers:{Authorization:"Bearer "+token}},auth:{autoRefreshToken:false,persistSession:false}});const me=await auth.auth.getUser(token);if(me.error||!me.data.user)return out({ok:false,error:"Session invalide."},401);const p=await req.json(),id=Number(p.generated_document_id);if(!Number.isFinite(id))return out({ok:false,error:"ID invalide."},400);const d=await admin.from("aurora_generated_documents").select("id,title,content_json,metadata").eq("id",id).maybeSingle();if(d.error||!d.data)return out({ok:false,error:"Document introuvable."},404);const h=await html(d.data.content_json||{});const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),135000);let r:Response;try{r=await fetch(BWR,{method:"POST",headers:{"Content-Type":"application/json","x-pdf-service-token":BWT},body:JSON.stringify({html:h}),signal:ac.signal});}finally{clearTimeout(tm)}if(!r.ok){const msg=(await r.text()).slice(0,1500);return out({ok:false,error:"Service PDF HTTP "+r.status+": "+msg},502);}const pdf=new Uint8Array(await r.arrayBuffer());const sig=new TextDecoder().decode(pdf.slice(0,5));if(pdf.length<1000||sig!=="%PDF-")return out({ok:false,error:"PDF invalide renvoyé par le service PDF."},502);const path="aurora-content-generated/"+me.data.user.id+"/"+id+".pdf";const up=await admin.storage.from("Pdfs").upload(path,pdf,{contentType:"application/pdf",upsert:true,cacheControl:"3600"});if(up.error)return out({ok:false,error:up.error.message},500);const su=await admin.storage.from("Pdfs").createSignedUrl(path,2592000);if(su.error)return out({ok:false,error:su.error.message},500);const meta={...(d.data.metadata||{}),pdf_engine:"cloudflare-browser-rendering+puppeteer+mathjax-svg-v1",pdf_generated_at:new Date().toISOString(),pdf_bytes:pdf.length};const db=await admin.from("aurora_generated_documents").update({pdf_path:path,pdf_url:su.data.signedUrl,metadata:meta,pdf_diagnostic:{ok:true,engine:"cloudflare-browser-rendering+puppeteer+mathjax-svg-v1",bytes:pdf.length}}).eq("id",id);if(db.error)return out({ok:false,error:db.error.message},500);return out({ok:true,pdf_url:su.data.signedUrl,bytes:pdf.length,engine:"cloudflare-browser-rendering+puppeteer+mathjax-svg-v1"});}catch(e){return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}});
