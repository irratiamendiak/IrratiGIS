(()=>{
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  function token(){return window.IrratiGISAuth?.getToken?.()||"";}
  function setup(){
    if(document.getElementById("irratiFirmsControl"))return;
    const map=window.map;
    if(!map||typeof L==="undefined")return setTimeout(setup,500);
    const layer=L.layerGroup();
    const control=L.control({position:"topright"});
    control.onAdd=()=>{
      const div=L.DomUtil.create("div","firms-control");div.id="irratiFirmsControl";
      div.innerHTML=`<button type="button" class="firms-toggle">🛰️ FIRMS</button><div class="firms-panel"><div class="firms-head"><strong>🛰️ NASA FIRMS</strong><button type="button" class="firms-close">×</button></div><label>Denbora-tartea</label><select class="firms-days"><option value="1">Azken 24 orduak</option><option value="2">Azken 48 orduak</option><option value="3">Azken 72 orduak</option><option value="7">Azken 7 egunak</option></select><div class="firms-actions"><button type="button" class="firms-load">🔥 Kargatu detekzioak</button><button type="button" class="firms-clear">Garbitu</button></div><div class="firms-status">Prest.</div><div class="firms-note">FIRMS satelite bidezko bero-detekzioak dira; ez dute berez sute baieztaturik esan nahi.</div></div>`;
      L.DomEvent.disableClickPropagation(div);L.DomEvent.disableScrollPropagation(div);
      div.querySelector(".firms-toggle").onclick=()=>div.classList.add("open");
      div.querySelector(".firms-close").onclick=()=>div.classList.remove("open");
      div.querySelector(".firms-clear").onclick=()=>{layer.clearLayers();status("Garbituta.")};
      div.querySelector(".firms-load").onclick=async()=>{
        const days=Number(div.querySelector(".firms-days").value||1);status("Detekzioak kargatzen…");
        try{const r=await fetch(`${API}/api/firms?days=${days}`,{headers:{Authorization:`Bearer ${token()}`}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);layer.clearLayers();for(const f of (d.fires||[])){if(Number.isFinite(Number(f.latitude))&&Number.isFinite(Number(f.longitude))){const m=L.circleMarker([Number(f.latitude),Number(f.longitude)],{radius:6,weight:2,fillOpacity:.85});m.bindPopup(`<strong>🛰️ NASA FIRMS</strong><br>Data: ${f.acq_date||"—"}<br>Ordua: ${f.acq_time||"—"}<br>Satelitea: ${f.satellite||"—"}<br>Konfiantza: ${f.confidence??"—"}<br>FRP: ${f.frp??"—"} MW<br>Koordenatuak: ${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}`);layer.addLayer(m)}}if(!map.hasLayer(layer))layer.addTo(map);status(`${(d.fires||[]).length} detekzio.`)}catch(e){status(e.message||"Ezin izan dira FIRMS datuak kargatu.",true)}};
      function status(t,error=false){const s=div.querySelector(".firms-status");s.textContent=t;s.classList.toggle("error",error)}
      return div;
    };
    control.addTo(map);
    window.IrratiGISFirms={layer,control};
  }
  setup();
})();
