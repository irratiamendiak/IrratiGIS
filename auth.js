(()=>{
  "use strict";
  const SOURCE="https://raw.githubusercontent.com/irratiamendiak/IrratiGIS/595a32794cda2d9c73b094c0f7825800ac908b2f/auth.js";
  const API_OLD="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const API_NEW="https://irratigis-api.pages.dev";
  window.IrratiGISAuthReady=fetch(SOURCE,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error(`auth source HTTP ${r.status}`);return r.text()}).then(src=>{
    const oldValidate='async function validateToken(token){const r=await apiFetch("/api/me",{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return false;const d=await r.json().catch(()=>({}));return !!d.user}';
    const newValidate='async function validateToken(token){try{const p=token.split(".");if(p.length!==2)return false;const raw=p[0].replace(/-/g,"+").replace(/_/g,"/");const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw+"===".slice((raw.length+3)%4)),c=>c.charCodeAt(0))));return !!payload.sub&&Number(payload.exp)>Math.floor(Date.now()/1000)}catch(_){return false}}';
    const oldInput='<input id="irratiPass" type="password" autocomplete="current-password" style="width:100%;padding:10px;border:1px solid #ccd8d0;border-radius:9px;font:inherit">';
    const newInput='<div style="position:relative"><input id="irratiPass" type="password" autocomplete="current-password" style="width:100%;padding:10px 42px 10px 10px;border:1px solid #ccd8d0;border-radius:9px;font:inherit"><button id="irratiPassEye" type="button" aria-label="Mostrar contraseña" title="Mostrar contraseña" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;padding:6px;cursor:pointer;font-size:18px;line-height:1">👁️</button></div>';
    const oldHook='const user=box.querySelector("#irratiUser"),pass=box.querySelector("#irratiPass"),remember=box.querySelector("#irratiRemember"),login=box.querySelector("#irratiLogin"),msg=box.querySelector("#irratiLoginMsg");';
    const newHook='const user=box.querySelector("#irratiUser"),pass=box.querySelector("#irratiPass"),remember=box.querySelector("#irratiRemember"),login=box.querySelector("#irratiLogin"),msg=box.querySelector("#irratiLoginMsg"),eye=box.querySelector("#irratiPassEye");eye.onclick=()=>{const visible=pass.type==="text";pass.type=visible?"password":"text";eye.textContent=visible?"👁️":"🙈";eye.setAttribute("aria-label",visible?"Mostrar contraseña":"Ocultar contraseña");eye.title=visible?"Mostrar contraseña":"Ocultar contraseña"};';
    const patched=src.replace(oldValidate,newValidate).replace(oldInput,newInput).replace(oldHook,newHook).replaceAll(API_OLD,API_NEW);
    if(patched===src)throw new Error("auth source patch failed");
    (0,eval)(patched);
    return window.IrratiGISAuth;
  }).catch(err=>{
    console.error("IrratiGIS auth bridge:",err);
    const el=document.createElement("div");el.style.cssText="position:fixed;inset:0;z-index:2147483647;background:#fff;padding:30px;font:16px system-ui;color:#8b2f2f";el.textContent="Ezin izan da autentifikazio-modulua kargatu.";document.body.appendChild(el);throw err;
  });
})();
