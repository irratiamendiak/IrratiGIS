(() => {
  "use strict";

  const API = "https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const TOKEN_KEY = "irratigis_session_token";

  const css = `
    #irratiLoginOverlay{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(135deg,#123e2b,#19734a);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
    #irratiLoginCard{width:min(390px,100%);background:#fff;border-radius:18px;padding:30px;box-shadow:0 18px 55px rgba(0,0,0,.30)}
    #irratiLoginCard h1{margin:0 0 5px;color:#123e2b;font-size:30px}
    #irratiLoginCard .subtitle{margin:0 0 24px;color:#65736b}
    #irratiLoginCard label{display:block;margin:0 0 6px;font-weight:750;color:#16231c}
    #irratiLoginCard input{display:block;width:100%;box-sizing:border-box;padding:12px;border:1px solid #ccd8d0;border-radius:9px;margin:0 0 15px;font:inherit;font-size:16px;background:#fff;color:#16231c}
    #irratiLoginButton{width:100%;border:0;border-radius:10px;padding:13px;background:#176b43;color:#fff;font:inherit;font-weight:800;font-size:16px;cursor:pointer}
    #irratiLoginButton:disabled{opacity:.65;cursor:wait}
    #irratiLoginMessage{min-height:22px;margin-top:14px;text-align:center;color:#a12626;font-size:14px}
    #irratiLoginCard .loading{color:#65736b}
  `;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

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
          <input id="irratiLoginPassword" name="password" type="password" autocomplete="current-password" required>
          <button id="irratiLoginButton" type="submit">Sartu</button>
          <div id="irratiLoginMessage" aria-live="polite">${message}</div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const form = document.getElementById("irratiLoginForm");
    const button = document.getElementById("irratiLoginButton");
    const msg = document.getElementById("irratiLoginMessage");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      msg.className = "loading";
      msg.textContent = "Egiaztatzen...";

      const user = document.getElementById("irratiLoginUser").value.trim();
      const password = document.getElementById("irratiLoginPassword").value;

      try {
        const response = await fetch(`${API}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user, password })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok || !data || !data.ok || !data.token) {
          throw new Error((data && data.error) || "Unauthorized");
        }

        localStorage.setItem(TOKEN_KEY, data.token);
        overlay.remove();
        window.dispatchEvent(new CustomEvent("irratiGISAuthenticated"));
      } catch (error) {
        msg.className = "";
        msg.textContent = "Erabiltzailea edo pasahitza okerrak dira.";
        button.disabled = false;
        document.getElementById("irratiLoginPassword").select();
      }
    });
  }

  async function validateToken(token) {
    const response = await fetch(`${API}/api/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return !!(data && data.ok !== false);
  }

  async function startAuth() {
    const token = localStorage.getItem(TOKEN_KEY);

    if (token) {
      try {
        if (await validateToken(token)) return;
      } catch (_) {}
      localStorage.removeItem(TOKEN_KEY);
    }

    showLogin();
    await new Promise(resolve => {
      window.addEventListener("irratiGISAuthenticated", resolve, { once: true });
    });
  }

  window.IrratiGISAuth = {
    API,
    TOKEN_KEY,
    getToken: () => localStorage.getItem(TOKEN_KEY),
    logout: () => {
      localStorage.removeItem(TOKEN_KEY);
      location.reload();
    }
  };

  window.IrratiGISAuthReady = startAuth();
})();
