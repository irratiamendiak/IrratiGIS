(()=>{
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  let layer=null;
  let checkbox=null;
  let row=null;
  let loading=false;
  let observer=null;
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
    if(!layer)layer=L.layerGroup();
    loading=true;
    status("…");
    try{
      const r=await fetch(`${API}/api/firms?days=1`,{headers:{Authorization:`Bearer ${t}`}});
      const raw=await r.text();
      let d={};
      try{d=JSON.parse(raw)}catch(_){d={error:raw.slice(0,180)}}
      if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
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
      status(e.message||"Errorea",true);
      if(checkbox)checkbox.checked=false;
      if(layer&&leafletMap.hasLayer(layer))leafletMap.removeLayer(layer);
    }finally{loading=false;}
  }

  function toggle(){
    const leafletMap=getMap();
    if(!leafletMap||!layer)return;
    if(checkbox?.checked)load();
    else{
      layer.clearLayers();
      if(leafletMap.hasLayer(layer))leafletMap.removeLayer(layer);
      status("");
    }
  }

  function installLayerRow(){
    const control=document.querySelector(".leaflet-control-layers");
    const overlays=control?.querySelector(".leaflet-control-layers-overlays");
    if(!overlays)return false;
    const existing=overlays.querySelector(".irrati-firms-layer-row");
    if(existing){
      row=existing;
      checkbox=existing.querySelector("input");
      return true;
    }

    row=document.createElement("label");
    row.className="irrati-firms-layer-row";
    const input=document.createElement("input");
    input.type="checkbox";
    input.className="leaflet-control-layers-selector";
    input.setAttribute("aria-label","NASA FIRMS");
    row.appendChild(input);
    row.appendChild(document.createTextNode(" 🚨 NASA FIRMS"));
    overlays.appendChild(row);
    checkbox=input;
    checkbox.addEventListener("change",toggle);

    if(!document.getElementById("irratiFirmsLayerStyle")){
      const style=document.createElement("style");
      style.id="irratiFirmsLayerStyle";
      style.textContent=`.irrati-firms-layer-row{display:block;line-height:1.5;cursor:pointer}.irrati-firms-layer-row input{margin-right:6px}.irrati-firms-layer-status{margin-left:6px;font-size:10px;color:#65736b}.irrati-firms-layer-status.error{color:#8b2f2f}`;
      document.head.appendChild(style);
    }
    return true;
  }

  function setup(){
    const leafletMap=getMap();
    if(!leafletMap||typeof L==="undefined"){setTimeout(setup,300);return;}
    if(!layer)layer=L.layerGroup();
    document.querySelector(".irrati-firms-badge")?.remove();
    if(installLayerRow())return;
    if(!observer){
      observer=new MutationObserver(()=>installLayerRow());
      observer.observe(document.body,{childList:true,subtree:true});
    }
    setTimeout(installLayerRow,300);
    setTimeout(installLayerRow,1000);
    setTimeout(installLayerRow,2000);
  }

  function boot(){
    try{if(typeof window.loadControlledBurns==="function")window.loadControlledBurns()}catch(e){console.error("Erreketa baimenduak:",e)}
    setup();
  }

  window.IrratiGISFirms={
    get layer(){return layer},
    load,
    open:()=>{if(installLayerRow()&&checkbox){checkbox.checked=true;toggle();}}
  };
  window.IrratiGISFirePopup={
    loadBurnsIntoLayer:boot,
    hookLayerControl:setup,
    openFirms:()=>window.IrratiGISFirms.open()
  };
  boot();
})();