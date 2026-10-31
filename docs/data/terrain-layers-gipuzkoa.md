# Cartografía del terreno · IrratiGIS

## Capas oficiales disponibles en el visor

Las capas siguientes proceden del servicio ArcGIS REST de geoEuskadi:

- Servicio: [U11/KARTOGRAFIA_CAS/MapServer](https://www.geo.euskadi.eus/geoeuskadi/rest/services/U11/KARTOGRAFIA_CAS/MapServer)
- Catálogo de capas: [All Layers and Tables](https://www.geo.euskadi.eus/geoeuskadi/rest/services/U11/KARTOGRAFIA_CAS/MapServer/layers)
- Organismo: Eusko Jaurlaritza / Gobierno Vasco · geoEuskadi.

| ID | Capa | Resolución publicada | Uso previsto |
|---:|---|---:|---|
| 5 | Fondo hipsométrico (LiDAR) | No indicada en la ficha del servicio consultada | Contexto visual de elevación |
| 6 | Orientaciones (LiDAR) | 25 m | Dirección de ladera |
| 7 | Pendientes (LiDAR) | 25 m | Inclinación del terreno |
| 8 | Sombras (LiDAR) | 1 m | Relieve sombreado |

Las capas 6, 7 y 8 tienen fichas de conjunto de datos enlazadas desde los metadatos del servicio. La capa de sombras se deriva del MDT 1 m × 1 m del año 2017. Pendiente y orientación son productos derivados de 25 m × 25 m del año 2017.

## Interpretación y límites

- La resolución indicada es la resolución nominal del producto, no una garantía de exactitud posicional o vertical.
- El fondo hipsométrico es una representación temática; no sustituye a un MDT numérico continuo para cálculos.
- Las capas de pendiente y orientación de 25 m no deben remuestrearse y presentarse como análisis de 1 m.
- La capa de sombras sirve para interpretación visual; no es un raster de elevaciones.
- Los productos publicados por geoEuskadi cubren el ámbito indicado por sus fichas. La cobertura efectiva, los NoData y la continuidad en el área de estudio deben comprobarse antes de usarlos en cálculos.
- El mosaico local de tres hojas MDT es una prueba parcial independiente. No representa la cobertura completa de Gipuzkoa.

## Uso en análisis de incendios

Para un futuro análisis reproducible, IrratiGIS debe separar:
1. **Visualización:** hipsometría y sombras.
2. **Variables derivadas:** pendiente y orientación, manteniendo su resolución de 25 m.
3. **Datos numéricos:** MDT original y derivados recalculados desde elevaciones verificadas, con control de CRS, NoData, continuidad y procedencia.

Ninguna de estas capas, por sí sola, constituye una predicción de propagación ni una instrucción operativa.
