// IrratiGIS — quemas autorizadas: solo al activar la capa
(function(){
  "use strict";

  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const esc=v=>String(v??"-").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const val=(o,keys)=>{for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"};
  function num(v){
    if(v==null)return NaN;
    if(typeof v==="number")return v;
    const s=String(v).trim().replace(",",".").replace(/\s+/g,"");
    const n=Number(s); return Number.isFinite(n)?n:NaN;
  }
  function coords(f){
    const s=f?.solicitud||{};
    const lat=num(val(f,["latitudea","latitud","latitude","lat"]));
    const lon=num(val(f,["longitudea","longitud","longitude","lon","lng"]));
    const slat=num(val(s,["latitudea","latitud","latitude","lat"]));
    const slon=num(val(s,["longitudea","longitud","longitude","lon","lng"]));
    const a=Number.isFinite(lat)&&Number.isFinite(lon)?[lat,lon]:[slat,slon];
    if(!Number.isFinite(a[0])||!Number.isFinite(a[1])||a[0]<-90||a[0]>90||a[1]<-180||a[1]>180)return null;
    return a;
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
  function fireMarker(f){
    const c=coords(f); if(!c)return null;
    const [lat,lon]=c;
    const icon=L.divIcon({className:"irrati-fire-icon",html:"<span style=\"display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#fff;border:2px solid #d24b16;box-shadow:0 1px 5px rgba(0,0,0,.35);font-size:18px\">🔥</span>",iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-15]});
    return L.marker([lat,lon],{icon}).bindPopup(popup(f,lat,lon));
  }
  async function loadBurnsIntoLayer(layer){
    if(!layer||layer.__irratiLoading)return;
    const token=window.IrratiGISAuth?.getToken?.();
    if(!token){console.warn("IrratiGIS: no hay sesión para cargar quemas");return;}
    layer.__irratiLoading=true;
    const msg=document.getElementById("message");
    if(msg)msg.textContent="Kontrolatutako errekak kontsultatzen...";
    try{
      const response=await fetch(`${API}/api/active?ts=${Date.now()}`,{cache:"no-store",headers:{Authorization:`Bearer ${token}`}});
      const data=await response.json().catch(()=>({}));
      console.log("IrratiGIS /api/active",response.status,data);
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const fires=Array.isArray(data.fires)?data.fires:[];
      layer.clearLayers();
      let shown=0;
      const bounds=[];
      fires.forEach(f=>{const marker=fireMarker(f);if(marker){marker.addTo(layer);bounds.push(marker.getLatLng());shown++;}});
      console.log(`IrratiGIS quemas: API=${fires.length}, coordenadas=${shown}`);
      if(shown&&layer._map)layer._map.fitBounds(L.latLngBounds(bounds),{padding:[35,35],maxZoom:13});
      if(msg)msg.textContent=`${shown} baimendutako erreketak kargatu dira.`;
    }catch(e){
      console.error("IrratiGIS: error cargando quemas",e);
      if(msg)msg.textContent="Ezin izan dira baimendutako errekak kargatu.";
    }finally{layer.__irratiLoading=false}
  }
  function isBurnEntry(entry){return !!entry&&entry.overlay&&entry.layer&&/Baimendutako erreketak|erreketak|quema/i.test(String(entry.name||""));}

  function bindInput(input,layer){
    if(!input||input.__irratiBurnBound)return;
    input.__irratiBurnBound=true;
    input.addEventListener("change",()=>{
      if(input.checked)loadBurnsIntoLayer(layer);
      else if(layer?.clearLayers)layer.clearLayers();
    });
  }

  function hookLayerControl(){
    if(!window.L||!L.Control||!L.Control.Layers)return false;
    const proto=L.Control.Layers.prototype;
    if(proto.__irratiBurnHook)return true;
    const originalAddItem=proto._addItem;
    if(typeof originalAddItem!=="function")return false;
    proto._addItem=function(obj){
      const result=originalAddItem.call(this,obj);
      if(isBurnEntry(obj)){
        const input=result?.querySelector?.("input")||result?.firstChild;
        if(input&&input.tagName==="INPUT")bindInput(input,obj.layer);
        else setTimeout(()=>{const i=result?.querySelector?.("input");if(i)bindInput(i,obj.layer)},0);
      }
      return result;
    };
    proto.__irratiBurnHook=true;
    return true;
  }

  let tries=0;
  const timer=setInterval(()=>{if(hookLayerControl()||++tries>240)clearInterval(timer)},250);
  window.IrratiGISFirePopup={loadBurnsIntoLayer};
})();