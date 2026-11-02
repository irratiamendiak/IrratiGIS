# Cubierta forestal 2024 — publicación

La capa se ha añadido como overlay opcional a IrratiGIS, en el grupo de capas de Leaflet.

## Teselas necesarias

El HTML solicita teselas vectoriales PBF con esta ruta relativa:

`forest-tiles/{z}/{x}/{y}.pbf`

El inventario MBTiles original usa esquema TMS y zooms 7–14. Antes de publicar la carpeta, extrae las teselas y convierte la coordenada Y a XYZ para cada zoom:

`y_xyz = (2 ** z) - 1 - y_tms`

Debe quedar una estructura como `forest-tiles/7/x/y.pbf`.

## Nota importante

El inventario original es vectorial. La capa está lista para solicitar teselas PBF, pero Leaflet base no dibuja PBF por sí solo. Para visualizar el contenido es necesario incorporar un renderer vectorial compatible (por ejemplo, Leaflet.VectorGrid) y configurar el nombre de la capa interna del MBTiles. No se activa hasta que el visor dispone de esas teselas y renderer.

GitHub Pages workflow publica el contenido de la raíz del repositorio, por lo que la carpeta `forest-tiles/` puede servirse como contenido estático.
