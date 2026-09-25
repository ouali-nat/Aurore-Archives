import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS_RAW = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
let SECRET_KEY = "";
try {
  SECRET_KEY = String(JSON.parse(SECRET_KEYS_RAW || "{}")?.default || "").trim();
} catch (_) {
  SECRET_KEY = "";
}
const LEGACY_SR = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const SR = SECRET_KEY || LEGACY_SR;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";

const db = createClient(URL, SR, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (x: unknown, s = 200) =>
  new Response(JSON.stringify(x), {
    status: s,
    headers: { ...H, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  if (req.method !== "POST") return out({ error: "Méthode non autorisée" }, 405);

  const a = req.headers.get("Authorization");
  if (!a?.startsWith("Bearer ")) return out({ error: "Authentification requise" }, 401);

  const internal = !!SR && a === `Bearer ${SR}`;
  let userId: string | null = null;

  if (!internal) {
    if (!ANON) return out({ error: "Configuration d'authentification incomplète" }, 503);
    const u = createClient(URL, ANON, {
      global: { headers: { Authorization: a } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const me = await u.auth.getUser();
    if (me.error || !me.data.user) return out({ error: "Session invalide" }, 401);
    userId = me.data.user.id;
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {}

  const requestedId = Number(body?.job_id || 0);
  if (requestedId && (!Number.isSafeInteger(requestedId) || requestedId < 1)) {
    return out({ error: "job_id invalide" }, 400);
  }

  let q = db
    .from("aurora_content_jobs")
    .select("id,status,title,generated_document_id,error_message,updated_at,created_by")
    .limit(1);

  if (requestedId) {
    q = q.eq("id", requestedId);
  } else {
    q = q
      .in("status", ["queued", "processing", "review"])
      .order("created_at", { ascending: true });
  }

  const { data: job, error } = await q.maybeSingle();
  if (error) return out({ error: error.message }, 500);
  if (!job) {
    return out({
      ok: true,
      processed: false,
      status: "idle",
      editorial_required: true,
      message: "Aucune demande de contenu trouvée.",
    });
  }

  if (!internal && userId && job.created_by && job.created_by !== userId) {
    return out({ error: "Job introuvable ou non autorisé" }, 404);
  }

  if (job.generated_document_id) {
    return out({
      ok: true,
      processed: false,
      ready_for_pdf: true,
      editorial_required: false,
      job_id: job.id,
      generated_document_id: job.generated_document_id,
      status: job.status,
      message: "Le contenu éditorial est déjà intégré. Aucun moteur de génération de contenu n'est appelé.",
    });
  }

  return out({
    ok: true,
    processed: false,
    ready_for_pdf: false,
    editorial_required: true,
    job_id: job.id,
    status: job.status,
    message:
      "Contenu éditorial non intégré. Aucun moteur IA de génération de contenu n'est appelé. " +
      "Le document doit d'abord être fourni via le circuit d'ingestion éditoriale Aurore.",
  });
});
