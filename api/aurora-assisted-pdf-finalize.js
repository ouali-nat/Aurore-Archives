const { PDFDocument } = require("pdf-lib");
const { createHash } = require("node:crypto");

const SUPABASE_URL = "https://tdeotqfsbvouresfhkab.supabase.co";
const EDGE_FUNCTION_URL = SUPABASE_URL + "/functions/v1/aurora-assisted-pdf-finalize";
const MAX_FRAGMENTS = 200;
const MAX_SOURCE_BYTES = 180 * 1024 * 1024;
const MAX_FINAL_BYTES = 47 * 1024 * 1024;

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.end(JSON.stringify(value));
}

function parseBody(req) {
  let body = req.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") return JSON.parse(body);
  throw new Error("Corps JSON de fusion manquant ou invalide.");
}

function signedSourcePath(raw) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    throw new Error("Une page ne possède pas une URL PDF valide.");
  }
  if (url.protocol !== "https:" || url.origin !== new URL(SUPABASE_URL).origin) {
    throw new Error("Une page PDF provient d’un serveur non autorisé.");
  }
  const prefix = "/storage/v1/object/sign/Pdfs/";
  if (!url.pathname.startsWith(prefix)) throw new Error("Une page PDF n’est pas un lien signé du bucket autorisé.");
  let path;
  try { path = decodeURIComponent(url.pathname.slice(prefix.length)); }
  catch { throw new Error("Le chemin d’une page PDF est mal encodé."); }
  if (!path || path.includes("..") || path.includes("\\") || path.split("/").length !== 4) {
    throw new Error("Le chemin d’une page PDF est invalide.");
  }
  return path;
}

async function readPdf(url, label, totalBefore) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error("Téléchargement serveur de la page " + label + " impossible (HTTP " + response.status + ").");
  const statedSize = Number(response.headers.get("content-length")) || 0;
  if (statedSize && totalBefore + statedSize > MAX_SOURCE_BYTES) {
    throw new Error("Les fragments dépassent 180 Mio au total. Les pages restent intactes ; aucun téléchargement n’a été lancé sur le téléphone.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error("Le fragment " + label + " n’est pas un PDF valide.");
  }
  if (totalBefore + bytes.length > MAX_SOURCE_BYTES) {
    throw new Error("Les fragments dépassent 180 Mio au total. Les pages restent intactes ; aucun téléchargement n’a été lancé sur le téléphone.");
  }
  return bytes;
}


function isPdfRef(value) {
  return !!value && value.constructor && value.constructor.name === "PDFRef"
    && typeof value.toString === "function";
}

function isPdfDict(value) {
  return !!value && value.constructor && value.constructor.name === "PDFDict"
    && typeof value.entries === "function" && typeof value.set === "function";
}

function isPdfArray(value) {
  return !!value && value.constructor && value.constructor.name === "PDFArray"
    && typeof value.size === "function" && typeof value.get === "function"
    && typeof value.set === "function";
}

function containsPdfRef(value, visited = new Set()) {
  if (isPdfRef(value)) return true;
  if (!value || typeof value !== "object" || visited.has(value)) return false;
  visited.add(value);
  if (isPdfDict(value)) return value.entries().some(([, child]) => containsPdfRef(child, visited));
  if (isPdfArray(value)) {
    for (let i = 0; i < value.size(); i++) {
      if (containsPdfRef(value.get(i), visited)) return true;
    }
  }
  return false;
}

function stablePdfValue(value) {
  if (isPdfRef(value)) return "ref:" + value.toString();
  if (isPdfDict(value)) {
    const entries = value.entries()
      .map(([key, child]) => [key.toString(), stablePdfValue(child)])
      .sort((a, b) => a[0].localeCompare(b[0]));
    return "dict:" + JSON.stringify(entries);
  }
  if (isPdfArray(value)) {
    const values = [];
    for (let i = 0; i < value.size(); i++) values.push(stablePdfValue(value.get(i)));
    return "array:" + JSON.stringify(values);
  }
  return (value && value.constructor && value.constructor.name || typeof value)
    + ":" + String(value);
}

function dictValue(dict, keyName) {
  const found = dict.entries().find(([key]) => key.toString() === keyName);
  return found ? found[1] : null;
}

function isPdfImageStream(value) {
  if (!value || typeof value.getContents !== "function" || !isPdfDict(value.dict)) return false;
  const subtype = dictValue(value.dict, "/Subtype");
  return !!subtype && subtype.toString() === "/Image";
}

function imageStreamSignature(stream) {
  const pairs = [];
  for (const [key, value] of stream.dict.entries()) {
    const name = key.toString();
    if (name === "/Length") continue;
    if (name === "/SMask" && isPdfRef(value)) {
      pairs.push([name, "ref:" + value.toString()]);
      continue;
    }
    // Do not merge images whose rendering depends on another unverified object.
    if (containsPdfRef(value)) return null;
    pairs.push([name, stablePdfValue(value)]);
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const digest = createHash("sha256").update(stream.getContents()).digest("hex");
  return (stream.constructor && stream.constructor.name || "PDFStream")
    + "|" + JSON.stringify(pairs) + "|" + digest;
}

function replacePdfRefs(value, replacements, visited) {
  if (isPdfRef(value)) return replacements.get(value.toString()) || value;
  if (!value || typeof value !== "object" || visited.has(value)) return value;
  visited.add(value);
  if (isPdfDict(value)) {
    for (const [key, child] of value.entries()) {
      const next = replacePdfRefs(child, replacements, visited);
      if (next !== child) value.set(key, next);
    }
  } else if (isPdfArray(value)) {
    for (let i = 0; i < value.size(); i++) {
      const child = value.get(i);
      const next = replacePdfRefs(child, replacements, visited);
      if (next !== child) value.set(i, next);
    }
  } else if (value.dict && isPdfDict(value.dict) && typeof value.getContents === "function") {
    replacePdfRefs(value.dict, replacements, visited);
  }
  return value;
}

// Lossless: consolidate only byte-identical PDF image streams with matching
// decoding parameters. Alpha masks are consolidated first so their parent
// images can safely share the same mask reference. No image is resampled.
function deduplicateIdenticalImageStreams(pdf) {
  const context = pdf && pdf.context;
  const stats = {
    image_streams_examined: 0,
    duplicate_image_streams_removed: 0,
    image_stream_bytes_saved: 0,
  };
  if (!context || typeof context.enumerateIndirectObjects !== "function"
      || typeof context.delete !== "function") return stats;

  for (const hasSoftMask of [false, true]) {
    const seen = new Map();
    const replacements = new Map();
    const duplicates = [];
    const entries = context.enumerateIndirectObjects();

    for (const [ref, object] of entries) {
      if (!isPdfImageStream(object)) continue;
      const mask = dictValue(object.dict, "/SMask");
      const hasMask = !!mask && mask.toString() !== "null" && mask.toString() !== "/None";
      if (hasMask !== hasSoftMask) continue;
      stats.image_streams_examined++;
      let signature;
      let byteLength = 0;
      try {
        signature = imageStreamSignature(object);
        byteLength = object.getContents().length;
      } catch (_) {
        continue;
      }
      if (!signature) continue;
      const canonicalRef = seen.get(signature);
      if (canonicalRef) {
        replacements.set(ref.toString(), canonicalRef);
        duplicates.push({ ref, byteLength });
      } else {
        seen.set(signature, ref);
      }
    }

    if (!replacements.size) continue;
    for (const [, object] of context.enumerateIndirectObjects()) {
      replacePdfRefs(object, replacements, new Set());
    }
    for (const duplicate of duplicates) {
      context.delete(duplicate.ref);
      stats.duplicate_image_streams_removed++;
      stats.image_stream_bytes_saved += duplicate.byteLength;
    }
  }
  return stats;
}

async function callEdge(action, token, apikey, payload) {
  const response = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Authorization": "Bearer " + token,
      "apikey": apikey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, action }),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok || !data.ok) {
    const error = new Error(data.error || ("Vérification Supabase HTTP " + response.status));
    error.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Méthode non autorisée." });
  }
  try {
    const authorization = String(req.headers.authorization || "");
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const apikey = String(req.headers.apikey || "").trim();
    if (!token || !apikey) return sendJson(res, 401, { ok: false, error: "Session ou clé publique Supabase manquante." });

    const body = parseBody(req);
    if (!Array.isArray(body.page_urls) || body.page_urls.length < 1) {
      return sendJson(res, 400, { ok: false, error: "La liste des URL de pages PDF est vide." });
    }
    if (body.page_urls.length > MAX_FRAGMENTS) {
      return sendJson(res, 400, { ok: false, error: "Trop de fragments PDF (maximum " + MAX_FRAGMENTS + ")." });
    }

    body.page_urls.forEach(signedSourcePath);
    const courseContext = {
      course_id: String(body.course_id || "").trim(),
      course_title: String(body.course_title || "").trim().slice(0, 180),
      theme_color: String(body.theme_color || "").trim(),
      course_fingerprint: String(body.course_fingerprint || "").trim().slice(0, 240),
    };
    // Compatibilité avec les clients déjà ouverts : l’Edge Function tente
    // d’identifier le cours à partir des métadonnées des fragments si course_id
    // manque. Les versions récentes transmettent toujours cet identifiant.
    const prepared = await callEdge("prepare_upload", token, apikey, { page_urls: body.page_urls, ...courseContext });
    if (!Array.isArray(prepared.paths) || !prepared.paths.length
      || !Array.isArray(prepared.source_urls)
      || prepared.source_urls.length !== prepared.paths.length
      || !prepared.upload_url || !prepared.pdf_path) {
      throw new Error("Supabase n’a pas fourni les autorisations de dépôt et les liens source attendus.");
    }
    const orderedUrls = prepared.source_urls.map((rawUrl, index) => {
      const url = String(rawUrl || "");
      const path = signedSourcePath(url);
      if (path !== prepared.paths[index]) {
        throw new Error("L’ordre des URL source signées ne correspond pas aux fragments validés.");
      }
      return url;
    });

    const merged = await PDFDocument.create();
    let fragmentBytes = 0;
    let pageCount = 0;
    for (let i = 0; i < orderedUrls.length; i++) {
      const label = (i + 1) + "/" + orderedUrls.length;
      const bytes = await readPdf(orderedUrls[i], label, fragmentBytes);
      fragmentBytes += bytes.byteLength;
      const source = await PDFDocument.load(bytes);
      const pageIndices = source.getPageIndices();
      if (!pageIndices.length) throw new Error("Le fragment " + label + " ne contient aucune page.");
      const copied = await merged.copyPages(source, pageIndices);
      copied.forEach(page => merged.addPage(page));
      pageCount += copied.length;
    }

    const losslessOptimization = deduplicateIdenticalImageStreams(merged);
    const finalBytes = new Uint8Array(await merged.save({ useObjectStreams: true }));
    if (finalBytes.length < 5 || Buffer.from(finalBytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
      throw new Error("Le PDF final obtenu n’est pas valide.");
    }
    if (finalBytes.byteLength > MAX_FINAL_BYTES) {
      return sendJson(res, 413, {
        ok: false,
        error: "Après déduplication exacte sans perte, le PDF final fait " + (finalBytes.byteLength / 1048576).toFixed(2) + " Mio et dépasse la cible de 47 Mio. Les fragments restent intacts ; aucune compression avec perte ni baisse de résolution n’a été appliquée.",
        bytes: finalBytes.byteLength,
        size_mib: Number((finalBytes.byteLength / 1048576).toFixed(2)),
        page_count: pageCount,
        fragment_bytes: fragmentBytes,
        lossless_optimization: losslessOptimization,
      });
    }

    const uploadResponse = await fetch(prepared.upload_url, {
      method: "PUT",
      signal: AbortSignal.timeout(90000),
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "max-age=3600",
        "x-upsert": "true",
      },
      body: finalBytes,
    });
    if (!uploadResponse.ok) {
      const detail = (await uploadResponse.text()).slice(0, 500);
      throw new Error("Dépôt serveur du PDF final impossible (HTTP " + uploadResponse.status + ")" + (detail ? " : " + detail : "."));
    }

    const completed = await callEdge("complete_upload", token, apikey, {
      page_urls: body.page_urls,
      pdf_path: prepared.pdf_path,
      bytes: finalBytes.byteLength,
      page_count: pageCount,
      fragment_bytes: fragmentBytes,
      ...courseContext,
    });
    return sendJson(res, 200, {
      ...completed,
      lossless_optimization: {
        ...losslessOptimization,
        final_bytes: finalBytes.byteLength,
        final_size_mib: Number((finalBytes.byteLength / 1048576).toFixed(2)),
        fragment_bytes: fragmentBytes,
        quality_changed: false,
      },
    });
  } catch (error) {
    const status = Number(error && error.statusCode);
    return sendJson(res, status >= 400 && status < 600 ? status : 500, {
      ok: false,
      error: String(error && error.message || error || "Erreur inconnue pendant la fusion").slice(0, 900),
    });
  }
};
