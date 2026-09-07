(()=>{
"use strict";

/* Clasificador orientativo FIRMS. No elimina detecciones. */
const INDUSTRIAL_TAGS=["industrial","quarry","brownfield","works","kiln","plant","chimney","storage_tank","silo","power","generator","substation","landfill"];
const FOREST_TAGS=["forest","wood","scrub","heath","fell"];
const RURAL_TAGS=["forest","farmland","meadow","orchard","vineyard","grassland","scrub","heath","wood","fell","allotments"];
const URBAN_TAGS=["residential","retail","institutional","parking","commercial"];
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function confidenceValue(v){
  if(v==null||v==="")return null;
  if(typeof v==="string"){const s=v.trim().toLowerCase();if(s==="high"||s==="h")return 90;if(s==="nominal"||s==="medium"||s==="med"||s==="n")return 65;if(s==="low"||s==="l")return 35}
  const n=num(v);return n==null?null:Math.max(0,Math.min(100,n));
}
function hasTag(c,tags){const values=Array.isArray(c?.tags)?c.tags.map(x=>String(x).toLowerCase()):[];return tags.some(t=>values.includes(t))}
function classify(firms,context={}){
  const frp=num(firms?.frp),confidence=confidenceValue(firms?.confidence??firms?.confidence_pct);
  const repeated=Math.max(0,Math.round(num(context.repeatedDetections)??0));
  const nearestIndustrial=num(context.nearestIndustrialMeters),nearestForest=num(context.nearestForestMeters);
  const forest=hasTag(context,FOREST_TAGS),rural=hasTag(context,RURAL_TAGS),industrialTag=hasTag(context,INDUSTRIAL_TAGS),urban=hasTag(context,URBAN_TAGS);
  /* La etiqueta forestal solo cuenta si está realmente próxima a la detección. */
  const forestNearby=forest&&(nearestForest==null||nearestForest<=300);
  const closeIndustrial=nearestIndustrial!=null&&nearestIndustrial<=300;
  let score=20,reasons=[];
  if(forestNearby){score+=35;reasons.push("entorno forestal/natural")}
  else if(rural){score+=8;reasons.push("entorno rural/agrícola")}
  if(industrialTag){score-=18;reasons.push("actividad industrial en el entorno")}
  if(closeIndustrial){score-=nearestIndustrial<=100?30:22;reasons.push(`actividad industrial a ${Math.round(nearestIndustrial)} m`)}
  if(urban){score-=12;reasons.push("entorno urbano")}
  if(repeated>0){score+=Math.min(28,repeated*10);reasons.push(`${repeated} detección${repeated===1?"":"es"} próxima${repeated===1?"":"s"}`)}
  if(frp!=null){score+=frp>=50?20:frp>=20?14:frp>=5?7:1;reasons.push(`FRP ${frp} MW`)}
  if(confidence!=null){score+=confidence>=80?15:confidence>=50?7:1;reasons.push(`confianza ${Math.round(confidence)}%`)}
  score=Math.max(0,Math.min(100,Math.round(score)));
  const strongSignal=(frp!=null&&frp>=20)||(confidence!=null&&confidence>=80);
  const corroboratedForest=forestNearby&&(repeated>=1||strongSignal);
  const industrialSourceLikely=closeIndustrial&&!forestNearby&&(industrialTag||repeated>=1||!strongSignal);
  let category="thermal_anomaly";
  if(corroboratedForest&&score>=65)category="probable_forest_fire";
  else if(industrialSourceLikely)category="probable_industrial_source";
  else if(score>=38||strongSignal)category="possible_fire";
  const labels={probable_forest_fire:"🔥 Probable incendio forestal",possible_fire:"🟠 Posible incendio",thermal_anomaly:"♨️ Anomalía térmica",probable_industrial_source:"🏭 Probable fuente industrial"};
  return {category,label:labels[category],score,reasons,confidence,frp,nearestIndustrialMeters:nearestIndustrial,nearestForestMeters:nearestForest,repeatedDetections:repeated};
}
window.IrratiGISFirmsClassifier={classify};
})();
