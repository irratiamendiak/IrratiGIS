(()=>{
"use strict";
const VERSION="20260909-12";
const INDUSTRIAL_TAGS=["industrial","quarry","brownfield","works","kiln","plant","chimney","storage_tank","silo","power","generator","substation","landfill"];
const FOREST_TAGS=["forest","wood","scrub","heath","fell"];
const VEGETATION_TAGS=["forest","wood","scrub","heath","fell","farmland","meadow","orchard","vineyard","grassland","allotments"];
const URBAN_TAGS=["residential","retail","institutional","parking","commercial","construction","depot"];
const INDUSTRIAL_FOCUS_METERS=150;
function num(value){const n=Number(value);return Number.isFinite(n)?n:null}
function confidenceValue(value){if(value==null||value==="")return null;if(typeof value==="string"){const s=value.trim().toLowerCase();if(s==="high"||s==="h")return 90;if(s==="nominal"||s==="medium"||s==="med"||s==="n")return 65;if(s==="low"||s==="l")return 35}const n=num(value);return n==null?null:Math.max(0,Math.min(100,n))}
function hasTag(context,tags){const values=Array.isArray(context?.tags)?context.tags.flatMap(x=>{const s=String(x).toLowerCase();const i=s.indexOf("=");return i>=0?[s,s.slice(i+1)]:[s]}):[];return tags.some(tag=>values.includes(tag))}
function classify(firms,context={}){
 const frp=num(firms?.frp),confidence=confidenceValue(firms?.confidence??firms?.confidence_pct);
 const repeated=Math.max(0,Math.round(num(context.repeatedDetections)??0));
 const temporalRepeated=Math.max(0,Math.round(num(context.temporalRepeatedDetections)??0));
 const clusterFire=context.clusterFire===true;
 const nearestIndustrial=num(context.nearestIndustrialMeters),nearestForest=num(context.nearestForestMeters);
 const industrialTag=hasTag(context,INDUSTRIAL_TAGS);
 const explicitForest=hasTag(context,FOREST_TAGS);
 const urban=Boolean(context.urban)||hasTag(context,URBAN_TAGS);
 const localForest=context.localForest===true;
 const vegetation=Boolean(context.vegetation)||localForest||hasTag(context,VEGETATION_TAGS);
 // La industria solo cuenta como evidencia de la fuente si está realmente pegada al foco.
 // Los objetos industriales lejanos encontrados por Overpass no contaminan la detección.
 const industrialImmediate=industrialTag&&nearestIndustrial!=null&&nearestIndustrial<=INDUSTRIAL_FOCUS_METERS;
 const forestCluster=explicitForest&&(clusterFire||repeated>=2||temporalRepeated>=1);
 const interfaceForest=context.interfaceForest===true||(nearestForest!=null&&nearestForest<=300&&urban);
 const forestEnvironment=localForest||interfaceForest||forestCluster;
 const nearIndustrial=nearestIndustrial!=null&&nearestIndustrial<=300;
 let score=25,reasons=[];
 if(localForest){score+=30;reasons.push(context.interfaceForest?"interfaz urbano-forestal":"entorno forestal/natural inmediato")}
 else if(forestCluster){score+=30;reasons.push("contexto forestal + grupo de detecciones")}
 else if(interfaceForest){score+=25;reasons.push("interfaz forestal cercana")}
 else if(vegetation){score+=20;reasons.push("entorno de vegetación/rural")}
 if(urban){score-=10;reasons.push("entorno urbano")}
 if(industrialImmediate){score-=20;reasons.push("actividad industrial inmediata")}
 else if(nearIndustrial){reasons.push(`actividad industrial a ${Math.round(nearestIndustrial)} m (fuera del foco inmediato)`)}
 if(repeated>0){const bonus=Math.min(24,repeated*8);score+=bonus;reasons.push(`${repeated} detección${repeated===1?"":"es"} próxima${repeated===1?"":"s"}`)}
 if(temporalRepeated>0){const bonus=Math.min(18,temporalRepeated*6);score+=bonus;reasons.push(`${temporalRepeated} detección${temporalRepeated===1?"":"es"} en momentos distintos`)}
 if(frp!=null){if(frp>=50)score+=20;else if(frp>=20)score+=15;else if(frp>=5)score+=8;else score+=2;reasons.push(`FRP ${frp} MW`)}
 if(confidence!=null){if(confidence>=80)score+=15;else if(confidence>=50)score+=8;else score+=2;reasons.push(`confianza ${Math.round(confidence)}%`)}
 score=Math.max(0,Math.min(100,Math.round(score)));
 let category="thermal_anomaly";
 // El contexto forestal/interfaz tiene prioridad sobre la intensidad de la señal.
 if(forestEnvironment)category="probable_forest_fire";
 else if(urban&&industrialImmediate)category="probable_industrial_source";
 else{const strongSignal=(frp!=null&&frp>=20)||(confidence!=null&&confidence>=80);const fireEvidence=clusterFire||strongSignal||temporalRepeated>=1;if(vegetation&&fireEvidence&&score>=50)category="probable_forest_fire";else if(score>=40||strongSignal||clusterFire)category="possible_fire"}
 const labels={probable_forest_fire:"🔥 Probable incendio forestal",possible_fire:"🟠 Posible incendio",thermal_anomaly:"♨️ Anomalía térmica",probable_industrial_source:"🏭 Probable fuente industrial"};
 return{category,label:labels[category],score,reasons,confidence,frp,nearestIndustrialMeters:nearestIndustrial,repeatedDetections:repeated,temporalRepeatedDetections:temporalRepeated};
}
window.IrratiGISFirmsClassifier={classify};
window.IrratiGISFirmsClassifierVersion=VERSION;
})();