#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

# Production layout hardening test trigger: 2026-09-19.


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
            out.append(r"\[" + normalize_math(p[1:-1].strip()) + r"\]")
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

    spec = "|" + "l" * width + "|"
    out = [r"\begin{center}", r"\begin{tabular}{" + spec + "}", r"\hline"]
    for i, row in enumerate(cells):
        out.append(" & ".join(inline(c) for c in row) + r"\\")
        if i == 0:
            out.append(r"\hline")
    out += [r"\hline", r"\end{tabular}", r"\end{center}"]
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

        lines.append(inline(raw))
        lines.append("")
        i += 1

    return lines


def render_graphs(graphs):
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
            r"\begin{figure}[htbp]",
            r"\centering",
            r"\includegraphics[width=0.92\linewidth,height=10.5cm,keepaspectratio]{" + safe_path + r"}",
            r"\caption{" + title + r"}",
            r"\end{figure}",
            "",
        ])
    return lines


def display_formula(s):
    if not s:
        return ""
    return "\n\\[\n" + normalize_math(str(s).strip()) + "\n\\]\n"


def render(data):
    title = data.get("title", "")
    lines = [
        r"\documentclass[11pt,a4paper]{article}",
        r"\usepackage{fontspec}",
        r"\usepackage{amsmath,amssymb,mathtools}",
        r"\usepackage{geometry}",
        r"\usepackage{microtype}",
        r"\usepackage{enumitem}",
        r"\setlist{itemsep=1.5mm,topsep=2mm,parsep=0pt}",
        r"\setlength{\parindent}{0pt}",
        r"\setlength{\parskip}{3pt}",
        r"\usepackage{unicode-math}",
        r"\usepackage{polyglossia}",
        r"\setmainlanguage{french}",
        r"\setmainfont{Latin Modern Roman}",
        r"\setmathfont{Latin Modern Math}",
        r"\geometry{margin=2.2cm}",
        r"\usepackage{graphicx}",
        r"\usepackage{caption}",
        r"\usepackage{needspace}",
        r"\usepackage{hyperref}",
        r"\hypersetup{hidelinks}",
        r"\title{" + tex_text(title) + r"}",
        r"\author{Aurore — Section Archives}",
        r"\date{}",
        r"\begin{document}",
        r"\maketitle",
        r"\section*{Introduction}",
        inline(data.get("introduction", "")),
        r"\section*{Objectifs d'apprentissage}",
        r"\begin{itemize}",
    ]

    for item in data.get("learning_objectives", []):
        lines.append(r"\item " + inline(item))
    lines.append(r"\end{itemize}")

    exercise_number = 0

    for sec in data.get("sections", []):
        lines.append(r"\Needspace{6\baselineskip}")
        lines.append(r"\section{" + tex_text(sec.get("title", "")) + r"}")
        if sec.get("objective"):
            lines.append(r"\begin{quote}")
            lines.append(r"\textbf{Objectif :} " + inline(sec["objective"]))
            lines.append(r"\end{quote}")
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
        lines.extend(render_graphs(sec.get("graphs", [])))

        for ex in sec.get("exercises", []):
            exercise_number += 1
            lines.append(r"\Needspace{5\baselineskip}")
            lines.append(r"\subsection*{Exercice " + str(exercise_number) + "}")
            lines.append(inline(ex.get("question", "")) + "\n\n")
            if ex.get("hint"):
                lines.append(r"\textit{Indication :} " + inline(ex["hint"]) + "\n\n")
            if ex.get("formula"):
                lines.append(display_formula(ex["formula"]))

    if data.get("corrections"):
        lines.append(r"\section*{Corrections}")
        for c in data["corrections"]:
            lines.append(r"\Needspace{5\baselineskip}")
            lines.append(r"\subsection*{Exercice " + str(c.get("exercise_number", "")) + "}")
            lines.append(inline(c.get("solution", "")) + "\n\n")

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
    if _mixed_probe != r"\[(e^x)^n = e^{nx}\] pour tout entier \[n\]":
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
    out.write_text(render(data), encoding="utf-8")
    print(f"Generated {out}")


if __name__ == "__main__":
    main()
