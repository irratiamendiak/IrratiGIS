(()=>{
  "use strict";
  const SOURCE="https://raw.githubusercontent.com/irratiamendiak/IrratiGIS/595a32794cda2d9c73b094c0f7825800ac908b2f/auth.js";
  const API_OLD="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const API_NEW="https://irratigis-api.pages.dev";
  window.IrratiGISAuthReady=fetch(SOURCE,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error(`auth source HTTP ${r.status}`);return r.text()}).then(src=>{
    const oldValidate='async function validateToken(token){const r=await apiFetch("/api/me",{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)return false;const d=await r.json().catch(()=>({}));return !!d.user}';
    const newValidate='async function validateToken(token){try{const p=token.split(".");if(p.length!==2)return false;const raw=p[0].replace(/-/g,"+").replace(/_/g,"/");const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw+"===".slice((raw.length+3)%4)),c=>c.charCodeAt(0))));return !!payload.sub&&Number(payload.exp)>Math.floor(Date.now()/1000)}catch(_){return false}}';
    const patched=src.replace(oldValidate,newValidate).replaceAll(API_OLD,API_NEW);
    if(patched===src)throw new Error("auth source patch failed");
    (0,eval)(patched);
    return window.IrratiGISAuth;
  }).catch(err=>{
    console.error("IrratiGIS auth bridge:",err);
    const el=document.createElement("div");el.style.cssText="position:fixed;inset:0;z-index:2147483647;background:#fff;padding:30px;font:16px system-ui;color:#8b2f2f";el.textContent="Ezin izan da autentifikazio-modulua kargatu.";document.body.appendChild(el);throw err;
  });
})();
