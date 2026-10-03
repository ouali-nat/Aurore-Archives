const FUNCTION_NAME_CANDIDATES = [
  "f","g","h","k","m","n","p","q","r","s","u","v","w",
  "f1","f2","f3","f4","f5","f6","f7","f8","f9",
];

function cleanExpression(raw) {
  let s = String(raw ?? "")
    .trim()
    .replace(/^\s*(?:f\s*\(\s*[A-Za-z]\s*\)|y)\s*=\s*/i, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/\bln\s*\(/gi, "ln(")
    .replace(/\blog\s*\(/gi, "log(")
    .replace(/\bif\s*\(/gi, "If(");
  if (/\bx\b/i.test(s)) return s;
  if (/\bt\b/i.test(s)) return s.replace(/\bt\b/g, "x");
  return s;
}

function extractNamedFunction(raw) {
  const match = String(raw ?? "").trim().match(
    /^([A-Za-z][A-Za-z0-9_]*)\s*\(\s*[A-Za-z]\s*\)\s*=\s*(.+)$/s,
  );
  return match ? { name: match[1], body: match[2] } : null;
}

const GEO_GEBRA_KNOWN_FUNCTIONS = new Set([
  "abs","acos","asin","atan","cos","cosh","cot","coth","csc","exp","floor","ceil",
  "if","integral","ln","log","max","min","mod","nroot","round","sec","sech","sgn",
  "sin","sinh","sqrt","sum","tan","tanh","random","randombetween","countif",
  "derivative","function","sequence","zip","length","element","first","last",
]);

const GEO_GEBRA_KNOWN_CONSTANTS = new Set(["e","pi","i"]);

function identifierTokens(raw) {
  return String(raw ?? "").match(/\b[A-Za-z][A-Za-z0-9_]*\b/g) || [];
}

function functionCallNames(raw) {
  const names = [];
  const re = /\b([A-Za-z][A-Za-z0-9_]*)\s*\(/g;
  let match;
  while ((match = re.exec(String(raw ?? ""))) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Validate scalar identifiers used by function2d and emit the minimal
 * constructions needed for free mathematical parameters. A single uppercase
 * symbol such as C is a conventional scalar parameter and is initialized to
 * 1 for a static PDF snapshot. Named function calls must already have a
 * definition in the graph itself or in companion_expressions; otherwise the
 * renderer refuses the graph instead of inventing a curve.
 */
export function buildFunction2DParameterCommands(expressions, companionExpressions = []) {
  if (!Array.isArray(expressions)) {
    throw new TypeError("function2d expression array attendu.");
  }

  const definedFunctions = new Set();
  for (const raw of [...expressions, ...(Array.isArray(companionExpressions) ? companionExpressions : [])]) {
    const named = extractNamedFunction(raw);
    if (named) definedFunctions.add(named.name.toLowerCase());
  }

  const scalarParameters = new Set();
  const unresolvedFunctions = new Set();
  const unresolvedScalars = new Set();

  for (const raw of expressions) {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new TypeError("Chaque expression function2d doit être une chaîne non vide.");
    }
    const named = extractNamedFunction(raw);
    const body = cleanExpression(named ? named.body : raw);
    for (const functionName of functionCallNames(body)) {
      const lower = functionName.toLowerCase();
      if (GEO_GEBRA_KNOWN_FUNCTIONS.has(lower) || definedFunctions.has(lower)) continue;
      unresolvedFunctions.add(functionName);
    }

    for (const token of identifierTokens(body)) {
      const lower = token.toLowerCase();
      if (lower === "x" || lower === "t") continue;
      if (GEO_GEBRA_KNOWN_FUNCTIONS.has(lower) || GEO_GEBRA_KNOWN_CONSTANTS.has(lower)) continue;
      if (definedFunctions.has(lower)) continue;
      if (/^[A-Z]$/.test(token)) {
        scalarParameters.add(token);
      } else {
        unresolvedScalars.add(token);
      }
    }
  }

  if (unresolvedFunctions.size) {
    throw new TypeError(
      "GeoGebra function2d : fonction(s) non définie(s) : " +
      [...unresolvedFunctions].sort().join(", ") + ".",
    );
  }
  if (unresolvedScalars.size) {
    throw new TypeError(
      "GeoGebra function2d : identifiant(s) scalaire(s) non défini(s) : " +
      [...unresolvedScalars].sort().join(", ") + ".",
    );
  }

  return [...scalarParameters].sort().map((name) => name + "=1");
}

export function buildFunction2DArrayCommands(expressions, companionExpressions = []) {
  if (!Array.isArray(expressions)) {
    throw new TypeError("function2d expression array attendu.");
  }

  const items = expressions
    .map((raw) => {
      if (typeof raw !== "string") {
        throw new TypeError("Chaque expression function2d doit être une chaîne.");
      }
      const value = raw.trim();
      if (!value) throw new TypeError("Une expression function2d ne peut pas être vide.");
      return value;
    });

  if (!items.length) {
    throw new TypeError("Le tableau expression function2d ne peut pas être vide.");
  }

  const reservedNames = new Set();
  for (const raw of [...items, ...(Array.isArray(companionExpressions) ? companionExpressions : [])]) {
    const named = extractNamedFunction(raw);
    if (named) reservedNames.add(named.name.toLowerCase());
  }

  let generatedIndex = 0;
  const nextGeneratedName = () => {
    while (generatedIndex < FUNCTION_NAME_CANDIDATES.length) {
      const candidate = FUNCTION_NAME_CANDIDATES[generatedIndex++];
      if (!reservedNames.has(candidate.toLowerCase())) return candidate;
    }
    let suffix = generatedIndex;
    while (reservedNames.has("f" + suffix)) suffix += 1;
    generatedIndex = suffix + 1;
    return "f" + suffix;
  };

  const commands = [];
  const functionNames = [];
  const localNames = new Set();

  for (const raw of items) {
    const named = extractNamedFunction(raw);
    let name;
    let body;

    if (named) {
      name = named.name;
      body = cleanExpression(named.body);
    } else {
      name = nextGeneratedName();
      body = cleanExpression(raw);
    }

    if (!body) throw new TypeError("Une expression function2d ne peut pas être vide après normalisation.");
    const lowerName = name.toLowerCase();
    if (localNames.has(lowerName)) {
      throw new TypeError("Deux expressions function2d utilisent le même nom d'objet: " + name);
    }

    localNames.add(lowerName);
    commands.push(name + "(x)=" + body);
    functionNames.push(name);
  }

  return { commands, functionNames };
}
