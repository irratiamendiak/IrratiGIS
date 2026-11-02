# Publicar las teselas forestales

1. Ubica el MBTiles del inventario forestal 2024.
2. Ejecuta: `python scripts/export_forest_tiles.py forestal_gipuzkoa.mbtiles --out forest-tiles`
3. Publica la carpeta `forest-tiles/` en el mismo origen de GitHub Pages que `index.html`.

El script convierte la fila TMS de MBTiles a XYZ. No subas el MBTiles original al repositorio; comprueba tamaño y límites antes de publicar la carpeta exportada. La capa solo solicita teselas al marcar su casilla.

El renderer espera la capa interna `forestal_gipuzkoa_2024`; si el nombre real difiere, actualiza `vectorTileLayerStyles` en `index.html`.
