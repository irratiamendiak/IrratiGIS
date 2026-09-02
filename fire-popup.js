(()=>{
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  let layer=null;
  let loading=false;
  let timer=null;
  const token=()=>window.IrratiGISAuth?.getToken?.()||"";
  const getMap=()=>typeof map!=="undefined"?map:null;

  function getLayer(){
    if(!layer)layer=window.IrratiGISFirmsLayer||null;
    if(!layer&&typeof L!=="undefined")layer=L.layerGroup();
    if(layer)window.IrratiGISFirmsLayer=layer;
    return layer;
  }

  function addLeafletRow(){
    const leafletMap=getMap(),firmsLayer=getLayer();
    if(!leafletMap||!firmsLayer||typeof L==="undefined")return false;
    const lists=document.querySelectorAll(".leaflet-control-layers-list");
    if(!lists.length)return false;
    let added=false;
    lists.forEach(list=>{
      if(list.querySelector("[data-irrati-firms-row]"))return;
      const row=document.createElement("div");
      row.setAttribute("data-irrati-firms-row","1");
      row.style.cssText="display:block;line-height:24px;white-space:nowrap;";
      const input=document.createElement("input");
      input.type="checkbox";
      input.className="leaflet-control-layers-selector";
      input.checked=leafletMap.hasLayer(firmsLayer);
      input.style.margin="4px 5px 0 4px";
      input.addEventListener("change",()=>{
        if(input.checked){firmsLayer.addTo(leafletMap);load();}
        else leafletMap.removeLayer(firmsLayer);
      });
      const span=document.createElement("span");
      span.textContent="🚨 NASA FIRMS";
      row.appendChild(input);
      row.appendChild(span);
      list.appendChild(row);
      added=true;
    });
    return added||document.querySelector("[data-irrati-firms-row]")!==null;
  }

  function registerLayerControl(){
    addLeafletRow();
    [100,300,700,1500,3000].forEach(ms=>setTimeout(addLeafletRow,ms));
    if(!timer)timer=setInterval(addLeafletRow,2000);
  }

  async function load(){
    if(loading)return;
    const leafletMap=getMap(),firmsLayer=getLayer();
    if(!leafletMap||typeof L==="undefined"||!firmsLayer)return;
    const t=token();
    if(!t)return;
    loading=true;
    try{
      const r=await fetch(`${API}/api/firms?days=1`,{headers:{Authorization:`Bearer ${t}`} });
      const raw=await r.text();
      let d={};try{d=JSON.parse(raw)}catch(_){d={error:raw.slice(0,180)}}
      if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
      firmsLayer.clearLayers();
      for(const f of(d.fires||[])){
        const lat=Number(f.latitude),lon=Number(f.longitude);
        if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
        const m=L.circleMarker([lat,lon],{radius:6,weight:2,fillOpacity:.85});
        m.bindPopup(`<strong>🛰️ NASA FIRMS</strong><br>Data: ${f.acqDate||"—"}<br>Ordua: ${f.acqTime||"—"}<br>Satelitea: ${f.satellite||"—"}<br>Konfiantza: ${f.confidence??"—"}<br>FRP: ${f.frp??"—"} MW<br>Koordenatuak: ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
        firmsLayer.addLayer(m);
      }
    }catch(e){
      console.error("FIRMS:",e);
      firmsLayer.clearLayers();
      if(leafletMap.hasLayer(firmsLayer))leafletMap.removeLayer(firmsLayer);
    }finally{loading=false;}
  }

  function boot(){
    try{if(typeof window.loadControlledBurns==="function")window.loadControlledBurns()}catch(e){console.error("Erreketa baimenduak:",e)}
    const leafletMap=getMap();
    if(!leafletMap)return;
    getLayer();
    registerLayerControl();
    leafletMap.off("overlayadd",onOverlayAdd);
    leafletMap.on("overlayadd",onOverlayAdd);
    leafletMap.off("overlayremove",onOverlayRemove);
    leafletMap.on("overlayremove",onOverlayRemove);
  }

  function onOverlayAdd(e){
    if(e?.layer===getLayer()){
      document.querySelectorAll("[data-irrati-firms-row] input").forEach(i=>i.checked=true);
      load();
    }
  }

  function onOverlayRemove(e){
    if(e?.layer===getLayer())document.querySelectorAll("[data-irrati-firms-row] input").forEach(i=>i.checked=false);
  }

  window.IrratiGISFirms={get layer(){return getLayer()},load,registerLayerControl,open:()=>{const m=getMap(),l=getLayer();if(m&&l){registerLayerControl();l.addTo(m);load()}}};
  window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot,openFirms:()=>window.IrratiGISFirms.open()};
  boot();
})();