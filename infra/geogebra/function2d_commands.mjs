const FUNCTION_NAME_CANDIDATES = [
  "f","g","h","k","m","n","p","q","r","s","u","v","w",
  "f1","f2","f3","f4","f5","f6","f7","f8","f9",
];

// GeoGebra built-ins that are valid inside a function2d expression.
// Unknown calls such as pH(x) are not executable unless pH is explicitly
// defined as a local function in the graph payload.
const GEO_GEBRA_FUNCTIONS = new Set([
  "abs","acos","acosh","asin","asinh","atan","atanh","ceil","cos","cosh",
  "cot","csc","exp","floor","if","integral","ln","log","max","min","n",
  "round","sec","sign","sin","sinh","sqrt","tan","tanh",
]);

function assertKnownFunctionCalls(body, localNames = new Set()) {
  const source = String(body ?? "");
  const allowed = new Set([
    ...GEO_GEBRA_FUNCTIONS,
    ...localNames,
  ]);

  const unknown = [];
  for (const match of source.matchAll(/\\b([A-Za-z][A-Za-z0-9_]*)\\s*\\(/g)) {
    const name = match[1];
    if (!allowed.has(name.toLowerCase()) && !unknown.includes(name)) {
      unknown.push(name);
    }
  }

  if (unknown.length) {
    throw new TypeError(
      `Fonction GeoGebra non définie dans l'expression : ${unknown.join(", ")}. Définissez-la explicitement avant le tracé.`,
    );
  }
}

function cleanExpression(raw) {
  let s = String(raw ?? "")
    .trim()
    .replace(/^\s*(?:f\s*\(\s*[A-Za-z]\s*\)|y)\s*=\s*/i, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/\bln\s*\(/gi, "ln(")
    .replace(/\blog\s*\(/gi, "log(");
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
    assertKnownFunctionCalls(body, reservedNames);
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
