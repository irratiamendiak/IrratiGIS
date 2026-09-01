// IrratiGIS — integración de quemas autorizadas con el mapa existente
(function(){
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";

  function token(){return window.IrratiGISAuth?.getToken?.()||localStorage.getItem("irratigis_session_token")||sessionStorage.getItem("irratigis_session_token_temp")||"";}

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
    L.circleMarker=function(coords,options){
      if(!L.__irratiGfaBurnLoading)return original.call(this,coords,options);
      const point=normalizePoint(coords);
      const icon=L.divIcon({className:"irrati-gfa-fire-icon",html:"<span style=\"font-size:30px;line-height:32px;text-shadow:0 1px 3px rgba(0,0,0,.55);\">🔥</span>",iconSize:[34,34],iconAnchor:[17,31],popupAnchor:[0,-27]});
      return L.marker(point,{icon,zIndexOffset:1000});
    };
    L.__irratiGfaBurnHook=true;
    L.__irratiGfaOriginalCircleMarker=original;
    console.log("IrratiGIS: hook de marcadores 🔥 instalado");
  }

  async function loadBurnsIntoNativeLayer(){
    installNativeBurnMarkerHook();
    if(typeof window.loadControlledBurns!=="function")return false;
    L.__irratiGfaBurnLoading=true;
    try{
      await window.loadControlledBurns();
      return true;
    }catch(e){
      console.error("IrratiGIS native burn loader",e);
      return false;
    }finally{
      L.__irratiGfaBurnLoading=false;
    }
  }

  async function diagnostic(){
    const t=token();if(!t)return;
    try{
      const r=await fetch(`${API}/api/active?ts=${Date.now()}`,{cache:"no-store",headers:{Authorization:`Bearer ${t}`}});
      const d=await r.json();
      console.log("IrratiGIS quemas diagnóstico",r.status,d);
      const msg=document.getElementById("message");
      if(msg&&r.ok)msg.textContent=`GFA: ${Array.isArray(d.fires)?d.fires.length:0} quemas recibidas.`;
    }catch(e){console.error("IrratiGIS diagnóstico quemas",e)}
  }

  async function boot(){
    if(!token())return;
    installNativeBurnMarkerHook();
    await loadBurnsIntoNativeLayer();
    await diagnostic();
  }

  window.addEventListener("irratiGISAuthenticated",()=>setTimeout(boot,100));
  window.addEventListener("load",()=>setTimeout(boot,500));
  let n=0;const timer=setInterval(()=>{if(token()){boot();clearInterval(timer)}if(++n>120)clearInterval(timer)},250);
  window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot};
})();