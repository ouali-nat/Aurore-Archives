const { PDFDocument } = require("pdf-lib");

const SUPABASE_URL = "https://tdeotqfsbvouresfhkab.supabase.co";
const EDGE_FUNCTION_URL = SUPABASE_URL + "/functions/v1/aurora-assisted-pdf-finalize";
const MAX_FRAGMENTS = 200;
const MAX_SOURCE_BYTES = 180 * 1024 * 1024;
const MAX_FINAL_BYTES = 60 * 1024 * 1024;

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

    const pathsFromRequest = body.page_urls.map(signedSourcePath);
    const prepared = await callEdge("prepare_upload", token, apikey, { page_urls: body.page_urls });
    if (!Array.isArray(prepared.paths) || !prepared.paths.length || !prepared.upload_url || !prepared.pdf_path) {
      throw new Error("Supabase n’a pas fourni les autorisations de dépôt attendues.");
    }
    const urlByPath = new Map();
    body.page_urls.forEach((url, index) => {
      if (!urlByPath.has(pathsFromRequest[index])) urlByPath.set(pathsFromRequest[index], url);
    });
    const orderedUrls = prepared.paths.map(path => urlByPath.get(path)).filter(Boolean);
    if (orderedUrls.length !== prepared.paths.length) {
      throw new Error("La liste des fragments validés ne correspond pas aux URL reçues.");
    }

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

    const finalBytes = new Uint8Array(await merged.save({ useObjectStreams: true }));
    if (finalBytes.length < 5 || Buffer.from(finalBytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
      throw new Error("Le PDF final obtenu n’est pas valide.");
    }
    if (finalBytes.byteLength > MAX_FINAL_BYTES) {
      return sendJson(res, 413, {
        ok: false,
        error: "Le PDF final dépasse 60 Mio. Les fragments restent disponibles ; aucun téléchargement des pages n’a été lancé sur le téléphone.",
        bytes: finalBytes.byteLength,
      });
    }

    const uploadResponse = await fetch(prepared.upload_url, {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "3600",
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
    });
    return sendJson(res, 200, completed);
  } catch (error) {
    const status = Number(error && error.statusCode);
    return sendJson(res, status >= 400 && status < 600 ? status : 500, {
      ok: false,
      error: String(error && error.message || error || "Erreur inconnue pendant la fusion").slice(0, 900),
    });
  }
};
