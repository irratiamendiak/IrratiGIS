const ALLOWED_ORIGIN = "https://irratiamendiak.github.io";
const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const GFA_BASE_URL = "https://w390w.gipuzkoa.net/WAS/CORP/DMQQuemasWEB";

function corsHeaders(origin = "") {
  const allowedOrigin = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin)
    }
  });
}

function base64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===";
  const binary = atob(padded.slice(0, padded.length - (padded.length % 4)));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function getSigningKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createToken(user, secret) {
  const payload = {
    sub: user,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  };
  const payloadPart = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadPart)
  );
  return `${payloadPart}.${base64urlEncode(new Uint8Array(signature))}`;
}

async function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  try {
    const [payloadPart, signaturePart] = parts;
    const key = await getSigningKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(signaturePart),
      new TextEncoder().encode(payloadPart)
    );
    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadPart))
    );
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch (_) {
    return null;
  }
}

function todayAtMidnight() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day} 00:00:00`;
}

function todayAtEnd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day} 23:59:59`;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractDate(value) {
  if (!value) return null;
  if (typeof value === "string") return new Date(value.replace(" ", "T")).getTime();
  if (typeof value === "number") return value;
  return null;
}

function mapQuema(item) {
  const solicitud = item?.solicitud || {};
  const datos = item?.datosQuema || {};
  const ciudadano = solicitud.ciudadano || item?.ciudadano || {};
  const material = datos.materialQuema || {};
  const motivo = datos.motivo || {};
  const municipio = solicitud.municipio || item?.municipio || null;

  const lat = toNumber(solicitud.latitud ?? item?.latitud ?? item?.latitudea);
  const lon = toNumber(solicitud.longitud ?? item?.longitud ?? item?.longitudea);

  const nombre = ciudadano.nombre || "";
  const apellidos = ciudadano.apellidos || ciudadano.apellido1 || ciudadano.apellido || "";
  const titular = [nombre, apellidos].filter(Boolean).join(" ").trim();

  return {
    id: solicitud.codigo ?? item?.codigo ?? null,
    numeroAutorizacion: datos.numeroAutorizacion ?? item?.numeroAutorizacion ?? null,
    titular,
    nombre: nombre || null,
    apellidos: apellidos || null,
    telefono: datos.telefonoMovil || datos.telefonoFijo || null,
    telefonoMovil: datos.telefonoMovil || null,
    telefonoFijo: datos.telefonoFijo || null,
    latitud: lat,
    longitud: lon,
    latitudea: lat,
    longitudea: lon,
    direccion: solicitud.direccion ?? item?.direccion ?? null,
    municipio,
    tipoQuema: material.descripcion || null,
    codigoMaterial: material.codigo || null,
    motivo: motivo.descripcion || null,
    fechaInicio: solicitud.fechaInicio ?? item?.fechaInicio ?? null,
    fechaFin: solicitud.fechaFin ?? item?.fechaFin ?? null,
    estado: solicitud.estado?.codigo ?? item?.estado?.codigo ?? item?.estado ?? null,
    superficie: datos.superficie ?? null,
    descripcionEmergencias: datos.descripcionEmergencias ?? null,
    parcela: {
      provincia: solicitud.provincia ?? null,
      municipio: solicitud.municipio ?? null,
      poligono: solicitud.poligono ?? null,
      parcela: solicitud.parcela ?? null,
      recinto: solicitud.recinto ?? null
    }
  };
}

async function getActiveBurns(env) {
  const user = String(env.GFA_USER || "").trim();
  const password = String(env.GFA_PASSWORD || "");
  if (!user || !password) throw new Error("Credenciales GFA no configuradas");

  const loginResponse = await fetch(`${GFA_BASE_URL}/login/es`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, password })
  });

  if (!loginResponse.ok) {
    throw new Error(`Login GFA HTTP ${loginResponse.status}`);
  }

  const authorizedUser = await loginResponse.json();
  if (!authorizedUser?.token || authorizedUser?.id == null) {
    throw new Error("Respuesta de login GFA sin token o id");
  }

  const municipalityIds = Array.isArray(authorizedUser.municipios)
    ? authorizedUser.municipios.map(m => typeof m === "object" ? m.id : m).filter(v => v != null)
    : [];

  const query = {
    dni: null,
    idsEstado: ["a", "q"],
    poligono: null,
    parcela: null,
    recinto: null,
    anyo: null,
    codigo: null,
    fechaIncio: todayAtMidnight(),
    fechaFin: todayAtEnd(),
    tipoSolicitud: "Q",
    nombreCiudadano: null,
    transferidaPastos: null,
    transferidaMontesUtilidadPublica: null,
    transferidaEspaciosNaturales: null,
    nombreParcela: null,
    idsMunicipio: municipalityIds,
    numAut: null,
    idGuardaForestal: authorizedUser.id
  };

  const listResponse = await fetch(`${GFA_BASE_URL}/quema/lista/completo/es`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "security-token": authorizedUser.token,
      "security-user-id": String(authorizedUser.id)
    },
    body: JSON.stringify(query)
  });

  if (!listResponse.ok) {
    throw new Error(`Consulta de quemas GFA HTTP ${listResponse.status}`);
  }

  const raw = await listResponse.json();
  const list = Array.isArray(raw) ? raw : [];
  const now = Date.now();

  return list
    .map(mapQuema)
    .filter(q => q.latitud != null && q.longitud != null)
    .filter(q => {
      const inicio = extractDate(q.fechaInicio);
      const fin = extractDate(q.fechaFin);
      return (inicio == null || inicio <= now) && (fin == null || fin >= now);
    });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return json({ ok: true, worker: "irratigis-erreketak", status: "online" }, 200, origin);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      const configuredUser = String(env.IRRATIGIS_LOGIN_USER || "").trim();
      const configuredPassword = String(env.IRRATIGIS_LOGIN_PASSWORD || "");
      return json({
        ok: true,
        worker: "irratigis-erreketak",
        loginConfigured: !!configuredUser && !!configuredPassword,
        configuredUser: configuredUser || null,
        gfaConfigured: !!String(env.GFA_USER || "").trim() && !!String(env.GFA_PASSWORD || "")
      }, 200, origin);
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const user = String(body.user || "").trim();
        const password = String(body.password || "");
        const validUser = String(env.IRRATIGIS_LOGIN_USER || "").trim();
        const validPassword = String(env.IRRATIGIS_LOGIN_PASSWORD || "");

        if (!validUser || !validPassword) {
          return json({ ok: false, error: "Login no configurado" }, 500, origin);
        }

        if (user !== validUser || password !== validPassword) {
          return json({ ok: false, error: "Unauthorized" }, 401, origin);
        }

        const token = await createToken(user, validPassword);
        return json({ ok: true, token }, 200, origin);
      } catch (_) {
        return json({ ok: false, error: "Invalid request" }, 400, origin);
      }
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const payload = await verifyToken(token, env.IRRATIGIS_LOGIN_PASSWORD);

      if (!payload) {
        return json({ ok: false, error: "Unauthorized" }, 401, origin);
      }
      return json({ ok: true, user: payload.sub }, 200, origin);
    }

    if (url.pathname === "/api/active" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const payload = await verifyToken(token, env.IRRATIGIS_LOGIN_PASSWORD);

      if (!payload) {
        return json({ ok: false, error: "Unauthorized" }, 401, origin);
      }

      try {
        const fires = await getActiveBurns(env);
        return json({ ok: true, fires }, 200, origin);
      } catch (error) {
        console.error("Error consultando quemas GFA", error);
        return json({ ok: false, error: "No se pudieron consultar las quemas GFA" }, 502, origin);
      }
    }

    return json({ ok: false, error: "Not found" }, 404, origin);
  }
};
