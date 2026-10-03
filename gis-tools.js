/* ============================================================
   IrratiGIS · gis-tools.js  (v21)
   Edición de vértices + conversor de coordenadas compacto.
   Carga en index.html: <script src="gis-tools.js?v=21" defer></script>
   ============================================================ */
(() => {
  "use strict";

  function waitFor(){
    return new Promise(resolve=>{
      const t=setInterval(()=>{
        if(window.IrratiGISMap && typeof L!=="undefined" && window.drawings &&
           window.redrawRings && window.getCurrentRings && document.querySelector(".icon-tools") && document.getElementById("utmE")){
          clearInterval(t); resolve();
        }
      },300);
    });
  }

  let map=null;
  const MODES={NONE:"none",MOVE:"move",ADD:"add",DEL:"del"};
  let mode=MODES.NONE;
  let handleLayer=null, midLayer=null;
  let btnMove=null, btnAdd=null, btnDel=null;

  function getRings(){
    const r = window.getCurrentRings ? window.getCurrentRings() : null;
    return Array.isArray(r) && r.length ? r.map(ring=>ring.map(c=>[c[0],c[1]])) : null;
  }
  function applyRings(rings){
    if(window.setCurrentRings) window.setCurrentRings(rings);
    if(window.redrawRings) window.redrawRings(rings);
    if(window.recalcFromRings) window.recalcFromRings(rings);
    renderHandles();
  }
  function isClosed(ring){
    if(ring.length<4) return false;
    const a=ring[0], b=ring[ring.length-1];
    return Math.abs(a[0]-b[0])<1e-9 && Math.abs(a[1]-b[1])<1e-9;
  }

  function clearHandles(){ if(handleLayer) handleLayer.clearLayers(); if(midLayer) midLayer.clearLayers(); }

  function renderHandles(){
    if(!handleLayer) handleLayer=L.layerGroup().addTo(map);
    if(!midLayer) midLayer=L.layerGroup().addTo(map);
    clearHandles();
    if(mode===MODES.NONE) return;
    const rings=getRings();
    if(!rings){ return; }

    rings.forEach((ring,ri)=>{
      const closed=isClosed(ring);
      const nVis=closed?ring.length-1:ring.length;
      for(let vi=0; vi<nVis; vi++){
        const [lon,lat]=ring[vi];
        const color = mode===MODES.DEL?"#d7191c":"#176b43";
        const h=L.circleMarker([lat,lon],{radius:7,weight:2,color:"#fff",fillColor:color,fillOpacity:1,bubblingMouseEvents:false});
        if(mode===MODES.MOVE) makeDraggable(h,ri,vi);
        else if(mode===MODES.DEL) h.on("click",(e)=>{L.DomEvent.stop(e);deleteVertex(ri,vi);});
        h.addTo(handleLayer);
      }
      if(mode===MODES.ADD){
        const lim=closed?ring.length-1:ring.length-1;
        for(let vi=0; vi<lim; vi++){
          const a=ring[vi], b=ring[vi+1];
          const ml=L.circleMarker([(a[1]+b[1])/2,(a[0]+b[0])/2],{radius:6,weight:2,color:"#fff",fillColor:"#2d8f5a",fillOpacity:.9,bubblingMouseEvents:false});
          ml.on("click",(e)=>{L.DomEvent.stop(e);addVertex(ri,vi+1,[(a[0]+b[0])/2,(a[1]+b[1])/2]);});
          ml.addTo(midLayer);
        }
      }
    });
  }

  function makeDraggable(handle,ri,vi){
    let dragging=false;
    handle.on("mousedown",onDown); handle.on("touchstart",onDown);
    function onDown(ev){ dragging=true; map.dragging.disable(); L.DomEvent.stop(ev.originalEvent||ev);
      map.on("mousemove",onMove); map.on("touchmove",onMove); map.on("mouseup",onUp); map.on("touchend",onUp); }
    function onMove(ev){ if(dragging) handle.setLatLng(ev.latlng); }
    function onUp(){ if(!dragging) return; dragging=false; map.dragging.enable();
      map.off("mousemove",onMove); map.off("touchmove",onMove); map.off("mouseup",onUp); map.off("touchend",onUp);
      const ll=handle.getLatLng(); const rings=getRings(); if(!rings||!rings[ri]) return;
      rings[ri][vi]=[ll.lng,ll.lat];
      if(isClosed(rings[ri]) && vi===0) rings[ri][rings[ri].length-1]=[ll.lng,ll.lat];
      applyRings(rings);
    }
  }

  function deleteVertex(ri,vi){
    const rings=getRings(); if(!rings||!rings[ri]) return;
    const ring=rings[ri], closed=isClosed(ring);
    const unique=closed?ring.length-1:ring.length;
    if(unique<=(closed?3:2)){ setMsg("Ezin dira puntu gehiago kendu."); return; }
    ring.splice(vi,1);
    if(closed) ring[ring.length-1]=[ring[0][0],ring[0][1]];
    applyRings(rings);
  }

  function addVertex(ri,at,lonlat){
    const rings=getRings(); if(!rings||!rings[ri]) return;
    rings[ri].splice(at,0,lonlat); applyRings(rings);
  }

  function setMsg(t){ const m=document.getElementById("message"); if(m) m.textContent=t; }

  function highlight(){
    [[btnMove,MODES.MOVE,"#176b43"],[btnAdd,MODES.ADD,"#176b43"],[btnDel,MODES.DEL,"#d7191c"]].forEach(([b,m,c])=>{
      if(!b) return;
      if(mode===m){ b.style.background=c; b.style.color="#fff"; b.classList.add("active"); }
      else { b.style.background=""; b.style.color=""; b.classList.remove("active"); }
    });
  }

  function toggle(target){
    if(target!==MODES.NONE && !getRings()){ setMsg("Lehenengo kargatu GPX/KML bat editatzeko."); return; }
    mode = (mode===target)?MODES.NONE:target;
    highlight(); renderHandles();
    setMsg(mode===MODES.MOVE?"Editatze modua: arrastatu puntuak."
      :mode===MODES.ADD?"Gehitze modua: sakatu tarteko puntu berdeetan."
      :mode===MODES.DEL?"Ezabatze modua: sakatu puntu gorri bat kentzeko."
      :"Edizioa geldituta.");
  }

  function addButtons(){
    const bar=document.querySelector(".icon-tools");
    if(!bar || document.getElementById("editMove")) return;
    const mk=(id,icon,title,onClick)=>{
      const b=document.createElement("button");
      b.id=id; b.type="button"; b.title=title; b.innerHTML=icon;
      b.addEventListener("click",onClick);
      bar.appendChild(b); return b;
    };
    btnMove=mk("editMove","🖐️","Puntuak editatu/mugitu",()=>toggle(MODES.MOVE));
    btnAdd =mk("editAdd","➕·","Puntua gehitu",()=>toggle(MODES.ADD));
    btnDel =mk("editDel","✖️·","Puntua ezabatu",()=>toggle(MODES.DEL));
  }

  // ---- Conversor de coordenadas compacto (panel flotante) ----
  let coordPanel=null, coordBtn=null;
  function buildCoordPanel(){
    if(document.getElementById("coordFloatBtn")) return;
    const bar=document.querySelector(".icon-tools");
    if(!bar) return;

    coordBtn=document.createElement("button");
    coordBtn.id="coordFloatBtn"; coordBtn.type="button"; coordBtn.title="Koordenatu bihurgailua"; coordBtn.innerHTML="📐";
    coordBtn.addEventListener("click",togglePanel);
    bar.appendChild(coordBtn);

    const mapEl=document.getElementById("map");
    if(!mapEl) return;
    coordPanel=document.createElement("div");
    coordPanel.id="coordFloatPanel";
    coordPanel.style.cssText="position:absolute;right:8px;top:70px;z-index:1200;width:min(290px,80vw);background:#fff;border:1px solid #dce5df;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);padding:12px;display:none;font:13px system-ui";
    coordPanel.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:14px;color:#176b43">📐 Koordenatuak</strong>
        <button type="button" id="coordFloatClose" style="border:0;background:#eef3ef;border-radius:7px;padding:4px 8px;cursor:pointer;font-weight:800">✕</button>
      </div>
      <div id="coordFloatBody"></div>`;
    mapEl.appendChild(coordPanel);
    L.DomEvent.disableClickPropagation(coordPanel);
    L.DomEvent.disableScrollPropagation(coordPanel);
    coordPanel.querySelector("#coordFloatClose").addEventListener("click",()=>{coordPanel.style.display="none";coordBtn.classList.remove("active");coordBtn.style.background="";coordBtn.style.color="";});

    const body=coordPanel.querySelector("#coordFloatBody");
    const L2=(txt)=>{const l=document.createElement("label");l.textContent=txt;l.style.cssText="display:block;font-size:10px;font-weight:800;color:#65736b;margin:7px 0 3px";return l;};
    const row=()=>{const d=document.createElement("div");d.style.cssText="display:grid;grid-template-columns:1fr 1fr;gap:6px";return d;};

    const grab=(id)=>document.getElementById(id);
    const utmE=grab("utmE"), utmN=grab("utmN"), utmZone=grab("utmZone"), utmHem=grab("utmHem"), utmDatum=grab("utmDatum"),
          geoLat=grab("geoLat"), geoLon=grab("geoLon"), coordResult=grab("coordResult");
    const btnU2G=grab("utmToGeo"), btnG2U=grab("geoToUtm"), btnPick=grab("pickCoord"), btnCenter=grab("centerCoord"), btnCopy=grab("copyCoord"), btnGoogle=grab("googleMaps");

    if(!utmE){ body.innerHTML="<em>Bihurgailua ez dago eskuragarri.</em>"; return; }

    body.appendChild(L2("UTM X · Y"));
    const r1=row(); r1.appendChild(utmE); r1.appendChild(utmN); body.appendChild(r1);
    body.appendChild(L2("Zona · Datuma"));
    const r2=row(); r2.appendChild(utmZone); r2.appendChild(utmDatum); body.appendChild(r2);
    utmHem.style.display="none"; body.appendChild(utmHem);
    body.appendChild(L2("Lat · Lon"));
    const r3=row(); r3.appendChild(geoLat); r3.appendChild(geoLon); body.appendChild(r3);
    const bwrap=document.createElement("div"); bwrap.style.cssText="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px";
    [btnU2G,btnG2U,btnPick,btnCenter,btnGoogle].forEach(b=>{ if(b){ b.style.flex="1 1 auto"; b.style.minWidth="0"; b.style.fontSize="11px"; b.style.padding="8px 6px"; bwrap.appendChild(b); } });
    body.appendChild(bwrap);
    if(coordResult){ coordResult.style.marginTop="9px"; body.appendChild(coordResult); }

    [utmE,utmN,utmZone,utmHem,utmDatum,geoLat,geoLon].forEach(el=>{ if(el){ el.style.padding="7px"; el.style.fontSize="13px"; el.style.width="100%"; } });

    const bigPanel = utmE.closest(".panel");
    if(bigPanel) bigPanel.style.display="none";
  }
  function togglePanel(){
    if(!coordPanel) return;
    const open = coordPanel.style.display==="none";
    coordPanel.style.display = open ? "block" : "none";
    if(open){ coordBtn.classList.add("active"); coordBtn.style.background="#176b43"; coordBtn.style.color="#fff"; }
    else { coordBtn.classList.remove("active"); coordBtn.style.background=""; coordBtn.style.color=""; }
  }

  async function init(){
    await waitFor();
    map=window.IrratiGISMap;
    addButtons();
    buildCoordPanel();
    const clearBtn=document.getElementById("clearTrack");
    if(clearBtn) clearBtn.addEventListener("click",()=>{ mode=MODES.NONE; highlight(); clearHandles(); });
    console.log("IrratiGIS editor + conversor listo.");
  }

  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",init); }
  else { init(); }
})();
