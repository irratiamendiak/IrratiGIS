import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists in index.html`);
  const open = html.indexOf("{", start);
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

const classifier = vm.runInNewContext([
  extractFunction("fsFuelFromInventoryProperties"),
  extractFunction("fsFuelFromCover")
].join("\n") + "\n({ fsFuelFromInventoryProperties, fsFuelFromCover })");

test("inventory use classes map only the explicit herbaceous and shrub classes", () => {
  const map = classifier.fsFuelFromInventoryProperties;
  assert.equal(map({ TIPES_es: "Herbazal" }), "belarra");
  assert.equal(map({ TIPES_es: "", TIPES: "Herbazal" }), "belarra");
  assert.equal(map({ TIPES_es: "Prado" }), "belarra");
  assert.equal(map({ TIPES_es: "Matorral" }), "garoa");
  assert.equal(map({ TIPES_es: "Pastizal-matorral" }), null);
  assert.equal(map({ TIPES_es: "Bosque" }), null);
  assert.equal(map({ TIPES_es: "Bosque de plantación" }), null);
});

test("known conifer and broadleaf species suggest only their broad cover group", () => {
  const map = classifier.fsFuelFromInventoryProperties;
  assert.equal(map({ SP1_es: "Pinus radiata" }), "pinudia");
  assert.equal(map({ SP1_es: "Pseudotsuga menziesii" }), "pinudia");
  assert.equal(map({ SP1_es: "Fagus sylvatica" }), "hostozabala");
  assert.equal(map({ SP1_es: "Quercus robur" }), "hostozabala");\n  assert.equal(map({ SP1_es: "Pino radiata" }), "pinudia");\n  assert.equal(map({ SP1_es: "Haya" }), "hostozabala");
  assert.equal(map({ SP1_es: "Eucalyptus globulus" }), null);
  assert.equal(map({ SP1_es: "Especie no catalogada" }), null);
});

test("mixed species and ambiguous or incomplete map features remain unresolved", () => {
  const map = classifier.fsFuelFromInventoryProperties;
  assert.equal(map({ SP1_es: "Pinus radiata", SP2_es: "Fagus sylvatica" }), null);
  assert.equal(map({ TIPES_es: "Bosque", SP1_es: "" }), null);
  assert.equal(map({ TIPES_es: "Pastizal-matorral", SP1_es: "Pinus radiata" }), "pinudia");
});

test("cover aggregation refuses disagreement and unresolved inventory features", () => {
  const aggregate = classifier.fsFuelFromCover;
  const feature = properties => ({ source: "inventory", properties });
  assert.equal(aggregate([feature({ SP1_es: "Pinus radiata" }), feature({ SP1_es: "Pinus sylvestris" })]), "pinudia");
  assert.equal(aggregate([feature({ SP1_es: "Pinus radiata" }), feature({ SP1_es: "Fagus sylvatica" })]), null);
  assert.equal(aggregate([feature({ SP1_es: "Pinus radiata" }), feature({ TIPES_es: "Bosque" })]), null);
  assert.equal(aggregate([]), null);
});

test("inventory classification is structurally separate from textual WMS fallback", () => {
  const source = html.slice(html.indexOf("function fsFuelFromText"), html.indexOf("function fsCoverFromInventory"));
  assert.match(source, /function fsFuelFromInventoryProperties/);
  assert.match(source, /source===\"inventory\"/);
  assert.doesNotMatch(source, /eukali|eucalip|bosque|arbolado/);
});
