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
          body: JSON.stringify({
            page_urls: body.page_urls,
            course_id: body.course_id,
            course_title: body.course_title,
            theme_color: body.theme_color,
            course_fingerprint: body.course_fingerprint,
          }),
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
      .select("id,created_by,job_id,title,document_type,metadata")
      .in("id", documentIds);
    if (documentsError) throw new Error("Vérification des documents source impossible : " + documentsError.message);
    const ownedIds = new Set((documents || [])
      .filter((doc: any) => String(doc.created_by || "") === userId)
      .map((doc: any) => Number(doc.id)));
    if (documentIds.some((id) => !ownedIds.has(id))) {
      return json({ ok: false, error: "Un fragment source est introuvable ou ne t’appartient pas." }, 403);
    }

    // Chaque fragment de l’éditeur reste dans Supabase pour pouvoir être régénéré.
    // La fusion, en revanche, est rattachée au cours complet et produit un seul
    // document de contrôle humain dans Content Factory.
    const sourceCourseIds = [...new Set((documents || []).map((doc: any) => {
      const metadata = doc?.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
      const candidate = metadata.assisted_page?.course_id
        || metadata.assisted_system_page?.course_id
        || metadata.assisted_sheet?.course_id
        || metadata.assisted_course_id
        || metadata.course_id
        || metadata.source_course_id;
      return String(candidate || "").trim();
    }).filter(Boolean))];
    const courseId = String(body?.course_id || (sourceCourseIds.length === 1 ? sourceCourseIds[0] : "")).trim();
    if (!courseId) {
      return json({ ok: false, error: "Impossible d’identifier le cours associé à la fusion. Recharge l’édition assistée puis relance la fusion du PDF global." }, 400);
    }
    if (sourceCourseIds.some((sourceId) => sourceId !== courseId)) {
      return json({ ok: false, error: "Les fragments transmis appartiennent à plusieurs cours. Aucun PDF global n’a été enregistré." }, 400);
    }
    const { data: courseRow, error: courseError } = await admin
      .from("aurora_assisted_courses")
      .select("id,created_by,title,pages,editor_version,updated_at")
      .eq("id", courseId)
      .eq("created_by", userId)
      .maybeSingle();
    if (courseError) throw new Error("Vérification du cours d’édition impossible : " + courseError.message);
    if (!courseRow) return json({ ok: false, error: "Cours d’édition introuvable ou accès refusé." }, 403);

    const coursePayload = courseRow.pages && typeof courseRow.pages === "object"
      ? (courseRow.pages.course && typeof courseRow.pages.course === "object" ? courseRow.pages.course : courseRow.pages)
      : {};
    const courseTitle = String(coursePayload.title || courseRow.title || body?.course_title || "Cours").trim().slice(0, 180) || "Cours";
    const requestedTheme = String(body?.theme_color || coursePayload.theme_color || "#6D28D9").trim().toUpperCase();
    const themeColor = /^#[0-9A-F]{6}$/.test(requestedTheme) ? requestedTheme : "#6D28D9";
    const courseFingerprint = String(body?.course_fingerprint || "").trim().slice(0, 240);

    // Le chemin dépend du cours, des fragments et de l’empreinte du contenu.
    // Une régénération ne peut donc pas écraser silencieusement le PDF d’une version antérieure.
    const seed = userId + "\n" + courseId + "\n" + courseFingerprint + "\n" + paths.join("\n");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    const fingerprint = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
    const finalPath = "aurora-assisted-final-pdfs/" + userId + "/" + fingerprint + ".pdf";

    if (action === "prepare_upload") {
      // Re-sign the source pages for two hours so a long course generation
      // does not fail merely because an earlier preview URL expired.
      const sourceUrls: string[] = [];
      for (let offset = 0; offset < paths.length; offset += 50) {
        const batchPaths = paths.slice(offset, offset + 50);
        const { data: signedBatch, error: sourceSignError } = await admin.storage
          .from("Pdfs")
          .createSignedUrls(batchPaths, 2 * 60 * 60);
        if (sourceSignError || !signedBatch || signedBatch.length !== batchPaths.length) {
          throw new Error("Création des liens temporaires des fragments impossible : " + (sourceSignError?.message || "réponse incomplète"));
        }
        for (let i = 0; i < signedBatch.length; i++) {
          const item = signedBatch[i] as any;
          if (item.error || !item.signedUrl) {
            throw new Error("Impossible de signer le fragment " + (offset + i + 1) + " : " + String(item.error || "URL absente"));
          }
          const sourceUrl = new URL(item.signedUrl, SUPA_URL);
          if (sourceUrl.origin !== new URL(SUPA_URL).origin
            || !sourceUrl.pathname.startsWith("/storage/v1/object/sign/Pdfs/")) {
            throw new Error("Supabase a fourni un lien source non autorisé.");
          }
          sourceUrls.push(sourceUrl.toString());
        }
      }

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
        source_urls: sourceUrls,
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

      const now = new Date().toISOString();
      const courseSummary = {
        course_id: courseId,
        course_title: courseTitle,
        fingerprint,
        course_fingerprint: courseFingerprint || null,
        pdf_path: finalPath,
        page_count: claimedPageCount,
        fragment_count: paths.length,
        fragment_bytes: Number(body?.fragment_bytes) || 0,
        bytes: storedSize,
        size_mib: Number((storedSize / 1048576).toFixed(3)),
        source_document_ids: documentIds,
        assembled_at: now,
        engine: "vercel-node-pdf-lib-merge-v1",
      };

      const existingQuery = await admin
        .from("aurora_generated_documents")
        .select("id,job_id,status,version,metadata,published_document_id")
        .eq("created_by", userId)
        .eq("document_type", "cours_assiste")
        .contains("metadata", { origin: "edition_assistee", assisted_final: { course_id: courseId } })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingQuery.error) throw new Error("Recherche du document global existant impossible : " + existingQuery.error.message);

      let generatedDocumentId: number;
      let jobId: number | null = null;
      let documentStatus = "review";
      let documentVersion = 1;

      if (existingQuery.data) {
        const existing = existingQuery.data;
        const existingMetadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
        const previousFinal = existingMetadata.assisted_final && typeof existingMetadata.assisted_final === "object"
          ? existingMetadata.assisted_final
          : {};
        const changedFinal = String(previousFinal.fingerprint || "") !== fingerprint
          || String(previousFinal.course_fingerprint || "") !== String(courseFingerprint || "");
        const oldStatus = String(existing.status || "review").toLowerCase();
        documentStatus = changedFinal ? "review" : oldStatus;
        documentVersion = Math.max(1, Number(existing.version) || 1) + (changedFinal ? 1 : 0);
        jobId = Number(existing.job_id) || null;
        generatedDocumentId = Number(existing.id);
        const finalMetadata = {
          ...existingMetadata,
          origin: "edition_assistee",
          pipeline: "Édition assistée → fusion PDF globale",
          assisted_pdf_status: "completed",
          assisted_final: courseSummary,
          human_validation_required: changedFinal || !["approved", "published"].includes(documentStatus),
          auto_publish: false,
        };
        const updated = await admin.from("aurora_generated_documents").update({
          title: courseTitle,
          document_type: "cours_assiste",
          source_format: "structured",
          pdf_path: finalPath,
          pdf_url: signed.signedUrl,
          pdf_diagnostic: { bytes: storedSize, page_count: claimedPageCount, fragments: paths.length, quality_changed: false },
          theme_color: themeColor,
          version: documentVersion,
          status: documentStatus,
          validation_notes: changedFinal
            ? "Le PDF global a été remplacé après une nouvelle fusion. Contrôle humain requis avant publication."
            : (existingMetadata.human_validation_required === true ? "PDF global fusionné et vérifié — contrôle humain requis." : undefined),
          metadata: finalMetadata,
          updated_at: now,
        }).eq("id", generatedDocumentId).eq("created_by", userId).select("id,job_id,status,version").single();
        if (updated.error || !updated.data) throw new Error("Mise à jour du document global impossible : " + (updated.error?.message || "document introuvable"));
        jobId = Number(updated.data.job_id) || jobId;
        documentStatus = String(updated.data.status || documentStatus);
      } else {
        const jobMetadata = {
          origin: "edition_assistee",
          assisted_final: true,
          course_id: courseId,
          final_pdf_fingerprint: fingerprint,
          final_pdf_path: finalPath,
          auto_publish: false,
          manual_validation_required: true,
        };
        const jobResult = await admin.from("aurora_content_jobs").insert({
          created_by: userId,
          status: "review",
          title: courseTitle,
          subject: coursePayload.subject || coursePayload.matiere || null,
          level: coursePayload.level || null,
          class_name: coursePayload.class_name || null,
          document_type: "cours_assiste",
          source_format: "structured",
          prompt: "Édition assistée — PDF global fusionné, contrôle humain requis.",
          instructions: {
            source: "edition_assistee",
            assisted_final: true,
            course_id: courseId,
            final_pdf_fingerprint: fingerprint,
            auto_publish: false,
            manual_validation_required: true,
          },
          source_document_ids: documentIds,
          metadata: jobMetadata,
          created_at: now,
          updated_at: now,
        }).select("id").single();
        if (jobResult.error || !jobResult.data) throw new Error("Création de la réception du PDF global impossible : " + (jobResult.error?.message || "job absent"));
        jobId = Number(jobResult.data.id);

        const finalMetadata = {
          origin: "edition_assistee",
          pipeline: "Édition assistée → fusion PDF globale",
          assisted_pdf_status: "completed",
          assisted_final: courseSummary,
          human_validation_required: true,
          auto_publish: false,
        };
        const inserted = await admin.from("aurora_generated_documents").insert({
          job_id: jobId,
          created_by: userId,
          title: courseTitle,
          subject: coursePayload.subject || null,
          level: coursePayload.level || null,
          class_name: coursePayload.class_name || null,
          document_type: "cours_assiste",
          source_format: "structured",
          source_content: null,
          content_json: {
            title: courseTitle,
            document_type: "cours_assiste",
            source_format: "structured",
            assisted_course_id: courseId,
            block_count: Array.isArray(coursePayload.blocks) ? coursePayload.blocks.length : null,
            final_pdf: courseSummary,
          },
          version: 1,
          status: "review",
          validation_notes: "PDF global fusionné et vérifié — contrôle humain requis avant publication.",
          metadata: finalMetadata,
          theme_color: themeColor,
          matiere: coursePayload.subject || coursePayload.matiere || null,
          pdf_path: finalPath,
          pdf_url: signed.signedUrl,
          pdf_diagnostic: { bytes: storedSize, page_count: claimedPageCount, fragments: paths.length, quality_changed: false },
          created_at: now,
          updated_at: now,
        }).select("id,status,version,job_id").single();
        if (inserted.error || !inserted.data) {
          await admin.from("aurora_content_jobs").update({
            status: "failed",
            error_message: "Le PDF global est enregistré, mais la fiche Content Factory n’a pas été créée : " + (inserted.error?.message || "document absent"),
            updated_at: now,
          }).eq("id", jobId).eq("created_by", userId);
          throw new Error("Création du document global Content Factory impossible : " + (inserted.error?.message || "document absent"));
        }
        generatedDocumentId = Number(inserted.data.id);
        documentStatus = String(inserted.data.status || "review");
        documentVersion = Number(inserted.data.version) || 1;
      }

      // Le job parent reste lié au document global. Le job et les documents de
      // chaque fragment sont conservés mais seront masqués de Content Factory.
      if (jobId) {
        const jobResult = await admin.from("aurora_content_jobs")
          .select("id,status,metadata")
          .eq("id", jobId)
          .eq("created_by", userId)
          .maybeSingle();
        if (jobResult.error) throw new Error("Vérification du job global impossible : " + jobResult.error.message);
        if (jobResult.data) {
          const jm = jobResult.data.metadata && typeof jobResult.data.metadata === "object" ? jobResult.data.metadata : {};
          const oldJobStatus = String(jobResult.data.status || "review").toLowerCase();
          const nextJobStatus = ["draft", "queued", "processing", "failed"].includes(oldJobStatus) ? "review" : oldJobStatus;
          const linked = await admin.from("aurora_content_jobs").update({
            generated_document_id: generatedDocumentId,
            status: nextJobStatus,
            metadata: {
              ...jm,
              origin: "edition_assistee",
              assisted_final: true,
              course_id: courseId,
              final_pdf_fingerprint: fingerprint,
              final_pdf_path: finalPath,
              generated_document_id: generatedDocumentId,
              auto_publish: false,
              manual_validation_required: documentStatus === "review",
            },
            updated_at: now,
          }).eq("id", jobId).eq("created_by", userId);
          if (linked.error) throw new Error("Lien entre le job et le PDF global impossible : " + linked.error.message);
        }
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
        generated_document_id: generatedDocumentId,
        job_id: jobId,
        status: documentStatus,
        version: documentVersion,
        title: courseTitle,
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
