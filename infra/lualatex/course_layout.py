"""Course PDF layout based on the native Sésamath/sesamanuel composition.

The course profile deliberately uses the real sesamanuel class rather than
recreating its visual language with the legacy Aurore tcolorbox layout.
Aurore's per-document palette is injected into the sesamanuel color families.
# Production smoke trigger: structured course refactor test.
"""


def render_course_document(data, theme_palette):
    """Render a structured Aurore course using the sesamanuel course method."""
    from render_document import (
        _document_identity,
        _declared_exercise_count,
        _is_renderable_geogebra_graph,
        clean_text,
        inline,
        normalize_math,
        render_graphs,
        _math_fragment_is_blockworthy,
        _split_embedded_math,
        render_aurore_graphics,
        tex_text,
    )

    title = clean_text(data.get("title") or "Cours")
    subject = clean_text(data.get("subject") or data.get("matiere") or "")
    level = clean_text(data.get("level") or data.get("class_name") or "")
    class_name = clean_text(data.get("class_name") or "")
    document_identity = _document_identity(data)
    document_id = document_identity.get("id")
    document_key = document_identity.get("key") or ""

    base = theme_palette["strong"]
    primary = theme_palette["primary"]
    secondary = theme_palette["secondary"]

    # Inputs accepted from current/legacy Aurore payloads.
    prereqs = (
        data.get("prerequisites")
        or data.get("prerequis")
        or (
            data.get("metadata", {}).get("prerequisites")
            if isinstance(data.get("metadata"), dict)
            else None
        )
        or []
    )
    if isinstance(prereqs, str):
        prereqs = [prereqs]
    if not isinstance(prereqs, list):
        prereqs = []
    prereqs = [clean_text(item) for item in prereqs if clean_text(item)]

    objectives = data.get("learning_objectives") or []
    if not isinstance(objectives, list):
        objectives = [objectives]
    objectives = [clean_text(item) for item in objectives if clean_text(item)]

    sections = data.get("sections") if isinstance(data.get("sections"), list) else []

    import re

    def course_relation(raw, label="Relation"):
        value = normalize_math(str(raw or "").strip())
        if not value:
            return ""
        value = re.sub(
            r"\\{1,2}begin\{equation\*\}([\s\S]*?)\\{1,2}end\{equation\*\}",
            lambda m: m.group(1).strip(),
            value,
        )
        value = re.sub(r"\\{1,2}begin\{equation\*\}", "", value)
        value = re.sub(r"\\{1,2}end\{equation\*\}", "", value).strip()
        if value.startswith("$$") and value.endswith("$$"):
            value = value[2:-2].strip()
        elif value.startswith("$") and value.endswith("$"):
            value = value[1:-1].strip()
        elif value.startswith(r"\\[") and value.endswith(r"\\]"):
            value = value[2:-2].strip()
        elif value.startswith(r"\[") and value.endswith(r"\]"):
            value = value[2:-2].strip()
        if not value:
            return ""
        return r"\AuroreCourseRelation{" + tex_text(label) + r"}{" + value + r"}"

    def direct_math(raw):
        return course_relation(raw, "Relation")

    def render_prose_with_math(raw, auto_math=True):
        """Keep prose in semantic paragraphs while isolating substantial mathematics."""
        text = clean_text(raw).replace("\r\n", "\n").replace("\r", "\n").strip()
        if not text:
            return ""
        paragraphs = [part.strip() for part in re.split(r"\n{2,}", text) if part.strip()]
        rendered = []

        for paragraph in paragraphs:
            parts = [x for x in re.split(
                r"(\$[\s\S]*?\$|\\\([\s\S]*?\\\))",
                paragraph
            ) if x]
            prose = []

            def flush_prose():
                if prose:
                    value = "".join(prose).strip()
                    prose.clear()
                    if value:
                        embedded = _split_embedded_math(value)
                        if any(kind == "math" for kind, _ in embedded):
                            for kind, piece in embedded:
                                if kind == "math":
                                    # Plain mathematical relations found inside prose
                                    # stay in the natural paragraph flow. Only explicit
                                    # display math is allowed to become a full relation block.
                                    normalized = normalize_math(piece.strip())
                                    if normalized:
                                        rendered.append(
                                            r"\\AuroreMathCompact{}{" + normalized + r"}"
                                        )
                                elif piece.strip():
                                    rendered.append(inline(piece, auto_math=auto_math))
                        else:
                            rendered.append(inline(value, auto_math=auto_math))

            for part in parts:
                stripped = part.strip()
                if not stripped:
                    continue
                if re.fullmatch(r"\$[\s\S]*?\$|\\\([\s\S]*?\\\)", part):
                    body = stripped[1:-1].strip() if stripped.startswith("$") else stripped[2:-2].strip()
                    # Inline LaTeX remains inline even when it is a complete
                    # equality or a longer calculation. This is the critical
                    # distinction from explicit $...$ / \\[...\\] display math:
                    # prose and inline formulas must keep their left-to-right flow.
                    flush_prose()
                    normalized = normalize_math(body)
                    if normalized:
                        rendered.append(
                            r"\\AuroreMathCompact{}{" + normalized + r"}"
                        )
                else:
                    prose.append(part)

            flush_prose()
            if rendered:
                rendered.append(r"\par\medskip")

        return "\n".join(x for x in rendered if x and x.strip()).rstrip()

    def split_labeled(raw):
        text = clean_text(raw).replace("\r\n", "\n").replace("\r", "\n").strip()
        if not text:
            return None, ""
        match = __import__("re").match(
            r"^(DÉFINITION|DEFINITION|PROPRIÉTÉ|PROPRIETE|THÉORÈME|THEOREME|"
            r"REMARQUE|REMARQUES|NOTATION|VOCABULAIRE|PREUVE|EXEMPLE|"
            r"MÉTHODE|METHODE|FORMULE|FORMULE UTILE|RELATION|RELATION UTILE)\s*(?::|-)?\s*(.*)$",
            text,
            flags=__import__("re").IGNORECASE | __import__("re").DOTALL,
        )
        if not match:
            return None, text
        label = match.group(1).strip().lower()
        body = match.group(2).strip()
        aliases = {
            "definition": "definition",
            "définition": "definition",
            "propriete": "propriete",
            "propriété": "propriete",
            "theoreme": "theoreme",
            "théorème": "theoreme",
            "remarque": "remarque",
            "remarques": "remarques",
            "notation": "notation",
            "vocabulaire": "vocabulaire",
            "preuve": "preuve",
            "exemple": "exemple",
            "methode": "methode",
            "méthode": "methode",
            "formule": "relation",
            "formule utile": "relation",
            "relation": "relation",
            "relation utile": "relation",
        }
        return aliases.get(label, label), body

    def render_body_text(raw, auto_math=True):
        text = clean_text(raw).replace("\r\n", "\n").replace("\r", "\n").strip()
        if not text:
            return ""

        # Preserve explicit display formulas and ordinary prose separately.
        import re
        parts = [part for part in re.split(
            r"(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))",
            text
        ) if part]
        out = []
        for part in parts:
            if part.startswith("$$") and part.endswith("$$"):
                out.append(direct_math(part[2:-2]))
            elif part.startswith(r"\[") and part.endswith(r"\]"):
                out.append(direct_math(part[2:-2]))
            elif part.startswith(r"\(") and part.endswith(r"\)"):
                out.append(r"\(" + normalize_math(part[2:-2].strip()) + r"\)")
            else:
                if part.strip():
                    out.append(inline(part, auto_math=auto_math))
        return "\n".join(out)

    def render_item(raw):
        if isinstance(raw, dict):
            text = raw.get("text") or raw.get("content") or raw.get("body") or ""
            label = clean_text(raw.get("type") or raw.get("kind") or "").lower()
            custom_title = clean_text(raw.get("title") or "")
            if label in {"definition", "propriete", "propriété", "theoreme", "théorème"}:
                env = "propriete" if label in {"propriete", "propriété"} else (
                    "theoreme" if label in {"theoreme", "théorème"} else "definition"
                )
                opt = "[" + tex_text(custom_title) + "]" if custom_title else ""
                return "\\begin{" + env + "}" + opt + "\n" + render_body_text(text) + "\n\\end{" + env + "}"
            if label in {"remarque", "notation", "vocabulaire", "preuve"}:
                return "\\begin{" + label + "}\n" + render_body_text(text) + "\n\\end{" + label + "}"
            if label in {"formula", "formule", "relation", "equation", "équation"}:
                return course_relation(text, "Relation")
            if label in {"exemple", "methode"}:
                opt = "[" + tex_text(custom_title) + "]" if custom_title else ""
                env = "methode*1" if label == "methode" else "exemple*1"
                return "\\begin{" + env + "}" + opt + "\n" + render_body_text(text) + "\n\\end{" + env + "}"
            return render_body_text(text)

        kind, body = split_labeled(raw)
        if kind in {"definition", "propriete", "theoreme"}:
            env = kind
            title_part = ""
            first_line, sep, rest = body.partition("\n")
            # A short first line followed by a long body is treated as an
            # optional subtitle only when the source explicitly used "Titre :".
            title_match = __import__("re").match(r"^([^.\n]{2,90})\s*:\s*(.*)$", first_line)
            if title_match and sep:
                title_part = "[" + tex_text(title_match.group(1).strip()) + "]"
                body = title_match.group(2).strip() + ("\n" + rest if rest else "")
            return "\\begin{" + env + "}" + title_part + "\n" + render_body_text(body) + "\n\\end{" + env + "}"

        if kind in {"remarque", "remarques", "notation", "vocabulaire", "preuve"}:
            env = "remarque" if kind == "remarques" else kind
            return "\\begin{" + env + "}\n" + render_body_text(body) + "\n\\end{" + env + "}"

        if kind == "exemple":
            return "\\begin{exemple*1}\n" + render_body_text(body) + "\n\\end{exemple*1}"

        if kind == "relation":
            return course_relation(body, "Relation")

        if kind == "methode":
            # Native sesamanuel's *1 method keeps the complete method together
            # while retaining the exact method header and spacing conventions.
            method_title, sep, method_body = body.partition("\n")
            if not sep:
                method_title = ""
                method_body = body
            opt = "[" + tex_text(method_title) + "]" if method_title else ""
            return "\\begin{methode*1}" + opt + "\n" + render_body_text(method_body) + "\n\\end{methode*1}"

        stripped = clean_text(raw)
        if stripped.startswith("|") or " | " in stripped:
            rows = [line for line in stripped.splitlines() if "|" in line]
            if len(rows) >= 2:
                cells = [
                    [cell.strip() for cell in row.strip().strip("|").split("|")]
                    for row in rows
                ]
                width = max((len(row) for row in cells), default=0)
                if width >= 2:
                    cells = [row + [""] * (width - len(row)) for row in cells]
                    table_lines = [
                        r"\begin{center}",
                        r"\small",
                        r"\begin{tabularx}{0.98\linewidth}{" + " ".join(["X"] * width) + r"}",
                        r"\hline",
                    ]
                    for idx, row in enumerate(cells):
                        table_lines.append(" & ".join(inline(cell, auto_math=True) for cell in row) + r"\\")
                        if idx == 0:
                            table_lines.append(r"\hline")
                    table_lines.extend([r"\hline", r"\end{tabularx}", r"\end{center}"])
                    return "\n".join(table_lines)

        if __import__("re").match(r"^[-*•]\s+", stripped):
            return r"\begin{itemize}" + "\n\item " + inline(__import__("re").sub(r"^[-*•]\s+", "", stripped), auto_math=True) + "\n\end{itemize}"

        if __import__("re").match(r"^\d+[.)]\s+", stripped):
            return (
                r"\begin{enumerate}" + "\n"
                + r"\item " + inline(__import__("re").sub(r"^\d+[.)]\s+", "", stripped), auto_math=True)
                + "\n\end{enumerate}"
            )

        if __import__("re").fullmatch(r"\s*(?:\$\$[\s\S]*\$\$|\\\[[\s\S]*\\\])\s*", stripped):
            return direct_math(stripped.strip("$[]\\"))

        return render_body_text(stripped, auto_math=True)

    def render_content_items(items):
        if not isinstance(items, list):
            return []
        out = []
        for item in items:
            rendered = render_item(item)
            if rendered:
                out.append(rendered)
        return out

    # Convert Aurore's current palette into the sesamanuel color vocabulary.
    # These are the actual color hooks documented by the native class.
    preamble = [
        r"\documentclass[0.6,nocrop]{sesamanuel}",
        r"\usepackage{graphicx}",
        r"\usepackage{amsmath,amssymb,mathtools}",
        r"\usepackage{tabularx}",
        r"\usepackage{longtable}",
        r"\usepackage{xcolor}",
        r"\usepackage{tikz}",
        r"\usepackage[most]{tcolorbox}",
        r"\usepackage{multicol}",
        r"\newcommand{\AuroreMathCompact}[2]{%",
        r"  \tcbox[on line,enhanced,boxrule=.45pt,colframe=AuroreBase!58!white,colback=white!99!AurorePrimary,arc=7pt,left=7pt,right=7pt,top=3pt,bottom=3pt]%",
        r"    {\ensuremath{\displaystyle #2}}%",
        r"}",
        r"\definecolor{AuroreBase}{HTML}{" + base + r"}",
        r"\definecolor{AurorePrimary}{HTML}{" + primary + r"}",
        r"\definecolor{AuroreSecondary}{HTML}{" + secondary + r"}",
        r"\NewThema{A}{a}{aurore}{Aurore}{AURORE}{AuroreBase}{AurorePrimary}",
        r"\themaA",
        # Chapter / theme frame.
        r"\colorlet{ChapterTopFrameColor}{AuroreBase}",
        r"\colorlet{ChapterBottomFrameColor}{AurorePrimary}",
        r"\colorlet{ThemaTopFrameColor}{AuroreBase}",
        r"\colorlet{ThemaBottomFrameColor}{AuroreSecondary}",
        r"\colorlet{ThemaTitleColor}{white}",
        r"\colorlet{ChapterNumBkgColor}{AuroreBase}",
        r"\colorlet{ChapterNumSquare1Color}{AuroreSecondary}",
        r"\colorlet{ChapterNumSquare2Color}{AurorePrimary}",
        r"\colorlet{ChapterNumSquare3Color}{AuroreBase}",
        r"\colorlet{ChapterNumSquare4Color}{AuroreSecondary}",
        r"\colorlet{ChapterNumSquare5Color}{AurorePrimary}",
        r"\colorlet{ChapterTitleColor}{AuroreBase}",
        r"\colorlet{ChapterNumColor}{white}",
        r"\colorlet{PrerequisTitleColor}{AuroreBase}",
        r"\colorlet{PrerequisBkgColor}{AurorePrimary!8!white}",
        r"\colorlet{PrerequisItemColor}{AuroreBase}",
        r"\colorlet{AEItemColor}{AuroreBase}",
        r"\colorlet{AETitleFrame1Color}{AuroreBase}",
        r"\colorlet{AETitleFrame2Color}{AuroreSecondary}",
        r"\colorlet{AETitleFrame3Color}{AurorePrimary}",
        r"\colorlet{AETitleColor}{white}",
        r"\colorlet{AEExoNumColor}{white}",
        r"\colorlet{AEExoNumFrameColor}{AuroreBase}",
        r"\colorlet{AEFrameColor}{AurorePrimary!6!white}",
        # Activities / course / section palette.
        r"\colorlet{ActiviteSubtitleColor}{AuroreBase}",
        r"\colorlet{ActiviteTitleColor}{white}",
        r"\colorlet{ActiviteItemColor}{AuroreBase}",
        r"\colorlet{ActivitePartieColor}{AuroreBase}",
        r"\colorlet{ActiviteActiviteTopColor}{AuroreBase}",
        r"\colorlet{ActiviteActiviteBottomColor}{AurorePrimary}",
        r"\colorlet{ActiviteDebatTopColor}{AuroreSecondary}",
        r"\colorlet{ActiviteDebatBottomColor}{AuroreBase}",
        r"\colorlet{CoursHeadFrame1Color}{AuroreBase}",
        r"\colorlet{CoursHeadFrame2Color}{AuroreSecondary}",
        r"\colorlet{CoursHeadFrame3Color}{AurorePrimary}",
        r"\colorlet{CoursHeadFrame4Color}{AuroreBase!55!white}",
        r"\colorlet{CoursHeadFrame5Color}{AurorePrimary!55!white}",
        r"\colorlet{CoursFootColor}{AuroreBase}",
        r"\colorlet{SectionFrame1Color}{AuroreBase}",
        r"\colorlet{SectionFrame2Color}{AurorePrimary}",
        r"\colorlet{SectionFrame3Color}{AuroreSecondary}",
        r"\colorlet{SectionNumColor}{white}",
        r"\colorlet{SectionTitleColor}{AuroreBase}",
        r"% Aurore course spine: continuous dominant-color guide for the course pages.",
        r"\newif\ifAuroreCourseSpine",
        r"\AuroreCourseSpinefalse",
        r"\newcommand{\AuroreCourseSpineOn}{\global\AuroreCourseSpinetrue}",
        r"\newcommand{\AuroreCourseSpineOff}{\global\AuroreCourseSpinefalse}",
        r"\AddToHook{shipout/foreground}{%",
        r"  \ifAuroreCourseSpine",
        r"    \begin{tikzpicture}[remember picture,overlay]",
        r"      \draw[AuroreBase!86!white,line width=1.05pt] ([xshift=0.78cm,yshift=-1.10cm]current page.north west) -- ([xshift=0.78cm,yshift=1.05cm]current page.south west);",
        r"    \end{tikzpicture}%",
        r"  \fi",
        r"}",
        r"\newcommand{\AuroreCourseSectionRule}{%",
        r"  \noindent\hspace*{0.05\linewidth}\textcolor{AuroreBase!62!white}{\rule{0.91\linewidth}{0.75pt}}\par\vspace{0.24cm}%",
        r"}",
        r"\newcommand{\AuroreCourseRelation}[2]{%",
        r"    \begin{tcolorbox}[enhanced,breakable,width=0.94\linewidth,colback=white!99!AurorePrimary,colframe=AuroreBase!56!white,leftrule=1.7pt,arc=9pt,outer arc=9pt,boxrule=.45pt,left=10pt,right=10pt,top=5pt,bottom=6pt,halign=center,before skip=6pt,after skip=7pt,pad at break*=1mm]%",
        r"      {\sffamily\scriptsize\bfseries\color{AuroreBase!88!black}#1}\par\vspace{2pt}%",
        r"      \begin{equation*}\displaystyle #2\end{equation*}%",
        r"    \end{tcolorbox}%",
        r"}",
        r"\colorlet{SubsectionNumColor}{AuroreBase}",
        r"\colorlet{SubsectionTitleColor}{AuroreBase}",
        # Definition/proof/example/method colors.
        r"\colorlet{DefSquareColor}{AuroreBase}",
        r"\colorlet{DefTitleColor}{AuroreBase}",
        r"\colorlet{DefSubtitleColor}{AuroreBase}",
        r"\colorlet{DefItemColor}{AuroreBase}",
        r"\colorlet{DefFrameColor}{AurorePrimary!7!white}",
        r"\colorlet{RemTitleColor}{AuroreBase}",
        r"\colorlet{RemItemColor}{AuroreBase}",
        r"\colorlet{ExempleRuleColor}{AuroreBase}",
        r"\colorlet{ExempleEdgeFrameColor}{AuroreSecondary}",
        r"\colorlet{ExempleBkgFrameColor}{AurorePrimary!7!white}",
        r"\colorlet{ExempleTitleColor}{AuroreBase}",
        r"\colorlet{ExempleItemColor}{AuroreBase}",
        r"\colorlet{MethodeTitleFrameColor}{AuroreBase}",
        r"\colorlet{MethodeTitleColor}{white}",
        r"\colorlet{MethodeSubtitleColor}{AuroreBase}",
        r"\colorlet{MethodeIntroBkgFrameColor}{AurorePrimary!6!white}",
        r"\colorlet{ExAppEdgeFrameColor}{AuroreBase}",
        r"\colorlet{ExAppBkgFrameColor}{AuroreBase}",
        r"\colorlet{ExAppTitleColor}{white}",
        r"\colorlet{ExAppCorrEdgeFrameColor}{AuroreSecondary}",
        r"\colorlet{ExAppCorrBkgFrameColor}{AurorePrimary}",
        r"\colorlet{ExAppCorrTitleColor}{white}",
        r"\colorlet{ExAppItemColor}{AuroreBase}",
        r"\colorlet{ProofRuleColor}{AuroreBase}",
        r"\colorlet{ProofTitleColor}{AuroreBase}",
        r"\colorlet{ProofTopFrameColor}{AurorePrimary!6!white}",
        r"\colorlet{ProofBottomFrameColor}{AuroreSecondary}",
        r"\colorlet{ProofTriangleFrameColor}{AuroreBase}",
        r"\colorlet{ProofItemColor}{AuroreBase}",
        # Training/exercise palette.
        r"\colorlet{ExoBaseHeadFrame1Color}{AuroreBase}",
        r"\colorlet{ExoBaseHeadFrame2Color}{AuroreSecondary}",
        r"\colorlet{ExoBaseHeadFrame3Color}{AurorePrimary}",
        r"\colorlet{ExoBaseHeadFrame4Color}{AuroreBase!55!white}",
        r"\colorlet{ExoBaseHeadFrame5Color}{AurorePrimary!55!white}",
        r"\colorlet{ExoBaseFootColor}{AuroreBase}",
        r"\colorlet{CorrigeHeadFrameColor}{AuroreBase}",
        r"\colorlet{CorrigeColumnRuleColor}{AuroreSecondary}",
        r"\setlength{\parindent}{0pt}",
        r"\begin{document}",
        r"\thispagestyle{empty}",
    ]

    # Native chapter first page.
    lines = list(preamble)
    lines.append(r"\chapter{" + tex_text(title) + "}")

    repere_items = prereqs or objectives
    if repere_items:
        label = "Prérequis et objectifs du chapitre" if prereqs and objectives else (
            "Connaissances nécessaires à ce chapitre" if prereqs else "Objectifs du chapitre"
        )
        lines.append(r"\begin{prerequis}[" + tex_text(label) + "]")
        lines.append(r"\begin{itemize}")
        for item in repere_items:
            lines.append(r"\item " + inline(item, auto_math=True))
        lines.append(r"\end{itemize}")
        lines.append(r"\end{prerequis}")

    self_assessment = data.get("self_assessment") or data.get("autoevaluation") or []
    if isinstance(self_assessment, dict):
        self_assessment = self_assessment.get("questions") or []
    if isinstance(self_assessment, list) and self_assessment:
        lines.append(r"\begin{autoeval}")
        lines.append(r"\begin{multicols}{2}")
        for q in self_assessment:
            if not isinstance(q, dict):
                q = {"question": q}
            q_text = q.get("question") or q.get("text") or q.get("content") or ""
            solution = q.get("solution") or q.get("correction") or ""
            lines.append(r"\begin{exercice}")
            lines.append(render_body_text(q_text))
            lines.append(r"\end{exercice}")
            if solution:
                lines.append(r"\begin{corrige}")
                lines.append(render_body_text(solution))
                lines.append(r"\end{corrige}")
        lines.append(r"\end{multicols}")
        lines.append(r"\end{autoeval}")

    # Course part: preserve the native Sésamath flow while adding the
    # Aurore vertical spine and a light horizontal connector per section.
    lines.append(r"\cours")
    lines.append(r"\AuroreCourseSpineOn")

    for section in sections:
        if not isinstance(section, dict):
            continue
        section_title = clean_text(section.get("title") or "").strip()
        if not section_title:
            continue
        lines.append(r"\section{" + tex_text(section_title) + "}")
        lines.append(r"\AuroreCourseSectionRule")

        objective = clean_text(section.get("objective") or "").strip()
        if objective:
            lines.append(r"\begin{remarque}")
            lines.append(r"\textbf{" + tex_text("À retenir") + r".} " + render_body_text(objective))
            lines.append(r"\end{remarque}")

        formula = section.get("formula")
        if formula:
            if isinstance(formula, list):
                for item in formula:
                    lines.append(direct_math(item))
            else:
                lines.append(direct_math(formula))

        content_items = section.get("content") if isinstance(section.get("content"), list) else []
        if content_items:
            lines.extend(render_content_items(content_items))

        graphs = section.get("graphs")
        if isinstance(graphs, list):
            valid_graphs = [g for g in graphs if _is_renderable_geogebra_graph(g)]
            if valid_graphs:
                lines.extend(render_graphs(valid_graphs, allow=True))

        graphics = section.get("graphics")
        if isinstance(graphics, list) and graphics:
            graphics_root = data.get("_render_assets_dir") or "assets"
            lines.extend(
                render_aurore_graphics(
                    graphics,
                    __import__("pathlib").Path(graphics_root) / "aurore" / "course",
                    {"primary": "#" + primary, "secondary": "#" + secondary, "strong": "#" + base},
                )
            )

        # Structured course exercises remain in the same editorial document but
        # are collected into the native "S'entraîner" part below.
        if section.get("formula") and not content_items and not graphs and not graphics:
            lines.append(r"\smallskip")

    course_exercises = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        for ex in section.get("exercises") or []:
            if isinstance(ex, dict):
                course_exercises.append(ex)

    # Preserve declared count as a QA guard, without inventing exercises.
    declared = _declared_exercise_count(data)
    if declared is not None and course_exercises and len(course_exercises) != declared:
        # The renderer remains faithful to received content; the workflow QA
        # already owns hard failures for explicit exercise-sheet contracts.
        print(
            f"Course exercise count: received={len(course_exercises)} declared={declared}"
        )

    corrections_present = False
    if course_exercises:
        lines.append(r"\AuroreCourseSpineOff")
        lines.append(r"\exercicesbase")
        lines.append(r"\begin{colonne*exercice}")

        grouped = {}
        for ex in course_exercises:
            group = clean_text(ex.get("series") or ex.get("theme") or "Entraînement").strip()
            grouped.setdefault(group, []).append(ex)

        exercise_no = 0
        for group, exercises in grouped.items():
            if group:
                lines.append(r"\serie{" + tex_text(group) + r"}")
            for ex in exercises:
                exercise_no += 1
                statement = (
                    ex.get("question")
                    or ex.get("statement")
                    or ex.get("enonce")
                    or ex.get("content")
                    or ""
                )
                solution = ex.get("solution") or ex.get("correction") or ex.get("details") or ""
                heading = clean_text(ex.get("title") or "")
                if solution:
                    corrections_present = True
                    begin = r"\begin{exercice*}"
                else:
                    begin = r"\begin{exercice}"
                lines.append(begin)
                if heading:
                    # The star/non-star environment accepts an optional title.
                    lines[-1] = begin[:-1] + "[" + tex_text(heading) + "]}"
                lines.append(r"\label{aurore-ex-" + str(exercise_no) + "}")
                body = render_body_text(statement, auto_math=True)
                lines.append(body)
                if ex.get("hint"):
                    lines.append(r"\textit{" + tex_text("Indication :") + r"} " + render_body_text(ex.get("hint")))
                lines.append(r"\end{exercice" + ("*" if solution else "") + "}")
                if solution:
                    lines.append(r"\begin{corrige}")
                    lines.append(render_body_text(solution, auto_math=True))
                    lines.append(r"\end{corrige}")

        lines.append(r"\end{colonne*exercice}")

    # Keep corrections in the native three-column "Solutions" mechanism.
    if corrections_present:
        lines.append(r"\AfficheCorriges[3]")

    # End with the native class output, not a custom Aurore rights/QR page.
    lines.append(r"\end{document}")
    return "\n".join(lines)