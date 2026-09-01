// IrratiGIS — quemas autorizadas: cargar al activar la capa
(function(){
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const esc=v=>String(v??"-").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const val=(o,keys)=>{for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"};
  const num=v=>{if(v==null)return NaN;const n=Number(String(v).trim().replace(",",".").replace(/\s+/g,""));return Number.isFinite(n)?n:NaN};

  // GFA entrega X/Y en UTM. Gipuzkoa: ETRS89 / UTM zona 30N (EPSG:25830).
  // Leaflet necesita lat/lon en grados (EPSG:4326).
  // IMPORTANTE: el meridiano central de la zona UTM 30 es -3°, no +3°.
  function utm30ToWgs84(easting,northing){
    const a=6378137.0,eccSquared=0.00669438002290,k0=0.9996;
    const e1=(1-Math.sqrt(1-eccSquared))/(1+Math.sqrt(1-eccSquared));
    const x=easting-500000.0,y=northing,M=y/k0;
    const mu=M/(a*(1-eccSquared/4-3*eccSquared*eccSquared/64-5*Math.pow(eccSquared,3)/256));
    const phi1Rad=mu+(3*e1/2-27*Math.pow(e1,3)/32)*Math.sin(2*mu)+(21*e1*e1/16-55*Math.pow(e1,4)/32)*Math.sin(4*mu)+(151*Math.pow(e1,3)/96)*Math.sin(6*mu)+(1097*Math.pow(e1,4)/512)*Math.sin(8*mu);
    const eccPrimeSquared=eccSquared/(1-eccSquared);
    const sin=Math.sin(phi1Rad),cos=Math.cos(phi1Rad),tan=Math.tan(phi1Rad);
    const N1=a/Math.sqrt(1-eccSquared*sin*sin),T1=tan*tan,C1=eccPrimeSquared*cos*cos;
    const R1=a*(1-eccSquared)/Math.pow(1-eccSquared*sin*sin,1.5),D=x/(N1*k0);
    const lat=phi1Rad-(N1*tan/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*eccPrimeSquared)*Math.pow(D,4)/24+(61+90*T1+298*C1+45*T1*T1-252*eccPrimeSquared-3*C1*C1)*Math.pow(D,6)/720);
    const lon0Rad=-3*Math.PI/180;
    const lon=lon0Rad+(D-(1+2*T1+C1)*Math.pow(D,3)/6+(5-2*C1+28*T1-3*C1*C1+8*eccPrimeSquared+24*T1*T1)*Math.pow(D,5)/120)/cos;
    return [lat*180/Math.PI,lon*180/Math.PI];
  }

  function coords(f){
    const s=f?.solicitud||{};
    const pairs=[
      [f?.latitudea,f?.longitudea],[f?.latitud,f?.longitud],[f?.latitude,f?.longitude],[f?.lat,f?.lon],[f?.lat,f?.lng],
      [s?.latitudea,s?.longitudea],[s?.latitud,s?.longitud],[s?.latitude,s?.longitude],[s?.lat,s?.lon],[s?.lat,s?.lng]
    ];
    for(const [a,b] of pairs){const lat=num(a),lon=num(b);if(Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180)return[lat,lon]}
    for(const [xv,yv] of pairs){const x=num(xv),y=num(yv);if(Number.isFinite(x)&&Number.isFinite(y)&&x>=100000&&x<=900000&&y>=4000000&&y<=5000000){const p=utm30ToWgs84(x,y);if(p[0]>=-90&&p[0]<=90&&p[1]>=-180&&p[1]<=180)return p}}
    return null;
  }

  function popup(f,lat,lon){
    const titular=([val(f,["nombre","nombreTitular"]),val(f,["apellidos","titularApellidos"])].filter(x=>x!=="-").join(" ")||val(f,["titular"]));
    const row=(a,b)=>`<div><b>${a}:</b> ${esc(b)}</div>`;
    return `<div style="min-width:245px;max-width:330px"><strong style="font-size:15px">🔥 Quema autorizada</strong><div style="margin-top:8px;display:grid;gap:4px">`+
      row("Nº permiso",val(f,["baimena","numeroAutorizacion","numAut","numeroPermiso"]))+row("Titular",titular)+row("Teléfono",val(f,["telefono","telefonoPermiso","telefonoQuema","telefonoMovil","telefonoFijo"]))+
      row("Dirección",val(f,["direccion","direccionQuema"]))+row("Municipio",val(f,["udalerria","municipio","nombreMunicipio"]))+row("Superficie",val(f,["superficie","superficieQuema"]))+
      row("Combustible",val(f,["descripcionMaterial","tipoCombustible","combustible","codigoMaterial"]))+row("Motivo",val(f,["motivo","razon"]))+row("Fecha autorización",val(f,["fechaAutorizacion","fechaResolucion","fechaPermiso"]))+
      row("Inicio",val(f,["fechaInicio","fechaInicioQuema"]))+row("Código SIGPAC",val(f,["codigoSigpac","sigpac","codigoSIGPAC","referenciaSigpac"]))+row("Accesos",val(f,["accesos","acceso","descripcionAcceso"]))+
      row("Coordenadas",`${lat.toFixed(6)}, ${lon.toFixed(6)}`)+`</div></div>`;
  }

  function fireMarker(f){
    const c=coords(f);if(!c)return null;const[lat,lon]=c;
    const icon=L.divIcon({className:"irrati-fire-icon",html:"<span style=\"display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#fff;border:2px solid #d24b16;box-shadow:0 1px 5px rgba(0,0,0,.35);font-size:18px\">🔥</span>",iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-15]});
    return L.marker([lat,lon],{icon}).bindPopup(popup(f,lat,lon));
  }

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
      console.log(`IrratiGIS quemas: API=${fires.length}, coordenadas visibles=${shown}`);
      if(shown){const map=window.__irratiGISMap||layer._map;if(map)map.fitBounds(L.latLngBounds(bounds),{padding:[35,35],maxZoom:13})}
      if(msg)msg.textContent=`${shown} baimendutako erreketak kargatu dira.`;
    }catch(e){console.error("IrratiGIS: error cargando quemas",e);if(msg)msg.textContent="Ezin izan dira baimendutako errekak kargatu."}
    finally{layer.__irratiLoading=false}
  }

  function isBurnLayer(layer){return !!layer&&layer===window.__irratiGISControlledBurnLayer}
  function bindMap(map,layer){
    if(!map||!layer||map.__irratiBurnMapBound)return;
    map.__irratiBurnMapBound=true;
    map.on("overlayadd",e=>{if(isBurnLayer(e.layer)){console.log("IrratiGIS: overlayadd quemas");loadBurnsIntoLayer(layer)}});
    map.on("overlayremove",e=>{if(isBurnLayer(e.layer)){console.log("IrratiGIS: overlayremove quemas");layer.clearLayers()}});
    if(map.hasLayer(layer)){console.log("IrratiGIS: capa quemas ya activa");loadBurnsIntoLayer(layer)}
  }
  function hookLayerControl(){
    const map=window.__irratiGISMap,layer=window.__irratiGISControlledBurnLayer;
    if(!map||!layer||!window.L)return false;
    bindMap(map,layer);return true;
  }
  let tries=0;
  const timer=setInterval(()=>{if(hookLayerControl()||++tries>240)clearInterval(timer)},250);
  window.IrratiGISFirePopup={loadBurnsIntoLayer,hookLayerControl};
})();