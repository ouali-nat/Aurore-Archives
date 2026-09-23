import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from render_document import (
    _document_kind,
    _edition_profile,
    _exercise_profile_qa_issues,
    _has_usable_content_json,
    render,
)


def exercise_doc(correction="Solution cohérente avec les questions posées."):
    return {
        "title": "Série de nombres complexes",
        "document_type": "exercices",
        "metadata": {
            "exercise_pipeline": True,
            "exercise_count": 1,
            "paired_corrections": True,
        },
        "sections": [
            {
                "title": "Exercice 1",
                "content": [],
                "exercises": [
                    {
                        "question": "Résoudre $z^2=1$ et interpréter les solutions.",
                        "correction": correction,
                    }
                ],
            }
        ],
    }


def course_doc():
    return {
        "title": "Cours sur les nombres complexes",
        "document_type": "cours",
        "introduction": "Introduction au chapitre.",
        "sections": [
            {
                "title": "Rappels",
                "content": ["Un nombre complexe s'écrit $z=x+iy$."],
                "exercises": [],
            }
        ],
    }


def test_document_kind_is_independent():
    assert _document_kind({"document_type": "exercices"}) == "exercices"
    assert _document_kind({"document_type": "Cours"}) == "cours"
    assert _document_kind({"document_type": "fiche de cours"}) == "cours"


def test_exercise_profile_rejects_course_filler():
    bad = exercise_doc(
        "Solution. Développement complémentaire : pour une dérivée, "
        "pour une intégrale, pour une loi binomiale et pour un tableau de signes."
    )
    issues = _exercise_profile_qa_issues(bad)
    assert issues
    assert any("contaminé" in issue for issue in issues)


def test_exercise_profile_accepts_paired_structured_correction():
    good = exercise_doc()
    assert _has_usable_content_json(good)
    assert _exercise_profile_qa_issues(good) == []
    assert _edition_profile(good)["kind"] == "exercices"


def test_course_profile_remains_separate():
    course = course_doc()
    assert _has_usable_content_json(course)
    assert _edition_profile(course)["kind"] == "cours"
    tex = render(course)
    assert r"\AuroreTitleBlock{Document pédagogique}" in tex
    assert r"\AuroreExerciseCover" not in tex


def test_exercise_render_uses_exercise_cover_and_ignores_section_content():
    good = exercise_doc()
    good["sections"][0]["content"] = [
        "Contenu parasite de cours qui ne doit jamais entrer dans un PDF d'exercices."
    ]
    tex = render(good)
    assert r"\AuroreExerciseCover" in tex
    assert r"\AuroreExerciseSeriesBlock{1}" in tex
    assert "Contenu parasite de cours" not in tex


def test_locked_profile_cannot_switch_kind():
    good = exercise_doc()
    good["_aurore_profile"] = {"kind": "cours", "lock": True}
    with pytest.raises(ValueError):
        _edition_profile(good)
