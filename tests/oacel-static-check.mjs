import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=/.test(m[1]) &&
    !/\btype\s*=\s*["'](?:application\/json|application\/ld\+json)/i.test(m[1]));

assert.ok(scripts.length > 0, "Expected at least one inline JavaScript block");
for (const [index, script] of scripts.entries()) {
  assert.doesNotThrow(
    () => new Function(script[2]),
    "Inline script " + (index + 1) + " must parse"
  );
}

const required = [
  ["motorway and trunk links excluded from pedestrian graph", '!["motorway","motorway_link","trunk","trunk_link"].includes(w.tags.highway)'],
  ["sampled fire-arrival checks", "fireSamples"],
  ["reverse edge samples", "fireSamples:fireSamples.map(p=>({f:1-p.f,arrival:p.arrival})).reverse()"],
  ["off-network connector checks", "const connectorSafe="],
  ["route diagnostic status", "no_connected_route_passed_checks"],
  ["diagnostic in exported metadata", "route_status:fsLast.osm?.routeStatus"],
  ["GeoJSON point latitude and longitude bounds", "Math.abs(lat)<=90&&Math.abs(lon)<=180"],
  ["GeoJSON coordinates reversed from lat/lon to lon/lat", "const xy=pts=>pts.map(p=>[Number(p[1]),Number(p[0])])"],
  ["GeoJSON polygon rings closed", "if(a[0]!==b[0]||a[1]!==b[1]) ring.push([...a])"],
  ["GeoJSON rejects degenerate polygon rings", "if(!Number.isFinite(twiceArea)||Math.abs(twiceArea)<1e-12) return"],
  ["GeoJSON exterior rings use counter-clockwise winding", "if(twiceArea<0){ ring.pop(); ring.reverse(); ring.push([...ring[0]]); }"],
  ["GeoJSON line coordinate validation", "const line=(pts,properties)=>{ if(validPts(pts))"],
  ["reject null and empty GeoJSON coordinates", 'const validCoord=v=>v!==null&&v!==""&&v!==undefined&&Number.isFinite(Number(v))'],
  ["GeoJSON polygon coordinate bounds", "Math.abs(Number(p[0]))<=90&&Math.abs(Number(p[1]))<=180"],
  ["GeoJSON collection metadata and coordinate order", 'coordinate_order:"[longitude, latitude]"'],
  ["GeoJSON route warning preserved", "confirmar accesibilidad, fuego, humo, pendiente, comunicaciones y destino en terreno."],
  ["WGS84 GeoJSON export", "application/geo+json;charset=utf-8"],
  ["safety disclaimer", "no certifica seguridad"],
];
for (const [label, token] of required) {
  assert.ok(html.includes(token), "Missing expected feature: " + label);
}

console.log("Static OACEL checks passed: " + scripts.length +
  " inline scripts parsed; " + required.length + " feature guards found.");

const exportStart = html.indexOf("function fsExportGeoJSON(){");
const helpersStart = html.indexOf("  const xy=pts=>", exportStart);
const helpersEnd = html.indexOf("  (D.perimeters||[])", helpersStart);
assert.ok(exportStart >= 0 && helpersStart > exportStart && helpersEnd > helpersStart,
  "Expected GeoJSON geometry helpers inside fsExportGeoJSON");
const emitted = [];
const helpersSource = html.slice(helpersStart, helpersEnd);
const helpers = new Function("add", helpersSource +
  "\nreturn {xy,validPts,line,polygon,point};")((geometry, properties) =>
    emitted.push({geometry, properties}));

assert.deepEqual(helpers.xy([[42.5, -2.7], [43, -3]]),
  [[-2.7, 42.5], [-3, 43]], "Coordinates must be emitted as longitude, latitude");
assert.equal(helpers.validPts([[42, -2], [43, -3]]), true);
assert.equal(helpers.validPts([[91, -2], [43, -3]]), false,
  "Latitude outside [-90, 90] must be rejected");
assert.equal(helpers.validPts([[42, 181], [43, -3]]), false,
  "Longitude outside [-180, 180] must be rejected");
assert.equal(helpers.validPts([[null, -2], [43, -3]]), false,
  "Null coordinates must not coerce to zero");
assert.equal(helpers.validPts([["", -2], [43, -3]]), false,
  "Empty coordinates must not coerce to zero");
helpers.line([[42, -2]], {kind: "invalid_line"});
assert.equal(emitted.length, 0, "Lines with fewer than two points must be rejected");
helpers.line([[42, -2], [43, -3]], {kind: "valid_line"});
assert.equal(emitted.length, 1);
assert.deepEqual(emitted[0].geometry.coordinates, [[-2, 42], [-3, 43]]);
emitted.length = 0;
helpers.polygon([[42, -2], [43, -3], [44, -2]], {kind: "test_polygon"});
assert.equal(emitted.length, 1);
const ring = emitted[0].geometry.coordinates[0];
assert.deepEqual(ring[0], ring[ring.length - 1],
  "Polygon ring must be closed");
let signedArea = 0;
for (let i = 0; i < ring.length - 1; i++) {
  signedArea += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
}
assert.ok(signedArea > 0, "Exterior polygon ring must be counter-clockwise");
emitted.length = 0;
helpers.polygon([[91, -2], [43, -3], [44, -4]], {kind: "invalid_polygon"});
assert.equal(emitted.length, 0, "Invalid polygon coordinates must be rejected");
helpers.polygon([[null, -2], [43, -3], [44, -4]], {kind: "invalid_polygon"});
assert.equal(emitted.length, 0, "Null polygon coordinates must be rejected");
helpers.polygon([[42, -2], [42, -2], [42, -2]], {kind: "degenerate_polygon"});
assert.equal(emitted.length, 0, "Polygon with fewer than three distinct vertices must be rejected");
helpers.polygon([[42, -2], [43, -3], [44, -4]], {kind: "collinear_polygon"});
assert.equal(emitted.length, 0, "Zero-area polygon must be rejected");
helpers.point(91, -2, {kind: "invalid_point"});
helpers.point(42, 181, {kind: "invalid_point"});
assert.equal(emitted.length, 0, "Out-of-range points must be rejected");
helpers.point(42, -2, {kind: "valid_point"});
assert.deepEqual(emitted[0].geometry.coordinates, [-2, 42]);

console.log("Executable GeoJSON geometry tests passed.");

const exportEnd = html.indexOf("\n\n/* --- panela --- */", exportStart);
assert.ok(exportEnd > exportStart, "Expected end of GeoJSON export function");
const exportSource = html.slice(exportStart, exportEnd);
let capturedBlob;
const fakeUrl = {
  createObjectURL(blob) { capturedBlob = blob; return "blob:geojson-test"; },
  revokeObjectURL() {},
};
const fakeAnchor = { href: "", download: "", click() {}, remove() {} };
const fakeDocument = {
  createElement() { return { ...fakeAnchor }; },
  body: { appendChild() {} },
};
const fakeButton = { textContent: "", isConnected: true };
const fakePanel = { querySelector(selector) { return selector === ".fs-export" ? fakeButton : null; } };
const exportState = {
  ign: { lat: 42, lng: -2 },
  osm: { routeStatus: "candidate_routes_found", routeStatusMessage: "candidate only" },
  draw: {
    perimeters: [
      { minutes: 30, area_ha: 4.2, pts: [[42, -2], [42.1, -2], [42.1, -1.9]] },
      { minutes: 60, area_ha: "unknown", pts: [[91, -2], [42, -2], [42.1, -1.9]] },
    ],
    control: [{ pts: [[42, -2], [42.01, -2.01]], riv: false, type: "path", name: "trail" }],
    safe: [[[42, -2], [42, -2], [42, -2]]],
    escape: [[[42, -2], [42.02, -2.02]]],
    escapeRoutes: [{
      pts: [[42, -2], [42.02, -2.02]], zone_name: "candidate area", zone_index: 1,
      length_m: 200, eta_min: 4, network_eta_min: 3, start_snap_m: 10,
      destination_snap_m: 15, fire_margin_min: 10, elapsed_since_ignition_min: 5,
      route_method: "test_graph",
    }],
    def: [[42, -2], [42.03, -2.03]],
    par: [[[42, -2], [42.04, -2.04]]],
    crit: [{ lat: 42.01, lon: -2.01, t: 10, why: "test" }],
    anchors: [{ lat: 42.02, lon: -2.02, role: "anchor A", near: { name: "path", type: "path", distance_m: 20 } }],
    anchorLinks: [{ pts: [[42.02, -2.02], [42.03, -2.03]], role: "anchor A", control_name: "path", distance_m: 20 }],
    assets: [{ lat: 42.01, lon: -2.01, big: false, icon: "🏠" }],
  },
};
const exportCfg = { elapsedMin: 5, fuel: "test", moistMode: "calc", startH: 0, moist: 8,
  wind: "manual", dir: 225, spd: 20, temp: 25, rh: 40, rate: 300 };
const exportFunction = new Function(
  "fsLast", "fsPanel", "fsTeamPos", "fsCfg", "FS_FUELS", "FS_DT", "FS_T",
  "Blob", "URL", "document", "setTimeout",
  "return (" + exportSource + ");"
)(exportState, fakePanel, { lat: 42.005, lng: -2.005 }, exportCfg,
  { test: { n: "test fuel" } }, 5, 360, Blob, fakeUrl, fakeDocument, () => {});
exportFunction();
assert.ok(capturedBlob, "GeoJSON export should create a Blob");
assert.equal(capturedBlob.type, "application/geo+json;charset=utf-8");
const exported = JSON.parse(await capturedBlob.text());
if (process.env.OACEL_GEOJSON_FIXTURE_PATH) {
  writeFileSync(process.env.OACEL_GEOJSON_FIXTURE_PATH, JSON.stringify(exported));
}
assert.equal(exported.type, "FeatureCollection");
assert.equal(exported.coordinate_reference, "WGS84 / EPSG:4326");
assert.equal(exported.coordinate_order, "[longitude, latitude]");
assert.equal(exported.metadata.feature_count, exported.features.length,
  "Metadata feature count must match emitted features");
assert.equal(exported.metadata.route_count, 1);
assert.equal(exported.metadata.route_status, "candidate_routes_found");
assert.ok(exported.features.some(f => f.properties.kind === "team_position"));
assert.ok(exported.features.some(f => f.properties.kind === "connected_escape_route_candidate"));
assert.ok(exported.features.some(f => f.properties.kind === "predicted_perimeter" && f.properties.area_ha === 4.2));
assert.ok(!exported.features.some(f => f.properties.kind === "candidate_low_fuel_area"),
  "Invalid/degenerate polygons must be omitted");
assert.ok(!exported.features.some(f => f.properties.kind === "predicted_perimeter" && f.properties.minutes === 60),
  "Invalid polygon coordinates must be omitted");
for (const feature of exported.features) {
  assert.equal(feature.type, "Feature");
  assert.ok(feature.properties.safety_note, "Every feature should include a safety disclaimer");
  const visit = coordinates => {
    if (typeof coordinates[0] === "number") {
      assert.ok(Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1]));
      assert.ok(Math.abs(coordinates[0]) <= 180 && Math.abs(coordinates[1]) <= 90,
        "GeoJSON output must use valid [longitude, latitude] positions");
    } else coordinates.forEach(visit);
  };
  visit(feature.geometry.coordinates);
}
console.log("GeoJSON export integration checks passed: metadata, feature types, coordinate bounds/order, and safety labels.");

