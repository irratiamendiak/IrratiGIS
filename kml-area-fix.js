(()=>{
"use strict";
function $(id){return document.getElementById(id)}
function eq(a,b){return Math.abs(a[0]-b[0])<1e-12&&Math.abs(a[1]-b[1])<1e-12}
function clean(s){return s.trim().split(/\s+/).map(x=>{const p=x.split(",");return[Number(p[0]),Number(p[1])] }).filter(c=>Number.isFinite(c[0])&&Number.isFinite(c[1])&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90)}
function close(r){const a=clean(r);if(a.length>=3&&!eq(a[0],a[a.length-1]))a.push(a[0].slice());return a}
function areaForKml(text){
  const xml=new DOMParser().parseFromString(text,"application/xml");
  if(xml.querySelector("parsererror"))throw new Error("KML XML baliogabea");
  const rings=[];
  [...xml.getElementsByTagNameNS("*","Polygon")].forEach(p=>{
    const o=p.getElementsByTagNameNS("*","outerBoundaryIs")[0];
    const c=o&&o.getElementsByTagNameNS("*","coordinates")[0];
    if(c){const r=close(c.textContent);if(r.length>=4)rings.push(r)}
  });
  if(!rings.length){
    [...xml.getElementsByTagNameNS("*","LineString")].forEach(l=>{
      const c=l.getElementsByTagNameNS("*","coordinates")[0];
      if(c){const r=close(c.textContent);if(r.length>=4)rings.push(r)}
    });
  }
  if(!rings.length){
    [...xml.getElementsByTagNameNS("*","coordinates")].forEach(c=>{const r=close(c.textContent);if(r.length>=4)rings.push(r)})
  }
  if(!rings.length)throw new Error("Ez da azalera kalkulatzeko KML geometria itxirik aurkitu.");
  if(typeof turf==="undefined")throw new Error("Turf ez dago kargatuta.");
  let area=0,perimeter=0,points=0;
  rings.forEach(r=>{area+=turf.area(turf.polygon([r]));perimeter+=turf.length(turf.lineString(r),{units:"kilometers"});points+=r.length-1});
  return{area,perimeter,points,rings}
}
async function fixFile(f){
  if(!f||!(/\.kml$/i.test(f.name)))return;
  try{
    const res=areaForKml(await f.text());
    $("m2").textContent=new Intl.NumberFormat("eu-ES",{minimumFractionDigits:2,maximumFractionDigits:2}).format(res.area)+" m²";
    $("ha").textContent=new Intl.NumberFormat("eu-ES",{minimumFractionDigits:4,maximumFractionDigits:4}).format(res.area/10000)+" ha";
    $("km2").textContent=new Intl.NumberFormat("eu-ES",{minimumFractionDigits:6,maximumFractionDigits:6}).format(res.area/1e6)+" km²";
    $("pm").textContent=new Intl.NumberFormat("eu-ES",{minimumFractionDigits:2,maximumFractionDigits:2}).format(res.perimeter*1000)+" m";
    $("pkm").textContent=new Intl.NumberFormat("eu-ES",{minimumFractionDigits:3,maximumFractionDigits:3}).format(res.perimeter)+" km";
    $("points").textContent=new Intl.NumberFormat("eu-ES").format(res.points)+" puntu";
    $("geom").textContent=String(res.rings.length);
    $("rings").textContent=res.rings.length===1?"geometria":"geometriak";
    $("message").textContent="KML azalera kalkulatuta: "+new Intl.NumberFormat("eu-ES",{minimumFractionDigits:4,maximumFractionDigits:4}).format(res.area/10000)+" ha.";
    window.dispatchEvent(new CustomEvent("irratiKmlAreaFixed",{detail:res}));
  }catch(e){console.error("KML area fix",e)}
}
function boot(){const input=$("file");if(!input)return setTimeout(boot,250);if(input.dataset.areaFix)return;input.dataset.areaFix="1";input.addEventListener("change",()=>fixFile(input.files&&input.files[0]),true)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
