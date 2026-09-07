(()=>{
"use strict";

/*
 * Clasificador orientativo de detecciones NASA FIRMS.
 * No elimina detecciones ni decide por sí solo que exista un incendio.
 *
 * Principio de calibración:
 * - La industria solo domina cuando el punto está realmente sobre/cerca de
 *   una instalación industrial inequívoca y la señal es débil.
 * - Una industria a cientos de metros no debe convertir un incendio de
 *   vegetación en industrial.
 * - Un incendio puede ocurrir dentro de un entorno industrial, por lo que una
 *   señal fuerte o un clúster con evidencia forestal prevalece.
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
  const nearestForest=num(context.nearestForestMeters);
  const forest=hasTag(context,FOREST_TAGS)||nearestForest!=null&&nearestForest<=300;
  const vegetation=forest||hasTag(context,VEGETATION_TAGS);
  const industrialTag=hasTag(context,INDUSTRIAL_TAGS);
  const urban=hasTag(context,URBAN_TAGS);
  const veryNearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=100;
  const nearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=300;

  let score=25;
  const reasons=[];

  if(forest){score+=25;reasons.push("entorno forestal/natural")}
  else if(clusterForest){score+=20;reasons.push("clúster próximo con entorno forestal")}
  else if(vegetation){score+=20;reasons.push("entorno de vegetación/rural")}

  /* Solo penalizamos industria de forma relevante cuando está realmente
     próxima. A 453 m, por ejemplo, una instalación industrial no debe
     dominar una detección de vegetación. */
  if(industrialTag&&veryNearIndustrial){score-=15;reasons.push("actividad industrial inmediata")}
  else if(nearIndustrial){score-=4;reasons.push(`actividad industrial a ${Math.round(nearestIndustrial)} m`)}
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
   * Fuente industrial: punto inequívocamente industrial y muy próximo,
   * con señal débil. No exigimos persistencia: una instalación industrial
   * puede generar una única detección térmica. Una señal fuerte prevalece.
   */
  const industrialSourceLikely=industrialTag&&
    veryNearIndustrial&&
    (frp==null||frp<5)&&
    (confidence==null||confidence<80)&&
    !forestEvidence&&!clusterFire;

  let category="thermal_anomaly";

  /* Vegetación + confianza nominal o mejor ya es una señal compatible con
     incendio. La industria a >300 m no puede anularla. Para bosque real,
     además, una señal fuerte/persistencia/clúster refuerza la categoría. */
  const vegetationFireLikely=vegetation&&
    (confidence==null||confidence>=50)&&
    !veryNearIndustrial;

  if(fireEvidence&&forestEvidence&&score>=55)category="probable_forest_fire";
  else if(industrialSourceLikely)category="probable_industrial_source";
  else if(vegetationFireLikely&&score>=50)category="probable_forest_fire";
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
