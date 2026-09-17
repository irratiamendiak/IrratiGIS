from datetime import date, timedelta, datetime
import math

from app_basugix_v22_10_5_15_HISTORICO_MAS_RAPIDO_CORREGIDO import (
    con, init_db, FIXED_STATION_IDS, FIXED_STATIONS,
    demo_weather, calculate, danger_level,
    ire_gip_season, ire_gip_wind_factor, wind_cardinal,
)


def seed():
    init_db()
    today = date.today()
    start = today - timedelta(days=30)
    with con() as c:
        for sid in FIXED_STATION_IDS:
            c.execute(
                "INSERT OR IGNORE INTO stations(station_id,name,municipality,province,updated_at) VALUES(?,?,?,?,?)",
                (sid, FIXED_STATIONS.get(sid, sid), 'Gipuzkoa', 'Gipuzkoa', datetime.now().isoformat(timespec='seconds')),
            )
        for sid in FIXED_STATION_IDS:
            ffmc, dmc, dc = 85.0, 6.0, 15.0
            for i in range(31):
                day = start + timedelta(days=i)
                temp, rh, wind, rain = demo_weather(sid, day)
                # Stable deterministic direction for the demo dataset.
                direction = float((hash(f'wind-{sid}-{day.isoformat()}') % 36000) / 100.0)
                res = calculate(temp, rh, wind, rain, month=day.month,
                                 prev_ffmc=ffmc, prev_dmc=dmc, prev_dc=dc)
                season_name, sf = ire_gip_season(day)
                wf = ire_gip_wind_factor(direction, wind)
                ire = min(100.0, max(0.0, float(res.fwi) * wf * sf))
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
                ffmc, dmc, dc = res.ffmc, res.dmc, res.dc
        c.commit()


if __name__ == '__main__':
    seed()
    print('BASUGIX demo history ready')
