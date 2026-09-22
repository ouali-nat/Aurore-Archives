#!/usr/bin/env python3
"""Aurore deterministic SVG editorial graphics engine.

This module intentionally generates vector source from structured data. It does
not use an image model, external image service, or random values.
"""

from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from pathlib import Path

MAX_GRAPHICS = 24
MAX_ELEMENTS = 120

# Deux familles explicites : micro-décoration éditoriale et schémas scientifiques.
EDITORIAL_DECORATIVE_KINDS = frozenset({
    "separator", "title_decor", "separator_leaf", "leaf_branch",
    "deco_feuillage", "dots", "mini_tree",
})

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
    """Séparateur éditorial discret."""
    width, height = 1200, 72
    style = str(spec.get("style") or "dots").lower()
    lines = _svg_open(width, height, "Séparateur Aurore")
    if style == "line":
        lines.append(f'<line x1="180" y1="36" x2="1020" y2="36" stroke="{c["primary"]}" stroke-width="1.2" stroke-linecap="round"/>')
    elif style == "leaf_branch":
        lines.extend([
            f'<path d="M190 40 C380 20 500 55 650 36 C790 18 900 50 1010 30" fill="none" stroke="{c["strong"]}" stroke-width="1.1" stroke-linecap="round"/>',
            f'<ellipse cx="380" cy="27" rx="11" ry="4.5" transform="rotate(-24 380 27)" fill="{c["secondary"]}"/>',
            f'<ellipse cx="545" cy="43" rx="11" ry="4.5" transform="rotate(25 545 43)" fill="{c["primary"]}"/>',
            f'<ellipse cx="820" cy="25" rx="11" ry="4.5" transform="rotate(-20 820 25)" fill="{c["secondary"]}"/>',
        ])
    else:
        for x, r in [(564, 2.3), (588, 3.6), (600, 4.8), (612, 3.6), (636, 2.3)]:
            lines.append(f'<circle cx="{x}" cy="36" r="{r}" fill="{c["primary"]}"/>')
        lines.append(f'<line x1="240" y1="36" x2="530" y2="36" stroke="{c["secondary"]}" stroke-width="1.0" stroke-linecap="round"/>')
        lines.append(f'<line x1="670" y1="36" x2="960" y2="36" stroke="{c["secondary"]}" stroke-width="1.0" stroke-linecap="round"/>')
    lines += _svg_close()
    return lines
def _render_title_decor(spec: dict, c: dict) -> list[str]:
    """Accent de titre très léger."""
    width, height = 1200, 92
    lines = _svg_open(width, height, "Décoration de titre Aurore")
    lines.extend([
        f'<path d="M220 66 C310 40 365 43 440 61" fill="none" stroke="{c["strong"]}" stroke-width="1.3" stroke-linecap="round"/>',
        f'<path d="M760 61 C835 43 890 40 980 66" fill="none" stroke="{c["strong"]}" stroke-width="1.3" stroke-linecap="round"/>',
        f'<circle cx="600" cy="46" r="7" fill="{c["primary"]}"/>',
        f'<circle cx="600" cy="46" r="3" fill="{c["paper"]}"/>',
        f'<path d="M440 61 Q520 24 600 46 Q680 24 760 61" fill="none" stroke="{c["secondary"]}" stroke-width="0.9"/>',
    ])
    lines += _svg_close()
    return lines
def _render_callout(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 250
    label = _safe_text(spec.get("label") or "À retenir", 80)
    body = _safe_text(spec.get("text") or "", 260)
    lines = _svg_open(width, height, label)
    lines.extend([
        f'<rect x="35" y="30" width="1130" height="190" rx="28" fill="{c["soft"]}" stroke="{c["primary"]}" stroke-width="2"/>',
        f'<rect x="35" y="30" width="18" height="190" rx="9" fill="{c["strong"]}"/>',
        f'<text x="85" y="92" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="700" fill="{c["strong"]}">{_esc(label)}</text>',
        f'<text x="85" y="145" font-family="DejaVu Sans, sans-serif" font-size="25" fill="{c["ink"]}">{_esc(body)}</text>',
    ])
    lines += _svg_close()
    return lines


def _num(value: object, fallback: float = 0.0, lo: float | None = None, hi: float | None = None) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        out = fallback
    if lo is not None:
        out = max(lo, out)
    if hi is not None:
        out = min(hi, out)
    return out

def _int(value: object, fallback: int = 0, lo: int | None = None, hi: int | None = None) -> int:
    try:
        out = int(float(value))
    except (TypeError, ValueError):
        out = fallback
    if lo is not None:
        out = max(lo, out)
    if hi is not None:
        out = min(hi, out)
    return out

def _direction_angle(direction: object, sense: object = None, angle: object = None) -> float:
    if angle is not None:
        return _num(angle, 0.0) * 3.141592653589793 / 180.0
    d = str(direction or "").strip().lower()
    s = str(sense or "").strip().lower()
    if d in {"horizontal", "x"}:
        return 3.141592653589793 if s in {"left", "gauche", "-"} else 0.0
    if d in {"vertical", "y"}:
        return -3.141592653589793 / 2 if s in {"up", "haut", "-"} else 3.141592653589793 / 2
    names = {
        "right": 0.0, "droite": 0.0,
        "up": -3.141592653589793 / 2, "haut": -3.141592653589793 / 2,
        "left": 3.141592653589793, "gauche": 3.141592653589793,
        "down": 3.141592653589793 / 2, "bas": 3.141592653589793 / 2,
        "up-right": -3.141592653589793 / 4, "haut-droite": -3.141592653589793 / 4,
        "up-left": -3 * 3.141592653589793 / 4, "haut-gauche": -3 * 3.141592653589793 / 4,
        "down-right": 3.141592653589793 / 4, "bas-droite": 3.141592653589793 / 4,
        "down-left": 3 * 3.141592653589793 / 4, "bas-gauche": 3 * 3.141592653589793 / 4,
    }
    if d in names:
        return names[d]
    return 0.0

def _arrow_marker(lines: list[str], marker_id: str, color: str, size: int = 10) -> None:
    size = _int(size, 10, 5, 24)
    lines.extend([
        "<defs>",
        f'<marker id="{marker_id}" markerWidth="{size}" markerHeight="{size}" refX="{size - 1}" refY="{size / 2}" orient="auto" markerUnits="strokeWidth">',
        f'<path d="M0 0 L{size} {size / 2} L0 {size} Z" fill="{color}"/>',
        "</marker>",
        "</defs>",
    ])

def _label_with_box(lines: list[str], text: object, x: float, y: float, c: dict,
                    accent: str | None = None, size: int = 24, anchor: str = "start") -> None:
    value = _safe_text(text, 120)
    if not value:
        return
    fill = accent or c["ink"]
    lines.append(
        f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" '
        f'font-family="DejaVu Sans, sans-serif" font-size="{size}" fill="{fill}">{_esc(value)}</text>'
    )

def _render_cell(spec: dict, c: dict) -> list[str]:
    # Backward-compatible legacy cell diagram.
    width, height = 1200, 720
    lines = _svg_open(width, height, "Schéma de cellule")
    lines.extend([
        f'<ellipse cx="600" cy="360" rx="470" ry="270" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="3.2"/>',
        f'<ellipse cx="600" cy="360" rx="150" ry="115" fill="{c["paper"]}" stroke="{c["primary"]}" stroke-width="3"/>',
        f'<text x="600" y="370" text-anchor="middle" font-family="DejaVu Sans" font-size="30" font-weight="700" fill="{c["strong"]}">Noyau</text>',
    ])
    mitochondria = [(300,250),(870,255),(330,500),(840,490)]
    for x, y in mitochondria:
        lines.append(f'<ellipse cx="{x}" cy="{y}" rx="62" ry="35" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="2"/>')
        lines.append(f'<path d="M{x-35} {y} q18 -20 36 0 q18 20 36 0" fill="none" stroke="{c["strong"]}" stroke-width="1.4"/>')
    labels = [("Membrane",95,115,190,190),("Cytoplasme",940,150,790,240),("Mitochondrie",930,590,840,500)]
    for label,x,y,tx,ty in labels:
        lines.append(f'<line x1="{x}" y1="{y}" x2="{tx}" y2="{ty}" stroke="{c["ink"]}" stroke-width="1.4"/>')
        lines.append(f'<text x="{x}" y="{y-8}" font-family="DejaVu Sans" font-size="25" fill="{c["ink"]}">{_esc(label)}</text>')
    lines += _svg_close()
    return lines

def _render_animal_cell(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 760
    title = _safe_text(spec.get("title") or "Organisation d'une cellule animale", 160)
    lines = _svg_open(width, height, title)
    lines.extend([
        f'<ellipse cx="600" cy="385" rx="455" ry="285" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="3"/>',
        f'<ellipse cx="600" cy="385" rx="160" ry="125" fill="{c["paper"]}" stroke="{c["primary"]}" stroke-width="3.2"/>',
        f'<text x="600" y="395" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="31" font-weight="700" fill="{c["strong"]}">Noyau</text>',
        f'<ellipse cx="395" cy="265" rx="72" ry="39" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="2"/>',
        f'<path d="M350 265 q20 -22 40 0 q20 22 40 0" fill="none" stroke="{c["strong"]}" stroke-width="1.4"/>',
        f'<ellipse cx="825" cy="515" rx="72" ry="39" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="2"/>',
        f'<path d="M780 515 q20 -22 40 0 q20 22 40 0" fill="none" stroke="{c["strong"]}" stroke-width="1.4"/>',
        f'<ellipse cx="850" cy="275" rx="54" ry="30" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="2"/>',
        f'<path d="M815 275 q17 -17 34 0 q17 17 34 0" fill="none" stroke="{c["strong"]}" stroke-width="1.4"/>',
        f'<ellipse cx="370" cy="520" rx="54" ry="30" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="2"/>',
        f'<path d="M335 520 q17 -17 34 0 q17 17 34 0" fill="none" stroke="{c["strong"]}" stroke-width="1.4"/>',
    ])
    labels = [
        ("Membrane plasmique", 78, 135, 190, 235),
        ("Cytoplasme", 970, 185, 840, 250),
        ("Noyau", 955, 400, 760, 390),
        ("Mitochondrie", 905, 625, 825, 520),
    ]
    for label, x, y, tx, ty in labels:
        lines.append(f'<line x1="{x}" y1="{y}" x2="{tx}" y2="{ty}" stroke="{c["ink"]}" stroke-width="1.4"/>')
        _label_with_box(lines, label, x, y - 8, c, size=24)
    lines.append(f'<text x="600" y="725" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="22" fill="{c["ink"]}">Schéma simplifié à visée pédagogique</text>')
    lines += _svg_close()
    return lines

def _render_plant_cell(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 800
    title = _safe_text(spec.get("title") or "Organisation d'une cellule végétale", 160)
    lines = _svg_open(width, height, title)
    lines.extend([
        f'<rect x="120" y="85" width="960" height="610" rx="105" fill="{c["secondary"]}" fill-opacity="0.28" stroke="{c["strong"]}" stroke-width="3.5"/>',
        f'<rect x="155" y="118" width="890" height="544" rx="88" fill="{c["soft"]}" stroke="{c["primary"]}" stroke-width="3"/>',
        f'<ellipse cx="620" cy="390" rx="205" ry="155" fill="{c["paper"]}" stroke="{c["strong"]}" stroke-width="3"/>',
        f'<text x="620" y="400" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="700" fill="{c["strong"]}">Grande vacuole</text>',
        f'<ellipse cx="360" cy="275" rx="84" ry="46" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="2"/>',
        f'<ellipse cx="360" cy="275" rx="52" ry="23" fill="none" stroke="{c["strong"]}" stroke-width="1.4"/>',
        f'<ellipse cx="875" cy="250" rx="84" ry="46" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="2"/>',
        f'<ellipse cx="875" cy="250" rx="52" ry="23" fill="none" stroke="{c["strong"]}" stroke-width="1.4"/>',
        f'<ellipse cx="870" cy="535" rx="84" ry="46" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="2"/>',
        f'<ellipse cx="870" cy="535" rx="52" ry="23" fill="none" stroke="{c["strong"]}" stroke-width="1.4"/>',
        f'<ellipse cx="350" cy="540" rx="66" ry="34" fill="{c["secondary"]}" stroke="{c["strong"]}" stroke-width="2"/>',
        f'<ellipse cx="850" cy="380" rx="82" ry="46" fill="none" stroke="{c["strong"]}" stroke-width="2.5"/>',
        f'<circle cx="850" cy="380" r="16" fill="{c["strong"]}"/>',
    ])
    labels = [
        ("Paroi cellulaire", 90, 130, 155, 170),
        ("Membrane plasmique", 880, 145, 1015, 180),
        ("Chloroplaste", 275, 255, 360, 275),
        ("Noyau", 960, 390, 850, 380),
        ("Mitochondrie", 225, 610, 350, 540),
        ("Vacuole", 935, 585, 745, 490),
    ]
    for label, x, y, tx, ty in labels:
        lines.append(f'<line x1="{x}" y1="{y}" x2="{tx}" y2="{ty}" stroke="{c["ink"]}" stroke-width="1.4"/>')
        _label_with_box(lines, label, x, y - 8, c, size=23)
    lines.append(f'<text x="600" y="742" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="22" fill="{c["ink"]}">Schéma simplifié à visée pédagogique</text>')
    lines += _svg_close()
    return lines

def _render_leaf_branch(spec: dict, c: dict) -> list[str]:
    """Petit motif botanique pour marge ou séparateur."""
    width, height = 1200, 100
    lines = _svg_open(width, height, "Branche décorative Aurore")
    leaf_count = _int(spec.get("leaf_count"), 7, 3, 12)
    lines.append(f'<path d="M210 66 C390 35 500 76 645 50 C785 28 900 68 990 42" fill="none" stroke="{c["strong"]}" stroke-width="1.2" stroke-linecap="round"/>')
    xs = [235 + i * (730 / max(1, leaf_count - 1)) for i in range(leaf_count)]
    for i, x in enumerate(xs):
        y = 58 - 12 * (0.5 + 0.5 * ((i % 3) / 2))
        side = -1 if i % 2 == 0 else 1
        fill = c["secondary"] if i % 2 == 0 else c["primary"]
        lines.append(f'<ellipse cx="{x:.1f}" cy="{y + side * 6:.1f}" rx="10" ry="4" transform="rotate({-26 if side < 0 else 26} {x:.1f} {y + side * 6:.1f})" fill="{fill}"/>')
    lines += _svg_close()
    return lines
def _render_dots(spec: dict, c: dict) -> list[str]:
    """Motif de points minimal."""
    width, height = 1200, 64
    lines = _svg_open(width, height, "Motif de points Aurore")
    count = _int(spec.get("count"), 5, 3, 13)
    spacing = _num(spec.get("spacing"), 36, 18, 60)
    start_x = 600 - (count - 1) * spacing / 2
    radii = [2.0, 3.0, 4.2, 3.0, 2.0, 2.5, 3.6, 2.4, 2.8, 2.2, 3.2, 2.5, 2.0]
    for i in range(count):
        radius = radii[i % len(radii)]
        fill = c["primary"] if i % 2 == 0 else c["secondary"]
        lines.append(f'<circle cx="{start_x + i * spacing:.1f}" cy="{31 + (i % 2) * 1.5}" r="{radius}" fill="{fill}"/>')
    lines += _svg_close()
    return lines
def _render_mini_tree(spec: dict, c: dict) -> list[str]:
    """Petit arbre décoratif réservé aux marges/coins."""
    width, height = 1200, 120
    lines = _svg_open(width, height, "Petit arbre décoratif Aurore")
    lines.extend([
        f'<path d="M600 98 C597 82 599 66 600 52" fill="none" stroke="{c["strong"]}" stroke-width="2.6" stroke-linecap="round"/>',
        f'<path d="M600 74 C575 62 552 52 535 42 M600 74 C625 62 648 52 665 42" fill="none" stroke="{c["strong"]}" stroke-width="2.1" stroke-linecap="round"/>',
        f'<ellipse cx="535" cy="40" rx="20" ry="10" fill="{c["secondary"]}"/>',
        f'<ellipse cx="665" cy="40" rx="20" ry="10" fill="{c["secondary"]}"/>',
        f'<ellipse cx="600" cy="24" rx="25" ry="12" fill="{c["secondary"]}"/>',
    ])
    lines += _svg_close()
    return lines
def _render_force_diagram(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 720
    title = _safe_text(spec.get("title") or "Représentation des forces", 160)
    lines = _svg_open(width, height, title)
    cx = 600.0
    cy = 390.0
    shape = str(spec.get("object") or "bloc").lower().strip()
    if shape in {"point", "particle", "masse"}:
        lines.append(f'<circle cx="{cx}" cy="{cy}" r="34" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="2.5"/>')
    elif shape in {"sphère", "sphere", "ball", "balle"}:
        lines.append(f'<circle cx="{cx}" cy="{cy}" r="82" fill="{c["secondary"]}" fill-opacity="0.55" stroke="{c["strong"]}" stroke-width="3"/>')
    else:
        lines.append(f'<rect x="{cx-120}" y="{cy-76}" width="240" height="152" rx="18" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="3"/>')
    lines.append(f'<text x="{cx}" y="{cy+10}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="27" font-weight="700" fill="{c["strong"]}">{_esc(spec.get("object_label") or "Objet")}</text>')
    if spec.get("support"):
        lines.extend([
            f'<line x1="170" y1="500" x2="1030" y2="500" stroke="{c["ink"]}" stroke-width="3"/>',
            f'<path d="M180 500 l-20 28 m70-28 l-20 28 m70-28 l-20 28 m70-28 l-20 28 m70-28 l-20 28 m70-28 l-20 28 m70-28 l-20 28" stroke="{c["secondary"]}" stroke-width="2"/>',
        ])
    _arrow_marker(lines, "force-arrow", c["strong"], 7)
    forces = spec.get("forces") if isinstance(spec.get("forces"), list) else []
    palette = [c["strong"], c["primary"], c["secondary"], c["ink"]]
    for idx, force in enumerate(forces[:10]):
        if not isinstance(force, dict):
            continue
        angle = _direction_angle(force.get("direction"), force.get("sense"), force.get("angle"))
        length = _num(force.get("length"), 190 + (idx % 3) * 18, 90, 300)
        x2 = cx + length * __import__("math").cos(angle)
        y2 = cy + length * __import__("math").sin(angle)
        x1 = cx + 22 * __import__("math").cos(angle)
        y1 = cy + 22 * __import__("math").sin(angle)
        color = _hex(force.get("color"), palette[idx % len(palette)])
        lines.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" stroke-width="3.2" stroke-linecap="round" marker-end="url(#force-arrow)"/>')
        label = _safe_text(force.get("name") or force.get("symbol") or f"Force {idx+1}", 80)
        value = _safe_text(force.get("value") or "", 60)
        suffix = f" · {value}" if value else ""
        lx = cx + (length + 28) * __import__("math").cos(angle)
        ly = cy + (length + 28) * __import__("math").sin(angle)
        anchor = "middle"
        if __import__("math").cos(angle) > 0.35:
            anchor = "start"
        elif __import__("math").cos(angle) < -0.35:
            anchor = "end"
        _label_with_box(lines, label + suffix, lx, ly, c, accent=color, size=18, anchor=anchor)
        if force.get("symbol") and force.get("symbol") not in label:
            sy = ly + 25 if abs(__import__("math").sin(angle)) < 0.75 else ly
            _label_with_box(lines, force.get("symbol"), lx, sy, c, accent=color, size=17, anchor=anchor)
    lines += _svg_close()
    return lines

def _spring_points(x1: float, x2: float, y: float, turns: int, amplitude: float, compressed: float = 0.0) -> str:
    turns = _int(turns, 12, 4, 24)
    usable = max(120.0, x2 - x1)
    amplitude = _num(amplitude, 34, 12, 60)
    start = x1 + 70
    end = x2 - 70
    span = max(90.0, (end - start) / turns)
    points = [f"{x1:.1f},{y:.1f}", f"{start:.1f},{y:.1f}"]
    effective = max(0.45, 1.0 - _num(compressed, 0.0, 0.0, 0.8))
    half = span * effective / 2
    x = start
    for i in range(turns * 2):
        x += half
        yy = y + (amplitude if i % 2 == 0 else -amplitude)
        points.append(f"{x:.1f},{yy:.1f}")
    points.append(f"{end:.1f},{y:.1f}")
    points.append(f"{x2:.1f},{y:.1f}")
    return " ".join(points)

def _render_spring(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 520
    title = _safe_text(spec.get("title") or "Construction d'un ressort", 160)
    lines = _svg_open(width, height, title)
    x1, x2, y = 180.0, 1020.0, 260.0
    turns = _int(spec.get("turns"), 12, 4, 24)
    amplitude = _num(spec.get("amplitude"), 32, 12, 58)
    compression = _num(spec.get("compression"), 0.0, 0.0, 0.75)
    anchor = str(spec.get("anchor") or "left").lower().strip()
    lines.extend([
        f'<rect x="85" y="205" width="90" height="110" rx="12" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="3"/>',
        f'<path d="M95 220 v80 M115 220 v80 M135 220 v80 M155 220 v80" stroke="{c["secondary"]}" stroke-width="2"/>',
        f'<line x1="1020" y1="205" x2="1020" y2="315" stroke="{c["strong"]}" stroke-width="3"/>',
        f'<polyline points="{_spring_points(x1, x2, y, turns, amplitude, compression)}" fill="none" stroke="{c["primary"]}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>',
    ])
    if anchor in {"right", "droite", "both", "deux"}:
        lines.append(f'<rect x="1035" y="205" width="80" height="110" rx="12" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="3"/>')
        lines.append(f'<path d="M1045 220 v80 M1065 220 v80 M1085 220 v80 M1105 220 v80" stroke="{c["secondary"]}" stroke-width="2"/>')
    label = _safe_text(spec.get("label") or "Ressort", 80)
    _label_with_box(lines, label, 600, 115, c, accent=c["strong"], size=28, anchor="middle")
    if compression > 0:
        _label_with_box(lines, f"compression : {compression:.2f}", 600, 440, c, size=22, anchor="middle")
    lines += _svg_close()
    return lines

def _render_mass_spring(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 620
    title = _safe_text(spec.get("title") or "Système masse–ressort", 160)
    lines = _svg_open(width, height, title)
    x1, x2, y = 160.0, 820.0, 315.0
    lines.extend([
        f'<rect x="80" y="225" width="85" height="180" rx="12" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="3"/>',
        f'<path d="M92 240 v150 M112 240 v150 M132 240 v150 M152 240 v150" stroke="{c["secondary"]}" stroke-width="2"/>',
        f'<polyline points="{_spring_points(x1, x2, y, _int(spec.get("turns"), 11, 4, 24), _num(spec.get("amplitude"), 28, 12, 55), 0)}" fill="none" stroke="{c["primary"]}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>',
        f'<rect x="825" y="225" width="235" height="180" rx="22" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="3.2"/>',
        f'<text x="942" y="325" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="38" font-weight="700" fill="{c["strong"]}">{_esc(spec.get("mass_label") or "m")}</text>',
        f'<line x1="1058" y1="180" x2="1058" y2="485" stroke="{c["ink"]}" stroke-width="2.5"/>',
        f'<text x="600" y="120" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="27" font-weight="700" fill="{c["strong"]}">{_esc(spec.get("label") or "Masse–ressort")}</text>',
        f'<line x1="170" y1="465" x2="1080" y2="465" stroke="{c["ink"]}" stroke-width="3"/>',
    ])
    lines += _svg_close()
    return lines

def _draw_circuit_component(lines: list[str], comp: dict, c: dict, idx: int) -> tuple[float, float]:
    x = _num(comp.get("x"), 260 + (idx % 4) * 220, 100, 1100)
    y = _num(comp.get("y"), 270 if idx < 4 else 450, 90, 650)
    kind = str(comp.get("type") or "lamp").lower().strip()
    fill = _hex(comp.get("color"), c["soft"])
    stroke = _hex(comp.get("stroke"), c["strong"])
    if kind in {"battery", "pile", "generator"}:
        lines.extend([
            f'<line x1="{x-14:.1f}" y1="{y-45:.1f}" x2="{x-14:.1f}" y2="{y+45:.1f}" stroke="{stroke}" stroke-width="3"/>',
            f'<line x1="{x+18:.1f}" y1="{y-25:.1f}" x2="{x+18:.1f}" y2="{y+25:.1f}" stroke="{stroke}" stroke-width="3"/>',
        ])
    elif kind in {"lamp", "bulb", "lampe"}:
        lines.extend([
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="47" fill="{fill}" stroke="{stroke}" stroke-width="3"/>',
            f'<path d="M{x-25:.1f} {y-25:.1f} L{x+25:.1f} {y+25:.1f} M{x+25:.1f} {y-25:.1f} L{x-25:.1f} {y+25:.1f}" stroke="{stroke}" stroke-width="3"/>',
        ])
    elif kind in {"resistor", "résistance", "resistance"}:
        lines.append(f'<rect x="{x-72:.1f}" y="{y-28:.1f}" width="144" height="56" rx="5" fill="{fill}" stroke="{stroke}" stroke-width="3"/>')
    elif kind in {"switch", "interrupteur"}:
        closed = bool(comp.get("closed", False))
        lines.extend([
            f'<circle cx="{x-48:.1f}" cy="{y:.1f}" r="9" fill="{stroke}"/>',
            f'<circle cx="{x+48:.1f}" cy="{y:.1f}" r="9" fill="{stroke}"/>',
            f'<line x1="{x-42:.1f}" y1="{y:.1f}" x2="{x+42:.1f}" y2="{y if closed else y-35:.1f}" stroke="{stroke}" stroke-width="3.2" stroke-linecap="round"/>',
        ])
    elif kind in {"ammeter", "ampèremètre"}:
        lines.extend([
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="45" fill="{fill}" stroke="{stroke}" stroke-width="3"/>',
            f'<text x="{x:.1f}" y="{y+14:.1f}" text-anchor="middle" font-family="DejaVu Sans" font-size="35" font-weight="700" fill="{stroke}">A</text>',
        ])
    elif kind in {"voltmeter", "voltmètre"}:
        lines.extend([
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="45" fill="{fill}" stroke="{stroke}" stroke-width="3"/>',
            f'<text x="{x:.1f}" y="{y+14:.1f}" text-anchor="middle" font-family="DejaVu Sans" font-size="35" font-weight="700" fill="{stroke}">V</text>',
        ])
    else:
        lines.append(f'<rect x="{x-68:.1f}" y="{y-34:.1f}" width="136" height="68" rx="12" fill="{fill}" stroke="{stroke}" stroke-width="3"/>')
    label = _safe_text(comp.get("label") or comp.get("id") or kind, 60)
    _label_with_box(lines, label, x, y + 82, c, accent=stroke, size=21, anchor="middle")
    return x, y

def _render_circuit_custom(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 720
    title = _safe_text(spec.get("title") or "Circuit électrique", 160)
    lines = _svg_open(width, height, title)
    components = spec.get("components") if isinstance(spec.get("components"), list) else []
    if not components:
        return _render_circuit(spec, c)
    positions: dict[str, tuple[float, float]] = {}
    for idx, comp in enumerate(components[:16]):
        if not isinstance(comp, dict):
            continue
        cid = _safe_text(comp.get("id") or str(idx + 1), 40)
        positions[cid] = _draw_circuit_component(lines, comp, c, idx)
    connections = spec.get("connections") if isinstance(spec.get("connections"), list) else []
    if not connections and len(positions) > 1:
        ids = list(positions)
        connections = [[ids[i], ids[(i + 1) % len(ids)]] for i in range(len(ids))]
    wire_color = _hex(spec.get("wire_color"), c["ink"])
    for conn in connections[:32]:
        if isinstance(conn, dict):
            a = str(conn.get("from") or "").strip()
            b = str(conn.get("to") or "").strip()
        elif isinstance(conn, list) and len(conn) >= 2:
            a, b = str(conn[0]).strip(), str(conn[1]).strip()
        else:
            continue
        if a not in positions or b not in positions:
            continue
        ax, ay = positions[a]
        bx, by = positions[b]
        midx = (ax + bx) / 2
        # Deterministic orthogonal routing for readability.
        path = f"M{ax:.1f} {ay:.1f} H{midx:.1f} V{by:.1f} H{bx:.1f}"
        lines.insert(2, f'<path d="{path}" fill="none" stroke="{wire_color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>')
    note = _safe_text(spec.get("note") or "", 200)
    if note:
        _label_with_box(lines, note, 600, 675, c, size=21, anchor="middle")
    lines += _svg_close()
    return lines

def _render_circuit(spec: dict, c: dict) -> list[str]:
    width, height = 1200, 520
    lines = _svg_open(width, height, "Circuit électrique")
    lines.extend([
        f'<path d="M150 150 H400 M800 150 H1050 V370 H150 V150" fill="none" stroke="{c["ink"]}" stroke-width="3.2"/>',
        f'<rect x="400" y="110" width="120" height="80" rx="12" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="2.5"/>',
        f'<text x="460" y="160" text-anchor="middle" font-family="DejaVu Sans" font-size="27" font-weight="700" fill="{c["strong"]}">Pile</text>',
        f'<rect x="680" y="110" width="120" height="80" rx="12" fill="{c["soft"]}" stroke="{c["primary"]}" stroke-width="2.5"/>',
        f'<text x="740" y="160" text-anchor="middle" font-family="DejaVu Sans" font-size="27" font-weight="700" fill="{c["strong"]}">Lampe</text>',
        f'<circle cx="600" cy="370" r="55" fill="{c["soft"]}" stroke="{c["strong"]}" stroke-width="2.5"/>',
        f'<text x="600" y="380" text-anchor="middle" font-family="DejaVu Sans" font-size="25" fill="{c["strong"]}">I</text>',
    ])
    lines += _svg_close()
    return lines

def _render_tree(spec: dict, c: dict) -> list[str]:
    """Schéma botanique scientifique, jamais une décoration générique."""
    width, height = 1200, 680
    lines = _svg_open(width, height, "Schéma d'arbre")
    lines.extend([
        f'<path d="M600 620 C590 480 600 370 600 250" fill="none" stroke="{c["strong"]}" stroke-width="7" stroke-linecap="round"/>',
        f'<path d="M600 390 C470 330 370 270 250 200 M600 390 C730 330 830 270 950 200" fill="none" stroke="{c["strong"]}" stroke-width="5.5" stroke-linecap="round"/>',
        f'<path d="M600 300 C520 240 460 190 400 130 M600 300 C680 240 740 190 800 130" fill="none" stroke="{c["strong"]}" stroke-width="4.5" stroke-linecap="round"/>',
    ])
    for x,y,rx,ry in [(250,190,100,45),(950,190,100,45),(400,120,90,42),(800,120,90,42),(600,245,105,48)]:
        lines.append(f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{c["secondary"]}" stroke="{c["primary"]}" stroke-width="1.6"/>')
    if spec.get("caption"):
        lines.append(f'<text x="600" y="655" text-anchor="middle" font-family="DejaVu Sans" font-size="14" fill="{c["ink"]}">{_esc(spec.get("caption"))}</text>')
    lines += _svg_close()
    return lines
RENDERERS = {
    "separator": _render_separator,
    "title_decor": _render_title_decor,
    "callout": _render_callout,
    "cell": _render_cell,
    "animal_cell": _render_animal_cell,
    "cellule_animale": _render_animal_cell,
    "plant_cell": _render_plant_cell,
    "cellule_vegetale": _render_plant_cell,
    "separator_leaf": _render_leaf_branch,
    "leaf_branch": _render_leaf_branch,
    "deco_feuillage": _render_leaf_branch,
    "dots": _render_dots,
    "mini_tree": _render_mini_tree,
    "circuit": _render_circuit,
    "circuit_custom": _render_circuit_custom,
    "circuit_personnalise": _render_circuit_custom,
    "schema_circuit": _render_circuit_custom,
    "force_diagram": _render_force_diagram,
    "forces": _render_force_diagram,
    "spring": _render_spring,
    "ressort": _render_spring,
    "mass_spring": _render_mass_spring,
    "masse_ressort": _render_mass_spring,
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
        element_count = len(raw.get("elements", [])) if isinstance(raw.get("elements"), list) else 0
        if element_count > MAX_ELEMENTS:
            raise ValueError(f"Aurore SVG: trop d'éléments dans le graphique {index + 1}")
        kind = str(raw.get("kind") or raw.get("type") or "separator").strip().lower()
        renderer = RENDERERS.get(kind)
        if renderer is None:
            raise ValueError(f"Aurore SVG: type non supporté: {kind}")
        spec = dict(raw)
        spec["theme"] = theme or raw.get("theme") or {}
        svg = "\n".join(renderer(spec, _colors(spec))) + "\n"
        try:
            ET.fromstring(svg)
        except ET.ParseError as exc:
            raise ValueError(
                f"Aurore SVG: XML invalide pour le graphique {index + 1} ({kind}): {exc}"
            ) from exc
        svg_path = assets_dir / f"aurore-graphic-{index + 1}.svg"
        svg_path.write_text(svg, encoding="utf-8")
        role = "editorial" if kind in EDITORIAL_DECORATIVE_KINDS else "scientific"
        out.append({"index": index, "kind": kind, "role": role, "svg_path": str(svg_path), "title": _safe_text(raw.get("title") or kind)})
    return out
