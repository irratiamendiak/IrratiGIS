// IrratiGIS — integración de quemas autorizadas con el mapa existente
(function(){
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";

  function token(){return window.IrratiGISAuth?.getToken?.()||localStorage.getItem("irratigis_session_token")||sessionStorage.getItem("irratigis_session_token_temp")||"";}

  async function loadBurnsIntoNativeLayer(){
    // index.html owns the real Leaflet map and controlledBurnLayer in its lexical scope.
    // Use its loader directly instead of trying to recover the map object from another script.
    if(typeof window.loadControlledBurns === "function"){
      try{
        await window.loadControlledBurns();
        return true;
      }catch(e){
        console.error("IrratiGIS native burn loader",e);
      }
    }
    return false;
  }

  async function diagnostic(){
    const t=token();
    if(!t)return;
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
    await loadBurnsIntoNativeLayer();
    await diagnostic();
  }

  window.addEventListener("irratiGISAuthenticated",()=>setTimeout(boot,100));
  window.addEventListener("load",()=>setTimeout(boot,250));
  let n=0;const t=setInterval(()=>{if(token()){boot();clearInterval(t)}if(++n>120)clearInterval(t)},250);

  window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot};
})();