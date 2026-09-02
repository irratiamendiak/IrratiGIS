(()=>{
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  let layer=null;
  let checkbox=null;
  let row=null;
  let loading=false;
  const token=()=>window.IrratiGISAuth?.getToken?.()||"";
  const getMap=()=>typeof map!=="undefined"?map:null;

  function status(text,error=false){
    if(!row)return;
    let s=row.querySelector(".irrati-firms-layer-status");
    if(!s){s=document.createElement("span");s.className="irrati-firms-layer-status";row.appendChild(s);}
    s.textContent=text;
    s.classList.toggle("error",error);
  }

  async function load(){
    if(loading)return;
    const leafletMap=getMap();
    if(!leafletMap||typeof L==="undefined")return;
    const t=token();
    if(!t){status("Saioa beharrezkoa",true);if(checkbox)checkbox.checked=false;return;}
    loading=true;
    status("…");
    try{
      const r=await fetch(`${API}/api/firms?days=1`,{headers:{Authorization:`Bearer ${t}`}});
      const raw=await r.text();
      let d={};
      try{d=JSON.parse(raw)}catch(_){d={error:raw.slice(0,180)}}
      if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
      if(!layer)layer=L.layerGroup();
      layer.clearLayers();
      for(const f of(d.fires||[])){
        const lat=Number(f.latitude),lon=Number(f.longitude);
        if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
        const m=L.circleMarker([lat,lon],{radius:6,weight:2,fillOpacity:.85});
        m.bindPopup(`<strong>🛰️ NASA FIRMS</strong><br>Data: ${f.acqDate||"—"}<br>Ordua: ${f.acqTime||"—"}<br>Satelitea: ${f.satellite||"—"}<br>Konfiantza: ${f.confidence??"—"}<br>FRP: ${f.frp??"—"} MW<br>Koordenatuak: ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
        layer.addLayer(m);
      }
      if(checkbox?.checked&&!leafletMap.hasLayer(layer))layer.addTo(leafletMap);
      status(`${(d.fires||[]).length}`);
    }catch(e){
      console.error("FIRMS:",e);
      status("Errorea",true);
      if(checkbox)checkbox.checked=false;
      if(layer&&leafletMap.hasLayer(layer))leafletMap.removeLayer(layer);
    }finally{loading=false;}
  }

  function toggle(){
    const leafletMap=getMap();
    if(!leafletMap||!layer)return;
    if(checkbox?.checked)load();
    else {layer.clearLayers();if(leafletMap.hasLayer(layer))leafletMap.removeLayer(layer);status("");}
  }

  function installLayerRow(){
    if(row&&document.body.contains(row))return true;
    const control=document.querySelector(".leaflet-control-layers");
    const overlays=control?.querySelector(".leaflet-control-layers-overlays");
    if(!overlays)return false;
    if(overlays.querySelector(".irrati-firms-layer-row"))return true;
    row=document.createElement("label");
    row.className="leaflet-control-layers-selector irrati-firms-layer-row";
    row.style.cssText="display:block;position:relative;padding-left:4px;";
    row.innerHTML=`<input type="checkbox" class="irrati-firms-layer-check"><span>🚨 NASA FIRMS</span>`;
    overlays.appendChild(row);
    checkbox=row.querySelector(".irrati-firms-layer-check");
    checkbox.addEventListener("change",toggle);
    const style=document.createElement("style");
    style.textContent=`.irrati-firms-layer-row{display:flex!important;align-items:center;gap:6px;line-height:1.5;cursor:pointer}.irrati-firms-layer-row input{margin:0 4px 0 0}.irrati-firms-layer-status{margin-left:4px;font-size:10px;color:#65736b}.irrati-firms-layer-status.error{color:#8b2f2f}`;
    document.head.appendChild(style);
    return true;
  }

  function setup(){
    if(!layer&&typeof L!=="undefined")layer=L.layerGroup();
    document.querySelector(".irrati-firms-badge")?.remove();
    if(installLayerRow())return;
    setTimeout(setup,500);
  }

  function boot(){
    try{if(typeof window.loadControlledBurns==="function")window.loadControlledBurns();}catch(e){console.error("Erreketa baimenduak:",e)}
    setup();
  }

  window.IrratiGISFirms={layer,load,open:()=>{if(!checkbox)installLayerRow();if(checkbox){checkbox.checked=true;toggle();}}};
  window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot,openFirms:()=>{window.IrratiGISFirms?.open?.()}};
  boot();
})();