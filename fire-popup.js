// IrratiGIS — quemas autorizadas: solo se cargan al activar la capa
(function(){
  "use strict";
  const esc=v=>String(v??"-").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const val=(o,keys)=>{for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"};
  const coords=f=>{
    const n=v=>{if(v==null)return NaN;let s=String(v).trim().replace(/\s/g,"");if(s.includes(",")&&!s.includes("."))s=s.replace(",",".");return Number(s)};
    const lat=n(val(f,["latitudea","latitud","latitude","lat"]));
    const lon=n(val(f,["longitudea","longitud","longitude","lon","lng"]));
    return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180?[lat,lon]:null;
  };
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
  async function refreshLayer(layer){
    const token=window.IrratiGISAuth?.getToken?.(),api=window.IrratiGISAuth?.API;
    if(!token||!api||!layer)return;
    try{
      const r=await fetch(`${api}/api/active`,{headers:{Authorization:`Bearer ${token}`}});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json();
      const fires=Array.isArray(data.fires)?data.fires:[];
      layer.clearLayers();
      let shown=0;
      fires.forEach(f=>{
        const c=coords(f); if(!c)return;
        const [lat,lon]=c;
        const icon=L.divIcon({className:"irrati-fire-icon",html:"<div style=\"width:34px;height:34px;border-radius:50%;background:#fff;border:2px solid #c62828;display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 2px 7px rgba(0,0,0,.35)\">🔥</div>",iconSize:[34,34],iconAnchor:[17,17],popupAnchor:[0,-17]});
        L.marker([lat,lon],{icon,title:"Quema autorizada"}).bindPopup(popup(f,lat,lon),{maxWidth:350}).addTo(layer);
        shown++;
      });
      const msg=document.getElementById("message");
      if(msg)msg.textContent=`🔥 ${shown} quemas autorizadas mostradas.`;
      console.log(`IrratiGIS: ${fires.length} quemas recibidas, ${shown} con coordenadas.`);
    }catch(e){
      console.error("IrratiGIS: error mostrando quemas",e);
      const msg=document.getElementById("message");if(msg)msg.textContent="Error cargando quemas autorizadas: "+e.message;
    }
  }
  function hookLayers(){
    if(!window.L||!L.Control?.Layers||L.Control.Layers.prototype.__irratiFireHooked)return false;
    const proto=L.Control.Layers.prototype;
    const original=proto._onInputClick;
    proto._onInputClick=function(){
      const result=original.apply(this,arguments);
      try{
        (this._layers||[]).forEach(entry=>{
          if(entry?.layer && String(entry.name||"").includes("Baimendutako erreketak")){
            const input=this._form?.querySelector?.('input[type="checkbox"]');
            const labels=this._form?.querySelectorAll?.('label')||[];
            for(const label of labels){
              if(!String(label.textContent||"").includes("Baimendutako erreketak"))continue;
              const cb=label.querySelector('input[type="checkbox"]');
              if(cb?.checked){refreshLayer(entry.layer);}else{entry.layer.clearLayers();}
              break;
            }
          }
        });
      }catch(e){console.warn("IrratiGIS: error al cambiar capa",e)}
      return result;
    };
    proto.__irratiFireHooked=true;
    return true;
  }
  let tries=0;
  const timer=setInterval(()=>{if(hookLayers()||++tries>120)clearInterval(timer)},250);
})();
