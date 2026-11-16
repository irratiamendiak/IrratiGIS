/* IrratiGIS wildfire spread engine.
 * Pure numerical core: no DOM, map, network, or application-global dependencies.
 * Terrain, weather, fuel-moisture and timing are injected by the caller.
 */
(function (root) {
  "use strict";

  const RAD = Math.PI / 180;

  function fuelMoisture(fuel, percent) {
    const moisture = percent / 100;
    const ratio = moisture / fuel.Mx;
    if (ratio >= 1) return 0;
    const eta = x => 1 - 2.59 * x + 5.11 * x * x - 3.52 * x * x * x;
    const heat = m => 250 + 1116 * m;
    return Math.max(0, eta(ratio) / eta(0.06 / fuel.Mx)) * heat(0.06) / heat(moisture);
  }

  function behavior(fuel, tangentSlope, aspect, windFrom, windSpeed, moisturePercent) {
    const baseRate = fuel.R0 * fuelMoisture(fuel, moisturePercent);
    const downwind = (windFrom + 180) % 360;
    if (baseRate <= 0) return { Rh: 0, head: downwind, e: 0, LB: 1, phiE: 0 };

    const C = 7.47 * Math.exp(-0.133 * Math.pow(fuel.sig, 0.55));
    const B = 0.02526 * Math.pow(fuel.sig, 0.54);
    const phiW = windSpeed > 0.5 ? C * Math.pow(windSpeed * 54.68 * fuel.waf, B) : 0;
    const slope = Math.min(tangentSlope, 1.73);
    const phiS = 5.275 * Math.pow(fuel.beta, -0.3) * slope * slope;
    const upslope = (aspect + 180) % 360;
    const delta = (downwind - upslope) * RAD;
    const X = phiS + phiW * Math.cos(delta);
    const Y = phiW * Math.sin(delta);
    const phiE = Math.hypot(X, Y);
    const head = phiE < 1e-6 ? downwind : (upslope + Math.atan2(Y, X) / RAD + 360) % 360;
    const Rh = Math.min(fuel.Rmax, baseRate * (1 + phiE));
    const effectiveWind = Math.min(60, Math.pow(phiE / C, 1 / B) / 88);
    const LB = Math.min(8, 0.936 * Math.exp(0.2566 * effectiveWind) +
      0.461 * Math.exp(-0.1548 * effectiveWind) - 0.397);
    return { Rh, head, e: Math.sqrt(Math.max(0, LB * LB - 1)) / LB, LB, phiE };
  }

  function ellipseRate(result, relativeAngleDegrees) {
    return result.Rh * (1 - result.e) /
      (1 - result.e * Math.cos(relativeAngleDegrees * RAD));
  }

  function intensity(fuel, rate, heatContent) {
    return heatContent * fuel.w * rate / 60;
  }

  function flameLength(lineIntensity) {
    return 0.0775 * Math.pow(lineIntensity, 0.46);
  }

  function simulate(options) {
    const {
      fuel, fuelAt, ignition, durationMinutes, stepMinutes, weatherAt, terrainAt,
      moistureAt, heatContent, windFactor = 1, moistureDelta = 0,
      bearingStepDegrees = 3, terrainStepMinutes = 1
    } = options;
    if (!fuel || !ignition || typeof weatherAt !== "function" ||
        typeof terrainAt !== "function" || typeof moistureAt !== "function" ||
        !(stepMinutes > 0) || !(durationMinutes >= stepMinutes)) {
      throw new TypeError("Parámetros incompletos para ejecutar la simulación.");
    }

    // Weather is a function of simulation time, not of the ray's position.
    // Sample it once per substep and reuse it for every bearing. This avoids
    // repeating identical interpolation work (and guarantees one shared
    // weather snapshot for all rays at a given simulation instant).
    const substeps = Math.max(1, Math.ceil(stepMinutes / Math.max(0.1, terrainStepMinutes)));
    const dt = stepMinutes / substeps;
    const weatherByStep = [];
    for (let time = stepMinutes; time <= durationMinutes; time += stepMinutes) {
      const samples = [];
      for (let sub = 0; sub < substeps; sub++) {
        const sampleTime = time - stepMinutes + (sub + 1) * dt;
        samples.push(weatherAt(sampleTime));
      }
      weatherByStep.push(samples);
    }

    const rays = [];
    const metersPerLongitudeDegree = 111320 * Math.cos(ignition.lat * RAD);
    for (let bearing = 0; bearing < 360; bearing += bearingStepDegrees) {
      let lat = ignition.lat, lon = ignition.lng, distance = 0;
      const bearingRadians = bearing * RAD;
      const initialFuel = fuelAt ? (fuelAt(lat, lon) || {}) : {};
      let activeFuel = initialFuel.fuel || fuel;
      let activeFuelKey = initialFuel.key || "default";
      const points = [[0, 0, lat, lon, activeFuelKey]];
      let limited = false;
      let stepIndex = 0;
      for (let time = stepMinutes; time <= durationMinutes; time += stepMinutes, stepIndex++) {
        if (!limited) {
          const weatherSamples = weatherByStep[stepIndex];
          for (let sub = 0; sub < substeps; sub++) {
            const sampleTime = time - stepMinutes + (sub + 1) * dt;
            const weather = weatherSamples[sub];
            const terrain = terrainAt(lat, lon);
            // null/undefined o una muestra incompleta significa que no hay
            // terreno válido: se detiene este rayo, sin extrapolar ni rellenar.
            if (!terrain || !Number.isFinite(terrain.tan) || !Number.isFinite(terrain.asp)) {
              limited = true;
              break;
            }
            const selected = fuelAt ? (fuelAt(lat, lon) || {}) : {};
            activeFuel = selected.fuel || fuel;
            activeFuelKey = selected.key || "default";
            const moisture = Math.max(2, moistureAt(weather, activeFuel, terrain, sampleTime) + moistureDelta);
            const spread = behavior(activeFuel, terrain.tan, terrain.asp, weather.dir,
              weather.spd * windFactor, moisture);
            const increment = spread.Rh > 0
              ? ellipseRate(spread, angleDifference(bearing, spread.head)) * dt
              : 0;
            lat += increment * Math.cos(bearingRadians) / 111320;
            lon += increment * Math.sin(bearingRadians) / metersPerLongitudeDegree;
            distance += increment;
          }
        }
        points.push([time, distance, lat, lon, activeFuelKey]);
      }
      rays.push({ bg: bearing, pts: points, limited });
    }
    return rays;
  }


  // Estimate arrival time by interpolating between the two rays that bracket
  // the target bearing. This works for any ray spacing (3°, 5°, etc.) and
  // avoids the discontinuities caused by selecting a hard-coded ray index.
  function arrivalTime(rays, ignition, lat, lng) {
    if (!Array.isArray(rays) || rays.length < 2 || !ignition ||
        !Number.isFinite(lat) || !Number.isFinite(lng)) return Infinity;
    const east = (lng - ignition.lng) * 111320 * Math.cos(ignition.lat * RAD);
    const north = (lat - ignition.lat) * 111320;
    const targetDistance = Math.hypot(east, north);
    if (targetDistance <= 0.01) return 0;
    const bearing = (Math.atan2(east, north) / RAD + 360) % 360;
    const sorted = rays.slice().sort((a, b) => a.bg - b.bg);
    let lower = sorted[sorted.length - 1], upper = sorted[0];
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].bg <= bearing) lower = sorted[i];
      if (sorted[i].bg >= bearing) { upper = sorted[i]; break; }
    }
    let lowerBearing = lower.bg, upperBearing = upper.bg;
    let targetBearing = bearing;
    if (upperBearing <= lowerBearing) upperBearing += 360;
    if (targetBearing < lowerBearing) targetBearing += 360;
    const span = upperBearing - lowerBearing;
    const fraction = span > 0 ? (targetBearing - lowerBearing) / span : 0;
    const count = Math.min(lower.pts.length, upper.pts.length);
    for (let i = 1; i < count; i++) {
      const d0 = lower.pts[i - 1][1] * (1 - fraction) + upper.pts[i - 1][1] * fraction;
      const d1 = lower.pts[i][1] * (1 - fraction) + upper.pts[i][1] * fraction;
      if (d1 >= targetDistance && d1 > d0) {
        const f = Math.max(0, Math.min(1, (targetDistance - d0) / (d1 - d0)));
        return lower.pts[i - 1][0] + f * (lower.pts[i][0] - lower.pts[i - 1][0]);
      }
    }
    return Infinity;
  }

  function angleDifference(a, b) {
    return ((a - b + 540) % 360) - 180;
  }

  root.IrratiWildfireEngine = Object.freeze({
    fuelMoisture, behavior, ellipseRate, intensity, flameLength, simulate, arrivalTime
  });
})(window);
