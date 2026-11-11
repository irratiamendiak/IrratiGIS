/* IrratiGIS · modelo de datos del módulo operativo
 * Primera fase: esquema común y validaciones. Sin persistencia ni envío de datos.
 * Coordenadas GeoJSON: [longitud, latitud], WGS84 (EPSG:4326).
 */
(function (root) {
  "use strict";

  const VERSION = "1.0.0";

  const TYPES = Object.freeze([
    "sector",
    "critical_point",
    "protected_asset",
    "access",
    "water_point",
    "anchor_point",
    "control_line",
    "escape_route",
    "safety_zone",
    "resource"
  ]);

  const PRIORITIES = Object.freeze(["low", "medium", "high", "critical"]);
  const STATUSES = Object.freeze([
    "proposed", "identified", "confirmed", "active",
    "completed", "unavailable", "cancelled"
  ]);

  const OACEL_KEYS = Object.freeze([
    "observation", "attention", "communication", "escape", "safety_place"
  ]);

  const now = () => new Date().toISOString();
  const makeId = () => {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return root.crypto.randomUUID();
    }
    return "op-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 10);
  };

  function cleanText(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength || 2000) : "";
  }

  function validPosition(position) {
    return Array.isArray(position) &&
      position.length >= 2 &&
      Number.isFinite(Number(position[0])) &&
      Number.isFinite(Number(position[1])) &&
      Number(position[0]) >= -180 && Number(position[0]) <= 180 &&
      Number(position[1]) >= -90 && Number(position[1]) <= 90;
  }

  function validateGeometry(geometry) {
    if (!geometry || typeof geometry !== "object") return "Falta la geometría.";
    if (geometry.type === "Point") {
      return validPosition(geometry.coordinates) ? null : "Coordenadas de punto no válidas.";
    }
    if (geometry.type === "LineString") {
      return Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 &&
        geometry.coordinates.every(validPosition) ? null : "La línea necesita al menos dos posiciones válidas.";
    }
    if (geometry.type === "Polygon") {
      const rings = geometry.coordinates;
      if (!Array.isArray(rings) || !rings.length) return "El polígono no tiene anillos.";
      const valid = rings.every(ring =>
        Array.isArray(ring) && ring.length >= 4 &&
        ring.every(validPosition) &&
        JSON.stringify(ring[0]) === JSON.stringify(ring[ring.length - 1])
      );
      return valid ? null : "El polígono debe tener anillos cerrados y coordenadas válidas.";
    }
    return "Geometría no admitida: usa Point, LineString o Polygon.";
  }

  function createRecord(input) {
    const data = input || {};
    const record = {
      id: cleanText(data.id, 100) || makeId(),
      type: TYPES.includes(data.type) ? data.type : "critical_point",
      title: cleanText(data.title, 160) || "Elemento sin título",
      description: cleanText(data.description, 2000),
      geometry: data.geometry || null,
      priority: PRIORITIES.includes(data.priority) ? data.priority : "medium",
      status: STATUSES.includes(data.status) ? data.status : "proposed",
      sectorId: cleanText(data.sectorId, 100) || null,
      owner: cleanText(data.owner, 160),
      source: cleanText(data.source, 300),
      observedAt: data.observedAt || now(),
      updatedAt: now(),
      observations: Array.isArray(data.observations)
        ? data.observations.slice(-100).map(item => ({
            at: item && item.at || now(),
            author: cleanText(item && item.author, 160),
            text: cleanText(item && item.text, 2000)
          }))
        : [],
      properties: data.properties && typeof data.properties === "object"
        ? data.properties : {}
    };
    return record;
  }

  function validateRecord(record) {
    const errors = [];
    if (!record || typeof record !== "object") return ["El registro no es válido."];
    if (!TYPES.includes(record.type)) errors.push("Tipo de elemento no admitido.");
    if (!cleanText(record.title, 160)) errors.push("El título es obligatorio.");
    const geometryError = validateGeometry(record.geometry);
    if (geometryError) errors.push(geometryError);
    if (!PRIORITIES.includes(record.priority)) errors.push("Prioridad no válida.");
    if (!STATUSES.includes(record.status)) errors.push("Estado no válido.");
    return errors;
  }

  function createOacel(input) {
    const data = input || {};
    const result = {
      id: cleanText(data.id, 100) || makeId(),
      sectorId: cleanText(data.sectorId, 100) || null,
      unitId: cleanText(data.unitId, 100) || null,
      updatedAt: now(),
      reviewedBy: cleanText(data.reviewedBy, 160),
      items: {}
    };
    OACEL_KEYS.forEach(key => {
      const item = data.items && data.items[key] || {};
      result.items[key] = {
        detail: cleanText(item.detail, 1000),
        confirmed: item.confirmed === true,
        confirmedAt: item.confirmed === true ? (item.confirmedAt || now()) : null,
        confirmedBy: item.confirmed === true ? cleanText(item.confirmedBy, 160) : ""
      };
    });
    return result;
  }

  function assessOacel(oacel) {
    const missing = [];
    OACEL_KEYS.forEach(key => {
      const item = oacel && oacel.items && oacel.items[key];
      if (!item || item.confirmed !== true || !cleanText(item.detail, 1000)) {
        missing.push(key);
      }
    });
    return {
      complete: missing.length === 0,
      missing,
      // Completitud documental no equivale a garantía de seguridad en el terreno.
      message: missing.length
        ? "OACEL incompleto o sin confirmar. Verificar sobre el terreno."
        : "Elementos OACEL registrados. Requiere reevaluación continua."
    };
  }

  const api = Object.freeze({
    version: VERSION,
    types: TYPES,
    priorities: PRIORITIES,
    statuses: STATUSES,
    oacelKeys: OACEL_KEYS,
    createRecord,
    validateRecord,
    validateGeometry,
    createOacel,
    assessOacel
  });

  root.IrratiGISOperationsModel = api;
})(typeof window !== "undefined" ? window : globalThis);
