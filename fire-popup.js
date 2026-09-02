(function(){"use strict";
function loadFirms(){
  const old=document.getElementById("irratiFirmsScript");
  if(old)old.remove();
  const s=document.createElement("script");s.id="irratiFirmsScript";s.src="firms.js?v=20260902-03";s.defer=true;s.onload=()=>setTimeout(()=>window.IrratiGISFirms?.open?.(),50);document.head.appendChild(s);
}
function boot(){
  try{if(typeof window.loadControlledBurns==="function")window.loadControlledBurns()}catch(e){console.error(e)}
  loadFirms();
}
window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot};
})();