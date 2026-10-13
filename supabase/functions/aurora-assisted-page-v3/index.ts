import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const C = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const out=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers:{...C,"Content-Type":"application/json"}});

const clean=(v:unknown)=>String(v??"").replace(/[\u0000-\u001F]/g," ").replace(/\s+/g," ").trim();

function validWikimedia(content:any){
  if(!String(content?.imageUrl||"").startsWith("https://upload.wikimedia.org/")) return false;
  if(!String(content?.sourceUrl||"").startsWith("https://commons.wikimedia.org/")) return false;
  const lic=clean(content?.license);
  if(!lic || /fair use|non-commercial|noncommercial|no derivatives/i.test(lic)) return false;
  return true;
}
function safeWikimediaDisplayUrl(thumbnail:any,original:any){
  const fallback=String(original||"").trim();
  const candidate=String(thumbnail||"").trim();
  try{
    const u=new URL(candidate);
    if(u.protocol==="https:"&&["upload.wikimedia.org","thumb.wikimedia.org"].includes(u.hostname))return u.toString();
  }catch(_){}
  return fallback;
}

function normalizeHexColor(value:any){
  const h=String(value??"").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(h)?h:null;
}

function extractStructuredText(value:any):string{
  if(value===null||value===undefined)return "";
  if(typeof value!=="string")return String(value);
  const raw=value.trim();
  if(!raw)return "";
  if((raw.startsWith("{")&&raw.endsWith("}"))||(raw.startsWith("[")&&raw.endsWith("]"))){
    try{
      const parsed=JSON.parse(raw);
      const walk=(node:any):string=>{
        if(node===null||node===undefined)return "";
        if(typeof node==="string")return node;
        if(Array.isArray(node))return node.map(walk).filter(Boolean).join("\n\n");
        if(typeof node!=="object")return String(node);
        if(typeof node.text==="string")return node.text;
        if(typeof node.body==="string")return node.body;
        if(typeof node.statement==="string")return node.statement;
        if(typeof node.question==="string")return node.question;
        if(typeof node.content==="string")return node.content;
        if(node.content&&typeof node.content==="object")return walk(node.content);
        return "";
      };
      const extracted=walk(parsed).trim();
      if(extracted)return extracted;
    }catch(_){}
  }
  return value;
}


function blockContentOf(block:any){
  if(typeof block?.content==="string")return {text:block.content};
  if(block?.content&&typeof block.content==="object"&&!Array.isArray(block.content))return block.content;
  return {};
}
function blockTextOf(content:any):string{
  if(typeof content==="string")return extractStructuredText(content);
  if(!content||typeof content!=="object")return "";
  return extractStructuredText(content.text??content.content??content.body??"");
}

function buildContent(courseTitle:string,pageNumber:number,block:any,themeColor:string|null){
  const type=clean(block?.type||"paragraph").toLowerCase();
  const content=blockContentOf(block);
  const section:any={title:"Bloc "+String(pageNumber),content:[],exercises:[],graphs:[],assisted_block_id:String(block?.id||"")};
  if(type==="paragraph") section.content=[blockTextOf(content)];
  else if(type==="point") section.point={title:String(content.title||"Point de cours"),text:blockTextOf(content),color:String(content.color||""),rank:Number(content.rank)||1};
  else if(type==="exercise") section.exercises=[{id:String(block?.id||""),title:String(content.title||"Exercice"),statement:extractStructuredText(content.statement||""),hint:extractStructuredText(content.hint||""),correction_title:String(content.correction_title||"Corrigé"),correction:extractStructuredText(content.correction||"")}];
  else if(type==="graphique") section.graphs=[content.json&&typeof content.json==="object"?content.json:{}];
  else if(type==="vector-scene"){
    const json=content.json&&typeof content.json==="object"&&!Array.isArray(content.json)?content.json:{};
    const scene=json.scene&&typeof json.scene==="object"&&!Array.isArray(json.scene)?json.scene:null;
    if(!scene||!Array.isArray(scene.elements)||!scene.elements.length)throw new Error("Le schéma vectoriel ne contient aucune scène exploitable.");
    section.title=clean(json.title)||"Schéma vectoriel";
    section.content=[];
    section.vector_scenes=[{title:String(json.title||"Schéma vectoriel"),caption:String(json.caption||""),scene}];
  }
  else if(type==="wikimedia-image"){
    const image={
      url:safeWikimediaDisplayUrl(content.thumbUrl,content.imageUrl),
      caption:String(content.caption||""),
      title:String(content.title||""),
      author:String(content.author||""),
      license:String(content.license||""),
      source_url:String(content.sourceUrl||"")
    };
    // Le renderer rapide collecte les images dans section.images quand sections existe.
    // Le tableau images racine seul était ignoré et la section affichait uniquement le texte de remplacement.
    section.title=clean(content.title)||"Illustration Wikimedia";
    section.content=[];
    section.images=[image];
  }
  else throw new Error("Type de bloc non pris en charge : "+type);
  return {
    title:courseTitle,
    theme_color:themeColor,
    document_type:"page_assistee",
    source_format:"structured",
    sections:[section],
    images:type==="wikimedia-image" ? [{
      url:safeWikimediaDisplayUrl(content.thumbUrl,content.imageUrl),
      caption:String(content.caption||""),
      title:String(content.title||""),
      author:String(content.author||""),
      license:String(content.license||""),
      source_url:String(content.sourceUrl||"")
    }] : [],
    assisted_block:{id:String(block?.id||""),type,content}
  };
}


function buildFlowContent(courseTitle:string,pageNumber:number,blocks:any[],themeColor:string|null,userId:string){
  const title=String(courseTitle||"Cours").trim()||"Cours";
  const sections:any[]=[];
  const sourceBlocks=Array.isArray(blocks)?blocks.filter((b:any)=>b&&typeof b==="object"):[];
  if(!sourceBlocks.length)throw new Error("Aucun bloc de flux à rendre.");
  let exerciseNumber=0;
  for(let i=0;i<sourceBlocks.length;i++){
    const b=sourceBlocks[i],type=clean(b?.type||"paragraph").toLowerCase();
    const content=blockContentOf(b);
    const blockId=String(b?.id||"");
    const common={assisted_block_id:blockId};
    if(type==="paragraph"){
      const text=blockTextOf(content);
      if(clean(text))sections.push({...common,title:"Bloc "+String(i+1),content:[text],exercises:[],graphs:[]});
    }else if(type==="point"){
      const text=blockTextOf(content);
      if(clean(text))sections.push({...common,title:clean(content.title)||"Point de cours",objective:"",
        point:{title:String(content.title||"Point de cours"),text,color:String(content.color||themeColor||""),rank:Number(content.rank)||i+1},
        content:[text],exercises:[],graphs:[]});
    }else if(type==="exercise"){
      const statement=extractStructuredText(content.statement||"");
      if(!clean(statement))throw new Error("L’énoncé d’exercice est vide.");
      exerciseNumber++;
      const correction=extractStructuredText(content.correction||"");
      const correctionTitle=clean(content.correction_title)||("Corrigé "+String(exerciseNumber));
      const title=clean(content.title)||("Exercice "+String(exerciseNumber));
      sections.push({...common,title,content:[],
        exercises:[{id:blockId,exercise_id:blockId,title,statement,question:statement,hint:extractStructuredText(content.hint||""),correction_title:correctionTitle,correction}],
        corrections:clean(correction)?[{exercise_number:exerciseNumber,exercise_id:blockId,solution:correction,correction_title:correctionTitle}]:[],
        graphs:[]});
    }else if(type==="graphique"){
      const graph=content.json&&typeof content.json==="object"&&!Array.isArray(content.json)?content.json:null;
      if(!graph)throw new Error("Le JSON du graphique est invalide.");
      if(!clean(graph.id)||!clean(graph.instrument||graph.graph_type))throw new Error("Le graphique doit contenir id et instrument/graph_type.");
      const graphPath=String(graph.geogebra_image_path||graph.graph_local_path||"").trim();
      if(!graphPath&&!clean(graph.geogebra_image_url||graph.image_url||graph.preview_url))throw new Error("L’asset GeoGebra n’est pas disponible.");
      if(graphPath&&(!graphPath.startsWith("aurora-content/"+userId+"/")||graphPath.includes("..")))throw new Error("Chemin GeoGebra non autorisé.");
      sections.push({...common,title:clean(graph.title)||("Graphique "+String(i+1)),content:[],exercises:[],graphs:[graph]});
    }else if(type==="wikimedia-image"){
      if(!validWikimedia(content))throw new Error("Image Wikimedia invalide ou licence non compatible.");
      const image={url:safeWikimediaDisplayUrl(content.thumbUrl,content.imageUrl),caption:String(content.caption||""),title:String(content.title||""),author:String(content.author||""),license:String(content.license||""),source_url:String(content.sourceUrl||"")};
      sections.push({...common,title:clean(content.title)||("Illustration "+String(i+1)),content:[],exercises:[],graphs:[],images:[image]});
    }else if(type==="vector-scene"){
      const json=content.json&&typeof content.json==="object"&&!Array.isArray(content.json)?content.json:{};
      const scene=json.scene&&typeof json.scene==="object"&&!Array.isArray(json.scene)?json.scene:null;
      if(!scene||!Array.isArray(scene.elements)||!scene.elements.length)throw new Error("Le schéma vectoriel ne contient aucune scène exploitable.");
      sections.push({...common,title:clean(json.title)||("Schéma vectoriel "+String(i+1)),content:[],exercises:[],graphs:[],vector_scenes:[{title:String(json.title||"Schéma vectoriel"),caption:String(json.caption||""),scene}]});
    }else{
      throw new Error("Type de bloc non pris en charge dans le flux : "+type);
    }
  }
  return {title,theme_color:themeColor,document_type:"page_assistee",source_format:"structured",sections,images:[],
    assisted_block:{id:String(sourceBlocks[0]?.id||""),type:clean(sourceBlocks[0]?.type||""),
      content:sourceBlocks[0]?.content&&typeof sourceBlocks[0]?.content==="object"?sourceBlocks[0].content:{},
      mixed_flow:true,flow_block_ids:sourceBlocks.map((b:any)=>String(b?.id||"")).filter(Boolean)}};
}


function buildCanonicalPreviewContent(course:any,themeColor:string|null){
  const title=String(course?.title||"Cours").trim()||"Cours";
  const rawBlocks=Array.isArray(course?.blocks)?course.blocks:[];
  const blocks=rawBlocks.filter((b:any)=>String(b?.role||"").toLowerCase()!=="document-start"&&String(b?.role||"").toLowerCase()!=="document-end");
  const sections:any[]=[];
  const corrections:any[]=[];
  const images:any[]=[];
  const validBlocks=blocks.filter((b:any)=>b&&typeof b==="object"&&String(b.type||"").trim());
  let exerciseNumber=0;

  for(let i=0;i<validBlocks.length;i++){
    const b=validBlocks[i],type=clean(b.type).toLowerCase(),content=blockContentOf(b);
    if(type==="paragraph"){
      const text=blockTextOf(content);
      if(!clean(text))continue;
      sections.push({title:"Bloc "+String(i+1),content:[text],exercises:[],graphs:[]});
    }else if(type==="point"){
      const text=blockTextOf(content);
      if(!clean(text))continue;
      sections.push({
        title:clean(content.title)||"Point de cours",
        objective:"",
        content:[text],
        exercises:[],
        graphs:[]
      });
    }else if(type==="exercise"){
      const statement=extractStructuredText(content.statement||"");
      if(!clean(statement))continue;
      exerciseNumber+=1;
      const id=clean(b.id)||"exercise-"+String(exerciseNumber);
      const correction=extractStructuredText(content.correction||"");
      const correctionTitle=clean(content.correction_title)||("Corrigé "+String(exerciseNumber));
      const correctionBlock=clean(correction)?{
        exercise_number:exerciseNumber,
        exercise_id:id,
        solution:correction,
        correction_title:correctionTitle
      }:null;
      sections.push({
        title:clean(content.title)||("Exercice "+String(exerciseNumber)),
        content:[],
        exercises:[{
          id,
          question:statement,
          statement,
          hint:extractStructuredText(content.hint||""),
          correction_title:correctionTitle,
          correction
        }],
        corrections:correctionBlock?[correctionBlock]:[],
        graphs:[]
      });
      if(correctionBlock)corrections.push(correctionBlock);
    }else if(type==="graphique"){
      const graph=content.json&&typeof content.json==="object"&&!Array.isArray(content.json)?content.json:null;
      if(!graph)continue;
      sections.push({
        title:clean(graph.title)||("Graphique "+String(i+1)),
        content:[],
        exercises:[],
        graphs:[graph]
      });
    }else if(type==="wikimedia-image"){
      const imageUrl=String(content.imageUrl||"").trim();
      if(!imageUrl.startsWith("https://upload.wikimedia.org/"))continue;
      const image={
        url:safeWikimediaDisplayUrl(content.thumbUrl,imageUrl),
        caption:String(content.caption||""),
        title:String(content.title||""),
        author:String(content.author||""),
        license:String(content.license||""),
        source_url:String(content.sourceUrl||"")
      };
      sections.push({
        title:clean(content.title)||("Illustration "+String(i+1)),
        content:[],
        exercises:[],
        graphs:[],
        images:[image]
      });
      // Maintenu à la racine pour les consommateurs historiques sans sections.
      images.push(image);
    }
  }

  return {
    title,
    theme_color:themeColor,
    document_type:"cours",
    source_format:"structured",
    sections,
    corrections,
    images,
    metadata:{
      origin:"edition_assistee",
      assisted_document_preview:true,
      preview_contract:"canonical-production-first-toc-last"
    }
  };
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:C});
  if(req.method!=="POST")return out({ok:false,error:"Méthode non autorisée"},405);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer "))return out({ok:false,error:"Authentification requise"},401);
  const token=auth.slice(7).trim();
  const me=await admin.auth.getUser(token);
  if(me.error||!me.data.user)return out({ok:false,error:"Session invalide"},401);
  const userId=me.data.user.id; const activeProfile=await admin.from("Profils").select("banni").eq("id",userId).maybeSingle(); if(activeProfile.error||!activeProfile.data||activeProfile.data.banni===true)return out({ok:false,error:"Compte suspendu ou profil non autorisé"},403);

  let body:any;
  try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400);}
  const courseId=clean(body?.course_id);
  const previewMode=String(body?.mode||"").trim()==="canonical-document-preview";
  if(previewMode)return out({ok:false,error:"Le rendu canonique complet n’est pas activé sur cette Preview."},403);
  const statusMode=String(body?.mode||"").trim()==="canonical-document-preview-status";
  const singleBlockMode=body?.single_block===true;
  const includeAdjacentBlocks=body?.include_adjacent_blocks===true;

  if(!courseId){
    return out({ok:false,error:"course_id est requis"},400);
  }

  const course=await admin.from("aurora_assisted_courses").select("id,created_by,title,pages").eq("id",courseId).eq("created_by",userId).maybeSingle();
  if(course.error)return out({ok:false,error:course.error.message},500);
  if(!course.data)return out({ok:false,error:"Cours d’édition introuvable ou accès refusé"},404);

  if(statusMode){
    const previewId=Number(body?.generated_document_id||0);
    if(!Number.isSafeInteger(previewId)||previewId<1)return out({ok:false,error:"generated_document_id invalide"},400);
    const row=await admin.from("aurora_generated_documents").select("id,title,status,pdf_path,pdf_url,metadata,version,updated_at").eq("id",previewId).eq("created_by",userId).maybeSingle();
    if(row.error)return out({ok:false,error:row.error.message},500);
    if(!row.data)return out({ok:false,error:"Aperçu canonique introuvable ou accès refusé"},404);
    const md=row.data.metadata&&typeof row.data.metadata==="object"?row.data.metadata:{};
    return out({
      ok:true,
      generated_document_id:row.data.id,
      title:row.data.title,
      status:row.data.status,
      pdf_path:row.data.pdf_path||null,
      pdf_url:row.data.pdf_url||null,
      lualatex_status:md.lualatex_status||null,
      lualatex_progress:Number(md.lualatex_progress||0),
      lualatex_stage:md.lualatex_stage||null,
      production_status:md.production_status||null,
      error:md.lualatex_last_error||null,
      updated_at:row.data.updated_at||null
    });
  }

  if(previewMode){
    const pages=course.data.pages&&typeof course.data.pages==="object"?course.data.pages:{};
    const persistedCourse=pages.course&&typeof pages.course==="object"?pages.course:{title:course.data.title||"Cours",blocks:[]};
    const snapshot=body?.course_snapshot&&typeof body.course_snapshot==="object"?body.course_snapshot:null;
    const sourceCourse=snapshot||persistedCourse;
    const themeColor=normalizeHexColor(body?.theme_color)||normalizeHexColor(sourceCourse?.theme_color);
    const contentJson=buildCanonicalPreviewContent(sourceCourse,themeColor);
    const now=new Date().toISOString();

    const insertedJob=await admin.from("aurora_content_jobs").insert({
      created_by:userId,status:"queued",title:sourceCourse.title||course.data.title||"Cours",
      subject:sourceCourse.subject||null,level:sourceCourse.level||null,class_name:sourceCourse.class_name||null,
      document_type:"cours",source_format:"structured",
      prompt:"Aperçu canonique de l’édition assistée — couverture, sommaire, contenu et page de clôture.",
      instructions:{canonical_preview:true,manual_pdf_launch_required:true},
      source_document_ids:[],metadata:{origin:"edition_assistee",assisted_document_preview:true},
      created_at:now,updated_at:now
    }).select("id").single();
    if(insertedJob.error)return out({ok:false,error:"Création du job d’aperçu impossible : "+insertedJob.error.message},500);

    const jobId=Number(insertedJob.data.id);
    const insertedDoc=await admin.from("aurora_generated_documents").insert({
      job_id:jobId,created_by:userId,title:sourceCourse.title||course.data.title||"Cours",
      subject:sourceCourse.subject||null,level:sourceCourse.level||null,class_name:sourceCourse.class_name||null,
      document_type:"apercu_assiste",source_format:"structured",source_content:null,
      content_json:contentJson,version:1,status:"review",
      validation_notes:"Aperçu canonique de l’éditeur assisté — jamais publiable tel quel.",
      metadata:{
        origin:"edition_assistee",
        assisted_document_preview:true,
        pipeline:"Édition assistée -> renderer canonique LuaLaTeX",
        preview_only:true,
        publishable:false,
        preview_contract:"canonical-production-first-toc-last"
      },
      theme_color:themeColor,matiere:sourceCourse.subject||null
    }).select("id,status,metadata").single();
    if(insertedDoc.error)return out({ok:false,error:"Création du document d’aperçu impossible : "+insertedDoc.error.message},500);

    const generatedDocumentId=Number(insertedDoc.data.id);
    const request=await fetch(URL_+"/functions/v1/aurora-pdf-production-request",{
      method:"POST",
      headers:{"Authorization":auth,"Content-Type":"application/json","apikey":ANON},
      body:JSON.stringify({generated_document_id:generatedDocumentId})
    });
    let q:any={};
    try{q=await request.json()}catch{q={error:"Réponse de la file LuaLaTeX invalide"}}
    if(!request.ok||!q.ok){
      return out({
        ok:false,
        error:q?.error||("Demande de production HTTP "+request.status),
        generated_document_id:generatedDocumentId,
        queued:false
      },500);
    }
    return out({
      ok:true,
      mode:"canonical-document-preview",
      generated_document_id:generatedDocumentId,
      queued:Boolean(q.queued),
      queue_position:q.queue_position??null,
      queue_total:q.queue_total??null,
      wake:q.wake||null
    });
  }

  const blockId=clean(body?.block_id);
  const pageNumber=Number(body?.page_number||0);
  const block=body?.block&&typeof body.block==="object"?body.block:null;
  if(!blockId||!Number.isInteger(pageNumber)||pageNumber<1||!block){
    return out({ok:false,error:"course_id, block_id, page_number et block sont requis"},400);
  }

  const type=clean(block.type||"paragraph").toLowerCase();
  const content=blockContentOf(block);

  // Les graphes, exercices et images sont toujours des blocs autonomes :
  // on ignore les éventuels flow_blocks résiduels envoyés par un client ancien.
  // Seuls paragraphes et points entrent dans la reconstruction d'un flux.
  const isStandaloneBlockType = !["paragraph","point","exercise","graphique","wikimedia-image","vector-scene"].includes(type);
  let flowBlocks:any[];
  if(isStandaloneBlockType){
    flowBlocks=[block];
  }else if(singleBlockMode){
    // Mode explicite « bloc unique » : ne jamais reconstruire le flux contigu
    // depuis aurora_assisted_courses. Le bloc envoyé par l’éditeur est la seule
    // unité rendue, même s’il appartient à un flux historique.
    flowBlocks=[block];
  }else if(includeAdjacentBlocks&&Array.isArray(block.flow_blocks)&&block.flow_blocks.length){
    flowBlocks=block.flow_blocks.filter((b:any)=>b&&typeof b==="object");
  }else if(includeAdjacentBlocks&&["paragraph","point","exercise","graphique","wikimedia-image"].includes(type)&&block?.default_introduction!==true){
    const pages=course.data.pages&&typeof course.data.pages==="object"?course.data.pages:{};
    const persistedCourse=pages.course&&typeof pages.course==="object"?pages.course:{blocks:[]};
    const allBlocks=Array.isArray(persistedCourse.blocks)?persistedCourse.blocks:[];
    const flowable=(b:any)=>b&&typeof b==="object"
      &&["paragraph","point","exercise","graphique","wikimedia-image","vector-scene"].includes(String(b?.type||"").toLowerCase())
      &&String(b?.role||"").toLowerCase()!=="document-start"
      &&String(b?.role||"").toLowerCase()!=="document-end"
      &&b?.default_introduction!==true;
    const idx=allBlocks.findIndex((b:any)=>String(b?.id||"")===blockId);
    if(idx>=0&&flowable(allBlocks[idx])){
      let start=idx,end=idx;
      while(start>0&&flowable(allBlocks[start-1]))start--;
      while(end<allBlocks.length-1&&flowable(allBlocks[end+1]))end++;
      flowBlocks=allBlocks.slice(start,end+1);
      if(!flowBlocks.some((b:any)=>String(b?.id||"")===blockId))flowBlocks=[block];
    }else{
      flowBlocks=[block];
    }
  }else{
    flowBlocks=[block];
  }
  // Un bloc vide est un séparateur de flux, pas une raison de faire échouer
  // la génération d'un paragraphe/point voisin qui possède du contenu.
  // On conserve uniquement le segment non vide contenant le bloc demandé.
  // Si le bloc demandé lui-même est vide, la validation ci-dessous le signalera.
  const flowBlockHasText=(candidate:any)=>{
    const candidateType=clean(candidate?.type||"").toLowerCase();
    const candidateContent=blockContentOf(candidate);
    if(["paragraph","point"].includes(candidateType))return Boolean(clean(blockTextOf(candidateContent)));
    if(candidateType==="exercise")return Boolean(clean(extractStructuredText(candidateContent.statement)));
    if(candidateType==="graphique"){
      const g=candidateContent.json&&typeof candidateContent.json==="object"&&!Array.isArray(candidateContent.json)?candidateContent.json:{};
      return Boolean(clean(g.geogebra_image_path||g.graph_local_path||g.geogebra_image_url||g.image_url||g.preview_url));
    }
    if(candidateType==="wikimedia-image")return validWikimedia(candidateContent);
    if(candidateType==="vector-scene"){
      const json=candidateContent.json&&typeof candidateContent.json==="object"&&!Array.isArray(candidateContent.json)?candidateContent.json:{};
      const scene=json.scene&&typeof json.scene==="object"&&!Array.isArray(json.scene)?json.scene:{};
      return Array.isArray(scene.elements)&&scene.elements.length>0;
    }
    return false;
  };
  const requestedFlowIndex=flowBlocks.findIndex((candidate:any)=>String(candidate?.id||"")===blockId);
  if(requestedFlowIndex>=0){
    let segmentStart=requestedFlowIndex;
    let segmentEnd=requestedFlowIndex;
    while(segmentStart>0&&flowBlockHasText(flowBlocks[segmentStart-1]))segmentStart--;
    while(segmentEnd<flowBlocks.length-1&&flowBlockHasText(flowBlocks[segmentEnd+1]))segmentEnd++;
    flowBlocks=flowBlocks.slice(segmentStart,segmentEnd+1);
  }
  if(!flowBlocks.length)return out({ok:false,error:"Le flux de blocs est vide."},400);
  // Les pages d'exercice, de graphique et d'image sont des unités autonomes.
  // Seul un vrai flux contenant plusieurs blocs doit être limité aux points/paragraphes.
  const supportedFlowTypes=["paragraph","point","exercise","graphique","wikimedia-image","vector-scene"];
  if(flowBlocks.some((b:any)=>!supportedFlowTypes.includes(clean(b?.type||"").toLowerCase())))return out({ok:false,error:"Type de bloc non pris en charge dans le flux assisté."},400);
  for(const fb of flowBlocks){
    const ft=clean(fb?.type||"").toLowerCase();
    const fc=blockContentOf(fb);
    if(ft==="paragraph"&&!clean(blockTextOf(fc)))return out({ok:false,error:"Un paragraphe du flux est vide."},400);
    if(ft==="point"&&!clean(blockTextOf(fc)))return out({ok:false,error:"Le contenu d’un point du flux est vide."},400);
    if(ft==="exercise"&&!clean(extractStructuredText(fc.statement)))return out({ok:false,error:"L’énoncé d’un exercice du flux est vide."},400);
    if(ft==="graphique"){
      const g=fc.json&&typeof fc.json==="object"&&!Array.isArray(fc.json)?fc.json:null;
      if(!g||!clean(g.id)||!clean(g.instrument||g.graph_type))return out({ok:false,error:"Un graphique du flux doit contenir id et instrument/graph_type."},400);
      const graphPath=String(g.geogebra_image_path||g.graph_local_path||"").trim();
      if(!graphPath&&!clean(g.geogebra_image_url||g.image_url||g.preview_url))return out({ok:false,error:"Asset graphique non disponible."},409);
      if(graphPath&&(!graphPath.startsWith("aurora-content/"+userId+"/")||graphPath.includes("..")))return out({ok:false,error:"Chemin GeoGebra non autorisé."},403);
    }
    if(ft==="wikimedia-image"&&!validWikimedia(fc))return out({ok:false,error:"Image Wikimedia du flux invalide ou licence non compatible."},400);
    if(ft==="vector-scene"){
      const json=fc.json&&typeof fc.json==="object"&&!Array.isArray(fc.json)?fc.json:{};
      if(!json.scene||typeof json.scene!=="object"||!Array.isArray(json.scene.elements)||!json.scene.elements.length){
        return out({ok:false,error:"Le schéma vectoriel doit contenir json.scene.elements."},400);
      }
    }
  }
  if(type==="exercise"&&!clean(extractStructuredText(content.statement)))return out({ok:false,error:"L’énoncé est vide."},400);
  if(type==="graphique"){
    const g=content.json;
    if(!g||typeof g!=="object"||Array.isArray(g))return out({ok:false,error:"Le JSON du graphique doit être un objet."},400);
    if(!clean(g.id)||!clean(g.instrument||g.graph_type))return out({ok:false,error:"Le graphique doit avoir un id unique et instrument/graph_type."},400);
    const graphPath=String(g.geogebra_image_path||g.graph_local_path||"").trim(); const graphUrl=String(g.geogebra_image_url||g.image_url||g.preview_url||"").trim(); if(!graphPath&&!graphUrl)return out({ok:false,error:"Graphique validé, mais l’asset GeoGebra n’est pas encore disponible. Le JSON reste conservé."},409); if(graphPath&&(!graphPath.startsWith(`aurora-content/${userId}/`)||graphPath.includes("..")))return out({ok:false,error:"Chemin GeoGebra non autorisé"},403);
  }
  if(type==="wikimedia-image"&&!validWikimedia(content))return out({ok:false,error:"Image Wikimedia invalide ou licence non compatible."},400);

  const now=new Date().toISOString();
  const insertedJob=await admin.from("aurora_content_jobs").insert({
    created_by:userId,status:"queued",title:course.data.title||"Cours",subject:null,level:null,class_name:null,
    document_type:"page_assistee",source_format:"structured",prompt:"Édition assistée — rendu d’une page indépendante.",
    instructions:{assisted_page:true,classification:{category:"Édition assistée",resource_type:"cours"}},
    source_document_ids:[],metadata:{origin:"edition_assistee",assisted_page:{course_id:courseId,block_id:blockId,page_number:pageNumber,block_type:type}},
    created_at:now,updated_at:now
  }).select("id").single();
  if(insertedJob.error)return out({ok:false,error:"Création du job de rendu impossible : "+insertedJob.error.message},500);

  const jobId=Number(insertedJob.data.id);
  let contentJson:any;
  const themeColor=normalizeHexColor(body?.theme_color);
  try{
    contentJson=flowBlocks.length>1
      ?buildFlowContent(String(course.data.title||body.course_title||"Cours"),pageNumber,flowBlocks,themeColor,userId)
      :buildContent(String(course.data.title||body.course_title||"Cours"),pageNumber,flowBlocks[0],themeColor);
  }catch(e){return out({ok:false,error:e instanceof Error?e.message:String(e)},400);}

  const metadata={
    origin:"edition_assistee",
    pipeline:"Édition assistée -> fast page renderer",
    assisted_page:{
      course_id:courseId,
      block_id:blockId,
      page_number:pageNumber,
      block_type:type,
      flow_block_ids:flowBlocks.map((b:any)=>String(b?.id||"")).filter(Boolean),
      theme_color:themeColor
    }
  };
  const insertedDoc=await admin.from("aurora_generated_documents").insert({
    job_id:jobId,created_by:userId,title:(course.data.title||"Cours")+" — Page "+String(pageNumber)+(Array.isArray(block.flow_blocks)&&block.flow_blocks.length>1?" · flux":"") ,
    subject:null,level:null,class_name:null,document_type:"page_assistee",source_format:"structured",source_content:null,
    content_json:contentJson,version:1,status:"generated",validation_notes:flowBlocks.length>1
      ?"Édition assistée — flux de blocs consécutifs (reconstruit côté serveur si nécessaire)."
      :"Édition assistée — page indépendante.",
    metadata,theme_color:null,matiere:null
  }).select("id,status,metadata").single();
  if(insertedDoc.error)return out({ok:false,error:"Création du document de rendu impossible : "+insertedDoc.error.message},500);

  const generatedDocumentId=Number(insertedDoc.data.id);

  // Keep the assisted editor on the dedicated instant page renderer.
  // It is deliberately separate from the full-document LuaLaTeX production queue:
  // one assisted page must stay fast, adaptive and independently verifiable.
  let rendered:Response;
  try{
    rendered=await fetch(URL_+"/functions/v1/aurora-assisted-page-fast-v3",{
      method:"POST",
      headers:{
        "Authorization":auth,
        "Content-Type":"application/json",
        "apikey":ANON
      },
      body:JSON.stringify({
        generated_document_id:generatedDocumentId,
        page_number:pageNumber,
        content:contentJson
      })
    });
  }catch(error:any){
    const detail=clean(error?.message||error).slice(0,800);
    const renderError=/(?:CPU_TIME_LIMIT_EXCEEDED|CPU\s+Time\s+exceeded|CPU\s+time\s+limit|HTTP\s*546)/i.test(detail)
      ?"Limite CPU du renderer assisté atteinte (CPU_TIME_LIMIT_EXCEEDED). "+detail
      :"Appel au renderer assisté interrompu : "+(detail||"erreur réseau non précisée");
    await admin.from("aurora_generated_documents").update({
      metadata:{...metadata,fast_page_status:"failed",fast_page_last_error:renderError},
      updated_at:new Date().toISOString()
    }).eq("id",generatedDocumentId);
    return out({
      ok:false,
      error:renderError,
      generated_document_id:generatedDocumentId,
      page_number:pageNumber
    },502);
  }
  const rawRendererResponse=await rendered.text();
  let q:any={};
  try{q=rawRendererResponse?JSON.parse(rawRendererResponse):{}}catch{q={error:rawRendererResponse||"Réponse du renderer assisté invalide"}}
  const edgeErrorCode=clean(rendered.headers.get("sb-error-code")||rendered.headers.get("x-sb-error-code")||"");
  const childError=clean(q?.error||q?.message||q?.details||rawRendererResponse||"").slice(0,900);
  const cpuLimitExceeded=rendered.status===546||/(?:CPU_TIME_LIMIT_EXCEEDED|CPU\s+Time\s+exceeded|CPU\s+time\s+limit)/i.test(edgeErrorCode+" "+childError);
  const sceneQaFailed=type==="vector-scene"&&Number(q?.qa?.scenes_failed||0)>0;
  if(!rendered.ok||!q.ok||sceneQaFailed){
    const renderError=sceneQaFailed
      ?String((Array.isArray(q?.qa?.scene_errors)?q.qa.scene_errors:[]).join(" · ")||"Le renderer a créé un PDF mais n’a pas validé le schéma vectoriel.")
      :cpuLimitExceeded
        ?"Limite CPU du renderer assisté atteinte (CPU_TIME_LIMIT_EXCEEDED; HTTP "+rendered.status+"). Le rendu va être repris bloc par bloc."
        :(childError||("Renderer assisté HTTP "+rendered.status));
    await admin.from("aurora_generated_documents").update({
      metadata:{...metadata,fast_page_status:"failed",fast_page_last_error:renderError},
      updated_at:new Date().toISOString()
    }).eq("id",generatedDocumentId);
    return out({
      ok:false,
      error:renderError||("Renderer assisté HTTP "+rendered.status),
      generated_document_id:generatedDocumentId,
      page_number:pageNumber
    },500);
  }

  return out({
    ...q,
    generated_document_id:generatedDocumentId,
    job_id:jobId,
    page_number:pageNumber,
    flow_block_ids:Array.isArray(contentJson?.assisted_block?.flow_block_ids)&&contentJson.assisted_block.flow_block_ids.length
      ?contentJson.assisted_block.flow_block_ids
      :[blockId],
    mode:"instant-page",
    engine:"pdf-lib-course-page-v2"
  });
});
