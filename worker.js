const ALLOWED_ORIGIN = "https://irratiamendiak.github.io";
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Diagnóstico: debe responder inmediatamente si el Worker está bien desplegado.
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
        configuredUser: configuredUser || null
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

    return json({ ok: false, error: "Not found" }, 404, origin);
  }
};
