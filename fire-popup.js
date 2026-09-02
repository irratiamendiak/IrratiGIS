(function(){"use strict";
function loadFirms(){
  if(document.getElementById("irratiFirmsScript"))return;
  const s=document.createElement("script");s.id="irratiFirmsScript";s.src="firms.js?v=20260902-01";s.defer=true;document.head.appendChild(s);
}
function boot(){
  try{if(typeof window.loadControlledBurns==="function")window.loadControlledBurns()}catch(e){console.error(e)}
  const f=()=>{const a=document.querySelectorAll(".leaflet-control-layers-overlays input.leaflet-control-layers-selector");for(const i of a){const t=(i.closest("label")?.textContent||"").toLowerCase();if(t.includes("baimendutako")||t.includes("erreketak")||t.includes("quemas autorizadas")){if(!i.checked)i.click();loadFirms();return true}}loadFirms();return false};
  if(f())return;setTimeout(f,300);setTimeout(f,1000);setTimeout(f,2000);setTimeout(f,4000)
}
window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot}
})();