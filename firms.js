(()=>{
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const METEOSAT_WMS="https://view.eumetsat.int/geoserver/wms";
  let pendingOpen=false;
  let meteosatLayer=null;
  let meteosatRowBound=false;
  function token(){return window.IrratiGISAuth?.getToken?.()||"";}
  function meteosatTime(){
    const d=new Date(Date.now()-20*60*1000);
    d.setUTCMinutes(Math.floor(d.getUTCMinutes()/15)*15,0,0);
    return d.toISOString();
  }
  function getMeteosatLayer(){
    if(meteosatLayer||typeof L==="undefined")return meteosatLayer;
    meteosatLayer=L.tileLayer.wms(METEOSAT_WMS,{
      layers:"msg_fes:fire",
      styles:"",
      format:"image/png",
      transparent:true,
      version:"1.3.0",
      opacity:.9,
      time:meteosatTime(),
      attribution:"© EUMETSAT"
    });
    window.IrratiGISMeteosatLayer=meteosatLayer;
    return meteosatLayer;
  }
  function ensureMeteosatRow(){
    const leafletMap=(typeof map!=="undefined")?map:null;
    const layer=getMeteosatLayer();
    const list=document.querySelector(".leaflet-control-layers-overlays");
    if(!leafletMap||!layer||!list)return null;
    let row=list.querySelector(".irrati-meteosat-layer-row");
    if(!row){
      row=document.createElement("label");
      row.className="irrati-meteosat-layer-row";
      row.style.display="block";
      const input=document.createElement("input");
      input.type="checkbox";
      input.className="leaflet-control-layers-selector";
      row.appendChild(input);
      const span=document.createElement("span");
      span.textContent=" 🌍 Meteosat - incendios";
      row.appendChild(span);
      list.appendChild(row);
    }
    const input=row.querySelector("input");
    if(input&&!meteosatRowBound){
      meteosatRowBound=true;
      input.addEventListener("change",()=>{
        const m=(typeof map!=="undefined")?map:null;
        const l=getMeteosatLayer();
        if(!m||!l)return;
        if(input.checked){
          l.setParams({time:meteosatTime()});
          l.addTo(m);
        }else{
          m.removeLayer(l);
        }
      });
    }
    if(input)input.checked=leafletMap.hasLayer(layer);
    return input;
  }
  function refreshMeteosat(){
    const m=(typeof map!=="undefined")?map:null;
    const l=getMeteosatLayer();
    if(!m||!l||!m.hasLayer(l))return;
    l.setParams({time:meteosatTime()});
  }
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
      function open(){div.classList.add("open");}
      async function load(){
        const days=Number(div.querySelector(".firms-days").value||1);const t=token();
        if(!t){status("Saioa ez dago aktibo.",true);return}
        status("Detekzioak kargatzen…");
        try{const r=await fetch(`${API}/api/firms?days=${days}`,{headers:{Authorization:`Bearer ${t}`}});const raw=await r.text();let d={};try{d=JSON.parse(raw)}catch(_){d={error:raw.slice(0,180)}}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);layer.clearLayers();for(const f of(d.fires||[])){if(Number.isFinite(Number(f.latitude))&&Number.isFinite(Number(f.longitude))){const m=L.circleMarker([Number(f.latitude),Number(f.longitude)],{radius:6,weight:2,fillOpacity:.85});m.bindPopup(`<strong>🛰️ NASA FIRMS</strong><br>Data: ${f.acqDate||"—"}<br>Ordua: ${f.acqTime||"—"}<br>Satelitea: ${f.satellite||"—"}<br>Konfiantza: ${f.confidence??"—"}<br>FRP: ${f.frp??"—"} MW<br>Koordenatuak: ${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}`);layer.addLayer(m)}}if(!leafletMap.hasLayer(layer))layer.addTo(leafletMap);status(`${(d.fires||[]).length} detekzio.`)}catch(e){console.error("FIRMS:",e);status(e.message||"Ezin izan dira FIRMS datuak kargatu.",true)}}
      function status(t,error=false){const s=div.querySelector(".firms-status");s.textContent=t;s.classList.toggle("error",error)}
      if(pendingOpen){open();pendingOpen=false;setTimeout(load,100);}
      return div;
    };
    control.addTo(leafletMap);
    window.IrratiGISFirms={layer,control,open:()=>{pendingOpen=true;const d=document.getElementById("irratiFirmsControl");if(d){d.classList.add("open");pendingOpen=false;setTimeout(()=>{const b=d.querySelector(".firms-load");if(b)b.click()},100);}}};
    window.IrratiGISMeteosat={layer:getMeteosatLayer(),refresh:refreshMeteosat,registerLayerControl:ensureMeteosatRow,open:()=>{const m=(typeof map!=="undefined")?map:null,l=getMeteosatLayer();if(m&&l){ensureMeteosatRow();l.setParams({time:meteosatTime()});l.addTo(m);const input=ensureMeteosatRow();if(input)input.checked=true;}}};
    ensureMeteosatRow();
    setTimeout(ensureMeteosatRow,500);
    setInterval(()=>{ensureMeteosatRow();refreshMeteosat()},10*60*1000);
    if(pendingOpen){const d=document.getElementById("irratiFirmsControl");if(d)d.classList.add("open");}
  }
  setup();
})();
