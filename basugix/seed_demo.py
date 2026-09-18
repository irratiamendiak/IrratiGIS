import asyncio
import os
import subprocess
import sys

# Load Render historical Euskalmet web-summary hotfix before importing the app.
try:
    import sitecustomize  # noqa: F401
except Exception as exc:
    print(f'BASUGIX hotfix import warning: {type(exc).__name__}: {exc}', flush=True)
from datetime import date, timedelta, datetime
import sqlite3
import csv
from pathlib import Path
from zoneinfo import ZoneInfo

from app_basugix_v22_10_5_15_HISTORICO_MAS_RAPIDO_CORREGIDO import (
    BASE_DIR, DB_PATH, PROVIDER, V22_WRITE_ENABLED, init_db, FIXED_STATION_IDS, FIXED_STATIONS,
    demo_weather, update_day, calculate, danger_level,
    ire_gip_season, ire_gip_wind_factor, wind_cardinal, v22_local_level,
)

MADRID = ZoneInfo('Europe/Madrid')


def operational_day():
    now = datetime.now(MADRID)
    return now.date() if now.hour >= 12 else now.date() - timedelta(days=1)


def seed_demo():
    """Initialize the DB without injecting synthetic data in real mode."""
    init_db()
    if PROVIDER != 'demo':
        print(f'BASUGIX demo seed skipped (provider={PROVIDER})')
        return

    today = date.today()
    start = today - timedelta(days=30)

    generated = []
    for sid in FIXED_STATION_IDS:
        ffmc, dmc, dc = 85.0, 6.0, 15.0
        for i in range(31):
            day = start + timedelta(days=i)
            temp, rh, wind, rain = demo_weather(sid, day)
            direction = float((hash(f'wind-{sid}-{day.isoformat()}') % 36000) / 100.0)
            res = calculate(temp, rh, wind, rain, month=day.month,
                            prev_ffmc=ffmc, prev_dmc=dmc, prev_dc=dc)
            season_name, sf = ire_gip_season(day)
            wf = ire_gip_wind_factor(direction, wind)
            ire = min(100.0, max(0.0, float(res.fwi) * wf * sf))
            generated.append((sid, day, temp, rh, wind, rain, direction,
                              res, season_name, sf, wf, ire))
            ffmc, dmc, dc = res.ffmc, res.dmc, res.dc

    with sqlite3.connect(str(DB_PATH), timeout=60.0) as c:
        for sid in FIXED_STATION_IDS:
            c.execute(
                "INSERT OR IGNORE INTO stations(station_id,name,municipality,province,updated_at) VALUES(?,?,?,?,?)",
                (sid, FIXED_STATIONS.get(sid, sid), 'Gipuzkoa', 'Gipuzkoa', datetime.now().isoformat(timespec='seconds')),
            )
        for sid, day, temp, rh, wind, rain, direction, res, season_name, sf, wf, ire in generated:
            now = datetime.now().isoformat(timespec='seconds')
            ds = day.isoformat()
            c.execute("""
                INSERT OR REPLACE INTO weather_daily(
                    station_id,day,temperature,humidity,wind_kmh,rain_mm,source,created_at,
                    observation_time,rain_points_present,rain_points_missing,rain_coverage_pct,
                    rain_quality,data_quality,temperature_time,humidity_time,wind_time,
                    temperature_delta_min,humidity_delta_min,wind_delta_min,noon_fallback_used,
                    meteo_source_station,station_fallback_used,station_fallback_distance_km
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (sid,ds,temp,rh,wind,rain,'BASUGIX demo',now,'12:00',144,0,100.0,
                  'complete','demo','12:00','12:00','12:00',0,0,0,0,sid,0,0.0))
            c.execute("""
                INSERT OR REPLACE INTO fwi_daily(
                    station_id,day,ffmc,dmc,dc,isi,bui,fwi,danger_level,ire_gip,ire_gip_level,
                    wind_direction_deg,wind_factor,season_factor,created_at,wind_direction_cardinal,
                    season_name,data_quality,rain_quality,rain_points_present,rain_points_missing,
                    rain_coverage_pct,noon_fallback_used,temperature_time,humidity_time,wind_time
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (sid,ds,res.ffmc,res.dmc,res.dc,res.isi,res.bui,res.fwi,danger_level(res.fwi),
                  round(ire,2),danger_level(ire),round(direction,1),round(wf,4),round(sf,4),now,
                  wind_cardinal(direction),season_name,'demo','complete',144,0,100.0,0,'12:00','12:00','12:00'))
        c.commit()


HISTORICAL_CSV = Path(os.getenv(
    'HISTORICAL_CSV_PATH',
    str(BASE_DIR / 'data' / 'Euskalmet_2010_2025_5estaciones_FWI_V22_MEDIODIA.csv')
))


def seed_historical_csv():
    """Importa el histórico V22 de mediodía, preservando su semántica."""
    if not HISTORICAL_CSV.exists():
        print(f'BASUGIX historical CSV not found: {HISTORICAL_CSV}', flush=True)
        return 0
    now = datetime.now().isoformat(timespec='seconds')
    rows = 0
    batch = []
    with HISTORICAL_CSV.open('r', encoding='utf-8-sig', newline='') as fh:
        reader = csv.DictReader(fh, delimiter=';')
        required = {'fecha','station_id','temperatura_12h_C','hora_temperatura','humedad_12h_pct','hora_humedad','viento_12h_kmh','hora_viento','lluvia_24h_mm','direccion_vectorial_diaria_deg','FFMC','DMC','DC','ISI','BUI','FWI'}
        missing = sorted(required - set(reader.fieldnames or []))
        if missing:
            raise RuntimeError(f'CSV histórico sin columnas requeridas: {missing}')
        with sqlite3.connect(str(DB_PATH), timeout=60.0) as c:
            for row in reader:
                sid = str(row['station_id']).strip().upper()
                if sid not in FIXED_STATION_IDS: continue
                ds = str(row['fecha']).strip()
                temp=float(row['temperatura_12h_C']); rh=float(row['humedad_12h_pct']); wind=float(row['viento_12h_kmh']); rain=float(row['lluvia_24h_mm'])
                try:
                    direction=float(str(row['direccion_vectorial_diaria_deg'] or '').strip())
                except (TypeError, ValueError):
                    direction=None
                ffmc=float(row['FFMC']); dmc=float(row['DMC']); dc=float(row['DC']); isi=float(row['ISI']); bui=float(row['BUI']); fwi=float(row['FWI'])
                season_name,sf=ire_gip_season(date.fromisoformat(ds)); wf=ire_gip_wind_factor(direction,wind); ire=min(100.0,max(0.0,fwi*wf*sf))
                tt=str(row['hora_temperatura']).strip() or '12:00'; ht=str(row['hora_humedad']).strip() or '12:00'; wt=str(row['hora_viento']).strip() or '12:00'
                # T/RH/viento: observación de mediodía. Lluvia: acumulado de 24 h cerrado a las 12:00.
                w=(sid,ds,temp,rh,wind,rain,'Euskalmet histórico V22 mediodía',now,'12:00',None,None,100.0,'complete','real',tt,ht,wt,None,None,None,0,sid,0,0.0)
                f=(sid,ds,ffmc,dmc,dc,isi,bui,fwi,v22_local_level(sid,fwi),round(ire,2),v22_local_level(sid,ire),direction,round(wf,4),round(sf,4),now,(wind_cardinal(direction) if direction is not None else 'N/D'),season_name,'real','complete',None,None,100.0,0,tt,ht,wt)
                batch.append((w,f))
                if len(batch)>=500:
                    for x,y in batch:
                        c.execute("INSERT OR REPLACE INTO weather_daily(station_id,day,temperature,humidity,wind_kmh,rain_mm,source,created_at,observation_time,rain_points_present,rain_points_missing,rain_coverage_pct,rain_quality,data_quality,temperature_time,humidity_time,wind_time,temperature_delta_min,humidity_delta_min,wind_delta_min,noon_fallback_used,meteo_source_station,station_fallback_used,station_fallback_distance_km) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",x)
                        c.execute("INSERT OR REPLACE INTO fwi_daily(station_id,day,ffmc,dmc,dc,isi,bui,fwi,danger_level,ire_gip,ire_gip_level,wind_direction_deg,wind_factor,season_factor,created_at,wind_direction_cardinal,season_name,data_quality,rain_quality,rain_points_present,rain_points_missing,rain_coverage_pct,noon_fallback_used,temperature_time,humidity_time,wind_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",y)
                    rows+=len(batch); batch=[]
            for x,y in batch:
                c.execute("INSERT OR REPLACE INTO weather_daily(station_id,day,temperature,humidity,wind_kmh,rain_mm,source,created_at,observation_time,rain_points_present,rain_points_missing,rain_coverage_pct,rain_quality,data_quality,temperature_time,humidity_time,wind_time,temperature_delta_min,humidity_delta_min,wind_delta_min,noon_fallback_used,meteo_source_station,station_fallback_used,station_fallback_distance_km) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",x)
                c.execute("INSERT OR REPLACE INTO fwi_daily(station_id,day,ffmc,dmc,dc,isi,bui,fwi,danger_level,ire_gip,ire_gip_level,wind_direction_deg,wind_factor,season_factor,created_at,wind_direction_cardinal,season_name,data_quality,rain_quality,rain_points_present,rain_points_missing,rain_coverage_pct,noon_fallback_used,temperature_time,humidity_time,wind_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",y)
            rows+=len(batch)
            for sid,name in FIXED_STATIONS.items():
                c.execute("INSERT OR IGNORE INTO stations(station_id,name,municipality,province,updated_at) VALUES(?,?,?,?,?)",(sid,name,'Gipuzkoa','Gipuzkoa',now))
            c.commit()
    print(f'BASUGIX historical CSV imported rows={rows} source={HISTORICAL_CSV} rain=24h_accumulated_until_12:00',flush=True)
    return rows


def historical_row_ready(sid, day):
    """Reuse a stored real historical day and avoid a redundant upstream download."""
    ds = day.isoformat()
    try:
        with sqlite3.connect(str(DB_PATH), timeout=10.0) as c:
            w = c.execute(
                """SELECT source, temperature, humidity, wind_kmh, rain_mm,
                          rain_coverage_pct
                   FROM weather_daily WHERE station_id=? AND day=?""",
                (sid, ds)
            ).fetchone()
            f = c.execute(
                """SELECT fwi, ire_gip FROM fwi_daily
                   WHERE station_id=? AND day=?""",
                (sid, ds)
            ).fetchone()
        if not w or not f:
            return False
        source = str(w[0] or '').lower()
        if 'demo' in source or 'open-meteo' in source:
            return False
        if any(v is None for v in w[1:5]):
            return False
        try:
            coverage_ok = w[5] is None or float(w[5]) >= 90.0
        except Exception:
            coverage_ok = False
        return coverage_ok and f[0] is not None and f[1] is not None
    except Exception:
        return False


def bootstrap_real():
    """Populate only the currently published operational day."""
    init_db()
    if PROVIDER != 'euskalmet':
        return
    if not V22_WRITE_ENABLED:
        print('BASUGIX real bootstrap skipped (V22_WRITE_ENABLED=0)', flush=True)
        return

    async def run():
        day = operational_day()
        print(f'BASUGIX real bootstrap operational day={day.isoformat()} TZ=Europe/Madrid', flush=True)
        async def update_station(sid):
            if day < date.today() and historical_row_ready(sid, day):
                print(
                    f'BASUGIX real bootstrap {sid} {day.isoformat()} '
                    'REUSE stored historical real data',
                    flush=True,
                )
                return

            print(f'BASUGIX real bootstrap {sid} {day.isoformat()} START', flush=True)
            try:
                result = await asyncio.wait_for(update_day(sid, day), timeout=420)
                print(f'BASUGIX real bootstrap {sid} {day.isoformat()} OK fwi={result.get("fwi")} ire={result.get("ire_gip")}', flush=True)
            except Exception as exc:
                print(f'BASUGIX real bootstrap {sid} {day.isoformat()} ERROR {type(exc).__name__}: {exc}', flush=True)

        await asyncio.gather(*(update_station(sid) for sid in FIXED_STATION_IDS))

    asyncio.run(run())


if __name__ == '__main__':
    init_db()
    if PROVIDER == 'demo':
        seed_demo()
    elif V22_WRITE_ENABLED:
        seed_historical_csv()
        subprocess.Popen(
            [sys.executable, '-c', 'from seed_demo import bootstrap_real; bootstrap_real()'],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            start_new_session=True,
            env={**os.environ, 'PYTHONUNBUFFERED': '1'},
        )
        print('BASUGIX real bootstrap launched in background', flush=True)
    print('BASUGIX startup data ready', flush=True)
