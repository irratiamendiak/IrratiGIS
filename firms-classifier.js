(()=>{
"use strict";

/*
 * Clasificador orientativo de detecciones NASA FIRMS.
 * No elimina detecciones ni decide por sí solo que exista un incendio.
 */

/*
 * Solo contextos inequívocamente industriales.
 * IMPORTANTE: commercial/retail, amenity=fuel (gasolineras) y similares
 * no cuentan como industria para la clasificación.
 */
const INDUSTRIAL_TAGS=[
  "industrial","quarry","brownfield","works","kiln","plant","chimney",
  "storage_tank","silo","power","generator","substation","landfill"
];
const FOREST_TAGS=["forest","wood","scrub","heath","fell"];
const RURAL_TAGS=[
  "forest","farmland","meadow","orchard","vineyard","grassland","scrub",
  "heath","wood","fell","allotments"
];
const URBAN_TAGS=["residential","retail","institutional","parking","commercial"];

function num(value){const n=Number(value);return Number.isFinite(n)?n:null}
function confidenceValue(value){
  if(value==null||value==="")return null;
  if(typeof value==="string"){
    const s=value.trim().toLowerCase();
    if(s==="high"||s==="h")return 90;
    if(s==="nominal"||s==="medium"||s==="med"||s==="n")return 65;
    if(s==="low"||s==="l")return 35;
  }
  const n=num(value);return n==null?null:Math.max(0,Math.min(100,n));
}
function hasTag(context,tags){
  const values=Array.isArray(context?.tags)?context.tags.map(x=>String(x).toLowerCase()):[];
  return tags.some(tag=>values.includes(tag));
}
function classify(firms,context={}){
  const frp=num(firms?.frp);
  const confidence=confidenceValue(firms?.confidence??firms?.confidence_pct);
  const repeated=Math.max(0,Math.round(num(context.repeatedDetections)??0));
  const nearestIndustrial=num(context.nearestIndustrialMeters);
  const rural=hasTag(context,RURAL_TAGS);
  const forest=hasTag(context,FOREST_TAGS);
  const industrialTag=hasTag(context,INDUSTRIAL_TAGS);
  const urban=hasTag(context,URBAN_TAGS);
  const closeIndustrial=nearestIndustrial!=null&&nearestIndustrial<=300;
  const nearbyIndustrial=nearestIndustrial!=null&&nearestIndustrial<=1000;

  let score=25;
  const reasons=[];

  /* El contexto pesa más que una señal térmica aislada. */
  if(forest){score+=25;reasons.push("entorno forestal/natural")}
  else if(rural){score+=12;reasons.push("entorno rural/agrícola")}
  if(industrialTag){score-=18;reasons.push("actividad industrial en el entorno")}
  if(nearbyIndustrial){
    if(nearestIndustrial<=100)score-=25;
    else if(nearestIndustrial<=300)score-=20;
    else if(nearestIndustrial<=600)score-=10;
    else score-=5;
    reasons.push(`actividad industrial a ${Math.round(nearestIndustrial)} m`);
  }
  if(urban){score-=15;reasons.push("entorno urbano")}

  if(repeated>0){
    const bonus=Math.min(24,repeated*8);score+=bonus;
    reasons.push(`${repeated} detección${repeated===1?"":"es"} próxima${repeated===1?"":"s"}`)
  }
  if(frp!=null){
    if(frp>=50)score+=20;
    else if(frp>=20)score+=15;
    else if(frp>=5)score+=8;
    else score+=2;
    reasons.push(`FRP ${frp} MW`)
  }
  if(confidence!=null){
    if(confidence>=80)score+=15;
    else if(confidence>=50)score+=8;
    else score+=2;
    reasons.push(`confianza ${Math.round(confidence)}%`)
  }

  score=Math.max(0,Math.min(100,Math.round(score)));

  const strongSignal=(frp!=null&&frp>=20)||(confidence!=null&&confidence>=80);
  const corroborated=forest&&(repeated>=1||strongSignal);
  const industrialSourceLikely=closeIndustrial&&!forest&&(
    industrialTag || repeated>=1 || !strongSignal
  );

  let category="thermal_anomaly";
  if(corroborated&&score>=60)category="probable_forest_fire";
  else if(industrialSourceLikely)category="probable_industrial_source";
  else if(score>=40||strongSignal)category="possible_fire";

  const labels={
    probable_forest_fire:"🔥 Probable incendio forestal",
    possible_fire:"🟠 Posible incendio",
    thermal_anomaly:"♨️ Anomalía térmica",
    probable_industrial_source:"🏭 Probable fuente industrial"
  };
  return {
    category,label:labels[category],score,reasons,confidence,frp,
    nearestIndustrialMeters:nearestIndustrial,
    repeatedDetections:repeated
  };
}
window.IrratiGISFirmsClassifier={classify};
})();
