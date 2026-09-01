// IrratiGIS — quemas autorizadas: activa la capa existente y mejora sus popups
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
  function activateExistingBurnLayer(){
    const controls=document.querySelectorAll('.leaflet-control-layers');
    for(const control of controls){
      for(const label of control.querySelectorAll('label')){
        const text=(label.textContent||'').replace(/\s+/g,' ').trim();
        if(!text.includes('Baimendutako erreketak')) continue;
        const input=label.querySelector('input[type="checkbox"]');
        if(input && !input.checked){
          input.click();
          console.log('IrratiGIS: capa 🔥 activada');
        }
        return true;
      }
    }
    return false;
  }
  function hookPopups(){
    if(!window.L||!L.Marker||L.Marker.prototype.__irratiFirePopupHooked) return false;
    const original=L.Marker.prototype.bindPopup;
    L.Marker.prototype.bindPopup=function(content,options){
      if(typeof content==='string'&&content.includes('Baimendutako erreketak')){
        const ll=this.getLatLng?.();
        const lat=ll?.lat,lon=ll?.lng;
        const text=document.createElement('div');text.innerHTML=content;
        const values={};
        text.querySelectorAll('strong').forEach(s=>{const k=(s.textContent||'').replace(/:$/,'').trim();const v=(s.parentElement?.textContent||'').replace(/^.*?:\s*/,'').trim();if(k)values[k]=v});
        const row=(a,b)=>`<div><b>${a}:</b> ${esc(b||'-')}</div>`;
        const html=`<div style="min-width:245px;max-width:330px"><strong style="font-size:15px">🔥 Quema autorizada</strong><div style="margin-top:8px;display:grid;gap:4px">${row('Nº permiso',values.Baimena)}${row('Municipio',values.Udalerria)}${row('Inicio',values['Hasiera-data'])}${row('Estado',values.Egoera)}${row('Coordenadas',Number.isFinite(lat)&&Number.isFinite(lon)?`${lat.toFixed(6)}, ${lon.toFixed(6)}`:'-')}</div></div>`;
        return original.call(this,html,options);
      }
      return original.call(this,content,options);
    };
    L.Marker.prototype.__irratiFirePopupHooked=true;
    return true;
  }
  let n=0;
  const timer=setInterval(()=>{
    const layer=activateExistingBurnLayer();
    const popup=hookPopups();
    if(layer&&popup || ++n>120)clearInterval(timer);
  },250);
  const observer=new MutationObserver(()=>activateExistingBurnLayer());
  if(document.body)observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),31000);
})();
