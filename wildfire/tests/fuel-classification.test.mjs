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
  const source = html.slice(html.indexOf("function fsFuelFromText"), html.indexOf("function fsCoverFromInventory"));
  assert.match(source, /function fsFuelFromInventoryProperties/);
  assert.match(source, /source===\"inventory\"/);
  assert.doesNotMatch(source, /eukali|eucalip|bosque|arbolado/);
});

test("cover diagnostics identify the effective source and expose classification decisions", () => {
  const coverStart = html.indexOf("async function fsCover(");
  const coverEnd = html.indexOf("\nfunction fsStrategy(", coverStart);
  const cover = html.slice(coverStart, coverEnd > coverStart ? coverEnd : undefined);
  assert.match(html, /source:"wms"/);
  assert.match(html, /Origen efectivo:/);
  assert.match(html, /Diagnóstico de clasificación/);
  assert.match(html, /Resultado agregado:/);
});


test("inventory spatial query reports why the local layer did not provide features", () => {
  const run = ({ enabled = true, gl = null } = {}) => {
    const context = {
      map: { hasLayer: () => enabled },
      inventarioForestalLayer: { getMaplibreMap: () => gl },
      escapeHtml: value => String(value)
    };
    return vm.runInNewContext(extractFunction("fsCoverFromInventory") + "\nfsCoverFromInventory", context);
  };
  assert.equal(run({ enabled: false })({ lat: 43, lng: -2 }).status, "layer-disabled");
  assert.equal(run()({ lat: 43, lng: -2 }).status, "maplibre-unavailable");
  const base = {
    isStyleLoaded: () => true,
    getLayer: () => ({}),
    project: () => ({ x: 10, y: 10 }),
    queryRenderedFeatures: () => []
  };
  assert.equal(run({ gl: { ...base, isStyleLoaded: () => false } })({ lat: 43, lng: -2 }).status, "style-not-loaded");
  assert.equal(run({ gl: { ...base, getLayer: () => null } })({ lat: 43, lng: -2 }).status, "style-layer-missing");
  assert.equal(run({ gl: base })({ lat: 43, lng: -2 }).status, "query-empty");
  const found = run({ gl: { ...base, queryRenderedFeatures: () => [{ properties: { TIPES_es: "Herbazal" } }] } })({ lat: 43, lng: -2 });
  assert.equal(found.status, "features-found");
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].source, "inventory");
});
