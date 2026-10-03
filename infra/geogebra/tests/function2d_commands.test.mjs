import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFunction2DArrayCommands,
  buildFunction2DParameterCommands,
} from "../function2d_commands.mjs";

test("deux expressions brutes deviennent deux fonctions GeoGebra distinctes", () => {
  assert.deepEqual(
    buildFunction2DArrayCommands(["x", "x^2"]),
    {
      commands: ["f(x)=x", "g(x)=x^2"],
      functionNames: ["f", "g"],
    },
  );
});

test("un tableau d'une expression conserve le comportement f(x)=...", () => {
  assert.deepEqual(
    buildFunction2DArrayCommands(["sqrt(x)"]),
    {
      commands: ["f(x)=sqrt(x)"],
      functionNames: ["f"],
    },
  );
});

test("la variable t est adaptée vers x sans modifier la structure de la fonction", () => {
  assert.deepEqual(
    buildFunction2DArrayCommands(["exp(-0.2*t)"]),
    {
      commands: ["f(x)=exp(-0.2*x)"],
      functionNames: ["f"],
    },
  );
});

test("une fonction explicitement nommée est conservée dans un tableau", () => {
  assert.deepEqual(
    buildFunction2DArrayCommands(["a(t)=100+2*t", "b(x)=x^2"]),
    {
      commands: ["a(x)=100+2*x", "b(x)=x^2"],
      functionNames: ["a", "b"],
    },
  );
});

test("une fonction de domaine explicite reste intacte", () => {
  assert.deepEqual(
    buildFunction2DArrayCommands(["If(x>0,1/x,0)"]),
    {
      commands: ["f(x)=If(x>0,1/x,0)"],
      functionNames: ["f"],
    },
  );
});

test("une commande conditionnelle écrite en minuscules est normalisée pour GeoGebra", () => {
  assert.deepEqual(
    buildFunction2DArrayCommands(["if(x>0,1/x,0)"]),
    {
      commands: ["f(x)=If(x>0,1/x,0)"],
      functionNames: ["f"],
    },
  );
});

test("les noms utilisés par les companions sont réservés lors de la génération", () => {
  assert.deepEqual(
    buildFunction2DArrayCommands(["x", "x^2"], ["g(x)=sin(x)"]),
    {
      commands: ["f(x)=x", "h(x)=x^2"],
      functionNames: ["f", "h"],
    },
  );
});

test("un tableau invalide est rejeté explicitement au lieu d'être converti en texte", () => {
  assert.throws(
    () => buildFunction2DArrayCommands(["x", 2]),
    /Chaque expression function2d doit être une chaîne/,
  );
  assert.throws(
    () => buildFunction2DArrayCommands([]),
    /ne peut pas être vide/,
  );
});

test("le renderer transmet le graphe préparé à page.evaluate", () => {
  const source = fs.readFileSync(
    new URL("../render_missing_graphs.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /return await page\.evaluate\(async \(graph\) => \{[\s\S]*?\n\s*\}, preparedGraph\);/,
    "Le graphe préparé doit être transmis à page.evaluate.",
  );
  assert.doesNotMatch(
    source,
    /return await page\.evaluate\(async \(graph\) => \{[\s\S]*?\n\s*\}, graph\);/,
    "Le renderer ne doit pas retransmettre le graphe original après préparation.",
  );
});


test("une définition scalaire nommée pH(x)=... reste une construction valide", () => {
  assert.deepEqual(
    buildFunction2DArrayCommands(["pH(x)=2+12/(1+e^(-0.5*(x-10)))"]),
    {
      commands: ["pH(x)=2+12/(1+e^(-0.5*(x-10)))"],
      functionNames: ["pH"],
    },
  );
});


test("un paramètre scalaire libre C est matérialisé avant la fonction", () => {
  assert.deepEqual(
    buildFunction2DParameterCommands(["C*exp(-x)"]),
    ["C=1"],
  );
});

test("une fonction nommée non définie est rejetée au lieu d'être inventée", () => {
  assert.throws(
    () => buildFunction2DParameterCommands(["F(x)"]),
    /fonction\(s\) non définie\(s\).*F/,
  );
});

test("un identifiant scalaire descriptif non déclaré est rejeté", () => {
  assert.throws(
    () => buildFunction2DParameterCommands(["densite"]),
    /identifiant\(s\) scalaire\(s\) non défini\(s\).*densite/,
  );
});

test("une fonction compagnon déclarée peut être référencée", () => {
  assert.deepEqual(
    buildFunction2DParameterCommands(["F(x)"], ["F(x)=x^2"]),
    [],
  );
});

test("le renderer place les paramètres avant les commandes function2d", () => {
  const source = fs.readFileSync(
    new URL("../render_missing_graphs.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /render_function_parameter_commands[\s\S]*commands\.push\(\.\.\.graph\.render_function_commands\)/,
    "Les paramètres doivent être ajoutés avant les constructions de fonctions.",
  );
});
