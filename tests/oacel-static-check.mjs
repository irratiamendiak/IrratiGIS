import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  ["GeoJSON line coordinate validation", "const line=(pts,properties)=>{ if(validPts(pts))"],
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
