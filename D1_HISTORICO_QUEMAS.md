# Histórico de quemas con Cloudflare D1

El Worker ya incluye:

- tabla `burn_observations` para conservar las quemas por día;
- tabla `burn_daily_runs` para registrar cuántas quemas se encontraron cada día;
- guardado automático al consultar `/api/active`;
- guardado automático diario mediante Cron Trigger (`0 6 * * *`, UTC);
- endpoint autenticado `GET /api/history?date=YYYY-MM-DD`;
- consulta por intervalo `GET /api/history?from=YYYY-MM-DD&to=YYYY-MM-DD`.

## Crear la D1

Desde Cloudflare/Wrangler:

```bash
npx wrangler d1 create irratigis-quemas-historico --binding DB
```

Ese comando devuelve el `database_id`. Cloudflare requiere ese ID para declarar la binding D1 del Worker.

Añadir en `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "irratigis-quemas-historico",
    "database_id": "EL_ID_REAL_DE_D1"
  }
]
```

## Aplicar la tabla

```bash
npx wrangler d1 migrations apply irratigis-quemas-historico --remote
```

La migración está en `migrations/0001_burn_history.sql`.

## Endpoint histórico

Con un Bearer token válido:

```text
GET /api/history?date=2026-09-02
GET /api/history?from=2026-09-01&to=2026-09-30
```

La respuesta contiene `days` con el recuento diario y `fires` con las quemas observadas, incluidas sus coordenadas y el JSON completo guardado en `data`.
