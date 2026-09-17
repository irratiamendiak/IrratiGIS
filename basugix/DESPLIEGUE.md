# BASUGIX — despliegue

El backend es una aplicación FastAPI/Python. GitHub Pages sirve únicamente la interfaz estática; BASUGIX necesita un servicio que ejecute Python.

## Estado

- Interfaz IrratiGIS: GitHub Pages.
- Backend BASUGIX: pendiente de desplegar en un runtime Python.
- Dependencia local pendiente de incorporar: `fwi.py`, porque `app_basugix_v22_10_5_15_HISTORICO_MAS_RAPIDO_CORREGIDO.py` importa `calculate` y `danger_level` desde ese módulo.
- Datos persistentes: SQLite (`fire_risk_v2.db`).
- Producción con Euskalmet: requiere `EUSKALMET_PRIVATE_KEY_PATH` y las variables de entorno correspondientes.

## Variables principales

`DATA_PROVIDER`, `DATABASE_PATH`, `EUSKALMET_BASE_URL`, `EUSKALMET_PRIVATE_KEY_PATH`, `FWI_OBSERVATION_HOUR`, `FWI_INITIAL_FFMC`, `FWI_INITIAL_DMC`, `FWI_INITIAL_DC`, `GIPUZKOA_BOUNDARY_URL`.

No se deben guardar claves privadas ni secretos en el repositorio.
