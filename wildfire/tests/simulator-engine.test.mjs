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
    "arrivalTime", "behavior", "ellipseRate", "flameLength", "forestWindSite", "fuelMoisture", "intensity", "simulate", "windAdjustmentFactor"
  ]);
});

test("fuel moisture response is bounded and reduces spread as moisture rises", () => {
  const dry = engine.fuelMoisture(fuel, 5);
  const wet = engine.fuelMoisture(fuel, 15);
  assert.ok(dry > wet);
  assert.equal(engine.fuelMoisture(fuel, 25), 0);
  assert.ok(Number.isFinite(dry) && dry >= 0);
});

test("midflame wind adjustment varies with Anderson fuel-bed structure", () => {
  assert.equal(engine.windAdjustmentFactor({id:1,depth:1}), 0.4);
  assert.equal(engine.windAdjustmentFactor({id:8,depth:1}), 0.3);
  assert.equal(engine.windAdjustmentFactor({id:4,depth:3}), 0.5);
  assert.notEqual(engine.windAdjustmentFactor({id:1,depth:1}), engine.windAdjustmentFactor({id:8,depth:1}));
});

test("Gipuzkoa forest structure only grants conservative partial shelter when all indicators agree", () => {
  const sheltered = engine.forestWindSite({height:14,density:850,basalArea:22,crownRatio:.55});
  assert.equal(sheltered.waf,.3);
  assert.equal(sheltered.source,"gipuzkoa-partial-shelter");
  assert.equal(engine.forestWindSite({height:14,density:300,basalArea:22,crownRatio:.55}),null);
  assert.equal(engine.forestWindSite({height:14,density:850,basalArea:22,crownRatio:.15}),null);
  assert.equal(engine.forestWindSite({height:6,density:850,basalArea:22,crownRatio:.55}),null);
});

test("site forest structure can override the default midflame wind adjustment", () => {
  const fuelBed = {loads:[.034,0,0,0],sav:[3500,109,30,1500],depth:1,Mx:.12};
  const open = engine.behavior(fuelBed,0,0,270,20,5);
  const partiallySheltered = engine.behavior(fuelBed,0,0,270,20,5,{waf:.3,source:"gipuzkoa-partial-shelter"});
  assert.equal(open.windAdjustment,0.4);
  assert.equal(partiallySheltered.windAdjustment,0.3);
  assert.ok(partiallySheltered.Rh < open.Rh);
  assert.equal(engine.windAdjustmentFactor(fuelBed,{waf:0.05}),0.4);
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

test("simulation is deterministic and caches time-only weather samples across bearings", () => {
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
  assert.equal(weatherCalls, 6); // 3 time steps × 2 terrain substeps, not × 120 rays.
  const second = engine.simulate(options);
  assert.equal(weatherCalls, 12);
  assert.equal(first.length, 120);
  assert.equal(first[0].pts.length, 4);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(terrainCalls > 0 && moistureCalls > 0);
  assert.ok(first[0].pts[3][1] > 0);
});


test("arrival time interpolates between actual 3-degree rays, including north wraparound", () => {
  const ignition = { lat: 43, lng: -2 };
  const makeRay = (bg, distance) => ({
    bg,
    pts: [[0, 0, ignition.lat, ignition.lng], [10, distance, 0, 0], [20, distance * 2, 0, 0]]
  });
  const rays = [];
  for (let bg = 0; bg < 360; bg += 3) rays.push(makeRay(bg, bg === 357 ? 100 : 200));
  const atEast = engine.arrivalTime(rays, ignition, ignition.lat, ignition.lng + 100 / (111320 * Math.cos(43 * Math.PI / 180)));
  assert.ok(Number.isFinite(atEast));
  assert.ok(atEast >= 0 && atEast <= 10);
  const atIgnition = engine.arrivalTime(rays, ignition, ignition.lat, ignition.lng);
  assert.equal(atIgnition, 0);
  assert.equal(engine.arrivalTime(rays, ignition, 43.1, -2), Infinity);
});

test("arrival interpolation also supports a 5-degree ray grid", () => {
  const ignition = { lat: 43, lng: -2 };
  const rays = [];
  for (let bg = 0; bg < 360; bg += 5) {
    rays.push({ bg, pts: [[0, 0], [10, 100], [20, 200]] });
  }
  const lng = ignition.lng + 150 / (111320 * Math.cos(43 * Math.PI / 180));
  assert.ok(Math.abs(engine.arrivalTime(rays, ignition, 43, lng) - 15) < 1e-6);
});

test("the Anderson 1982 catalog exposes all 13 models with fuel-bed parameters", () => {
  const models = [...html.matchAll(/fm(1[0-3]|[1-9]):\{id:\1,n:/g)].map(m => Number(m[1]));
  assert.deepEqual(models, Array.from({length:13}, (_,i)=>i+1));
  assert.match(html, /loads:\[\.034,0,0,0\],sav:\[3500,109,30,1500\],depth:1,Mx:\.12/);
  assert.match(html, /loads:\[\.322,1\.058,1\.288,0\],sav:\[1500,109,30,1500\],depth:3,Mx:\.25/);
  assert.match(html, /f\.w=total\*4\.882427636/);
  assert.match(html, /f\.cls=deadTotal\?/);
});

test("Anderson models 1, 4 and 13 run through Rothermel and produce different spread rates", () => {
  const makeFuel = (loads, sav, depth, Mx) => ({loads,sav,depth,Mx});
  const model1 = makeFuel([.034,0,0,0],[3500,109,30,1500],1,.12);
  const model4 = makeFuel([.23,.184,.092,.23],[2000,109,30,1500],6,.20);
  const model13 = makeFuel([.322,1.058,1.288,0],[1500,109,30,1500],3,.25);
  const rates = [model1,model4,model13].map(f => engine.behavior(f,0,0,270,0,5));
  assert.ok(rates.every(r => r.model === "rothermel" && Number.isFinite(r.Rh) && r.Rh > 0));
  assert.equal(new Set(rates.map(r=>r.Rh.toFixed(5))).size, 3);
  const wet = engine.behavior(model1,0,0,270,0,13);
  assert.equal(wet.Rh, 0);
});

test("simulation rejects incomplete inputs instead of silently returning empty output", () => {
  assert.throws(() => engine.simulate({}), /Parámetros incompletos/);
});

test("Gipuzkoa forest structure and LiDAR layers feed the spatial wind adjustment", () => {
  assert.match(html, /fsCreateForestWindSampler/);
  assert.match(html, /fsQueryForestPolygons\(259/);
  assert.match(html, /fsQueryForestPolygons\(14/);
  assert.match(html, /fsMaxSpreadExtent\(FS_T\)/);
  assert.match(html, /windAt, ignition:fsIgn/);
  assert.match(html, /fsEngine\.forestWindSite/);
  assert.match(html, /s==="3"\|\|/);
  assert.match(html, /Ez da babes osoa aplikatzen/i);
});

test("the map page loads and delegates its spread calculations to the engine module", () => {
  assert.match(html, /wildfire\/simulator\/engine\.js/);
  assert.match(html, /fsEngine\.simulate\(/);
  assert.match(html, /fsEngine\.behavior\(/);
  assert.doesNotMatch(html, /for\(let bg=0;bg<360;bg\+=5\)/);
});


test("forest polygon ring bounds preserve the original even-odd containment result", () => {
  const block = html.match(/function fsForestPolygonIndex[\\s\\S]*?(?=function fsFirstBranchHeight)/)?.[0];
  assert.ok(block, "forest spatial helpers are present in the map page");
  const sandbox = {};
  vm.runInNewContext(block + "\\nglobalThis.forestHelpers = {fsForestPolygonIndex, fsForestContains, fsForestFind};", sandbox);
  const {fsForestPolygonIndex, fsForestContains, fsForestFind} = sandbox.forestHelpers;
  const outer = [[0,0],[10,0],[10,10],[0,10],[0,0]];
  const hole = [[3,3],[7,3],[7,7],[3,7],[3,3]];
  const detached = [[20,20],[22,20],[22,22],[20,22],[20,20]];
  const features = [{geometry:{rings:[outer,hole,detached]},attributes:{id:7}}];
  const index = fsForestPolygonIndex(features);
  const legacyContains = (rings,lon,lat) => {
    let inside=false;
    for(const ring of rings){
      for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const a=ring[i],b=ring[j];
        if((a[1]>lat)!==(b[1]>lat)&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
      }
    }
    return inside;
  };
  for(let lon=-1;lon<=23;lon+=.125){
    for(let lat=-1;lat<=23;lat+=.125){
      assert.equal(fsForestContains(features[0].geometry.rings,lon,lat,index.polygons[0].ringBounds),
        legacyContains(features[0].geometry.rings,lon,lat), `containment differs at ${lon},${lat}`);
      const expected=legacyContains(features[0].geometry.rings,lon,lat)?features[0].attributes:null;
      assert.deepEqual(fsForestFind(index,lat,lon),expected);
    }
  }
});
