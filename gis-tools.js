/* ============================================================
   IrratiGIS · gis-tools.js
   Fase 2: edición de GPX/KML cargados con Leaflet-Geoman
   Edita los tracks/polígonos reales y recalcula superficie/perímetro.
   Carga en index.html: <script src="gis-tools.js?v=3" defer></script>
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
      const t=setInterval(()=>{ if(window.IrratiGISMap && typeof L!=="undefined"){ clearInterval(t); resolve(window.IrratiGISMap); } },300);
    });
  }
  function ensurePm(map){
    if(map.pm) return true;
    try{ if(L.PM && L.PM.Map){ map.pm = new L.PM.Map(map); } }catch(_){}
    if(map.pm) return true;
    try{ if(L.PM && typeof L.PM.reInitLayer==="function"){ L.PM.reInitLayer(map); } }catch(_){}
    return !!map.pm;
  }

  function isEditableGeom(layer){
    return (layer instanceof L.Polygon) || (layer instanceof L.Polyline);
  }
  function isNumberMarker(layer){
    return (layer instanceof L.CircleMarker) && !(layer instanceof L.Polygon) && !(layer instanceof L.Polyline);
  }

  function ringsFromDrawings(drawings){
    const rings=[];
    drawings.eachLayer(layer=>{
      if(!isEditableGeom(layer)) return;
      let latlngs = layer.getLatLngs();
      const isPoly = (layer instanceof L.Polygon);
      const coordsArr = isPoly ? (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs) : latlngs;
      const ring = coordsArr.map(p=>[p.lng,p.lat]);
      if(isPoly && ring.length>=3){
        const first=ring[0], last=ring[ring.length-1];
        if(first[0]!==last[0] || first[1]!==last[1]) ring.push([first[0],first[1]]);
      }
      if(ring.length>=2) rings.push(ring);
    });
    return rings;
  }

  async function init(){
    const map = await waitForMap();
    loadCss(GEOMAN_CSS);
    try{ await loadScript(GEOMAN_JS); }catch(e){ console.error("Geoman:",e); return; }
    for(let i=0;i<10 && !ensurePm(map);i++){ await new Promise(r=>setTimeout(r,200)); }
    if(!map.pm){ console.warn("Geoman: no se pudo enganchar al mapa"); return; }
    try{ map.pm.setLang("eu"); }catch(_){ try{ map.pm.setLang("es"); }catch(__){} }

    const drawings = window.drawings;
    if(!drawings){ console.warn("gis-tools: window.drawings no disponible"); return; }

    const toolbarOpts = {
      position: "topright",
      drawMarker: false, drawPolyline: false, drawPolygon: false,
      drawCircle: false, drawCircleMarker: false, drawRectangle: false, drawText: false,
      editMode: true, dragMode: true, cutPolygon: false, removalMode: true, rotateMode: false
    };
    function showToolbar(){ try{ map.pm.addControls(toolbarOpts); }catch(_){} }
    function hideToolbar(){ try{ map.pm.removeControls(); }catch(_){} }

    function setNumberMarkersVisible(visible){
      drawings.eachLayer(layer=>{
        if(isNumberMarker(layer)){
          const el = layer.getElement && layer.getElement();
          if(el) el.style.display = visible ? "" : "none";
        }
      });
    }

    function recalc(){
      try{
        const rings = ringsFromDrawings(drawings);
        if(!rings.length) return;
        if(window.setCurrentRings) window.setCurrentRings(rings);
        if(window.recalcFromRings) window.recalcFromRings(rings);
        const msg=document.getElementById("message");
        if(msg) msg.textContent="Geometria editatua: azalera eta perimetroa eguneratu dira.";
      }catch(e){ console.warn("recalc:",e); }
    }

    map.on("pm:globaleditmodetoggled", (e)=>{
      if(e.enabled){ setNumberMarkersVisible(false); }
      else { setNumberMarkersVisible(true); recalc(); }
    });
    map.on("pm:globaldragmodetoggled", (e)=>{
      if(!e.enabled) recalc();
    });
    map.on("pm:edit", ()=> recalc());
    map.on("pm:dragend", ()=> recalc());
    map.on("pm:remove", ()=> recalc());

    function updateToolbarVisibility(){
      const tv = document.getElementById("irratiTracksView");
      const active = tv && tv.classList.contains("active");
      if(active) showToolbar(); else { hideToolbar(); setNumberMarkersVisible(true); }
    }
    const tv = document.getElementById("irratiTracksView");
    if(tv){ new MutationObserver(updateToolbarVisibility).observe(tv,{attributes:true,attributeFilter:["class"]}); }
    setTimeout(updateToolbarVisibility, 500);
    document.querySelectorAll(".irrati-tab").forEach(b=> b.addEventListener("click", ()=> setTimeout(updateToolbarVisibility,150)));

    console.log("IrratiGIS GIS tresnak: edición de GPX/KML lista.");
  }

  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();
