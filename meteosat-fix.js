(()=>{
"use strict";
const WMS="https://adaguc.lsasvcs.ipma.pt//adagucserver?dataset=MSG-FRP",LAYER="MSG:FRP-PIXEL";
let layers=[],busy=false;
const map=()=>window.IrratiGISMap||null;
function msg(t,type="info"){const m=map();if(!m)return;let e=document.getElementById("irratiMeteosatFixStatus");if(!e){e=document.createElement("div");e.id="irratiMeteosatFixStatus";e.style.cssText="position:absolute;left:10px;bottom:70px;z-index:1002;padding:7px 10px;border-radius:9px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.2);font:800 12px system-ui;max-width:560px;pointer-events:none";m.getContainer().appendChild(e)}e.textContent=t;e.style.color=type==="error"?"#a12626":type==="ok"?"#176b43":"#345243";e.style.display="block"}
function clear(){const m=map();layers.forEach(x=>{try{m?.removeLayer(x)}catch{}});layers=[]}
function now(){const d=new Date();d.setUTCSeconds(0,0);d.setUTCMinutes(Math.floor(d.getUTCMinutes()/15)*15);return d}
function wt(d){return d.toISOString().replace(/\.000Z$/,"Z")}
function wms(t,opacity=.9,version="1.1.1"){const m=map();const p={layers:LAYER,styles:"default",format:"image/png",transparent:true,version,opacity,attribution:"© EUMETSAT / LSA SAF",uppercase:true};if(version==="1.1.1")p.srs="EPSG:4326";else p.crs=L.CRS.EPSG4326;p.time=wt(t);const x=L.tileLayer.wms(WMS,p).addTo(m);layers.push(x);return x}
function wait(x){return new Promise(r=>{let done=false;const tm=setTimeout(()=>{if(!done){done=true;r(false)}},7000);x.once("tileload",()=>{if(!done){done=true;clearTimeout(tm);r(true)}});x.once("tileerror",()=>{if(!done){done=true;clearTimeout(tm);r(false)}})})}
async function load(){if(busy)return;const m=map();if(!m)return;busy=true;clear();try{const n=now();const candidates=[n,new Date(n-15*60000),new Date(n-30*60000),new Date(n-60*60000)];let good=null;for(const t of candidates){msg(`Meteosat: probando FRP-PIXEL ${wt(t)}…`);const x=wms(t,.9,"1.1.1");if(await wait(x)){good=x;break}m.removeLayer(x);layers=layers.filter(y=>y!==x)}if(!good){msg("Meteosat: el WMS oficial sigue rechazando las teselas FRP-PIXEL.","error");return}msg(`Meteosat: FRP-PIXEL cargado (${good.wmsParams.time}) · histórico opcional`,"ok");window.IrratiGISMeteosatLayer=good}catch(e){console.error(e);msg(`Meteosat: ERROR — ${e.message||e}`,"error")}finally{busy=false}}
function hook(){const m=map(),row=document.querySelector(".irrati-meteosat-layer-row"),i=row?.querySelector("input");if(!m||!row||!i)return false;i.onchange=()=>i.checked?load():(clear(),msg("Meteosat: desactivado"));return true}
function boot(){if(hook())return;setTimeout(boot,500)}
boot();
})();
