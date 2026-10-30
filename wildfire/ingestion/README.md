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

## Resultado de la primera inspección B5M (30-10-2026)

Se recibió el archivo `GFA_DSET_MB_SHP.zip` y se inspeccionó localmente, sin alterar el original.

- SHA-256 del ZIP: `f69745502d30e63baf2c0a03267e5a1b682314aa00254b703cb8565cb795ee32`.
- Contenido: SHP, SHX, DBF, PRJ y README; CRS declarado y leído: EPSG:25830.
- 126 registros poligonales, 92 códigos territoriales: 88 municipios y 4 entidades territoriales especiales.
- Sin geometrías nulas, vacías o inválidas en el archivo recibido.
- Área plana de la unión: 1.981,254 km²; extensión EPSG:25830 registrada en el informe.
- El GeoPackage de salida conserva cuatro capas: `source_features`, `municipalities`, `special_territorial_units` y `pilot_boundary`. Se disuelven los fragmentos/enclaves por código municipal, sin perder la capa fuente original.
- Las cuatro entidades especiales se conservan separadas y se incluyen en el contorno general del piloto.

La geometría supera controles estructurales y una comprobación de plausibilidad de área; esto no constituye certificación jurídica ni contraste independiente con CNIG. Antes de recortar los modelos de elevación, el límite debe contrastarse con la fuente CNIG y revisar explícitamente enclaves y entidades especiales.


## MDT geoEuskadi 1 m: servicio y distribución verificados (30-10-2026)

La ficha oficial del **MDT LiDAR 2017 de 1 m** confirma que representa terreno desnudo y que su linaje no es un vuelo homogéneo de 2017: parte del MDT 2016, incorpora actualización estereoscópica en zonas urbanas con vuelo de 10 cm de 2017 y actualización LiDAR 2017 fuera de zonas urbanas, además de mejoras donde los datos LiDAR de 2008/2012 definían peor el relieve. Las alturas son ortométricas referidas a **EGM08_REDNAP**. Licencia CC BY 3.0; atribución: Eusko Jaurlaritza / Gobierno Vasco.

- Metadatos: https://www.geo.euskadi.eus/geonetwork/srv/spa/metadata.show?uuid=md_IDEEu_MDT_LIDAR_2017_es
- Servicio ArcGIS REST: https://www.geo.euskadi.eus/geoeuskadi/rest/services/U11/WCS_KARTOGRAFIA/MapServer
- Capa raster: `MDT_LIDAR_2017_1M` (ID 20), EPSG:25830.
- Directorio de descargas por hojas: https://www.geo.euskadi.eus/lidar/DatosDescarga/MDE/MAX_ACTUALIDAD/MDT_LIDAR_2017_ETRS89/MDT/

El tamaño de píxel de 1 m no equivale a una exactitud vertical de 1 m. La selección final de ZIPs debe basarse en la extensión real de cada ráster, no solo en el nombre de la hoja. Como muestra de descarga pequeña para inspeccionar el formato y los metadatos internos se ha identificado `H0110/mdt_110_6_5.zip` (2.360.209 bytes en el índice consultado). No se considera aún tesela confirmada para el mosaico hasta verificar su CRS, transformación afín, dimensiones, NoData y bbox.

El servicio declara una extensión general EPSG:25830 de X=461031..606516 e Y=4700735..4811755; sirve para comprobar cobertura global del servicio, no para afirmar cobertura completa del límite de Gipuzkoa. Antes del mosaico se construirá un índice de teselas a partir de los metadatos internos de cada archivo y se comprobarán huecos y solapes.


### Inspección de una tesela MDT antes de descargar el conjunto

Para probar el formato sin bajar un gran volumen, el índice oficial de geoEuskadi publica esta tesela de ejemplo (2.360.209 bytes en el listado):

https://www.geo.euskadi.eus/lidar/DatosDescarga/MDE/MAX_ACTUALIDAD/MDT_LIDAR_2017_ETRS89/MDT/H0110/mdt_110_6_5.zip

Tras descargarla, ejecutar:

    python wildfire/ingestion/inspect_raster_archive.py mdt_110_6_5.zip --output mdt_110_6_5_report.json

El inspector extrae en un directorio temporal con validación de rutas ZIP y reporta CRS, dimensiones, resolución, transformación, bbox, NoData, tipo de dato y bloques de los rásteres GeoTIFF o ESRI ASCII Grid (`.asc`). Conserva el texto del archivo `.prj` y reconoce la firma explícita ETRS89 / UTM zona 30 / GRS80 como EPSG:25830, dejando constancia de que esa autoridad se infiere del sidecar. No crea mosaicos ni afirma que la tesela cubra el piloto.

### Resultado de inspección de la muestra MDT (30-10-2026)

Se recibió y abrió localmente `mdt_110_6_5.zip`; el ZIP original no se ha incorporado al repositorio.

- SHA-256: `c92f60af55eeaf6eed617f30a83de8cab5e9ded8b4a169bb1a3c607766f87efc` (2.360.209 bytes).
- Contenido: `mdt_110_6_5.asc` (rejilla ESRI ASCII, 52.733.287 bytes descomprimidos) y `mdt_110_6_5.prj`.
- Rejilla: 3.520 columnas × 2.430 filas, celda de 1 m, una banda, float32, NoData = -9999.
- Extensión EPSG:25830, interpretada a partir del sidecar ETRS89 / UTM 30 / GRS80: X=474430..477950; Y=4749230..4751660.
- 987.806 celdas con datos y 7.565.794 celdas NoData (aprox. 88,5 % NoData). Elevaciones válidas observadas: 903,72..1.089,38 m.
- La tesela no intersecta el límite del piloto: queda al oeste, con una separación horizontal mínima aproximada de 54,4 km. Se descarta como tesela de cobertura para el mosaico de Gipuzkoa; se conserva únicamente como muestra de formato y prueba del inspector.

La inspección ha revelado que el formato real de esta distribución es ESRI ASCII Grid, no GeoTIFF. El inspector y sus pruebas se han ampliado para admitir ambos formatos y leer el sidecar `.prj`. La inferencia EPSG se limita a la combinación explícita de identificadores del archivo de proyección; no sustituye una validación geodésica independiente.


## Índice espacial oficial para seleccionar hojas MDT

Se ha localizado una fuente cartográfica oficial que puede resolver la selección espacial sin enumerar ni descargar a ciegas todos los ZIPs:

- Servicio ArcGIS REST de cartografía geoEuskadi: https://www.geo.euskadi.eus/geoeuskadi/rest/services/U11/KARTOGRAFIA_CAS/MapServer
- Capa **Hojas 5000**: ID 80 (polígonos de hojas cartográficas).
- Capa **Malla UTM 1×1 km**: ID 83 (cuadrículas UTM).
- El servicio publica también capas de hojas 10.000, 25.000 y 50.000 (IDs 79, 78 y 77).

La capa de hojas 5000 es la candidata inicial para investigar la correspondencia entre el identificador cartográfico y los nombres ZIP `mdt_NNN_i_j.zip`; no se da por hecho que ambos esquemas coincidan. La malla UTM 1×1 km puede servir como control espacial complementario, no como sustituto de las huellas reales de los rásteres.

Siguiente validación: consultar las geometrías que intersectan el límite del piloto, comparar sus códigos con el índice de directorios Hxxxx y descargar solo una pequeña muestra de ZIPs candidatos para verificar sus bbox internos. La selección final se hará por intersección de bbox/huella ráster real con Gipuzkoa, comprobando huecos y solapes. Fuente de licencia del servicio: CC BY 3.0; atribución Eusko Jaurlaritza / Gobierno Vasco.


### Descarga reproducible del índice oficial de hojas 1:5.000

La capa consultada se ha afinado al servicio ArcGIS REST de cartografía geoEuskadi, que expone `MC_HOJAS_5000` (ID 67) directamente en EPSG:25830. El catálogo REST confirma los campos `OBJECTID`, `CCFF`, `CFXMTN50`, `SC50CLAS` y `HOJA`, además de la geometría. La extensión declarada para la capa es X=461076,0977..603127,9435 e Y=4700742,3814..4811749,5984; contiene la extensión rectangular del límite B5M del piloto (X=532391,9707..603082,1649; Y=4749442,28..4805496,8647). Esto demuestra cobertura de la extensión, no que cada hoja concreta ni cada tesela MDT tenga cobertura útil. La capa distinta del servicio U11/KARTOGRAFIA_CAS (ID 80) usa EPSG:3857; se descarta para el cruce directo y el flujo utiliza la capa 67 de U11/WMS_KARTOGRAFIA.

Para obtener el índice candidato desde la geometría local preparada:

    python wildfire/ingestion/fetch_arcgis_sheet_index.py \
      --boundary data/processed/gipuzkoa/Gipuzkoa_limite_B5M.gpkg \
      --boundary-layer pilot_boundary \
      --output data/processed/gipuzkoa/mdt_5000_sheet_index.gpkg

El script consulta primero los OBJECTID por la extensión del piloto, descarga geometrías por lotes y realiza el cruce geométrico exacto localmente. Produce un GeoPackage y un informe JSON con los códigos y las áreas de intersección. El script necesita conexión a Internet cuando se ejecuta; CI solo compila y prueba su lógica con respuestas simuladas, no consulta servicios externos.

**Precaución:** una hoja cartográfica 1:5.000 no se presume equivalente a un ZIP MDT ni a una carpeta Hxxxx. Los códigos solo se utilizarán para orientar la búsqueda; la selección final de datos de elevación seguirá dependiendo de comprobar la extensión, CRS y resolución de cada ráster real.


### Índice de distribución LiDAR 2017: fuente complementaria, no índice MDT

La ficha oficial del vuelo LiDAR 2017 publica un SHP denominado "Distribución Hojas" en:

https://www.geo.euskadi.eus/lidar/DatosDescarga/LIDAR/LIDAR_2017_ETRS89/HOJAS_LAS_LIDAR_2017_ETRS89.zip

La ficha describe el vuelo LAS con hojas de 500 × 500 m, ETRS89 / UTM 30 y alturas ortométricas EGM08_REDNAP. Esta distribución documenta la disponibilidad de ficheros LAS del vuelo, no necesariamente la distribución de los archivos MDT ASCII de 1 m. Por ello no se utilizará como índice primario para seleccionar `mdt_NNN_i_j.zip`; solo podrá emplearse como control complementario si se demuestra la relación geométrica y de nomenclatura.

La ficha advierte además que hubo zonas con errores importantes que no se publicaron y que la ausencia de datos de descarga puede corresponder a esas zonas. Esto refuerza la necesidad de usar huellas reales y registrar huecos, en vez de asumir cobertura continua a partir de una malla teórica.

Fuente: ficha oficial "Vuelo LIDAR 2017 de la Comunidad Autónoma del País Vasco", Gobierno Vasco; atribución requerida: Eusko Jaurlaritza / Gobierno Vasco.
