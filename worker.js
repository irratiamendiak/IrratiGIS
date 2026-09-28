var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var ALLOWED_ORIGIN = "https://irratiamendiak.github.io";
var TOKEN_TTL_SECONDS = 60 * 60 * 12;
var GFA_BASE_URL = "https://w390w.gipuzkoa.net/WAS/CORP/DMQQuemasWEB";
var GFA_TIME_ZONE = "Europe/Madrid";
var FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov";
function corsHeaders(origin = "") {
  return { "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, security-token, security-user-id", "Vary": "Origin" };
}
__name(corsHeaders, "corsHeaders");
function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin) } });
}
__name(json, "json");
function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(b64, "b64");
function unb64(s) {
  let p = s.replace(/-/g, "+").replace(/_/g, "/");
  while (p.length % 4) p += "=";
  const bin = atob(p);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
__name(unb64, "unb64");
async function key(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
__name(key, "key");
async function createToken(user, secret) {
  const part = b64(new TextEncoder().encode(JSON.stringify({ sub: user, exp: Math.floor(Date.now() / 1e3) + TOKEN_TTL_SECONDS })));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(part));
  return `${part}.${b64(new Uint8Array(sig))}`;
}
__name(createToken, "createToken");
async function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const p = token.split(".");
  if (p.length !== 2) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), unb64(p[1]), new TextEncoder().encode(p[0]));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(unb64(p[0])));
    return payload.sub && payload.exp > Math.floor(Date.now() / 1e3) ? payload : null;
  } catch (_) {
    return null;
  }
}
__name(verifyToken, "verifyToken");
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
__name(n, "n");
function utmToLonLat(x, y, zone) {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9996;
  const xa = x - 5e5, M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * Math.pow(e2, 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) + 151 * Math.pow(e1, 3) / 96 * Math.sin(6 * mu);
  const s = Math.sin(phi1), c = Math.cos(phi1), t = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * s * s), R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5);
  const C1 = ep2 * c * c, T1 = t * t, D = xa / (N1 * k0);
  const lat = phi1 - N1 * t / R1 * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);
  const lon0 = (zone * 6 - 183) * Math.PI / 180;
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / c;
  return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}
__name(utmToLonLat, "utmToLonLat");
function landcoverGroup(text) {
  if (!text) return { group: "desconocido", clase: null };
  const t = text.toLowerCase();
  const has = (...ws) => ws.some((w) => t.includes(w));
  if (has("sector secundario", "industrial", "industria")) return { group: "industrial", clase: "industrial" };
  if (has("minas y canteras", "cantera", "mina", "extracc")) return { group: "cantera", clase: "minas y canteras" };
  if (has("uso residencial", "residencial", "tejido urbano", "urbano", "edificaci")) return { group: "urbano", clase: "urbano/residencial" };
  if (has("servicios comerciales", "comercial", "log\u00edst", "redes de transporte", "transporte", "utilidades", "servicios")) return { group: "urbano", clase: "servicios/infraestructura" };
  if (has("forestal", "bosque", "arbolado", "matorral", "monte", "con\u00edfera", "frondosa")) return { group: "forestal", clase: "forestal" };
  if (has("agricultura", "agr\u00edcola", "cultivo", "labor", "pastizal", "prado", "pasto", "herb\u00e1c", "vi\u00f1ed", "frutal", "olivar")) return { group: "agricola", clase: "agr\u00edcola/pasto" };
  if (has("vegetaci", "natural", "sin uso econ\u00f3mico", "zonas terrestres")) return { group: "vegetacion", clase: "vegetaci\u00f3n/natural" };
  return { group: "desconocido", clase: null };
}
__name(landcoverGroup, "landcoverGroup");
function utm30Xy(lat, lon) {
  const a = 6378137, e = 0.0818191908426, k = 0.9996, r = Math.PI / 180, p = lat * r, l = lon * r, l0 = -3 * r;
  const ep = e * e / (1 - e * e), N = a / Math.sqrt(1 - e * e * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep * Math.cos(p) ** 2, A = Math.cos(p) * (l - l0);
  const M = a * ((1 - e * e / 4 - 3 * e ** 4 / 64 - 5 * e ** 6 / 256) * p - (3 * e * e / 8 + 3 * e ** 4 / 32 + 45 * e ** 6 / 1024) * Math.sin(2 * p) + (15 * e ** 4 / 256 + 45 * e ** 6 / 1024) * Math.sin(4 * p) - (35 * e ** 6 / 3072) * Math.sin(6 * p));
  const x = k * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep) * A ** 5 / 120) + 5e5;
  const y = k * (M + N * Math.tan(p) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep) * A ** 6 / 720));
  return [x, y];
}
__name(utm30Xy, "utm30Xy");
function parcelKind(ref) {
  const r = String(ref || "").replace(/\s/g, "").toUpperCase();
  if (!r) return null;
  if (/^\d{5}[A-Z]/.test(r)) return "rustica";
  if (/^\d{7}/.test(r)) return "urbana";
  return null;
}
__name(parcelKind, "parcelKind");
function localParts(date = /* @__PURE__ */ new Date()) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: GFA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date), o = {};
  for (const x of p) if (["year", "month", "day"].includes(x.type)) o[x.type] = x.value;
  return o;
}
__name(localParts, "localParts");
function dateKey(date = /* @__PURE__ */ new Date()) {
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
__name(dateKey, "dateKey");
function shiftDateKey(k, days) {
  const [y, m, d] = k.split("-").map(Number), x = new Date(Date.UTC(y, m - 1, d + days));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}
__name(shiftDateKey, "shiftDateKey");
function dayStart(k) {
  return `${k} 00:00:00`;
}
__name(dayStart, "dayStart");
function dayEnd(k) {
  return `${k} 23:59:59`;
}
__name(dayEnd, "dayEnd");
function extractDate(v) {
  if (!v) return null;
  if (typeof v === "string") return new Date(v.replace(" ", "T")).getTime();
  if (typeof v === "number") return v;
  return null;
}
__name(extractDate, "extractDate");
function mapQuema(item) {
  const s = item?.solicitud || {}, d = item?.datosQuema || {}, c = s.ciudadano || item?.ciudadano || {}, m = d.materialQuema || {}, mot = d.motivo || {}, municipio = s.municipio || item?.municipio || null, lat = n(s.latitud ?? item?.latitud ?? item?.latitude ?? item?.latitudea ?? item?.lat), lon = n(s.longitud ?? item?.longitud ?? item?.longitude ?? item?.longitudea ?? item?.lon), nombre = c.nombre || s.nombreCiudadano || d.nombreCiudadano || "", apellidos = c.apellidos || c.apellido1 || c.apellido || s.apellidosCiudadano || d.apellidosCiudadano || "", titular = [nombre, apellidos].filter(Boolean).join(" ").trim(), telefonoPermiso = s.telefono ?? c.telefono ?? c.telefonoMovil ?? c.telefonoFijo ?? d.telefonoPermiso ?? null, telefonoQuema = d.telefonoQuema ?? d.telefonoMovil ?? d.telefonoFijo ?? null, numeroAutorizacion = d.numeroAutorizacion ?? item?.numeroAutorizacion ?? s.codigo ?? null, tipoQuema = m.descripcion || d.tipoQuema || null, estado = s.estado?.codigo ?? item?.estado?.codigo ?? item?.estado ?? null;
  let lonDeg = lon, latDeg = lat;
  if (lat != null && lon != null && Math.abs(lat) > 90) {
    const ll = utmToLonLat(lon, lat, 30);
    lonDeg = ll[0];
    latDeg = ll[1];
  }
  return { id: s.codigo ?? item?.codigo ?? null, anyo: s.anyo ?? item?.anyo ?? null, codigoTipo: s.tipo?.codigo ?? item?.tipo?.codigo ?? item?.codigoTipo ?? null, numeroAutorizacion, baimena: numeroAutorizacion, titular, nombre: nombre || null, apellidos: apellidos || null, telefono: telefonoQuema || telefonoPermiso || null, telefonoPermiso, telefonoQuema, telefonoMovil: d.telefonoMovil || null, telefonoFijo: d.telefonoFijo || null, latitud: latDeg, longitud: lonDeg, latitudea: latDeg, longitudea: lonDeg, direccion: s.direccion ?? item?.direccion ?? null, municipio, udalerria: municipio, tipoQuema, descripcionMaterial: tipoQuema, codigoMaterial: m.codigo || null, motivo: mot.descripcion || null, fechaInicio: s.fechaInicio ?? item?.fechaInicio ?? null, fechaFin: s.fechaFin ?? item?.fechaFin ?? null, fechaAutorizacion: d.autorizar?.fecha ?? d.fechaAutorizacion ?? null, estado, egoera: estado, superficie: d.superficie ?? null, codigoSigpac: d.codigoSigpac ?? null, accesos: d.accesos ?? null, parcela: { nombreParcela: d.descripcionRecinto ?? null, provincia: s.provincia ?? null, municipio, poligono: s.poligono ?? null, parcela: s.parcela ?? null, recinto: s.recinto ?? null } };
}
__name(mapQuema, "mapQuema");
async function requestGfaList(user, query) {
  const r = await fetch(`${GFA_BASE_URL}/quema/lista/completo/es`, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "security-token": user.token, "security-user-id": String(user.id) }, body: JSON.stringify(query) }), text = await r.text();
  console.log("GFA LIST HTTP:", r.status, "recordsText:", text.slice(0, 500));
  if (!r.ok) throw new Error(`Consulta de quemas GFA HTTP ${r.status}: ${text.slice(0, 500)}`);
  try {
    const raw = JSON.parse(text);
    return Array.isArray(raw) ? raw : [];
  } catch (_) {
    throw new Error(`GFA no devuelve JSON v\xE1lido: ${text.slice(0, 500)}`);
  }
}
__name(requestGfaList, "requestGfaList");
async function requestGfaDetail(user, item) {
  const s = item?.solicitud || {}, anyo = s.anyo ?? item?.anyo, codigo = s.codigo ?? item?.codigo, tipo = s.tipo?.codigo ?? item?.tipo?.codigo ?? item?.codigoTipo;
  if (anyo == null || codigo == null || tipo == null) return item;
  const r = await fetch(`${GFA_BASE_URL}/solicitud/${encodeURIComponent(anyo)}/${encodeURIComponent(codigo)}/${encodeURIComponent(tipo)}/es`, { headers: { "Accept": "application/json", "security-token": user.token, "security-user-id": String(user.id) } }), text = await r.text();
  if (!r.ok) throw new Error(`Detalle quema ${codigo} HTTP ${r.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) || item;
  } catch (_) {
    return item;
  }
}
__name(requestGfaDetail, "requestGfaDetail");
async function getActiveBurns(env, targetDate = dateKey()) {
  const user = String(env.GFA_USER || "").trim(), password = String(env.GFA_PASSWORD || "");
  if (!user || !password) throw new Error("Credenciales GFA no configuradas");
  const login = await fetch(`${GFA_BASE_URL}/login/es`, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ user, password }) });
  if (!login.ok) {
    const text = await login.text();
    throw new Error(`Login GFA HTTP ${login.status}: ${text.slice(0, 300)}`);
  }
  const authorizedUser = await login.json();
  if (!authorizedUser?.token || authorizedUser?.id == null) throw new Error("Respuesta de login GFA sin token o id");
  const municipalityIds = Array.isArray(authorizedUser.municipios) ? authorizedUser.municipios.map((m) => typeof m === "object" ? m.id : m).filter((v) => v != null) : [], baseQuery = { dni: null, idsEstado: ["a", "q"], poligono: null, parcela: null, recinto: null, anyo: null, codigo: null, fechaIncio: dayStart(targetDate), fechaFin: dayEnd(targetDate), tipoSolicitud: "Q", nombreCiudadano: null, transferidaPastos: null, transferidaMontesUtilidadPublica: null, transferidaEspaciosNaturales: null, nombreParcela: null, idsMunicipio: municipalityIds, numAut: null, idGuardaForestal: null };
  let list = await requestGfaList(authorizedUser, baseQuery), queryUsed = "estado+municipio+tipo";
  if (!list.length) {
    const q2 = { ...baseQuery, idsEstado: null };
    list = await requestGfaList(authorizedUser, q2);
    queryUsed = "sin filtro estado";
  }
  if (!list.length && municipalityIds.length) {
    const q3 = { ...baseQuery, idsEstado: null, idsMunicipio: null };
    list = await requestGfaList(authorizedUser, q3);
    queryUsed = "sin filtro estado/municipio";
  }
  if (!list.length) {
    const q4 = { ...baseQuery, idsEstado: null, idsMunicipio: null, tipoSolicitud: null };
    list = await requestGfaList(authorizedUser, q4);
    queryUsed = "sin filtro estado/municipio/tipo";
  }
  const details = await Promise.allSettled(list.map((item) => requestGfaDetail(authorizedUser, item))), targetStart = extractDate(dayStart(targetDate)), targetEnd = extractDate(dayEnd(targetDate)), result = [];
  details.forEach((r, i) => {
    const item = r.status === "fulfilled" ? r.value : list[i], q = mapQuema(item), inicio = extractDate(q.fechaInicio), fin = extractDate(q.fechaFin);
    if ((inicio == null || inicio <= targetEnd) && (fin == null || fin >= targetStart) && q.latitud != null && q.longitud != null && String(q.estado).toLowerCase() === "q") result.push(q);
  });
  console.log("GFA QUEMAS DEL D\xCDA CON COORDENADAS:", targetDate, result.length, "de", list.length, "consulta:", queryUsed);
  return result;
}
__name(getActiveBurns, "getActiveBurns");
async function saveBurnSnapshot(env, fires, observedDate = dateKey()) {
  if (!env.DB) {
    console.warn("D1 no configurada; no se guarda hist\xF3rico");
    return { saved: false, reason: "D1 no configurada" };
  }
  const observedAt = (/* @__PURE__ */ new Date()).toISOString(), statements = fires.map((f) => {
    const burnKey = `${f.anyo ?? ""}:${f.id ?? ""}:${f.codigoTipo ?? ""}`;
    return env.DB.prepare(`INSERT INTO burn_observations (observed_date,observed_at,burn_key,anyo,codigo,codigo_tipo,numero_autorizacion,titular,municipio,fecha_inicio,fecha_fin,estado,latitud,longitud,tipo_quema,superficie,codigo_sigpac,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(observed_date,burn_key) DO UPDATE SET observed_at=excluded.observed_at,numero_autorizacion=excluded.numero_autorizacion,titular=excluded.titular,municipio=excluded.municipio,fecha_inicio=excluded.fecha_inicio,fecha_fin=excluded.fecha_fin,estado=excluded.estado,latitud=excluded.latitud,longitud=excluded.longitud,tipo_quema=excluded.tipo_quema,superficie=excluded.superficie,codigo_sigpac=excluded.codigo_sigpac,payload_json=excluded.payload_json`).bind(observedDate, observedAt, burnKey, f.anyo ?? null, f.id ?? null, f.codigoTipo ?? null, f.numeroAutorizacion ?? null, f.titular ?? null, f.municipio ?? null, f.fechaInicio ?? null, f.fechaFin ?? null, f.estado ?? null, f.latitud ?? null, f.longitud ?? null, f.tipoQuema ?? null, f.superficie ?? null, f.codigoSigpac ?? null, JSON.stringify(f));
  });
  if (statements.length) await env.DB.batch(statements);
  await env.DB.prepare(`INSERT INTO burn_daily_runs (observed_date,observed_at,burn_count) VALUES (?,?,?) ON CONFLICT(observed_date) DO UPDATE SET observed_at=excluded.observed_at,burn_count=excluded.burn_count`).bind(observedDate, observedAt, fires.length).run();
  return { saved: true, date: observedDate, count: fires.length };
}
__name(saveBurnSnapshot, "saveBurnSnapshot");
function parseCsvLine(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
__name(parseCsvLine, "parseCsvLine");
async function getFirms(env, days = 1) {
  const key2 = String(env.FIRMS_MAP_KEY || "").trim();
  if (!key2) throw new Error("FIRMS_MAP_KEY no configurada");
  const d = Math.min(5, Math.max(1, Number(days) || 1)), url = `${FIRMS_BASE_URL}/api/area/csv/${encodeURIComponent(key2)}/VIIRS_SNPP_NRT/-4,41.9,-1,44.2/${d}`, r = await fetch(url, { headers: { Accept: "text/csv" }, cf: { cacheTtl: 60, cacheEverything: true } }), text = await r.text();
  if (!r.ok) throw new Error(`NASA FIRMS HTTP ${r.status}: ${text.slice(0, 300)}`);
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines.shift()).map((x) => x.trim().toLowerCase()), latIndex = headers.indexOf("latitude"), lonIndex = headers.indexOf("longitude");
  if (latIndex < 0 || lonIndex < 0) throw new Error("Respuesta NASA FIRMS sin coordenadas");
  return lines.map((line) => {
    const v = parseCsvLine(line), o = {};
    headers.forEach((h, i) => o[h] = v[i] ?? "");
    return { latitude: n(o.latitude), longitude: n(o.longitude), brightness: n(o.bright_ti4), scan: n(o.scan), track: n(o.track), acqDate: o.acq_date || null, acqTime: o.acq_time || null, satellite: o.satellite || null, instrument: o.instrument || null, confidence: o.confidence || null, frp: n(o.frp), daynight: o.daynight || null, version: o.version || null };
  }).filter((f) => f.latitude != null && f.longitude != null && f.latitude >= 41.9 && f.latitude <= 44.2 && f.longitude >= -4 && f.longitude <= -1);
}
__name(getFirms, "getFirms");
async function authPayload(request, env) {
  const auth = request.headers.get("Authorization") || "", token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const primary = String(env.IRRATIGIS_LOGIN_PASSWORD || "");
  const legacy = String(env.GFA_PASSWORD || "");
  return await verifyToken(token, primary) || (legacy && legacy !== primary ? await verifyToken(token, legacy) : null);
}
__name(authPayload, "authPayload");
async function proxyGfa(request, url) {
  const suffix = url.pathname.slice("/api/gfa".length) || "/", target = new URL(GFA_BASE_URL + suffix + url.search), headers = new Headers(request.headers);
  headers.delete("host");
  return fetch(new Request(target.toString(), { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body, redirect: "follow" }));
}
__name(proxyGfa, "proxyGfa");
var worker_default = { async fetch(request, env) {
  const url = new URL(request.url), origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (url.pathname.startsWith("/api/gfa/") || url.pathname === "/api/gfa") return proxyGfa(request, url);
  if (url.pathname === "/" && request.method === "GET") return json({ ok: true, worker: "irratigis-erreketak", status: "online" }, 200, origin);
  if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, worker: "irratigis-erreketak", loginConfigured: !!env.IRRATIGIS_LOGIN_USER && !!env.IRRATIGIS_LOGIN_PASSWORD, configuredUser: String(env.IRRATIGIS_LOGIN_USER || "").trim() || null, gfaConfigured: !!env.GFA_USER && !!env.GFA_PASSWORD, d1Configured: !!env.DB, firmsConfigured: !!env.FIRMS_MAP_KEY }, 200, origin);
  if (url.pathname === "/api/login-form" && request.method === "POST") {
    const htmlHeaders = { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; frame-ancestors ${ALLOWED_ORIGIN}`, ...corsHeaders(origin) };
    const post = /* @__PURE__ */ __name((payload, status = 200) => {
      const remember = payload.remember === "0" ? "0" : "1";
      const target = payload.token ? `${ALLOWED_ORIGIN}/IrratiGIS/#irrati_token=${encodeURIComponent(payload.token)}&remember=${remember}` : `${ALLOWED_ORIGIN}/IrratiGIS/#irrati_login_error=${encodeURIComponent(payload.error || "Login failed")}`;
      return new Response(`<script>location.replace(${JSON.stringify(target)})<\/script>`, { status, headers: htmlHeaders });
    }, "post");
    try {
      const form = await request.formData(), user = String(form.get("user") || "").trim(), password = String(form.get("password") || ""), remember = String(form.get("remember") || "1"), validUser = String(env.IRRATIGIS_LOGIN_USER || "").trim(), validPassword = String(env.IRRATIGIS_LOGIN_PASSWORD || "");
      let valid = user === validUser && password === validPassword;
      if (!valid && user !== validUser) {
        const gfa = await fetch(`${GFA_BASE_URL}/login/es`, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ user, password }), signal: AbortSignal.timeout(12e3) });
        valid = gfa.ok;
      }
      if (!valid) return post({ type: "irratiGISLogin", error: "Unauthorized" }, 401);
      return post({ type: "irratiGISLogin", token: await createToken(user, validPassword) }, 200);
    } catch (_) {
      return post({ type: "irratiGISLogin", error: "Invalid request" }, 400);
    }
  }
  if (url.pathname === "/api/login" && request.method === "POST") {
    try {
      const body = await request.json(), user = String(body.user || body.username || "").trim(), password = String(body.password || ""), validUser = String(env.IRRATIGIS_LOGIN_USER || "").trim(), validPassword = String(env.IRRATIGIS_LOGIN_PASSWORD || "");
      let valid = user === validUser && password === validPassword;
      if (!valid && user !== validUser) {
        const gfa = await fetch(`${GFA_BASE_URL}/login/es`, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ user, password }), signal: AbortSignal.timeout(12e3) });
        valid = gfa.ok;
      }
      if (!valid) return json({ ok: false, error: "Unauthorized" }, 401, origin);
      return json({ ok: true, token: await createToken(user, validPassword) }, 200, origin);
    } catch (_) {
      return json({ ok: false, error: "Invalid request" }, 400, origin);
    }
  }
  if (url.pathname === "/api/me" && request.method === "GET") {
    const payload = await authPayload(request, env);
    return payload ? json({ ok: true, user: payload.sub }, 200, origin) : json({ ok: false, error: "Unauthorized" }, 401, origin);
  }
  if (url.pathname === "/api/active" && request.method === "GET") {
    const payload = await authPayload(request, env);
    if (!payload) return json({ ok: false, error: "Unauthorized" }, 401, origin);
    try {
      const fires = await getActiveBurns(env);
      await saveBurnSnapshot(env, fires);
      return json({ ok: true, fires }, 200, origin);
    } catch (error) {
      console.error("Error consultando quemas GFA", error?.stack || error);
      return json({ ok: false, error: "No se pudieron consultar las quemas GFA", detail: String(error?.message || error) }, 502, origin);
    }
  }
  if (url.pathname === "/api/firms" && request.method === "GET") {
    try {
      const days = Math.min(7, Math.max(1, Number(url.searchParams.get("days") || 1))), fires = await getFirms(env, days);
      return json({ ok: true, source: "NASA FIRMS", days, fires }, 200, origin);
    } catch (error) {
      console.error("Error consultando NASA FIRMS", error?.stack || error);
      return json({ ok: false, error: "No se pudieron consultar las detecciones NASA FIRMS", detail: String(error?.message || error) }, 502, origin);
    }
  }
  if (url.pathname === "/api/history" && request.method === "GET") {
    const payload = await authPayload(request, env);
    if (!payload) return json({ ok: false, error: "Unauthorized" }, 401, origin);
    if (!env.DB) return json({ ok: false, error: "D1 no configurada" }, 503, origin);
    const date = url.searchParams.get("date"), from = url.searchParams.get("from") || date, to = url.searchParams.get("to") || date;
    if (!from && !to) return json({ ok: false, error: "Indica date o from/to" }, 400, origin);
    const start = from || to, end = to || from, rows = await env.DB.prepare(`SELECT observed_date,observed_at,burn_key,anyo,codigo,codigo_tipo,numero_autorizacion,titular,municipio,fecha_inicio,fecha_fin,estado,latitud,longitud,tipo_quema,superficie,codigo_sigpac,payload_json FROM burn_observations WHERE observed_date BETWEEN ? AND ? ORDER BY observed_date DESC, observed_at DESC, numero_autorizacion`).bind(start, end).all(), runs = await env.DB.prepare(`SELECT observed_date,observed_at,burn_count FROM burn_daily_runs WHERE observed_date BETWEEN ? AND ? ORDER BY observed_date DESC`).bind(start, end).all();
    return json({ ok: true, from: start, to: end, days: runs.results || [], fires: (rows.results || []).map((r) => ({ ...r, data: r.payload_json ? JSON.parse(r.payload_json) : null })) }, 200, origin);
  }
  if (url.pathname === "/api/landcover" && request.method === "GET") {
    const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ ok: false, error: "lat/lon requeridos" }, 400, origin);
    const base = "https://servicios.idee.es/wms-inspire/ocupacion-suelo";
    const dd = 0.0009, W = 101, H = 101, I = 50, J = 50;
    const bbox = `${lat - dd},${lon - dd},${lat + dd},${lon + dd}`;
    const gfi = /* @__PURE__ */ __name(async (layer, fmt) => {
      const q = new URLSearchParams({ service: "WMS", version: "1.3.0", request: "GetFeatureInfo", layers: layer, query_layers: layer, styles: "", crs: "EPSG:4326", bbox, width: String(W), height: String(H), i: String(I), j: String(J), info_format: fmt, feature_count: "3" });
      try { const r = await fetch(`${base}?${q.toString()}`, { cf: { cacheTtl: 86400, cacheEverything: true } }); if (!r.ok) return null; return await r.text(); } catch (_) { return null; }
    }, "gfi");
    try {
      const txt = await gfi("LU.ExistingLandUse", "text/html") || await gfi("LU.ExistingLandUse", "text/plain") || await gfi("LC.LandCoverSurfaces", "text/html") || await gfi("LC.LandCoverSurfaces", "text/plain");
      const g = landcoverGroup(txt);
      return json({ ok: true, group: g.group, clase: g.clase, fuente: "IGN Ocupaci\u00f3n del Suelo", raw: (txt || "").replace(/\s+/g, " ").slice(0, 300) }, 200, origin);
    } catch (error) {
      return json({ ok: false, error: "GetFeatureInfo fall\u00f3", detail: String(error?.message || error) }, 502, origin);
    }
  }
  if (url.pathname === "/api/parcel" && request.method === "GET") {
    const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ ok: false, error: "lat/lon requeridos" }, 400, origin);
    const [x, y] = utm30Xy(lat, lon), d = 150;
    const bbox4326 = `${lat - 0.0016},${lon - 0.0016},${lat + 0.0016},${lon + 0.0016}`;
    const bbox25830 = `${x - d},${y - d},${x + d},${y + d}`;
    const tries = [
      { srs: "urn:ogc:def:crs:EPSG::4326", bbox: bbox4326 },
      { srs: "urn:ogc:def:crs:EPSG::25830", bbox: bbox25830 },
      { srs: "EPSG::25830", bbox: bbox25830 }
    ];
    const fetchWfs = /* @__PURE__ */ __name(async (t) => {
      const q = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typenames: "cp:CadastralParcel", srsname: t.srs, bbox: `${t.bbox},${t.srs}`, count: "80" });
      try { const r = await fetch(`https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx?${q.toString()}`, { cf: { cacheTtl: 86400, cacheEverything: true } }); return { status: r.status, txt: await r.text() }; } catch (e) { return { status: 0, txt: String(e?.message || e) }; }
    }, "fetchWfs");
    let res = null, usado = null;
    for (const t of tries) { res = await fetchWfs(t); if (res.txt && /CadastralParcel|localId|nationalCadastral/i.test(res.txt)) { usado = t.srs; break; } }
    const txt = res ? res.txt : "";
    const refs = [];
    const re = /(?:nationalCadastralReference|localId|cp:localId|gml:identifier)[^>]*>([^<]+)</gi;
    let mm;
    while ((mm = re.exec(txt)) !== null) refs.push(mm[1].trim());
    let urbana = 0, rustica = 0;
    for (const ref of refs) { const knd = parcelKind(ref.split(".").pop()); if (knd === "urbana") urbana++; else if (knd === "rustica") rustica++; }
    const kind = urbana > 0 ? "urbana" : rustica > 0 ? "rustica" : null;
    return json({ ok: true, kind, urbanas: urbana, rusticas: rustica, total: refs.length, srsUsado: usado, httpStatus: res?.status ?? null, muestra: refs.slice(0, 4), raw: (txt || "").replace(/\s+/g, " ").slice(0, 600) }, 200, origin);
  }
  return json({ ok: false, error: "Not found" }, 404, origin);
}, async scheduled(controller, env) {
  try {
    const scheduledAt = new Date(controller.scheduledTime), parts = new Intl.DateTimeFormat("en-US", { timeZone: GFA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(scheduledAt), local = {};
    for (const p of parts) if (["year", "month", "day", "hour"].includes(p.type)) local[p.type] = p.value;
    const localDate = `${local.year}-${local.month}-${local.day}`, localHour = Number(local.hour);
    if (localHour !== 4) {
      console.log("CRON omitido; ventana local no es 04:00", { cron: controller.cron, localDate, localHour });
      return;
    }
    const targetDate = shiftDateKey(localDate, -1), fires = await getActiveBurns(env, targetDate), saved = await saveBurnSnapshot(env, fires, targetDate);
    console.log("CRON HIST\xD3RICO QUEMAS D-1:", saved, { localDate, targetDate, cron: controller.cron });
  } catch (error) {
    console.error("CRON hist\xF3rico quemas fallido", error?.stack || error);
    throw error;
  }
} };
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
