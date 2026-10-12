#!/usr/bin/env python3
"""Safely compress the stored PDF fragments for the one explicitly scoped course."""
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
        path = str(page.get("path") or "")
        block_id = str(page.get("block_id") or "")
        signed_url = str(page.get("url") or "")
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

            if source_pages != 1:
                skipped_count += 1
                optimized_total += len(original)
                print(f"[{index}/{len(pages)}] {path} — {source_pages} pages inattendues, non modifié.")
                continue

            cmd = [
                "gs",
                "-sDEVICE=pdfwrite",
                "-dCompatibilityLevel=1.4",
                "-dPDFSETTINGS=/ebook",
                "-dPassThroughJPEGImages=true",
                "-dPassThroughJPXImages=true",
                "-dDetectDuplicateImages=true",
                "-dCompressFonts=true",
                "-dSubsetFonts=true",
                "-dNOPAUSE",
                "-dQUIET",
                "-dBATCH",
                f"-sOutputFile={candidate}",
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

            if len(optimized) >= len(original) - 128:
                skipped_count += 1
                optimized_total += len(original)
                print(f"[{index}/{len(pages)}] {path} — pas de gain utile, source conservée.")
                continue

            upload_headers = {
                "x-aurore-render-token": TOKEN,
                "content-type": "application/pdf",
                "x-aurore-course-id": COURSE_ID,
                        "x-aurore-block-id": block_id,
                "x-aurore-page-path": path,
                "x-aurore-page-count": str(output_pages),
            }
            upload_status, upload_raw = post(
                FUNCTION_URL + "?action=upload",
                optimized,
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
            optimized_total += len(optimized)
            saving = (1 - len(optimized) / len(original)) * 100
            print(
                f"[{index}/{len(pages)}] {path} — "
                f"{len(original) / 1048576:.2f} → {len(optimized) / 1048576:.2f} Mio "
                f"({saving:.1f} % économisés), sauvegarde d'origine créée."
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
