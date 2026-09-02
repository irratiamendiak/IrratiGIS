(()=>{
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  let panel=null;
  let layer=null;
  const token=()=>window.IrratiGISAuth?.getToken?.()||"";
  function getMap(){return (typeof map!=="undefined")?map:null;}
  function status(text,error=false){
    const el=panel?.querySelector(".irrati-firms-status");
    if(el){el.textContent=text;el.classList.toggle("error",error);}
  }
  async function load(){
    const days=Number(panel?.querySelector(".irrati-firms-days")?.value||1);
    const t=token();
    if(!t){status("Saioa ez dago aktibo.",true);return;}
    const leafletMap=getMap();
    if(!leafletMap||typeof L==="undefined"){status("Mapa ez dago prest.",true);return;}
    status("Detekzioak kargatzen…");
    try{
      const r=await fetch(`${API}/api/firms?days=${days}`,{headers:{Authorization:`Bearer ${t}`}});
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
      if(!leafletMap.hasLayer(layer))layer.addTo(leafletMap);
      status(`${(d.fires||[]).length} detekzio.`);
    }catch(e){console.error("FIRMS:",e);status(e.message||"Ezin izan dira FIRMS datuak kargatu.",true);}
  }
  function open(){
    if(!panel)setup();
    if(panel){panel.classList.add("open");setTimeout(load,50);}
  }
  function setup(){
    if(panel&&document.body.contains(panel))return;
    const mapEl=document.getElementById("map");
    const host=mapEl?.closest(".irrati-map-panel")||mapEl?.parentElement;
    if(!host)return setTimeout(setup,300);
    panel=document.createElement("div");
    panel.id="irratiFirmsPanel";
    panel.className="irrati-firms-panel";
    panel.innerHTML=`<div class="irrati-firms-box"><div class="irrati-firms-head"><strong>🛰️ NASA FIRMS</strong><button type="button" class="irrati-firms-close" aria-label="Itxi">×</button></div><label>Denbora-tartea</label><select class="irrati-firms-days"><option value="1">Azken 24 orduak</option><option value="2">Azken 48 orduak</option><option value="3">Azken 72 orduak</option><option value="5">Azken 5 egunak</option></select><div class="irrati-firms-actions"><button type="button" class="irrati-firms-load">🔥 Kargatu detekzioak</button><button type="button" class="irrati-firms-clear">Garbitu</button></div><div class="irrati-firms-status">Prest.</div><div class="irrati-firms-note">FIRMS satelite bidezko bero-detekzioak dira; ez dute berez sute baieztaturik esan nahi.</div></div>`;
    host.appendChild(panel);
    panel.querySelector(".irrati-firms-close").onclick=()=>panel.classList.remove("open");
    panel.querySelector(".irrati-firms-load").onclick=load;
    panel.querySelector(".irrati-firms-clear").onclick=()=>{if(layer)layer.clearLayers();status("Garbituta.");};
    const style=document.createElement("style");
    style.textContent=`.irrati-map-panel{position:relative}.irrati-firms-panel{display:none;position:absolute;top:74px;right:12px;z-index:10000;width:min(340px,calc(100% - 24px));pointer-events:auto}.irrati-firms-panel.open{display:block}.irrati-firms-box{background:#fff;border:1px solid var(--line,#ccd8d0);border-radius:14px;padding:12px;box-shadow:0 8px 28px rgba(0,0,0,.22);font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}.irrati-firms-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.irrati-firms-close{border:0;background:#eef3ef;border-radius:7px;padding:4px 9px;cursor:pointer;font-size:18px}.irrati-firms-box label{display:block;font-size:11px;font-weight:800;color:#65736b;margin:6px 0 4px}.irrati-firms-box select{width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccd8d0;border-radius:8px;background:#fff}.irrati-firms-actions{display:flex;gap:6px;margin-top:8px}.irrati-firms-actions button{flex:1;padding:8px 6px;border:1px solid #ccd8d0;border-radius:8px;cursor:pointer;font-weight:800}.irrati-firms-load{background:#176b43;color:#fff;border-color:#176b43!important}.irrati-firms-status{font-size:12px;color:#65736b;margin-top:8px}.irrati-firms-status.error{color:#8b2f2f}.irrati-firms-note{font-size:10px;color:#65736b;margin-top:8px;line-height:1.35}`;
    document.head.appendChild(style);
    window.IrratiGISFirms={open,load,layer};
  }
  function boot(){
    try{if(typeof window.loadControlledBurns==="function")window.loadControlledBurns();}catch(e){console.error("Erreketa baimenduak:",e)}
    setup();
  }
  window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot,openFirms:open};
  setup();
})();