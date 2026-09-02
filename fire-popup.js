(()=>{
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  let layer=null,loading=false,rowBound=false;
  const token=()=>window.IrratiGISAuth?.getToken?.()||"";
  const getMap=()=>window.IrratiGISMap||null;
  function getLayer(){
    if(!layer)layer=window.IrratiGISFirmsLayer||null;
    if(!layer&&typeof L!=="undefined")layer=L.featureGroup();
    if(layer)window.IrratiGISFirmsLayer=layer;
    return layer;
  }
  function ensureRow(){
    const map=getMap(),firms=getLayer();
    if(!map||!firms)return null;
    const list=document.querySelector(".leaflet-control-layers-overlays");
    if(!list)return null;
    const rows=[...list.querySelectorAll("[data-irrati-firms-row]")];
    rows.slice(1).forEach(r=>r.remove());
    let row=list.querySelector(".irrati-firms-layer-row")||list.querySelector("[data-irrati-firms-row]");
    if(!row){
      row=document.createElement("label");
      row.className="irrati-firms-layer-row";
      row.setAttribute("data-irrati-firms-row","1");
      row.style.display="block";
      const input=document.createElement("input");
      input.type="checkbox";input.className="leaflet-control-layers-selector";
      row.appendChild(input);
      const span=document.createElement("span");span.textContent=" 🚨 NASA FIRMS";row.appendChild(span);
      list.appendChild(row);
    }
    const input=row.querySelector("input");
    if(input&&!rowBound){
      rowBound=true;
      input.addEventListener("change",()=>{if(input.checked){firms.addTo(map);load()}else map.removeLayer(firms)});
    }
    if(input)input.checked=map.hasLayer(firms);
    return input;
  }
  function coords(f){
    let lat=f?.latitude??f?.lat??f?.y,lon=f?.longitude??f?.lon??f?.lng??f?.x;
    if((lat==null||lon==null)&&Array.isArray(f?.geometry?.coordinates))[lon,lat]=f.geometry.coordinates;
    lat=Number(lat);lon=Number(lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)?[lat,lon]:null;
  }
  function items(d){return Array.isArray(d?.fires)?d.fires:Array.isArray(d?.detections)?d.detections:Array.isArray(d?.data)?d.data:Array.isArray(d?.features)?d.features:[]}
  async function load(){
    if(loading)return;
    const map=getMap(),firms=getLayer(),t=token();
    if(!map||!firms||typeof L==="undefined"||!t)return;
    loading=true;
    try{
      const r=await fetch(`${API}/api/firms?days=5`,{headers:{Authorization:`Bearer ${t}`}});
      const raw=await r.text();let d={};
      try{d=JSON.parse(raw)}catch(_){throw new Error(`FIRMS erantzuna ez da JSON: ${raw.slice(0,160)}`)}
      if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
      firms.clearLayers();let count=0;
      for(const f of items(d)){
        const c=coords(f);if(!c)continue;
        const m=L.circleMarker(c,{radius:7,weight:2,color:"#b30000",fillColor:"#ff3b00",fillOpacity:.9});
        m.bindPopup(`<strong>🛰️ NASA FIRMS</strong><br>Data: ${f.acqDate||f.acq_date||"—"}<br>Ordua: ${f.acqTime||f.acq_time||"—"}<br>Satelitea: ${f.satellite||f.satellite_name||"—"}<br>Konfiantza: ${f.confidence??f.confidence_pct??"—"}<br>FRP: ${f.frp??"—"} MW<br>Koordenatuak: ${c[0].toFixed(5)}, ${c[1].toFixed(5)}`);
        firms.addLayer(m);count++;
      }
      if(count>0)firms.addTo(map);
      const input=ensureRow();if(input)input.checked=count>0;
      console.info(`IrratiGIS FIRMS: ${count} detekzio`,d);
    }catch(e){console.error("IrratiGIS FIRMS:",e);firms.clearLayers()}
    finally{loading=false}
  }
  function boot(){const map=getMap(),firms=getLayer();if(!map||!firms)return;ensureRow();setTimeout(ensureRow,500);setTimeout(load,1200)}
  window.IrratiGISFirms={get layer(){return getLayer()},load,registerLayerControl:ensureRow,open:()=>{const m=getMap(),l=getLayer();if(m&&l){ensureRow();l.addTo(m);load()}}};
  window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot,openFirms:()=>window.IrratiGISFirms.open()};
  boot();
})();
