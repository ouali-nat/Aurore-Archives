#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

def tex_text(s):
    s = str(s or "")
    return (s.replace("\\", r"\textbackslash{}")
             .replace("&", r"\&").replace("%", r"\%").replace("#", r"\#")
             .replace("_", r"\_").replace("{", r"\{").replace("}", r"\}"))

def inline(s):
    s = str(s or "")
    # Preserve inline math while escaping ordinary text.
    parts = re.split(r"(\$[^$\n]+\$)", s)
    out = []
    for p in parts:
        if p.startswith("$") and p.endswith("$"):
            out.append("$" + p[1:-1].strip() + "$")
        else:
            out.append(tex_text(p))
    return "".join(out)

def paragraph(s):
    s = str(s or "").strip()
    if not s:
        return ""
    if s.startswith("- "):
        return r"\begin{itemize}" + "\n" + r"\item " + inline(s[2:]) + "\n" + r"\end{itemize}"
    if re.match(r"^\d+\.\s", s):
        s = re.sub(r"^\d+\.\s+", "", s)
        return r"\begin{enumerate}" + "\n" + r"\item " + inline(s) + "\n" + r"\end{enumerate}"
    return inline(s) + "\n\n"

def display_formula(s):
    if not s:
        return ""
    return "\n\\[\n" + str(s).strip() + "\n\\]\n"

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
        r"\title{" + tex_text(title) + "}",
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
        lines.append(r"\section{" + tex_text(sec.get("title", "")) + "}")
        for item in sec.get("content", []):
            lines.append(paragraph(item))
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
    parser = argparse.ArgumentParser(description="Render an Aurore document JSON to LuaLaTeX source.")
    parser.add_argument("input", nargs="?", default="fixtures/document-21.json",
                        help="Input Aurore JSON file.")
    parser.add_argument("-o", "--output", default=None,
                        help="Output .tex path. Defaults to input filename with .tex extension.")
    args = parser.parse_args()

    src = Path(args.input)
    out = Path(args.output) if args.output else src.with_suffix(".tex")

    data = json.loads(src.read_text(encoding="utf-8"))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render(data), encoding="utf-8")
    print(f"Generated {out}")

if __name__ == "__main__":
    main()
