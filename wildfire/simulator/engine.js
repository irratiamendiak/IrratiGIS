/* IrratiGIS wildfire spread engine.
 * Rothermel (1972) surface-fire spread equations with the Anderson (1982) 13 fuel models.
 * Internal Rothermel calculations use the original US customary units; public rates are m/min.
 * Wind adjustment uses site-level forest structure when supplied by the caller. Gipuzkoa's
 * mapped stand density/height plus LiDAR first-branch height can identify a conservative
 * partial-shelter proxy; otherwise Anderson/NWCG fuel-bed defaults are used.
 * The supplied fine-fuel moisture is applied to all particle classes. This is not a crown-fire model.
 */
(function (root) {
  "use strict";
  const RAD = Math.PI / 180;
  const LBFT2_TO_KGM2 = 4.882427636;
  const FT_TO_M = 0.3048;
  const BTULB_TO_JKG = 2326;
  const RHO_PARTICLE = 32; // lb/ft3, standard dry particle density
  const TOTAL_MINERAL = 0.0555;
  const EFFECTIVE_MINERAL = 0.01;
  const HEAT = 8000; // BTU/lb, common value for the original 13 models

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function damping(moisture, extinction) {
    const r = moisture / extinction;
    if (r >= 1) return 0;
    return clamp(1 - 2.59*r + 5.11*r*r - 3.52*r*r*r, 0, 1);
  }
  function fuelMoisture(fuel, percent) {
    const mx = Number(fuel && fuel.Mx);
    if (!(mx > 0)) return 0;
    return damping(Math.max(0, percent / 100), mx);
  }
  function rothermelBase(fuel, moisturePercent) {
    if (!fuel || !Array.isArray(fuel.loads) || !Array.isArray(fuel.sav)) return null;
    const loads = fuel.loads;
    const sav = fuel.sav;
    const depth = Number(fuel.depth);
    if (loads.length !== 4 || sav.length !== 4 || !(depth > 0)) return null;
    const moisture = Math.max(0, moisturePercent / 100);
    const mx = Number(fuel.Mx);
    if (!(mx > 0) || moisture >= mx) return { rate: 0, phiW: 0, phiS: 0, sigma: 0, beta: 0 };
    const netLoads = loads.map(v => Math.max(0, Number(v) || 0) * (1 - TOTAL_MINERAL));
    const totalLoad = netLoads.reduce((a,b)=>a+b,0);
    const surfaceArea = netLoads.reduce((a,w,i)=>a+w*(Number(sav[i])||0),0);
    if (!(totalLoad > 0) || !(surfaceArea > 0)) return { rate: 0, phiW: 0, phiS: 0, sigma: 0, beta: 0 };
    const sigma = surfaceArea / totalLoad; // ft-1
    const rhoBulk = totalLoad / depth; // lb/ft3
    const beta = rhoBulk / RHO_PARTICLE;
    const betaOp = 3.348 * Math.pow(sigma, -0.8189);
    const A = 133 * Math.pow(sigma, -0.7913);
    const gammaMax = Math.pow(sigma, 1.5) / (495 + 0.0594 * Math.pow(sigma, 1.5));
    const gamma = gammaMax * Math.pow(beta / betaOp, A) * Math.exp(A * (1 - beta / betaOp));
    const xi = Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) /
      (192 + 0.2595 * sigma);
    const etaM = damping(moisture, mx);
    const etaS = 0.174 * Math.pow(EFFECTIVE_MINERAL, -0.19);
    const reaction = gamma * netLoads.reduce((sum,w)=>sum+w*HEAT*etaM*etaS,0);
    const epsilon = Math.exp(-138 / sigma);
    const qIgnition = 250 + 1116 * moisture;
    const heatSink = rhoBulk * epsilon * qIgnition;
    const rate = heatSink > 0 ? reaction * xi / heatSink : 0; // ft/min, no wind/slope
    return { rate, sigma, beta, rhoBulk, gamma, xi, reaction, heatSink, etaM };
  }
  // Conservative Gipuzkoa structural screen; thresholds are provisional proxies,
  // not a substitute for a direct canopy-cover measurement or local calibration.
  function forestWindSite(metrics) {
    const height=Number(metrics&&metrics.height);
    const density=Number(metrics&&metrics.density);
    const basalArea=Number(metrics&&metrics.basalArea);
    const crownRatio=Number(metrics&&metrics.crownRatio);
    if(height>=8&&density>=600&&basalArea>=15&&crownRatio>=0.30&&crownRatio<=1) {
      return {waf:0.3,source:"gipuzkoa-partial-shelter",height,density,basalArea,crownRatio};
    }
    return null;
  }
  function windAdjustmentFactor(fuel, windSite) {
    const siteWaf = Number(windSite && windSite.waf);
    if (Number.isFinite(siteWaf) && siteWaf >= 0.1 && siteWaf <= 0.5) return siteWaf;
    const id = Number(fuel && fuel.id);
    const depth = Number(fuel && fuel.depth);
    // Anderson 8–10 are timber-litter models; use their standard unsheltered-bed default
    // unless the caller supplies a site-level forest-structure shelter estimate.
    if (id >= 8 && id <= 10) return 0.3;
    // Exposed fuels: NWCG unsheltered classes by fuel-bed depth.
    if (depth > 2.7) return 0.5;
    if (depth >= 0.9) return 0.4;
    return 0.3;
  }
  function behavior(fuel, tangentSlope, aspect, windFrom, windSpeedKmh, moisturePercent, windSite) {
    const downwind = (windFrom + 180) % 360;
    const base = rothermelBase(fuel, moisturePercent);
    if (!base) return legacyBehavior(fuel, tangentSlope, aspect, windFrom, windSpeedKmh, moisturePercent, windSite);
    if (!(base.rate > 0)) return { Rh: 0, head: downwind, e: 0, LB: 1, phiE: 0, model: "rothermel" };
    const sigma = base.sigma, beta = base.beta;
    const C = 7.47 * Math.exp(-0.133 * Math.pow(sigma, 0.55));
    const B = 0.02526 * Math.pow(sigma, 0.54);
    const E = 0.715 * Math.exp(-0.000359 * sigma);
    const windAdjustment = windAdjustmentFactor(fuel, windSite);
    const midFlameFtMin = Math.max(0, windSpeedKmh) * 54.68 * windAdjustment;
    const phiW = midFlameFtMin > 0.5
      ? C * Math.pow(midFlameFtMin, B) * Math.pow(beta / (3.348 * Math.pow(sigma, -0.8189)), -E)
      : 0;
    const slope = Math.min(Math.max(0, tangentSlope), 1.73);
    const phiS = 5.275 * Math.pow(beta, -0.3) * slope * slope;
    const upslope = (aspect + 180) % 360;
    const delta = (downwind - upslope) * RAD;
    const X = phiS + phiW * Math.cos(delta);
    const Y = phiW * Math.sin(delta);
    const phiE = Math.hypot(X, Y);
    const head = phiE < 1e-6 ? downwind : (upslope + Math.atan2(Y, X) / RAD + 360) % 360;
    const rateFtMin = base.rate * (1 + phiE);
    const effectiveWindFtMin = phiE > 0 ? Math.pow(phiE / C, 1 / B) : 0;
    const effectiveWindMph = effectiveWindFtMin / 88;
    const LB = Math.min(8, 0.936 * Math.exp(0.2566 * effectiveWindMph) +
      0.461 * Math.exp(-0.1548 * effectiveWindMph) - 0.397);
    return { Rh: rateFtMin * FT_TO_M, head, e: Math.sqrt(Math.max(0, LB*LB-1))/LB,
      LB, phiE, phiW, phiS, baseRate: base.rate*FT_TO_M, model: "rothermel",
      sigma, beta, reactionIntensity: base.reaction, windAdjustment };
  }

  // Compatibility path for inventory records that have not yet been expressed
  // as complete Anderson particle-class fuel beds.
  function legacyBehavior(fuel, tangentSlope, aspect, windFrom, windSpeed, moisturePercent, windSite) {
    const baseRate = Number(fuel && fuel.R0) * fuelMoisture(fuel, moisturePercent);
    const downwind = (windFrom + 180) % 360;
    if (!(baseRate > 0)) return { Rh: 0, head: downwind, e: 0, LB: 1, phiE: 0, model: "legacy-inventory" };
    const sigma = Number(fuel.sig)||1800;
    const C = 7.47 * Math.exp(-0.133 * Math.pow(sigma, 0.55));
    const B = 0.02526 * Math.pow(sigma, 0.54);
    const legacyWaf = windAdjustmentFactor(fuel, windSite);
    const phiW = windSpeed > 0.5 ? C * Math.pow(windSpeed * 54.68 * legacyWaf, B) : 0;
    const slope = Math.min(Math.max(0,tangentSlope),1.73);
    const phiS = 5.275 * Math.pow(Number(fuel.beta)||0.01, -0.3) * slope*slope;
    const upslope = (aspect + 180) % 360, delta=(downwind-upslope)*RAD;
    const X=phiS+phiW*Math.cos(delta), Y=phiW*Math.sin(delta), phiE=Math.hypot(X,Y);
    const head=phiE<1e-6?downwind:(upslope+Math.atan2(Y,X)/RAD+360)%360;
    const Rh=Math.min(Number(fuel.Rmax)||100,baseRate*(1+phiE));
    const effectiveWind=Math.min(60,Math.pow(phiE/C,1/B)/88);
    const LB=Math.min(8,0.936*Math.exp(0.2566*effectiveWind)+0.461*Math.exp(-0.1548*effectiveWind)-0.397);
    return {Rh,head,e:Math.sqrt(Math.max(0,LB*LB-1))/LB,LB,phiE,model:"legacy-inventory",windAdjustment:legacyWaf};
  }
  function ellipseRate(result, angle) {
    return result.Rh * (1-result.e) / (1-result.e*Math.cos(angle*RAD));
  }
  function intensity(fuel, rate, heatContent) {
    const load = Number.isFinite(fuel && fuel.w) ? fuel.w : 0;
    const heat = Number.isFinite(heatContent) ? heatContent : HEAT*BTULB_TO_JKG;
    return heat * load * rate / 60000; // kW/m, with rate in m/min
  }
  function flameLength(lineIntensity) { return 0.0775 * Math.pow(Math.max(0,lineIntensity),0.46); }

  function simulate(options) {
    const { fuel, fuelAt, ignition, durationMinutes, stepMinutes, weatherAt, terrainAt,
      moistureAt, windAt, heatContent, windFactor=1, moistureDelta=0, bearingStepDegrees=3,
      terrainStepMinutes=1 } = options;
    if (!fuel || !ignition || typeof weatherAt!=="function" || typeof terrainAt!=="function" ||
      typeof moistureAt!=="function" || !(stepMinutes>0) || !(durationMinutes>=stepMinutes)) {
      throw new TypeError("Parámetros incompletos para ejecutar la simulación.");
    }
    const substeps=Math.max(1,Math.ceil(stepMinutes/Math.max(0.1,terrainStepMinutes)));
    const dt=stepMinutes/substeps, weatherByStep=[];
    for(let time=stepMinutes;time<=durationMinutes;time+=stepMinutes){
      const samples=[];
      for(let sub=0;sub<substeps;sub++) samples.push(weatherAt(time-stepMinutes+(sub+1)*dt));
      weatherByStep.push(samples);
    }
    const rays=[], metersPerLongitudeDegree=111320*Math.cos(ignition.lat*RAD);
    for(let bearing=0;bearing<360;bearing+=bearingStepDegrees){
      let lat=ignition.lat,lon=ignition.lng,distance=0;
      const bearingRadians=bearing*RAD, initial=fuelAt?(fuelAt(lat,lon)||{}):{};
      let activeFuel=initial.fuel||fuel, activeFuelKey=initial.key||"default";
      const points=[[0,0,lat,lon,activeFuelKey]];
      let limited=false,stepIndex=0;
      for(let time=stepMinutes;time<=durationMinutes;time+=stepMinutes,stepIndex++){
        if(!limited){
          for(let sub=0;sub<substeps;sub++){
            const sampleTime=time-stepMinutes+(sub+1)*dt, weather=weatherByStep[stepIndex][sub];
            const terrain=terrainAt(lat,lon);
            if(!terrain||!Number.isFinite(terrain.tan)||!Number.isFinite(terrain.asp)){limited=true;break;}
            const selected=fuelAt?(fuelAt(lat,lon)||{}):{};
            activeFuel=selected.fuel||fuel; activeFuelKey=selected.key||"default";
            const moisture=Math.max(2,moistureAt(weather,activeFuel,terrain,sampleTime)+moistureDelta);
            const windSite=typeof windAt==="function"?windAt(lat,lon,activeFuel,terrain,sampleTime):null;
            const spread=behavior(activeFuel,terrain.tan,terrain.asp,weather.dir,
              weather.spd*windFactor,moisture,windSite);
            const increment=spread.Rh>0?ellipseRate(spread,angleDifference(bearing,spread.head))*dt:0;
            lat+=increment*Math.cos(bearingRadians)/111320;
            lon+=increment*Math.sin(bearingRadians)/metersPerLongitudeDegree;
            distance+=increment;
          }
        }
        points.push([time,distance,lat,lon,activeFuelKey]);
      }
      rays.push({bg:bearing,pts:points,limited});
    }
    return rays;
  }
  function arrivalTime(rays, ignition, lat, lng) {
    if(!Array.isArray(rays)||rays.length<2||!ignition||!Number.isFinite(lat)||!Number.isFinite(lng))return Infinity;
    const east=(lng-ignition.lng)*111320*Math.cos(ignition.lat*RAD),north=(lat-ignition.lat)*111320;
    const targetDistance=Math.hypot(east,north); if(targetDistance<=0.01)return 0;
    const bearing=(Math.atan2(east,north)/RAD+360)%360,sorted=rays.slice().sort((a,b)=>a.bg-b.bg);
    let lower=sorted[sorted.length-1],upper=sorted[0];
    for(let i=0;i<sorted.length;i++){if(sorted[i].bg<=bearing)lower=sorted[i];if(sorted[i].bg>=bearing){upper=sorted[i];break;}}
    let lb=lower.bg,ub=upper.bg,tb=bearing;if(ub<=lb)ub+=360;if(tb<lb)tb+=360;
    const fraction=ub>lb?(tb-lb)/(ub-lb):0,count=Math.min(lower.pts.length,upper.pts.length);
    for(let i=1;i<count;i++){
      const d0=lower.pts[i-1][1]*(1-fraction)+upper.pts[i-1][1]*fraction;
      const d1=lower.pts[i][1]*(1-fraction)+upper.pts[i][1]*fraction;
      if(d1>=targetDistance&&d1>d0){const f=clamp((targetDistance-d0)/(d1-d0),0,1);return lower.pts[i-1][0]+f*(lower.pts[i][0]-lower.pts[i-1][0]);}
    }
    return Infinity;
  }
  function angleDifference(a,b){return ((a-b+540)%360)-180;}
  root.IrratiWildfireEngine=Object.freeze({fuelMoisture,forestWindSite,windAdjustmentFactor,behavior,ellipseRate,intensity,flameLength,simulate,arrivalTime});
})(window);
