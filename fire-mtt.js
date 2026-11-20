/* ============================================================
   IrratiGIS · fire-mtt.js  (v1)
   Sute-hedapena: Minimum Travel Time (MTT, Finney 2002 estiloa).
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
    NB_RADIUS: 3          // auzokideen erradioa (3 → 32 norabide, 2 → 16)
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
    return { Rh, Ec, Hx, Hy };
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
      const Rhi = Rh[i], Ei = Ec[i], hxi = Hx[i], hyi = Hy[i];
      for (let q = 0; q < NBN; q++) {
        const nb = NB[q];
        const nx = x + nb.ox, ny = y + nb.oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (done[j]) continue;
        const ci = nb.ux * hxi + nb.uy * hyi;
        const cj = nb.ux * Hx[j] + nb.uy * Hy[j];
        const ri = rateAt(Rhi, Ei, ci), rj = rateAt(Rh[j], Ec[j], cj);
        const dist = nb.d * res;
        const nt = k + 0.5 * dist * (1 / ri + 1 / rj);
        if (nt < t[j]) { t[j] = nt; push(nt, j); }
      }
    }
    return { t, done, visited };
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
  function chooseDomain(lat, Tmin, R0, windSpeed) {
    const Uf = windSpeed * CFG.MIDFLAME;
    const Ubound = Uf + CFG.K_SLOPE * CFG.TAN_MAX;
    const Rbound = R0 * (1 + CFG.KW * Ubound);
    let Rdom = Math.min(CFG.MAX_RADIUS_M, Math.max(300, 1.1 * Rbound * Tmin));
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

  const core = { CFG, buildNeighbors, setNeighbors: (r) => { NB = buildNeighbors(r); }, lbRatio, eccentricity, rateAt, buildFields, mtt, contourLoops, polygonAreaPx,
                 chooseDomain, theoreticalEllipse, lonLatToGlobalPx, globalPxToLonLat, groundRes };
  if (typeof module !== "undefined" && module.exports) { module.exports = core; }
  if (typeof window === "undefined") return;
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
    wait: "Kalkulatzen…", demLoading: "Lur-eredua kargatzen…"
  };

  let map = null, panel = null, btn = null, marker = null, picking = false;
  let layer = null, lastRing = null;

  function $(id) { return document.getElementById(id); }
  function setMsg(t) { const m = $("fmMsg"); if (m) m.innerHTML = t; }

  async function fetchWind(lat, lon) {
    const u = "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
      latitude: lat.toFixed(4), longitude: lon.toFixed(4),
      current: "wind_speed_10m,wind_direction_10m", wind_speed_unit: "kmh", timezone: "auto"
    });
    const r = await fetch(u); if (!r.ok) throw new Error("Open-Meteo " + r.status);
    const j = await r.json(); const c = j.current;
    if (!c) throw new Error("Open-Meteo: datu gabe");
    return { fromDeg: Number(c.wind_direction_10m), speed: Number(c.wind_speed_10m) };
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

  function clearResult() {
    if (layer) { layer.clearLayers(); }
    lastRing = null;
    const b = $("fmToTrack"); if (b) b.disabled = true;
  }

  async function run() {
    if (!marker) { setMsg(S.needPoint); return; }
    const ll = marker.getLatLng();
    const wind = { fromDeg: ((Number($("fmWdir").value) % 360) + 360) % 360, speed: Math.max(0, Number($("fmWspd").value) || 0) };
    const Tmin = Math.max(1, Number($("fmDur").value) || 60);
    const R0 = Math.max(0.05, Number($("fmR0").value) || 2);
    clearResult();
    $("fmRun").disabled = true; setMsg(S.demLoading);
    try {
      const dom = chooseDomain(ll.lat, Tmin, R0, wind.speed);
      const [gxS, gyS] = lonLatToGlobalPx(ll.lng, ll.lat, dom.z);
      const sx = Math.round(gxS), sy = Math.round(gyS);
      const W = 2 * dom.Rpx + 1, H = W;
      const gx0 = sx - dom.Rpx, gy0 = sy - dom.Rpx;
      const { elev, missing } = await loadDEM(dom.z, gx0, gy0, W, H);
      setMsg(S.wait);
      await new Promise(r => setTimeout(r, 30));
      const t0 = performance.now();
      const F = buildFields(elev, W, H, dom.res, wind, R0);
      const src = dom.Rpx * W + dom.Rpx;
      const { t, done, visited } = mtt(W, H, F, src, Tmin, dom.res);
      // bbox bisitatuena
      let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
      for (let i = 0; i < done.length; i++) if (done[i]) {
        const x = i % W, y = (i / W) | 0;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
      const box = { x0: bx0 - 2, y0: by0 - 2, x1: bx1 + 1, y1: by1 + 1 };
      layer = layer || L.featureGroup().addTo(map);
      const levels = [0.25, 0.5, 0.75, 1].map(f => f * Tmin);
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
      // elipse teorikoa
      let ellTxt = "";
      if ($("fmEll").checked) {
        const te = theoreticalEllipse(ll.lat, ll.lng, wind, R0, Tmin);
        L.polyline(te.pts.map(p => [p[1], p[0]]), { color: "#1565c0", weight: 2, dashArray: "6 6", interactive: false }).addTo(layer);
        ellTxt = `<br>Elipse teorikoa: aurrealdea ${Math.round(te.head)} m (L/B ${lbRatio(wind.speed * CFG.MIDFLAME).toFixed(2)})`;
      }
      // aurrealdeko distantzia (MTT): ignizioarekiko urrunena
      let maxD = 0;
      for (let i = 0; i < done.length; i++) if (done[i]) {
        const x = i % W, y = (i / W) | 0;
        const d = Math.hypot(x - dom.Rpx, y - dom.Rpx) * dom.res; if (d > maxD) maxD = d;
      }
      lastRing = finalRing;
      $("fmToTrack").disabled = !finalRing;
      const ms = Math.round(performance.now() - t0);
      setMsg(`<strong>${areaHa.toFixed(2)} ha</strong> · perimetroa ${perimKm.toFixed(2)} km · aurrealdea ${Math.round(maxD)} m` +
        ellTxt + `<br><span style="color:#65736b">${visited.toLocaleString()} gelaxka · ${dom.res.toFixed(0)} m · ${ms} ms` +
        (dom.clipped ? " · ⚠️ eremua mugatu da" : "") + (missing ? " · ⚠️ " + missing + " lauza falta" : "") + "</span>");
      try { map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 16 }); } catch (_) {}
    } catch (err) {
      console.error("fire-mtt:", err);
      setMsg("⚠️ " + (err.message || err));
    } finally { $("fmRun").disabled = false; }
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
      '<label style="display:flex;gap:6px;align-items:center;margin:9px 0 0;font-size:12px"><input id="fmEll" type="checkbox"> ' + S.ell + '</label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">' +
      '<button type="button" id="fmRun" style="' + bt + ';background:#176b43;color:#fff">' + S.calc + '</button>' +
      '<button type="button" id="fmClear" style="' + bt + '">' + S.clear + '</button>' +
      '<button type="button" id="fmToTrack" disabled style="' + bt + ';flex-basis:100%">' + S.toTrack + '</button></div>' +
      '<div id="fmMsg" style="margin-top:9px;padding:8px;border-radius:8px;background:#f7faf8;border:1px solid #e2e8e4;font-size:12px;overflow-wrap:anywhere">—</div>' +
      '<div style="margin-top:7px;font-size:10.5px;color:#65736b">' + S.note + '</div>';
    mapEl.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel);
    L.DomEvent.disableScrollPropagation(panel);
    $("fmClose").onclick = () => togglePanel(false);
    $("fmPick").onclick = () => setPick(!picking);
    $("fmRun").onclick = run;
    $("fmClear").onclick = () => { clearResult(); if (marker) { map.removeLayer(marker); marker = null; } setMsg("—"); };
    $("fmAuto").onclick = async () => {
      const c = marker ? marker.getLatLng() : map.getCenter();
      setMsg("Open-Meteo…");
      try { const w = await fetchWind(c.lat, c.lng); $("fmWdir").value = Math.round(w.fromDeg); $("fmWspd").value = Math.round(w.speed); setMsg("💨 " + Math.round(w.fromDeg) + "° · " + Math.round(w.speed) + " km/h (Open-Meteo)"); }
      catch (e) { setMsg("⚠️ " + e.message); }
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
  async function init() { await waitFor(); map = window.IrratiGISMap; buildPanel(); console.log("IrratiGIS fire-mtt listo (v1)."); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
