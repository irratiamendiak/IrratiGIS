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
  extractFunction("fsFuelLidarRange") + "\n" + extractFunction("fsFuelFromInventoryProperties") + "\nfsFuelFromInventoryProperties"
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


test("2024 inventory codes use O1-O3 dominance and keep equal mixed stands unresolved", () => {
  assert.equal(classifier({
    TIPES_ES: "Bosque", SP1: 982, SP1_ES: "Bosque mixto atlántico", O1: 10,
    SP2: 960, SP2_ES: "Plantaciones variadas de frondosas", O2: 5
  }), "fm10");
  assert.equal(classifier({
    TIPES_ES: "Bosque", SP1: 982, SP1_ES: "Bosque mixto atlántico", O1: 5,
    SP2: 960, SP2_ES: "Plantaciones variadas de frondosas", O2: 5
  }), null);
  assert.equal(classifier({
    TIPES_ES: "Bosque", SP1: 960, SP1_ES: "Plantaciones variadas de frondosas", O1: 10
  }), "fm9");
  assert.equal(classifier({
    TIPES_ES: "Bosque", SP1: 961, SP1_ES: "Plantaciones variadas de coníferas", O1: 10
  }), "fm8");
  assert.equal(classifier({
    TIPES_ES: "Bosque", SP1: 962, SP1_ES: "Plantaciones variadas de frondosas y coníferas", O1: 10
  }), null);
});

test("LiDAR 2012 only promotes broadleaf plantation proxy when both understory indicators clear thresholds", () => {
  const stand = { TIPES_ES: "Bosque", SP1: 960, SP1_ES: "Plantaciones variadas de frondosas", O1: 10 };
  assert.equal(classifier(stand, { LEYENDA_HEIGHT: "40-60", LEYENDA_MASS: "20-40" }), "fm10");
  assert.equal(classifier(stand, { LEYENDA_HEIGHT: "0-40", LEYENDA_MASS: "20-40" }), "fm9");
  assert.equal(classifier(stand, { LEYENDA_HEIGHT: "40-60", LEYENDA_MASS: "0-20" }), "fm9");
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
