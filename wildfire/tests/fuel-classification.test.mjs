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

const classifier = vm.runInNewContext(
  extractFunction("fsFuelFromInventoryProperties") + "\nfsFuelFromInventoryProperties"
);

test("explicit herbaceous and shrub inventory classes map to Anderson model proxies", () => {
  assert.equal(classifier({ TIPES_es: "Herbazal" }), "fm1");
  assert.equal(classifier({ TIPES_es: "Prado" }), "fm1");
  assert.equal(classifier({ TIPES_es: "Matorral" }), "fm5");
  assert.equal(classifier({ TIPES_es: "Helechal" }), "fm5");
  assert.equal(classifier({ TIPES_es: "Pastizal-matorral" }), null);
});

test("single dominant tree species maps to a litter proxy, not a definitive fuel survey", () => {
  assert.equal(classifier({ SP1_es: "Pinus radiata" }), "fm8");
  assert.equal(classifier({ SP1_es: "Pseudotsuga menziesii" }), "fm8");
  assert.equal(classifier({ SP1_es: "Fagus sylvatica" }), "fm9");
  assert.equal(classifier({ SP1_es: "Quercus robur" }), "fm9");
  assert.equal(classifier({ SP1_es: "Eucalyptus globulus" }), null);
  assert.equal(classifier({ SP1_es: "Especie no catalogada" }), null);
});

test("mixed, ambiguous and incomplete inventory features remain unresolved", () => {
  assert.equal(classifier({ SP1_es: "Pinus radiata", SP2_es: "Fagus sylvatica" }), null);
  assert.equal(classifier({ TIPES_es: "Bosque", SP1_es: "" }), null);
  assert.equal(classifier({ TIPES_es: "Pastizal-matorral", SP1_es: "Pinus radiata" }), null);
});

test("the 13-model catalog includes every inventory proxy returned by the classifier", () => {
  const models = new Set([...html.matchAll(/fm(1[0-3]|[1-9]):\{id:\1,n:/g)].map(m => `fm${m[1]}`));
  for (const key of ["fm1", "fm5", "fm8", "fm9"]) assert.ok(models.has(key));
  assert.equal(models.size, 13);
});

test("the fuel source selector keeps inventory and manual Rothermel, with no WMS source", () => {
  assert.match(html, /value="inventory"/);
  assert.match(html, /value="rothermel"/);
  assert.doesNotMatch(html, /value="wms"|FS_FOREST_WMS|Kanpoko baso-WMSa/);
  assert.doesNotMatch(html, /function fsCover\(/);
});
