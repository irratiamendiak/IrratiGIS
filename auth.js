(() => {
  "use strict";

  const API = "https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const TOKEN_KEY = "irratigis_session_token";
  const SESSION_TOKEN_KEY = "irratigis_session_token_temp";

  function showAuthDiagnostic() {
    const add = () => {
      if (document.getElementById("irratiAuthDiagnostic")) return;
      const badge = document.createElement("div");
      badge.id = "irratiAuthDiagnostic";
      badge.textContent = "🟢 PRUEBA: auth.js cargado v17";
      badge.style.cssText = "position:fixed;left:12px;bottom:54px;z-index:2147483646;background:#d1e7dd;color:#0f5132;border:2px solid #198754;border-radius:10px;padding:10px 14px;font:800 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 3px 14px rgba(0,0,0,.28);pointer-events:none";
      document.body.appendChild(badge);
    };
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add, {once:true});
  }

  function getToken() { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY) || ""; }
  function saveToken(token, remember) { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(SESSION_TOKEN_KEY); (remember ? localStorage : sessionStorage).setItem(remember ? TOKEN_KEY : SESSION_TOKEN_KEY, token); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(SESSION_TOKEN_KEY); }
  async function apiFetch(path, options = {}) { return fetch(`${API}${path}`, options); }

  function showDirectMapTest() {
    const add = () => {
      const mapEl = document.getElementById("map");
      if (!mapEl) return;
      let fire = document.getElementById("irratiDirectMapFireTest");
      if (!fire) {
        fire = document.createElement("div");
        fire.id = "irratiDirectMapFireTest";
        fire.textContent = "🔥";
        fire.style.cssText = "position:fixed;z-index:2147483647;font-size:72px;line-height:72px;pointer-events:auto;filter:drop-shadow(0 2px 4px rgba(0,0,0,.7));cursor:pointer";
        fire.title = "PRUEBA QUEMA — clic para confirmar";
        fire.onclick = () => alert("🧪 PRUEBA QUEMA\n\nEl navegador está dibujando correctamente el marcador de prueba.");
        document.body.appendChild(fire);
      }
      const r = mapEl.getBoundingClientRect();
      fire.style.left = `${Math.round(r.left + r.width / 2 - 36)}px`;
      fire.style.top = `${Math.round(r.top + r.height / 2 - 36)}px`;
      fire.style.display = "block";
    };
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add, {once:true});
    window.addEventListener("resize", add);
    window.addEventListener("scroll", add, {passive:true});
    setTimeout(add,500); setTimeout(add,1500); setTimeout(add,3000);
  }

  function exposeBurnLayerGlobals() { try { if (typeof map !== "undefined") window.__irratiGISMap = map; if (typeof controlledBurnLayer !== "undefined") window.__irratiGISControlledBurnLayer = controlledBurnLayer; } catch (_) {} }

  function loadFirePopupModule() {
    exposeBurnLayerGlobals();
    const existing = document.getElementById("irratiFirePopupScript");
    if (existing) return window.IrratiGISFirePopupReady || Promise.resolve(window.IrratiGISFirePopup);
    const script = document.createElement("script");
    script.id = "irratiFirePopupScript";
    script.src = "fire-popup.js?v=20260902-17";
    script.defer = true;
    window.IrratiGISFirePopupReady = new Promise(resolve => { script.onload = () => resolve(window.IrratiGISFirePopup); script.onerror = () => { console.error("IrratiGIS: no se pudo cargar fire-popup.js"); resolve(null); }; });
    document.head.appendChild(script);
    return window.IrratiGISFirePopupReady;
  }

  function runFirePopupNow() {
    exposeBurnLayerGlobals();
    const module = window.IrratiGISFirePopup;
    if (module && typeof module.loadBurnsIntoLayer === "function") { module.loadBurnsIntoLayer(); return true; }
    return false;
  }

  function bootBurnTests() {
    showAuthDiagnostic();
    showDirectMapTest();
    loadFirePopupModule().then(() => { exposeBurnLayerGlobals(); runFirePopupNow(); });
  }

  function addLogoutButton() {
    if (document.getElementById("irratiLogoutButton")) return;
    const button = document.createElement("button");
    button.id = "irratiLogoutButton"; button.type = "button"; button.textContent = "Cerrar sesión";
    button.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483646;padding:9px 12px;border:0;border-radius:9px;background:#fff;color:#176b43;font:800 12px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer";
    button.onclick = () => { clearToken(); location.reload(); };
    document.body.appendChild(button);
  }

  function showLogin(message = "Acceso protegido") {
    let old = document.getElementById("irratiLoginBackdrop"); if (old) old.remove();
    const back = document.createElement("div"); back.id = "irratiLoginBackdrop";
    back.style.cssText = "position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px";
    const box = document.createElement("div"); box.style.cssText = "width:min(420px,94vw);background:#fff;border-radius:16px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:14px system-ui;color:#16231c";
    box.innerHTML = `<h2 style="margin:0 0 8px">IrratiGIS</h2><p style="margin:0 0 14px;color:#65736b">${message}</p><label style="display:block;font-weight:800;font-size:12px;margin:8px 0 4px">Usuario</label><input id="irratiUser" type="text" autocomplete="username" style="width:100%;padding:10px;border:1px solid #ccd8d0;border-radius:9px;font:inherit"><label style="display:block;font-weight:800;font-size:12px;margin:10px 0 4px">Contraseña</label><input id="irratiPass" type="password" autocomplete="current-password" style="width:100%;padding:10px;border:1px solid #ccd8d0;border-radius:9px;font:inherit"><label style="display:flex;gap:7px;align-items:center;margin:10px 0"><input id="irratiRemember" type="checkbox" checked> Recordarme</label><button id="irratiLogin" type="button" style="padding:10px 14px;border:0;border-radius:9px;background:#176b43;color:#fff;font:800 14px system-ui;cursor:pointer">Entrar</button><div id="irratiLoginMsg" style="margin-top:10px;color:#8b2f2f"></div>`;
    back.appendChild(box); document.body.appendChild(back);
    const user=box.querySelector("#irratiUser"), pass=box.querySelector("#irratiPass"), remember=box.querySelector("#irratiRemember"), login=box.querySelector("#irratiLogin"), msg=box.querySelector("#irratiLoginMsg");
    async function submit(){
      login.disabled=true; msg.textContent="Entrando…";
      try{
        const response=await apiFetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user:user.value.trim(),password:pass.value,remember:remember.checked})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!data.token) throw new Error(data.error||`HTTP ${response.status}`);
        saveToken(data.token,remember.checked); back.remove(); addLogoutButton();
        window.dispatchEvent(new CustomEvent("irratiGISAuthenticated"));
        bootBurnTests();
      }catch(err){msg.textContent=err.message||"No se pudo iniciar sesión.";}finally{login.disabled=false;}
    }
    login.onclick=submit; pass.addEventListener("keydown",e=>{if(e.key==="Enter")submit();}); user.focus();
  }

  async function validateToken(token){const response=await apiFetch("/api/me",{headers:{"Authorization":`Bearer ${token}`}});if(!response.ok)return false;const data=await response.json().catch(()=>({}));return !!data.user;}

  async function startAuth(){
    const token=getToken();
    if(token){try{if(await validateToken(token)){addLogoutButton();bootBurnTests();return;}}catch(_){}clearToken();}
    showLogin();
    await new Promise(resolve=>window.addEventListener("irratiGISAuthenticated",resolve,{once:true}));
  }

  window.IrratiGISAuth={API,TOKEN_KEY,getToken,logout:()=>{clearToken();location.reload();}};
  window.IrratiGISAuthReady=startAuth();
})();