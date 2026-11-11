import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const engineSource = readFileSync(new URL("../simulator/engine.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(engineSource, context);
const engine = context.window.IrratiWildfireEngine;

const fuel = {
  R0: 0.5, sig: 1800, beta: 0.006, waf: 0.4, w: 0.9,
  Mx: 0.2, Rmax: 40
};

test("engine exports a small numerical API without browser UI dependencies", () => {
  assert.deepEqual(Object.keys(engine).sort(), [
    "behavior", "ellipseRate", "flameLength", "fuelMoisture", "intensity", "simulate"
  ]);
});

test("fuel moisture response is bounded and reduces spread as moisture rises", () => {
  const dry = engine.fuelMoisture(fuel, 5);
  const wet = engine.fuelMoisture(fuel, 15);
  assert.ok(dry > wet);
  assert.equal(engine.fuelMoisture(fuel, 25), 0);
  assert.ok(Number.isFinite(dry) && dry >= 0);
});

test("wind and slope influence rate and the resulting head direction", () => {
  const flat = engine.behavior(fuel, 0, 0, 270, 0, 8);
  const sloped = engine.behavior(fuel, 0.5, 180, 270, 0, 8);
  const windy = engine.behavior(fuel, 0, 0, 270, 20, 8);
  const combined = engine.behavior(fuel, 0.5, 180, 270, 20, 8);
  assert.ok(sloped.Rh > flat.Rh);
  assert.ok(windy.Rh > flat.Rh);
  assert.notEqual(combined.head, flat.head);
});

test("ellipse rate, Byram intensity and flame length remain finite and ordered", () => {
  const spread = engine.behavior(fuel, 0.2, 180, 270, 12, 8);
  const head = engine.ellipseRate(spread, 0);
  const flank = engine.ellipseRate(spread, 90);
  const rear = engine.ellipseRate(spread, 180);
  assert.ok(head >= flank && flank >= rear);
  const intensity = engine.intensity(fuel, head, 18600);
  assert.ok(intensity > 0);
  assert.ok(engine.flameLength(intensity) > 0);
});

test("simulation is deterministic and receives terrain, weather and moisture as injected inputs", () => {
  let terrainCalls = 0, weatherCalls = 0, moistureCalls = 0;
  const options = {
    fuel,
    ignition: { lat: 43.2, lng: -2.1 },
    durationMinutes: 6,
    stepMinutes: 2,
    heatContent: 18600,
    weatherAt: () => { weatherCalls++; return { dir: 270, spd: 12 }; },
    terrainAt: () => { terrainCalls++; return { tan: 0.25, asp: 180 }; },
    moistureAt: () => { moistureCalls++; return 8; }
  };
  const first = engine.simulate(options);
  const second = engine.simulate(options);
  assert.equal(first.length, 72);
  assert.equal(first[0].pts.length, 4);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(terrainCalls > 0 && weatherCalls > 0 && moistureCalls > 0);
  assert.ok(first[0].pts[3][1] > 0);
});

test("simulation rejects incomplete inputs instead of silently returning empty output", () => {
  assert.throws(() => engine.simulate({}), /Parámetros incompletos/);
});

test("the map page loads and delegates its spread calculations to the engine module", () => {
  assert.match(html, /wildfire\/simulator\/engine\.js/);
  assert.match(html, /fsEngine\.simulate\(/);
  assert.match(html, /fsEngine\.behavior\(/);
  assert.doesNotMatch(html, /for\(let bg=0;bg<360;bg\+=5\)/);
});
