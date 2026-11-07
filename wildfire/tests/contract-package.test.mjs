import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../wildfire-intelligence.js", import.meta.url), "utf8");
const contract = JSON.parse(readFileSync(new URL("../data-contract.json", import.meta.url), "utf8"));

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const open = source.indexOf("{", start);
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

test("contract adapter produces coherent package and SI wind values", () => {
  let id = 0;
  const build = vm.runInNewContext(`(${extractFunction("toContractPackage")})`, {
    structuredClone,
    uuid: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`
  });
  const incident = {
    id: "00000000-0000-4000-8000-000000000001", name: "Test", status: "planning",
    createdAt: "2026-11-07T10:00:00.000Z",
    ignition: { type: "Point", coordinates: [-2.2, 43.1] },
    weatherObservation: {
      quality: "field_verified", observedAt: "2026-11-07T09:00:00.000Z", source: "Station test",
      windSpeedKmh: 36, windGustKmh: 54, windDirectionFromDegrees: 180,
      temperatureC: 20, relativeHumidityPercent: 45
    },
    scenario: { horizonMinutes: 60 },
    provenance: { capturedAt: "2026-11-07T10:00:00.000Z" }
  };
  const pkg = build(incident);
  assert.match(pkg.observation.id, /^[0-9a-f-]{36}$/i);
  assert.match(pkg.scenario.id, /^[0-9a-f-]{36}$/i);
  assert.equal(pkg.weather.windSpeed.value, 10);
  assert.equal(pkg.weather.windGust.value, 15);
  assert.equal(pkg.weather.windSpeed.unit, "m/s");
  assert.equal(pkg.observation.quality, "field_verified");
  assert.deepEqual(Object.keys(pkg.terrain).sort(), ["aspect", "crs", "dem", "resolutionMeters", "slope"].sort());
  assert.equal(pkg.terrain.dem, null);
  assert.equal(pkg.modelExecution.executed, false);
  assert.equal(pkg.scenario.status, "draft");
  assert.ok(contract.terrain && contract.provenance.quality.includes("field_verified"));
});
