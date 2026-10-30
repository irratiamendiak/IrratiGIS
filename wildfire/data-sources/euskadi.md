# Euskadi · inventario inicial de fuentes geoespaciales

Este inventario identifica fuentes oficiales candidatas. La disponibilidad de una capa en un catálogo no implica que sus atributos basten para parametrizar un modelo de comportamiento del fuego.

## 1. Terreno

### MDT LiDAR 1 m · Gobierno Vasco / geoEuskadi
- Catálogo: https://www.geo.euskadi.eus/geonetwork/srv/spa/main.home
- Ficha del MDT 2017: https://www.euskadi.eus/modelo-digital-del-terreno-mdt-1m-comunidad-autonoma-del-pais-vasco-ano-2017/aa30-12375/es/
- Distribuciones descritas: mosaico TIFF 1 m, 5 m y 25 m; ASC; servicio WCS.
- Uso propuesto: DEM primario para pendiente, orientación y derivados topográficos, sujeto a comprobación de cobertura, fecha, datum vertical, CRS y artefactos.
- Precaución: el dato identificado corresponde a 2017; comprobar si existe una edición posterior y si los cambios de terreno/infraestructura requieren actualización.

## 2. Combustibles y estructura forestal

### Mapa Forestal del País Vasco 2024
- Ficha oficial: https://www.euskadi.eus/mapa-forestal-del-pais-vasco/web01-a2nekabe/es/
- Descarga SHP publicada: https://www.geo.euskadi.eus/cartografia/DatosDescarga/Agricultura/INV_FORESTAL_2024_10000_ETRS89.zip
- Servicio WMS: https://www.geo.euskadi.eus/WMS_NEKAZARITZA
- Uso propuesto: cobertura forestal, especie/estructura y clasificación de vegetación como base de la traducción a modelos de combustible.
- Precaución crítica: no es directamente un mapa de modelos de combustible de comportamiento. La ficha describe teselas mínimas de 0,10 ha; rasterizar a 10 m no añade detalle de combustible. Se necesita tabla de correspondencia documentada y validación de campo/teledetección por tipo forestal y tratamiento.

### Hábitats y Vegetación
- Catálogo: https://opendata.euskadi.eus/catalogo/-/geograficos/habitats-vegetacion-actual-y-usos-del-suelo/
- Uso propuesto: fuente complementaria para contrastar formaciones, hábitats y vegetación no forestal.
- Precaución: no sustituye mediciones de carga, continuidad vertical/horizontal, humedad ni parámetros de combustible.

### Mapa Forestal de España (MFE50) · MITECO
- Descargas: https://www.miteco.gob.es/es/biodiversidad/servicios/banco-datos-naturaleza/informacion-disponible/mfe50_descargas_ccaa.html
- Uso propuesto: respaldo de clasificación y expansión a escala nacional, no reemplazo automático de cartografía regional de mayor detalle.

## 3. Reglas para convertir fuentes en capas de simulación

1. Conservar los originales y sus metadatos; no sobrescribir ni reproyectar la única copia.
2. Registrar fecha de referencia, escala/resolución nativa, licencia, CRS horizontal/vertical, unidad y método de descarga.
3. Separar cobertura/vegetación observada de modelo de combustible inferido.
4. Mantener una tabla versionada de correspondencia entre clases forestales y modelos de combustible (p. ej. Anderson 13 o Scott-Burgan 40), con justificación y nivel de confianza por clase.
5. No asignar un modelo de combustible por defecto a suelo urbano, agua, roca, agricultura o clases desconocidas sin regla explícita y validada.
6. Atributos de copa (altura, base de copa y densidad aparente) necesitan fuentes específicas; no inferirlos solo de la especie forestal.
7. Publicar un mapa de confianza/cobertura de datos junto con cada paisaje.
8. El producto de 10 m es una rejilla común para el cálculo. Si la fuente de combustible tiene escala efectiva más gruesa, etiquetar esa limitación en el manifiesto y en el visor.

## 4. Estado

| Tema | Fuente candidata | Estado |
|---|---|---|
| Elevación | MDT LiDAR 1 m (2017) | Identificada; falta descarga y QA de mosaicos |
| Combustible de superficie | Mapa Forestal 2024 + hábitats | Identificadas; falta traducción y validación |
| Cubierta de copas | Mapa forestal / fuente LiDAR específica | Pendiente de definir variable y método |
| Altura de copa | LiDAR / inventario forestal | Pendiente de identificar producto apropiado |
| Altura base de copa | Inventario/estimación calibrada | Pendiente; no inferir sin evidencia |
| Densidad aparente de copa | Inventario/estimación calibrada | Pendiente; no inferir sin evidencia |
| Humedad de combustible | Observación y método operacional | Pendiente de integrar |
| Meteorología | Euskalmet / AEMET y estaciones | Pendiente de contrato temporal y validación |

**No generar todavía un paisaje nacional ni un paisaje operacional completo** hasta resolver los atributos de combustible, humedad, cubierta/copa y la validación de las reglas de correspondencia.


## 5. Actualización de catálogo · piloto Gipuzkoa (30-10-2026)

- **Mapa Forestal CAE 2025:** ya existe ficha oficial y tablas estadísticas territoriales/comarcales, incluida Gipuzkoa. La página consultada no confirma por sí sola una distribución espacial descargable 2025. Se mantiene el SHP 2024 como candidato espacial provisional, sin atribuirle fecha 2025.
- **MDT geoEuskadi 1 m:** el catálogo ofrece distribuciones históricas y de máxima actualidad. Los metadatos describen una base de 2008 con actualizaciones de cambios posteriores. Es necesario revisar el linaje por tesela y el datum vertical.
- **CNIG MDT50cm provisional V1 (tercera cobertura LiDAR):** publicación identificada en mayo de 2026 para País Vasco. Se incorpora como candidato independiente para comparación de calidad, no como sustituto automático: la versión es provisional y procede de clasificación inicial de nube de puntos.
- Se crea un catálogo reproducible en `wildfire/ingestion/sources.euskadi-gipuzkoa.json`, una plantilla vacía de correspondencia de combustibles y un validador de metadatos.

Fuentes:
- https://www.euskadi.eus/mapa-forestal-cae-2025/web01-a3estbin/es/
- https://www.geo.euskadi.eus/modelo-digital-elevaciones-1-metro-del-pais-vasco/webgeo00-dataset/es/
- https://centrodedescargas.cnig.es/CentroDescargas/novedades?codSerie=MDT01

**Estado:** catálogo y scaffolding incorporados; todavía no se han descargado ni procesado los datos geoespaciales reales de Gipuzkoa.


## 6. Límite territorial del piloto Gipuzkoa

Se ha incorporado como candidato técnico el SHP de **Territorios Históricos** de geoEuskadi:
https://www.geo.euskadi.eus/cartografia/DatosDescarga/Limites/TERRITORIOS_5000_ETRS89.zip

El catálogo indica ETRS89 / UTM huso 30 y atribución obligatoria al Gobierno Vasco. También advierte que el conjunto no cumple los requisitos para considerarse cartografía oficial y que algunas líneas pueden ser provisionales o estar en disputa. Por tanto, se utilizará solo para delimitar el área de trabajo tras inspección geométrica y de metadatos, no como delimitación jurídica definitiva.

Se ha añadido un descargador que conserva el ZIP original, calcula SHA-256, genera manifiesto de procedencia y extrae archivos ZIP con controles contra path traversal y enlaces simbólicos. La descarga real y la selección de la geometría de Gipuzkoa quedan pendientes de ejecución y revisión.

## 7. Fuente de límite del piloto actualizada

Para el piloto se prefiere ahora la capa **Límites municipales oficiales de Gipuzkoa** de la Diputación Foral de Gipuzkoa (B5M), actualizada el 26-10-2026, en lugar de la capa regional de Territorios Históricos de geoEuskadi. Permite conservar los polígonos y atributos municipales y disolverlos para el área de estudio. Licencia CC BY 4.0 con atribución a B5M. El portal advierte que la información es informativa y debe contrastarse con las fuentes administrativas oficiales.

- Ficha: https://b5m.gipuzkoa.eus/web5000/es/conjuntos-datos/limites-municipales
- SHP ZIP: https://b5m.gipuzkoa.eus/datasets/GFA_DSET_MB_SHP.zip
- GPKG: https://b5m.gipuzkoa.eus/datasets/GFA_DSET_MB.gpkg

Se incorpora `prepare_gipuzkoa_boundary.py` para descargar, verificar CRS, revisar/reparar geometrías inválidas, mantener municipios y generar el polígono disuelto EPSG:25830 con informe de calidad. La ejecución real sigue pendiente porque el entorno de esta sesión no ha podido transferir el binario del portal.
