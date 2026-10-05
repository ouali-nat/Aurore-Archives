/**
 * Aurore GeoGebra renderer contract.
 *
 * This is deliberately stricter than GeoGebra itself: an entry is accepted
 * only when the Aurore server-side renderer has a construction path for it.
 * Keep this contract synchronized with render_missing_graphs.mjs.
 */
export const GEO_GEBRA_RENDERER_CONTRACT_VERSION = 5;

export const GEOMETRY2D_SUPPORTED_TYPES = new Set([
  "point",
  "vector",
  "line",
  "ray",
  "polygon",
]);

export const GEOMETRY3D_SUPPORTED_TYPES = new Set([
  "point",
  "vector",
  "line",
  "plane",
  "sphere",
  "cylinder",
  "cone",
  "polygon",
  "cube",
  "prism",
  "pyramid",
  "tetrahedron",
]);

export const FUNCTION2D_SUPPORTED_FUNCTIONS = new Set([
  "abs","acos","asin","atan","cos","cosh","cot","coth","csc","exp",
  "floor","ceil","if","integral","ln","log","max","min","mod","nroot",
  "round","sec","sech","sgn","sin","sinh","sqrt","sum","tan","tanh",
  "random","randombetween","countif","derivative","function","sequence",
  "zip","length","element","first","last",
]);

export function normalizeInstrument(raw) {
  const value = String(raw || "").toLowerCase().trim();
  return ({
    function: "function2d",
    graph: "function2d",
    courbe: "function2d",
    parametric: "parametric2d",
    vector2d: "geometry2d",
    plan2d: "geometry2d",
    geometrie3d: "geometry3d",
    "3d": "geometry3d",
  })[value] || value;
}

export function rendererObjectTypeSupported(instrument, type) {
  const t = String(type || "").toLowerCase().trim();
  if (instrument === "geometry2d") return GEOMETRY2D_SUPPORTED_TYPES.has(t);
  if (instrument === "geometry3d") return GEOMETRY3D_SUPPORTED_TYPES.has(t);
  return false;
}
