(()=>{
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  let layer=null;
  let loading=false;
  let timer=null;
  let control=null;

  const token=()=>window.IrratiGISAuth?.getToken?.()||"";

  function getMap(){
    if(window.IrratiGISMap) return window.IrratiGISMap;
    if(typeof L==="undefined")return null;
    const el=document.getElementById("map");
    if(!el)return null;
    try{
      const events=el._leaflet_events||{};
      for(const key of Object.keys(events)){
        const entry=events[key],ctx=entry&&entry.ctx;
        if(ctx&&typeof ctx.getContainer==="function"&&ctx.getContainer()===el){
          window.IrratiGISMap=ctx;
          return ctx;
        }
      }
    }catch(e){console.warn("IrratiGIS: ezin izan da Leaflet mapa berreskuratu.",e)}
    return null;
  }

  function getLayer(){
    if(!layer)layer=window.IrratiGISFirmsLayer||null;
    if(!layer&&typeof L!=="undefined")layer=L.featureGroup();
    if(layer)window.IrratiGISFirmsLayer=layer;
    return layer;
  }

  // Aurretik sortutako Leaflet Control.Layers objektua aurkitu.
  // Leaflet-ek zoomend listener-aren ctx gisa kontrola gordetzen du.
  function getLayerControl(){
    if(control&&control._map)return control;
    const m=getMap();
    if(!m)return null;
    try{
      const events=m._events||{};
      const zoom=events.zoomend;
      const list=Array.isArray(zoom)?zoom:[zoom];
      for(const entry of list){
        const ctx=entry&&entry.ctx;
        if(ctx&&typeof ctx.addOverlay==="function"&&ctx._overlaysList&&ctx._layers){
          control=ctx;
          return ctx;
        }
      }
    }catch(e){console.warn("IrratiGIS: geruzen kontrola ezin izan da aurkitu.",e)}
    return null;
  }

  function installNativeOverlay(){
    const m=getMap(),l=getLayer(),c=getLayerControl();
    if(!m||!l||!c)return false;

    const exists=c._layers?.some(x=>x&&x.layer===l);
    if(!exists)c.addOverlay(l,"🚨 NASA FIRMS");
    return true;
  }

  function addFallbackRow(){
    const m=getMap(),l=getLayer();
    if(!m||!l||typeof L==="undefined")return false;
    const lists=document.querySelectorAll(".leaflet-control-layers-overlays");
    if(!lists.length)return false;
    let added=false;
    lists.forEach(list=>{
      if(list.querySelector("[data-irrati-firms-row]"))return;
      const row=document.createElement("label");
      row.setAttribute("data-irrati-firms-row","1");
      row.style.cssText="display:block;line-height:24px;white-space:nowrap;";
      const input=document.createElement("input");
      input.type="checkbox";
      input.className="leaflet-control-layers-selector";
      input.checked=m.hasLayer(l);
      input.addEventListener("change",()=>{
        if(input.checked){l.addTo(m);load()}else m.removeLayer(l);
      });
      const span=document.createElement("span");
      span.textContent=" 🚨 NASA FIRMS";
      row.append(input,span);
      list.appendChild(row);
      added=true;
    });
    return added;
  }

  function registerLayerControl(){
    if(installNativeOverlay())return true;
    addFallbackRow();
    [100,300,700,1500,3000].forEach(ms=>setTimeout(()=>{
      if(!installNativeOverlay())addFallbackRow();
    },ms));
    if(!timer)timer=setInterval(()=>{
      if(installNativeOverlay()){
        clearInterval(timer);
        timer=null;
      }else addFallbackRow();
    },1000);
    return true;
  }

  async function load(){
    if(loading)return;
    const m=getMap(),l=getLayer();
    if(!m||typeof L==="undefined"||!l)return;
    const t=token();
    if(!t)return;
    loading=true;
    try{
      const r=await fetch(`${API}/api/firms?days=1`,{headers:{Authorization:`Bearer ${t}`}});
      const raw=await r.text();
      let d={};
      try{d=JSON.parse(raw)}catch(_){d={error:raw.slice(0,180)}}
      if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);

      l.clearLayers();
      for(const f of(d.fires||[])){
        const lat=Number(f.latitude),lon=Number(f.longitude);
        if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
        const marker=L.circleMarker([lat,lon],{radius:6,weight:2,fillOpacity:.85});
        marker.bindPopup(
          `<strong>🛰️ NASA FIRMS</strong><br>`+
          `Data: ${f.acqDate||"—"}<br>`+
          `Ordua: ${f.acqTime||"—"}<br>`+
          `Satelitea: ${f.satellite||"—"}<br>`+
          `Konfiantza: ${f.confidence??"—"}<br>`+
          `FRP: ${f.frp??"—"} MW<br>`+
          `Koordenatuak: ${lat.toFixed(5)}, ${lon.toFixed(5)}`
        );
        l.addLayer(marker);
      }

      if(!m.hasLayer(l))l.addTo(m);
      registerLayerControl();
    }catch(e){
      console.error("FIRMS:",e);
      l.clearLayers();
    }finally{loading=false}
  }

  function onOverlayAdd(e){
    if(e?.layer===getLayer())load();
  }
  function onOverlayRemove(e){
    if(e?.layer===getLayer()){
      document.querySelectorAll("[data-irrati-firms-row] input").forEach(i=>i.checked=false);
    }
  }

  function boot(){
    const m=getMap();
    if(!m)return;
    getLayer();
    registerLayerControl();
    m.off("overlayadd",onOverlayAdd);
    m.on("overlayadd",onOverlayAdd);
    m.off("overlayremove",onOverlayRemove);
    m.on("overlayremove",onOverlayRemove);
  }

  window.IrratiGISFirms={
    get layer(){return getLayer()},
    load,
    registerLayerControl,
    open:()=>{
      const m=getMap(),l=getLayer();
      if(m&&l){
        registerLayerControl();
        l.addTo(m);
        load();
      }
    }
  };

  window.IrratiGISFirePopup={
    loadBurnsIntoLayer:boot,
    hookLayerControl:boot,
    openFirms:()=>window.IrratiGISFirms.open()
  };

  boot();
})();