(()=>{
"use strict";
const VERSION="20260907-13";

/*
 * Clasificador orientativo de detecciones NASA FIRMS.
 *
 * Regla geográfica principal:
 * - Suelo urbano / suelo de actividades económicas urbano:
 *   NO se considera incendio forestal.
 * - Suelo rural/no urbanizable:
 *   puede ser incendio forestal si hay vegetación/bosque/interfaz.
 * - La cercanía de bosque a una parcela urbana no convierte el foco
 *   en forestal.
 *
 * Además se enriquece cada marcador con Udalplan (geoEuskadi) mediante
 * consulta espacial al punto FIRMS. Esto permite distinguir el suelo
 * donde cae realmente el foco, en lugar de agregar landuse de 1 km.
 */

const INDUSTRIAL_TAGS=[
  "industrial","quarry","brownfield","works","kiln","plant","chimney",
  "storage_tank","silo","power","generator","substation","landfill"
];
const FOREST_TAGS=["forest","wood","scrub","heath","fell"];
const VEGETATION_TAGS=[
  "forest","wood","scrub","heath","fell","farmland","meadow",
  "orchard","vineyard","grassland","allotments"
];
const URBAN_TAGS=[
  "residential","retail","institutional","parking","commercial",
  "industrial","construction","depot"
];

function num(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null
}
function confidenceValue(value){
  if(value==null||value==="")return null;
  if(typeof value==="string"){
    const s=value.trim().toLowerCase();
    if(s==="high"||s==="h")return 90;
    if(s==="nominal"||s==="medium"||s==="med"||s==="n")return 65;
    if(s==="low"||s==="l")return 35;
  }
  const n=num(value);
  return n==null?null:Math.max(0,Math.min(100,n));
}
function hasTag(context,tags){
  const values=Array.isArray(context?.tags)
    ?context.tags.map(x=>String(x).toLowerCase())
    :[];
  return tags.some(tag=>values.includes(tag));
}

function classify(firms,context={}){
  const frp=num(firms?.frp);
  const confidence=confidenceValue(firms?.confidence??firms?.confidence_pct);
  const repeated=Math.max(0,Math.round(num(context.repeatedDetections)??0));
  const temporalRepeated=Math.max(0,Math.round(num(context.temporalRepeatedDetections)??0));
  const clusterFire=context.clusterFire===true;
  const nearestIndustrial=num(context.nearestIndustrialMeters);
  const nearestForest=num(context.nearestForestMeters);

  const industrialTag=hasTag(context,INDUSTRIAL_TAGS);
  const explicitForest=hasTag(context,FOREST_TAGS);
  const urban=hasTag(context,URBAN_TAGS)||industrialTag;

  const localForest=context.localForest===true;
  const vegetation=localForest||hasTag(context,VEGETATION_TAGS);

  /* Udalplan es la fuente principal para separar urbano/rural. */
  const parcelUrban=context.parcelUrban===true;
  const parcelIndustrial=context.parcelIndustrial===true;
  const parcelRural=context.parcelRural===true;

  const forestCluster=explicitForest&&(clusterFire||repeated>=2||temporalRepeated>=1);

  /* En parcela urbana no usamos un bosque que esté en otra parcela. */
  const interfaceEvidence=!parcelUrban &&
    vegetation &&
    urban &&
    !industrialTag &&
    (nearestIndustrial==null||nearestIndustrial>100);

  const interfaceForest=interfaceEvidence ||
    (!parcelUrban&&nearestForest!=null&&nearestForest<=300);

  const forestEnvironment=!parcelUrban &&
    (localForest||interfaceForest||forestCluster||parcelRural&&vegetation);

  const veryNearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=100;
  const nearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=300;

  let score=25;
  const reasons=[];

  if(parcelUrban){
    score-=25;
    reasons.push("parcela urbana");
  }else if(parcelIndustrial){
    score-=20;
    reasons.push("parcela de actividades económicas");
  }else if(parcelRural){
    score+=18;
    reasons.push("parcela rural/no urbanizable");
  }

  if(localForest&&!parcelUrban){
    score+=30;
    reasons.push("entorno forestal/natural inmediato");
  }else if(forestCluster&&!parcelUrban){
    score+=30;
    reasons.push("contexto forestal + grupo de detecciones");
  }else if(interfaceEvidence){
    score+=28;
    reasons.push("interfaz urbano-forestal");
  }else if(!parcelUrban&&nearestForest!=null&&nearestForest<=300){
    score+=25;
    reasons.push(`borde forestal cercano (${Math.round(nearestForest)} m)`);
  }else if(vegetation&&!parcelUrban){
    score+=20;
    reasons.push("entorno de vegetación/rural");
  }

  if(urban){
    score-=10;
    reasons.push("entorno urbano");
  }

  if(industrialTag&&veryNearIndustrial){
    score-=20;
    reasons.push("actividad industrial inmediata");
  }else if(nearIndustrial){
    score-=4;
    reasons.push(`actividad industrial a ${Math.round(nearestIndustrial)} m`);
  }

  if(repeated>0){
    const bonus=Math.min(24,repeated*8);
    score+=bonus;
    reasons.push(`${repeated} detección${repeated===1?"":"es"} próxima${repeated===1?"":"s"}`);
  }
  if(temporalRepeated>0){
    const bonus=Math.min(18,temporalRepeated*6);
    score+=bonus;
    reasons.push(`${temporalRepeated} detección${temporalRepeated===1?"":"es"} en momentos distintos`);
  }
  if(frp!=null){
    if(frp>=50)score+=20;
    else if(frp>=20)score+=15;
    else if(frp>=5)score+=8;
    else score+=2;
    reasons.push(`FRP ${frp} MW`);
  }
  if(confidence!=null){
    if(confidence>=80)score+=15;
    else if(confidence>=50)score+=8;
    else score+=2;
    reasons.push(`confianza ${Math.round(confidence)}%`);
  }

  score=Math.max(0,Math.min(100,Math.round(score)));

  let category="thermal_anomaly";

  /*
   * PRIORIDAD:
   * 1. Parcela urbana -> nunca probable incendio forestal.
   * 2. Parcela industrial/económica -> fuente industrial.
   * 3. Parcela rural + vegetación/bosque -> incendio forestal.
   * 4. Resto -> posible incendio/anomalía.
   */
  if(parcelUrban){
    if(parcelIndustrial||industrialTag||veryNearIndustrial){
      category="probable_industrial_source";
    }else{
      const strongSignal=(frp!=null&&frp>=20)||(confidence!=null&&confidence>=80);
      category=strongSignal||clusterFire?"possible_fire":"thermal_anomaly";
    }
  }else if(parcelIndustrial){
    category="probable_industrial_source";
  }else if(forestEnvironment){
    category="probable_forest_fire";
  }else if(urban&&(industrialTag||veryNearIndustrial)){
    category="probable_industrial_source";
  }else{
    const strongSignal=(frp!=null&&frp>=20)||(confidence!=null&&confidence>=80);
    const fireEvidence=clusterFire||strongSignal||temporalRepeated>=1;

    if(vegetation&&fireEvidence&&score>=50)category="probable_forest_fire";
    else if(score>=40||strongSignal||clusterFire)category="possible_fire";
  }

  const labels={
    probable_forest_fire:"🔥 Probable incendio forestal",
    possible_fire:"🟠 Posible incendio",
    thermal_anomaly:"♨️ Anomalía térmica",
    probable_industrial_source:"🏭 Probable fuente industrial"
  };

  return {
    category,
    label:labels[category],
    score,
    reasons,
    confidence,
    frp,
    nearestIndustrialMeters:nearestIndustrial,
    repeatedDetections:repeated,
    temporalRepeatedDetections:temporalRepeated,
    parcelUrban,
    parcelIndustrial,
    parcelRural,
    parcelClassification:context.parcelClassification||null,
    parcelName:context.parcelName||null
  };
}

/* Udalplan: 504 residencial, 505 actividades económicas, 512 no urbanizable. */
const UDALPLAN_BASE="https://www.geo.euskadi.eus/geoeuskadi/rest/services/U11/PLANEAMIENTO_CAS/MapServer";
const parcelCache=new Map();
const markerInputs=new Map();

function keyForLatLng(ll){
  return `${Number(ll.lat).toFixed(5)},${Number(ll.lng).toFixed(5)}`;
}

async function queryLayer(layerId,lat,lon){
  const p=new URLSearchParams({
    where:"1=1",
    outFields:"TIPO_DE_SU,CLASIF,CLASIF_EUS,SUELO,NOMBRE,MUNICIPIO,SUBTIPO",
    geometry:`${lon},${lat}`,
    geometryType:"esriGeometryPoint",
    inSR:"4326",
    spatialRel:"esriSpatialRelIntersects",
    returnGeometry:"false",
    f:"json"
  });
  const r=await fetch(`${UDALPLAN_BASE}/${layerId}/query?${p.toString()}`,{cache:"no-store"});
  if(!r.ok)throw new Error(`Udalplan ${layerId}: HTTP ${r.status}`);
  const d=await r.json();
  return Array.isArray(d?.features)?d.features:[];
}

function parcelFromFeatures(residential,economic,nonUrban){
  const r=residential[0]?.attributes||null;
  const e=economic[0]?.attributes||null;
  const n=nonUrban[0]?.attributes||null;
  const rt=String(r?.TIPO_DE_SU||"").toLowerCase();
  const et=String(e?.TIPO_DE_SU||"").toLowerCase();
  const urbanResidential=rt==="1"||rt==="1b";
  const urbanEconomic=et==="1"||et==="1b";
  const portEconomic=et==="1a";

  if(urbanEconomic||portEconomic){
    return {
      parcelUrban:true,
      parcelIndustrial:true,
      parcelRural:false,
      parcelClassification:portEconomic
        ?"suelo urbano de actividades económicas/portuario"
        :"suelo urbano de actividades económicas",
      parcelName:e?.NOMBRE||null
    };
  }
  if(urbanResidential){
    return {
      parcelUrban:true,
      parcelIndustrial:false,
      parcelRural:false,
      parcelClassification:"suelo urbano residencial",
      parcelName:r?.NOMBRE||null
    };
  }
  if(n){
    return {
      parcelUrban:false,
      parcelIndustrial:false,
      parcelRural:true,
      parcelClassification:"suelo no urbanizable/rural",
      parcelName:n?.AFUN||n?.COMARCA||null
    };
  }
  if(r||e){
    const t=r?.TIPO_DE_SU||e?.TIPO_DE_SU||"";
    return {
      parcelUrban:false,
      parcelIndustrial:false,
      parcelRural:false,
      parcelClassification:`suelo Udalplan ${t}`,
      parcelName:r?.NOMBRE||e?.NOMBRE||null
    };
  }
  return {
    parcelUrban:false,
    parcelIndustrial:false,
    parcelRural:false,
    parcelClassification:null,
    parcelName:null
  };
}

async function parcelContext(lat,lon){
  const k=`${lat.toFixed(5)},${lon.toFixed(5)}`;
  if(parcelCache.has(k))return parcelCache.get(k);
  const promise=(async()=>{
    try{
      const [residential,economic,nonUrban]=await Promise.all([
        queryLayer(504,lat,lon),
        queryLayer(505,lat,lon),
        queryLayer(512,lat,lon)
      ]);
      return parcelFromFeatures(residential,economic,nonUrban);
    }catch(error){
      console.warn("Udalplan FIRMS:",error);
      return {
        parcelUrban:false,
        parcelIndustrial:false,
        parcelRural:false,
        parcelClassification:null,
        parcelName:null
      };
    }
  })();
  parcelCache.set(k,promise);
  return promise;
}

function escapeHtml(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function replacePopupClassification(marker,classification,parcel){
  const popup=marker?.getPopup?.();
  if(!popup)return;
  let html=String(popup.getContent?.()||"");
  if(!html)return;
  const label=classification?.label||"♨️ Anomalía térmica";
  const score=classification?.score??"—";
  const reasons=Array.isArray(classification?.reasons)&&classification.reasons.length
    ?classification.reasons.join(" · ")
    :"sin contexto adicional";
  html=html.replace(
    /<b>Clasificación:<\/b>.*?<br><b>Score:<\/b>\s*[^<]+/,
    `<b>Clasificación:</b> ${label}<br><b>Score:</b> ${score}/100`
  );
  html=html.replace(
    /<b>Motivos:<\/b>.*?<br><b>Coordenadas:/,
    `<b>Motivos:</b> ${escapeHtml(reasons)}<br><b>Parcela:</b> ${escapeHtml(parcel?.parcelClassification||"sin datos Udalplan")} ${parcel?.parcelName?`(${escapeHtml(parcel.parcelName)})`:""}<br><b>Coordenadas:`
  );
  popup.setContent(html);
}

async function enrichMarker(marker){
  const ll=marker?.getLatLng?.();
  if(!ll)return;
  const k=keyForLatLng(ll);
  const input=markerInputs.get(k);
  if(!input)return;
  const parcel=await parcelContext(ll.lat,ll.lng);
  const nextContext={...input.context,...parcel};
  const classification=classify(input.firms,nextContext);
  replacePopupClassification(marker,classification,parcel);
}

function installParcelEnrichment(){
  const layer=window.IrratiGISFirmsLayer;
  if(!layer||layer.__IrratiGISParcelEnrichment)return false;
  layer.__IrratiGISParcelEnrichment=true;
  layer.on("layeradd",event=>{
    const marker=event?.layer;
    if(!marker?.getLatLng)return;
    enrichMarker(marker).catch(error=>console.warn("FIRMS parcela:",error));
  });
  return true;
}

const originalClassify=classify;
function trackedClassify(firms,context={}){
  const result=originalClassify(firms,context);
  const props=firms?.properties||{};
  const lat=num(firms?.latitude??firms?.lat??firms?.y??props.latitude??props.lat??props.y);
  const lon=num(firms?.longitude??firms?.lon??firms?.lng??firms?.x??props.longitude??props.lon??props.lng??props.x);
  if(lat!=null&&lon!=null){
    markerInputs.set(`${lat.toFixed(5)},${lon.toFixed(5)}`,{firms,context});
  }
  return result;
}

window.IrratiGISFirmsClassifier={classify:trackedClassify};
window.IrratiGISFirmsClassifierVersion=VERSION;

installParcelEnrichment();
const timer=setInterval(()=>{
  if(installParcelEnrichment())clearInterval(timer);
},250);
setTimeout(()=>clearInterval(timer),10000);

})();
