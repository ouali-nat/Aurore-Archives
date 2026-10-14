import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPA_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function safePdfPath(raw: unknown, userId: string): string {
  const path = String(raw ?? "").replace(/^\/+/, "");
  if (!path || path.includes("..") || path.includes("\\") || path.length > 600) {
    throw new Error("Chemin de fragment PDF invalide.");
  }
  const parts = path.split("/");
  if (parts.length !== 4 || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Le chemin du fragment PDF n’a pas le format attendu.");
  }
  const [root, ownerId, documentId, filename] = parts;
  if (ownerId !== userId || !/^\d{1,18}$/.test(documentId) || !Number.isSafeInteger(Number(documentId))) {
    throw new Error("Le fragment PDF ne correspond pas à la session connectée.");
  }
  if (!["aurora-content-pages", "aurora-assisted-system-pages", "aurora-assisted-sheet-pages"].includes(root)) {
    throw new Error("Type de fragment PDF non autorisé.");
  }
  if (root === "aurora-content-pages" && !/^page-\d{4}\.pdf$/i.test(filename)) {
    throw new Error("Nom de page PDF non autorisé.");
  }
  if (root === "aurora-assisted-system-pages" && !/^(cover|toc|end)\.pdf$/i.test(filename)) {
    throw new Error("Page système non autorisée.");
  }
  if (root === "aurora-assisted-sheet-pages" && !/^[a-z0-9_-]{1,80}\.pdf$/i.test(filename)) {
    throw new Error("Page de fiche non autorisée.");
  }
  return path;
}

function storagePathFromSignedUrl(raw: unknown): string {
  let parsed: URL;
  try {
    parsed = new URL(String(raw ?? ""));
  } catch {
    throw new Error("Une page n’a pas d’URL PDF valide.");
  }
  const expectedOrigin = new URL(SUPA_URL).origin;
  const prefix = "/storage/v1/object/sign/Pdfs/";
  if (parsed.origin !== expectedOrigin || !parsed.pathname.startsWith(prefix)) {
    throw new Error("URL de fragment PDF externe ou non autorisée.");
  }
  let path = "";
  try {
    path = decodeURIComponent(parsed.pathname.slice(prefix.length));
  } catch {
    throw new Error("URL de fragment PDF mal encodée.");
  }
  return path;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée." }, 405);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ ok: false, error: "Authentification requise." }, 401);

  try {
    const userClient = createClient(SUPA_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ ok: false, error: "Session invalide." }, 401);
    const userId = authData.user.id;

    const { data: profile, error: profileError } = await admin
      .from("Profils")
      .select("banni")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile || profile.banni === true) {
      return json({ ok: false, error: "Compte suspendu ou profil non autorisé." }, 403);
    }

    let body: any;
    try { body = await req.json(); } catch { return json({ ok: false, error: "JSON invalide." }, 400); }
    const action = String(body?.action || "merge");
    if (!["merge", "prepare_upload", "complete_upload"].includes(action)) {
      return json({ ok: false, error: "Action de fusion inconnue." }, 400);
    }
    if (!Array.isArray(body?.page_urls) || body.page_urls.length < 1) {
      return json({ ok: false, error: "La liste des URL de pages PDF est vide." }, 400);
    }
    if (body.page_urls.length > 200) return json({ ok: false, error: "Trop de fragments PDF (maximum 200)." }, 400);

    // Compatibilité avec les anciennes versions de l’éditeur encore en cache :
    // toute requête legacy de fusion est transférée à Vercel, jamais exécutée
    // dans le worker Edge limité en mémoire.
    if (action === "merge") {
      try {
        const response = await fetch("https://aurore-section-archives.com/api/aurora-assisted-pdf-finalize", {
          method: "POST",
          headers: {
            "Authorization": authorization,
            "apikey": req.headers.get("apikey") || ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ page_urls: body.page_urls }),
        });
        const responseBody = await response.text();
        return new Response(responseBody, {
          status: response.status,
          headers: {
            ...CORS,
            "Content-Type": response.headers.get("Content-Type") || "application/json",
            "Cache-Control": "no-store",
          },
        });
      } catch (proxyError) {
        console.error("Legacy merge proxy to Vercel failed:", proxyError);
        return json({ ok: false, error: "Le service de fusion serveur est momentanément indisponible. Les fragments restent disponibles ; ne relance pas leur génération." }, 502);
      }
    }

    const paths: string[] = [];
    const seen = new Set<string>();
    for (const input of body.page_urls) {
      const fromUrl = storagePathFromSignedUrl(input);
      const path = safePdfPath(fromUrl, userId);
      if (!seen.has(path)) { seen.add(path); paths.push(path); }
    }
    if (!paths.length) return json({ ok: false, error: "Aucun fragment PDF utilisable." }, 400);

    const documentIds = [...new Set(paths.map((path) => Number(path.split("/")[2])))];
    const { data: documents, error: documentsError } = await admin
      .from("aurora_generated_documents")
      .select("id,created_by")
      .in("id", documentIds);
    if (documentsError) throw new Error("Vérification des documents source impossible : " + documentsError.message);
    const ownedIds = new Set((documents || [])
      .filter((doc: any) => String(doc.created_by || "") === userId)
      .map((doc: any) => Number(doc.id)));
    if (documentIds.some((id) => !ownedIds.has(id))) {
      return json({ ok: false, error: "Un fragment source est introuvable ou ne t’appartient pas." }, 403);
    }

    const seed = userId + "\n" + paths.join("\n");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    const fingerprint = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
    const finalPath = "aurora-assisted-final-pdfs/" + userId + "/" + fingerprint + ".pdf";

    if (action === "prepare_upload") {
      const { data: upload, error: uploadError } = await admin.storage
        .from("Pdfs")
        .createSignedUploadUrl(finalPath, { upsert: true });
      if (uploadError || !upload?.signedUrl) {
        throw new Error("Création du lien de dépôt serveur impossible : " + (uploadError?.message || "URL absente"));
      }
      const uploadUrl = new URL(upload.signedUrl, SUPA_URL);
      const expectedOrigin = new URL(SUPA_URL).origin;
      if (uploadUrl.origin !== expectedOrigin) {
        throw new Error("Le stockage a renvoyé un lien de dépôt externe non autorisé.");
      }
      if (uploadUrl.pathname.startsWith("/object/upload/sign/")) {
        uploadUrl.pathname = "/storage/v1" + uploadUrl.pathname;
      }
      if (!uploadUrl.pathname.startsWith("/storage/v1/object/upload/sign/Pdfs/aurora-assisted-final-pdfs/")) {
        throw new Error("Le lien de dépôt ne cible pas le dossier final autorisé.");
      }
      return json({
        ok: true,
        action,
        upload_url: uploadUrl.toString(),
        pdf_path: finalPath,
        fingerprint,
        paths,
        fragments: paths.length,
      });
    }

    if (action === "complete_upload") {
      if (String(body?.pdf_path || "") !== finalPath) {
        return json({ ok: false, error: "Le chemin du PDF final ne correspond pas aux fragments vérifiés." }, 403);
      }
      const claimedPageCount = Number(body?.page_count) || 0;
      if (!Number.isInteger(claimedPageCount) || claimedPageCount < 1) {
        return json({ ok: false, error: "Le nombre de pages du PDF final est invalide." }, 400);
      }
      const filename = fingerprint + ".pdf";
      const { data: storedFiles, error: listError } = await admin.storage
        .from("Pdfs")
        .list("aurora-assisted-final-pdfs/" + userId, { limit: 100, search: filename });
      if (listError) throw new Error("Vérification du PDF déposé impossible : " + listError.message);
      const stored = (storedFiles || []).find((item: any) => item.name === filename);
      if (!stored) return json({ ok: false, error: "Le serveur n’a pas confirmé l’enregistrement du PDF final." }, 409);
      const storedSize = Number(stored.metadata?.size) || Number(body?.bytes) || 0;
      if (storedSize < 5 || storedSize > 60 * 1024 * 1024) {
        return json({ ok: false, error: "La taille du PDF final enregistré est invalide.", bytes: storedSize }, 413);
      }
      const { data: signed, error: signedError } = await admin.storage
        .from("Pdfs")
        .createSignedUrl(finalPath, 60 * 60 * 24 * 30);
      if (signedError || !signed?.signedUrl) {
        throw new Error("Création du lien PDF final impossible : " + (signedError?.message || "URL absente"));
      }
      return json({
        ok: true,
        pdf_url: signed.signedUrl,
        pdf_path: finalPath,
        bytes: storedSize,
        size_mib: Number((storedSize / 1048576).toFixed(3)),
        page_count: claimedPageCount,
        fragments: paths.length,
        fragment_bytes: Number(body?.fragment_bytes) || 0,
        engine: "vercel-node-pdf-lib-merge-v1",
      });
    }

    const merged = await PDFDocument.create();
    let fragmentBytes = 0;
    let pageCount = 0;
    

    for (let index = 0; index < paths.length; index++) {
      const path = paths[index];
      const { data, error } = await admin.storage.from("Pdfs").download(path);
      if (error || !data) throw new Error("Page " + (index + 1) + " introuvable : " + (error?.message || "fichier absent"));
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
        throw new Error("Le fragment " + (index + 1) + " n’est pas un PDF valide.");
      }
      fragmentBytes += bytes.length;
      const source = await PDFDocument.load(bytes);
      const indices = source.getPageIndices();
      if (!indices.length) throw new Error("Le fragment " + (index + 1) + " ne contient aucune page.");
      const copied = await merged.copyPages(source, indices);
      copied.forEach((page) => merged.addPage(page));
      pageCount += copied.length;

    }

    const finalBytes = new Uint8Array(await merged.save({ useObjectStreams: true }));
    if (finalBytes.length < 5 || new TextDecoder().decode(finalBytes.slice(0, 5)) !== "%PDF-") {
      throw new Error("Le PDF final n’est pas valide.");
    }
    if (finalBytes.length > 60 * 1024 * 1024) {
      return json({ ok: false, error: "PDF final supérieur à 60 Mo : le document reste disponible par fragments.", bytes: finalBytes.length }, 413);
    }

    const { error: uploadError } = await admin.storage.from("Pdfs").upload(finalPath, finalBytes, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw new Error("Enregistrement du PDF final impossible : " + uploadError.message);
    const { data: signed, error: signedError } = await admin.storage.from("Pdfs").createSignedUrl(finalPath, 60 * 60 * 24 * 30);
    if (signedError || !signed?.signedUrl) throw new Error("Création du lien PDF final impossible : " + (signedError?.message || "URL absente"));

    return json({
      ok: true,
      pdf_url: signed.signedUrl,
      pdf_path: finalPath,
      bytes: finalBytes.length,
      size_mib: Number((finalBytes.length / 1048576).toFixed(3)),
      page_count: pageCount,
      fragments: paths.length,
      fragment_bytes: fragmentBytes,
      engine: "server-side-pdf-lib-merge-v1",
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
