#!/usr/bin/env python3
"""Safely compress the stored PDF fragments for the one explicitly scoped course."""
# Reprocess the existing course from its verified source backups with the visual-fidelity profile.
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

SUPABASE_URL = "https://tdeotqfsbvouresfhkab.supabase.co"
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/aurora-assisted-pdf-optimize"
COURSE_ID = "bc62da2b-5ed8-4e7b-80e9-982a5d79425c"
COURSE_TITLE = "Probabilités demo"
TOKEN = os.environ.get("AURORA_LUALATEX_RENDER_TOKEN", "").strip()


def post(url: str, body: bytes, headers: dict[str, str], timeout: int = 180) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def parse_page_count(path: Path) -> int:
    result = subprocess.run(
        ["pdfinfo", str(path)],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=20,
    )
    match = re.search(r"(?m)^Pages:\s+(\d+)\s*$", result.stdout)
    if not match:
        raise RuntimeError("pdfinfo n'a pas fourni le nombre de pages")
    return int(match.group(1))


def main() -> int:
    if not TOKEN:
        raise SystemExit("Secret GitHub AURORA_LUALATEX_RENDER_TOKEN absent.")
    auth_headers = {
        "x-aurore-render-token": TOKEN,
        "content-type": "application/json",
    }
    status, raw = post(
        FUNCTION_URL + "?action=plan",
        json.dumps({"course_id": COURSE_ID, "expected_title": COURSE_TITLE}).encode(),
        auth_headers,
    )
    try:
        plan = json.loads(raw)
    except Exception as exc:
        raise SystemExit(f"Le serveur n'a pas renvoyé un plan JSON valide (HTTP {status}).") from exc
    if status != 200 or plan.get("ok") is not True:
        raise SystemExit(f"Plan de compression refusé (HTTP {status}): {plan.get('error', 'erreur inconnue')}")
    pages = plan.get("pages")
    if not isinstance(pages, list) or not pages:
        raise SystemExit("Aucun fragment PDF stocké n'a été trouvé pour ce cours.")

    original_total = 0
    optimized_total = 0
    compressed_count = 0
    skipped_count = 0
    failed_count = 0
    print(f"Cours vérifié : {plan.get('title')} — {len(pages)} fragment(s) prêt(s).")

    for index, page in enumerate(pages, start=1):
        quality = str(page.get("quality") or "")
        status_value = str(page.get("compression_status") or "")
        if status_value in {"server_compressed", "source_restored"} and quality in {"visual_fidelity", "visual_fidelity_restored"}:
            skipped_count += 1
            print(f"[{index}/{len(pages)}] {page.get('path', '')} — profil haute fidélité déjà appliqué, ignoré.")
            continue
        path = str(page.get("path") or "")
        block_id = str(page.get("block_id") or "")
        backup_path = str(page.get("backup_path") or "")
        backup_url = str(page.get("backup_url") or "")
        use_backup = bool(backup_path and backup_url and quality not in {"visual_fidelity", "visual_fidelity_restored"})
        signed_url = backup_url if use_backup else str(page.get("url") or "")
        expected_bytes = int(page.get("bytes") or 0)
        if not path or not block_id or not signed_url:
            failed_count += 1
            print(f"[{index}/{len(pages)}] Métadonnées incomplètes — fragment ignoré.")
            continue

        try:
            with urllib.request.urlopen(signed_url, timeout=60) as response:
                original = response.read()
        except Exception:
            failed_count += 1
            print(f"[{index}/{len(pages)}] {path} — téléchargement serveur échoué, source conservée.")
            continue

        if len(original) < 1000 or not original.startswith(b"%PDF-"):
            failed_count += 1
            print(f"[{index}/{len(pages)}] {path} — PDF source invalide, source conservée.")
            continue

        original_total += len(original)
        with tempfile.TemporaryDirectory(prefix="aurore-pdf-opt-") as temp_dir:
            source = Path(temp_dir) / "source.pdf"
            candidate = Path(temp_dir) / "candidate.pdf"
            source.write_bytes(original)
            try:
                source_pages = parse_page_count(source)
            except Exception:
                failed_count += 1
                print(f"[{index}/{len(pages)}] {path} — pagination source illisible, source conservée.")
                continue

            if source_pages < 1 or source_pages > 20:
                skipped_count += 1
                optimized_total += len(original)
                print(f"[{index}/{len(pages)}] {path} — {source_pages} pages hors limite autorisée, non modifié.")
                continue

            cmd = [
                "gs",
                "-sDEVICE=pdfwrite",
                "-dCompatibilityLevel=1.4",
                "-dDownsampleColorImages=false",
                "-dDownsampleGrayImages=false",
                "-dDownsampleMonoImages=false",
                "-sColorConversionStrategy=LeaveColorUnchanged",
                "-dPassThroughJPEGImages=true",
                "-dPassThroughJPXImages=true",
                "-dDetectDuplicateImages=true",
                "-dCompressFonts=true",
                "-dSubsetFonts=true",
                "-c",
                "<< /ColorImageDict << /QFactor 0.15 /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> /GrayImageDict << /QFactor 0.15 /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> >> setdistillerparams",
                "-dNOPAUSE",
                "-dQUIET",
                "-dBATCH",
                f"-sOutputFile={candidate}",
                "-f",
                str(source),
            ]
            try:
                result = subprocess.run(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=45
                )
            except subprocess.TimeoutExpired:
                failed_count += 1
                optimized_total += len(original)
                print(f"[{index}/{len(pages)}] {path} — Ghostscript dépasse 45 s, source conservée.")
                continue
            if result.returncode != 0 or not candidate.is_file():
                failed_count += 1
                optimized_total += len(original)
                print(f"[{index}/{len(pages)}] {path} — Ghostscript a échoué, source conservée.")
                continue

            optimized = candidate.read_bytes()
            if len(optimized) < 1000 or not optimized.startswith(b"%PDF-"):
                failed_count += 1
                optimized_total += len(original)
                print(f"[{index}/{len(pages)}] {path} — sortie invalide, source conservée.")
                continue
            try:
                output_pages = parse_page_count(candidate)
            except Exception:
                failed_count += 1
                optimized_total += len(original)
                print(f"[{index}/{len(pages)}] {path} — pagination de sortie illisible, source conservée.")
                continue
            if output_pages != source_pages:
                failed_count += 1
                optimized_total += len(original)
                print(f"[{index}/{len(pages)}] {path} — pagination modifiée, source conservée.")
                continue

            restore_source = False
            chosen = optimized
            if len(optimized) >= len(original) - 128:
                if use_backup:
                    chosen = original
                    restore_source = True
                    print(f"[{index}/{len(pages)}] {path} — aucune réduction haute fidélité utile ; restauration de la source originale sauvegardée.")
                else:
                    skipped_count += 1
                    optimized_total += len(original)
                    print(f"[{index}/{len(pages)}] {path} — pas de gain utile et aucune sauvegarde antérieure ; source conservée.")
                    continue

            upload_headers = {
                "x-aurore-render-token": TOKEN,
                "content-type": "application/pdf",
                "x-aurore-course-id": COURSE_ID,
                "x-aurore-block-id": block_id,
                "x-aurore-page-path": path,
                "x-aurore-page-count": str(output_pages),
                "x-aurore-quality-profile": "visual_fidelity",
            }
            if use_backup:
                upload_headers["x-aurore-source-backup-path"] = backup_path
            if restore_source:
                upload_headers["x-aurore-restore-source"] = "true"
            upload_status, upload_raw = post(
                FUNCTION_URL + "?action=upload",
                chosen,
                upload_headers,
            )
            try:
                uploaded = json.loads(upload_raw)
            except Exception:
                uploaded = {}
            if upload_status != 200 or uploaded.get("ok") is not True:
                failed_count += 1
                optimized_total += len(original)
                message = uploaded.get("error", "réponse serveur invalide")
                print(f"[{index}/{len(pages)}] {path} — remplacement refusé (HTTP {upload_status}: {message}); source conservée.")
                if upload_status == 403:
                    raise SystemExit("Refus d'accès serveur : arrêt immédiat, aucun autre fragment ne sera envoyé.")
                continue

            compressed_count += 1
            optimized_total += len(chosen)
            saving = (1 - len(chosen) / len(original)) * 100
            action_label = "source originale restaurée" if restore_source else "profil haute fidélité appliqué"
            print(
                f"[{index}/{len(pages)}] {path} — "
                f"{len(original) / 1048576:.2f} → {len(chosen) / 1048576:.2f} Mio "
                f"({saving:.1f} % économisés), {action_label}; sauvegarde du précédent fichier créée."
            )

    saved = original_total - optimized_total
    print(
        "Bilan : "
        f"{compressed_count} fragment(s) compressé(s), "
        f"{skipped_count} conservé(s) faute de gain, "
        f"{failed_count} échec(s); "
        f"économie estimée sur les fragments traités : {max(saved, 0) / 1048576:.2f} Mio."
    )
    if compressed_count == 0:
        raise SystemExit("Aucun fragment n'a été remplacé : toutes les sources sont conservées.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
