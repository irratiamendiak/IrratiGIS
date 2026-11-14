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
  assert.equal(map({ SP1_es: "Quercus robur" }), "hostozabala");
  assert.equal(map({ SP1_es: "Pino radiata" }), "pinudia");
  assert.equal(map({ SP1_es: "Haya" }), "hostozabala");
  assert.equal(map({ SP1_es: "Eucalyptus globulus" }), null);
  assert.equal(map({ SP1_es: "Especie no catalogada" }), null);
});

test("mixed species and ambiguous or incomplete map features remain unresolved", () => {
  const map = classifier.fsFuelFromInventoryProperties;
  assert.equal(map({ SP1_es: "Pinus radiata", SP2_es: "Fagus sylvatica" }), null);
  assert.equal(map({ TIPES_es: "Bosque", SP1_es: "" }), null);
  assert.equal(map({ TIPES_es: "Pastizal-matorral", SP1_es: "Pinus radiata" }), null);
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
  const inventory = vm.runInNewContext(extractFunction("fsFuelFromInventoryProperties") + "\nfsFuelFromInventoryProperties");
  const fallback = vm.runInNewContext(extractFunction("fsFuelFromText") + "\nfsFuelFromText");
  assert.equal(fallback("bosque"), null);
  assert.equal(fallback("arbolado"), null);
  assert.equal(fallback("Eucalyptus globulus"), null);
  assert.equal(inventory({ SP1_es: "Pinus radiata" }), "pinudia");
  assert.equal(inventory({ SP1_es: "Eucalyptus globulus" }), null);
});
test("inventory fuel source uses the persistent 2024 auxiliary map and shared cache", () => {
  assert.match(html, /let fsFuelSource="inventory"/);
  assert.match(html, /const fsInventoryFuelCache=new Map\(\)/);
  assert.match(html, /async function fsCreateInventoryFuelSampler\(/);
  assert.match(html, /fsCreateInventoryFuelSampler\(map\.getCenter\(\)\)/);
  assert.match(html, /source:"inventory"/);
  assert.match(html, /queryRenderedFeatures\(px,\{layers:\["forestal-poligonos"\]\}\)/);
});
test("inventory spatial query reports why the local layer did not provide features", async () => {
  const run = ({ enabled = true, gl = null } = {}) => {
    const context = {
      map: { hasLayer: () => enabled },
      inventarioForestalLayer: { getMaplibreMap: () => gl },
      escapeHtml: value => String(value)
    };
    const source = extractFunction("fsCoverFromInventory").replace(/^(?!async\s)function\s/, "async function ");
    return vm.runInNewContext(source + "\nfsCoverFromInventory", context);
  };
  assert.equal((await run({ enabled: false })({ lat: 43, lng: -2 })).status, "layer-disabled");
  assert.equal((await run()({ lat: 43, lng: -2 })).status, "maplibre-unavailable");
  const base = {
    isStyleLoaded: () => true,
    getLayer: () => ({}),
    project: () => ({ x: 10, y: 10 }),
    queryRenderedFeatures: () => []
  };
  assert.equal((await run({ gl: { ...base, isStyleLoaded: () => false } })({ lat: 43, lng: -2 })).status, "style-not-loaded");
  assert.equal((await run({ gl: { ...base, getLayer: () => null } })({ lat: 43, lng: -2 })).status, "style-layer-missing");
  assert.equal((await run({ gl: base })({ lat: 43, lng: -2 })).status, "query-empty");
  const found = await run({ gl: { ...base, queryRenderedFeatures: () => [{ properties: { TIPES_es: "Herbazal" } }] } })({ lat: 43, lng: -2 });
  assert.equal(found.status, "features-found");
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].source, "inventory");
});
