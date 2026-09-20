import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, PDFImage, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const MATH_URL = `${SUPA_URL}/functions/v1/aurora-content-math-renderer`;
const LOGO = "https://raw.githubusercontent.com/ouali-nat/Aurore-Archives/main/icon-192-1.png";
const FONT_REGULAR = "https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
const FONT_BOLD = "https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf";
const admin = createClient(SUPA_URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });

const C = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { ...C, "Content-Type": "application/json" } });

// --- Unicode -> LaTeX fallback normalisation (used ONLY inside isolated math segments) ---
const U: Record<string, string> = { "∞": "\\infty", "≈": "\\approx", "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "∈": "\\in", "∉": "\\notin", "√": "\\sqrt{}", "×": "\\times", "÷": "\\div", "±": "\\pm", "π": "\\pi", "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "θ": "\\theta", "λ": "\\lambda", "μ": "\\mu", "σ": "\\sigma", "φ": "\\phi", "ω": "\\omega", "ℝ": "\\mathbb{R}", "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}", "→": "\\to", "⇒": "\\Rightarrow", "⇔": "\\Leftrightarrow", "∑": "\\sum", "∫": "\\int", "∂": "\\partial" };
const SUPER: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "ⁿ": "n", "ⁱ": "i", "ˣ": "x", "ʸ": "y", "⁺": "+", "⁻": "-" };
const SUB: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "ₙ": "n", "ₓ": "x", "ₐ": "a", "ᵢ": "i" };

// IMPORTANT : cette fonction ne doit JAMAIS appliquer de transformations "plain-text
// vers LaTeX" (exp(...)->e^{...}, ln(->\ln(, sqrt(...)->\sqrt{...}, ^X->^{X}, etc.).
// Ces heuristiques dataient d'avant l'introduction des délimiteurs $...$, quand le
// contenu pouvait contenir des maths en texte brut. Aujourd'hui chaque segment passé
// ici est déjà du LaTeX correctement échappé par backslash (\exp(x), \ln(x), \sqrt{x},
// e^{x}...). Le \b (limite de mot) de ces regex matche juste après un backslash (qui
// est un caractère non-mot), donc "\exp(" était corrompu en "\e^{" et "\ln(" doublé en
// "\\ln(" — cassant le rendu MathJax silencieusement (formule -> "[formule]" ou
// glyphes incohérents). On ne garde que la substitution de symboles Unicode isolés,
// qui ne peut pas entrer en collision avec une commande LaTeX valide.
function toTex(s: string) {
  let t = String(s || "").normalize("NFC");
  for (const [a, b] of Object.entries(SUPER)) t = t.split(a).join(`^{${b}}`);
  for (const [a, b] of Object.entries(SUB)) t = t.split(a).join(`_{${b}}`);
  for (const [a, b] of Object.entries(U)) t = t.split(a).join(b);
  return t;
}

const clean = (x: any) => String(x ?? "").normalize("NFC").replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim();
const norm = (s: string) => String(s || "").replace(/\s+/g, "").toLowerCase();
const slug = (s: string) => clean(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 90) || "document";

type Seg = { k: "text" | "math"; v: string };
function splitDollar(s: string): Seg[] {
  const a = String(s || "").normalize("NFC");
  const out: Seg[] = [];
  let i = 0, buf = "";
  const push = (k: "text" | "math", v: string) => { if (v) out.push({ k, v }); };
  while (i < a.length) {
    if (a[i] === "$") {
      const dbl = a[i + 1] === "$";
      const end = a.indexOf(dbl ? "$$" : "$", i + (dbl ? 2 : 1));
      if (end >= 0) {
        push("text", buf); buf = "";
        push("math", a.slice(i + (dbl ? 2 : 1), end));
        i = end + (dbl ? 2 : 1);
        continue;
      }
    }
    buf += a[i++];
  }
  push("text", buf);
  return out;
}

type Block =
  | { type: "text"; value: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "image"; ref: string };

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  const T = (s: string) => String(s ?? "").trim();
  while (i < lines.length) {
    const raw = lines[i];
    const t = T(raw);

    if (t === "\\begin{itemize}" || t === "\\begin{enumerate}") {
      const ordered = t === "\\begin{enumerate}";
      const items: string[] = [];
      i++;
      while (i < lines.length && T(lines[i]) !== "\\end{itemize}" && T(lines[i]) !== "\\end{enumerate}") {
        const it = T(lines[i]);
        if (it.startsWith("\\item")) items.push(it.slice(5).trim());
        else if (it) items.push(it);
        i++;
      }
      i++;
      if (items.length) out.push({ type: "list", ordered, items });
      continue;
    }

    if (t === "\\begin{center}") {
      let j = i + 1;
      if (j < lines.length && T(lines[j]).startsWith("\\begin{tabular}")) {
        j++;
        const rows: string[][] = [];
        while (j < lines.length && T(lines[j]) !== "\\end{tabular}") {
          const rt = T(lines[j]);
          if (rt && rt.replace(/\\/g, "") !== "hline") {
            let row = rt;
            while (row.endsWith("\\")) row = row.slice(0, -1).trim();
            rows.push(row.split("&").map((c) => c.trim()));
          }
          j++;
        }
        j++;
        if (j < lines.length && T(lines[j]) === "\\end{center}") j++;
        if (rows.length) out.push({ type: "table", rows });
        i = j;
        continue;
      }
      const gm = j < lines.length ? T(lines[j]).match(/^\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/) : null;
      if (gm) {
        j++;
        if (j < lines.length && T(lines[j]) === "\\end{center}") j++;
        out.push({ type: "image", ref: gm[1] });
        i = j;
        continue;
      }
      i++;
      continue;
    }

    const gm2 = t.match(/^\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/);
    if (gm2) { out.push({ type: "image", ref: gm2[1] }); i++; continue; }

    if (t === "\\end{center}" || t === "\\end{tabular}" || t === "\\hline" || t === "") { i++; continue; }

    out.push({ type: "text", value: raw });
    i++;
  }
  return out;
}

const MAX_UNIQUE_FORMULAS = 500;
const REMOTE = 30000;
const BUDGET = 140000;
let started = 0, unique = 0, hits = 0, skipped = 0, mathTime = 0, graphTime = 0, stageNow = "START";
const mc = new Map<string, Uint8Array>();
const mi = new Map<string, PDFImage>();
const gi = new Map<string, PDFImage>();
let diagnostic: any = null;

function budget(extra = 0) { return !started || BUDGET - (performance.now() - started) >= extra; }
function stage(s: string, d?: string) {
  stageNow = s;
  diagnostic = { version: "v35", stage: s, updated_at: new Date().toISOString(), ...(d ? { details: d } : {}) };
  console.log("[AURORA_PDF_STAGE]", JSON.stringify(diagnostic));
}
async function persist(id: number) {
  try {
    const q = await admin.from("aurora_generated_documents").select("metadata").eq("id", id).maybeSingle();
    await Promise.race([
      admin.from("aurora_generated_documents").update({ metadata: { ...(q.data?.metadata || {}), pdf_diagnostic: diagnostic } }).eq("id", id),
      new Promise((r) => setTimeout(r, 1200)),
    ]);
  } catch { /* best effort */ }
}

let green = rgb(.12, .43, .28), dark = rgb(.055, .25, .16), mid = rgb(.30, .58, .42), pale = rgb(.94, .975, .95),
  wash = rgb(.975, .988, .978), ink = rgb(.07, .10, .08), muted = rgb(.36, .43, .39), white = rgb(1, 1, 1), line = rgb(.72, .82, .76);
function profileStyle(d:any){
  const p=String(d?._factory?.content_profile||d?.content_profile||"general");
  const styles:any={
    scientifique:[[.12,.25,.55],[.06,.12,.30],[.24,.42,.75],[.94,.96,.995],[.975,.985,1],[.08,.12,.20],[.36,.42,.52],[.70,.76,.88]],
    experimental:[[.12,.43,.28],[.055,.25,.16],[.30,.58,.42],[.94,.975,.95],[.975,.988,.978],[.07,.10,.08],[.36,.43,.39],[.72,.82,.76]],
    langues:[[.55,.20,.45],[.30,.08,.25],[.72,.35,.62],[.99,.95,.98],[.995,.98,.99],[.16,.08,.13],[.42,.34,.40],[.88,.72,.84]],
    francais_litterature:[[.50,.22,.30],[.28,.08,.14],[.70,.34,.42],[.99,.96,.95],[.995,.985,.98],[.15,.08,.09],[.43,.34,.35],[.88,.76,.76]],
    histoire_geographie:[[.45,.31,.12],[.27,.17,.05],[.64,.47,.20],[.98,.96,.90],[.99,.98,.94],[.13,.10,.06],[.40,.35,.26],[.82,.74,.56]],
    informatique:[[.08,.36,.42],[.03,.20,.24],[.16,.55,.62],[.92,.98,.98],[.97,.99,.99],[.05,.12,.14],[.32,.42,.44],[.68,.82,.84]],
    technique:[[.28,.32,.36],[.14,.17,.20],[.45,.50,.56],[.95,.96,.97],[.98,.985,.99],[.08,.10,.12],[.38,.42,.46],[.75,.78,.82]]
  };
  const a=styles[p]||styles.experimental;
  [green,dark,mid,pale,wash,ink,muted,line]=a.map((x:number[])=>rgb(...x));
  return p;
}


function visualProfileEnabled(profile:string){
  return ["experimental","langues","francais_litterature","histoire_geographie","informatique","technique"].includes(profile);
}
function metaPlain(v:any){
  if(v==null)return "";
  const s=typeof v==="object"?String(v.value??""):String(v);
  return s.replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
}
function allowedVisualLicense(meta:any){
  const raw=(metaPlain(meta?.LicenseShortName)+" "+metaPlain(meta?.UsageTerms)+" "+metaPlain(meta?.License)).toLowerCase();
  if(raw.includes("fair use")||raw.includes("non-commercial")||raw.includes("noncommercial")||raw.includes("no derivatives"))return false;
  return raw.includes("public domain")||raw.includes("cc0")||raw.includes("creative commons zero")||raw.includes("cc by-sa")||raw.includes("cc by ");
}
function visualQueries(d:any,profile:string){
  const title=String(d?.title||"").trim(), subject=String(d?.subject||"").trim();
  const suffix:any={experimental:"scientific experiment",langues:"language learning",francais_litterature:"literature",histoire_geographie:"map history",informatique:"computer diagram",technique:"technical diagram"};
  const out:string[]=[];
  const add=(q:string)=>{q=q.replace(/\s+/g," ").trim();if(q&&!out.includes(q))out.push(q);};
  for(const s of (Array.isArray(d?.sections)?d.sections:[]).slice(0,3)){
    add([title,subject,String(s?.title||""),suffix[profile]||""].filter(Boolean).join(" "));
    if(out.length>=3)break;
  }
  return out.slice(0,3);
}
async function fetchWikimediaVisuals(d:any,profile:string){
  if(!visualProfileEnabled(profile))return [];
  const queries=visualQueries(d,profile), chosen:any[]=[], seen=new Set<string>();
  for(const query of queries){
    if(chosen.length>=2)break;
    try{
      const api="https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch="+encodeURIComponent(query)+"&prop=imageinfo&iiprop=url|size|mime|thumbmime|extmetadata&iilimit=1&iiurlwidth=1100&iiextmetadataversion=latest";
      const r=await fetch(api,{headers:{"User-Agent":"Aurore-Section-Archives/1.0 (educational PDF generator)"}});
      if(!r.ok)continue;
      const data=await r.json();
      const pages=Object.values(data?.query?.pages||{}) as any[];
      const terms=query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").split(/[^a-z0-9]+/).filter((x:string)=>x.length>3&&!["the","with","from","this","that","diagram","history","scientific","technical","language","learning","experiment"].includes(x));
      const cand=pages.map(p=>{
        const ii=p?.imageinfo?.[0]||{},meta=ii?.extmetadata||{},name=String(p?.title||"").replace(/^File:/i,"");
        const norm=name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
        const score=terms.reduce((n:number,t:string)=>n+(norm.includes(t)?1:0),0);
        return {p,ii,meta,name,score};
      }).filter(x=>{
        const ii=x.ii||{},mime=String(ii.mime||"").toLowerCase(),w=Number(ii.width)||0,h=Number(ii.height)||0,thumb=String(ii.thumburl||"");
        return allowedVisualLicense(x.meta)&&(mime==="image/jpeg"||mime==="image/png")&&w>=500&&h>=300&&thumb.startsWith("https://upload.wikimedia.org/");
      }).sort((a,b)=>b.score-a.score);
      for(const c of cand){
        const url=String(c.ii.thumburl||"");
        if(!url||seen.has(url))continue;
        const ir=await fetch(url,{headers:{"User-Agent":"Aurore-Section-Archives/1.0 (educational PDF generator)"}});
        if(!ir.ok)continue;
        const ct=String(ir.headers.get("content-type")||c.ii.thumbmime||c.ii.mime||"").toLowerCase();
        if(ct!=="image/jpeg"&&ct!=="image/png")continue;
        const b=new Uint8Array(await ir.arrayBuffer());
        if(b.length<10000||b.length>2200000)continue;
        chosen.push({
          section_index:Math.max(0,queries.indexOf(query)),
          title:c.name,
          caption:(metaPlain(c.meta?.ImageDescription)||c.name).slice(0,220),
          author:(metaPlain(c.meta?.Artist)||"Auteur non renseigné").slice(0,180),
          license:(metaPlain(c.meta?.LicenseShortName)||metaPlain(c.meta?.UsageTerms)||"Licence libre Commons").slice(0,120),
          source:"Wikimedia Commons",
          source_url:String(c.ii.descriptionurl||("https://commons.wikimedia.org/wiki/"+encodeURIComponent(c.p?.title||"")).replace(/%3A/g,":")),
          bytes:b,
          width:Number(c.ii.width)||1,
          height:Number(c.ii.height)||1,
          search_query:query
        });
        seen.add(url);
        break;
      }
    }catch(_){}
  }
  return chosen;
}
function rounded(p: any, x: number, y: number, w: number, h: number, r: number, c: any) {
  p.drawSvgPath(`M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`, { x, y: y + h, color: c });
}
function assertImg(i: any, l: string) { if (!(i instanceof PDFImage)) throw Error(`Image ${l} invalide`); return i; }
async function embed(pdf: any, b: Uint8Array, l: string) {
  if (!b || b.length < 8) throw Error(`Image ${l} absente`);
  let i: any;
  if (b[0] === 137 && b[1] === 80) i = await pdf.embedPng(b);
  else if (b[0] === 255 && b[1] === 216) i = await pdf.embedJpg(b);
  else throw Error(`Image ${l}: format non supporté`);
  return assertImg(i, l);
}
async function emb(pdf: any, b: Uint8Array, k: string, l: string, c: Map<string, PDFImage>) {
  const e = c.get(k);
  return e || c.set(k, await embed(pdf, b, l)).get(k)!;
}
let logoBytes: Uint8Array | null = null;
let fontRegularBytes: Uint8Array | null = null;
let fontBoldBytes: Uint8Array | null = null;
async function bytes(u: string, ms = 7000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(u, { signal: c.signal }); if (!r.ok) throw Error(`HTTP ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
  finally { clearTimeout(t); }
}
async function remote(payload: any, auth: string): Promise<any> {
  if (!budget(REMOTE + 500)) throw Error("PDF_RENDER_BUDGET");
  const st = performance.now();
  const r = await fetch(MATH_URL, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(REMOTE) });
  let b: any;
  try { b = await r.json(); } catch { throw Error(`Moteur scientifique: HTTP ${r.status}`); }
  if (!r.ok || !b?.ok) throw Error(b?.error || `Moteur scientifique: HTTP ${r.status}`);
  const xs = Array.isArray(b.results) ? b.results : (b.png_base64 ? [{ png_base64: b.png_base64 }] : []);
  if (!xs.length) throw Error("Moteur scientifique: image absente");
  if (payload.kind === "graph") { const raw=atob(xs[0].png_base64), o=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)o[i]=raw.charCodeAt(i); graphTime += performance.now()-st; return o; }
  mathTime += performance.now()-st;
  return xs.map((z:any)=>{const raw=atob(z.png_base64),o=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)o[i]=raw.charCodeAt(i);return o;});
}
async function formulas(xs: string[], auth: string) {
  const out: { k: string; b: Uint8Array }[] = [];
  const pending: { k:string; v:string }[] = [];
  for (const raw of xs) {
    const k = norm(toTex(raw));
    if (mc.has(k)) { hits++; out.push({ k, b: mc.get(k)! }); continue; }
    if (unique >= MAX_UNIQUE_FORMULAS || !budget(REMOTE + 8000)) { skipped++; continue; }
    if (!pending.some(z=>z.k===k)) pending.push({k,v:toTex(raw)});
  }
  for (let i=0;i<pending.length;i+=12) {
    const batch=pending.slice(i,i+12);
    if (!budget(REMOTE+8000)) { skipped += pending.length-i; break; }
    unique += batch.length;
    try {
      const bs:any[] = await remote({formulas:batch.map(z=>z.v)}, auth);
      for (let j=0;j<batch.length;j++) {
        const b=bs[j];
        if (b) { mc.set(batch[j].k,b); out.push({k:batch[j].k,b}); }
      }
    } catch { /* qa handles the miss */ }
  }
  return out;
}
function collectMathValues(v:any, out:string[] = []) {
  if (typeof v === "string") {
    const segs = splitDollar(v);
    for (const s of segs) if (s.k === "math" && s.v.trim()) out.push(s.v);
    return out;
  }
  if (Array.isArray(v)) { for (const z of v) collectMathValues(z, out); return out; }
  if (v && typeof v === "object") { for (const z of Object.values(v)) collectMathValues(z, out); }
  return out;
}

function header(p: any, f: any) {
  p.drawText("AURORE  —  SECTION ARCHIVES", { x: 48, y: 800, font: f.bold, size: 8.5, color: dark });
  p.drawLine({ start: { x: 48, y: 789 }, end: { x: 547, y: 789 }, thickness: .65, color: line });
}

async function make(d: any, auth: string) {
  const contentProfile=profileStyle(d);
  started = performance.now(); unique = hits = skipped = mathTime = graphTime = 0;
  mc.clear(); mi.clear(); gi.clear();
  const qa: any = { formulas_total: 0, formulas_ok: 0, formulas_failed: 0, graphs_total: 0, graphs_ok: 0, graphs_failed: 0, geogebra_graphs: 0, lists_total: 0, tables_total: 0, image_failures: [] as string[], visual_sources: [] as any[], visuals_total: 0, visuals_ok: 0, visuals_failed: 0 };
  const wikimediaVisuals=await fetchWikimediaVisuals(d,contentProfile);
  stage("START");

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  if (!fontRegularBytes) fontRegularBytes = await bytes(FONT_REGULAR, 12000);
  if (!fontBoldBytes) fontBoldBytes = await bytes(FONT_BOLD, 12000);
  const reg = await pdf.embedFont(fontRegularBytes, { subset: true });
  const bold = await pdf.embedFont(fontBoldBytes, { subset: true });
  stage("FONTS_READY", "v35 Unicode Noto Sans + fontkit");

  if (!logoBytes) logoBytes = await bytes(LOGO);
  const logo = await embed(pdf, logoBytes, "logo");
  stage("LOGO_READY");

  const cp = pdf.addPage([595, 842]);
  cp.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: white });
  cp.drawImage(logo, { x: 48, y: 726, width: 70, height: 70 });
  cp.drawText("SECTION ARCHIVES", { x: 48, y: 690, font: bold, size: 11, color: green });
  cp.drawLine({ start: { x: 48, y: 678 }, end: { x: 160, y: 678 }, thickness: 2, color: mid });
  const titleLines = wrapWords(clean(d.title) || "Document pédagogique", bold, 24, 499);
  let ty = 555;
  for (const tl of titleLines) { cp.drawText(tl, { x: 48, y: ty, font: bold, size: 24, color: dark }); ty -= 30; }
  cp.drawText(`Document ${contentProfile.replace(/_/g," ")} · Aurore`, { x: 48, y: 60, font: reg, size: 10, color: muted });

  const W = 595, H = 842, X = 48, max = 499;
  let p = pdf.addPage([W, H]), y = 764;
  header(p, { reg, bold });
  const next = () => { p = pdf.addPage([W, H]); header(p, { reg, bold }); y = 764; };
  const ensure = (h: number, sp = 10) => { if (y - h - sp < 45) next(); };

  function wrapWords(t: string, f: any, z: number, maxW: number) {
    const w = clean(t).split(/\s+/).filter(Boolean), o: string[] = [];
    let c = "";
    for (const x of w) { const n = c ? c + " " + x : x; if (f.widthOfTextAtSize(n, z) <= maxW) c = n; else { if (c) o.push(c); c = x; } }
    if (c) o.push(c);
    return o;
  }

  type Tok = { type: "word"; text: string } | { type: "img"; im: PDFImage; w: number; h: number };
  async function buildTokens(text: string): Promise<Tok[]> {
    const segs = splitDollar(text);
    const toks: Tok[] = [];
    for (const s of segs) {
      if (s.k === "text") {
        for (const w of clean(s.v).split(/\s+/).filter(Boolean)) toks.push({ type: "word", text: w });
      } else {
        qa.formulas_total++;
        const r = await formulas([s.v], auth);
        if (r.length) {
          const im = await emb(pdf, r[0].b, r[0].k, "math", mi);
          const PX = 8; let w = im.width / PX, h = im.height / PX;
          const maxInlineH = 15;
          if (h > maxInlineH) { const sc = maxInlineH / h; w *= sc; h *= sc; }
          toks.push({ type: "img", im, w, h });
          qa.formulas_ok++;
        } else {
          qa.formulas_failed++;
          toks.push({ type: "word", text: "[formule]" });
        }
      }
    }
    return toks;
  }
  function layout(toks: Tok[], font: any, z: number, maxW: number) {
    const spaceW = font.widthOfTextAtSize(" ", z);
    const lines: { toks: (Tok & { w: number; h: number })[]; h: number }[] = [];
    let cur: (Tok & { w: number; h: number })[] = [], curW = 0, curH = z;
    const flush = () => { if (cur.length) { lines.push({ toks: cur, h: curH }); cur = []; curW = 0; curH = z; } };
    for (const t of toks) {
      const w = t.type === "word" ? font.widthOfTextAtSize(t.text, z) : t.w;
      const h = t.type === "word" ? z : t.h;
      const sep = cur.length ? spaceW : 0;
      if (cur.length && curW + sep + w > maxW) flush();
      const sep2 = cur.length ? spaceW : 0;
      cur.push({ ...t, w, h } as any);
      curW += sep2 + w;
      if (h > curH) curH = h;
    }
    flush();
    return { lines, spaceW };
  }
  async function flow(text: string, opts: { z?: number; color?: any; after?: number; font?: any; box?: boolean; bg?: any; bar?: boolean; barColor?: any; indent?: number } = {}) {
    const z = opts.z ?? 10.5, font = opts.font ?? reg, padX = opts.indent ?? 16, padTop = 10, padBot = 10, lineH = z + 7;
    const toks = await buildTokens(text);
    if (!toks.length) return;
    const { lines, spaceW } = layout(toks, font, z, max - 2 * padX);
    let totalH = padTop + padBot;
    for (const ln of lines) totalH += Math.max(lineH, ln.h + 6);
    ensure(totalH, opts.after ?? 9);
    if (opts.box !== false) {
      rounded(p, X, y - totalH, max, totalH, 11, opts.bg ?? pale);
      if (opts.bar !== false) p.drawLine({ start: { x: X, y: y - 7 }, end: { x: X, y: y - totalH + 7 }, thickness: 3, color: opts.barColor ?? mid });
    }
    let cy = y - padTop - z;
    for (const ln of lines) {
      let cx = X + padX;
      const rowH = Math.max(lineH, ln.h + 6);
      for (const tok of ln.toks) {
        if (tok.type === "word") { p.drawText(tok.text, { x: cx, y: cy, font, size: z, color: opts.color ?? ink }); cx += tok.w + spaceW; }
        else { p.drawImage(tok.im, { x: cx, y: cy - tok.h * 0.12, width: tok.w, height: tok.h }); cx += tok.w + spaceW; }
      }
      cy -= rowH;
    }
    y -= totalH + (opts.after ?? 9);
  }

  async function renderList(items: string[], ordered: boolean) {
    qa.lists_total++;
    const z = 10.2, font = reg, markerW = 20, padTop = 10, padBot = 10, lineH = z + 7;
    const perItem: { lines: any[] }[] = [];
    let totalH = padTop + padBot;
    for (const it of items) {
      const toks = await buildTokens(it);
      const { lines } = layout(toks, font, z, max - 32 - markerW);
      perItem.push({ lines });
      for (const ln of lines) totalH += Math.max(lineH, ln.h + 6);
      totalH += 3;
    }
    ensure(totalH, 9);
    rounded(p, X, y - totalH, max, totalH, 11, pale);
    p.drawLine({ start: { x: X, y: y - 7 }, end: { x: X, y: y - totalH + 7 }, thickness: 3, color: mid });
    let cy = y - padTop - z;
    let n = 1;
    for (const { lines } of perItem) {
      const marker = ordered ? `${n}.` : "•";
      p.drawText(marker, { x: X + 16, y: cy, font: bold, size: z, color: mid });
      for (const ln of lines) {
        let cx = X + 16 + markerW;
        const rowH = Math.max(lineH, ln.h + 6);
        for (const tok of ln.toks) {
          if (tok.type === "word") { p.drawText(tok.text, { x: cx, y: cy, font, size: z, color: ink }); cx += tok.w + font.widthOfTextAtSize(" ", z); }
          else { p.drawImage(tok.im, { x: cx, y: cy - tok.h * 0.12, width: tok.w, height: tok.h }); cx += tok.w + font.widthOfTextAtSize(" ", z); }
        }
        cy -= rowH;
      }
      cy -= 3;
      n++;
    }
    y -= totalH + 9;
  }

  async function renderTable(rows: string[][]) {
    qa.tables_total++;
    const ncols = Math.max(...rows.map((r) => r.length), 1);
    const colW = max / ncols, rowH = 28;
    const totalH = rowH * rows.length;
    ensure(totalH, 12);
    const top = y, bottom = y - totalH;
    p.drawRectangle({ x: X, y: bottom, width: max, height: totalH, color: white, borderColor: line, borderWidth: 1 });
    for (let r = 1; r < rows.length; r++) p.drawLine({ start: { x: X, y: top - r * rowH }, end: { x: X + max, y: top - r * rowH }, thickness: .6, color: line });
    for (let c = 1; c < ncols; c++) p.drawLine({ start: { x: X + c * colW, y: top }, end: { x: X + c * colW, y: bottom }, thickness: .6, color: line });

    for (let ri = 0; ri < rows.length; ri++) {
      const cellY = top - ri * rowH - rowH / 2;
      for (let ci = 0; ci < rows[ri].length; ci++) {
        const raw = rows[ri][ci];
        if (!raw) continue;
        const cx0 = X + ci * colW, cw = colW;
        const isPureMath = /^\$[^$]+\$$/.test(raw) || /^\$\$[^$]+\$\$$/.test(raw);
        if (isPureMath) {
          qa.formulas_total++;
          const latex = raw.replace(/^\${1,2}/, "").replace(/\${1,2}$/, "");
          const r = await formulas([latex], auth);
          if (r.length) {
            const im = await emb(pdf, r[0].b, r[0].k, "cell", mi);
            const PX = 8; let w = im.width / PX, h = im.height / PX;
            const scale = Math.min(1, (cw - 10) / w, 15 / h);
            w *= scale; h *= scale;
            p.drawImage(im, { x: cx0 + (cw - w) / 2, y: cellY - h / 2, width: w, height: h });
            qa.formulas_ok++;
          } else {
            qa.formulas_failed++;
            const txt = clean(latex);
            p.drawText(txt.slice(0, 14), { x: cx0 + 6, y: cellY - 3.5, font: reg, size: 8, color: muted });
          }
        } else {
          const txt = clean(raw.replace(/\$/g, ""));
          if (txt) {
            const size = 9;
            const w = reg.widthOfTextAtSize(txt, size);
            p.drawText(txt.slice(0, 24), { x: cx0 + Math.max(4, (cw - w) / 2), y: cellY - 3.5, font: reg, size, color: ink });
          }
        }
      }
    }
    y -= totalH + 12;
  }

  async function renderImage(graph: any) {
    qa.graphs_total++;
    if (graph?.geogebra_image_path) {
      try {
        const dl = await admin.storage.from("Pdfs").download(graph.geogebra_image_path);
        if (dl.error || !dl.data) throw Error(dl.error?.message || "téléchargement échoué");
        const b = new Uint8Array(await dl.data.arrayBuffer());
        const im = await emb(pdf, b, graph.geogebra_image_path, "graph", gi);
        const availW = max, ratio = im.height / im.width;
        let w = Math.min(availW, 380), h = w * ratio;
        if (h > 260) { h = 260; w = h / ratio; }
        ensure(h + 24, 12);
        rounded(p, X, y - h - 16, max, h + 16, 11, wash);
        p.drawImage(im, { x: X + (max - w) / 2, y: y - h - 8, width: w, height: h });
        if (graph.title) p.drawText(clean(String(graph.title)), { x: X + 16, y: y - h - 20, font: reg, size: 8.5, color: muted });
        y -= h + 24;
        qa.graphs_ok++;
        if (graph.geogebra_image_source === "geogebra") qa.geogebra_graphs++;
        return;
      } catch (e) {
        qa.image_failures.push(e instanceof Error ? e.message : String(e));
      }
    }
    qa.graphs_failed++;
    const msg = "Graphique en cours de génération.";
    ensure(40, 10);
    rounded(p, X, y - 40, max, 40, 11, wash);
    p.drawText(msg, { x: X + 16, y: y - 24, font: reg, size: 9.5, color: muted });
    y -= 52;
  }


  async function renderVisual(v:any) {
    qa.visuals_total++;
    try{
      const b=v?.bytes instanceof Uint8Array?v.bytes:new Uint8Array(v?.bytes||[]);
      if(b.length<8)throw Error("illustration vide");
      const im=await emb(pdf,b,"wikimedia:"+String(v.source_url||v.title||qa.visuals_total),"visual",gi);
      const ratio=Number(v.height||im.height)/Number(v.width||im.width);
      let w=Math.min(max-24,430),h=w*ratio;
      if(h>225){h=225;w=h/ratio;}
      const cardH=h+54;
      ensure(cardH+12,12);
      rounded(p,X,y-cardH,max,cardH,13,wash);
      p.drawText("WIKIMEDIA COMMONS",{x:X+15,y:y-17,font:bold,size:6.7,color:mid});
      p.drawImage(im,{x:X+(max-w)/2,y:y-30-h,width:w,height:h});
      const cap=clean(String(v.caption||v.title||""));
      if(cap)p.drawText(cap.slice(0,90),{x:X+15,y:y-cardH+27,font:reg,size:7.6,color:muted});
      y-=cardH+12;
      qa.visuals_ok++;
      qa.visual_sources.push({title:v.title,author:v.author,license:v.license,source:v.source,source_url:v.source_url});
    }catch(e){
      qa.visuals_failed++;
      qa.image_failures.push(e instanceof Error?e.message:String(e));
    }
  }

  async function displayFormula(latex: string) {
    if (!latex) return;
    qa.formulas_total++;
    const r = await formulas([latex], auth);
    if (!r.length) { qa.formulas_failed++; return; }
    qa.formulas_ok++;
    const im = await emb(pdf, r[0].b, r[0].k, "display", mi);
    const pad = 9, PX = 8;
    let w = im.width / PX, h = im.height / PX;
    const sc = Math.min(1, (max - 24) / (w + 2 * pad), 60 / (h + 2 * pad));
    w *= sc; h *= sc;
    ensure(h + 2 * pad + 8, 9);
    rounded(p, X + (max - (w + 2 * pad)) / 2, y - h - 2 * pad, w + 2 * pad, h + 2 * pad, 9, wash);
    p.drawImage(im, { x: X + (max - w) / 2, y: y - h - pad, width: w, height: h });
    y -= h + 2 * pad + 8;
  }

  async function renderBlocks(blocks: Block[], graphs: any[]) {
    let gIdx = 0;
    for (const b of blocks) {
      if (b.type === "text") await flow(b.value);
      else if (b.type === "list") await renderList(b.items, b.ordered);
      else if (b.type === "table") await renderTable(b.rows);
      else if (b.type === "image") { await renderImage(graphs[gIdx]); gIdx++; }
    }
  }

  stage("MATH_PREWARM_START");
  const allMath = [...new Set(collectMathValues(d).map(toTex).filter(Boolean))];
  await formulas(allMath, auth);
  stage("MATH_PREWARM_DONE", `requested=${allMath.length}; cached=${mc.size}; unique=${unique}; skipped=${skipped}`);
  stage("CONTENT_START");
  if (d.introduction) await flow(String(d.introduction));
  if (Array.isArray(d.learning_objectives) && d.learning_objectives.length) await renderList(d.learning_objectives.map(String), false);

  const secs = Array.isArray(d.sections) ? d.sections : [];
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const sectionTitles:any={scientifique:{kicker:"NOTION · MÉTHODE · APPLICATION",exercise:"Exercice",objective:"Objectif"},experimental:{kicker:"OBSERVATION · EXPLICATION · APPLICATION",exercise:"Exercice",objective:"Objectif"},langues:{kicker:"LANGUAGE · PRACTICE · COMMUNICATION",exercise:"Activity",objective:"Learning objective"},francais_litterature:{kicker:"LECTURE · ANALYSE · INTERPRÉTATION",exercise:"Activité",objective:"Objectif"},histoire_geographie:{kicker:"REPÈRES · ANALYSE · SYNTHÈSE",exercise:"Activité",objective:"Objectif"},informatique:{kicker:"CONCEPT · CODE · PRATIQUE",exercise:"Mise en pratique",objective:"Objectif"},technique:{kicker:"PRINCIPE · PROCÉDURE · CONTRÔLE",exercise:"Application",objective:"Objectif"}};
    const ps=sectionTitles[contentProfile]||{kicker:"COURS · APPLICATION · SYNTHÈSE",exercise:"Exercice",objective:"Objectif"};
    ensure(42, 12);
    p.drawText(String(i + 1).padStart(2, "0"), { x: X, y: y - 2, font: bold, size: 9, color: mid });
    p.drawText(ps.kicker, { x: X + 34, y: y + 1, font: bold, size: 6.8, color: mid });
    p.drawText(clean(s.title || "Section").toUpperCase(), { x: X + 34, y: y - 13, font: bold, size: 15.5, color: dark });
    y -= 42;
    if (s.objective) await flow(ps.objective + " — " + String(s.objective), { z: 9.5, color: muted, after: 8, bg: wash, barColor: mid });
    if (Array.isArray(s.content)) await renderBlocks(parseBlocks(s.content.map(String)), Array.isArray(s.graphs) ? s.graphs : []);
    if (Array.isArray(s.graphs) && s.graphs.length) {
      for (const g of s.graphs) await renderImage(g);
    }
    if (s.formula) await displayFormula(String(s.formula));
    for(const v of (wikimediaVisuals||[]).filter((x:any)=>Number(x.section_index)===i)) await renderVisual(v);
    if (Array.isArray(s.exercises)) {
      for (let n = 0; n < s.exercises.length; n++) {
        const q = s.exercises[n];
        await flow(ps.exercise + " " + (n + 1) + ". " + String(q?.question || ""), { bg: contentProfile==="langues" ? rgb(.985,.95,.98) : contentProfile==="francais_litterature" ? rgb(.99,.96,.95) : pale, barColor: mid });
        if (q?.hint) await flow(`Indication — ${String(q.hint)}`, { z: 9.5, color: muted, after: 6, bg: wash });
        if (q?.formula) await displayFormula(String(q.formula));
      }
    }
  }
  stage("CONTENT_READY");

  if (Array.isArray(d.corrections) && d.corrections.length) {
    ensure(36, 12);
    p.drawText(contentProfile==="langues"?"ANSWERS":contentProfile==="francais_litterature"?"CORRIGÉS ET ANALYSE":"CORRIGÉS", { x: X, y: y - 4, font: bold, size: 16, color: dark });
    y -= 36;
    for (const c of d.corrections) {
      await flow(`Corrigé — exercice ${c.exercise_number || ""}`, { color: dark, after: 5, bg: pale });
      if (c.solution) await flow(String(c.solution));
      if (c.formula) await displayFormula(String(c.formula));
    }
  }
  stage("MATH_READY", `ok=${qa.formulas_ok}; failed=${qa.formulas_failed}; unique=${unique}; cache=${hits}; skipped=${skipped}`);

  const bp = pdf.addPage([595, 842]);
  bp.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: white });
  rounded(bp, 48, 88, 499, 700, 24, pale);
  bp.drawLine({ start: { x: 48, y: 112 }, end: { x: 48, y: 764 }, thickness: 5, color: green });
  const hasVisualRefs=Array.isArray(wikimediaVisuals)&&wikimediaVisuals.length>0;
  bp.drawText(hasVisualRefs?"RÉFÉRENCES VISUELLES":"MOTS DE BON USAGE",{x:88,y:720,font:bold,size:19,color:dark});
  bp.drawText(hasVisualRefs?"SOURCES ET LICENCES":"ET DE DROITS D'AUTEUR",{x:88,y:690,font:bold,size:19,color:dark});
  if(hasVisualRefs){
    let ry=640;
    for(const v of wikimediaVisuals){
      bp.drawText(clean(String(v.title||"Illustration")).slice(0,62),{x:88,y:ry,font:bold,size:9.2,color:ink}); ry-=16;
      bp.drawText(("Auteur : "+String(v.author||"Auteur non renseigné")).slice(0,74),{x:88,y:ry,font:reg,size:8.0,color:muted}); ry-=13;
      bp.drawText(("Licence : "+String(v.license||"Licence libre Commons")).slice(0,74),{x:88,y:ry,font:reg,size:8.0,color:muted}); ry-=13;
      bp.drawText("Source : Wikimedia Commons",{x:88,y:ry,font:reg,size:8.0,color:muted}); ry-=12;
      const u=String(v.source_url||"");
      if(u)bp.drawText(u.slice(0,82),{x:88,y:ry,font:reg,size:6.0,color:mid});
      ry-=25;
    }
    bp.drawText("Sélection automatique limitée aux fichiers dont les métadonnées indiquent une licence compatible.",{x:88,y:112,font:reg,size:7.0,color:muted});
    bp.drawText("Consultez toujours la page source pour les conditions complètes de réutilisation.",{x:88,y:101,font:reg,size:7.0,color:muted});
  }else{
    bp.drawText("Ce document est produit par Aurore à des fins pédagogiques.",{x:88,y:630,font:reg,size:11.5,color:ink});
  }
  bp.drawImage(logo,{x:475,y:40,width:72,height:72});
  stage("BACK_PAGE_READY");

  const saved = new Uint8Array(await pdf.save({ useObjectStreams: false }));
  stage("PDF_SAVE_DONE", `${saved.length} octets`);
  return { bytes: saved, qa, logo: `${logoBytes.length} octets` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: C });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  const a = req.headers.get("Authorization");
  if (!a?.startsWith("Bearer ")) return json({ error: "Authentification requise" }, 401);
  const uc = createClient(SUPA_URL, ANON, { global: { headers: { Authorization: a } }, auth: { autoRefreshToken: false, persistSession: false } });
  const u = await uc.auth.getUser();
  if (u.error || !u.data.user) return json({ error: "Session invalide" }, 401);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }
  const id = Number(b?.generated_document_id);
  if (!Number.isSafeInteger(id) || id < 1) return json({ error: "generated_document_id obligatoire" }, 400);
  const { data: doc, error } = await admin.from("aurora_generated_documents").select("*").eq("id", id).eq("created_by", u.data.user.id).maybeSingle();
  if (error || !doc) return json({ error: "Document généré introuvable" }, 404);
  if (!["generated", "review", "approved"].includes(doc.status)) return json({ error: `Rendu impossible depuis ${doc.status}` }, 409);
  try {
    const r = await make({ ...(doc.content_json || {}), subject: doc.subject || undefined, level: doc.level || undefined, class_name: doc.class_name || undefined }, a);
    const path = `aurora-content/${u.data.user.id}/${doc.id}/v${doc.version || 1}-${slug(doc.title)}.pdf`;
    stage("STORAGE_UPLOAD_START");
    const up = await admin.storage.from("Pdfs").upload(path, r.bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) throw Error(`Storage: ${up.error.message}`);
    const pub = admin.storage.from("Pdfs").getPublicUrl(path);
    const metadata = { ...(doc.metadata || {}), pdf_diagnostic: diagnostic, pdf_render: { engine: "pdf-lib+fontkit+NotoSans-v37-Wikimedia", generated_at: new Date().toISOString(), bytes: r.bytes.length, qa: r.qa, performance: "v37-wikimedia", visual_sources: r.qa?.visual_sources || [] } };
    const { error: ue } = await admin.from("aurora_generated_documents").update({
      pdf_path: path, pdf_url: pub.data.publicUrl, metadata,
      validation_notes: `Renderer v37 + Wikimedia Commons: police Unicode Noto Sans + fontkit pour éviter les erreurs WinAnsi (≠, ≤, ≥, etc.), sans modifier le pipeline MathJax/LaTeX. Correctifs toTex() (LaTeX ne doit plus être corrompu par les anciennes heuristiques exp(/ln(/sqrt() et mise à l'échelle naturelle des formules inline (plus de hauteur cible forcée).`,
    }).eq("id", id);
    if (ue) throw Error(ue.message);
    stage("DATABASE_UPDATE_DONE");
    await persist(id);
    return json({ ok: true, generated_document_id: id, pdf_path: path, pdf_url: pub.data.publicUrl, bytes: r.bytes.length, qa: r.qa, stage: "DATABASE_UPDATE_DONE" });
  } catch (e) {
    console.error("[AURORA_PDF_ERROR]", stageNow, e);
    await persist(id);
    return json({ ok: false, generated_document_id: id, stage: stageNow, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
