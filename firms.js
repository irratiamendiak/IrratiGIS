(()=>{
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  function token(){return window.IrratiGISAuth?.getToken?.()||"";}
  function setup(){
    if(document.getElementById("irratiFirmsControl"))return;
    const leafletMap=(typeof map!=="undefined")?map:null;
    if(!leafletMap||typeof L==="undefined")return setTimeout(setup,500);
    const layer=L.layerGroup();
    const control=L.control({position:"topright"});
    control.onAdd=()=>{
      const div=L.DomUtil.create("div","firms-control");div.id="irratiFirmsControl";
      div.innerHTML=`<button type="button" class="firms-toggle">🛰️ FIRMS</button><div class="firms-panel"><div class="firms-head"><strong>🛰️ NASA FIRMS</strong><button type="button" class="firms-close">×</button></div><label>Denbora-tartea</label><select class="firms-days"><option value="1">Azken 24 orduak</option><option value="2">Azken 48 orduak</option><option value="3">Azken 72 orduak</option><option value="5">Azken 5 egunak</option></select><div class="firms-actions"><button type="button" class="firms-load">🔥 Kargatu detekzioak</button><button type="button" class="firms-clear">Garbitu</button></div><div class="firms-status">Prest.</div><div class="firms-note">FIRMS satelite bidezko bero-detekzioak dira; ez dute berez sute baieztaturik esan nahi.</div></div>`;
      L.DomEvent.disableClickPropagation(div);L.DomEvent.disableScrollPropagation(div);
      div.querySelector(".firms-toggle").onclick=()=>div.classList.add("open");
      div.querySelector(".firms-close").onclick=()=>div.classList.remove("open");
      div.querySelector(".firms-clear").onclick=()=>{layer.clearLayers();status("Garbituta.")};
      div.querySelector(".firms-load").onclick=load;
      async function load(){
        const days=Number(div.querySelector(".firms-days").value||1);const t=token();
        if(!t){status("Saioa ez dago aktibo.",true);return}
        status("Detekzioak kargatzen…");
        try{const r=await fetch(`${API}/api/firms?days=${days}`,{headers:{Authorization:`Bearer ${t}`}});const raw=await r.text();let d={};try{d=JSON.parse(raw)}catch(_){d={error:raw.slice(0,180)}}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);layer.clearLayers();for(const f of(d.fires||[])){if(Number.isFinite(Number(f.latitude))&&Number.isFinite(Number(f.longitude))){const m=L.circleMarker([Number(f.latitude),Number(f.longitude)],{radius:6,weight:2,fillOpacity:.85});m.bindPopup(`<strong>🛰️ NASA FIRMS</strong><br>Data: ${f.acqDate||"—"}<br>Ordua: ${f.acqTime||"—"}<br>Satelitea: ${f.satellite||"—"}<br>Konfiantza: ${f.confidence??"—"}<br>FRP: ${f.frp??"—"} MW<br>Koordenatuak: ${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}`);layer.addLayer(m)}}if(!leafletMap.hasLayer(layer))layer.addTo(leafletMap);status(`${(d.fires||[]).length} detekzio.`)}catch(e){console.error("FIRMS:",e);status(e.message||"Ezin izan dira FIRMS datuak kargatu.",true)}}
      function status(t,error=false){const s=div.querySelector(".firms-status");s.textContent=t;s.classList.toggle("error",error)}
      div.classList.add("open");
      setTimeout(load,300);
      return div;
    };
    control.addTo(leafletMap);
    window.IrratiGISFirms={layer,control,open:()=>{const d=document.getElementById("irratiFirmsControl");if(d)d.classList.add("open")}};
    const style=document.createElement("style");style.textContent=`.firms-control{background:#fff;border-radius:6px;box-shadow:0 1px 5px rgba(0,0,0,.45);font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}.firms-toggle{height:34px;border:0;border-radius:6px;background:#fff;cursor:pointer;font-weight:900;padding:0 10px;white-space:nowrap}.firms-panel{display:block;width:min(330px,80vw);padding:10px}.firms-control:not(.open) .firms-panel{display:none}.firms-control.open .firms-toggle{display:none}.firms-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}.firms-close{border:0;background:#eef3ef;border-radius:7px;padding:4px 8px;cursor:pointer}.firms-panel label{display:block;font-size:11px;font-weight:800;color:#65736b;margin:6px 0 4px}.firms-panel select{width:100%;padding:8px;border:1px solid #ccd8d0;border-radius:8px;background:#fff}.firms-actions{display:flex;gap:6px;margin-top:8px}.firms-actions button{flex:1;padding:8px 6px}.firms-load{background:#176b43;color:#fff}.firms-status{font-size:12px;color:#65736b;margin-top:8px}.firms-status.error{color:#8b2f2f}.firms-note{font-size:10px;color:#65736b;margin-top:8px;line-height:1.35}`;document.head.appendChild(style);
  }
  setup();
})();
