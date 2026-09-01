// IrratiGIS — quemas autorizadas: cargar al activar la capa
(function(){
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const esc=v=>String(v??"-").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const val=(o,keys)=>{for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"};
  const num=v=>{if(v==null)return NaN;const n=Number(String(v).trim().replace(",",".").replace(/\s+/g,""));return Number.isFinite(n)?n:NaN};
  function coords(f){
    const s=f?.solicitud||{};
    const pairs=[[f?.latitudea,f?.longitudea],[f?.latitud,f?.longitud],[f?.latitude,f?.longitude],[f?.lat,f?.lon],[f?.lat,f?.lng],[s?.latitudea,s?.longitudea],[s?.latitud,s?.longitud],[s?.latitude,s?.longitude],[s?.lat,s?.lon],[s?.lat,s?.lng]];
    for(const [a,b] of pairs){const lat=num(a),lon=num(b);if(Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180)return[lat,lon]}
    return null;
  }
  function popup(f,lat,lon){
    const titular=([val(f,["nombre","nombreTitular"]),val(f,["apellidos","titularApellidos"])].filter(x=>x!=="-").join(" ")||val(f,["titular"]));
    const row=(a,b)=>`<div><b>${a}:</b> ${esc(b)}</div>`;
    return `<div style="min-width:245px;max-width:330px"><strong style="font-size:15px">🔥 Quema autorizada</strong><div style="margin-top:8px;display:grid;gap:4px">`+
      row("Nº permiso",val(f,["baimena","numeroAutorizacion","numAut","numeroPermiso"]))+
      row("Titular",titular)+row("Teléfono",val(f,["telefono","telefonoPermiso","telefonoQuema","telefonoMovil","telefonoFijo"]))+
      row("Dirección",val(f,["direccion","direccionQuema"]))+row("Municipio",val(f,["udalerria","municipio","nombreMunicipio"]))+
      row("Superficie",val(f,["superficie","superficieQuema"]))+row("Combustible",val(f,["descripcionMaterial","tipoCombustible","combustible","codigoMaterial"]))+
      row("Motivo",val(f,["motivo","razon"]))+row("Fecha autorización",val(f,["fechaAutorizacion","fechaResolucion","fechaPermiso"]))+
      row("Inicio",val(f,["fechaInicio","fechaInicioQuema"]))+row("Código SIGPAC",val(f,["codigoSigpac","sigpac","codigoSIGPAC","referenciaSigpac"]))+
      row("Accesos",val(f,["accesos","acceso","descripcionAcceso"]))+row("Coordenadas",`${lat.toFixed(6)}, ${lon.toFixed(6)}`)+`</div></div>`;
  }
  function fireMarker(f){const c=coords(f);if(!c)return null;const[lat,lon]=c;const icon=L.divIcon({className:"irrati-fire-icon",html:"<span style=\"display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#fff;border:2px solid #d24b16;box-shadow:0 1px 5px rgba(0,0,0,.35);font-size:18px\">🔥</span>",iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-15]});return L.marker([lat,lon],{icon}).bindPopup(popup(f,lat,lon))}
  async function loadBurnsIntoLayer(layer){
    if(!layer||layer.__irratiLoading)return;
    const token=window.IrratiGISAuth?.getToken?.();
    if(!token){console.warn("IrratiGIS: no hay sesión para cargar quemas");return}
    layer.__irratiLoading=true;
    const msg=document.getElementById("message");if(msg)msg.textContent="Kontrolatutako errekak kontsultatzen...";
    try{
      const r=await fetch(`${API}/api/active?ts=${Date.now()}`,{cache:"no-store",headers:{Authorization:`Bearer ${token}`}});
      const data=await r.json().catch(()=>({}));console.log("IrratiGIS /api/active",r.status,data);if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const fires=Array.isArray(data.fires)?data.fires:[];layer.clearLayers();let shown=0;const bounds=[];
      for(const f of fires){const m=fireMarker(f);if(m){m.addTo(layer);bounds.push(m.getLatLng());shown++}}
      console.log(`IrratiGIS quemas: API=${fires.length}, coordenadas=${shown}`);
      if(shown&&layer._map)layer._map.fitBounds(L.latLngBounds(bounds),{padding:[35,35],maxZoom:13});
      if(msg)msg.textContent=`${shown} baimendutako erreketak kargatu dira.`;
    }catch(e){console.error("IrratiGIS: error cargando quemas",e);if(msg)msg.textContent="Ezin izan dira baimendutako errekak kargatu."}
    finally{layer.__irratiLoading=false}
  }
  function isBurnName(name){return /Baimendutako erreketak|erreketak|quema/i.test(String(name||""))}
  function hookLayerControl(){
    if(!window.L?.Control?.Layers)return false;
    const p=L.Control.Layers.prototype;if(p.__irratiBurnHook)return true;
    const original=p._onInputClick;if(typeof original!=="function")return false;
    p._onInputClick=function(e){
      original.call(this,e);
      try{
        const entries=Array.isArray(this._layers)?this._layers:[];
        const burn=entries.find(x=>x?.overlay&&x?.layer&&isBurnName(x.name));
        if(!burn)return;
        const input=e?.target;
        const labels=[...this._form?.querySelectorAll?.("label")||[]];
        const label=labels.find(l=>l.contains(input));
        const text=(label?.textContent||"").trim();
        if(input&&input.checked&&isBurnName(text))loadBurnsIntoLayer(burn.layer);
        else if(input&&!input.checked&&isBurnName(text))burn.layer.clearLayers();
      }catch(err){console.error("IrratiGIS: error en control de capas",err)}
    };
    p.__irratiBurnHook=true;return true;
  }
  let tries=0;const timer=setInterval(()=>{if(hookLayerControl()||++tries>240)clearInterval(timer)},250);
  window.IrratiGISFirePopup={loadBurnsIntoLayer,hookLayerControl};
})();