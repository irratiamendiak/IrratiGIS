(() => {
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const TOKEN_KEY="irratigis_session_token";
  const SESSION_TOKEN_KEY="irratigis_session_token_temp";
  function getToken(){return localStorage.getItem(TOKEN_KEY)||sessionStorage.getItem(SESSION_TOKEN_KEY)||"";}
  function saveToken(token,remember){localStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(SESSION_TOKEN_KEY);(remember?localStorage:sessionStorage).setItem(remember?TOKEN_KEY:SESSION_TOKEN_KEY,token);}
  function clearToken(){localStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(SESSION_TOKEN_KEY);}
  async function apiFetch(path,options={}){return fetch(`${API}${path}`,options);}

  function loadFirePopupModule(){
    const existing=document.getElementById("irratiFirePopupScript");
    if(existing)return window.IrratiGISFirePopupReady||Promise.resolve(window.IrratiGISFirePopup);
    const script=document.createElement("script");
    script.id="irratiFirePopupScript";
    script.src="fire-popup.js?v=20260902-18";
    script.defer=true;
    window.IrratiGISFirePopupReady=new Promise(resolve=>{script.onload=()=>resolve(window.IrratiGISFirePopup);script.onerror=()=>resolve(null);});
    document.head.appendChild(script);
    return window.IrratiGISFirePopupReady;
  }
  function runRealBurns(){loadFirePopupModule().then(m=>{if(m&&typeof m.loadBurnsIntoLayer==="function")m.loadBurnsIntoLayer();});}

  function addLogoutButton(){
    if(document.getElementById("irratiLogoutButton"))return;
    const b=document.createElement("button");b.id="irratiLogoutButton";b.type="button";b.textContent="Cerrar sesión";
    b.style.cssText="position:fixed;right:12px;top:12px;z-index:2147483646;padding:9px 12px;border:0;border-radius:9px;background:#fff;color:#176b43;font:800 12px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer";
    b.onclick=()=>{clearToken();location.reload();};document.body.appendChild(b);
  }

  function showLogin(message="Acceso protegido"){
    const old=document.getElementById("irratiLoginBackdrop");if(old)old.remove();
    const back=document.createElement("div");back.id="irratiLoginBackdrop";back.style.cssText="position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px";
    const box=document.createElement("div");box.style.cssText="width:min(420px,94vw);background:#fff;border-radius:16px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:14px system-ui;color:#16231c";
    box.innerHTML=`<h2 style="margin:0 0 8px">IrratiGIS</h2><p style="margin:0 0 14px;color:#65736b">${message}</p><label style="display:block;font-weight:800;font-size:12px;margin:8px 0 4px">Usuario</label><input id="irratiUser" type="text" autocomplete="username" style="width:100%;padding:10px;border:1px solid #ccd8d0;border-radius:9px;font:inherit"><label style="display:block;font-weight:800;font-size:12px;margin:10px 0 4px">Contraseña</label><input id="irratiPass" type="password" autocomplete="current-password" style="width:100%;padding:10px;border:1px solid #ccd8d0;border-radius:9px;font:inherit"><label style="display:flex;gap:7px;align-items:center;margin:10px 0"><input id="irratiRemember" type="checkbox" checked> Recordarme</label><button id="irratiLogin" type="button" style="padding:10px 14px;border:0;border-radius:9px;background:#176b43;color:#fff;font:800 14px system-ui;cursor:pointer">Entrar</button><div id="irratiLoginMsg" style="margin-top:10px;color:#8b2f2f"></div>`;
    back.appendChild(box);document.body.appendChild(back);
    const user=box.querySelector("#irratiUser"),pass=box.querySelector("#irratiPass"),remember=box.querySelector("#irratiRemember"),login=box.querySelector("#irratiLogin"),msg=box.querySelector("#irratiLoginMsg");
    async function submit(){
      login.disabled=true;msg.textContent="Entrando…";
      try{
        const r=await apiFetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user:user.value.trim(),password:pass.value,remember:remember.checked})});
        const d=await r.json().catch(()=>({}));if(!r.ok||!d.token)throw new Error(d.error||`HTTP ${r.status}`);
        saveToken(d.token,remember.checked);back.remove();addLogoutButton();window.dispatchEvent(new CustomEvent("irratiGISAuthenticated"));runRealBurns();
      }catch(e){msg.textContent=e.message||"No se pudo iniciar sesión.";}finally{login.disabled=false;}
    }
    login.onclick=submit;pass.addEventListener("keydown",e=>{if(e.key==="Enter")submit();});user.focus();
  }

  async function validateToken(token){const r=await apiFetch("/api/me",{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return false;const d=await r.json().catch(()=>({}));return !!d.user;}
  async function startAuth(){const token=getToken();if(token){try{if(await validateToken(token)){addLogoutButton();runRealBurns();return;}}catch(_){}clearToken();}showLogin();}
  window.IrratiGISAuth={API,TOKEN_KEY,getToken,logout:()=>{clearToken();location.reload();}};
  window.IrratiGISAuthReady=startAuth();
})();