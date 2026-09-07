(()=>{
"use strict";

/*
 * Clasificador orientativo de detecciones NASA FIRMS.
 *
 * Esta primera fase es deliberadamente independiente de fire-popup.js:
 * - no modifica la capa FIRMS
 * - no modifica los iconos
 * - no modifica la activación/desactivación
 *
 * Recibe una detección FIRMS y un contexto geográfico opcional y devuelve
 * una clasificación + puntuación. La clasificación nunca elimina datos.
 */

const INDUSTRIAL_TAGS = [
  "industrial","commercial","retail","quarry","brownfield","construction",
  "depot","landfill","works","kiln","plant","chimney","storage_tank",
  "silo","power","generator","substation"
];

const RURAL_TAGS = [
  "forest","farmland","meadow","orchard","vineyard","grassland","scrub",
  "heath","wood","fell","allotments"
];

const URBAN_TAGS = ["residential","retail","institutional","parking"];

function num(value){
  const n=Number(value);
  return Number.isFinite(n)?n:null;
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

function distanceScore(distanceMeters){
  const d=num(distanceMeters);
  if(d==null)return 0;
  if(d<=50)return -35;
  if(d<=150)return -28;
  if(d<=300)return -20;
  if(d<=600)return -10;
  if(d<=1000)return -5;
  return 0;
}

function hasTag(context,tags){
  const values=Array.isArray(context?.tags)
    ? context.tags.map(x=>String(x).toLowerCase())
    : [];
  return tags.some(tag=>values.includes(tag));
}

function classify(firms,context={}){
  const frp=num(firms?.frp);
  const confidence=confidenceValue(firms?.confidence ?? firms?.confidence_pct);
  const repeated=Math.max(0,num(context.repeatedDetections)??0);
  const nearestIndustrial=num(context.nearestIndustrialMeters);

  let score=30;
  const reasons=[];

  if(hasTag(context,RURAL_TAGS)){
    score+=25;
    reasons.push("entorno rural/forestal");
  }

  if(hasTag(context,INDUSTRIAL_TAGS)){
    score+=distanceScore(nearestIndustrial);
    if(nearestIndustrial!=null && nearestIndustrial<=1000){
      reasons.push(`actividad industrial a ${Math.round(nearestIndustrial)} m`);
    }
  }

  if(hasTag(context,URBAN_TAGS)){
    score-=15;
    reasons.push("entorno urbano");
  }

  if(repeated>0){
    const bonus=Math.min(18,repeated*6);
    score+=bonus;
    reasons.push(`${repeated} detección${repeated===1?"":"es"} próxima${repeated===1?"":"s"}`);
  }

  if(frp!=null){
    if(frp>=50)score+=15;
    else if(frp>=20)score+=10;
    else if(frp>=5)score+=5;
    reasons.push(`FRP ${frp} MW`);
  }

  if(confidence!=null){
    if(confidence>=80)score+=15;
    else if(confidence>=50)score+=10;
    else score+=4;
    reasons.push(`confianza ${Math.round(confidence)}%`);
  }

  score=Math.max(0,Math.min(100,Math.round(score)));

  let category="thermal_anomaly";
  if(score>=70)category="probable_forest_fire";
  else if(score>=45)category="possible_fire";
  else if(nearestIndustrial!=null && nearestIndustrial<=300)category="probable_industrial_source";

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
    repeatedDetections:repeated
  };
}

window.IrratiGISFirmsClassifier={classify};
})();
