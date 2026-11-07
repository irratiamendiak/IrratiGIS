# Diseño inicial: simulación de propagación de incendios

Estado: definición técnica inicial; todavía no es un modelo operativo ni calcula perímetros.

## Objetivo del primer hito

Dado un punto de ignición, una hora de inicio y un escenario de combustible, terreno y meteorología, producir una secuencia temporal de perímetros simulados y métricas explicables. El primer alcance es el comportamiento y la propagación después de la ignición; no la probabilidad de que se inicie un incendio.

## Lo que ya existe en IrratiGIS

- El visor principal es una aplicación estática basada en Leaflet y MapLibre.
- El inventario forestal 2024 de Gipuzkoa se consume como PMTiles vectorial, capa `forestal_gipuzkoa_2024`. En el tooltip se consultan `TIPES_es`, `TIPES`, `tipo`, `TYPE` y las especies `SP1_es`, `SP2_es`, `SP3_es`.
- El visor ya consulta Open-Meteo para viento horario a 10 m: dirección, velocidad y rachas. Esa función pertenece al módulo de análisis Campbell y no constituye por sí sola un modelo de viento para incendios.
- Se referencia un mosaico Terrarium de elevación para análisis visual de pendiente/orientación. No se ha verificado que exista un MDT local descargable y homogéneo para alimentar una simulación.
- `basugix/fwi.py` calcula FFMC, DMC, DC, ISI, BUI y FWI. Son índices de peligro meteorológico; no calculan el avance del frente de llama.
- BASUGIX es un backend FastAPI separado del visor estático. `auth.js` llama además a una API Deno distinta. No se debe acoplar el motor a una de estas APIs sin decidir antes su despliegue y ciclo de vida.

## Arquitectura propuesta

1. **Adaptadores de datos**: lectura del inventario forestal, MDT y meteorología. Mantenerlos separados del núcleo físico.
2. **Normalización de combustible**: traducir los atributos del inventario a modelos de combustible documentados. La traducción debe ser explícita, versionada y permitir el valor «desconocido»; no inferir un modelo sólo a partir del nombre de una especie.
3. **Terreno**: trabajar en una malla proyectada métrica (ETRS89 / UTM 30N, EPSG:25830), con resolución fijada según la fuente real del MDT. Derivar pendiente y orientación; registrar resolución, fecha y nodata.
4. **Meteorología**: permitir datos automáticos y edición manual. Guardar hora, fuente, altura de medida, unidades y calidad. El viento de Open-Meteo a 10 m es una condición de contorno, no viento local corregido por el relieve.
5. **Núcleo de propagación**: implementar y verificar un modelo de propagación superficial basado en Rothermel, con propagación direccional y efecto de pendiente/viento. Mantener el modelo desacoplado de Leaflet y de los proveedores meteorológicos.
6. **API de simulación**: ejecutar trabajos fuera del hilo de la interfaz, validar entradas y devolver resultados con versión del motor y parámetros usados.
7. **Visor**: representar perímetros por instante, tiempo de llegada y metadatos; permitir comparar escenarios y exportar GeoJSON.

## Contrato mínimo de una simulación

- Ignición: latitud/longitud, instante con zona horaria y tamaño inicial documentado.
- Combustible: modelo de combustible superficial, carga por clases, profundidad del lecho, humedad de combustibles muertos/vivos cuando esté disponible y procedencia de cada valor.
- Terreno: elevación, pendiente y orientación, con resolución y sistema de referencia.
- Meteorología: temperatura, humedad relativa, precipitación antecedente, velocidad y dirección del viento, hora y altura de referencia.
- Control: duración, paso temporal, tamaño de celda y límites espaciales.
- Resultados: perímetros temporales, velocidad de propagación, intensidad de línea y tiempo de llegada, con unidades y metadatos.

## Criterios de aceptación antes de conectarlo al visor

- Pruebas unitarias de conversión de unidades, orientación del viento, pendiente y límites numéricos.
- Casos de referencia publicados para verificar la implementación física, no sólo pruebas de que el código ejecuta.
- Comprobación de que el fuego no se propaga sobre celdas sin combustible o nodata, salvo que exista una regla explícita.
- Reproducibilidad: misma entrada y versión del motor producen el mismo resultado.
- Advertencia visible: herramienta experimental para análisis y escenarios, no predicción operativa ni sustituto de servicios de emergencia.

## Decisiones pendientes que bloquean una simulación físicamente defendible

- Tabla de correspondencia revisada entre atributos del inventario forestal y modelos de combustible.
- Fuente y resolución del MDT para el área de simulación.
- Tratamiento de combustibles vivos/muertos y su humedad.
- Validación del viento local y de su interacción con el relieve.
- Casos reales o experimentales de referencia para calibración y evaluación.

## Principio de integración

No modificar `index.html`, `auth.js`, `gis-tools.js` ni el flujo actual de BASUGIX hasta que el núcleo y sus pruebas estén definidos. El desarrollo se mantiene en una rama independiente y los cambios de interfaz se harán como una fase posterior y pequeña.
