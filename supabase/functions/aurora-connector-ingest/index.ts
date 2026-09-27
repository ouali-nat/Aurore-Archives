import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const TARGET_URL = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/aurora-gpt-ingest`;
const MAX_BODY_BYTES = 2500000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-aurore-gpt-key, authorization, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return reply({ ok: false, error: "Méthode POST requise." }, 405);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return reply({ ok: false, error: "Payload éditorial trop volumineux." }, 413);
  }

  // Le point canonique aurora-gpt-ingest reste l'unique propriétaire de :
  // authentification, mémoire éditoriale, préflight scientifique, contrats,
  // idempotence et insertion en base.
  const gptKey = req.headers.get("x-aurore-gpt-key") || "";
  if (!gptKey) {
    return reply({ ok: false, error: "Clé éditoriale Aurore manquante." }, 401);
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return reply({ ok: false, error: "Impossible de lire le payload éditorial." }, 400);
  }

  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return reply({ ok: false, error: "Payload éditorial trop volumineux." }, 413);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const headers = new Headers();
    headers.set("Content-Type", req.headers.get("content-type") || "application/json");
    headers.set("x-aurore-gpt-key", gptKey);

    const authorization = req.headers.get("authorization");
    if (authorization) headers.set("authorization", authorization);

    const requestId = req.headers.get("x-request-id");
    if (requestId) headers.set("x-request-id", requestId);

    const upstream = await fetch(TARGET_URL, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    const responseBody = await upstream.text();
    const responseHeaders = new Headers(CORS);
    responseHeaders.set(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json",
    );
    responseHeaders.set("X-Aurore-Connector-Forwarded", "true");

    return new Response(responseBody, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return reply({
      ok: false,
      error: "Le relais vers le point d'ingestion canonique a échoué.",
      detail: error instanceof Error ? error.message : String(error),
    }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
