import tempfile
import unittest
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from aurore_svg import MAX_ELEMENTS, MAX_GRAPHICS, RENDERERS, render_graphics


GRAPHIC_SPECS = [
    {"kind": "separator", "style": "leaf_branch"},
    {"kind": "title_decor", "title": "Titre"},
    {"kind": "callout", "label": "À retenir", "text": "Un exemple."},
    {"kind": "leaf_branch"},
    {"kind": "dots"},
    {"kind": "mini_tree"},
    {"kind": "cell"},
    {"kind": "animal_cell"},
    {"kind": "plant_cell"},
    {
        "kind": "force_diagram",
        "object": "bloc",
        "object_label": "Bloc",
        "support": True,
        "forces": [
            {"name": "Poids", "symbol": "P", "direction": "vertical", "sense": "down", "value": "20 N"},
            {"name": "Réaction du support", "symbol": "R", "direction": "vertical", "sense": "up", "value": "20 N"},
            {"name": "Traction", "symbol": "T", "direction": "horizontal", "sense": "right", "value": "8 N"},
        ],
    },
    {"kind": "spring", "turns": 14, "compression": 0.15, "label": "Ressort hélicoïdal"},
    {"kind": "mass_spring", "mass_label": "m", "turns": 12},
    {
        "kind": "circuit_custom",
        "title": "Circuit série",
        "components": [
            {"id": "G", "type": "battery", "label": "Générateur", "x": 220, "y": 330},
            {"id": "I", "type": "switch", "label": "Interrupteur", "x": 480, "y": 210, "closed": False},
            {"id": "L", "type": "lamp", "label": "Lampe", "x": 760, "y": 330},
            {"id": "R", "type": "resistor", "label": "Résistance", "x": 480, "y": 500},
        ],
        "connections": [["G", "I"], ["I", "L"], ["L", "R"], ["R", "G"]],
    },
    {"kind": "circuit"},
    {"kind": "tree"},
]


class AuroreSvgTest(unittest.TestCase):
    def test_registry_contains_new_and_legacy_kinds(self):
        expected = {
            "separator", "title_decor", "callout", "cell", "circuit", "tree",
            "animal_cell", "plant_cell", "leaf_branch", "dots", "mini_tree",
            "force_diagram", "spring", "mass_spring", "circuit_custom",
        }
        self.assertTrue(expected.issubset(RENDERERS))

    def test_all_graphics_render_to_svg(self):
        with tempfile.TemporaryDirectory() as tmp:
            generated = render_graphics(GRAPHIC_SPECS, Path(tmp), theme={
                "primary": "#3B82F6",
                "secondary": "#7DB3FF",
                "strong": "#1D4ED8",
            })
            self.assertEqual(len(generated), len(GRAPHIC_SPECS))
            for item in generated:
                svg = Path(item["svg_path"]).read_text(encoding="utf-8")
                self.assertTrue(svg.startswith("<svg "))
                self.assertTrue(svg.endswith("</svg>\n"))
                self.assertIn('xmlns="http://www.w3.org/2000/svg"', svg)
                self.assertNotIn("<image", svg)
                self.assertNotIn("data:image", svg)

    def test_limits_and_safe_color_guardrails(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                render_graphics(GRAPHIC_SPECS * 2, Path(tmp))
            too_many_elements = [{"kind": "dots", "elements": [{}] * (MAX_ELEMENTS + 1)}]
            with self.assertRaises(ValueError):
                render_graphics(too_many_elements, Path(tmp))
            generated = render_graphics(
                [{"kind": "dots", "theme": {"primary": "red", "secondary": "#F0ABFC"}}],
                Path(tmp),
            )
            svg = Path(generated[0]["svg_path"]).read_text(encoding="utf-8")
            self.assertIn("#8B5CF6", svg)
            self.assertIn("#F0ABFC", svg)


if __name__ == "__main__":
    unittest.main()
