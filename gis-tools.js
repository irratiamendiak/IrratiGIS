/* ============================================================
   IrratiGIS · gis-tools.js  (v22)
   Edición de vértices (GPX/KML) + conversor de coordenadas
   compacto flotante (con campos propios, sin tocar el original).
   Carga en index.html: <script src="gis-tools.js?v=22" defer></script>
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
    mk("sharePoint","📍↗️","Kokapena partekatu",()=>toggleShare());
    mk("measureDist","📏","Distantzia neurtu",()=>toggleMeasure());
  }

  // ---- Conversor de coordenadas compacto (panel flotante propio) ----
  let coordPanel=null, coordBtn=null;
  function buildCoordPanel(){
    if(document.getElementById("coordFloatBtn")) return;
    const bar=document.querySelector(".icon-tools");
    const mapEl=document.getElementById("map");
    if(!bar || !mapEl) return;

    // Botón icono
    coordBtn=document.createElement("button");
    coordBtn.id="coordFloatBtn"; coordBtn.type="button"; coordBtn.title="Koordenatu bihurgailua"; coordBtn.innerHTML="📐";
    coordBtn.addEventListener("click",togglePanel);
    bar.appendChild(coordBtn);

    // Panel flotante con campos PROPIOS (no toca el conversor original)
    coordPanel=document.createElement("div");
    coordPanel.id="coordFloatPanel";
    coordPanel.style.cssText="position:absolute;right:8px;top:70px;z-index:1200;width:min(280px,82vw);background:#fff;border:1px solid #dce5df;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);padding:12px;display:none;font:13px system-ui;color:#16231c";
    coordPanel.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<strong style="font-size:14px;color:#176b43">📐 Koordenatuak</strong>'+
      '<button type="button" id="cfClose" style="border:0;background:#eef3ef;border-radius:7px;padding:4px 8px;cursor:pointer;font-weight:800">✕</button></div>'+
      '<label style="display:block;font-size:10px;font-weight:800;color:#65736b;margin:6px 0 3px">UTM X · Y</label>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
        '<input id="cfX" type="number" step="0.01" placeholder="X" style="width:100%;border:1px solid #cfdad3;border-radius:8px;padding:7px;font:inherit">'+
        '<input id="cfY" type="number" step="0.01" placeholder="Y" style="width:100%;border:1px solid #cfdad3;border-radius:8px;padding:7px;font:inherit"></div>'+
      '<label style="display:block;font-size:10px;font-weight:800;color:#65736b;margin:8px 0 3px">Zona · Datuma</label>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
        '<select id="cfZone" style="width:100%;border:1px solid #cfdad3;border-radius:8px;padding:7px;font:inherit"></select>'+
        '<select id="cfDatum" style="width:100%;border:1px solid #cfdad3;border-radius:8px;padding:7px;font:inherit"><option value="ETRS89">ETRS89</option><option value="WGS84">WGS84</option></select></div>'+
      '<label style="display:block;font-size:10px;font-weight:800;color:#65736b;margin:8px 0 3px">Lat · Lon</label>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'+
        '<input id="cfLat" type="number" step="0.0000001" placeholder="Lat" style="width:100%;border:1px solid #cfdad3;border-radius:8px;padding:7px;font:inherit">'+
        '<input id="cfLon" type="number" step="0.0000001" placeholder="Lon" style="width:100%;border:1px solid #cfdad3;border-radius:8px;padding:7px;font:inherit"></div>'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">'+
        '<button type="button" id="cfU2G" style="flex:1 1 auto;border:0;border-radius:8px;padding:8px 6px;font-size:11px;font-weight:750;cursor:pointer;background:#edf3ef;color:#234233">UTM→Geo</button>'+
        '<button type="button" id="cfG2U" style="flex:1 1 auto;border:0;border-radius:8px;padding:8px 6px;font-size:11px;font-weight:750;cursor:pointer;background:#edf3ef;color:#234233">Geo→UTM</button>'+
        '<button type="button" id="cfPick" style="flex:1 1 auto;border:0;border-radius:8px;padding:8px 6px;font-size:11px;font-weight:750;cursor:pointer;background:#edf3ef;color:#234233">Mapatik</button>'+
        '<button type="button" id="cfGoogle" style="flex:1 1 auto;border:0;border-radius:8px;padding:8px 6px;font-size:11px;font-weight:750;cursor:pointer;background:#edf3ef;color:#234233">Google</button></div>'+
      '<div id="cfResult" style="margin-top:9px;padding:8px;border-radius:8px;background:#f7faf8;border:1px solid #e2e8e4;font-size:12px;overflow-wrap:anywhere">Sartu koordenatuak.</div>';
    mapEl.appendChild(coordPanel);
    L.DomEvent.disableClickPropagation(coordPanel);
    L.DomEvent.disableScrollPropagation(coordPanel);

    // Rellenar zonas 1..60 (por defecto 30)
    const zsel=coordPanel.querySelector("#cfZone");
    for(let z=1;z<=60;z++){ const o=document.createElement("option"); o.value=String(z); o.textContent=String(z); if(z===30)o.selected=true; zsel.appendChild(o); }

    const $=id=>document.getElementById(id);
    const orig={ X:$("utmE"),Y:$("utmN"),Zone:$("utmZone"),Hem:$("utmHem"),Datum:$("utmDatum"),Lat:$("geoLat"),Lon:$("geoLon"),Res:$("coordResult") };

    coordPanel.querySelector("#cfClose").addEventListener("click",()=>setPanel(false));

    // UTM -> Geo: copia a los campos originales, pulsa el botón original, trae resultado
    coordPanel.querySelector("#cfU2G").addEventListener("click",()=>{
      orig.X.value=$("cfX").value; orig.Y.value=$("cfY").value;
      orig.Zone.value=$("cfZone").value; orig.Datum.value=$("cfDatum").value; orig.Hem.value="N";
      $("utmToGeo").click();
      $("cfLat").value=orig.Lat.value; $("cfLon").value=orig.Lon.value;
      showResult(orig.Res);
    });
    coordPanel.querySelector("#cfG2U").addEventListener("click",()=>{
      orig.Lat.value=$("cfLat").value; orig.Lon.value=$("cfLon").value;
      orig.Datum.value=$("cfDatum").value;
      $("geoToUtm").click();
      $("cfX").value=orig.X.value; $("cfY").value=orig.Y.value; $("cfZone").value=orig.Zone.value;
      showResult(orig.Res);
    });
    coordPanel.querySelector("#cfPick").addEventListener("click",()=>{
      $("pickCoord").click(); // activa el modo coger-del-mapa original
      setMsg("Egin klik mapan puntu bat hartzeko.");
      // Cuando el original rellene lat/lon, los copiamos (observamos el resultado)
      const chk=setInterval(()=>{
        if(orig.Lat.value){ $("cfLat").value=orig.Lat.value; $("cfLon").value=orig.Lon.value; $("cfX").value=orig.X.value; $("cfY").value=orig.Y.value; showResult(orig.Res); clearInterval(chk); }
      },400);
      setTimeout(()=>clearInterval(chk),15000);
    });
    coordPanel.querySelector("#cfGoogle").addEventListener("click",()=>{
      orig.Lat.value=$("cfLat").value; orig.Lon.value=$("cfLon").value;
      $("googleMaps").click();
    });

    function showResult(origRes){ const r=$("cfResult"); if(r&&origRes) r.innerHTML=origRes.innerHTML||origRes.textContent||"—"; }

    // Ocultar el panel grande original (sin moverlo)
    const big = orig.X.closest(".panel");
    if(big) big.style.display="none";
  }
  function setPanel(open){
    if(!coordPanel) return;
    coordPanel.style.display = open ? "block" : "none";
    if(open){ coordBtn.classList.add("active"); coordBtn.style.background="#176b43"; coordBtn.style.color="#fff"; }
    else { coordBtn.classList.remove("active"); coordBtn.style.background=""; coordBtn.style.color=""; }
  }
  function togglePanel(){ setPanel(coordPanel && coordPanel.style.display==="none"); }


  // ---- Modo "compartir punto": clic en el mapa -> popup con Kopiatu/Partekatu ----
  let shareMode=false;
  function toggleShare(){
    shareMode=!shareMode;
    const b=document.getElementById("sharePoint");
    if(b){ if(shareMode){ b.style.background="#176b43"; b.style.color="#fff"; } else { b.style.background=""; b.style.color=""; } }
    const mapEl=map&&map.getContainer&&map.getContainer();
    if(mapEl) mapEl.style.cursor = shareMode ? "crosshair" : "";
    setMsg(shareMode?"Sakatu mapan puntu bat partekatzeko.":"");
    if(shareMode){ map.on("click",onShareClick); } else { map.off("click",onShareClick); }
  }
  function onShareClick(e){
    const lat=e.latlng.lat, lon=e.latlng.lng;
    const txt = window.irratiPointShareText ? window.irratiPointShareText(lat,lon) : (lat.toFixed(6)+", "+lon.toFixed(6));
    const btns = window.irratiShareButtons ? window.irratiShareButtons({titulo:"Kokapena",lat:lat,lon:lon}) : "";
    const u = window.toUtm30 ? null : null;
    let utmLine="";
    try{ if(typeof proj4!=="undefined"){ const p=proj4("+proj=longlat +datum=WGS84 +no_defs","+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs",[lon,lat]); utmLine="<br><strong>UTM (ETRS89 30N):</strong> X "+Math.round(p[0])+" · Y "+Math.round(p[1]); } }catch(_){}
    const html="<strong>Kokapena</strong><br><br><strong>Geografikoak:</strong> "+lat.toFixed(6)+", "+lon.toFixed(6)+utmLine+btns;
    L.popup({closeButton:true}).setLatLng(e.latlng).setContent(html).openOn(map);
    // desactivar el modo tras un uso
    shareMode=false;
    const b=document.getElementById("sharePoint"); if(b){ b.style.background=""; b.style.color=""; }
    if(map&&map.getContainer) map.getContainer().style.cursor="";
    map.off("click",onShareClick);
  }


  // ---- Regla: medir distancias ----
  let measureMode=false, measurePts=[], measureLayer=null, measureBadge=null;
  function fmtDist(m){
    if(m>=1000) return (m/1000).toLocaleString("eu-ES",{minimumFractionDigits:2,maximumFractionDigits:2})+" km";
    return m.toLocaleString("eu-ES",{minimumFractionDigits:0,maximumFractionDigits:0})+" m";
  }
  function measureTotal(){
    if(measurePts.length<2) return 0;
    let tot=0;
    for(let i=1;i<measurePts.length;i++){
      try{ tot+=turf.distance([measurePts[i-1].lng,measurePts[i-1].lat],[measurePts[i].lng,measurePts[i].lat],{units:"meters"}); }catch(_){}
    }
    return tot;
  }
  function showMeasureBadge(txt){
    const mapEl=map.getContainer();
    if(!measureBadge){
      measureBadge=document.createElement("div");
      measureBadge.id="measureBadge";
      measureBadge.style.cssText="position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:1200;background:#176b43;color:#fff;border-radius:9px;padding:7px 12px;box-shadow:0 2px 10px rgba(0,0,0,.3);font:800 13px system-ui;pointer-events:none;white-space:nowrap";
      mapEl.appendChild(measureBadge);
    }
    measureBadge.textContent=txt;
    measureBadge.style.display="block";
  }
  function hideMeasureBadge(){ if(measureBadge) measureBadge.style.display="none"; }
  function redrawMeasure(){
    if(!measureLayer) measureLayer=L.layerGroup().addTo(map);
    measureLayer.clearLayers();
    if(measurePts.length){
      // línea
      if(measurePts.length>=2){
        L.polyline(measurePts,{color:"#176b43",weight:3,dashArray:"6,4"}).addTo(measureLayer);
      }
      // puntos
      measurePts.forEach((p,i)=>{
        L.circleMarker(p,{radius:5,weight:2,color:"#fff",fillColor:"#176b43",fillOpacity:1}).addTo(measureLayer);
      });
    }
    const tot=measureTotal();
    showMeasureBadge(measurePts.length<2?"Distantzia: sakatu bigarren puntua":("Distantzia: "+fmtDist(tot)));
  }
  function toggleMeasure(){
    measureMode=!measureMode;
    const b=document.getElementById("measureDist");
    if(b){ if(measureMode){ b.style.background="#176b43"; b.style.color="#fff"; } else { b.style.background=""; b.style.color=""; } }
    const mapEl=map.getContainer();
    if(mapEl) mapEl.style.cursor = measureMode ? "crosshair" : "";
    if(measureMode){
      // desactivar otros modos
      if(shareMode) toggleShare();
      measurePts=[]; redrawMeasure();
      showMeasureBadge("Distantzia: sakatu lehen puntua");
      map.on("click",onMeasureClick);
      map.on("dblclick",onMeasureEnd);
      map.doubleClickZoom.disable();
      setMsg("Neurtze modua: sakatu mapan puntuak. Bukatzeko, klik bikoitza edo sakatu berriro 📏.");
       }else{
      map.off("click",onMeasureClick);
      map.off("dblclick",onMeasureEnd);
      map.doubleClickZoom.enable();
      if(mapEl) mapEl.style.cursor="";
      setMsg("");
      const tot=measureTotal();
      if(measurePts.length>=2){ showMeasureBadge("Distantzia: "+fmtDist(tot)); computeSlope(tot); }
    }
  }
  function onMeasureClick(e){ measurePts.push(e.latlng); redrawMeasure(); }
  function onMeasureEnd(e){
    if(e&&e.originalEvent) L.DomEvent.stop(e.originalEvent);
    // termina el modo pero deja la medición dibujada
    measureMode=false;
    const b=document.getElementById("measureDist"); if(b){ b.style.background=""; b.style.color=""; }
    map.off("click",onMeasureClick); map.off("dblclick",onMeasureEnd);
    map.doubleClickZoom.enable();
    const mapEl=map.getContainer(); if(mapEl) mapEl.style.cursor="";
    const tot=measureTotal();
    showMeasureBadge("Distantzia: "+fmtDist(tot));
    // Consultar altitudes al IGN y calcular pendiente (primer vs último punto)
    if(measurePts.length>=2){ computeSlope(tot); }
  }
  async function computeSlope(distM){
    const a=measurePts[0], b=measurePts[measurePts.length-1];
    showMeasureBadge("Distantzia: "+fmtDist(distM)+" · altuera kargatzen…");
    try{
      const wkt="MULTIPOINT("+a.lng+" "+a.lat+", "+b.lng+" "+b.lat+")";
      const r=await fetch("https://api-processes.idee.es/processes/getElevation/execution",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({inputs:{crs:4326,formato:"wkt",geom:wkt,withCoord:true,outputFormat:"array"}})
      });
      const j=await r.json();
      const vals=j&&j.values;
      if(!Array.isArray(vals)||vals.length<2) throw new Error("altitud");
      const z1=Number(vals[0][2]), z2=Number(vals[1][2]);
      if(!Number.isFinite(z1)||!Number.isFinite(z2)) throw new Error("altitud");
      const desnivel=z2-z1;
      const pct = distM>0 ? (desnivel/distM*100) : 0;
      const grados = distM>0 ? (Math.atan2(desnivel,distM)*180/Math.PI) : 0;
      const nf=(n,d)=>n.toLocaleString("eu-ES",{minimumFractionDigits:d,maximumFractionDigits:d});
      showMeasureBadge("Distantzia: "+fmtDist(distM)+" · Desnibela: "+nf(desnivel,1)+" m · Malda: "+nf(pct,1)+"% ("+nf(grados,1)+"°)");
    }catch(err){
      showMeasureBadge("Distantzia: "+fmtDist(distM)+" · (ezin izan da altuera lortu)");
    }
  }
  // Limpiar medición al pulsar "Track-a ezabatu"
  function clearMeasure(){ measurePts=[]; if(measureLayer) measureLayer.clearLayers(); hideMeasureBadge(); if(measureMode) toggleMeasure(); }

  async function init(){
    await waitFor();
    map=window.IrratiGISMap;
    addButtons();
    try{ buildCoordPanel(); }catch(e){ console.warn("coord panel:",e); }
    const clearBtn=document.getElementById("clearTrack");
    if(clearBtn) clearBtn.addEventListener("click",()=>{ mode=MODES.NONE; highlight(); clearHandles(); clearMeasure(); });
    console.log("IrratiGIS editor + conversor listo (v22).");
  }
  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded",init); }
  else { init(); }
})();
