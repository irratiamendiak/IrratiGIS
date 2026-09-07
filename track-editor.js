(()=>{
  "use strict";

  const map=()=>window.IrratiGISMap||null;
  let editing=false;
  let target=null;
  let handles=[];

  const style=()=>{
    if(document.getElementById("irratiTrackEditorStyle"))return;
    const s=document.createElement("style");
    s.id="irratiTrackEditorStyle";
    s.textContent=`
      .irrati-track-editor-marker{background:transparent!important;border:0!important}
      .irrati-track-editor-marker span{display:flex;width:22px;height:22px;border-radius:50%;align-items:center;justify-content:center;background:#fff;border:2px solid #176b43;box-shadow:0 1px 5px rgba(0,0,0,.35);font:800 10px system-ui;color:#176b43}
      .irrati-track-editor-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0 0;padding:9px 10px;background:#f7faf8;border:1px solid #dce5df;border-radius:10px;font:12px system-ui;color:#52645a}
      .irrati-track-editor-bar button{min-height:38px}
      .irrati-track-editor-bar strong{color:#176b43}
      @media(max-width:560px){.irrati-track-editor-bar{display:grid;grid-template-columns:1fr 1fr}.irrati-track-editor-bar .irrati-track-editor-info{grid-column:1/-1}}
    `;
    document.head.appendChild(s);
  };

  function message(t){
    const e=document.getElementById("message");
    if(e)e.textContent=t;
  }

  function isShape(layer){
    return layer && typeof layer.getLatLngs==="function" && typeof layer.setLatLngs==="function";
  }

  function candidates(){
    const m=map();
    if(!m)return[];
    const out=[];
    m.eachLayer(group=>{
      if(!group || typeof group.eachLayer!=="function" || typeof group.getLayers!=="function")return;
      const shapes=[];
      group.eachLayer(child=>{
        if(isShape(child))shapes.push(child);
      });
      if(!shapes.length)return;
      const points=shapes.reduce((n,s)=>n+countPoints(s.getLatLngs()),0);
      if(points>=2)out.push({group,shapes,points});
    });
    return out.sort((a,b)=>b.points-a.points);
  }

  function countPoints(v){
    if(!Array.isArray(v))return 0;
    if(v.length&&Array.isArray(v[0]))return v.reduce((n,x)=>n+countPoints(x),0);
    return v.length;
  }

  function flattenRings(latlngs){
    if(!Array.isArray(latlngs))return[];
    if(latlngs.length&&latlngs[0]&&typeof latlngs[0].lat==="number")return[latlngs];
    return latlngs.flatMap(x=>flattenRings(x));
  }

  function clearHandles(){
    handles.forEach(h=>{try{map().removeLayer(h)}catch(_){}});
    handles=[];
  }

  function getPoint(shape,ringIndex,pointIndex){
    const all=shape.getLatLngs();
    const rings=flattenRings(all);
    return rings[ringIndex]?.[pointIndex]||null;
  }

  function setPoint(shape,ringIndex,pointIndex,ll){
    const all=shape.getLatLngs();
    const rings=flattenRings(all);
    const ring=rings[ringIndex];
    if(!ring||!ring[pointIndex])return;
    ring[pointIndex]=L.latLng(ll.lat,ll.lng);
    if(ring.length>2 && ring[0] && ring[ring.length-1] &&
       Math.abs(ring[0].lat-ring[ring.length-1].lat)<1e-10 &&
       Math.abs(ring[0].lng-ring[ring.length-1].lng)<1e-10){
      if(pointIndex===0)ring[ring.length-1]=L.latLng(ll.lat,ll.lng);
      if(pointIndex===ring.length-1)ring[0]=L.latLng(ll.lat,ll.lng);
    }
    shape.setLatLngs(all);
  }

  function deletePoint(shape,ringIndex,pointIndex){
    const all=shape.getLatLngs();
    const rings=flattenRings(all);
    const ring=rings[ringIndex];
    if(!ring||ring.length<3)return false;
    const wasClosed=ring.length>=4&&
      Math.abs(ring[0].lat-ring[ring.length-1].lat)<1e-10&&
      Math.abs(ring[0].lng-ring[ring.length-1].lng)<1e-10;
    const idx=wasClosed&&pointIndex===ring.length-1?0:pointIndex;
    ring.splice(idx,1);
    if(wasClosed){
      if(ring.length>=3)ring.push(L.latLng(ring[0].lat,ring[0].lng));
    }
    if(ring.length<2)return false;
    shape.setLatLngs(all);
    return true;
  }

  function handlePopup(handle){
    const b=document.createElement("button");
    b.type="button";
    b.textContent="Puntu hau ezabatu";
    b.style.cssText="margin-top:6px;padding:7px 9px;border:0;border-radius:7px;background:#f2dddd;color:#8b2f2f;font-weight:800;cursor:pointer";
    b.onclick=()=>{
      if(!target)return;
      if(deletePoint(handle.shape,handle.ring,handle.point)){
        rebuildHandles();
        message("Puntua ezabatu da. Track-a editatzen jarraitzen duzu.");
      }else{
        message("Ezin da puntua ezabatu: track-ak gutxienez 2 puntu behar ditu.");
      }
      map().closePopup();
    };
    const wrap=document.createElement("div");
    wrap.innerHTML=`<strong>Puntua ${handle.point+1}</strong><br>${handle.lat.toFixed(6)}, ${handle.lng.toFixed(6)}<br>`;
    wrap.appendChild(b);
    return wrap;
  }

  function rebuildHandles(){
    clearHandles();
    if(!editing||!target)return;
    target.shapes.forEach(shape=>{
      const rings=flattenRings(shape.getLatLngs());
      rings.forEach((ring,ri)=>{
        const closed=ring.length>=4&&
          Math.abs(ring[0].lat-ring[ring.length-1].lat)<1e-10&&
          Math.abs(ring[0].lng-ring[ring.length-1].lng)<1e-10;
        const max=closed?ring.length-1:ring.length;
        for(let pi=0;pi<max;pi++){
          const ll=ring[pi];
          const icon=L.divIcon({className:"irrati-track-editor-marker",html:`<span>${pi+1}</span>`,iconSize:[22,22],iconAnchor:[11,11]});
          const marker=L.marker(ll,{draggable:true,icon,zIndexOffset:10000});
          const h={marker,shape,ring:ri,point:pi,lat:ll.lat,lng:ll.lng};
          marker.on("dragend",()=>{
            const p=marker.getLatLng();
            setPoint(shape,ri,pi,p);
            h.lat=p.lat;h.lng=p.lng;
            updateInfo();
          });
          marker.on("click",()=>marker.bindPopup(handlePopup(h)).openPopup());
          marker.addTo(map());
          handles.push(marker);
        }
      });
    });
    updateInfo();
  }

  function updateInfo(){
    const e=document.getElementById("irratiTrackEditorInfo");
    if(!e)return;
    if(!editing||!target){e.textContent="Editorea itzalita";return}
    const n=target.shapes.reduce((sum,s)=>sum+countPoints(s.getLatLngs()),0);
    e.innerHTML=`<strong>Editatzen:</strong> ${n} puntu · arrastatu puntuak mugitzeko · klik egin puntu batean ezabatzeko`;
  }

  function chooseTarget(){
    const cs=candidates();
    if(!cs.length)return null;
    // Loaded GPX/KML drawings usually contain more geometry layers than the empty map.
    return cs[0];
  }

  function stop(){
    editing=false;
    clearHandles();
    target=null;
    const b=document.getElementById("irratiEditTrack");
    if(b){b.classList.remove("active");b.textContent="✏️ Track-a editatu";}
    const bar=document.getElementById("irratiTrackEditorBar");
    if(bar)bar.remove();
  }

  function start(){
    if(editing){stop();message("Edizioa gelditu da.");return;}
    const t=chooseTarget();
    if(!t){message("Ez dago editatzeko track/lerroik. Kargatu GPX/KML bat edo marraztu track bat lehenengo.");return;}
    target=t;
    editing=true;
    const b=document.getElementById("irratiEditTrack");
    if(b){b.classList.add("active");b.textContent="✕ Edizioa itzali";}
    const tools=document.querySelector(".tracktools");
    if(tools&&!document.getElementById("irratiTrackEditorBar")){
      const bar=document.createElement("div");
      bar.id="irratiTrackEditorBar";
      bar.className="irrati-track-editor-bar";
      bar.innerHTML=`<span id="irratiTrackEditorInfo" class="irrati-track-editor-info"></span><button type="button" id="irratiExportEditedTrack">💾 GPX editatua</button><button type="button" id="irratiCloseTrackEditor">Amaitu edizioa</button>`;
      tools.after(bar);
      document.getElementById("irratiExportEditedTrack").onclick=exportEdited;
      document.getElementById("irratiCloseTrackEditor").onclick=()=>{stop();message("Edizioa amaitu da.")};
    }
    rebuildHandles();
    message("Track-a editatzeko modua aktibatuta: puntuak arrastatu edo klik egin ezabatzeko.");
  }

  function exportEdited(){
    if(!target)return;
    const tracks=[];
    target.shapes.forEach((shape,si)=>{
      flattenRings(shape.getLatLngs()).forEach((ring,ri)=>{
        const pts=ring.filter(ll=>Number.isFinite(ll.lat)&&Number.isFinite(ll.lng));
        if(pts.length<2)return;
        const xml=pts.map(ll=>`      <trkpt lat="${ll.lat.toFixed(8)}" lon="${ll.lng.toFixed(8)}"></trkpt>`).join("\n");
        tracks.push(`    <trk><name>Track editatua ${si+1}.${ri+1}</name><trkseg>\n${xml}\n    </trkseg></trk>`);
      });
    });
    if(!tracks.length){message("Ez dago geometria esportatzeko.");return;}
    const gpx=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="IrratiGIS Track Editor" xmlns="http://www.topografix.com/GPX/1/1">\n${tracks.join("\n")}\n</gpx>`;
    const blob=new Blob([gpx],{type:"application/gpx+xml;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="track-editatua.gpx";document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1200);
    message("GPX editatua esportatu da. Orain GPX berria berriro karga dezakezu tresnan.");
  }

  function inject(){
    style();
    const tools=document.querySelector(".tracktools");
    if(!tools||document.getElementById("irratiEditTrack"))return;
    const b=document.createElement("button");
    b.id="irratiEditTrack";
    b.type="button";
    b.textContent="✏️ Track-a editatu";
    b.title="Mugitu edo ezabatu track-eko puntuak";
    b.onclick=start;
    const anchor=document.getElementById("drawTrack");
    if(anchor&&anchor.nextSibling)tools.insertBefore(b,anchor.nextSibling);else tools.appendChild(b);
  }

  function boot(){
    if(!map()){setTimeout(boot,400);return}
    inject();
    const obs=new MutationObserver(()=>inject());
    obs.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();