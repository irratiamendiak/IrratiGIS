/* ============================================================
   IrratiGIS · fire-mtt.js  (v9)
   Sute-hedapena: Minimum Travel Time (MTT, Finney 2002 estiloa).
   v8: BIBLIOTEKA: panel propioa desaktibatuta (window.IRRATI_MTT_LEGACY=true bada, panel zaharra). «Suteen bilakaera» panelak
       window.IrratiMTT.runIntegrated(...) erabiltzen du: MTT etapaka (eguraldia ordu-ordutik), erregaia (inbentarioa), terrenoa
       (MDT LiDAR edo Terrarium, index.html-ko fsTerrain) eta hezetasuna (fsMoistAt) partekatuta Erradioak metodoarekin.
   v7: ERREGAI-MODUA (aukerakoa): gelaxka bakoitzean Rothermel (engine.js) + Gipuzkoako Baso Inbentarioa
       (erregai-eredua) + erregai finaren hezetasuna. R0/K_SLOPE/KW ez dira erabiltzen modu horretan.
   - Abiadura lokala: elipse bidezko eredua (Anderson 1983 L/B + Richards fokua),
     haizea + malda bektore bakar batean batuta (gelaxka bakoitzean).
   - Lur-eredua: AWS Terrarium (berdin Campbell geruzak).
   - Kalkulua nabigatzailean (Dijkstra 16 auzokiekin), isokronak + perimetroa.
   Kargatu index.html-n:  <script src="fire-mtt.js?v=1" defer></script>
   ESTIMAZIO SINPLIFIKATUA ETA KALIBRATU GABEA: erreferentzia gisa soilik.
   ============================================================ */
(() => {
  "use strict";

  /* ---------- Parametro kalibragarriak ---------- */
  const CFG = {
    MIDFLAME: 0.4,        // erdi-garren haizea / 10 m-ko haizea
    K_SLOPE: 20,          // km/h-ko haize baliokidea tan(malda)=1 bakoitzeko
    TAN_MAX: 1.2,         // malda-efektuaren muga (≈ 50°)
    KW: 0.12,             // R_aurre = R0·(1 + KW·U_eraginkor[km/h])
    LB_MAX: 8,            // luzera/zabalera ratioaren muga
    MAX_RADIUS_M: 12500,  // kalkulu-eremuaren gehienezko erradioa
    MAX_SIDE: 900,        // gelaxka kopurua alde bakoitzean (gehienez)
    ZOOMS: [14, 13, 12],  // Terrarium zoom-ak (fin → lodi)
    NB_RADIUS: 3,         // auzokideen erradioa (3 → 32 norabide, 2 → 16)
    RMIN: 0.2             // abiadura minimoa norabide guztietan, R0-ren frakzio gisa (atzera/maldan behera)
  };

  const RAD = Math.PI / 180;

  /* ---------- Matematika: Mercator ---------- */
  function lonLatToGlobalPx(lon, lat, z) {
    const s = 256 * Math.pow(2, z);
    const gx = (lon + 180) / 360 * s;
    const sin = Math.sin(lat * RAD);
    const gy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
    return [gx, gy];
  }
  function globalPxToLonLat(gx, gy, z) {
    const s = 256 * Math.pow(2, z);
    const lon = gx / s * 360 - 180;
    const n = Math.PI - 2 * Math.PI * gy / s;
    const lat = Math.atan(Math.sinh(n)) / RAD;
    return [lon, lat];
  }
  function groundRes(lat, z) { return 156543.03392 * Math.cos(lat * RAD) / Math.pow(2, z); }

  /* ---------- Elipse-eredua ---------- */
  // Anderson (1983): L/B = 0.936 e^(0.2566 U) + 0.461 e^(-0.1548 U) - 0.397  (U mph)
  function lbRatio(Ukmh) {
    const U = Ukmh / 1.609344;
    const lb = 0.936 * Math.exp(0.2566 * U) + 0.461 * Math.exp(-0.1548 * U) - 0.397;
    return Math.min(CFG.LB_MAX, Math.max(1, lb));
  }
  function eccentricity(lb) { return Math.sqrt(Math.max(0, lb * lb - 1)) / lb; }
  // Abiadura norabide batean, jatorria foku atzekoan (Richards):  r(θ)=Rh(1-e)/(1-e cosθ)
  function rateAt(Rh, e, cosTheta) { return Rh * (1 - e) / (1 - e * cosTheta); }

  /* Gelaxka bakoitzeko eremuak: Rh, e, norabide-unitarioa (ekialdea, iparraldea) */
  function buildFields(elev, W, H, res, wind, R0) {
    const n = W * H;
    const Rh = new Float32Array(n), Ec = new Float32Array(n);
    const Hx = new Float32Array(n), Hy = new Float32Array(n);
    const Uf = wind.speed * CFG.MIDFLAME;
    const toRad = ((wind.fromDeg + 180) % 360) * RAD;       // haizea nora doan
    const wx = Math.sin(toRad) * Uf, wy = Math.cos(toRad) * Uf;
    const E = (x, y) => elev[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = E(x - 1, y - 1), b = E(x, y - 1), c = E(x + 1, y - 1),
              d = E(x - 1, y),                     f = E(x + 1, y),
              g = E(x - 1, y + 1), h = E(x, y + 1), i = E(x + 1, y + 1);
        const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * res);
        const dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * res);   // y hegoalderantz
        let gx = dzdx, gy = -dzdy;                                       // maldan gora: (E, N)
        const tan = Math.hypot(gx, gy);
        if (tan > CFG.TAN_MAX) { gx *= CFG.TAN_MAX / tan; gy *= CFG.TAN_MAX / tan; }
        const ex = wx + CFG.K_SLOPE * gx, ey = wy + CFG.K_SLOPE * gy;
        const U = Math.hypot(ex, ey);
        const k = y * W + x;
        Rh[k] = R0 * (1 + CFG.KW * U);
        Ec[k] = eccentricity(lbRatio(U));
        if (U > 1e-6) { Hx[k] = ex / U; Hy[k] = ey / U; } else { Hx[k] = 0; Hy[k] = 1; }
      }
    }
    return { Rh, Ec, Hx, Hy, Rmin: CFG.RMIN * R0 };
  }

  /* ---------- ERREGAI-MODUA: Rothermel gelaxka bakoitzean (alferra: bisitatutako gelaxkak soilik) ----------
     codes: Uint8Array (gelaxka → fuels indizea); fuels: erregai-objektuen taula (0 = ordezkoa);
     E: IrratiWildfireEngine; moisture: % (erregai fin hila); wind: {fromDeg, speed(km/h, 10 m)} */
  function makeRothermelFields(elev, W, H, res, wind, moisture, codes, fuels, E) {
    const n = W * H;
    const Rh = new Float32Array(n), Ec = new Float32Array(n), Hx = new Float32Array(n), Hy = new Float32Array(n), Rm = new Float32Array(n);
    const have = new Uint8Array(n);
    const Z = (x, y) => elev[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    function ensure(k) {
      if (have[k]) return; have[k] = 1;
      const y = (k / W) | 0, x = k - y * W;
      const a = Z(x - 1, y - 1), b = Z(x, y - 1), c = Z(x + 1, y - 1),
            d = Z(x - 1, y),                      f = Z(x + 1, y),
            g = Z(x - 1, y + 1), h = Z(x, y + 1), i = Z(x + 1, y + 1);
      const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * res);
      const dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * res);
      let gx = dzdx, gy = -dzdy;                       // maldan gora: (E, N)
      let tan = Math.hypot(gx, gy);
      if (tan > CFG.TAN_MAX) { gx *= CFG.TAN_MAX / tan; gy *= CFG.TAN_MAX / tan; tan = CFG.TAN_MAX; }
      const asp = ((Math.atan2(-gx, -gy) / RAD) + 360) % 360;   // maldan behera doan norabidea (azimutea)
      const fuel = fuels[codes[k]] || fuels[0];
      const bh = E.behavior(fuel, tan, asp, wind.fromDeg, wind.speed, moisture, null);
      const rh = bh && bh.Rh > 0 ? bh.Rh : 0;
      Rh[k] = rh; Ec[k] = rh > 0 ? bh.e : 0;
      const hd = (rh > 0 ? bh.head : 0) * RAD; Hx[k] = Math.sin(hd); Hy[k] = Math.cos(hd);
      Rm[k] = rh > 0 ? CFG.RMIN * (bh.baseRate || 0) : 0;
    }
    return { Rh, Ec, Hx, Hy, RminArr: Rm, ensure, have };
  }
  /* Poligonoak (lon/lat, GeoJSON) kodeen sareta batean errasterizatu (even-odd, zuloak barne). toGrid: [lon,lat] → [x,y] sareta-koordenatuak */
  function fillFeatureCodes(codes, W, H, geom, code, toGrid) {
    const polys = geom && geom.type === "Polygon" ? [geom.coordinates] : geom && geom.type === "MultiPolygon" ? geom.coordinates : [];
    for (const poly of polys) {
      const rings = poly.map(r => r.map(toGrid));
      let ymin = Infinity, ymax = -Infinity;
      for (const r of rings) for (const p of r) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
      const y0 = Math.max(0, Math.ceil(ymin)), y1 = Math.min(H - 1, Math.floor(ymax));
      for (let y = y0; y <= y1; y++) {
        const xs = [];
        for (const r of rings) for (let i = 0; i < r.length - 1; i++) {
          const a = r[i], b = r[i + 1];
          if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
          for (let x = x0; x <= x1; x++) codes[y * W + x] = code;
        }
      }
    }
  }
  /* Elipse teorikoa Rothermel-ekin (lur laua, erregai bakarra) */
  function theoreticalEllipseRothermel(lat, lon, wind, fuel, moisture, Tmin, E) {
    const bh = E.behavior(fuel, 0, 0, wind.fromDeg, wind.speed, moisture, null);
    if (!(bh && bh.Rh > 0)) return { pts: [], head: 0, Rh: 0, e: 0, lb: 1 };
    const hd = bh.head * RAD, hx = Math.sin(hd), hy = Math.cos(hd), pts = [];
    for (let a = 0; a <= 360; a += 5) {
      const th = a * RAD, r = rateAt(bh.Rh, bh.e, Math.cos(th)) * Tmin;
      const ux = hx * Math.cos(th) - hy * Math.sin(th), uy = hy * Math.cos(th) + hx * Math.sin(th);
      pts.push([lon + (r * ux) / (111320 * Math.cos(lat * RAD)), lat + (r * uy) / 111320]);
    }
    return { pts, head: bh.Rh * Tmin, Rh: bh.Rh, e: bh.e, lb: bh.LB };
  }
  /* Hezetasun-oreka (Simard) → erregai fin hila (%), Suteen bilakaera-ren modu berean (EMC·1.03) */
  function fineFuelMoisture(T, RH) {
    const F = T * 9 / 5 + 32; let e;
    if (RH < 10) e = 0.03229 + 0.281073 * RH - 0.000578 * RH * F;
    else if (RH < 50) e = 2.22749 + 0.160107 * RH - 0.014784 * F;
    else e = 21.0606 + 0.005565 * RH * RH - 0.00035 * RH * F - 0.483199 * RH;
    return Math.min(30, Math.max(2, e)) * 1.03;
  }

  /* ---------- Gutxieneko-denbora bidea (Dijkstra, 32 auzokide) ---------- */
  let NB = [];
  function buildNeighbors(radius) {
    const out = [];
    const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
    for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
      if ((ox === 0 && oy === 0) || gcd(ox, oy) !== 1) continue;
      const d = Math.hypot(ox, oy); out.push({ ox, oy, d, ux: ox / d, uy: -oy / d });
    }
    return out;
  }
  NB = buildNeighbors(CFG.NB_RADIUS);

  function mtt(W, H, F, src, Tmax, res) {
    const N = W * H;
    const t = new Float64Array(N).fill(Infinity);
    const done = new Uint8Array(N);
    let cap = 1 << 16, size = 0;
    let hk = new Float64Array(cap), hv = new Int32Array(cap);
    function push(k, v) {
      if (size === cap) {
        cap *= 2;
        const nk = new Float64Array(cap), nv = new Int32Array(cap);
        nk.set(hk); nv.set(hv); hk = nk; hv = nv;
      }
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hk[p] <= k) break;
        hk[i] = hk[p]; hv[i] = hv[p]; i = p;
      }
      hk[i] = k; hv[i] = v;
    }
    let popK = 0, popV = 0;
    function pop() {
      popK = hk[0]; popV = hv[0];
      size--;
      if (size > 0) {
        const k = hk[size], v = hv[size];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= size) break;
          if (c + 1 < size && hk[c + 1] < hk[c]) c++;
          if (hk[c] >= k) break;
          hk[i] = hk[c]; hv[i] = hv[c]; i = c;
        }
        hk[i] = k; hv[i] = v;
      }
    }
    const { Rh, Ec, Hx, Hy } = F;
    const Rmin = F.Rmin || 0, RminArr = F.RminArr || null, ens = F.ensure || null;
    const NBN = NB.length;
    t[src] = 0; push(0, src);
    let visited = 0;
    while (size > 0) {
      pop();
      const k = popK, i = popV;
      if (done[i]) continue;
      if (k > Tmax) break;
      done[i] = 1; visited++;
      const x = i % W, y = (i / W) | 0;
      if (ens) ens(i);
      const Rhi = Rh[i], Ei = Ec[i], hxi = Hx[i], hyi = Hy[i];
      if (ens && !(Rhi > 0)) continue;          // erregairik gabe / hezetasuna > itzaltzekoa: ez da hedatzen
      for (let q = 0; q < NBN; q++) {
        const nb = NB[q];
        const nx = x + nb.ox, ny = y + nb.oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (done[j]) continue;
        if (ens) { ens(j); if (!(Rh[j] > 0)) continue; }
        const ci = nb.ux * hxi + nb.uy * hyi;
        const cj = nb.ux * Hx[j] + nb.uy * Hy[j];
        const ri = Math.max(RminArr ? RminArr[i] : Rmin, rateAt(Rhi, Ei, ci)), rj = Math.max(RminArr ? RminArr[j] : Rmin, rateAt(Rh[j], Ec[j], cj));
        const dist = nb.d * res;
        const nt = k + 0.5 * dist * (1 / ri + 1 / rj);
        if (nt < t[j]) { t[j] = nt; push(nt, j); }
      }
    }
    return { t, done, visited };
  }


  /* ---------- MTT ETAPAKA: baldintzak (eguraldia/hezetasuna) tarte bakoitzean desberdinak izan daitezke ----------
     ends: etapen amaiera-denborak (min, goranzkoak); getFields(si): etapa horretako eremuak ({Rh,Ec,Hx,Hy,RminArr,ensure}).
     Etapa bakoitzean aurreko etapako gelaxka finkatuetatik (aurrealdea) jarraitzen du. */
  function mttStaged(W, H, res, src, ends, getFields) {
    const N = W * H;
    const t = new Float64Array(N).fill(Infinity);
    const done = new Uint8Array(N);
    let cap = 1 << 16, size = 0;
    let hk = new Float64Array(cap), hv = new Int32Array(cap);
    function push(k, v) {
      if (size === cap) {
        cap *= 2;
        const nk = new Float64Array(cap), nv = new Int32Array(cap);
        nk.set(hk); nv.set(hv); hk = nk; hv = nv;
      }
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hk[p] <= k) break;
        hk[i] = hk[p]; hv[i] = hv[p]; i = p;
      }
      hk[i] = k; hv[i] = v;
    }
    let popK = 0, popV = 0;
    function pop() {
      popK = hk[0]; popV = hv[0];
      size--;
      if (size > 0) {
        const k = hk[size], v = hv[size];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= size) break;
          if (c + 1 < size && hk[c + 1] < hk[c]) c++;
          if (hk[c] >= k) break;
          hk[i] = hk[c]; hv[i] = hv[c]; i = c;
        }
        hk[i] = k; hv[i] = v;
      }
    }
    const NBN = NB.length;
    let fr = [], visited = 0;
    for (let si = 0; si < ends.length; si++) {
      const Tend = ends[si], F = getFields(si);
      const Rh = F.Rh, Ec = F.Ec, Hx = F.Hx, Hy = F.Hy, RminArr = F.RminArr, ens = F.ensure;
      size = 0;
      for (let i = 0; i < N; i++) if (!done[i]) t[i] = Infinity;    // aurreko etapako behin-behineko denborak baztertu
      const fr2 = [];
      // i gelaxka finkatutik auzokideak erlaxatu; true = oraindik auzokide finkatu gabeak daude
      const floorT = si === 0 ? 0 : ends[si - 1];      // etapa honen hasiera: baldintza berriek ezin dute aurreko denborak aldatu
      const relax = (i, k) => {
        const x = i % W, y = (i / W) | 0;
        ens(i);
        const Rhi = Rh[i];
        if (!(Rhi > 0)) return false;
        const Ei = Ec[i], hxi = Hx[i], hyi = Hy[i];
        let open = false;
        for (let q = 0; q < NBN; q++) {
          const nb = NB[q], nx = x + nb.ox, ny = y + nb.oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (done[j]) continue;
          open = true;
          ens(j); if (!(Rh[j] > 0)) continue;
          const ci = nb.ux * hxi + nb.uy * hyi, cj = nb.ux * Hx[j] + nb.uy * Hy[j];
          const ri = Math.max(RminArr[i], rateAt(Rhi, Ei, ci)), rj = Math.max(RminArr[j], rateAt(Rh[j], Ec[j], cj));
          let nt = k + 0.5 * nb.d * res * (1 / ri + 1 / rj);
          if (nt < floorT) nt = floorT;
          if (nt < t[j]) { t[j] = nt; push(nt, j); }
        }
        return open;
      };
      if (si === 0) { t[src] = 0; push(0, src); }
      else for (const i of fr) if (relax(i, t[i])) fr2.push(i);
      while (size > 0) {
        pop();
        const k = popK, i = popV;
        if (done[i]) continue;
        if (k > Tend) break;
        done[i] = 1; visited++;
        if (relax(i, k)) fr2.push(i);
      }
      fr = fr2;
    }
    return { t, done, visited };
  }

  /* Gelaxka-eremuak (alferrak) integraziorako: erregaia, malda, hezetasuna eta haize-doikuntza kanpoko funtzioetatik. */
  function makeCellFields(N, codes, fuels, E, wind, windFactor, terrOf, moistOf, siteOf, stats) {
    const Rh = new Float32Array(N), Ec = new Float32Array(N), Hx = new Float32Array(N), Hy = new Float32Array(N), Rm = new Float32Array(N);
    const have = new Uint8Array(N);
    function ensure(k) {
      if (have[k]) return; have[k] = 1;
      const ter = terrOf(k);
      if (!ter) { if (stats) stats.noTerrain++; return; }               // lurzorurik gabe (LiDAR estaldurarik ez): ez da hedatzen
      const fuel = fuels[codes[k]] || fuels[0];
      const m = Math.max(2, moistOf(fuel, ter, k));
      const site = siteOf ? siteOf(fuel, ter, k) : null;
      const b = E.behavior(fuel, ter.tan, ter.asp, wind.dir, wind.spd * windFactor, m, site);
      const rh = b && b.Rh > 0 ? b.Rh : 0;
      Rh[k] = rh; Ec[k] = rh > 0 ? b.e : 0;
      const hd = (rh > 0 ? b.head : 0) * RAD; Hx[k] = Math.sin(hd); Hy[k] = Math.cos(hd);
      Rm[k] = rh > 0 ? CFG.RMIN * (b.baseRate || 0) : 0;
    }
    return { Rh, Ec, Hx, Hy, RminArr: Rm, ensure, have };
  }

  /* Maila altuko sarrera: «Suteen bilakaera» panelak erabiltzen du (terrenoa, eguraldia, hezetasuna, erregaia partekatuta).
     o: {lat,lng,engine,fuel,FUELS,NOFUEL,features,fuelKeyOf,times,stageMin,reachM,coverM,windFactor,
         weatherAt(t),sunAt(t),terrainAt(lat,lon),moistureAt(w,fuel,ter,sun),windSiteAt(lat,lon,fuel,ter,t)} */
  function runIntegrated(o) {
    const E = o.engine, times = o.times || [30, 60, 90, 120], stageMin = o.stageMin || 15, windFactor = o.windFactor == null ? 1 : o.windFactor, mDelta = o.moistureDelta || 0;
    const Tmax = Math.max.apply(null, times);
    const Rwant = Math.min(o.coverM || 5000, Math.max(400, o.reachM || 5000));
    let z = 14, res = 0, Rpx = 0;
    for (const zz of [14, 13, 12]) { z = zz; res = groundRes(o.lat, z); Rpx = Math.ceil(Rwant / res); if (2 * Rpx + 1 <= CFG.MAX_SIDE) break; }
    if (2 * Rpx + 1 > CFG.MAX_SIDE) Rpx = (CFG.MAX_SIDE - 1) >> 1;
    const W = 2 * Rpx + 1, H = W, N = W * H;
    const gS = lonLatToGlobalPx(o.lng, o.lat, z), gx0 = Math.floor(gS[0]) - Rpx, gy0 = Math.floor(gS[1]) - Rpx, src = Rpx * W + Rpx;
    const cellLL = (k) => { const y = (k / W) | 0, x = k - y * W, g = globalPxToLonLat(gx0 + x + 0.5, gy0 + y + 0.5, z); return [g[1], g[0]]; };   // [lat, lon]
    // erregai-kodeak
    const codes = new Uint8Array(N), fuels = [o.fuel], keys = ["ordezkoa"], idx = new Map();
    let polys = 0;
    if (o.features && o.features.length) {
      const toGrid = (p) => { const g = lonLatToGlobalPx(p[0], p[1], z); return [g[0] - gx0 - 0.5, g[1] - gy0 - 0.5]; };
      const memo = new Map();
      for (const f of o.features) {
        const p = f.properties || {};
        const mk = [p.TIPES_es, p.TIPES, p.tipo, p.TYPE, p.SP1_es, p.SP1, p.SP2_es, p.SP2, p.SP3_es, p.SP3].join("|");
        let key = memo.get(mk); if (key === undefined) { key = o.fuelKeyOf(p); memo.set(mk, key); }
        if (!key) continue;
        const fuel = key === "nb" ? o.NOFUEL : o.FUELS[key]; if (!fuel) continue;
        let c = idx.get(key); if (c === undefined) { c = fuels.length; fuels.push(fuel); keys.push(key); idx.set(key, c); }
        polys++;
        fillFeatureCodes(codes, W, H, f.geometry, c, toGrid);
      }
    }
    // malda cachea (etapen artean partekatua)
    const tanA = new Float32Array(N), aspA = new Float32Array(N), tSt = new Uint8Array(N);
    const terrOf = (k) => {
      if (tSt[k] === 0) {
        const ll = cellLL(k), ter = o.terrainAt(ll[0], ll[1]);
        if (ter) { tanA[k] = Math.min(ter.tan, CFG.TAN_MAX * 1.5); aspA[k] = ter.asp; tSt[k] = 1; } else tSt[k] = 2;
      }
      return tSt[k] === 1 ? { tan: tanA[k], asp: aspA[k] } : null;
    };
    const stats = { noTerrain: 0 };
    const ends = []; for (let tt = stageMin; tt <= Tmax + 1e-9; tt += stageMin) ends.push(tt);
    const getFields = (si) => {
      const mid = ends[si] - stageMin / 2, w = o.weatherAt(mid), sun = o.sunAt ? o.sunAt(mid) : null;
      return makeCellFields(N, codes, fuels, E, { dir: w.dir, spd: w.spd }, windFactor, terrOf,
        (fuel, ter) => o.moistureAt(w, fuel, ter, sun) + mDelta,
        o.windSiteAt ? (fuel, ter, k) => { const ll = cellLL(k); return o.windSiteAt(ll[0], ll[1], fuel, ter, mid); } : null, stats);
    };
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const m = mttStaged(W, H, res, src, ends, getFields);
    const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    const t = m.t, cellHa = res * res / 1e4;
    // bounding box eta area/perimetroak
    const areas = {}, rings = {};
    let bx0 = W, bx1 = 0, by0 = H, by1 = 0, clipped = false;
    for (let i = 0; i < N; i++) if (t[i] <= Tmax) {
      const x = i % W, y = (i / W) | 0;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    if (bx0 <= 1 || by0 <= 1 || bx1 >= W - 2 || by1 >= H - 2) clipped = true;
    const box = { x0: bx0 - 2, y0: by0 - 2, x1: bx1 + 1, y1: by1 + 1 };
    const toLL = (p) => { const g = globalPxToLonLat(gx0 + p[0] + 0.5, gy0 + p[1] + 0.5, z); return [g[1], g[0]]; };
    for (const T of times) {
      let c = 0; for (let i = 0; i < N; i++) if (t[i] <= T) c++;
      areas[T] = c * cellHa;
      rings[T] = contourLoops(t, W, H, T, box).filter(l => l.pts.length > 3).map(l => l.pts.map(toLL));
    }
    // erregai-banaketa (azken denborako eremuan)
    const cnt = new Map(); let tot = 0;
    for (let i = 0; i < N; i++) if (t[i] <= Tmax) { cnt.set(codes[i], (cnt.get(codes[i]) || 0) + 1); tot++; }
    const fuelShare = [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ key: keys[c], pct: 100 * n / Math.max(1, tot) }));
    const stalled = keys.map((k, c) => ({ k, f: fuels[c] })).filter(q => q.k !== "nb" && q.f && q.f.Mx > 0).map(q => q.k);
    // beste poligono baten (lat,lng) gainjartzea (IoU) sareta honetan: ring = [[lat,lon],...]
    const iouWith = (T, ring) => {
      if (!ring || ring.length < 3) return null;
      const pts = ring.map(p => { const g = lonLatToGlobalPx(p[1], p[0], z); return [g[0] - gx0 - 0.5, g[1] - gy0 - 0.5]; });
      const mask = rasterizeRing(pts, W, H);
      let I = 0, U = 0, A = 0, B = 0;
      for (let i = 0; i < N; i++) { const a = t[i] <= T, b = mask[i] > 0; if (a) A++; if (b) B++; if (a && b) I++; if (a || b) U++; }
      return { iou: U ? I / U : 0, mttInRays: B ? I / B : 0, raysInMtt: A ? I / A : 0 };
    };
    return { times, areas, rings, W, H, res, z, gx0, gy0, Rpx, t, done: m.done, visited: m.visited, ms, clipped,
             noTerrain: stats.noTerrain, polys, fuelShare, keys, iouWith, stageMin, ends };
  }

  /* ---------- Marching squares + josketa ---------- */
  // Itzultzen du: [{pts:[[px,py],...], closed:boolean}, ...]  (px,py = sareta-koordenatuak)
  function contourLoops(t, W, H, level, box) {
    const x0 = Math.max(0, box.x0), y0 = Math.max(0, box.y0);
    const x1 = Math.min(W - 2, box.x1), y1 = Math.min(H - 2, box.y1);
    const inside = (v) => v <= level;
    const pos = new Map();          // edge-key → [px,py]
    const adj = new Map();          // edge-key → [seg ids]
    const segs = [];
    const keyH = (x, y) => (y * W + x) * 2, keyV = (x, y) => (y * W + x) * 2 + 1;
    const frac = (a, b) => {
      if (!isFinite(b)) return 0.98;
      if (!isFinite(a)) return 0.02;
      const d = b - a; return d === 0 ? 0.5 : Math.min(1, Math.max(0, (level - a) / d));
    };
    function edgePoint(kind, x, y) {
      const key = kind === "H" ? keyH(x, y) : keyV(x, y);
      if (!pos.has(key)) {
        if (kind === "H") { const a = t[y * W + x], b = t[y * W + x + 1]; pos.set(key, [x + frac(a, b), y]); }
        else { const a = t[y * W + x], b = t[(y + 1) * W + x]; pos.set(key, [x, y + frac(a, b)]); }
      }
      return key;
    }
    function addSeg(k1, k2) {
      const id = segs.length; segs.push([k1, k2]);
      if (!adj.has(k1)) adj.set(k1, []); adj.get(k1).push(id);
      if (!adj.has(k2)) adj.set(k2, []); adj.get(k2).push(id);
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const vTL = t[y * W + x], vTR = t[y * W + x + 1], vBL = t[(y + 1) * W + x], vBR = t[(y + 1) * W + x + 1];
        const TL = inside(vTL), TR = inside(vTR), BR = inside(vBR), BL = inside(vBL);
        if (TL === TR && TR === BR && BR === BL) continue;
        const cr = [];     // ordena: goia, eskuina, behea, ezkerra
        if (TL !== TR) cr.push(["top", edgePoint("H", x, y)]);
        if (TR !== BR) cr.push(["right", edgePoint("V", x + 1, y)]);
        if (BR !== BL) cr.push(["bottom", edgePoint("H", x, y + 1)]);
        if (BL !== TL) cr.push(["left", edgePoint("V", x, y)]);
        if (cr.length === 2) { addSeg(cr[0][1], cr[1][1]); continue; }
        if (cr.length === 4) {
          const E = Object.fromEntries(cr);
          const avg = (vTL + vTR + vBL + vBR) / 4;
          const centerIn = isFinite(avg) ? avg <= level : false;
          // zentroa barruan → kanpoko izkinak isolatu; bestela barruko izkinak
          const want = !centerIn;     // true = barruko izkinak isolatu
          const corners = [["TL", TL, "top", "left"], ["TR", TR, "top", "right"],
                           ["BR", BR, "right", "bottom"], ["BL", BL, "bottom", "left"]];
          corners.forEach(([, st, e1, e2]) => { if (st === want) addSeg(E[e1], E[e2]); });
        }
      }
    }
    // josketa
    const used = new Uint8Array(segs.length);
    const loops = [];
    for (let s0 = 0; s0 < segs.length; s0++) {
      if (used[s0]) continue;
      used[s0] = 1;
      const chain = [segs[s0][0], segs[s0][1]];
      // aurrera
      for (;;) {
        const last = chain[chain.length - 1];
        const cand = (adj.get(last) || []).find(id => !used[id]);
        if (cand === undefined) break;
        used[cand] = 1;
        const s = segs[cand]; chain.push(s[0] === last ? s[1] : s[0]);
        if (chain[chain.length - 1] === chain[0]) break;
      }
      // atzera (kate irekia bada)
      if (chain[chain.length - 1] !== chain[0]) {
        for (;;) {
          const first = chain[0];
          const cand = (adj.get(first) || []).find(id => !used[id]);
          if (cand === undefined) break;
          used[cand] = 1;
          const s = segs[cand]; chain.unshift(s[0] === first ? s[1] : s[0]);
          if (chain[0] === chain[chain.length - 1]) break;
        }
      }
      const closed = chain.length > 3 && chain[0] === chain[chain.length - 1];
      loops.push({ pts: chain.map(k => pos.get(k)), closed });
    }
    return loops;
  }

  function polygonAreaPx(pts) {
    let a = 0;
    for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
    return Math.abs(a) / 2;
  }

  /* ---------- Domeinua ---------- */
  function chooseDomain(lat, Tmin, R0, windSpeed, RdomMin) {
    const Uf = windSpeed * CFG.MIDFLAME;
    const Ubound = Uf + CFG.K_SLOPE * CFG.TAN_MAX;
    const Rbound = R0 * (1 + CFG.KW * Ubound);
    let Rdom = Math.min(CFG.MAX_RADIUS_M, Math.max(300, 1.1 * Rbound * Tmin, RdomMin || 0));
    let z = CFG.ZOOMS[CFG.ZOOMS.length - 1];
    for (const zz of CFG.ZOOMS) { if (2 * Rdom / groundRes(lat, zz) <= CFG.MAX_SIDE) { z = zz; break; } }
    const res = groundRes(lat, z);
    const maxR = CFG.MAX_SIDE * res / 2;
    const clipped = Rdom > maxR;
    if (clipped) Rdom = maxR;
    return { z, res, Rdom, Rpx: Math.floor(Rdom / res), clipped };
  }

  /* ---------- Elipse teorikoa (lur laua) alderatzeko ---------- */
  function theoreticalEllipse(lat, lon, wind, R0, Tmin) {
    const Uf = wind.speed * CFG.MIDFLAME;
    const Rh = R0 * (1 + CFG.KW * Uf), e = eccentricity(lbRatio(Uf));
    const toRad = ((wind.fromDeg + 180) % 360) * RAD;
    const hx = Math.sin(toRad), hy = Math.cos(toRad);
    const pts = [];
    for (let a = 0; a <= 360; a += 5) {
      const th = a * RAD;
      const r = rateAt(Rh, e, Math.cos(th)) * Tmin;
      // biratu head-norabidearen inguruan
      const ux = hx * Math.cos(th) - hy * Math.sin(th);
      const uy = hy * Math.cos(th) + hx * Math.sin(th);
      pts.push([lon + (r * ux) / (111320 * Math.cos(lat * RAD)), lat + (r * uy) / 111320]);
    }
    return { pts, head: Rh * Tmin, Rh, e };
  }

  /* ---------- Kalibrazioa: erreferentzia-perimetroarekin alderatu ---------- */
  // ring: [[x,y],...] sareta-koordenatuetan (gelaxka zentroa = zenbaki osoa), itxia
  function rasterizeRing(ring, W, H) {
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const xs = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const xa = ring[i][0], ya = ring[i][1], xb = ring[i + 1][0], yb = ring[i + 1][1];
        if ((ya > y) !== (yb > y)) xs.push(xa + (xb - xa) * (y - ya) / (yb - ya));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
        for (let x = x0; x <= x1; x++) mask[y * W + x] = 1;
      }
    }
    return mask;
  }
  // T bakoitzeko IoU eta azalera (gelaxka-kopurua): {curve:[{T,A,I,iou}], R}
  function calibrationCurve(t, ref, Tmax, nb) {
    const A = new Float64Array(nb + 1), I = new Float64Array(nb + 1);
    const dT = Tmax / nb; let R = 0;
    for (let i = 0; i < t.length; i++) {
      if (ref[i]) R++;
      const v = t[i];
      if (!isFinite(v) || v > Tmax) continue;
      const b = Math.min(nb, Math.ceil(v / dT));
      A[b]++; if (ref[i]) I[b]++;
    }
    const curve = []; let a = 0, inter = 0;
    for (let b = 0; b <= nb; b++) {
      a += A[b]; inter += I[b];
      curve.push({ T: b * dT, A: a, I: inter, iou: inter / (a + R - inter) });
    }
    return { curve, R };
  }

  // Kalibrazioa R0-rik gabe: R0=1 m/min-ekin kalkulatu (T = R0·T metrotan).
  // combos: [{K, fromDeg, speed}] → {runs (laburpena), sel (onena, t-rekin)}
  function calibrateSweep(elev, W, H, res, src, mask, combos, opts) {
    const runs = []; let sel = null;
    const mk = opts && opts.mk, Tlim = opts && opts.Tmax ? opts.Tmax : Infinity;
    for (const cb of combos) {
      let F;
      if (mk) F = mk(cb); else { CFG.K_SLOPE = cb.K; F = buildFields(elev, W, H, res, { fromDeg: cb.fromDeg, speed: cb.speed }, 1); }
      const m = mtt(W, H, F, src, Tlim, res);
      let Tedge = Infinity;
      for (let x = 0; x < W; x++) Tedge = Math.min(Tedge, m.t[x], m.t[(H - 1) * W + x]);
      for (let y = 0; y < H; y++) Tedge = Math.min(Tedge, m.t[y * W], m.t[y * W + W - 1]);
      if (!isFinite(Tedge) || Tedge > Tlim) Tedge = Tlim;
      const { curve, R } = calibrationCurve(m.t, mask, Tedge, 720);
      let best = curve[0]; for (const c of curve) if (c.iou > best.iou) best = c;
      const am = curve.find(c => c.A >= R) || null;
      const r = { K: cb.K, fromDeg: cb.fromDeg, speed: cb.speed, visited: m.visited, Tcap: Tedge, best, am, R };
      runs.push(r);
      if (!sel || best.iou > sel.best.iou) { sel = r; sel.t = m.t; }
      else if (r.t) delete r.t;
    }
    runs.forEach(r => { if (r !== sel) delete r.t; });
    return { runs, sel };
  }

  const core = { mttStaged, makeCellFields, runIntegrated, makeRothermelFields, fillFeatureCodes, theoreticalEllipseRothermel, fineFuelMoisture, calibrateSweep, rasterizeRing, calibrationCurve, CFG, buildNeighbors, setNeighbors: (r) => { NB = buildNeighbors(r); }, lbRatio, eccentricity, rateAt, buildFields, mtt, contourLoops, polygonAreaPx,
                 chooseDomain, theoreticalEllipse, lonLatToGlobalPx, globalPxToLonLat, groundRes };
  if (typeof module !== "undefined" && module.exports) { module.exports = core; }
  if (typeof window === "undefined") return;
  window.IrratiMTT = core;
  window.IrratiFireMTT = { core };

  /* =========================================================
     UI (Leaflet)
     ========================================================= */
  const S = {
    title: "🔥 Sute-hedapena (MTT)",
    pick: "📍 Sua hasteko puntua",
    picking: "Egin klik mapan…",
    windFrom: "Haizea · nondik (°)",
    windSpeed: "Haizea · abiadura (km/h, 10 m)",
    auto: "Automatikoa",
    dur: "Iraupena (min)",
    r0: "R0 · oinarrizko abiadura (m/min)",
    ell: "Elipse teorikoa alderatu (lur laua)",
    calc: "Kalkulatu", clear: "Garbitu", toTrack: "Perimetroa trackera",
    note: "Eredu sinplifikatua eta kalibratu gabea (malda + haizea, erregai uniformea). Erreferentzia gisa soilik.",
    needPoint: "Lehenik markatu sua hasteko puntua.",
    wait: "Kalkulatzen…", demLoading: "Lur-eredua kargatzen…", fuelLoading: "Baso Inbentarioa (erregaiak) kargatzen…",
    fuelOn: "Erregaia: inbentarioa + Rothermel (hezetasuna)", moist: "Erregai fin hilaren hezetasuna (%)", fb: "Ordezko erregaia (poligonorik gabe)",
    noteFuel: "Erregai-modua: Baso Inbentarioko estaldura → Anderson eredua (hipotesi-taula) + Rothermel gelaxka bakoitzean; hezetasuna uniformea (euri-historiarik gabe). Lur-eredua: AWS Terrarium (ez LiDAR).",
    adv: "Parametro aurreratuak", ref: "Erreferentzia (GeoJSON)", cal: "Kalibratu (iraupena automatikoa, IoU)", sweep: "K_SLOPE automatikoki aztertu (0–40)", sweepW: "Haizea ere aztertu (±60°, 0–2× abiadura)"
  };

  let map = null, panel = null, btn = null, marker = null, picking = false;
  let layer = null, lastRing = null, ref = null, refLayer = null;

  function $(id) { return document.getElementById(id); }
  function setMsg(t) { const m = $("fmMsg"); if (m) m.innerHTML = t; }

  async function fetchWind(lat, lon) {
    const u = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4),
      current: "wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m", wind_speed_unit: "kmh", timezone: "auto"
    });
    const r = await fetch(u); if (!r.ok) throw new Error("Open-Meteo " + r.status);
    const j = await r.json(); const c = j.current;
    if (!c) throw new Error("Open-Meteo: datu gabe");
    return { fromDeg: Number(c.wind_direction_10m), speed: Number(c.wind_speed_10m), T: Number(c.temperature_2m), RH: Number(c.relative_humidity_2m) };
  }

  function loadTile(z, x, y) {
    return new Promise((resolve) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/" + z + "/" + x + "/" + y + ".png";
    });
  }

  async function loadDEM(z, gx0, gy0, W, H) {
    if (typeof window !== "undefined" && typeof window.__fmDemLoader === "function") return window.__fmDemLoader(z, gx0, gy0, W, H);   // probetarako ataka
    const tx0 = Math.floor(gx0 / 256), tx1 = Math.floor((gx0 + W - 1) / 256);
    const ty0 = Math.floor(gy0 / 256), ty1 = Math.floor((gy0 + H - 1) / 256);
    const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;
    const cv = document.createElement("canvas"); cv.width = nx * 256; cv.height = ny * 256;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(loadTile(z, tx, ty).then(img => ({ img, tx, ty })));
    }
    const res = await Promise.all(jobs);
    let missing = 0;
    res.forEach(({ img, tx, ty }) => { if (img) ctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256); else missing++; });
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const elev = new Float32Array(W * H);
    const offX = gx0 - tx0 * 256, offY = gy0 - ty0 * 256;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = ((y + offY) * cv.width + (x + offX)) * 4;
      elev[y * W + x] = data[k + 3] === 0 ? 0 : (data[k] * 256 + data[k + 1] + data[k + 2] / 256) - 32768;
    }
    return { elev, missing };
  }

  /* ---------- ERREGAI-MODUA: erregaiak eta motorra (index.html-eko globalak) ---------- */
  function getEngine() { return (typeof window !== "undefined" && window.IrratiWildfireEngine) || null; }
  function getFuelApi() {
    try {
      if (typeof FS_FUELS === "undefined" || typeof fsCreateInventoryFuelSampler !== "function" || typeof fsFuelFromInventoryProperties !== "function") return null;
      const size = typeof FS_INV_SIZE !== "undefined" ? FS_INV_SIZE : 1536, zoom = typeof FS_INV_ZOOM !== "undefined" ? FS_INV_ZOOM : 13;
      return {
        FUELS: FS_FUELS, NOFUEL: typeof FS_NOFUEL !== "undefined" ? FS_NOFUEL : null,
        fromProps: fsFuelFromInventoryProperties, create: fsCreateInventoryFuelSampler,
        coverM: (lat) => 0.46 * size * 78271.517 * Math.cos(lat * RAD) / Math.pow(2, zoom)
      };
    } catch (_) { return null; }
  }
  async function fetchInventory(api, ll) {
    const sm = await api.create({ lat: ll.lat, lng: ll.lng });
    try {
      await new Promise(r => setTimeout(r, 80));
      return sm.map.queryRenderedFeatures({ layers: ["forestal-poligonos"] }) || [];
    } finally {
      try { sm.map.remove(); } catch (_) {}
      try { sm.container.remove(); } catch (_) {}
    }
  }
  async function buildFuelGrid(api, ll, dom, gx0, gy0, W, H, fbKey) {
    const fb = api.FUELS[fbKey] || api.FUELS.fm5;
    const fuels = [fb], keys = ["ordezkoa " + fbKey], idx = new Map();
    const codes = new Uint8Array(W * H);
    const feats = await fetchInventory(api, ll);
    const memo = new Map(); let mapped = 0;
    const toGrid = (p) => { const g = lonLatToGlobalPx(p[0], p[1], dom.z); return [g[0] - gx0 - 0.5, g[1] - gy0 - 0.5]; };
    for (const f of feats) {
      const p = f.properties || {};
      const mk = [p.TIPES_es, p.TIPES, p.tipo, p.TYPE, p.SP1_es, p.SP1, p.SP2_es, p.SP2, p.SP3_es, p.SP3].join("|");
      let key = memo.get(mk); if (key === undefined) { key = api.fromProps(p); memo.set(mk, key); }
      if (!key) continue;
      const fuel = key === "nb" ? api.NOFUEL : api.FUELS[key]; if (!fuel) continue;
      let c = idx.get(key); if (c === undefined) { c = fuels.length; fuels.push(fuel); keys.push(key); idx.set(key, c); }
      mapped++;
      fillFeatureCodes(codes, W, H, f.geometry, c, toGrid);
    }
    let inDom = 0, fbCells = 0; const R = dom.Rpx, cx = R, cy = R;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > R * R) continue;
      inDom++; if (codes[y * W + x] === 0) fbCells++;
    }
    const info = feats.length
      ? `Inbentarioa: ${feats.length} poligono (${mapped} erregai-ereduarekin) · ordezko erregaia (${fbKey}) eremuaren %${Math.round(100 * fbCells / Math.max(1, inDom))}an (poligonorik gabe edo sailkatu gabe)`
      : "⚠️ Ez da inbentario-poligonorik lortu: eremu osoa ordezko erregaiarekin (" + fbKey + ")";
    return { codes, fuels, keys, info };
  }

  function clearResult() {
    if (layer) { layer.clearLayers(); }
    lastRing = null;
    const b = $("fmToTrack"); if (b) b.disabled = true;
  }

  const num = (id, def) => { const el = $(id); const v = el ? parseFloat(el.value) : NaN; return isNaN(v) ? def : v; };

  async function run() {
    if (!marker) { setMsg(S.needPoint); return; }
    const ll = marker.getLatLng();
    CFG.K_SLOPE = Math.max(0, num("fmKs", 20));
    CFG.KW = Math.max(0, num("fmKw", 0.12));
    CFG.RMIN = Math.min(1, Math.max(0, num("fmRmin", 0.2)));
    const wind = { fromDeg: ((num("fmWdir", 180) % 360) + 360) % 360, speed: Math.max(0, num("fmWspd", 10)) };
    const Tmin = Math.max(1, num("fmDur", 60));
    const R0 = Math.max(0.05, num("fmR0", 2));
    const calib = !!(ref && $("fmCal").checked);
    const fuelOn = !!($("fmFuelOn") && $("fmFuelOn").checked);
    const moisture = Math.max(1, num("fmMoist", 8));
    const fbKey = ($("fmFb") && $("fmFb").value) || "fm5";
    const api = fuelOn ? getFuelApi() : null, EN = fuelOn ? getEngine() : null;
    if (fuelOn && (!api || !EN)) { setMsg("⚠️ Erregai-modua ez dago erabilgarri (Baso Inbentarioa edo Rothermel motorra falta dira). Desmarkatu «Erregaia» aukera."); return; }
    clearResult();
    $("fmRun").disabled = true; setMsg(S.demLoading);
    try {
      let RdomMin = 0;
      if (calib) {
        const kx = 111320 * Math.cos(ll.lat * RAD), ky = 111320;
        ref.ring.forEach(p => { RdomMin = Math.max(RdomMin, Math.hypot((p[0] - ll.lng) * kx, (p[1] - ll.lat) * ky)); });
        RdomMin = RdomMin * 1.3 + 150;
      }
      let dom;
      if (fuelOn) dom = chooseDomain(ll.lat, 0, R0, wind.speed, Math.min(api.coverM(ll.lat), Math.max(RdomMin, 500, 45 * Tmin)));
      else dom = chooseDomain(ll.lat, calib ? 0 : Tmin, R0, wind.speed, RdomMin);
      const [gxS, gyS] = lonLatToGlobalPx(ll.lng, ll.lat, dom.z);
      const sx = Math.round(gxS), sy = Math.round(gyS);
      const W = 2 * dom.Rpx + 1, H = W;
      const gx0 = sx - dom.Rpx, gy0 = sy - dom.Rpx;
      const { elev, missing } = await loadDEM(dom.z, gx0, gy0, W, H);
      let codes = null, fuels = null, fuelKeys = null, fuelInfo = "";
      if (fuelOn) {
        setMsg(S.fuelLoading);
        const fg = await buildFuelGrid(api, ll, dom, gx0, gy0, W, H, fbKey);
        codes = fg.codes; fuels = fg.fuels; fuelKeys = fg.keys; fuelInfo = fg.info;
      }
      setMsg(S.wait);
      await new Promise(r => setTimeout(r, 30));
      const t0 = performance.now();
      const src = dom.Rpx * W + dom.Rpx;
      const cellHa = dom.res * dom.res / 1e4;
      let t, visited, Tshow = Tmin, calTxt = "", warnTxt = "";
      if (calib) {
        const ringG = ref.ring.map(p => { const g = lonLatToGlobalPx(p[0], p[1], dom.z); return [g[0] - gx0 - 0.5, g[1] - gy0 - 0.5]; });
        const mask = rasterizeRing(ringG, W, H);
        const sweepK = !fuelOn && $("fmSweep").checked, sweepW = $("fmSweepW").checked;
        const calOpts = fuelOn ? { mk: (cb) => makeRothermelFields(elev, W, H, dom.res, { fromDeg: cb.fromDeg, speed: cb.speed }, moisture, codes, fuels, EN), Tmax: Math.max(4 * Tmin, 120) } : undefined;
        const Ks = sweepK ? [0, 5, 10, 15, 20, 30, 40] : [CFG.K_SLOPE];
        const w0 = { fromDeg: wind.fromDeg, speed: wind.speed };
        const r1 = calibrateSweep(elev, W, H, dom.res, src, mask, Ks.map(K => ({ K, fromDeg: w0.fromDeg, speed: w0.speed })), calOpts);
        let sel = r1.sel; const kRuns = r1.runs; let wRuns = [];
        if (sweepW) {
          const wc = [];
          for (const off of [-60, -40, -20, 0, 20, 40, 60]) for (const mult of [0, 0.5, 1, 1.5, 2]) {
            if (mult === 0 && off !== 0) continue;
            wc.push({ K: sel.K, fromDeg: (w0.fromDeg + off + 360) % 360, speed: w0.speed * mult });
          }
          const r2 = calibrateSweep(elev, W, H, dom.res, src, mask, wc, calOpts);
          wRuns = r2.runs; if (r2.sel.best.iou > sel.best.iou) sel = r2.sel;
        }
        CFG.K_SLOPE = sel.K; wind.fromDeg = sel.fromDeg; wind.speed = sel.speed;
        if (sweepK) $("fmKs").value = sel.K;
        if (sweepW) { $("fmWdir").value = Math.round(sel.fromDeg); $("fmWspd").value = Math.round(sel.speed * 10) / 10; }
        t = sel.t; visited = sel.visited; Tshow = Math.max(1, sel.best.T);
        const tMin = (m) => Math.round(m / (fuelOn ? 1 : R0));
        calTxt = `<br>Erreferentzia: <strong>${(sel.R * cellHa).toFixed(1)} ha</strong>` +
          `<br>IoU onena: <strong>${sel.best.iou.toFixed(2)}</strong> · ${fuelOn ? "T = " + Math.round(sel.best.T) + " min" : "R0·T = " + Math.round(sel.best.T) + " m (R0=" + R0 + " → T = " + tMin(sel.best.T) + " min)"} · eredua ${(sel.best.A * cellHa).toFixed(1)} ha` +
          `<br>Errealaren %${Math.round(100 * sel.best.I / sel.R)} estalita · modeloaren %${Math.round(100 * (1 - sel.best.I / sel.best.A))} kanpoan` +
          `<br>Azalera berdina: ${sel.am ? (fuelOn ? "T = " + Math.round(sel.am.T) + " min" : "R0·T = " + Math.round(sel.am.T) + " m (T = " + tMin(sel.am.T) + " min)") + " · IoU " + sel.am.iou.toFixed(2) + " · estalita %" + Math.round(100 * sel.am.I / sel.R) : "— ez da lortu domeinuan"}` +
          (sel.best.T >= sel.Tcap * 0.98 ? "<br>⚠️ IoU gehienezkoa domeinuaren ertzean: emaitza mugatua" : "");
        if (sweepK) calTxt += "<br>K_SLOPE: " + kRuns.map(r => r.K + "→" + r.best.iou.toFixed(2)).join(" · ");
        if (sweepW) {
          const base = wRuns.find(r => r.fromDeg === w0.fromDeg && r.speed === w0.speed);
          calTxt += `<br>Haizea: hasierakoa ${Math.round(w0.fromDeg)}° · ${w0.speed.toFixed(1)} km/h → IoU ${base ? base.best.iou.toFixed(2) : "—"}` +
            `<br>Top-3: ` + wRuns.slice().sort((a, b) => b.best.iou - a.best.iou).slice(0, 3)
              .map(r => `${Math.round(r.fromDeg)}°/${r.speed.toFixed(1)} → ${r.best.iou.toFixed(2)}`).join(" · ");
        }
        calTxt += `<br>Hautatua: K_SLOPE = ${sel.K} · haizea ${Math.round(sel.fromDeg)}° · ${sel.speed.toFixed(1)} km/h`;
        const r0imp = sel.best.T / Tmin;
        if (fuelOn) calTxt += `<br>Erregai-moduan «Iraupena» = ${Math.round(Tmin)} min jarri duzu; eredu fisikoak <strong>${Math.round(sel.best.T)} min</strong> behar ditu IoU onenerako (×${r0imp.toFixed(1)}). ×1 inguruan bada, denbora eta abiadura koherenteak dira.`;
        else calTxt += `<br>Hedapen aktiboa ${Math.round(Tmin)} min bada → R0 ≈ <strong>${r0imp.toFixed(1)} m/min</strong>` +
          (r0imp > 30 || r0imp < 0.3 ? " ⚠️ fisikoki ez dirudi («Iraupena» = hedapen aktiboaren denbora, ez itzaltzeraino)" : "");
      } else {
        const F = fuelOn ? makeRothermelFields(elev, W, H, dom.res, wind, moisture, codes, fuels, EN) : buildFields(elev, W, H, dom.res, wind, R0);
        const m = mtt(W, H, F, src, Tmin, dom.res);
        t = m.t; visited = m.visited;
        if (fuelOn) { F.ensure(src); if (!(F.Rh[src] > 0)) warnTxt = "<br>⚠️ Abiapuntuan ez dago hedapenik: erregairik gabeko erabilera edo hezetasuna ≥ itzaltze-hezetasuna."; }
      }

      // ---- marrazketa ----
      let bx0 = W, by0 = H, bx1 = 0, by1 = 0, maxD = 0;
      for (let i = 0; i < t.length; i++) if (t[i] <= Tshow) {
        const x = i % W, y = (i / W) | 0;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        const d = Math.hypot(x - dom.Rpx, y - dom.Rpx) * dom.res; if (d > maxD) maxD = d;
      }
      const box = { x0: bx0 - 2, y0: by0 - 2, x1: bx1 + 1, y1: by1 + 1 };
      layer = layer || L.featureGroup().addTo(map);
      const levels = [0.25, 0.5, 0.75, 1].map(f => f * Tshow);
      const colors = ["#ffd54a", "#ffa726", "#f4511e", "#b71c1c"];
      const toLL = (p) => { const g = globalPxToLonLat(gx0 + p[0] + 0.5, gy0 + p[1] + 0.5, dom.z); return [g[1], g[0]]; };
      let finalRing = null, areaHa = 0, perimKm = 0;
      levels.forEach((lv, idx) => {
        const loops = contourLoops(t, W, H, lv, box).filter(l => l.pts.length > 3);
        loops.forEach(l => {
          const ll2 = l.pts.map(toLL);
          if (idx === levels.length - 1) {
            L.polygon(ll2, { color: colors[idx], weight: 3, fillColor: "#e53935", fillOpacity: 0.12, interactive: false }).addTo(layer);
          } else {
            L.polyline(ll2, { color: colors[idx], weight: 2, opacity: 0.95, interactive: false }).addTo(layer);
          }
        });
        if (idx === levels.length - 1 && loops.length) {
          const best = loops.reduce((a, b) => polygonAreaPx(a.pts) >= polygonAreaPx(b.pts) ? a : b);
          finalRing = best.pts.map(p => { const g = globalPxToLonLat(gx0 + p[0] + 0.5, gy0 + p[1] + 0.5, dom.z); return [g[0], g[1]]; });
          if (finalRing.length && (finalRing[0][0] !== finalRing[finalRing.length - 1][0] || finalRing[0][1] !== finalRing[finalRing.length - 1][1])) finalRing.push(finalRing[0].slice());
          if (window.turf) {
            try { const poly = turf.polygon([finalRing]); areaHa = turf.area(poly) / 1e4; perimKm = turf.length(turf.polygonToLine(poly), { units: "kilometers" }); } catch (_) {}
          }
        }
      });
      let fuelTxt = "";
      if (fuelOn) {
        const cnt = new Map(); let tot = 0;
        for (let i = 0; i < t.length; i++) if (t[i] <= Tshow) { const c = codes[i]; cnt.set(c, (cnt.get(c) || 0) + 1); tot++; }
        const parts = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => fuelKeys[c] + " %" + Math.round(100 * n / Math.max(1, tot)));
        const stalled = fuelKeys.map((k, c) => ({ k, f: fuels[c] })).filter(o => o.k !== "nb" && o.f && o.f.Mx > 0 && moisture >= o.f.Mx * 100).map(o => o.k);
        fuelTxt = `<br>Erregaiak (erretako eremuan): ${parts.join(" · ") || "—"} · hezetasuna %${moisture}` +
          (stalled.length ? `<br>⚠️ Hezetasuna ≥ itzaltze-hezetasuna: ${stalled.join(", ")} (erregai horietan ez da hedatzen)` : "") +
          `<br><span style="color:#65736b">${fuelInfo}</span>`;
      }
      let ellTxt = "";
      if ($("fmEll").checked) {
        const te = fuelOn ? theoreticalEllipseRothermel(ll.lat, ll.lng, wind, fuels[codes[src]] || fuels[0], moisture, Tshow, EN) : theoreticalEllipse(ll.lat, ll.lng, wind, calib ? 1 : R0, Tshow);
        L.polyline(te.pts.map(p => [p[1], p[0]]), { color: "#1565c0", weight: 2, dashArray: "6 6", interactive: false }).addTo(layer);
        ellTxt = `<br>Elipse teorikoa: aurrealdea ${Math.round(te.head)} m (L/B ${(fuelOn ? te.lb : lbRatio(wind.speed * CFG.MIDFLAME)).toFixed(2)})`;
      }
      lastRing = finalRing;
      $("fmToTrack").disabled = !finalRing;
      const ms = Math.round(performance.now() - t0);
      setMsg(`<strong>${areaHa.toFixed(2)} ha</strong> · perimetroa ${perimKm.toFixed(2)} km · aurrealdea ${Math.round(maxD)} m` +
        (calib ? (fuelOn ? ` (T = ${Math.round(Tshow)} min)` : ` (R0·T = ${Math.round(Tshow)} m)`) : "") + ellTxt + fuelTxt + warnTxt + calTxt +
        `<br><span style="color:#65736b">${visited.toLocaleString()} gelaxka · ${dom.res.toFixed(0)} m · AWS Terrarium z${dom.z} · ${ms} ms` +
        (dom.clipped ? " · ⚠️ eremua mugatu da" : "") + (missing ? " · ⚠️ " + missing + " lauza falta" : "") + "</span>");
      try {
        const bnds = layer.getBounds(); if (refLayer) bnds.extend(refLayer.getBounds());
        map.fitBounds(bnds, { padding: [30, 30], maxZoom: 16 });
      } catch (_) {}
    } catch (err) {
      console.error("fire-mtt:", err);
      setMsg("⚠️ " + (err.message || err));
    } finally { $("fmRun").disabled = false; }
  }

  /* ---- erreferentzia-perimetroa (GeoJSON) ---- */
  function loadReference(geo) {
    const feats = geo.type === "FeatureCollection" ? geo.features : [geo.type === "Feature" ? geo : { geometry: geo, properties: {} }];
    let ring = null, pt = null, pprops = {};
    feats.forEach(f => {
      const g = f.geometry; if (!g) return;
      if (!ring && g.type === "Polygon") ring = g.coordinates[0];
      else if (!ring && g.type === "MultiPolygon") ring = g.coordinates[0][0];
      else if (!pt && g.type === "Point") { pt = g.coordinates; pprops = f.properties || {}; }
    });
    if (!ring) throw new Error("GeoJSON-ak ez dauka poligonorik");
    ref = { ring: ring.map(p => [p[0], p[1]]) };
    if (refLayer) refLayer.clearLayers(); else refLayer = L.featureGroup().addTo(map);
    L.polygon(ref.ring.map(p => [p[1], p[0]]), { color: "#111", weight: 2, dashArray: "2 5", fillColor: "#000", fillOpacity: 0.06, interactive: false }).addTo(refLayer);
    if (pt) {
      placeMarker(L.latLng(pt[1], pt[0]));
      if (isFinite(pprops.wind_from_deg)) $("fmWdir").value = Math.round(pprops.wind_from_deg);
      if (isFinite(pprops.wind_kmh)) $("fmWspd").value = pprops.wind_kmh;
    }
    $("fmCal").disabled = false; $("fmCal").checked = true;
    map.fitBounds(refLayer.getBounds(), { padding: [30, 30] });
    let ha = 0; try { ha = turf.area(turf.polygon([ref.ring])) / 1e4; } catch (_) {}
    setMsg("Erreferentzia kargatuta" + (ha ? ": " + ha.toFixed(1) + " ha" : "") + (pt ? " · hasiera-puntua jarrita" : "") + ". Sakatu «Kalkulatu».");
  }

  function setPick(on) {
    picking = on;
    const b = $("fmPick"); if (b) b.textContent = on ? S.picking : S.pick;
    map.getContainer().style.cursor = on ? "crosshair" : "";
  }
  function placeMarker(latlng) {
    if (!marker) {
      marker = L.marker(latlng, { draggable: true, icon: L.divIcon({ className: "", html: '<div style="font-size:24px;line-height:24px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">🔥</div>', iconSize: [24, 24], iconAnchor: [12, 20] }) }).addTo(map);
      marker.on("dragend", () => clearResult());
    } else marker.setLatLng(latlng);
  }

  function buildPanel() {
    if ($("fmPanel")) return;
    const bar = document.querySelector(".icon-tools");
    const mapEl = $("map");
    if (!bar || !mapEl) return;
    btn = document.createElement("button");
    btn.id = "fireMtt"; btn.type = "button"; btn.title = S.title; btn.innerHTML = "🔥⏱️";
    btn.addEventListener("click", () => togglePanel());
    bar.appendChild(btn);
    const inp = "width:100%;border:1px solid #cfdad3;border-radius:8px;padding:7px;font:inherit";
    const lab = "display:block;font-size:10px;font-weight:800;color:#65736b;margin:7px 0 3px";
    const bt = "flex:1 1 auto;border:0;border-radius:8px;padding:8px 6px;font-size:12px;font-weight:750;cursor:pointer;background:#edf3ef;color:#234233";
    panel = document.createElement("div");
    panel.id = "fmPanel";
    panel.style.cssText = "position:absolute;left:8px;top:70px;z-index:1200;width:min(300px,86vw);max-height:calc(100% - 90px);overflow:auto;background:#fff;border:1px solid #dce5df;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);padding:12px;display:none;font:13px system-ui;color:#16231c";
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<strong style="font-size:14px;color:#176b43">' + S.title + '</strong>' +
      '<button type="button" id="fmClose" style="border:0;background:#eef3ef;border-radius:7px;padding:4px 8px;cursor:pointer;font-weight:800">✕</button></div>' +
      '<button type="button" id="fmPick" style="' + bt + ';width:100%">' + S.pick + '</button>' +
      '<label style="' + lab + '">' + S.windFrom + ' · ' + S.windSpeed + '</label>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px">' +
      '<input id="fmWdir" type="number" min="0" max="360" step="5" value="180" style="' + inp + '">' +
      '<input id="fmWspd" type="number" min="0" step="1" value="10" style="' + inp + '">' +
      '<button type="button" id="fmAuto" style="' + bt + '">' + S.auto + '</button></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
      '<div><label style="' + lab + '">' + S.dur + '</label><input id="fmDur" type="number" min="1" step="10" value="60" style="' + inp + '"></div>' +
      '<div><label style="' + lab + '">' + S.r0 + '</label><input id="fmR0" type="number" min="0.1" step="0.5" value="2" style="' + inp + '"></div></div>' +
      '<label style="display:flex;gap:6px;align-items:center;margin:9px 0 0;font-size:12px;font-weight:700"><input id="fmFuelOn" type="checkbox" checked> ' + S.fuelOn + '</label>' +
      '<div id="fmFuelRow" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
      '<div><label style="' + lab + '">' + S.moist + '</label><input id="fmMoist" type="number" min="1" max="40" step="0.5" value="8" style="' + inp + '"></div>' +
      '<div><label style="' + lab + '">' + S.fb + '</label><select id="fmFb" style="' + inp + '">' + ["fm1","fm2","fm3","fm5","fm6","fm8","fm9"].map(k => '<option value="' + k + '"' + (k === "fm5" ? " selected" : "") + '>' + k + '</option>').join("") + '</select></div></div>' +
      '<details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;font-weight:800;color:#65736b">' + S.adv + '</summary>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
      '<div><label style="' + lab + '">K_SLOPE (km/h · tanφ)</label><input id="fmKs" type="number" min="0" step="1" value="20" style="' + inp + '"></div>' +
      '<div><label style="' + lab + '">KW (1/(km/h))</label><input id="fmKw" type="number" min="0" step="0.01" value="0.12" style="' + inp + '"></div>' +
      '<div><label style="' + lab + '">Rmin / R0 (0–1)</label><input id="fmRmin" type="number" min="0" max="1" step="0.05" value="0.2" style="' + inp + '"></div></div></details>' +
      '<label style="display:flex;gap:6px;align-items:center;margin:9px 0 0;font-size:12px"><input id="fmEll" type="checkbox"> ' + S.ell + '</label>' +
      '<div style="display:flex;gap:6px;margin-top:9px;align-items:center">' +
      '<button type="button" id="fmRef" style="' + bt + '">' + S.ref + '</button>' +
      '<input id="fmRefFile" type="file" accept=".geojson,.json,application/json" style="display:none"></div>' +
      '<label style="display:flex;gap:6px;align-items:center;margin:7px 0 0;font-size:12px"><input id="fmCal" type="checkbox" disabled> ' + S.cal + '</label>' +
      '<label style="display:flex;gap:6px;align-items:center;margin:5px 0 0;font-size:12px"><input id="fmSweep" type="checkbox" checked> ' + S.sweep + '</label>' +
      '<label style="display:flex;gap:6px;align-items:center;margin:5px 0 0;font-size:12px"><input id="fmSweepW" type="checkbox"> ' + S.sweepW + '</label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">' +
      '<button type="button" id="fmRun" style="' + bt + ';background:#176b43;color:#fff">' + S.calc + '</button>' +
      '<button type="button" id="fmClear" style="' + bt + '">' + S.clear + '</button>' +
      '<button type="button" id="fmToTrack" disabled style="' + bt + ';flex-basis:100%">' + S.toTrack + '</button></div>' +
      '<div id="fmMsg" style="margin-top:9px;padding:8px;border-radius:8px;background:#f7faf8;border:1px solid #e2e8e4;font-size:12px;overflow-wrap:anywhere">—</div>' +
      '<div style="margin-top:7px;font-size:10.5px;color:#65736b">' + S.note + '<br>' + S.noteFuel + '</div>';
    mapEl.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel);
    L.DomEvent.disableScrollPropagation(panel);
    $("fmClose").onclick = () => togglePanel(false);
    $("fmPick").onclick = () => setPick(!picking);
    $("fmRun").onclick = run;
    $("fmClear").onclick = () => { clearResult(); if (marker) { map.removeLayer(marker); marker = null; } if (refLayer) { map.removeLayer(refLayer); refLayer = null; } ref = null; $("fmCal").checked = false; $("fmCal").disabled = true; setMsg("—"); };
    $("fmAuto").onclick = async () => {
      const c = marker ? marker.getLatLng() : map.getCenter();
      setMsg("Open-Meteo…");
      try {
        const w = await fetchWind(c.lat, c.lng); $("fmWdir").value = Math.round(w.fromDeg); $("fmWspd").value = Math.round(w.speed);
        let extra = "";
        if (isFinite(w.T) && isFinite(w.RH)) { const mo = fineFuelMoisture(w.T, w.RH); $("fmMoist").value = (Math.round(mo * 10) / 10); extra = " · " + Math.round(w.T) + " °C, HR %" + Math.round(w.RH) + " → erregai fin hila ≈ %" + (Math.round(mo * 10) / 10) + " (euri-historiarik gabe)"; }
        setMsg("💨 " + Math.round(w.fromDeg) + "° · " + Math.round(w.speed) + " km/h (Open-Meteo)" + extra);
      }
      catch (e) { setMsg("⚠️ " + e.message); }
    };
    const syncFuelUI = () => {
      const on = $("fmFuelOn").checked;
      ["fmR0", "fmKs", "fmKw", "fmSweep"].forEach(id => { const el = $(id); if (el) el.disabled = on; });
      $("fmFuelRow").style.opacity = on ? "1" : "0.45";
      ["fmMoist", "fmFb"].forEach(id => { $(id).disabled = !on; });
    };
    $("fmFuelOn").onchange = syncFuelUI; syncFuelUI();
    $("fmRef").onclick = () => $("fmRefFile").click();
    $("fmRefFile").onchange = (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { try { loadReference(JSON.parse(rd.result)); } catch (err) { setMsg("⚠️ " + err.message); } };
      rd.readAsText(f); e.target.value = "";
    };
    $("fmToTrack").onclick = () => {
      if (!lastRing) return;
      const rings = [lastRing.map(p => p.slice())];
      if (window.setCurrentRings) window.setCurrentRings(rings);
      if (window.redrawRings) window.redrawRings(rings);
      if (window.recalcFromRings) window.recalcFromRings(rings);
      setMsg("Perimetroa trackera pasatu da (GPX/SHP/PDF esportatu daiteke).");
    };
    map.on("click", (e) => { if (picking) { placeMarker(e.latlng); setPick(false); clearResult(); } });
  }

  function togglePanel(open) {
    if (!panel) return;
    const show = typeof open === "boolean" ? open : panel.style.display === "none";
    panel.style.display = show ? "block" : "none";
    if (btn) btn.classList.toggle("active", show);
    if (!show) setPick(false);
  }

  function waitFor() {
    return new Promise(resolve => {
      const iv = setInterval(() => {
        if (window.IrratiGISMap && typeof L !== "undefined" && document.querySelector(".icon-tools") && document.getElementById("map")) { clearInterval(iv); resolve(); }
      }, 200);
    });
  }
  async function init() {
    if (window.IRRATI_MTT_LEGACY !== true) { console.log("IrratiGIS fire-mtt listo (v9): biblioteka; panel propioa desaktibatuta (MTT «Suteen bilakaera» panelean)."); return; }
    await waitFor(); map = window.IrratiGISMap; buildPanel(); console.log("IrratiGIS fire-mtt listo (v9, panel zaharra).");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
