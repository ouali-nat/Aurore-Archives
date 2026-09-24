#!/usr/bin/env python3
import argparse
import json
import re
import unicodedata
from pathlib import Path
from aurore_svg import render_graphics

AURORE_SITE_URL = "https://aurore-section-archivescom.vercel.app/"
DEFAULT_THEME_COLOR = "6D28D9"

AURORE_EDITORIAL_DECORATIVE_KINDS = {
    "separator", "title_decor", "separator_leaf",
    "leaf_branch", "deco_feuillage", "dots", "mini_tree",
}

SITE_THEME_PALETTE = {
    "violet":    {"primary": "8B5CF6", "secondary": "C084FC", "strong": "6D28D9"},
    "rouge":     {"primary": "E05260", "secondary": "FF8A96", "strong": "C93648"},
    "vert":      {"primary": "2FA66A", "secondary": "75D89C", "strong": "198754"},
    "bleu":      {"primary": "3B82F6", "secondary": "7DB3FF", "strong": "1D4ED8"},
    "jaune":     {"primary": "D5A51B", "secondary": "F5D36B", "strong": "B77900"},
    "orange":    {"primary": "E8791A", "secondary": "FFB36B", "strong": "C85C0D"},
    "cyan":      {"primary": "0891B2", "secondary": "67E8F9", "strong": "0E7490"},
    "rose":      {"primary": "DB2777", "secondary": "F9A8D4", "strong": "BE185D"},
    "indigo":    {"primary": "6366F1", "secondary": "A5B4FC", "strong": "4338CA"},
    "turquoise": {"primary": "14B8A6", "secondary": "67E8F9", "strong": "0F766E"},
    "emeraude":  {"primary": "10B981", "secondary": "6EE7B7", "strong": "047857"},
    "lime":      {"primary": "84CC16", "secondary": "BEF264", "strong": "4D7C0F"},
    "sarcelle":  {"primary": "0D9488", "secondary": "5EEAD4", "strong": "115E59"},
    "magenta":   {"primary": "D946EF", "secondary": "F0ABFC", "strong": "A21CAF"},
    "fuchsia":   {"primary": "C026D3", "secondary": "F0ABFC", "strong": "86198F"},
    "corail":    {"primary": "F06A57", "secondary": "FFB4A8", "strong": "C2412D"},
    "bordeaux":  {"primary": "9F1239", "secondary": "FB7185", "strong": "881337"},
    "pourpre":   {"primary": "9333EA", "secondary": "D8B4FE", "strong": "6B21A8"},
    "prune":     {"primary": "7E22CE", "secondary": "C084FC", "strong": "581C87"},
    "or":        {"primary": "D4A017", "secondary": "F6D365", "strong": "9A6700"},
    "ambre":     {"primary": "F59E0B", "secondary": "FCD34D", "strong": "B45309"},
    "menthe":    {"primary": "10B981", "secondary": "A7F3D0", "strong": "047857"},
    "azur":      {"primary": "0EA5E9", "secondary": "7DD3FC", "strong": "0369A1"},
    "lavande":   {"primary": "8B5CF6", "secondary": "DDD6FE", "strong": "6D28D9"},
    "safran":    {"primary": "EAB308", "secondary": "FDE68A", "strong": "A16207"},
    "nuit":      {"primary": "2563EB", "secondary": "93C5FD", "strong": "1E3A8A"},
    "marine":    {"primary": "0F4C5C", "secondary": "67E8F9", "strong": "0B3440"},
    "ocean":     {"primary": "0284C7", "secondary": "38BDF8", "strong": "075985"},
    "ciel":      {"primary": "0EA5E9", "secondary": "BAE6FD", "strong": "0369A1"},
    "ardoise":   {"primary": "64748B", "secondary": "CBD5E1", "strong": "334155"},
    "graphite":  {"primary": "52525B", "secondary": "D4D4D8", "strong": "27272A"},
    "foret":     {"primary": "16A34A", "secondary": "86EFAC", "strong": "166534"},
    "sapin":     {"primary": "047857", "secondary": "A7F3D0", "strong": "065F46"},
    "pomme":     {"primary": "65A30D", "secondary": "BEF264", "strong": "3F6212"},
    "pistache":  {"primary": "84CC16", "secondary": "D9F99D", "strong": "4D7C0F"},
    "peche":     {"primary": "F97316", "secondary": "FED7AA", "strong": "C2410C"},
    "abricot":   {"primary": "D97706", "secondary": "FCD34D", "strong": "92400E"},
    "terracotta":{"primary": "C2410C", "secondary": "FDBA74", "strong": "9A3412"},
    "framboise": {"primary": "E11D48", "secondary": "FDA4AF", "strong": "9F1239"},
    "mauve":     {"primary": "8B5CF6", "secondary": "E9D5FF", "strong": "6D28D9"},
    "pervenche": {"primary": "6366F1", "secondary": "C7D2FE", "strong": "3730A3"},
    "glacier":   {"primary": "0891B2", "secondary": "CFFAFE", "strong": "155E75"},
    "sable":     {"primary": "B7791F", "secondary": "FEF3C7", "strong": "854D0E"},
    "cacao":     {"primary": "92400E", "secondary": "D6B38C", "strong": "451A03"},
    "lagune":    {"primary": "0D9488", "secondary": "99F6E4", "strong": "0F5257"},
}

# Production layout hardening test trigger: 2026-09-19.\n# Matrix equation-wrapper hardening verified for production retry.\n# Exercise JSON compatibility: accept question/statement/enonce and inline corrections.


def _document_identity(data):
    """Return a stable Aurore identifier and public verification URL.

    The QR target intentionally resolves through the public Aurore interface
    instead of pointing straight at an internal/admin location or a storage
    object. Publication status and PDF integrity can therefore be checked
    later without regenerating the already-issued PDF.
    """
    meta = data.get("_aurore_document") if isinstance(data.get("_aurore_document"), dict) else {}
    raw_id = meta.get("id") or data.get("document_id") or data.get("id")
    try:
        document_id = int(raw_id) if raw_id is not None else None
    except (TypeError, ValueError):
        document_id = None
    created_at = str(meta.get("created_at") or data.get("created_at") or "")
    year_match = re.search(r"(20\d{2})", created_at)
    year = year_match.group(1) if year_match else "2026"
    key = f"AUR-{year}-{document_id:06d}" if document_id is not None else "AUR-ARCHIVES"
    verification_url = (
        f"{AURORE_SITE_URL}?verify_document={document_id}"
        if document_id is not None
        else AURORE_SITE_URL
    )
    return {
        "id": document_id,
        "key": key,
        "year": year,
        "share_url": verification_url,
        "verification_url": verification_url,
    }

def _is_renderable_geogebra_graph(graph):
    """Return True only for an actual GeoGebra construction asset.

    Production Content Factory payloads may omit instrument while still
    carrying a valid GeoGebra source, expression and/or points. The explicit
    GeoGebra source/style markers are therefore accepted as a fallback, while
    a bare storage path alone is never enough to make a legacy illustration
    render as a graph.
    """
    if not isinstance(graph, dict):
        return False

    storage_path = str(
        graph.get("geogebra_image_path") or graph.get("graph_local_path") or ""
    ).strip()
    if not storage_path:
        return False

    source = str(graph.get("geogebra_image_source") or "").lower().strip()
    style = str(graph.get("style") or "").lower().strip()
    instrument = str(
        graph.get("instrument") or graph.get("graph_type") or ""
    ).lower().strip()
    aliases = {
        "function": "function2d",
        "graph": "function2d",
        "courbe": "function2d",
        "complex_plane": "complex_plane",
        "parametric": "parametric2d",
        "geometrie3d": "geometry3d",
        "3d": "geometry3d",
    }
    instrument = aliases.get(instrument, instrument)

    objects = graph.get("objects") if isinstance(graph.get("objects"), list) else []
    points = graph.get("points") if isinstance(graph.get("points"), list) else []
    poi = (
        graph.get("points_of_interest")
        if isinstance(graph.get("points_of_interest"), list)
        else []
    )
    expression = str(graph.get("expression") or "").strip()
    x_expression = str(graph.get("x_expression") or "").strip()
    y_expression = str(graph.get("y_expression") or "").strip()
    z_expression = str(graph.get("z_expression") or "").strip()
    asymptotes = graph.get("asymptotes") if isinstance(graph.get("asymptotes"), list) else []

    if instrument in {"function2d", "complex_plane"}:
        return bool(
            expression
            or asymptotes
            or any(isinstance(p, (list, tuple)) and len(p) == 2 for p in points)
        )
    if instrument == "parametric2d":
        return bool(x_expression and y_expression)
    if instrument == "parametric3d":
        return bool(x_expression and y_expression and z_expression)
    if instrument == "surface3d":
        return bool(expression)
    if instrument == "geometry3d":
        valid_types = {
            "point", "vector", "line", "plane", "sphere", "cylinder",
            "cone", "polygon", "cube", "prism", "pyramid", "tetrahedron",
        }
        has_objects = any(
            isinstance(o, dict)
            and str(o.get("type") or "").lower().strip() in valid_types
            for o in objects
        )
        has_points3 = any(
            isinstance(p, (list, tuple)) and len(p) >= 3 for p in points
        )
        has_poi3 = any(
            isinstance(p, dict) and p.get("z") is not None for p in poi
        )
        return bool(has_objects or has_points3 or has_poi3)

    # Current Content Factory schema can omit instrument. In that case,
    # require an explicit GeoGebra marker plus real construction data.
    if not instrument and source == "geogebra":
        return bool(
            expression
            or x_expression
            or y_expression
            or z_expression
            or asymptotes
            or points
            or objects
            or poi
        )

    # Some older payloads carry only the style marker. Accept those only when
    # there is structured construction data, never on path alone.
    if not instrument and style == "geogebra":
        return bool(
            expression
            or x_expression
            or y_expression
            or z_expression
            or asymptotes
            or points
            or objects
            or poi
        )

    return False

def _open_url_with_retry(req, timeout=30, attempts=4):
    """Open an HTTP request with bounded retries for Wikimedia/CDN 429 responses."""
    import time
    import urllib.error
    import urllib.request

    last = None
    for attempt in range(attempts):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code != 429 or attempt >= attempts - 1:
                raise
            retry_after = exc.headers.get("Retry-After") if getattr(exc, "headers", None) else None
            try:
                delay = max(2.0, min(20.0, float(retry_after)))
            except (TypeError, ValueError):
                delay = min(20.0, max(5.0, 2.0 ** attempt))
            print(
                f"WARNING: Wikimedia rate limit 429; retrying in {delay:.1f}s "
                f"(attempt {attempt + 2}/{attempts})"
            )
            time.sleep(delay)
    raise last


def _has_geogebra(data):
    """Detect GeoGebra content from the structured graph payload."""
    sections = data.get("sections", []) if isinstance(data.get("sections"), list) else []
    for section in sections:
        if not isinstance(section, dict):
            continue
        graphs = section.get("graphs", [])
        if isinstance(graphs, list) and any(
            _is_renderable_geogebra_graph(g) for g in graphs
        ):
            return True
    return False

def _fetch_geogebra_assets(data, tex_dir):
    """Materialize GeoGebra PNGs from the public Supabase Storage bucket.

    GeoGebra stores the generated PNG in Supabase Storage and content_json
    keeps the storage path in geogebra_image_path. LuaLaTeX can only include
    a local file, so the production renderer must download those assets before
    writing the .tex file.
    """
    import urllib.parse
    import urllib.request

    sections = data.get("sections", []) if isinstance(data.get("sections"), list) else []
    if not sections:
        return 0

    assets_dir = Path(tex_dir) / "assets" / "geogebra"
    assets_dir.mkdir(parents=True, exist_ok=True)

    # The GeoGebra Edge Function uploads to the public "Pdfs" bucket.
    storage_base = "https://tdeotqfsbvouresfhkab.supabase.co/storage/v1/object/public/Pdfs"
    count = 0

    for section_index, section in enumerate(sections):
        if not isinstance(section, dict):
            continue
        graphs = section.get("graphs", [])
        if not isinstance(graphs, list):
            continue

        for graph_index, graph in enumerate(graphs):
            if not isinstance(graph, dict):
                continue
            if not _is_renderable_geogebra_graph(graph):
                continue

            existing = str(graph.get("graph_local_path") or "").strip()
            if existing:
                existing_path = Path(tex_dir) / existing
                if existing_path.is_file() and existing_path.stat().st_size > 0:
                    continue

            storage_path = str(graph.get("geogebra_image_path") or "").strip().lstrip("/")
            if not storage_path:
                continue

            # Prevent path traversal and keep the source restricted to the
            # expected Storage object path.
            if ".." in Path(storage_path).parts:
                raise RuntimeError(f"Chemin GeoGebra invalide: {storage_path}")

            url = storage_base + "/" + urllib.parse.quote(storage_path, safe="/")
            filename = f"graph-{section_index + 1}-{graph_index + 1}.png"
            local = assets_dir / filename

            try:
                with _open_url_with_retry(urllib.request.Request(url, headers={"User-Agent": "Aurore-Section-Archives/1.0 (https://aurore-section-archivescom.vercel.app/)"}), timeout=30) as response:
                    payload = response.read()
            except Exception as exc:
                raise RuntimeError(
                    f"Impossible de télécharger le graphique GeoGebra "
                    f"{section_index + 1}.{graph_index + 1} depuis Supabase Storage: {exc}"
                ) from exc

            if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
                raise RuntimeError(
                    f"Le fichier GeoGebra {storage_path} n'est pas un PNG valide."
                )

            local.write_bytes(payload)
            graph["graph_local_path"] = str(local.relative_to(tex_dir)).replace("\\", "/")
            graph["geogebra_local_source"] = "supabase-storage"
            count += 1
            print(
                f"GeoGebra asset {count}: section={section_index + 1} "
                f"graph={graph_index + 1} path={storage_path}"
            )

    return count



def _editorial_profile(data):
    subject = clean_text(data.get("subject") or "").lower()
    title = clean_text(data.get("title") or "").lower()
    text = f"{subject} {title}"
    if re.search(r"svt|biologie|cellule|organite|membrane|genetique|génétique|ecologie|écologie|physiologie|microbiologie", text):
        return "biologie"
    if re.search(r"math|mathématique|mathematique|algèbre|algebre|géométrie|geometrie|calcul", subject):
        return "scientifique"
    if re.search(r"physique|chimie|géologie|geologie", subject):
        return "experimental"
    if re.search(r"anglais|english|espagnol|allemand|arabe|langue", subject):
        return "langues"
    if re.search(r"français|francais|littérature|litterature|littéraire|litteraire", subject):
        return "francais_litterature"
    if re.search(r"histoire|géographie|geographie|éducation civique|education civique", subject):
        return "histoire_geographie"
    if re.search(r"informatique|programmation|algorithmique|numérique|numerique", subject):
        return "informatique"
    if re.search(r"technique|technologie|électronique|electronique|mécanique|mecanique", subject):
        return "technique"
    return "general"

def _visual_profile_config(profile):
    """Return Wikimedia search guidance for each editorial profile."""
    return {
        "biologie": {
            "terms": "biology biological cell anatomy organelles microscopy diagram",
            "queries": ["diagram", "structure", "microscopy", "comparison"],
        },
        "experimental": {
            "terms": "physics chemistry geology scientific experiment apparatus diagram",
            "queries": ["diagram", "experiment", "apparatus", "phenomenon"],
        },
        "scientifique": {
            "terms": "mathematics geometry graph function theorem mathematical diagram",
            "queries": ["geometry diagram", "function graph", "mathematical diagram", "coordinate system"],
        },
        "langues": {
            "terms": "language English vocabulary communication classroom map culture",
            "queries": ["vocabulary illustration", "communication situation", "map", "culture"],
        },
        "francais_litterature": {
            "terms": "French literature author artwork literary history language",
            "queries": ["literary work", "author portrait", "literature", "language diagram"],
        },
        "histoire_geographie": {
            "terms": "history geography historical map territory monument landscape",
            "queries": ["historical map", "geography map", "landscape", "monument"],
        },
        "informatique": {
            "terms": "computer science programming networking hardware software diagram",
            "queries": ["computer diagram", "network diagram", "hardware", "programming"],
        },
        "technique": {
            "terms": "engineering technology mechanics electronics machine technical diagram",
            "queries": ["technical diagram", "mechanism", "machine", "electronic circuit"],
        },
        "general": {
            "terms": "educational scientific educational illustration diagram",
            "queries": ["educational diagram", "educational illustration"],
        },
    }.get(profile, {"terms": "educational illustration diagram", "queries": ["educational diagram"]})


def _visual_query_for_section(data, section, profile):
    """Build a focused Wikimedia query from the section's actual notion."""
    cfg = _visual_profile_config(profile)
    title = clean_text(section.get("title") or "").strip()
    content = section.get("content", [])
    if isinstance(content, list):
        content_text = " ".join(clean_text(x) for x in content[:4])
    else:
        content_text = clean_text(content)
    base = f"{title} {content_text}".strip()
    base = re.sub(r"\\s+", " ", base)[:420]

    # Prefer the section's own notion. Generic terms are appended only to
    # improve Commons retrieval; they never replace the pedagogical subject.
    extras = cfg["terms"]
    candidates = [
        f"{base} {extras} diagram",
        f"{title} {cfg['queries'][0]}",
    ]
    if len(cfg["queries"]) > 1:
        candidates.append(f"{title} {cfg['queries'][1]}")
    return [q.strip() for q in candidates if q.strip()]


def _wikimedia_license_ok(rawlic):
    rawlic = str(rawlic or "").lower()
    if any(x in rawlic for x in ("fair use", "non-commercial", "noncommercial", "no derivatives")):
        return False
    return any(x in rawlic for x in (
        "public domain", "cc0", "creative commons zero", "cc by", "cc-by", "cc sa", "cc-sa"
    ))


def _fetch_wikimedia_visuals(data, assets_dir, profile):
    """Fetch Wikimedia visuals from an explicit editorial plan, with legacy fallback.

    New documents use section.visuals[] written and validated by DeepSeek/Luna.
    Older documents that do not carry that contract keep the previous automatic
    retrieval path so existing production content is not broken.
    """
    import urllib.parse
    import urllib.request

    sections = data.get("sections", [])
    if not isinstance(sections, list):
        return []

    major_sections = [
        (idx, s) for idx, s in enumerate(sections)
        if isinstance(s, dict) and clean_text(s.get("title")).strip()
    ]
    if not major_sections:
        return []

    assets_dir.mkdir(parents=True, exist_ok=True)
    visuals = []
    statuses = []
    seen_pages, seen_urls = set(), set()
    search_cache = {}

    explicit = any(
        isinstance(s.get("visuals"), list) and s.get("visuals")
        for _, s in major_sections
    )
    max_total = 8
    max_per_section = 3
    planned_explicit = sum(
        len(s.get("visuals", []))
        for _, s in major_sections
        if isinstance(s.get("visuals"), list)
    ) if explicit else 0
    if explicit and planned_explicit > max_total:
        print(
            f"WARNING: plan Wikimedia contains {planned_explicit} visuals; "
            f"production cap is {max_total}. Candidates are ranked and bounded "
            "without failing the PDF build."
        )

    def qwords(value):
        return [
            w.lower() for w in re.findall(r"[a-zA-ZÀ-ÿ]{4,}", clean_text(value))
            if w.lower() not in {
                "diagram", "illustration", "photo", "image", "schema",
                "educational", "scientific", "showing", "the", "with",
                "from", "pour", "dans", "avec", "une", "des", "les",
                "sur", "du", "d'une", "et"
            }
        ]

    def candidates_for_directive(directive, section):
        query = clean_text(directive.get("query") or "").strip()
        if not query:
            return []
        purpose = clean_text(directive.get("purpose") or "illustration").strip().lower()

        # Always keep the editorial query first. The remaining variants widen
        # retrieval without inventing a different pedagogical subject.
        candidates = [query]
        lowered = query.lower()

        def add_candidate(value):
            value = re.sub(r"\s+", " ", str(value or "")).strip()
            if value and value not in candidates:
                candidates.append(value)

        if purpose in ("schema", "illustration", "experimental") and "diagram" not in lowered:
            add_candidate(query + " diagram")
        if purpose in ("photo", "experimental") and "photo" not in lowered:
            add_candidate(query + " photo")

        compact = re.sub(
            r"\b(?:diagram|illustration|photo|image|schema|labeled|labelled)\b",
            "",
            query,
            flags=re.IGNORECASE,
        )
        compact = re.sub(r"\s+", " ", compact).strip()
        if compact and compact.lower() != query.lower():
            add_candidate(compact)

        comparison_source = compact or query
        parts = re.split(r"\b(?:vs\.?|versus)\b", comparison_source, flags=re.IGNORECASE)
        if len(parts) == 2:
            left = parts[0].strip()
            right = parts[1].strip()
            if left and right:
                add_candidate(f"{left} {right} comparison")
                add_candidate(f"{left} {right} comparison diagram")

        morphology = comparison_source
        morphology = re.sub(r"\bprokaryotic\b", "prokaryote", morphology, flags=re.IGNORECASE)
        morphology = re.sub(r"\beukaryotic\b", "eukaryote", morphology, flags=re.IGNORECASE)
        if morphology.lower() != comparison_source.lower():
            add_candidate(morphology)

        # The section itself is a fallback search source for every subject.
        # This is what gives mathematics, French, history, geography,
        # languages, computer science and technical subjects a real visual
        # route even when the upstream plan contains no visual directive.
        for fallback_query in _visual_query_for_section(data, section, profile):
            add_candidate(fallback_query)

        if re.search(r"\bprokaryote\b", morphology, flags=re.IGNORECASE) and re.search(
            r"\beukaryote\b", morphology, flags=re.IGNORECASE
        ):
            add_candidate("prokaryote eukaryote cell comparison")
            add_candidate("celltypes")

        # Finally, trim long editorial suffixes one token at a time. This keeps
        # the semantic core available to Commons when the complete phrase is
        # too specific for its search index.
        tokens = re.findall(r"[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’+\-]*", query)
        if len(tokens) >= 3:
            core_tokens = max(2, min(4, len(tokens) - 1))
            add_candidate(" ".join(tokens[:core_tokens]))

        # Bounded on purpose: enough diversity for robust retrieval without
        # turning one PDF into dozens of API calls per illustration.
        return candidates[:8]

    def _visual_purpose_terms(purpose):
        return {
            "schema": {"diagram", "schema", "structure", "anatomy", "figure", "illustration", "comparison"},
            "illustration": {"illustration", "diagram", "figure", "map", "portrait", "structure"},
            "photo": {"photo", "microscopy", "micrograph", "image", "specimen", "experiment"},
            "experimental": {"experiment", "apparatus", "laboratory", "microscopy", "diagram"},
            "comparison": {"comparison", "compare", "difference", "differences", "versus", "vs"},
        }.get(purpose, {"diagram", "illustration", "figure"})

    def _score_wikimedia_candidate(page, ii, meta, url, query, section, purpose):
        page_title = clean_text(page.get("title") or "")
        description = clean_text(
            meta.get("ImageDescription", {}).get("value", "")
            if isinstance(meta.get("ImageDescription"), dict)
            else ""
        )
        categories = clean_text(
            meta.get("Categories", {}).get("value", "")
            if isinstance(meta.get("Categories"), dict)
            else ""
        )
        haystack = " ".join([page_title, description, categories]).lower()
        normalized_haystack = re.sub(r"[^a-z0-9à-ÿ]+", " ", haystack).strip()
        query_words = set(qwords(query))
        section_words = set(qwords(section.get("title")))
        document_words = set(qwords(data.get("title"))) | set(qwords(data.get("subject")))
        purpose_words = _visual_purpose_terms(purpose)

        hay_words = set(qwords(haystack))
        title_words = set(qwords(page_title))

        query_overlap = len(query_words & hay_words)
        section_overlap = len(section_words & hay_words)
        document_overlap = len(document_words & hay_words)
        purpose_overlap = len(purpose_words & hay_words)

        score = 0.0
        score += 48.0 * (query_overlap / max(1, len(query_words)))
        score += 22.0 * (len(query_words & title_words) / max(1, len(query_words)))
        score += 18.0 * (section_overlap / max(1, len(section_words)))
        score += 8.0 * (document_overlap / max(1, len(document_words)))
        score += 5.0 * (purpose_overlap / max(1, len(purpose_words)))

        normalized_query = re.sub(r"[^a-z0-9à-ÿ]+", " ", query.lower()).strip()
        if len(normalized_query.split()) >= 2 and normalized_query in normalized_haystack:
            score += 18.0

        # Slight preference for sufficiently large, landscape-or-square assets
        # that behave well in a pedagogical page. This never replaces relevance.
        width = int(ii.get("width") or 0)
        height = int(ii.get("height") or 0)
        if width >= 1000 and height >= 600:
            score += 2.0
        elif width >= 700 and height >= 500:
            score += 1.0

        return score

    def search_one(query, section, purpose="illustration"):
        # Cache is section/purpose aware because relevance is contextual.
        cache_key = "|".join([
            query.strip().lower(),
            clean_text(section.get("title")).strip().lower(),
            purpose,
        ])
        if cache_key in search_cache:
            return search_cache[cache_key]

        api = (
            "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*"
            "&generator=search&gsrnamespace=6&gsrlimit=16&gsrsearch="
            + urllib.parse.quote(query)
            + "&prop=imageinfo&iiprop=url|size|mime|thumbmime|extmetadata"
            "&iilimit=1&iiurlwidth=1200&iiextmetadataversion=latest"
        )
        req = urllib.request.Request(
            api,
            headers={"User-Agent": "Aurore-Section-Archives/1.0 (https://aurore-section-archivescom.vercel.app/)"},
        )
        with _open_url_with_retry(req, timeout=20) as resp:
            pages = list(
                (json.loads(resp.read().decode("utf-8")).get("query") or {})
                .get("pages", {})
                .values()
            )

        candidates = []
        for page in pages:
            ii = (page.get("imageinfo") or [{}])[0]
            meta = ii.get("extmetadata") or {}
            mime = str(ii.get("mime") or "").lower()
            thumb_mime = str(ii.get("thumbmime") or "").lower()
            url = str(ii.get("thumburl") or ii.get("url") or "")
            effective_mime = (
                thumb_mime
                if thumb_mime in ("image/jpeg", "image/png")
                else mime
            )
            if effective_mime not in ("image/jpeg", "image/png"):
                continue
            if not url.startswith("https://upload.wikimedia.org/"):
                continue
            if not _wikimedia_license_ok(
                " ".join(
                    str(
                        meta.get(k, {}).get("value", "")
                        if isinstance(meta.get(k), dict)
                        else meta.get(k, "")
                    )
                    for k in ("LicenseShortName", "UsageTerms", "License")
                )
            ):
                continue
            width = int(ii.get("width") or 0)
            height = int(ii.get("height") or 0)
            if width < 500 or height < 300:
                continue

            score = _score_wikimedia_candidate(
                page, ii, meta, url, query, section, purpose
            )
            candidates.append((score, page, ii, meta, url, effective_mime))

        candidates.sort(
            key=lambda item: (-item[0], str(item[1].get("title") or "").lower())
        )
        search_cache[cache_key] = candidates
        return candidates

    def ranked_candidates_for_directive(directive, section):
        purpose = clean_text(directive.get("purpose") or "illustration").strip().lower()
        ranked = []
        seen_keys = set()
        for query in candidates_for_directive(directive, section):
            try:
                results = search_one(query, section, purpose=purpose)
            except Exception as exc:
                print(f"WARNING: Wikimedia search failed for {query!r}: {exc}")
                continue
            for score, page, ii, meta, url, effective_mime in results:
                key = (str(page.get("title") or "").lower(), url)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                ranked.append(
                    (score, page, ii, meta, url, effective_mime, query)
                )
        ranked.sort(
            key=lambda item: (-item[0], str(item[1].get("title") or "").lower())
        )
        return ranked



    if explicit:
        for section_index, section in major_sections:
            directives = section.get("visuals", [])
            if not isinstance(directives, list):
                directives = []

            # Existing editorial visuals remain authoritative. When a section
            # has no Wikimedia directive, add one bounded supplemental request
            # derived from the section itself. This applies to every profile,
            # including mathematics, and stays separate from GeoGebra graphs.
            has_wikimedia = any(
                isinstance(raw, dict)
                and str(raw.get("type") or "wikimedia").lower().strip() == "wikimedia"
                for raw in directives
            )
            effective_directives = list(directives)
            if (
                not has_wikimedia
                and len(visuals) < max_total
                and any(
                    clean_text(item).strip()
                    for item in (
                        section.get("content", [])
                        if isinstance(section.get("content", []), list)
                        else [section.get("content", "")]
                    )
                )
            ):
                auto_queries = _visual_query_for_section(data, section, profile)
                if auto_queries:
                    purpose_by_profile = {
                        "scientifique": "schema",
                        "biologie": "schema",
                        "experimental": "experimental",
                        "informatique": "schema",
                        "technique": "schema",
                        "histoire_geographie": "illustration",
                        "francais_litterature": "illustration",
                        "langues": "illustration",
                        "general": "illustration",
                    }
                    effective_directives.append({
                        "type": "wikimedia",
                        "query": auto_queries[0],
                        "caption": clean_text(section.get("title") or ""),
                        "purpose": purpose_by_profile.get(profile, "illustration"),
                        "priority": "supplemental",
                        "required": False,
                    })
                    print(
                        f"Wikimedia supplemental visual: section={section_index + 1} "
                        f"profile={profile} query={auto_queries[0]!r}"
                    )

            accepted_for_section = 0
            for raw in effective_directives:
                if len(visuals) >= max_total or accepted_for_section >= max_per_section:
                    break
                if not isinstance(raw, dict):
                    continue
                if str(raw.get("type") or "wikimedia").lower().strip() != "wikimedia":
                    continue

                priority = str(raw.get("priority") or "").lower().strip()
                raw_required = raw.get("required")
                required = (
                    priority == "required"
                    or raw_required is True
                    or str(raw_required).strip().lower() in ("1", "true", "yes", "oui")
                )
                query_candidates = candidates_for_directive(raw, section)
                if not query_candidates:
                    statuses.append({
                        "section_index": section_index,
                        "section_title": clean_text(section.get("title") or ""),
                        "query": "",
                        "priority": priority or "recommended",
                        "status": "failed",
                        "reason": "query_missing",
                    })
                    print(f"Wikimedia visual skipped: section={section_index + 1} reason=query_missing")
                    continue

                ranked = ranked_candidates_for_directive(raw, section)
                best = None
                for candidate in ranked:
                    score, page, ii, meta, url, effective_mime, resolved_query = candidate
                    page_key = str(page.get("title") or "").lower()
                    if page_key in seen_pages or url in seen_urls:
                        continue
                    try:
                        req = urllib.request.Request(
                            url,
                            headers={"User-Agent": "Aurore-Section-Archives/1.0"},
                        )
                        with _open_url_with_retry(req, timeout=30) as resp:
                            blob = resp.read()
                        if not (10000 <= len(blob) <= 2500000):
                            raise RuntimeError("downloaded image size outside production bounds")
                        best = candidate + (blob,)
                        break
                    except Exception as exc:
                        print(
                            f"WARNING: Wikimedia candidate rejected after ranking: "
                            f"section={section_index + 1} query={resolved_query!r} "
                            f"title={str(page.get('title') or '')!r} error={exc}"
                        )
                        continue

                if not best:
                    statuses.append({
                        "section_index": section_index,
                        "section_title": clean_text(section.get("title") or ""),
                        "query": query_candidates[0],
                        "priority": priority or "recommended",
                        "status": "failed",
                        "reason": "no_usable_ranked_candidate",
                        "candidate_count": len(ranked),
                    })
                    # A missing image must never stop PDF production. There is
                    # no empty frame inserted: the visual is simply omitted,
                    # while graphs and all other content continue to render.
                    print(
                        f"Wikimedia visual unavailable: section={section_index + 1} "
                        f"query={query_candidates[0]!r} priority={priority or 'recommended'} "
                        f"candidates={len(ranked)} — PDF continues."
                    )
                    continue

                score, page, ii, meta, url, effective_mime, resolved_query, blob = best
                try:
                    ext = ".png" if effective_mime == "image/png" else ".jpg"
                    local = assets_dir / f"wikimedia-{len(visuals)+1}{ext}"
                    local.write_bytes(blob)

                    def mv(k, default=""):
                        v = meta.get(k, {})
                        return str(v.get("value", default) if isinstance(v, dict) else v)

                    title = str(page.get("title") or "").replace("File:", "", 1)
                    caption = clean_text(raw.get("caption") or mv("ImageDescription", title))[:280]
                    visuals.append({
                        "section_index": section_index,
                        "section_title": clean_text(section.get("title") or ""),
                        "path": str(local.relative_to(assets_dir.parent)).replace("\\", "/"),
                        "title": clean_text(title),
                        "caption": caption,
                        "author": clean_text(mv("Artist", "Auteur non renseigné"))[:180],
                        "license": clean_text(mv("LicenseShortName", mv("UsageTerms", "Licence libre Commons")))[:120],
                        "source_url": str(
                            ii.get("descriptionurl")
                            or "https://commons.wikimedia.org/wiki/"
                            + urllib.parse.quote(str(page.get("title") or ""))
                        ),
                    })
                    seen_pages.add(str(page.get("title") or "").lower())
                    seen_urls.add(url)
                    accepted_for_section += 1
                    statuses.append({
                        "section_index": section_index,
                        "section_title": clean_text(section.get("title") or ""),
                        "query": query_candidates[0],
                        "resolved_query": resolved_query,
                        "priority": priority or "recommended",
                        "status": "fetched",
                        "source_title": clean_text(title),
                        "relevance_score": round(score, 2),
                        "candidate_count": len(ranked),
                    })
                    if resolved_query != query_candidates[0]:
                        print(
                            f"Wikimedia search fallback: requested={query_candidates[0]!r} "
                            f"resolved={resolved_query!r} score={score:.2f}"
                        )
                    print(
                        f"Wikimedia visual {len(visuals)}: section={section_index + 1} "
                        f"priority={priority or 'recommended'} query={query_candidates[0]!r} "
                        f"resolved={resolved_query!r} title={title!r} score={score:.2f}"
                    )
                except Exception as exc:
                    statuses.append({
                        "section_index": section_index,
                        "section_title": clean_text(section.get("title") or ""),
                        "query": query_candidates[0],
                        "resolved_query": resolved_query,
                        "priority": priority or "recommended",
                        "status": "failed",
                        "reason": str(exc),
                        "candidate_count": len(ranked),
                    })
                    print(
                        f"WARNING: Wikimedia asset materialization failed: "
                        f"section={section_index + 1} query={resolved_query!r} error={exc} — PDF continues."
                    )

    
    else:
        # Backward-compatible path for old documents generated before
        # section.visuals[] existed. This path deliberately keeps the old
        # relevance logic and the same 8-visual ceiling.
        legacy_max = min(8, max(1, len(major_sections)))
        for section_index, section in major_sections:
            if len(visuals) >= legacy_max:
                break

            ranked = []
            for query in _visual_query_for_section(data, section, profile):
                try:
                    purpose = {
                        "scientifique": "schema",
                        "biologie": "schema",
                        "experimental": "experimental",
                        "informatique": "schema",
                        "technique": "schema",
                    }.get(profile, "illustration")
                    ranked.extend(
                        (score, page, ii, meta, url, effective_mime, query)
                        for score, page, ii, meta, url, effective_mime
                        in search_one(query, section, purpose=purpose)
                    )
                except Exception as exc:
                    print(f"WARNING: legacy Wikimedia search failed: {exc}")

            ranked.sort(
                key=lambda item: (-item[0], str(item[1].get("title") or "").lower())
            )

            selected = None
            for candidate in ranked:
                score, page, ii, meta, url, effective_mime, query = candidate
                page_key = str(page.get("title") or "").lower()
                if page_key in seen_pages or url in seen_urls:
                    continue
                try:
                    req = urllib.request.Request(
                        url,
                        headers={"User-Agent": "Aurore-Section-Archives/1.0"},
                    )
                    with _open_url_with_retry(req, timeout=30) as resp:
                        blob = resp.read()
                    if not (10000 <= len(blob) <= 2500000):
                        continue
                    selected = candidate + (blob,)
                    break
                except Exception as exc:
                    print(f"WARNING: legacy Wikimedia download failed: {exc}")

            if not selected:
                continue

            score, page, ii, meta, url, effective_mime, query, blob = selected
            try:
                ext = ".png" if effective_mime == "image/png" else ".jpg"
                local = assets_dir / f"wikimedia-{len(visuals)+1}{ext}"
                local.write_bytes(blob)

                def mv(k, default=""):
                    v = meta.get(k, {})
                    return str(v.get("value", default) if isinstance(v, dict) else v)

                title = str(page.get("title") or "").replace("File:", "", 1)
                visuals.append({
                    "section_index": section_index,
                    "section_title": clean_text(section.get("title") or ""),
                    "path": str(local.relative_to(assets_dir.parent)).replace("\\", "/"),
                    "title": clean_text(title),
                    "caption": clean_text(mv("ImageDescription", title))[:260],
                    "author": clean_text(mv("Artist", "Auteur non renseigné"))[:180],
                    "license": clean_text(mv("LicenseShortName", mv("UsageTerms", "Licence libre Commons")))[:120],
                    "source_url": str(ii.get("descriptionurl") or "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(str(page.get("title") or ""))),
                })
                seen_pages.add(str(page.get("title") or "").lower())
                seen_urls.add(url)
                print(f"Wikimedia legacy visual {len(visuals)}: section={section_index + 1} query={query!r} title={title!r}")
            except Exception as exc:
                print(f"WARNING: legacy Wikimedia download failed: {exc}")

    data["_wikimedia_visual_status"] = statuses
    required_planned = sum(
        1
        for _, section in major_sections
        if isinstance(section.get("visuals"), list)
        for raw in section.get("visuals", [])
        if isinstance(raw, dict)
        and (
            str(raw.get("priority") or "").lower().strip() == "required"
            or raw.get("required") is True
            or str(raw.get("required")).strip().lower() in ("1", "true", "yes", "oui")
        )
    ) if explicit else 0
    required_fetched = sum(
        1
        for status in statuses
        if status.get("priority") == "required" and status.get("status") == "fetched"
    ) if explicit else 0
    failed = sum(1 for status in statuses if status.get("status") != "fetched")
    required_missing = max(0, required_planned - required_fetched)
    visual_qa = {
        "mode": "explicit" if explicit else "legacy",
        "planned": int(planned_explicit if explicit else len(statuses)),
        "selected": int(len(statuses)),
        "retrieved": int(len(visuals)),
        "embedded": 0,
        "required_planned": int(required_planned),
        "required_retrieved": int(required_fetched),
        "required_missing": int(required_missing),
        "failed": int(failed),
        "status": "blocked" if required_missing else ("warning" if failed else "pass"),
        "editorial_cap": int(max_total),
    }
    data["_visual_qa"] = visual_qa
    print(
        f"Wikimedia visual QA: status={visual_qa['status']} "
        f"planned={visual_qa['planned']} selected={visual_qa['selected']} "
        f"retrieved={visual_qa['retrieved']} required={visual_qa['required_retrieved']}/{visual_qa['required_planned']} "
        f"failed={visual_qa['failed']}"
    )
    # A missing Wikimedia visual is never a generation blocker.
    # "required" means editorially preferred/important, not a hard build gate:
    # GeoGebra/math graphs and the rest of the document must still compile.
    if explicit and required_missing:
        print(
            "WARNING: Wikimedia required visual(s) unavailable: "
            f"{required_missing} missing ({required_fetched}/{required_planned} fetched). "
            "PDF generation continues; no Wikimedia gap can block production."
        )
    return visuals
def render_visuals(visuals):
    lines=[]
    for v in visuals or []:
        p=str(v.get("path") or "").replace("\\\\","/").replace("#","\\#").replace("%","\\%")
        if not p: continue
        lines += [
            r"\begin{tcolorbox}[enhanced,breakable,colback=white,colframe=aurorebase!38!white,arc=11pt,boxrule=.45pt,left=8pt,right=8pt,top=8pt,bottom=8pt]",
            r"\centering",
            r"\includegraphics[width=.88\linewidth,height=7.8cm,keepaspectratio]{"+p+r"}",
            r"\par\smallskip{\sffamily\small\bfseries\color{auroredeep} "+tex_text(v.get("title") or "Illustration")+r"}",
            r"\par{\sffamily\scriptsize\color{gray} "+tex_text(v.get("caption") or "")+r"}",
            r"\end{tcolorbox}",""
        ]
    return lines

def render_wikimedia_references(visuals):
    if not visuals: return []
    lines=[
        r"\clearpage",
        r"\section*{Crédits visuels \& licences}",
        r"\addcontentsline{toc}{section}{Crédits visuels et licences}",
        r"{\sffamily\small Les illustrations documentaires utilisées dans cette édition sont listées ci-dessous avec leur auteur, leur licence et leur source.}",""
    ]
    for v in visuals:
        lines += [r"\begin{tcolorbox}[enhanced,breakable,colback=white,colframe=aurorebase!25!white,arc=9pt,left=8pt,right=8pt,top=7pt,bottom=7pt]",
                  r"{\sffamily\bfseries "+tex_text(v.get("title") or "Illustration")+r"}\par",
                  r"{\sffamily\scriptsize Auteur : "+tex_text(v.get("author") or "")+r"}\par",
                  r"{\sffamily\scriptsize Licence : "+tex_text(v.get("license") or "")+r"}\par",
                  r"{\sffamily\scriptsize Source : \href{"+str(v.get("source_url") or "")+r"}{Wikimedia Commons}}",
                  r"\end{tcolorbox}",""]
    return lines


def clean_text(s):
    """Remove non-printable C0/C1 control characters without touching normal Unicode."""
    s = str(s or "")
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", "", s)

def tex_text(s):
    s = clean_text(s)
    return (
        s.replace("\\", r"\textbackslash{}")
         .replace("&", r"\&").replace("%", r"\%").replace("#", r"\#")
         .replace("_", r"\_").replace("{", r"\{").replace("}", r"\}")
         .replace("^", r"\textasciicircum{}").replace("~", r"\textasciitilde{}")
    )

def _repair_common_math_command_corruption(s):
    """Repair narrow, known math-command corruption without touching prose."""
    # Repair compact limit-direction corruption produced upstream (e.g. \\topminfty).
    s = s.replace(r"\topminfty", r"\to+\infty")
    s = s.replace(r"\to+infty", r"\to+\infty")
    s = s.replace(r"\to-infty", r"\to-\infty")
    # Repair a compact limit target where ``\\ell`` lost its backslash (e.g. ``\\toell``).
    s = s.replace(r"\toell", r"\to\ell")
    s = s.replace(r"\too", r"\to")
    s = s.replace("}ight)", r"}\right)")
    s = s.replace("]ight]", r"]\right]")
    s = s.replace(r"\fracrac", r"\frac")
    s = s.replace(r"\rac", r"\frac")
    s = s.replace(r"\torac", r"\to\frac")
    s = s.replace(r"\toimes", r"\to\times")
    s = s.replace(r"\imes", r"\times")
    s = re.sub(r"(?<!\\)\bimes(?=\b)", lambda _m: r"\times", s)
    s = re.sub(r"(?<!\\)\brac(?=\s*(?:\{|[0-9]))", lambda _m: r"\frac", s)
    s = s.replace(r"\leftleft", r"\left")
    s = s.replace(r"\rightright", r"\right")
    s = s.replace(r"\sqrtqrt", r"\sqrt")
    s = s.replace(r"\inftyfty", r"\infty")
    s = s.replace(r"\texttext", r"\text")
    s = s.replace(r"\mathbbmathbb", r"\mathbb")
    s = s.replace(r"\inmathbb", r"\in\mathbb")
    s = s.replace(r"\lnln", r"\ln")
    s = re.sub(r"(?<!\\)\b([A-Za-z])in(?=\s*mathbb\b)", lambda m: m.group(1) + r"\in", s)
    s = re.sub(r"(?<!\\)\blim(?=\s*[_({])", lambda _m: r"\lim", s)
    s = re.sub(r"(?<!\\)\bsqrt(?=\s*\{)", lambda _m: r"\sqrt", s)
    s = re.sub(r"(?<!\\)\bfrac(?=\s*(?:\{|[0-9]))", lambda _m: r"\frac", s)
    s = re.sub(r"(?<!\\)\binfty\b", lambda _m: r"\infty", s)
    s = re.sub(r"(?<!\\)\bln(?=\s*\()", lambda _m: r"\ln", s)
    s = re.sub(r"(?<!\\)\blog(?=\s*\()", lambda _m: r"\log", s)
    s = re.sub(r"(?<!\\)\b(sin|cos|tan|exp)(?=\s*\()", lambda m: "\\" + m.group(1), s)
    s = re.sub(r"(?<!\\)\bleft(?=\s*[\(\[|])", lambda _m: r"\left", s)
    s = re.sub(r"(?<!\\)\bright(?=\s*[\)\]|])", lambda _m: r"\right", s)
    s = re.sub(r"(?<!\\)\bight(?=\s*[\)\]|])", lambda _m: r"\right", s)
    s = re.sub(r"(?<!\\)\btext(?=\s*\{)", lambda _m: r"\text", s)
    s = re.sub(r"(?<!\\)\bmathbb(?=\s*(?:\{|[A-Za-z]))", lambda _m: r"\mathbb", s)
    s = re.sub(r"(?<!\\)\b(?:qquad|quad)\b", lambda m: "\\" + m.group(0), s)
    s = re.sub(r"(?<!\\)\bwidetilde(?=\s*(?:\{|[A-Za-z]))", lambda _m: r"\widetilde", s)
    s = re.sub(r"(?<!\\)setminus(?=\s*(?:\{|[A-Za-z]))", lambda _m: r"\setminus", s)
    return s

def normalize_math(s):
    """
    Normalize JSON-escaped LaTeX commands inside math.

    Content Factory payloads can contain doubled backslashes for commands
    (for example \\exp or \\infty). Collapse those command escapes while
    preserving the doubled backslashes used as array/alignment row breaks,
    including row breaks immediately before \\hline or \\cline.
    """
    s = str(s or "")
    # Repair JSON control escapes before clean_text() removes them.
    s = s.replace("\f" + "rac", r"\frac")
    s = s.replace("\t" + "ext", r"\text")
    s = s.replace("\t" + "imes", r"\times")
    s = s.replace("\t" + "heta", r"\theta")
    s = s.replace("\t" + "o", r"\to")
    # JSON decodes \\right as CR + "ight"; restore the lost backslash before clean_text().
    s = s.replace("\r" + "ight", r"\right")
    s = clean_text(s)
    s = _repair_common_math_command_corruption(s)


    # Protect LaTeX row breaks before normalizing command escapes.
    #
    # A matrix row can be followed immediately by a one-letter entry, e.g.
    # ``e&f\\\\g&h``. The older protection only recognized row breaks before
    # ``&``/``\\hline``/end-of-input, so ``\\\\g`` was collapsed to ``\\g`` and
    # LuaLaTeX treated it as an undefined control sequence. Preserve row
    # separators inside matrix/array/alignment environments before collapsing
    # JSON-overescaped commands.
    marker = "__AURORA_ARRAY_ROWBREAK__"
    # Content Factory payloads can reach this renderer with JSON escaping
    # still present: environment commands may therefore appear as \\begin/\\end
    # instead of \\begin/\\end. Normalize only these delimiters first.
    # We must not normalize arbitrary doubled backslashes here because \\\\ is
    # also the row separator inside matrices/arrays.
    math_env_names = (
        r"array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|"
        r"smallmatrix|cases|aligned|alignedat|gathered|split|rcases"
    )
    s = re.sub(
        rf"\\\\(?=begin\\{{(?:{math_env_names})\\}}|end\\{{(?:{math_env_names})\\}})",
        r"\\",
        s,
    )

    row_env_pattern = re.compile(
        rf"\\begin\\{{(?:{math_env_names})\\}}"
        rf"[\\s\\S]*?"
        rf"\\end\\{{(?:{math_env_names})\\}}"
    )

    def _protect_math_rows(match):
        block = match.group(0)
        # Preserve row separators before the first cell of the next row,
        # including one-letter variables such as ``\\g`` / ``\\c``.
        block = re.sub(
            r"\\\\(?=(?:[A-Za-z0-9]+)(?:\s*&|\s*$))",
            marker,
            block,
        )
        block = re.sub(
            r"\\\\(?=\s*(?:&|\\\\(?:hline|cline)|$))",
            marker,
            block,
        )
        return block

    s = row_env_pattern.sub(_protect_math_rows, s)
    # A JSON-escaped command such as \\exp represents one LaTeX command
    # backslash. Do not touch protected array row breaks.
    s = re.sub(r"\\\\(?=[A-Za-z{}])", lambda _m: "\\", s)
    s = _repair_common_math_command_corruption(s)

    # JSON-escaped TeX punctuation can also arrive doubled (for example
    # \\% for a percentage inside math). Unlike array row breaks, these
    # sequences must collapse to one command backslash; otherwise the
    # % becomes a TeX comment and can swallow the closing delimiter/braces.
    s = re.sub(r"\\\\(?=[%&#_^~])", lambda _m: "\\", s)

    # Restore protected array row breaks as real LaTeX double-backslash commands.
    s = s.replace(marker, "\\\\")

    # Canonicalize an over-escaped matrix row break (three backslashes)
    # that can remain after JSON/LaTeX normalization.
    def _repair_overescaped_matrix_rows(match):
        block = match.group(0)
        # Use literal replacement here to avoid regex ambiguity around
        # backslash escaping: exactly three backslashes become two.
        block = block.replace(chr(92) * 3, chr(92) * 2)
        return block

    s = re.sub(
        r"\\begin\{(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|array|aligned|alignedat|gathered|split|rcases)\}[\s\S]*?\\end\{(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|array|aligned|alignedat|gathered|split|rcases)\}",
        _repair_overescaped_matrix_rows,
        s,
    )

    # Some payloads arrive already partially normalized: a JSON row break
    # can reach this point as a single backslash before the next one-character
    # cell. Inside matrix/alignment environments that is a lost row separator.
    # Repair only this narrow shape; real commands such as \\gamma are untouched.
    def _repair_lost_matrix_rows(match):
        block = match.group(0)
        # After command normalization a lost row separator can be reduced to
        # a single backslash: ``f\\g&h``. Inside a matrix this shape cannot be
        # be a valid one-letter TeX command, so restore the row break.
        block = re.sub(
            r"(?<=[A-Za-z0-9})])\\(?=[A-Za-z](?:\s*&))",
            r"\\\\",
            block,
        )
        # The cases environment uses no alignment ampersand. If a row break
        # has been reduced to a single backslash before the first letter of
        # the next equation (for example 3-backslash-x+3y=7), restore it only
        # when the following token clearly starts an equation.
        block = re.sub(
            r"(?<=[A-Za-z0-9})])\\(?=[A-Za-z](?:\s*[+\-=]))",
            r"\\\\",
            block,
        )
        # Repair a lost row break before the end of a one-column matrix,
        # e.g. x\\y\\end{pmatrix}.
        block = re.sub(
            r"(?<=[A-Za-z0-9})])\\(?=[A-Za-z](?:\s*\\end\{))",
            r"\\\\",
            block,
        )
        return block

    s = re.sub(
        r"\\begin\{(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|array|aligned|alignedat|gathered|split|rcases)\}[\s\S]*?\\end\{(?:matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|array|aligned|alignedat|gathered|split|rcases)\}",
        _repair_lost_matrix_rows,
        s,
    )

    # Repair a narrow invalid \\t sequence when it is clearly a truncated \\to command.
    # This can arise at an editorial JavaScript/Python escape boundary.
    # Valid commands such as \\text, \\times and \\theta are left untouched.
    s = re.sub(r"\\t(?=\\s*(?:[,.;:$)\\]}]|$))", r"\\to", s)

    # Before a horizontal rule ("\\ \\hline") instead of the required
    # array row break ("\\\\ \\hline"). Canonicalize that malformed
    # sequence only inside array environments; never alter ordinary math.
    def _fix_array_rows(match):
        block = match.group(0)
        return re.sub(
            r"(?<!\\)\\(?=\s+\\(?:hline|cline)\b)",
            r"\\\\",
            block,
        )

    return re.sub(
        r"\\begin\{array\}[\s\S]*?\\end\{array\}",
        _fix_array_rows,
        s,
    )

_AUTO_MATH_START_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?:"
    r"conjugué|conjuguée|Var|Im|Re|arg|mod|AB|AC|BC|ABC|P|C|"
    r"E_[A-Za-z0-9]+|f(?:['’′]{1,2})?(?:\([A-Za-z0-9_,]+\))?|"
    r"z(?:['’′]|_[A-Za-z0-9]+|[0-9]+)?|[abcmnpqxykTEX])"
)
_AUTO_MATH_STANDALONE_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?:E_[A-Za-z0-9]+|z_[A-Za-z0-9]+|"
    r"f['’′]{1,2}|Δ|Ω)(?=\s*[:;,])"
)
_AUTO_MATH_ATOM_RE = re.compile(
    r"(?:"
    r"\d+(?:[.,]\d+)?|"
    r"(?:conjugué|conjuguée|Var|Im|Re|arg|mod|AB|AC|BC|ABC|P|C|"
    r"E_[A-Za-z0-9]+|f(?:['’′]{1,2})?(?:\([A-Za-z0-9_,]+\))?|"
    r"z(?:['’′]|_[A-Za-z0-9]+|[0-9]+)?|[abcimnpqxykTEXRe])|"
    r"\\[A-Za-z]+|"
    r"\((?:[^()\n]|\([^()\n]*\))*\)|"
    r"\{(?:[^{}\n]|\{[^{}\n]*\})*\}|"
    r"\[(?:[^\[\]\n]|\[[^\[\]\n]*\])*\}|"
    r"[²³⁴⁵⁶⁷⁸⁹⁰₀₁₂₃₄₅₆₇₈₉πΔΩ√−≤≥≠≈∈∉×±]"
    r")"
)
_AUTO_MATH_OP_RE = re.compile(r"(?:=|[+\-*/^_<>]|∈|∉|≤|≥|≠|≈|±)")
_AUTO_MATH_ABS_PREFIX_RE = re.compile(
    r"(?<!\w)\|[^|\n]{1,100}\|\s*(?:=|≠|≤|≥|<|>)\s*"
)

def _auto_math_read_atom(s, pos):
    match = _AUTO_MATH_ATOM_RE.match(s, pos)
    return (match.end(), match.group(0)) if match else None

def _auto_math_read_signed_atom(s, pos):
    p = pos
    while p < len(s) and s[p] in " \t":
        p += 1
    if p < len(s) and s[p] in "+-":
        p += 1
        while p < len(s) and s[p] in " \t":
            p += 1
    return _auto_math_read_atom(s, p)

def _auto_math_parse_expression(s, start):
    first = _auto_math_read_atom(s, start)
    if not first:
        return None

    pos, first_atom = first
    meaningful = False
    spaced_function = first_atom in {"arg", "mod", "conjugué", "conjuguée"}

    while True:
        base = pos
        while pos < len(s) and s[pos] in " \t":
            pos += 1
        had_space = pos > base

        if pos >= len(s):
            pos = base
            break

        operator = _AUTO_MATH_OP_RE.match(s, pos)
        if operator:
            meaningful = True
            pos = operator.end()
            next_atom = _auto_math_read_signed_atom(s, pos)
            if not next_atom:
                pos = base
                break
            pos = next_atom[0]
            spaced_function = False
            continue

        if spaced_function:
            next_atom = _auto_math_read_atom(s, pos)
            if next_atom:
                meaningful = True
                pos = next_atom[0]
                spaced_function = False
                continue

        if not had_space:
            next_atom = _auto_math_read_atom(s, pos)
            if next_atom:
                meaningful = True
                pos = next_atom[0]
                continue

        pos = base
        break

    candidate = s[start:pos].strip()
    if not meaningful:
        return None
    return pos, candidate

def _auto_math_normalize_fragment(fragment):
    value = str(fragment or "")
    value = value.translate(str.maketrans({
        "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5", "⁶": "^6",
        "⁷": "^7", "⁸": "^8", "⁹": "^9", "⁰": "^0",
        "₁": "_1", "₂": "_2", "₃": "_3", "₄": "_4", "₅": "_5",
        "₆": "_6", "₇": "_7", "₈": "_8", "₉": "_9",
        "π": r"\pi", "Δ": r"\Delta", "Ω": r"\Omega", "√": r"\sqrt ",
        "−": "-", "≤": r"\leq", "≥": r"\geq", "≠": r"\neq",
        "≈": r"\approx", "∈": r"\in", "∉": r"\notin",
        "×": r"\times", "∞": r"\infty", "±": r"\pm",
        "α": r"\alpha", "β": r"\beta", "γ": r"\gamma",
        "θ": r"\theta", "λ": r"\lambda", "μ": r"\mu",
        "′": "'", "’": "'", "…": r"\ldots",
    }))
    value = re.sub(r"(\\in|\\notin)\s*R\b", r"\1\\mathbb{R}", value)
    value = re.sub(r"\\sqrt\s+([A-Za-z0-9_]+)", r"\\sqrt{\1}", value)
    value = re.sub(r"\bz([0-9]+)\b", r"z_{\1}", value)
    value = re.sub(r"\bC\(([^(),]+),([^(),]+)\)", r"\\binom{\1}{\2}", value)
    value = re.sub(r"\bVar(?=\s*\()", r"\\operatorname{Var}", value)
    value = re.sub(r"\bE(?=\s*\()", r"\\mathbb{E}", value)
    value = re.sub(
        r"\b(?:conjugué|conjuguée)\s+([A-Za-z](?:_[A-Za-z0-9]+)?)",
        r"\\overline{\1}",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(r"\bIm(?=\s*\()", r"\\operatorname{Im}", value)
    value = re.sub(r"\bRe(?=\s*\()", r"\\operatorname{Re}", value)
    value = re.sub(r"\barg(?=\s*(?:\(|[A-Za-z]))", r"\\arg", value)
    return value

def _auto_mathize_plain_text(text):
    """Protect clearly mathematical plain-text fragments before TeX escaping.

    This is intentionally used only for exercise-series content. It recognizes
    common structured math syntax (equations, moduli, arguments, roots,
    indices, powers and statistical formulas) without turning normal French
    prose into mathematics.
    """
    s = str(text or "")
    placeholders = []

    def protect(raw):
        token = f"AURORAMATHTOKEN{len(placeholders)}"
        placeholders.append(raw)
        return token

    matches = []

    for match in _AUTO_MATH_STANDALONE_RE.finditer(s):
        matches.append((match.start(), match.end(), match.group(0)))

    for match in _AUTO_MATH_ABS_PREFIX_RE.finditer(s):
        end = match.end()
        if end < len(s) and s[end] == "|":
            rhs = re.match(r"\|[^|\n]{1,100}\|", s[end:])
            if rhs:
                end += rhs.end()
        else:
            parsed = _auto_math_parse_expression(s, end)
            if parsed:
                end = parsed[0]
            else:
                atom = _auto_math_read_atom(s, end)
                if atom:
                    end = atom[0]
        matches.append((match.start(), end, s[match.start():end]))

    for match in _AUTO_MATH_START_RE.finditer(s):
        if match.end() < len(s) and s[match.end()].isalpha():
            continue
        parsed = _auto_math_parse_expression(s, match.start())
        if parsed:
            matches.append((match.start(), parsed[0], parsed[1]))

    for match in re.finditer(r"(?<![\w])(?:Δ|Ω|√|∫|Σ|∑)", s):
        parsed = _auto_math_parse_expression(s, match.start())
        if parsed:
            matches.append((match.start(), parsed[0], parsed[1]))

    matches.sort(key=lambda item: (item[0], -(item[1] - item[0])))
    chosen = []
    last_end = -1
    for item in matches:
        if item[0] < last_end:
            continue
        chosen.append(item)
        last_end = item[1]

    output = []
    cursor = 0
    for start, end, candidate in chosen:
        output.append(s[cursor:start])
        output.append(protect(r"\(" + _auto_math_normalize_fragment(candidate) + r"\)"))
        cursor = end
    output.append(s[cursor:])
    return "".join(output), placeholders

def _render_bare_latex_fragments(text, auto_math=False):
    """Preserve LaTeX commands embedded in prose even when delimiters are missing.

    Some generated solutions contain fragments such as \\\\overline{OA},
    \\\\frac{1}{f'}, \\\\gamma or \\\\text{cm} without surrounding $...$.
    Those fragments must remain real TeX instead of being escaped as text.
    """
    s = normalize_math(str(text or ""))
    placeholders = []
    if auto_math:
        s, placeholders = _auto_mathize_plain_text(s)

    def protect(raw):
        token = f"AURORAMATHTOKEN{len(placeholders)}"
        placeholders.append(raw)
        return token

    patterns = [
        r"\\frac\{(?:[^{}]|\{[^{}]*\})*\}\{(?:[^{}]|\{[^{}]*\})*\}",
        r"\\overline\{[^{}]*\}",
        r"\\(?:textbf|textit|textrm|textsf|texttt|emph|underline)\{[^{}]*\}",
        r"\\text\{[^{}]*\}",
        r"\\(?:sqrt|mathrm|mathbf|mathit)\{[^{}]*\}",
        r"\\(?:gamma|delta|alpha|beta|theta|lambda|mu|pi|infty|approx|pm|times|cdot|leq|geq|neq|iff|Longrightarrow|Rightarrow|Longleftarrow|Leftrightarrow)\b",
        r"\\,",
        r"\\quad",
    ]

    for pattern in patterns:
        s = re.sub(pattern, lambda m: protect(r"\(" + m.group(0) + r"\)"), s)

    keyword_tokens = []
    def protect_keyword(raw):
        token = f"AURORAKEYWORDTOKEN{len(keyword_tokens)}"
        keyword_tokens.append(raw)
        return token

    # Controlled editorial markup: [[terme clé]] becomes a theme-colored bold term.
    s = re.sub(
        r"\[\[([^\[\]]{1,80})\]\]",
        lambda m: protect_keyword(
            r"\\textcolor{aurorebase}{\\bfseries " + tex_text(m.group(1).strip()) + r"}"
        ),
        s,
    )

    escaped = tex_text(s)
    for i, raw in enumerate(placeholders):
        escaped = escaped.replace(f"AURORAMATHTOKEN{i}", raw)
    for i, raw in enumerate(keyword_tokens):
        escaped = escaped.replace(f"AURORAKEYWORDTOKEN{i}", raw)
    return escaped


def inline(s, auto_math=False):
    """
    Escape ordinary text while preserving LaTeX math blocks.

    Content Factory may emit inline or display math, including multiline
    array environments. Math must never pass through tex_text(), otherwise
    backslashes, braces and alignment markers are escaped into invalid TeX.
    """
    s = str(s or "")
    # Repair the specific upstream typo $....$: an inline formula whose
    # closing dollar is immediately followed by an accidental extra dollar.
    # Without this repair, later formulas can be paired incorrectly and
    # LuaLaTeX eventually reports a missing closing math delimiter.
    s = re.sub(r"(?<!\$)\$([^$\n]{1,240})\$\$(?=\s|$|[,.!?;:])", r"$\1$", s)
    stripped = s.strip()

    # A whole item may be an explicit display-math block. Single-dollar
    # math is intentionally handled only by the regex below so a sentence
    # containing several formulas cannot be mistaken for one math block.
    if stripped.startswith(r"\[") and stripped.endswith(r"\]"):
        return normalize_math(stripped)

    pattern = re.compile(r"(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[\s\S]*?\$)")
    parts = pattern.split(s)
    out = []
    for p in parts:
        if not p:
            continue
        if p.startswith("$$") and p.endswith("$$") and len(p) >= 4:
            out.append(r"\[" + normalize_math(p[2:-2].strip()) + r"\]")
        elif p.startswith(r"\[") and p.endswith(r"\]"):
            out.append(normalize_math(p))
        elif p.startswith(r"\(") and p.endswith(r"\)"):
            out.append(r"\(" + normalize_math(p[2:-2].strip()) + r"\)")
        elif p.startswith("$") and p.endswith("$") and len(p) >= 2:
            out.append(r"\(" + normalize_math(p[1:-1].strip()) + r"\)")
        else:
            out.append(_render_bare_latex_fragments(p, auto_math=auto_math))
    return "".join(out)


def _is_numbered(s):
    return bool(re.match(r"^\s*\d+[.)]\s+", str(s or "")))


def _is_bullet(s):
    return bool(re.match(r"^\s*(?:[-*•])\s+", str(s or "")))


def _is_table_row(s):
    s = str(s or "").strip()
    # Ignore pipe characters that belong to LaTeX math. In particular,
    # array environments use a column separator such as {c|ccccc}; those
    # pipes must never cause the math block to be treated as a Markdown table.
    text_only = re.sub(
        r"(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[\s\S]*?\$)",
        "",
        s,
    )
    return "|" in text_only and len([p for p in text_only.split("|") if p.strip()]) >= 2


def _strip_list_marker(s):
    return re.sub(r"^\s*(?:\d+[.)]|[-*•])\s+", "", clean_text(s)).strip()


def _is_numeric_noise(s):
    """Reject accidental pages/blocks containing only long numeric sequences."""
    t = clean_text(s).strip()
    nums = re.findall(r"(?<![A-Za-z])\d+(?![A-Za-z])", t)
    if len(nums) < 8:
        return False
    return bool(re.fullmatch(r"[\d\s,.;:()\-]+", t))


def render_table(rows):
    cells = [[c.strip() for c in row.strip().strip("|").split("|")] for row in rows]
    if not cells:
        return ""
    width = max(len(r) for r in cells)
    cells = [r + [""] * (width - len(r)) for r in cells]
    cells = [
        r for r in cells
        if not all(re.fullmatch(r":?-{2,}:?", c.replace(" ", "")) for c in r)
    ]
    if not cells:
        return ""

    spec = "|" + "|".join([r">{\raggedright\arraybackslash}X"] * width) + "|"
    out = [
        r"\begin{tcolorbox}[enhanced,breakable,colback=white,colframe=aurorebase!38!white,arc=10pt,boxrule=.45pt,left=8pt,right=8pt,top=8pt,bottom=8pt]",
        r"\small",
        r"\renewcommand{\arraystretch}{1.18}",
        r"\begin{tabularx}{0.98\linewidth}{" + spec + r"}",
        r"\hline",
    ]
    for i, row in enumerate(cells):
        out.append(" & ".join(inline(c) for c in row) + r"\\")
        if i == 0:
            out.append(r"\hline")
    out += [r"\hline", r"\end{tabularx}", r"\end{tcolorbox}"]
    return "\n".join(out)


def _split_exercise_text(value, mode="question"):
    """Split exercise statements/corrections into readable pedagogical steps."""
    text = clean_text(value).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []
    # Expose numbered subquestions without discarding their original wording.
    text = re.sub(r"\s+(?=(?:\d+[.)]|[A-Za-z][.)])\s+)", "\n", text)
    chunks = [part.strip() for part in re.split(r"\n+", text) if part.strip()]

    if mode == "correction":
        refined = []
        for chunk in chunks:
            parts = re.split(
                r"(?<=[.!?])\s+(?=(?:Donc|Ainsi|Alors|Pour |Par |Avec |On |Si |Les |Le |La |Enfin|Il |Cela |Ce |Cette|On en déduit|Calcul|Vérif))",
                chunk,
                flags=re.IGNORECASE,
            )
            refined.extend(p.strip() for p in parts if p.strip())
        chunks = refined
    return chunks


def render_exercise_text(value, mode="question"):
    lines = []
    display_pattern = re.compile(r"(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])")
    for part in _split_exercise_text(value, mode=mode):
        m = re.match(r"^(\d+[.)])\s+(.+)$", part, flags=re.DOTALL)
        prefix = ""
        body = m.group(2) if m else part
        if m:
            prefix = (
                r"\par\medskip\noindent{\sffamily\bfseries\color{auroredeep}" + tex_text(m.group(1)) +
                r"}\enspace "
            )

        segments = [x for x in display_pattern.split(body) if x]
        first_text = True
        for segment in segments:
            if display_pattern.fullmatch(segment):
                math = segment
                if math.startswith("$") and math.endswith("$"):
                    math = math[2:-2].strip()
                else:
                    math = math[2:-2].strip()
                lines.append(r"\par\medskip")
                lines.append(r"\begin{equation*}" + normalize_math(math) + r"\end{equation*}")
                lines.append(r"\par\smallskip")
                continue

            rendered = inline(segment, auto_math=True)
            if not rendered.strip():
                continue
            if mode == "correction":
                rendered = re.sub(
                    r"^(\s*)(?:Donc|Ainsi|Alors|On en déduit|Il s'ensuit|Il s’ensuit)\b[,:]?\s*",
                    r"\\(\\Longrightarrow\\)\\enspace ",
                    rendered,
                    flags=re.IGNORECASE,
                )
            if first_text and prefix:
                lines.append(prefix + rendered)
            else:
                lines.append(rendered)
            first_text = False
            lines.append(r"\par\smallskip")
    return lines


def render_content(items, auto_math=False):
    # Be defensive about Content Factory payloads. Some production payloads
    # can arrive as a JSON-encoded string instead of a native list.
    if isinstance(items, str):
        try:
            decoded = json.loads(items)
            items = decoded if isinstance(decoded, list) else [items]
        except (TypeError, json.JSONDecodeError):
            items = [items]
    elif not isinstance(items, list):
        items = [items]

    lines = []
    i = 0
    while i < len(items):
        raw = clean_text(items[i]).strip()
        if not raw:
            i += 1
            continue
        if _is_numeric_noise(raw):
            i += 1
            continue

        if _is_table_row(raw):
            table_rows = []
            while i < len(items) and _is_table_row(str(items[i] or "").strip()):
                table_rows.append(str(items[i]).strip())
                i += 1
            lines.append(render_table(table_rows))
            continue

        if _is_numbered(raw):
            group = []
            while i < len(items) and _is_numbered(str(items[i] or "").strip()):
                group.append(_strip_list_marker(items[i]))
                i += 1
            lines.append(r"\begin{enumerate}")
            lines.extend(r"\item " + inline(x, auto_math=auto_math) for x in group)
            lines.append(r"\end{enumerate}")
            continue

        if _is_bullet(raw):
            group = []
            while i < len(items) and _is_bullet(str(items[i] or "").strip()):
                group.append(_strip_list_marker(items[i]))
                i += 1
            lines.append(r"\begin{itemize}")
            lines.extend(r"\item " + inline(x, auto_math=auto_math) for x in group)
            lines.append(r"\end{itemize}")
            continue

        block = labeled_block(raw, auto_math=auto_math)
        if block:
            lines.extend(block)
            i += 1
            continue
        lines.append(inline(raw, auto_math=auto_math))
        lines.append("")
        i += 1

    return lines


def render_aurore_graphics(graphics, assets_dir, theme):
    """Materialize SVG graphics and keep editorial motifs visually subordinate."""
    generated = render_graphics(graphics, assets_dir, theme=theme)
    lines = []
    import subprocess

    for item in generated:
        svg_path = Path(item["svg_path"])
        pdf_path = svg_path.with_suffix(".pdf")
        try:
            subprocess.run(
                ["rsvg-convert", "-f", "pdf", "-o", str(pdf_path), str(svg_path)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or "").strip()
            raise RuntimeError(
                f"Conversion Aurore SVG -> PDF échouée pour {svg_path.name}"
                + (f": {detail}" if detail else "")
            ) from exc

        rel = str(pdf_path.relative_to(Path(assets_dir).parent.parent.parent)).replace("\\", "/")
        safe = rel.replace("#", "\\#").replace("%", "\\%")
        kind = str(item.get("kind") or "").strip().lower()
        is_decorative = (
            item.get("role") == "editorial"
            or kind in AURORE_EDITORIAL_DECORATIVE_KINDS
        )

        if is_decorative:
            # Micro-motif : pas de grand encadré, pas de légende, pas de pleine largeur.
            lines.extend([
                r"\par\smallskip",
                r"\noindent\makebox[\linewidth][c]{%",
                r"\includegraphics[width=.68\linewidth,height=.42cm,keepaspectratio]{" + safe + r"}%",
                r"}",
                r"\par\smallskip",
                "",
            ])
        else:
            # Schéma scientifique : conserve son espace pédagogique et sa légende.
            lines.extend([
                r"\begin{tcolorbox}[enhanced,breakable,colback=white,colframe=aurorebase!32!white,arc=11pt,boxrule=.45pt,left=8pt,right=8pt,top=8pt,bottom=8pt]",
                r"\centering",
                r"\includegraphics[width=.92\linewidth,keepaspectratio]{" + safe + r"}",
                r"\par\smallskip{\sffamily\small\color{gray} " + tex_text(item.get("title") or item.get("kind") or "Graphisme Aurore") + r"}",
                r"\end{tcolorbox}",
                "",
            ])
    return lines

def render_graphs(graphs, allow=True, exercise_mode=False):
    if not allow:
        return []
    if not isinstance(graphs, list):
        return []
    lines = []
    for graph in graphs:
        if not isinstance(graph, dict):
            continue
        if not _is_renderable_geogebra_graph(graph):
            continue
        local_path = str(graph.get("graph_local_path") or "").strip()
        if not local_path:
            continue
        safe_path = local_path.replace("\\", "/").replace("#", "\\#").replace("%", "\\%")
        title = tex_text(graph.get("title") or "Graphique")
        lines.extend([
            r"\begin{tcolorbox}[enhanced,breakable,colback=white,colframe=aurorebase,arc=7pt,boxrule=.45pt,left=8pt,right=8pt,top=8pt,bottom=8pt]",
            r"\centering",
            r"\includegraphics[width=" + ("0.88" if exercise_mode else "0.92") + r"\linewidth,height=" + ("7.2cm" if exercise_mode else "10.5cm") + r",keepaspectratio]{" + safe_path + r"}",
            r"\par\smallskip{\sffamily\small\color{gray} " + title + r"}",
            r"\end{tcolorbox}",
            "",
        ])
    return lines


def resolve_theme_palette(data):
    """Resolve the exact Aurore site palette for the document."""
    design_candidates = [data.get("_aurore_design"), data.get("aurore_design")]
    design = next((d for d in design_candidates if isinstance(d, dict)), {})
    key = clean_text(design.get("theme_key") or data.get("theme_key") or "").strip().lower()
    if key in SITE_THEME_PALETTE:
        return SITE_THEME_PALETTE[key]

    candidates = [
        design.get("theme_strong"),
        design.get("theme_primary"),
        design.get("theme_color"),
        data.get("theme_color"),
        data.get("themeColor"),
    ]
    for value in candidates:
        raw = clean_text(value).strip().lstrip("#").upper()
        if not re.fullmatch(r"[0-9A-F]{6}", raw):
            continue
        for palette in SITE_THEME_PALETTE.values():
            if raw in {palette["strong"], palette["primary"], palette["secondary"]}:
                return palette
        return {"primary": raw, "secondary": raw, "strong": raw}

    return SITE_THEME_PALETTE["violet"]


def resolve_theme_color(data):
    """Backward-compatible helper returning the strong Aurore color."""
    return resolve_theme_palette(data)["strong"]


def labeled_block(s, auto_math=False):
    """Render a small editorial callout when prose starts with a known label."""
    t = clean_text(s).strip()
    m = re.match(
        r"^(Définition|Propriété(?: à connaître)?|Théorème|Lemme|Méthode|Exemple(?: guidé)?|Remarque|Important|À retenir|Conseil|Astuce|Attention|Erreur(?: fréquente)?|Observation|Formule utile|Relation utile|Proposition|Vocabulaire utile|Point essentiel|À découvrir|Piste de réflexion)\s*[:\-]\s*(.+)$",
        t,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return []
    return [
        r"\AuroreLabeledBlock{" + tex_text(m.group(1)) + r"}{" + inline(m.group(2), auto_math=auto_math) + r"}",
        "",
    ]

def display_formula(s):
    if not s:
        return ""
    raw = str(s).strip()

    # A formula field can be either:
    #   1) a pure LaTeX expression, which belongs in equation*, or
    #   2) prose containing several inline $...$ expressions.
    # Never put the second form inside equation*, because that nests inline
    # math delimiters inside display math and produces:
    # "Display math should end with $."
    has_inline_delimiters = bool(
        re.search(r"\$[\s\S]*?\$|\\\\\[[\s\S]*?\\\\\]|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)", raw)
    )

    if has_inline_delimiters:
        return "\n".join([
            r"\AuroreLabeledBlock{Formule}{" + inline(raw) + r"}",
            "",
        ])

    math = normalize_math(raw)

    # Content Factory formula fields may already contain a full equation*
    # environment. AuroreFormulaBlock itself provides the equation* wrapper,
    # so keeping the incoming wrapper would nest equation* inside equation*
    # and makes LuaLaTeX fail with "Bad math environment delimiter".
    # Accept both normal and JSON-overescaped equation delimiters. The
    # surrounding AuroreFormulaBlock already supplies equation*, so an
    # incoming equation* wrapper must always be removed.
    # Some payloads are not a clean standalone wrapper: extra braces or
    # surrounding serialization can leave equation* delimiters inside the
    # formula field. AuroreFormulaBlock supplies the only equation* wrapper
    # needed by the renderer, so remove any incoming equation* delimiters
    # after normalizing their JSON escaping. This also handles the exact
    # failure shape observed in production:
    #   \\begin{equation*} ... \\end{equation*}
    # ending immediately before AuroreFormulaBlock's closing brace.
    equation_wrapper = re.fullmatch(
        r"\\{1,2}begin\{equation\*\}([\\s\\S]*?)\\{1,2}end\{equation\*\}",
        math.strip(),
    )
    if equation_wrapper:
        math = equation_wrapper.group(1).strip()
    else:
        math = re.sub(r"\\{1,2}begin\{equation\*\}", "", math)
        math = re.sub(r"\\{1,2}end\{equation\*\}", "", math)
        math = math.strip()

    if math.startswith("$") and math.endswith("$"):
        math = math[1:-1].strip()
    elif math.startswith(r"\\[") and math.endswith(r"\\]"):
        math = math[2:-2].strip()
    elif math.startswith(r"\[") and math.endswith(r"\]"):
        math = math[2:-2].strip()

    return "\n".join([
        r"\AuroreFormulaBlock{" + math + r"}",
        "",
    ])


# Aurore editorial profiles are resolved before rendering so course/exercise regeneration stays isolated.
_EXERCISE_DOCUMENT_TYPES = frozenset({
    "exercice", "exercices", "exercise", "exercises",
    "serie exercices", "série exercices", "serie d exercices",
    "série d exercices", "devoir", "devoirs", "corrige", "corrigé",
    "corrige de devoir", "corrigé de devoir",
})

_COURSE_DOCUMENT_TYPES = frozenset({
    "cours", "course", "fiche de cours", "fiches cours",
    "fiche revision", "fiche de revision", "fiche de révision",
    "resume", "résumé", "document pedagogique", "document pédagogique",
})

_EXERCISE_LEAK_MARKERS = (
    "développement complémentaire",
    "pour une dérivée",
    "pour une intégrale",
    "pour une loi binomiale",
    "pour un tableau de signes",
    "pour une approximation normale",
)


def _normalized_document_type(value):
    raw = str(value or "").strip().lower()
    raw = unicodedata.normalize("NFKD", raw)
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    raw = re.sub(r"[_/\\-]+", " ", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw


def _document_kind(data):
    raw = data.get("document_type") if isinstance(data, dict) else None
    if not raw and isinstance(data.get("metadata"), dict):
        raw = data["metadata"].get("document_type")
    normalized = _normalized_document_type(raw)
    if (
        normalized in _EXERCISE_DOCUMENT_TYPES
        or "exercice" in normalized
        or "exercise" in normalized
        or "devoir" in normalized
    ):
        return "exercices"
    if normalized in _COURSE_DOCUMENT_TYPES or normalized.startswith("cours "):
        return "cours"
    return "document"


def _edition_profile(data):
    kind = _document_kind(data)
    profile = {
        "kind": kind,
        "version": "exercise-sheet-v2" if kind == "exercices" else (
            "course-v2" if kind == "cours" else "document-v1"
        ),
        "locked": False,
        "source": "document_type",
    }
    locked = data.get("_aurore_profile")
    if not isinstance(locked, dict) and isinstance(data.get("metadata"), dict):
        locked = data["metadata"].get("aurore_profile")
    if isinstance(locked, dict):
        locked_kind = _document_kind({"document_type": locked.get("document_type") or locked.get("kind")})
        if locked.get("kind") and locked_kind != kind:
            raise ValueError(
                f"Profil éditorial verrouillé incompatible avec document_type: "
                f"{locked_kind!r} != {kind!r}"
            )
        if locked.get("version"):
            profile["version"] = str(locked["version"])
        profile["locked"] = bool(locked.get("lock", locked.get("locked", True)))
        profile["source"] = str(locked.get("source") or "metadata")
    return profile


def _exercise_profile_qa_issues(data):
    """Reject course-style filler when the document contract is an exercise sheet."""
    if _document_kind(data) != "exercices":
        return []
    issues = []
    sections = data.get("sections") if isinstance(data.get("sections"), list) else []
    meta = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    instructions = data.get("instructions") if isinstance(data.get("instructions"), dict) else {}
    declared = _declared_exercise_count(data)
    paired = bool(
        meta.get("paired_corrections")
        or instructions.get("paired_corrections")
        or meta.get("exercise_pipeline")
    )
    actual = 0
    long_contents = []
    for section_index, section in enumerate(sections, start=1):
        if not isinstance(section, dict):
            issues.append(f"section {section_index}: objet invalide")
            continue
        exercises = section.get("exercises") if isinstance(section.get("exercises"), list) else []
        section_content = section.get("content")
        # A series may end with a structured editorial/support section
        # (methods, reminders, reference sheet, etc.) that intentionally
        # contains prose instead of another exercise. Such a section must
        # not be rejected merely because it has no exercises array.
        # Keep the QA strict for empty sections and for sections that contain
        # neither exercises nor usable supporting content.
        has_supporting_content = (
            isinstance(section_content, list)
            and any(clean_text(item) for item in section_content)
        )
        if not exercises and not has_supporting_content:
            issues.append(f"section {section_index}: aucun exercice structuré ni contenu de soutien")
        if isinstance(section_content, list):
            for item in section_content:
                txt = clean_text(item)
                low = txt.lower()
                if not txt:
                    continue
                if len(txt) >= 160:
                    long_contents.append(txt)
                if any(marker in low for marker in _EXERCISE_LEAK_MARKERS):
                    issues.append(
                        f"section {section_index}: contenu générique de cours détecté dans section.content"
                    )
        for ex_index, ex in enumerate(exercises, start=1):
            if not isinstance(ex, dict):
                issues.append(f"section {section_index}, exercice {ex_index}: objet invalide")
                continue
            actual += 1
            statement = ex.get("question") or ex.get("statement") or ex.get("enonce") or ex.get("content")
            correction = ex.get("solution") or ex.get("correction") or ex.get("details")
            if not clean_text(statement):
                issues.append(f"exercice {actual}: énoncé vide")
            if paired and not clean_text(correction):
                issues.append(f"exercice {actual}: corrigé apparié manquant")
            low_correction = clean_text(correction).lower()
            marker_hits = sum(marker in low_correction for marker in _EXERCISE_LEAK_MARKERS)
            if "développement complémentaire" in low_correction or marker_hits >= 3:
                issues.append(
                    f"exercice {actual}: corrigé contaminé par des blocs génériques de cours"
                )
    if declared is not None and actual != declared:
        issues.append(f"nombre d'exercices incohérent: reçu {actual}, déclaré {declared}")
    if len(long_contents) != len(set(long_contents)) and long_contents:
        issues.append("contenu de section dupliqué entre plusieurs exercices")
    return list(dict.fromkeys(issues))


def _declared_exercise_count(data):
    """Read the exercise count declared by the generation contract."""
    meta = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    instructions = data.get("instructions") if isinstance(data.get("instructions"), dict) else {}
    qa = meta.get("qa") if isinstance(meta.get("qa"), dict) else {}
    candidates = [
        data.get("exercise_count"),
        meta.get("exercise_count"),
        instructions.get("exercise_count"),
        qa.get("exercise_count"),
    ]
    for value in candidates:
        try:
            count = int(value)
        except (TypeError, ValueError):
            continue
        if count > 0:
            return count
    return None

def _has_usable_content_json(data):
    if not isinstance(data, dict):
        return False
    if not str(data.get("title") or "").strip():
        return False
    sections = data.get("sections")
    if not isinstance(sections, list) or not sections:
        return False
    if _document_kind(data) == "exercices":
        return any(
            isinstance(section, dict)
            and isinstance(section.get("exercises"), list)
            and any(
                isinstance(ex, dict)
                and any(
                    str(ex.get(key) or "").strip()
                    for key in ("question", "statement", "enonce", "content")
                )
                for ex in section.get("exercises", [])
            )
            for section in sections
        )
    if not str(data.get("introduction") or "").strip():
        return False
    return any(
        isinstance(section, dict)
        and (
            (
                isinstance(section.get("content"), list)
                and any(str(item or "").strip() for item in section.get("content", []))
            )
            or (
                isinstance(section.get("exercises"), list)
                and any(
                    isinstance(ex, dict)
                    and any(
                        str(ex.get(key) or "").strip()
                        for key in ("question", "statement", "enonce", "content", "solution", "correction")
                    )
                    for ex in section.get("exercises", [])
                )
            )
        )
        for section in sections
    )


def render(data):
    if not _has_usable_content_json(data):
        raise ValueError("LuaLaTeX source rejected: structured content_json is required")
    title = data.get("title", "")
    theme_palette = resolve_theme_palette(data)
    theme = theme_palette["strong"]
    theme_primary = theme_palette["primary"]
    theme_secondary = theme_palette["secondary"]
    subject = clean_text(data.get("subject") or "")
    level = clean_text(data.get("level") or "")
    class_name = clean_text(data.get("class_name") or "")
    author = clean_text(data.get("author") or "")
    version = clean_text(data.get("version") or "")
    info = [v for v in [subject, level, class_name] if v]
    document_identity = _document_identity(data)
    document_id = document_identity["id"]
    document_key = document_identity["key"]
    document_share_url = document_identity["verification_url"]
    profile = _editorial_profile(data)
    edition_profile = _edition_profile(data)
    document_kind = edition_profile["kind"]
    document_type = document_kind
    is_exercise_document = document_kind == "exercices"
    if is_exercise_document:
        exercise_qa = _exercise_profile_qa_issues(data)
        if exercise_qa:
            raise ValueError(
                "Exercise profile QA failed: " + " | ".join(exercise_qa[:8])
            )
    has_geogebra = _has_geogebra(data)
    lines = [
        r"\documentclass[11pt,a4paper]{article}",
        r"\usepackage{fontspec}",
        r"\usepackage{amsmath,amssymb,mathtools}",
        r"\usepackage[table]{xcolor}",
        r"\usepackage{geometry}",
        r"\usepackage{microtype}",
        r"\usepackage{enumitem}",
        r"\setlist{itemsep=1.5mm,topsep=2mm,parsep=0pt}" if not is_exercise_document else r"\setlist{itemsep=1mm,topsep=1.5mm,parsep=0pt}",
        r"\setlength{\parindent}{0pt}",
        r"\setlength{\parskip}{2.5pt}" if is_exercise_document else r"\setlength{\parskip}{3pt}",
        r"\usepackage{unicode-math}",
        r"\usepackage{polyglossia}",
        r"\setmainlanguage{french}",
        r"\IfFontExistsTF{Montserrat}{\setmainfont{Montserrat}}{\setmainfont{Latin Modern Roman}}",
        r"\setmathfont{Latin Modern Math}",
        r"\defaultfontfeatures{Ligatures=TeX}",
        r"\emergencystretch=2em",
        r"\geometry{margin=2.05cm,top=2.25cm,bottom=2.15cm}" if is_exercise_document else r"\geometry{margin=2.2cm,top=2.55cm,bottom=2.35cm}",
        r"\usepackage{graphicx}",
        r"\usepackage{qrcode}",
        r"\usepackage{caption}",
        r"\usepackage{needspace}",
        r"\usepackage{fancyhdr}",
        r"\usepackage{titlesec}",
        r"\usepackage{array}",
        r"\usepackage{tabularx}",
        r"\usepackage{hyperref}",
        r"\usepackage{tikz}",
        r"\usepackage[most]{tcolorbox}",
        r"\definecolor{aurorebase}{HTML}{" + theme + r"}",
        r"\definecolor{auroreprimary}{HTML}{" + theme_primary + r"}",
        r"\definecolor{auroresecondary}{HTML}{" + theme_secondary + r"}",
        r"\colorlet{auroredeep}{aurorebase!82!black}",
        r"\colorlet{aurorelight}{auroreprimary!10!white}",
        r"\colorlet{aurorepale}{auroreprimary!4!white}",
        r"\pagecolor{white!99!aurorepale}" if is_exercise_document else r"\pagecolor{aurorepale}",
        r"\AddToHook{shipout/background}{%",
        r"  \begin{tikzpicture}[remember picture,overlay]",
        r"    % Aurore : motif de bulles plus présent, avec plusieurs niveaux de contraste.",
        r"    \fill[auroresecondary!24] ([xshift=-1.20cm,yshift=-1.00cm]current page.north east) circle (2.55cm);",
        r"    \fill[auroreprimary!15] ([xshift=1.05cm,yshift=0.85cm]current page.north west) circle (1.55cm);",
        r"    \fill[aurorebase!11] ([xshift=-0.45cm,yshift=-9.2cm]current page.north east) circle (1.05cm);",
        r"    \fill[auroresecondary!17] ([xshift=0.80cm,yshift=-13.4cm]current page.north west) circle (1.30cm);",
        r"    \fill[auroreprimary!14] ([xshift=1.20cm,yshift=1.10cm]current page.south west) circle (2.05cm);",
        r"    \fill[auroresecondary!19] ([xshift=-1.00cm,yshift=0.90cm]current page.south east) circle (1.60cm);",
        r"    \fill[aurorebase!10] ([xshift=-2.15cm,yshift=-4.20cm]current page.south east) circle (0.72cm);",
        r"    \fill[auroreprimary!11] ([xshift=1.95cm,yshift=-5.50cm]current page.south west) circle (0.85cm);",
        r"  \end{tikzpicture}%",
        r"}",
        r"\hypersetup{hidelinks,colorlinks=true,linkcolor=auroredeep,urlcolor=auroredeep," +
        r"pdftitle={" + tex_text(title) + r"},pdfauthor={Aurore — Section Archives}," +
        r"pdfsubject={Document pédagogique},pdfkeywords={" + tex_text(document_key) + r"}}",
        r"\setlength{\headheight}{22pt}",
        r"\pagestyle{fancy}",
        r"\fancyhf{}",
        r"\renewcommand{\headrulewidth}{0.55pt}",
        r"\renewcommand{\footrulewidth}{0pt}",
        r"\fancyhead[L]{\IfFileExists{assets/aurore-logo.png}{\includegraphics[height=.60cm]{assets/aurore-logo.png}}{\textcolor{aurorebase}{\rule{.60cm}{.60cm}}}}",
        r"\fancyhead[R]{\textcolor{aurorebase!75!black}{\small\sffamily Section Archives}}",
        r"\fancyfoot[C]{\textcolor{gray}{\small Aurore — Section Archives \textbullet\; \thepage}}",
        r"\fancypagestyle{plain}{%",
        r"  \fancyhf{}%",
        r"  \renewcommand{\headrulewidth}{0.55pt}%",
        r"  \fancyhead[L]{\IfFileExists{assets/aurore-logo.png}{\includegraphics[height=.60cm]{assets/aurore-logo.png}}{\textcolor{aurorebase}{\rule{.60cm}{.60cm}}}}%",
        r"  \fancyhead[R]{\textcolor{aurorebase!75!black}{\small\sffamily Section Archives}}%",
        r"  \fancyfoot[C]{\textcolor{gray}{\small Aurore — Section Archives \textbullet\; \thepage}}%",
        r"}",
        r"\titleformat{\section}{\Large\sffamily\bfseries\color{auroredeep}}{\thesection}{0.65em}{}[\vspace{0.25ex}\textcolor{aurorebase!78!white}{\titlerule[0.7pt]}]",
        r"\titleformat{\subsection}{\large\sffamily\bfseries\color{auroredeep}}{\thesubsection}{0.6em}{}[\vspace{0.18ex}\textcolor{aurorebase!38!white}{\titlerule[0.45pt]}]",
        r"\titlespacing*{\section}{0pt}{3.0ex plus .6ex minus .2ex}{1.55ex}",
        r"\titlespacing*{\subsection}{0pt}{2.1ex plus .4ex minus .2ex}{0.95ex}",
        r"\tcbset{auroreblock/.style={enhanced,breakable,arc=11pt,outer arc=11pt,boxrule=.45pt,colframe=aurorebase!42!white,left=9pt,right=9pt,top=7pt,bottom=7pt,before skip=7pt,after skip=9pt,fonttitle=\sffamily\bfseries,pad at break*=1.5mm}}",
        r"\newcommand{\AurorePill}[1]{\tcbox[on line,boxrule=0pt,colback=aurorepale,arc=7pt,left=6pt,right=6pt,top=3pt,bottom=3pt]{\sffamily\bfseries\small\textcolor{auroredeep}{#1}}}",
        r"\newcommand{\AuroreLabeledBlock}[2]{%",
        r"  \begin{tcolorbox}[auroreblock,colback=aurorelight!72!white]%",
        r"    \AurorePill{#1}\par\smallskip #2",
        r"  \end{tcolorbox}%",
        r"}",
        r"\newcommand{\AuroreExerciseBlock}[2]{%",
        r"  \begin{tcolorbox}[auroreblock,colback=white,colframe=aurorebase!38!white,leftrule=1.5pt]%",
        r"    \AurorePill{Exercice #1}\par\smallskip #2",
        r"  \end{tcolorbox}%",
        r"}",
        r"\newcommand{\AuroreActivityBlock}[2]{%",
        r"  \begin{tcolorbox}[auroreblock,colback=white,colframe=aurorebase!38!white,leftrule=1.5pt]%",
        r"    \AurorePill{Activité #1}\par\smallskip #2",
        r"  \end{tcolorbox}%",
        r"}",
        r"\newcommand{\AuroreCorrectionBlock}[2]{%",
        r"  \begin{tcolorbox}[auroreblock,colback=aurorelight!72!white,colframe=auroredeep!38!white,leftrule=1.5pt]%",
        r"    \AurorePill{Corrigé — Exercice #1}\par\smallskip #2",
        r"  \end{tcolorbox}%",
        r"}",
        r"% Exercise-series layout: compact, math-first, isolated from the legacy course layout.",
        r"\newcommand{\AuroreExerciseSeriesHeading}[1]{%",
        r"  \par\needspace{4\baselineskip}{\sffamily\large\bfseries\color{auroredeep}#1}\par\vspace{0.18cm}\textcolor{aurorebase!55!white}{\rule{\linewidth}{0.55pt}}\vspace{0.35cm}%",
        r"}",
        r"\newcommand{\AuroreExerciseSeriesBlock}[2]{%",
        r"  \begin{tcolorbox}[enhanced,breakable,arc=6pt,boxrule=.45pt,colframe=aurorebase!55!white,colback=white,left=7pt,right=7pt,top=5pt,bottom=6pt,before skip=5pt,after skip=7pt,pad at break*=1mm]%",
        r"    {\sffamily\bfseries\color{auroredeep}Exercice #1}\par\smallskip #2%",
        r"  \end{tcolorbox}%",
        r"}",
        r"\newcommand{\AuroreExerciseSeriesCorrection}[2]{%",
        r"  \begin{tcolorbox}[enhanced,breakable,arc=6pt,boxrule=.35pt,colframe=aurorebase!28!white,colback=aurorepale,left=7pt,right=7pt,top=5pt,bottom=6pt,before skip=5pt,after skip=7pt,pad at break*=1mm]%",
        r"    {\sffamily\bfseries\color{auroredeep}Corrigé — Exercice #1}\par\smallskip #2%",
        r"  \end{tcolorbox}%",
        r"}",
        r"\newcommand{\AuroreFormulaBlock}[1]{%",
        r"  \begin{tcolorbox}[auroreblock,colback=aurorepale,colframe=aurorebase!38!white,arc=12pt,halign=center]%",
        r"    \AurorePill{Formule utile}\par\smallskip",
        r"    \begin{equation*}\displaystyle #1\end{equation*}%",
        r"  \end{tcolorbox}%",
        r"}",
        r"\newcommand{\AuroreExerciseCover}[3]{%",
        r"  \begin{tcolorbox}[enhanced,colback=white,colframe=aurorebase!48!white,arc=9pt,boxrule=.65pt,left=16pt,right=16pt,top=13pt,bottom=13pt,borderline west={3.5pt}{0pt}{auroreprimary!95!white}]%",
        r"    {\sffamily\scriptsize\bfseries\color{aurorebase!82!black}AURORE · SECTION ARCHIVES\par}",
        r"    \vspace{0.16cm}",
        r"    {\sffamily\bfseries\color{auroredeep}\fontsize{10}{12}\selectfont FICHE D'EXERCICES\par}",
        r"    \vspace{0.10cm}",
        r"    {\sffamily\bfseries\color{auroredeep}\fontsize{23}{28}\selectfont #2\par}",
        r"    \vspace{0.14cm}",
        r"    {\sffamily\small\color{aurorebase!70!black}#3\par}",
        r"  \end{tcolorbox}%",
        r"}",
        r"\newcommand{\AuroreTitleBlock}[3]{%",
        r"  \begin{tcolorbox}[enhanced,colback=white!99!aurorepale,colframe=aurorebase!28!white,arc=17pt,boxrule=.55pt,left=20pt,right=20pt,top=15pt,bottom=16pt,borderline west={2.8pt}{0pt}{auroreprimary!92!white},borderline north={0.85pt}{0pt}{auroresecondary!78!white}]%",
        r"    \centering",
        r"    {\sffamily\fontsize{8.8}{10.2}\selectfont\bfseries\color{aurorebase!80!black}AURORE\enspace ·\enspace SECTION ARCHIVES\par}",
        r"    \vspace{0.15cm}",
        r"    \AurorePill{#1}\par",
        r"    \vspace{0.18cm}",
        r"    {\sffamily\fontsize{28}{34}\selectfont\bfseries\color{auroredeep}#2\par}",
        r"    \vspace{0.22cm}",
        r"    \textcolor{auroreprimary}{\rule{0.16\linewidth}{1.35pt}}\par",
        r"    \vspace{0.16cm}",
        r"    {\sffamily\small\color{aurorebase!70!black}#3\par}",
        r"    \vspace{0.15cm}",
        r"    \textcolor{auroresecondary!62!white}{\rule{0.74\linewidth}{0.32pt}}",
        r"  \end{tcolorbox}%",
        r"}",
        r"\begin{document}",
        r"\thispagestyle{empty}",
        r"\fontsize{11.3}{16.1}\selectfont",
        r"\vspace*{0.22cm}",
        r"\noindent",
        r"\begin{tcolorbox}[enhanced,colback=white!98!aurorepale,colframe=auroreprimary!62!white,arc=11pt,boxrule=.6pt,left=3pt,right=3pt,top=3pt,bottom=3pt,width=1.74cm,height=1.74cm,valign=center,halign=center]",
        r"  \IfFileExists{assets/aurore-logo.png}{\includegraphics[width=1.42cm,height=1.42cm,keepaspectratio]{assets/aurore-logo.png}}{\textcolor{aurorebase}{\rule{1.05cm}{1.05cm}}}%",
        r"\end{tcolorbox}",
        r"\vspace{0.17cm}",
        (
            r"\AuroreExerciseCover{Série d'exercices}{" + tex_text(title) + r"}{Aurore — Section Archives" +
            (r" · " + tex_text(" · ".join(info)) if info else "") + r"}"
            if is_exercise_document
            else r"\AuroreTitleBlock{Document pédagogique}{" + tex_text(title) + r"}{Aurore — Section Archives" +
            (r" · " + tex_text(" · ".join(info)) if info else "") + r"}"
        ),
        r"\vfill",
        r"{\sffamily\small\color{gray}Document pédagogique édité avec Aurora · identité visuelle Aurore}",
        r"\clearpage",
        r"\renewcommand{\contentsname}{Sommaire}",
        r"\setcounter{tocdepth}{2}",
        r"\begin{tcolorbox}[enhanced,colback=white!92!aurorepale,colframe=aurorebase!38!white,arc=13pt,boxrule=.5pt,left=12pt,right=12pt,top=10pt,bottom=10pt]",
        r"  \AurorePill{Sommaire}\par\medskip",
        r"  \tableofcontents",
        r"\end{tcolorbox}",
        r"\clearpage",
        r"\section*{Introduction}",
        r"\addcontentsline{toc}{section}{Introduction}",
        inline(data.get("introduction", "")),
    ]
    if is_exercise_document:
        lines = lines[:-3]
        exercise_instructions = ""
        if isinstance(data.get("instructions"), dict):
            exercise_instructions = clean_text(data["instructions"].get("exercise_sheet_intro") or "")
        if not exercise_instructions:
            exercise_instructions = (
                "Traiter chaque exercice indépendamment. Justifier les étapes de calcul, "
                "indiquer les conditions de validité et terminer chaque question par une conclusion. "
                "Les corrigés sont regroupés dans une section dédiée afin de préserver l'espace de travail."
            )
        lines.extend([
            r"\section*{Consignes de travail}",
            r"\addcontentsline{toc}{section}{Consignes de travail}",
            r"\AuroreLabeledBlock{Méthode}{" + inline(exercise_instructions, auto_math=False) + r"}",
            r"\section*{Énoncés}",
            r"\addcontentsline{toc}{section}{Énoncés}",
        ])

    learning_objectives = [
        str(item).strip()
        for item in data.get("learning_objectives", []) or []
        if str(item).strip()
    ]
    if learning_objectives and not is_exercise_document:
        lines.append(r"\section*{À découvrir}")
        lines.append(r"\addcontentsline{toc}{section}{À découvrir}")
        lines.append(r"\begin{itemize}")
        for item in learning_objectives:
            lines.append(r"\item " + inline(item))
        lines.append(r"\end{itemize}")

    exercise_number = 0

    corrections_by_number = {}
    for c in data.get("corrections", []) or []:
        try:
            corrections_by_number[int(c.get("exercise_number", 0) or 0)] = c
        except (TypeError, ValueError):
            continue
    used_correction_numbers = set()

    inline_exercise_corrections = []
    declared_exercise_count = _declared_exercise_count(data) if is_exercise_document else None
    structured_exercise_count = sum(
        len(sec.get("exercises", []))
        for sec in data.get("sections", [])
        if isinstance(sec, dict) and isinstance(sec.get("exercises"), list)
    ) if is_exercise_document else 0
    if (
        is_exercise_document
        and declared_exercise_count is not None
        and structured_exercise_count < declared_exercise_count
    ):
        raise ValueError(
            "Série d'exercices incomplète: "
            f"{structured_exercise_count} exercice(s) reçu(s), "
            f"{declared_exercise_count} attendu(s)."
        )
    if (
        is_exercise_document
        and declared_exercise_count is not None
        and structured_exercise_count > declared_exercise_count
    ):
        print(
            "Exercise-series QA: "
            f"{structured_exercise_count} exercice(s) reçu(s), "
            f"{declared_exercise_count} déclaré(s); "
            "les exercices excédentaires seront ignorés."
        )

    for _idx, sec in enumerate(data.get("sections", [])):
        if is_exercise_document:
            exercises = sec.get("exercises", []) or []
            if not isinstance(exercises, list):
                exercises = []
            section_title = clean_text(sec.get("title") or "").strip()
            if section_title and len(exercises) > 1:
                lines.append(r"\AuroreExerciseSeriesHeading{" + tex_text(section_title) + r"}")
            # En profil exercices, section.content est volontairement ignoré :
            # seuls les champs structurés de l'exercice peuvent entrer dans le PDF.
            content_items = []
            if sec.get("formula"): lines.append(display_formula(sec["formula"]))
            section_graphics = sec.get("graphics", [])
            section_visuals = [v for v in (data.get("_wikimedia_visuals", []) or []) if int(v.get("section_index", -1)) == _idx]
            section_graphs = sec.get("graphs", []) or []
            if not exercises:
                lines.extend(render_graphs(section_graphs, allow=True, exercise_mode=True))
                if section_graphics:
                    graphics_root = Path(data.get("_render_assets_dir") or "assets") / "aurore" / f"section-{_idx + 1}"
                    lines.extend(render_aurore_graphics(section_graphics, graphics_root, {"primary":"#"+theme_primary,"secondary":"#"+theme_secondary,"strong":"#"+theme}))
                if section_visuals: lines.extend(render_visuals(section_visuals))
            for ex_index, ex in enumerate(exercises):
                if not isinstance(ex, dict):
                    continue
                if declared_exercise_count is not None and exercise_number >= declared_exercise_count:
                    break
                exercise_number += 1
                question = ex.get("question") or ex.get("statement") or ex.get("enonce") or ex.get("content") or ""
                inline_correction = ex.get("solution") or ex.get("correction") or ""
                body = []
                body.extend(render_exercise_text(question, mode="question"))
                if ex_index == 0:
                    body.extend(render_graphs(section_graphs, allow=True, exercise_mode=True))
                    if section_graphics:
                        graphics_root = Path(data.get("_render_assets_dir") or "assets") / "aurore" / f"section-{_idx + 1}"
                        body.extend(render_aurore_graphics(section_graphics, graphics_root, {"primary":"#"+theme_primary,"secondary":"#"+theme_secondary,"strong":"#"+theme}))
                    if section_visuals: body.extend(render_visuals(section_visuals))
                if ex.get("hint"):
                    body.append(r"\AuroreLabeledBlock{Indication}{" + inline(ex["hint"], auto_math=True) + r"}")
                if ex.get("formula"): body.append(display_formula(ex["formula"]))
                lines.append(r"\AuroreExerciseSeriesBlock{" + str(exercise_number) + r"}{" + "\n".join(body) + r"}")
                if inline_correction: inline_exercise_corrections.append((exercise_number, inline_correction))
            continue

        lines.append(r"\Needspace{6\baselineskip}")
        lines.append(r"\section{" + tex_text(sec.get("title", "")) + r"}")
        if sec.get("objective"): lines.append(r"\AuroreLabeledBlock{À découvrir}{" + inline(sec["objective"]) + r"}")
        if sec.get("formula"): lines.append(display_formula(sec["formula"]))
        content_items = sec.get("content", [])
        if isinstance(content_items, list) and sec.get("exercises"):
            content_items = [item for item in content_items if not re.match(r"^\s*Exercice\s+\d+\s*:", clean_text(item))]
        lines.extend(render_content(content_items))
        lines.extend(render_graphs(sec.get("graphs", []), allow=True))
        section_graphics = sec.get("graphics", [])
        if section_graphics:
            graphics_root = Path(data.get("_render_assets_dir") or "assets") / "aurore" / f"section-{_idx + 1}"
            lines.extend(render_aurore_graphics(section_graphics, graphics_root, {"primary":"#"+theme_primary,"secondary":"#"+theme_secondary,"strong":"#"+theme}))
        section_visuals = [v for v in (data.get("_wikimedia_visuals", []) or []) if int(v.get("section_index", -1)) == _idx]
        if section_visuals: lines.extend(render_visuals(section_visuals))
        for ex in sec.get("exercises", []):
            exercise_number += 1
            lines.append(r"\Needspace{5\baselineskip}")
            question = ex.get("question") or ex.get("statement") or ex.get("enonce") or ex.get("content") or ""
            inline_correction = ex.get("solution") or ex.get("correction") or ""
            lines.append((r"\AuroreActivityBlock{" if profile == "biologie" else r"\AuroreExerciseBlock{") + str(exercise_number) + r"}{" + inline(question) + r"}")
            if ex.get("hint"): lines.append(r"\AuroreLabeledBlock{Indication}{" + inline(ex["hint"]) + r"}")
            if ex.get("formula"): lines.append(display_formula(ex["formula"]))
            correction = corrections_by_number.get(exercise_number)
            if correction is not None:
                solution = correction.get("solution") or correction.get("correction") or correction.get("details") or ""
                lines.append(r"\Needspace{5\baselineskip}")
                lines.append(r"\AuroreCorrectionBlock{" + str(correction.get("exercise_number", exercise_number)) + r"}{" + inline(solution) + r"}")
                used_correction_numbers.add(exercise_number)
            elif inline_correction:
                lines.append(r"\Needspace{5\baselineskip}")
                lines.append(r"\AuroreCorrectionBlock{" + str(exercise_number) + r"}{" + inline(inline_correction) + r"}")

    if is_exercise_document:
        if corrections_by_number or inline_exercise_corrections:
            lines.append(r"\clearpage")
            lines.append(r"\section*{Corrigés}")
            lines.append(r"\addcontentsline{toc}{section}{Corrigés}")
        for number in sorted(corrections_by_number):
            correction = corrections_by_number[number]
            solution = correction.get("solution") or correction.get("correction") or correction.get("details") or ""
            if solution:
                correction_body = "\n".join(render_exercise_text(solution, mode="correction"))
                lines.append(r"\AuroreExerciseSeriesCorrection{" + str(number) + r"}{" + correction_body + r"}")
                used_correction_numbers.add(number)
        for number, solution in inline_exercise_corrections:
            if solution and number not in corrections_by_number:
                correction_body = "\n".join(render_exercise_text(solution, mode="correction"))
                lines.append(r"\AuroreExerciseSeriesCorrection{" + str(number) + r"}{" + correction_body + r"}")

    unmatched = [] if is_exercise_document else [
        c for c in data.get("corrections", [])
        if int(c.get("exercise_number", 0) or 0) not in used_correction_numbers
    ]
    if unmatched:
        lines.append(r"\section*{Corrections complémentaires}")
        for c in unmatched:
            lines.append(r"\Needspace{5\baselineskip}")
            lines.append(r"\AuroreCorrectionBlock{" + str(c.get("exercise_number", "")) + r"}{" + inline(c.get("solution", "")) + r"}")

    rights_lines = [
        r"\clearpage",
        r"\thispagestyle{plain}",
        r"\begin{center}",
        r"\vspace*{0.055\textheight}",
        r"\begin{tcolorbox}[enhanced,colback=white!98!aurorepale,colframe=aurorebase!30!white,arc=16pt,boxrule=.6pt,left=16pt,right=16pt,top=15pt,bottom=16pt,width=.92\linewidth]",
        r"  \AurorePill{Mentions · crédits · vérification}\par\smallskip",
        r"  {\sffamily\Large\bfseries\color{auroredeep}Édition Aurore}\par\smallskip",
        r"  {\sffamily\small\color{aurorebase!78!black}" + tex_text(title) + r"\par\medskip}",
        r"  \textcolor{auroreprimary}{\rule{0.18\linewidth}{1.15pt}}\par\medskip",
        r"  \begin{tcolorbox}[colback=aurorelight!55!white,colframe=aurorebase!20!white,arc=11pt,boxrule=.4pt,left=9pt,right=9pt,top=7pt,bottom=7pt]",
        r"    {\sffamily\scriptsize\bfseries\color{auroredeep}IDENTITÉ DE L'ÉDITION}\par\smallskip",
        r"    {\sffamily\scriptsize Identifiant : \texttt{" + document_key + r"}\hfill Version : " + (version or "1") + r"\par}",
        r"    {\sffamily\scriptsize " + tex_text(" · ".join(info) if info else "Document pédagogique Aurore") + r"\par}",
        r"  \end{tcolorbox}",
        r"  \medskip",
        r"  \begin{tcolorbox}[enhanced,colback=white,colframe=aurorebase!58!white,arc=13pt,boxrule=.65pt,left=10pt,right=10pt,top=7pt,bottom=8pt,borderline={0.7pt}{0pt}{auroreprimary!38!white}]",
        r"    \begin{tabularx}{\linewidth}{@{}X>{\centering\arraybackslash}m{2.55cm}@{}}",
        r"      \begin{minipage}[c]{\linewidth}",
        r"        {\sffamily\scriptsize\bfseries\color{auroredeep}VÉRIFICATION \& PUBLICATION}\par\smallskip",
        r"        {\sffamily\small\color{auroredeep}Veuillez scanner le QR code pour vérifier cette édition.\par}",
        (r"        \medskip" + r"        {\sffamily\scriptsize\color{aurorebase!80!black}Graphiques : GeoGebra®\par}") if has_geogebra else "",
        r"      \end{minipage} &",
    ]
    if document_id is not None:
        rights_lines.extend([
            r"      \raisebox{0.62cm}[2.30cm][0pt]{\qrcode[height=2.12cm]{" + document_share_url + r"}}",
        ])
    else:
        rights_lines.append(r"      \rule{0pt}{2.30cm}")
    rights_lines.extend([
        r"      \\",
        r"    \end{tabularx}",
        r"  \end{tcolorbox}",
        r"  \medskip",
        r"  \begin{tcolorbox}[colback=aurorepale,colframe=aurorebase!18!white,arc=10pt,boxrule=.35pt,left=9pt,right=9pt,top=6pt,bottom=6pt]",
        r"    {\sffamily\normalsize\bfseries\color{auroredeep}DROITS \& RÉUTILISATION}\par\smallskip",
        r"    \textcolor{auroreprimary}{\rule{0.16\linewidth}{1.0pt}}\par\smallskip",
        r"    {\sffamily\small\color{auroredeep}Cette édition constitue une création éditoriale d'Aurore. Les connaissances générales et formules restent réutilisables sous réserve des droits applicables aux éléments tiers.\par}",
        r"    {\sffamily\footnotesize\color{gray}Les ressources tierces conservent leurs propres licences et conditions d'utilisation.\par}",
        r"  \end{tcolorbox}",
        r"  \medskip",
        r"  {\sffamily\scriptsize\color{gray}Assistance éditoriale : Aurore · Couleur dominante : \#" + theme + r"\par}",
        r"  \end{tcolorbox}",
        r"\end{center}",
    ])
    lines.extend(rights_lines)
    lines.extend(render_wikimedia_references(data.get("_wikimedia_visuals", [])))
    lines.append(r"\end{document}")
    return "\n".join(lines)


def main():
    # Guardrails for both production failure modes:
    # 1) doubled JSON backslashes must become real LaTeX commands;
    # 2) array row breaks must remain doubled backslashes.
    _probe = r"$\\begin{array}{c|ccccc} x & -\\infty & & 0 & & +\\infty \\ \\hline f(x) & 0 & \\nearrow & 1 & \\nearrow & +\\infty \\end{array}$"
    _probe_out = inline(_probe)
    if r"\textbackslash{}begin" in _probe_out:
        raise SystemExit("inline() math guardrail failed: escaped math command")
    if r"\begin{array}" not in _probe_out or r"\infty" not in _probe_out:
        raise SystemExit("inline() math guardrail failed: array structure")
    if r"\\ \hline" not in _probe_out and r"\\\hline" not in _probe_out:
        raise SystemExit("inline() math guardrail failed: array row break before hline")
    if "__AURORA_ARRAY_ROWBREAK__" in _probe_out:
        raise SystemExit("inline() math guardrail failed: protected array row break leaked")

    _probe_percent = inline(r"$25\\%$")
    if r"25\%" not in _probe_percent or r"25\\%" in _probe_percent:
        raise SystemExit("inline() math guardrail failed: doubled TeX punctuation")

    parser = argparse.ArgumentParser(description="Render an Aurore document JSON to LuaLaTeX source.")
    parser.add_argument("input", nargs="?", default="fixtures/document-21.json")
    parser.add_argument("-o", "--output", default=None)
    args = parser.parse_args()

    src = Path(args.input)
    out = Path(args.output) if args.output else src.with_suffix(".tex")
    data = json.loads(src.read_text(encoding="utf-8"))
    out.parent.mkdir(parents=True, exist_ok=True)

    if not _has_usable_content_json(data):
        raise SystemExit("Structured content_json is missing or unusable")

    profile = _editorial_profile(data)
    geogebra_count = _fetch_geogebra_assets(data, out.parent)
    print(f"GeoGebra assets fetched: {geogebra_count}")
    raw_document_type = data.get("document_type")
    if not raw_document_type and isinstance(data.get("metadata"), dict):
        raw_document_type = data["metadata"].get("document_type")
    main_document_type = str(raw_document_type or "").strip().lower()
    requested_profile = _edition_profile(data)
    main_is_exercise_document = requested_profile["kind"] == "exercices"
    main_metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    print(
        f"Document profile: kind={requested_profile['kind']} "
        f"version={requested_profile['version']} locked={requested_profile['locked']}"
    )
    main_graphics = main_metadata.get("graphics") if isinstance(main_metadata.get("graphics"), dict) else {}
    external_images_disabled = (
        main_graphics.get("wikimedia") is False
        or main_graphics.get("external_images") is False
        or main_metadata.get("exercise_pipeline") is True
        or data.get("exercise_pipeline") is True
        or requested_profile["kind"] == "exercices"
    )

    if main_is_exercise_document and external_images_disabled:
        data["_wikimedia_visuals"] = []
        data["_visual_qa"] = {
            "mode": "disabled",
            "reason": "exercise_series_external_images_disabled",
            "planned": 0,
            "selected": 0,
            "retrieved": 0,
            "embedded": 0,
            "required_planned": 0,
            "required_retrieved": 0,
            "required_missing": 0,
            "failed": 0,
            "status": "pass",
            "editorial_cap": 0,
        }
        print("Wikimedia visuals disabled for exercise-series production.")
    else:
        data["_wikimedia_visuals"] = _fetch_wikimedia_visuals(
            data, out.parent / "assets", profile
        )
    valid_wikimedia_visuals = []
    for visual in data["_wikimedia_visuals"]:
        visual_file = out.parent / str(visual.get("path") or "")
        if not visual_file.is_file() or visual_file.stat().st_size == 0:
            print(
                f"WARNING: Wikimedia asset missing or empty: {visual_file} — "
                "visual omitted; PDF generation continues."
            )
            continue
        valid_wikimedia_visuals.append(visual)
    data["_wikimedia_visuals"] = valid_wikimedia_visuals
    if isinstance(data.get("_visual_qa"), dict):
        data["_visual_qa"]["retrieved"] = len(valid_wikimedia_visuals)
    print(
        f"Wikimedia visuals fetched: {len(data['_wikimedia_visuals'])} "
        f"(profile={profile})"
    )
    data["_render_assets_dir"] = str(out.parent / "assets")
    tex = render(data)
    missing_embedded = [
        str(v.get("path") or "")
        for v in data["_wikimedia_visuals"]
        if str(v.get("path") or "") and str(v.get("path") or "") not in tex
    ]
    if missing_embedded:
        data["_visual_qa"]["status"] = "warning"
        data["_visual_qa"]["embedded"] = len(data["_wikimedia_visuals"]) - len(missing_embedded)
        data["_visual_qa"]["embedded_missing"] = missing_embedded
        print(
            "WARNING: Wikimedia visual(s) were fetched but not embedded in LaTeX: "
            + ", ".join(missing_embedded)
            + " — PDF generation continues."
        )
    else:
        data["_visual_qa"]["embedded"] = len(data["_wikimedia_visuals"])
    if data["_visual_qa"].get("status") == "blocked":
        data["_visual_qa"]["status"] = "warning"
    if data["_visual_qa"].get("failed", 0):
        data["_visual_qa"]["status"] = "warning"
    out.write_text(tex, encoding="utf-8")
    qa_path = out.with_suffix(".visual-qa.json")
    qa_path.write_text(json.dumps(data["_visual_qa"], ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wikimedia visual QA saved: {qa_path}")
    print(f"Generated {out}")


if __name__ == "__main__":
    main()