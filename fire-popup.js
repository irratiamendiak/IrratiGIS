(()=>{"use strict";
const API="https://irratigis-api.pages.dev";
let layer=null,loading=false,rowBound=false,statusEl=null;
const token=()=>window.IrratiGISAuth?.getToken?.()||"";
const getMap=()=>window.IrratiGISMap||null;
function getLayer(){if(!layer)layer=window.IrratiGISFirmsLayer||null;if(!layer&&typeof L!=="undefined")layer=L.featureGroup();if(layer)window.IrratiGISFirmsLayer=layer;return layer}
function status(text,type="info"){const map=getMap();if(!map)return;if(!statusEl){statusEl=document.createElement("div");statusEl.id="irratiFirmsStatus";statusEl.style.cssText="position:absolute;left:10px;bottom:10px;z-index:1000;padding:7px 10px;border-radius:9px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.2);font:800 12px system-ui;color:#345243;max-width:420px;pointer-events:none";map.getContainer().appendChild(statusEl)}statusEl.textContent=text;statusEl.style.color=type==="error"?"#a12626":type==="ok"?"#176b43":"#345243";statusEl.style.display="block"}
function ensureRow(){const map=getMap(),firms=getLayer();if(!map||!firms)return null;const list=document.querySelector(".leaflet-control-layers-overlays");if(!list)return null;const rows=[...list.querySelectorAll("[data-irrati-firms-row]")];rows.slice(1).forEach(r=>r.remove());let row=list.querySelector(".irrati-firms-layer-row")||list.querySelector("[data-irrati-firms-row]");if(!row){row=document.createElement("label");row.className="irrati-firms-layer-row";row.setAttribute("data-irrati-firms-row","1");row.style.display="block";const input=document.createElement("input");input.type="checkbox";input.className="leaflet-control-layers-selector";row.appendChild(input);const span=document.createElement("span");span.textContent=" 🚨 NASA FIRMS";row.appendChild(span);list.appendChild(row)}const input=row.querySelector("input");if(input&&!rowBound){rowBound=true;input.addEventListener("change",()=>{if(input.checked){firms.addTo(map);load()}else{map.removeLayer(firms);status("NASA FIRMS: itzalita")}})}if(input)input.checked=map.hasLayer(firms);return input}
function coords(f){let lat=f?.latitude??f?.lat??f?.y,lon=f?.longitude??f?.lon??f?.lng??f?.x;if((lat==null||lon==null)&&Array.isArray(f?.geometry?.coordinates)){[lon,lat]=f.geometry.coordinates}lat=Number(lat);lon=Number(lon);return Number.isFinite(lat)&&Number.isFinite(lon)?[lat,lon]:null}
function items(d){return Array.isArray(d?.fires)?d.fires:Array.isArray(d?.detections)?d.detections:Array.isArray(d?.data)?d.data:Array.isArray(d?.features)?d.features:[]}
async function load(){if(loading)return;const map=getMap(),firms=getLayer(),t=token();if(!map||!firms||typeof L==="undefined"){status("NASA FIRMS: mapa ez dago prest","error");return}if(!t){status("NASA FIRMS: saio-tokenik ez","error");return}loading=true;status("NASA FIRMS: datuak kargatzen…");try{const r=await fetch(`${API}/api/firms?days=5`,{headers:{Authorization:`Bearer ${t}`}});const raw=await r.text();let d={};try{d=JSON.parse(raw)}catch(_){throw new Error(`FIRMS erantzuna ez da JSON: ${raw.slice(0,160)}`)}if(!r.ok)throw new Error(d.detail||d.error||`HTTP ${r.status}`);const arr=items(d);firms.clearLayers();let count=0,bad=0;for(const f of arr){const c=coords(f);if(!c){bad++;continue}const m=L.circleMarker(c,{radius:8,weight:2,color:"#8b0000",fillColor:"#ff3b00",fillOpacity:.95});m.bindPopup(`<strong>🛰️ NASA FIRMS</strong><br>Data: ${f.acqDate||f.acq_date||"—"}<br>Ordua: ${f.acqTime||f.acq_time||"—"}<br>Satelitea: ${f.satellite||f.satellite_name||"—"}<br>Konfiantza: ${f.confidence??f.confidence_pct??"—"}<br>FRP: ${f.frp??"—"} MW<br>Koordenatuak: ${c[0].toFixed(5)}, ${c[1].toFixed(5)}`);firms.addLayer(m);count++}if(count>0)firms.addTo(map);const input=ensureRow();if(input)input.checked=count>0;status(count>0?`NASA FIRMS: ${count} detekzio mapan (${bad} koordenatu baliogabe)`: `NASA FIRMS: 0 detekzio (APIak ${arr.length} erregistro bidali ditu)`,count>0?"ok":"info");console.info("IrratiGIS FIRMS",{count,bad,response:d})}catch(e){console.error("IrratiGIS FIRMS:",e);firms.clearLayers();status(`NASA FIRMS: ERROREA — ${e.message||e}`,"error")}finally{loading=false}}
function boot(){const map=getMap(),firms=getLayer();if(!map||!firms)return;ensureRow();status("NASA FIRMS: prest");setTimeout(ensureRow,500);setTimeout(load,1200)}

const METEOSAT_WMS="https://adaguc.lsasvcs.ipma.pt//adagucserver";
const METEOSAT_DATASET="MSG-FRP";
const METEOSAT_BASE={dataset:METEOSAT_DATASET,layers:"",styles:"",format:"image/png",transparent:true,version:"1.1.1",opacity:.98,zIndex:650,attribution:"© EUMETSAT / LSA SAF"};
let meteosatLayer=null,meteosatBusy=false,meteosatLayerName="",meteosatTileLoads=0,meteosatTileErrors=0;
function round15(d){const x=new Date(d);x.setUTCMinutes(Math.floor(x.getUTCMinutes()/15)*15,0,0);return x}
function fallbackMeteosatTime(){return new Date(round15(Date.now()-30*60*1000)).toISOString()}
function findTimeDimension(layer){let node=layer;while(node){const direct=[...node.children].find(e=>{const n=e.getAttribute?.("name")?.toLowerCase();return (e.localName==="Dimension"||e.localName==="Extent")&&n==="time"});if(direct)return direct;node=node.parentElement}return null}
async function readMeteosatCapabilities(){
  const url=`${METEOSAT_WMS}?dataset=${encodeURIComponent(METEOSAT_DATASET)}&SERVICE=WMS&REQUEST=GetCapabilities&_irrati=${Date.now()}`;
  const r=await fetch(url,{cache:"no-store",mode:"cors"});
  if(!r.ok)throw new Error(`GetCapabilities HTTP ${r.status}`);
  const text=await r.text();
  const xml=new DOMParser().parseFromString(text,"text/xml");
  if(xml.getElementsByTagName("parsererror").length)throw new Error("GetCapabilities XML inválido");
  const all=[...xml.getElementsByTagName("Layer")];
  const target=all.find(l=>{const title=[...l.children].find(e=>e.localName==="Title")?.textContent||"";const abstract=[...l.children].find(e=>e.localName==="Abstract")?.textContent||"";return /FRP-PIXEL/i.test(title)||/FRP-PIXEL/i.test(abstract)});
  if(!target)throw new Error("No se encontró la capa FRP-PIXEL en GetCapabilities");
  const name=[...target.children].find(e=>e.localName==="Name")?.textContent?.trim();
  if(!name)throw new Error("La capa FRP-PIXEL no tiene Name");
  const dim=findTimeDimension(target);
  if(!dim)throw new Error("La capa FRP-PIXEL no tiene dimensión TIME");
  const raw=dim.textContent.replace(/\s+/g," ").trim();
  const parts=raw.split(/[;,]/).map(s=>s.trim()).filter(Boolean);let candidate=parts[parts.length-1]||"";if(candidate.includes("/"))candidate=candidate.split("/")[1];
  const dt=new Date(candidate);if(!Number.isFinite(dt.getTime()))throw new Error("TIME de FRP-PIXEL no es válido");
  const latest=new Date(Math.min(dt.getTime(),Date.now())).toISOString();return {name,time:latest}
}
async function latestMeteosat(){try{return await readMeteosatCapabilities()}catch(e){console.warn("IrratiGIS Meteosat GetCapabilities:",e);return {name:meteosatLayerName||"",time:fallbackMeteosatTime(),fallback:true,error:e}}}
function attachMeteosatDiagnostics(l){
  if(!l||l.__irratiDiag)return l;l.__irratiDiag=true;
  l.on("tileloadstart",e=>{meteosatTileLoads++;console.info("IrratiGIS Meteosat GetMap START",e.tile?.src||e);});
  l.on("tileload",e=>{console.info("IrratiGIS Meteosat GetMap OK",{url:e.tile?.src||"",layers:l.wmsParams?.layers||"",time:l.wmsParams?.time||"",loads:meteosatTileLoads,errors:meteosatTileErrors});});
  l.on("tileerror",e=>{meteosatTileErrors++;console.error("IrratiGIS Meteosat GetMap ERROR",{url:e.tile?.src||"",layers:l.wmsParams?.layers||"",time:l.wmsParams?.time||"",error:e.error||e,loads:meteosatTileLoads,errors:meteosatTileErrors});status(`Meteosat: GetMap ERROR (${meteosatTileErrors}) — abre F12 > Console` ,"error")});
  return l
}
function createMeteosatLayer(name){return attachMeteosatDiagnostics(L.tileLayer.wms(METEOSAT_WMS,{...METEOSAT_BASE,layers:name}))}
async function refreshMeteosat(){
  const map=getMap();if(!map||!meteosatLayer||!map.hasLayer(meteosatLayer)||meteosatBusy)return;
  meteosatBusy=true;meteosatTileLoads=0;meteosatTileErrors=0;status("Meteosat: buscando último FRP-PIXEL…");
  try{
    const info=await latestMeteosat();
    if(info.name&&info.name!==meteosatLayerName){meteosatLayerName=info.name;const wasOn=map.hasLayer(meteosatLayer);map.removeLayer(meteosatLayer);meteosatLayer=createMeteosatLayer(meteosatLayerName);window.IrratiGISMeteosatLayer=meteosatLayer;if(wasOn)meteosatLayer.addTo(map)}
    if(!meteosatLayerName)throw new Error(info.error?.message||"No se pudo determinar la capa FRP-PIXEL");
    meteosatLayer.setParams({...METEOSAT_BASE,layers:meteosatLayerName,time:info.time,_irrati:Date.now()});meteosatLayer.redraw();
    status(`Meteosat: FRP-PIXEL ${info.time.slice(11,16)} UTC · capa ${meteosatLayerName} · esperando GetMap…`,"ok");
    console.info("IrratiGIS Meteosat",{layer:meteosatLayerName,time:info.time,fallback:!!info.fallback});
    setTimeout(()=>{if(meteosatTileLoads===0&&meteosatTileErrors===0)status(`Meteosat: sin respuesta de teselas GetMap — revisa F12 > Console`,`error`);else if(meteosatTileErrors>0)status(`Meteosat: GetMap con ${meteosatTileErrors} errores / ${meteosatTileLoads} cargas`,`error`);else status(`Meteosat: GetMap OK · capa ${meteosatLayerName} · ${meteosatTileLoads} teselas solicitadas`,"ok")},5000);
  }catch(e){console.error("IrratiGIS Meteosat:",e);status(`Meteosat: ERROR — ${e.message||e}`,"error")}finally{meteosatBusy=false}
}
function initMeteosat(){
  const map=getMap();if(!map||typeof L==="undefined")return setTimeout(initMeteosat,500);
  const list=document.querySelector(".leaflet-control-layers-overlays");if(!list)return setTimeout(initMeteosat,500);
  let row=list.querySelector(".irrati-meteosat-layer-row");
  if(!row){row=document.createElement("label");row.className="irrati-meteosat-layer-row";row.style.display="block";const input=document.createElement("input");input.type="checkbox";input.className="leaflet-control-layers-selector";row.appendChild(input);const span=document.createElement("span");span.textContent=" 🌍 Meteosat - incendios";row.appendChild(span);list.appendChild(row)}
  const input=row.querySelector("input");
  if(!input.dataset.meteosatBound){input.dataset.meteosatBound="1";input.addEventListener("change",async()=>{if(input.checked){if(!meteosatLayer)meteosatLayer=createMeteosatLayer(meteosatLayerName||"");meteosatLayer.addTo(map);await refreshMeteosat()}else{if(meteosatLayer)map.removeLayer(meteosatLayer);status("Meteosat: itzalita")}})}
  input.checked=map.hasLayer(meteosatLayer);
  window.IrratiGISMeteosat={get layer(){return meteosatLayer},open:async()=>{input.checked=true;if(!meteosatLayer)meteosatLayer=createMeteosatLayer(meteosatLayerName||"");meteosatLayer.addTo(map);await refreshMeteosat()},refresh:refreshMeteosat};
  if(!window.IrratiGISMeteosatTimer)window.IrratiGISMeteosatTimer=setInterval(()=>window.IrratiGISMeteosat?.refresh?.(),15*60*1000)
}
window.IrratiGISFirms={get layer(){return getLayer()},load,registerLayerControl:ensureRow,open:()=>{const m=getMap(),l=getLayer();if(m&&l){ensureRow();l.addTo(m);load()}}};
window.IrratiGISFirePopup={loadBurnsIntoLayer:boot,hookLayerControl:boot,openFirms:()=>window.IrratiGISFirms.open()};
boot();initMeteosat();
})();