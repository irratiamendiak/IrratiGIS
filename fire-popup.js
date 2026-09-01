// IrratiGIS — quemas autorizadas: carga bajo demanda al activar la capa Leaflet
(function(){
  "use strict";

  const API = "https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const esc=v=>String(v??"-").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const val=(o,keys)=>{for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"};
  function num(v){if(v==null)return NaN;if(typeof v==="number")return v;const n=Number(String(v).trim().replace(",","."));return Number.isFinite(n)?n:NaN}

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

  function fireMarker(f){
    const lat=num(val(f,["latitudea","latitud","latitude","lat"]));
    const lon=num(val(f,["longitudea","longitud","longitude","lon","lng"]));
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)return null;
    const icon=L.divIcon({className:"irrati-fire-icon",html:"<span style=\"display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#fff;border:2px solid #d24b16;box-shadow:0 1px 5px rgba(0,0,0,.35);font-size:18px\">🔥</span>",iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-15]});
    return L.marker([lat,lon],{icon}).bindPopup(popup(f,lat,lon));
  }

  async function loadBurnsIntoLayer(layer){
    if(!layer||layer.__irratiLoading)return;
    const token=window.IrratiGISAuth?.getToken?.();
    if(!token){console.warn("IrratiGIS: no hay sesión para cargar quemas");return}
    layer.__irratiLoading=true;
    try{
      const response=await fetch(`${API}/api/active`,{headers:{Authorization:`Bearer ${token}`}});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      const fires=Array.isArray(data.fires)?data.fires:[];
      layer.clearLayers();
      let shown=0;
      fires.forEach(f=>{const marker=fireMarker(f);if(marker){marker.addTo(layer);shown++}});
      console.log(`IrratiGIS: ${shown}/${fires.length} quemas mostradas`);
      const msg=document.getElementById("message");if(msg)msg.textContent=`${shown} baimendutako erreketak kargatu dira.`;
    }catch(e){
      console.error("IrratiGIS: error cargando quemas",e);
      const msg=document.getElementById("message");if(msg)msg.textContent="Ezin izan dira baimendutako erreketak kargatu.";
    }finally{layer.__irratiLoading=false}
  }

  function hookLayerControl(){
    if(!window.L||!L.Control||!L.Control.Layers)return false;
    const proto=L.Control.Layers.prototype;
    if(proto.__irratiBurnOnToggle)return true;
    const original=proto._onInputClick;
    if(typeof original!=="function")return false;
    proto._onInputClick=function(){
      original.apply(this,arguments);
      setTimeout(()=>{
        try{
          (this._layers||[]).forEach(entry=>{
            if(!entry||!entry.overlay||!entry.layer||!String(entry.name||"").includes("Baimendutako erreketak"))return;
            const checked=entry.input?entry.input.checked:this._map.hasLayer(entry.layer);
            if(checked)loadBurnsIntoLayer(entry.layer);
          });
        }catch(e){console.warn("IrratiGIS: error tras cambiar capa de quemas",e)}
      },0);
    };
    proto.__irratiBurnOnToggle=true;
    return true;
  }

  let tries=0;
  const timer=setInterval(()=>{if(hookLayerControl()||++tries>120)clearInterval(timer)},250);
  window.IrratiGISFirePopup={loadBurnsIntoLayer};
})();