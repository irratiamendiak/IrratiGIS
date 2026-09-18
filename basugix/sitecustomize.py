import asyncio
import math
from datetime import date, datetime
from zoneinfo import ZoneInfo

# BASUGIX Render hotfix:
# 1) meteorología real de D0 con T/HR/viento a las 12:00 + lluvia 24 h;
# 2) desde las 12:00, "Último" DEBE ser hoy, nunca una fecha histórica;
# 3) si Euskalmet falla, se devuelve error explícito, nunca se maquilla con 2025.

try:
    import app_basugix_v22_10_5_15_HISTORICO_MAS_RAPIDO_CORREGIDO as m
    from fastapi.routing import APIRoute

    _original_station_weather_fast_or_live = m._v221052_station_weather_fast_or_live

    async def _patched_station_weather(station, day):
        # Histórico: ZIP/API Euskalmet con observaciones cercanas a 12:00.
        # D0: ruta operativa exacta 12:00 + lluvia 24 h observada.
        try:
            if day < date.today():
                result = await asyncio.wait_for(
                    _original_station_weather_fast_or_live(station, day),
                    timeout=75.0,
                )
            else:
                result = await asyncio.wait_for(
                    m.v2210_operational_weather(station, day),
                    timeout=75.0,
                )
            print(
                f"BASUGIX V22.10 NOON OK station={station} day={day.isoformat()} "
                f"T={result.get('temperature_time')} HR={result.get('humidity_time')} "
                f"wind={result.get('wind_time')} rain={result.get('rain_mm')} "
                f"points={result.get('rain_points_present')}",
                flush=True,
            )
            return result
        except Exception as exc:
            print(
                f"BASUGIX V22.10 NOON ERROR station={station} day={day.isoformat()} "
                f"type={type(exc).__name__}: {exc}",
                flush=True,
            )
            raise

    m._v221052_station_weather_fast_or_live = _patched_station_weather

    async def _latest_exact():
        now = datetime.now(ZoneInfo("Europe/Madrid"))
        today = now.date()
        desired = today if now.hour >= 12 else today.replace() 
        if now.hour < 12:
            from datetime import timedelta
            desired = today - timedelta(days=1)

        # Si ya existe exactamente el día operativo, servirlo.
        payload = m._v221052_main_day_from_db(desired)
        if payload is not None:
            payload = dict(payload)
            payload["mode"] = "sqlite_exact_operational_day"
            payload["requested_day"] = desired.isoformat()
            payload["live_fallback"] = False
            return payload

        # Asegurar continuidad FWI cuando sea un día reciente.
        try:
            await m._v221052_ensure_previous_operational_day(desired)
        except Exception as exc:
            print(f"BASUGIX previous-day preparation warning: {type(exc).__name__}: {exc}", flush=True)

        try:
            live = await asyncio.wait_for(
                m.api_v22103_live(desired.isoformat(), force=1, _skip_prev_sync=True),
                timeout=float(__import__("os").getenv("EUSKALMET_OPERATIONAL_LATEST_TIMEOUT", "90")),
            )
        except Exception as exc:
            return {
                "ok": False,
                "error": f"No se pudo obtener el día operativo {desired.isoformat()} de Euskalmet: {type(exc).__name__}: {exc}",
                "requested_day": desired.isoformat(),
                "selected_day": None,
                "writes_to_database": False,
            }

        # CRÍTICO: api_v22103_live tiene compatibilidad histórica que puede devolver
        # un día antiguo si todas las estaciones fallan. Para D0 eso está prohibido.
        selected = str(live.get("selected_day") or "")
        if selected != desired.isoformat():
            return {
                "ok": False,
                "error": (
                    f"Euskalmet no devolvió datos utilizables para {desired.isoformat()}. "
                    f"Se rechazó correctamente el fallback a {selected or 'sin fecha'}."
                ),
                "requested_day": desired.isoformat(),
                "selected_day": selected or None,
                "writes_to_database": False,
            }
        live = dict(live)
        live["requested_day"] = desired.isoformat()
        live["live_fallback"] = False
        live["mode"] = "euskalmet_exact_operational_day"
        return live

    async def _debug_latest_exact(on_or_before=None):
        try:
            lim = date.fromisoformat(on_or_before) if on_or_before else datetime.now(ZoneInfo("Europe/Madrid")).date()
        except Exception:
            return {"ok": False, "error": "Fecha no válida. Usa YYYY-MM-DD."}

        payload = m._v221052_main_day_from_db(lim)
        if payload is not None:
            return payload

        try:
            live = await asyncio.wait_for(
                m.api_v22103_live(lim.isoformat(), force=1, _skip_prev_sync=True),
                timeout=90.0,
            )
        except Exception as exc:
            return {"ok": False, "error": f"No hay datos para {lim.isoformat()}: {type(exc).__name__}: {exc}"}

        if str(live.get("selected_day") or "") != lim.isoformat():
            return {
                "ok": False,
                "error": f"No hay datos utilizables para {lim.isoformat()}; se rechazó cualquier fallback a otra fecha.",
                "requested_day": lim.isoformat(),
                "selected_day": live.get("selected_day"),
            }
        return live

    def _insert_get_route(path, endpoint, name):
        # El módulo principal ya registró estas rutas. Insertamos una ruta idéntica
        # delante para que FastAPI use esta política estricta de fecha.
        route = APIRoute(
            path=path,
            endpoint=endpoint,
            methods=["GET"],
            name=name,
        )
        m.app.router.routes.insert(0, route)

    _insert_get_route("/api/v221052/latest-fast", _latest_exact, "basugix_latest_exact_operational")
    _insert_get_route("/debug/v221052/main-day-latest", _debug_latest_exact, "basugix_debug_latest_exact")

    print(
        "BASUGIX Render hotfix loaded: D0 after 12:00 = TODAY; stale-date fallback disabled",
        flush=True,
    )

except Exception as exc:
    print(
        f"BASUGIX Render hotfix load failed: {type(exc).__name__}: {exc}",
        flush=True,
    )
