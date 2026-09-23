import fs from "node:fs/promises";
import http from "node:http";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.SUPABASE_URL;
const RENDER_TOKEN = process.env.AURORA_LUALATEX_RENDER_TOKEN;
const DOCUMENT_ID = Number(process.env.DOCUMENT_ID);
const GEO_GEBRA_RENDERER_VERSION = 3;

if (!SUPABASE_URL || !RENDER_TOKEN || !Number.isSafeInteger(DOCUMENT_ID)) {
  throw new Error("SUPABASE_URL, AURORA_LUALATEX_RENDER_TOKEN et DOCUMENT_ID sont requis.");
}

const sourceUrl = `${SUPABASE_URL}/functions/v1/aurora-lualatex-source?document_id=${DOCUMENT_ID}`;
const sourceResponse = await fetch(sourceUrl, {
  headers: { "x-aurore-render-token": RENDER_TOKEN },
});
if (!sourceResponse.ok) {
  throw new Error(`Source document HTTP ${sourceResponse.status}: ${await sourceResponse.text()}`);
}
const sourcePayload = await sourceResponse.json();
const document = sourcePayload?.document;
if (!document?.content_json || typeof document.content_json !== "object") {
  throw new Error("Le document source ne contient pas content_json.");
}

const content = structuredClone(document.content_json);
content._aurore_document = {
  ...(content._aurore_document && typeof content._aurore_document === "object"
    ? content._aurore_document
    : {}),
  id: Number(document.id),
  created_at: document.created_at,
  version: Number(document.version || 1),
  title: document.title,
};

function instrumentOf(g) {
  const raw = String(g?.instrument || g?.graph_type || "").toLowerCase().trim();
  const aliases = {
    function: "function2d",
    graph: "function2d",
    courbe: "function2d",
    complex_plane: "complex_plane",
    parametric: "parametric2d",
    geometrie3d: "geometry3d",
    "3d": "geometry3d",
  };
  const normalized = aliases[raw] || raw;
  const objects = Array.isArray(g?.objects) ? g.objects : [];
  const points = Array.isArray(g?.points) ? g.points : [];
  const poi = Array.isArray(g?.points_of_interest) ? g.points_of_interest : [];
  const hasObjects = objects.some((o) =>
    o && typeof o === "object" &&
    ["point","vector","line","plane","sphere","cylinder","cone","polygon","cube","prism","pyramid","tetrahedron"]
      .includes(String(o?.type || "").toLowerCase()),
  );
  const hasExpression = String(g?.expression || "").trim();
  const hasX = String(g?.x_expression || "").trim();
  const hasY = String(g?.y_expression || "").trim();
  const hasZ = String(g?.z_expression || "").trim();
  if (["function2d","complex_plane","parametric2d","parametric3d","surface3d","geometry3d"].includes(normalized)) return normalized;
  if (raw) return null;
  if (hasObjects) return "geometry3d";
  if (hasZ && hasX && hasY) return "parametric3d";
  if (hasX && hasY) return points.some((p) => Array.isArray(p) && p.length >= 3) || poi.some((p) => p && Number.isFinite(Number(p?.z)))
    ? "parametric3d"
    : "parametric2d";
  if (hasExpression) return "function2d";
  if (points.some((p) => Array.isArray(p) && p.length >= 3) || poi.some((p) => p && Number.isFinite(Number(p?.z)))) return "geometry3d";
  if (points.some((p) => Array.isArray(p) && p.length === 2) || (Array.isArray(g?.asymptotes) && g.asymptotes.length)) return "function2d";
  return null;
}

function validGraph(g) {
  const instrument = instrumentOf(g);
  if (!["function2d", "complex_plane", "parametric2d", "parametric3d", "surface3d", "geometry3d"].includes(instrument)) {
    return false;
  }
  const objects = Array.isArray(g?.objects) ? g.objects : [];
  const points = Array.isArray(g?.points) ? g.points : [];
  const poi = Array.isArray(g?.points_of_interest) ? g.points_of_interest : [];
  if (instrument === "function2d" || instrument === "complex_plane") {
    return Boolean(
      String(g?.expression || "").trim() ||
      (Array.isArray(g?.asymptotes) && g.asymptotes.length) ||
      points.some((p) => Array.isArray(p) && p.length === 2),
    );
  }
  if (instrument === "parametric2d") return Boolean(String(g?.x_expression || "").trim() && String(g?.y_expression || "").trim());
  if (instrument === "parametric3d") return Boolean(String(g?.x_expression || "").trim() && String(g?.y_expression || "").trim() && String(g?.z_expression || "").trim());
  if (instrument === "surface3d") return Boolean(String(g?.expression || "").trim());
  const validTypes = new Set([
    "point","vector","line","plane","sphere","cylinder","cone","polygon","cube",
    "prism","pyramid","tetrahedron",
  ]);
  return objects.some((o) => validTypes.has(String(o?.type || "").toLowerCase()))
    || points.some((p) => Array.isArray(p) && p.length >= 3)
    || poi.some((p) => p && Number.isFinite(Number(p?.z)));
}

function imageReady(g) {
  const path = String(g?.geogebra_image_path || "").trim();
  const source = String(g?.geogebra_image_source || "").toLowerCase();
  if (!path || source !== "geogebra") return false;
  const solids = new Set(["sphere","cylinder","cone","cube","prism","pyramid","tetrahedron"]);
  const hasSolid = (Array.isArray(g?.objects) ? g.objects : []).some((o) =>
    solids.has(String(o?.type || "").toLowerCase()),
  );
  return Number(g?.geogebra_renderer_version || 0) >= GEO_GEBRA_RENDERER_VERSION && (!hasSolid || Number(g?.geogebra_renderer_version || 0) >= GEO_GEBRA_RENDERER_VERSION);
}

const pending = [];
let globalGraphIndex = 0;
for (const [sectionIndex, section] of (Array.isArray(content.sections) ? content.sections : []).entries()) {
  for (const [graphIndex, graph] of (Array.isArray(section?.graphs) ? section.graphs : []).entries()) {
    if (validGraph(graph) && !imageReady(graph)) {
      pending.push({ sectionIndex, graphIndex, globalGraphIndex, graph });
    }
    globalGraphIndex++;
  }
}

console.log(`GeoGebra server-side: ${pending.length} graphique(s) à rendre pour le document #${DOCUMENT_ID}.`);

if (!pending.length) {
  await fs.writeFile(
    "infra/lualatex/production/document.json",
    JSON.stringify(content, null, 2),
    "utf8",
  );
  console.log("Aucun graphique GeoGebra manquant.");
  process.exit(0);
}

const server = http.createServer((req, res) => {
  if (req.url !== "/geogebra.html") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(`<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Aurore GeoGebra renderer</title></head>
<body style="margin:0;background:#fff">
  <script src="https://www.geogebra.org/apps/deployggb.js"></script>
</body>
</html>`);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") {
  await new Promise((resolve) => server.close(resolve));
  throw new Error("Impossible de démarrer le serveur local GeoGebra.");
}
const localOrigin = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=swiftshader",
    "--disable-features=IsolateOrigins,site-per-process",
  ],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
page.on("pageerror", (error) => console.warn("[GeoGebra pageerror]", error.message));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    console.warn("[GeoGebra console]", message.type(), message.text());
  }
});
page.on("requestfailed", (request) => {
  console.warn("[GeoGebra requestfailed]", request.method(), request.url(), request.failure()?.errorText || "unknown");
});
await page.goto(`${localOrigin}/geogebra.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => typeof window.GGBApplet === "function", { timeout: 60000 });
await page.waitForTimeout(2000);
console.log(`GeoGebra host page ready: ${localOrigin}`);

const renderGraphInBrowser = async (graph) => {
  return await page.evaluate(async (graph) => {
    function finite(v, fallback) {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    }
    function parameter(v) {
      const t = String(v || "t").replace(/[^A-Za-z0-9_]/g, "").trim() || "t";
      return /^[xyz]$/i.test(t) ? "t" : t;
    }
    function expr(v) {
      return String(v || "")
        .trim()
        .replace(/^\s*(?:f\s*\(\s*x\s*\)|y)\s*=\s*/i, "")
        .replace(/×/g, "*")
        .replace(/÷/g, "/")
        .replace(/−/g, "-")
        .replace(/√\s*\(/g, "sqrt(")
        .replace(/\bln\s*\(/gi, "ln(")
        .replace(/\blog\s*\(/gi, "log(");
    }
    function point3(raw) {
      if (Array.isArray(raw) && raw.length >= 3) {
        const p = raw.slice(0, 3).map(Number);
        return p.every(Number.isFinite) ? p : null;
      }
      if (typeof raw === "string") {
        const m = raw.trim().match(/^[\[\(]\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*[\]\)]$/);
        return m ? m.slice(1).map(Number) : null;
      }
      return null;
    }
    function geometryCommands(g) {
      const cmds = [];
      const objects = Array.isArray(g?.objects) ? g.objects : [];
      let seq = 1;
      const ensurePoint = (raw, prefix) => {
        if (typeof raw === "string" && /^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) return raw;
        const p = point3(raw);
        if (!p) return null;
        const name = (prefix || "P") + seq++;
        cmds.push(name + "=(" + p.join(",") + ")");
        return name;
      };
      for (const o of objects) {
        if (!o || typeof o !== "object") continue;
        const type = String(o.type || "").toLowerCase();
        const requested = (String(o.name || "").match(/^[A-Za-z][A-Za-z0-9_]*$/) || [])[0] || "";
        const reserved = new Set([
          "Angle","Axes","Bottom","Center","Circle","Cone","Cube","Curve","Cylinder","Distance",
          "Function","Height","Intersect","Line","Midpoint","Plane","Point","Polygon","Prism",
          "Pyramid","Radius","Ray","Segment","Sphere","Surface","Tetrahedron","Top","Vector","Volume",
        ]);
        const safe = requested && !reserved.has(requested) ? requested : "";
        const generated = () => {
          const prefix = {
            point:"P",vector:"u",line:"d",plane:"p",sphere:"sphere",cylinder:"cylinder",
            cone:"cone",polygon:"poly",cube:"cube",prism:"prism",pyramid:"pyr",tetrahedron:"tetra",
          }[type] || "obj";
          return prefix + seq++;
        };
        const name = type === "point" && safe ? safe : generated();
        const ps = Array.isArray(o.points) ? o.points : [];
        if (type === "point") {
          const p = point3(o.point || ps[0] || o.coordinates);
          if (p) cmds.push(name + "=(" + p.join(",") + ")");
        } else if (type === "vector") {
          const a = ensurePoint(o.from || ps[0], "A");
          const b = ensurePoint(o.to || ps[1], "B");
          if (a && b) cmds.push(name + "=Vector(" + a + "," + b + ")");
        } else if (type === "line") {
          const a = ensurePoint(o.from || ps[0], "A");
          const b = ensurePoint(o.to || ps[1], "B");
          if (a && b) cmds.push(name + "=Line(" + a + "," + b + ")");
        } else if (type === "plane") {
          const a = ensurePoint(ps[0], "A");
          const b = ensurePoint(ps[1], "B");
          const c = ensurePoint(ps[2], "C");
          if (a && b && c) cmds.push(name + "=Plane(" + a + "," + b + "," + c + ")");
        } else if (type === "sphere") {
          const a = ensurePoint(o.center || o.from || ps[0], "O");
          const r = Number(o.radius);
          if (a && Number.isFinite(r) && r > 0) cmds.push(name + "=Sphere(" + a + "," + r + ")");
        } else if (type === "cylinder" || type === "cone") {
          const r = Number(o.radius);
          let a = ensurePoint(o.from || ps[0], "A");
          let b = ensurePoint(o.to || ps[1], "B");
          if (a && !b && Number.isFinite(Number(o.height)) && Number(o.height) > 0) {
            const base = point3(o.from || ps[0]);
            if (base) b = ensurePoint([base[0], base[1], base[2] + Number(o.height)], "B");
          }
          if (a && b && Number.isFinite(r) && r > 0) {
            cmds.push(name + "=" + (type === "cylinder" ? "Cylinder" : "Cone") + "(" + a + "," + b + "," + r + ")");
          }
        } else if (type === "polygon") {
          const refs = ps.map((q) => ensurePoint(q, "P")).filter(Boolean);
          if (refs.length >= 3) cmds.push(name + "=Polygon(" + refs.join(",") + ")");
        } else if (["cube","prism","pyramid","tetrahedron"].includes(type)) {
          const refs = ps.map((q) => ensurePoint(q, "P")).filter(Boolean);
          if (type === "cube" && refs.length >= 2) cmds.push(name + "=Cube(" + refs.slice(0, 3).join(",") + ")");
          else if (type === "tetrahedron" && refs.length >= 3) cmds.push(name + "=Tetrahedron(" + refs.slice(0, 3).join(",") + ")");
          else if (type === "pyramid" && refs.length >= 4) cmds.push(name + "=Pyramid(" + refs.join(",") + ")");
          else if (type === "prism" && refs.length >= 6) cmds.push(name + "=Prism(" + refs.join(",") + ")");
        }
      }
      return cmds;
    }

    function graphInstrument(g) {
      const raw = String(g?.instrument || g?.graph_type || "").toLowerCase().trim();
      const aliases = { function:"function2d",graph:"function2d",courbe:"function2d",complex_plane:"complex_plane",parametric:"parametric2d",geometrie3d:"geometry3d","3d":"geometry3d" };
      const normalized = aliases[raw] || raw;
      const objects = Array.isArray(g?.objects) ? g.objects : [];
      const hasObjects = objects.some((o) =>
        o && typeof o === "object" &&
        ["point","vector","line","plane","sphere","cylinder","cone","polygon","cube","prism","pyramid","tetrahedron"].includes(String(o?.type || "").toLowerCase()),
      );
      const hasX = String(g?.x_expression || "").trim();
      const hasY = String(g?.y_expression || "").trim();
      const hasZ = String(g?.z_expression || "").trim();
      const hasExpression = String(g?.expression || "").trim();
      if (["function2d","complex_plane","parametric2d","parametric3d","surface3d","geometry3d"].includes(normalized)) return normalized;
      if (hasObjects) return "geometry3d";
      if (hasZ && hasX && hasY) return "parametric3d";
      if (hasX && hasY) return "parametric2d";
      if (hasExpression) return "function2d";
      return null;
    }

    const instrument = graphInstrument(graph);
    if (!instrument) throw new Error("Instrument GeoGebra inconnu.");
    const is3D = ["parametric3d","surface3d","geometry3d"].includes(instrument);
    const width = 1400, height = is3D ? 900 : 820;
    const host = document.createElement("div");
    const hostId = "aurora-server-ggb-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    host.id = hostId;
    host.style.cssText = "position:fixed;left:0;top:0;width:"+width+"px;height:"+height+"px;opacity:1;visibility:visible;background:#fff;overflow:hidden;z-index:9999;";
    document.body.appendChild(host);

    const commands = [];
    if (instrument === "parametric2d") {
      const x=expr(graph?.x_expression), y=expr(graph?.y_expression), t=parameter(graph?.parameter);
      const tmin=finite(graph?.t_min,0), tmax=finite(graph?.t_max,2*Math.PI);
      if (x && y && tmax > tmin) commands.push("Curve("+x+","+y+","+t+","+tmin+","+tmax+")");
    } else if (instrument === "parametric3d") {
      const x=expr(graph?.x_expression), y=expr(graph?.y_expression), z=expr(graph?.z_expression), t=parameter(graph?.parameter);
      const tmin=finite(graph?.t_min,0), tmax=finite(graph?.t_max,2*Math.PI);
      if (x && y && z && tmax > tmin) commands.push("Curve("+x+","+y+","+z+","+t+","+tmin+","+tmax+")");
    } else if (instrument === "surface3d") {
      const e=expr(graph?.expression); if (e) commands.push("f(x,y)="+e);
    } else if (instrument === "geometry3d") {
      commands.push(...geometryCommands(graph));
    } else if (instrument === "complex_plane") {
      // Complex-plane illustrations are represented by explicit 2D solution
      // points. Do not inject the symbolic z^6=64 relation as f(x)=...;
      // GeoGebra only needs the solution points and the coordinate axes.
    } else {
      const raw = String(graph?.expression || "").trim();
      const e = expr(raw);
      if (e) {
        // Conics from Content Factory are often implicit equations
        // (for example x^2+y^2=4). GeoGebra must receive the relation
        // itself, not an invalid f(x)=<implicit-equation> wrapper.
        const isImplicitEquation =
          e.indexOf("=") > 0 &&
          e.indexOf("=") === e.lastIndexOf("=") &&
          /[xy]/i.test(e);
        commands.push(isImplicitEquation ? e : "f(x)=" + e);
      }
    }

    if (instrument === "function2d" || instrument === "complex_plane" || instrument === "parametric2d") {
      const xmin=finite(graph?.x_min,-10), xmax=finite(graph?.x_max,10), ymin=finite(graph?.y_min,-10), ymax=finite(graph?.y_max,10);
      if (xmax>xmin && ymax>ymin) {
        commands.push("SetCoordSystem("+[xmin,xmax,ymin,ymax].join(",")+")");
      }
      if ((instrument === "function2d" || instrument === "complex_plane") && Array.isArray(graph?.points)) {
        let pointIndex = 0;
        for (const raw of graph.points) {
          if (!Array.isArray(raw) || raw.length < 2) continue;
          const px = Number(raw[0]), py = Number(raw[1]);
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          pointIndex += 1;
          commands.push("P"+pointIndex+"=("+px+","+py+")");
        }
      }
      if (instrument !== "complex_plane") {
        commands.push(
          "O=(0,0)",
          "I=(1,0)",
          "J=(0,1)",
          "SetLabelVisible(O,true)",
          "SetLabelVisible(I,true)",
          "SetLabelVisible(J,true)",
        );
      }
    }

    try {
      const b64 = await new Promise((resolve, reject) => {
        let done = false, api = null, loaded = false;
        const finish = (fn, value) => {
          if (done) return;
          done = true;
          try { api?.remove?.(); } catch {}
          try { host.remove(); } catch {}
          fn(value);
        };
        const timer = setTimeout(() => finish(reject, new Error(loaded ? "GeoGebra n'a pas terminé la construction." : "GeoGebra n'a pas chargé l'applet.")), 45000);
        const params = {
          id: hostId,
          appName: is3D ? "3d" : "graphing",
          width,
          height,
          showToolBar:false, showAlgebraInput:false, showMenuBar:false,
          showResetIcon:false, showFullscreenButton:false, showZoomButtons:false,
          showSuggestionButtons:false, language:"fr",
          appletOnLoad: (a) => {
            api=a; loaded=true;
            try {
              try { a.evalCommand("SetActiveView("+(is3D?-1:1)+")"); } catch {}
              if (is3D) {
                const vals=[graph?.x_min,graph?.x_max,graph?.y_min,graph?.y_max,graph?.z_min,graph?.z_max].map(Number);
                if (vals.every(Number.isFinite) && vals[1]>vals[0] && vals[3]>vals[2] && vals[5]>vals[4]) a.setCoordSystem(...vals,true);
                try { a.setAxesVisible(3,true,true,true); } catch {}
                try { a.setGridVisible(3,true); } catch {}
                try { a.setAxisLabels(3,"x","y","z"); } catch {}
                try { a.setAxisSteps(3,1,1,1,0); } catch {}
              } else {
                const showAxes = graph?.axes !== false;
                const showGrid = graph?.grid !== false;
                try { a.setAxesVisible(showAxes,showAxes); } catch {}
                try { a.setGridVisible(showGrid); } catch {}
                try { a.setAxisSteps(1,1,1,0); } catch {}
                try { a.setAxisLabels(1,String(graph?.x_label || "x"),String(graph?.y_label || "y")); } catch {}
              }

              const primary = instrument === "complex_plane"
                ? commands.filter((c) => /^P\d+=\([-0-9.,]+\)$/.test(c))
                : commands.filter((c) =>
                    /(?:Curve|Sphere|Cylinder|Cone|Cube|Prism|Pyramid|Tetrahedron|Polygon|Line|Plane|Vector)\s*\(/i.test(c) ||
                    /^f\s*\(\s*x(?:\s*,\s*y)?\s*\)\s*=/.test(c) ||
                    /^[^=]+=[^=]+$/.test(c) ||
                    /^[A-Za-z][A-Za-z0-9_]*=\([^)]*\)$/.test(c)
                  );
              if (!primary.length) {
                clearTimeout(timer);
                finish(reject, new Error("Aucune commande GeoGebra de construction exploitable."));
                return;
              }
              for (const command of commands) {
                try { a.evalCommand(command); } catch (e) { console.warn("GeoGebra command failed:", command, e); }
              }
              let attempts=0;
              const ready=()=>{
                attempts++;
                const count=typeof a.getObjectNumber==="function" ? Number(a.getObjectNumber()) : 0;
                if (count >= primary.length) {
                  try { a.setRepaintingActive?.(true); } catch {}
                  try { a.recalculateEnvironments?.(); } catch {}
                  try { a.refreshViews?.(); } catch {}
                  try { if (is3D) a.showAllObjects?.(); } catch {}
                  try { a.evalCommand("SetActiveView("+(is3D?-1:1)+")"); } catch {}
                  setTimeout(()=>{
                    try {
                      const out=String(a.getPNGBase64(2,false,144)||"").replace(/^data:image\/png;base64,/i,"");
                      if (!out) throw new Error("GeoGebra a renvoyé une image vide.");
                      clearTimeout(timer);
                      finish(resolve,out);
                    } catch(e) {
                      clearTimeout(timer);
                      finish(reject,e);
                    }
                  },1800);
                  return;
                }
                if (attempts < 120) setTimeout(ready,250);
                else { clearTimeout(timer); finish(reject,new Error("GeoGebra n'a pas créé les objets attendus.")); }
              };
              ready();
            } catch(e) {
              clearTimeout(timer);
              finish(reject,e);
            }
          },
        };
        try {
          const applet = new window.GGBApplet(params, true);
          applet.inject(hostId);
        } catch(e) {
          clearTimeout(timer);
          finish(reject,e);
        }
      });
      return b64;
    } catch (e) {
      try { host.remove(); } catch {}
      throw e;
    }
  }, graph);
};

for (const item of pending) {
  console.log(`GeoGebra ${item.globalGraphIndex + 1}/${pending.length}: ${item.graph?.title || "Graphique"}`);
  const pngBase64 = await renderGraphInBrowser(item.graph);
  const uploadResponse = await fetch(`${SUPABASE_URL}/functions/v1/aurora-geogebra`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-aurore-render-token": RENDER_TOKEN,
    },
    body: JSON.stringify({
      generated_document_id: DOCUMENT_ID,
      graph_index: item.globalGraphIndex,
      png_base64: pngBase64,
      action: "server-upload",
    }),
  });
  const uploadData = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !uploadData?.ok) {
    throw new Error(
      `GeoGebra upload échoué pour ${item.globalGraphIndex + 1}: ${JSON.stringify(uploadData)}`,
    );
  }
  content.sections[item.sectionIndex].graphs[item.graphIndex].geogebra_image_path = uploadData.path;
  content.sections[item.sectionIndex].graphs[item.graphIndex].geogebra_image_source = "geogebra";
  content.sections[item.sectionIndex].graphs[item.graphIndex].geogebra_renderer_version = GEO_GEBRA_RENDERER_VERSION;
  content.sections[item.sectionIndex].graphs[item.graphIndex].geogebra_image_updated_at = new Date().toISOString();
  console.log(`  → PNG enregistré: ${uploadData.path} (${uploadData.bytes} bytes)`);
}

await browser.close();
await new Promise((resolve) => server.close(resolve));

await fs.writeFile(
  "infra/lualatex/production/document.json",
  JSON.stringify(content, null, 2),
  "utf8",
);

const remaining=[];
globalGraphIndex=0;
for (const section of Array.isArray(content.sections) ? content.sections : []) {
  for (const graph of Array.isArray(section?.graphs) ? section.graphs : []) {
    if (validGraph(graph) && !imageReady(graph)) remaining.push(globalGraphIndex);
    globalGraphIndex++;
  }
}
if (remaining.length) {
  throw new Error(`Préparation GeoGebra incomplète. Graphiques manquants: ${remaining.map((n)=>n+1).join(", ")}`);
}
console.log(`GeoGebra server-side OK: ${pending.length} graphique(s) prêt(s) pour LuaLaTeX (renderer v${GEO_GEBRA_RENDERER_VERSION}).`);