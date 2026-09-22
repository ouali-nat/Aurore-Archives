#!/usr/bin/env python3
"""Aurore deterministic SVG editorial graphics engine.

This module intentionally generates vector source from structured data. It does
not use an image model, external image service, or random values.
"""

from __future__ import annotations

import html
import re
from pathlib import Path

MAX_GRAPHICS = 24
MAX_ELEMENTS = 120

PALETTE = {
    "primary": "#8B5CF6",
    "secondary": "#C084FC",
    "strong": "#6D28D9",
    "ink": "#27203A",
    "paper": "#FFFFFF",
    "soft": "#F7F3FF",
}

def _safe_text(value: object, limit: int = 180) -> str:
    text = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", str(value or ""))
    return text[:limit]

def _hex(value: object, fallback: str) -> str:
    raw = str(value or "").strip()
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", raw):
        return fallback
    return raw

def _esc(value: object) -> str:
    return html.escape(_safe_text(value), quote=True)

def _colors(spec: dict) -> dict:
    theme = spec.get("theme") if isinstance(spec.get("theme"), dict) else {}
    return {
        "primary": _hex(theme.get("primary"), PALETTE["primary"]),
        "secondary": _hex(theme.get("secondary"), PALETTE["secondary"]),
        "strong": _hex(theme.get("strong"), PALETTE["strong"]),
        "ink": _hex(theme.get("ink"), PALETTE["ink"]),
        "paper": _hex(theme.get("paper"), PALETTE["paper"]),
        "soft": _hex(theme.get("soft"), PALETTE["soft"]),
    }

def _svg_open(width: int, height: int, title: str = "Aurore graphic") -> list[str]:
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label="{_esc(title)}">',
        '<title>' + _esc(title) + '</title>',
    ]

def _svg_close() -> list[str]:
    return ["</svg>"]

def _render_separator(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 110
    style = str(spec.get("style") or "dots").lower()
    lines = _svg_open(width, height, "Séparateur Aurore")
    if style == "line":
        lines.append(f'<line x1="70" y1="55" x2="1130" y2="55" stroke="{c["primary"]}" stroke-width="5" stroke-linecap="round"/>')
    elif style == "leaf_branch":
        lines.extend([
            f'<path d="M80 62 C300 20 470 90 650 52 C820 18 970 82 1120 45" fill="none" stroke="{c["strong"]}" stroke-width="4" stroke-linecap="round"/>',
            f'<ellipse cx="300" cy="42" rx="26" ry="11" transform="rotate(-24 300 42)" fill="{c["secondary"]}"/>',
            f'<ellipse cx="510" cy="67" rx="26" ry="11" transform="rotate(25 510 67)" fill="{c["primary"]}"/>',
            f'<ellipse cx="840" cy="39" rx="26" ry="11" transform="rotate(-20 840 39)" fill="{c["secondary"]}"/>',
        ])
    else:
        for x, r in [(430, 7), (555, 11), (600, 16), (645, 11), (770, 7)]:
            lines.append(f'<circle cx="{x}" cy="55" r="{r}" fill="{c["primary"]}"/>')
        lines.append(f'<line x1="80" y1="55" x2="390" y2="55" stroke="{c["secondary"]}" stroke-width="3" stroke-linecap="round"/>')
        lines.append(f'<line x1="810" y1="55" x2="1120" y2="55" stroke="{c["secondary"]}" stroke-width="3" stroke-linecap="round"/>')
    lines += _svg_close()
    return lines

def _render_title_decor(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 150
    lines = _svg_open(width, height, "Décoration de titre Aurore")
    lines.extend([
        f'<path d="M70 118 C180 65 240 75 335 110" fill="none" stroke="{c["strong"]}" stroke-width="5" stroke-linecap="round"/>',
        f'<path d="M865 110 C960 75 1020 65 1130 118" fill="none" stroke="{c["strong"]}" stroke-width="5" stroke-linecap="round"/>',
        f'<circle cx="600" cy="72" r="24" fill="{c["primary"]}"/>',
        f'<circle cx="600" cy="72" r="10" fill="{c["paper"]}"/>',
        f'<path d="M335 110 Q470 25 600 72 Q730 25 865 110" fill="none" stroke="{c["secondary"]}" stroke-width="3"/>',
    ])
    lines += _svg_close()
    return lines

def _render_callout(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 250
    label = _safe_text(spec.get("label") or "À retenir", 80)
    body = _safe_text(spec.get("text") or "", 260)
    lines = _svg_open(width, height, label)
    lines.extend([
        f'<rect x="35" y="30" width="1130" height="190" rx="28" fill="{c["soft"]}" stroke="{c["primary"]}" stroke-width="4"/>',
        f'<rect x="35" y="30" width="18" height="190" rx="9" fill="{c["strong"]}"/>',
        f'<text x="85" y="92" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="700" fill="{c["strong"]}">{_esc(label)}</text>',
        f'<text x="85" y="145" font-family="DejaVu Sans, sans-serif" font-size="25" fill="{c["ink"]}">{_esc(body)}</text>',
    ])
    lines += _svg_close()
    return lines

def _render_cell(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 720
    lines = _svg_open(width, height, "Schéma de cellule")
    lines.extend([
        f'<ellipse cx="600" cy="360" rx="470" ry="270" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="7"/>',
        f'<ellipse cx="600" cy="360" rx="150" ry="115" fill="{c["paper"]}" stroke="{c["primary"]}" stroke-width="6"/>',
        f'<text x="600" y="370" text-anchor="middle" font-family="DejaVu Sans" font-size="30" font-weight="700" fill="{c["strong"]}">Noyau</text>',
    ])
    mitochondria = [(300,250),(870,255),(330,500),(840,490)]
    for x, y in mitochondria:
        lines.append(f'<ellipse cx="{x}" cy="{y}" rx="62" ry="35" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="4"/>')
        lines.append(f'<path d="M{x-35} {y} q18 -20 36 0 q18 20 36 0" fill="none" stroke="{c["strong"]}" stroke-width="3"/>')
    labels = [("Membrane",95,115,190,190),("Cytoplasme",940,150,790,240),("Mitochondrie",930,590,840,500)]
    for label,x,y,tx,ty in labels:
        lines.append(f'<line x1="{x}" y1="{y}" x2="{tx}" y2="{ty}" stroke="{c["ink"]}" stroke-width="3"/>')
        lines.append(f'<text x="{x}" y="{y-8}" font-family="DejaVu Sans" font-size="25" fill="{c["ink"]}">{_esc(label)}</text>')
    lines += _svg_close()
    return lines

def _render_circuit(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 520
    lines = _svg_open(width, height, "Circuit électrique")
    lines.extend([
        f'<path d="M150 150 H400 M800 150 H1050 V370 H150 V150" fill="none" stroke="{c["ink"]}" stroke-width="7"/>',
        f'<rect x="400" y="110" width="120" height="80" rx="12" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="5"/>',
        f'<text x="460" y="160" text-anchor="middle" font-family="DejaVu Sans" font-size="27" font-weight="700" fill="{c["strong"]}">Pile</text>',
        f'<rect x="680" y="110" width="120" height="80" rx="12" fill="{c["soft"]}" stroke="{c["primary"]}" stroke-width="5"/>',
        f'<text x="740" y="160" text-anchor="middle" font-family="DejaVu Sans" font-size="27" font-weight="700" fill="{c["strong"]}">Lampe</text>',
        f'<circle cx="600" cy="370" r="55" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="5"/>',
        f'<text x="600" y="380" text-anchor="middle" font-family="DejaVu Sans" font-size="25" fill="{c["strong"]}">I</text>',
    ])
    lines += _svg_close()
    return lines

def _render_tree(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 680
    lines = _svg_open(width, height, "Schéma d'arbre")
    lines.extend([
        f'<path d="M600 620 C590 480 600 370 600 250" fill="none" stroke="{c["strong"]}" stroke-width="24" stroke-linecap="round"/>',
        f'<path d="M600 390 C470 330 370 270 250 200 M600 390 C730 330 830 270 950 200" fill="none" stroke="{c["strong"]}" stroke-width="18" stroke-linecap="round"/>',
        f'<path d="M600 300 C520 240 460 190 400 130 M600 300 C680 240 740 190 800 130" fill="none" stroke="{c["strong"]}" stroke-width="16" stroke-linecap="round"/>',
    ])
    for x,y,rx,ry in [(250,190,100,45),(950,190,100,45),(400,120,90,42),(800,120,90,42),(600,245,105,48)]:
        lines.append(f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{c["secondary"]}" stroke="{c["primary"]}" stroke-width="4"/>')
    lines.append(f'<text x="600" y="655" text-anchor="middle" font-family="DejaVu Sans" font-size="28" fill="{c["ink"]}">Aurore · schéma botanique</text>')
    lines += _svg_close()
    return lines

RENDERERS = {
    "separator": _render_separator,
    "title_decor": _render_title_decor,
    "callout": _render_callout,
    "cell": _render_cell,
    "circuit": _render_circuit,
    "tree": _render_tree,
}

def render_graphics(graphics: object, assets_dir: Path, theme: dict | None = None) -> list[dict]:
    if not isinstance(graphics, list):
        return []
    if len(graphics) > MAX_GRAPHICS:
        raise ValueError(f"Aurore SVG: maximum {MAX_GRAPHICS} graphiques par document")
    assets_dir = Path(assets_dir)
    assets_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for index, raw in enumerate(graphics):
        if not isinstance(raw, dict):
            continue
        if len(raw.get("elements", [])) if isinstance(raw.get("elements"), list) else 0 > MAX_ELEMENTS:
            raise ValueError(f"Aurore SVG: trop d'éléments dans le graphique {index + 1}")
        kind = str(raw.get("kind") or raw.get("type") or "separator").strip().lower()
        renderer = RENDERERS.get(kind)
        if renderer is None:
            raise ValueError(f"Aurore SVG: type non supporté: {kind}")
        spec = dict(raw)
        spec["theme"] = theme or raw.get("theme") or {}
        svg = "
".join(renderer(spec, _colors(spec))) + "
"
        svg_path = assets_dir / f"aurore-graphic-{index + 1}.svg"
        svg_path.write_text(svg, encoding="utf-8")
        out.append({"index": index, "kind": kind, "svg_path": str(svg_path), "title": _safe_text(raw.get("title") or kind)})
    return out
