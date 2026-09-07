(()=>{
"use strict";

/*
 * Clasificador orientativo de detecciones NASA FIRMS.
 * No elimina detecciones ni decide por sí solo que exista un incendio.
 *
 * PRINCIPIO: una detección aislada sobre/near una empresa NO debe convertirse
 * en fuente industrial. Y un incendio real puede estar dentro de un entorno
 * industrial. La clasificación debe considerar el conjunto espacial de
 * detecciones y, para "industrial", la persistencia temporal.
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
  const temporalRepeated=Math.max(0,Math.round(num(context.temporalRepeatedDetections)??0));
  const clusterFire=context.clusterFire===true;
  const clusterForest=context.clusterForest===true;
  const nearestIndustrial=num(context.nearestIndustrialMeters);
  const rural=hasTag(context,RURAL_TAGS);
  const forest=hasTag(context,FOREST_TAGS);
  const industrialTag=hasTag(context,INDUSTRIAL_TAGS);
  const urban=hasTag(context,URBAN_TAGS);
  const nearbyIndustrial=nearestIndustrial!=null&&nearestIndustrial<=1000;

  let score=25;
  const reasons=[];

  /* Un contexto forestal pesa, pero no debe anular una evidencia industrial.
     El contexto del clúster permite reconocer incendios que ocupan varios
     puntos FIRMS aunque solo uno de ellos caiga sobre una zona forestal OSM. */
  if(forest){score+=25;reasons.push("entorno forestal/natural")}
  else if(clusterForest){score+=20;reasons.push("clúster próximo con entorno forestal")}
  else if(rural){score+=10;reasons.push("entorno rural/agrícola")}

  if(industrialTag){score-=8;reasons.push("actividad industrial en el entorno")}
  if(nearbyIndustrial){
    if(nearestIndustrial<=100)score-=12;
    else if(nearestIndustrial<=300)score-=10;
    else if(nearestIndustrial<=600)score-=6;
    else score-=3;
    reasons.push(`actividad industrial a ${Math.round(nearestIndustrial)} m`);
  }
  if(urban){score-=12;reasons.push("entorno urbano")}

  if(repeated>0){
    const bonus=Math.min(24,repeated*8);score+=bonus;
    reasons.push(`${repeated} detección${repeated===1?"":"es"} próxima${repeated===1?"":"s"}`)
  }
  if(temporalRepeated>0){
    const bonus=Math.min(18,temporalRepeated*6);score+=bonus;
    reasons.push(`${temporalRepeated} detección${temporalRepeated===1?"":"es"} en momentos distintos`)
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
  const fireEvidence=clusterFire||strongSignal||temporalRepeated>=1;
  const forestEvidence=forest||clusterForest;

  /*
   * Fuente industrial: solo cuando hay un objeto OSM industrial inequívoco,
   * está muy cerca y existe persistencia temporal. Las detecciones espaciales
   * del mismo paso satelital NO cuentan como persistencia. Si la señal es
   * fuerte, prevalece la hipótesis de incendio aunque haya industria.
   */
  const industrialSourceLikely=industrialTag&&
    nearestIndustrial!=null&&nearestIndustrial<=300&&
    temporalRepeated>=1&&!strongSignal&&!forestEvidence&&!clusterFire;

  let category="thermal_anomaly";
  if(fireEvidence&&forestEvidence&&score>=55)category="probable_forest_fire";
  else if(industrialSourceLikely)category="probable_industrial_source";
  else if(score>=40||strongSignal||clusterFire)category="possible_fire";

  const labels={
    probable_forest_fire:"🔥 Probable incendio forestal",
    possible_fire:"🟠 Posible incendio",
    thermal_anomaly:"♨️ Anomalía térmica",
    probable_industrial_source:"🏭 Probable fuente industrial"
  };
  return {
    category,label:labels[category],score,reasons,confidence,frp,
    nearestIndustrialMeters:nearestIndustrial,
    repeatedDetections:repeated,
    temporalRepeatedDetections:temporalRepeated
  };
}
window.IrratiGISFirmsClassifier={classify};
})();
