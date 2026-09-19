#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path


def tex_text(s):
    s = str(s or "")
    return (
        s.replace("\\", r"\textbackslash{}")
         .replace("&", r"\&").replace("%", r"\%").replace("#", r"\#")
         .replace("_", r"\_").replace("{", r"\{").replace("}", r"\}")
    )


def normalize_math(s):
    """
    Normalize JSON-escaped LaTeX commands inside math.

    Content Factory payloads can contain two backslashes for a single
    LaTeX command (for example \\exp or \\infty). Collapse only doubled
    backslashes that introduce a command or an escaped brace. Preserve
    doubled backslashes used as array/alignment row breaks.
    """
    s = str(s or "")
    return re.sub(r"\\\\(?=[A-Za-z{}])", lambda _m: "\\", s)


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
    if stripped.startswith("$") and stripped.endswith("$") and len(stripped) >= 4:
        return r"\[" + normalize_math(stripped[2:-2].strip()) + r"\]"
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
    return "|" in s and len([p for p in s.split("|") if p.strip()]) >= 2


def _strip_list_marker(s):
    return re.sub(r"^\s*(?:\d+[.)]|[-*•])\s+", "", str(s or "")).strip()


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
        raw = str(items[i] or "").strip()
        if not raw:
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
        r"\usepackage{unicode-math}",
        r"\usepackage{polyglossia}",
        r"\setmainlanguage{french}",
        r"\setmainfont{Latin Modern Roman}",
        r"\setmathfont{Latin Modern Math}",
        r"\geometry{margin=2.2cm}",
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

    for sec in data.get("sections", []):
        lines.append(r"\section{" + tex_text(sec.get("title", "")) + r"}")
        lines.extend(render_content(sec.get("content", [])))

        if sec.get("formula"):
            lines.append(display_formula(sec["formula"]))

        for i, ex in enumerate(sec.get("exercises", []), 1):
            lines.append(r"\subsection*{Exercice " + str(i) + "}")
            lines.append(inline(ex.get("question", "")) + "\n\n")
            if ex.get("hint"):
                lines.append(r"\textit{Indication :} " + inline(ex["hint"]) + "\n\n")
            if ex.get("formula"):
                lines.append(display_formula(ex["formula"]))

    if data.get("corrections"):
        lines.append(r"\section*{Corrections}")
        for c in data["corrections"]:
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
    if "\\textbackslash{}begin" in _probe_out:
        raise SystemExit("inline() math guardrail failed: escaped math command")
    if r"\begin{array}" not in _probe_out or r"\infty" not in _probe_out or "\\\\ \\hline" not in _probe_out:
        raise SystemExit("inline() math guardrail failed: array structure")
    _exp_probe = inline(r"$\\exp(x)$")
    if r"\exp(x)" not in _exp_probe or "$" in _exp_probe:
        raise SystemExit("inline() math guardrail failed: exp command")

    _mixed_probe = inline(r"$(e^x)^n = e^{nx}$ pour tout entier $n$")
    if _mixed_probe != r"\[(e^x)^n = e^{nx}\] pour tout entier \[n\]":
        raise SystemExit("inline() math guardrail failed: mixed inline formulas")

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
