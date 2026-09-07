(()=>{
"use strict";
const VERSION="20260907-12";

/*
 * Clasificador orientativo de detecciones NASA FIRMS.
 * No elimina detecciones ni decide por sí solo que exista un incendio.
 *
 * Regla principal:
 * - Entorno forestal o interfaz urbano-forestal local => incendio forestal.
 * - Si el punto tiene contexto forestal OSM y forma parte de un grupo de
 *   detecciones, ese contexto forestal refuerza la clasificación aunque OSM
 *   también tenga actividad industrial cerca.
 * - Un entorno de vegetación/rural en contacto con zona urbana se considera
 *   interfaz urbano-forestal cuando no hay una instalación industrial
 *   inmediata que explique mejor el foco.
 * - Solo si NO hay señal forestal/interfaz suficiente, una instalación
 *   urbana/industrial identificada cerca puede clasificarse como fuente industrial.
 * - La intensidad del pixel NO decide por sí sola la categoría forestal.
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
  const nearestIndustrial=num(context.nearestIndustrialMeters);
  const nearestForest=num(context.nearestForestMeters);
  const industrialTag=hasTag(context,INDUSTRIAL_TAGS);
  const explicitForest=hasTag(context,FOREST_TAGS);
  const urban=hasTag(context,URBAN_TAGS)||industrialTag;

  const localForest=context.localForest===true;
  const vegetation=localForest||hasTag(context,VEGETATION_TAGS);

  // El centroide OSM de una gran parcela forestal puede quedar lejos del foco.
  // Por eso, si OSM identifica bosque/natural y hay varias detecciones próximas,
  // lo tratamos como evidencia de incendio forestal aunque haya industria cerca.
  const forestCluster=explicitForest&&(clusterFire||repeated>=2||temporalRepeated>=1);
  const interfaceEvidence=vegetation&&urban&&!industrialTag&&
    (nearestIndustrial==null||nearestIndustrial>100);
  const interfaceForest=interfaceEvidence || (nearestForest!=null&&nearestForest<=300);
  const forestEnvironment=localForest||interfaceForest||forestCluster;

  const veryNearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=100;
  const nearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=300;

  let score=25;
  const reasons=[];

  if(localForest){
    score+=30;
    reasons.push("entorno forestal/natural inmediato")
  }else if(forestCluster){
    score+=30;
    reasons.push("contexto forestal + grupo de detecciones")
  }else if(interfaceEvidence){
    score+=28;
    reasons.push("interfaz urbano-forestal")
  }else if(nearestForest!=null&&nearestForest<=300){
    score+=25;
    reasons.push(`borde forestal cercano (${Math.round(nearestForest)} m)`)
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
   * PRIORIDAD GEOGRAFICA:
   * 1. Forestal / interfaz / bosque + cluster -> incendio forestal.
   * 2. Sin señal forestal/interfaz suficiente: instalación urbana/industrial -> industrial.
   * 3. Resto -> posible incendio / anomalía.
   *
   * Esto evita que una industria cercana anule Arza o Bermeo cuando el foco
   * está asociado a un entorno forestal o a una interfaz urbano-forestal.
   * Las gasolineras (amenity=fuel) y retail NO están en INDUSTRIAL_TAGS.
   */
  let category="thermal_anomaly";

  if(forestEnvironment){
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
    category,label:labels[category],score,reasons,confidence,frp,
    nearestIndustrialMeters:nearestIndustrial,
    repeatedDetections:repeated,
    temporalRepeatedDetections:temporalRepeated
  };
}
window.IrratiGISFirmsClassifier={classify};
window.IrratiGISFirmsClassifierVersion=VERSION;
})();
