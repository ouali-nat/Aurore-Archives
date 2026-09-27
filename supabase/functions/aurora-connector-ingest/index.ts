import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MAX_BODY_BYTES = 2500000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, x-aurore-gpt-key, x-request-id, x-idempotency-key, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return reply({ ok: false, error: "Méthode POST requise." }, 405);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return reply({ ok: false, error: "Payload éditorial trop volumineux." }, 413);
  }

  const rawKey = req.headers.get("x-aurore-gpt-key") || "";
  if (!rawKey) {
    return reply({ ok: false, error: "Clé éditoriale Aurore manquante." }, 401);
  }

  const keyHash = await sha256(rawKey);
  const { data: keyRow, error: keyError } = await db
    .from("aurora_gpt_ingest_keys")
    .select("id, active")
    .eq("key_hash", keyHash)
    .eq("active", true)
    .maybeSingle();

  if (keyError || !keyRow) {
    return reply({ ok: false, error: "Clé éditoriale Aurore invalide." }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return reply({ ok: false, error: "Payload JSON invalide." }, 400);
  }

  const encodedSize = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (encodedSize > MAX_BODY_BYTES) {
    return reply({ ok: false, error: "Payload éditorial trop volumineux." }, 413);
  }

  // Le bridge SQL de confiance porte volontairement le mode connector_mode.
  // Il vérifie la mémoire éditoriale courante puis appelle le RPC canonique.
  // Les gates scientifiques, volumétriques, structurelles, mathématiques,
  // l'idempotence et la revue humaine restent donc en aval.
  const requestId =
    (req.headers.get("x-idempotency-key") || req.headers.get("x-request-id") || "").trim();

  if (!String(payload.title || "").trim()) {
    return reply({ ok: false, error: "Le titre est obligatoire." }, 400);
  }
  if (
    !payload.content_json ||
    typeof payload.content_json !== "object" ||
    Array.isArray(payload.content_json)
  ) {
    return reply({ ok: false, error: "content_json doit être un objet JSON." }, 400);
  }

  let ingestId = String(payload.ingest_id || "").trim();
  if (!ingestId) {
    if (requestId) {
      ingestId = `connector-${requestId.slice(0, 100)}`;
    } else {
      const stableMaterial = JSON.stringify({
        title: payload.title,
        subject: payload.subject || payload.matiere || null,
        level: payload.level || payload.niveau || null,
        class_name: payload.class_name || payload.classe || null,
        document_type: payload.document_type || "cours",
        prompt: payload.prompt || null,
        content_json: payload.content_json,
      });
      ingestId = `connector-${(await sha256(stableMaterial)).slice(0, 48)}`;
    }
    payload.ingest_id = ingestId;
  }

  if (payload.connector_mode === undefined) {
    payload.connector_mode = true;
  }

  try {
    const { data, error } = await db.rpc(
      "aurora_connector_ingest_editorial_document",
      { p_payload: payload },
    );

    if (error) {
      return reply(
        {
          ok: false,
          error: error.message,
          connector_protocol: "aurora-connector-ingest-1",
        },
        422,
      );
    }

    await db
      .from("aurora_gpt_ingest_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyRow.id);

    return reply(
      {
        ok: true,
        connector_protocol: "aurora-connector-ingest-1",
        ingest_id: ingestId,
        result: Array.isArray(data) ? data[0] ?? data : data,
      },
      200,
    );
  } catch (error) {
    return reply(
      {
        ok: false,
        error: "Erreur interne du bridge d’ingestion Aurore.",
        detail: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
