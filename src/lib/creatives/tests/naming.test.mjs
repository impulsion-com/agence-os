// Nomenclature des annonces. Usage : node --experimental-strip-types --test src/lib/creatives/tests/naming.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { guessSeparator, namingCoverage, namingFields, parseAdName, readNaming } from "../naming.ts";

test("préfixes détectés sans réglage (façon Motion)", () => {
  assert.deepEqual(parseAdName("F:UGC | A:Routine | H:Problème | Routine du soir"), { F: "UGC", A: "Routine", H: "Problème" });
  assert.deepEqual(parseAdName("T:MaleTalent_F:TopFunnel"), { T: "MaleTalent", F: "TopFunnel" });
  assert.deepEqual(parseAdName("Routine du soir"), {});
});

test("préfixes déclarés : libellés et filtre", () => {
  const cfg = readNaming({ mode: "prefix", separator: "|", fields: [{ key: "F", label: "Format" }, { key: "h", label: "Accroche" }] });
  assert.deepEqual(parseAdName("F:UGC | A:Routine | H:Problème", cfg), { Format: "UGC", Accroche: "Problème" });
});

test("positions (façon Creaboost)", () => {
  const cfg = readNaming({ mode: "position", separator: "_", fields: [{ key: "1", label: "Format" }, { key: "3", label: "Accroche" }] });
  assert.deepEqual(parseAdName("UGC_Routine_Problème_V2", cfg), { Format: "UGC", Accroche: "Problème" });
  assert.deepEqual(parseAdName("UGC", cfg), { Format: "UGC" });
});

test("séparateur deviné", () => {
  assert.equal(guessSeparator("a | b | c"), "|");
  assert.equal(guessSeparator("a_b_c"), "_");
  assert.equal(guessSeparator("simple"), "");
});

test("réglage illisible : retour aux préfixes automatiques", () => {
  assert.deepEqual(readNaming(null), { mode: "prefix", separator: "", fields: [] });
  assert.deepEqual(readNaming({ mode: "x", fields: [{ key: " ", label: "X" }, 3] }).fields, []);
});

test("champs présents et couverture", () => {
  const names = ["F:UGC | A:Routine", "F:Statique | A:Avis", "F:UGC", "Sans nomenclature"];
  assert.deepEqual(namingFields(names), [{ label: "F", count: 3 }, { label: "A", count: 2 }]);
  assert.equal(namingCoverage(names), 0.75);
});

test("nom lisible sans les propriétés", async () => {
  const { displayName } = await import("../naming.ts");
  assert.equal(displayName("F:UGC | A:Routine | Routine du soir"), "Routine du soir");
  assert.equal(displayName("F:UGC | A:Routine"), "F:UGC | A:Routine");
  assert.equal(displayName("UGC_Routine", { mode: "position", separator: "_", fields: [] }), "UGC_Routine");
});
