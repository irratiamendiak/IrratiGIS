// IrratiGIS — popup compacto de quemas autorizadas
(function(){
  "use strict";

  const fire = window.IrratiGISFirePopup = {
    esc:function(v){return String(v??"-").replace(/[&<>"']/g,function(c){return ({"&":"&amp;","<":"&lt;","/>":">","\"":"&quot;","'":"&#39;"})[c]})},
    field:function(o,keys){for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"},
    popup:function(f,lat,lon){
      const e=this.esc,v=this.field;
      const tit=[v(f,["nombre","nombreTitular","titularNombre"]),v(f,["apellidos","apellido1","apellido2","titularApellidos"])].filter(x=>x!=="-").join(" ")||v(f,["titular"]);
      const row=(a,b)=>`<div><b>${a}:</b> ${e(b)}</div>`;
      return `<div style="min-width:250px;max-width:330px"><strong style="font-size:15px">🔥 Quema autorizada</strong><div style="margin-top:8px;display:grid;gap:4px">${row("Nº permiso",v(f,["baimena","numeroAutorizacion","numAut","numeroPermiso"]))}${row("Titular",tit)}${row("Teléfono",v(f,["telefono","telefonoPermiso","telefonoQuema","telefonoMovil","telefonoFijo"]))}${row("Municipio",v(f,["udalerria","municipio","nombreMunicipio"]))}${row("Dirección",v(f,["direccion","direccionQuema"]))}${row("Superficie",v(f,["superficie","superficieQuema"]))}${row("Combustible",v(f,["descripcionMaterial","tipoCombustible","combustible","codigoMaterial"]))}${row("Motivo",v(f,["motivo","razon"]))}${row("Fecha autorización",v(f,["fechaAutorizacion","fechaResolucion","fechaPermiso"]))}${row("Inicio",v(f,["fechaInicio"]))}${row("Código SIGPAC",v(f,["codigoSigpac","sigpac","codigoSIGPAC","referenciaSigpac"]))}${row("Accesos",v(f,["accesos","acceso","descripcionAcceso"]))}${row("Coordenadas",`${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`)}</div></div>`;
    }
  };

  function activateFireLayer(){
    const controls=document.querySelectorAll('.leaflet-control-layers');
    for(const control of controls){
      const labels=control.querySelectorAll('label');
      for(const label of labels){
        const text=(label.textContent||'').replace(/\s+/g,' ').trim();
        if(text.indexOf('Baimendutako erreketak')===-1) continue;
        const input=label.querySelector('input[type="checkbox"]');
        if(input && !input.checked){
          input.click();
          console.log('IrratiGIS: capa de quemas activada automáticamente');
        }
        return true;
      }
    }
    return false;
  }

  function hookLeaflet(){
    if(!window.L || !L.Marker || !L.Marker.prototype || L.Marker.prototype.__irratiFirePopupHooked) return !!(window.L&&L.Marker);
    const original=L.Marker.prototype.bindPopup;
    L.Marker.prototype.bindPopup=function(content,options){
      if(typeof content === "string" && content.indexOf("Baimendutako erreketak") !== -1){
        const latlng=this.getLatLng?.();
        const lat=latlng?.lat, lon=latlng?.lng;
        const text=document.createElement("div");
        text.innerHTML=content;
        const values={};
        text.querySelectorAll("strong").forEach(s=>{
          const label=(s.textContent||"").replace(/:$/," ").trim();
          const value=(s.parentElement?.textContent||"").replace(/^.*?:\s*/,"").trim();
          if(label) values[label]=value;
        });
        const row=(a,b)=>`<div><b>${a}:</b> ${fire.esc(b||"-")}</div>`;
        const compact=`<div style="min-width:250px;max-width:330px"><strong style="font-size:15px">🔥 Quema autorizada</strong><div style="margin-top:8px;display:grid;gap:4px">${row("Nº permiso",values["Baimena"])}${row("Municipio",values["Udalerria"])}${row("Inicio",values["Hasiera-data"])}${row("Estado",values["Egoera"])}${row("Coordenadas",Number.isFinite(lat)&&Number.isFinite(lon)?`${lat.toFixed(6)}, ${lon.toFixed(6)}`:"-")}</div></div>`;
        return original.call(this,compact,options);
      }
      return original.call(this,content,options);
    };
    L.Marker.prototype.__irratiFirePopupHooked=true;
    return true;
  }

  if(!hookLeaflet()){
    let n=0;
    const timer=setInterval(()=>{if(hookLeaflet()||++n>40)clearInterval(timer)},250);
  }

  // El visor crea la capa durante el arranque. Buscamos el control repetidamente
  // y la activamos; no depende del número de quemas (4, 67 o las que haya).
  let tries=0;
  const layerTimer=setInterval(()=>{
    if(activateFireLayer() || ++tries>120) clearInterval(layerTimer);
  },250);

  const observer=new MutationObserver(()=>activateFireLayer());
  if(document.body) observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),31000);
})();
