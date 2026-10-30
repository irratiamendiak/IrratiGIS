/* IrratiGIS Wildfire Intelligence · foundation v0.1.0
 * Incident intake and GIS handoff only. No fire-spread prediction is performed here.
 */
(() => {
  "use strict";

  const VERSION = "0.1.0";
  const STYLE_ID = "irrati-wildfire-style";
  const CONTROL_CLASS = "irrati-wildfire-control";
  const state = {
    map: null,
    control: null,
    ignitionLayer: null,
    selectingIgnition: false,
    ignition: null,
    incident: null
  };

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  const isoNow = () => new Date().toISOString();

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .irrati-wildfire-control{background:#fff;border:1px solid #cfdad3;border-radius:12px;box-shadow:0 2px 12px #0002;color:#17251d;font:13px/1.4 system-ui,sans-serif;max-width:min(360px,calc(100vw - 76px))}
      .irrati-wildfire-control button,.irrati-wildfire-control input,.irrati-wildfire-control select{font:inherit}
      .iwf-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:linear-gradient(120deg,#173d2d,#246947);color:#fff;border-radius:11px 11px 0 0}
      .iwf-head strong{font-size:13px;letter-spacing:.02em}
      .iwf-toggle{border:0;border-radius:7px;background:#ffffff20;color:#fff;padding:5px 8px;cursor:pointer}
      .iwf-body{padding:11px;max-height:min(72vh,650px);overflow:auto}
      .iwf-body[hidden]{display:none}
      .iwf-section{border-top:1px solid #e2e9e4;padding-top:9px;margin-top:9px}
      .iwf-section h4{margin:0 0 7px;font-size:12px;color:#24543b}
      .iwf-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .iwf-field label{display:block;font-size:10px;font-weight:800;color:#64746a;margin-bottom:3px}
      .iwf-field input,.iwf-field select{width:100%;min-width:0;padding:7px;border:1px solid #ccd8d0;border-radius:7px;background:#fff;color:#17251d}
      .iwf-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}
      .iwf-actions button{border:0;border-radius:8px;padding:8px 10px;font-weight:750;cursor:pointer;background:#eaf1ec;color:#214c35}
      .iwf-actions .primary{background:#176b43;color:#fff}
      .iwf-actions button:disabled{opacity:.45;cursor:not-allowed}
      .iwf-note{font-size:11px;color:#65736b;margin:7px 0 0}
      .iwf-status{padding:8px;border-radius:8px;background:#f3f6f4;font-size:11px;margin-top:8px}
      .iwf-status strong{display:block;margin-bottom:3px}
      .iwf-warning{background:#fff6e8;color:#744b0b;border:1px solid #f0d8a9}
      .iwf-ready{background:#edf6ef;color:#24543b}
      .iwf-coord{font-variant-numeric:tabular-nums;font-size:11px;color:#43564a}
      @media(max-width:560px){.irrati-wildfire-control{max-width:calc(100vw - 68px)}.iwf-body{max-height:62vh}.iwf-grid{gap:6px}}
    `;
    document.head.appendChild(style);
  }

  function buildControl() {
    const Control = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const root = L.DomUtil.create("section", CONTROL_CLASS);
        root.innerHTML = `
          <div class="iwf-head">
            <strong>🔥 WILDFIRE INTELLIGENCE</strong>
            <button type="button" class="iwf-toggle" data-action="toggle" aria-expanded="true">Ocultar</button>
          </div>
          <div class="iwf-body">
            <div class="iwf-section" style="border-top:0;padding-top:0;margin-top:0">
              <h4>1 · Incidente</h4>
              <div class="iwf-field"><label for="iwf-name">Nombre del incidente</label><input id="iwf-name" maxlength="100" placeholder="Ej. Incendio · municipio / zona"></div>
              <div class="iwf-actions">
                <button type="button" class="primary" data-action="pick">📍 Seleccionar ignición en mapa</button>
                <button type="button" data-action="clear">Limpiar</button>
              </div>
              <div class="iwf-coord" id="iwf-coords">Punto de ignición no seleccionado</div>
            </div>
            <div class="iwf-section">
              <h4>2 · Meteorología observada (entrada manual inicial)</h4>
              <div class="iwf-grid">
                <div class="iwf-field"><label for="iwf-wind">Viento medio (km/h)</label><input id="iwf-wind" type="number" min="0" max="250" step="0.1" placeholder="—"></div>
                <div class="iwf-field"><label for="iwf-gust">Racha (km/h)</label><input id="iwf-gust" type="number" min="0" max="300" step="0.1" placeholder="—"></div>
                <div class="iwf-field"><label for="iwf-direction">Dirección desde (°)</label><input id="iwf-direction" type="number" min="0" max="360" step="1" placeholder="0–360"></div>
                <div class="iwf-field"><label for="iwf-temp">Temperatura (°C)</label><input id="iwf-temp" type="number" min="-30" max="60" step="0.1" placeholder="—"></div>
                <div class="iwf-field"><label for="iwf-rh">Humedad relativa (%)</label><input id="iwf-rh" type="number" min="0" max="100" step="1" placeholder="—"></div>
                <div class="iwf-field"><label for="iwf-fuel">Combustible / modelo</label><input id="iwf-fuel" maxlength="80" placeholder="Pendiente de asignar"></div>
              </div>
              <p class="iwf-note">Registrar fuente, hora de observación y estación asociada antes de usar estos datos en un modelo.</p>
            </div>
            <div class="iwf-section">
              <h4>3 · Escenario de trabajo</h4>
              <div class="iwf-grid">
                <div class="iwf-field"><label for="iwf-horizon">Horizonte</label><select id="iwf-horizon"><option value="30">30 minutos</option><option value="60" selected>1 hora</option><option value="120">2 horas</option><option value="240">4 horas</option><option value="480">8 horas</option></select></div>
                <div class="iwf-field"><label for="iwf-source">Calidad de datos</label><select id="iwf-source"><option value="unverified">Sin verificar</option><option value="field_verified">Verificado en campo</option><option value="authoritative">Fuente oficial</option></select></div>
              </div>
              <div class="iwf-actions">
                <button type="button" class="primary" data-action="create">Crear ficha de escenario</button>
                <button type="button" data-action="export" disabled>Exportar GeoJSON</button>
              </div>
              <div id="iwf-status" class="iwf-status iwf-warning" role="status" aria-live="polite">
                <strong>Prototipo de captura</strong>
                No se ha ejecutado ningún modelo de propagación.
              </div>
            </div>
            <p class="iwf-note">Esta herramienta organiza datos y geometrías. No calcula perímetros previstos, no evalúa seguridad de líneas y no emite recomendaciones tácticas.</p>
          </div>`;
        L.DomEvent.disableClickPropagation(root);
        L.DomEvent.disableScrollPropagation(root);
        root.addEventListener("click", onControlClick);
        state.root = root;
        return root;
      }
    });
    state.control = new Control();
    state.control.addTo(state.map);
  }

  function setStatus(title, message, kind = "warning") {
    const el = state.root?.querySelector("#iwf-status");
    if (!el) return;
    el.className = "iwf-status " + (kind === "ready" ? "iwf-ready" : "iwf-warning");
    el.innerHTML = `<strong>${esc(title)}</strong>${esc(message)}`;
  }

  function setIgnition(latlng) {
    state.ignition = { type: "Point", coordinates: [latlng.lng, latlng.lat] };
    state.ignitionLayer.clearLayers();
    L.circleMarker(latlng, {
      radius: 8, color: "#7b160e", weight: 2,
      fillColor: "#f04432", fillOpacity: 0.95
    }).bindTooltip("Ignición registrada · sin validar").addTo(state.ignitionLayer);
    const coords = state.root?.querySelector("#iwf-coords");
    if (coords) coords.textContent = `WGS84 · ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
    setStatus("Ignición registrada", "Revisar la posición y confirmar su fuente y hora antes de cualquier análisis.", "ready");
  }

  function stopPicking() {
    state.selectingIgnition = false;
    state.map.getContainer().style.cursor = "";
    const button = state.root?.querySelector('[data-action="pick"]');
    if (button) button.textContent = "📍 Seleccionar ignición en mapa";
  }

  function startPicking() {
    state.selectingIgnition = true;
    state.map.getContainer().style.cursor = "crosshair";
    const button = state.root?.querySelector('[data-action="pick"]');
    if (button) button.textContent = "Haz clic en el mapa…";
    setStatus("Selección activa", "Haz clic en el punto de ignición. Pulsa de nuevo para cancelar.");
  }

  function numberValue(id) {
    const raw = state.root.querySelector("#" + id).value.trim();
    return raw === "" ? null : Number(raw);
  }

  function onControlClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "toggle") {
      const body = state.root.querySelector(".iwf-body");
      body.hidden = !body.hidden;
      button.textContent = body.hidden ? "Mostrar" : "Ocultar";
      button.setAttribute("aria-expanded", String(!body.hidden));
    } else if (action === "pick") {
      if (state.selectingIgnition) stopPicking(); else startPicking();
    } else if (action === "clear") {
      stopPicking();
      state.ignition = null;
      state.incident = null;
      state.ignitionLayer.clearLayers();
      state.root.querySelector("#iwf-coords").textContent = "Punto de ignición no seleccionado";
      state.root.querySelector('[data-action="export"]').disabled = true;
      setStatus("Ficha limpia", "Selecciona una ignición para comenzar.");
    } else if (action === "create") {
      createIncident();
    } else if (action === "export") {
      exportGeoJSON();
    }
  }

  function createIncident() {
    const name = state.root.querySelector("#iwf-name").value.trim();
    if (!state.ignition) {
      setStatus("Falta la ignición", "Selecciona primero un punto en el mapa.");
      return;
    }
    if (!name) {
      setStatus("Falta el nombre", "Introduce un nombre identificable para el incidente.");
      return;
    }
    const wind = numberValue("iwf-wind");
    const gust = numberValue("iwf-gust");
    const direction = numberValue("iwf-direction");
    const temp = numberValue("iwf-temp");
    const rh = numberValue("iwf-rh");
    const fuel = state.root.querySelector("#iwf-fuel").value.trim();
    const missing = [];
    if (wind === null) missing.push("viento medio");
    if (direction === null) missing.push("dirección del viento");
    if (temp === null) missing.push("temperatura");
    if (rh === null) missing.push("humedad relativa");
    if (!fuel) missing.push("modelo de combustible");
    state.incident = {
      schemaVersion: "1.0.0",
      id: (crypto.randomUUID ? crypto.randomUUID() : "iwf-" + Date.now()),
      name,
      status: "planning",
      createdAt: isoNow(),
      coordinateReferenceSystem: "EPSG:4326",
      ignition: state.ignition,
      weatherObservation: {
        observedAt: null,
        source: null,
        quality: state.root.querySelector("#iwf-source").value,
        windSpeedKmh: wind,
        windGustKmh: gust,
        windDirectionFromDegrees: direction,
        temperatureC: temp,
        relativeHumidityPercent: rh
      },
      fuel: { model: fuel || null },
      scenario: { horizonMinutes: Number(state.root.querySelector("#iwf-horizon").value), status: "draft" },
      provenance: { capturedAt: isoNow(), application: "IrratiGIS Wildfire Intelligence", version: VERSION },
      modelExecution: { executed: false, reason: "No hay motor de propagación conectado." }
    };
    state.root.querySelector('[data-action="export"]').disabled = false;
    if (missing.length) {
      setStatus("Ficha creada · datos incompletos", "Pendiente: " + missing.join(", ") + ". No se puede ejecutar una simulación.", "warning");
    } else {
      setStatus("Ficha creada · lista para completar", "Falta incorporar hora/fuente de observaciones, perímetro validado, DEM y combustible cartografiado. No se ha ejecutado una simulación.", "ready");
    }
  }

  function exportGeoJSON() {
    if (!state.incident) return;
    const feature = {
      type: "Feature",
      geometry: state.incident.ignition,
      properties: {
        incident_id: state.incident.id,
        name: state.incident.name,
        feature_type: "ignition_point",
        status: "unverified",
        created_at: state.incident.createdAt,
        model_executed: false,
        application: "IrratiGIS Wildfire Intelligence",
        version: VERSION
      }
    };
    const blob = new Blob([JSON.stringify({ type: "FeatureCollection", features: [feature] }, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `irratigis-wildfire-${state.incident.id}.geojson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function onMapClick(event) {
    if (!state.selectingIgnition) return;
    setIgnition(event.latlng);
    stopPicking();
  }

  function init() {
    if (typeof L === "undefined" || !window.IrratiGISMap) return false;
    state.map = window.IrratiGISMap;
    state.ignitionLayer = L.featureGroup().addTo(state.map);
    buildControl();
    state.map.on("click", onMapClick);
    window.IrratiGISWildfire = {
      version: VERSION,
      getIncident: () => state.incident ? structuredClone(state.incident) : null,
      getIgnitionLayer: () => state.ignitionLayer,
      clear: () => state.root?.querySelector('[data-action="clear"]')?.click()
    };
    console.info(`IrratiGIS Wildfire Intelligence v${VERSION} initialized`);
    return true;
  }

  function boot(attempt = 0) {
    if (init()) return;
    if (attempt < 40) setTimeout(() => boot(attempt + 1), 250);
    else console.warn("Wildfire Intelligence: no se encontró el mapa IrratiGIS.");
  }

  injectStyles();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
  else boot();
})();