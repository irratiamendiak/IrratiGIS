// IrratiGIS — integración de quemas autorizadas con el mapa existente
(function(){
  "use strict";

  function showDiagnostic(){
    function add(){
      if(document.getElementById("irratiFireDiagnostic")) return;
      const badge=document.createElement("div");
      badge.id="irratiFireDiagnostic";
      badge.textContent="🔥 PRUEBA: fire-popup.js cargado";
      badge.style.cssText="position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#fff3cd;color:#664d03;border:2px solid #ffca2c;border-radius:10px;padding:10px 14px;font:800 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 3px 14px rgba(0,0,0,.28);pointer-events:none";
      document.body.appendChild(badge);
    }
    if(document.body) add(); else document.addEventListener("DOMContentLoaded",add,{once:true});
  }

  function addMapContainerTest(){
    const mapEl=document.getElementById("map");
    if(!mapEl) return false;
    if(getComputedStyle(mapEl).position==="static") mapEl.style.position="relative";
    const old=document.getElementById("irratiMapFireTest");
    if(old) old.remove();
    const wrap=document.createElement("div");
    wrap.id="irratiMapFireTest";
    wrap.style.cssText="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:999999;cursor:pointer;pointer-events:auto;text-align:center";
    wrap.innerHTML='<div style="font-size:58px;line-height:60px;text-shadow:0 2px 5px rgba(0,0,0,.65)">🔥</div><div style="background:#fff;padding:5px 9px;border-radius:8px;font:800 12px system-ui;color:#176b43;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap">PRUEBA QUEMA</div>';
    wrap.addEventListener("click",function(){alert("🧪 PRUEBA — la capa de quemas puede dibujar en el mapa.\n\nEste marcador no es una quema real.");});
    mapEl.appendChild(wrap);
    return true;
  }

  function boot(){
    showDiagnostic();
    addMapContainerTest();
    setTimeout(addMapContainerTest,500);
    setTimeout(addMapContainerTest,1500);
    setTimeout(addMapContainerTest,3000);
  }

  window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot};
})();