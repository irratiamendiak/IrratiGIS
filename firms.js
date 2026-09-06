(()=>{
  "use strict";
  // Compatibilidad: FIRMS se gestiona ahora desde fire-popup.js.
  // Este archivo no crea una segunda capa Leaflet para evitar que el
  // control y los marcadores queden separados.
  function handoff(){
    const m=window.IrratiGISFirePopup;
    if(m&&typeof m.hookLayerControl==="function")m.hookLayerControl();
    else setTimeout(handoff,300);
  }
  handoff();
})();
