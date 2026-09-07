(()=>{
"use strict";

/*
 * Meteosat FRP-PIXEL / LSA SAF
 * Objetivo: mapa acumulado de detecciones de las últimas 24/48/72 h.
 * Cada observación MSG/SEVIRI llega en slots de 15 min.
 * Las detecciones se colorean por antigüedad, al estilo FIRMS.
 * NASA FIRMS no se modifica.
 */
const WMS="https://adaguc.lsasvcs.ipma.pt//adagucserver";
const DATASET="MSG-FRP";
const LAYER="MSG:FRP-PIXEL";
const BBOX=[-5.0,42.3,-0.8,44.0];
const SLOT=15*60*1000;
const REFRESH=15*60*1000;
const LATENCY=30*60*1000;
const COLORS={
  fresh:"#e31a1c",      // 0-6 h
  recent:"#ff8c00",     // 6-24 h
  old:"#ffd21f",        // 24-48 h
  oldest:"#8b8b8b"      // 48-72 h
};

let map=null;
let enabled=false;
let rangeHours=24;
let overlays=new Map();
let currentTimes=[];
let loading=false;
let refreshTimer=null;
let generation=0;
let latestSlot=null;

const $=id=>document.getElementById(id);
function getMap(){return window.IrratiGISMap||((typeof window.map!=="undefined")?window.map:null)}
function iso(d){return new Date(d).toISOString().replace(/\.000Z$/,"Z")}
function round15(d){const x=new Date(d);x.setUTCSeconds(0,0);x.setUTCMinutes(Math.floor(x.getUTCMinutes()/15)*15);return x}
function localFmt(d){return new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Madrid"}).format(d)}
function esc(s){return String(s).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]))}

function status(text,type="info"){
  const e=$("irratiMeteosatStatus");
  if(!e)return;
  e.textContent=text;
  e.dataset.type=type;
  e.style.color=type==="error"?"#a12626":type==="ok"?"#176b43":"#52645a";
}

function ensureFilters(){
  if($("irratiMeteosatFilters"))return;
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.id="irratiMeteosatFilters";
  svg.setAttribute("width","1");svg.setAttribute("height","1");
  svg.style.cssText="position:absolute;width:1px;height:1px;left:-10px;top:-10px;pointer-events:none";
  const defs=document.createElementNS("http://www.w3.org/2000/svg","defs");
  const make=(id,color)=>{
    const f=document.createElementNS("http://www.w3.org/2000/svg","filter");
    f.id=id;f.setAttribute("color-interpolation-filters","sRGB");
    const c=color.replace("#","");
    const r=parseInt(c.slice(0,2),16)/255,g=parseInt(c.slice(2,4),16)/255,b=parseInt(c.slice(4,6),16)/255;
    const m=document.createElementNS("http://www.w3.org/2000/svg","feColorMatrix");
    m.setAttribute("type","matrix");
    m.setAttribute("values",`0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 1 0`);
    f.appendChild(m);defs.appendChild(f);
  };
  make("irratiMeteoFresh",COLORS.fresh);
  make("irratiMeteoRecent",COLORS.recent);
  make("irratiMeteoOld",COLORS.old);
  make("irratiMeteoOldest",COLORS.oldest);
  svg.appendChild(defs);document.body.appendChild(svg);
}

function ageClass(t,ref){
  const h=Math.max(0,(ref-t)/3600000);
  if(h<6)return {name:"fresh",label:"0–6 h",filter:"url(#irratiMeteoFresh)",opacity:.95};
  if(h<24)return {name:"recent",label:"6–24 h",filter:"url(#irratiMeteoRecent)",opacity:.88};
  if(h<48)return {name:"old",label:"24–48 h",filter:"url(#irratiMeteoOld)",opacity:.78};
  return {name:"oldest",label:"48–72 h",filter:"url(#irratiMeteoOldest)",opacity:.68};
}

function mapUrl(t){
  const p=new URLSearchParams({
    dataset:DATASET,SERVICE:"WMS",VERSION:"1.3.0",REQUEST:"GetMap",
    LAYERS:LAYER,STYLES:"auto/nearest",CRS:"EPSG:4326",
    BBOX:`${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}`,
    WIDTH:"1200",HEIGHT:"680",FORMAT:"image/png",TRANSPARENT:"TRUE",
    TIME:iso(t)
  });
  return WMS+"?"+p.toString();
}

function ensurePane(){
  if(!map.getPane("meteosatPane")){
    const p=map.createPane("meteosatPane");
    p.style.zIndex=360;
  }
}

function makePanel(){
  if($("irratiMeteosatPanel"))return;
  const c=document.createElement("div");
  c.id="irratiMeteosatPanel";
  c.className="irrati-meteosat-panel leaflet-control";
  c.innerHTML=`
    <div class="irrati-meteosat-head"><strong>🛰️ Meteosat · FRP</strong><button id="irratiMeteosatClose" type="button">×</button></div>
    <div class="irrati-meteosat-sub">Mapa acumulado · una observación cada 15 min</div>
    <div class="irrati-meteosat-ranges">
      <button id="irratiMeteosatR24" type="button" class="active">24 h</button>
      <button id="irratiMeteosatR48" type="button">48 h</button>
      <button id="irratiMeteosatR72" type="button">72 h</button>
    </div>
    <div class="irrati-meteosat-legend">
      <span><i class="fresh"></i>0–6 h</span>
      <span><i class="recent"></i>6–24 h</span>
      <span><i class="old"></i>24–48 h</span>
      <span><i class="oldest"></i>48–72 h</span>
    </div>
    <div class="irrati-meteosat-time" id="irratiMeteosatTime">—</div>
    <div id="irratiMeteosatStatus" class="irrati-meteosat-status">Meteosat apagado</div>
    <div class="irrati-meteosat-note">El mapa se actualiza automáticamente cada 15 min. Fuente: LSA SAF / EUMETSAT · FRP-PIXEL LSA-502 · ~3 km</div>`;
  map.getContainer().appendChild(c);
  $("irratiMeteosatClose").onclick=()=>toggle(false);
  [24,48,72].forEach(h=>$("irratiMeteosatR"+h).onclick=()=>setRange(h));
}

function updatePanel(){
  [24,48,72].forEach(h=>$("irratiMeteosatR"+h)?.classList.toggle("active",h===rangeHours));
  if($("irratiMeteosatTime")){
    $("irratiMeteosatTime").textContent=latestSlot?`Hasta ${localFmt(latestSlot)} local`:`—`;
  }
}

function clearOverlays(){
  overlays.forEach(o=>{try{map.removeLayer(o.layer)}catch{}});
  overlays.clear();
}

function removeOutside(start,end){
  overlays.forEach((o,key)=>{
    if(o.time<start||o.time>end){try{map.removeLayer(o.layer)}catch{};overlays.delete(key)}
  });
}

function addSlot(t,ref,token){
  const key=t.getTime();
  if(overlays.has(key)){
    const a=ageClass(t,ref);const o=overlays.get(key);o.layer.setOpacity(a.opacity);o.layer.getElement?.().style?.setProperty("filter",a.filter);return Promise.resolve(true);
  }
  return new Promise(resolve=>{
    if(token!==generation||!enabled){resolve(false);return}
    const a=ageClass(t,ref);
    const layer=L.imageOverlay(mapUrl(t),[[BBOX[1],BBOX[0]],[BBOX[3],BBOX[2]]],{
      opacity:a.opacity,alt:`Meteosat FRP-PIXEL ${iso(t)}`,zIndex:360,pane:"meteosatPane",interactive:false
    });
    let finished=false;
    const done=ok=>{
      if(finished)return;finished=true;
      if(ok){
        overlays.set(key,{time:key,layer});
        const img=layer.getElement?.();
        if(img)img.style.filter=a.filter;
        resolve(true);
      }else{try{map.removeLayer(layer)}catch{};resolve(false)}
    };
    layer.once("load",()=>done(true));
    layer.once("error",()=>done(false));
    layer.addTo(map);
    setTimeout(()=>done(false),12000);
  });
}

async function loadWindow(){
  if(!map||!enabled||loading)return;
  loading=true;
  const token=++generation;
  try{
    /* LSA SAF publica el producto con latencia típica de hasta ~30 min. */
    const ref=round15(new Date(Date.now()-LATENCY));
    latestSlot=ref;
    const start=new Date(ref.getTime()-rangeHours*3600000);
    const times=[];
    for(let t=start.getTime();t<=ref.getTime();t+=SLOT)times.push(new Date(t));
    currentTimes=times;
    removeOutside(start,ref);
    updatePanel();

    let done=0,failed=0;
    const queue=times.filter(t=>!overlays.has(t.getTime()));
    status(`Meteosat: cargando acumulado ${rangeHours} h · ${queue.length} observaciones pendientes…`);

    /* Carga progresiva para no bloquear móviles ni saturar el WMS. */
    const workers=Math.min(6,queue.length);
    let cursor=0;
    const worker=async()=>{
      while(cursor<queue.length&&token===generation&&enabled){
        const t=queue[cursor++];
        const ok=await addSlot(t,ref,token);
        if(ok)done++;else failed++;
        if((done+failed)%6===0||done+failed===queue.length){
          status(`Meteosat: ${done}/${times.length} observaciones cargadas${failed?` · ${failed} sin imagen`:""}`);
        }
      }
    };
    await Promise.all(Array.from({length:workers},worker));
    if(token===generation&&enabled){
      /* Reaplica color/opacidad por si el mapa llevaba tiempo abierto. */
      overlays.forEach(o=>{const a=ageClass(new Date(o.time),ref);o.layer.setOpacity(a.opacity);const img=o.layer.getElement?.();if(img)img.style.filter=a.filter});
      status(`Meteosat: acumulado de ${rangeHours} h · ${overlays.size} observaciones disponibles`+(failed?` · ${failed} sin imagen`:""),"ok");
    }
  }catch(e){
    console.error(e);
    status(`Meteosat: error — ${e.message||e}`,"error");
  }finally{loading=false;updatePanel()}
}

function scheduleRefresh(){
  if(refreshTimer)clearTimeout(refreshTimer);
  const now=Date.now();
  const next=(Math.floor(now/REFRESH)+1)*REFRESH+5000;
  refreshTimer=setTimeout(async()=>{
    refreshTimer=null;
    if(enabled){
      /* Solo reconstruimos la ventana; los slots ya descargados se reutilizan. */
      await loadWindow();
      scheduleRefresh();
    }
  },Math.max(5000,next-now));
}

async function toggle(on){
  enabled=!!on;
  makePanel();
  $("irratiMeteosatPanel").style.display=on?"block":"none";
  if(!on){
    generation++;
    if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=null;
    clearOverlays();currentTimes=[];latestSlot=null;
    status("Meteosat apagado");
    window.IrratiGISMeteosatLayer=null;
    return;
  }
  ensureFilters();ensurePane();updatePanel();
  await loadWindow();scheduleRefresh();
}

function setRange(h){
  rangeHours=h;
  if(!enabled){updatePanel();return}
  loadWindow();
}

function addLayerRow(){
  const lists=document.querySelectorAll(".leaflet-control-layers-overlays");
  if(!lists.length)return false;
  lists.forEach(list=>{
    if(list.querySelector(".irrati-meteosat-layer-row"))return;
    const row=document.createElement("label");row.className="irrati-meteosat-layer-row";row.style.display="block";
    const input=document.createElement("input");input.type="checkbox";input.className="leaflet-control-layers-selector";input.checked=enabled;
    input.addEventListener("change",()=>toggle(input.checked));
    const span=document.createElement("span");span.textContent=" 🛰️ Meteosat FRP · acumulado 15 min";
    row.appendChild(input);row.appendChild(span);list.appendChild(row);
  });
  return true;
}

function injectStyle(){
  if($("irratiMeteosatStyle"))return;
  const s=document.createElement("style");s.id="irratiMeteosatStyle";
  s.textContent=`
  .irrati-meteosat-panel{position:absolute;left:10px;bottom:34px;z-index:1002;width:min(320px,calc(100vw - 20px));background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.22);padding:8px;font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c2d24}
  .irrati-meteosat-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.irrati-meteosat-head strong{font-size:13px}.irrati-meteosat-head button{border:0;background:#eef3ef;border-radius:7px;padding:4px 8px;cursor:pointer}
  .irrati-meteosat-sub,.irrati-meteosat-note{color:#65736b;margin-top:3px}.irrati-meteosat-ranges{display:flex;gap:6px;margin-top:9px}.irrati-meteosat-ranges button{flex:1;border:0;border-radius:8px;background:#edf3ef;color:#234233;padding:6px 7px;font-weight:800;cursor:pointer}.irrati-meteosat-ranges button.active{background:#176b43;color:#fff}
  .irrati-meteosat-legend{display:grid;grid-template-columns:repeat(2,1fr);gap:5px;margin-top:6px}.irrati-meteosat-legend span{display:flex;align-items:center;gap:4px;font-size:9px;font-weight:800;color:#46564d}.irrati-meteosat-legend i{display:inline-block;width:10px;height:10px;border-radius:50%}.irrati-meteosat-legend .fresh{background:#e31a1c}.irrati-meteosat-legend .recent{background:#ff8c00}.irrati-meteosat-legend .old{background:#ffd21f}.irrati-meteosat-legend .oldest{background:#8b8b8b}
  .irrati-meteosat-time{text-align:center;font-weight:800;margin:9px 0 4px}.irrati-meteosat-status{margin-top:7px;padding:7px 8px;background:#f7faf8;border-radius:8px;font-weight:700}.irrati-meteosat-note{font-size:9px;margin-top:7px}
  @media(max-width:520px){.irrati-meteosat-panel{left:7px;bottom:52px;width:calc(100vw - 20px)}.irrati-meteosat-legend{grid-template-columns:repeat(2,1fr)}}`;
  document.head.appendChild(s);
}

function boot(){
  map=getMap();
  if(!map||typeof L==="undefined"){setTimeout(boot,500);return}
  injectStyle();ensureFilters();makePanel();addLayerRow();
  if(!window.__irratiMeteosatObserver){
    window.__irratiMeteosatObserver=new MutationObserver(()=>addLayerRow());
    window.__irratiMeteosatObserver.observe(document.body,{childList:true,subtree:true});
  }
}

window.IrratiGISMeteosat={toggle,setRange};
boot();
})();
