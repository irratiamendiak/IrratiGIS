# BASUGIX

Módulo independiente de BASUGIX integrado en el repositorio IrratiGIS.

## Estado

- Rama de integración: `basugix-integracion`
- Versión funcional de referencia: BASUGIX V22.10.5.15 (histórico acelerado), basada en la V22.10.5.12 estable.
- No se modifica la aplicación principal de IrratiGIS en esta fase.

## Arquitectura prevista

BASUGIX conserva su aplicación FastAPI, plantillas, motor FWI, SQLite y conectores meteorológicos dentro de este directorio. La interfaz de IrratiGIS podrá enlazar a BASUGIX sin mezclar su lógica con el visor GIS principal.

## Seguridad

No subir nunca a GitHub:

- `.env`
- claves privadas de Euskalmet
- `fingerPrint.txt` / `fingerprint.txt`
- bases de datos con información que no deba publicarse
- tokens o credenciales

## Próximo paso

Incorporar el conjunto completo de archivos de la versión funcional: aplicación Python, `fwi.py`, plantillas, configuración de dependencias y recursos necesarios para el despliegue.
