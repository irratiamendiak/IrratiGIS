# IrratiGIS Wildfire Intelligence

## Objetivo
Módulo integrado en IrratiGIS para preparar incidentes, registrar observaciones, organizar escenarios y, en fases posteriores, visualizar resultados de modelos científicos de comportamiento del fuego.

## Estado de esta entrega
**Fundación de producto (prototipo de interfaz y modelo de datos).** Esta entrega permite crear una ficha de incidente, seleccionar el punto de ignición sobre el mapa y exportar su geometría como GeoJSON. No calcula propagación ni recomienda tácticas.

## Arquitectura objetivo

- **Frontend GIS:** IrratiGIS + Leaflet. El módulo se carga como extensión independiente y reutiliza `window.IrratiGISMap`.
- **API de incidentes:** Cloudflare Worker / API versionada para autenticación, validación, persistencia y orquestación de trabajos.
- **Persistencia:** D1 para incidentes, observaciones, escenarios y auditoría; almacenamiento de objetos para rásteres y resultados pesados.
- **Análisis espacial:** servicio Python con GDAL, Rasterio, GeoPandas, Shapely y PyProj; PostGIS cuando se incorpore un backend espacial persistente.
- **Modelos de fuego:** adaptadores aislados para FlamMap/FARSITE y modelos complementarios. Cada adaptador documentará versión, parámetros, licencia, resolución, supuestos y limitaciones.
- **Intercambio GIS:** GeoJSON para vectores; GeoTIFF/COG para ráster; EPSG:25830 como CRS métrico de trabajo en Euskadi y reproyección explícita para otros territorios.
- **Observabilidad:** identificador de trabajo, sello temporal, fuente y antigüedad de cada dato, versión del modelo, logs y estado de validación.

## Módulos funcionales

1. Incidente y observaciones (ignición, perímetro, focos secundarios, hora y fuente).
2. Meteorología (viento medio/racha/dirección, temperatura, humedad relativa, precipitación y series temporales).
3. Combustibles (modelo, continuidad, carga, estructura y humedad del combustible vivo/muerto).
4. Terreno (DEM, pendiente, orientación, curvatura y barreras topográficas).
5. Comportamiento del fuego (ROS, longitud de llama, intensidad de línea, spotting cuando el modelo lo soporte).
6. Escenarios y sensibilidad (condiciones central y alternativas; incertidumbre explícita).
7. Exposición (población, edificios, infraestructuras, patrimonio y valores ambientales).
8. Análisis de oportunidades de control (elementos lineales y puntos de anclaje como candidatos a inspección, nunca como líneas aprobadas automáticamente).
9. Situación operativa, seguridad, comunicaciones, recursos e informes.

## Contrato de datos
Ver `data-contract.json`. Todo dato operacional debe incluir fuente, timestamp, unidad, CRS cuando aplique y calidad/estado. No mezclar observaciones con predicciones.

## Principios de seguridad y calidad
- Ninguna salida de este prototipo constituye una predicción validada ni una orden de extinción.
- No recomendar ataque directo/indirecto/paralelo de forma automática. El sistema podrá presentar información y criterios de evaluación, sujetos a procedimientos oficiales y decisión del mando.
- Zonas de seguridad, rutas de escape y exposición del personal requieren información operacional actualizada y validación humana.
- Mostrar incertidumbre, datos ausentes, antigüedad y procedencia.
- No extrapolar modelos fuera de su dominio validado sin advertencia.
- Validar los modelos con incendios históricos y revisión por especialistas antes de uso operacional.
- Fallo de API o modelo no debe impedir el uso del visor cartográfico existente.

## Fases
- **F0 (esta rama):** interfaz de incidente, selección de ignición, contrato de datos y exportación GeoJSON.
- **F1:** ingesta de meteorología y capas de combustible/terreno con trazabilidad.
- **F2:** adaptadores de modelos y ejecución asíncrona de escenarios.
- **F3:** exposición, puntos críticos y análisis territorial.
- **F4:** oportunidades de control, panel de situación, auditoría y validación operacional.

## Integración
El script `wildfire-intelligence.js` se carga con `defer` desde `index.html`. Se inicializa cuando el mapa Leaflet está disponible y registra un control independiente.
