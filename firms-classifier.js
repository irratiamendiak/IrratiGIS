(()=>{
"use strict";

/*
 * Clasificador orientativo de detecciones NASA FIRMS.
 * No elimina detecciones ni decide por sí solo que exista un incendio.
 *
 * Regla principal de calibración:
 * - Entorno forestal o interfaz urbano-forestal => incendio forestal.
 *   La intensidad del píxel NO invalida esta regla: un incendio real puede
 *   tener focos FIRMS de baja intensidad.
 * - Entorno urbano sin evidencia forestal => probable fuente industrial.
 * - La proximidad industrial solo sirve como apoyo; no debe convertir un
 *   incendio forestal en industrial cuando existe contexto forestal.
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
  const interfaceForest=forest&&urban;
  const forestEnvironment=forest||clusterForest;
  const veryNearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=100;
  const nearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=300;

  let score=25;
  const reasons=[];

  if(interfaceForest){
    score+=30;
    reasons.push("interfaz urbano-forestal")
  }else if(forest){
    score+=30;
    reasons.push("entorno forestal/natural")
  }else if(clusterForest){
    score+=25;
    reasons.push("clúster próximo con entorno forestal")
  }else if(vegetation){
    score+=20;
    reasons.push("entorno de vegetación/rural")
  }

  if(urban){
    score-=10;
    reasons.push("entorno urbano")
  }

  if(industrialTag&&veryNearIndustrial){
    score-=20;
    reasons.push("actividad industrial inmediata")
  }else if(nearIndustrial){
    score-=4;
    reasons.push(`actividad industrial a ${Math.round(nearestIndustrial)} m`)
  }

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

  /*
   * La categoría ya no depende principalmente de la intensidad.
   * El contexto geográfico tiene prioridad:
   *
   * 1. Forestal/interfaz urbano-forestal -> incendio forestal.
   * 2. Urbano sin contexto forestal -> fuente industrial.
   * 3. Resto -> scoring orientativo tradicional.
   *
   * Esto evita que una instalación industrial cercana o un FRP bajo convierta
   * en industrial/posible una detección que forma parte de un incendio forestal.
   */
  let category="thermal_anomaly";

  if(forestEnvironment){
    category="probable_forest_fire";
  }else if(urban){
    category="probable_industrial_source";
  }else{
    const strongSignal=(frp!=null&&frp>=20)||(confidence!=null&&confidence>=80);
    const fireEvidence=clusterFire||strongSignal||temporalRepeated>=1;
    const industrialSourceLikely=industrialTag&&veryNearIndustrial&&
      (frp==null||frp<20)&&
      (confidence==null||confidence<80)&&
      repeated===0&&temporalRepeated===0;

    if(industrialSourceLikely)category="probable_industrial_source";
    else if(vegetation&&fireEvidence&&score>=50)category="probable_forest_fire";
    else if(score>=40||strongSignal||clusterFire)category="possible_fire";
  }

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
