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

function buildContent(courseTitle:string,pageNumber:number,block:any,themeColor:string|null,flowBlocks:any[]=[]){
  const sourceBlocks=Array.isArray(flowBlocks)&&flowBlocks.length?flowBlocks:[block];
  const sections:any[]=[];
  const images:any[]=[];
  const validBlocks=sourceBlocks.filter((b:any)=>b&&typeof b==="object");
  for(const current of validBlocks){
    const type=clean(current?.type||"paragraph").toLowerCase();
    const content=current?.content&&typeof current.content==="object"?current.content:{};
    const section:any={
      title:"Bloc "+String(pageNumber),
      content:[],
      exercises:[],
      graphs:[],
      block_id:String(current?.id||"")
    };
    if(type==="paragraph"){
      section.content=[extractStructuredText(content.text||"")];
    }else if(type==="point"){
      section.point={
        title:String(content.title||"Point de cours"),
        text:extractStructuredText(content.text||""),
        color:String(content.color||""),
        rank:Number(content.rank)||1
      };
    }else if(type==="exercise"){
      section.exercises=[{
        id:String(current?.id||""),
        title:String(content.title||"Exercice"),
        statement:extractStructuredText(content.statement||""),
        hint:extractStructuredText(content.hint||""),
        correction_title:String(content.correction_title||"Corrigé"),
        correction:extractStructuredText(content.correction||"")
      }];
    }else if(type==="graphique"){
      section.graphs=[content.json&&typeof content.json==="object"?content.json:{}];
    }else if(type==="wikimedia-image"){
      section.content=["Illustration Wikimedia"];
      const imageUrl=String(content.imageUrl||"");
      if(imageUrl.startsWith("https://upload.wikimedia.org/")){
        images.push({
          url:imageUrl,
          caption:String(content.caption||""),
          title:String(content.title||""),
          author:String(content.author||""),
          license:String(content.license||""),
          source_url:String(content.sourceUrl||""),
          block_id:String(current?.id||"")
        });
      }
    }else{
      throw new Error("Type de bloc non pris en charge : "+type);
    }
    sections.push(section);
  }
  return {
    title:courseTitle,
    theme_color:themeColor,
    document_type:"page_assistee",
    source_format:"structured",
    sections,
    images,
    assisted_block:{
      id:String(block?.id||""),
      type:clean(block?.type||"paragraph").toLowerCase(),
      content:block?.content&&typeof block.content==="object"?block.content:{}
    },
    flow_blocks:validBlocks.map((b:any)=>({id:String(b?.id||""),type:clean(b?.type||"paragraph").toLowerCase()}))
  };
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
    const b=validBlocks[i],type=clean(b.type).toLowerCase(),content=b.content&&typeof b.content==="object"?b.content:{};
    if(type==="paragraph"){
      const text=extractStructuredText(content.text||"");
      if(!clean(text))continue;
      sections.push({title:"Bloc "+String(i+1),content:[text],exercises:[],graphs:[]});
    }else if(type==="point"){
      const text=extractStructuredText(content.text||"");
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
      sections.push({
        title:clean(content.title)||("Exercice "+String(exerciseNumber)),
        content:[],
        exercises:[{
          id,
          question:statement,
          statement,
          hint:extractStructuredText(content.hint||"")
        }],
        graphs:[]
      });
      const correction=extractStructuredText(content.correction||"");
      if(clean(correction)){
        corrections.push({
          exercise_number:exerciseNumber,
          exercise_id:id,
          solution:correction,
          correction_title:clean(content.correction_title)||("Corrigé "+String(exerciseNumber))
        });
      }
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
      if(!imageUrl)continue;
      sections.push({
        title:clean(content.title)||("Illustration "+String(i+1)),
        content:["Illustration documentaire."],
        exercises:[],
        graphs:[]
      });
      if(imageUrl.startsWith("https://upload.wikimedia.org/")){
        images.push({
          url:imageUrl,
          caption:String(content.caption||""),
          title:String(content.title||""),
          author:String(content.author||""),
          license:String(content.license||""),
          source_url:String(content.sourceUrl||"")
        });
      }
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
  const userId=me.data.user.id;

  let body:any;
  try{body=await req.json()}catch{return out({ok:false,error:"JSON invalide"},400);}
  const courseId=clean(body?.course_id);
  const previewMode=String(body?.mode||"").trim()==="canonical-document-preview";
  const statusMode=String(body?.mode||"").trim()==="canonical-document-preview-status";

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
  const content=block.content&&typeof block.content==="object"?block.content:{};
  if(type==="paragraph"&&!clean(extractStructuredText(content.text)))return out({ok:false,error:"Le paragraphe est vide."},400);
  if(type==="point"&&!clean(extractStructuredText(content.text)))return out({ok:false,error:"Le contenu du point est vide."},400);
  if(type==="exercise"&&!clean(extractStructuredText(content.statement)))return out({ok:false,error:"L’énoncé est vide."},400);
  if(type==="graphique"){
    const g=content.json;
    if(!g||typeof g!=="object"||Array.isArray(g))return out({ok:false,error:"Le JSON du graphique doit être un objet."},400);
    if(!clean(g.id)||!clean(g.instrument||g.graph_type))return out({ok:false,error:"Le graphique doit avoir un id unique et instrument/graph_type."},400);
    if(!clean(g.geogebra_image_path||g.graph_local_path))return out({ok:false,error:"Graphique validé, mais l’asset GeoGebra n’est pas encore disponible. Le JSON reste conservé."},409);
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
  try{contentJson=buildContent(String(course.data.title||body.course_title||"Cours"),pageNumber,block,themeColor,Array.isArray(body?.flow_blocks)?body.flow_blocks:[]);}
  catch(e){return out({ok:false,error:e instanceof Error?e.message:String(e)},400);}

  const metadata={
    origin:"edition_assistee",
    pipeline:"Édition assistée -> fast page renderer",
    assisted_page:{course_id:courseId,block_id:blockId,page_number:pageNumber,block_type:type,theme_color:themeColor}
  };
  const insertedDoc=await admin.from("aurora_generated_documents").insert({
    job_id:jobId,created_by:userId,title:(course.data.title||"Cours")+" — Page "+String(pageNumber),
    subject:null,level:null,class_name:null,document_type:"page_assistee",source_format:"structured",source_content:null,
    content_json:contentJson,version:1,status:"generated",validation_notes:"Édition assistée — page indépendante.",
    metadata,theme_color:null,matiere:null
  }).select("id,status,metadata").single();
  if(insertedDoc.error)return out({ok:false,error:"Création du document de rendu impossible : "+insertedDoc.error.message},500);

  const generatedDocumentId=Number(insertedDoc.data.id);

  // Keep the assisted editor on the dedicated instant page renderer.
  // It is deliberately separate from the full-document LuaLaTeX production queue:
  // one assisted page must stay fast, adaptive and independently verifiable.
  const rendered=await fetch(URL_+"/functions/v1/aurora-assisted-page-fast",{
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
  let q:any={};
  try{q=await rendered.json()}catch{q={error:"Réponse du renderer assisté invalide"}}
  if(!rendered.ok||!q.ok){
    await admin.from("aurora_generated_documents").update({
      metadata:{...metadata,fast_page_status:"failed",fast_page_last_error:String(q?.error||"Renderer assisté impossible")},
      updated_at:new Date().toISOString()
    }).eq("id",generatedDocumentId);
    return out({
      ok:false,
      error:q?.error||("Renderer assisté HTTP "+rendered.status),
      generated_document_id:generatedDocumentId,
      page_number:pageNumber
    },500);
  }

  return out({
    ...q,
    generated_document_id:generatedDocumentId,
    job_id:jobId,
    page_number:pageNumber,
    mode:"instant-page",
    engine:"pdf-lib-course-page-v2"
  });
});
