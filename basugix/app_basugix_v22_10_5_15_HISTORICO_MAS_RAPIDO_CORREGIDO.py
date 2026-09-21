import asyncio, io, json, math, os, random, re, sqlite3, time, traceback, zipfile, hashlib
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import xml.etree.ElementTree as ET
import httpx, jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape
import uvicorn
from fwi import calculate, danger_level

BASE_DIR=Path(__file__).parent
load_dotenv(BASE_DIR/'.env', override=True)
DB_PATH=os.getenv('DATABASE_PATH',str(BASE_DIR/'fire_risk_v2.db'))
PROVIDER=os.getenv('DATA_PROVIDER','demo').lower().strip(); BASE_URL=os.getenv('EUSKALMET_BASE_URL','https://api.euskadi.eus').rstrip('/')
OBS_HOUR=int(os.getenv('FWI_OBSERVATION_HOUR','12'))
INITIAL=(float(os.getenv('FWI_INITIAL_FFMC','85')),float(os.getenv('FWI_INITIAL_DMC','6')),float(os.getenv('FWI_INITIAL_DC','15')))
TARGETS={
    'temperature': ('measuresForAir', ('temperature','mean_temperature','air_temperature')),
    'humidity': ('measuresForAir', ('humidity','relative_humidity','relativehumidity')),
    'wind_kmh': ('measuresForWind', ('mean_speed','average_speed','wind_speed')),
    'rain_mm': ('measuresForWater', ('precipitation','rain','rainfall')),
}


FIXED_STATIONS={
    'C023':'Arrasate',
    'C017':'Miramon',
    'C058':'Bidania',
    'C026':'Berastegi',
    'C028':'Zegama',
}
FIXED_STATION_IDS=list(FIXED_STATIONS.keys())

# V22.10.5.12 RESPALDO EUSKALMET FINAL — coordenadas publicadas por Euskalmet/Gobierno Vasco.
STATION_COORDS={
    'C023': {'lat':43.0695849,'lon':-2.49308},
    'C017': {'lat':43.2868,'lon':-1.97121},
    'C058': {'lat':43.1460,'lon':-2.15502},
    'C026': {'lat':43.1248,'lon':-1.9817},
    'C028': {'lat':42.9588,'lon':-2.29852},
}
GIPUZKOA_BOUNDARY_URL=os.getenv(
    'GIPUZKOA_BOUNDARY_URL',
    'https://geo2day.com/europe/spain/euskadi/guipuzcoa.geojson'
)
GIPUZKOA_BOUNDARY_CACHE=BASE_DIR/'gipuzkoa_boundary_cache.geojson'

# Cartografía municipal oficial de la Diputación Foral de Gipuzkoa (B5M).
GIPUZKOA_MUNICIPAL_GEOJSON_URL=os.getenv(
    'GIPUZKOA_MUNICIPAL_GEOJSON_URL',
    'https://b5m.gipuzkoa.eus/datasets/GFA_DSET_MB.geojson'
)
GIPUZKOA_MUNICIPAL_CACHE=BASE_DIR/'gipuzkoa_municipios_b5m_cache.geojson'
GIPUZKOA_MUNICIPAL_WGS84_CACHE=BASE_DIR/'gipuzkoa_municipios_b5m_wgs84_cache.geojson'


# BASUGIX V22.10.5.12: zonificación fisioclimática MUNICIPIO POR MUNICIPIO.
# Cada polígono municipal se puntúa individualmente con distancia al centroide,
# carácter marítimo/interior y compatibilidad altitudinal/orográfica.
# Las cotas de las estaciones son las publicadas por Euskalmet/Gobierno Vasco.
# La cota municipal es una referencia fisiográfica de clase, no una altitud media oficial.
BASUGIX_STATION_TERRAIN={
    'C017':{'elevation_m':113,'profile':'maritime_low'},
    'C058':{'elevation_m':592,'profile':'humid_high_hill'},
    'C026':{'elevation_m':379,'profile':'interior_hill'},
    'C028':{'elevation_m':520,'profile':'mountain_interior'},
    'C023':{'elevation_m':318,'profile':'interior_valley'},
}
BASUGIX_COASTAL_MUNICIPALITIES=[
    'mutriku','deba','zumaia','getaria','zarautz','orio',
    'donostia / san sebastian','donostia-san sebastian','donostia','san sebastian',
    'pasaia','lezo','hondarribia'
]
BASUGIX_MARITIME_TRANSITION_MUNICIPALITIES=[
    'aia','aizarnazabal','zestoa','usurbil','lasarte-oria','urnieta','hernani',
    'errenteria','oiartzun','irun','mendaro'
]
BASUGIX_HIGH_OROGRAPHY_MUNICIPALITIES=[
    'errezil','beizama','bidania-goiatz','berastegi','eldain','elduain','orexa',
    'gaztelu','ataun','zaldibia','gaintza','altzaga','zerain','mutiloa','zegama',
    'idiazabal','segura','legazpi','gabiria','ezkio-itsaso','antzuola','elgeta',
    'leintz-gatzaga','eskoriatza','aretxabaleta','onati','oñati'
]
BASUGIX_HILLY_MUNICIPALITIES=[
    'albiztur','alkiza','asteasu','larraul','hernialde','berrobi','belauntza','ibarra',
    'leaburu','lizartza','altzo','amezketa','abaltzisketa','ordizia','itsasondo','arama',
    'olaberria','beasain','lazkao','urretxu','zumarraga','azpeitia','azkoitia','soraluze',
    'elgoibar','eibar','bergara','arrasate','mondragon','arrasate / mondragon'
]
BASUGIX_REGION_ELEVATION_HINT={
    'donostialdea':160,'donostia':160,'bajo bidasoa':120,'bidasoa':120,
    'urola kosta':260,'urola costa':260,'deba barrena':260,'debabarrena':260,
    'tolosaldea':320,'tolosa':320,'goierri':430,
    'deba goiena':360,'debagoiena':360,'alto deba':360,
}
# Alias heredado: ya no decide la asignación territorial.
