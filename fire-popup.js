// IrratiGIS — capa independiente de quemas autorizadas
(function(){
  "use strict";
  const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const esc=v=>String(v??"-").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const val=(o,keys)=>{for(const k of keys){const v=o?.[k];if(v!=null&&String(v).trim()!=="")return v}return "-"};
  const num=v=>{if(v==null)return NaN;const n=Number(String(v).trim().replace(",","."));return Number.isFinite(n)?n:NaN};

  function utm30(e,n){const a=6378137,e2=.0066943800229,k=.9996,e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2)),x=e-500000,y=n,M=y/k,mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2*e2*e2/256));const p=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu),s=Math.sin(p),c=Math.cos(p),t=Math.tan(p),ep=e2/(1-e2),N=a/Math.sqrt(1-e2*s*s),T=t*t,C=ep*c*c,R=a*(1-e2)/Math.pow(1-e2*s*s,1.5),D=x/(N*k),lat=p-(N*t/R)*(D*D/2-(5+3*T+10*C-4*C*C-9*ep)*D**4/24+(61+90*T+298*C+45*T*T-252*ep-3*C*C)*D**6/720),lon=-3*Math.PI/180+(D-(1+2*T+C)*D**3/6+(5-2*C+28*T-3*T*T+8*ep+24*T*T)*D**5/120)/c;return[lat*180/Math.PI,lon*180/Math.PI]}
  function coords(f){const s=f?.solicitud||{};const p=[[f?.latitudea,f?.longitudea],[f?.latitud,f?.longitud],[s?.latitud,s?.longitud],[s?.latitudea,s?.longitudea],[f?.y,f?.x],[f?.coordY,f?.coordX],[f?.coordenadaY,f?.coordenadaX],[f?.utmY,f?.utmX],[f?.norte,f?.este],[s?.y,s?.x]];for(const[a,b]of p){const A=num(a),B=num(b);if(A>=-90&&A<=90&&B>=-180&&B<=180)return[A,B]}for(const[a,b]of p){for(const[x,y]of[[num(a),num(b)],[num(b),num(a)]])if(x>=100000&&x<=900000&&y>=4000000&&y<=5000000){const q=utm30(x,y);if(q[0]>35&&q[0]<50&&q[1]>-10&&q[1]<5)return q}}return null}
  function popup(f,c){const row=(a,b)=>`<div><b>${a}:</b> ${esc(b)}</div>`;return `<div style="min-width:230px"><b>🔥 Quema autorizada</b><hr style="margin:6px 0">${row("Nº permiso",val(f,["baimena","numeroAutorizacion","numAut"]))}${row("Titular",val(f,["titular","nombre"]))}${row("Municipio",val(f,["municipio","udalerria"]))}${row("Inicio",val(f,["fechaInicio"]))}${row("Fin",val(f,["fechaFin"]))}${row("Coordenadas",c[0].toFixed(6)+", "+c[1].toFixed(6))}</div>`}

  let overlay=null,map=null,initialized=false;
  function ensure(){
    if(!window.L||map)return;
    map=window.__irratiGISMap||window.map||null;
    if(!map)return;
    overlay=L.featureGroup();
    window.__irratiGISFireOverlay=overlay;
    L.control.layers(null,{"🔥 Baimendutako erreketak":overlay},{collapsed:true}).addTo(map);
  }
  async function load(){
    ensure();
    const token=window.IrratiGISAuth?.getToken?.();
    if(!overlay||!token)return;
    try{
      const r=await fetch(`${API}/api/active?ts=${Date.now()}`,{cache:"no-store",headers:{Authorization:`Bearer ${token}`}});
      const d=await r.json();
      console.log("IrratiGIS /api/active",r.status,d);
      if(!r.ok)throw Error(d?.error||`HTTP ${r.status}`);
      const fires=Array.isArray(d.fires)?d.fires:[];
      overlay.clearLayers();
      let shown=0,bounds=[];
      for(const f of fires){
        const c=coords(f);
        if(!c)continue;
        const icon=L.divIcon({className:"irrati-fire-icon",html:"🔥",iconSize:[28,28],iconAnchor:[14,14]});
        L.marker(c,{icon}).bindPopup(popup(f,c)).addTo(overlay);
        bounds.push(c);shown++;
      }
      console.log(`IrratiGIS quemas: API=${fires.length}, coordenadas visibles=${shown}`);
      const msg=document.getElementById("message");
      if(msg)msg.textContent=`${shown} baimendutako erreketak kargatu dira.`;
      if(overlay._map&&bounds.length&&!initialized){map.fitBounds(L.latLngBounds(bounds),{padding:[30,30],maxZoom:13});}
      initialized=true;
    }catch(e){
      console.error("IrratiGIS quemas",e);
      const msg=document.getElementById("message");
      if(msg)msg.textContent=`Error quemas GFA: ${e.message||e}`;
    }
  }
  function init(){
    ensure();
    if(!map||!overlay)return false;
    if(!map.__irratiFireOverlayBound){
      map.on("overlayadd",e=>{if(e.layer===overlay)load()});
      map.__irratiFireOverlayBound=true;
    }
    return true;
  }
  function boot(){if(init())load()}
  window.addEventListener("irratiGISAuthenticated",()=>setTimeout(boot,50));
  let n=0;const t=setInterval(()=>{if(init()){clearInterval(t);if(window.IrratiGISAuth?.getToken?.())load()}if(++n>120)clearInterval(t)},250);
  window.IrratiGISFirePopup={loadBurnsIntoLayer:load,hookLayerControl:boot};
})();