(()=>{
"use strict";
const VERSION="20260928-ign-landcover";
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function confidenceValue(v){if(v==null||v==="")return null;if(typeof v==="string"){const s=v.trim().toLowerCase();if(s==="high"||s==="h")return 90;if(["nominal","medium","med","n"].includes(s))return 65;if(s==="low"||s==="l")return 35}const n=num(v);return n==null?null:Math.max(0,Math.min(100,n))}
function classify(firms,context={}){
 const frp=num(firms?.frp??firms?.properties?.frp);
 const confidence=confidenceValue(firms?.confidence??firms?.confidence_pct??firms?.properties?.confidence??firms?.properties?.confidence_pct);
 const repeated=Math.max(0,Math.round(num(context.repeatedDetections)??0));
 const temporal=Math.max(0,Math.round(num(context.temporalRepeatedDetections)??0));
 const clusterFire=context.clusterFire===true;
 let landGroup=String(context.landGroup||"").toLowerCase();
 if(!landGroup){
  if(context.industrial===true)landGroup="industrial";
  else if(context.urban===true)landGroup="urbano";
  else if(context.explicitForest===true||context.localForest===true)landGroup="forestal";
  else if(context.vegetation===true)landGroup="vegetacion";
  else landGroup="desconocido";
 }
 const esVegetacion=["forestal","agricola","vegetacion"].includes(landGroup);
 const esIndustrialUrbano=["industrial","urbano","cantera"].includes(landGroup);
 let category,score,reasons=[];
 if(esVegetacion){category="vegetation_fire";score=80;reasons.push(`ocupación del suelo: ${context.landClase||landGroup}`)}
 else if(esIndustrialUrbano){category="industrial_urban";score=12;reasons.push(`ocupación del suelo: ${context.landClase||landGroup}`)}
 else{category="thermal_anomaly";score=45;reasons.push("ocupación del suelo desconocida")}
 if(frp!=null){score+=frp>=50?6:frp>=20?4:0;reasons.push(`FRP ${frp} MW`)}
 if(confidence!=null){score+=confidence>=80?4:0;reasons.push(`confianza ${Math.round(confidence)}%`)}
 if(clusterFire||repeated>0)reasons.push("varias detecciones próximas");
 score=Math.max(0,Math.min(100,Math.round(score)));
 const labels={vegetation_fire:"🔥 Fuego en vegetación",industrial_urban:"🏭 Fuente industrial/urbana",thermal_anomaly:"♨️ Anomalía térmica"};
 return{category,label:labels[category],score,reasons,landGroup,landClase:context.landClase||null,confidence,frp,repeatedDetections:repeated,temporalRepeatedDetections:temporal};
}
window.IrratiGISFirmsClassifier={classify,version:VERSION};
window.IrratiGISFirmsClassifierVersion=VERSION;
})();
