(() => {
  "use strict";

  const API = "https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const TOKEN_KEY = "irratigis_session_token";
  const SESSION_TOKEN_KEY = "irratigis_session_token_temp";
  const API_TIMEOUT_MS = 15000;

  const css = `
    #irratiLoginOverlay{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(135deg,#123e2b,#19734a);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
    #irratiLoginCard{width:min(390px,100%);background:#fff;border-radius:18px;padding:30px;box-shadow:0 18px 55px rgba(0,0,0,.30)}
    #irratiLoginCard h1{margin:0 0 5px;color:#123e2b;font-size:30px}
    #irratiLoginCard .subtitle{margin:0 0 24px;color:#65736b}
    #irratiLoginCard label{display:block;margin:0 0 6px;font-weight:750;color:#16231c}
    #irratiLoginCard input{display:block;width:100%;box-sizing:border-box;padding:12px;border:1px solid #ccd8d0;border-radius:9px;margin:0 0 15px;font:inherit;font-size:16px;background:#fff;color:#16231c}
    .irratiPasswordWrap{position:relative;width:100%}
    .irratiPasswordWrap input{padding-right:50px!important;margin-bottom:15px!important}
    #irratiTogglePassword{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:40px;height:40px;border:0;background:transparent;cursor:pointer;font-size:20px;padding:0;display:flex;align-items:center;justify-content:center}
    #irratiRememberRow{display:flex;align-items:center;gap:9px;margin:2px 0 18px;color:#39463f;font-size:14px;cursor:pointer}
    #irratiRememberMe{width:17px!important;height:17px;margin:0!important;padding:0!important;cursor:pointer}
    #irratiLoginButton{width:100%;border:0;border-radius:10px;padding:13px;background:#176b43;color:#fff;font:inherit;font-weight:800;font-size:16px;cursor:pointer}
    #irratiLoginButton:disabled{opacity:.65;cursor:wait}
    #irratiLoginMessage{min-height:22px;margin-top:14px;text-align:center;color:#a12626;font-size:14px}
    #irratiLoginCard .loading{color:#65736b}
  `;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  function getStoredToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY);
  }

  function saveToken(token, remember) {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    if (remember) localStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  }

  function apiFetch(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    return fetch(`${API}${path}`, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  async function getHealth() {
    const response = await apiFetch("/api/health", { method: "GET" });
    const data = await response.json().catch(() => null);
    return { response, data };
  }

  function showLogin(message = "") {
    let overlay = document.getElementById("irratiLoginOverlay");
    if (overlay) {
      const msg = document.getElementById("irratiLoginMessage");
      if (msg) msg.textContent = message;
      return;
    }

    overlay = document.createElement("div");
    overlay.id = "irratiLoginOverlay";
    overlay.innerHTML = `
      <div id="irratiLoginCard" role="dialog" aria-labelledby="irratiLoginTitle">
        <h1 id="irratiLoginTitle">IrratiGIS</h1>
        <p class="subtitle">Saioa hasi</p>
        <form id="irratiLoginForm" autocomplete="on">
          <label for="irratiLoginUser">Erabiltzailea</label>
          <input id="irratiLoginUser" name="username" type="text" autocomplete="username" required>
          <label for="irratiLoginPassword">Pasahitza</label>
          <div class="irratiPasswordWrap">
            <input id="irratiLoginPassword" name="password" type="password" autocomplete="current-password" required>
            <button id="irratiTogglePassword" type="button" aria-label="Mostrar contraseña" title="Mostrar contraseña">👁️</button>
          </div>
          <label id="irratiRememberRow" for="irratiRememberMe">
            <input id="irratiRememberMe" type="checkbox">
            <span>Mantenerme conectado</span>
          </label>
          <button id="irratiLoginButton" type="submit">Sartu</button>
          <div id="irratiLoginMessage" aria-live="polite">${message}</div>
        </form>
      </div>`;

    document.body.appendChild(overlay);

    const form = document.getElementById("irratiLoginForm");
    const button = document.getElementById("irratiLoginButton");
    const msg = document.getElementById("irratiLoginMessage");
    const passwordInput = document.getElementById("irratiLoginPassword");
    const togglePassword = document.getElementById("irratiTogglePassword");
    const rememberMe = document.getElementById("irratiRememberMe");

    togglePassword.addEventListener("click", () => {
      const showing = passwordInput.type === "text";
      passwordInput.type = showing ? "password" : "text";
      togglePassword.textContent = showing ? "👁️" : "🙈";
      togglePassword.setAttribute("aria-label", showing ? "Mostrar contraseña" : "Ocultar contraseña");
      togglePassword.setAttribute("title", showing ? "Mostrar contraseña" : "Ocultar contraseña");
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      msg.className = "loading";
      msg.textContent = "Egiaztatzen...";

      const user = document.getElementById("irratiLoginUser").value.trim();
      const password = document.getElementById("irratiLoginPassword").value;
      const remember = rememberMe.checked;

      try {
        const response = await apiFetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user, password })
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || !data || !data.ok || !data.token) {
          const serverError = data && data.error ? String(data.error) : "Respuesta HTTP " + response.status;
          throw new Error(serverError);
        }

        saveToken(data.token, remember);
        overlay.remove();
        window.dispatchEvent(new CustomEvent("irratiGISAuthenticated"));
      } catch (error) {
        msg.className = "";
        if (error && error.name === "AbortError") {
          msg.textContent = "No responde el Worker de Cloudflare. Espera unos segundos y recarga.";
        } else if (error && error.message === "Unauthorized") {
          msg.textContent = "Usuario o contraseña no coinciden con Cloudflare.";
        } else if (error && error.message === "Login no configurado") {
          msg.textContent = "Falta configurar IRRATIGIS_LOGIN_USER o IRRATIGIS_LOGIN_PASSWORD en Cloudflare.";
        } else {
          msg.textContent = "Error del servidor: " + ((error && error.message) || "desconocido");
        }
        button.disabled = false;
        passwordInput.select();
      }
    });
  }

  async function validateToken(token) {
    const response = await apiFetch("/api/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return !!(data && data.ok !== false);
  }

  async function startAuth() {
    const token = getStoredToken();
    if (token) {
      try {
        if (await validateToken(token)) return;
      } catch (_) {}
      clearToken();
    }

    try {
      const { response, data } = await getHealth();
      if (!response.ok || !data || !data.ok) {
        showLogin("El Worker responde con un error HTTP " + response.status + ".");
        return;
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        showLogin("El Worker de Cloudflare no responde. Revisa el despliegue de irratigis-erreketak.");
      } else {
        showLogin("No se puede conectar con el Worker de Cloudflare.");
      }
      return;
    }

    showLogin();
    await new Promise(resolve => {
      window.addEventListener("irratiGISAuthenticated", resolve, { once: true });
    });
  }

  window.IrratiGISAuth = {
    API,
    TOKEN_KEY,
    getToken: () => getStoredToken(),
    logout: () => { clearToken(); location.reload(); }
  };

  window.IrratiGISAuthReady = startAuth();
})();
