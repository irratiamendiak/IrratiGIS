(()=>{
  "use strict";
    const API="https://irratigis-erreketak.kulixka-mendiak.workers.dev";
  const TOKEN_KEY="irratigis_session_token";
  const SESSION_TOKEN_KEY="irratigis_session_token_temp";
  const METEOSAT_EUROPE_BOUNDS=[[34,-25],[72,45]];
  function getToken(){return localStorage.getItem(TOKEN_KEY)||sessionStorage.getItem(SESSION_TOKEN_KEY)||"";}
  function saveToken(token,remember){localStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(SESSION_TOKEN_KEY);(remember?localStorage:sessionStorage).setItem(remember?TOKEN_KEY:SESSION_TOKEN_KEY,token);}
  function clearToken(){localStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(SESSION_TOKEN_KEY);}
  function toUtm30(lat,lon){
    try{
      if(typeof proj4==="undefined")return null;
      const p=proj4("+proj=longlat +datum=WGS84 +no_defs","+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs",[lon,lat]);
      return {x:Math.round(p[0]),y:Math.round(p[1])};
    }catch(_){return null;}
  }
  function materialEu(v){
    const t=String(v??"").trim().toLowerCase();
    const map={"matorral":"Sastrakak","restos agr\u00edcolas":"Nekazal kondarrak","restos agricolas":"Nekazal kondarrak","restos forestales":"Baso kondarrak","vegetaci\u00f3n herb\u00e1cea":"Belarkara landaretza","vegetacion herbacea":"Belarkara landaretza"};
    return map[t]||(v||"—");
  }
  const MUNI={"1":"Abaltzisketa","2":"Aduna","3":"Aizarnazabal","4":"Albiztur","5":"Alegia","6":"Alkiza","7":"Altzo","8":"Amezketa","9":"Andoain","10":"Anoeta","11":"Antzuola","12":"Arama","13":"Aretxabaleta","14":"Asteasu","15":"Ataun","16":"Aia","17":"Azkoitia","18":"Azpeitia","19":"Beasain","20":"Beizama","21":"Belauntza","22":"Berastegi","23":"Berrobi","24":"Bidegoian","25":"Zegama","26":"Zerain","27":"Zestoa","28":"Zizurkil","29":"Deba","30":"Eibar","31":"Elduain","32":"Elgoibar","33":"Elgeta","34":"Eskoriatza","35":"Ezkio-itsaso","36":"Hondarribia","37":"Gaintza","38":"Gabiria","39":"Getaria","40":"Hernani","41":"Hernialde","42":"Ibarra","43":"Idiazabal","44":"Ikaztegieta","45":"Irun","46":"Irura","47":"Itsasondo","48":"Larraul","49":"Lazkao","50":"Leaburu","51":"Legazpi","52":"Legorreta","53":"Lezo","54":"Lizartza","55":"Arrasate/Mondragón","56":"Mutriku","57":"Mutiloa","58":"Olaberria","59":"Oñati","60":"Orexa","61":"Orio","62":"Ormaiztegi","63":"Oiartzun","64":"Pasaia","65":"Soraluze/Placencia de las Armas","66":"Errezil","67":"Errenteria","68":"Leintz-Gatzaga","69":"Donostia-San Sebastián","70":"Segura","71":"Tolosa","72":"Urnieta","73":"Usurbil","74":"Bergara","75":"Villabona","76":"Ordizia","77":"Urretxu","78":"Zaldibia","79":"Zarautz","80":"Zumarraga","81":"Zumaia","82":"Mendaro","83":"Lasarte-Oria","84":"Astigarraga","85":"Baliarrain","86":"Orendain","87":"Altzaga","88":"Gaztelu","89":"Itsaso","98":"Alzania","99":"Sierra de Aralar"};
  function udalerriaIzena(v){const k=String(v??"").trim();return MUNI[k]||(v||"—");}
      window.irratiShareText=function(text){
    const t=String(text||"");
    window.open("https://wa.me/?text="+encodeURIComponent(t),"_blank","noopener");
  };
  window.irratiCopyText=function(text,btn){
    const t=String(text||"");
    const done=()=>{ if(btn){ const o=btn.textContent; btn.textContent="✓ Kopiatuta"; setTimeout(()=>btn.textContent=o,1500); } };
    if(navigator.clipboard&&window.isSecureContext){ navigator.clipboard.writeText(t).then(done).catch(()=>fallback()); }
    else fallback();
    function fallback(){ const ta=document.createElement("textarea"); ta.value=t; ta.style.position="fixed"; ta.style.left="-9999px"; document.body.appendChild(ta); ta.select(); try{document.execCommand("copy");}catch(_){} ta.remove(); done(); }
  };
  window.irratiBurnShareText=function(d){
    const L=[];
    L.push("🔥 "+(d.titulo||"Erreketa"));
    if(d.kodea) L.push("Kodea: "+d.kodea);
    if(d.titularra) L.push("Titularra: "+d.titularra);
    if(d.telefonoa) L.push("Telefonoa: "+d.telefonoa);
    if(d.erregaia) L.push("Erregaia: "+d.erregaia);
    if(d.herria) L.push("Herria: "+d.herria);
    if(d.helbidea) L.push("Helbidea: "+d.helbidea);
    if(Number.isFinite(d.lat)&&Number.isFinite(d.lon)){
      L.push("Koordenatuak: "+d.lat.toFixed(6)+", "+d.lon.toFixed(6));
      L.push("📍 https://maps.google.com/?q="+d.lat+","+d.lon);
    }
    return L.join("\n");
  };
  window.irratiShareButtons=function(d){
    const json=encodeURIComponent(JSON.stringify(d));
    return '<div style="display:flex;gap:6px;margin-top:8px">'+
      '<button type="button" onclick="(function(b){var d=JSON.parse(decodeURIComponent(b.getAttribute(\'data-share\')));window.irratiCopyText(window.irratiBurnShareText(d),b)})(this)" data-share="'+json+'" style="flex:1;border:0;border-radius:8px;padding:7px;font-weight:700;cursor:pointer;background:#edf3ef;color:#234233;font-size:12px">📋 Kopiatu</button>'+
      '<button type="button" onclick="(function(b){var d=JSON.parse(decodeURIComponent(b.getAttribute(\'data-share\')));window.irratiShareText(window.irratiBurnShareText(d))})(this)" data-share="'+json+'" style="flex:1;border:0;border-radius:8px;padding:7px;font-weight:700;cursor:pointer;background:#176b43;color:#fff;font-size:12px">↗️ Partekatu</button></div>';
  };
  async function apiFetch(path,options={}){return fetch(`${API}${path}`,{...options,mode:"cors",credentials:"omit",cache:"no-store"});}
  function recoverMap(){
    if(window.IrratiGISMap||typeof L==="undefined")return window.IrratiGISMap||null;
    const el=document.getElementById("map");
    if(!el)return null;
    try{
      const map=L.map(el,{center:[43.05,-2.2],zoom:9});
      window.IrratiGISMap=map;
      window.map=map;
      const osm=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:20,attribution:"© OpenStreetMap contributors"}).addTo(map);
      const controlled=L.featureGroup();
      window.IrratiGISControlledBurnLayer=controlled;
      L.control.layers({"OpenStreetMap":osm},{"🔥 Baimendutako erreketak":controlled},{collapsed:true,position:"topright"}).addTo(map);
      L.control.scale({metric:true,imperial:false}).addTo(map);
      window.loadControlledBurns=async function(){
        if(window.__irratiControlledLoading)return;
        const token=getToken();
        if(!token)return;
        window.__irratiControlledLoading=true;
        try{
          const r=await fetch(`${API}/api/active`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store",mode:"cors"});
          if(!r.ok)throw new Error(`HTTP ${r.status}`);
          const j=await r.json();
          const fires=Array.isArray(j.fires)?j.fires:[];
          controlled.clearLayers();
          fires.forEach(f=>{
            const lat=Number(f.latitudea??f.latitude??f.lat),lon=Number(f.longitudea??f.longitude??f.lon);
            if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
            const m=L.circleMarker([lat,lon],{radius:8,weight:2,fillOpacity:.85});
            const esc=s=>String(s??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#039;"}[c]));
            const u=toUtm30(lat,lon);m.bindPopup(`<strong>🔥 Baimendutako erreketa</strong><br><br><strong>Baimena:</strong> ${esc(f.baimena||f.codigo||"-")}<br><strong>Udalerria:</strong> ${esc(f.udalerria||"-")}<br><strong>Egoera:</strong> ${esc(f.egoera||"-")}<br><strong>Geografikoak:</strong> ${lat.toFixed(6)}, ${lon.toFixed(6)}${u?`<br><strong>UTM (ETRS89 30N):</strong> X ${u.x} · Y ${u.y}`:""}`);
            m.addTo(controlled);
          });
          if(fires.length)map.fitBounds(controlled.getBounds().pad(.2),{maxZoom:15,animate:false});
          const msg=document.getElementById("message");if(msg)msg.textContent=`${fires.length} baimendutako erreketa kargatu dira.`;
        }catch(e){console.error("IrratiGIS baimendutako erreketa",e);const msg=document.getElementById("message");if(msg)msg.textContent="Ezin izan dira baimendutako erreketa kargatu."}
        finally{window.__irratiControlledLoading=false}
      };
      setTimeout(()=>map.invalidateSize(),50);
      return map;
    }catch(e){console.error("IrratiGIS map recovery",e);return null}
  }
  function installFirmsLeafletOverlay(){const leafletMap=window.IrratiGISMap||((typeof map!=="undefined")?map:null);if(!leafletMap||typeof L==="undefined")return false;if(!window.IrratiGISFirmsLayer)window.IrratiGISFirmsLayer=L.featureGroup();const firmsLayer=window.IrratiGISFirmsLayer;const addRow=()=>{const lists=document.querySelectorAll(".leaflet-control-layers-overlays");if(!lists.length)return false;lists.forEach(list=>{if(list.querySelector(".irrati-firms-layer-row"))return;const row=document.createElement("label");row.className="irrati-firms-layer-row";row.style.display="block";const input=document.createElement("input");input.type="checkbox";input.className="leaflet-control-layers-selector";input.checked=leafletMap.hasLayer(firmsLayer);input.addEventListener("change",()=>{if(input.checked){if(window.IrratiGISFirms?.open)window.IrratiGISFirms.open();else firmsLayer.addTo(leafletMap)}else leafletMap.removeLayer(firmsLayer)});const span=document.createElement("span");span.textContent=" 🚨 NASA FIRMS";row.appendChild(input);row.appendChild(span);list.appendChild(row)});return true};addRow();[100,300,700,1500,3000].forEach(ms=>setTimeout(addRow,ms));if(!window.__irratiFirmsDomObserver){window.__irratiFirmsDomObserver=new MutationObserver(()=>addRow());window.__irratiFirmsDomObserver.observe(document.body,{childList:true,subtree:true})}return true;}
  function setOverlayCheckbox(match,on){const map=window.IrratiGISMap;if(!map)return false;let found=false;document.querySelectorAll(".leaflet-control-layers-overlays label").forEach(label=>{const text=(label.textContent||"").toLowerCase();if(!text.includes(match.toLowerCase()))return;const input=label.querySelector("input");if(!input)return;found=true;if(input.checked!==on){input.checked=on;input.dispatchEvent(new Event("change",{bubbles:true}))}});return found}
  function setupMeteosatEuropeView(){const map=window.IrratiGISMap;if(!map)return;const wire=()=>{document.querySelectorAll(".leaflet-control-layers-overlays label").forEach(label=>{const text=(label.textContent||"").toLowerCase();if(!text.includes("meteosat frp"))return;const input=label.querySelector("input");if(!input||input.dataset.europeWired)return;input.dataset.europeWired="1";const go=()=>{if(input.checked)setTimeout(()=>map.fitBounds(METEOSAT_EUROPE_BOUNDS,{padding:[24,24],animate:false,maxZoom:6}),80)};input.addEventListener("change",go);if(input.checked)go()})};wire();if(!window.__irratiMeteosatEuropeObserver){window.__irratiMeteosatEuropeObserver=new MutationObserver(wire);window.__irratiMeteosatEuropeObserver.observe(document.body,{childList:true,subtree:true})}}
  function setupAppArchitecture(){if(document.getElementById("irratiAppTabs"))return;const main=document.querySelector("main");if(!main)return;const map=document.getElementById("map"),mapPanel=map?.closest(".panel"),coordPanel=document.querySelector(".coordgrid")?.closest(".panel"),uploadPanel=main.querySelector(".upload")?.closest(".panel"),cards=main.querySelector(".cards"),details=main.querySelector(".file-details-panel"),printReport=document.getElementById("printReport"),footer=main.querySelector(".footer");if(!mapPanel)return;const originalMapHead=mapPanel.querySelector(".maphead"),trackTools=mapPanel.querySelector(".tracktools"),trackStats=mapPanel.querySelector(".trackstats"),layersNote=mapPanel.querySelector(".layers-note");const nav=document.createElement("nav");nav.id="irratiAppTabs";nav.className="irrati-app-tabs";nav.setAttribute("aria-label","IrratiGIS atalak");nav.style.display="none";nav.innerHTML=`<button type="button" class="irrati-tab active" data-view="burns" aria-selected="true">🔥 Baimendutako erreketak</button><button type="button" class="irrati-tab" data-view="tracks" aria-selected="false">📐 GIS tresnak</button>`;const fireView=document.createElement("section");fireView.id="irratiFireView";fireView.className="irrati-view";const burnView=document.createElement("section");burnView.id="irratiBurnView";burnView.className="irrati-view active";const tracksView=document.createElement("section");tracksView.id="irratiTracksView";tracksView.className="irrati-view";const fireIntro=document.createElement("div");fireIntro.className="irrati-section-intro";fireIntro.innerHTML=`<div><div class="irrati-section-kicker">ZAINTZA · SUTEAK</div><h2>🔥 Suteak</h2><p>NASA FIRMS satelite bidezko detekzio termikoak eta Meteosat FRP-PIXEL.</p></div><span class="irrati-status-badge">Suteen ikuspegia</span></div>`;const burnIntro=document.createElement("div");burnIntro.className="irrati-section-intro";burnIntro.innerHTML=`<div><h2>🔥 Baimendutako erreketak</h2><p>Baimendutako erreketa kokapenak eta egoera aktiboak.</p></div>`;const trackIntro=document.createElement("div");trackIntro.className="irrati-section-intro";trackIntro.innerHTML=`<div><h2>GIS tresnak</h2><p>Kargatu, editatu, neurtu eta esportatu.</p></div><span class="irrati-status-badge blue">Lan-eremua</span>`;mapPanel.classList.add("irrati-map-panel");if(originalMapHead){const h2=originalMapHead.querySelector("h2");if(h2)h2.textContent="Mapa-bisorea";const badges=originalMapHead.querySelector("div div");if(badges)badges.innerHTML=""}main.innerHTML="";main.appendChild(nav);main.appendChild(fireView);main.appendChild(burnView);main.appendChild(tracksView);if(printReport)main.appendChild(printReport);if(footer)main.appendChild(footer);fireView.appendChild(fireIntro);burnView.appendChild(burnIntro);tracksView.appendChild(trackIntro);if(uploadPanel)tracksView.appendChild(uploadPanel);if(cards)tracksView.appendChild(cards);if(details)tracksView.appendChild(details);if(coordPanel)tracksView.appendChild(coordPanel);if(trackTools)mapPanel.appendChild(trackTools);if(trackStats)mapPanel.appendChild(trackStats);if(layersNote)mapPanel.appendChild(layersNote);
    recoverMap();
    setTimeout(buildHistoryPanel,300);
    const setMapMode=mode=>{const fires=mode==="fires",burns=mode==="burns";fireView.classList.toggle("active",fires);burnView.classList.toggle("active",burns);tracksView.classList.toggle("active",!fires&&!burns);nav.querySelectorAll(".irrati-tab").forEach(b=>{const active=b.dataset.view===mode;b.classList.toggle("active",active);b.setAttribute("aria-selected",active?"true":"false")});if(trackTools)trackTools.hidden=!tracksView.classList.contains("active");if(trackStats)trackStats.hidden=!tracksView.classList.contains("active");if(layersNote)layersNote.hidden=!tracksView.classList.contains("active");if(fires||burns)mapPanel.classList.add("irrati-fire-map");const target=fires?fireView:burns?burnView:tracksView;if(mapPanel.parentElement!==target)target.appendChild(mapPanel);
      try{ const hp=document.getElementById("irratiHistPanel"); if(hp && hp.parentElement===target){ target.appendChild(hp); } }catch(_){}if(fires){setOverlayCheckbox("baimendutako erreketa",false);installFirmsLeafletOverlay();if(window.IrratiGISFirms?.open)window.IrratiGISFirms.open();else runRealBurns()}else if(burns){setOverlayCheckbox("NASA FIRMS",false);setOverlayCheckbox("baimendutako erreketa",false)}else{setOverlayCheckbox("NASA FIRMS",false);}requestAnimationFrame(()=>{if(typeof window.IrratiGISMap?.invalidateSize==="function")window.IrratiGISMap.invalidateSize();setTimeout(()=>window.IrratiGISMap?.invalidateSize?.(),80)})};nav.querySelectorAll(".irrati-tab").forEach(b=>b.addEventListener("click",()=>setMapMode(b.dataset.view)));setMapMode("tracks");const style=document.createElement("style");style.textContent=`.irrati-app-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 14px;padding:5px;background:#e8efeb;border:1px solid var(--line);border-radius:15px;position:sticky;top:8px;z-index:1000;box-shadow:0 4px 16px rgba(0,0,0,.08)}.irrati-tab{min-height:48px;border:0;border-radius:11px;background:transparent;color:#345243;font:800 15px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;cursor:pointer;padding:10px 12px}.irrati-tab.active{background:#fff;color:#176b43;box-shadow:0 2px 8px rgba(0,0,0,.10)}.irrati-view{display:none}.irrati-view.active{display:block}.irrati-section-intro{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:12px;padding:14px 16px;background:#fff;border:1px solid var(--line);border-radius:15px;box-shadow:0 4px 16px rgba(0,0,0,.04)}.irrati-section-intro h2{margin:1px 0 4px;font-size:22px}.irrati-section-intro p{margin:0;color:var(--muted);font-size:13px}.irrati-section-kicker{font-size:10px;font-weight:900;letter-spacing:.14em;color:var(--green)}.irrati-status-badge{flex:none;padding:6px 9px;border-radius:999px;background:#e8f5ed;color:#176b43;font-size:11px;font-weight:900}.irrati-status-badge.blue{background:#e8f2f8;color:#175f8f}.irrati-map-panel{margin-bottom:14px}@media(max-width:800px){.irrati-app-tabs{grid-template-columns:1fr}.irrati-tab{min-height:44px;font-size:13px;padding:8px 7px}}@media(max-width:560px){.irrati-app-tabs{top:4px;margin-bottom:9px;padding:4px}.irrati-section-intro{padding:11px 12px;border-radius:12px;align-items:flex-start}.irrati-section-intro h2{font-size:18px}.irrati-section-intro p{font-size:12px}.irrati-status-badge{display:none}}`;document.head.appendChild(style);const title=document.querySelector("header h1"),subtitle=document.querySelector("header p"),eyebrow=document.querySelector("header .eyebrow");if(title)title.textContent="IrratiGIS";if(eyebrow)eyebrow.textContent="GIS SISTEMA";if(subtitle)subtitle.textContent="Baimendutako erreketak · GIS tresnak";}
  function buildHistoryPanel(){
    if(document.getElementById("irratiHistPanel"))return;
       const burnView=document.getElementById("irratiTracksView")||document.getElementById("irratiBurnView");
    if(!burnView)return;
    const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
    const sec=document.createElement("section");
    sec.className="panel";
    sec.id="irratiHistPanel";
    sec.innerHTML=`
      <div class="maphead"><div><h2>🔥 Erreketen historikoa</h2>
      <div><span class="badge">Data zehatza</span> <span class="badge blue">Data-tartea</span></div></div></div>
      <div style="background:#f7faf8;border:1px solid var(--line);border-radius:12px;padding:12px">
        <label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin:6px 0 4px">Datatik / Desde</label>
        <input id="irratiHistFrom" type="date" style="width:100%;border:1px solid #cfdad3;border-radius:9px;padding:10px;font:inherit;background:#fff">
        <label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin:10px 0 4px">Datara / Hasta (hutsik = egun bakarra)</label>
        <input id="irratiHistTo" type="date" style="width:100%;border:1px solid #cfdad3;border-radius:9px;padding:10px;font:inherit;background:#fff">
        <label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin:10px 0 4px">Kodea (aukerakoa)</label>
        <input id="irratiHistKode" type="text" inputmode="numeric" placeholder="adib. 26743715" style="width:100%;border:1px solid #cfdad3;border-radius:9px;padding:10px;font:inherit;background:#fff">
        <label style="display:block;font-size:11px;font-weight:800;color:var(--muted);margin:10px 0 4px">Herria (aukerakoa)</label>
        <select id="irratiHistHerria" style="width:100%;border:1px solid #cfdad3;border-radius:9px;padding:10px;font:inherit;background:#fff"><option value="">— Guztiak —</option></select>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button id="irratiHistQuery" style="border:0;border-radius:10px;padding:11px 14px;font-weight:750;cursor:pointer;background:#176b43;color:#fff">Kontsultatu</button>
          <button id="irratiHistClear" style="border:0;border-radius:10px;padding:11px 14px;font-weight:750;cursor:pointer;background:#edf3ef;color:#234233">Garbitu</button>
        </div>
        <div id="irratiHistResult" style="margin-top:10px;padding:10px;border-radius:9px;background:#fff;border:1px solid var(--line);font-size:13px">Aukeratu data bat eta sakatu «Kontsultatu».</div>
        <div id="irratiHistExports" style="display:none;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button id="irratiHistCsv" style="border:0;border-radius:10px;padding:10px 13px;font-weight:750;cursor:pointer;background:#175f8f;color:#fff">Excel (CSV) esportatu</button>
          <button id="irratiHistPdf" style="border:0;border-radius:10px;padding:10px 13px;font-weight:750;cursor:pointer;background:#8a5a1f;color:#fff">PDF esportatu</button>
        </div>
        <div id="irratiHistTableWrap" style="margin-top:10px;overflow-x:auto"></div>
      </div>`;
        burnView.appendChild(sec);
    try{
      const mp=document.getElementById("map")?.closest(".panel");
      if(mp && mp.parentElement===burnView){ burnView.appendChild(mp); burnView.appendChild(sec); }
    }catch(_){}
    // Rellenar desplegable de municipios ordenado por nombre
    try{
      const selH=document.getElementById("irratiHistHerria");
      if(selH){
        Object.entries(MUNI).sort((a,b)=>a[1].localeCompare(b[1],"eu")).forEach(([cod,nom])=>{
          const o=document.createElement("option");o.value=cod;o.textContent=nom;selH.appendChild(o);
        });
      }
    }catch(_){}

    const map=window.IrratiGISMap;
    const histLayer=L.featureGroup();
    window.__irratiHistLayer=histLayer;
    let shown=false;
    const flame=L.divIcon({className:"burn-flame-icon",html:'<div style="font-size:22px;line-height:1;text-align:center;filter:drop-shadow(0 1px 1px rgba(0,0,0,.55))">🔥</div>',iconSize:[24,24],iconAnchor:[12,12],popupAnchor:[0,-10]});
    const R=id=>document.getElementById(id);

    let lastRows=[], lastFrom="", lastTo="";
    const COLS=[["data","Data"],["kodea","Kodea"],["titularra","Titularra"],["telefonoa","Telefonoa"],["materiala","Erregaia"],["udalerria","Udalerria"],["helbidea","Helbidea"],["lat","Lat"],["lon","Lon"]];
    function renderTable(rows){
      const w=R("irratiHistTableWrap");
      if(!rows.length){w.innerHTML="";R("irratiHistExports").style.display="none";return;}
      let html='<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>';
      COLS.forEach(c=>html+=`<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #cfdad3;white-space:nowrap">${esc(c[1])}</th>`);
      html+="</tr></thead><tbody>";
      rows.forEach(r=>{html+="<tr>";COLS.forEach(c=>html+=`<td style="padding:6px 8px;border-bottom:1px solid #e2e8e4;white-space:nowrap">${esc(r[c[0]])}</td>`);html+="</tr>";});
      html+="</tbody></table>";
      w.innerHTML=html;
      R("irratiHistExports").style.display="flex";
    }
    async function run(){
      const kode=(R("irratiHistKode").value||"").trim();
      const herria=(R("irratiHistHerria").value||"").trim();
      const from=R("irratiHistFrom").value, to=R("irratiHistTo").value||from;
      // Si hay código, la búsqueda es por código (sin fecha). Si no, se exige fecha.
      if(!kode && !from){R("irratiHistResult").textContent="Aukeratu data bat edo sartu kodea.";return;}
      const token=getToken();
      if(!token){R("irratiHistResult").textContent="Saioa ez dago aktibo.";return;}
      R("irratiHistResult").textContent="Kontsultatzen…";
      lastRows=[]; lastFrom=from||""; lastTo=to||from||"";
      try{
        let apiUrl;
        if(kode){ apiUrl=`${API}/api/history?codigo=${encodeURIComponent(kode)}`; }
        else { apiUrl=`${API}/api/history?from=${from}&to=${to}`+(herria?`&municipio=${encodeURIComponent(herria)}`:""); }
        const r=await fetch(apiUrl,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
        const j=await r.json();
        if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
        const fires=Array.isArray(j.fires)?j.fires:[];
        histLayer.clearLayers();
        let n=0; const bounds=[];
        fires.forEach(row=>{
          const f=row.data||row;
          let lat=Number(f.latitudea??f.latitud), lon=Number(f.longitudea??f.longitud);
          // Si vienen en UTM (valores grandes), convertir a lat/lon con proj4 (ETRS89/30N)
          if(Number.isFinite(lat)&&Number.isFinite(lon)&&(Math.abs(lat)>90||Math.abs(lon)>180)){
            try{
              const xUtm=Number(f.longitudea??f.longitud??f.x??lon);
              const yUtm=Number(f.latitudea??f.latitud??f.y??lat);
              if(typeof proj4!=="undefined"){
                const g=proj4("+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs","+proj=longlat +datum=WGS84 +no_defs",[xUtm,yUtm]);
                lon=g[0]; lat=g[1];
              }
            }catch(_){}
          }
          if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return;
          const rec={data:row.observed_date||"",kodea:f.id||"",titularra:f.titular||"",telefonoa:f.telefono||"",materiala:materialEu(f.tipoQuema||f.descripcionMaterial),udalerria:udalerriaIzena(f.municipio||f.udalerria),helbidea:f.direccion||"",lat:lat.toFixed(6),lon:lon.toFixed(6)};
          lastRows.push(rec);
          const m=L.marker([lat,lon],{icon:flame});
          const uH=toUtm30(lat,lon);const shareH=window.irratiShareButtons?window.irratiShareButtons({titulo:"Erreketa (historikoa)",kodea:rec.kodea,titularra:rec.titularra,telefonoa:rec.telefonoa,erregaia:rec.materiala,herria:rec.udalerria,helbidea:rec.helbidea,lat:lat,lon:lon}):"";m.bindPopup(`<strong>🔥 Erreketa (historikoa)</strong><br><br><strong>Data:</strong> ${esc(rec.data||"—")}<br><strong>Kodea:</strong> ${esc(rec.kodea||"—")}<br><strong>Titularra:</strong> ${esc(rec.titularra||"—")}<br><strong>Telefonoa:</strong> ${esc(rec.telefonoa||"—")}<br><strong>Erregaia:</strong> ${esc(rec.materiala)}<br><strong>Helbidea:</strong> ${esc(rec.helbidea||"—")}<br><strong>Geografikoak:</strong> ${lat.toFixed(6)}, ${lon.toFixed(6)}${uH?`<br><strong>UTM (ETRS89 30N):</strong> X ${uH.x} · Y ${uH.y}`:""}${shareH}`);
          m.addTo(histLayer); bounds.push([lat,lon]); n++;
        });
        if(!shown){histLayer.addTo(map);shown=true;}
        renderTable(lastRows);
        const criterio = kode ? `Kodea: ${esc(kode)}` : (`${esc(from)}${to!==from?` → ${esc(to)}`:""}`+(herria?` · ${esc(MUNI[herria]||herria)}`:""));
        if(n){try{map.fitBounds(L.latLngBounds(bounds).pad(0.2));}catch(_){}R("irratiHistResult").innerHTML=`<strong>${n}</strong> erreketa aurkitu dira (${criterio}).`;}
        else{R("irratiHistResult").textContent=`Ez da erreketarik aurkitu (${criterio}).`;}
      }catch(e){R("irratiHistResult").textContent="Errorea: "+(e.message||e);R("irratiHistExports").style.display="none";}
    }
    function fname(ext){return `erreketak_${lastFrom}${lastTo!==lastFrom?"_"+lastTo:""}.${ext}`;}
    function download(blob,name){const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}
    function exportCsv(){
      if(!lastRows.length)return;
      const q=v=>{const s=String(v??"");return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
      const head=COLS.map(c=>q(c[1])).join(";");
      const body=lastRows.map(r=>COLS.map(c=>q(r[c[0]])).join(";")).join("\n");
      const csv="\ufeff"+head+"\n"+body;
      download(new Blob([csv],{type:"text/csv;charset=utf-8"}),fname("csv"));
    }
    function exportPdf(){
      if(!lastRows.length)return;
      if(!window.jspdf||!window.jspdf.jsPDF){R("irratiHistResult").textContent="PDF liburutegia ez dago kargatuta.";return;}
      const {jsPDF}=window.jspdf;
      const doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});
      doc.setFillColor(24,78,52);doc.rect(0,0,297,16,"F");
      doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(13);
      doc.text("IrratiGIS · Erreketen historikoa",10,10);
      doc.setTextColor(20,20,20);doc.setFontSize(9);
      doc.text(`${lastFrom}${lastTo!==lastFrom?" - "+lastTo:""}  ·  ${lastRows.length} erreketa`,10,22);
      const heads=COLS.map(c=>c[1]);
      const widths=[20,20,34,22,26,26,60,22,22];
      let x=10,y=30;
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);
      heads.forEach((h,i)=>{doc.text(String(h),x,y);x+=widths[i];});
      doc.setDrawColor(180);doc.line(10,y+1.5,287,y+1.5);
      doc.setFont("helvetica","normal");
      y+=6;
      lastRows.forEach(r=>{
        if(y>195){doc.addPage();y=20;}
        x=10;
        COLS.forEach((c,i)=>{
          const t=doc.splitTextToSize(String(r[c[0]]??""),widths[i]-1);
          doc.text(t.length?t[0]:"",x,y);
          x+=widths[i];
        });
        y+=5.5;
      });
      doc.save(fname("pdf"));
    }
    R("irratiHistCsv").addEventListener("click",exportCsv);
    R("irratiHistPdf").addEventListener("click",exportPdf);
    function clear(){histLayer.clearLayers();if(shown){map.removeLayer(histLayer);shown=false;}const k=R("irratiHistKode");if(k)k.value="";const h=R("irratiHistHerria");if(h)h.value="";R("irratiHistTableWrap").innerHTML="";R("irratiHistExports").style.display="none";R("irratiHistResult").textContent="Aukeratu data bat eta sakatu «Kontsultatu».";}
    R("irratiHistQuery").addEventListener("click",run);
    R("irratiHistClear").addEventListener("click",clear);
  }
  function tidyMapOverlays(){const map=window.IrratiGISMap;if(!map)return;const c=map.getContainer();const apply=()=>{const met=c.querySelector("#irratiMeteosatPanel");if(met){met.style.setProperty("top","112px","important");met.style.setProperty("bottom","auto","important");met.style.setProperty("left","8px","important")}const legend=c.querySelector(".irrati-firms-legend");if(legend){legend.style.setProperty("margin-bottom","58px","important")}const st=c.querySelector("#irratiFirmsStatus");if(st){st.style.setProperty("bottom","8px","important")}const dbg=c.querySelector("#irratiAuthFirmsDebug");if(dbg){dbg.style.setProperty("bottom","52px","important")}};apply();if(!window.__irratiOverlayObserver){window.__irratiOverlayObserver=new MutationObserver(apply);window.__irratiOverlayObserver.observe(c,{childList:true,subtree:true})}}
  function showFirmsDebug(text,type="info"){const map=window.IrratiGISMap;if(!map)return;let el=document.getElementById("irratiAuthFirmsDebug");if(!el){el=document.createElement("div");el.id="irratiAuthFirmsDebug";el.style.cssText="position:absolute;left:10px;bottom:52px;z-index:1001;padding:7px 10px;border-radius:9px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.2);font:800 12px system-ui;max-width:500px;pointer-events:none";map.getContainer().appendChild(el)}el.textContent=text;el.style.color=type==="error"?"#a12626":"#176b43";el.style.display="block";if(type!=="error")setTimeout(()=>{if(el.parentNode)el.remove()},2200);}
  function loadFirePopupModule(){return Promise.resolve(null);const existing=document.getElementById("irratiFirePopupScript");if(existing)return window.IrratiGISFirePopupReady||Promise.resolve(window.IrratiGISFirePopup);const script=document.createElement("script");script.id="irratiFirePopupScript";script.src="fire-popup.js?v=20260909-01";script.defer=true;window.IrratiGISFirePopupReady=new Promise(resolve=>{script.onload=()=>{showFirmsDebug("NASA FIRMS: modulua kargatuta");resolve(window.IrratiGISFirePopup)};script.onerror=()=>{showFirmsDebug("NASA FIRMS: fire-popup.js EZIN KARGATU","error");resolve(null)}});document.head.appendChild(script);return window.IrratiGISFirePopupReady;}
  function runRealBurns(){installFirmsLeafletOverlay();showFirmsDebug("NASA FIRMS: karga abiarazten…");loadFirePopupModule().then(m=>{installFirmsLeafletOverlay();if(window.IrratiGISFirms?.open)window.IrratiGISFirms.open();else if(m&&typeof m.openFirms==="function")m.openFirms();else if(m&&typeof m.loadBurnsIntoLayer==="function"){m.loadBurnsIntoLayer();setTimeout(()=>window.IrratiGISFirms?.open?.(),300)}else showFirmsDebug("NASA FIRMS: modulua ez dago prest","error");setTimeout(installFirmsLeafletOverlay,1200);tidyMapOverlays();setupMeteosatEuropeView()})}
  function addLogoutButton(){if(document.getElementById("irratiLogoutButton"))return;const b=document.createElement("button");b.id="irratiLogoutButton";b.type="button";b.textContent="Saioa itxi";b.style.cssText="position:fixed;right:12px;top:12px;z-index:2147483646;padding:9px 12px;border:0;border-radius:9px;background:#fff;color:#176b43;font:800 12px system-ui;box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer";b.onclick=()=>{clearToken();location.reload()};document.body.appendChild(b);}
  function showLogin(message="Sarbide babestua"){const old=document.getElementById("irratiLoginBackdrop");if(old)old.remove();const back=document.createElement("div");back.id="irratiLoginBackdrop";back.style.cssText="position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px";const box=document.createElement("div");box.style.cssText="width:min(420px,94vw);background:#fff;border-radius:16px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:14px system-ui;color:#16231c";box.innerHTML=`<h2 style="margin:0 0 8px">IrratiGIS</h2><p style="margin:0 0 14px;color:#65736b">${message}</p><label style="display:block;font-weight:800;font-size:12px;margin:8px 0 4px">Erabiltzailea</label><input id="irratiUser" type="text" autocomplete="username" style="width:100%;padding:10px;border:1px solid #ccd8d0;border-radius:9px;font:inherit"><label style="display:block;font-weight:800;font-size:12px;margin:10px 0 4px">Pasahitza</label><div style="position:relative"><input id="irratiPass" type="password" autocomplete="current-password" style="width:100%;padding:10px 42px 10px 10px;border:1px solid #ccd8d0;border-radius:9px;font:inherit"><button id="irratiPassEye" type="button" aria-label="Mostrar contraseña" title="Mostrar contraseña" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;padding:6px;cursor:pointer;font-size:18px;line-height:1">👁️</button></div><label style="display:flex;gap:7px;align-items:center;margin:10px 0"><input id="irratiRemember" type="checkbox" checked> Gogoratu</label><button id="irratiLogin" type="button" style="padding:10px 14px;border:0;border-radius:9px;background:#176b43;color:#fff;font:800 14px system-ui;cursor:pointer">Sartu</button><div id="irratiLoginMsg" style="margin-top:10px;color:#8b2f2f"></div>`;back.appendChild(box);document.body.appendChild(back);const user=box.querySelector("#irratiUser"),pass=box.querySelector("#irratiPass"),remember=box.querySelector("#irratiRemember"),login=box.querySelector("#irratiLogin"),msg=box.querySelector("#irratiLoginMsg"),eye=box.querySelector("#irratiPassEye");eye.onclick=()=>{const visible=pass.type==="text";pass.type=visible?"password":"text";eye.textContent=visible?"👁️":"🙈";eye.setAttribute("aria-label",visible?"Mostrar contraseña":"Ocultar contraseña");eye.title=visible?"Mostrar contraseña":"Ocultar contraseña"};async function submit(){login.disabled=true;msg.textContent="Saioa hasten…";try{const body=new URLSearchParams({user:user.value.trim(),password:pass.value,remember:remember.checked?"1":"0"});const r=await apiFetch("/api/login-form",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});const text=await r.text();const tm=text.match(/irrati_token=([^&\"']+)/);if(!r.ok||!tm){const em=text.match(/irrati_login_error=([^&\"']+)/);throw new Error(em?decodeURIComponent(em[1]):`Login HTTP ${r.status}`)}const token=decodeURIComponent(tm[1]);saveToken(token,remember.checked);back.remove();addLogoutButton();setupAppArchitecture();setOverlayCheckbox("NASA FIRMS",false);setOverlayCheckbox("baimendutako erreketa",false)}catch(e){msg.textContent=e.message||"Ezin izan da saioa hasi.";login.disabled=false}}login.onclick=submit;pass.addEventListener("keydown",e=>{if(e.key==="Enter")submit()});user.focus();}
  function validateToken(token){try{const p=token.split(".");if(p.length!==2)return false;const raw=p[0].replace(/-/g,"+").replace(/_/g,"/");const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw+"===".slice((raw.length+3)%4)),c=>c.charCodeAt(0))));return !!payload.sub&&Number(payload.exp)>Math.floor(Date.now()/1000)}catch(_){return false}}
  async function startAuth(){setupAppArchitecture();const hash=new URLSearchParams(location.hash.replace(/^#/,""));const incoming=hash.get("irrati_token");if(incoming){history.replaceState(null,"",location.pathname+location.search);saveToken(incoming,hash.get("remember")==="1")}const token=getToken();if(token&&validateToken(token)){addLogoutButton();setOverlayCheckbox("NASA FIRMS",false);setOverlayCheckbox("baimendutako erreketa",false);tidyMapOverlays();setupMeteosatEuropeView();return}if(token)clearToken();showLogin()}
  window.IrratiGISAuth={API,TOKEN_KEY,getToken,logout:()=>{clearToken();location.reload()}};window.IrratiGISAuthReady=startAuth();
})();
