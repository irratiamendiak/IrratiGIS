/* ============================================================
   IrratiGIS · gis-tools.js
   Editor propio de vértices (sin Geoman):
   - Editatu (mover vértices)
   - Puntua gehitu (añadir vértice en un tramo)
   - Puntua ezabatu (borrar vértice)
   Reutiliza la capa window.drawings, window.currentRings y
   window.redrawRings / recalcFromRings / setCurrentRings.
   Carga en index.html: <script src="gis-tools.js?v=10" defer></script>
   ============================================================ */
(() => {
  "use strict";

  function waitFor(){
    return new Promise(resolve=>{
      const t=setInterval(()=>{
        if(window.IrratiGISMap && typeof L!=="undefined" && window.drawings && window.redrawRings){
          clearInterval(t); resolve();
        }
      },300);
    });
  }

  function getRings(){
    const r = window.getCurrentRings ? window.getCurrentRings() : null;
    return Array.isArray(r) ? r.map(ring=>ring.map(c=>[c[0],c[1]])) : null;
  }
  function setRings(rings){
    if(window.setCurrentRings) window.setCurrentRings(rings);
    if(window.redrawRings) window.redrawRings(rings);
    if(window.recalcFromRings) window.recalcFromRings(rings);
    renderHandles();
  }
  function isClosed(ring){
    if(ring.length<4) return false;
    const a=ring[0], b=ring[ring.length-1];
    return Math.abs(a[0]-b[0])<1e-12 && Math.abs(a[1]-b[1])<1e-12;
  }

  const MODES = { NONE:"none", MOVE:"move", ADD:"add", DEL:"del" };
  let mode = MODES.NONE;
  let handleLayer = null;
  let midLayer = null;
  let map = null;

  function clearHandles(){
    if(handleLayer){ handleLayer.clearLayers(); }
    if(midLayer){ midLayer.clearLayers(); }
  }

  function renderHandles(){
    if(!handleLayer){ handleLayer = L.layerGroup().addTo(map); }
    if(!midLayer){ midLayer = L.layerGroup().addTo(map); }
    clearHandles();
    if(mode===MODES.NONE) return;
    const rings = getRings();
    if(!rings) return;

    rings.forEach((ring, ri)=>{
      const closed = isClosed(ring);
      const nVis = closed ? ring.length-1 : ring.length;
      for(let vi=0; vi<nVis; vi++){
        const [lon,lat]=ring[vi];
        const color = mode===MODES.DEL ? "#d7191c" : (mode===MODES.ADD ? "#888" : "#176b43");
        const h = L.circleMarker([lat,lon], {
          radius:7, weight:2, color:"#fff", fillColor:color, fillOpacity:1,
          pane:"markerPane", bubblingMouseEvents:false
        });
        h.__ri=ri; h.__vi=vi;
        if(mode===MODES.MOVE){ makeDraggable(h, ri, vi); }
        else if(mode===MODES.DEL){ h.on("click",(ev)=>{ L.DomEvent.stop(ev); deleteVertex(ri, vi); }); }
        h.addTo(handleLayer);
      }
      if(mode===MODES.ADD){
        const lim = closed ? ring.length-1 : ring.length-1;
        for(let vi=0; vi<lim; vi++){
          const a=ring[vi], b=ring[vi+1];
          const midLon=(a[0]+b[0])/2, midLat=(a[1]+b[1])/2;
          const mid = L.circleMarker([midLat,midLon], {
            radius:6, weight:2, color:"#fff", fillColor:"#2d8f5a", fillOpacity:.9,
            dashArray:"2", pane:"markerPane", bubblingMouseEvents:false
          });
          mid.on("click",(ev)=>{ L.DomEvent.stop(ev); addVertex(ri, vi+1, [midLon,midLat]); });
          mid.addTo(midLayer);
        }
      }
    });
  }

  function makeDraggable(handle, ri, vi){
    let dragging=false;
    handle.on("mousedown", onDown);
    handle.on("touchstart", onDown, {passive:false});
    function onDown(ev){
      dragging=true;
      map.dragging.disable();
      L.DomEvent.stop(ev.originalEvent||ev);
      map.on("mousemove", onMove);
      map.on("touchmove", onMove);
      map.on("mouseup", onUp);
      map.on("touchend", onUp);
    }
    function onMove(ev){
      if(!dragging) return;
      handle.setLatLng(ev.latlng);
    }
    function onUp(ev){
      if(!dragging) return;
      dragging=false;
      map.dragging.enable();
      map.off("mousemove", onMove); map.off("touchmove", onMove);
      map.off("mouseup", onUp); map.off("touchend", onUp);
      const ll = handle.getLatLng();
      const rings = getRings();
      if(!rings || !rings[ri]) return;
      rings[ri][vi] = [ll.lng, ll.lat];
      if(isClosed(rings[ri]) && vi===0){ rings[ri][rings[ri].length-1] = [ll.lng, ll.lat]; }
      setRings(rings);
    }
  }

  function deleteVertex(ri, vi){
    const rings = getRings();
    if(!rings || !rings[ri]) return;
    const ring = rings[ri];
    const closed = isClosed(ring);
    const uniqueCount = closed ? ring.length-1 : ring.length;
    if(uniqueCount <= (closed?3:2)){
      const msg=document.getElementById("message"); if(msg) msg.textContent="Ezin dira puntu gehiago kendu.";
      return;
    }
    ring.splice(vi,1);
    if(closed){ ring[ring.length-1] = [ring[0][0], ring[0][1]]; }
    setRings(rings);
  }

  function addVertex(ri, insertAt, lonlat){
    const rings = getRings();
    if(!rings || !rings[ri]) return;
    rings[ri].splice(insertAt, 0, lonlat);
    setRings(rings);
  }

  function buildControl(){
    const Ctl = L.Control.extend({
      options:{position:"topright"},
      onAdd:function(){
        const div = L.DomUtil.create("div","leaflet-bar irrati-edit-bar");
        div.style.cssText="background:#fff;display:flex;flex-direction:column";
        const mk=(title,html,onClick)=>{
          const a=L.DomUtil.create("a","",div);
          a.href="#"; a.title=title; a.innerHTML=html;
          a.style.cssText="width:34px;height:34px;line-height:34px;text-align:center;font-size:17px;cursor:pointer;color:#176b43";
          L.DomEvent.on(a,"click",(e)=>{ L.DomEvent.stop(e); onClick(a); });
          return a;
        };
        const bMove=mk("Editatu (puntuak mugitu)","✏️",()=>toggleMode(MODES.MOVE));
        const bAdd =mk("Puntua gehitu","➕",()=>toggleMode(MODES.ADD));
        const bDel =mk("Puntua ezabatu","🗑️",()=>toggleMode(MODES.DEL));
        div.__btns={move:bMove,add:bAdd,del:bDel};
        L.DomEvent.disableClickPropagation(div);
        window.__irratiEditBar=div;
        return div;
      }
    });
    return new Ctl();
  }

  function highlightButtons(){
    const bar=window.__irratiEditBar;
    if(!bar||!bar.__btns) return;
    const {move,add,del}=bar.__btns;
    [move,add,del].forEach(b=>{ b.style.background="#fff"; b.style.color="#176b43"; });
    if(mode===MODES.MOVE){ move.style.background="#176b43"; move.style.color="#fff"; }
    if(mode===MODES.ADD){ add.style.background="#176b43"; add.style.color="#fff"; }
    if(mode===MODES.DEL){ del.style.background="#d7191c"; del.style.color="#fff"; }
  }

  function toggleMode(target){
    mode = (mode===target) ? MODES.NONE : target;
    highlightButtons();
    renderHandles();
    const msg=document.getElementById("message");
    if(msg){
      msg.textContent = mode===MODES.MOVE?"Editatze modua: arrastatu puntuak."
        : mode===MODES.ADD?"Gehitze modua: sakatu tarteko puntuetan puntu berria sartzeko."
        : mode===MODES.DEL?"Ezabatze modua: sakatu puntu bat kentzeko."
        : "Edizioa geldituta.";
    }
  }

  let control=null;
  function showControl(){ if(!control){ control=buildControl(); } map.addControl(control); setTimeout(highlightButtons,50); }
  function hideControl(){ mode=MODES.NONE; clearHandles(); if(control){ try{ map.removeControl(control); }catch(_){} } }

  function updateVisibility(){
    const tv=document.getElementById("irratiTracksView");
    const active = tv && tv.classList.contains("active");
    if(active) showControl(); else hideControl();
  }

  async function init(){
    await waitFor();
    map = window.IrratiGISMap;
    const tv=document.getElementById("irratiTracksView");
    if(tv){ new MutationObserver(updateVisibility).observe(tv,{attributes:true,attributeFilter:["class"]}); }
    setTimeout(updateVisibility,500);
    document.querySelectorAll(".irrati-tab").forEach(b=> b.addEventListener("click", ()=> setTimeout(updateVisibility,150)));
    console.log("IrratiGIS editor de vértices listo.");
  }

  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();
