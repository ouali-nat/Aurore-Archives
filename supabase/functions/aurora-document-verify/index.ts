import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SITE_URL = "https://aurore-section-archivescom.vercel.app/";

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
    },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function pathLabel(doc: Record<string, unknown>) {
  const parts = ["Niveau", "Classe", "Matière", "Catégorie"]
    .map((key) => clean(doc[key]))
    .filter(Boolean);
  return parts.length ? parts : ["Bibliothèque", "Archives"];
}

async function restGet(table: string, query: string) {
  const base = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !secret) throw new Error("Configuration serveur incomplète.");
  const response = await fetch(base + "/rest/v1/" + table + "?" + query, {
    headers: {
      apikey: secret,
      Authorization: "Bearer " + secret,
    },
  });
  if (!response.ok) throw new Error("Supabase HTTP " + response.status);
  return await response.json();
}

async function verifyPdf(pdfUrl: string) {
  if (!pdfUrl) return { valid: false, reason: "pdf_missing" };
  let head: Response;
  try {
    head = await fetch(pdfUrl, { method: "HEAD" });
  } catch {
    return { valid: false, reason: "pdf_unreachable" };
  }
  if (!head.ok) return { valid: false, reason: "pdf_http" };
  const contentType = clean(head.headers.get("content-type")).toLowerCase();
  const contentLength = Number(head.headers.get("content-length") || 0);
  if (contentLength === 0 && contentType && !contentType.includes("pdf")) {
    return { valid: false, reason: "pdf_metadata" };
  }

  try {
    const sample = await fetch(pdfUrl, { headers: { Range: "bytes=0-4" } });
    if (!sample.ok) return { valid: false, reason: "pdf_sample_http" };
    const reader = sample.body?.getReader();
    if (!reader) return { valid: false, reason: "pdf_sample_unreadable" };
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < 5) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parts.push(chunk.value);
        total += chunk.value.byteLength;
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
    const merged = new Uint8Array(Math.min(total, 5));
    let offset = 0;
    for (const part of parts) {
      const take = Math.min(part.byteLength, 5 - offset);
      merged.set(part.slice(0, take), offset);
      offset += take;
      if (offset >= 5) break;
    }
    const magic = new TextDecoder().decode(merged);
    if (magic !== "%PDF-") return { valid: false, reason: "pdf_signature" };
  } catch {
    return { valid: false, reason: "pdf_sample_unreadable" };
  }
  return { valid: true, reason: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "GET") return json({ ok: false, error: "Méthode non autorisée." }, 405);

  try {
    const requestUrl = new URL(req.url);
    const rawId = requestUrl.searchParams.get("id") || "";
    if (!/^\d+$/.test(rawId)) {
      return json({ ok: false, status: "invalid", message: "Référence de document invalide." }, 400);
    }
    const id = Number(rawId);

    const generatedRows = await restGet(
      "aurora_generated_documents",
      "id=eq." + id + "&select=id,title,version,status,published_document_id,pdf_url"
    );
    const generated = Array.isArray(generatedRows) ? generatedRows[0] : null;

    const unavailable = () => json({
      ok: false,
      status: "not_found",
      message: "Document introuvable ou non disponible.",
    }, 404);

    if (!generated) return unavailable();

    const publishedId = generated.published_document_id;
    if (generated.status !== "published" || !publishedId) return unavailable();

    const publicRows = await restGet(
      "Document",
      "id=eq." + publishedId + "&select=id,%22Titre%22,%22Niveau%22,%22Classe%22,%22Matière%22,%22Catégorie%22,%22Fichier_url%22,%22Publie%22"
    );
    const document = Array.isArray(publicRows) ? publicRows[0] : null;

    if (!document || document.Publie !== true || !clean(document.Fichier_url)) {
      return unavailable();
    }

    const pdf = await verifyPdf(clean(document.Fichier_url));
    if (!pdf.valid) {
      return json({
        ok: false,
        status: "corrupt",
        message: "Document corrompu",
        document: { id: document.id, title: document.Titre, version: generated.version },
        reason: pdf.reason,
      }, 409);
    }

    const publicUrl = SITE_URL + "?document=" + document.id;
    return json({
      ok: true,
      status: "published",
      message: "Document publié et vérifié",
      document: {
        id: document.id,
        title: document.Titre,
        level: document.Niveau,
        class_name: document.Classe,
        subject: document.Matière,
        category: document.Catégorie,
        version: generated.version,
      },
      publication: { url: publicUrl, path: pathLabel(document) },
      pdf: { valid: true },
    });
  } catch (error) {
    console.error("aurora-document-verify:", error);
    return json({ ok: false, status: "error", message: "Vérification temporairement indisponible." }, 503);
  }
});