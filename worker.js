export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Login API
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const user = String(body.user || "").trim();
        const password = String(body.password || "");

        // Credenciales guardadas como secretos de Cloudflare
        const validUser = env.IRRATIGIS_LOGIN_USER;
        const validPassword = env.IRRATIGIS_LOGIN_PASSWORD;

        if (!validUser || !validPassword) {
          return Response.json(
            { ok: false, error: "Login no configurado" },
            { status: 500 }
          );
        }

        if (user !== validUser || password !== validPassword) {
          return Response.json(
            { ok: false, error: "Unauthorized" },
            { status: 401 }
          );
        }

        const token = crypto.randomUUID();

        return Response.json({
          ok: true,
          token
        });
      } catch {
        return Response.json(
          { ok: false, error: "Invalid request" },
          { status: 400 }
        );
      }
    }

    // Para el resto de peticiones, servir los archivos estáticos
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
