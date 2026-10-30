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
