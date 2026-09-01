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
    #irratiLogoutButton{position:fixed;top:14px;right:14px;z-index:99998;border:0;border-radius:10px;padding:10px 14px;background:#fff;color:#176b43;font:inherit;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18)}
    #irratiLogoutButton:hover{background:#f2f7f4}
    @media(max-width:560px){#irratiLogoutButton{top:8px;right:8px;padding:9px 11px;font-size:13px}}
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

  function addLogoutButton() {
    if (document.getElementById("irratiLogoutButton")) return;
    const button = document.createElement("button");
    button.id = "irratiLogoutButton";
    button.type = "button";
    button.textContent = "Irten";
    button.title = "Saioa itxi";
    button.setAttribute("aria-label", "Saioa itxi");
    button.addEventListener("click", () => { clearToken(); location.reload(); });
    document.body.appendChild(button);
  }

  function apiFetch(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    return fetch(`${API}${path}`, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
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
          <label id="irratiRememberRow" for="irratiRememberMe"><input id="irratiRememberMe" type="checkbox"><span>Mantenerme conectado</span></label>
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
    });

    form.addEventListener("submit", async event => {
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
          throw new Error(data && data.error ? String(data.error) : "Respuesta HTTP " + response.status);
        }
        saveToken(data.token, remember);
        overlay.remove();
        addLogoutButton();
        window.dispatchEvent(new CustomEvent("irratiGISAuthenticated"));
      } catch (error) {
        msg.className = "";
        if (error?.name === "AbortError") msg.textContent = "El Worker de Cloudflare no responde.";
        else if (error?.message === "Unauthorized") msg.textContent = "Usuario o contraseña no coinciden con Cloudflare.";
        else if (error?.message === "Login no configurado") msg.textContent = "Falta configurar IRRATIGIS_LOGIN_USER o IRRATIGIS_LOGIN_PASSWORD en Cloudflare.";
        else msg.textContent = "Error del servidor: " + (error?.message || "desconocido");
        button.disabled = false;
        passwordInput.select();
      }
    });
  }

  async function validateToken(token) {
    const response = await apiFetch("/api/me", { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return !!(data && data.ok !== false);
  }

  async function startAuth() {
    const token = getStoredToken();
    if (token) {
      try {
        if (await validateToken(token)) { addLogoutButton(); return; }
      } catch (_) {}
      clearToken();
    }
    showLogin();
    await new Promise(resolve => window.addEventListener("irratiGISAuthenticated", resolve, { once: true }));
  }

  window.IrratiGISAuth = { API, TOKEN_KEY, getToken: () => getStoredToken(), logout: () => { clearToken(); location.reload(); } };
  window.IrratiGISAuthReady = startAuth();

  function escapeBurnHtml(value) {
    return String(value ?? "-").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function firstValue(obj, keys, fallback = "-") {
    for (const key of keys) {
      const value = obj?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return fallback;
  }

  async function loadControlledBurnsFallback() {
    try {
      if (typeof map === "undefined" || typeof controlledBurnLayer === "undefined" || typeof L === "undefined") return;
      if (controlledBurnLayer.getLayers().length > 0) return;
      const token = getStoredToken();
      if (!token) return;

      const response = await apiFetch("/api/active", { method: "GET", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const fires = Array.isArray(data?.fires) ? data.fires : (Array.isArray(data) ? data : []);

      fires.forEach(fire => {
        const q = fire?.datosQuema || fire?.quema || fire;
        const lat = Number(firstValue(q, ["latitud", "latitude", "lat", "latitudea"]));
        const lon = Number(firstValue(q, ["longitud", "longitude", "lon", "lng", "longitudea"]));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const solicitante = q?.solicitante || fire?.solicitante || {};
        const marker = L.marker([lat, lon], {
          icon: L.divIcon({ className: "irrati-burn-icon", html: "<div style=\"font-size:30px;line-height:30px;text-shadow:0 1px 3px rgba(0,0,0,.55)\">🔥</div>", iconSize: [32,32], iconAnchor: [16,30] }),
          zIndexOffset: 1000
        });

        const nombre = firstValue(q, ["nombreYApellidos", "nombreApellidos", "titular", "nombre"], firstValue(solicitante, ["nombreYApellidos", "nombre"], "-"));
        const permiso = firstValue(q, ["numeroAutorizacion", "baimena", "numeroPermiso", "permiso"]);
        const telefono = firstValue(q, ["telefonoMovil", "telefonoFijo", "telefono", "telefonoQuema", "telefonoPermiso"]);
        const telefonoQuema = firstValue(q, ["telefonoQuema", "telefonoMovil", "telefonoFijo", "telefono"]);
        const tipo = firstValue(q, ["descripcionMaterial", "tipoQuema", "tipo", "descripcionTipoQuema"]);
        const ubicacion = firstValue(q, ["descripcionRecinto", "ubicacion", "parcela", "nombreParcela"]);

        marker.bindPopup(
          `<strong>🔥 Baimendutako erreketak</strong><br><br>` +
          `<strong>Titularra:</strong> ${escapeBurnHtml(nombre)}<br>` +
          `<strong>Nº permiso de quema:</strong> ${escapeBurnHtml(permiso)}<br>` +
          `<strong>Teléfono del permiso:</strong> ${escapeBurnHtml(telefono)}<br>` +
          `<strong>Teléfono de la quema:</strong> ${escapeBurnHtml(telefonoQuema)}<br>` +
          `<strong>Tipo de quema:</strong> ${escapeBurnHtml(tipo)}<br>` +
          `<strong>Ubicación:</strong> ${escapeBurnHtml(ubicacion)}<br>` +
          `<strong>Coordenadas:</strong> ${lat.toFixed(6)}, ${lon.toFixed(6)}`
        );
        marker.addTo(controlledBurnLayer);
      });

      if (controlledBurnLayer.getLayers().length > 0 && !map.hasLayer(controlledBurnLayer)) controlledBurnLayer.addTo(map);
    } catch (error) {
      console.error("IrratiGIS: fallback de quemas activas fallido", error);
    }
  }

  function hookControlledBurnLayer() {
    try {
      if (typeof map === "undefined" || typeof controlledBurnLayer === "undefined") return false;
      map.on("overlayadd", event => {
        if (event.layer === controlledBurnLayer) {
          if (typeof loadControlledBurns === "function") loadControlledBurns();
          setTimeout(loadControlledBurnsFallback, 1200);
        }
      });
      return true;
    } catch (_) { return false; }
  }

  if (!hookControlledBurnLayer()) {
    window.addEventListener("load", () => { hookControlledBurnLayer(); }, { once: true });
    setTimeout(hookControlledBurnLayer, 500);
  }

  window.addEventListener("irratiGISAuthenticated", () => {
    setTimeout(loadControlledBurnsFallback, 1200);
    setTimeout(loadControlledBurnsFallback, 3000);
  });
})();
