(()=>{
  "use strict";
  const FIRMS_SRC="firms.js?v=20260902-04";
  let firmsPromise=null;
  function loadFirms(){
    if(window.IrratiGISFirms)return Promise.resolve(window.IrratiGISFirms);
    if(firmsPromise)return firmsPromise;
    firmsPromise=new Promise(resolve=>{
      const old=document.getElementById("irratiFirmsScript");
      if(old)old.remove();
      const s=document.createElement("script");
      s.id="irratiFirmsScript";
      s.src=FIRMS_SRC;
      s.onload=()=>resolve(window.IrratiGISFirms||null);
      s.onerror=()=>resolve(null);
      document.head.appendChild(s);
    });
    return firmsPromise;
  }
  function openFirms(){
    return loadFirms().then(api=>{
      if(api&&typeof api.open==="function")api.open();
      return api;
    });
  }
  function boot(){
    try{if(typeof window.loadControlledBurns==="function")window.loadControlledBurns()}catch(e){console.error(e)}
    openFirms();
  }
  window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot,openFirms};
})();
