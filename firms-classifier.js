(()=>{
"use strict";
const VERSION="20260908-bermeo2";
const INDUSTRIAL_TAGS=["industrial","quarry","brownfield","works","kiln","plant","chimney","storage_tank","silo","power","generator","substation","landfill"];
const FOREST_TAGS=["forest","wood","scrub","heath","fell"];
const VEGETATION_TAGS=["forest","wood","scrub","heath","fell","farmland","farmyard","meadow","orchard","vineyard","grassland","grass","allotments","greenfield","plant_nursery","greenhouse_horticulture","animal_keeping"];
const URBAN_TAGS=["residential","retail","institutional","parking","commercial","construction","depot"];
const NAV_WFS="https://idena.navarra.es/ogc/wfs",SPAIN_WFS="https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx",ARABA_WFS="https://geo.araba.eus/WFS_INSPIRE_CP";
const cadCache=new Map();
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function confidenceValue(v){if(v==null||v==="")return null;if(typeof v==="string"){const s=v.trim().toLowerCase();if(s==="high"||s==="h")return 90;if(["nominal","medium","med","n"].includes(s))return 65;if(s==="low"||s==="l")return 35}const n=num(v);return n==null?null:Math.max(0,Math.min(100,n))}
function hasTag(ctx,tags){const values=Array.isArray(ctx?.tags)?ctx.tags.map(x=>String(x).toLowerCase()):[];return tags.some(t=>values.some(v=>v===t||v.endsWith(`=${t}`)||v.includes(`=${t},`)||v.includes(`,${t}`)))}
function classify(firms,context={}){
 const frp=num(firms?.frp??firms?.properties?.frp),confidence=confidenceValue(firms?.confidence??firms?.confidence_pct??firms?.properties?.confidence??firms?.properties?.confidence_pct);
 const repeated=Math.max(0,Math.round(num(context.repeatedDetections)??0)),temporal=Math.max(0,Math.round(num(context.temporalRepeatedDetections)??0));
 const clusterFire=context.clusterFire===true,parcelUrban=context.parcelUrban===true,parcelRural=context.parcelRural===true;
 const industrialTag=hasTag(context,INDUSTRIAL_TAGS),explicitForest=hasTag(context,FOREST_TAGS),vegetation=hasTag(context,VEGETATION_TAGS);
 const urbanOsm=hasTag(context,URBAN_TAGS)||industrialTag;
 const nearestIndustrial=num(context.nearestIndustrialMeters),nearestForest=num(context.nearestForestMeters);
 const veryNearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=100;
 const localForest=context.localForest===true||explicitForest||(nearestForest!=null&&nearestForest<=150);
 const ruralNatural=!parcelUrban&&(parcelRural||vegetation||localForest||context.ruralNatural===true);
 const strong=(frp!=null&&frp>=20)||(confidence!=null&&confidence>=80);
 const clusteredWildland=clusterFire&&confidence!=null&&confidence>=50;
 let score=25,reasons=[];
 if(parcelUrban){score-=25;reasons.push("parcela catastral urbana")}
 if(parcelRural){score+=18;reasons.push("parcela catastral rústica")}
 if(localForest&&!parcelUrban){score+=35;reasons.push("entorno forestal/natural")}
 else if(vegetation&&!parcelUrban){score+=20;reasons.push("entorno de vegetación rural")}
 if(urbanOsm){score-=10;reasons.push("entorno urbano")}
 if(industrialTag&&veryNearIndustrial){score-=25;reasons.push("actividad industrial inmediata")}
 else if(nearestIndustrial!=null&&nearestIndustrial<=300){score-=5;reasons.push(`actividad industrial a ${Math.round(nearestIndustrial)} m`)}
 if(repeated>0){score+=Math.min(24,repeated*8);reasons.push(`${repeated} detección${repeated===1?"":"es"} próximas`)}
 if(temporal>0){score+=Math.min(18,temporal*6);reasons.push(`${temporal} detección${temporal===1?"":"es"} en momentos distintos`)}
 if(clusteredWildland){score+=20;reasons.push("cluster de detecciones compatible con frente de incendio")}
 if(frp!=null){score+=frp>=50?20:frp>=20?15:frp>=5?8:2;reasons.push(`FRP ${frp} MW`)}
 if(confidence!=null){score+=confidence>=80?15:confidence>=50?8:2;reasons.push(`confianza ${Math.round(confidence)}%`)}
 if(ruralNatural&&!parcelUrban&&!veryNearIndustrial){score+=10;reasons.push("entorno rural/natural compatible con incendio de vegetación")}
 score=Math.max(0,Math.min(100,Math.round(score)));
 let category="thermal_anomaly";
 if(parcelUrban) category=(industrialTag||veryNearIndustrial)?"probable_industrial_source":(strong||clusterFire?"possible_fire":"thermal_anomaly");
 else if(industrialTag&&veryNearIndustrial) category="probable_industrial_source";
 else if(localForest) category="probable_forest_fire";
 else if(clusteredWildland) category="probable_forest_fire";
 else if((parcelRural||vegetation)&&(clusterFire||temporal>0||repeated>=2)) category="probable_forest_fire";
 else if(ruralNatural&&(strong||clusterFire||temporal>0||repeated>0||score>=40)) category="probable_forest_fire";
 else if(ruralNatural) category="possible_fire";
 else if(vegetation&&(clusterFire||strong||temporal>0)&&score>=45) category="probable_forest_fire";
 else if(strong||clusterFire||score>=40) category="possible_fire";
 const labels={probable_forest_fire:"🔥 Probable incendio forestal",possible_fire:"🟠 Posible incendio",thermal_anomaly:"♨️ Anomalía térmica",probable_industrial_source:"🏭 Probable fuente industrial"};
 return{category,label:labels[category],score,reasons,confidence,frp,nearestIndustrialMeters:nearestIndustrial,repeatedDetections:repeated,temporalRepeatedDetections:temporal,parcelUrban,parcelRural,parcelClassification:context.parcelClassification||null};
}
function isNavarra(lat,lon){return lat>=42.4&&lat<=43.4&&lon>=-2.1&&lon<=-0.7}
function isAraba(lat,lon){return lat>=42.45&&lat<=43.25&&lon>=-3.45&&lon<=-2.15}
function key(lat,lon){return`${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`}
function utm30(lat,lon){const a=6378137,e=.0818191908426,k=.9996,r=Math.PI/180,p=lat*r,l=lon*r,l0=-3*r,ep=e*e/(1-e*e),N=a/Math.sqrt(1-e*e*Math.sin(p)**2),T=Math.tan(p)**2,C=ep*Math.cos(p)**2,A=Math.cos(p)*(l-l0),M=a*((1-e*e/4-3*e**4/64-5*e**6/256)*p-(3*e*e/8+3*e**4/32+45*e**6/1024)*Math.sin(2*p)+(15*e**4/256+45*e**6/1024)*Math.sin(4*p)-(35*e**6/3072)*Math.sin(6*p));return[k*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep)*A**5/120)+500000,k*(M+N*Math.tan(p)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep)*A**6/720)]}
async function navQuery(type,lat,lon){const d=.00003,p=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",typenames:`IDENA:${type}`,srsname:"EPSG:4326",bbox:`${lon-d},${lat-d},${lon+d},${lat+d}`,outputFormat:"application/json",count:"1"}),r=await fetch(`${NAV_WFS}?${p}`,{cache:"no-store"});if(!r.ok)throw Error(`IDENA ${type}: ${r.status}`);try{const j=await r.json();return Array.isArray(j?.features)?j.features:[]}catch{return[]}}
async function genericQuery(url,lat,lon){const[x,y]=utm30(lat,lon),d=3,p=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",typenames:"CP:CadastralParcel",srsname:"EPSG::25830",bbox:`${x-d},${y-d},${x+d},${y+d}`,count:"2"}),r=await fetch(`${url}?${p}`,{cache:"no-store"});if(!r.ok)throw Error(`Catastro WFS: ${r.status}`);const doc=new DOMParser().parseFromString(await r.text(),"application/xml"),out=[];for(const el of doc.getElementsByTagNameNS("*","CadastralParcel")){for(const n of["nationalCadastralReference","localId"]){const q=el.getElementsByTagNameNS("*",n)[0];if(q?.textContent){out.push(q.textContent.trim());break}}}return out}
function refKind(ref){const r=String(ref||"").replace(/\s/g,"").toUpperCase();if(!r)return null;if(/^\d{5}[A-Z]/.test(r))return"rural";if(/^\d{7}/.test(r))return"urban";return null}
function empty(){return{parcelUrban:false,parcelRural:false,parcelClassification:null}}
async function cadastre(lat,lon){const k=key(lat,lon);if(cadCache.has(k))return cadCache.get(k);const p=(async()=>{try{if(isNavarra(lat,lon)){const[u,r,m]=await Promise.all([navQuery("CATAST_Pol_ParcelaUrba",lat,lon),navQuery("CATAST_Pol_ParcelaRusti",lat,lon),navQuery("CATAST_Pol_ParcelaMixta",lat,lon)]);if(u.length)return{parcelUrban:true,parcelRural:false,parcelClassification:"parcela catastral urbana"};if(r.length||m.length)return{parcelUrban:false,parcelRural:true,parcelClassification:m.length?"parcela catastral mixta (tratada como rústica)":"parcela catastral rústica"};return empty()}
 if(isAraba(lat,lon)){const knd=refKind((await genericQuery(ARABA_WFS,lat,lon))[0]);return knd==="urban"?{parcelUrban:true,parcelRural:false,parcelClassification:"parcela catastral urbana"}:knd==="rural"?{parcelUrban:false,parcelRural:true,parcelClassification:"parcela catastral rústica"}:empty()}
 if(lat>=41.6&&lat<=43.35&&lon>=-3.55&&lon<=-0.9){const knd=refKind((await genericQuery(SPAIN_WFS,lat,lon))[0]);return knd==="urban"?{parcelUrban:true,parcelRural:false,parcelClassification:"parcela catastral urbana"}:knd==="rural"?{parcelUrban:false,parcelRural:true,parcelClassification:"parcela catastral rústica"}:empty()}
 }catch(e){console.warn("Catastro FIRMS:",e)}return empty()})();cadCache.set(k,p);return p}
window.IrratiGISFirmsClassifier={classify,cadastre,version:VERSION};
window.IrratiGISFirmsClassifierVersion=VERSION;
window.IrratiGISFirmsCadastreVersion=VERSION;
})();
