// IrratiGIS — popup compacto de quemas autorizadas
(function(){
  window.IrratiGISFirePopup={
    esc:function(v){return String(v??"-").replace(/[&<>"']/g,function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]})},
    field:function(o,keys){for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"},
    popup:function(f,lat,lon){
      const e=this.esc,v=this.field,tit=[v(f,["nombre","nombreTitular","titularNombre"]),v(f,["apellidos","apellido1","apellido2","titularApellidos"])].filter(x=>x!=="-").join(" ")||v(f,["titular"]);
      const row=(a,b)=>`<div><b>${a}:</b> ${e(b)}</div>`;
      return `<div style="min-width:250px;max-width:330px"><strong style="font-size:15px">🔥 Quema autorizada</strong><div style="margin-top:8px;display:grid;gap:4px">${row("Nº permiso",v(f,["baimena","numeroAutorizacion","numAut","numeroPermiso"]))}${row("Titular",tit)}${row("Teléfono",v(f,["telefono","telefonoPermiso","telefonoQuema","telefonoMovil","telefonoFijo"]))}${row("Municipio",v(f,["udalerria","municipio","nombreMunicipio"]))}${row("Dirección",v(f,["direccion","direccionQuema"]))}${row("Superficie",v(f,["superficie","superficieQuema"]))}${row("Combustible",v(f,["descripcionMaterial","tipoCombustible","combustible","codigoMaterial"]))}${row("Motivo",v(f,["motivo","razon"]))}${row("Fecha autorización",v(f,["fechaAutorizacion","fechaResolucion","fechaPermiso"]))}${row("Inicio",v(f,["fechaInicio"]))}${row("Código SIGPAC",v(f,["codigoSigpac","sigpac","codigoSIGPAC","referenciaSigpac"]))}${row("Accesos",v(f,["accesos","acceso","descripcionAcceso"]))}${row("Coordenadas",`${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`)}</div></div>`;
    }
  };
})();
