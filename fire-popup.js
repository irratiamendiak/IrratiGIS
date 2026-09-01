// IrratiGIS — integración de quemas autorizadas con el mapa existente
(function(){
  "use strict";

  function utm30ToLatLon(easting,northing){
    const a=6378137,eccSquared=0.00669438002290,k0=0.9996;
    const eccPrimeSquared=eccSquared/(1-eccSquared);
    const e1=(1-Math.sqrt(1-eccSquared))/(1+Math.sqrt(1-eccSquared));
    const x=easting-500000,y=northing,M=y/k0;
    const mu=M/(a*(1-eccSquared/4-3*eccSquared*eccSquared/64-5*Math.pow(eccSquared,3)/256));
    const phi1Rad=mu+(3*e1/2-27*Math.pow(e1,3)/32)*Math.sin(2*mu)+(21*e1*e1/16-55*Math.pow(e1,4)/32)*Math.sin(4*mu)+(151*Math.pow(e1,3)/96)*Math.sin(6*mu)+(1097*Math.pow(e1,4)/512)*Math.sin(8*mu);
    const N1=a/Math.sqrt(1-eccSquared*Math.sin(phi1Rad)*Math.sin(phi1Rad));
    const T1=Math.tan(phi1Rad)*Math.tan(phi1Rad),C1=eccPrimeSquared*Math.cos(phi1Rad)*Math.cos(phi1Rad);
    const R1=a*(1-eccSquared)/Math.pow(1-eccSquared*Math.sin(phi1Rad)*Math.sin(phi1Rad),1.5),D=x/(N1*k0);
    const lat=phi1Rad-(N1*Math.tan(phi1Rad)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*eccPrimeSquared)*Math.pow(D,4)/24+(61+90*T1+298*C1+45*T1*T1-252*eccPrimeSquared-3*C1*C1)*Math.pow(D,6)/720);
    const lon0=-3*Math.PI/180;
    const lon=lon0+(D-(1+2*T1+C1)*Math.pow(D,3)/6+(5-2*C1+28*T1-3*C1*C1+8*eccPrimeSquared+24*T1*T1)*Math.pow(D,5)/120)/Math.cos(phi1Rad);
    return [lat*180/Math.PI,lon*180/Math.PI];
  }

  function normalizePoint(coords){
    const y=Number(coords?.[0]),x=Number(coords?.[1]);
    if(!Number.isFinite(y)||!Number.isFinite(x)) return coords;
    if(Math.abs(y)<=90&&Math.abs(x)<=180) return [y,x];
    if(x>100000&&x<900000&&y>0&&y<10000000) return utm30ToLatLon(x,y);
    return coords;
  }

  function installNativeBurnMarkerHook(){
    if(!window.L||typeof L.circleMarker!=="function"||L.__irratiGfaBurnHook)return;
    const original=L.circleMarker;

    // El index.html crea las quemas con exactamente estas opciones.
    // El hook es permanente para evitar la carrera con waitForIrratiGISAuth():
    // el cargador nativo puede empezar antes que fire-popup.boot().
    L.circleMarker=function(coords,options){
      const o=options||{};
      const isGfaBurn = Number(o.radius)===8 && Number(o.weight)===2 && Number(o.fillOpacity)===0.85;
      if(!isGfaBurn) return original.call(this,coords,options);

      const point=normalizePoint(coords);
      const icon=L.divIcon({
        className:"irrati-gfa-fire-icon",
        html:"<span style=\"font-size:30px;line-height:32px;text-shadow:0 1px 3px rgba(0,0,0,.55);\">🔥</span>",
        iconSize:[34,34],
        iconAnchor:[17,31],
        popupAnchor:[0,-27]
      });
      return L.marker(point,{icon,zIndexOffset:1000});
    };

    L.__irratiGfaBurnHook=true;
    L.__irratiGfaOriginalCircleMarker=original;
    console.log("IrratiGIS: hook permanente de marcadores 🔥 instalado");
  }

  function boot(){
    installNativeBurnMarkerHook();
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",boot,{once:true});
  }else{
    boot();
  }

  window.IrratiGISFirePopup={
    loadBurnsIntoLayer:boot,
    hookLayerControl:boot
  };
})();