/* ============================================================
   IrratiGIS · gis-tools.js
   Fase 2: edición de geometrías con Leaflet-Geoman (Community)
   Se carga desde index.html con: <script src="gis-tools.js?v=2" defer></script>
   ============================================================ */
(() => {
  "use strict";

  const GEOMAN_CSS = "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css";
  const GEOMAN_JS  = "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.min.js";

  function loadCss(href){
    if(document.querySelector(`link[href="${href}"]`)) return;
    const l=document.createElement("link"); l.rel="stylesheet"; l.href=href; document.head.appendChild(l);
  }
  function loadScript(src){
    return new Promise((resolve,reject)=>{
      if(document.querySelector(`script[src="${src}"]`)){ resolve(); return; }
      const s=document.createElement("script"); s.src=src; s.onload=()=>resolve(); s.onerror=()=>reject(new Error("No se pudo cargar "+src));
      document.head.appendChild(s);
    });
  }

  function waitForMap(){
    return new Promise(resolve=>{
      const t=setInterval(()=>{
        if(window.IrratiGISMap && typeof L!=="undefined"){ clearInterval(t); resolve(window.IrratiGISMap); }
      },300);
    });
  }

  function ensurePm(map){
    if(map.pm) return true;
    try{ if(L.PM && L.PM.Map){ map.pm = new L.PM.Map(map); } }catch(_){}
    if(map.pm) return true;
    try{ if(L.PM && typeof L.PM.reInitLayer==="function"){ L.PM.reInitLayer(map); } }catch(_){}
    return !!map.pm;
  }

  async function init(){
    const map = await waitForMap();
    loadCss(GEOMAN_CSS);
    try{ await loadScript(GEOMAN_JS); }catch(e){ console.error("Geoman:",e); return; }

    for(let i=0;i<10 && !ensurePm(map);i++){ await new Promise(r=>setTimeout(r,200)); }
    if(!map.pm){ console.warn("Geoman: no se pudo enganchar al mapa (map.pm ausente)"); return; }

    try{ map.pm.setLang("eu"); }catch(_){ try{ map.pm.setLang("es"); }catch(__){} }

    const editLayer = (window.drawings) ? window.drawings : L.featureGroup().addTo(map);
    window.IrratiGISEditLayer = editLayer;

    const toolbarOpts = {
      position: "topright",
      drawMarker: true,
      drawPolyline: true,
      drawPolygon: true,
      drawCircle: false,
      drawCircleMarker: false,
      drawRectangle: true,
      drawText: false,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      removalMode: true,
      rotateMode: false
    };

    function showToolbar(){ try{ map.pm.addControls(toolbarOpts); }catch(_){} }
    function hideToolbar(){ try{ map.pm.removeControls(); }catch(_){} }

    map.on("pm:create", (e) => {
      try{ if(e.layer){ e.layer.addTo(editLayer); } }catch(_){}
    });

    function updateToolbarVisibility(){
      const tracksView = document.getElementById("irratiTracksView");
      const active = tracksView && tracksView.classList.contains("active");
      if(active) showToolbar(); else hideToolbar();
    }

    const tracksView = document.getElementById("irratiTracksView");
    if(tracksView){
      const obs = new MutationObserver(updateToolbarVisibility);
      obs.observe(tracksView,{attributes:true,attributeFilter:["class"]});
    }
    setTimeout(updateToolbarVisibility, 500);
    document.querySelectorAll(".irrati-tab").forEach(b=>{
      b.addEventListener("click", ()=> setTimeout(updateToolbarVisibility, 150));
    });

    console.log("IrratiGIS GIS tresnak: Geoman listo. map.pm =", !!map.pm);
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded", init);
  }else{
    init();
  }
})();
