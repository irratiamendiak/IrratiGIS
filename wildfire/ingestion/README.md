# Ingesta de datos oficiales · piloto Gipuzkoa

Esta carpeta define un registro auditable de fuentes y el punto de partida de la ingesta. No descarga ni publica datos automáticamente: primero se revisan metadatos, cobertura, licencia, CRS, fecha y calidad.

## Hallazgo de catálogo (30-10-2026)

- El catálogo del Gobierno Vasco ya presenta el Mapa Forestal CAE 2025, con tablas estadísticas por territorio y comarca, incluida Gipuzkoa. La página consultada no demuestra por sí sola que esté disponible una distribución vectorial espacial 2025; por eso el catálogo mantiene como distribución espacial candidata el SHP 2024, sin etiquetarlo como 2025.
- El dataset geoEuskadi de elevaciones de 1 m expone distribuciones de máxima actualidad e históricas. Sus metadatos describen una base original 2008 y actualizaciones/cambios posteriores; antes de usarlo hay que inspeccionar los metadatos de cada mosaico y el linaje de las zonas de cambio.
- El CNIG publicó en mayo de 2026 un MDT provisional de 50 cm de tercera cobertura LiDAR para País Vasco, generado desde una clasificación inicial de nube de puntos. Es candidato a evaluación, no sustituto automático del MDT regional: se debe comparar artefactos, completitud y precisión vertical.

## Flujo previsto

1. Obtener el límite administrativo oficial de Gipuzkoa y guardarlo como vector fuente con licencia y checksum. No dibujar el límite a mano.
2. Resolver y descargar teselas de MDT mediante el catálogo/servicio oficial. Conservar originales inmutables y registrar URL, fecha, tamaño y SHA-256.
3. Obtener la distribución espacial forestal más reciente disponible. Mientras la distribución 2025 no esté confirmada, usar 2024 solo como fuente provisional, registrando esa fecha real.
4. Recortar por el límite del piloto con una zona de guarda suficiente para evitar artefactos de borde en derivados topográficos.
5. Generar inventario de atributos y estadísticas por clase antes de rasterizar.
6. Construir el crosswalk de vegetación a modelos de combustible únicamente tras revisión experta y evidencia local. La plantilla fuel-crosswalk.template.csv no contiene asignaciones operativas.
7. Producir rásteres de 10 m solo como rejilla de trabajo. Mantener la resolución/escala efectiva de cada fuente en los metadatos y en la capa de confianza.

## Validación local

    python wildfire/ingestion/validate_catalog.py --catalog wildfire/ingestion/sources.euskadi-gipuzkoa.json
    python -m pytest -q wildfire/ingestion/tests

El validador comprueba estructura y trazabilidad mínima; no valida la exactitud temática ni la aptitud para simulación.

## Fuentes oficiales

- [Modelo Digital de Elevaciones 1 m geoEuskadi](https://www.geo.euskadi.eus/modelo-digital-elevaciones-1-metro-del-pais-vasco/webgeo00-dataset/es/)
- [Mapa Forestal CAE 2025](https://www.euskadi.eus/mapa-forestal-cae-2025/web01-a3estbin/es/)
- [Ficha de descarga Mapa Forestal CAE](https://www.euskadi.eus/mapa-forestal-del-pais-vasco/web01-a3estbin/es/)
- [Servicio oficial de descargas geoEuskadi](https://www.euskadi.eus/gobierno-vasco/-/servicios-de-descarga/)
- [Novedades CNIG MDT50 cm, 3ª cobertura LiDAR](https://centrodedescargas.cnig.es/CentroDescargas/novedades?codSerie=MDT01)

## Límites

No se ha descargado ni procesado aquí ningún mosaico real. No hay todavía un paisaje Gipuzkoa, un modelo de combustible validado ni una salida FlamMap/FARSITE. Los datos provisionales deben permanecer etiquetados como tales.

## Descarga reproducible de fuentes

El límite de Territorios Históricos está publicado en el directorio oficial de geoEuskadi como SHP ZIP. El catálogo declara ETRS89 / UTM 30N y licencia con atribución, pero advierte que algunas líneas pueden ser provisionales y que la capa no reúne los requisitos de cartografía oficial. Se usa solo como límite técnico de recorte del piloto, pendiente de revisión.

Descarga y extracción segura (no se ejecuta durante CI):

    python wildfire/ingestion/download_source.py \
      --catalog wildfire/ingestion/sources.euskadi-gipuzkoa.json \
      --source-id euskadi_historical_territories_boundary \
      --output data/raw

El comando conserva el ZIP original, calcula SHA-256, extrae de forma segura (rechaza rutas ZIP que escapen del destino y enlaces simbólicos) y escribe `download_manifest.json`. No filtra automáticamente el polígono de Gipuzkoa porque primero hay que inspeccionar los campos, CRS y geometrías reales. El MDT50cm CNIG se seleccionará por hojas que intersecten el área, sin descarga masiva indiscriminada.

## Límite del piloto: fuente preferida de Gipuzkoa

La capa preferida pasa a ser **Límites municipales oficiales de Gipuzkoa**, publicada por la Diputación Foral de Gipuzkoa en B5M y actualizada el 26-10-2026. Se descarga como SHP ZIP (2,56 MB) y contiene atributos de municipio y comarca. La licencia del portal es CC BY 4.0, con atribución y enlace a B5M. La propia Diputación advierte que la información es informativa y debe contrastarse con las fuentes administrativas correspondientes.

    pip install -r wildfire/ingestion/requirements.txt
    python wildfire/ingestion/prepare_gipuzkoa_boundary.py

El proceso conserva el ZIP original y su SHA-256, comprueba que el CRS esté declarado, conserva los polígonos municipales, repara geometrías inválidas cuando sea posible, reproyecta a EPSG:25830 y genera una capa disuelta del piloto. El informe registra el área, extensión, número de municipios y avisos de plausibilidad. No corrige límites ni elimina enclaves automáticamente.

## MDT 1 m: descarga por teselas

El catálogo oficial ofrece un directorio de teselas individuales bajo:

https://www.geo.euskadi.eus/lidar/DatosDescarga/MDE/MAX_ACTUALIDAD/MDT_LIDAR_2017_ETRS89/MDT/

No se debe descargar el archivo multipartito regional de 1 m (15 partes, aproximadamente 15 GB) para este piloto. Se necesita identificar las hojas/teselas que intersectan el límite preparado y descargar solo esos ZIP individuales. La selección de teselas queda pendiente de ejecutar tras obtener y revisar el polígono real.


## Contraste del límite administrativo con CNIG

Se registra además el producto **Límites y Unidades Administrativas Actuales** del CNIG, con fecha de julio/agosto de 2026 y licencia compatible con CC-BY 4.0. La distribución nacional SHP indicada por el catálogo ocupa 156,96 MB; se mantiene como referencia de contraste y no se descarga automáticamente hasta resolver el enlace directo y verificar cómo filtrar la provincia sin procesar innecesariamente toda España.

- Ficha CNIG: https://centrodedescargas.cnig.es/CentroDescargas/detalleArchivo?sec=9000029
- Catálogo de producto: https://centrodedescargas.cnig.es/CentroDescargas/catalogo.do?Serie=LILIM

La capa geoEuskadi de Territorios Históricos sigue siendo una fuente de trabajo regional útil, pero sus advertencias de límites provisionales impiden tratarla como delimitación jurídica definitiva. La geometría del piloto debe contrastarse con CNIG antes de recortar los MDT.
