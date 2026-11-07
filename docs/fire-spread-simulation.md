# Suteen Bilakaera: integración del Inventario Forestal 2024

Estado: integración de lectura local en desarrollo. La simulación existente se conserva; esta fase conecta su consulta de cubierta con la capa forestal que ya utiliza IrratiGIS.

## Componentes existentes reutilizados

- La capa PMTiles `forestal_gipuzkoa_2024`, servida desde el objeto `inventarioForestalLayer` en `index.html`.
- La simulación interactiva de Suteen Bilakaera que ya vive en `index.html`: ignición, meteorología Open-Meteo o manual, terreno Terrarium, humedad estimada, escenarios y perímetros.
- El conjunto de combustibles configurables `FS_FUELS` y las funciones `fsMoist`, `fsBehavior`, `fsR`, `fsSimulate`.
- El análisis auxiliar de Campbell y los datos históricos EGIF ya presentes en la aplicación.

## Cambio incorporado en esta rama

`fsCoverFromInventory(ll)` consulta, cuando la capa del Inventario Forestal 2024 está activada, las entidades renderizadas de `forestal-poligonos` en la coordenada consultada. Recupera los atributos disponibles (priorizando `TIPES_es`, `TIPES`, `tipo`, `TYPE`, `SP1_es`, `SP2_es`, `SP3_es`) y los entrega al panel de cubierta de Suteen Bilakaera.

- La consulta es de solo lectura: no cambia la capa, sus atributos ni sus geometrías.
- Si el inventario local está apagado o no devuelve una entidad, se conserva el WMS forestal anterior como alternativa.
- La sugerencia de combustible queda expresamente marcada como orientativa y no validada por la estructura del lecho.

## Correspondencias prudentes añadidas

La clasificación del inventario se realiza por campos, no concatenando todos los atributos en una cadena:

- `TIPES_es` / `TIPES` identifica el uso: `Herbazal` y `Prado` se sugieren como `belarra`; `Matorral` como `garoa`.
- `SP1_es`, `SP2_es` y `SP3_es` se usan para distinguir grupos de especies: coníferas identificadas (p. ej. `Pinus`/pino, `Picea`, `Larix`, `Cryptomeria`, `Pseudotsuga`, `Sequoia`) pueden sugerir `pinudia`; frondosas identificadas (p. ej. `Fagus`/haya, `Quercus`/roble, `Castanea`, `Betula`/abedul) pueden sugerir `hostozabala`.
- Si varias entidades consultadas discrepan, o el uso forestal depende de especie y ésta falta, o la clase es mixta/genérica, no se devuelve sugerencia automática.
- Eucalyptus queda sin asignación automática: no se fuerza dentro de los parámetros de pinar o de frondosa genérica.
- El WMS alternativo mantiene una heurística textual separada, más limitada; no se mezcla con la clasificación estructurada del PMTiles.

Estas son **sugerencias de grupo de cubierta**, no equivalencias demostradas con modelos físicos de combustible. La fuente oficial publica usos como bosque, bosque de plantación, herbazal, matorral, pastizal-matorral y prado, además de especies y estados de masa. La tabla de superficies y especies de Gipuzkoa está en el [informe oficial del Mapa Forestal 2024](https://www.euskadi.eus/contenidos/informacion/mapa_forestal_2024/es_agripes/adjuntos/GIPUZKOA2024.pdf). La cartografía de uso/especie no describe por sí sola el combustible fino superficial.

## Límite físico importante

El código actual describe su aproximación como «Rothermel simplificado» o «Rothermel-like». No debe presentarse como una implementación completa y validada del modelo original de Rothermel. La propagación usa parámetros empíricos propios en `FS_FUELS`, factores simplificados de viento y pendiente, una elipse de propagación y estimaciones de intensidad de Byram/longitud de llama.

La clasificación de vegetación del inventario no contiene por sí sola todas las variables físicas necesarias para parametrizar un modelo de combustible: cargas por clases de tamaño, proporción vivo/muerto, profundidad del lecho, continuidad y humedad real. Por tanto, no se autoriza convertir automáticamente una especie o un tipo forestal en un modelo físico definitivo.

## Siguiente paso técnico

1. Inspeccionar valores y dominios reales de los atributos del PMTiles, no sólo los nombres de campo.
2. Preparar una tabla de correspondencias versionada entre clases del inventario y los cinco combustibles actualmente admitidos por `FS_FUELS`.
3. Para cada correspondencia, registrar evidencia, confianza, revisión y clases sin asignación.
4. Mantener selección manual cuando no exista equivalencia validada.
5. Probar consulta local en puntos y a lo largo del recorrido, con la capa activada y desactivada.
6. Separar en una fase posterior el motor físico del HTML y contrastarlo con casos de referencia antes de llamarlo Rothermel validado.

## Criterios de aceptación

- La consulta del inventario no modifica ni reemplaza la fuente PMTiles.
- La ausencia de entidad, fallo de MapLibre o capa desactivada no bloquea la simulación existente.
- La interfaz identifica si la información procede del inventario local o del WMS alternativo.
- Ninguna clase sin correspondencia revisada se convierte silenciosamente en combustible.
- La salida se mantiene como análisis orientativo, no como predicción operativa ni recomendación táctica.