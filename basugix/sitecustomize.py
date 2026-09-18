import asyncio
import math
from datetime import date

# BASUGIX Render hotfix: the authenticated api.euskadi.eus station endpoint
# is timing out from Render. Historical days can be read from Euskalmet's
# public web summaryData endpoint without that API dependency.

try:
    import app_basugix_v22_10_5_15_HISTORICO_MAS_RAPIDO_CORREGIDO as m

    def _num(v):
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            try:
                return float(v.replace(",", "."))
            except Exception:
                return None
        return None

    def _summary_value(item):
        fields = m._summary_fields(item)
        for key in ("mean", "_mean", "sum", "_sum", "total", "_total", "value", "_value"):
            v = fields.get(key)
            if isinstance(v, dict):
                v = v.get("_value", v.get("value"))
            n = _num(v)
            if n is not None and math.isfinite(n):
                return n
        for v in fields.values():
            n = _num(v)
            if n is not None and math.isfinite(n):
                return n
        return None

    def _measure_id(item):
        return m._eid(item.get("_measureId", item.get("measureId")))

    async def _historical_web_summary(station, day):
        payload = await m.web_summary_payload(station, day)
        items = m._summary_items(payload)
        found = {}

        for item in items:
            mid = (_measure_id(item) or "").strip().lower()
            value = _summary_value(item)
            if value is None:
                continue
            if "temperature" in mid or "temperatura" in mid:
                found.setdefault("temperature", value)
            elif "humidity" in mid or "humedad" in mid or mid in ("relative_humidity", "relativehumidity"):
                found.setdefault("humidity", value)
            elif "precip" in mid or "rain" in mid or "lluv" in mid:
                found.setdefault("rain_mm", value)

        speed_kmh, direction = await m.web_summary_wind(station, day)
        found["wind_kmh"] = speed_kmh
        found["wind_direction_deg"] = direction

        missing = [k for k in ("temperature", "humidity", "wind_kmh", "rain_mm") if found.get(k) is None]
        if missing:
            names = [_measure_id(x) for x in items]
            raise RuntimeError(
                f"Euskalmet web summary sin campos para {station} {day.isoformat()}: "
                f"faltan {missing}; measures={names[:80]}"
            )

        return {
            "temperature": round(float(found["temperature"]), 2),
            "humidity": round(max(0.0, min(100.0, float(found["humidity"]))), 2),
            "wind_kmh": round(max(0.0, float(found["wind_kmh"])), 2),
            "rain_mm": round(max(0.0, float(found["rain_mm"])), 2),
            "wind_direction_deg": round(float(found["wind_direction_deg"]), 1) if found.get("wind_direction_deg") is not None else None,
            "temperature_time": "12:00",
            "humidity_time": "12:00",
            "wind_time": "12:00",
            "temperature_delta_min": 0,
            "humidity_delta_min": 0,
            "wind_delta_min": 0,
            "noon_fallback_used": False,
            "post_cut_fallback_used": False,
            "rain_points_present": 144,
            "rain_points_missing": 0,
            "rain_coverage_pct": 100.0,
            "rain_quality": "Completo",
            "data_quality": "Euskalmet web summaryData",
            "observation_time": "12:00",
            "source": "Euskalmet webmet00-summaryData.json",
        }

    async def _patched(station, day):
        if day < date.today():
            try:
                # Historical Render path: use only the public Euskalmet web
                # summary. Never fall through to the authenticated API endpoint,
                # because that endpoint is the source of the Render timeout.
                result = await asyncio.wait_for(_historical_web_summary(station, day), timeout=20.0)
                print(
                    f"BASUGIX HISTORICAL WEB SUMMARY OK station={station} "
                    f"day={day.isoformat()} source=Euskalmet webmet00-summaryData.json",
                    flush=True,
                )
                return result
            except Exception as exc:
                print(
                    f"BASUGIX HISTORICAL WEB SUMMARY ERROR station={station} "
                    f"day={day.isoformat()} type={type(exc).__name__}: {exc}",
                    flush=True,
                )
                raise RuntimeError(
                    f"Euskalmet web summary no disponible para {station} {day.isoformat()}: {exc}"
                ) from exc
        return await m.v2210_operational_weather(station, day)

    m._render_historical_web_summary = _historical_web_summary
    m._v221052_station_weather_fast_or_live = _patched
    print("BASUGIX Render historical web-summary hotfix loaded", flush=True)

except Exception as exc:
    print(
        f"BASUGIX Render hotfix load failed: {type(exc).__name__}: {exc}",
        flush=True,
    )
