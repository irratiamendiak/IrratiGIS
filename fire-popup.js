// IrratiGIS — quemas autorizadas: cargar al activar la capa
(function(){
  "use strict";

  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const esc=v=>String(v??"-").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const val=(o,keys)=>{for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"};
  function num(v){
    if(v==null)return NaN;
    if(typeof v==="number")return v;
    const n=Number(String(v).trim().replace(",",".").replace(/\s+/g,""));
    return Number.isFinite(n)?n:NaN;
  }
  function coords(f){
    const s=f?.solicitud||{};
    const pairs=[
      [f?.latitudea,f?.longitudea],[f?.latitud,f?.longitud],[f?.latitude,f?.longitude],[f?.lat,f?.lon],[f?.lat,f?.lng],
      [s?.latitudea,s?.longitudea],[s?.latitud,s?.longitud],[s?.latitude,s?.longitude],[s?.lat,s?.lon],[s?.lat,s?.lng]
    ];
    for(const [a,b] of pairs){const lat=num(a),lon=num(b);if(Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180)return [lat,lon];}
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
  function fireMarker(f){
    const c=coords(f);if(!c)return null;
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
      for(const f of fires){const marker=fireMarker(f);if(marker){marker.addTo(layer);bounds.push(marker.getLatLng());shown++;}}
      console.log(`IrratiGIS quemas: API=${fires.length}, coordenadas=${shown}`);
      if(shown&&layer._map)layer._map.fitBounds(L.latLngBounds(bounds),{padding:[35,35],maxZoom:13});
      if(msg)msg.textContent=`${shown} baimendutako erreketak kargatu dira.`;
    }catch(e){
      console.error("IrratiGIS: error cargando quemas",e);
      if(msg)msg.textContent="Ezin izan dira baimendutako errekak kargatu.";
    }finally{layer.__irratiLoading=false;}
  }
  function findBurnLayer(){
    const candidates=[];
    try{
      document.querySelectorAll("input").forEach(input=>{
        const label=(input.parentElement?.textContent||"").trim();
        if(/Baimendutako erreketak|erreketak|quema/i.test(label))candidates.push(input);
      });
    }catch(e){}
    return candidates;
  }
  function bindInput(input,layer){
    if(!input||input.__irratiBurnBound)return false;
    input.__irratiBurnBound=true;
    input.addEventListener("change",()=>{
      console.log("IrratiGIS: capa quemas",input.checked?"ACTIVADA":"DESACTIVADA");
      if(input.checked)loadBurnsIntoLayer(layer);else if(layer?.clearLayers)layer.clearLayers();
    });
    if(input.checked)loadBurnsIntoLayer(layer);
    return true;
  }
  function hookLayerControl(){
    if(!window.L||!L.Control||!L.Control.Layers)return false;
    const proto=L.Control.Layers.prototype;
    if(proto.__irratiBurnHook)return true;
    const originalAddItem=proto._addItem;
    if(typeof originalAddItem!=="function")return false;
    proto._addItem=function(obj){
      const result=originalAddItem.call(this,obj);
      if(obj?.overlay&&obj?.layer&&/Baimendutako erreketak|erreketak|quema/i.test(String(obj.name||""))){
        const input=result?.querySelector?.("input");
        if(input)bindInput(input,obj.layer);
        else setTimeout(()=>{const i=result?.querySelector?.("input");if(i)bindInput(i,obj.layer);},0);
      }
      return result;
    };
    proto.__irratiBurnHook=true;
    return true;
  }
  function hookExistingControls(){
    if(!window.L||!L.Control||!L.Control.Layers)return false;
    let found=false;
    document.querySelectorAll("input").forEach(input=>{
      const text=(input.parentElement?.textContent||"").trim();
      if(/Baimendutako erreketak|erreketak|quema/i.test(text)){
        found=true;
        const map=window.__irratiGISMap;
        if(map&&window.__irratiGISControlledBurnLayer)bindInput(input,window.__irratiGISControlledBurnLayer);
      }
    });
    return found;
  }
  let tries=0;
  const timer=setInterval(()=>{hookLayerControl();hookExistingControls();if(++tries>240)clearInterval(timer);},250);
  window.IrratiGISFirePopup={loadBurnsIntoLayer,bindInput,hookLayerControl};
})();