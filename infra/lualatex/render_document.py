#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

AURORE_SITE_URL = "https://aurore-section-archivescom.vercel.app/"
DEFAULT_THEME_COLOR = "6D28D9"

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

# Production layout hardening test trigger: 2026-09-19.


def _document_identity(data):
    """Return a stable Aurore identifier and public document URL when available."""
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
    share_url = f"{AURORE_SITE_URL}?document={document_id}" if document_id is not None else AURORE_SITE_URL
    return {"id": document_id, "key": key, "year": year, "share_url": share_url}

def _has_geogebra(data):
    """Detect GeoGebra content from the structured graph payload."""
    sections = data.get("sections", []) if isinstance(data.get("sections"), list) else []
    for section in sections:
        if not isinstance(section, dict):
            continue
        graphs = section.get("graphs", [])
        if isinstance(graphs, list) and any(
            isinstance(g, dict) and (g.get("graph_local_path") or g.get("geogebra_image_path"))
            for g in graphs
        ):
            return True
    return False



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

def _fetch_wikimedia_visuals(data, assets_dir, profile):
    if profile not in ("biologie", "experimental", "histoire_geographie", "francais_litterature"):
        return []
    import urllib.parse
    import urllib.request
    assets_dir.mkdir(parents=True, exist_ok=True)
    if profile == "biologie":
        queries = ["eukaryotic cell diagram", "animal eukaryotic cell organelles"] if re.search(r"cellule|organite|eucary", f"{data.get('title','')} {data.get('subject','')}", re.I) else [f"{data.get('title','')} biology diagram"]
    else:
        queries = [f"{data.get('title','')} {data.get('subject','')} educational diagram"]
    visuals, seen = [], set()
    for query in queries:
        if len(visuals) >= 2:
            break
        try:
            api = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=" + urllib.parse.quote(query) + "&prop=imageinfo&iiprop=url|size|mime|thumbmime|extmetadata&iilimit=1&iiurlwidth=1200&iiextmetadataversion=latest"
            req = urllib.request.Request(api, headers={"User-Agent":"Aurore-Section-Archives/1.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                pages = list((json.loads(resp.read().decode("utf-8")).get("query") or {}).get("pages", {}).values())
            for page in pages:
                ii = (page.get("imageinfo") or [{}])[0]
                meta = ii.get("extmetadata") or {}
                mime, url = str(ii.get("mime") or "").lower(), str(ii.get("thumburl") or "")
                rawlic = " ".join(str(meta.get(k,{}).get("value","") if isinstance(meta.get(k),dict) else meta.get(k,"")) for k in ("LicenseShortName","UsageTerms","License")).lower()
                if mime not in ("image/jpeg","image/png") or not url.startswith("https://upload.wikimedia.org/"):
                    continue
                if int(ii.get("width") or 0) < 500 or int(ii.get("height") or 0) < 300:
                    continue
                if any(x in rawlic for x in ("fair use","non-commercial","noncommercial","no derivatives")):
                    continue
                if not any(x in rawlic for x in ("public domain","cc0","creative commons zero","cc by","cc-by")) or url in seen:
                    continue
                try:
                    req = urllib.request.Request(url, headers={"User-Agent":"Aurore-Section-Archives/1.0"})
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        blob = resp.read()
                    if not (10000 <= len(blob) <= 2500000):
                        continue
                    ext = ".png" if mime == "image/png" else ".jpg"
                    local = assets_dir / f"wikimedia-{len(visuals)+1}{ext}"
                    local.write_bytes(blob)
                    def mv(k, default=""):
                        v=meta.get(k, {})
                        return str(v.get("value", default) if isinstance(v,dict) else v)
                    title = str(page.get("title") or "").replace("File:","",1)
                    visuals.append({"path":str(local.relative_to(assets_dir.parent)).replace("\\\\","/"),"title":clean_text(title),"caption":clean_text(mv("ImageDescription",title))[:220],"author":clean_text(mv("Artist","Auteur non renseigné"))[:180],"license":clean_text(mv("LicenseShortName",mv("UsageTerms","Licence libre Commons")))[:120],"source_url":str(ii.get("descriptionurl") or "https://commons.wikimedia.org/wiki/"+urllib.parse.quote(str(page.get("title") or "")))})
                    seen.add(url)
                    break
                except Exception:
                    continue
        except Exception:
            continue
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
    lines=[r"\clearpage",r"\section*{Références visuelles}",r"\addcontentsline{toc}{section}{Références visuelles}",r"{\sffamily\small Illustrations issues de Wikimedia Commons ; licence et auteur indiqués fichier par fichier.}",""]
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


def normalize_math(s):
    """
    Normalize JSON-escaped LaTeX commands inside math.

    Content Factory payloads can contain doubled backslashes for commands
    (for example \\exp or \\infty). Collapse those command escapes while
    preserving the doubled backslashes used as array/alignment row breaks,
    including row breaks immediately before \\hline or \\cline.
    """
    s = clean_text(s)

    # Protect LaTeX row breaks before normalizing command escapes.
    marker = "__AURORA_ARRAY_ROWBREAK__"
    s = re.sub(
        r"\\\\(?=\s*(?:&|\\(?:hline|cline)|$))",
        marker,
        s,
    )

    # A JSON-escaped command such as \\exp represents one LaTeX command
    # backslash. Do not touch protected array row breaks.
    s = re.sub(r"\\\\(?=[A-Za-z{}])", lambda _m: "\\", s)

    # Restore protected row breaks as real LaTeX double-backslash commands.
    s = s.replace(marker, "\\\\")

    # Some Content Factory payloads can arrive with a single backslash
    # before a horizontal rule ("\\ \\hline") instead of the required
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

def inline(s):
    """
    Escape ordinary text while preserving LaTeX math blocks.

    Content Factory may emit inline or display math, including multiline
    array environments. Math must never pass through tex_text(), otherwise
    backslashes, braces and alignment markers are escaped into invalid TeX.
    """
    s = str(s or "")
    stripped = s.strip()

    # A whole item may be an explicit display-math block. Single-dollar
    # math is intentionally handled only by the regex below so a sentence
    # containing several formulas cannot be mistaken for one math block.
    if stripped.startswith(r"\[") and stripped.endswith(r"\]"):
        return normalize_math(stripped)

    pattern = re.compile(r"(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[\s\S]*?\$)")
    parts = pattern.split(s)
    out = []
    for p in parts:
        if not p:
            continue
        if p.startswith("$$") and p.endswith("$$") and len(p) >= 4:
            out.append(r"\[" + normalize_math(p[2:-2].strip()) + r"\]")
        elif p.startswith(r"\[") and p.endswith(r"\]"):
            out.append(normalize_math(p))
        elif p.startswith("$") and p.endswith("$") and len(p) >= 2:
            out.append(r"\(" + normalize_math(p[1:-1].strip()) + r"\)")
        else:
            out.append(tex_text(p))
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


def render_content(items):
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
            lines.extend(r"\item " + inline(x) for x in group)
            lines.append(r"\end{enumerate}")
            continue

        if _is_bullet(raw):
            group = []
            while i < len(items) and _is_bullet(str(items[i] or "").strip()):
                group.append(_strip_list_marker(items[i]))
                i += 1
            lines.append(r"\begin{itemize}")
            lines.extend(r"\item " + inline(x) for x in group)
            lines.append(r"\end{itemize}")
            continue

        block = labeled_block(raw)
        if block:
            lines.extend(block)
            i += 1
            continue
        lines.append(inline(raw))
        lines.append("")
        i += 1

    return lines


def render_graphs(graphs, allow=True):
    if not allow:
        return []
    if not isinstance(graphs, list):
        return []
    lines = []
    for graph in graphs:
        if not isinstance(graph, dict):
            continue
        local_path = str(graph.get("graph_local_path") or "").strip()
        if not local_path:
            continue
        safe_path = local_path.replace("\\", "/").replace("#", "\\#").replace("%", "\\%")
        title = tex_text(graph.get("title") or "Graphique")
        lines.extend([
            r"\begin{tcolorbox}[enhanced,breakable,colback=white,colframe=aurorebase,arc=7pt,boxrule=.45pt,left=8pt,right=8pt,top=8pt,bottom=8pt]",
            r"\centering",
            r"\includegraphics[width=0.92\linewidth,height=10.5cm,keepaspectratio]{" + safe_path + r"}",
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


def labeled_block(s):
    """Render a small editorial callout when prose starts with a known label."""
    t = clean_text(s).strip()
    m = re.match(
        r"^(Définition|Propriété|Théorème|Lemme|Méthode|Exemple|Remarque|Important|À retenir|Conseil|Erreur(?: fréquente)?|Observation)\s*[:\-]\s*(.+)$",
        t,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return []
    return [
        r"\AuroreLabeledBlock{" + tex_text(m.group(1)) + r"}{" + inline(m.group(2)) + r"}",
        "",
    ]

def display_formula(s):
    if not s:
        return ""
    math = normalize_math(str(s).strip())
    return "\n".join([
        r"\AuroreFormulaBlock{" + math + r"}",
        "",
    ])


def render(data):
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
    document_share_url = document_identity["share_url"]
    profile = _editorial_profile(data)
    has_geogebra = _has_geogebra(data) and profile == "scientifique"
    lines = [
        r"\documentclass[11pt,a4paper]{article}",
        r"\usepackage{fontspec}",
        r"\usepackage{amsmath,amssymb,mathtools}",
        r"\usepackage[table]{xcolor}",
        r"\usepackage{geometry}",
        r"\usepackage{microtype}",
        r"\usepackage{enumitem}",
        r"\setlist{itemsep=1.5mm,topsep=2mm,parsep=0pt}",
        r"\setlength{\parindent}{0pt}",
        r"\setlength{\parskip}{3pt}",
        r"\usepackage{unicode-math}",
        r"\usepackage{polyglossia}",
        r"\setmainlanguage{french}",
        r"\IfFontExistsTF{Montserrat}{\setmainfont{Montserrat}}{\setmainfont{Latin Modern Roman}}",
        r"\setmathfont{Latin Modern Math}",
        r"\defaultfontfeatures{Ligatures=TeX}",
        r"\emergencystretch=2em",
        r"\geometry{margin=2.2cm,top=2.55cm,bottom=2.35cm}",
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
        r"\colorlet{aurorepale}{auroreprimary!3!white}",
        r"\pagecolor{aurorepale}",
        r"\AddToHook{shipout/background}{%",
        r"  \begin{tikzpicture}[remember picture,overlay]",
        r"    % Aurore : bulles décoratives plus nombreuses, visibles mais très pâles.",
        r"    \fill[auroresecondary!16] ([xshift=-1.20cm,yshift=-1.00cm]current page.north east) circle (2.55cm);",
        r"    \fill[auroreprimary!9] ([xshift=1.05cm,yshift=0.85cm]current page.north west) circle (1.55cm);",
        r"    \fill[aurorebase!8] ([xshift=-0.45cm,yshift=-9.2cm]current page.north east) circle (1.05cm);",
        r"    \fill[auroresecondary!10] ([xshift=0.80cm,yshift=-13.4cm]current page.north west) circle (1.30cm);",
        r"    \fill[auroreprimary!8] ([xshift=1.20cm,yshift=1.10cm]current page.south west) circle (2.05cm);",
        r"    \fill[auroresecondary!11] ([xshift=-1.00cm,yshift=0.90cm]current page.south east) circle (1.60cm);",
        r"    \fill[aurorebase!7] ([xshift=-2.15cm,yshift=-4.20cm]current page.south east) circle (0.72cm);",
        r"    \fill[auroreprimary!6] ([xshift=1.95cm,yshift=-5.50cm]current page.south west) circle (0.85cm);",
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
        r"\fancyhead[L]{\IfFileExists{assets/aurore-logo.png}{\includegraphics[height=.58cm]{assets/aurore-logo.png}}{\textcolor{aurorebase}{\rule{.58cm}{.58cm}}}}",
        r"\fancyhead[R]{\textcolor{aurorebase!75!black}{\small\sffamily Section Archives}}",
        r"\fancyfoot[C]{\textcolor{gray}{\small Aurore — Section Archives \textbullet\; \thepage}}",
        r"\fancypagestyle{plain}{%",
        r"  \fancyhf{}%",
        r"  \renewcommand{\headrulewidth}{0.55pt}%",
        r"  \fancyhead[L]{\IfFileExists{assets/aurore-logo.png}{\includegraphics[height=.58cm]{assets/aurore-logo.png}}{\textcolor{aurorebase}{\rule{.58cm}{.58cm}}}}%",
        r"  \fancyhead[R]{\textcolor{aurorebase!75!black}{\small\sffamily Section Archives}}%",
        r"  \fancyfoot[C]{\textcolor{gray}{\small Aurore — Section Archives \textbullet\; \thepage}}%",
        r"}",
        r"\titleformat{\section}{\Large\sffamily\bfseries\color{auroredeep}}{\thesection}{0.65em}{}",
        r"\titleformat{\subsection}{\large\sffamily\bfseries\color{auroredeep}}{\thesubsection}{0.6em}{}",
        r"\titlespacing*{\section}{0pt}{3.0ex plus .6ex minus .2ex}{1.3ex}",
        r"\titlespacing*{\subsection}{0pt}{2.1ex plus .4ex minus .2ex}{0.8ex}",
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
        r"\newcommand{\AuroreFormulaBlock}[1]{%",
        r"  \begin{tcolorbox}[auroreblock,colback=aurorepale,colframe=aurorebase!38!white,arc=12pt,halign=center]%",
        r"    \AurorePill{Formule}\par\smallskip",
        r"    \begin{equation*}\displaystyle #1\end{equation*}%",
        r"  \end{tcolorbox}%",
        r"}",
        r"\newcommand{\AuroreTitleBlock}[3]{%",
        r"  \begin{tcolorbox}[enhanced,colback=white!96!aurorepale,colframe=aurorebase!28!white,arc=16pt,boxrule=.55pt,left=16pt,right=16pt,top=14pt,bottom=15pt,borderline west={2pt}{0pt}{aurorebase!75!white}]%",
        r"    \AurorePill{#1}\par\medskip",
        r"    {\sffamily\fontsize{28.5}{34}\selectfont\bfseries\color{auroredeep}#2\par}",
        r"    \vspace{0.45cm}",
        r"    \textcolor{auroreprimary}{\rule{0.18\linewidth}{1.25pt}}\par",
        r"    \vspace{0.45cm}",
        r"    {\sffamily\normalsize\color{aurorebase!78!black}#3\par}",
        r"  \end{tcolorbox}%",
        r"}",
        r"\begin{document}",
        r"\thispagestyle{empty}",
        r"\fontsize{11.3}{16.1}\selectfont",
        r"\vspace*{0.55cm}",
        r"\begin{flushleft}",
        r"\IfFileExists{assets/aurore-logo.png}{%",
        r"  \includegraphics[height=.78cm]{assets/aurore-logo.png}%",
        r"}{%",
        r"  \AurorePill{AURORE}%",
        r"}",
        r"\end{flushleft}",
        r"\vspace{0.95cm}",
        r"\AuroreTitleBlock{Document pédagogique}{" + tex_text(title) + r"}{Aurore — Section Archives" + (r" · " + tex_text(" · ".join(info)) if info else "") + r"}",
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
        r"\section*{Objectifs d'apprentissage}",
        r"\addcontentsline{toc}{section}{Objectifs d'apprentissage}",
        r"\begin{itemize}",
    ]

    for item in data.get("learning_objectives", []):
        lines.append(r"\item " + inline(item))
    lines.append(r"\end{itemize}")

    exercise_number = 0

    for _idx, sec in enumerate(data.get("sections", [])):
        lines.append(r"\Needspace{6\baselineskip}")
        lines.append(r"\section{" + tex_text(sec.get("title", "")) + r"}")
        if sec.get("objective"):
            lines.append(r"\AuroreLabeledBlock{Objectif}{" + inline(sec["objective"]) + r"}")
        if sec.get("formula"):
            lines.append(display_formula(sec["formula"]))
        content_items = sec.get("content", [])
        # Content Factory may also emit a prose list such as
        # "Exercice 1 : ..." while the structured exercises array below
        # contains the same exercises. Render the structured version only.
        if isinstance(content_items, list) and sec.get("exercises"):
            content_items = [
                item for item in content_items
                if not re.match(r"^\s*Exercice\s+\d+\s*:", clean_text(item))
            ]
        lines.extend(render_content(content_items))
        allow_graphs = (profile == "scientifique" or (profile == "experimental" and any(isinstance(g, dict) and g.get("style") != "geogebra" for g in (sec.get("graphs", []) or []))))
        lines.extend(render_graphs(sec.get("graphs", []), allow=allow_graphs))
        if profile in ("biologie", "experimental", "histoire_geographie", "francais_litterature") and (_idx == 2 if profile == "biologie" and len(data.get("sections") or []) > 2 else _idx == 0):
            lines.extend(render_visuals(data.get("_wikimedia_visuals", [])))

        for ex in sec.get("exercises", []):
            exercise_number += 1
            lines.append(r"\Needspace{5\baselineskip}")
            block_label = "Activité" if profile == "biologie" else ("Application" if profile == "experimental" else "Exercice")
            lines.append((r"\AuroreActivityBlock{" if profile == "biologie" else r"\AuroreExerciseBlock{") + str(exercise_number) + r"}{" + inline(ex.get("question", "")) + r"}")
            if ex.get("hint"):
                hint_label = "Piste de réflexion" if profile == "biologie" else "Indication"
                lines.append(r"\AuroreLabeledBlock{" + hint_label + r"}{" + inline(ex["hint"]) + r"}")
            if ex.get("formula"):
                lines.append(display_formula(ex["formula"]))

    if data.get("corrections"):
        lines.append(r"\section*{Corrections}")
        for c in data["corrections"]:
            lines.append(r"\Needspace{5\baselineskip}")
            lines.append(r"\AuroreCorrectionBlock{" + str(c.get("exercise_number", "")) + r"}{" + inline(c.get("solution", "")) + r"}")

    rights_lines = [
        r"\clearpage",
        r"\thispagestyle{plain}",
        r"\begin{center}",
        r"\vspace*{0.08\textheight}",
        r"\begin{tcolorbox}[enhanced,colback=white!97!aurorepale,colframe=aurorebase!28!white,arc=15pt,boxrule=.55pt,left=15pt,right=15pt,top=14pt,bottom=14pt,width=.91\linewidth]",
        r"  \AurorePill{© Aurore — Section Archives}\par\medskip",
        r"  {\sffamily\small\color{auroredeep}Ce document pédagogique constitue une création éditoriale d'Aurore.\par\medskip}",
        r"  {\sffamily\small\color{auroredeep}Les connaissances, formules et notions scientifiques générales restent librement utilisables sous réserve des droits éventuellement applicables aux éléments tiers.\par\medskip}",
        r"  {\sffamily\small\color{auroredeep}Les éléments provenant de tiers restent soumis à leurs propres conditions de licence et d'utilisation.\par}",
    ]
    if has_geogebra:
        rights_lines.extend([
            r"  \medskip",
            r"  {\sffamily\small\itshape\color{aurorebase!80!black}Graphiques réalisés avec GeoGebra®\par}",
        ])
    if document_id is not None:
        rights_lines.extend([
            r"  \medskip",
            r"  \begin{minipage}[c]{0.66\linewidth}",
            r"    {\sffamily\scriptsize\color{gray}Document vérifiable sur Aurore}\par",
            r"    {\sffamily\small\href{" + document_share_url + r"}{\textcolor{auroredeep}{Vérifier ce document sur Aurore}}}\par",
            r"    {\sffamily\scriptsize\color{gray}Identifiant : \texttt{" + document_key + r"}}",
            r"  \end{minipage}",
            r"  \hfill",
            r"  \raisebox{0pt}[2.25cm][0pt]{\qrcode[height=2.05cm]{" + document_share_url + r"}}",
        ])
    rights_lines.extend([
        r"  \par\medskip",
        r"  {\sffamily\scriptsize\color{gray}" + ("Version " + (version or "1") + " · " if version else "Version 1 · ") + r"Couleur dominante Aurore : \#" + theme + r"}",
        r"\end{tcolorbox}",
        r"\end{center}",
    ])
    lines.extend(render_wikimedia_references(data.get("_wikimedia_visuals", [])))
    lines.extend(rights_lines)
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
    _exp_probe = inline(r"$\\exp(x)$")
    if r"\exp(x)" not in _exp_probe or "$" in _exp_probe:
        raise SystemExit("inline() math guardrail failed: exp command")

    # Guard against the exact malformed array row break observed in production.
    _malformed_array_probe = inline(
        r"$\begin{array}{c|c} a & b \ \hline c & d \end{array}$"
    )
    if r"\\ \hline" not in _malformed_array_probe:
        raise SystemExit("inline() math guardrail failed: malformed array row break")

    _mixed_probe = inline(r"$(e^x)^n = e^{nx}$ pour tout entier $n$")
    if _mixed_probe != r"\((e^x)^n = e^{nx}\) pour tout entier \(n\)":
        raise SystemExit("inline() math guardrail failed: mixed inline formulas")

    _array_row_probe = r"$\\begin{array}{c|ccccc} x & -\\infty & & 0 & & +\\infty \\ \\hline f(x) & 0 & \\nearrow & 1 & \\nearrow & +\\infty \\end{array}$"
    if _is_table_row(_array_row_probe):
        raise SystemExit("content guardrail failed: LaTeX array misdetected as table")

    parser = argparse.ArgumentParser(description="Render an Aurore document JSON to LuaLaTeX source.")
    parser.add_argument("input", nargs="?", default="fixtures/document-21.json")
    parser.add_argument("-o", "--output", default=None)
    args = parser.parse_args()

    src = Path(args.input)
    out = Path(args.output) if args.output else src.with_suffix(".tex")
    data = json.loads(src.read_text(encoding="utf-8"))
    out.parent.mkdir(parents=True, exist_ok=True)
    profile = _editorial_profile(data)
    data["_wikimedia_visuals"] = _fetch_wikimedia_visuals(data, out.parent / "assets", profile)
    out.write_text(render(data), encoding="utf-8")
    print(f"Generated {out}")


if __name__ == "__main__":
    main()