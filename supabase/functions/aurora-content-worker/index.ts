import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const SECRET_KEYS_RAW=Deno.env.get("SUPABASE_SECRET_KEYS")||"";
let SECRET_KEY="";try{SECRET_KEY=String(JSON.parse(SECRET_KEYS_RAW||"{}")?.default||"").trim();}catch(_){}
const LEGACY_SR=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"").trim();
const SR=SECRET_KEY||LEGACY_SR;
const C={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...C,"Content-Type":"application/json"}});
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:C});
  if(req.method!=="POST")return json({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!SR||auth!==("Bearer "+SR))return json({ok:false,error:"Accès interne requis"},401);
  let body:any={};try{body=await req.json();}catch(_){}
  return json({ok:true,processed:false,status:"editorial_required",job_id:Number(body?.job_id||0)||null,message:"Le contenu est fourni par l’éditeur ChatGPT. Ce worker ne génère aucun contenu et ne revendique aucune demande."});
});