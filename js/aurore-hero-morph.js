/* =========================================================
   AURORE — HERO MORPHING
   Morphing de forme en douceur, avec 24 points constants pour
   permettre au navigateur d'interpoler proprement les formes.
   ========================================================= */
(function () {
  'use strict';

  function initAuroreHeroMorph() {
    const hero = document.querySelector('#screen-home .hero');
    if (!hero || hero.dataset.auroreHeroMorphReady === '1') return;

    hero.dataset.auroreHeroMorphReady = '1';
    hero.classList.add('aurore-hero-morph');

    const POINT_COUNT = 24;
    const SHAPES = [
      { id: 'circle',    sides: 24, round: 0.00, rotation: -90, outer: 46.6, label: 'cercle' },
      { id: 'triangle',  sides: 3,  round: 0.22, rotation: -90, outer: 48.0, label: 'triangle arrondi' },
      { id: 'square',    sides: 4,  round: 0.20, rotation: -45, outer: 47.0, label: 'carré arrondi' },
      { id: 'cube',      sides: 4,  round: 0.11, rotation: -45, outer: 47.0, label: 'cube' },
      { id: 'hexagon',   sides: 6,  round: 0.17, rotation: -90, outer: 47.0, label: 'hexagone' },
      { id: 'octagon',   sides: 8,  round: 0.14, rotation: -90, outer: 47.0, label: 'octogone' },
      { id: 'dodecagon', sides: 12, round: 0.11, rotation: -90, outer: 47.0, label: 'dodécagone' },
      { id: 'polygon24', sides: 24, round: 0.00, rotation: -90, outer: 47.0, label: 'polygone à 24 côtés' }
    ];

    let index = 0;
    let timer = null;
    let paused = false;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function point(x, y) {
      return clamp(x, 2, 98).toFixed(2) + '% ' + clamp(y, 2, 98).toFixed(2) + '%';
    }

    function createRoundedPolygon(sides, round, rotation, outerRadius) {
      const center = 50;
      const radius = outerRadius;
      const rotationRad = rotation * Math.PI / 180;
      const vertices = [];

      for (let i = 0; i < sides; i += 1) {
        const angle = rotationRad + (Math.PI * 2 * i / sides);
        vertices.push({
          x: center + radius * Math.cos(angle),
          y: center + radius * Math.sin(angle)
        });
      }

      const perCorner = Math.max(1, Math.round(POINT_COUNT / sides));
      const result = [];

      for (let i = 0; i < sides; i += 1) {
        const prev = vertices[(i - 1 + sides) % sides];
        const current = vertices[i];
        const next = vertices[(i + 1) % sides];

        const before = {
          x: current.x + (prev.x - current.x) * round,
          y: current.y + (prev.y - current.y) * round
        };

        const after = {
          x: current.x + (next.x - current.x) * round,
          y: current.y + (next.y - current.y) * round
        };

        for (let step = 0; step < perCorner; step += 1) {
          const t = step / perCorner;
          const mt = 1 - t;
          const bx = mt * mt * before.x + 2 * mt * t * current.x + t * t * after.x;
          const by = mt * mt * before.y + 2 * mt * t * current.y + t * t * after.y;
          result.push(point(bx, by));
        }
      }

      while (result.length < POINT_COUNT) result.push(result[result.length - 1]);
      return result.slice(0, POINT_COUNT).join(', ');
    }

    function applyShape(shape, nextIndex) {
      index = nextIndex;
      hero.dataset.shape = shape.id;
      hero.dataset.shapeLabel = shape.label;
      hero.style.setProperty('--hero-clip', 'polygon(' + createRoundedPolygon(shape.sides, shape.round, shape.rotation, shape.outer) + ')');

      if (shape.id === 'cube') {
        hero.style.setProperty('--hero-content-scale', '.97');
      } else if (shape.id === 'triangle') {
        hero.style.setProperty('--hero-content-scale', '.95');
      } else {
        hero.style.setProperty('--hero-content-scale', '1');
      }
    }

    function schedule() {
      window.clearTimeout(timer);
      if (reduceMotion.matches || paused || document.hidden) return;
      timer = window.setTimeout(function () {
        const nextIndex = (index + 1) % SHAPES.length;
        applyShape(SHAPES[nextIndex], nextIndex);
        schedule();
      }, 3000);
    }

    function setPaused(nextPaused) {
      paused = nextPaused;
      if (paused) {
        window.clearTimeout(timer);
      } else {
        schedule();
      }
    }

    applyShape(SHAPES[0], 0);

    hero.addEventListener('mouseenter', function () { setPaused(true); });
    hero.addEventListener('mouseleave', function () { setPaused(false); });
    hero.addEventListener('focusin', function () { setPaused(true); });
    hero.addEventListener('focusout', function (event) {
      if (!hero.contains(event.relatedTarget)) setPaused(false);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        window.clearTimeout(timer);
      } else if (!paused) {
        schedule();
      }
    });

    if (typeof reduceMotion.addEventListener === 'function') {
      reduceMotion.addEventListener('change', function () {
        window.clearTimeout(timer);
        if (!reduceMotion.matches && !paused) schedule();
      });
    } else if (typeof reduceMotion.addListener === 'function') {
      reduceMotion.addListener(function () {
        window.clearTimeout(timer);
        if (!reduceMotion.matches && !paused) schedule();
      });
    }

    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuroreHeroMorph, { once: true });
  } else {
    initAuroreHeroMorph();
  }
})();
