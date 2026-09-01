// IrratiGIS — quemas autorizadas directamente sobre el mapa
(function(){
  "use strict";
  const esc=v=>String(v??"-").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const val=(o,keys)=>{for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"};
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
  function num(v){
    if(v==null)return NaN;
    if(typeof v==="number")return v;
    let s=String(v).trim().replace(/\s/g,"");
    if(s.includes(",")&&!s.includes("."))s=s.replace(",",".");
    return Number(s);
  }
  function coords(f){
    const lat=num(val(f,["latitudea","latitud","latitude","lat"]));
    const lon=num(val(f,["longitudea","longitud","longitude","lon","lng"]));
    return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180?[lat,lon]:null;
  }
  async function loadDirect(){
    if(!window.L||!window.map)return false;
    const token=window.IrratiGISAuth?.getToken?.(),api=window.IrratiGISAuth?.API;
    if(!token||!api)return false;
    if(window.__irratiDirectFireLayer)return true;
    try{
      const r=await fetch(`${api}/api/active`,{headers:{Authorization:`Bearer ${token}`}});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json(),fires=Array.isArray(data.fires)?data.fires:[];
      const layer=L.featureGroup().addTo(window.map); window.__irratiDirectFireLayer=layer;
      const bounds=[]; let shown=0;
      fires.forEach(f=>{
        const c=coords(f); if(!c)return;
        const [lat,lon]=c;
        const icon=L.divIcon({className:"irrati-fire-icon",html:"<div style=\"width:34px;height:34px;border-radius:50%;background:#fff;border:2px solid #c62828;display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 2px 7px rgba(0,0,0,.35)\">🔥</div>",iconSize:[34,34],iconAnchor:[17,17],popupAnchor:[0,-17]});
        L.marker([lat,lon],{icon,title:"Quema autorizada"}).bindPopup(popup(f,lat,lon),{maxWidth:350}).addTo(layer);
        bounds.push([lat,lon]); shown++;
      });
      console.log(`IrratiGIS: ${fires.length} quemas recibidas, ${shown} mostradas con coordenadas.`);
      const msg=document.getElementById("message"); if(msg)msg.textContent=`🔥 ${shown} quemas autorizadas mostradas en el mapa.`;
      if(bounds.length===1)window.map.setView(bounds[0],15); else if(bounds.length>1)window.map.fitBounds(bounds,{padding:[40,40],maxZoom:15});
      return true;
    }catch(e){console.error("IrratiGIS: error mostrando quemas",e);return false;}
  }
  function start(){let n=0;const t=setInterval(async()=>{if(await loadDirect()||++n>30)clearInterval(t)},1000)}
  if(window.IrratiGISAuthReady?.then)window.IrratiGISAuthReady.then(start);else{window.addEventListener("irratiGISAuthenticated",start,{once:true});start()}
})();
