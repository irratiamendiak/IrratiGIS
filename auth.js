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
      badge.textContent = "🟢 PRUEBA: auth.js cargado";
      badge.style.cssText = "position:fixed;left:12px;bottom:54px;z-index:2147483646;background:#d1e7dd;color:#0f5132;border:2px solid #198754;border-radius:10px;padding:10px 14px;font:800 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 3px 14px rgba(0,0,0,.28);pointer-events:none";
      (document.body || document.documentElement).appendChild(badge);
      console.log("IrratiGIS: DIAGNÓSTICO auth.js cargado correctamente");
    };
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add, {once:true});
  }
  showAuthDiagnostic();

  function getToken() { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY) || ""; }
  function saveToken(token, remember) { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(SESSION_TOKEN_KEY); (remember ? localStorage : sessionStorage).setItem(remember ? TOKEN_KEY : SESSION_TOKEN_KEY, token); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(SESSION_TOKEN_KEY); }
  async function apiFetch(path, options = {}) { return fetch(`${API}${path}`, options); }
  function exposeBurnLayerGlobals() { try { if (typeof map !== "undefined") window.__irratiGISMap = map; if (typeof controlledBurnLayer !== "undefined") window.__irratiGISControlledBurnLayer = controlledBurnLayer; } catch (_) {} }

  function loadFirePopupModule() {
    exposeBurnLayerGlobals();
    const existing = document.getElementById("irratiFirePopupScript");
    if (existing) return window.IrratiGISFirePopupReady || Promise.resolve(window.IrratiGISFirePopup);
    const script = document.createElement("script");
    script.id = "irratiFirePopupScript";
    script.src = "fire-popup.js?v=20260902-12";
    script.defer = true;
    window.IrratiGISFirePopupReady = new Promise(resolve => { script.onload = () => resolve(window.IrratiGISFirePopup); script.onerror = () => { console.error("IrratiGIS: no se pudo cargar fire-popup.js"); resolve(null); }; });
    document.head.appendChild(script);
    return window.IrratiGISFirePopupReady;
  }

  function runFirePopupNow() {
    exposeBurnLayerGlobals();
    const module = window.IrratiGISFirePopup;
    if (module && typeof module.loadBurnsIntoLayer === "function") {
      module.loadBurnsIntoLayer();
      return true;
    }
    return false;
  }

  function addLogoutButton() { if (document.getElementById("irratiLogoutButton")) return; const b=document.createElement("button"); b.id="irratiLogoutButton"; b.textContent="Irten"; b.style.cssText="position:fixed;top:12px;right:12px;z-index:999999;border:0;border-radius:9px;padding:9px 13px;background:#fff;color:#176b43;font-weight:800;box-shadow:0 2px 10px rgba(0,0,0,.2);cursor:pointer"; b.onclick=()=>{clearToken();location.reload();}; document.body.appendChild(b); }
  function showLogin(message="") { let old=document.getElementById("irratiLoginOverlay"); if(old)return; const overlay=document.createElement("div"); overlay.id="irratiLoginOverlay"; overlay.style.cssText="position:fixed;inset:0;z-index:999998;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(135deg,#123e2b,#19734a);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif"; overlay.innerHTML=`<form id="irratiLoginForm" style="width:min(390px,100%);background:#fff;border-radius:18px;padding:28px;box-shadow:0 18px 55px rgba(0,0,0,.3)"><h1 style="margin:0 0 5px;color:#123e2b">IrratiGIS</h1><p style="color:#65736b">Saioa hasi</p><label>Erabiltzailea</label><input id="irratiUser" autocomplete="username" required style="display:block;width:100%;box-sizing:border-box;padding:12px;margin:6px 0 14px;border:1px solid #ccd8d0;border-radius:9px"><label>Pasahitza</label><input id="irratiPassword" type="password" autocomplete="current-password" required style="display:block;width:100%;box-sizing:border-box;padding:12px;margin:6px 0 14px;border:1px solid #ccd8d0;border-radius:9px"><label style="display:flex;gap:8px;align-items:center;margin-bottom:15px"><input id="irratiRemember" type="checkbox"> Mantenerme conectado</label><button id="irratiLoginButton" type="submit" style="width:100%;padding:13px;border:0;border-radius:10px;background:#176b43;color:#fff;font-weight:800;cursor:pointer">Sartu</button><div id="irratiLoginMessage" style="min-height:22px;margin-top:12px;text-align:center;color:#a12626">${message}</div></form>`; document.body.appendChild(overlay); document.getElementById("irratiLoginForm").addEventListener("submit",async e=>{e.preventDefault();const button=document.getElementById("irratiLoginButton"),msg=document.getElementById("irratiLoginMessage");button.disabled=true;msg.textContent="Egiaztatzen...";try{const r=await apiFetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user:document.getElementById("irratiUser").value.trim(),password:document.getElementById("irratiPassword").value})});const data=await r.json();if(!r.ok||!data.ok||!data.token)throw new Error(data.error||`HTTP ${r.status}`);saveToken(data.token,document.getElementById("irratiRemember").checked);overlay.remove();addLogoutButton();window.dispatchEvent(new CustomEvent("irratiGISAuthenticated"));}catch(err){msg.textContent="Error: "+(err.message||err);button.disabled=false;}}); }
  async function validateToken(token){const r=await apiFetch("/api/me",{headers:{Authorization:`Bearer ${token}`}});return r.ok;}
  async function startAuth(){exposeBurnLayerGlobals();await loadFirePopupModule();exposeBurnLayerGlobals();runFirePopupNow();const token=getToken();if(token){try{if(await validateToken(token)){addLogoutButton();return}}catch(_){}clearToken();}showLogin();await new Promise(resolve=>window.addEventListener("irratiGISAuthenticated",resolve,{once:true}));}
  window.IrratiGISAuth={API,TOKEN_KEY,getToken,logout:()=>{clearToken();location.reload();}};
  window.IrratiGISAuthReady=startAuth();
  window.addEventListener("load",()=>{exposeBurnLayerGlobals();loadFirePopupModule().then(()=>{exposeBurnLayerGlobals();runFirePopupNow();});});
})();