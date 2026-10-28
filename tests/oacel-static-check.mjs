import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=/.test(m[1]) &&
    !/\btype\s*=\s*["'](?:application\/json|application\/ld\+json)/i.test(m[1]));

assert.ok(scripts.length > 0, "Expected at least one inline JavaScript block");
for (const [index, script] of scripts.entries()) {
  assert.doesNotThrow(() => new Function(script[2]), \`Inline script \${index + 1} must parse\`);
}

const required = [
  ["sampled fire-arrival checks", "fireSamples"],
  ["reverse edge samples", "fireSamples:fireSamples.map(p=>({f:1-p.f,arrival:p.arrival})).reverse()"],
  ["off-network connector checks", "const connectorSafe="],
  ["route diagnostic status", "no_connected_route_passed_checks"],
  ["diagnostic in exported metadata", "route_status:fsLast.osm?.routeStatus"],
  ["WGS84 GeoJSON export", "application/geo+json;charset=utf-8"],
  ["safety disclaimer", "no certifica seguridad"],
];
for (const [label, token] of required) {
  assert.ok(html.includes(token), \`Missing expected feature: \${label}\`);
}

console.log(\`Static OACEL checks passed: \${scripts.length} inline scripts parsed; \${required.length} feature guards found.\`);
