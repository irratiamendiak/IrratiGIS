# Publicación de la cobertura forestal de Gipuzkoa

El MBTiles ya generado se publica como tiles vectoriales XYZ en Supabase Storage.
No se sube el MBTiles completo: se extraen los 1.011 tiles y se corrige la
orientación TMS → XYZ para que Leaflet los solicite correctamente.

## 1. Crear el bucket

En Supabase → Storage, crea un bucket público llamado `forestal-gipuzkoa`.
No guardes la clave service-role en el repositorio ni en el frontend.

## 2. Subir desde tu equipo

Necesitas Python 3.8+ y el archivo local `forestal_gipuzkoa.mbtiles`.

PowerShell:
```powershell
$env:SUPABASE_URL="https://TU_PROYECTO.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="TU_SERVICE_ROLE_KEY"
python publish_forest_tiles.py .\forestal_gipuzkoa.mbtiles forestal-gipuzkoa
```

El script reemplaza objetos existentes y muestra el progreso. Si falla por
tamaño/límite de subida, el mensaje indica el tile concreto; no vuelvas a
convertir ni recortar el GeoPackage.

## 3. URL de tiles

```
https://TU_PROYECTO.supabase.co/storage/v1/object/public/forestal-gipuzkoa/{z}/{x}/{y}.pbf
```

Capa y zoom del MBTiles: `forestal_gipuzkoa_2024`, zoom 7–14. La capa contiene
atributos forestales del origen. La integración en Leaflet debe usar un
plugin MVT (por ejemplo Leaflet.VectorGrid) y revisar el nombre de la capa
interna antes de asignar estilo/identificar atributos.

## Seguridad

El bucket público permite descargar las teselas sin autenticar. La service-role
key solo se usa localmente para la carga y debe permanecer secreta. Este
procedimiento publica únicamente los tiles; no modifica el mapa ni despliega
Deno Deploy.
