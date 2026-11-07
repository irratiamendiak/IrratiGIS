# Metodología de correspondencia de vegetación a modelos de combustible

Estado: **sin correspondencias aprobadas**. Este documento fija los criterios de admisión antes de crear filas en `fuel-crosswalk.template.csv`.

## 1. Fuente vegetal de partida

- Conjunto: Mapa Forestal del País Vasco 2024.
- Distribución espacial candidata: `INV_FORESTAL_2024_10000_ETRS89.zip`.
- Organismo y atribución: Eusko Jaurlaritza / Gobierno Vasco.
- Fecha de actualización del catálogo: 06-03-2025; fecha de fin de datos: 31-12-2024.
- Linaje publicado: fotointerpretación de ortofotografía aérea de 25 cm y metodología basada en IFN4, con colaboración de las diputaciones.
- Unidad mínima cartográfica declarada: tesela homogénea de 0,10 ha.

La tesela mínima de 0,10 ha no equivale a una resolución de píxel de 10 m. Rasterizar los polígonos a una malla de cálculo no crea información sobre la estructura fina del combustible.

Fuente oficial: https://www.euskadi.eus/mapa-forestal-del-pais-vasco/web01-a3ogaoce/es/

## 2. Qué puede y qué no puede inferirse

El inventario aporta información de usos del suelo y especies/formaciones forestales. Es una base para estratificar y localizar tipos de vegetación, pero no caracteriza por sí solo todas las variables físicas que necesita un modelo de combustible de superficie.

No se autoriza inferir únicamente a partir de la especie:
- carga de combustible muerto por clases de tamaño;
- carga de combustible vivo herbáceo y leñoso;
- profundidad del lecho de combustible;
- proporción de material fino y compacto;
- humedad del combustible;
- continuidad horizontal o vertical;
- altura de base de copa ni densidad aparente de copa.

El informe oficial del Mapa Forestal 2024 indica que los cálculos de biomasa, existencias maderables y alturas del arbolado se completarían con productos de vuelos LiDAR/fotogramétricos de 2024 y mediciones Basonet. Por tanto, esos atributos no se deben dar por presentes en el SHP forestal solo por existir el inventario.

## 3. Esquema de destino

FBFM40 (Scott y Burgan) se mantiene como **esquema candidato para evaluar**, no como clasificación ya adoptada para Euskadi. Sus modelos representan distribuciones de carga de combustible por componentes vivos/muertos, clases de tamaño y tipos de combustible (hierba, matorral, arbolado y restos).

Referencia técnica: https://landfire.gov/fuel/fbfm40

No copiar códigos FBFM40 de mapas LANDFIRE de Estados Unidos a polígonos vascos por similitud visual o por nombre de especie. Los modelos deben seleccionarse por estructura y parámetros medidos/documentados, y validarse en el ámbito ecológico local.

## 4. Requisitos para aprobar una fila del crosswalk

Cada correspondencia deberá incluir en `fuel-crosswalk.template.csv`:

1. Identificador inequívoco de la versión de origen, nombre real del campo y código/valor exacto del polígono.
2. Etiqueta de clase obtenida del diccionario oficial o de la tabla de atributos, no traducida a mano.
3. Esquema y código de combustible de destino, con referencia técnica explícita.
4. Evidencia que justifique la correspondencia (inventario de campo, parcelas Basonet, LiDAR validado, bibliografía local o inspección de combustible).
5. Validación local independiente y responsable/revisor.
6. Confianza y estado de revisión. Una clase sin evidencia suficiente debe quedar sin código de destino y marcada como pendiente/rechazada, nunca recibir un modelo por defecto.

## 5. Reglas para clases no modelables con la evidencia disponible

- Agua, urbano, roca, suelo desnudo, agricultura y superficies artificiales: no asignar FBFM40 automáticamente. Definir su tratamiento de superficie/no combustible mediante reglas explícitas y validación.
- Bosques arbolados: la especie dominante puede ayudar a formar estratos de muestreo, pero no determina por sí sola el modelo de combustible superficial.
- Matorral, pastizal y vegetación de transición: requieren comprobar composición, altura, cobertura, carga y continuidad.
- Clases desconocidas, mixtas o sin diccionario: mantener como `unmapped`/pendiente hasta resolver su semántica.

## 6. Próximo hito de datos

Antes de poblar el crosswalk hay que obtener y conservar el ZIP SHP original y su metadato, inspeccionar el DBF completo (nombres, tipos, dominios, nulos y frecuencias) y recuperar el diccionario oficial de los campos jerárquicos de uso y especie. Después se debe resumir Gipuzkoa por clase y preparar una matriz de estratos para validación local.

Hasta completar ese hito, el crosswalk permanece vacío deliberadamente. No es un fallo del proceso: evita convertir una clasificación de vegetación en parámetros físicos de fuego sin evidencia.
