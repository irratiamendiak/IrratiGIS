import asyncio, io, json, math, os, random, re, sqlite3, time, traceback, zipfile
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import xml.etree.ElementTree as ET
import httpx, jwt
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape
import uvicorn
from fwi import calculate, danger_level

BASE_DIR=Path(__file__).parent
load_dotenv(BASE_DIR/'.env', override=False)
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
PHYSIOCLIMATIC_REGION_STATION={}


SENSOR_OVERRIDES_PATH=BASE_DIR/'sensor_overrides.json'
V22_THRESHOLDS_PATH=BASE_DIR/'v22_fwi_percentiles.json'
V22_NOON_HOUR=int(os.getenv('V22_NOON_HOUR','12'))
V22_NOON_TOLERANCE_MIN=int(os.getenv('V22_NOON_TOLERANCE_MIN','75'))
V22_WRITE_ENABLED=os.getenv('V22_WRITE_ENABLED','0').strip().lower() in ('1','true','yes','on')
V221_RAW_CACHE_DIR=BASE_DIR/'v22_raw_cache'
V221_RAW_CACHE_DIR.mkdir(exist_ok=True)
V221_RAW_BASE_URL=os.getenv(
    'V221_RAW_BASE_URL',
    'https://opendata.euskadi.eus/contenidos/ds_meteorologicos/met_stations_ds_{year}/opendata/{year}.zip'
)
app=FastAPI(title='Fire Risk Gipuzkoa V6.2 - V22.10.5.14 ISI + RAPIDEZ')
templates=Environment(loader=FileSystemLoader(str(BASE_DIR/'templates')),autoescape=select_autoescape(['html']))

# V22.10.5.14 — rendimiento: conexiones HTTP persistentes y cachés de
# estructuras estables. No modifica cálculos, umbrales ni fuentes de datos.
_HTTP_CLIENT=None
_HTTP_CLIENT_LOCK=asyncio.Lock()
_FORECAST_HTTP_CLIENT=None
_FORECAST_HTTP_CLIENT_LOCK=asyncio.Lock()
_V221052_MAPPING_CACHE={}
_V221052_DAY_INDEX_CACHE={}
_V221052_HISTORY_CACHE={}
_V221052_MAPPING_TTL=3600.0
_V221052_DAY_INDEX_TTL=3600.0
_V221052_HISTORY_TTL=3600.0
_V221052_HISTORY_CACHE_MAX=20
_V221052_HISTORY_COVERAGE_CACHE={}
_V221052_HISTORY_COVERAGE_TTL=3600.0

async def _euskalmet_http_client():
    global _HTTP_CLIENT
    if _HTTP_CLIENT is None or _HTTP_CLIENT.is_closed:
        async with _HTTP_CLIENT_LOCK:
            if _HTTP_CLIENT is None or _HTTP_CLIENT.is_closed:
                _HTTP_CLIENT=httpx.AsyncClient(timeout=httpx.Timeout(12.0,connect=4.0),follow_redirects=True,limits=httpx.Limits(max_connections=40,max_keepalive_connections=20,keepalive_expiry=30.0))
    return _HTTP_CLIENT

async def _forecast_http_client():
    global _FORECAST_HTTP_CLIENT
    if _FORECAST_HTTP_CLIENT is None or _FORECAST_HTTP_CLIENT.is_closed:
        async with _FORECAST_HTTP_CLIENT_LOCK:
            if _FORECAST_HTTP_CLIENT is None or _FORECAST_HTTP_CLIENT.is_closed:
                _FORECAST_HTTP_CLIENT=httpx.AsyncClient(timeout=httpx.Timeout(25.0,connect=10.0),follow_redirects=True,limits=httpx.Limits(max_connections=10,max_keepalive_connections=5,keepalive_expiry=30.0))
    return _FORECAST_HTTP_CLIENT

async def _close_performance_clients():
    global _HTTP_CLIENT,_FORECAST_HTTP_CLIENT
    for client in (_HTTP_CLIENT,_FORECAST_HTTP_CLIENT):
        if client is not None and not client.is_closed:
            await client.aclose()
    _HTTP_CLIENT=None
    _FORECAST_HTTP_CLIENT=None


def con():
    c=sqlite3.connect(DB_PATH); c.row_factory=sqlite3.Row; return c

def init_db():
    with con() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS stations(station_id TEXT PRIMARY KEY,name TEXT,municipality TEXT,province TEXT,altitude REAL,raw_json TEXT,updated_at TEXT);
        CREATE TABLE IF NOT EXISTS sensor_map(station_id TEXT,variable TEXT,sensor_id TEXT,measure_type_id TEXT,measure_id TEXT,updated_at TEXT,PRIMARY KEY(station_id,variable));
        CREATE TABLE IF NOT EXISTS weather_daily(station_id TEXT,day TEXT,temperature REAL,humidity REAL,wind_kmh REAL,rain_mm REAL,source TEXT,created_at TEXT,PRIMARY KEY(station_id,day));
        CREATE TABLE IF NOT EXISTS fwi_daily(station_id TEXT,day TEXT,ffmc REAL,dmc REAL,dc REAL,isi REAL,bui REAL,fwi REAL,danger_level TEXT,ire_gip REAL,ire_gip_level TEXT,wind_direction_deg REAL,wind_factor REAL,season_factor REAL,created_at TEXT,PRIMARY KEY(station_id,day));
        ''')
        wcols={row[1] for row in c.execute("PRAGMA table_info(weather_daily)").fetchall()}
        for name,sqltype in (
            ('observation_time','TEXT'),
            ('rain_points_present','INTEGER'),
            ('rain_points_missing','INTEGER'),
            ('rain_coverage_pct','REAL'),
            ('rain_quality','TEXT'),
            ('data_quality','TEXT'),
            ('temperature_time','TEXT'),
            ('humidity_time','TEXT'),
            ('wind_time','TEXT'),
            ('temperature_delta_min','INTEGER'),
            ('humidity_delta_min','INTEGER'),
            ('wind_delta_min','INTEGER'),
            ('noon_fallback_used','INTEGER'),
            ('meteo_source_station','TEXT'),
            ('station_fallback_used','INTEGER'),
            ('station_fallback_distance_km','REAL'),
        ):
            if name not in wcols:
                c.execute(f'ALTER TABLE weather_daily ADD COLUMN {name} {sqltype}')

        cols={row[1] for row in c.execute("PRAGMA table_info(fwi_daily)").fetchall()}
        for name,sqltype in (
            ('ire_gip','REAL'),
            ('ire_gip_level','TEXT'),
            ('wind_direction_deg','REAL'),
            ('wind_factor','REAL'),
            ('season_factor','REAL'),
            ('wind_direction_cardinal','TEXT'),
            ('season_name','TEXT'),
            ('data_quality','TEXT'),
            ('rain_quality','TEXT'),
            ('rain_points_present','INTEGER'),
            ('rain_points_missing','INTEGER'),
            ('rain_coverage_pct','REAL'),
            ('noon_fallback_used','INTEGER'),
            ('temperature_time','TEXT'),
            ('humidity_time','TEXT'),
            ('wind_time','TEXT'),
            ('meteo_source_station','TEXT'),
            ('station_fallback_used','INTEGER'),
            ('station_fallback_distance_km','REAL'),
        ):
            if name not in cols:
                c.execute(f'ALTER TABLE fwi_daily ADD COLUMN {name} {sqltype}')
        # V22.10.5.12 HISTÓRICO DB RÁPIDO: índices explícitos para navegación histórica.
        c.execute('CREATE INDEX IF NOT EXISTS idx_weather_daily_station_day ON weather_daily(station_id,day)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_fwi_daily_station_day ON fwi_daily(station_id,day)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_weather_daily_day ON weather_daily(day)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_fwi_daily_day ON fwi_daily(day)')
        c.commit()

def station_ids(text=None):
    # V2.2 is intentionally restricted to the five selected stations.
    if text:
        requested=[x.strip().upper() for x in text.split(',') if x.strip()]
        return [x for x in FIXED_STATION_IDS if x in requested] or FIXED_STATION_IDS.copy()
    return FIXED_STATION_IDS.copy()

def walk(o):
    if isinstance(o,dict):
        yield o
        for v in o.values(): yield from walk(v)
    elif isinstance(o,list):
        for v in o: yield from walk(v)

def localized(v):
    if isinstance(v,str): return v
    if isinstance(v,dict):
        for k in ('SPANISH','BASQUE','ENGLISH','es','eu','en'):
            if v.get(k): return str(v[k])
        for x in v.values():
            if isinstance(x,str) and x:return x

def sensors_from(payload):
    out=[]
    for d in walk(payload):
        if not isinstance(d,dict):
            continue
        for k,v in d.items():
            nk=str(k).lower().replace('_','').replace('-','')
            if nk=='sensorid' and v is not None:
                sid=str(v).strip()
                if sid and sid not in out:
                    out.append(sid)
            elif nk in ('key','oid','sensorkey') and isinstance(v,str):
                m=re.search(r'/sensors/([^/"\']+)',v)
                if m:
                    sid=m.group(1).strip()
                    if sid and sid not in out:
                        out.append(sid)
    return out

def sensor_measure_pairs(payload):
    out=[]
    for d in walk(payload):
        if not isinstance(d,dict):
            continue
        mt=None; mid=None
        for k,v in d.items():
            nk=str(k).lower().replace('_','').replace('-','')
            if nk=='measuretype' and isinstance(v,(str,int,float)):
                mt=str(v).strip()
            elif nk=='measureid' and isinstance(v,(str,int,float)):
                mid=str(v).strip()
        if mt and mid and (mt,mid) not in out:
            out.append((mt,mid))
    return out

def _norm(v):
    return str(v).lower().replace('_','').replace('-','').strip()

async def station_payload_for_day(station,day):
    # Metadata only. The actual weather values remain DAILY summaries.
    # Recent dated station snapshots can return 404, so use current metadata
    # strictly to discover sensor/measure IDs.
    return await api_get(f'/euskalmet/stations/{station}/current')


async def discover_daily_mapping(station,day,station_payload):
    result={}
    for sid in sensors_from(station_payload):
        try:
            meta=await api_get(f'/euskalmet/sensors/{sid}')
        except Exception:
            continue
        pairs=sensor_measure_pairs(meta)
        for var,(wanted_mt,aliases) in TARGETS.items():
            if var in result:
                continue
            alias_norm={_norm(x) for x in aliases}
            for mt,mid in pairs:
                if _norm(mt)==_norm(wanted_mt) and _norm(mid) in alias_norm:
                    result[var]=(sid,mt,mid)
                    break
    return result

_JWT_CACHE={"token":None,"exp":0}

def _keccak256(data):
    """Pure-Python Keccak-256 (not SHA3-256), used by Euskalmet loginId."""
    RC=(1,0x8082,0x800000000000808A,0x8000000080008000,0x808B,0x80000001,
        0x8000000080008081,0x8000000000008009,0x8A,0x88,0x80008009,0x8000000A,
        0x8000808B,0x800000000000008B,0x8000000000008089,0x8000000000008003,
        0x8000000000008002,0x8000000000000080,0x800A,0x800000008000000A,
        0x8000000080008081,0x8000000000008080,0x80000001,0x8000000080008008)
    ROT=((0,36,3,41,18),(1,44,10,45,2),(62,6,43,15,61),
         (28,55,25,21,56),(27,20,39,8,14))
    MASK=(1<<64)-1
    def rol(x,n):
        return x if n==0 else ((x<<n)|(x>>(64-n)))&MASK
    def permute(a):
        for rc in RC:
            col=[a[x]^a[x+5]^a[x+10]^a[x+15]^a[x+20] for x in range(5)]
            d=[col[(x-1)%5]^rol(col[(x+1)%5],1) for x in range(5)]
            for x in range(5):
                for y in range(5): a[x+5*y]=(a[x+5*y]^d[x])&MASK
            b=[0]*25
            for x in range(5):
                for y in range(5):
                    b[y+5*((2*x+3*y)%5)]=rol(a[x+5*y],ROT[x][y])
            for x in range(5):
                for y in range(5):
                    a[x+5*y]=b[x+5*y]^((~b[(x+1)%5+5*y])&b[(x+2)%5+5*y])
            a[0]^=rc
    rate=136
    buf=bytearray(data)
    buf.append(1)
    while len(buf)%rate != rate-1: buf.append(0)
    buf.append(0x80)
    state=[0]*25
    for off in range(0,len(buf),rate):
        block=buf[off:off+rate]
        for i in range(rate//8):
            state[i]^=int.from_bytes(block[i*8:(i+1)*8],'little')
        permute(state)
    return b''.join(x.to_bytes(8,'little') for x in state)[:32].hex()


def _read_login_id(private_key_path, derived_login_id=None):
    """Resolve Euskalmet API owner identity automatically.

    Euskalmet accepts either email or loginId. Prefer an explicitly configured
    loginId, then the fingerprint derived from the loaded public key, and only
    then fall back to email. This avoids relying on the account email matching
    the API-key owner when the key itself already identifies the owner.
    """
    login=os.getenv('EUSKALMET_LOGIN_ID','').strip()
    email=os.getenv('EUSKALMET_EMAIL','').strip()
    if login:
        return 'loginId', login
    if derived_login_id:
        return 'loginId', str(derived_login_id).strip()
    if email:
        return 'email', email

    candidates=[
        private_key_path.parent/'fingerPrint.txt',
        private_key_path.parent/'fingerprint.txt',
        BASE_DIR/'fingerPrint.txt',
        BASE_DIR/'fingerprint.txt',
    ]
    for fp in candidates:
        if not fp.exists():
            continue
        try:
            value=fp.read_text(encoding='utf-8-sig').strip()
        except UnicodeDecodeError:
            value=fp.read_text(encoding='iso-8859-1').strip()
        if value:
            if ':' in value and '\n' not in value:
                maybe=value.split(':',1)[1].strip()
                if maybe:
                    value=maybe
            return 'loginId', value

    raise RuntimeError(
        'No se encontró EUSKALMET_LOGIN_ID/EUSKALMET_EMAIL ni fingerPrint.txt '
        'junto a la clave privada'
    )

def token():
    """Genera el JWT Euskalmet usando la clave privada configurada en Render."""
    now=int(time.time())
    cached=_JWT_CACHE.get("token")
    exp=int(_JWT_CACHE.get("exp") or 0)
    if cached and now < exp-120:
        return cached

    configured=os.getenv('EUSKALMET_PRIVATE_KEY_PATH','').strip()
    private_key=os.getenv('EUSKALMET_PRIVATE_KEY','').strip()

    def normalize_pem(raw):
        if isinstance(raw, bytes):
            if raw.startswith(b'\xef\xbb\xbf'):
                raw=raw[3:]
            try:
                text=raw.decode('utf-8')
            except UnicodeDecodeError:
                text=raw.decode('latin-1')
        else:
            text=str(raw)
        text=text.strip()
        if len(text)>=2 and text[0]=='"' and text[-1]=='"':
            text=text[1:-1].strip()
        # Render Secret Files normally contain real CR/LF characters, but some
        # exports store them escaped as literal backslash sequences. Normalize
        # both representations to real newline characters.
        text=text.replace('\\r\\n','\n').replace('\\n','\n').replace('\\r','\n')
        text=text.replace('\r\n','\n').replace('\r','\n')
        # Rebuild the PEM envelope and base64 body with canonical 64-char lines.
        m=re.search(r'-----BEGIN ([A-Z0-9 ]+?)-----',text,re.I)
        if not m:
            return (text+'\n').encode('utf-8')
        label=m.group(1).upper()
        tail=text[m.end():]
        e=re.search(r'-----END '+re.escape(label)+r'-----',tail,re.I)
        if not e:
            return (text+'\n').encode('utf-8')
        body=re.sub(r'\s+','',tail[:e.start()])
        prefix=f'-----BEGIN {label}-----'
        suffix=f'-----END {label}-----'
        if not body:
            return (prefix+'\n'+suffix+'\n').encode('ascii')
        wrapped='\n'.join(body[i:i+64] for i in range(0,len(body),64))
        return (prefix+'\n'+wrapped+'\n'+suffix+'\n').encode('ascii')

    if configured:
        p=Path(configured)
        if not p.is_absolute():
            p=BASE_DIR/p
        if not p.exists():
            raise RuntimeError(f'No existe la clave privada configurada en EUSKALMET_PRIVATE_KEY_PATH: {p}')
        private_key_bytes=normalize_pem(p.read_bytes())
        owner_path=p
        source=f'file:{p}'
    elif private_key:
        private_key_bytes=normalize_pem(private_key)
        tmp=BASE_DIR/'.render_private_key_runtime.pem'
        tmp.write_bytes(private_key_bytes)
        owner_path=tmp
        source='env:EUSKALMET_PRIVATE_KEY'
    else:
        raise RuntimeError('Falta EUSKALMET_PRIVATE_KEY_PATH o EUSKALMET_PRIVATE_KEY en Render')

    try:
        from cryptography.hazmat.primitives.serialization import (
            load_pem_private_key, load_der_private_key, load_ssh_private_key
        )
        key_obj=None
        parse_errors=[]
        # 1) PEM canónico normalizado.
        try:
            key_obj=load_pem_private_key(private_key_bytes,password=None)
        except Exception as exc:
            parse_errors.append(f'PEM:{type(exc).__name__}:{exc}')
        # 2) Algunos gestores almacenan la clave como Base64 DER sin envoltorio PEM.
        if key_obj is None:
            try:
                compact=re.sub(rb'[^A-Za-z0-9+/=]',b'',private_key_bytes)
                der=__import__('base64').b64decode(compact,validate=True)
                key_obj=load_der_private_key(der,password=None)
                private_key_bytes=der
            except Exception as exc:
                parse_errors.append(f'DER:{type(exc).__name__}:{exc}')
        # 3) Render puede contener una clave OpenSSH aunque el fichero se llame .pem.
        if key_obj is None:
            try:
                key_obj=load_ssh_private_key(private_key_bytes,password=None)
            except Exception as exc:
                parse_errors.append(f'SSH:{type(exc).__name__}:{exc}')
        if key_obj is None or not hasattr(key_obj,'private_numbers'):
            raise ValueError('La clave no es una clave privada RSA; ' + ' | '.join(parse_errors))
    except Exception as exc:
        raise RuntimeError(f'La clave privada Euskalmet no es una clave privada RSA utilizable ({source}): {type(exc).__name__}: {exc}') from exc

    # Euskalmet documenta loginId como la huella Keccak-256 de la clave pública.
    # La calculamos sobre el DER SubjectPublicKeyInfo de la clave ya cargada.
    # No dependemos de la versión de OpenSSL instalada en Render.
    derived_login_id=None
    try:
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        public_der_for_login=key_obj.public_key().public_bytes(
            Encoding.DER, PublicFormat.SubjectPublicKeyInfo
        )
        derived_login_id=_keccak256(public_der_for_login)
    except Exception as exc:
        print(f"EUSKALMET AUTH LOGINID DIAG unavailable={type(exc).__name__}",flush=True)

    owner_claim,owner_value=_read_login_id(owner_path, derived_login_id=derived_login_id)
    if source.startswith('env:EUSKALMET_PRIVATE_KEY'):
        try:
            owner_path.unlink()
        except OSError:
            pass

    # Diagnóstico seguro: sólo metadatos no secretos de la clave pública derivada.
    try:
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        import hashlib
        public_der=key_obj.public_key().public_bytes(Encoding.DER,PublicFormat.SubjectPublicKeyInfo)
        public_sha256=hashlib.sha256(public_der).hexdigest()
        print(f"EUSKALMET AUTH DIAG source={source} owner_claim={owner_claim} rsa_bits={getattr(key_obj,'key_size',None)} public_sha256={public_sha256}",flush=True)
    except Exception as exc:
        print(f"EUSKALMET AUTH DIAG unavailable={type(exc).__name__}",flush=True)

    exp=now+3600
    payload={'aud':'met01.apikey','iss':os.getenv('EUSKALMET_ISSUER','fire-risk-euskadi'),'iat':now,'exp':exp,'version':'1.0.0',owner_claim:owner_value}
    signed=jwt.encode(payload,private_key_bytes,algorithm='RS256')
    _JWT_CACHE['token']=signed
    _JWT_CACHE['exp']=exp
    return signed
def decode_json_response(r, path):
    """Decode Euskalmet JSON robustly.

    Some Euskalmet endpoints declare/return ISO-8859-1 data. httpx/json may
    otherwise try UTF-8 directly and fail on bytes such as 0xBF.
    """
    raw = r.content
    candidates = []

    # Respect HTTP Content-Type charset first.
    if r.encoding:
        candidates.append(r.encoding)

    # Known/fallback encodings observed in Euskalmet/Open Data Euskadi.
    candidates.extend(["utf-8-sig", "utf-8", "iso-8859-1", "windows-1252"])

    seen = set()
    errors = []
    for enc in candidates:
        if not enc:
            continue
        enc = enc.lower()
        if enc in seen:
            continue
        seen.add(enc)
        try:
            decoded = raw.decode(enc)
            return json.loads(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            errors.append(f"{enc}: {exc}")

    # Last-resort JSON decoding with replacement lets us return a useful
    # diagnostic rather than a cryptic codec traceback.
    try:
        decoded = raw.decode("iso-8859-1", errors="replace")
        return json.loads(decoded)
    except Exception as exc:
        content_type = r.headers.get("content-type", "desconocido")
        preview = raw[:120].decode("iso-8859-1", errors="replace")
        raise RuntimeError(
            f"No se pudo interpretar JSON de Euskalmet en {path}. "
            f"Content-Type={content_type}. Inicio={preview!r}. "
            f"Intentos: {' | '.join(errors[-4:])}. Error final: {exc}"
        )

async def api_get(path):
    client=await _euskalmet_http_client()
    async def _request_once():
        return await client.get(
            BASE_URL + path,
            headers={
                "Accept":"application/json",
                "Authorization":"Bearer " + token(),
            },
        )

    try:
        r=await _request_once()

        if r.status_code in (401,403):
            _JWT_CACHE["token"]=None
            _JWT_CACHE["exp"]=0
            r=await _request_once()

        if r.status_code >= 400:
            raw=bytes(r.content)
            declared=r.headers.get("content-type","")
            body=raw.decode("iso-8859-1",errors="replace")[:500]
            raise RuntimeError(
                f"Euskalmet HTTP {r.status_code} en {path}. "
                f"Content-Type={declared}. Respuesta={body}"
            )

        return decode_json_response(r,path)

    except Exception as exc:
        diagnostic=(
            "\n================ EUSKALMET ERROR ================\n"
            f"Fecha: {datetime.now().isoformat(timespec='seconds')}\n"
            f"Endpoint: {path}\n"
            f"Tipo: {type(exc).__name__}\n"
            f"Error: {exc}\n"
            + traceback.format_exc()
            + "\n=================================================\n"
        )
        try:
            with open(BASE_DIR/"euskalmet_error.log","a",encoding="utf-8",errors="replace") as fh:
                fh.write(diagnostic)
        except Exception:
            pass
        print(diagnostic,flush=True)
        raise RuntimeError(f"{path}: {type(exc).__name__}: {exc}") from exc

def _flatten_numeric(payload, prefix=""):
    """Yield (path, value) for numeric-looking leaves in a JSON payload."""
    if isinstance(payload,dict):
        for k,v in payload.items():
            p=f"{prefix}.{k}" if prefix else str(k)
            yield from _flatten_numeric(v,p)
    elif isinstance(payload,list):
        for i,v in enumerate(payload):
            p=f"{prefix}[{i}]"
            yield from _flatten_numeric(v,p)
    elif isinstance(payload,(int,float)):
        yield prefix,float(payload)
    elif isinstance(payload,str):
        try:
            yield prefix,float(payload.replace(',','.'))
        except Exception:
            return

def _daily_candidates(payload,var):
    """Return plausible daily-summary candidates ordered by semantic preference."""
    # FWI input sanity ranges; deliberately conservative.
    ranges={
        'temperature':(-60.0,60.0),
        'humidity':(0.0,100.0),
        'wind_kmh':(0.0,250.0),
        'rain_mm':(0.0,500.0),
    }
    lo,hi=ranges[var]

    # Prefer daily average/mean for T/RH/wind; accumulated/sum for rain.
    if var=='rain_mm':
        preferred=('accumulated','accumulation','total','sum','precipitation','rain','value')
        rejected=('maxspeed','direction','sigma','count','hour','minute','timestamp','code')
    else:
        preferred=('mean','average','avg','value','measurement','measuredvalue')
        rejected=('sum','total','accumulated','count','direction','sigma','timestamp','code')

    scored=[]
    for path,value in _flatten_numeric(payload):
        if not (lo <= value <= hi):
            continue
        p=path.lower().replace('_','').replace('-','')
        if any(x.replace('_','') in p for x in rejected):
            continue

        score=0
        for rank,key in enumerate(preferred):
            kk=key.replace('_','')
            if kk in p:
                score += 100-rank*8
        # Reward likely statistic/value leaf names.
        leaf=p.rsplit('.',1)[-1]
        if leaf in ('mean','average','avg','value','measurement','measuredvalue','sum','total','accumulated'):
            score += 30
        # De-prioritize obvious metadata.
        if any(x in p for x in ('id','year','month','day','date','at','version','numericid')):
            score -= 80
        scored.append((score,path,value))

    scored.sort(key=lambda x:(x[0],-len(x[1])),reverse=True)
    return scored

def choose_daily(payload,var):
    candidates=_daily_candidates(payload,var)
    if not candidates:
        return None
    # Take the single best semantically named daily statistic.
    return candidates[0][2]

def _append_daily_debug(path,var,payload,value):
    """Keep a local diagnostic without exposing credentials."""
    try:
        record={
            'time':datetime.now().isoformat(timespec='seconds'),
            'endpoint':path,
            'variable':var,
            'selected_value':value,
            'top_candidates':[
                {'score':s,'path':p,'value':v}
                for s,p,v in _daily_candidates(payload,var)[:8]
            ],
        }
        with open(BASE_DIR/'daily_parser_debug.jsonl','a',encoding='utf-8') as fh:
            fh.write(json.dumps(record,ensure_ascii=False)+'\n')
    except Exception:
        pass


async def daily_reading(station,sensor,var,day,measure_type_id,measure_id):
    path=(f'/euskalmet/readings/summarized/byDay/forStation/{station}/{sensor}'
          f'/measures/{measure_type_id}/{measure_id}'
          f'/at/{day.year}/{day.month:02d}/{day.day:02d}')
    try:
        payload=await api_get(path)
    except Exception as exc:
        raise RuntimeError(
            f'No disponible resumen diario {var}: {path}. {exc}'
        ) from exc

    value=choose_daily(payload,var)
    _append_daily_debug(path,var,payload,value)

    if value is None:
        raise RuntimeError(
            f'No se encontró un estadístico diario válido para {var}: {path}. '
            f'Revisa daily_parser_debug.jsonl'
        )

    # Euskalmet API mean_speed is returned in m/s while the daily report
    # presents the same daily mean in km/h. Convert only wind speed.
    if var=='wind_kmh':
        return float(value)*3.6
    return float(value)


def cached(station,var):
    with con() as c:
        row=c.execute(
            'SELECT * FROM sensor_map WHERE station_id=? AND variable=?',
            (station,var)
        ).fetchone()
    return dict(row) if row else None

def cache(station,var,sensor,measure_type_id,measure_id):
    with con() as c:
        sql=("INSERT INTO sensor_map VALUES(?,?,?,?,?,?) "
             "ON CONFLICT(station_id,variable) DO UPDATE SET "
             "sensor_id=excluded.sensor_id,"
             "measure_type_id=excluded.measure_type_id,"
             "measure_id=excluded.measure_id,"
             "updated_at=excluded.updated_at")
        c.execute(
            sql,
            (station,var,sensor,measure_type_id,measure_id,
             datetime.now().isoformat(timespec='seconds'))
        )
        c.commit()

async def resolve_daily(station,var,day,station_payload,mapping):
    info=mapping.get(var)

    if info:
        sid,mt,mid=info
        value=await daily_reading(station,sid,var,day,mt,mid)
        cache(station,var,sid,mt,mid)
        return value

    row=cached(station,var)
    if row:
        return await daily_reading(
            station,row['sensor_id'],var,day,
            row['measure_type_id'],row['measure_id']
        )

    raise RuntimeError(
        f'La configuración actual de {station} no declara una medida compatible para {var}'
    )


def save_station(station,p):
    name=localized(p.get('name')) if isinstance(p,dict) else None; muni=localized(p.get('municipality')) if isinstance(p,dict) else None; prov=localized(p.get('province')) if isinstance(p,dict) else None; alt=p.get('altitude') if isinstance(p,dict) else None
    with con() as c:
        c.execute('INSERT INTO stations VALUES(?,?,?,?,?,?,?) ON CONFLICT(station_id) DO UPDATE SET name=excluded.name,municipality=excluded.municipality,province=excluded.province,altitude=excluded.altitude,raw_json=excluded.raw_json,updated_at=excluded.updated_at',(station,name,muni,prov,float(alt) if alt not in (None,'') else None,json.dumps(p,ensure_ascii=False),datetime.now().isoformat(timespec='seconds'))); c.commit()

async def euskalmet_weather(station,day):
    """Fetch ONLY completed daily summaries from Euskalmet."""
    detail=await station_payload_for_day(station,day)
    if isinstance(detail,dict) and not localized(detail.get('name')):
        detail=dict(detail)
        detail['name']=FIXED_STATIONS.get(station,station)
    save_station(station,detail)

    mapping=await discover_daily_mapping(station,day,detail)
    vals={}
    for var in TARGETS:
        vals[var]=await resolve_daily(station,var,day,detail,mapping)

    wind=max(0,float(vals['wind_kmh']))

    return (
        round(float(vals['temperature']),2),
        round(max(0,min(100,float(vals['humidity']))),2),
        round(wind,2),
        round(max(0,float(vals['rain_mm'])),2),
    )

async def hybrid_weather(station,day):
    return await euskalmet_weather(station,day), 'Euskalmet API diario'




def _v22_load_thresholds():
    try:
        if V22_THRESHOLDS_PATH.exists():
            data=json.loads(V22_THRESHOLDS_PATH.read_text(encoding='utf-8'))
            return data if isinstance(data,dict) else {}
    except Exception:
        pass
    return {}

def v22_local_level(station,value):
    """Station-specific climatological level using P40/P65/P85/P95.

    Falls back to the old absolute thresholds while the percentile file
    has not yet been generated.
    """
    thresholds=_v22_load_thresholds().get(station,{})
    try:
        p40=float(thresholds['p40'])
        p65=float(thresholds['p65'])
        p85=float(thresholds['p85'])
        p95=float(thresholds['p95'])
    except Exception:
        if value < 5: return 'Bajo'
        if value < 10: return 'Moderado'
        if value < 20: return 'Alto'
        if value < 35: return 'Muy alto'
        return 'Extremo'

    v=float(value)
    if v < p40: return 'Bajo'
    if v < p65: return 'Moderado'
    if v < p85: return 'Alto'
    if v < p95: return 'Muy alto'
    return 'Extremo'

def _v221_tag_value(meteoros,prefix):
    if meteoros is None:
        return None
    for child in list(meteoros):
        tag=child.tag.split('}')[-1]
        if tag.startswith(prefix):
            try:
                return float(str(child.text).replace(',','.'))
            except Exception:
                return None
    return None

async def _v221_download_year(year):
    """Download/cache the official Euskalmet annual raw-readings ZIP."""
    target=V221_RAW_CACHE_DIR/f'{year}.zip'
    # The annual archives are large. Keep a completed local copy.
    if target.exists() and target.stat().st_size > 1_000_000:
        return target

    url=V221_RAW_BASE_URL.format(year=year)
    tmp=target.with_suffix('.part')

    headers={
        'User-Agent':'Mozilla/5.0 (BASUGIX V22.1 experimental)',
        'Accept':'application/zip,application/octet-stream,*/*',
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0,connect=30.0),follow_redirects=True) as client:
        async with client.stream('GET',url,headers=headers) as r:
            if r.status_code >= 400:
                body=(await r.aread())[:500].decode('iso-8859-1',errors='replace')
                raise RuntimeError(
                    f'V22.1 raw archive HTTP {r.status_code} para {url}. Respuesta={body}'
                )
            with tmp.open('wb') as fh:
                async for chunk in r.aiter_bytes(1024*1024):
                    if chunk:
                        fh.write(chunk)

    if not tmp.exists() or tmp.stat().st_size < 1_000_000:
        raise RuntimeError(f'V22.1 archivo anual incompleto: {tmp}')
    tmp.replace(target)
    return target

def _v221_station_inner_zip(outer_zip,station):
    """Resolve the inner ZIP for a station robustly.

    The annual archive may contain entries such as ``2026/C011_2026.zip``.
    Match the station id as a complete token in the basename, not as an
    arbitrary substring, and tolerate nested folders/case differences.
    """
    station=str(station).strip().upper()
    names=[n for n in outer_zip.namelist() if str(n).lower().endswith('.zip')]

    exact=[]
    token=[]
    for n in names:
        base=Path(n).name
        stem=Path(base).stem.upper()
        # Common official forms: C023_2026.zip, C023.zip, PREFIX_C023_2026.zip.
        if stem == station or stem.startswith(station+'_') or stem.startswith(station+'-'):
            exact.append(n)
            continue
        if re.search(r'(^|[^A-Z0-9])'+re.escape(station)+r'([^A-Z0-9]|$)', stem):
            token.append(n)

    candidates=exact or token
    if not candidates:
        available=[]
        for n in names[:5000]:
            stem=Path(n).stem.upper()
            m=re.match(r'([A-Z]+\d+)',stem)
            if m:
                available.append(m.group(1))
        available=sorted(set(available))
        raise RuntimeError(
            f'V22.1 no encuentra ZIP interno de {station}. '
            f'Estaciones detectadas en el archivo: {available[:80]}'
        )
    candidates.sort(key=lambda n:(len(Path(n).parts),len(n),n))
    return candidates[0]


def _v221052_local_tag(elem):
    return str(elem.tag).split('}')[-1].strip().lower() if getattr(elem,'tag',None) is not None else ''


def _v221052_attr_ci(elem,*names):
    wanted={str(x).lower() for x in names}
    for k,v in getattr(elem,'attrib',{}).items():
        if str(k).split('}')[-1].lower() in wanted:
            return v
    return None


def _v221052_parse_date_text(value):
    if value is None:
        return None
    s=str(value).strip()
    for pat,fmt in ((r'\d{4}-\d{2}-\d{2}','%Y-%m-%d'),(r'\d{2}/\d{2}/\d{4}','%d/%m/%Y'),(r'\d{4}/\d{2}/\d{2}','%Y/%m/%d')):
        m=re.search(pat,s)
        if m:
            try:
                return datetime.strptime(m.group(0),fmt).date().isoformat()
            except Exception:
                pass
    return None


def _v221052_date_from_xml_day(xml_name, day_node, year):
    """Resolve a civil date from historical Euskalmet monthly XMLs.

    The real files can encode <dia Dia="1"> while the month/year live in
    filenames such as C023_2026_1.xml. Full ISO dates are also accepted.
    """
    raw=_v221052_attr_ci(day_node,'Dia','day','fecha','date')
    full=_v221052_parse_date_text(raw)
    if full:
        return full

    # Resolve month from filename (..._YYYY_M.xml or ..._YYYY_MM.xml).
    base=Path(str(xml_name)).name
    m=re.search(r'(?:^|_)(\d{4})_(\d{1,2})(?:[^0-9]|$)',base)
    file_year=int(m.group(1)) if m else int(year)
    file_month=int(m.group(2)) if m else None

    # Dia is commonly just 1..31 in these monthly XMLs.
    day_num=None
    if raw is not None:
        md=re.search(r'(?<!\d)([0-3]?\d)(?!\d)',str(raw).strip())
        if md:
            try: day_num=int(md.group(1))
            except Exception: day_num=None

    if day_num is None:
        for ch in list(day_node)[:12]:
            if _v221052_local_tag(ch) in ('fecha','date','dia','day'):
                full=_v221052_parse_date_text(ch.text)
                if full:
                    return full
                md=re.search(r'(?<!\d)([0-3]?\d)(?!\d)',str(ch.text or '').strip())
                if md:
                    try: day_num=int(md.group(1))
                    except Exception: pass
                if day_num is not None:
                    break

    if file_month is not None and day_num is not None:
        try:
            return date(file_year,file_month,day_num).isoformat()
        except Exception:
            return None
    return None


def _v221052_parse_time_text(value):
    if value is None:
        return None
    m=re.search(r'([01]?\d|2[0-3]):([0-5]\d)',str(value))
    if not m:
        return None
    return int(m.group(1)),int(m.group(2))


def _v221052_norm_name(value):
    # Normalize XML tag/attribute names such as Tem.Aire_a_150cm, Vel.Med_a_2200cm.
    import unicodedata
    s=unicodedata.normalize('NFKD',str(value or '')).encode('ascii','ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+','',s)


def _v221052_num(value):
    if value is None:
        return None
    s=str(value).strip()
    if not s:
        return None
    # Accept decimal comma and strip harmless unit-like whitespace.
    s=s.replace(',','.')
    m=re.search(r'[-+]?\d+(?:\.\d+)?',s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


def _v221052_meteo_value_any(node,prefixes):
    """Find a numeric meteorological value under *node*.

    Euskalmet historical XMLs use more than one representation: values may be
    element text, a generic value/valor attribute, or meteorological attributes
    attached to Hora/Meteoros (e.g. Tem.Aire_a_150cm, Humedad_a_150cm,
    Vel.Med_a_2200cm). Search all three forms.
    """
    prefs=[_v221052_norm_name(x) for x in prefixes]
    for child in node.iter():
        tag=_v221052_norm_name(_v221052_local_tag(child))

        # 1) Named element: <Tem.Aire...>23.1</Tem.Aire...>
        if any(tag.startswith(p) or p in tag for p in prefs):
            val=_v221052_num(child.text)
            if val is not None:
                return val
            for ak,av in getattr(child,'attrib',{}).items():
                ank=_v221052_norm_name(str(ak).split('}')[-1])
                if ank in ('value','valor','measurement','medida','dato'):
                    val=_v221052_num(av)
                    if val is not None:
                        return val

        # 2) Named attribute on Hora/Meteoros or any descendant.
        for ak,av in getattr(child,'attrib',{}).items():
            ank=_v221052_norm_name(str(ak).split('}')[-1])
            if any(ank.startswith(p) or p in ank for p in prefs):
                val=_v221052_num(av)
                if val is not None:
                    return val
    return None

def _v221_parse_station_days(raw_inner_zip, wanted_dates):
    """Parse only requested civil dates from one station inner ZIP."""
    wanted={d.isoformat() for d in wanted_dates}
    out={d:[] for d in wanted}

    with zipfile.ZipFile(io.BytesIO(raw_inner_zip)) as inner:
        xml_names=[n for n in inner.namelist() if n.lower().endswith('.xml')]
        for xml_name in xml_names:
            root=ET.fromstring(inner.read(xml_name))
            for dia in root.findall('.//dia'):
                ds=dia.attrib.get('Dia')
                if ds not in wanted:
                    continue
                for hora in dia.findall('./hora'):
                    hs=hora.attrib.get('Hora')
                    if not hs:
                        continue
                    try:
                        dt=datetime.strptime(ds+' '+hs,'%Y-%m-%d %H:%M')
                    except Exception:
                        continue

                    meteoros=hora.find('./Meteoros')
                    if meteoros is None:
                        continue

                    out[ds].append({
                        'dt':dt,
                        'temperature':_v221_tag_value(meteoros,'Tem.Aire.'),
                        'humidity':_v221_tag_value(meteoros,'Humedad.'),
                        'wind_ms':_v221_tag_value(meteoros,'Vel.Med.'),
                        'rain_mm':_v221_tag_value(meteoros,'Precip.'),
                        'direction_deg':_v221_tag_value(meteoros,'Dir.Med.'),
                    })

    for key in out:
        out[key].sort(key=lambda x:x['dt'])
    return out

async def _v221_raw_days(station,day):
    """Return raw 10-minute observations for previous/current day."""
    years=sorted({day.year,(day-timedelta(days=1)).year})
    combined={
        (day-timedelta(days=1)).isoformat():[],
        day.isoformat():[],
    }

    for year in years:
        archive=await _v221_download_year(year)
        with zipfile.ZipFile(archive) as outer:
            inner_name=_v221_station_inner_zip(outer,station)
            raw_inner=outer.read(inner_name)

        parsed=_v221_parse_station_days(
            raw_inner,
            [day-timedelta(days=1),day]
        )
        for key,vals in parsed.items():
            combined.setdefault(key,[]).extend(vals)

    return combined

def _v221_nearest(observations,key,target_hour=12,tolerance_min=40):
    target=target_hour*60
    best=None
    for obs in observations:
        value=obs.get(key)
        if value is None:
            continue
        minute=obs['dt'].hour*60+obs['dt'].minute
        delta=abs(minute-target)
        if best is None or delta < best[0]:
            best=(delta,obs['dt'],float(value))
    if best is None or best[0] > tolerance_min:
        return None,None
    return best[2],best[1].strftime('%H:%M')

def _v221_rain24(previous_obs,current_obs,target_hour=12):
    """Sum interval precipitation in (previous noon, current noon]."""
    target=target_hour*60
    total=0.0
    count=0

    for obs in previous_obs:
        p=obs.get('rain_mm')
        if p is None:
            continue
        minute=obs['dt'].hour*60+obs['dt'].minute
        if minute > target:
            p=float(p)
            if 0.0 <= p <= 100.0:
                total += p
                count += 1

    for obs in current_obs:
        p=obs.get('rain_mm')
        if p is None:
            continue
        minute=obs['dt'].hour*60+obs['dt'].minute
        if minute <= target:
            p=float(p)
            if 0.0 <= p <= 100.0:
                total += p
                count += 1

    return (total,count) if count else (None,0)


def _v222_num(v):
    if isinstance(v,(int,float)):
        return float(v)
    if isinstance(v,str):
        try:
            return float(v.replace(',','.'))
        except Exception:
            return None
    return None

def _v223_parse_time_value(v):
    """Return HH:MM from strings, ISO datetimes or epoch timestamps."""
    if isinstance(v,str):
        s=v.strip()
        m=re.search(r'([01]\d|2[0-3]):([0-5]\d)',s)
        if m:
            return f'{m.group(1)}:{m.group(2)}'
        # ISO-like compact forms occasionally use T1200 or 120000.
        m=re.search(r'T?([01]\d|2[0-3])([0-5]\d)(?:[0-5]\d)?(?:Z|[+-]\d\d:?\d\d)?$',s)
        if m:
            return f'{m.group(1)}:{m.group(2)}'
        return None

    if isinstance(v,(int,float)):
        x=float(v)
        # Epoch seconds / milliseconds.
        try:
            if x > 10_000_000_000:
                x=x/1000.0
            if x > 1_000_000_000:
                dt=datetime.fromtimestamp(x)
                return dt.strftime('%H:%M')
        except Exception:
            pass
    return None

def _v223_numeric_leaves(node,prefix=''):
    out=[]
    if isinstance(node,dict):
        for k,v in node.items():
            p=f'{prefix}.{k}' if prefix else str(k)
            if isinstance(v,(int,float)):
                out.append((p,float(v)))
            elif isinstance(v,str):
                try:
                    out.append((p,float(v.replace(',','.'))))
                except Exception:
                    pass
    return out

def _v222_extract_points(payload):
    """V22.3: aggressively extract intraday HH:MM/value pairs.

    Handles:
      - time/hour/hora/at/date/datetime/timestamp sibling + value
      - ISO datetime keys
      - epoch timestamps
      - nested {_at:..., _value:...}
      - arrays of [timestamp,value] or [HH:MM,value]
      - clock keys {"12:10": 17.2}
    """
    out=[]

    TIME_KEYS={
        'time','hour','hora','at','date','daytime','dateTime','datetime',
        'timestamp','_at','_date','_timestamp','instant','fecha','fechaHora'
    }
    VALUE_KEYS={
        'value','_value','measurement','measuredValue','measured_value',
        'reading','data','result','mean','_mean'
    }

    def add(hhmm,val,path):
        num=_v222_num(val)
        if hhmm and num is not None:
            out.append((hhmm,float(num),path))

    def visit(node,path=''):
        if isinstance(node,str):
            s=node.strip()
            if s and s[:1] in '[{':
                try:
                    visit(json.loads(s),path)
                except Exception:
                    pass
            return

        if isinstance(node,list):
            # Pair-like arrays.
            if len(node)>=2:
                hhmm=_v223_parse_time_value(node[0])
                num=_v222_num(node[1])
                if hhmm and num is not None:
                    add(hhmm,num,path+'[pair]')
            for i,v in enumerate(node):
                visit(v,f'{path}[{i}]')
            return

        if not isinstance(node,dict):
            return

        # 1) Explicit time sibling.
        hhmm=None
        time_key=None
        for k,v in node.items():
            if str(k) in TIME_KEYS or str(k).lower() in {x.lower() for x in TIME_KEYS}:
                hhmm=_v223_parse_time_value(v)
                if hhmm:
                    time_key=str(k)
                    break

        if hhmm:
            # Prefer obvious value fields.
            used=False
            for k,v in node.items():
                if str(k) in VALUE_KEYS or str(k).lower() in {x.lower() for x in VALUE_KEYS}:
                    num=_v222_num(v)
                    if num is not None:
                        add(hhmm,num,f'{path}.{k}')
                        used=True
            # If no explicit value field, use plausible numeric sibling leaves.
            if not used:
                for p,num in _v223_numeric_leaves(node,path):
                    pl=p.lower()
                    if any(bad in pl for bad in (
                        'id','numericid','entityversion','count','year','month','day',
                        'code','version','latitude','longitude','altitude'
                    )):
                        continue
                    add(hhmm,num,p)

        # 2) Time encoded in dictionary key.
        for k,v in node.items():
            kh=_v223_parse_time_value(k)
            if kh:
                num=_v222_num(v)
                if num is not None:
                    add(kh,num,f'{path}.{k}')
                elif isinstance(v,dict):
                    for vk in VALUE_KEYS:
                        if vk in v:
                            add(kh,v[vk],f'{path}.{k}.{vk}')

        # 3) Any string/number child containing time can pair with value sibling.
        if not hhmm:
            for k,v in node.items():
                kh=_v223_parse_time_value(v)
                if kh:
                    for vk in VALUE_KEYS:
                        if vk in node:
                            add(kh,node[vk],f'{path}.{vk}')
                    break

        for k,v in node.items():
            visit(v,f'{path}.{k}' if path else str(k))

    visit(payload)

    seen=set()
    clean=[]
    for hhmm,val,path in out:
        key=(hhmm,round(float(val),8))
        if key not in seen:
            seen.add(key)
            clean.append((hhmm,float(val),path))
    clean.sort(key=lambda x:x[0])
    return clean

def _v223_payload_shape(payload,max_items=80):
    """Compact structural summary of an API payload for diagnostics."""
    rows=[]
    def visit(node,path='',depth=0):
        if len(rows)>=max_items or depth>5:
            return
        typ=type(node).__name__
        if isinstance(node,dict):
            rows.append({'path':path or '$','type':typ,'keys':list(node.keys())[:20]})
            for k,v in list(node.items())[:20]:
                visit(v,f'{path}.{k}' if path else str(k),depth+1)
        elif isinstance(node,list):
            rows.append({'path':path or '$','type':typ,'length':len(node)})
            for i,v in enumerate(node[:8]):
                visit(v,f'{path}[{i}]',depth+1)
        else:
            preview=str(node)
            rows.append({'path':path or '$','type':typ,'value':preview[:160]})
    visit(payload)
    return rows



def _v224_api_path_from_key(key):
    k=str(key).strip()
    if k.startswith('http://') or k.startswith('https://'):
        # api_get expects relative paths; strip known API host if present.
        m=re.search(r'https?://[^/]+(/.*)$',k)
        return m.group(1) if m else k
    if not k.startswith('/'):
        k='/'+k
    return k

def _v224_keys(payload):
    """Collect API resource keys from a response."""
    keys=[]
    def visit(node):
        if isinstance(node,dict):
            k=node.get('key')
            if isinstance(k,str) and 'euskalmet/readings/' in k:
                keys.append(k)
            for v in node.values():
                visit(v)
        elif isinstance(node,list):
            for v in node:
                visit(v)
        elif isinstance(node,str):
            s=node.strip()
            if s.startswith('euskalmet/readings/'):
                keys.append(s)
            elif s and s[:1] in '[{':
                try:
                    visit(json.loads(s))
                except Exception:
                    pass
    visit(payload)
    out=[]
    seen=set()
    for k in keys:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out

def _v224_time_from_key(key):
    """Extract HH:MM from Euskalmet reading resource keys.

    Expected shapes:
      .../at/YYYY/MM/DD/HH
      .../at/YYYY/MM/DD/HH/MM

    Important: do not confuse the civil day (DD) with the hour.
    """
    s=str(key).rstrip('/')

    m=re.search(
        r'/at/\d{4}/\d{1,2}/\d{1,2}/([01]\d|2[0-3])/([0-5]\d)$',
        s
    )
    if m:
        return f'{m.group(1)}:{m.group(2)}'

    m=re.search(
        r'/at/\d{4}/\d{1,2}/\d{1,2}/([01]\d|2[0-3])$',
        s
    )
    if m:
        return f'{m.group(1)}:00'

    return None


def _v2243_slot_start(slot):
    """Extract HH:MM from one Euskalmet hourly interval descriptor."""
    if not isinstance(slot,dict):
        return None

    # Observed API structure:
    #   "range": "LocalTime:[12:00:00.000..12:09:59.999]"
    #   "rangeDesc": "12:00 - 12:09"
    for key in ('range','rangeDesc','lowerEndpointDesc','lowerEndpoint'):
        value=slot.get(key)
        if value is None:
            continue
        m=re.search(r'([01]\d|2[0-3]):([0-5]\d)',str(value))
        if m:
            return f'{m.group(1)}:{m.group(2)}'
    return None

def _v2243_slot_points(payload):
    """Parse the real Euskalmet hourly payload: parallel `slots` + `values`.

    Example discovered for C023 temperature at /.../2026/08/20/12:
      slots  = 12:00-12:09, 12:10-12:19, ... 12:50-12:59
      values = [20.64, 20.37, 20.51, 20.36, 20.44, 20.33]

    Returns 10-minute observations as (HH:MM, value, source_path).
    """
    points=[]

    def visit(node,path=''):
        if isinstance(node,str):
            s=node.strip()
            if s and s[:1] in '[{':
                try:
                    visit(json.loads(s),path)
                except Exception:
                    pass
            return

        if isinstance(node,list):
            for i,v in enumerate(node):
                visit(v,f'{path}[{i}]')
            return

        if not isinstance(node,dict):
            return

        slots=node.get('slots')
        values=node.get('values')

        # Some API variants can stringify either collection.
        if isinstance(slots,str):
            try: slots=json.loads(slots)
            except Exception: pass
        if isinstance(values,str):
            try: values=json.loads(values)
            except Exception: pass

        if isinstance(slots,list) and isinstance(values,list):
            for i,(slot,value) in enumerate(zip(slots,values)):
                hhmm=_v2243_slot_start(slot)
                num=_v222_num(value)
                if hhmm is not None and num is not None:
                    points.append((
                        hhmm,
                        float(num),
                        f'{path}.values[{i}]' if path else f'values[{i}]'
                    ))

        for k,v in node.items():
            visit(v,f'{path}.{k}' if path else str(k))

    visit(payload)

    seen=set()
    out=[]
    for hhmm,val,path in points:
        key=(hhmm,round(float(val),8))
        if key not in seen:
            seen.add(key)
            out.append((hhmm,float(val),path))
    out.sort(key=lambda x:x[0])
    return out

def _v224_value_from_payload(payload):
    """Find the most plausible measured value in a leaf reading payload."""
    candidates=[]

    def visit(node,path=''):
        if isinstance(node,str):
            s=node.strip()
            if s and s[:1] in '[{':
                try:
                    visit(json.loads(s),path)
                    return
                except Exception:
                    pass
            return
        if isinstance(node,list):
            for i,v in enumerate(node):
                visit(v,f'{path}[{i}]')
            return
        if not isinstance(node,dict):
            return

        for k,v in node.items():
            num=_v222_num(v)
            if num is None:
                continue
            nk=str(k).lower().replace('_','').replace('-','')
            p=(path+'.'+str(k) if path else str(k)).lower()
            score=0
            if nk in ('value','measurement','measuredvalue','reading','data'):
                score += 1000
            if 'value' in nk or 'measurement' in nk or 'reading' in nk:
                score += 700
            if any(bad in p for bad in (
                'numericid','entityversion','stationid','sensorid','measureid',
                'measuretype','year','month','day','hour','minute','timestamp',
                'latitude','longitude','altitude','count','code','version'
            )):
                score -= 900
            candidates.append((score,path+'.'+str(k),float(num)))

        for k,v in node.items():
            visit(v,f'{path}.{k}' if path else str(k))

    visit(payload)
    if not candidates:
        return None,None
    candidates.sort(key=lambda x:(x[0],-len(x[1])),reverse=True)
    best=candidates[0]
    if best[0] < 0:
        return None,None
    return best[2],best[1]

async def _v224_follow_key(key,max_depth=4):
    """Follow one Euskalmet reading resource until a numeric reading is found.

    Returns list of (HH:MM,value,path). A resource may expand from:
      day -> 24 hourly keys -> minute keys -> leaf reading.
    """
    results=[]
    visited=set()

    async def walk_key(k,depth):
        path=_v224_api_path_from_key(k)
        if path in visited or depth>max_depth:
            return
        visited.add(path)

        payload=await api_get(path)

        # V22.4.3: real hourly Euskalmet payload uses parallel slots + values.
        pts=_v2243_slot_points(payload)
        if pts:
            results.extend(pts)
            return

        # Fallback for other API response shapes.
        pts=_v222_extract_points(payload)
        if pts:
            results.extend(pts)
            return

        child_keys=_v224_keys(payload)
        if child_keys:
            # Ramas independientes en paralelo; reduce la latencia de lectura.
            await asyncio.gather(*(walk_key(ck,depth+1) for ck in child_keys))
            return

        # Leaf object with no explicit timestamp: infer time from resource key.
        hhmm=_v224_time_from_key(k)
        value,value_path=_v224_value_from_payload(payload)
        if hhmm and value is not None:
            results.append((hhmm,float(value),f'{path}:{value_path}'))

    await walk_key(key,0)

    seen=set()
    clean=[]
    for hhmm,val,path in results:
        item=(hhmm,round(float(val),8))
        if item not in seen:
            seen.add(item)
            clean.append((hhmm,float(val),path))
    clean.sort(key=lambda x:x[0])
    return clean

async def _v224_day_index(station,sensor,measure_type,measure_id,day):
    """Get the day index; cache only its structural keys, not live leaf values."""
    cache_key=(station,str(sensor),str(measure_type),str(measure_id),day.isoformat())
    now=time.time()
    hit=_V221052_DAY_INDEX_CACHE.get(cache_key)
    if hit and now-float(hit[0]) < _V221052_DAY_INDEX_TTL:
        return hit[1],hit[2],list(hit[3])
    path=(
        f'/euskalmet/readings/forStation/{station}/{sensor}'
        f'/measures/{measure_type}/{measure_id}'
        f'/at/{day.year}/{day.month:02d}/{day.day:02d}'
    )
    payload=await api_get(path)
    keys=_v224_keys(payload)
    _V221052_DAY_INDEX_CACHE[cache_key]=(now,path,payload,list(keys))
    return path,payload,keys

async def _v224_measure_at_noon(station,sensor,measure_type,measure_id,day):
    """Follow only the hour nearest noon, then extract minute-level values."""
    path,payload,keys=await _v224_day_index(
        station,sensor,measure_type,measure_id,day
    )
    if not keys:
        # Some API versions may return values directly.
        pts=_v222_extract_points(payload)
        val,tm,_=_v222_nearest(
            pts,V22_NOON_HOUR,V22_NOON_TOLERANCE_MIN
        )
        if val is not None:
            return val,tm,{'day_endpoint':path,'direct_points':len(pts)}
        raise RuntimeError(f'V22.4.3 índice diario sin claves para {measure_id}: {path}')

    target=V22_NOON_HOUR*60
    ranked=[]
    for k in keys:
        tm=_v224_time_from_key(k)
        if tm is None:
            continue
        hh,mm=map(int,tm.split(':'))
        ranked.append((abs(hh*60+mm-target),k))
    ranked.sort(key=lambda x:x[0])

    attempts=[]
    for _,key in ranked[:3]:
        pts=await _v224_follow_key(key,max_depth=4)
        val,tm,pth=_v222_nearest(
            pts,V22_NOON_HOUR,V22_NOON_TOLERANCE_MIN
        )
        attempts.append({
            'key':key,
            'points_found':len(pts),
            'sample':pts[:10],
        })
        if val is not None:
            return val,tm,{
                'day_endpoint':path,
                'chosen_hour_key':key,
                'leaf_path':pth,
                'attempts':attempts,
            }

    raise RuntimeError(json.dumps({
        'message':f'V22.4.3 no pudo extraer lectura próxima a mediodía de {measure_id}',
        'day_endpoint':path,
        'attempts':attempts,
    },ensure_ascii=False))

async def _v224_rain24(station,sensor_today,mt_today,mid_today,
                       sensor_prev,mt_prev,mid_prev,day):
    """Accumulate 10-min precipitation in (previous 12:00, current 12:00].

    V22.4.3 filters individual 10-minute points, not whole hourly branches.
    This matches the historical reconstruction methodology.
    """
    prev_day=day-timedelta(days=1)
    _,_,prev_keys=await _v224_day_index(
        station,sensor_prev,mt_prev,mid_prev,prev_day
    )
    _,_,today_keys=await _v224_day_index(
        station,sensor_today,mt_today,mid_today,day
    )

    target=V22_NOON_HOUR*60
    total=0.0
    n=0
    details=[]

    # Include previous-day hour 12 because its 12:10..12:50 slots are > noon.
    # Include current-day hour 12 because only its 12:00 slot is <= noon.
    branches=[]
    for src_day,keys in ((prev_day,prev_keys),(day,today_keys)):
        for key in keys:
            tm=_v224_time_from_key(key)
            if tm is None:
                continue
            hh,mm=map(int,tm.split(':'))
            hour_minute=hh*60+mm
            if src_day==prev_day and hour_minute >= target:
                branches.append((src_day,key))
            elif src_day==day and hour_minute <= target:
                branches.append((src_day,key))

    for src_day,key in branches:
        pts=await _v224_follow_key(key,max_depth=4)
        subtotal=0.0
        accepted=0

        for hhmm,val,_ in pts:
            hh,mm=map(int,hhmm.split(':'))
            minute=hh*60+mm

            include = (
                (src_day==prev_day and minute > target)
                or
                (src_day==day and minute <= target)
            )
            if not include:
                continue

            v=float(val)
            if 0.0 <= v <= 100.0:
                subtotal += v
                total += v
                accepted += 1
                n += 1

        details.append({
            'day':src_day.isoformat(),
            'key':key,
            'points_found':len(pts),
            'accepted':accepted,
            'subtotal':round(subtotal,4),
        })

    if n==0:
        raise RuntimeError(json.dumps({
            'message':'V22.4.3 no encontró precipitación 10-min en la ventana de 24 h',
            'branches':len(branches),
            'details':details,
        },ensure_ascii=False))

    return total,n,details


async def _v222_mapping(station,day):
    now=time.time()
    hit=_V221052_MAPPING_CACHE.get(station)
    if hit and now-float(hit[0]) < _V221052_MAPPING_TTL:
        return dict(hit[1])

    # Primero reutilizamos el sensor_map persistido. Esto evita que cada arranque
    # tenga que consultar /stations/current + /sensors/* y disparar el rate limit
    # de Euskalmet antes de poder leer las observaciones de las cinco estaciones.
    cached_mapping={}
    for var in TARGETS:
        row=cached(station,var)
        if row:
            cached_mapping[var]=(str(row['sensor_id']),str(row['measure_type_id']),str(row['measure_id']))
    if len(cached_mapping)==len(TARGETS):
        _V221052_MAPPING_CACHE[station]=(now,dict(cached_mapping))
        return cached_mapping

    detail=await station_payload_for_day(station,day)
    mapping=await discover_daily_mapping(station,day,detail)
    for var in TARGETS:
        if var not in mapping:
            row=cached(station,var)
            if row:
                mapping[var]=(str(row['sensor_id']),str(row['measure_type_id']),str(row['measure_id']))
    missing=[v for v in TARGETS if v not in mapping]
    if missing:
        raise RuntimeError(f'V22.2 no pudo resolver sensor/medida para {station}: {missing}')
    _V221052_MAPPING_CACHE[station]=(now,dict(mapping))
    return mapping

def _v222_nearest(points,target_hour=12,tolerance_min=40):
    """Select the intraday point nearest to target_hour within tolerance. V22.4.5a default tolerance=75 min."""
    target=target_hour*60
    best=None
    for hhmm,val,path in points:
        try:
            hh,mm=map(int,hhmm.split(':'))
        except Exception:
            continue
        delta=abs(hh*60+mm-target)
        if best is None or delta<best[0]:
            best=(delta,hhmm,float(val),path)
    if best is None or best[0]>tolerance_min:
        return None,None,None
    return best[2],best[1],best[3]

async def _v222_recent_api_weather(station,day):
    """V22.4 recent acquisition following day->hour->minute API keys."""
    mapping_today=await _v222_mapping(station,day)
    mapping_prev=await _v222_mapping(station,day-timedelta(days=1))

    values={}
    meta={}

    for var in ('temperature','humidity','wind_kmh'):
        sensor,mt,mid=mapping_today[var]
        val,tm,info=await _v224_measure_at_noon(
            station,sensor,mt,mid,day
        )
        values[var]=val
        meta[var]={'time':tm,**info}

    # Wind measure is m/s in this project/API.
    wind_kmh=max(0.0,float(values['wind_kmh'])*3.6)

    st,mt,mid=mapping_today['rain_mm']
    sp,mtp,midp=mapping_prev['rain_mm']
    rain24,rain_n,rain_details=await _v224_rain24(
        station,st,mt,mid,sp,mtp,midp,day
    )

    _,direction=await web_summary_wind(station,day)

    return {
        'source':'Euskalmet API recursive readings',
        'temperature':round(float(values['temperature']),2),
        'temperature_time':meta['temperature']['time'],
        'humidity':round(max(0.0,min(100.0,float(values['humidity']))),2),
        'humidity_time':meta['humidity']['time'],
        'wind_kmh':round(wind_kmh,2),
        'wind_time':meta['wind_kmh']['time'],
        'rain24':round(max(0.0,float(rain24)),2),
        'rain_points':rain_n,
        'direction':round(direction,1) if direction is not None else None,
        'meta':{
            'temperature':meta['temperature'],
            'humidity':meta['humidity'],
            'wind':meta['wind_kmh'],
            'rain_details':rain_details,
        }
    }


async def _v222_archive_weather(station,day):
    """Fallback for historical days from annual raw XML archive."""
    raw=await _v221_raw_days(station,day)
    prev_day=(day-timedelta(days=1)).isoformat()
    current_day=day.isoformat()
    previous_obs=raw.get(prev_day,[])
    current_obs=raw.get(current_day,[])

    if not current_obs:
        raise RuntimeError(
            f'Archivo anual sin lecturas XML para {station} {current_day}'
        )

    t,t_time=_v221_nearest(
        current_obs,'temperature',V22_NOON_HOUR,V22_NOON_TOLERANCE_MIN
    )
    rh,rh_time=_v221_nearest(
        current_obs,'humidity',V22_NOON_HOUR,V22_NOON_TOLERANCE_MIN
    )
    wind_ms,w_time=_v221_nearest(
        current_obs,'wind_ms',V22_NOON_HOUR,V22_NOON_TOLERANCE_MIN
    )
    rain24,rain_count=_v221_rain24(
        previous_obs,current_obs,V22_NOON_HOUR
    )

    if None in (t,rh,wind_ms,rain24):
        raise RuntimeError(
            f'Archivo anual incompleto para FWI mediodía: {station} {current_day}'
        )

    _,direction=await web_summary_wind(station,day)

    return {
        'source':'Euskalmet annual raw XML archive',
        'temperature':round(float(t),2),
        'temperature_time':t_time,
        'humidity':round(max(0.0,min(100.0,float(rh))),2),
        'humidity_time':rh_time,
        'wind_kmh':round(max(0.0,float(wind_ms)*3.6),2),
        'wind_time':w_time,
        'rain24':round(max(0.0,float(rain24)),2),
        'rain_points':rain_count,
        'direction':round(direction,1) if direction is not None else None,
        'meta':{
            'raw_previous_day_points':len(previous_obs),
            'raw_current_day_points':len(current_obs),
        }
    }

async def v22_noon_weather(station,day):
    """V22.5 hybrid acquisition with deterministic historical source selection.

    Completed historical days use the authenticated Euskalmet API first, matching
    the original project path. The annual raw XML archive is a bounded fallback
    so a slow archive download cannot block Render startup.

    The FWI methodology is identical in both branches:
      nearest T/RH/wind observation to 12:00 + previous 24 h precipitation.
    """
    attempts=[]

    if day < date.today():
        # Historical API first: it was the original project path and avoids
        # downloading/parsing a full annual ZIP on every Render cold start.
        try:
            rec=await asyncio.wait_for(
                _v222_recent_api_weather(station,day),
                timeout=float(os.getenv('EUSKALMET_HISTORICAL_API_TIMEOUT','30'))
            )
            chosen='api'
        except Exception as api_exc:
            attempts.append({
                'source':'api',
                'error':f'{type(api_exc).__name__}: {api_exc}'
            })
            try:
                rec=await asyncio.wait_for(_v222_archive_weather(station,day), timeout=90)
                chosen='annual_xml'
            except Exception as xml_exc:
                attempts.append({
                    'source':'annual_xml',
                    'error':f'{type(xml_exc).__name__}: {xml_exc}'
                })
                raise RuntimeError(
                    f'V22.5 no pudo obtener datos históricos para {station} '
                    f'{day.isoformat()}. '
                    f'Fallo API: {attempts[0]["error"]} | '
                    f'Fallo XML: {attempts[1]["error"]}'
                )
    else:
        try:
            rec=await _v222_recent_api_weather(station,day)
            chosen='api'
        except Exception as api_exc:
            attempts.append({
                'source':'api',
                'error':f'{type(api_exc).__name__}: {api_exc}'
            })
            try:
                rec=await _v222_archive_weather(station,day)
                chosen='annual_xml'
            except Exception as xml_exc:
                attempts.append({
                    'source':'annual_xml',
                    'error':f'{type(xml_exc).__name__}: {xml_exc}'
                })
            try:
                debug_dir=BASE_DIR/'v22_debug'
                debug_dir.mkdir(exist_ok=True)
                (debug_dir/f'{station}_{day.isoformat()}_v22_4_3b_fail.json').write_text(
                    json.dumps({
                        'model':'V22.5 hybrid',
                        'station':station,
                        'day':day.isoformat(),
                        'attempts':attempts,
                    },ensure_ascii=False,indent=2),
                    encoding='utf-8'
                )
            except Exception:
                pass
            raise RuntimeError(
                f'V22.5 no pudo obtener datos mediodía para {station} '
                f'{day.isoformat()}. '
                f'Fallo API: {attempts[0]["error"] if attempts else "desconocido"} | '
                f'Fallback XML: {attempts[1]["error"] if len(attempts)>1 else "no ejecutado"}'
            )

    debug={
        'model':'V22.5 hybrid',
        'station':station,
        'day':day.isoformat(),
        'chosen_source':chosen,
        'source':rec['source'],
        'observation_hour':V22_NOON_HOUR,
        'temperature_C':rec['temperature'],
        'temperature_time':rec['temperature_time'],
        'humidity_pct':rec['humidity'],
        'humidity_time':rec['humidity_time'],
        'wind_kmh':rec['wind_kmh'],
        'wind_time':rec['wind_time'],
        'rain_previous_24h_mm':rec['rain24'],
        'rain_points':rec['rain_points'],
        'daily_vectorial_direction_deg':rec['direction'],
        'fallback_attempts':attempts,
        'meta':rec.get('meta',{}),
    }

    try:
        debug_dir=BASE_DIR/'v22_debug'
        debug_dir.mkdir(exist_ok=True)
        (debug_dir/f'{station}_{day.isoformat()}_v22_4_3b_noon.json').write_text(
            json.dumps(debug,ensure_ascii=False,indent=2),
            encoding='utf-8'
        )
    except Exception:
        pass

    return (
        rec['temperature'],
        rec['humidity'],
        rec['wind_kmh'],
        rec['rain24'],
        rec['direction'],
    )

def ire_gip_level(value):
    if value < 5: return 'Bajo'
    if value < 10: return 'Moderado'
    if value < 20: return 'Alto'
    if value < 35: return 'Muy alto'
    return 'Extremo'

def ire_gip_season(day):
    """Return (season_name, factor) for the Gipuzkoa cantabrian MVP."""
    md=(day.month,day.day)
    if md >= (9,15) or md <= (4,15):
        return 'Alta',1.20
    if (6,15) <= md <= (9,14):
        return 'Media',1.00
    return 'Baja',0.85

def ire_gip_season_factor(day):
    return ire_gip_season(day)[1]


def south_component(direction_deg):
    """0 for no southerly component, 1 for pure south (180°)."""
    if direction_deg is None:
        return 0.0
    return max(0.0,-math.cos(math.radians(float(direction_deg)%360.0)))

def wind_cardinal(direction_deg):
    if direction_deg is None:
        return None
    labels=('N','NE','E','SE','S','SO','O','NO')
    d=float(direction_deg)%360.0
    return labels[int((d+22.5)//45)%8]

def ire_gip_wind_factor(direction_deg, wind_kmh):
    """BASUGIX V21 optimizada: corrector regional de dirección.

    Parámetros seleccionados tras validación histórica EGIF + Euskalmet
    (Gipuzkoa 2010-2025):

        centro = 180° (Sur)
        A = 0.12
        p = 1.5

        F_dir = 1 + A * max(0, -cos(theta))**p

    Motivo de mantener A=0.12:
    - A=0.10 y A=0.12 maximizan la captura de días-incendio dentro del
      10% de días con mayor índice (~37.0% frente a 35.8% del FWI solo).
    - A=0.12 mejora la sensibilidad Alto+ con un incremento pequeño de
      días promovidos (163 de ~27.900; ~0.58%).
    - A>0.15 aumenta más las alertas pero no mejora de forma estable la
      captura en el top 10%, y pierde eficiencia marginal.
    - La dirección aporta señal adicional aun controlando por FWI, pero
      no se traduce el OR histórico directamente a un multiplicador.

    wind_kmh se conserva por compatibilidad, pero no entra otra vez en
    F_dir porque la velocidad ya está incorporada en el FWI.
    """
    if direction_deg is None:
        return 1.0

    theta=float(direction_deg)%360.0
    south=max(0.0, -math.cos(math.radians(theta)))

    A=0.12
    p=1.5
    return 1.0 + A*(south**p)


def ire_gip_wind_debug(direction_deg, wind_kmh):
    """Diagnostic values for the V21 experimental direction factor."""
    if direction_deg is None:
        return {
            'direction_deg':None,
            'direction_cardinal':'—',
            'wind_kmh':round(max(0.0,float(wind_kmh)),2),
            'south_component':0.0,
            'exponent_p':1.5,
            'max_direction_increment':0.12,
            'increment':0.0,
            'wind_factor':1.0,
            'formula':'sin dirección -> 1.0000',
            'note':'La velocidad no modifica F_dir en V21.'
        }

    theta=float(direction_deg)%360.0
    speed=max(0.0,float(wind_kmh))
    south=max(0.0, -math.cos(math.radians(theta)))
    A=0.12
    p=1.5
    increment=A*(south**p)
    factor=1.0+increment

    return {
        'direction_deg':round(theta,1),
        'direction_cardinal':wind_cardinal(theta),
        'wind_kmh':round(speed,2),
        'south_component':round(south,4),
        'exponent_p':p,
        'max_direction_increment':A,
        'increment':round(increment,4),
        'wind_factor':round(factor,4),
        'formula':f'1 + 0.12 × ({south:.4f} ^ 1.5) = {factor:.4f}',
        'note':'V21 optimizada: A=0.12 y p=1.5 retenidos tras validación histórica; la velocidad permanece solo en FWI.'
    }

def _norm_text(v):
    return str(v).strip().lower().replace('_',' ').replace('-',' ')

def _numeric(v):
    if isinstance(v,(int,float)):
        return float(v)
    if isinstance(v,str):
        try:
            return float(v.replace(',','.'))
        except Exception:
            return None
    return None

def _extract_daily_value(payload, *, reject_mean=False):
    """Extract the daily value/statistic from a summarized response.

    For mean_direction, reject the arithmetic `mean` field. For a dedicated
    vector-direction measure, prefer `value` / explicit vector fields.
    """
    candidates=[]

    def visit(obj,path=''):
        if isinstance(obj,dict):
            for k,v in obj.items():
                num=_numeric(v)
                p=(path+'.'+str(k) if path else str(k))
                nk=_norm_text(k)
                pl=p.lower().replace('_','').replace('-','')

                if num is not None and 0.0 <= num <= 360.0:
                    if any(x in pl for x in (
                        'numericid','entityversion','sensorid','stationid',
                        'measureid','measuretype','timestamp','count',
                        'year','month','day','code','sigma'
                    )):
                        pass
                    else:
                        if reject_mean and nk in ('mean','media','average','avg'):
                            pass
                        else:
                            score=0
                            if 'vector' in pl or 'vectorial' in pl:
                                score += 600
                            if nk in ('value','valor','measurement','measured value','measuredvalue','data'):
                                score += 400
                            if 'direction' in pl or 'direccion' in pl or 'dirección' in pl:
                                score += 250
                            if 'mean' in pl or 'media' in pl or 'average' in pl:
                                score += 120
                            candidates.append((score,p,float(num)))

                visit(v,p)

        elif isinstance(obj,list):
            for i,v in enumerate(obj):
                visit(v,f'{path}[{i}]')

    visit(payload)

    if not candidates:
        return None

    candidates.sort(key=lambda x:(x[0],-len(x[1])),reverse=True)
    return candidates[0][2]

def _measure_priority(measure_id):
    m=_norm_text(measure_id)
    score=0
    # Dedicated vectorial direction measures are exactly what we want.
    if 'vector' in m or 'vectorial' in m:
        score += 1000
    if 'direction' in m or 'direccion' in m or 'dirección' in m:
        score += 500
    if 'mean' in m or 'media' in m:
        score += 200
    # Arithmetic mean_direction is diagnostic fallback only.
    if m == 'mean direction':
        score -= 800
    return score



def _maybe_json(value):
    if isinstance(value,str):
        s=value.strip()
        if s and s[0] in '[{':
            try:
                return json.loads(s)
            except Exception:
                return value
    return value

def _eid(obj):
    """Extract nested Euskalmet entity id, e.g. {'_id':'mean_speed'}."""
    obj=_maybe_json(obj)
    if isinstance(obj,dict):
        for key in ('_id','id','name'):
            if key in obj:
                return str(obj[key])
    if isinstance(obj,str):
        return obj
    return None

def _summary_items(payload):
    """Decode the real summaryData `_items` collection."""
    if not isinstance(payload,dict):
        return []

    items=payload.get('_items',payload.get('items'))
    items=_maybe_json(items)

    if isinstance(items,dict):
        items=list(items.values())
    if not isinstance(items,list):
        return []

    return [x for x in items if isinstance(x,dict)]

def _summary_item(payload,station,measure_id):
    station=station.upper()
    target=_norm_text(measure_id)
    candidates=[]

    for item in _summary_items(payload):
        mid=_eid(item.get('_measureId',item.get('measureId')))
        sid=_eid(item.get('_stationId',item.get('stationId')))
        mtype=_eid(item.get('_measureType',item.get('measureType')))

        if _norm_text(mid or '') != target:
            continue

        score=0
        if (sid or '').upper()==station:
            score += 100
        if _norm_text(mtype or '')==_norm_text('measuresForWind'):
            score += 30
        candidates.append((score,item))

    if not candidates:
        return None

    candidates.sort(key=lambda x:x[0],reverse=True)
    return candidates[0][1]

def _summary_fields(item):
    """Return the raw `_summary` fields as ordinary Python values."""
    if not isinstance(item,dict):
        return {}

    summary=_maybe_json(item.get('_summary',item.get('summary',{})))
    if not isinstance(summary,dict):
        return {}

    out={}
    for k,v in summary.items():
        vv=_maybe_json(v)

        # Values such as {'_value': 5.8, ...} or {'value': 5.8}.
        if isinstance(vv,dict):
            chosen=None
            for kk in ('_value','value','_mean','mean'):
                if kk in vv:
                    chosen=vv[kk]
                    break
            out[k]=chosen if chosen is not None else vv
        else:
            out[k]=vv
    return out

def _summary_measure_blocks(payload):
    """Find every measure block in Euskalmet summaryData.

    Handles dictionaries/lists and also JSON strings nested inside the response.
    We only require a `name`; data is resolved separately.
    """
    out=[]

    def visit(node):
        if isinstance(node,str):
            s=node.strip()
            if s and s[0] in '[{':
                try:
                    visit(json.loads(s))
                except Exception:
                    pass
            return

        if isinstance(node,dict):
            if isinstance(node.get('name'),str):
                out.append(node)
            for v in node.values():
                visit(v)
            return

        if isinstance(node,list):
            for v in node:
                visit(v)

    visit(payload)
    return out

def _summary_block(payload,station,measure_name):
    """Return block by exact measure name.

    `station` is used as preference, not as a hard requirement, because some
    summaryData variants omit/move the station field.
    """
    target=_norm_text(measure_name)
    station=station.upper()

    candidates=[]
    for block in _summary_measure_blocks(payload):
        if _norm_text(block.get('name','')) != target:
            continue

        bstation=str(block.get('station','')).upper()
        score=0
        if bstation == station:
            score += 100
        if isinstance(block.get('data'),dict):
            score += 50
        candidates.append((score,block))

    if not candidates:
        return None

    candidates.sort(key=lambda x:x[0],reverse=True)
    return candidates[0][1]

def _find_data_dict(block):
    """Locate the time-series `data` object even if nested one level differently."""
    if not isinstance(block,dict):
        return None
    if isinstance(block.get('data'),dict):
        return block['data']

    found=None
    def visit(node):
        nonlocal found
        if found is not None:
            return
        if isinstance(node,dict):
            if isinstance(node.get('data'),dict):
                found=node['data']
                return
            for v in node.values():
                visit(v)
        elif isinstance(node,list):
            for v in node:
                visit(v)
    visit(block)
    return found


def _summary_series(block):
    vals=[]
    if not isinstance(block,dict):
        return vals

    def visit(node):
        if isinstance(node,dict):
            pairs=[]
            for k,v in node.items():
                if isinstance(k,str) and re.fullmatch(r'\d{2}:\d{2}',k):
                    try:
                        pairs.append((k,float(str(v).replace(',','.'))))
                    except Exception:
                        pass
            if pairs:
                vals.extend(pairs)
            for v in node.values():
                visit(v)
        elif isinstance(node,list):
            for v in node:
                visit(v)

    visit(_find_data_dict(block))

    seen=set()
    out=[]
    for item in vals:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out

def _vector_mean_degrees(values):
    if not values:
        return None
    s=sum(math.sin(math.radians(v % 360.0)) for v in values)
    c=sum(math.cos(math.radians(v % 360.0)) for v in values)
    if abs(s)<1e-12 and abs(c)<1e-12:
        return None
    return (math.degrees(math.atan2(s,c))+360.0)%360.0

async def web_summary_payload(station,day):
    """Lee el summaryData JSON con cabeceras equivalentes a la web de Euskalmet."""
    url=(
        f'https://www.euskalmet.euskadi.eus/vamet/stations/readings/'
        f'{station}/{day.year}/{day.month:02d}/{day.day:02d}/'
        f'webmet00-summaryData.json'
    )

    headers={
        'Accept':'application/json, text/javascript, */*; q=0.01',
        'Accept-Language':'es-ES,es;q=0.9',
        'Referer':'https://www.euskalmet.euskadi.eus/observacion/datos-de-estaciones/',
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                     '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'X-Requested-With':'XMLHttpRequest',
        'Cache-Control':'no-cache',
        'Pragma':'no-cache',
    }

    async with httpx.AsyncClient(timeout=30.0,follow_redirects=True) as client:
        r=await client.get(url,headers=headers)

        # Persist raw response for exact diagnosis.
        try:
            debug_dir=BASE_DIR/'wind_debug'
            debug_dir.mkdir(exist_ok=True)
            raw_meta={
                'url':url,
                'status_code':r.status_code,
                'content_type':r.headers.get('content-type'),
                'content_length':len(r.content),
                'response_headers':dict(r.headers),
                'text_prefix':r.text[:2000],
            }
            (debug_dir/f'{station}_{day.isoformat()}_summaryData_HTTP.json').write_text(
                json.dumps(raw_meta,ensure_ascii=False,indent=2),
                encoding='utf-8'
            )
        except Exception:
            pass

        if r.status_code!=200:
            raise RuntimeError(f'summaryData HTTP {r.status_code}: {url}')

        try:
            payload=r.json()
        except Exception as exc:
            raise RuntimeError(
                f'summaryData no devolvió JSON. Content-Type={r.headers.get("content-type")}, '
                f'bytes={len(r.content)}. URL={url}'
            ) from exc

        if isinstance(payload,str):
            try:
                payload=json.loads(payload)
            except Exception:
                pass

        if payload in ({},[],None,''):
            raise RuntimeError(
                f'summaryData devolvió JSON vacío para {station} {day.isoformat()}. '
                f'Respuesta guardada en wind_debug/'
                f'{station}_{day.isoformat()}_summaryData_HTTP.json'
            )

        return payload


async def web_summary_wind(station,day):
    """V19: usa directamente los estadísticos diarios que ya publica Euskalmet.

    Velocidad media diaria:
      mean_speed -> _summary.mean -> m/s -> km/h.

    Dirección media diaria:
      vectorial_mean_direction -> _summary.mean -> grados.

    No se calcula ninguna media vectorial en la aplicación.
    """
    payload=await web_summary_payload(station,day)

    # ---------------------------------------------------------
    # Velocidad media diaria
    # ---------------------------------------------------------
    speed_item=_summary_item(payload,station,'mean_speed')
    if speed_item is None:
        raise RuntimeError(f'summaryData no contiene mean_speed para {station}')

    speed_summary=_summary_fields(speed_item)
    raw_speed_mean=speed_summary.get('_mean')
    if raw_speed_mean is None:
        raw_speed_mean=speed_summary.get('mean')

    if isinstance(raw_speed_mean,dict):
        raw_speed_mean=raw_speed_mean.get('_value',raw_speed_mean.get('value'))

    try:
        raw_speed_mean=float(raw_speed_mean)
    except Exception:
        raise RuntimeError(
            f'No se pudo leer _summary.mean de mean_speed para {station}. '
            f'Summary={speed_summary}'
        )

    speed_kmh=raw_speed_mean*3.6

    # ---------------------------------------------------------
    # Dirección media vectorial diaria PUBLICADA POR EUSKALMET
    # ---------------------------------------------------------
    direction_item=_summary_item(payload,station,'vectorial_mean_direction')
    if direction_item is None:
        raise RuntimeError(
            f'summaryData no contiene vectorial_mean_direction para {station}'
        )

    direction_summary=_summary_fields(direction_item)
    direction_deg=direction_summary.get('_mean')
    if direction_deg is None:
        direction_deg=direction_summary.get('mean')

    if isinstance(direction_deg,dict):
        direction_deg=direction_deg.get('_value',direction_deg.get('value'))

    try:
        direction_deg=float(direction_deg)%360.0
    except Exception:
        raise RuntimeError(
            f'No se pudo leer _summary.mean de vectorial_mean_direction '
            f'para {station}. Summary={direction_summary}'
        )

    # Diagnóstico mínimo.
    try:
        debug_dir=BASE_DIR/'wind_debug'
        debug_dir.mkdir(exist_ok=True)
        rec={
            'station':station,
            'day':day.isoformat(),
            'source':'webmet00-summaryData.json',
            'mean_speed_raw_ms':round(raw_speed_mean,6),
            'mean_speed_kmh':round(speed_kmh,3),
            'vectorial_mean_direction_deg':round(direction_deg,3),
        }
        (debug_dir/f'{station}_{day.isoformat()}_wind_v19.json').write_text(
            json.dumps(rec,ensure_ascii=False,indent=2),
            encoding='utf-8'
        )
    except Exception:
        pass

    return round(speed_kmh,2),round(direction_deg,1)


async def resolve_daily_wind_direction(station, day, detail):
    _,direction=await web_summary_wind(station,day)
    return direction


def demo_weather(station,day):
    r=random.Random(f'v2-{station}-{day}'); season=14+8*math.sin((day.timetuple().tm_yday-110)/365*2*math.pi)
    vals=(season+r.uniform(-3,5),r.uniform(35,88),r.uniform(4,34),0 if r.random()<.58 else max(0,r.gauss(2,4.5)))
    with con() as c:
        c.execute('INSERT OR IGNORE INTO stations(station_id,name,municipality,province,updated_at) VALUES(?,?,?,?,?)',(station,'Demo '+station,'Euskadi','',datetime.now().isoformat(timespec='seconds'))); c.commit()
    return tuple(round(x,2) for x in vals)

def prev_state(station,day):
    with con() as c:
        r=c.execute('SELECT ffmc,dmc,dc FROM fwi_daily WHERE station_id=? AND day<? ORDER BY day DESC LIMIT 1',(station,day.isoformat())).fetchone()
    return (r['ffmc'],r['dmc'],r['dc']) if r else INITIAL


# ============================================================
# V22.10 — MOTOR OPERATIVO 12:00
#
# Criterio definitivo candidato:
#   T, HR y velocidad del viento = observación EXACTA de las 12:00
#   precipitación = suma de las lecturas de 10 min observadas en
#                   (12:00 del día anterior, 12:00 del día actual]
#
# Huecos de lluvia:
#   NO se rellenan con 0
#   NO se interpolan
#   se suma únicamente lo observado
#   se guarda cobertura y etiqueta de calidad
#
# Dirección del viento:
#   se mantiene el origen diario ya utilizado por el proyecto.
# ============================================================

def _v2210_quality(points):
    try:
        present=int(points)
    except Exception:
        present=0
    present=max(0,min(144,present))
    missing=144-present
    coverage=round(100.0*present/144.0,2)
    if missing==0:
        label='Completo'
    elif missing<=3:
        label='Hueco menor'
    elif missing<=12:
        label='Hueco relevante'
    else:
        label='Cobertura insuficiente'
    return {
        'rain_points_present':present,
        'rain_points_missing':missing,
        'rain_coverage_pct':coverage,
        'rain_quality':label,
    }



V22101_FALLBACK_MIN = int(os.getenv('V22101_FALLBACK_MIN', '30'))

async def _v22101_measure_exact_or_fallback(station, day, var, target_hhmm='12:00',
                                            tolerance_min=V22101_FALLBACK_MIN):
    """
    Política V22.10.2:
      1) usar 12:00 exacto si existe;
      2) si no existe, usar la lectura más próxima dentro de ±tolerance_min;
      3) si tampoco existe en ±30 min, usar la PRIMERA lectura disponible
         posterior a las 12:00, es decir, la primera observación cuando termina
         la desconexión/corte;
      4) sólo falla si no existe ninguna observación posterior en ese día.

    En empate dentro de ±30 min (p.ej. 11:50 y 12:10), se mantiene la
    preferencia por la anterior.
    """
    exact = await _v2294_exact_measure(station, day, var, target_hhmm)
    target_h, target_m = map(int, target_hhmm.split(':'))
    target_min = target_h * 60 + target_m

    if exact.get('ok'):
        return {
            **exact,
            'mode': 'exact',
            'selected_time': target_hhmm,
            'delta_min': 0,
            'fallback_used': False,
            'post_cut_fallback_used': False,
            'tolerance_min': tolerance_min,
        }

    mapping = await _v222_mapping(station, day)
    sensor, mt, mid = mapping[var]
    day_path, _, keys = await _v224_day_index(station, sensor, mt, mid, day)

    all_points = []
    for key in keys:
        key_tm = _v224_time_from_key(key)
        if key_tm is None:
            continue
        pts = await _v224_follow_key(key, max_depth=4)
        for hhmm, val, path in pts:
            try:
                hh, mm = map(int, hhmm.split(':'))
            except Exception:
                continue
            minute = hh * 60 + mm
            all_points.append({
                'time': hhmm,
                'raw_value': float(val),
                'source_path': path,
                'hour_key': key,
                'minute': minute,
                'delta_min': minute - target_min,
            })

    # Deduplicar.
    unique = []
    seen = set()
    for p in sorted(all_points, key=lambda x: (x['minute'], x['time'])):
        sig = (p['time'], round(p['raw_value'], 8))
        if sig not in seen:
            seen.add(sig)
            unique.append(p)

    # Fallback 1: lectura más próxima dentro de ±30 min.
    nearby = [p for p in unique if abs(p['delta_min']) <= tolerance_min]
    if nearby:
        nearby.sort(
            key=lambda p: (
                abs(p['delta_min']),
                0 if p['delta_min'] < 0 else 1,
                p['time']
            )
        )
        selected = nearby[0]
        mode = 'fallback_within_tolerance'
        post_cut = False
    else:
        # Fallback 2: primera lectura POSTERIOR a las 12:00,
        # sin límite de minutos dentro de ese mismo día.
        after = [p for p in unique if p['delta_min'] > 0]
        if not after:
            return {
                'ok': False,
                'variable': var,
                'target_time': target_hhmm,
                'mode': 'missing',
                'fallback_used': False,
                'post_cut_fallback_used': False,
                'tolerance_min': tolerance_min,
                'day_endpoint': day_path,
                'available_points': unique,
                'error': (
                    f'No existe observación a las {target_hhmm}, ni dentro de '
                    f'±{tolerance_min} min, ni ninguna observación posterior ese día'
                ),
            }
        after.sort(key=lambda p: (p['minute'], p['time']))
        selected = after[0]
        mode = 'fallback_first_after_cut'
        post_cut = True

    raw = float(selected['raw_value'])
    converted = raw * 3.6 if var == 'wind_kmh' else raw

    return {
        'ok': True,
        'variable': var,
        'target_time': target_hhmm,
        'selected_raw': round(raw, 6),
        'selected_value': round(converted, 6),
        'selected_time': selected['time'],
        'delta_min': int(selected['delta_min']),
        'fallback_used': True,
        'post_cut_fallback_used': post_cut,
        'mode': mode,
        'tolerance_min': tolerance_min,
        'unit_conversion': 'm/s -> km/h' if var == 'wind_kmh' else 'none',
        'source_path': selected['source_path'],
        'hour_key': selected['hour_key'],
        'available_points': unique,
    }



# ============================================================
# V22.10.5 — CACHÉ PERSISTENTE + ESTACIÓN GEOGRÁFICA DE RESPALDO
# ============================================================

V22105_CACHE_DIR = BASE_DIR / 'v22105_cache'
V22105_CACHE_DIR.mkdir(parents=True, exist_ok=True)
V22105_LIVE_CACHE_SECONDS = int(os.getenv('V22105_LIVE_CACHE_SECONDS', '1800'))


def _v22105_haversine_coords(lat1,lon1,lat2,lon2):
    lat1,lon1,lat2,lon2=map(math.radians,[lat1,lon1,lat2,lon2])
    dlat=lat2-lat1; dlon=lon2-lon1
    h=math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371.0088 * 2 * math.asin(min(1.0,math.sqrt(h)))

V22105_CATALOG_CACHE=BASE_DIR/'v22105_euskalmet_station_catalog.json'
V22105_CATALOG_TTL_SECONDS=int(os.getenv('V22105_CATALOG_TTL_SECONDS','86400'))
V22105_MAX_BACKUP_CANDIDATES=int(os.getenv('V22105_MAX_BACKUP_CANDIDATES','20'))

def _v221051_get(d,*names):
    if not isinstance(d,dict): return None
    nd={_norm(k):v for k,v in d.items()}
    for n in names:
        v=nd.get(_norm(n))
        if v not in (None,''): return v
    return None

def _v221051_float(v):
    try:
        return float(str(v).replace(',','.').strip())
    except Exception:
        return None

def _v221051_id(d):
    raw=_v221051_get(d,'stationId','station_id','stationCode','station_code','code','id')
    if raw is None: return None
    sid=str(raw).strip().upper()
    return sid if re.fullmatch(r'[A-Z]\d{3,4}',sid) else None

def _v221051_coords(d):
    lat=_v221051_float(_v221051_get(d,'latitude','latitud','lat'))
    lon=_v221051_float(_v221051_get(d,'longitude','longitud','lon','lng'))
    if lat is not None and lon is not None and 35<=lat<=46 and -10<=lon<=5:
        return lat,lon
    for k,v in d.items() if isinstance(d,dict) else []:
        if _norm(k) in ('coordinates','coordenadas') and isinstance(v,(list,tuple)) and len(v)>=2:
            a=_v221051_float(v[0]); b=_v221051_float(v[1])
            if a is not None and b is not None and 35<=b<=46 and -10<=a<=5:
                return b,a
        if isinstance(v,dict):
            c=_v221051_coords(v)
            if c: return c
    return None

def _v221051_parse_catalog(payload):
    out={}
    for d in walk(payload):
        if not isinstance(d,dict): continue
        sid=_v221051_id(d)
        if not sid: continue
        coords=_v221051_coords(d)
        if not coords: continue
        name=localized(_v221051_get(d,'name','stationName','nombre')) or sid
        out[sid]={
            'station_id':sid,'station_name':name,
            'lat':coords[0],'lon':coords[1]
        }
    return list(out.values())

V221052_CATALOG_XLSX_URL = (
    'https://opendata.euskadi.eus/contenidos/ds_meteorologicos/'
    'estaciones_meteorologicas/opendata/estaciones.xlsx'
)


def _v221052_xlsx_col(ref):
    """Convierte una referencia Excel (p. ej. AA12) a índice 0-based."""
    letters=''.join(ch for ch in str(ref) if ch.isalpha()).upper()
    n=0
    for ch in letters:
        n=n*26+(ord(ch)-64)
    return n-1 if n else None


def _v221052_parse_xlsx(raw_bytes):
    """Parsea el XLSX oficial sin dependencia externa (solo ZIP + XML stdlib)."""
    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
        shared=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            root=ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in root.iter():
                if si.tag.split('}')[-1] != 'si':
                    continue
                txt=''.join((t.text or '') for t in si.iter() if t.tag.split('}')[-1]=='t')
                shared.append(txt)

        sheet_names=[n for n in z.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')]
        if not sheet_names:
            raise RuntimeError('XLSX oficial sin hojas reconocibles')
        root=ET.fromstring(z.read(sorted(sheet_names)[0]))

        rows=[]
        for row in root.iter():
            if row.tag.split('}')[-1] != 'row':
                continue
            vals={}
            for c in list(row):
                if c.tag.split('}')[-1] != 'c':
                    continue
                idx=_v221052_xlsx_col(c.attrib.get('r',''))
                if idx is None:
                    continue
                typ=c.attrib.get('t')
                value=None
                if typ=='inlineStr':
                    value=''.join((t.text or '') for t in c.iter() if t.tag.split('}')[-1]=='t')
                else:
                    v=next((x for x in c if x.tag.split('}')[-1]=='v'),None)
                    if v is not None:
                        raw=v.text or ''
                        if typ=='s':
                            try: value=shared[int(raw)]
                            except Exception: value=raw
                        else:
                            value=raw
                vals[idx]=value
            if vals:
                maxidx=max(vals)
                rows.append([vals.get(i) for i in range(maxidx+1)])

    if not rows:
        return []

    # Detecta la fila de cabecera buscando los campos típicos del catálogo.
    header_i=0
    best=-1
    for i,row in enumerate(rows[:20]):
        norm=[_norm(v) if v is not None else '' for v in row]
        score=sum(any(k in cell for cell in norm) for k in ('codigo','stationid','estacion','latitud','longitud'))
        if score>best:
            best=score; header_i=i
    headers=[str(x).strip() if x is not None else f'col_{i}' for i,x in enumerate(rows[header_i])]
    dict_rows=[]
    for row in rows[header_i+1:]:
        if not any(v not in (None,'') for v in row):
            continue
        d={headers[i]:row[i] if i<len(row) else None for i in range(len(headers))}
        dict_rows.append(d)

    parsed=_v221051_parse_catalog(dict_rows)
    if parsed:
        return parsed

    # Fallback heurístico para hojas con encabezados inesperados: intenta localizar
    # código de estación y dos coordenadas plausibles por fila.
    out=[]
    for row in rows[header_i+1:]:
        sid=None; nums=[]; text=[]
        for v in row:
            if v in (None,''): continue
            sv=str(v).strip()
            if sid is None and re.fullmatch(r'[A-Za-z]\d{3,4}',sv):
                sid=sv.upper()
            try: nums.append(float(sv.replace(',','.')))
            except Exception: text.append(sv)
        if not sid: continue
        lat=next((x for x in nums if 35<=x<=46),None)
        lon=next((x for x in nums if -10<=x<=5 and x!=lat),None)
        if lat is None or lon is None: continue
        name=next((x for x in text if x.upper()!=sid and len(x)>2),sid)
        out.append({'station_id':sid,'station_name':name,'lat':lat,'lon':lon})
    uniq={x['station_id']:x for x in out}
    return list(uniq.values())


async def _v221052_fetch_xlsx_url(url):
    timeout=httpx.Timeout(12.0,connect=4.0)
    headers={
        'Accept':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream, */*',
        'User-Agent':'BASUGIX-V22.10.5.12/1.0'
    }
    async with httpx.AsyncClient(timeout=timeout,follow_redirects=True,headers=headers) as client:
        r=await client.get(url)
        r.raise_for_status()
        raw=bytes(r.content)
        if len(raw)<1000 or not raw.startswith(b'PK'):
            raise RuntimeError('El recurso XLSX oficial no parece un XLSX válido')
        return raw


V221052_CATALOG_URLS = (
    'https://opendata.euskadi.eus/contenidos/ds_meteorologicos/estaciones_meteorologicas/opendata/estaciones.json',
    'https://opendata.euskadi.eus/contenidos/ds_meteorologicos/estaciones_meteorologicas/opendata/estaciones.geojson',
    'https://www.euskadi.eus/contenidos/ds_meteorologicos/estaciones_meteorologicas/opendata/estaciones.json',
    'https://www.euskadi.eus/contenidos/ds_meteorologicos/estaciones_meteorologicas/opendata/estaciones.geojson',
)

async def _v221052_fetch_json_url(url):
    timeout=httpx.Timeout(30.0,connect=15.0)
    headers={
        'Accept':'application/json, application/geo+json, */*',
        'User-Agent':'BASUGIX-V22.10.5.12/1.0'
    }
    async with httpx.AsyncClient(timeout=timeout,follow_redirects=True,headers=headers) as client:
        r=await client.get(url)
        r.raise_for_status()
        ctype=(r.headers.get('content-type') or '').lower()
        if 'json' not in ctype and not r.text.lstrip().startswith(('{','[')):
            raise RuntimeError(f'Recurso no JSON ({ctype or "sin content-type"})')
        return r.json()

def _v221052_parse_geojson(payload):
    if isinstance(payload,dict) and isinstance(payload.get('features'),list):
        rows=[]
        for feat in payload['features']:
            if not isinstance(feat,dict):
                continue
            props=feat.get('properties') or {}
            geom=feat.get('geometry') or {}
            coords=geom.get('coordinates')
            merged=dict(props)
            if isinstance(coords,(list,tuple)) and len(coords)>=2:
                merged['longitude']=coords[0]
                merged['latitude']=coords[1]
            rows.append(merged)
        parsed=_v221051_parse_catalog(rows)
        if parsed:
            return parsed
    return _v221051_parse_catalog(payload)

async def _v221051_station_catalog(force=False):
    """
    Carga el catálogo oficial de la Red de estaciones meteorológicas de Euskadi
    desde las distribuciones JSON/GeoJSON publicadas por Open Data Euskadi.
    """
    if not force and V22105_CATALOG_CACHE.exists():
        try:
            age=time.time()-V22105_CATALOG_CACHE.stat().st_mtime
            if age <= V22105_CATALOG_TTL_SECONDS:
                rows=json.loads(V22105_CATALOG_CACHE.read_text(encoding='utf-8'))
                if isinstance(rows,list) and rows:
                    return rows
        except Exception:
            pass

    errors=[]

    # Fuente primaria: XLSX oficial enlazado por el catálogo de Open Data Euskadi.
    try:
        raw=await _v221052_fetch_xlsx_url(V221052_CATALOG_XLSX_URL)
        rows=_v221052_parse_xlsx(raw)
        if rows:
            V22105_CATALOG_CACHE.write_text(
                json.dumps(rows,ensure_ascii=False,indent=2),
                encoding='utf-8'
            )
            return rows
        errors.append(f'{V221052_CATALOG_XLSX_URL}: descargado pero sin estaciones reconocibles')
    except Exception as exc:
        errors.append(f'{V221052_CATALOG_XLSX_URL}: {type(exc).__name__}: {exc}')

    # Respaldo del propio catálogo: distribuciones JSON/GeoJSON oficiales.
    for url in V221052_CATALOG_URLS:
        try:
            payload=await _v221052_fetch_json_url(url)
            rows=_v221052_parse_geojson(payload)
            if rows:
                V22105_CATALOG_CACHE.write_text(
                    json.dumps(rows,ensure_ascii=False,indent=2),
                    encoding='utf-8'
                )
                return rows
            errors.append(f'{url}: descargado pero sin estaciones reconocibles')
        except Exception as exc:
            errors.append(f'{url}: {type(exc).__name__}: {exc}')

    if V22105_CATALOG_CACHE.exists():
        try:
            rows=json.loads(V22105_CATALOG_CACHE.read_text(encoding='utf-8'))
            if isinstance(rows,list) and rows:
                return rows
        except Exception:
            pass

    raise RuntimeError(
        'No se pudo cargar el catálogo oficial de estaciones. Intentos: '
        + ' | '.join(errors)
    )

async def _v221051_backup_candidates(target_station,force_catalog=False):
    target=STATION_COORDS[target_station]
    catalog=await _v221051_station_catalog(force=force_catalog)
    rows=[]
    for st in catalog:
        sid=st['station_id']
        if sid==target_station: continue
        dist=_v22105_haversine_coords(target['lat'],target['lon'],st['lat'],st['lon'])
        rows.append({
            **st,
            'distance_km':round(dist,2),
            'is_one_of_five':sid in FIXED_STATION_IDS
        })
    rows.sort(key=lambda x:(x['distance_km'],x['station_id']))
    return rows[:max(1,V22105_MAX_BACKUP_CANDIDATES)]

def _v22105_cache_path(day):
    return V22105_CACHE_DIR / f'web_{day.isoformat()}.json'

def _v22105_cache_read(day, force=False):
    if force: return None
    path=_v22105_cache_path(day)
    if not path.exists(): return None
    try:
        payload=json.loads(path.read_text(encoding='utf-8'))
        if day>=date.today() and time.time()-path.stat().st_mtime>V22105_LIVE_CACHE_SECONDS:
            return None
        payload['cache']={'hit':True,'path':path.name,'generated_at':payload.get('cache',{}).get('generated_at')}
        return payload
    except Exception:
        return None

def _v22105_cache_write(day,payload):
    # La caché nunca debe impedir servir la aplicación. Si Windows/antivirus bloquea
    # momentáneamente el fichero temporal, devolvemos igualmente el payload calculado.
    path=_v22105_cache_path(day)
    out=dict(payload)
    out['cache']={'hit':False,'path':path.name,'generated_at':datetime.now().isoformat(timespec='seconds')}
    try:
        tmp=path.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        tmp.replace(path)
    except Exception as exc:
        out['cache']['write_error']=f'{type(exc).__name__}: {exc}'
    return out

V221052_MIN_RAIN_COVERAGE_PCT=float(os.getenv('V221052_MIN_RAIN_COVERAGE_PCT','90'))

def _v221052_station_package_status(met):
    """Valida el paquete meteorológico completo de una estación para un día.

    Política: si falla una variable crítica, se descarta la estación completa para ese
    cálculo y todas las variables proceden de una única estación de respaldo.
    """
    missing=[]
    for key in ('temperature','humidity','wind_kmh'):
        value=met.get(key)
        try:
            ok=value is not None and math.isfinite(float(value))
        except Exception:
            ok=False
        if not ok:
            missing.append(key)

    rain_value=met.get('rain_mm')
    try:
        rain_numeric=rain_value is not None and math.isfinite(float(rain_value))
    except Exception:
        rain_numeric=False
    coverage=met.get('rain_coverage_pct')
    try:
        coverage_ok=coverage is not None and float(coverage) >= V221052_MIN_RAIN_COVERAGE_PCT
    except Exception:
        coverage_ok=False
    if not rain_numeric:
        missing.append('rain_mm')
    if not coverage_ok:
        missing.append('rain_24h_coverage')

    return {
        'ok':not missing,
        'missing':missing,
        'rain_coverage_pct':coverage,
        'min_rain_coverage_pct':V221052_MIN_RAIN_COVERAGE_PCT,
    }



# ============================================================
# V22.10.5.12 RAPIDEZ — MOTOR LOCAL DESDE ZIP ANUAL
# ============================================================
# Para fechas históricas, evita decenas de llamadas HTTP por cambio de fecha.
# Lee el ZIP anual oficial una sola vez por estación/año y mantiene en memoria
# las observaciones de 10 minutos necesarias para mediodía y lluvia 24 h.
V221052_FAST_ARCHIVE_ENABLED=os.getenv('V221052_FAST_ARCHIVE_ENABLED','1').strip().lower() in ('1','true','yes','on')
_V221052_FAST_OBS_CACHE={}

def _v221052_fast_station_year_sync(archive_path,station,year):
    key=(str(archive_path),str(station).upper(),int(year))
    cached=_V221052_FAST_OBS_CACHE.get(key)
    if cached is not None:
        return cached
    station=str(station).upper(); out={}
    with zipfile.ZipFile(archive_path) as outer:
        inner_name=_v221_station_inner_zip(outer,station)
        raw_inner=outer.read(inner_name)
    with zipfile.ZipFile(io.BytesIO(raw_inner)) as inner:
        xml_names=[n for n in inner.namelist() if n.lower().endswith('.xml')]
        for xml_name in xml_names:
            try: root=ET.fromstring(inner.read(xml_name))
            except Exception: continue
            day_nodes=[e for e in root.iter() if _v221052_local_tag(e) in ('dia','day')]
            base_xml=Path(str(xml_name)).name
            mm=re.search(r'(?:^|_)(\d{4})_(\d{1,2})(?:[^0-9]|$)',base_xml)
            xml_year=int(mm.group(1)) if mm else int(year)
            xml_month=int(mm.group(2)) if mm else None
            for day_pos,dia in enumerate(day_nodes,start=1):
                ds=None
                if xml_month is not None:
                    try: ds=date(xml_year,xml_month,day_pos).isoformat()
                    except Exception: ds=None
                if ds is None: ds=_v221052_date_from_xml_day(xml_name,dia,int(year))
                if not ds or not ds.startswith(f'{int(year):04d}-'): continue
                rows=out.setdefault(ds,[])
                for hora in [e for e in dia.iter() if e is not dia and _v221052_local_tag(e) in ('hora','hour')]:
                    hs=_v221052_attr_ci(hora,'Hora','hour','time','hora_local','localtime')
                    hm=_v221052_parse_time_text(hs)
                    if hm is None: continue
                    hh,mi=hm
                    rows.append({
                        'minute':hh*60+mi,
                        'temperature':_v221052_meteo_value_any(hora,('temaire','temperatura','temperature','temp')),
                        'humidity':_v221052_meteo_value_any(hora,('humedad','humidity','hr')),
                        'wind_ms':_v221052_meteo_value_any(hora,('velmed','velocidadmedia','windspeed','wind')),
                        'rain_mm':_v221052_meteo_value_any(hora,('precip','precipitacion','rain','rainfall')),
                        'direction_deg':_v221052_meteo_value_any(hora,('dirmed','direccionmedia','winddirection','direction')),
                    })
                rows.sort(key=lambda r:r['minute'])
    _V221052_FAST_OBS_CACHE[key]=out
    return out

async def _v221052_fast_station_year(station,year):
    archive=await _v221_download_year(int(year))
    return await asyncio.to_thread(_v221052_fast_station_year_sync,archive,station,int(year))

def _v221052_fast_pick(rows,key,target=720,tolerance=30):
    candidates=[]
    for r in rows:
        v=r.get(key)
        if v is None: continue
        delta=abs(int(r['minute'])-target)
        if delta<=tolerance:
            candidates.append((delta,int(r['minute']),float(v)))
    if not candidates:
        # mismo criterio operacional actual: primer dato posterior a las 12:00
        later=[(int(r['minute']),float(r[key])) for r in rows if r.get(key) is not None and int(r['minute'])>=target]
        if not later: return None,None,True
        minute,val=min(later,key=lambda x:x[0])
        return val,f'{minute//60:02d}:{minute%60:02d}',True
    delta,minute,val=min(candidates,key=lambda x:(x[0],x[1]))
    return val,f'{minute//60:02d}:{minute%60:02d}',delta>0

async def _v221052_fast_archive_weather(station,day):
    cur=await _v221052_fast_station_year(station,day.year)
    rows=cur.get(day.isoformat())
    if not rows: raise RuntimeError('día no presente en ZIP anual')
    prev_day=day-timedelta(days=1)
    if prev_day.year==day.year:
        prev=cur.get(prev_day.isoformat(),[])
    else:
        prev_idx=await _v221052_fast_station_year(station,prev_day.year)
        prev=prev_idx.get(prev_day.isoformat(),[])
    temp,tt,tf=_v221052_fast_pick(rows,'temperature')
    hum,ht,hf=_v221052_fast_pick(rows,'humidity')
    wind_ms,wt,wf=_v221052_fast_pick(rows,'wind_ms')
    direction,_,_= _v221052_fast_pick(rows,'direction_deg')
    missing=[k for k,v in [('temperature',temp),('humidity',hum),('wind_kmh',wind_ms)] if v is None]
    if missing: raise RuntimeError('ZIP anual sin paquete de mediodía: '+', '.join(missing))
    rain_vals=[]
    for r in prev:
        if r.get('rain_mm') is not None and int(r['minute'])>720: rain_vals.append(float(r['rain_mm']))
    for r in rows:
        if r.get('rain_mm') is not None and int(r['minute'])<=720: rain_vals.append(float(r['rain_mm']))
    rain_points=len(rain_vals); expected=144
    coverage=100.0*rain_points/expected if expected else 0.0
    if not rain_vals: raise RuntimeError('ZIP anual sin precipitación 24 h')
    wind_kmh=float(wind_ms)*3.6
    q='Completo' if rain_points>=expected else ('Parcial' if coverage>=90 else 'Incompleto')
    return {
        'temperature':round(float(temp),2),'humidity':round(float(hum),2),'wind_kmh':round(wind_kmh,2),
        'rain_mm':round(sum(max(0.0,x) for x in rain_vals),2),'wind_direction_deg':direction,
        'temperature_time':tt,'humidity_time':ht,'wind_time':wt,
        'temperature_delta_min':None,'humidity_delta_min':None,'wind_delta_min':None,
        'noon_fallback_used':bool(tf or hf or wf),'post_cut_fallback_used':False,
        'temperature_mode':'archivo_anual','humidity_mode':'archivo_anual','wind_mode':'archivo_anual',
        'rain_points_present':rain_points,'rain_points_missing':max(0,expected-rain_points),
        'rain_coverage_pct':round(coverage,1),'rain_quality':q,
        'data_quality':q + (' + fallback mediodía' if (tf or hf or wf) else ''),
        'source':'Euskalmet ZIP anual oficial · motor local rápido',
        'observation_time':'12:00',
    }

async def _v221052_station_weather_fast_or_live(station,day):
    # HISTÓRICO: una fecha anterior a hoy debe salir exclusivamente de
    # observaciones reales de Euskalmet. Nunca se usa Open-Meteo para una
    # fecha pasada. Primero intentamos el ZIP anual local (rápido) y, si el
    # archivo anual todavía no existe o no contiene ese año, usamos la API
    # histórica de Euskalmet. Esto es especialmente necesario para el año
    # en curso (p.ej. 2026), cuyo ZIP anual puede no estar publicado aún.
    if day < date.today():
        archive_error=None
        if V221052_FAST_ARCHIVE_ENABLED:
            try:
                return await _v221052_fast_archive_weather(station,day)
            except Exception as exc:
                archive_error=f'{type(exc).__name__}: {exc}'

        try:
            # v22_noon_weather usa exclusivamente observaciones Euskalmet:
            # API histórica y, como respaldo, XML anual oficial.
            met=await v22_noon_weather(station,day)
            met=dict(met)
            if met.get('rain_mm') is None and met.get('rain24') is not None:
                met['rain_mm']=met.get('rain24')
            return met
        except Exception as exc:
            api_error=f'{type(exc).__name__}: {exc}'
            detail='; '.join(x for x in (archive_error,api_error) if x)
            raise RuntimeError(
                f'No hay observaciones históricas utilizables de Euskalmet para '
                f'{station} {day.isoformat()}. {detail}'
            ) from exc

    # Sólo el día actual puede utilizar la ruta operativa en tiempo real.
    return await v2210_operational_weather(station,day)

V221052_ALLOW_EXTERNAL_STATION_FALLBACK=os.getenv(
    'V221052_ALLOW_EXTERNAL_STATION_FALLBACK','0'
).strip().lower() in ('1','true','yes','on')

async def v22105_weather_with_station_fallback(target_station,day):
    """Respaldo geográfico a nivel de ESTACIÓN COMPLETA.

    Si falla cualquier variable crítica del paquete (T, HR, viento o cobertura de
    precipitación 24 h), no se mezclan variables: se descarta la estación para ese día
    y se usa íntegramente la estación Euskalmet elegible más cercana.
    """
    errors=[]
    fallback_reason=None
    try:
        met=await _v221052_station_weather_fast_or_live(target_station,day)
        met=dict(met)
        status=_v221052_station_package_status(met)
        if not status['ok']:
            fallback_reason='paquete_incompleto: '+', '.join(status['missing'])
            errors.append({
                'station':target_station,'distance_km':0.0,
                'reason':'incomplete_station_package',
                'missing_required_fields':status['missing'],
                'rain_coverage_pct':status.get('rain_coverage_pct'),
            })
        else:
            met.update({
                'meteo_source_station':target_station,
                'meteo_source_station_name':FIXED_STATIONS.get(target_station,target_station),
                'station_fallback_used':False,
                'station_fallback_external':False,
                'station_fallback_distance_km':0.0,
                'station_fallback_attempts':[],
                'station_fallback_reason':None,
                'station_fallback_policy':'estacion_completa',
                'station_package_complete':True,
            })
            return met
    except Exception as exc:
        fallback_reason=f'{type(exc).__name__}: {exc}'
        errors.append({'station':target_station,'distance_km':0.0,'reason':'station_error','error':fallback_reason})

    if not V221052_ALLOW_EXTERNAL_STATION_FALLBACK:
        raise RuntimeError(
            f'La estación objetivo {target_station} no tiene un paquete completo de '
            f'observaciones de Euskalmet para {day.isoformat()}; no se sustituye por '
            f'otra estación.'
        )

    candidates=await _v221051_backup_candidates(target_station)
    for cand in candidates:
        sid=cand['station_id']
        try:
            met=await _v221052_station_weather_fast_or_live(sid,day)
            met=dict(met)
            status=_v221052_station_package_status(met)
            if not status['ok']:
                errors.append({
                    'station':sid,'station_name':cand.get('station_name'),
                    'distance_km':cand['distance_km'],
                    'reason':'incomplete_station_package',
                    'missing_required_fields':status['missing'],
                    'rain_coverage_pct':status.get('rain_coverage_pct'),
                })
                continue
            met.update({
                'meteo_source_station':sid,
                'meteo_source_station_name':cand.get('station_name') or sid,
                'station_fallback_used':True,
                'station_fallback_external':sid not in FIXED_STATION_IDS,
                'station_fallback_distance_km':cand['distance_km'],
                'station_fallback_attempts':errors,
                'station_fallback_reason':fallback_reason or 'estacion_objetivo_no_utilizable',
                'station_fallback_policy':'estacion_completa',
                'station_package_complete':True,
            })
            met['data_quality']=f"{met.get('data_quality','')} + respaldo completo {sid}".strip(' +')
            met['source']=f"{met.get('source','Euskalmet')} | respaldo estación completa {sid} ({cand['distance_km']} km)"
            return met
        except Exception as exc:
            errors.append({
                'station':sid,'station_name':cand.get('station_name'),
                'distance_km':cand['distance_km'],
                'reason':'station_error',
                'error':f'{type(exc).__name__}: {exc}'
            })
    raise RuntimeError(
        f'No se encontró estación Euskalmet con paquete meteorológico completo entre las '
        f'{len(candidates)} más cercanas para {target_station} {day.isoformat()}'
    )


async def v2210_operational_weather(station,day):
    """
    V22.10.1:
      - T/HR/viento: 12:00 exacto.
      - si falta: fallback ±30 min.
      - si continúa el corte: primera lectura disponible posterior a las 12:00.
      - lluvia: suma observada 10-min en (12:00 anterior, 12:00 actual].
    """
    # BASUGIX: T/HR/viento/lluvia no dependen entre sí. Ejecutarlas en serie
    # multiplicaba innecesariamente la latencia de Euskalmet. Se consultan en
    # paralelo; las cinco estaciones ya se procesan también en paralelo.
    temp, hum, wind, rain = await asyncio.gather(
        _v22101_measure_exact_or_fallback(
            station, day, 'temperature', '12:00', V22101_FALLBACK_MIN
        ),
        _v22101_measure_exact_or_fallback(
            station, day, 'humidity', '12:00', V22101_FALLBACK_MIN
        ),
        _v22101_measure_exact_or_fallback(
            station, day, 'wind_kmh', '12:00', V22101_FALLBACK_MIN
        ),
        _v2294_rain_exact_24h(station,day),
    )

    missing=[]
    if not temp.get('ok'): missing.append('temperature')
    if not hum.get('ok'): missing.append('humidity')
    if not wind.get('ok'): missing.append('wind_kmh')
    if missing:
        raise RuntimeError(
            f'V22.10.2: sin observación válida a las 12:00 ni posterior durante el día '
            f'de las 12:00 para {station} {day.isoformat()}: {", ".join(missing)}'
        )

    q = _v2210_quality(rain.get('points'))
    fallback_used = bool(
        temp.get('fallback_used') or hum.get('fallback_used') or wind.get('fallback_used')
    )
    post_cut_fallback_used = bool(
        temp.get('post_cut_fallback_used') or
        hum.get('post_cut_fallback_used') or
        wind.get('post_cut_fallback_used')
    )

    direction=None
    try:
        _,direction=await daily_wind_from_xml(station,day)
    except Exception:
        try:
            direction=await resolve_daily_wind_direction(station,day,{})
        except Exception:
            direction=None

    # Calidad combinada: conservamos la calidad de lluvia y añadimos aviso de meteo.
    if post_cut_fallback_used:
        data_quality = f"{q['rain_quality']} + fallback post-corte"
    elif fallback_used:
        data_quality = f"{q['rain_quality']} + fallback mediodía"
    else:
        data_quality = q['rain_quality']

    return {
        'temperature': float(temp['selected_value']),
        'humidity': float(hum['selected_value']),
        'wind_kmh': float(wind['selected_value']),
        'rain_mm': float(rain.get('rain_mm') or 0.0),
        'wind_direction_deg': direction,

        'temperature_time': temp.get('selected_time'),
        'humidity_time': hum.get('selected_time'),
        'wind_time': wind.get('selected_time'),
        'temperature_delta_min': temp.get('delta_min'),
        'humidity_delta_min': hum.get('delta_min'),
        'wind_delta_min': wind.get('delta_min'),
        'noon_fallback_used': fallback_used,
        'post_cut_fallback_used': post_cut_fallback_used,
        'temperature_mode': temp.get('mode'),
        'humidity_mode': hum.get('mode'),
        'wind_mode': wind.get('mode'),
        'fallback_tolerance_min': V22101_FALLBACK_MIN,

        **q,
        'data_quality': data_quality,
        'source': (
            'Euskalmet V22.10.2 12:00 exacto/fallback ±30 min/primer dato post-corte '
            '+ lluvia 10-min 24h observada'
        ),
    }


@app.get('/debug/v2210/day/{station}/{day_iso}')
async def debug_v2210_day(station:str,day_iso:str):
    """Vista previa del cálculo V22.10. No escribe en SQLite."""
    station=station.upper()
    if station not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación no válida','writes_to_database':False}
    try:
        d=date.fromisoformat(day_iso)
        met=await v22105_weather_with_station_fallback(station,d)
        pf,pd,pc=prev_state(station,d)
        vals=(met['temperature'],met['humidity'],met['wind_kmh'],met['rain_mm'])
        res=calculate(*vals,month=d.month,prev_ffmc=pf,prev_dmc=pd,prev_dc=pc)
        season_name,sf=ire_gip_season(d)
        wf=ire_gip_wind_factor(met['wind_direction_deg'],met['wind_kmh'])
        ire=min(100.0,max(0.0,float(res.fwi)*wf*sf))
        return {
            'ok':True,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'writes_to_database':False,
            'station':station,
            'station_name':FIXED_STATIONS.get(station,station),
            'day':d.isoformat(),
            'inputs':met,
            'seed':{'ffmc':pf,'dmc':pd,'dc':pc},
            'result':{
                'ffmc':round(float(res.ffmc),4),
                'dmc':round(float(res.dmc),4),
                'dc':round(float(res.dc),4),
                'isi':round(float(res.isi),4),
                'bui':round(float(res.bui),4),
                'fwi':round(float(res.fwi),4),
                'fwi_level':v22_local_level(station,res.fwi),
                'ire_gip':round(float(ire),4),
                'ire_gip_level':v22_local_level(station,ire),
                'wind_factor':round(float(wf),4),
                'season_factor':round(float(sf),4),
                'season_name':season_name,
            }
        }
    except Exception as exc:
        return {
            'ok':False,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'writes_to_database':False,
            'station':station,
            'day':day_iso,
            'error_type':type(exc).__name__,
            'error':str(exc),
        }


async def update_day(station,day):
    """V22.10: motor operativo exacto 12:00 + lluvia 10-min 24 h observada."""
    if not V22_WRITE_ENABLED:
        raise RuntimeError(
            "V22.10 está en modo seguro: escritura desactivada. "
            "Define V22_WRITE_ENABLED=1 sólo tras validar la candidata."
        )

    if PROVIDER=='euskalmet':
        met=await v22105_weather_with_station_fallback(station,day)
        vals=(met['temperature'],met['humidity'],met['wind_kmh'],met['rain_mm'])
        direction=met['wind_direction_deg']
    else:
        vals=demo_weather(station,day)
        direction=None
        met={
            'observation_time':'12:00',
            'rain_points_present':144,
            'rain_points_missing':0,
            'rain_coverage_pct':100.0,
            'rain_quality':'Completo',
            'data_quality':'Completo',
            'source':'Demo V22.10',
        }

    # Meteorología + trazabilidad de cobertura.
    with con() as c:
        c.execute(
            """INSERT INTO weather_daily(
                station_id,day,temperature,humidity,wind_kmh,rain_mm,source,created_at,
                observation_time,rain_points_present,rain_points_missing,
                rain_coverage_pct,rain_quality,data_quality,
                temperature_time,humidity_time,wind_time,
                temperature_delta_min,humidity_delta_min,wind_delta_min,
                noon_fallback_used
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(station_id,day) DO UPDATE SET
                temperature=excluded.temperature,
                humidity=excluded.humidity,
                wind_kmh=excluded.wind_kmh,
                rain_mm=excluded.rain_mm,
                source=excluded.source,
                created_at=excluded.created_at,
                observation_time=excluded.observation_time,
                rain_points_present=excluded.rain_points_present,
                rain_points_missing=excluded.rain_points_missing,
                rain_coverage_pct=excluded.rain_coverage_pct,
                noon_fallback_used=excluded.noon_fallback_used,
                temperature_time=excluded.temperature_time,
                humidity_time=excluded.humidity_time,
                wind_time=excluded.wind_time
 """,
            (
                station,day.isoformat(),*vals,met['source'],
                datetime.now().isoformat(timespec='seconds'),
                met['observation_time'],
                met['rain_points_present'],
                met['rain_points_missing'],
                met['rain_coverage_pct'],
                met['rain_quality'],
                met['data_quality'],
                met.get('temperature_time'),
                met.get('humidity_time'),
                met.get('wind_time'),
                met.get('temperature_delta_min'),
                met.get('humidity_delta_min'),
                met.get('wind_delta_min'),
                1 if met.get('noon_fallback_used') else 0,
            )
        )
        c.commit()

    pf,pd,pc=prev_state(station,day)
    res=calculate(*vals,month=day.month,prev_ffmc=pf,prev_dmc=pd,prev_dc=pc)

    direction_cardinal=wind_cardinal(direction)
    season_name,season_factor=ire_gip_season(day)
    wind_factor=ire_gip_wind_factor(direction,vals[2])
    ire_gip=min(100.0,max(0.0,float(res.fwi)*wind_factor*season_factor))

    fwi_level=v22_local_level(station,res.fwi)
    ire_level=v22_local_level(station,ire_gip)

    with con() as c:
        c.execute(
            """INSERT INTO fwi_daily(
                station_id,day,ffmc,dmc,dc,isi,bui,fwi,danger_level,
                ire_gip,ire_gip_level,wind_direction_deg,wind_factor,season_factor,
                created_at,wind_direction_cardinal,season_name,
                data_quality,rain_quality,rain_points_present,rain_points_missing,
                rain_coverage_pct,noon_fallback_used,
                temperature_time,humidity_time,wind_time
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(station_id,day) DO UPDATE SET
                ffmc=excluded.ffmc,dmc=excluded.dmc,dc=excluded.dc,
                isi=excluded.isi,bui=excluded.bui,fwi=excluded.fwi,
                danger_level=excluded.danger_level,
                ire_gip=excluded.ire_gip,
                ire_gip_level=excluded.ire_gip_level,
                wind_direction_deg=excluded.wind_direction_deg,
                wind_factor=excluded.wind_factor,
                season_factor=excluded.season_factor,
                created_at=excluded.created_at,
                wind_direction_cardinal=excluded.wind_direction_cardinal,
                season_name=excluded.season_name,
                data_quality=excluded.data_quality,
                rain_quality=excluded.rain_quality,
                rain_points_present=excluded.rain_points_present,
                rain_points_missing=excluded.rain_points_missing,
                rain_coverage_pct=excluded.rain_coverage_pct""",
            (
                station,day.isoformat(),
                res.ffmc,res.dmc,res.dc,res.isi,res.bui,res.fwi,fwi_level,
                round(ire_gip,2),ire_level,
                round(direction,1) if direction is not None else None,
                round(wind_factor,3),round(season_factor,3),
                datetime.now().isoformat(timespec='seconds'),
                direction_cardinal,season_name,
                met['data_quality'],met['rain_quality'],
                met['rain_points_present'],met['rain_points_missing'],
                met['rain_coverage_pct'],
                1 if met.get('noon_fallback_used') else 0,
                met.get('temperature_time'),
                met.get('humidity_time'),
                met.get('wind_time')
            )
        )
        c.commit()

    return {
        'station':station,
        'day':day.isoformat(),
        'fwi':round(float(res.fwi),2),
        'ire_gip':round(float(ire_gip),2),
        'data_quality':met['data_quality'],
        'rain_points_present':met['rain_points_present'],
        'rain_points_missing':met['rain_points_missing'],
        'rain_coverage_pct':met['rain_coverage_pct'],
        'temperature_time':met.get('temperature_time'),
        'humidity_time':met.get('humidity_time'),
        'wind_time':met.get('wind_time'),
        'temperature_delta_min':met.get('temperature_delta_min'),
        'humidity_delta_min':met.get('humidity_delta_min'),
        'wind_delta_min':met.get('wind_delta_min'),
        'noon_fallback_used':met.get('noon_fallback_used'),
    }


async def backfill(station,days):
    """Recalculate only completed civil days.

    Euskalmet summarized/byDay may not exist yet for the current day, so a
    request for 1 day means yesterday; 7 days means the seven completed days
    ending yesterday.
    """
    end=date.today()-timedelta(days=1)
    start=end-timedelta(days=days-1)
    # V22.10: no borramos previamente la serie. Cada día se sustituye
    # sólo después de obtener entradas válidas y calcularlo correctamente.
    results=[]
    for i in range(days):
        results.append(await update_day(station,start+timedelta(days=i)))
    return results

def rows_for(ids):
    out=[]
    with con() as c:
        for sid in ids:
            r=c.execute(
                """SELECT
                    s.station_id,
                    COALESCE(s.name,s.station_id) name,
                    s.municipality,s.province,
                    w.day,w.temperature,w.humidity,w.wind_kmh,w.rain_mm,w.source,w.observation_time,w.rain_points_present,w.rain_points_missing,w.rain_coverage_pct,w.rain_quality,w.data_quality,
                    f.ffmc,f.dmc,f.dc,f.isi,f.bui,f.fwi,f.danger_level,
                    f.ire_gip,f.ire_gip_level,f.wind_direction_deg,
                    f.wind_direction_cardinal,f.wind_factor,f.season_factor,f.season_name
                FROM stations s
                LEFT JOIN weather_daily w
                  ON w.station_id=s.station_id
                 AND w.day=(SELECT MAX(day) FROM weather_daily WHERE station_id=s.station_id)
                LEFT JOIN fwi_daily f
                  ON f.station_id=s.station_id
                 AND f.day=w.day
                WHERE s.station_id=?""",
                (sid,)
            ).fetchone()
            out.append(dict(r) if r else {'station_id':sid,'name':sid})
    return out

@app.on_event('startup')
async def startup():
    init_db()

@app.on_event('shutdown')
async def shutdown_performance_clients():
    await _close_performance_clients()

@app.get('/tabla',response_class=HTMLResponse)
async def legacy_table(request:Request,stations:str|None=None,msg:str|None=None):
    ids=FIXED_STATION_IDS.copy()
    return templates.get_template('dashboard_ire_gip_v2.html').render(
        rows=rows_for(ids),station_text=','.join(ids),provider=PROVIDER,
        msg=msg,station_names=FIXED_STATIONS
    )

@app.post('/sync')
async def sync(stations:str=Form(...),days:int=Form(7)):
    if not V22_WRITE_ENABLED:
        ids=station_ids(stations)
        msg=(
            'V22.10 en modo seguro: no se ha escrito en la base de datos. '
            'Activa V22_WRITE_ENABLED=1 sólo después de la validación final.'
        )
        return RedirectResponse(
            '/?stations='+','.join(ids)+'&msg='+httpx.QueryParams({'x':msg})['x'],
            status_code=303
        )
    ids=station_ids(stations)
    days=max(1,min(days,60))

    successes=[]
    errors=[]

    # Each station is completely isolated: a failure in one never prevents
    # the remaining stations from being processed.
    for sid in ids:
        try:
            await backfill(sid,days)
            successes.append(sid)
        except Exception as e:
            diagnostic=(
                "\n================ SYNC ERROR ================\n"
                f"Estacion: {sid}\n"
                f"Tipo: {type(e).__name__}\n"
                f"Error: {e}\n"
                + traceback.format_exc()
                + "\n============================================\n"
            )
            try:
                with open(
                    BASE_DIR/"euskalmet_error.log",
                    "a",
                    encoding="utf-8",
                    errors="replace"
                ) as fh:
                    fh.write(diagnostic)
            except Exception:
                pass

            print(diagnostic,flush=True)
            errors.append(f'{sid}: {type(e).__name__}: {e}')

    parts=[]
    if successes:
        parts.append('Actualizadas: '+', '.join(successes))
    if errors:
        parts.append('Errores: '+' | '.join(errors))
    if not parts:
        parts.append('No se procesó ninguna estación')

    msg=' — '.join(parts)

    return RedirectResponse(
        '/?stations='+','.join(ids)+'&msg='+httpx.QueryParams({'x':msg})['x'],
        status_code=303
    )

@app.get('/station/{sid}',response_class=HTMLResponse)
async def station_page(request:Request,sid:str):
    sid=sid.upper()
    with con() as c:
        s=c.execute('SELECT * FROM stations WHERE station_id=?',(sid,)).fetchone(); h=c.execute('''SELECT w.*,f.ffmc,f.dmc,f.dc,f.isi,f.bui,f.fwi,f.danger_level FROM weather_daily w JOIN fwi_daily f ON f.station_id=w.station_id AND f.day=w.day WHERE w.station_id=? ORDER BY w.day DESC LIMIT 60''',(sid,)).fetchall(); sm=c.execute('SELECT * FROM sensor_map WHERE station_id=? ORDER BY variable',(sid,)).fetchall()
    return templates.get_template('station.html').render(station=dict(s) if s else {'station_id':sid,'name':sid},history=[dict(x) for x in h],sensors=[dict(x) for x in sm])











def _v2241_safe_preview(obj, limit=12000):
    """Return JSON-safe diagnostic payload without interpreting it."""
    try:
        raw=json.dumps(obj,ensure_ascii=False,default=str)
    except Exception:
        raw=repr(obj)
    if len(raw) > limit:
        return raw[:limit] + f' ... [TRUNCADO; total={len(raw)} chars]'
    return raw


















# ============================================================
# V22.10.5.12 RESPALDO EUSKALMET FINAL — capa visual / histórica.
# El motor FWI/BASUGIX de V22.5 permanece sin cambios.
# ============================================================

def _ui_date_or_none(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except Exception:
        return None

@app.get('/api/ui/history/{sid}')
async def api_ui_history(sid:str,start:str|None=None,end:str|None=None,limit:int=7000):
    """Histórico DB-only optimizado.

    No abre ZIP, no llama a Euskalmet y no recalcula FWI. Lee directamente las
    tablas precalculadas weather_daily/fwi_daily. Puede devolver todo 2010-2025
    (hasta 7000 filas) y genera una serie gráfica reducida para que el navegador
    no tenga que dibujar miles de puntos innecesarios.
    """
    sid=sid.upper()
    if sid not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación no válida'}

    requested_limit=max(1,min(int(limit),7000))
    cache_key=(sid,str(start or ''),str(end or ''),requested_limit)
    now=time.time()
    hit=_V221052_HISTORY_CACHE.get(cache_key)
    if hit and now-float(hit[0]) < _V221052_HISTORY_TTL:
        cached_response=dict(hit[1])
        cached_response['cache_hit']=True
        cached_response['query_ms']=0.0
        cached_response['total_ms']=0.0
        return cached_response

    # Cobertura real de la estación en la base. Se cachea porque el histórico
    # es esencialmente estático durante el uso normal de la interfaz.
    cov_hit=_V221052_HISTORY_COVERAGE_CACHE.get(sid)
    if cov_hit and now-float(cov_hit[0]) < _V221052_HISTORY_COVERAGE_TTL:
        cov=cov_hit[1]
    else:
        with con() as c:
            cov=c.execute(
                """SELECT MIN(f.day) AS min_day, MAX(f.day) AS max_day, COUNT(*) AS n
                   FROM fwi_daily f WHERE f.station_id=?""", (sid,)
            ).fetchone()
        if cov and cov['min_day']:
            _V221052_HISTORY_COVERAGE_CACHE[sid]=(time.time(),cov)
    if not cov or not cov['min_day']:
        return {'ok':False,'error':'Sin histórico precalculado para esta estación'}

    db_min=date.fromisoformat(cov['min_day']); db_max=date.fromisoformat(cov['max_day'])
    start_day=_ui_date_or_none(start) or max(db_min, db_max-timedelta(days=364))
    end_day=_ui_date_or_none(end) or db_max
    if start_day>end_day:
        start_day,end_day=end_day,start_day
    start_day=max(start_day,db_min); end_day=min(end_day,db_max)
    limit=requested_limit

    t0=time.perf_counter()
    with con() as c:
        rows=c.execute(
            """SELECT
                   f.day,
                   w.temperature,w.humidity,w.wind_kmh,w.rain_mm,
                   f.fwi,f.danger_level,
                   f.ire_gip,f.ire_gip_level,
                   w.meteo_source_station,w.station_fallback_used
               FROM fwi_daily f
               LEFT JOIN weather_daily w
                 ON w.station_id=f.station_id AND w.day=f.day
               WHERE f.station_id=? AND f.day>=? AND f.day<=?
               ORDER BY f.day ASC
               LIMIT ?""",
            (sid,start_day.isoformat(),end_day.isoformat(),limit)
        ).fetchall()

    data=[]
    fallback_count=0
    for r in rows:
        item=dict(r)
        if item.get('fwi') is not None:
            item['danger_level_stored']=item.get('danger_level')
            item['danger_level']=v22_local_level(sid,item['fwi'])
        if item.get('ire_gip') is not None:
            item['ire_gip_level_stored']=item.get('ire_gip_level')
            item['ire_gip_level']=v22_local_level(sid,item['ire_gip'])
        if item.get('station_fallback_used'):
            fallback_count += 1
        data.append(item)

    # Máximo ~900 puntos para la gráfica; la tabla conserva las filas completas.
    chart_max=900
    if len(data)<=chart_max:
        chart_rows=data
    else:
        step=max(1,math.ceil(len(data)/chart_max))
        chart_rows=data[::step]
        if chart_rows and chart_rows[-1].get('day') != data[-1].get('day'):
            chart_rows.append(data[-1])

    elapsed_ms=round((time.perf_counter()-t0)*1000,1)
    station_thresholds=_v22_load_thresholds().get(sid,{})
    response={
        'ok':True,
        'version':'V22.10.5.15 HISTÓRICO DB ULTRARÁPIDO',
        'station':sid,'station_name':FIXED_STATIONS.get(sid,sid),
        'coverage_min':db_min.isoformat(),'coverage_max':db_max.isoformat(),
        'start':start_day.isoformat(),'end':end_day.isoformat(),
        'count':len(data),'fallback_count':fallback_count,
        'query_ms':elapsed_ms,
        'level_method':'station_percentiles_P40_P65_P85_P95',
        'thresholds':station_thresholds,
        'rows':data,
        'chart_rows':chart_rows,
        'db_only':True,
        'writes_to_database':False,
    }
    if len(_V221052_HISTORY_CACHE)>=_V221052_HISTORY_CACHE_MAX:
        oldest=min(_V221052_HISTORY_CACHE.items(),key=lambda kv:kv[1][0])[0]
        _V221052_HISTORY_CACHE.pop(oldest,None)
    _V221052_HISTORY_CACHE[cache_key]=(time.time(),response)
    return response


@app.get('/api/ui/stations')
async def api_ui_stations():
    return {
        'ok':True,
        'stations':[
            {'id':sid,'name':FIXED_STATIONS[sid]}
            for sid in FIXED_STATION_IDS
        ]
    }

@app.get('/ui',response_class=HTMLResponse)
async def v226_ui():
    # Self-contained UI: no external JS/CSS libraries required.
    return HTMLResponse(r"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fire Risk Gipuzkoa · V22.10.5.12 HISTÓRICO DB RÁPIDO</title>
<style>
:root{
  --bg:#f3f5f1;--card:#ffffff;--ink:#10241b;--muted:#67756e;--line:#dfe5df;
  --accent:#0f3d2e;--accent2:#356859;--low:#dcefdc;--mod:#f3e9b2;
  --high:#f6c98f;--very:#ee947d;--ext:#d75f5f;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,Segoe UI,Arial,sans-serif}
.wrap{max-width:1500px;margin:auto;padding:24px}
header{display:flex;justify-content:space-between;gap:20px;align-items:flex-end;margin-bottom:18px}
h1{margin:0;font-size:34px;letter-spacing:-.5px}
.sub{color:var(--muted);margin-top:5px}
.badge{padding:8px 12px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:13px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:0 5px 22px rgba(20,45,30,.05);margin-bottom:16px}
.controls{display:grid;grid-template-columns:1.2fr .8fr .8fr auto;gap:12px;align-items:end}
label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin:0 0 6px}
select,input,button{width:100%;height:42px;border-radius:10px;border:1px solid #ccd5ce;background:white;padding:0 12px;font-size:14px}
button{background:var(--accent);color:#fff;border:0;font-weight:700;cursor:pointer;padding:0 20px}
button:hover{background:var(--accent2)}
.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px}
.card .k{font-size:12px;color:var(--muted);font-weight:700}
.card .v{font-size:26px;font-weight:800;margin-top:5px}
.card .s{font-size:12px;color:var(--muted);margin-top:3px}
.chartbox{height:350px;position:relative}
canvas{width:100%;height:100%}
.tablewrap{overflow:auto;max-height:520px;border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:13px;background:#fff}
th,td{padding:10px 9px;border-bottom:1px solid #e7ece8;text-align:right;white-space:nowrap}
th{position:sticky;top:0;background:#edf2ed;z-index:2;font-size:12px}
th:first-child,td:first-child{text-align:left}
tr:hover td{background:#f8faf8}
.level{display:inline-block;padding:4px 8px;border-radius:999px;font-weight:700;font-size:11px}
.Bajo{background:var(--low)} .Moderado{background:var(--mod)}
.Alto{background:var(--high)} .Muy-alto{background:var(--very)}
.Extremo{background:var(--ext);color:white}
.meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:10px}
.legend{display:flex;gap:18px;font-size:12px;color:var(--muted);margin:4px 0 10px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px}
.dot.fwi{background:#163d2c}.dot.ire{background:#b05a3c}
.empty{padding:40px;text-align:center;color:var(--muted)}
@media(max-width:900px){
  .controls{grid-template-columns:1fr 1fr}
  .cards{grid-template-columns:repeat(2,1fr)}
  header{align-items:flex-start;flex-direction:column}
}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <h1>Fire Risk Gipuzkoa</h1>
    <div class="sub">V22.10.5.12 · histórico 2010–2025 desde SQLite · navegación rápida · sin recalcular al consultar</div>
  </div>
  <div class="badge">Histórico precalculado · SQLite · respuesta inmediata</div>
</header>

<section class="panel">
  <div class="controls">
    <div>
      <label>Estación</label>
      <select id="station"></select>
    </div>
    <div>
      <label>Desde</label>
      <input id="start" type="date">
    </div>
    <div>
      <label>Hasta</label>
      <input id="end" type="date">
    </div>
    <div><button id="load">Consultar</button></div>
  </div>
  <div class="meta" id="meta"></div>
</section>

<div class="cards">
  <div class="card"><div class="k">Último FWI</div><div class="v" id="lastFwi">—</div><div class="s" id="lastFwiLevel">—</div></div>
  <div class="card"><div class="k">Último BASUGIX</div><div class="v" id="lastIre">—</div><div class="s" id="lastIreLevel">—</div></div>
  <div class="card"><div class="k">Máximo FWI</div><div class="v" id="maxFwi">—</div><div class="s" id="maxFwiDay">—</div></div>
  <div class="card"><div class="k">Máximo BASUGIX</div><div class="v" id="maxIre">—</div><div class="s" id="maxIreDay">—</div></div>
  <div class="card"><div class="k">Días consultados</div><div class="v" id="count">0</div><div class="s">registros disponibles</div></div>
</div>

<section class="panel">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap">
    <strong>Evolución FWI / BASUGIX</strong>
    <div class="legend">
      <span><i class="dot fwi"></i>FWI</span>
      <span><i class="dot ire"></i>BASUGIX</span>
      <span>Los huecos indican ausencia de dato histórico; no equivalen a 0.</span>
    </div>
  </div>
  <div class="chartbox"><canvas id="chart"></canvas></div>
</section>

<section class="panel">
  <strong>Histórico diario</strong>
  <div class="tablewrap" style="margin-top:12px">
    <table>
      <thead><tr>
        <th>Fecha</th><th>T °C</th><th>HR %</th><th>Viento km/h</th><th>Dirección</th>
        <th>Lluvia mm</th><th>FFMC</th><th>DMC</th><th>DC</th><th>ISI</th><th>BUI</th>
        <th>FWI</th><th>Nivel FWI</th><th>BASUGIX</th><th>Nivel BASUGIX</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
</section>
</div>

<script>
const $=id=>document.getElementById(id);
let rows=[];
let chartRows=[];

function iso(d){ return d.toISOString().slice(0,10); }
function num(v,d=2){ return v===null||v===undefined ? '—' : Number(v).toFixed(d); }
function levelClass(v){ return String(v||'').replace(' ','-'); }

async function setup(){
  const s=await fetch('/api/ui/stations').then(r=>r.json());
  $('station').innerHTML=s.stations.map(x=>`<option value="${x.id}">${x.name} · ${x.id}</option>`).join('');
  const e=new Date(); e.setDate(e.getDate()-1);
  const b=new Date(e); b.setDate(b.getDate()-89);
  $('end').value=iso(e); $('start').value=iso(b);
  await load();
}
async function load(){
  const q=new URLSearchParams({start:$('start').value,end:$('end').value});
  const sid=$('station').value;
  const d=await fetch(`/api/ui/history/${sid}?${q}`).then(r=>r.json());
  if(!d.ok){ alert(d.error||'Error'); return; }
  rows=d.rows||[];
  chartRows=d.chart_rows||rows;
  const t=d.thresholds||{};
  const umbrales=(t.p40!==undefined)
    ? `<span>Umbrales: Bajo &lt; ${Number(t.p40).toFixed(3)} · Moderado &lt; ${Number(t.p65).toFixed(3)} · Alto &lt; ${Number(t.p85).toFixed(3)} · Muy alto &lt; ${Number(t.p95).toFixed(3)} · Extremo ≥ ${Number(t.p95).toFixed(3)}</span>`
    : `<span>Umbrales absolutos de respaldo</span>`;
  $('meta').innerHTML=`<span><b>${d.station_name}</b> (${d.station})</span><span>${d.start} → ${d.end}</span><span>${d.count} registros</span><span>Cobertura DB: ${d.coverage_min} → ${d.coverage_max}</span><span>${d.fallback_count||0} días con respaldo</span><span>Consulta ${d.query_ms} ms</span>${umbrales}`;
  renderCards(); renderTable(); drawChart();
}
function renderCards(){
  $('count').textContent=rows.length;
  if(!rows.length){
    for(const id of ['lastFwi','lastIre','maxFwi','maxIre']) $(id).textContent='—';
    return;
  }
  const last=rows[rows.length-1];
  $('lastFwi').textContent=num(last.fwi);
  $('lastFwiLevel').textContent=`${last.day} · ${uiLevel(last.danger_level)}`;
  $('lastIre').textContent=num(last.ire_gip);
  $('lastIreLevel').textContent=last.ire_gip===null || last.ire_gip===undefined
    ? `${last.day} · sin dato histórico`
    : `${last.day} · ${uiLevel(last.ire_gip_level)}`;
  const fwiRows=rows.filter(r=>r.fwi!==null && r.fwi!==undefined);
  const ireRows=rows.filter(r=>r.ire_gip!==null && r.ire_gip!==undefined);
  const mf=fwiRows.length ? fwiRows.reduce((a,b)=>(Number(b.fwi)>Number(a.fwi)?b:a)) : null;
  const mi=ireRows.length ? ireRows.reduce((a,b)=>(Number(b.ire_gip)>Number(a.ire_gip)?b:a)) : null;
  $('maxFwi').textContent=mf ? num(mf.fwi) : '—';
  $('maxFwiDay').textContent=mf ? mf.day : 'sin datos';
  $('maxIre').textContent=mi ? num(mi.ire_gip) : '—';
  $('maxIreDay').textContent=mi ? mi.day : 'sin datos';
}
function renderTable(){
  if(!rows.length){ $('tbody').innerHTML='<tr><td colspan="15" class="empty">Sin datos para este periodo</td></tr>'; return; }
  $('tbody').innerHTML=rows.slice().reverse().map(r=>`
    <tr>
      <td><b>${r.day}</b></td>
      <td>${num(r.temperature)}</td><td>${num(r.humidity)}</td><td>${num(r.wind_kmh)}</td>
      <td>${r.wind_direction_cardinal||'—'} ${r.wind_direction_deg==null?'':num(r.wind_direction_deg,1)+'°'}</td>
      <td>${num(r.rain_mm)}</td><td>${num(r.ffmc)}</td><td>${num(r.dmc)}</td><td>${num(r.dc)}</td>
      <td>${num(r.isi)}</td><td>${num(r.bui)}</td><td><b>${num(r.fwi)}</b></td>
      <td><span class="level ${levelClass(r.danger_level)}">${r.danger_level||'—'}</span></td>
      <td><b>${num(r.ire_gip)}</b></td>
      <td><span class="level ${levelClass(r.ire_gip_level)}">${r.ire_gip_level||'—'}</span></td>
    </tr>`).join('');
}
function drawChart(){
  const canvas=$('chart'), box=canvas.parentElement, dpr=window.devicePixelRatio||1;
  const W=box.clientWidth,H=box.clientHeight;
  canvas.width=W*dpr; canvas.height=H*dpr;
  const c=canvas.getContext('2d'); c.scale(dpr,dpr);
  c.clearRect(0,0,W,H);
  const pad={l:50,r:18,t:18,b:34}, iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  c.strokeStyle='#dfe5df'; c.lineWidth=1;
  for(let i=0;i<=5;i++){ const y=pad.t+ih*i/5; c.beginPath();c.moveTo(pad.l,y);c.lineTo(W-pad.r,y);c.stroke(); }
  if(!rows.length) return;
  const vals=rows.flatMap(r=>[
    (r.fwi===null || r.fwi===undefined) ? null : Number(r.fwi),
    (r.ire_gip===null || r.ire_gip===undefined) ? null : Number(r.ire_gip)
  ]).filter(v=>v!==null && Number.isFinite(v));
  const max=Math.max(5,...vals)*1.08;
  c.fillStyle='#66756e'; c.font='11px Segoe UI';
  for(let i=0;i<=5;i++){ const v=max*(1-i/5); c.fillText(v.toFixed(1),5,pad.t+ih*i/5+4); }
  function x(i){ return pad.l+(rows.length===1?iw/2:iw*i/(rows.length-1)); }
  function y(v){ return pad.t+ih-(Math.max(0,Number(v))/max)*ih; }
  function line(key,color){
    c.strokeStyle=color;c.lineWidth=2.2;c.beginPath();
    let drawing=false;
    rows.forEach((r,i)=>{
      const v=r[key];
      if(v===null || v===undefined || !Number.isFinite(Number(v))){
        drawing=false;
        return;
      }
      const xx=x(i),yy=y(v);
      if(drawing) c.lineTo(xx,yy);
      else { c.moveTo(xx,yy); drawing=true; }
    });
    c.stroke();
  }
  line('fwi','#163d2c'); line('ire_gip','#b05a3c');
  c.fillStyle='#66756e';
  const ticks=Math.min(6,rows.length);
  for(let j=0;j<ticks;j++){
    const i=Math.round(j*(rows.length-1)/Math.max(1,ticks-1));
    const label=rows[i].day.slice(5);
    c.fillText(label,x(i)-14,H-10);
  }
}
$('load').addEventListener('click',load);
$('station').addEventListener('change',load);
window.addEventListener('resize',drawChart);
setup();
</script>
</body>
</html>""")


# ============================================================
# V22.10.5.12 RESPALDO EUSKALMET FINAL — portada territorial con mapa real de Gipuzkoa
# + áreas de influencia Voronoi recortadas al límite regional.
# ============================================================

async def _gipuzkoa_boundary():
    """Devuelve y cachea un límite real de Gipuzkoa en GeoJSON."""
    if GIPUZKOA_BOUNDARY_CACHE.exists():
        try:
            return json.loads(GIPUZKOA_BOUNDARY_CACHE.read_text(encoding='utf-8'))
        except Exception:
            pass
    async with httpx.AsyncClient(timeout=45,follow_redirects=True) as client:
        r=await client.get(
            GIPUZKOA_BOUNDARY_URL,
            headers={'User-Agent':'BASUGIX V22.10.5.12 RESPALDO EUSKALMET FINAL'}
        )
        r.raise_for_status()
        payload=r.json()
    try:
        GIPUZKOA_BOUNDARY_CACHE.write_text(
            json.dumps(payload,ensure_ascii=False),
            encoding='utf-8'
        )
    except Exception:
        pass
    return payload

@app.get('/api/map/boundary')
async def api_map_boundary():
    try:
        return await _gipuzkoa_boundary()
    except Exception as exc:
        return {'ok':False,'error':f'{type(exc).__name__}: {exc}'}

def _utm30_to_wgs84(x,y):
    """Convierte ETRS89/UTM 30N (EPSG:25830) a lon/lat WGS84 sin dependencias."""
    a=6378137.0
    eccSquared=0.00669438002290
    k0=0.9996
    x=float(x)-500000.0
    y=float(y)
    longOrigin=-3.0

    eccPrimeSquared=eccSquared/(1-eccSquared)
    M=y/k0
    mu=M/(a*(1-eccSquared/4-3*eccSquared**2/64-5*eccSquared**3/256))

    e1=(1-math.sqrt(1-eccSquared))/(1+math.sqrt(1-eccSquared))
    J1=3*e1/2-27*e1**3/32
    J2=21*e1**2/16-55*e1**4/32
    J3=151*e1**3/96
    J4=1097*e1**4/512

    fp=mu+J1*math.sin(2*mu)+J2*math.sin(4*mu)+J3*math.sin(6*mu)+J4*math.sin(8*mu)

    sinfp=math.sin(fp); cosfp=math.cos(fp); tanfp=math.tan(fp)
    N1=a/math.sqrt(1-eccSquared*sinfp*sinfp)
    T1=tanfp*tanfp
    C1=eccPrimeSquared*cosfp*cosfp
    R1=a*(1-eccSquared)/((1-eccSquared*sinfp*sinfp)**1.5)
    D=x/(N1*k0)

    lat=fp-(N1*tanfp/R1)*(
        D**2/2
        -(5+3*T1+10*C1-4*C1*C1-9*eccPrimeSquared)*D**4/24
        +(61+90*T1+298*C1+45*T1*T1-252*eccPrimeSquared-3*C1*C1)*D**6/720
    )
    lon=(
        D-(1+2*T1+C1)*D**3/6
        +(5-2*C1+28*T1-3*C1*C1+8*eccPrimeSquared+24*T1*T1)*D**5/120
    )/cosfp
    return [longOrigin+math.degrees(lon), math.degrees(lat)]


def _coords_need_reprojection(coords):
    """Detecta GeoJSON proyectado mirando el primer par numérico."""
    cur=coords
    while isinstance(cur,list) and cur:
        if len(cur)>=2 and isinstance(cur[0],(int,float)) and isinstance(cur[1],(int,float)):
            return abs(float(cur[0]))>180 or abs(float(cur[1]))>90
        cur=cur[0]
    return False


def _transform_coords_utm30(coords):
    if not isinstance(coords,list):
        return coords
    if len(coords)>=2 and isinstance(coords[0],(int,float)) and isinstance(coords[1],(int,float)):
        lonlat=_utm30_to_wgs84(coords[0],coords[1])
        if len(coords)>2:
            lonlat.extend(coords[2:])
        return lonlat
    return [_transform_coords_utm30(c) for c in coords]


def _municipios_to_wgs84(payload):
    """Normaliza el GeoJSON municipal a EPSG:4326 para Leaflet."""
    if not isinstance(payload,dict):
        return payload
    out=json.loads(json.dumps(payload))
    for f in out.get('features',[]):
        g=f.get('geometry') or {}
        coords=g.get('coordinates')
        if coords is not None and _coords_need_reprojection(coords):
            g['coordinates']=_transform_coords_utm30(coords)
    # GeoJSON RFC 7946 usa WGS84; eliminamos CRS proyectado heredado.
    out.pop('crs',None)
    return out


async def _gipuzkoa_municipal_geojson():
    """Descarga/cachea límites B5M y los entrega a Leaflet en WGS84."""
    if GIPUZKOA_MUNICIPAL_WGS84_CACHE.exists():
        try:
            return json.loads(GIPUZKOA_MUNICIPAL_WGS84_CACHE.read_text(encoding='utf-8'))
        except Exception:
            pass

    if GIPUZKOA_MUNICIPAL_CACHE.exists():
        try:
            raw=json.loads(GIPUZKOA_MUNICIPAL_CACHE.read_text(encoding='utf-8'))
        except Exception:
            raw=None
    else:
        raw=None

    if raw is None:
        async with httpx.AsyncClient(timeout=90,follow_redirects=True) as client:
            r=await client.get(
                GIPUZKOA_MUNICIPAL_GEOJSON_URL,
                headers={'User-Agent':'BASUGIX V22.10.5.15 MUNICIPIOS B5M'}
            )
            r.raise_for_status()
            raw=r.json()
        # topoquery2 devuelve un envoltorio con `features`; normalizamos a
        # FeatureCollection para que Leaflet/Turf no dependan de B5M.
        if isinstance(raw,dict) and raw.get('features') and raw.get('type')!='FeatureCollection':
            raw={'type':'FeatureCollection','features':raw.get('features',[])}
        try:
            GIPUZKOA_MUNICIPAL_CACHE.write_text(
                json.dumps(raw,ensure_ascii=False),
                encoding='utf-8'
            )
        except Exception:
            pass

    payload=_municipios_to_wgs84(raw)
    try:
        GIPUZKOA_MUNICIPAL_WGS84_CACHE.write_text(
            json.dumps(payload,ensure_ascii=False),
            encoding='utf-8'
        )
    except Exception:
        pass
    return payload

@app.get('/api/map/municipios')
async def api_map_municipios():
    try:
        return await _gipuzkoa_municipal_geojson()
    except Exception as exc:
        return {'ok':False,'error':f'{type(exc).__name__}: {exc}'}

@app.get('/api/map/zoning')
async def api_map_zoning():
    return {
        'ok':True,
        'version':'BASUGIX V22.10.5.12 ZONIFICACIÓN TERRITORIAL CONTINUA',
        'method':'malla territorial 1 km: distancia + influencia marítima + altitud/orografía proxy',
        'station_terrain':BASUGIX_STATION_TERRAIN,
        'grid_cell_km':1.0,
        'coastline_anchors':[
            [-2.505,43.307],[-2.385,43.320],[-2.260,43.303],[-2.203,43.303],
            [-2.159,43.284],[-2.129,43.290],[-2.083,43.312],[-1.982,43.324],[-1.795,43.373]
        ],
        'ridge_anchors':[
            [-2.430,43.080,420],[-2.300,43.100,500],[-2.180,43.120,650],
            [-2.080,43.100,700],[-1.990,43.080,650],[-2.300,42.990,600]
        ],
        'criteria':[
            'distancia geográfica a la estación',
            'distancia continua a la franja costera',
            'compatibilidad con una cota orográfica territorial estimada',
            'penalización fisioclimática costa/interior'
        ],
        'status':'continuous_grid_v1',
        'note':'Los límites municipales no intervienen en la asignación. La malla se recorta al límite de Gipuzkoa y cada celda adopta el BASUGIX de la estación con menor coste fisioclimático.'
    }


@app.get('/api/v22104/map-assets')
async def api_v22104_map_assets():
    """Carga sólo el límite provincial y parámetros de zonificación continua.

    Los municipios dejan de intervenir en el mapa BASUGIX, lo que además reduce
    el peso y el tiempo de carga de la vista principal.
    """
    try:
        boundary=await _gipuzkoa_boundary()
        return {
            'ok':True,
            'boundary':boundary,
            'zoning':{
                'station_terrain':BASUGIX_STATION_TERRAIN,
                'grid_cell_km':1.0,
                'coastline_anchors':[
                    [-2.505,43.307],[-2.385,43.320],[-2.260,43.303],[-2.203,43.303],
                    [-2.159,43.284],[-2.129,43.290],[-2.083,43.312],[-1.982,43.324],[-1.795,43.373]
                ],
                'ridge_anchors':[
                    [-2.430,43.080,420],[-2.300,43.100,500],[-2.180,43.120,650],
                    [-2.080,43.100,700],[-1.990,43.080,650],[-2.300,42.990,600]
                ],
                'method':'malla territorial continua: distancia + maritimidad + altitud/orografía proxy'
            }
        }
    except Exception as exc:
        return {'ok':False,'error':f'{type(exc).__name__}: {exc}'}

def _v221052_main_day_from_db(d):
    """Return the five main-station cards directly from SQLite when the day is precalculated.

    This is the fast path for historical navigation.  It deliberately preserves the
    same public payload shape as /api/v22103/live so the existing map/cards/detail UI
    needs no special historical branch.  Returning None means the caller should fall
    back to the ZIP/API calculation path.
    """
    started=time.perf_counter()
    ds=d.isoformat()
    placeholders=','.join('?' for _ in FIXED_STATION_IDS)
    with con() as c:
        rows=c.execute(f"""
            SELECT
              w.station_id,w.day,w.temperature,w.humidity,w.wind_kmh,w.rain_mm,
              w.source,w.observation_time,w.rain_points_present,w.rain_points_missing,
              w.rain_coverage_pct,w.rain_quality,w.data_quality,
              w.temperature_time,w.humidity_time,w.wind_time,
              w.temperature_delta_min,w.humidity_delta_min,w.wind_delta_min,
              w.noon_fallback_used,w.meteo_source_station,w.station_fallback_used,
              w.station_fallback_distance_km,
              f.ffmc,f.dmc,f.dc,f.isi,f.bui,f.fwi,f.danger_level,
              f.ire_gip,f.ire_gip_level,f.wind_direction_deg,f.wind_factor,
              f.season_factor,f.wind_direction_cardinal,f.season_name
            FROM weather_daily w
            JOIN fwi_daily f ON f.station_id=w.station_id AND f.day=w.day
            WHERE w.day=? AND w.station_id IN ({placeholders})
        """, (ds,*FIXED_STATION_IDS)).fetchall()
        name_rows=c.execute(
            "SELECT station_id,name FROM stations WHERE name IS NOT NULL AND name<>''"
        ).fetchall()
    by_sid={r['station_id']:dict(r) for r in rows}
    # Only take the DB shortcut when every target station is represented.  Otherwise
    # the normal fallback engine remains responsible for filling the missing day.
    if any(sid not in by_sid for sid in FIXED_STATION_IDS):
        return None
    station_names={r['station_id']:r['name'] for r in name_rows}
    thresholds=_v22_load_thresholds()
    out=[]
    for sid in FIXED_STATION_IDS:
        r=by_sid[sid]
        source_sid=(r.get('meteo_source_station') or sid)
        fallback=bool(r.get('station_fallback_used')) or source_sid!=sid
        source_name=(FIXED_STATIONS.get(source_sid) or station_names.get(source_sid) or source_sid)
        fwi=float(r['fwi']) if r.get('fwi') is not None else None
        ire=float(r['ire_gip']) if r.get('ire_gip') is not None else fwi
        fwi_level=(r.get('danger_level') or (v22_local_level(sid,fwi) if fwi is not None else None))
        ire_level=(r.get('ire_gip_level') or (v22_local_level(sid,ire) if ire is not None else None))
        out.append({
            'station_id':sid,'station_name':FIXED_STATIONS[sid],
            'lat':STATION_COORDS[sid]['lat'],'lon':STATION_COORDS[sid]['lon'],
            'day':ds,'thresholds':thresholds.get(sid,{}),'ok':True,
            'temperature':r.get('temperature'),'humidity':r.get('humidity'),
            'wind_kmh':r.get('wind_kmh'),'rain_mm':r.get('rain_mm'),
            'wind_direction_deg':r.get('wind_direction_deg'),
            'wind_direction_cardinal':r.get('wind_direction_cardinal'),
            'temperature_time':r.get('temperature_time'),'humidity_time':r.get('humidity_time'),
            'wind_time':r.get('wind_time'),'temperature_delta_min':r.get('temperature_delta_min'),
            'humidity_delta_min':r.get('humidity_delta_min'),'wind_delta_min':r.get('wind_delta_min'),
            'noon_fallback_used':bool(r.get('noon_fallback_used')),
            'post_cut_fallback_used':False,
            'temperature_mode':'sqlite_precalculado','humidity_mode':'sqlite_precalculado',
            'wind_mode':'sqlite_precalculado',
            'rain_points_present':r.get('rain_points_present'),
            'rain_points_missing':r.get('rain_points_missing'),
            'rain_coverage_pct':r.get('rain_coverage_pct'),'rain_quality':r.get('rain_quality'),
            'data_quality':r.get('data_quality') or 'Histórico precalculado',
            'source':r.get('source') or 'SQLite histórico precalculado',
            'meteo_source_station':source_sid,'meteo_source_station_name':source_name,
            'station_fallback_used':fallback,
            'station_fallback_distance_km':float(r.get('station_fallback_distance_km') or 0.0),
            'station_fallback_attempts':[],
            'station_fallback_reason':('Sustitución histórica precalculada' if fallback else None),
            'station_fallback_policy':'estacion_completa',
            'station_package_complete':True,
            'ffmc':r.get('ffmc'),'dmc':r.get('dmc'),'dc':r.get('dc'),
            'isi':r.get('isi'),'bui':r.get('bui'),'fwi':fwi,'fwi_level':fwi_level,
            'ire_gip':ire,'ire_gip_level':ire_level,'wind_factor':r.get('wind_factor'),
            'season_factor':r.get('season_factor'),'season_name':r.get('season_name'),
            'seed':None,
        })
    elapsed=round(time.perf_counter()-started,4)
    return {
        'ok':True,
        'version':'V22.10.5.12 · FECHA DB RÁPIDA',
        'writes_to_database':False,
        'selected_day':ds,
        'stations':out,
        'mode':'sqlite_precalculated_main_view',
        'calculation_seconds':elapsed,
        'db_fast_path':True,
        'backup_strategy':'sustitución completa ya precalculada en SQLite cuando consta en histórico',
        'note':'Fecha servida directamente desde weather_daily + fwi_daily; ZIP/API sólo se usan si la fecha no está precalculada para las cinco estaciones.'
    }

def _v221052_latest_complete_db_payload(on_or_before=None):
    """Última fecha <= límite con las cinco estaciones completas en weather_daily+fwi_daily."""
    limit=(on_or_before or date.today()).isoformat()
    placeholders=','.join('?' for _ in FIXED_STATION_IDS)
    with con() as c:
        row=c.execute(f"""
            SELECT w.day AS day
            FROM weather_daily w
            JOIN fwi_daily f ON f.station_id=w.station_id AND f.day=w.day
            WHERE w.day<=? AND w.station_id IN ({placeholders})
            GROUP BY w.day
            HAVING COUNT(DISTINCT w.station_id)=?
            ORDER BY w.day DESC
            LIMIT 1
        """, (limit,*FIXED_STATION_IDS,len(FIXED_STATION_IDS))).fetchone()
    if not row:
        return None
    return _v221052_main_day_from_db(date.fromisoformat(row['day']))


@app.get('/debug/v221052/main-day-latest')
async def debug_v221052_main_day_latest(on_or_before:str|None=None):
    try:
        lim=date.fromisoformat(on_or_before) if on_or_before else date.today()
    except Exception:
        return {'ok':False,'error':'Fecha no válida. Usa YYYY-MM-DD.'}
    payload=_v221052_latest_complete_db_payload(lim)
    if payload is None:
        return {'ok':False,'error':'No existe una fecha completa en SQLite hasta el límite solicitado.'}
    payload=dict(payload)
    payload['mode']='sqlite_latest_complete_fallback'
    payload['requested_limit']=lim.isoformat()
    return payload

@app.get('/api/v221052/latest-fast')
async def api_v221052_latest_fast():
    """Carga inicial/Último SIN red: responde inmediatamente desde SQLite.

    Antes de las 12:00 Europe/Madrid el objetivo operativo es D-1.
    Desde las 12:00 el objetivo es D0. Si D0 todavía no está completo en SQLite,
    devuelve de inmediato el último día completo y marca needs_live_refresh para
    que el navegador intente actualizar D0 en segundo plano sin bloquear la UI.
    """
    madrid_now=datetime.now(ZoneInfo('Europe/Madrid'))
    today=madrid_now.date()
    desired=today if madrid_now.hour >= 12 else today-timedelta(days=1)

    # Primero SQLite; después caché persistente de una consulta real reciente.
    payload=_v221052_main_day_from_db(desired)
    if payload is None:
        cached_payload=_v22105_cache_read(desired,force=False)
        if cached_payload and cached_payload.get('ok') and any(x.get('ok') for x in (cached_payload.get('stations') or [])):
            payload=dict(cached_payload)
            payload['mode']='persistent_operational_cache_latest_fast'
            payload['requested_day']=desired.isoformat()
            payload['needs_live_refresh']=False
            payload['live_fallback']=False
            return payload
    if payload is not None:
        payload=dict(payload)
        payload['mode']='sqlite_operational_latest_fast'
        payload['requested_day']=desired.isoformat()
        payload['needs_live_refresh']=False
        payload['live_fallback']=False
        return payload

    # Si D0 todavía no está precalculado, la portada debe responder inmediatamente.
    # El último día completo se muestra como respaldo explícito y el navegador intenta
    # actualizar D0 en segundo plano mediante refreshOperationalD0InBackground().
    # Nunca presentar un día antiguo (p.ej. 2025-12-31) como si fuese D0.
    # Para una fecha operativa solicitada, sólo son válidos los datos de esa fecha.
    # El fallback SQLite se conserva exclusivamente para consultas históricas.
    if desired < date.today():
        fallback_payload=_v221052_latest_complete_db_payload(desired)
        if fallback_payload is not None:
            fallback_payload=dict(fallback_payload)
            fallback_payload['mode']='sqlite_historical_fallback'
            fallback_payload['requested_day']=desired.isoformat()
            fallback_payload['live_fallback']=True
            fallback_payload['needs_live_refresh']=True
            return fallback_payload

    # Sólo si tampoco existe ningún día completo, intentamos Euskalmet en primer plano.
    try:
        live_payload=await asyncio.wait_for(
            api_v22103_live(desired.isoformat(),force=1,_skip_prev_sync=True),
            timeout=float(os.getenv('EUSKALMET_OPERATIONAL_LATEST_TIMEOUT','45'))
        )
        if live_payload and live_payload.get('ok') and any(x.get('ok') for x in (live_payload.get('stations') or [])):
            live_payload=dict(live_payload)
            live_payload['requested_day']=desired.isoformat()
            live_payload['live_fallback']=False
            live_payload['needs_live_refresh']=False
            live_payload['mode']='euskalmet_operational_latest_real'
            return live_payload
    except Exception as exc:
        print('BASUGIX latest real fetch error:',type(exc).__name__,exc,flush=True)

    return {
        'ok':False,
        'error':'No existe ningún día completo en SQLite y Euskalmet no devolvió un día operativo utilizable.',
        'requested_day':desired.isoformat(),
        'writes_to_database':False,
    }

@app.get('/debug/v221052/main-day-db/{day_iso}')
async def debug_v221052_main_day_db(day_iso:str):
    try:
        d=date.fromisoformat(day_iso)
    except Exception:
        return {'ok':False,'error':'Fecha no válida. Usa YYYY-MM-DD.'}
    payload=_v221052_main_day_from_db(d)
    if payload is None:
        return {'ok':False,'day':day_iso,'db_fast_path':False,'error':'La fecha no está completa para las cinco estaciones en SQLite.'}
    return payload


def _v221052_can_persist_operational_day(day):
    """Sólo persiste días recientes si existe continuidad FFMC/DMC/DC del día anterior."""
    prev=day-timedelta(days=1)
    placeholders=','.join('?' for _ in FIXED_STATION_IDS)
    with con() as c:
        row=c.execute(f"""
            SELECT COUNT(DISTINCT station_id) AS n
            FROM fwi_daily
            WHERE day=? AND station_id IN ({placeholders})
        """,(prev.isoformat(),*FIXED_STATION_IDS)).fetchone()
    return bool(row and int(row['n'] or 0)==len(FIXED_STATION_IDS))


def _v221052_persist_operational_payload(payload):
    """Guarda un día REAL completo para que 'Último' sea instantáneo en cargas posteriores."""
    try:
        if not payload or not payload.get('ok'):
            return False
        ds=payload.get('selected_day')
        if not ds:
            return False
        d=date.fromisoformat(ds)
        rows=payload.get('stations') or []
        if len(rows)!=len(FIXED_STATION_IDS) or not all(r.get('ok') for r in rows):
            return False
        if d>datetime.now(ZoneInfo('Europe/Madrid')).date():
            return False
        if not _v221052_can_persist_operational_day(d):
            return False
        now=datetime.now().isoformat(timespec='seconds')
        weather_rows=[]; fwi_rows=[]
        for r in rows:
            sid=r['station_id']
            weather_rows.append((
                sid,ds,r.get('temperature'),r.get('humidity'),r.get('wind_kmh'),r.get('rain_mm'),
                r.get('source') or 'Euskalmet operativo BASUGIX',now,'12:00',
                r.get('rain_points_present'),r.get('rain_points_missing'),r.get('rain_coverage_pct'),
                r.get('rain_quality'),r.get('data_quality'),r.get('temperature_time'),
                r.get('humidity_time'),r.get('wind_time'),r.get('temperature_delta_min'),
                r.get('humidity_delta_min'),r.get('wind_delta_min'),1 if r.get('noon_fallback_used') else 0,
                r.get('meteo_source_station') or sid,1 if r.get('station_fallback_used') else 0,
                r.get('station_fallback_distance_km') or 0.0
            ))
            fwi_rows.append((
                sid,ds,r.get('ffmc'),r.get('dmc'),r.get('dc'),r.get('isi'),r.get('bui'),r.get('fwi'),
                r.get('fwi_level'),r.get('ire_gip'),r.get('ire_gip_level'),r.get('wind_direction_deg'),
                r.get('wind_factor'),r.get('season_factor'),now,r.get('wind_direction_cardinal'),
                r.get('season_name'),r.get('data_quality'),r.get('rain_quality'),r.get('rain_points_present'),
                r.get('rain_points_missing'),r.get('rain_coverage_pct'),1 if r.get('noon_fallback_used') else 0,
                r.get('temperature_time'),r.get('humidity_time'),r.get('wind_time')
            ))
        _v221052_history_write_batch(weather_rows,fwi_rows)
        return True
    except Exception as exc:
        print('BASUGIX operational persist error:',type(exc).__name__,exc,flush=True)
        return False


async def _v221052_ensure_previous_operational_day(d):
    """Para D0/D-1 recientes, rellena como máximo los días intermedios que falten.

    Evita calcular D0 con la memoria FFMC/DMC/DC de dos días atrás. El límite de
    siete días impide que una consulta histórica accidental dispare una reconstrucción masiva.
    """
    today=datetime.now(ZoneInfo('Europe/Madrid')).date()
    if d < today-timedelta(days=7) or d>today:
        return
    prev=d-timedelta(days=1)
    if _v221052_main_day_from_db(prev) is not None:
        return
    # Busca el último día completo y completa secuencialmente hasta D-1.
    base=_v221052_latest_complete_db_payload(prev)
    if not base:
        return
    cur=date.fromisoformat(base['selected_day'])+timedelta(days=1)
    if (prev-cur).days>6:
        return
    while cur<=prev:
        if _v221052_main_day_from_db(cur) is None:
            p=await api_v22103_live(cur.isoformat(),force=1,_skip_prev_sync=True)
            if not p.get('ok') or not all(x.get('ok') for x in (p.get('stations') or [])):
                return
            _v221052_persist_operational_payload(p)
        cur+=timedelta(days=1)


async def _v221052_explicit_historical_day(day):
    """Serve an explicit past date without the authenticated station endpoint.

    Render uses the sitecustomize web-summary reader for historical days. This
    path is deliberately separate from the operational/latest fallback so a
    request for 2026-09-15 can never silently become 2026-09-17.
    """
    thresholds=_v22_load_thresholds()
    async def one(sid):
        base={
            'station_id':sid,'station_name':FIXED_STATIONS[sid],
            'lat':STATION_COORDS[sid]['lat'],'lon':STATION_COORDS[sid]['lon'],
            'day':day.isoformat(),'thresholds':thresholds.get(sid,{})
        }
        try:
            met=await asyncio.wait_for(
                _v221052_station_weather_fast_or_live(sid,day),
                timeout=25.0,
            )
            pf,pd,pc=prev_state(sid,day)
            res=calculate(
                met['temperature'],met['humidity'],met['wind_kmh'],met['rain_mm'],
                month=day.month,prev_ffmc=pf,prev_dmc=pd,prev_dc=pc
            )
            season_name,sf=ire_gip_season(day)
            wf=ire_gip_wind_factor(met.get('wind_direction_deg'),met['wind_kmh'])
            ire=min(100.0,max(0.0,float(res.fwi)*wf*sf))
            base.update({
                'ok':True,
                'temperature':met['temperature'],'humidity':met['humidity'],
                'wind_kmh':met['wind_kmh'],'rain_mm':met['rain_mm'],
                'wind_direction_deg':met.get('wind_direction_deg'),
                'wind_direction_cardinal':wind_cardinal(met.get('wind_direction_deg')),
                'temperature_time':met.get('temperature_time'),'humidity_time':met.get('humidity_time'),
                'wind_time':met.get('wind_time'),'temperature_delta_min':met.get('temperature_delta_min'),
                'humidity_delta_min':met.get('humidity_delta_min'),'wind_delta_min':met.get('wind_delta_min'),
                'noon_fallback_used':met.get('noon_fallback_used'),'post_cut_fallback_used':met.get('post_cut_fallback_used'),
                'temperature_mode':'historical_web_summary','humidity_mode':'historical_web_summary','wind_mode':'historical_web_summary',
                'rain_points_present':met.get('rain_points_present'),'rain_points_missing':met.get('rain_points_missing'),
                'rain_coverage_pct':met.get('rain_coverage_pct'),'rain_quality':met.get('rain_quality'),
                'data_quality':met.get('data_quality'),'source':met.get('source'),
                'meteo_source_station':sid,'meteo_source_station_name':FIXED_STATIONS[sid],
                'station_fallback_used':False,'station_fallback_distance_km':0.0,
                'station_fallback_attempts':[],'station_fallback_reason':None,
                'station_fallback_policy':'estacion_completa','station_package_complete':True,
                'ffmc':round(float(res.ffmc),4),'dmc':round(float(res.dmc),4),'dc':round(float(res.dc),4),
                'isi':round(float(res.isi),4),'bui':round(float(res.bui),4),'fwi':round(float(res.fwi),4),
                'fwi_level':v22_local_level(sid,res.fwi),'ire_gip':round(float(ire),4),
                'ire_gip_level':v22_local_level(sid,ire),'wind_factor':round(float(wf),4),
                'season_factor':round(float(sf),4),'season_name':season_name,
                'seed':{'ffmc':pf,'dmc':pd,'dc':pc},
            })
        except Exception as exc:
            base.update({'ok':False,'error_type':type(exc).__name__,'error':str(exc),
                         'temperature':None,'humidity':None,'wind_kmh':None,'rain_mm':None,
                         'fwi':None,'ire_gip':None,'fwi_level':None,'ire_gip_level':None,
                         'data_quality':'Sin dato','station_fallback_used':False})
        return base

    started=time.perf_counter()
    out=await asyncio.gather(*(one(sid) for sid in FIXED_STATION_IDS))
    elapsed=round(time.perf_counter()-started,3)
    return {
        'ok':any(x.get('ok') for x in out),
        'version':'V22.10.5.15 HISTÓRICO WEB SUMMARY',
        'writes_to_database':False,'selected_day':day.isoformat(),'stations':out,
        'mode':'explicit_historical_web_summary','calculation_seconds':elapsed,
        'db_fast_path':False,'requested_day':day.isoformat(),
        'note':'Fecha histórica explícita servida por summaryData de Euskalmet; no se usa el fallback de Último.',
    }
@app.get('/api/v22103/live')
async def api_v22103_live(day:str|None=None, force:int=0, _skip_prev_sync:bool=False):
    """
    V22.10.5:
      - caché persistente por fecha;
      - cinco estaciones en paralelo;
      - sustitución por estación geográficamente más cercana si la objetivo
        está completamente inoperativa ese día.
    No escribe en SQLite.
    """
    if day:
        try:
            d=date.fromisoformat(day)
        except Exception:
            return {'ok':False,'error':'Fecha no válida. Usa YYYY-MM-DD.','writes_to_database':False}
    else:
        # Política operativa dinámica para 'Último' y carga inicial:
        #   - antes de las 12:00 Europe/Madrid -> último dato real cerrado = D-1
        #   - desde las 12:00 Europe/Madrid    -> dato real de D0
        # No se usa MAX(day) de SQLite ni una fecha de predicción.
        madrid_now=datetime.now(ZoneInfo('Europe/Madrid'))
        madrid_today=madrid_now.date()
        d=madrid_today if madrid_now.hour >= 12 else madrid_today-timedelta(days=1)

    # Una fecha histórica explícita usa exclusivamente el lector histórico de Render.
    # Esto evita que una consulta, por ejemplo 2026-09-15, pueda caer al último día completo.
    if day is not None and d < date.today():
        return await _v221052_explicit_historical_day(d)

    # Para fechas operativas recientes garantizamos continuidad diaria antes de
    # calcular el FWI. Esto se ejecuta sólo cuando realmente falta el día previo.
    if not _skip_prev_sync and d >= datetime.now(ZoneInfo('Europe/Madrid')).date()-timedelta(days=7):
        await _v221052_ensure_previous_operational_day(d)

    # FAST PATH: cualquier fecha ya precalculada se sirve desde SQLite.
    # Si la llamada es 'Último'/inicial y el D0 aún no está en BD, NO bloqueamos
    # esperando a Euskalmet: devolvemos el último día completo. La UI hará un
    # intento de actualización D0 en segundo plano.
    if not force:
        db_payload=_v221052_main_day_from_db(d)
        if db_payload is not None:
            return db_payload
        if day is None:
            fallback_payload=_v221052_latest_complete_db_payload(d)
            if fallback_payload is not None:
                fallback_payload=dict(fallback_payload)
                fallback_payload['requested_day']=d.isoformat()
                fallback_payload['live_fallback']=True
                fallback_payload['needs_live_refresh']=datetime.now(ZoneInfo('Europe/Madrid')).hour >= 12
                fallback_payload['mode']='sqlite_immediate_fallback_pending_live_refresh'
                return fallback_payload

    cached=_v22105_cache_read(d,force=bool(force))
    if cached is not None:
        return cached

    thresholds=_v22_load_thresholds()

    async def one_station(sid):
        base={
            'station_id':sid,
            'station_name':FIXED_STATIONS[sid],
            'lat':STATION_COORDS[sid]['lat'],
            'lon':STATION_COORDS[sid]['lon'],
            'day':d.isoformat(),
            'thresholds':thresholds.get(sid,{})
        }
        try:
            met=await v22105_weather_with_station_fallback(sid,d)
            # La memoria es SIEMPRE la de la estación objetivo.
            pf,pd,pc=prev_state(sid,d)
            res=calculate(
                met['temperature'],met['humidity'],met['wind_kmh'],met['rain_mm'],
                month=d.month,prev_ffmc=pf,prev_dmc=pd,prev_dc=pc
            )
            season_name,sf=ire_gip_season(d)
            wf=ire_gip_wind_factor(met['wind_direction_deg'],met['wind_kmh'])
            ire=min(100.0,max(0.0,float(res.fwi)*wf*sf))

            base.update({
                'ok':True,
                'temperature':met['temperature'],
                'humidity':met['humidity'],
                'wind_kmh':met['wind_kmh'],
                'rain_mm':met['rain_mm'],
                'wind_direction_deg':met['wind_direction_deg'],
                'wind_direction_cardinal':wind_cardinal(met['wind_direction_deg']),
                'temperature_time':met.get('temperature_time'),
                'humidity_time':met.get('humidity_time'),
                'wind_time':met.get('wind_time'),
                'temperature_delta_min':met.get('temperature_delta_min'),
                'humidity_delta_min':met.get('humidity_delta_min'),
                'wind_delta_min':met.get('wind_delta_min'),
                'noon_fallback_used':met.get('noon_fallback_used'),
                'post_cut_fallback_used':met.get('post_cut_fallback_used'),
                'temperature_mode':met.get('temperature_mode'),
                'humidity_mode':met.get('humidity_mode'),
                'wind_mode':met.get('wind_mode'),
                'rain_points_present':met.get('rain_points_present'),
                'rain_points_missing':met.get('rain_points_missing'),
                'rain_coverage_pct':met.get('rain_coverage_pct'),
                'rain_quality':met.get('rain_quality'),
                'data_quality':met.get('data_quality'),
                'source':met.get('source'),
                'meteo_source_station':met.get('meteo_source_station'),
                'meteo_source_station_name':met.get('meteo_source_station_name'),
                'station_fallback_used':met.get('station_fallback_used'),
                'station_fallback_distance_km':met.get('station_fallback_distance_km'),
                'station_fallback_attempts':met.get('station_fallback_attempts'),
                'station_fallback_reason':met.get('station_fallback_reason'),
                'station_fallback_policy':met.get('station_fallback_policy','estacion_completa'),
                'station_package_complete':met.get('station_package_complete'),
                'ffmc':round(float(res.ffmc),4),
                'dmc':round(float(res.dmc),4),
                'dc':round(float(res.dc),4),
                'isi':round(float(res.isi),4),
                'bui':round(float(res.bui),4),
                'fwi':round(float(res.fwi),4),
                'fwi_level':v22_local_level(sid,res.fwi),
                'ire_gip':round(float(ire),4),
                'ire_gip_level':v22_local_level(sid,ire),
                'wind_factor':round(float(wf),4),
                'season_factor':round(float(sf),4),
                'season_name':season_name,
                'seed':{'ffmc':pf,'dmc':pd,'dc':pc},
            })
        except Exception as exc:
            base.update({
                'ok':False,
                'error_type':type(exc).__name__,
                'error':str(exc),
                'temperature':None,'humidity':None,'wind_kmh':None,'rain_mm':None,
                'fwi':None,'ire_gip':None,'fwi_level':None,'ire_gip_level':None,
                'data_quality':'Sin dato',
                'station_fallback_used':False,
            })
        return base

    started=time.perf_counter()
    out=await asyncio.gather(*(one_station(sid) for sid in FIXED_STATION_IDS))
    elapsed=round(time.perf_counter()-started,3)

    # Si Euskalmet no ha podido proporcionar ninguna estación, no dejamos la web vacía.
    # Mostramos el último día completo de SQLite y señalamos claramente el fallback.
    if not any(bool(x.get('ok')) for x in out):
        fallback_payload=_v221052_latest_complete_db_payload(d)
        if fallback_payload is not None:
            fallback_payload=dict(fallback_payload)
            fallback_payload['requested_day']=d.isoformat()
            fallback_payload['live_fallback']=True
            fallback_payload['live_fallback_reason']='Euskalmet no devolvió ninguna estación utilizable para la fecha solicitada'
            fallback_payload['mode']='sqlite_latest_complete_after_live_failure'
            fallback_payload['calculation_seconds']=elapsed
            return fallback_payload

    payload={
        'ok':True,
        'version':'V22.10.5.12 BASUGIX - ZONIFICACIÓN MUNICIPAL ROBUSTA',
        'writes_to_database':False,
        'selected_day':d.isoformat(),
        'stations':out,
        'mode':'cached_parallel_all_stations_with_nearest_backup',
        'calculation_seconds':elapsed,
        'backup_strategy':'sustitución de estación completa por la candidata Euskalmet elegible más cercana',
        'note':(
            'Si una estación está inoperativa todo el periodo utilizable del día, '
            'se usa la estación geográficamente más cercana disponible. '
            'FFMC/DMC/DC y umbrales siguen siendo los de la estación objetivo.'
        )
    }
    # Si es un día real completo y existe continuidad con D-1, queda almacenado.
    # Así la siguiente carga de BASUGIX y el botón 'Último' son consultas SQLite.
    persisted=_v221052_persist_operational_payload(payload)
    payload['operational_persisted']=bool(persisted)
    payload['writes_to_database']=bool(persisted)
    return _v22105_cache_write(d,payload)

@app.get('/debug/v22103/all/{day_iso}')
async def debug_v22103_all(day_iso:str):
    return await api_v22103_live(day_iso)



@app.get('/debug/v221052/backup-candidates/{station}')
async def debug_v221052_backup_candidates(station:str,force:int=0):
    station=station.upper()
    if station not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación objetivo no válida'}
    try:
        rows=await _v221051_backup_candidates(station,force_catalog=bool(force))
        return {
            'ok':True,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'target_station':station,
            'target_name':FIXED_STATIONS[station],
            'catalog_sources':[V221052_CATALOG_XLSX_URL,*V221052_CATALOG_URLS],
            'candidates':rows,
            'note':'Ordenadas por distancia; se prueba cada una hasta hallar T/HR/viento/lluvia utilizables.'
        }
    except Exception as exc:
        return {
            'ok':False,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'target_station':station,
            'catalog_sources':[V221052_CATALOG_XLSX_URL,*V221052_CATALOG_URLS],
            'error_type':type(exc).__name__,
            'error':str(exc)
        }



@app.get('/debug/v221052/substitution/{station}/{day_iso}')
async def debug_v221052_substitution(station:str,day_iso:str):
    """Diagnóstico aislado: indica si la estación objetivo se sustituye ese día."""
    station=station.upper()
    if station not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación objetivo no válida','writes_to_database':False}
    try:
        d=date.fromisoformat(day_iso)
    except Exception:
        return {'ok':False,'error':'Fecha no válida. Usa YYYY-MM-DD.','writes_to_database':False}

    try:
        met=await v22105_weather_with_station_fallback(station,d)
        return {
            'ok':True,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'writes_to_database':False,
            'target_station':station,
            'target_name':FIXED_STATIONS[station],
            'day':d.isoformat(),
            'substitution_used':bool(met.get('station_fallback_used')),
            'source_station':met.get('meteo_source_station'),
            'source_station_name':met.get('meteo_source_station_name'),
            'distance_km':met.get('station_fallback_distance_km'),
            'data_quality':met.get('data_quality'),
            'source':met.get('source'),
            'attempts':met.get('station_fallback_attempts',[]),
            'meteorology':{
                'temperature':met.get('temperature'),
                'humidity':met.get('humidity'),
                'wind_kmh':met.get('wind_kmh'),
                'rain_mm':met.get('rain_mm'),
                'temperature_time':met.get('temperature_time'),
                'humidity_time':met.get('humidity_time'),
                'wind_time':met.get('wind_time'),
            },
            'note':(
                'La sustitución solo afecta a la meteorología del día. '
                'La memoria FFMC/DMC/DC y los umbrales permanecen ligados a la estación objetivo.'
            )
        }
    except Exception as exc:
        return {
            'ok':False,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'writes_to_database':False,
            'target_station':station,
            'target_name':FIXED_STATIONS[station],
            'day':d.isoformat(),
            'error_type':type(exc).__name__,
            'error':str(exc)
        }


@app.get('/debug/v221052/find-substitutions/{station}/{start_iso}/{end_iso}')
async def debug_v221052_find_substitutions(station:str,start_iso:str,end_iso:str,max_days:int=62,stop_after:int=10):
    """Busca automáticamente días en los que una estación objetivo necesita respaldo.

    Recorre el intervalo inclusivo [start_iso, end_iso], de más reciente a más antiguo,
    sin escribir en la base de datos. Para evitar barridos accidentales demasiado grandes,
    limita el análisis a `max_days` (máximo 366) y puede detenerse al encontrar `stop_after`
    sustituciones (0 = no detener antes del final del intervalo limitado).
    """
    station=station.upper()
    if station not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación objetivo no válida','writes_to_database':False}

    try:
        start=date.fromisoformat(start_iso)
        end=date.fromisoformat(end_iso)
    except Exception:
        return {
            'ok':False,
            'error':'Fecha no válida. Usa YYYY-MM-DD para inicio y fin.',
            'writes_to_database':False
        }

    if start>end:
        start,end=end,start

    max_days=max(1,min(int(max_days),366))
    stop_after=max(0,min(int(stop_after),100))
    total_days=(end-start).days+1
    scan_days=min(total_days,max_days)

    substitutions=[]
    own_station_days=[]
    unavailable=[]
    scanned=0
    started=time.perf_counter()

    # Más reciente -> más antiguo: suele ser más práctico para localizar un caso real reciente.
    d=end
    while d>=start and scanned<scan_days:
        scanned+=1
        try:
            met=await v22105_weather_with_station_fallback(station,d)
            row={
                'day':d.isoformat(),
                'substitution_used':bool(met.get('station_fallback_used')),
                'source_station':met.get('meteo_source_station'),
                'source_station_name':met.get('meteo_source_station_name'),
                'distance_km':met.get('station_fallback_distance_km'),
                'data_quality':met.get('data_quality'),
                'temperature':met.get('temperature'),
                'humidity':met.get('humidity'),
                'wind_kmh':met.get('wind_kmh'),
                'rain_mm':met.get('rain_mm'),
                'attempts':met.get('station_fallback_attempts',[]),
            }
            if row['substitution_used']:
                substitutions.append(row)
                if stop_after and len(substitutions)>=stop_after:
                    break
            else:
                own_station_days.append({
                    'day':row['day'],
                    'data_quality':row['data_quality'],
                    'source_station':row['source_station']
                })
        except Exception as exc:
            unavailable.append({
                'day':d.isoformat(),
                'error_type':type(exc).__name__,
                'error':str(exc)
            })
        d-=timedelta(days=1)

    elapsed=round(time.perf_counter()-started,3)
    return {
        'ok':True,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'writes_to_database':False,
        'target_station':station,
        'target_name':FIXED_STATIONS[station],
        'requested_start':start.isoformat(),
        'requested_end':end.isoformat(),
        'requested_days':total_days,
        'scanned_days':scanned,
        'max_days':max_days,
        'stop_after':stop_after,
        'substitution_count':len(substitutions),
        'substitutions':substitutions,
        'unavailable_count':len(unavailable),
        'unavailable':unavailable,
        'own_station_count':len(own_station_days),
        'own_station_days':own_station_days,
        'calculation_seconds':elapsed,
        'note':(
            'Busca de fecha más reciente a más antigua. No escribe en la base de datos. '
            'Una sustitución solo se registra si falla la estación objetivo y una estación '
            'Euskalmet de respaldo proporciona meteorología utilizable.'
        )
    }


@app.get('/debug/v221052/find-first-substitutions/{start_iso}/{end_iso}')
async def debug_v221052_find_first_substitutions(start_iso:str,end_iso:str,max_days:int=366,stop_after:int=10):
    """Busca casos reales de sustitución entre las cinco estaciones objetivo.

    Recorre las fechas de más reciente a más antigua. En cada fecha comprueba en paralelo
    C023, C017, C058, C026 y C028, sin escribir en la base de datos. Se detiene cuando
    encuentra `stop_after` sustituciones o al alcanzar `max_days` fechas.
    """
    try:
        start=date.fromisoformat(start_iso)
        end=date.fromisoformat(end_iso)
    except Exception:
        return {
            'ok':False,
            'error':'Fecha no válida. Usa YYYY-MM-DD para inicio y fin.',
            'writes_to_database':False
        }

    if start>end:
        start,end=end,start

    max_days=max(1,min(int(max_days),3660))
    stop_after=max(1,min(int(stop_after),100))
    total_days=(end-start).days+1
    scan_days=min(total_days,max_days)

    substitutions=[]
    unavailable=[]
    station_summary={sid:{'checked_days':0,'own_station_days':0,'substitutions':0,'unavailable':0}
                     for sid in FIXED_STATION_IDS}
    scanned_dates=0
    station_checks=0
    started=time.perf_counter()

    async def check_one(sid,d):
        try:
            met=await v22105_weather_with_station_fallback(sid,d)
            return {
                'ok':True,
                'target_station':sid,
                'target_name':FIXED_STATIONS[sid],
                'day':d.isoformat(),
                'substitution_used':bool(met.get('station_fallback_used')),
                'source_station':met.get('meteo_source_station'),
                'source_station_name':met.get('meteo_source_station_name'),
                'distance_km':met.get('station_fallback_distance_km'),
                'data_quality':met.get('data_quality'),
                'temperature':met.get('temperature'),
                'humidity':met.get('humidity'),
                'wind_kmh':met.get('wind_kmh'),
                'rain_mm':met.get('rain_mm'),
                'temperature_time':met.get('temperature_time'),
                'humidity_time':met.get('humidity_time'),
                'wind_time':met.get('wind_time'),
                'attempts':met.get('station_fallback_attempts',[]),
            }
        except Exception as exc:
            return {
                'ok':False,
                'target_station':sid,
                'target_name':FIXED_STATIONS[sid],
                'day':d.isoformat(),
                'error_type':type(exc).__name__,
                'error':str(exc),
            }

    d=end
    while d>=start and scanned_dates<scan_days and len(substitutions)<stop_after:
        scanned_dates+=1
        rows=await asyncio.gather(*(check_one(sid,d) for sid in FIXED_STATION_IDS))
        station_checks+=len(rows)

        for row in rows:
            sid=row['target_station']
            station_summary[sid]['checked_days']+=1
            if not row['ok']:
                station_summary[sid]['unavailable']+=1
                unavailable.append(row)
                continue
            if row['substitution_used']:
                station_summary[sid]['substitutions']+=1
                substitutions.append(row)
                if len(substitutions)>=stop_after:
                    break
            else:
                station_summary[sid]['own_station_days']+=1

        d-=timedelta(days=1)

    elapsed=round(time.perf_counter()-started,3)
    return {
        'ok':True,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'writes_to_database':False,
        'target_stations':[{'station_id':sid,'name':FIXED_STATIONS[sid]} for sid in FIXED_STATION_IDS],
        'requested_start':start.isoformat(),
        'requested_end':end.isoformat(),
        'requested_days':total_days,
        'scanned_dates':scanned_dates,
        'station_checks':station_checks,
        'max_days':max_days,
        'stop_after':stop_after,
        'substitution_count':len(substitutions),
        'substitutions':substitutions,
        'unavailable_count':len(unavailable),
        'unavailable':unavailable,
        'station_summary':station_summary,
        'calculation_seconds':elapsed,
        'next_end_if_no_result':(
            (end-timedelta(days=scanned_dates)).isoformat()
            if len(substitutions)==0 and d>=start else None
        ),
        'note':(
            'Busca de fecha más reciente a más antigua en las cinco estaciones objetivo. '
            'Cada fecha se comprueba en paralelo. No escribe en la base de datos. '
            'Una sustitución solo cuenta cuando falla la estación objetivo y otra estación '
            'Euskalmet proporciona T/HR/viento/lluvia utilizables.'
        )
    }



@app.get('/debug/v221052/find-first-substitutions-fast/{start_iso}/{end_iso}')
async def debug_v221052_find_first_substitutions_fast(
    start_iso:str,
    end_iso:str,
    max_days:int=90,
    stop_after:int=3,
    max_live_days:int=14,
    per_check_timeout:int=25,
):
    """Búsqueda optimizada de sustituciones reales.

    Estrategia en dos fases:
      1) Revisa primero la base local `weather_daily` para localizar días ya calculados
         donde consta explícitamente una sustitución o una estación meteorológica distinta.
         Esta fase es casi instantánea y no llama a Euskalmet.
      2) Si no encuentra casos suficientes, realiza un barrido EN VIVO muy acotado,
         empezando por las fechas más recientes, con timeout por estación/día y un máximo
         de `max_live_days` fechas. De este modo una petición nunca debería quedar horas abierta.

    No escribe en la base de datos.
    """
    try:
        start=date.fromisoformat(start_iso)
        end=date.fromisoformat(end_iso)
    except Exception:
        return {
            'ok':False,
            'error':'Fecha no válida. Usa YYYY-MM-DD para inicio y fin.',
            'writes_to_database':False,
        }

    if start>end:
        start,end=end,start

    max_days=max(1,min(int(max_days),3660))
    stop_after=max(1,min(int(stop_after),20))
    max_live_days=max(0,min(int(max_live_days),31))
    per_check_timeout=max(5,min(int(per_check_timeout),60))

    total_days=(end-start).days+1
    effective_start=max(start,end-timedelta(days=max_days-1))
    started=time.perf_counter()

    substitutions=[]
    local_candidates=[]
    local_errors=[]

    # FASE 1: índice local. Aprovecha datos ya calculados sin tráfico de red.
    try:
        with con() as c:
            cols={r[1] for r in c.execute("PRAGMA table_info(weather_daily)").fetchall()}
            wanted={'station_id','day','meteo_source_station','station_fallback_used',
                    'station_fallback_distance_km','data_quality','temperature','humidity',
                    'wind_kmh','rain_mm'}
            if {'station_id','day'}.issubset(cols):
                select_cols=[x for x in wanted if x in cols]
                sql=(
                    f"SELECT {','.join(select_cols)} FROM weather_daily "
                    "WHERE station_id IN (?,?,?,?,?) AND day BETWEEN ? AND ? "
                    "ORDER BY day DESC"
                )
                rows=c.execute(sql,(*FIXED_STATION_IDS,effective_start.isoformat(),end.isoformat())).fetchall()
                for rr in rows:
                    row=dict(rr)
                    sid=str(row.get('station_id') or '').upper()
                    src=str(row.get('meteo_source_station') or '').upper()
                    explicit=bool(row.get('station_fallback_used'))
                    different=bool(src and sid and src!=sid)
                    if explicit or different:
                        local_candidates.append({
                            'target_station':sid,
                            'target_name':FIXED_STATIONS.get(sid,sid),
                            'day':row.get('day'),
                            'substitution_used':True,
                            'source_station':src or None,
                            'source_station_name':None,
                            'distance_km':row.get('station_fallback_distance_km'),
                            'data_quality':row.get('data_quality'),
                            'temperature':row.get('temperature'),
                            'humidity':row.get('humidity'),
                            'wind_kmh':row.get('wind_kmh'),
                            'rain_mm':row.get('rain_mm'),
                            'provenance':'weather_daily local',
                        })
    except Exception as exc:
        local_errors.append({'error_type':type(exc).__name__,'error':str(exc)})

    # Deduplicar y aceptar primero sustituciones ya registradas localmente.
    seen=set()
    for row in local_candidates:
        key=(row.get('target_station'),row.get('day'))
        if key in seen:
            continue
        seen.add(key)
        substitutions.append(row)
        if len(substitutions)>=stop_after:
            break

    live_scanned_dates=0
    live_station_checks=0
    live_timeouts=[]
    live_errors=[]

    async def live_check(sid,d):
        try:
            met=await asyncio.wait_for(
                v22105_weather_with_station_fallback(sid,d),
                timeout=per_check_timeout,
            )
            return {
                'ok':True,
                'target_station':sid,
                'target_name':FIXED_STATIONS[sid],
                'day':d.isoformat(),
                'substitution_used':bool(met.get('station_fallback_used')),
                'source_station':met.get('meteo_source_station'),
                'source_station_name':met.get('meteo_source_station_name'),
                'distance_km':met.get('station_fallback_distance_km'),
                'data_quality':met.get('data_quality'),
                'temperature':met.get('temperature'),
                'humidity':met.get('humidity'),
                'wind_kmh':met.get('wind_kmh'),
                'rain_mm':met.get('rain_mm'),
                'attempts':met.get('station_fallback_attempts',[]),
                'provenance':'live Euskalmet',
            }
        except asyncio.TimeoutError:
            return {
                'ok':False,'timeout':True,'target_station':sid,
                'target_name':FIXED_STATIONS[sid],'day':d.isoformat(),
                'error':f'timeout de {per_check_timeout}s',
            }
        except Exception as exc:
            return {
                'ok':False,'timeout':False,'target_station':sid,
                'target_name':FIXED_STATIONS[sid],'day':d.isoformat(),
                'error_type':type(exc).__name__,'error':str(exc),
            }

    # FASE 2: solo si hace falta. Máximo 14 días por defecto.
    if len(substitutions)<stop_after and max_live_days>0:
        d=end
        while d>=effective_start and live_scanned_dates<max_live_days and len(substitutions)<stop_after:
            live_scanned_dates+=1
            rows=await asyncio.gather(*(live_check(sid,d) for sid in FIXED_STATION_IDS))
            live_station_checks+=len(rows)
            for row in rows:
                if not row.get('ok'):
                    (live_timeouts if row.get('timeout') else live_errors).append(row)
                    continue
                if not row.get('substitution_used'):
                    continue
                key=(row.get('target_station'),row.get('day'))
                if key in seen:
                    continue
                seen.add(key)
                substitutions.append(row)
                if len(substitutions)>=stop_after:
                    break
            d-=timedelta(days=1)

    elapsed=round(time.perf_counter()-started,3)
    next_end=None
    if len(substitutions)<stop_after and max_live_days>0:
        candidate=end-timedelta(days=live_scanned_dates)
        if candidate>=effective_start:
            next_end=candidate.isoformat()

    return {
        'ok':True,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL - BUSCADOR OPTIMIZADO',
        'writes_to_database':False,
        'requested_start':start.isoformat(),
        'requested_end':end.isoformat(),
        'effective_start':effective_start.isoformat(),
        'requested_days':total_days,
        'max_days':max_days,
        'stop_after':stop_after,
        'strategy':'índice local primero + barrido vivo limitado con timeout',
        'local_candidate_count':len(local_candidates),
        'local_errors':local_errors,
        'live_scanned_dates':live_scanned_dates,
        'live_station_checks':live_station_checks,
        'per_check_timeout_seconds':per_check_timeout,
        'live_timeout_count':len(live_timeouts),
        'live_timeouts':live_timeouts[:20],
        'live_error_count':len(live_errors),
        'live_errors':live_errors[:20],
        'substitution_count':len(substitutions),
        'substitutions':substitutions[:stop_after],
        'calculation_seconds':elapsed,
        'next_end_if_more_search_needed':next_end,
        'recommended_next_call':(
            f'/debug/v221052/find-first-substitutions-fast/{effective_start.isoformat()}/{next_end}'
            f'?max_days={max_days}&stop_after={stop_after}&max_live_days={max_live_days}'
            if next_end and len(substitutions)<stop_after else None
        ),
        'note':(
            'Esta variante evita barridos de cientos de días en una sola petición. '
            'Busca primero sustituciones ya registradas en la base local y, solo si hacen falta, '
            'consulta Euskalmet durante un número pequeño de días con timeout por estación.'
        ),
    }

@app.get('/debug/v22105/cache')
async def debug_v22105_cache():
    files=[]
    for p in sorted(V22105_CACHE_DIR.glob('web_*.json')):
        try:
            files.append({
                'file':p.name,
                'size_bytes':p.stat().st_size,
                'modified':datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec='seconds')
            })
        except Exception:
            pass
    return {
        'ok':True,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'cache_dir':str(V22105_CACHE_DIR),
        'live_cache_seconds':V22105_LIVE_CACHE_SECONDS,
        'files':files,
        'backup_strategy':'sustitución de estación completa por la candidata Euskalmet elegible más cercana',
    }


@app.post('/admin/v22105/cache/clear')
async def admin_v22105_cache_clear():
    removed=[]
    for p in V22105_CACHE_DIR.glob('web_*.json'):
        try:
            p.unlink()
            removed.append(p.name)
        except Exception:
            pass
    return {'ok':True,'removed':removed,'count':len(removed)}

@app.get('/api/map/current')
async def api_map_current(day:str|None=None):
    requested_day=None
    if day:
        try:
            requested_day=date.fromisoformat(day)
        except Exception:
            return {'ok':False,'error':'Fecha no válida. Usa YYYY-MM-DD.'}

    # Si no se especifica fecha, usamos el último día disponible común o,
    # en su defecto, el último día disponible por estación.
    selected_day=requested_day.isoformat() if requested_day else None

    if selected_day is None:
        with con() as c:
            common=c.execute(
                """SELECT day
                   FROM fwi_daily
                   WHERE station_id IN (?,?,?,?,?)
                   GROUP BY day
                   HAVING COUNT(DISTINCT station_id)=5
                   ORDER BY day DESC LIMIT 1""",
                tuple(FIXED_STATION_IDS)
            ).fetchone()
            if common:
                selected_day=common['day']

    out=[]
    with con() as c:
        for sid in FIXED_STATION_IDS:
            if selected_day is not None:
                row=c.execute(
                    """SELECT
                           w.day,w.temperature,w.humidity,w.wind_kmh,w.rain_mm,w.source,w.observation_time,w.rain_points_present,w.rain_points_missing,w.rain_coverage_pct,w.rain_quality,w.data_quality,
                           f.fwi,f.ire_gip,f.wind_direction_deg,f.wind_direction_cardinal,
                           f.wind_factor,f.season_factor,f.season_name
                       FROM weather_daily w
                       LEFT JOIN fwi_daily f
                         ON f.station_id=w.station_id AND f.day=w.day
                       WHERE w.station_id=? AND w.day=?
                       LIMIT 1""",
                    (sid,selected_day)
                ).fetchone()
            else:
                row=c.execute(
                    """SELECT
                           w.day,w.temperature,w.humidity,w.wind_kmh,w.rain_mm,w.source,w.observation_time,w.rain_points_present,w.rain_points_missing,w.rain_coverage_pct,w.rain_quality,w.data_quality,
                           f.fwi,f.ire_gip,f.wind_direction_deg,f.wind_direction_cardinal,
                           f.wind_factor,f.season_factor,f.season_name
                       FROM weather_daily w
                       LEFT JOIN fwi_daily f
                         ON f.station_id=w.station_id AND f.day=w.day
                       WHERE w.station_id=?
                       ORDER BY w.day DESC LIMIT 1""",
                    (sid,)
                ).fetchone()

            item={
                'station_id':sid,
                'station_name':FIXED_STATIONS[sid],
                'lat':STATION_COORDS[sid]['lat'],
                'lon':STATION_COORDS[sid]['lon'],
            }
            if row:
                item.update(dict(row))
                item['fwi_level']=v22_local_level(sid,item['fwi']) if item.get('fwi') is not None else None
                item['ire_gip_level']=v22_local_level(sid,item['ire_gip']) if item.get('ire_gip') is not None else None
            else:
                item.update({
                    'day':selected_day,
                    'temperature':None,'humidity':None,'wind_kmh':None,'rain_mm':None,
                    'fwi':None,'ire_gip':None,'fwi_level':None,'ire_gip_level':None,
                    'wind_direction_deg':None,'wind_direction_cardinal':None
                })

            item['thresholds']=_v22_load_thresholds().get(sid,{})
            out.append(item)

    return {
        'ok':True,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'requested_day':day,
        'selected_day':selected_day,
        'stations':out,
        'influence_method':'zonificación fisioclimática experimental por comarcas oficiales B5M',
        'map_note':'El color representa el BASUGIX de la estación de referencia; no una medición directa en cada punto.'
    }


# -----------------------------------------------------------------------------
# V22.10.5.12 — Predicción HOY/MAÑANA/PASADO MAÑANA con Open-Meteo / ECMWF
# -----------------------------------------------------------------------------
_V221052_FORECAST_CACHE={'ts':0.0,'payload':None}
V221052_FORECAST_CACHE_SECONDS=int(os.getenv('V221052_FORECAST_CACHE_SECONDS','1800'))
V221052_OPENMETEO_URL=os.getenv('V221052_OPENMETEO_URL','https://api.open-meteo.com/v1/ecmwf')


def _v221052_latest_state_before(station, target_day):
    """Último estado FFMC/DMC/DC almacenado antes de target_day."""
    with con() as c:
        row=c.execute(
            """SELECT day,ffmc,dmc,dc FROM fwi_daily
               WHERE station_id=? AND day<? AND ffmc IS NOT NULL AND dmc IS NOT NULL AND dc IS NOT NULL
               ORDER BY day DESC LIMIT 1""",
            (station,target_day.isoformat())
        ).fetchone()
    if row:
        return date.fromisoformat(row['day']),float(row['ffmc']),float(row['dmc']),float(row['dc'])
    return None,float(INITIAL[0]),float(INITIAL[1]),float(INITIAL[2])


def _v221052_hourly_by_day(payload):
    hourly=(payload or {}).get('hourly') or {}
    times=hourly.get('time') or []
    tvals=hourly.get('temperature_2m') or []
    hvals=hourly.get('relative_humidity_2m') or []
    pvals=hourly.get('precipitation') or []
    wvals=hourly.get('wind_speed_10m') or []
    dvals=hourly.get('wind_direction_10m') or []
    rows=[]
    for i,ts in enumerate(times):
        try: dt=datetime.fromisoformat(str(ts))
        except Exception: continue
        def get(arr):
            try: return None if arr[i] is None else float(arr[i])
            except Exception: return None
        rows.append({'dt':dt,'temperature':get(tvals),'humidity':get(hvals),'precipitation':get(pvals),'wind_kmh':get(wvals),'direction':get(dvals)})
    rows.sort(key=lambda x:x['dt'])
    return rows


def _v221052_forecast_day_meteo(rows, day):
    """T/HR/viento a las 12:00 y precipitación acumulada (12h previas -> 12h actual)."""
    target=datetime(day.year,day.month,day.day,12,0)
    noon=[]
    for r in rows:
        if r['dt'].date()==day:
            delta=abs((r['dt']-target).total_seconds())
            noon.append((delta,r))
    noon.sort(key=lambda x:x[0])
    chosen=None
    for _,r in noon:
        if r['temperature'] is not None and r['humidity'] is not None and r['wind_kmh'] is not None:
            chosen=r; break
    if chosen is None:
        raise RuntimeError(f'Open-Meteo sin T/HR/viento para {day.isoformat()}')
    start=target-timedelta(hours=24)
    rain=0.0; rain_points=0
    for r in rows:
        if start < r['dt'] <= target and r['precipitation'] is not None:
            rain += max(0.0,float(r['precipitation'])); rain_points += 1
    if rain_points < 18:
        raise RuntimeError(f'Open-Meteo cobertura insuficiente de precipitación 24 h para {day.isoformat()} ({rain_points}/24)')
    return {
        'temperature':round(float(chosen['temperature']),2),
        'humidity':round(max(0.0,min(100.0,float(chosen['humidity']))),2),
        'wind_kmh':round(max(0.0,float(chosen['wind_kmh'])),2),
        'wind_direction_deg':None if chosen['direction'] is None else round(float(chosen['direction'])%360.0,2),
        'rain_mm':round(rain,2),
        'time':chosen['dt'].strftime('%H:%M'),
        'rain_points':rain_points,
    }


async def _v221052_openmeteo_all_locations():
    now=time.time()
    if _V221052_FORECAST_CACHE.get('payload') is not None and now-float(_V221052_FORECAST_CACHE.get('ts') or 0)<V221052_FORECAST_CACHE_SECONDS:
        return _V221052_FORECAST_CACHE['payload'],True
    lats=','.join(str(STATION_COORDS[s]['lat']) for s in FIXED_STATION_IDS)
    lons=','.join(str(STATION_COORDS[s]['lon']) for s in FIXED_STATION_IDS)
    params={
        'latitude':lats,
        'longitude':lons,
        'hourly':'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m',
        'timezone':'Europe/Madrid',
        'forecast_days':'3',
        'past_days':'35',
        'wind_speed_unit':'kmh',
        'precipitation_unit':'mm',
    }
    client=await _forecast_http_client()
    r=await client.get(V221052_OPENMETEO_URL,params=params,headers={'User-Agent':'BASUGIX V22.10.5.14 forecast'})
    if r.status_code>=400:
        raise RuntimeError(f'Open-Meteo HTTP {r.status_code}: {r.text[:300]}')
    payload=r.json()
    if isinstance(payload,dict): payload=[payload]
    if not isinstance(payload,list) or len(payload)!=len(FIXED_STATION_IDS):
        raise RuntimeError(f'Respuesta Open-Meteo inesperada: {type(payload).__name__}, ubicaciones={len(payload) if isinstance(payload,list) else "?"}')
    _V221052_FORECAST_CACHE.update({'ts':now,'payload':payload})
    print(f"BASUGIX Open-Meteo OK http={r.status_code} locations={len(payload)} model=ECMWF-IFS cache=False",flush=True)
    return payload,False




async def _v221052_live_rain_points_until(station, day, cutoff_dt):
    """Observaciones de precipitación 10-min en (D-1 12:00, cutoff].

    Usa la API Euskalmet en vivo. El resultado no se persiste ni se cachea para que
    cada recarga de D0 incorpore las observaciones más recientes disponibles.
    """
    prev=day-timedelta(days=1)
    start_dt=datetime(prev.year,prev.month,prev.day,12,0)
    end_dt=min(cutoff_dt,datetime(day.year,day.month,day.day,12,0))
    if end_dt<=start_dt:
        return {'rain_mm':0.0,'points':0,'latest_dt':None,'errors':[]}

    async def day_points(src_day):
        mapping=await _v222_mapping(station,src_day)
        sensor,mt,mid=mapping['rain_mm']
        _,_,keys=await _v224_day_index(station,sensor,mt,mid,src_day)
        selected=[]
        for key in keys:
            tm=_v224_time_from_key(key)
            if tm is None: continue
            hh,mm=map(int,tm.split(':'))
            branch_start=datetime(src_day.year,src_day.month,src_day.day,hh,mm)
            # La rama horaria puede contener 12:00..12:50. Inclúyela si solapa la ventana.
            branch_end=branch_start+timedelta(minutes=59,seconds=59)
            if branch_end>start_dt and branch_start<=end_dt:
                selected.append(key)
        # Ejecutar ramas en paralelo; reduce drásticamente la latencia frente a consulta secuencial.
        results=await asyncio.gather(*(_v224_follow_key(k,max_depth=4) for k in selected),return_exceptions=True)
        out=[]; errors=[]
        for key,res in zip(selected,results):
            if isinstance(res,Exception):
                errors.append(f'{key}: {type(res).__name__}: {res}')
                continue
            for hhmm,val,path in res:
                try:
                    hh,mm=map(int,hhmm.split(':'))
                    dt=datetime(src_day.year,src_day.month,src_day.day,hh,mm)
                    v=float(val)
                except Exception:
                    continue
                if start_dt < dt <= end_dt and 0.0 <= v <= 100.0:
                    out.append((dt,v,path))
        return out,errors

    chunks=await asyncio.gather(*(day_points(d) for d in sorted({prev,day})),return_exceptions=True)
    pts=[]; errors=[]
    for chunk in chunks:
        if isinstance(chunk,Exception):
            errors.append(f'{type(chunk).__name__}: {chunk}')
            continue
        vals,errs=chunk; pts.extend(vals); errors.extend(errs)
    # Deduplicar por instante/valor.
    seen=set(); clean=[]
    for dt,v,path in sorted(pts,key=lambda x:x[0]):
        k=(dt,round(v,8))
        if k in seen: continue
        seen.add(k); clean.append((dt,v,path))
    return {
        'rain_mm':round(sum(v for _,v,_ in clean),4),
        'points':len(clean),
        'latest_dt':clean[-1][0] if clean else None,
        'errors':errors[:8],
    }


async def _v221052_live_noon_package(station, day):
    """T/HR/viento observados cerca de las 12:00; todo-o-nada para no mezclar el paquete."""
    mapping=await _v222_mapping(station,day)
    vals={}; times={}; meta={}
    for var in ('temperature','humidity','wind_kmh'):
        sensor,mt,mid=mapping[var]
        val,tm,info=await _v224_measure_at_noon(station,sensor,mt,mid,day)
        vals[var]=float(val); times[var]=tm; meta[var]=info
    # mean_speed de Euskalmet está en m/s en esta ruta.
    vals['wind_kmh']=max(0.0,vals['wind_kmh']*3.6)
    try:
        _,direction=await web_summary_wind(station,day)
    except Exception:
        direction=None
    return {
        'temperature':round(vals['temperature'],2),
        'humidity':round(max(0.0,min(100.0,vals['humidity'])),2),
        'wind_kmh':round(vals['wind_kmh'],2),
        'wind_direction_deg':None if direction is None else round(float(direction)%360.0,2),
        'temperature_time':times['temperature'],'humidity_time':times['humidity'],'wind_time':times['wind_kmh'],
        'meta':meta,
    }


def _v221052_hybrid_d0_meteo(model_rows, day, live_rain, live_noon, now_dt):
    """Compone D0: Euskalmet observado hasta ahora + Open-Meteo para lo que aún falta."""
    model=_v221052_forecast_day_meteo(model_rows,day)
    target=datetime(day.year,day.month,day.day,12,0)
    cutoff=live_rain.get('latest_dt') if live_rain else None
    obs_rain=float((live_rain or {}).get('rain_mm') or 0.0)
    obs_points=int((live_rain or {}).get('points') or 0)

    # Completar lluvia sólo después de la última observación real. Si no hay ninguna,
    # Open-Meteo aporta la ventana completa de 24 h.
    if cutoff is None:
        forecast_rain=float(model['rain_mm']); forecast_points=int(model['rain_points'])
    else:
        forecast_rain=0.0; forecast_points=0
        start=datetime(day.year,day.month,day.day,12,0)-timedelta(hours=24)
        for r in model_rows:
            if max(start,cutoff) < r['dt'] <= target and r['precipitation'] is not None:
                forecast_rain += max(0.0,float(r['precipitation'])); forecast_points += 1

    use_live_noon=bool(live_noon)
    t=float(live_noon['temperature']) if use_live_noon else float(model['temperature'])
    rh=float(live_noon['humidity']) if use_live_noon else float(model['humidity'])
    wind=float(live_noon['wind_kmh']) if use_live_noon else float(model['wind_kmh'])
    direction=(live_noon.get('wind_direction_deg') if use_live_noon else model.get('wind_direction_deg'))
    noon_time=(live_noon.get('temperature_time') if use_live_noon else model.get('time'))

    observed_pct=round(min(100.0,100.0*obs_points/144.0),1)
    return {
        'temperature':round(t,2),'humidity':round(rh,2),'wind_kmh':round(wind,2),
        'wind_direction_deg':direction,
        'rain_mm':round(max(0.0,obs_rain+forecast_rain),2),
        'time':noon_time,
        'temperature_time':live_noon.get('temperature_time') if use_live_noon else model.get('time'),
        'humidity_time':live_noon.get('humidity_time') if use_live_noon else model.get('time'),
        'wind_time':live_noon.get('wind_time') if use_live_noon else model.get('time'),
        'rain_points':obs_points,
        'observed_rain_points':obs_points,'forecast_rain_hours':forecast_points,
        'observed_rain_mm':round(obs_rain,2),'forecast_rain_mm':round(forecast_rain,2),
        'observed_rain_pct':observed_pct,'forecast_rain_pct':round(max(0.0,100.0-observed_pct),1),
        'latest_euskalmet_time':cutoff.strftime('%Y-%m-%d %H:%M') if cutoff else None,
        'noon_package_observed':use_live_noon,
        'hybrid':True,
    }

@app.get('/api/v221052/forecast3')
async def api_v221052_forecast3(offset:int=0):
    """D0 híbrido Euskalmet+Open-Meteo; D+1/D+2 modelo. No escribe en SQLite."""
    offset=max(0,min(int(offset),2))
    madrid_now=datetime.now(ZoneInfo('Europe/Madrid'))
    today=madrid_now.date()
    # D0 sólo tiene sentido como previsión híbrida antes de las 12:00 hora local.
    if offset==0 and madrid_now.hour>=12:
        return {
            'ok':False,
            'forecast':True,
            'forecast_offset':0,
            'error':'La previsión D0 sólo está disponible antes de las 12:00. Después de las 12:00 se muestran únicamente D+1 y D+2.',
            'd0_available':False,
            'local_time':madrid_now.isoformat(timespec='minutes'),
            'writes_to_database':False,
        }
    target=today+timedelta(days=offset)
    now_dt=madrid_now.replace(tzinfo=None)
    started=time.perf_counter()
    try:
        raw_list,cache_hit=await _v221052_openmeteo_all_locations()
        print(f"BASUGIX forecast request offset={offset} target={target.isoformat()} provider=Open-Meteo/ECMWF-IFS cache={cache_hit}",flush=True)
        thresholds=_v22_load_thresholds()

        forecast_seed_today={}
        if offset in (1,2) and madrid_now.hour>=12:
            today_payload=_v221052_main_day_from_db(today)
            if today_payload is None:
                try:
                    today_payload=await api_v22103_live(today.isoformat(),force=1,_skip_prev_sync=False)
                except Exception as exc:
                    today_payload=None
                    print(f"BASUGIX forecast D0 seed error: {type(exc).__name__}: {exc}",flush=True)
            if isinstance(today_payload,dict):
                for st in today_payload.get('stations') or []:
                    if st.get('ok') and st.get('ffmc') is not None and st.get('dmc') is not None and st.get('dc') is not None:
                        forecast_seed_today[st.get('station_id')]={
                            'day':today,
                            'ffmc':float(st['ffmc']),'dmc':float(st['dmc']),'dc':float(st['dc'])
                        }

        async def build_station(sid,raw):
            rows=_v221052_hourly_by_day(raw)
            if sid in forecast_seed_today:
                seed=forecast_seed_today[sid]
                seed_day=seed['day']
                pf,pd,pc=seed['ffmc'],seed['dmc'],seed['dc']
                seed_ffmc,seed_dmc,seed_dc=pf,pd,pc
            else:
                seed_day,pf,pd,pc=_v221052_latest_state_before(sid,today)
                seed_ffmc,seed_dmc,seed_dc=pf,pd,pc
                model_days=sorted({r['dt'].date() for r in rows})
                if model_days:
                    first_model_day=model_days[0]
                    if seed_day is None:
                        seed_day=first_model_day-timedelta(days=1)
                        pf,pd,pc=INITIAL
                        seed_ffmc,seed_dmc,seed_dc=pf,pd,pc
                    elif seed_day < first_model_day-timedelta(days=1):
                        seed_day=first_model_day-timedelta(days=1)

            cur=(seed_day+timedelta(days=1)) if seed_day else today
            last_met=None; last_res=None; last_wf=1.0; last_sf=1.0; last_season=None
            live_meta=None
            guard=0
            while cur<=target and guard<12:
                if cur==today:
                    live_rain=None; live_noon=None; live_error=None
                    try:
                        live_rain=await _v221052_live_rain_points_until(sid,today,now_dt)
                    except Exception as exc:
                        live_error=f'lluvia: {type(exc).__name__}: {exc}'
                        live_rain={'rain_mm':0.0,'points':0,'latest_dt':None,'errors':[live_error]}
                    # El paquete de mediodía sólo sustituye al modelo cuando ya puede obtenerse completo.
                    if now_dt >= datetime(today.year,today.month,today.day,12,0):
                        try:
                            live_noon=await _v221052_live_noon_package(sid,today)
                        except Exception as exc:
                            live_error=(live_error+' | ' if live_error else '')+f'noon: {type(exc).__name__}: {exc}'
                    met=_v221052_hybrid_d0_meteo(rows,today,live_rain,live_noon,now_dt)
                    met['live_error']=live_error
                    live_meta=met
                else:
                    met=_v221052_forecast_day_meteo(rows,cur)
                    met['hybrid']=False
                res=calculate(met['temperature'],met['humidity'],met['wind_kmh'],met['rain_mm'],month=cur.month,prev_ffmc=pf,prev_dmc=pd,prev_dc=pc)
                season_name,sf=ire_gip_season(cur)
                wf=ire_gip_wind_factor(met['wind_direction_deg'],met['wind_kmh'])
                pf,pd,pc=float(res.ffmc),float(res.dmc),float(res.dc)
                last_met,last_res,last_wf,last_sf,last_season=met,res,wf,sf,season_name
                cur+=timedelta(days=1); guard+=1
            if last_met is None or last_res is None:
                raise RuntimeError(f'No se pudo encadenar la memoria FWI hasta {target.isoformat()} para {sid}')
            ire=min(100.0,max(0.0,float(last_res.fwi)*last_wf*last_sf))
            is_hybrid=bool(offset==0 and last_met.get('hybrid'))
            if is_hybrid:
                q=(f"D0 híbrido · lluvia {last_met.get('observed_rain_pct',0):.1f}% observada · "
                   +('T/HR/viento observados 12:00' if last_met.get('noon_package_observed') else 'T/HR/viento previstos 12:00'))
                source='Euskalmet 10-min + Open-Meteo · ECMWF IFS'
                source_name='Euskalmet + Open-Meteo / ECMWF'
                rain_quality=f"Híbrida: {last_met.get('observed_rain_points',0)}/144 puntos 10-min observados + {last_met.get('forecast_rain_hours',0)} h previstas"
            else:
                q='Predicción meteorológica'; source='Open-Meteo · ECMWF IFS'; source_name='Open-Meteo / ECMWF'; rain_quality='Pronóstico horario 24 h'
            return {
                'station_id':sid,'station_name':FIXED_STATIONS[sid],
                'lat':STATION_COORDS[sid]['lat'],'lon':STATION_COORDS[sid]['lon'],
                'day':target.isoformat(),'thresholds':thresholds.get(sid,{}),'ok':True,
                'temperature':last_met['temperature'],'humidity':last_met['humidity'],'wind_kmh':last_met['wind_kmh'],
                'rain_mm':last_met['rain_mm'],'wind_direction_deg':last_met['wind_direction_deg'],
                'wind_direction_cardinal':wind_cardinal(last_met['wind_direction_deg']),
                'temperature_time':last_met.get('temperature_time',last_met.get('time')),
                'humidity_time':last_met.get('humidity_time',last_met.get('time')),
                'wind_time':last_met.get('wind_time',last_met.get('time')),
                'rain_points_present':last_met.get('observed_rain_points',last_met.get('rain_points')),
                'rain_points_missing':max(0,144-int(last_met.get('observed_rain_points',0))) if is_hybrid else max(0,24-int(last_met.get('rain_points',0))),
                'rain_coverage_pct':last_met.get('observed_rain_pct',100.0 if not is_hybrid else 0.0),
                'rain_quality':rain_quality,'data_quality':q,
                'source':source,'meteo_source_station':'HYBRID' if is_hybrid else 'OPENMETEO','meteo_source_station_name':source_name,
                'station_fallback_used':False,'station_fallback_distance_km':0.0,'station_fallback_attempts':[],
                'station_fallback_reason':None,'station_fallback_policy':'hybrid_live_d0' if is_hybrid else 'forecast_model','station_package_complete':True,
                'ffmc':round(float(last_res.ffmc),4),'dmc':round(float(last_res.dmc),4),'dc':round(float(last_res.dc),4),
                'isi':round(float(last_res.isi),4),'bui':round(float(last_res.bui),4),'fwi':round(float(last_res.fwi),4),
                'fwi_level':v22_local_level(sid,last_res.fwi),'ire_gip':round(float(ire),4),'ire_gip_level':v22_local_level(sid,ire),
                'wind_factor':round(float(last_wf),4),'season_factor':round(float(last_sf),4),'season_name':last_season,
                'seed':{'day':seed_day.isoformat() if seed_day else None,'ffmc':round(float(seed_ffmc),4),'dmc':round(float(seed_dmc),4),'dc':round(float(seed_dc),4)},
                'forecast':True,'forecast_offset':offset,'forecast_model':'ECMWF IFS via Open-Meteo',
                'hybrid_d0':is_hybrid,
                'hybrid_observed_rain_pct':last_met.get('observed_rain_pct') if is_hybrid else None,
                'hybrid_forecast_rain_pct':last_met.get('forecast_rain_pct') if is_hybrid else None,
                'hybrid_observed_rain_mm':last_met.get('observed_rain_mm') if is_hybrid else None,
                'hybrid_forecast_rain_mm':last_met.get('forecast_rain_mm') if is_hybrid else None,
                'hybrid_latest_euskalmet_time':last_met.get('latest_euskalmet_time') if is_hybrid else None,
                'hybrid_noon_observed':last_met.get('noon_package_observed') if is_hybrid else None,
                'hybrid_live_error':last_met.get('live_error') if is_hybrid else None,
            }

        built=await asyncio.gather(*(build_station(sid,raw) for sid,raw in zip(FIXED_STATION_IDS,raw_list)),return_exceptions=True)
        stations=[]; errors=[]
        for sid,res in zip(FIXED_STATION_IDS,built):
            if isinstance(res,Exception):
                err={'station_id':sid,'error_type':type(res).__name__,'error':str(res)}
                errors.append(err)
                stations.append({
                    'station_id':sid,'station_name':FIXED_STATIONS[sid],
                    'lat':STATION_COORDS[sid]['lat'],'lon':STATION_COORDS[sid]['lon'],
                    'day':target.isoformat(),'thresholds':thresholds.get(sid,{}),
                    'ok':False,'error_type':type(res).__name__,'error':str(res),
                    'temperature':None,'humidity':None,'wind_kmh':None,'rain_mm':None,
                    'wind_direction_deg':None,'wind_direction_cardinal':None,
                    'temperature_time':None,'humidity_time':None,'wind_time':None,
                    'rain_points_present':0,'rain_points_missing':144,
                    'rain_coverage_pct':0.0,'rain_quality':'Daturik gabe',
                    'data_quality':'Daturik gabe','source':'',
                    'meteo_source_station':'','meteo_source_station_name':'',
                    'station_fallback_used':False,'station_fallback_distance_km':0.0,
                    'station_fallback_attempts':[],'station_fallback_reason':str(res),
                    'station_fallback_policy':'forecast_error',
                    'station_package_complete':False,
                    'ffmc':None,'dmc':None,'dc':None,'isi':None,'bui':None,
                    'fwi':None,'fwi_level':None,'ire_gip':None,'ire_gip_level':None,
                    'wind_factor':None,'season_factor':None,'season_name':None,
                    'seed':None,'forecast':True,'forecast_offset':offset,
                    'forecast_model':'ECMWF IFS via Open-Meteo','hybrid_d0':False
                })
            else:
                stations.append(res)
        if not stations or not any(s.get('ok') is not False for s in stations):
            raise RuntimeError(f'No se pudo calcular ninguna estación: {errors}')
        return {
            'ok':True,'version':'V22.10.5.14 · ISI EN PANELES + RAPIDEZ + D0 HÍBRIDO EUSKALMET + OPEN-METEO','writes_to_database':False,
            'selected_day':target.isoformat(),'stations':stations,'mode':'hybrid_forecast' if offset==0 else 'forecast',
            'openmeteo_provider':'Open-Meteo / ECMWF IFS','openmeteo_cache_hit':bool(cache_hit),
            'forecast':True,'forecast_offset':offset,'forecast_model':'ECMWF IFS via Open-Meteo',
            'calculation_seconds':round(time.perf_counter()-started,3),'cache':{'hit':cache_hit},'errors':errors,
            'note':('D0 se recalcula en cada petición: FFMC/DMC/DC parten de D-1 real; lluvia usa Euskalmet 10-min hasta la última lectura disponible y Open-Meteo sólo para el tramo restante hasta las 12:00. '
                    'T/HR/viento usan Open-Meteo hasta que el paquete observado de mediodía esté completo; entonces pasan íntegramente a Euskalmet. D+1/D+2 permanecen como pronóstico encadenado.')
        }
    except Exception as exc:
        return {'ok':False,'forecast':True,'forecast_offset':offset,'error_type':type(exc).__name__,'error':str(exc),'writes_to_database':False}

@app.get('/',response_class=HTMLResponse)
async def v227_home(lang:str='eu'):
    lang='eu' if str(lang).lower().startswith('eu') else 'es'
    html=r"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BASUGIX Gipuzkoa · V22.10.5.14 · ISI + rapidez + D0 híbrido + Predicción +2</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
:root{
 --bg:#f3f6f2;--card:#fff;--ink:#10251c;--muted:#64746c;--line:#dbe4dd;
 --deep:#073f2d;--deep2:#0b5a3f;--low:#4CAF50;--mod:#F4C430;
 --high:#F7931E;--very:#E84A22;--ext:#A61B29;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,Segoe UI,Arial,sans-serif}
.top{background:linear-gradient(90deg,#052f24,#07503a);color:#fff;padding:14px 24px}
.topin{max-width:1540px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:18px}
.brand{display:flex;align-items:center;gap:12px}.brand strong{font-size:26px}.brand span{opacity:.82;font-size:13px}
.nav{display:flex;gap:10px;flex-wrap:wrap}.nav a{color:#fff;text-decoration:none;padding:9px 12px;border-radius:9px;font-size:13px}.nav a.active{background:rgba(255,255,255,.14)}
.langswitch{display:flex;gap:5px;margin-left:8px}.langswitch a{color:#fff;text-decoration:none;border:1px solid rgba(255,255,255,.4);padding:7px 9px;border-radius:8px;font-size:12px;font-weight:800}.langswitch a:hover{background:rgba(255,255,255,.15)}
.wrap{max-width:1540px;margin:auto;padding:22px}
.headline{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-bottom:14px}
h1{font-size:25px;margin:0}.sub{color:var(--muted);font-size:14px;margin-top:4px}
.status{background:#fff;border:1px solid var(--line);padding:10px 14px;border-radius:12px;font-size:13px} button:disabled{opacity:.45;cursor:not-allowed}
.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}
.card{background:#fff;border:1px solid var(--line);border-radius:15px;padding:14px;cursor:pointer;transition:.15s}
.card:hover,.card.sel{border-color:#6d8d7b;box-shadow:0 5px 18px rgba(10,50,35,.08)}
.ctop{display:flex;justify-content:space-between;gap:8px}.sid{font-size:12px;color:var(--muted)}.name{font-weight:800}
.ival{font-size:30px;font-weight:900;margin:10px 0 4px}.pill{display:inline-block;padding:5px 10px;border-radius:999px;font-weight:800;font-size:12px}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;border-top:1px solid #edf1ed;padding-top:10px;margin-top:10px;font-size:11px;color:var(--muted)}
.metrics b{display:block;color:var(--ink);font-size:13px}
.isirow{margin-top:9px;padding-top:8px;border-top:1px dashed #dfe7e1;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;color:var(--muted)}
.isirow b{font-size:16px;color:var(--ink)}
.main{display:grid;grid-template-columns:minmax(0,2.25fr) minmax(300px,.75fr);gap:14px}
.panel{background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden}
.panelhead{padding:13px 15px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;align-items:center}
.panelhead strong{font-size:15px}.small{font-size:11px;color:var(--muted)}
#map{height:610px;background:#dfe9e1}
.side{padding:16px}.side h2{font-size:18px;margin:0 0 12px}
.big{font-size:42px;font-weight:900}
.levelrow{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.kv{border-top:1px solid var(--line);padding:9px 0;display:flex;justify-content:space-between;gap:12px;font-size:13px}
.thresholds{margin:14px 0;padding:12px;background:#f7faf7;border-radius:12px}
.thresholds .bar{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:8px}
.thresholds .seg{height:9px;border-radius:6px}
.legend{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;font-size:12px}
.dot{width:11px;height:11px;border-radius:50%;display:inline-block;margin-right:6px}
.actions{display:flex;gap:8px;margin-top:15px}.btn{display:inline-block;background:var(--deep);color:#fff;text-decoration:none;padding:10px 12px;border-radius:10px;font-weight:700;font-size:13px}
.note{margin-top:14px;padding:11px;border:1px solid var(--line);border-radius:10px;color:var(--muted);font-size:12px;line-height:1.45}
.footer{margin-top:14px;padding:13px 15px;border:1px solid #b9d3c2;background:#f5fbf6;border-radius:13px;font-size:12px;color:#355846}
.leaflet-tooltip.stationTip{background:#fff;border:1px solid #cfd9d2;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.12);font-weight:700}

/* Histórico integrado */
.histpanel{margin-top:16px;background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden}
.histbody{padding:16px}
.histcontrols{display:grid;grid-template-columns:1.15fr .85fr .85fr auto;gap:10px;align-items:end}
.histcontrols label{display:block;font-size:11px;font-weight:800;color:var(--muted);margin-bottom:5px}
.histcontrols select,.histcontrols input,.histcontrols button{width:100%;height:40px;border:1px solid var(--line);border-radius:9px;background:#fff;padding:0 10px}
.histcontrols button{background:var(--deep);color:#fff;border:0;font-weight:800;cursor:pointer;padding:0 16px}
.histmeta{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:var(--muted)}
.histstats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:12px}
.histstat{border:1px solid var(--line);border-radius:11px;padding:10px;background:#fafcf9}
.histstat .hk{font-size:10px;color:var(--muted);font-weight:800}.histstat .hv{font-size:21px;font-weight:900;margin-top:3px}.histstat .hs{font-size:10px;color:var(--muted)}
.histchart{height:260px;margin-top:14px;border:1px solid var(--line);border-radius:12px;padding:8px}.histchart canvas{width:100%;height:100%}
.histpager{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px}.histpager button{padding:6px 10px}.histpager .small{min-width:120px;text-align:center}
.histtable{overflow:auto;max-height:380px;margin-top:12px;border:1px solid var(--line);border-radius:11px}
.histtable table{border-collapse:collapse;width:100%;font-size:11px;background:#fff}.histtable th,.histtable td{padding:7px 8px;border-bottom:1px solid #edf1ed;text-align:right;white-space:nowrap}.histtable th{position:sticky;top:0;background:#eef3ef;z-index:2}.histtable th:first-child,.histtable td:first-child{text-align:left}
.histempty{text-align:center;padding:24px;color:var(--muted)}
@media(max-width:1100px){.cards{grid-template-columns:repeat(2,1fr)}.main{grid-template-columns:1fr}.side{order:-1}#map{height:520px}}
@media(max-width:900px){.histcontrols{grid-template-columns:1fr 1fr}.histstats{grid-template-columns:repeat(2,1fr)}}
@media(max-width:650px){.cards{grid-template-columns:1fr}.wrap{padding:12px}.headline{align-items:flex-start;flex-direction:column}.topin{align-items:flex-start;flex-direction:column}.main{display:block}.panel{margin-bottom:12px}#map{height:420px}.grid2{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="top"><div class="topin">
 <div class="brand"><div style="font-size:31px">🔥</div><div><strong>BASUGIX</strong><br><span>BASUGIX · Índice de riesgo de incendios forestales de Gipuzkoa</span></div></div>
 <div class="nav"><a class="active" href="/">INICIO</a><a href="#historico" id="navHistorico">HISTÓRICO</a><a href="/tabla">TABLA</a><a href="/health">ESTADO</a></div>
 <div class="langswitch"><a href="/?lang=es">ES</a><a href="/?lang=eu">EU</a></div>
</div></div>

<div class="wrap">
 <div class="headline">
   <div><h1>Situación territorial de riesgo de incendio</h1><div class="sub" id="dateLine">Últimos datos disponibles de las cinco estaciones</div></div>
   <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
     <button id="prevDay" type="button" style="height:40px;border:1px solid var(--line);background:#fff;border-radius:10px;padding:0 12px;cursor:pointer">←</button>
     <input id="mapDate" type="date" style="height:40px;border:1px solid var(--line);border-radius:10px;padding:0 10px;background:#fff">
     <button id="nextDay" type="button" style="height:40px;border:1px solid var(--line);background:#fff;border-radius:10px;padding:0 12px;cursor:pointer">→</button>
     <button id="latestDay" title="Último dato real: D-1 antes de las 12:00; D0 desde las 12:00" type="button" style="height:40px;border:0;background:var(--deep);color:#fff;border-radius:10px;padding:0 14px;font-weight:700;cursor:pointer">Último</button>
     <button id="forecastD0" class="forecastBtn" data-offset="0" type="button" style="height:40px;border:1px solid #8bb6a0;background:#eef8f1;color:#073f2d;border-radius:10px;padding:0 12px;font-weight:800;cursor:pointer">Hoy · Prev.</button>
     <button class="forecastBtn" data-offset="1" type="button" style="height:40px;border:1px solid #8bb6a0;background:#eef8f1;color:#073f2d;border-radius:10px;padding:0 12px;font-weight:800;cursor:pointer">Mañana · Prev.</button>
     <button class="forecastBtn" data-offset="2" type="button" style="height:40px;border:1px solid #8bb6a0;background:#eef8f1;color:#073f2d;border-radius:10px;padding:0 12px;font-weight:800;cursor:pointer">Pasado mañana · Prev.</button>
     <div class="status" id="status">Cargando datos y mapa…</div>
   </div>
 </div>

 <div class="cards" id="cards"></div>

 <div class="main">
   <section class="panel">
    <div class="panelhead"><div><strong>Mapa de riesgo · Gipuzkoa</strong><div class="small">Mapa real + zonificación territorial continua + límites municipales + municipio bajo cursor</div></div><div class="small">V22.10.5.12 · D-1 observado + predicción hoy/mañana/+2</div></div>
    <div id="map"></div>
   </section>

   <aside class="panel side">
     <h2>Detalle de estación</h2>
     <div class="levelrow"><div class="big" id="dIre">—</div><span class="pill" id="dLevel">—</span></div>
     <div class="kv"><span>Estación objetivo</span><b id="dName">—</b></div>
     <div class="kv"><span>Fecha del cálculo</span><b id="dDay">—</b></div>
     <div class="kv"><span>Temperatura</span><b id="dT">—</b></div>
     <div class="kv"><span>Humedad</span><b id="dRh">—</b></div>
     <div class="kv"><span>Viento medio</span><b id="dWind">—</b></div>
     <div class="kv"><span>Dirección</span><b id="dDir">—</b></div>
     <div class="kv"><span>Lluvia 24 h</span><b id="dRain">—</b></div>
     <div class="kv"><span>Cobertura lluvia</span><b id="dCoverage">—</b></div>
     <div class="kv"><span>Calidad</span><b id="dQuality">—</b></div>
     <div class="kv"><span>Horas T / HR / viento</span><b id="dTimes">—</b></div>
     <div class="kv"><span>Datos meteorológicos usados</span><b id="dSourceStation">—</b></div>
     <div class="kv" id="dFallbackReasonRow" style="display:none"><span>Motivo de sustitución</span><b id="dFallbackReason">—</b></div>
     <div class="kv" id="dFallbackPolicyRow" style="display:none"><span>Política de respaldo</span><b id="dFallbackPolicy">—</b></div>
     <div id="dFallbackNotice" style="display:none;margin:10px 0;padding:10px 12px;border-radius:10px;background:#fff3cd;border:1px solid #e6c75a;color:#5d4a00;font-size:13px;line-height:1.35"></div>
     <div class="kv"><span>FWI</span><b id="dFwi">—</b></div>
     <div class="thresholds">
       <b>Umbrales locales</b><div class="small">P40 / P65 / P85 / P95 de la estación</div>
       <div id="thrText" class="small" style="margin-top:8px">—</div>
       <div class="bar"><div class="seg" style="background:var(--low)"></div><div class="seg" style="background:var(--mod)"></div><div class="seg" style="background:var(--high)"></div><div class="seg" style="background:var(--very)"></div><div class="seg" style="background:var(--ext)"></div></div>
     </div>
     <div class="legend">
       <span><i class="dot" style="background:var(--low)"></i>Bajo</span>
       <span><i class="dot" style="background:var(--mod)"></i>Moderado</span>
       <span><i class="dot" style="background:var(--high)"></i>Alto</span>
       <span><i class="dot" style="background:var(--very)"></i>Muy alto</span>
       <span><i class="dot" style="background:var(--ext)"></i>Extremo</span>
     </div>
     <div class="actions"><a class="btn" id="histLink" href="#historico">Ver histórico aquí</a></div>
     <div class="note">El color de cada área representa el BASUGIX de su estación de referencia. La zona de referencia se asigna por afinidad fisioclimática y <b>no equivale a una medición directa en cada punto del territorio</b>.</div>
   </aside>
 </div>

 <section class="histpanel" id="historico">
   <div class="panelhead"><div><strong>Histórico 2010–2025</strong><div class="small">Consulta directa a SQLite · sin recalcular ZIP/XML</div></div><div class="small" id="histPerf">Listo</div></div>
   <div class="histbody">
     <div class="histcontrols">
       <div><label>Estación</label><select id="histStation"></select></div>
       <div><label>Desde</label><input id="histStart" type="date" value="2010-01-01"></div>
       <div><label>Hasta</label><input id="histEnd" type="date" value="2025-12-31"></div>
       <div><button id="histLoad" type="button">Consultar histórico</button></div>
     </div>
     <div class="histmeta" id="histMeta"></div>
     <div class="histstats">
       <div class="histstat"><div class="hk">Último FWI</div><div class="hv" id="hLastFwi">—</div><div class="hs" id="hLastFwiSub">—</div></div>
       <div class="histstat"><div class="hk">Último BASUGIX</div><div class="hv" id="hLastIre">—</div><div class="hs" id="hLastIreSub">—</div></div>
       <div class="histstat"><div class="hk">Máximo FWI</div><div class="hv" id="hMaxFwi">—</div><div class="hs" id="hMaxFwiSub">—</div></div>
       <div class="histstat"><div class="hk">Máximo BASUGIX</div><div class="hv" id="hMaxIre">—</div><div class="hs" id="hMaxIreSub">—</div></div>
       <div class="histstat"><div class="hk">Días disponibles</div><div class="hv" id="hCount">0</div><div class="hs">registros DB</div></div>
     </div>
     <div class="histchart"><canvas id="histChart"></canvas></div>
     <div class="histtable">
       <table><thead><tr><th>Fecha</th><th>T °C</th><th>HR %</th><th>Viento</th><th>Lluvia</th><th>FWI</th><th>Nivel</th><th>BASUGIX</th><th>Nivel</th><th>Meteo</th></tr></thead><tbody id="histTbody"><tr><td colspan="10" class="histempty">Selecciona un periodo y pulsa Consultar histórico</td></tr></tbody></table>
     </div>
     <div class="histpager"><button id="histPrev" type="button">← Anterior</button><span class="small" id="histPageInfo">—</span><button id="histNext" type="button">Siguiente →</button></div>
   </div>
 </section>
 <div class="footer">Fuente meteorológica: Euskalmet. V22.10.5: T/HR/viento 12:00 con fallback controlado y primera lectura post-corte; lluvia observada 10-min 24 h. Coordenadas de estaciones: Gobierno Vasco/Euskalmet. El mapa territorial usa una malla geográfica continua recortada al límite de Gipuzkoa; los municipios no intervienen. Cada celda se asigna por distancia, influencia marítima y compatibilidad altitudinal/orográfica. Los niveles se clasifican con percentiles climatológicos propios de cada estación.</div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@turf/turf@7/turf.min.js"></script>
<script>
const C={Bajo:'#4CAF50',Moderado:'#F4C430',Alto:'#F7931E','Muy alto':'#E84A22',Extremo:'#A61B29'};
const UI_LANG='__UI_LANG__';
function uiLevel(v){const x=v||'Sin dato';if(UI_LANG!=='eu')return x;return ({Bajo:'Baxua',Moderado:'Ertaina',Alto:'Altua','Muy alto':'Oso altua',Extremo:'Muturrekoa','Sin dato':'Daturik gabe'}[x]||x)}
function uiQuality(v){const x=v||'—';if(UI_LANG!=='eu')return x;return ({Completo:'Osoa','Hueco menor':'Hutsune txikia','Hueco relevante':'Hutsune esanguratsua','Cobertura insuficiente':'Estaldura eskasa','Predicción meteorológica':'Iragarpen meteorologikoa','Histórico precalculado':'Aurrez kalkulatutako historikoa'}[x]||x)}
function uiOwn(){return UI_LANG==='eu'?'berea':'propia'}
let data=null,map=null,zonesLayer=null,selected=null;

function n(v,d=2){return v===null||v===undefined?'—':Number(v).toFixed(d)}
function color(level){return C[level]||'#b7c0ba'}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

function renderLoadingCards(){
 const root=document.getElementById('cards');
 const names={C023:'Arrasate',C017:'Miramon',C058:'Bidania',C026:'Berastegi',C028:'Zegama'};
 root.innerHTML=Object.entries(names).map(([sid,name])=>`<div class="card" data-sid="${sid}"><div class="ctop"><span class="sid">${sid}</span><span class="name">${name}</span></div><div><span class="ival" style="font-size:20px">Cargando…</span></div><div class="metrics"><div><b>—</b>°C</div><div><b>—</b>% HR</div><div><b>—</b>km/h</div><div><b>—</b>mm</div></div><div class="isirow"><span>ISI · Índice de propagación</span><b>—</b></div><div class="small" style="margin-top:8px">Obteniendo datos reales de Euskalmet para la fecha seleccionada…</div></div>`).join('');
}

function cards(){
 const root=document.getElementById('cards');
 root.innerHTML=data.stations.map(s=>`
 <div class="card" data-sid="${s.station_id}">
   <div class="ctop"><span class="sid">${s.station_id}</span><span class="name">${esc(s.station_name)}</span></div>
   <div><span class="ival" style="color:${color(s.ire_gip_level)}">${n(s.ire_gip)}</span>
   <span class="pill" style="background:${color(s.ire_gip_level)}22;color:#183426;border:1px solid ${color(s.ire_gip_level)}66">${esc(uiLevel(s.ire_gip_level))}</span></div>
   <div class="metrics"><div><b>${n(s.temperature,1)}</b>°C</div><div><b>${n(s.humidity,0)}</b>% HR</div><div><b>${n(s.wind_kmh,1)}</b>km/h<br><span style="font-size:10px;color:var(--muted);font-weight:700">${esc(s.wind_direction_cardinal||'—')}${s.wind_direction_deg==null?'':' · '+n(s.wind_direction_deg,0)+'°'}</span></div><div><b>${n(s.rain_mm,1)}</b>mm</div></div>
   <div class="isirow"><span>ISI · Índice de propagación</span><b>${n(s.isi,2)}</b></div>
   <div class="small" style="margin-top:8px">${s.hybrid_d0?'🟠 D0 híbrido · ':(s.forecast?'🔮 Predicción · ':'')}${esc(uiQuality(s.data_quality))} · lluvia ${s.rain_points_present??'—'}/${s.hybrid_d0?144:(s.forecast?24:144)}</div>
   ${s.station_fallback_used ? `<div class="small" style="margin-top:6px;padding:5px 7px;border-radius:7px;background:#fff3cd;border:1px solid #e6c75a"><b>⚠ Estación sustituida:</b> ${esc(s.meteo_source_station||'—')} · ${esc(s.meteo_source_station_name||'—')} · ${n(s.station_fallback_distance_km,1)} km<br><span style="font-size:11px">Paquete completo: T · HR · viento · lluvia 24 h</span></div>` : ''}
 </div>`).join('');
 root.querySelectorAll('.card').forEach(el=>el.addEventListener('click',()=>select(el.dataset.sid)));
}

function select(sid){
 selected=sid;
 const s=data.stations.find(x=>x.station_id===sid); if(!s)return;
 document.querySelectorAll('.card').forEach(x=>x.classList.toggle('sel',x.dataset.sid===sid));
 document.getElementById('dIre').textContent=n(s.ire_gip);
 const pl=document.getElementById('dLevel'); pl.textContent=uiLevel(s.ire_gip_level); pl.style.background=color(s.ire_gip_level)+'33';
 document.getElementById('dName').textContent=`${s.station_id} · ${s.station_name}`;
 document.getElementById('dDay').textContent=s.day||'—';
 document.getElementById('dT').textContent=n(s.temperature,1)+' °C';
 document.getElementById('dRh').textContent=n(s.humidity,1)+' %';
 document.getElementById('dWind').textContent=n(s.wind_kmh,1)+' km/h';
 document.getElementById('dDir').textContent=(s.wind_direction_cardinal||'—')+(s.wind_direction_deg==null?'':' · '+n(s.wind_direction_deg,1)+'°');
 document.getElementById('dRain').textContent=n(s.rain_mm,1)+' mm';
 document.getElementById('dCoverage').textContent=(s.rain_points_present??'—')+'/'+(s.hybrid_d0?144:(s.forecast?24:144))+' · '+(s.rain_coverage_pct==null?'—':n(s.rain_coverage_pct,1)+' %')+(s.hybrid_d0&&s.hybrid_latest_euskalmet_time?' · última Euskalmet '+s.hybrid_latest_euskalmet_time:'');
 document.getElementById('dQuality').textContent=uiQuality(s.data_quality||s.rain_quality||'—');
 document.getElementById('dTimes').textContent=[s.temperature_time||'—',s.humidity_time||'—',s.wind_time||'—'].join(' / ');
 document.getElementById('dSourceStation').textContent=s.station_fallback_used
   ? `${s.meteo_source_station||'—'} · ${s.meteo_source_station_name||'—'} (${n(s.station_fallback_distance_km,1)} km)`
   : (s.hybrid_d0 ? `Euskalmet + Open-Meteo · D0 híbrido` : (s.forecast ? `${s.forecast_model||'Open-Meteo / ECMWF'} · predicción` : `${s.station_id} · ${uiOwn()}`));
 const fb=document.getElementById('dFallbackNotice');
 const fr=document.getElementById('dFallbackReasonRow');
 const fp=document.getElementById('dFallbackPolicyRow');
 if(s.station_fallback_used){
   const reason=(s.station_fallback_reason||'estación objetivo sin paquete meteorológico completo').replace(/^paquete_incompleto:\s*/,'Faltan variables: ');
   fr.style.display='flex'; fp.style.display='flex';
   document.getElementById('dFallbackReason').textContent=reason;
   document.getElementById('dFallbackPolicy').textContent='Estación completa · candidata elegible más cercana';
   fb.style.display='block';
   fb.innerHTML=`<b>⚠ Sustitución meteorológica activa el ${esc(s.day||'—')}</b><br><b>Estación objetivo:</b> ${esc(s.station_id+' · '+s.station_name)}.<br><b>Datos meteorológicos usados:</b> ${esc(s.meteo_source_station||'—')} · ${esc(s.meteo_source_station_name||'—')} (${n(s.station_fallback_distance_km,1)} km).<br>Temperatura, humedad, viento y lluvia 24 h proceden de <b>la misma estación de respaldo</b>.<br><span style="font-size:12px">La selección es determinista por proximidad: mientras la misma candidata siga aportando el paquete completo, continuará siendo la sustituta; sólo se pasa a la siguiente si deja de ser elegible. El FWI/BASUGIX, la memoria FFMC/DMC/DC y los umbrales continúan asociados a ${esc(s.station_id)}.</span>`;
 }else{
   fr.style.display='none'; fp.style.display='none';
   document.getElementById('dFallbackReason').textContent='—';
   document.getElementById('dFallbackPolicy').textContent='—';
   fb.style.display='none'; fb.textContent='';
 }
 document.getElementById('dFwi').textContent=n(s.fwi)+' · '+(uiLevel(s.fwi_level));
 const t=s.thresholds||{};
 document.getElementById('thrText').textContent=t.p40!==undefined
   ? (UI_LANG==='eu' ? `Baxua < ${n(t.p40,3)} · Ertaina < ${n(t.p65,3)} · Altua < ${n(t.p85,3)} · Oso altua < ${n(t.p95,3)} · Muturrekoa ≥ ${n(t.p95,3)}` : `Bajo < ${n(t.p40,3)} · Moderado < ${n(t.p65,3)} · Alto < ${n(t.p85,3)} · Muy alto < ${n(t.p95,3)} · Extremo ≥ ${n(t.p95,3)}`)
   : (UI_LANG==='eu'?'Ordezko atalase absolutuak':'Umbrales absolutos de respaldo');
 document.getElementById('histLink').href='#historico';
 const hs=document.getElementById('histStation'); if(hs) hs.value=sid;
 if(map) map.flyTo([s.lat,s.lon],10,{duration:.5});
}

async function buildMap(){
 let assets=null;
 try{
   const ctl=new AbortController();
   const timer=setTimeout(()=>ctl.abort(),3500);
   try{
     const ar=await fetch('/api/v22104/map-assets',{signal:ctl.signal});
     if(ar.ok) assets=await ar.json();
   }finally{clearTimeout(timer);}
 }catch(e){console.warn('Límite territorial no disponible temporalmente; se muestran estaciones sin bloquear la interfaz',e);}
 const boundary=assets&&assets.ok?assets.boundary:null;
 const zoning=assets&&assets.ok?(assets.zoning||{}):{};

 // Los municipios NO deciden la zonificación: se cargan únicamente como
 // capa cartográfica de referencia y para identificar el municipio al pasar
 // el cursor sobre una celda territorial. Si B5M falla, el mapa continúa.
 let municipios=null;
 try{
   const ctlM=new AbortController();
   const timerM=setTimeout(()=>ctlM.abort(),10000);
   try{
     const mr=await fetch('/api/map/municipios',{signal:ctlM.signal});
     if(mr.ok){
       const mj=await mr.json();
       if(mj && mj.type==='FeatureCollection') municipios=mj;
       else if(mj && mj.ok!==false && mj.features) municipios=mj;
     }
   }finally{clearTimeout(timerM);}
 }catch(e){console.warn('Límites municipales no disponibles; continúa la zonificación territorial',e);}

 map=L.map('map',{zoomControl:true}).setView([43.13,-2.18],9);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
   maxZoom:18,attribution:'© OpenStreetMap contributors · BASUGIX'
 }).addTo(map);

 let boundaryFeature=null;
 if(boundary){
   // Normalizamos FeatureCollection/Feature para las operaciones Turf.
   if(boundary.type==='FeatureCollection'){
     try{boundaryFeature=turf.combine(boundary).features[0];}catch(e){boundaryFeature=boundary.features&&boundary.features[0];}
   }else if(boundary.type==='Feature') boundaryFeature=boundary;
   else boundaryFeature=turf.feature(boundary);
   const boundLayer=L.geoJSON(boundary,{style:{color:'#153d2d',weight:2.4,fill:false,interactive:false}}).addTo(map);
   try{map.fitBounds(boundLayer.getBounds(),{padding:[18,18]});}catch(e){}
 }

 const stationTerrain=zoning.station_terrain||{};
 const coastAnchors=zoning.coastline_anchors||[];
 const ridgeAnchors=zoning.ridge_anchors||[];
 const cellKm=Number(zoning.grid_cell_km||1.0);
 let coastLine=null;
 try{if(coastAnchors.length>=2) coastLine=turf.lineString(coastAnchors);}catch(e){}

 // Índice ligero de municipios: bbox previo + point-in-polygon. Esto evita
 // que las fronteras administrativas condicionen el valor BASUGIX; sólo
 // sirven para contexto visual y para el nombre mostrado en el tooltip.
 // B5M ha usado distintos nombres de campos a lo largo del tiempo, por lo
 // que no dependemos de un único `name_es/name_eu`.
 function municipalityNames(props){
   const p=props||{};
   const entries=Object.entries(p).filter(([k,v])=>typeof v==='string' && v.trim());
   const nk=k=>String(k||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
   const isNameKey=k=>{
     const z=nk(k);
     return /(udalerri|udalerria|municip|nombre|izena|name|nommun|munname|denomin)/.test(z)
       && !/(codigo|code|id|codmun|comarca|eskualde|region|prov)/.test(z);
   };
   const plausible=v=>{
     const s=String(v||'').trim();
     return s.length>=2 && s.length<=100 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÿ]/.test(s) && !/^\d+$/.test(s);
   };
   const candidates=entries.filter(([k,v])=>isNameKey(k)&&plausible(v));
   const byLang=(lang)=>{
     const rx=lang==='eu'?/(eu|eus|eusk|basque)/:/(es|spa|cast|spanish)/;
     const hit=candidates.find(([k])=>rx.test(nk(k)));
     return hit?String(hit[1]).trim():'';
   };
   let eu=byLang('eu'), es=byLang('es');
   // Campos habituales y variantes en mayúsculas/minúsculas.
   const direct=(keys)=>{
     for(const key of keys){
       const hit=entries.find(([k,v])=>nk(k)===nk(key)&&plausible(v));
       if(hit)return String(hit[1]).trim();
     }
     return '';
   };
   eu=eu||direct(['name_eu','udalerria_eu','udalerria','udalerri','izena','nombre_eu','nom_eu']);
   es=es||direct(['name_es','municipio_es','municipio','nombre_es','nombre','nom_es']);
   const common=(candidates[0]&&String(candidates[0][1]).trim())||direct(['name','nombre','izena','udalerria','municipio']);
   eu=eu||common||es;
   es=es||common||eu;
   return {name_eu:eu||'—',name_es:es||'—'};
 }
 const municipioIndex=[];
 if(municipios && Array.isArray(municipios.features)){
   for(const mf of municipios.features){
     try{
       const names=municipalityNames(mf.properties||{});
       municipioIndex.push({feature:mf,bbox:turf.bbox(mf),...names});
     }catch(e){}
   }
 }
 function municipioForPoint(pt){
   if(!municipioIndex.length)return null;
   const x=pt[0],y=pt[1],p=turf.point(pt);
   for(const row of municipioIndex){
     const b=row.bbox;
     if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;
     try{if(turf.booleanPointInPolygon(p,row.feature))return row;}catch(e){}
   }
   return null;
 }

 function distKm(a,b){try{return turf.distance(turf.point(a),turf.point(b),{units:'kilometers'});}catch(e){return 999;}}
 function coastDistance(pt){
   if(!coastLine)return 25;
   try{return turf.pointToLineDistance(turf.point(pt),coastLine,{units:'kilometers'});}catch(e){return 25;}
 }
 function terrainElevation(pt){
   // Proxy orográfico continuo: IDW de cotas de estaciones + refuerzo suave de divisorias.
   let sw=0,sv=0;
   for(const s of data.stations){
     const d=Math.max(0.8,distKm(pt,[s.lon,s.lat]));
     const w=1/(d*d);
     const e=Number((stationTerrain[s.station_id]||{}).elevation_m??300);
     sw+=w; sv+=w*e;
   }
   let elev=sw?sv/sw:300;
   for(const r of ridgeAnchors){
     const d=distKm(pt,[r[0],r[1]]);
     if(d<18){const influence=Math.max(0,1-d/18);elev=Math.max(elev,Number(r[2])*influence+elev*(1-influence));}
   }
   return Math.max(20,Math.min(850,elev));
 }
 function physioclimate(pt){
   const cd=coastDistance(pt);
   const maritime=Math.max(0,Math.min(1,1-cd/18));
   const elev=terrainElevation(pt);
   return {coast_km:cd,maritime,elev_m:elev};
 }
 function stationPenalty(profile,sid){
   const st=stationTerrain[sid]||{};
   const se=Number(st.elevation_m??300);
   const altitude=Math.abs(profile.elev_m-se)*0.028;
   let marine=0;
   if(profile.maritime>0.72){
     marine=sid==='C017'?0:(sid==='C058'?18:(sid==='C026'?23:(sid==='C023'?27:31)));
   }else if(profile.maritime>0.35){
     marine=sid==='C017'?0:(sid==='C058'?4:(sid==='C026'?7:(sid==='C023'?9:12)));
   }else{
     marine=sid==='C017'?9:0;
   }
   let oro=0;
   if(profile.elev_m>500){oro=sid==='C017'?15:(sid==='C023'?5:(sid==='C026'?2:0));}
   else if(profile.elev_m<140){oro=sid==='C017'?0:(sid==='C023'?5:(sid==='C026'?7:9));}
   return {altitude,marine,oro,total:altitude+marine+oro};
 }
 function zoneForPoint(pt){
   const profile=physioclimate(pt); let best=null;
   for(const s of data.stations){
     const distance=distKm(pt,[s.lon,s.lat]);
     const pen=stationPenalty(profile,s.station_id);
     const score=distance+pen.total;
     const row={sid:s.station_id,distance,score,profile,pen};
     if(!best||row.score<best.score)best=row;
   }
   return best;
 }

 // Límites municipales: capa cartográfica de referencia DEBAJO de la zonificación.
 // Así las divisiones municipales siguen visibles a través del relleno BASUGIX.
 if(municipios){
   try{
     L.geoJSON(municipios,{
       style:()=>({color:'#ffffff',weight:1.35,opacity:.95,fill:false,fillOpacity:0}),
       interactive:false
     }).addTo(map);
   }catch(e){console.warn('No se pudieron dibujar los límites municipales',e);}
 }

 if(boundaryFeature){   try{
     const bbox=turf.bbox(boundaryFeature);
     const grid=turf.squareGrid(bbox,cellKm,{units:'kilometers'});
     const byStation={};
     for(const cell of (grid.features||[])){
       const ctr=turf.centroid(cell);
       let inside=false;
       try{inside=turf.booleanPointInPolygon(ctr,boundaryFeature);}catch(e){inside=false;}
       if(!inside)continue;
       const pt=ctr.geometry.coordinates;
       const zi=zoneForPoint(pt);
       if(!zi)continue;
       const muni=municipioForPoint(pt);
       cell.properties={
         ...(cell.properties||{}),sid:zi.sid,distance:zi.distance,
         coast_km:zi.profile.coast_km,elev_m:zi.profile.elev_m,score:zi.score,
         municipality_eu:muni?muni.name_eu:null,
         municipality_es:muni?muni.name_es:null
       };
       (byStation[zi.sid]||(byStation[zi.sid]=[])).push(cell);
     }
     for(const s of data.stations){
       const feats=byStation[s.station_id]||[];
       L.geoJSON(turf.featureCollection(feats),{
         style:()=>({color:color(s.ire_gip_level),weight:0,fillColor:color(s.ire_gip_level),fillOpacity:.48}),
         onEachFeature:(f,l)=>{
           const p=f.properties||{};
           function zoneTooltip(latlng){
             let muni=null;
             if(latlng) muni=municipioForPoint([latlng.lng,latlng.lat]);
             const muniName=muni
               ? (UI_LANG==='eu'?(muni.name_eu||muni.name_es):(muni.name_es||muni.name_eu))
               : (UI_LANG==='eu'?(p.municipality_eu||p.municipality_es):(p.municipality_es||p.municipality_eu));
             return `<b>${UI_LANG==='eu'?'BASUGIX lurralde-eremua':'Zona territorial BASUGIX'}</b><br>`+
               (muniName && muniName!=='—'?`<b>${UI_LANG==='eu'?'Udalerria':'Municipio'}:</b> ${esc(muniName)}<br>`:'')+
               `${UI_LANG==='eu'?'Erreferentzia':'Referencia'}: ${s.station_id} ${esc(s.station_name)}<br>`+
               `${UI_LANG==='eu'?'Kostarekiko distantzia':'Distancia a costa'}: ${n(p.coast_km,1)} km · `+
               `${UI_LANG==='eu'?'kota-proxy':'cota proxy'}: ${n(p.elev_m,0)} m<br>`+
               `BASUGIX ${n(s.ire_gip)} · ${esc(uiLevel(s.ire_gip_level))}`;
           }
           l.bindTooltip(zoneTooltip(null),{sticky:true,className:'stationTip'});
           // El municipio se resuelve en la coordenada REAL del cursor, no en
           // el centro de la celda territorial de 1 km.
           l.on('mousemove',ev=>{
             try{
               const tt=l.getTooltip();
               if(tt) tt.setContent(zoneTooltip(ev.latlng));
             }catch(e){}
           });
           l.on('click',()=>select(s.station_id));
         }
       }).addTo(map);
     }
   }catch(e){console.warn('No se pudo generar la zonificación continua; se mantienen estaciones y límite',e);}
 }



 if(boundary) L.geoJSON(boundary,{style:{color:'#153d2d',weight:2.4,fill:false,interactive:false}}).addTo(map);
 for(const s of data.stations){
   const m=L.circleMarker([s.lat,s.lon],{radius:7,color:'#fff',weight:2,fillColor:'#063e2d',fillOpacity:1}).addTo(map);
   m.bindTooltip(`<b>${s.station_id} ${esc(s.station_name)}</b><br>BASUGIX ${n(s.ire_gip)} · ${esc(uiLevel(s.ire_gip_level))}`,{direction:'top',className:'stationTip'});
   m.on('click',()=>select(s.station_id));
 }
}

let mapReady=false;
let d0RetryTimer=null;
let d0RetryCount=0;

function madridTodayISO(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const y=(parts.find(p=>p.type==='year')||{}).value;
 const m=(parts.find(p=>p.type==='month')||{}).value;
 const d=(parts.find(p=>p.type==='day')||{}).value;
 return y && m && d ? `${y}-${m}-${d}` : '';
}

// El calendario representa siempre el día operativo actual al entrar en la aplicación.
// No debe retroceder al último día completo de SQLite cuando D0 aún no esté disponible.
function madridOperationalISO(){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
 const y=(parts.find(p=>p.type==='year')||{}).value;
 const m=(parts.find(p=>p.type==='month')||{}).value;
 const d=(parts.find(p=>p.type==='day')||{}).value;
 const h=Number((parts.find(p=>p.type==='hour')||{}).value||0);
 if(!(y&&m&&d)) return '';
 const base=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
 if(h<12) base.setUTCDate(base.getUTCDate()-1);
 return base.toISOString().slice(0,10);
}
const initialOperational=madridOperationalISO();
if(initialOperational) document.getElementById('mapDate').value=initialOperational;

async function loadForDate(dayValue=null){
 const status=document.getElementById('status');
 if(!data){ renderLoadingCards(); }
 try{
   const url=dayValue
     ? '/api/v22103/live?day='+encodeURIComponent(dayValue)+'&_skip_prev_sync=1'
     : '/api/v221052/latest-fast';

   status.textContent=dayValue?'Cargando fecha…':'Cargando último dato real desde SQLite…';

   let resp;
   try{
     resp=await fetch(url);
   }catch(fetchErr){
     // Un reinicio breve de uvicorn --reload o un corte puntual no debe dejar la web vacía.
     await new Promise(r=>setTimeout(r,700));
     try{resp=await fetch(url);}catch(secondErr){
       const lim=dayValue||new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
       resp=await fetch('/debug/v221052/main-day-latest?on_or_before='+encodeURIComponent(lim));
     }
   }
   if(!resp.ok) throw new Error('HTTP '+resp.status+' al calcular estaciones');
   data=await resp.json();
   if(!data.ok) throw new Error(data.error||'Error de datos');
   if(!Array.isArray(data.stations) || !data.stations.length){
     throw new Error('La API no devolvió estaciones');
   }

   // SEGURIDAD D0: después de las 12:00 nunca se permite pintar una fecha
   // histórica aunque el backend entregue un fallback antiguo.
   if(!dayValue){
     const expected=madridOperationalISO();
     const got=String(data.selected_day || data.stations.find(s=>s.day)?.day || '');
     if(expected && got && got!==expected){
       throw new Error('D0 requerido '+expected+'; la API devolvió '+got+'. Dato histórico rechazado.');
     }
     d0RetryCount=0;
     if(d0RetryTimer){ clearTimeout(d0RetryTimer); d0RetryTimer=null; }
   }

   // Renderizamos tarjetas inmediatamente, antes de esperar al mapa.
   cards();

   const d=data.selected_day || (data.stations.find(s=>s.day)?.day) || '';
   if(d){
     // Si latest-fast está usando el último día completo como respaldo, NO sobrescribimos
     // el calendario: debe seguir mostrando hoy (D0 solicitado).
     const isFallback=!dayValue && data.live_fallback && data.requested_day;
     if(!isFallback) document.getElementById('mapDate').value=d;
     document.getElementById('dateLine').textContent=isFallback
       ? `D0 eskatua: ${data.requested_day} · azken egun osoa: ${d}`
       : `Mapa BASUGIX correspondiente al ${d}`;
   }else{
     document.getElementById('dateLine').textContent='Sin datos disponibles';
   }

   const firstValid=data.stations.find(s=>s.ok!==false) || data.stations[0];
   select(selected && data.stations.some(s=>s.station_id===selected)
     ? selected
     : firstValid.station_id);

   status.textContent='✓ Datos cargados · preparando mapa…';

   if(map){
     map.remove();
     map=null;
   }
   await buildMap();
   mapReady=true;

   const secs=data.calculation_seconds==null ? '' : ` · cálculo ${data.calculation_seconds}s`;
   const cacheTxt=data.cache?.hit ? ' · caché' : '';
   const fallbackTxt=data.live_fallback?' · ⚠ último día completo disponible':'';
   status.textContent='✓ BASUGIX cargado · último dato real'+fallbackTxt+secs+cacheTxt;
   if(!dayValue && data.needs_live_refresh){
     status.textContent='✓ Último dato almacenado mostrado · sincronizando último dato real…';
     refreshOperationalD0InBackground();
   }
 }catch(e){
   status.textContent='Error: '+e.message;
   console.error('V22.10.5.12 loadForDate',e);

   // Nunca conservar/pintar 2025 como si fuera D0. Si Euskalmet está
   // temporalmente limitado (p.ej. HTTP 429), reintentamos sin mostrar el
   // último día histórico. Máximo 3 reintentos, separados 65 s.
   if(!dayValue && d0RetryCount<3){
     d0RetryCount++;
     if(d0RetryTimer) clearTimeout(d0RetryTimer);
     status.textContent='⚠ D0 aún no disponible · reintento '+d0RetryCount+'/3 en 65 s';
     d0RetryTimer=setTimeout(()=>{
       d0RetryTimer=null;
       loadForDate(null);
     },65000);
   }
 }
}


async function refreshOperationalD0InBackground(){
  // Sólo se ejecuta cuando, después de las 12:00, SQLite aún no contiene D0.
  // La interfaz ya está visible con el último día completo: esta llamada NO la bloquea.
  if(!data || !data.needs_live_refresh || !data.requested_day) return;
  const desired=data.requested_day;
  const status=document.getElementById('status');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const resp=await fetch('/api/v22103/live?day='+encodeURIComponent(desired),{signal:controller.signal});
    if(!resp.ok) return;
    const fresh=await resp.json();
    if(!fresh.ok || fresh.selected_day!==desired || !Array.isArray(fresh.stations) || !fresh.stations.some(s=>s.ok!==false)) return;
    data=fresh;
    cards();
    const firstValid=data.stations.find(s=>s.ok!==false)||data.stations[0];
    select(selected && data.stations.some(s=>s.station_id===selected)?selected:firstValid.station_id);
    document.getElementById('mapDate').value=desired;
    document.getElementById('dateLine').textContent=`Mapa BASUGIX correspondiente al ${desired}`;
    if(map){map.remove();map=null;}
    await buildMap(); mapReady=true;
    status.textContent='✓ BASUGIX actualizado · D0 real Euskalmet';
  }catch(e){
    // Timeout/corte: conservamos el último día SQLite ya mostrado.
    console.warn('Actualización D0 en segundo plano no disponible',e);
  }finally{clearTimeout(timer);}
}

async function loadForecast(offset){
 const status=document.getElementById('status');
 try{
   const label=offset===0?'hoy':(offset===1?'mañana':'pasado mañana');
   status.textContent=`Cargando predicción ${label}…`;
   const resp=await fetch('/api/v221052/forecast3?offset='+encodeURIComponent(offset));
   if(!resp.ok) throw new Error('HTTP '+resp.status+' al cargar predicción');
   data=await resp.json();
   if(!data.ok) throw new Error(data.error||'Error de predicción');
   cards();
   const d=data.selected_day||'';
   if(d){document.getElementById('mapDate').value=d;document.getElementById('dateLine').textContent=`Predicción BASUGIX · ${label} · ${d}`;}
   const firstValid=data.stations.find(s=>s.ok!==false)||data.stations[0];
   select(selected && data.stations.some(s=>s.station_id===selected)?selected:firstValid.station_id);
   if(map){map.remove();map=null;}
   await buildMap(); mapReady=true;
   const secs=data.calculation_seconds==null?'':` · cálculo ${data.calculation_seconds}s`;
   const cacheTxt=data.cache?.hit?' · caché':'';
   status.textContent=offset===0?`🟠 D0 híbrido · Euskalmet en vivo + ECMWF/Open-Meteo${secs}${cacheTxt}`:`🔮 Predicción ${label} · ECMWF/Open-Meteo${secs}${cacheTxt}`;
 }catch(e){status.textContent='Error predicción: '+e.message;console.error(e);}
}

function updateForecastButtonsByLocalTime(){
 const d0=document.getElementById('forecastD0');
 const latest=document.getElementById('latestDay');
 // Hora oficial peninsular: Europe/Madrid, independiente de la zona horaria del PC/navegador.
 const parts=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',hour12:false}).formatToParts(new Date());
 const hour=Number((parts.find(p=>p.type==='hour')||{}).value||0);
 if(d0) d0.style.display=hour<12?'inline-block':'none';
 if(latest){
   latest.title=hour<12
     ? 'Último dato real disponible: ayer (D-1)'
     : 'Último dato real disponible: hoy (D0)';
 }
}
updateForecastButtonsByLocalTime();
setInterval(updateForecastButtonsByLocalTime,60000);
document.querySelectorAll('.forecastBtn').forEach(b=>b.addEventListener('click',()=>loadForecast(Number(b.dataset.offset))));

function shiftDate(delta){
 const el=document.getElementById('mapDate');
 if(!el.value) return;
 const [y,m,d]=el.value.split('-').map(Number);
 const dt=new Date(Date.UTC(y,m-1,d));
 dt.setUTCDate(dt.getUTCDate()+delta);
 const iso=dt.toISOString().slice(0,10);
 loadForDate(iso);
}

document.getElementById('mapDate').addEventListener('change',e=>{
 if(e.target.value) loadForDate(e.target.value);
});
document.getElementById('prevDay').addEventListener('click',()=>shiftDate(-1));
document.getElementById('nextDay').addEventListener('click',()=>shiftDate(1));
document.getElementById('latestDay').addEventListener('click',()=>loadForDate(null));



// --- Histórico integrado: lectura directa de SQLite ---
let histRows=[],histChartRows=[],histPage=0; const HIST_PAGE_SIZE=365;
function hnum(v,d=2){return v===null||v===undefined?'—':Number(v).toFixed(d)}
async function setupHistorical(){
  try{
    const st=await fetch('/api/ui/stations').then(r=>r.json());
    const sel=document.getElementById('histStation');
    sel.innerHTML=st.stations.map(x=>`<option value="${x.id}">${esc(x.name)} · ${x.id}</option>`).join('');
    if(selected) sel.value=selected;
  }catch(e){document.getElementById('histPerf').textContent='Error estaciones';}
}
async function loadHistorical(){
  const sid=document.getElementById('histStation').value;
  const start=document.getElementById('histStart').value;
  const end=document.getElementById('histEnd').value;
  const perf=document.getElementById('histPerf');
  perf.textContent='Consultando SQLite…';
  const t0=performance.now();
  try{
    const q=new URLSearchParams({start,end});
    const d=await fetch(`/api/ui/history/${sid}?${q}`).then(r=>r.json());
    if(!d.ok) throw new Error(d.error||'Error histórico');
    histRows=d.rows||[]; histChartRows=d.chart_rows||histRows; histPage=0;
    document.getElementById('histMeta').innerHTML=`<span><b>${esc(d.station_name)}</b> (${esc(d.station)})</span><span>${esc(d.start)} → ${esc(d.end)}</span><span>Cobertura DB ${esc(d.coverage_min||'—')} → ${esc(d.coverage_max||'—')}</span><span>${d.fallback_count||0} días con respaldo</span><span>SQL ${d.query_ms} ms</span>`;
    renderHistoricalStats(); renderHistoricalTable(); drawHistoricalChart();
    perf.textContent=`✓ ${histRows.length} registros · SQL ${d.query_ms} ms · total ${(performance.now()-t0).toFixed(0)} ms${d.cache_hit?' · caché':''}`;
  }catch(e){perf.textContent='Error: '+e.message; console.error(e);}
}
function renderHistoricalStats(){
  document.getElementById('hCount').textContent=histRows.length;
  if(!histRows.length){for(const id of ['hLastFwi','hLastIre','hMaxFwi','hMaxIre'])document.getElementById(id).textContent='—';return;}
  const last=histRows[histRows.length-1];
  document.getElementById('hLastFwi').textContent=hnum(last.fwi); document.getElementById('hLastFwiSub').textContent=`${last.day} · ${uiLevel(last.danger_level)}`;
  document.getElementById('hLastIre').textContent=hnum(last.ire_gip); document.getElementById('hLastIreSub').textContent=`${last.day} · ${uiLevel(last.ire_gip_level)}`;
  const fr=histRows.filter(r=>r.fwi!=null),ir=histRows.filter(r=>r.ire_gip!=null);
  const mf=fr.length?fr.reduce((a,b)=>Number(b.fwi)>Number(a.fwi)?b:a):null;
  const mi=ir.length?ir.reduce((a,b)=>Number(b.ire_gip)>Number(a.ire_gip)?b:a):null;
  document.getElementById('hMaxFwi').textContent=mf?hnum(mf.fwi):'—'; document.getElementById('hMaxFwiSub').textContent=mf?mf.day:'sin datos';
  document.getElementById('hMaxIre').textContent=mi?hnum(mi.ire_gip):'—'; document.getElementById('hMaxIreSub').textContent=mi?mi.day:'sin datos';
}
function renderHistoricalTable(){
  const tb=document.getElementById('histTbody'),info=document.getElementById('histPageInfo'),prev=document.getElementById('histPrev'),next=document.getElementById('histNext');
  if(!histRows.length){tb.innerHTML='<tr><td colspan="10" class="histempty">Sin datos en este periodo</td></tr>';if(info)info.textContent='—';if(prev)prev.disabled=true;if(next)next.disabled=true;return;}
  const reversed=histRows.slice().reverse(),pages=Math.max(1,Math.ceil(reversed.length/HIST_PAGE_SIZE));
  histPage=Math.max(0,Math.min(histPage,pages-1));
  const start=histPage*HIST_PAGE_SIZE,rows=reversed.slice(start,start+HIST_PAGE_SIZE);
  tb.innerHTML=rows.map(r=>`<tr><td><b>${r.day}</b></td><td>${hnum(r.temperature,1)}</td><td>${hnum(r.humidity,0)}</td><td>${hnum(r.wind_kmh,1)}</td><td>${hnum(r.rain_mm,1)}</td><td><b>${hnum(r.fwi)}</b></td><td>${esc(uiLevel(r.danger_level))}</td><td><b>${hnum(r.ire_gip)}</b></td><td>${esc(uiLevel(r.ire_gip_level))}</td><td>${r.station_fallback_used?esc((r.meteo_source_station||(UI_LANG==='eu'?'ordezkoa':'respaldo'))):uiOwn()}</td></tr>`).join('');
  if(info)info.textContent=`${histPage+1} / ${pages} · ${rows.length} filas`;
  if(prev)prev.disabled=histPage<=0;if(next)next.disabled=histPage>=pages-1;
}

function drawHistoricalChart(){
  const cv=document.getElementById('histChart'),ctx=cv.getContext('2d');
  const rect=cv.getBoundingClientRect(),ratio=window.devicePixelRatio||1; cv.width=Math.max(600,Math.floor(rect.width*ratio));cv.height=Math.max(220,Math.floor(rect.height*ratio));ctx.setTransform(ratio,0,0,ratio,0,0);
  const W=rect.width,H=rect.height,p={l:42,r:16,t:16,b:28};ctx.clearRect(0,0,W,H);
  if(!histChartRows.length){ctx.fillText('Sin datos',20,30);return;}
  const vals=[];histChartRows.forEach(r=>{if(r.fwi!=null)vals.push(Number(r.fwi));if(r.ire_gip!=null)vals.push(Number(r.ire_gip));}); const max=Math.max(1,...vals)*1.08;
  ctx.strokeStyle='#dbe4dd';ctx.lineWidth=1;for(let i=0;i<=4;i++){const y=p.t+(H-p.t-p.b)*i/4;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(W-p.r,y);ctx.stroke();ctx.fillStyle='#64746c';ctx.font='10px Segoe UI';ctx.fillText((max*(1-i/4)).toFixed(1),4,y+3);}
  const x=i=>p.l+(W-p.l-p.r)*(histChartRows.length===1?0:i/(histChartRows.length-1)); const y=v=>H-p.b-(H-p.t-p.b)*(Number(v)/max);
  function line(key,stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.7;ctx.beginPath();let started=false;histChartRows.forEach((r,i)=>{const v=r[key];if(v==null){started=false;return;}const xx=x(i),yy=y(v);if(!started){ctx.moveTo(xx,yy);started=true}else ctx.lineTo(xx,yy);});ctx.stroke();}
  line('fwi','#163d2c');line('ire_gip','#b05a3c');
  ctx.fillStyle='#64746c';ctx.font='10px Segoe UI';ctx.fillText(histChartRows[0].day,p.l,H-8);const last=histChartRows[histChartRows.length-1].day;ctx.fillText(last,W-p.r-62,H-8);
}
document.getElementById('histLoad').addEventListener('click',loadHistorical);
document.getElementById('histPrev').addEventListener('click',()=>{histPage--;renderHistoricalTable();});
document.getElementById('histNext').addEventListener('click',()=>{histPage++;renderHistoricalTable();});
document.getElementById('navHistorico').addEventListener('click',()=>{setTimeout(()=>{if(!histRows.length)loadHistorical();},50);});
document.getElementById('histLink').addEventListener('click',()=>{const hs=document.getElementById('histStation');if(hs&&selected)hs.value=selected;setTimeout(()=>{if(!histRows.length)loadHistorical();},50);});
setupHistorical();

loadForDate(null);
</script>
</body>
</html>"""
    html=html.replace('__UI_LANG__',lang)
    if lang=='eu':
        translations={
            '<html lang="es">':'<html lang="eu">',
            '<title>BASUGIX Gipuzkoa · V22.10.5.14 · ISI + rapidez + D0 híbrido + Predicción +2</title>':'<title>BASUGIX Gipuzkoa · V22.10.5.12 · D0 hibridoa + Iragarpena +2</title>',
            'BASUGIX · Índice de riesgo de incendios forestales de Gipuzkoa':'BASUGIX · Gipuzkoako Baso Sute Arrisku Indizea',
            '>INICIO<':'>HASIERA<','>HISTÓRICO<':'>HISTORIKOA<','>TABLA<':'>TAULA<','>ESTADO<':'>EGOERA<','>CASTELLANO<':'>GAZTELANIA<',
            'Situación territorial de riesgo de incendio':'Baso-sute arriskuaren lurralde egoera',
            'Últimos datos disponibles de las cinco estaciones':'Bost estazioetako azken datu erabilgarriak',
            'Último dato real: D-1 antes de las 12:00; D0 desde las 12:00':'Azken datu erreala: D-1 12:00ak baino lehen; D0 12:00etatik aurrera',
            '>Último<':'>Azkena<','Hoy · Prev.':'Gaur · Irag.','Mañana · Prev.':'Bihar · Irag.','Pasado mañana · Prev.':'Etzi · Irag.',
            'Cargando datos y mapa…':'Datuak eta mapa kargatzen…','D0 eskatua:':'D0 eskatua:','último día completo:':'azken egun osoa:','Cargando último dato real desde SQLite…':'Azken datu erreala SQLite-tik kargatzen…','Cargando fecha…':'Data kargatzen…','Mapa de riesgo · Gipuzkoa':'Arrisku mapa · Gipuzkoa',
            'Mapa real + zonificación territorial continua':'Benetako mapa + erreferentziazko eremu fisioklimatikoak',
            'D-1 observado + predicción hoy/mañana/+2':'D-1 behatua + gaur/bihar/+2 iragarpena',
            'Detalle de estación':'Estazioaren xehetasuna','Estación objetivo':'Helburuko estazioa','Fecha del cálculo':'Kalkuluaren data',
            'Datos meteorológicos usados':'Erabilitako meteorologia-datuak','Temperatura':'Tenperatura','Humedad':'Hezetasuna','Viento':'Haizea','Dirección':'Norabidea','Lluvia 24 h':'24 orduko euria',
            'Cobertura lluvia':'Euri-estaldura','Calidad de datos':'Datuen kalitatea','Horas T / HR / viento':'T / HR / haize orduak',
            'Motivo de sustitución':'Ordezkapenaren arrazoia','Política de respaldo':'Ordezkapen-politika','Umbrales locales':'Tokiko atalaseak',
            'P40 / P65 / P85 / P95 de la estación':'Estazioaren P40 / P65 / P85 / P95','Ver histórico aquí':'Ikusi historikoa hemen',
            'El color de cada área representa el BASUGIX de su estación de referencia. La zona de referencia se asigna por afinidad fisioclimática y <b>no equivale a una medición directa en cada punto del territorio</b>.':'Eremu bakoitzaren koloreak erreferentzia-estazioaren BASUGIX adierazten du. Erreferentzia-eremua antzekotasun fisioklimatikoaren arabera esleitzen da eta <b>ez da lurraldeko puntu bakoitzeko zuzeneko neurketa</b>.',
            'Histórico 2010–2025':'Historikoa 2010–2025','Consulta directa a SQLite · sin recalcular ZIP/XML':'SQLite kontsulta zuzena · ZIP/XML berriz kalkulatu gabe',
            '>Estación<':'>Estazioa<','>Desde<':'>Noiztik<','>Hasta<':'>Noiz arte<','Consultar histórico':'Historikoa kontsultatu',
            'Último FWI':'Azken FWI','Último BASUGIX':'Azken BASUGIX','Máximo FWI':'FWI maximoa','Máximo BASUGIX':'BASUGIX maximoa','Días':'Egunak',
            'Histórico diario':'Eguneroko historikoa','<th>Fecha</th>':'<th>Data</th>','<th>Nivel</th>':'<th>Maila</th>','<th>Meteo</th>':'<th>Meteo</th>',
            'Selecciona un periodo y pulsa Consultar histórico':'Hautatu aldi bat eta sakatu Historikoa kontsultatu','Sin datos en este periodo':'Ez dago daturik aldi honetan','Sin datos':'Daturik gabe',
            'Fuente meteorológica: Euskalmet.':'Meteorologia-iturria: Euskalmet.','Coordenadas de estaciones: Gobierno Vasco/Euskalmet.':'Estazioen koordenatuak: Eusko Jaurlaritza/Euskalmet.',
            'Los niveles se clasifican con percentiles climatológicos propios de cada estación.':'Mailak estazio bakoitzaren pertzentil klimatologikoekin sailkatzen dira.',
            'Estación sustituida:':'Estazioa ordezkatuta:','Paquete completo: T · HR · viento · lluvia 24 h':'Pakete osoa: T · HR · haizea · 24 orduko euria',
            'Predicción BASUGIX':'BASUGIX iragarpena','Predicción':'Iragarpena','Cargando predicción':'Iragarpena kargatzen','Error predicción:':'Iragarpen errorea:',
            'Último dato real disponible: ayer (D-1)':'Azken datu erreal erabilgarria: atzo (D-1)','Último dato real disponible: hoy (D0)':'Azken datu erreal erabilgarria: gaur (D0)',
            'Datos calculados · cargando mapa…':'Datuak kalkulatuta · mapa kargatzen…','Mapa BASUGIX correspondiente al':'Honi dagokion BASUGIX mapa:',
            'D0 híbrido':'D0 hibridoa','Euskalmet en vivo':'Euskalmet zuzenean','predicción':'iragarpena','lluvia':'euria',
            'Estación completa · candidata elegible más cercana':'Estazio osoa · hurbileneko hautagai egokia',
            'Sustitución meteorológica activa el':'Meteorologia-ordezkapena aktibo dago egun honetan:','Datos meteorológicos usados:':'Erabilitako meteorologia-datuak:',
            'Temperatura, humedad, viento y lluvia 24 h proceden de <b>la misma estación de respaldo</b>.':'Tenperatura, hezetasuna, haizea eta 24 orduko euria <b>ordezko estazio beretik</b> datoz.',
            'La selección es determinista por proximidad: mientras la misma candidata siga aportando el paquete completo, continuará siendo la sustituta; sólo se pasa a la siguiente si deja de ser elegible.':'Hautaketa hurbiltasunaren araberakoa da: hautagai berak pakete osoa ematen duen bitartean, ordezko bera izango da; egokia izateari uzten badio soilik pasatuko da hurrengora.',
            'El FWI/BASUGIX, la memoria FFMC/DMC/DC y los umbrales continúan asociados a':'FWI/BASUGIX, FFMC/DMC/DC memoria eta atalaseak honi lotuta jarraitzen dute:',
            'Cargando histórico…':'Historikoa kargatzen…','Error histórico':'Historikoaren errorea','Listo':'Prest','registros':'erregistro','total':'guztira',
            'última Euskalmet':'azken Euskalmet','estación objetivo sin paquete meteorológico completo':'helburuko estazioak ez du meteorologia-pakete osoa','Faltan variables:':'Aldagaiak falta dira:',
            'Mapa real + zonificación territorial continua':'Benetako mapa + lurralde-zonifikazio jarraitua + udal-mugak',
            'El mapa territorial usa una malla geográfica continua recortada al límite de Gipuzkoa; los municipios no intervienen. Cada celda se asigna por distancia, influencia marítima y compatibilidad altitudinal/orográfica.':'Lurralde-mapak Gipuzkoako mugara moztutako sare geografiko jarraitua erabiltzen du; udal-mugek ez dute esleipena baldintzatzen. Gelaxka bakoitza distantziaren, itsas eraginaren eta altuera/orografiaren bateragarritasunaren arabera esleitzen da.',
            'Referencia BASUGIX:':'BASUGIX erreferentzia:','transición marítima':'itsas trantsizioa','costa':'kostaldea','interior':'barnealdea','perfil orográfico':'profil orografikoa','distancia':'distantzia',
            'límites B5M':'B5M mugak'
        }
        for a,b in sorted(translations.items(),key=lambda kv:len(kv[0]),reverse=True): html=html.replace(a,b)
    return HTMLResponse(html)


@app.get('/debug/rain24-audit')
async def debug_rain24_mass_audit(
    date_from:str|None=None,
    date_to:str|None=None,
    stations:str="C023,C017,C058,C026,C028"
):
    """Auditoría masiva SOLO LECTURA de lluvia 24 h.

    Ejemplo:
      /debug/rain24-audit?date_from=2026-08-01&date_to=2026-08-22

    Compara para cada estación/día:
      weather_daily.rain_mm
      vs suma de observaciones 10-min en (12:00 anterior, 12:00 actual].

    No modifica la base de datos.
    """
    try:
        station_ids=[s.strip().upper() for s in stations.split(',') if s.strip()]
        bad=[s for s in station_ids if s not in FIXED_STATION_IDS]
        if bad:
            return {'ok':False,'error':f'Estaciones no válidas: {bad}','writes_to_database':False}

        with con() as c:
            bounds=c.execute(
                """SELECT MIN(day) AS dmin, MAX(day) AS dmax
                   FROM weather_daily
                   WHERE station_id IN ({})""".format(','.join('?'*len(station_ids))),
                tuple(station_ids)
            ).fetchone()

        if not bounds or not bounds['dmin'] or not bounds['dmax']:
            return {'ok':False,'error':'No hay datos weather_daily','writes_to_database':False}

        d0=date.fromisoformat(date_from) if date_from else date.fromisoformat(bounds['dmin'])
        d1=date.fromisoformat(date_to) if date_to else date.fromisoformat(bounds['dmax'])
        if d1 < d0:
            return {'ok':False,'error':'date_to anterior a date_from','writes_to_database':False}

        # Limitación defensiva para evitar una petición accidental enorme al API.
        total_days=(d1-d0).days+1
        if total_days>120:
            return {
                'ok':False,
                'error':'Rango demasiado grande para una sola auditoría. Máximo 120 días.',
                'requested_days':total_days,
                'writes_to_database':False
            }

        rows=[]
        summary_by_station={}
        overall={'checked':0,'ok':0,'review':0,'no_stored':0,'errors':0}

        for sid in station_ids:
            stsum={'checked':0,'ok':0,'review':0,'no_stored':0,'errors':0,
                   'max_abs_difference_mm':0.0,'total_abs_difference_mm':0.0}
            summary_by_station[sid]=stsum

            cur=d0
            while cur<=d1:
                prev=cur-timedelta(days=1)
                try:
                    mapping_today=await _v222_mapping(sid,cur)
                    mapping_prev=await _v222_mapping(sid,prev)

                    st,mt,mid=mapping_today['rain_mm']
                    sp,mtp,midp=mapping_prev['rain_mm']

                    helper_sum,helper_n,helper_details=await _v224_rain24(
                        sid,st,mt,mid,sp,mtp,midp,cur
                    )
                    calculated=round(float(helper_sum),4)

                    with con() as c:
                        stored=c.execute(
                            """SELECT rain_mm,source
                               FROM weather_daily
                               WHERE station_id=? AND day=?""",
                            (sid,cur.isoformat())
                        ).fetchone()

                    stored_mm=(float(stored['rain_mm'])
                               if stored and stored['rain_mm'] is not None else None)
                    diff=(round(calculated-stored_mm,4)
                          if stored_mm is not None else None)

                    if stored_mm is None:
                        status='SIN_DATO_BD'
                        overall['no_stored']+=1
                        stsum['no_stored']+=1
                    elif abs(diff)<=0.01:
                        status='OK'
                        overall['ok']+=1
                        stsum['ok']+=1
                    else:
                        status='REVISAR'
                        overall['review']+=1
                        stsum['review']+=1

                    overall['checked']+=1
                    stsum['checked']+=1

                    if diff is not None:
                        ad=abs(diff)
                        stsum['max_abs_difference_mm']=max(stsum['max_abs_difference_mm'],ad)
                        stsum['total_abs_difference_mm']=round(
                            stsum['total_abs_difference_mm']+ad,4
                        )

                    rows.append({
                        'day':cur.isoformat(),
                        'station':sid,
                        'station_name':FIXED_STATIONS.get(sid,sid),
                        'stored_rain_mm':stored_mm,
                        'calculated_10min_rain_mm':calculated,
                        'difference_mm':diff,
                        'accepted_points':helper_n,
                        'expected_points':144,
                        'complete_144':helper_n==144,
                        'stored_source':stored['source'] if stored else None,
                        'status':status,
                    })

                except Exception as exc:
                    overall['errors']+=1
                    stsum['errors']+=1
                    rows.append({
                        'day':cur.isoformat(),
                        'station':sid,
                        'station_name':FIXED_STATIONS.get(sid,sid),
                        'stored_rain_mm':None,
                        'calculated_10min_rain_mm':None,
                        'difference_mm':None,
                        'accepted_points':None,
                        'expected_points':144,
                        'complete_144':False,
                        'status':'ERROR',
                        'error_type':type(exc).__name__,
                        'error':str(exc),
                    })
                cur += timedelta(days=1)

        # Los casos problemáticos primero para facilitar la revisión.
        problems=[r for r in rows if r['status']!='OK']
        problems.sort(key=lambda r:(r['day'],r['station']))

        return {
            'ok':True,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'mode':'read_only_mass_rain_audit',
            'writes_to_database':False,
            'window_definition':f'(día anterior {V22_NOON_HOUR:02d}:00, día actual {V22_NOON_HOUR:02d}:00]',
            'date_from':d0.isoformat(),
            'date_to':d1.isoformat(),
            'stations':station_ids,
            'summary':overall,
            'summary_by_station':summary_by_station,
            'problem_count':len(problems),
            'problems':problems,
            'all_rows':rows,
        }

    except Exception as exc:
        return {
            'ok':False,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'error_type':type(exc).__name__,
            'error':str(exc),
            'writes_to_database':False,
        }


@app.get('/debug/rain24/{sid}/{yyyymmdd}')
async def debug_rain24_v2283(sid:str,yyyymmdd:str):
    """V22.8.3: audita la suma de precipitación de 24 h usada por el FWI.

    Ventana exacta:
      (día anterior 12:00, día actual 12:00]

    Devuelve:
      - todas las observaciones de 10 min aceptadas
      - subtotal por hora
      - suma API
      - valor guardado en weather_daily
      - diferencia
      - resultado OK/REVISAR
    """
    sid=sid.upper()
    if sid not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación no válida'}
    if len(yyyymmdd)!=8 or not yyyymmdd.isdigit():
        return {'ok':False,'error':'Fecha YYYYMMDD'}

    day=date(int(yyyymmdd[:4]),int(yyyymmdd[4:6]),int(yyyymmdd[6:8]))
    prev_day=day-timedelta(days=1)
    target=V22_NOON_HOUR*60

    try:
        mapping_today=await _v222_mapping(sid,day)
        mapping_prev=await _v222_mapping(sid,prev_day)

        st,mt,mid=mapping_today['rain_mm']
        sp,mtp,midp=mapping_prev['rain_mm']

        _,_,prev_keys=await _v224_day_index(sid,sp,mtp,midp,prev_day)
        _,_,today_keys=await _v224_day_index(sid,st,mt,mid,day)

        accepted=[]
        hourly={}
        raw_points=0

        async def consume(src_day,keys):
            nonlocal raw_points
            for key in keys:
                tm=_v224_time_from_key(key)
                if tm is None:
                    continue
                hh,mm=map(int,tm.split(':'))
                hour_minute=hh*60+mm

                # Limit to branches that can contain accepted points.
                if src_day==prev_day and hour_minute < target:
                    continue
                if src_day==day and hour_minute > target:
                    continue

                pts=await _v224_follow_key(key,max_depth=4)
                raw_points += len(pts)

                for hhmm,val,path in pts:
                    h,m=map(int,hhmm.split(':'))
                    minute=h*60+m

                    include=(
                        (src_day==prev_day and minute>target)
                        or
                        (src_day==day and minute<=target)
                    )
                    if not include:
                        continue

                    v=float(val)
                    if not (0.0 <= v <= 100.0):
                        continue

                    rec={
                        'day':src_day.isoformat(),
                        'time':hhmm,
                        'rain_mm':round(v,4),
                        'source':path,
                    }
                    accepted.append(rec)
                    hour_key=f'{src_day.isoformat()} {h:02d}:00'
                    hourly[hour_key]=hourly.get(hour_key,0.0)+v

        await consume(prev_day,prev_keys)
        await consume(day,today_keys)

        accepted.sort(key=lambda r:(r['day'],r['time']))
        api_sum=round(sum(r['rain_mm'] for r in accepted),4)

        hourly_rows=[
            {'hour':k,'subtotal_mm':round(v,4)}
            for k,v in sorted(hourly.items())
        ]

        with con() as c:
            stored=c.execute(
                """SELECT rain_mm,source,created_at
                   FROM weather_daily
                   WHERE station_id=? AND day=?""",
                (sid,day.isoformat())
            ).fetchone()

        stored_rain=float(stored['rain_mm']) if stored and stored['rain_mm'] is not None else None
        diff=round(api_sum-stored_rain,4) if stored_rain is not None else None
        matches=(diff is not None and abs(diff)<=0.01)

        # Independent call to the production helper for cross-check.
        helper_sum,helper_n,helper_details=await _v224_rain24(
            sid,st,mt,mid,sp,mtp,midp,day
        )
        helper_sum=round(float(helper_sum),4)

        return {
            'ok':True,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'station':sid,
            'station_name':FIXED_STATIONS.get(sid,sid),
            'day':day.isoformat(),
            'window':{
                'from_exclusive':f'{prev_day.isoformat()} {V22_NOON_HOUR:02d}:00',
                'to_inclusive':f'{day.isoformat()} {V22_NOON_HOUR:02d}:00',
            },
            'counts':{
                'accepted_10min_points':len(accepted),
                'raw_points_seen':raw_points,
                'expected_when_complete':144,
            },
            'api_manual_sum_mm':api_sum,
            'production_helper_sum_mm':helper_sum,
            'production_helper_points':helper_n,
            'stored_weather_daily_mm':stored_rain,
            'difference_manual_minus_stored_mm':diff,
            'difference_manual_minus_helper_mm':round(api_sum-helper_sum,4),
            'result':'OK' if matches and abs(api_sum-helper_sum)<=0.01 else 'REVISAR',
            'stored_source':stored['source'] if stored else None,
            'stored_created_at':stored['created_at'] if stored else None,
            'hourly_subtotals':hourly_rows,
            'accepted_points':accepted,
            'production_helper_details':helper_details,
            'writes_to_database':False,
        }

    except Exception as exc:
        return {
            'ok':False,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'station':sid,
            'day':day.isoformat(),
            'error_type':type(exc).__name__,
            'error':str(exc),
            'writes_to_database':False,
        }


# ============================================================
# V22.10.5.12 RESPALDO EUSKALMET FINAL
# MODO SEGURO / NO DESTRUCTIVO.
# Reconstruye FFMC/DMC/DC -> ISI/BUI/FWI -> BASUGIX en secuencia,
# usando v22_noon_weather(), cuya lluvia procede de la suma de
# observaciones Euskalmet de 10 minutos en (12:00 anterior, 12:00 actual].
# NO escribe en SQLite.
# ============================================================

@app.get('/debug/v229/rebuild/{sid}/{date_from}/{date_to}')
async def debug_v229_rebuild(sid:str,date_from:str,date_to:str):
    sid=sid.upper()
    if sid not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación no válida','writes_to_database':False}
    try:
        d0=date.fromisoformat(date_from)
        d1=date.fromisoformat(date_to)
    except Exception:
        return {'ok':False,'error':'Fechas en formato YYYY-MM-DD','writes_to_database':False}
    if d1<d0:
        return {'ok':False,'error':'date_to anterior a date_from','writes_to_database':False}
    if (d1-d0).days+1>120:
        return {'ok':False,'error':'Máximo 120 días por ejecución','writes_to_database':False}

    # Semilla anterior al periodo, para respetar la memoria FFMC/DMC/DC.
    with con() as c:
        seed=c.execute(
            """SELECT day,ffmc,dmc,dc
               FROM fwi_daily
               WHERE station_id=? AND day<?
               ORDER BY day DESC LIMIT 1""",
            (sid,d0.isoformat())
        ).fetchone()

    if seed:
        pf,pd,pc=float(seed['ffmc']),float(seed['dmc']),float(seed['dc'])
        seed_info={
            'source':'stored_previous_day',
            'day':seed['day'],
            'ffmc':pf,'dmc':pd,'dc':pc
        }
    else:
        pf,pd,pc=map(float,INITIAL)
        seed_info={
            'source':'INITIAL',
            'day':None,
            'ffmc':pf,'dmc':pd,'dc':pc
        }

    rows=[]
    failures=[]
    cur=d0

    while cur<=d1:
        try:
            # Esta función ya usa T/HR/viento de mediodía y lluvia 10-min 24 h.
            t,rh,wind_kmh,rain24,direction=await v22_noon_weather(sid,cur)

            res=calculate(
                float(t),float(rh),float(wind_kmh),float(rain24),
                month=cur.month,
                prev_ffmc=pf,prev_dmc=pd,prev_dc=pc
            )

            direction_cardinal=wind_cardinal(direction)
            season_name,s_factor=ire_gip_season(cur)
            w_factor=ire_gip_wind_factor(direction,float(wind_kmh))
            ire=min(100.0,max(0.0,float(res.fwi)*w_factor*s_factor))

            with con() as c:
                stored_fwi=c.execute(
                    """SELECT ffmc,dmc,dc,isi,bui,fwi,danger_level,
                              ire_gip,ire_gip_level,wind_direction_deg,
                              wind_factor,season_factor
                       FROM fwi_daily
                       WHERE station_id=? AND day=?""",
                    (sid,cur.isoformat())
                ).fetchone()
                stored_weather=c.execute(
                    """SELECT temperature,humidity,wind_kmh,rain_mm,source
                       FROM weather_daily
                       WHERE station_id=? AND day=?""",
                    (sid,cur.isoformat())
                ).fetchone()

            stored_fwi_d=dict(stored_fwi) if stored_fwi else None
            stored_weather_d=dict(stored_weather) if stored_weather else None

            stored_rain=(
                float(stored_weather['rain_mm'])
                if stored_weather and stored_weather['rain_mm'] is not None
                else None
            )
            stored_fwi_val=(
                float(stored_fwi['fwi'])
                if stored_fwi and stored_fwi['fwi'] is not None
                else None
            )
            stored_ire=(
                float(stored_fwi['ire_gip'])
                if stored_fwi and stored_fwi['ire_gip'] is not None
                else None
            )

            row={
                'day':cur.isoformat(),
                'inputs_10min':{
                    'temperature':round(float(t),2),
                    'humidity':round(float(rh),2),
                    'wind_kmh':round(float(wind_kmh),2),
                    'rain_previous_24h_mm':round(float(rain24),4),
                    'wind_direction_deg':round(float(direction),1) if direction is not None else None,
                    'wind_direction_cardinal':direction_cardinal,
                    'rain_source':'Euskalmet 10-min sum (prev noon, current noon]'
                },
                'inherited_reconstructed_state':{
                    'ffmc':round(pf,4),'dmc':round(pd,4),'dc':round(pc,4)
                },
                'reconstructed':{
                    'ffmc':round(float(res.ffmc),4),
                    'dmc':round(float(res.dmc),4),
                    'dc':round(float(res.dc),4),
                    'isi':round(float(res.isi),4),
                    'bui':round(float(res.bui),4),
                    'fwi':round(float(res.fwi),4),
                    'fwi_level':v22_local_level(sid,res.fwi),
                    'ire_gip':round(float(ire),4),
                    'ire_gip_level':v22_local_level(sid,ire),
                    'wind_factor':round(float(w_factor),4),
                    'season_factor':round(float(s_factor),4),
                    'season_name':season_name,
                },
                'stored_weather':stored_weather_d,
                'stored_fwi':stored_fwi_d,
                'comparison':{
                    'rain_delta_mm':(
                        round(float(rain24)-stored_rain,4)
                        if stored_rain is not None else None
                    ),
                    'fwi_delta':(
                        round(float(res.fwi)-stored_fwi_val,4)
                        if stored_fwi_val is not None else None
                    ),
                    'ire_gip_delta':(
                        round(float(ire)-stored_ire,4)
                        if stored_ire is not None else None
                    ),
                }
            }
            rows.append(row)

            # La memoria del día siguiente procede SIEMPRE de la reconstrucción.
            pf,pd,pc=float(res.ffmc),float(res.dmc),float(res.dc)

        except Exception as exc:
            failures.append({
                'day':cur.isoformat(),
                'error_type':type(exc).__name__,
                'error':str(exc)
            })
            # Detenemos para no romper la memoria secuencial.
            break

        cur+=timedelta(days=1)

    fwi_deltas=[
        abs(r['comparison']['fwi_delta'])
        for r in rows if r['comparison']['fwi_delta'] is not None
    ]
    ire_deltas=[
        abs(r['comparison']['ire_gip_delta'])
        for r in rows if r['comparison']['ire_gip_delta'] is not None
    ]
    rain_deltas=[
        abs(r['comparison']['rain_delta_mm'])
        for r in rows if r['comparison']['rain_delta_mm'] is not None
    ]

    return {
        'ok':len(failures)==0,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'mode':'sequential_non_destructive_10min_rain',
        'writes_to_database':False,
        'station':sid,
        'station_name':FIXED_STATIONS.get(sid,sid),
        'period':{
            'start':d0.isoformat(),
            'end':d1.isoformat(),
            'days_requested':(d1-d0).days+1,
            'days_completed':len(rows)
        },
        'seed':seed_info,
        'method':{
            'temperature_humidity_wind':'Euskalmet observation at/near noon',
            'rain':'sum of Euskalmet 10-min precipitation in (previous noon, current noon]',
            'memory':'reconstructed FFMC/DMC/DC propagated sequentially',
            'levels':'station-specific P40/P65/P85/P95 when configured'
        },
        'summary':{
            'max_abs_rain_delta_mm':round(max(rain_deltas or [0.0]),4),
            'max_abs_fwi_delta':round(max(fwi_deltas or [0.0]),4),
            'max_abs_ire_gip_delta':round(max(ire_deltas or [0.0]),4),
            'failures':len(failures)
        },
        'rows':rows,
        'failures':failures,
        'note':'V22.9 sólo reconstruye y compara. No modifica weather_daily ni fwi_daily.'
    }


@app.get('/debug/v229/rebuild-all/{date_from}/{date_to}')
async def debug_v229_rebuild_all(date_from:str,date_to:str):
    """Resumen de reconstrucción V22.9 para las cinco estaciones."""
    stations=[]
    for sid in FIXED_STATION_IDS:
        res=await debug_v229_rebuild(sid,date_from,date_to)
        stations.append({
            'station':sid,
            'station_name':FIXED_STATIONS.get(sid,sid),
            'ok':res.get('ok'),
            'period':res.get('period'),
            'seed':res.get('seed'),
            'summary':res.get('summary'),
            'failures':res.get('failures')
        })
    return {
        'ok':all(s.get('ok') for s in stations),
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'writes_to_database':False,
        'stations':stations,
        'detail_url':'/debug/v229/rebuild/{sid}/{date_from}/{date_to}'
    }



# ============================================================
# V22.10.5.12 RESPALDO EUSKALMET FINAL
# Corrige la auditoría V22.9.1: NO llama a ffmc_calc/dmc_calc/etc.,
# porque este proyecto sólo expone oficialmente calculate().
# Se audita exactamente el mismo motor que usa update_day() y V22.9.
# MODO SOLO LECTURA.
# ============================================================

@app.get('/debug/v2292/day/{sid}/{day_iso}')
async def debug_v2292_day(sid:str,day_iso:str):
    sid=sid.upper()
    if sid not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación no válida','writes_to_database':False}

    try:
        day=date.fromisoformat(day_iso)
    except Exception:
        return {'ok':False,'error':'Fecha YYYY-MM-DD','writes_to_database':False}

    try:
        # -----------------------------------------------------
        # 1. Semilla que utilizaría una reconstrucción iniciada
        #    en este día: último FFMC/DMC/DC almacenado anterior.
        # -----------------------------------------------------
        with con() as c:
            seed=c.execute(
                """SELECT day,ffmc,dmc,dc,fwi,ire_gip
                   FROM fwi_daily
                   WHERE station_id=? AND day<?
                   ORDER BY day DESC LIMIT 1""",
                (sid,day.isoformat())
            ).fetchone()

        if seed:
            pf=float(seed['ffmc'])
            pd=float(seed['dmc'])
            pc=float(seed['dc'])
            seed_info={
                'source':'stored_previous_day',
                'day':seed['day'],
                'ffmc':pf,
                'dmc':pd,
                'dc':pc,
                'stored_fwi':seed['fwi'],
                'stored_ire_gip':seed['ire_gip'],
            }
        else:
            pf,pd,pc=map(float,INITIAL)
            seed_info={
                'source':'INITIAL',
                'day':None,
                'ffmc':pf,
                'dmc':pd,
                'dc':pc,
            }

        # -----------------------------------------------------
        # 2. Entradas meteorológicas EXACTAS de V22.9:
        #    T/HR/viento cerca de mediodía + lluvia 10-min 24 h.
        # -----------------------------------------------------
        t,rh,wind_kmh,rain24,direction=await v22_noon_weather(sid,day)

        inputs={
            'temperature_c':round(float(t),4),
            'humidity_pct':round(float(rh),4),
            'wind_kmh':round(float(wind_kmh),4),
            'rain_previous_24h_10min_mm':round(float(rain24),4),
            'wind_direction_deg':round(float(direction),4) if direction is not None else None,
            'wind_direction_cardinal':wind_cardinal(direction),
            'rain_definition':'sum of 10-min precipitation in (previous noon, current noon]',
        }

        # -----------------------------------------------------
        # 3. Motor real. La misma llamada calculate() utilizada
        #    por update_day() y por /debug/v229/rebuild.
        # -----------------------------------------------------
        res1=calculate(
            float(t),float(rh),float(wind_kmh),float(rain24),
            month=day.month,
            prev_ffmc=pf,prev_dmc=pd,prev_dc=pc
        )

        # Segunda ejecución idéntica: control de determinismo.
        res2=calculate(
            float(t),float(rh),float(wind_kmh),float(rain24),
            month=day.month,
            prev_ffmc=pf,prev_dmc=pd,prev_dc=pc
        )

        result1={
            'ffmc':round(float(res1.ffmc),6),
            'dmc':round(float(res1.dmc),6),
            'dc':round(float(res1.dc),6),
            'isi':round(float(res1.isi),6),
            'bui':round(float(res1.bui),6),
            'fwi':round(float(res1.fwi),6),
        }
        result2={
            'ffmc':round(float(res2.ffmc),6),
            'dmc':round(float(res2.dmc),6),
            'dc':round(float(res2.dc),6),
            'isi':round(float(res2.isi),6),
            'bui':round(float(res2.bui),6),
            'fwi':round(float(res2.fwi),6),
        }

        engine_repeat_delta={
            k:round(result1[k]-result2[k],10)
            for k in result1
        }

        # -----------------------------------------------------
        # 4. BASUGIX con los factores actuales.
        # -----------------------------------------------------
        season_name,s_factor=ire_gip_season(day)
        w_factor=ire_gip_wind_factor(direction,float(wind_kmh))
        ire=min(100.0,max(0.0,float(res1.fwi)*float(w_factor)*float(s_factor)))

        reconstructed={
            **result1,
            'fwi_level':v22_local_level(sid,res1.fwi),
            'wind_factor':round(float(w_factor),6),
            'season_factor':round(float(s_factor),6),
            'season_name':season_name,
            'ire_gip':round(float(ire),6),
            'ire_gip_level':v22_local_level(sid,ire),
        }

        # -----------------------------------------------------
        # 5. Valores almacenados para comparar.
        # -----------------------------------------------------
        with con() as c:
            stored_weather=c.execute(
                """SELECT temperature,humidity,wind_kmh,rain_mm,source,created_at
                   FROM weather_daily
                   WHERE station_id=? AND day=?""",
                (sid,day.isoformat())
            ).fetchone()

            stored_fwi=c.execute(
                """SELECT ffmc,dmc,dc,isi,bui,fwi,danger_level,
                          ire_gip,ire_gip_level,wind_direction_deg,
                          wind_factor,season_factor,created_at
                   FROM fwi_daily
                   WHERE station_id=? AND day=?""",
                (sid,day.isoformat())
            ).fetchone()

        sw=dict(stored_weather) if stored_weather else None
        sf=dict(stored_fwi) if stored_fwi else None

        def delta(new, old):
            if old is None:
                return None
            return round(float(new)-float(old),6)

        comparison={
            'temperature_delta':delta(t, sw.get('temperature') if sw else None),
            'humidity_delta':delta(rh, sw.get('humidity') if sw else None),
            'wind_kmh_delta':delta(wind_kmh, sw.get('wind_kmh') if sw else None),
            'rain_delta_mm':delta(rain24, sw.get('rain_mm') if sw else None),
            'ffmc_delta':delta(res1.ffmc, sf.get('ffmc') if sf else None),
            'dmc_delta':delta(res1.dmc, sf.get('dmc') if sf else None),
            'dc_delta':delta(res1.dc, sf.get('dc') if sf else None),
            'isi_delta':delta(res1.isi, sf.get('isi') if sf else None),
            'bui_delta':delta(res1.bui, sf.get('bui') if sf else None),
            'fwi_delta':delta(res1.fwi, sf.get('fwi') if sf else None),
            'ire_gip_delta':delta(ire, sf.get('ire_gip') if sf else None),
        }

        engine_repeat_ok=all(abs(v)<=1e-9 for v in engine_repeat_delta.values())

        # Clasificación diagnóstica del origen de la diferencia.
        changed_inputs=[]
        if comparison['temperature_delta'] is not None and abs(comparison['temperature_delta'])>0.01:
            changed_inputs.append('temperature')
        if comparison['humidity_delta'] is not None and abs(comparison['humidity_delta'])>0.01:
            changed_inputs.append('humidity')
        if comparison['wind_kmh_delta'] is not None and abs(comparison['wind_kmh_delta'])>0.01:
            changed_inputs.append('wind_kmh')
        if comparison['rain_delta_mm'] is not None and abs(comparison['rain_delta_mm'])>0.01:
            changed_inputs.append('rain_24h')

        return {
            'ok':True,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'writes_to_database':False,
            'station':sid,
            'station_name':FIXED_STATIONS.get(sid,sid),
            'day':day.isoformat(),
            'seed':seed_info,
            'inputs_v229':inputs,
            'engine_call':{
                'function':'fwi.calculate',
                'signature_used':'calculate(T, RH, wind_kmh, rain24, month=..., prev_ffmc=..., prev_dmc=..., prev_dc=...)',
                'same_as_update_day':True,
                'same_as_v229_rebuild':True,
            },
            'reconstructed':reconstructed,
            'engine_repeat_check':{
                'second_run':result2,
                'delta_first_minus_second':engine_repeat_delta,
                'deterministic_match':engine_repeat_ok,
            },
            'stored_weather':sw,
            'stored_fwi':sf,
            'comparison_reconstructed_minus_stored':comparison,
            'diagnosis':{
                'changed_inputs_vs_stored':changed_inputs,
                'rain_changed':('rain_24h' in changed_inputs),
                'engine_deterministic':engine_repeat_ok,
                'interpretation':(
                    'Si engine_deterministic=true, el resultado mostrado procede exactamente '
                    'del motor calculate() con estas entradas y esta semilla. Las diferencias '
                    'frente a SQLite se explican por entradas/semilla distintas, no por una '
                    'segunda implementación de las fórmulas.'
                )
            }
        }

    except Exception as exc:
        return {
            'ok':False,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'station':sid,
            'day':day.isoformat(),
            'error_type':type(exc).__name__,
            'error':str(exc),
            'writes_to_database':False,
        }


# ============================================================
# V22.10.5.12 RESPALDO EUSKALMET FINAL
# Audita una secuencia completa día a día usando SIEMPRE el
# estado reconstruido del día anterior como memoria.
# MODO SOLO LECTURA / NO DESTRUCTIVO.
# ============================================================

@app.get('/debug/v2293/chain/{sid}/{date_from}/{date_to}')
async def debug_v2293_chain(sid:str,date_from:str,date_to:str):
    sid=sid.upper()
    if sid not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación no válida','writes_to_database':False}

    try:
        d0=date.fromisoformat(date_from)
        d1=date.fromisoformat(date_to)
    except Exception:
        return {'ok':False,'error':'Fechas en formato YYYY-MM-DD','writes_to_database':False}

    if d1 < d0:
        return {'ok':False,'error':'date_to anterior a date_from','writes_to_database':False}

    ndays=(d1-d0).days+1
    if ndays > 120:
        return {'ok':False,'error':'Máximo 120 días por ejecución','writes_to_database':False}

    # Semilla: último estado previo al inicio.
    with con() as c:
        seed=c.execute(
            """SELECT day,ffmc,dmc,dc,fwi,ire_gip
               FROM fwi_daily
               WHERE station_id=? AND day<?
               ORDER BY day DESC LIMIT 1""",
            (sid,d0.isoformat())
        ).fetchone()

    if seed:
        pf=float(seed['ffmc'])
        pd=float(seed['dmc'])
        pc=float(seed['dc'])
        seed_info={
            'source':'stored_previous_day',
            'day':seed['day'],
            'ffmc':pf,'dmc':pd,'dc':pc,
            'stored_fwi':seed['fwi'],
            'stored_ire_gip':seed['ire_gip'],
        }
    else:
        pf,pd,pc=map(float,INITIAL)
        seed_info={
            'source':'INITIAL',
            'day':None,
            'ffmc':pf,'dmc':pd,'dc':pc,
        }

    rows=[]
    failures=[]
    first_material_divergence=None
    cur=d0

    while cur <= d1:
        try:
            # Entradas meteorológicas V22.9.
            t,rh,wind_kmh,rain24,direction=await v22_noon_weather(sid,cur)

            inherited={
                'ffmc':round(pf,6),
                'dmc':round(pd,6),
                'dc':round(pc,6),
            }

            res=calculate(
                float(t),float(rh),float(wind_kmh),float(rain24),
                month=cur.month,
                prev_ffmc=pf,prev_dmc=pd,prev_dc=pc
            )

            season_name,s_factor=ire_gip_season(cur)
            w_factor=ire_gip_wind_factor(direction,float(wind_kmh))
            ire=min(100.0,max(0.0,float(res.fwi)*float(w_factor)*float(s_factor)))

            with con() as c:
                sw=c.execute(
                    """SELECT temperature,humidity,wind_kmh,rain_mm,source
                       FROM weather_daily
                       WHERE station_id=? AND day=?""",
                    (sid,cur.isoformat())
                ).fetchone()
                sf=c.execute(
                    """SELECT ffmc,dmc,dc,isi,bui,fwi,danger_level,
                              ire_gip,ire_gip_level,wind_direction_deg,
                              wind_factor,season_factor
                       FROM fwi_daily
                       WHERE station_id=? AND day=?""",
                    (sid,cur.isoformat())
                ).fetchone()

            swd=dict(sw) if sw else None
            sfd=dict(sf) if sf else None

            def dlt(a,b):
                if b is None:
                    return None
                return round(float(a)-float(b),6)

            comparison={
                'temperature_delta':dlt(t, swd.get('temperature') if swd else None),
                'humidity_delta':dlt(rh, swd.get('humidity') if swd else None),
                'wind_kmh_delta':dlt(wind_kmh, swd.get('wind_kmh') if swd else None),
                'rain_delta_mm':dlt(rain24, swd.get('rain_mm') if swd else None),
                'ffmc_delta':dlt(res.ffmc, sfd.get('ffmc') if sfd else None),
                'dmc_delta':dlt(res.dmc, sfd.get('dmc') if sfd else None),
                'dc_delta':dlt(res.dc, sfd.get('dc') if sfd else None),
                'isi_delta':dlt(res.isi, sfd.get('isi') if sfd else None),
                'bui_delta':dlt(res.bui, sfd.get('bui') if sfd else None),
                'fwi_delta':dlt(res.fwi, sfd.get('fwi') if sfd else None),
                'ire_gip_delta':dlt(ire, sfd.get('ire_gip') if sfd else None),
            }

            changed_inputs=[]
            for key,cmp_key in (
                ('temperature','temperature_delta'),
                ('humidity','humidity_delta'),
                ('wind_kmh','wind_kmh_delta'),
                ('rain_24h','rain_delta_mm'),
            ):
                v=comparison.get(cmp_key)
                if v is not None and abs(v) > 0.01:
                    changed_inputs.append(key)

            fwi_delta=comparison.get('fwi_delta')
            material=(
                fwi_delta is not None and abs(fwi_delta) >= 0.5
            )
            if material and first_material_divergence is None:
                first_material_divergence={
                    'day':cur.isoformat(),
                    'fwi_delta':fwi_delta,
                    'ire_gip_delta':comparison.get('ire_gip_delta'),
                    'changed_inputs':changed_inputs,
                    'inherited_reconstructed_state':inherited,
                }

            rows.append({
                'day':cur.isoformat(),
                'inputs_v229':{
                    'temperature_c':round(float(t),4),
                    'humidity_pct':round(float(rh),4),
                    'wind_kmh':round(float(wind_kmh),4),
                    'rain_previous_24h_10min_mm':round(float(rain24),4),
                    'wind_direction_deg':round(float(direction),4) if direction is not None else None,
                    'wind_direction_cardinal':wind_cardinal(direction),
                },
                'inherited_reconstructed_state':inherited,
                'reconstructed':{
                    'ffmc':round(float(res.ffmc),6),
                    'dmc':round(float(res.dmc),6),
                    'dc':round(float(res.dc),6),
                    'isi':round(float(res.isi),6),
                    'bui':round(float(res.bui),6),
                    'fwi':round(float(res.fwi),6),
                    'fwi_level':v22_local_level(sid,res.fwi),
                    'wind_factor':round(float(w_factor),6),
                    'season_factor':round(float(s_factor),6),
                    'season_name':season_name,
                    'ire_gip':round(float(ire),6),
                    'ire_gip_level':v22_local_level(sid,ire),
                },
                'stored_weather':swd,
                'stored_fwi':sfd,
                'comparison_reconstructed_minus_stored':comparison,
                'diagnosis':{
                    'changed_inputs_vs_stored':changed_inputs,
                    'material_fwi_divergence_ge_0_5':material,
                }
            })

            # Memoria del día siguiente = SIEMPRE reconstruida.
            pf=float(res.ffmc)
            pd=float(res.dmc)
            pc=float(res.dc)

        except Exception as exc:
            failures.append({
                'day':cur.isoformat(),
                'error_type':type(exc).__name__,
                'error':str(exc),
            })
            break

        cur += timedelta(days=1)

    fwi_deltas=[
        abs(r['comparison_reconstructed_minus_stored']['fwi_delta'])
        for r in rows
        if r['comparison_reconstructed_minus_stored']['fwi_delta'] is not None
    ]
    ire_deltas=[
        abs(r['comparison_reconstructed_minus_stored']['ire_gip_delta'])
        for r in rows
        if r['comparison_reconstructed_minus_stored']['ire_gip_delta'] is not None
    ]
    rain_deltas=[
        abs(r['comparison_reconstructed_minus_stored']['rain_delta_mm'])
        for r in rows
        if r['comparison_reconstructed_minus_stored']['rain_delta_mm'] is not None
    ]

    # Cuántos días cambian de categoría.
    level_changes=0
    for r in rows:
        sf=r.get('stored_fwi') or {}
        stored_level=sf.get('danger_level')
        new_level=r['reconstructed'].get('fwi_level')
        if stored_level is not None and new_level is not None and stored_level != new_level:
            level_changes += 1

    return {
        'ok':len(failures)==0,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'mode':'sequential_chain_audit_non_destructive',
        'writes_to_database':False,
        'station':sid,
        'station_name':FIXED_STATIONS.get(sid,sid),
        'period':{
            'start':d0.isoformat(),
            'end':d1.isoformat(),
            'days_requested':ndays,
            'days_completed':len(rows),
        },
        'seed':seed_info,
        'method':{
            'meteorology':'Euskalmet observation at/near noon',
            'rain':'sum of 10-min precipitation in (previous noon, current noon]',
            'memory':'reconstructed FFMC/DMC/DC propagated day by day',
            'engine':'fwi.calculate',
        },
        'summary':{
            'first_material_divergence':first_material_divergence,
            'max_abs_rain_delta_mm':round(max(rain_deltas or [0.0]),6),
            'max_abs_fwi_delta':round(max(fwi_deltas or [0.0]),6),
            'max_abs_ire_gip_delta':round(max(ire_deltas or [0.0]),6),
            'fwi_level_changes':level_changes,
            'failures':len(failures),
        },
        'rows':rows,
        'failures':failures,
        'note':'La memoria del día N+1 procede del estado reconstruido del día N. No se modifica SQLite.'
    }


@app.get('/debug/v2293/chain-all/{date_from}/{date_to}')
async def debug_v2293_chain_all(date_from:str,date_to:str):
    """Resumen secuencial V22.9.3 para las cinco estaciones."""
    out=[]
    for sid in FIXED_STATION_IDS:
        res=await debug_v2293_chain(sid,date_from,date_to)
        out.append({
            'station':sid,
            'station_name':FIXED_STATIONS.get(sid,sid),
            'ok':res.get('ok'),
            'period':res.get('period'),
            'seed':res.get('seed'),
            'summary':res.get('summary'),
            'failures':res.get('failures'),
        })
    return {
        'ok':all(x.get('ok') for x in out),
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'writes_to_database':False,
        'stations':out,
        'detail_url':'/debug/v2293/chain/{sid}/{date_from}/{date_to}'
    }


# ============================================================
# V22.10.5.12 RESPALDO EUSKALMET FINAL
#
# Criterio propuesto:
#   T, HR y viento = observación EXACTA de las 12:00.
#   Lluvia = suma de precipitación de 10 min en las 24 h:
#            (12:00 del día anterior, 12:00 del día actual]
#
# MODO SOLO LECTURA. No modifica SQLite.
# ============================================================

async def _v2294_exact_measure(station,day,var,target_hhmm='12:00'):
    """Obtiene la observación exacta HH:MM para T/HR/viento.

    No usa tolerancia ni 'nearest'. Si no existe exactamente 12:00,
    devuelve un diagnóstico con los puntos disponibles, pero no sustituye
    por 11:50, 12:10, etc.
    """
    mapping=await _v222_mapping(station,day)
    sensor,mt,mid=mapping[var]

    day_path,day_payload,keys=await _v224_day_index(
        station,sensor,mt,mid,day
    )

    target_hour=int(target_hhmm.split(':')[0])
    candidate_keys=[]
    for key in keys:
        tm=_v224_time_from_key(key)
        if tm is None:
            continue
        hh=int(tm.split(':')[0])
        if hh==target_hour:
            candidate_keys.append(key)

    points=[]
    for key in candidate_keys:
        pts=await _v224_follow_key(key,max_depth=4)
        for hhmm,val,path in pts:
            points.append({
                'time':hhmm,
                'raw_value':float(val),
                'source_path':path,
                'hour_key':key,
            })

    # Deduplicar conservando el primer origen.
    unique=[]
    seen=set()
    for p in sorted(points,key=lambda x:x['time']):
        k=(p['time'],round(p['raw_value'],8))
        if k not in seen:
            seen.add(k)
            unique.append(p)

    exact=[p for p in unique if p['time']==target_hhmm]
    selected=exact[0] if exact else None

    if selected is None:
        return {
            'ok':False,
            'variable':var,
            'target_time':target_hhmm,
            'day_endpoint':day_path,
            'candidate_hour_keys':candidate_keys,
            'available_points':unique,
            'error':'No existe observación exacta a las 12:00',
        }

    raw=float(selected['raw_value'])
    converted=raw*3.6 if var=='wind_kmh' else raw

    return {
        'ok':True,
        'variable':var,
        'target_time':target_hhmm,
        'selected_raw':round(raw,6),
        'selected_value':round(converted,6),
        'unit_conversion':'m/s -> km/h' if var=='wind_kmh' else 'none',
        'source_path':selected['source_path'],
        'hour_key':selected['hour_key'],
        'available_points':unique,
    }


async def _v2294_rain_exact_24h(station,day):
    """Suma 10-min exactamente en (día anterior 12:00, día actual 12:00]."""
    mapping_today=await _v222_mapping(station,day)
    mapping_prev=await _v222_mapping(station,day-timedelta(days=1))

    st,mt,mid=mapping_today['rain_mm']
    sp,mtp,midp=mapping_prev['rain_mm']

    total,n,details=await _v224_rain24(
        station,st,mt,mid,sp,mtp,midp,day
    )

    return {
        'ok':True,
        'rain_mm':round(float(total),6),
        'points':int(n),
        'expected_points':144,
        'complete_144':int(n)==144,
        'window':{
            'from_exclusive':f'{(day-timedelta(days=1)).isoformat()} 12:00',
            'to_inclusive':f'{day.isoformat()} 12:00',
        },
        'details':details,
    }


@app.get('/debug/v2294/noon/{sid}/{day_iso}')
async def debug_v2294_noon(sid:str,day_iso:str):
    """Audita el nuevo criterio exacto de las 12:00 para un día."""
    sid=sid.upper()
    if sid not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación no válida','writes_to_database':False}

    try:
        day=date.fromisoformat(day_iso)
    except Exception:
        return {'ok':False,'error':'Fecha YYYY-MM-DD','writes_to_database':False}

    try:
        # Semilla usada para el cálculo de ese día.
        with con() as c:
            seed=c.execute(
                """SELECT day,ffmc,dmc,dc,fwi,ire_gip
                   FROM fwi_daily
                   WHERE station_id=? AND day<?
                   ORDER BY day DESC LIMIT 1""",
                (sid,day.isoformat())
            ).fetchone()

        if seed:
            pf=float(seed['ffmc']); pd=float(seed['dmc']); pc=float(seed['dc'])
            seed_info=dict(seed)
            seed_info['source']='stored_previous_day'
        else:
            pf,pd,pc=map(float,INITIAL)
            seed_info={
                'source':'INITIAL','day':None,
                'ffmc':pf,'dmc':pd,'dc':pc
            }

        # Nuevo criterio: valor EXACTO 12:00.
        temp=await _v2294_exact_measure(sid,day,'temperature','12:00')
        hum=await _v2294_exact_measure(sid,day,'humidity','12:00')
        wind=await _v2294_exact_measure(sid,day,'wind_kmh','12:00')
        rain=await _v2294_rain_exact_24h(sid,day)

        exact_inputs_ok=temp.get('ok') and hum.get('ok') and wind.get('ok')

        # Comparación con la lógica actual V22.9 (nearest).
        current_t,current_h,current_w,current_r,current_dir=await v22_noon_weather(sid,day)

        exact_result=None
        if exact_inputs_ok:
            res=calculate(
                float(temp['selected_value']),
                float(hum['selected_value']),
                float(wind['selected_value']),
                float(rain['rain_mm']),
                month=day.month,
                prev_ffmc=pf,prev_dmc=pd,prev_dc=pc
            )
            season_name,s_factor=ire_gip_season(day)
            w_factor=ire_gip_wind_factor(current_dir,float(wind['selected_value']))
            ire=min(100.0,max(0.0,float(res.fwi)*w_factor*s_factor))

            exact_result={
                'ffmc':round(float(res.ffmc),6),
                'dmc':round(float(res.dmc),6),
                'dc':round(float(res.dc),6),
                'isi':round(float(res.isi),6),
                'bui':round(float(res.bui),6),
                'fwi':round(float(res.fwi),6),
                'fwi_level':v22_local_level(sid,res.fwi),
                'wind_factor':round(float(w_factor),6),
                'season_factor':round(float(s_factor),6),
                'season_name':season_name,
                'ire_gip':round(float(ire),6),
                'ire_gip_level':v22_local_level(sid,ire),
            }

        with con() as c:
            sw=c.execute(
                """SELECT temperature,humidity,wind_kmh,rain_mm,source
                   FROM weather_daily
                   WHERE station_id=? AND day=?""",
                (sid,day.isoformat())
            ).fetchone()
            sf=c.execute(
                """SELECT ffmc,dmc,dc,isi,bui,fwi,danger_level,
                          ire_gip,ire_gip_level
                   FROM fwi_daily
                   WHERE station_id=? AND day=?""",
                (sid,day.isoformat())
            ).fetchone()

        stored_weather=dict(sw) if sw else None
        stored_fwi=dict(sf) if sf else None

        return {
            'ok':True,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'writes_to_database':False,
            'station':sid,
            'station_name':FIXED_STATIONS.get(sid,sid),
            'day':day.isoformat(),
            'proposed_method':{
                'temperature':'observación exacta 12:00',
                'humidity':'observación exacta 12:00',
                'wind':'observación exacta 12:00',
                'rain':'suma 10-min en (12:00 anterior, 12:00 actual]',
                'fallback_when_exact_noon_missing':'NINGUNO en esta auditoría',
            },
            'seed':seed_info,
            'exact_1200':{
                'temperature':temp,
                'humidity':hum,
                'wind_kmh':wind,
                'rain_24h':rain,
            },
            'current_v229_nearest_inputs':{
                'temperature':round(float(current_t),6),
                'humidity':round(float(current_h),6),
                'wind_kmh':round(float(current_w),6),
                'rain_24h_mm':round(float(current_r),6),
                'wind_direction_deg':round(float(current_dir),6) if current_dir is not None else None,
            },
            'exact_1200_result':exact_result,
            'stored_weather':stored_weather,
            'stored_fwi':stored_fwi,
            'diagnosis':{
                'exact_noon_inputs_available':bool(exact_inputs_ok),
                'rain_points':rain.get('points'),
                'rain_complete_144':rain.get('complete_144'),
                'note':(
                    'Si exact_noon_inputs_available=true, el bloque exact_1200_result '
                    'representa el índice calculado con T/HR/viento exactamente a las 12:00 '
                    'y lluvia acumulada en las 24 h previas hasta las 12:00.'
                )
            }
        }

    except Exception as exc:
        return {
            'ok':False,
            'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
            'station':sid,
            'day':day.isoformat(),
            'error_type':type(exc).__name__,
            'error':str(exc),
            'writes_to_database':False,
        }


# ============================================================
# V22.10.5.12 RESPALDO EUSKALMET FINAL
#
# Comprueba, para todas las estaciones y días de un rango:
#   - existencia de T exacta a las 12:00
#   - existencia de HR exacta a las 12:00
#   - existencia de viento exacto a las 12:00
#   - lluvia 24 h por suma de 10-min
#   - número de puntos de lluvia (ideal 144)
#
# SOLO LECTURA. NO modifica SQLite.
# ============================================================

@app.get('/debug/v2295/noon-availability')
async def debug_v2295_noon_availability(
    date_from:str,
    date_to:str,
    stations:str="C023,C017,C058,C026,C028"
):
    try:
        d0=date.fromisoformat(date_from)
        d1=date.fromisoformat(date_to)
    except Exception:
        return {
            'ok':False,
            'error':'Fechas en formato YYYY-MM-DD',
            'writes_to_database':False
        }

    if d1 < d0:
        return {
            'ok':False,
            'error':'date_to anterior a date_from',
            'writes_to_database':False
        }

    station_ids=[s.strip().upper() for s in stations.split(',') if s.strip()]
    invalid=[s for s in station_ids if s not in FIXED_STATION_IDS]
    if invalid:
        return {
            'ok':False,
            'error':f'Estaciones no válidas: {invalid}',
            'writes_to_database':False
        }

    total_days=(d1-d0).days+1
    if total_days>120:
        return {
            'ok':False,
            'error':'Máximo 120 días por ejecución',
            'writes_to_database':False
        }

    overall={
        'station_days_checked':0,
        'exact_temp_1200':0,
        'exact_humidity_1200':0,
        'exact_wind_1200':0,
        'all_three_exact_1200':0,
        'rain_complete_144':0,
        'fully_complete_days':0,
        'missing_any_noon_input':0,
        'incomplete_rain_days':0,
        'errors':0,
    }

    by_station={}
    problems=[]
    rows=[]

    for sid in station_ids:
        ss={
            'checked':0,
            'exact_temp_1200':0,
            'exact_humidity_1200':0,
            'exact_wind_1200':0,
            'all_three_exact_1200':0,
            'rain_complete_144':0,
            'fully_complete_days':0,
            'missing_any_noon_input':0,
            'incomplete_rain_days':0,
            'errors':0,
        }
        by_station[sid]=ss

        cur=d0
        while cur<=d1:
            try:
                temp=await _v2294_exact_measure(sid,cur,'temperature','12:00')
                hum=await _v2294_exact_measure(sid,cur,'humidity','12:00')
                wind=await _v2294_exact_measure(sid,cur,'wind_kmh','12:00')
                rain=await _v2294_rain_exact_24h(sid,cur)

                temp_ok=bool(temp.get('ok'))
                hum_ok=bool(hum.get('ok'))
                wind_ok=bool(wind.get('ok'))
                all_three=temp_ok and hum_ok and wind_ok
                rain_complete=bool(rain.get('complete_144'))
                fully_complete=all_three and rain_complete

                overall['station_days_checked']+=1
                ss['checked']+=1

                if temp_ok:
                    overall['exact_temp_1200']+=1
                    ss['exact_temp_1200']+=1
                if hum_ok:
                    overall['exact_humidity_1200']+=1
                    ss['exact_humidity_1200']+=1
                if wind_ok:
                    overall['exact_wind_1200']+=1
                    ss['exact_wind_1200']+=1
                if all_three:
                    overall['all_three_exact_1200']+=1
                    ss['all_three_exact_1200']+=1
                else:
                    overall['missing_any_noon_input']+=1
                    ss['missing_any_noon_input']+=1

                if rain_complete:
                    overall['rain_complete_144']+=1
                    ss['rain_complete_144']+=1
                else:
                    overall['incomplete_rain_days']+=1
                    ss['incomplete_rain_days']+=1

                if fully_complete:
                    overall['fully_complete_days']+=1
                    ss['fully_complete_days']+=1

                row={
                    'day':cur.isoformat(),
                    'station':sid,
                    'station_name':FIXED_STATIONS.get(sid,sid),
                    'temperature_1200_ok':temp_ok,
                    'temperature_1200_value':temp.get('selected_value') if temp_ok else None,
                    'humidity_1200_ok':hum_ok,
                    'humidity_1200_value':hum.get('selected_value') if hum_ok else None,
                    'wind_1200_ok':wind_ok,
                    'wind_1200_kmh':wind.get('selected_value') if wind_ok else None,
                    'rain_24h_mm':rain.get('rain_mm'),
                    'rain_points':rain.get('points'),
                    'rain_complete_144':rain_complete,
                    'fully_complete':fully_complete,
                }

                if not temp_ok:
                    row['temperature_available_points']=temp.get('available_points')
                if not hum_ok:
                    row['humidity_available_points']=hum.get('available_points')
                if not wind_ok:
                    row['wind_available_points']=wind.get('available_points')

                rows.append(row)

                if not fully_complete:
                    problems.append(row)

            except Exception as exc:
                overall['errors']+=1
                ss['errors']+=1
                problem={
                    'day':cur.isoformat(),
                    'station':sid,
                    'station_name':FIXED_STATIONS.get(sid,sid),
                    'status':'ERROR',
                    'error_type':type(exc).__name__,
                    'error':str(exc),
                }
                rows.append(problem)
                problems.append(problem)

            cur += timedelta(days=1)

    # Porcentajes para interpretar rápidamente la cobertura.
    checked=max(overall['station_days_checked'],1)
    overall['pct_all_three_exact_1200']=round(
        100.0*overall['all_three_exact_1200']/checked,2
    )
    overall['pct_rain_complete_144']=round(
        100.0*overall['rain_complete_144']/checked,2
    )
    overall['pct_fully_complete']=round(
        100.0*overall['fully_complete_days']/checked,2
    )

    for sid,ss in by_station.items():
        c=max(ss['checked'],1)
        ss['pct_all_three_exact_1200']=round(100.0*ss['all_three_exact_1200']/c,2)
        ss['pct_rain_complete_144']=round(100.0*ss['rain_complete_144']/c,2)
        ss['pct_fully_complete']=round(100.0*ss['fully_complete_days']/c,2)

    return {
        'ok':overall['errors']==0,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'writes_to_database':False,
        'criterion':{
            'temperature':'exacta 12:00',
            'humidity':'exacta 12:00',
            'wind':'exacto 12:00',
            'rain':'suma 10-min en (12:00 anterior, 12:00 actual]',
            'rain_expected_points':144,
        },
        'period':{
            'start':d0.isoformat(),
            'end':d1.isoformat(),
            'days':total_days,
        },
        'stations':station_ids,
        'summary':overall,
        'summary_by_station':by_station,
        'problem_count':len(problems),
        'problems':problems,
        'all_rows':rows,
        'note':'Los problemas incluyen cualquier día sin T/HR/viento exactos a las 12:00 o sin 144 puntos de lluvia. No se usa fallback.'
    }


# ============================================================
# V22.10.5.12 RESPALDO EUSKALMET FINAL
#
# Criterio acordado:
#   - Temperatura: observación exacta 12:00
#   - Humedad: observación exacta 12:00
#   - Viento: observación exacta 12:00
#   - Lluvia: suma de registros de 10 min en
#       (12:00 día anterior, 12:00 día actual]
#
# Política de huecos:
#   - NO convertir registros ausentes a 0
#   - NO interpolar
#   - calcular la lluvia con lo realmente observado
#   - informar número de registros presentes/ausentes y cobertura
#
# Etiquetas provisionales:
#   144/144       -> Completo
#   faltan 1..3   -> Hueco menor
#   faltan 4..12  -> Hueco relevante
#   faltan >12    -> Cobertura insuficiente
#
# SOLO LECTURA. NO modifica SQLite.
# ============================================================

def _v2296_quality(points):
    try:
        p = int(points)
    except Exception:
        p = 0
    p = max(0, min(144, p))
    missing = 144 - p
    coverage = round((p / 144.0) * 100.0, 2)

    if missing == 0:
        label = "Completo"
    elif missing <= 3:
        label = "Hueco menor"
    elif missing <= 12:
        label = "Hueco relevante"
    else:
        label = "Cobertura insuficiente"

    return {
        "rain_points": p,
        "rain_missing_points": missing,
        "rain_coverage_pct": coverage,
        "data_quality": label,
    }


def _v2296_partial_hours(details):
    """Extrae horas con menos de 6 lecturas aceptadas."""
    out = []
    for item in (details or []):
        if not isinstance(item, dict):
            continue

        n = item.get("accepted")
        if n is None:
            n = item.get("points_found")

        try:
            n_int = int(n)
        except Exception:
            continue

        if n_int < 6:
            out.append({
                "day": item.get("day"),
                "hour": item.get("hour"),
                "points_found": item.get("points_found"),
                "accepted": item.get("accepted"),
                "missing_in_hour": max(0, 6 - n_int),
                "subtotal_mm": item.get("subtotal"),
                "source_key": item.get("key"),
            })
    return out


@app.get('/debug/v2296/rain-gaps/{station}/{day_iso}')
async def debug_v2296_rain_gaps(station: str, day_iso: str):
    """Audita los huecos de precipitación de un día/estación."""
    station = station.upper()
    if station not in FIXED_STATION_IDS:
        return {
            "ok": False,
            "error": "Estación no válida",
            "writes_to_database": False
        }

    try:
        d = date.fromisoformat(day_iso)
    except Exception:
        return {
            "ok": False,
            "error": "Fecha en formato YYYY-MM-DD",
            "writes_to_database": False
        }

    try:
        rain = await _v2294_rain_exact_24h(station, d)
        q = _v2296_quality(rain.get("points"))
        details = rain.get("details") or []
        partial = _v2296_partial_hours(details)

        return {
            "ok": True,
            "version": "V22.10.5.12 RESPALDO EUSKALMET FINAL",
            "writes_to_database": False,
            "station": station,
            "station_name": FIXED_STATIONS.get(station, station),
            "day": d.isoformat(),
            "window": rain.get("window"),
            "rain_24h_observed_mm": rain.get("rain_mm"),
            **q,
            "rain_complete_144": q["rain_missing_points"] == 0,
            "partial_hours": partial,
            "source_details": details,
            "interpretation": (
                "La lluvia es la suma de los registros realmente observados. "
                "Los huecos no se convierten en 0 y no se interpolan."
            ),
        }

    except Exception as exc:
        return {
            "ok": False,
            "version": "V22.10.5.12 RESPALDO EUSKALMET FINAL",
            "writes_to_database": False,
            "station": station,
            "day": day_iso,
            "error_type": type(exc).__name__,
            "error": str(exc),
        }


@app.get('/debug/v2296/rain-gap-audit')
async def debug_v2296_rain_gap_audit(
    date_from: str,
    date_to: str,
    stations: str = "C023,C017,C058,C026,C028"
):
    """Auditoría masiva de cobertura de precipitación 10-min."""
    try:
        d0 = date.fromisoformat(date_from)
        d1 = date.fromisoformat(date_to)
    except Exception:
        return {
            "ok": False,
            "error": "Fechas en formato YYYY-MM-DD",
            "writes_to_database": False
        }

    if d1 < d0:
        return {
            "ok": False,
            "error": "date_to anterior a date_from",
            "writes_to_database": False
        }

    if (d1 - d0).days + 1 > 120:
        return {
            "ok": False,
            "error": "Máximo 120 días por ejecución",
            "writes_to_database": False
        }

    station_ids = [s.strip().upper() for s in stations.split(",") if s.strip()]
    invalid = [s for s in station_ids if s not in FIXED_STATION_IDS]
    if invalid:
        return {
            "ok": False,
            "error": f"Estaciones no válidas: {invalid}",
            "writes_to_database": False
        }

    summary = {
        "checked": 0,
        "Completo": 0,
        "Hueco menor": 0,
        "Hueco relevante": 0,
        "Cobertura insuficiente": 0,
        "missing_points_total": 0,
        "errors": 0,
    }
    by_station = {}
    gaps = []
    all_rows = []

    for sid in station_ids:
        ss = {
            "checked": 0,
            "Completo": 0,
            "Hueco menor": 0,
            "Hueco relevante": 0,
            "Cobertura insuficiente": 0,
            "missing_points_total": 0,
            "errors": 0,
        }
        by_station[sid] = ss

        cur = d0
        while cur <= d1:
            try:
                rain = await _v2294_rain_exact_24h(sid, cur)
                q = _v2296_quality(rain.get("points"))

                row = {
                    "day": cur.isoformat(),
                    "station": sid,
                    "station_name": FIXED_STATIONS.get(sid, sid),
                    "rain_24h_observed_mm": rain.get("rain_mm"),
                    **q,
                }

                summary["checked"] += 1
                ss["checked"] += 1
                summary[q["data_quality"]] += 1
                ss[q["data_quality"]] += 1
                summary["missing_points_total"] += q["rain_missing_points"]
                ss["missing_points_total"] += q["rain_missing_points"]

                if q["rain_missing_points"] > 0:
                    row["partial_hours"] = _v2296_partial_hours(rain.get("details"))
                    gaps.append(row)

                all_rows.append(row)

            except Exception as exc:
                summary["errors"] += 1
                ss["errors"] += 1
                err = {
                    "day": cur.isoformat(),
                    "station": sid,
                    "station_name": FIXED_STATIONS.get(sid, sid),
                    "status": "ERROR",
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                }
                gaps.append(err)
                all_rows.append(err)

            cur += timedelta(days=1)

    checked = max(summary["checked"], 1)
    summary["days_with_any_gap"] = (
        summary["Hueco menor"] +
        summary["Hueco relevante"] +
        summary["Cobertura insuficiente"]
    )
    summary["pct_complete"] = round(100.0 * summary["Completo"] / checked, 2)

    for sid, ss in by_station.items():
        c = max(ss["checked"], 1)
        ss["days_with_any_gap"] = (
            ss["Hueco menor"] +
            ss["Hueco relevante"] +
            ss["Cobertura insuficiente"]
        )
        ss["pct_complete"] = round(100.0 * ss["Completo"] / c, 2)

    return {
        "ok": summary["errors"] == 0,
        "version": "V22.10.5.12 RESPALDO EUSKALMET FINAL",
        "writes_to_database": False,
        "criterion": {
            "temperature": "observación exacta 12:00",
            "humidity": "observación exacta 12:00",
            "wind": "observación exacta 12:00",
            "rain": "suma de registros observados de 10 min en (12:00 anterior, 12:00 actual]",
            "missing_policy": "no cero, no interpolación; informar cobertura",
            "quality_labels": {
                "Completo": "144/144",
                "Hueco menor": "faltan 1-3",
                "Hueco relevante": "faltan 4-12",
                "Cobertura insuficiente": "faltan más de 12"
            }
        },
        "period": {
            "start": d0.isoformat(),
            "end": d1.isoformat(),
            "days": (d1 - d0).days + 1,
        },
        "stations": station_ids,
        "summary": summary,
        "summary_by_station": by_station,
        "gap_count": len(gaps),
        "gaps": gaps,
        "all_rows": all_rows,
        "note": (
            "Sólo auditoría. La lluvia indicada es la observada; los huecos "
            "se contabilizan y etiquetan. SQLite no se modifica."
        )
    }


# ============================================================
# V22.9.7 - CRITERIO OPERATIVO Y CALIDAD DE DATOS
# T/HR/viento: lectura exacta 12:00.
# Lluvia: suma de lecturas 10-min observadas en
# (12:00 día anterior, 12:00 día actual].
# Los huecos NO se rellenan con 0 y NO se interpolan.
# ============================================================

def _v2297_rain_quality(points):
    try:
        present = int(points)
    except Exception:
        present = 0
    present = max(0, min(144, present))
    missing = 144 - present
    if missing == 0:
        label = "Completo"
    elif missing <= 3:
        label = "Hueco menor"
    elif missing <= 12:
        label = "Hueco relevante"
    else:
        label = "Cobertura insuficiente"
    return {
        "rain_points_present": present,
        "rain_points_expected": 144,
        "rain_points_missing": missing,
        "rain_coverage_pct": round(100.0 * present / 144.0, 2),
        "rain_quality": label,
        "rain_warning": None if missing == 0 else
            f"Precipitación observada con {present}/144 lecturas; faltan {missing}."
    }


@app.get('/debug/v2297/day/{station}/{day_iso}')
async def debug_v2297_day(station: str, day_iso: str):
    station = station.upper()
    if station not in FIXED_STATION_IDS:
        return {"ok": False, "error": "Estación no válida",
                "writes_to_database": False}
    try:
        d = date.fromisoformat(day_iso)
    except Exception:
        return {"ok": False, "error": "Fecha en formato YYYY-MM-DD",
                "writes_to_database": False}

    try:
        t = await _v2294_exact_measure(station, d, "temperature")
        h = await _v2294_exact_measure(station, d, "humidity")
        w = await _v2294_exact_measure(station, d, "wind_kmh")
        rain = await _v2294_rain_exact_24h(station, d)
        quality = _v2297_rain_quality(rain.get("points"))

        noon_ok = bool(t.get("ok") and h.get("ok") and w.get("ok"))
        return {
            "ok": noon_ok,
            "version": "V22.10.5.12 RESPALDO EUSKALMET FINAL",
            "writes_to_database": False,
            "station": station,
            "station_name": FIXED_STATIONS.get(station, station),
            "day": d.isoformat(),
            "criterion": {
                "temperature": "exacta 12:00",
                "humidity": "exacta 12:00",
                "wind": "exacta 12:00",
                "rain": "suma 10-min observada en (12:00 anterior, 12:00 actual]",
                "missing_rain": "no se rellena con 0 y no se interpola"
            },
            "inputs": {
                "temperature_c": t.get("selected_value"),
                "humidity_pct": h.get("selected_value"),
                "wind_kmh": w.get("selected_value"),
                "rain_24h_observed_mm": rain.get("rain_mm")
            },
            **quality,
            "noon_inputs_complete": noon_ok,
            "can_calculate_ire_gip": noon_ok,
            "interpretation":
                "La lluvia es la suma de las lecturas existentes. Los intervalos "
                "ausentes quedan contabilizados como huecos, no como lluvia cero."
        }
    except Exception as exc:
        return {
            "ok": False,
            "version": "V22.10.5.12 RESPALDO EUSKALMET FINAL",
            "writes_to_database": False,
            "station": station,
            "day": day_iso,
            "error_type": type(exc).__name__,
            "error": str(exc)
        }


@app.get('/debug/v2297/quality-policy')
async def debug_v2297_quality_policy():
    return {
        "ok": True,
        "version": "V22.10.5.12 RESPALDO EUSKALMET FINAL",
        "writes_to_database": False,
        "temperature": "exacta 12:00",
        "humidity": "exacta 12:00",
        "wind": "exacta 12:00",
        "rain": "suma 10-min observada de las 24 h previas hasta 12:00",
        "fill_missing_rain_with_zero": False,
        "interpolate_missing_rain": False,
        "report_missing_count": True,
        "labels": {
            "Completo": "144/144",
            "Hueco menor": "faltan 1-3",
            "Hueco relevante": "faltan 4-12",
            "Cobertura insuficiente": "faltan más de 12"
        }
    }


# ============================================================
# V22.10 — RECONSTRUCCIÓN SECUENCIAL CONTROLADA
#
# La reconstrucción usa exactamente el mismo motor operativo:
#   T/HR/viento exactos 12:00
#   lluvia observada 10-min de las 24 h previas
#
# Si falta T, HR o viento exacto de las 12:00, la cadena se DETIENE.
# No se inventa fallback y no se salta el día, porque FFMC/DMC/DC
# necesitan continuidad diaria.
# ============================================================

@app.get('/debug/v2210/rebuild/{station}/{date_from}/{date_to}')
async def debug_v2210_rebuild(station:str,date_from:str,date_to:str):
    """Vista previa secuencial V22.10. No escribe en SQLite."""
    station=station.upper()
    if station not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación no válida','writes_to_database':False}
    try:
        d0=date.fromisoformat(date_from)
        d1=date.fromisoformat(date_to)
    except Exception:
        return {'ok':False,'error':'Fechas YYYY-MM-DD','writes_to_database':False}
    if d1<d0:
        return {'ok':False,'error':'date_to anterior a date_from','writes_to_database':False}
    if (d1-d0).days+1>120:
        return {'ok':False,'error':'Máximo 120 días','writes_to_database':False}

    # Semilla inmediatamente anterior.
    with con() as c:
        seed=c.execute(
            """SELECT day,ffmc,dmc,dc
               FROM fwi_daily
               WHERE station_id=? AND day<?
               ORDER BY day DESC LIMIT 1""",
            (station,d0.isoformat())
        ).fetchone()

    if seed:
        pf,pd,pc=float(seed['ffmc']),float(seed['dmc']),float(seed['dc'])
        seed_info={'source':'stored_previous_day','day':seed['day'],
                   'ffmc':pf,'dmc':pd,'dc':pc}
    else:
        pf,pd,pc=map(float,INITIAL)
        seed_info={'source':'INITIAL','day':None,'ffmc':pf,'dmc':pd,'dc':pc}

    rows=[]
    failure=None
    cur=d0
    while cur<=d1:
        try:
            met=await v22105_weather_with_station_fallback(station,cur)
            res=calculate(
                met['temperature'],met['humidity'],met['wind_kmh'],met['rain_mm'],
                month=cur.month,prev_ffmc=pf,prev_dmc=pd,prev_dc=pc
            )
            season_name,sf=ire_gip_season(cur)
            wf=ire_gip_wind_factor(met['wind_direction_deg'],met['wind_kmh'])
            ire=min(100.0,max(0.0,float(res.fwi)*wf*sf))

            rows.append({
                'day':cur.isoformat(),
                'inputs':met,
                'inherited_state':{'ffmc':round(pf,4),'dmc':round(pd,4),'dc':round(pc,4)},
                'result':{
                    'ffmc':round(float(res.ffmc),4),
                    'dmc':round(float(res.dmc),4),
                    'dc':round(float(res.dc),4),
                    'isi':round(float(res.isi),4),
                    'bui':round(float(res.bui),4),
                    'fwi':round(float(res.fwi),4),
                    'fwi_level':v22_local_level(station,res.fwi),
                    'ire_gip':round(float(ire),4),
                    'ire_gip_level':v22_local_level(station,ire),
                }
            })
            pf,pd,pc=float(res.ffmc),float(res.dmc),float(res.dc)
        except Exception as exc:
            failure={
                'day':cur.isoformat(),
                'error_type':type(exc).__name__,
                'error':str(exc),
                'policy':'cadena detenida; no se usa fallback de hora ni se salta el día'
            }
            break
        cur+=timedelta(days=1)

    return {
        'ok':failure is None,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'writes_to_database':False,
        'station':station,
        'station_name':FIXED_STATIONS.get(station,station),
        'period':{'start':d0.isoformat(),'end':d1.isoformat(),
                  'days_requested':(d1-d0).days+1,'days_completed':len(rows)},
        'seed':seed_info,
        'rows':rows,
        'failure':failure
    }


@app.post('/admin/v2210/rebuild/{station}/{date_from}/{date_to}')
async def admin_v2210_rebuild(station:str,date_from:str,date_to:str):
    """Reconstrucción secuencial con escritura explícita."""
    if not V22_WRITE_ENABLED:
        return {
            'ok':False,
            'error':'Escritura desactivada. Define V22_WRITE_ENABLED=1.',
            'writes_to_database':False
        }

    station=station.upper()
    if station not in FIXED_STATION_IDS:
        return {'ok':False,'error':'Estación no válida','writes_to_database':False}
    try:
        d0=date.fromisoformat(date_from)
        d1=date.fromisoformat(date_to)
    except Exception:
        return {'ok':False,'error':'Fechas YYYY-MM-DD','writes_to_database':False}
    if d1<d0:
        return {'ok':False,'error':'date_to anterior a date_from','writes_to_database':False}
    if (d1-d0).days+1>120:
        return {'ok':False,'error':'Máximo 120 días','writes_to_database':False}

    written=[]
    cur=d0
    while cur<=d1:
        try:
            result=await update_day(station,cur)
            written.append(result)
        except Exception as exc:
            return {
                'ok':False,
                'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
                'writes_to_database':True,
                'station':station,
                'days_written':len(written),
                'written':written,
                'failure':{
                    'day':cur.isoformat(),
                    'error_type':type(exc).__name__,
                    'error':str(exc),
                    'policy':'se detiene antes de escribir el día fallido'
                }
            }
        cur+=timedelta(days=1)

    return {
        'ok':True,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'writes_to_database':True,
        'station':station,
        'days_written':len(written),
        'written':written
    }

@app.get('/health')
def health():
    return {
        'ok':True,
        'provider':PROVIDER,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL',
        'mode':'operational_1200_cache_full_euskalmet_network_backup',
        'write_enabled':V22_WRITE_ENABLED,
        'observation_hour':V22_NOON_HOUR,
        'noon_tolerance_min':V22101_FALLBACK_MIN,
        'fwi_base':'T/HR/viento 12:00 exactos; fallback ±30 min; si persiste el corte, primer dato posterior disponible; lluvia 10-min observada 24 h hasta 12:00',
        'levels':'station percentiles when configured',
    }

def scheduled():
    if not V22_WRITE_ENABLED:
        return
    async def go():
        for s in station_ids():
            try:
                await backfill(s,2)
            except Exception:
                pass
    asyncio.run(go())

scheduler=BackgroundScheduler(); scheduler.add_job(scheduled,'cron',hour=int(os.getenv('AUTO_UPDATE_HOUR','14')),minute=int(os.getenv('AUTO_UPDATE_MINUTE','30')),id='daily',replace_existing=True); scheduler.start()

# -----------------------------------------------------------------------------
# V22.10.5.12 - BUSCADOR INDEXADO EN ARCHIVO ANUAL
# Evita consultar la API día por día. Lee una vez el ZIP anual oficial y crea
# un índice de disponibilidad por estación/fecha. Sólo identifica sustituciones;
# no escribe en SQLite ni recalcula FWI.
# -----------------------------------------------------------------------------
_V221052_ARCHIVE_AVAIL_CACHE = {}

def _v221052_station_year_availability_sync(archive_path, station, year):
    key=(str(archive_path), str(station).upper(), int(year))
    cached=_V221052_ARCHIVE_AVAIL_CACHE.get(key)
    if cached is not None:
        return cached
    station=str(station).upper()
    out={}
    parse_meta={'station':station,'year':int(year),'xml_files':0,'day_nodes':0,'dated_nodes':0,'sample_dates':[],'date_strategy':'monthly_xml_year_month_plus_day_position'}
    with zipfile.ZipFile(archive_path) as outer:
        inner_name=_v221_station_inner_zip(outer,station)
        raw_inner=outer.read(inner_name)
        parse_meta['inner_zip']=inner_name
    with zipfile.ZipFile(io.BytesIO(raw_inner)) as inner:
        xml_names=[n for n in inner.namelist() if n.lower().endswith('.xml')]
        parse_meta['xml_files']=len(xml_names)
        for xml_name in xml_names:
            try:
                root=ET.fromstring(inner.read(xml_name))
            except Exception:
                continue
            # Do not assume exact case or namespace for dia/hora/Meteoros.
            day_nodes=[e for e in root.iter() if _v221052_local_tag(e) in ('dia','day')]
            parse_meta['day_nodes'] += len(day_nodes)

            # V22.10.5.12 FECHA RECONSTRUIDA:
            # algunos XML mensuales repiten/omiten la fecha completa en <dia>.
            # La fuente de verdad es: año+mes del nombre del XML + posición/día del nodo.
            base_xml=Path(str(xml_name)).name
            mm=re.search(r'(?:^|_)(\d{4})_(\d{1,2})(?:[^0-9]|$)',base_xml)
            xml_year=int(mm.group(1)) if mm else int(year)
            xml_month=int(mm.group(2)) if mm else None
            seen_xml_dates=set()

            for day_pos,dia in enumerate(day_nodes, start=1):
                # En los ZIP mensuales oficiales, la fuente más estable para la
                # fecha civil es el propio archivo mensual + la posición del nodo
                # <dia>. Algunos XML contienen atributos Dia inconsistentes o
                # repetidos en el primer registro del mes, lo que provocaba que
                # desapareciese exactamente un día por cada cambio de mes.
                #
                # Regla V22.10.5.12: si el nombre del XML identifica año/mes,
                # construir SIEMPRE YYYY-MM-DD con day_pos. Sólo recurrimos al
                # atributo Dia cuando no podemos determinar el mes del archivo.
                ds=None
                if xml_month is not None:
                    try:
                        ds=date(xml_year,xml_month,day_pos).isoformat()
                    except Exception:
                        ds=None
                if ds is None:
                    ds=_v221052_date_from_xml_day(xml_name,dia,int(year))

                if ds in seen_xml_dates:
                    # No debería ocurrir usando la posición mensual, pero dejamos
                    # el guardarraíl para archivos atípicos.
                    continue

                if not ds or not ds.startswith(f'{int(year):04d}-'):
                    continue
                seen_xml_dates.add(ds)
                parse_meta['dated_nodes'] += 1
                if len(parse_meta['sample_dates']) < 8 and ds not in parse_meta['sample_dates']:
                    parse_meta['sample_dates'].append(ds)
                flags=out.setdefault(ds, {'temperature':False,'humidity':False,'wind_kmh':False,'rain_mm':False,'points_after_1130':0,'rain_points':0})
                hour_nodes=[e for e in dia.iter() if e is not dia and _v221052_local_tag(e) in ('hora','hour')]
                for hora in hour_nodes:
                    # La precipitación es necesaria para el FWI, pero su ventana es de 24 h.
                    # Detectamos disponibilidad de precipitación en TODO el día, no sólo a mediodía.
                    if _v221052_meteo_value_any(hora,('precip','precipitacion','rain','rainfall')) is not None:
                        flags['rain_mm']=True
                        flags['rain_points'] += 1
                    raw_hs=_v221052_attr_ci(hora,'Hora','hour','time','hora_local','localtime')
                    hm=_v221052_parse_time_text(raw_hs)
                    if hm is None:
                        for ch in list(hora)[:10]:
                            if _v221052_local_tag(ch) in ('hora','hour','time','horalocal','localtime'):
                                hm=_v221052_parse_time_text(ch.text)
                                if hm: break
                    if hm is None:
                        continue
                    hh,mm=hm
                    if hh*60+mm < 11*60+30:
                        continue
                    # Search below the hour node; works with or without a Meteoros wrapper.
                    flags['points_after_1130'] += 1
                    if _v221052_meteo_value_any(hora,('temaire','temperatura','temperature','temp')) is not None:
                        flags['temperature']=True
                    if _v221052_meteo_value_any(hora,('humedad','humidity','hr')) is not None:
                        flags['humidity']=True
                    if _v221052_meteo_value_any(hora,('velmed','velocidadmedia','windspeed','wind')) is not None:
                        flags['wind_kmh']=True
    ordered_days=sorted(out)
    for ds,flags in out.items():
        # operational mantiene la semántica histórica T/HR/viento para no romper diagnósticos previos.
        flags['operational']=bool(flags['temperature'] and flags['humidity'] and flags['wind_kmh'])
        # Para usar una estación como RESPALDO del cálculo FWI exigimos además precipitación.
        # La lluvia 24 h necesita datos del día actual y del día civil anterior.
        try:
            prev_ds=(date.fromisoformat(ds)-timedelta(days=1)).isoformat()
        except Exception:
            prev_ds=None
        prev_flags=out.get(prev_ds) if prev_ds else None
        flags['rain_24h_ready']=bool(flags.get('rain_mm') and prev_flags and prev_flags.get('rain_mm'))
        flags['backup_eligible']=bool(flags['operational'] and flags['rain_24h_ready'])
        flags['missing_backup_fields']=[k for k in ('temperature','humidity','wind_kmh') if not flags.get(k)]
        if not flags.get('rain_mm'):
            flags['missing_backup_fields'].append('rain_mm_current_day')
        if not (prev_flags and prev_flags.get('rain_mm')):
            flags['missing_backup_fields'].append('rain_mm_previous_day')
    parse_meta['indexed_days']=len(out)
    parse_meta['operational_days']=sum(1 for f in out.values() if f.get('operational'))
    parse_meta['backup_eligible_days']=sum(1 for f in out.values() if f.get('backup_eligible'))
    parse_meta['index_gap_days']=max(0,parse_meta.get('dated_nodes',0)-len(out))
    # Preserve diagnostics without changing the public per-day schema.
    _V221052_ARCHIVE_AVAIL_CACHE[key]=out
    _V221052_ARCHIVE_AVAIL_CACHE[(key,'meta')]=parse_meta
    return out

_V221052_ARCHIVE_STATIONS_CACHE={}

def _v221052_archive_station_ids_sync(archive_path):
    key=str(archive_path)
    cached=_V221052_ARCHIVE_STATIONS_CACHE.get(key)
    if cached is not None:
        return cached
    found=set()
    with zipfile.ZipFile(archive_path) as outer:
        for n in outer.namelist():
            if not n.lower().endswith('.zip'):
                continue
            stem=Path(n).stem.upper()
            m=re.match(r'([A-Z]+\d+)(?:_|$)',stem)
            if m:
                found.add(m.group(1))
    out=sorted(found)
    _V221052_ARCHIVE_STATIONS_CACHE[key]=out
    return out

async def _v221052_archive_station_ids(year):
    archive=await _v221_download_year(int(year))
    return await asyncio.to_thread(_v221052_archive_station_ids_sync,archive)


async def _v221052_station_year_availability(station,year):
    archive=await _v221_download_year(int(year))
    return await asyncio.to_thread(_v221052_station_year_availability_sync,archive,station,int(year))

@app.get('/debug/v221052/archive-structure/{year}/{station}')
async def debug_v221052_archive_structure(year:int,station:str):
    """Inspect the real annual ZIP/inner-ZIP structure for one station."""
    station=str(station).upper().strip()
    try:
        archive=await _v221_download_year(int(year))
        with zipfile.ZipFile(archive) as outer:
            zip_names=[n for n in outer.namelist() if n.lower().endswith('.zip')]
            try:
                inner_name=_v221_station_inner_zip(outer,station)
            except Exception as exc:
                return {'ok':False,'year':year,'station':station,'archive':str(archive),
                        'outer_zip_count':len(zip_names),'outer_zip_sample':zip_names[:80],
                        'error_type':type(exc).__name__,'error':str(exc),'writes_to_database':False}
            raw=outer.read(inner_name)
        with zipfile.ZipFile(io.BytesIO(raw)) as inner:
            inner_names=inner.namelist()
            xml_names=[n for n in inner_names if n.lower().endswith('.xml')]
            xml_preview=[]
            for xml_name in xml_names[:3]:
                try:
                    root=ET.fromstring(inner.read(xml_name))
                    tags=[]
                    attrs=[]
                    for e in list(root.iter())[:120]:
                        t=_v221052_local_tag(e)
                        if t and t not in tags: tags.append(t)
                        if e.attrib and len(attrs)<20: attrs.append({str(k):str(v) for k,v in e.attrib.items()})
                    xml_preview.append({'xml':xml_name,'root_tag':_v221052_local_tag(root),'tags':tags[:50],'attrs':attrs[:20]})
                except Exception as exc:
                    xml_preview.append({'xml':xml_name,'error':f'{type(exc).__name__}: {exc}'})
        idx=await _v221052_station_year_availability(station,int(year))
        key=(str(archive),station,int(year))
        meta=_V221052_ARCHIVE_AVAIL_CACHE.get((key,'meta'),{})
        return {'ok':True,'writes_to_database':False,'year':year,'station':station,
                'archive':str(archive),'inner_zip':inner_name,'outer_zip_count':len(zip_names),
                'inner_entry_count':len(inner_names),'inner_entries_sample':inner_names[:50],
                'xml_count':len(xml_names),'xml_preview':xml_preview,'parser_meta':meta,
                'indexed_days':len(idx),'indexed_sample':list(idx.items())[:10]}
    except Exception as exc:
        return {'ok':False,'writes_to_database':False,'year':year,'station':station,
                'error_type':type(exc).__name__,'error':str(exc)}

@app.get('/debug/v221052/hour-sample/{year}/{station}')
async def debug_v221052_hour_sample(year:int,station:str):
    """Show one real Hora node around noon, including descendant attributes/text."""
    station=str(station).upper().strip()
    try:
        archive=await _v221_download_year(int(year))
        with zipfile.ZipFile(archive) as outer:
            inner_name=_v221_station_inner_zip(outer,station)
            raw=outer.read(inner_name)
        samples=[]
        with zipfile.ZipFile(io.BytesIO(raw)) as inner:
            for xml_name in [n for n in inner.namelist() if n.lower().endswith('.xml')]:
                root=ET.fromstring(inner.read(xml_name))
                for dia in [e for e in root.iter() if _v221052_local_tag(e) in ('dia','day')]:
                    ds=_v221052_date_from_xml_day(xml_name,dia,int(year))
                    for hora in [e for e in dia.iter() if e is not dia and _v221052_local_tag(e) in ('hora','hour')]:
                        hm=_v221052_parse_time_text(_v221052_attr_ci(hora,'Hora','hour','time','hora_local','localtime'))
                        if hm is None or not (11*60+30 <= hm[0]*60+hm[1] <= 12*60+30):
                            continue
                        descendants=[]
                        for e in list(hora.iter())[:60]:
                            descendants.append({
                                'tag':_v221052_local_tag(e),
                                'attrs':{str(k).split('}')[-1]:str(v) for k,v in getattr(e,'attrib',{}).items()},
                                'text':(e.text or '').strip()[:160]
                            })
                        samples.append({
                            'xml':xml_name,'day':ds,
                            'hour':f'{hm[0]:02d}:{hm[1]:02d}',
                            'temperature':_v221052_meteo_value_any(hora,('temaire','temperatura','temperature','temp')),
                            'humidity':_v221052_meteo_value_any(hora,('humedad','humidity','hr')),
                            'wind':_v221052_meteo_value_any(hora,('velmed','velocidadmedia','windspeed','wind')),
                            'descendants':descendants
                        })
                        if len(samples)>=3:
                            return {'ok':True,'writes_to_database':False,'year':year,'station':station,'inner_zip':inner_name,'samples':samples}
        return {'ok':True,'writes_to_database':False,'year':year,'station':station,'inner_zip':inner_name,'samples':samples,'note':'No se encontraron nodos Hora entre 11:30 y 12:30'}
    except Exception as exc:
        return {'ok':False,'writes_to_database':False,'year':year,'station':station,'error_type':type(exc).__name__,'error':str(exc)}

@app.get('/debug/v221052/find-substitutions-indexed/{start_iso}/{end_iso}')
async def debug_v221052_find_substitutions_indexed(start_iso:str,end_iso:str,max_days:int=366,stop_after:int=5):
    """Localiza sustituciones usando el archivo anual oficial como índice.

    V22.10.5.12 COBERTURA ARCHIVO CORREGIDA:
    - No confunde fechas todavía no publicadas en el ZIP anual con averías.
    - Un hueco sólo se considera real si cae DENTRO de la cobertura temporal
      realmente indexada para la estación objetivo.
    - Las candidatas se evalúan con la misma regla y devuelven diagnóstico de
      cobertura/variables para explicar por qué son o no utilizables.
    - No hace llamadas API por estación/día y no escribe en la base de datos.
    """
    try:
        start=date.fromisoformat(start_iso); end=date.fromisoformat(end_iso)
    except Exception:
        return {'ok':False,'error':'Fecha no válida. Usa YYYY-MM-DD.','writes_to_database':False}
    if start>end: start,end=end,start
    max_days=max(1,min(int(max_days),3660)); stop_after=max(1,min(int(stop_after),20))
    effective_start=max(start,end-timedelta(days=max_days-1))
    started=time.perf_counter()
    years=list(range(effective_start.year,end.year+1))

    target_indexes={}; index_errors=[]; archive_stations_by_year={}
    index_cache={}; coverage_cache={}

    def coverage_for(idx):
        if not idx:
            return {'min_day':None,'max_day':None,'indexed_days':0,'operational_days':0}
        days=sorted(idx.keys())
        return {
            'min_day':days[0],
            'max_day':days[-1],
            'indexed_days':len(days),
            'operational_days':sum(1 for f in idx.values() if f and f.get('operational')),
        }

    async def get_index(sid,year):
        key=(str(sid).upper(),int(year))
        if key not in index_cache:
            idx=await _v221052_station_year_availability(key[0],key[1])
            index_cache[key]=idx
            coverage_cache[key]=coverage_for(idx)
        return index_cache[key]

    for year in years:
        try:
            archive_stations_by_year[year]=set(await _v221052_archive_station_ids(year))
        except Exception as exc:
            archive_stations_by_year[year]=set()
            index_errors.append({'station':'*catalog*','year':year,'error_type':type(exc).__name__,'error':str(exc)})

    # 1) Indexar las cinco estaciones objetivo una vez por año/estación.
    for year in years:
        for sid in FIXED_STATION_IDS:
            try:
                target_indexes[(sid,year)]=await get_index(sid,year)
            except Exception as exc:
                index_errors.append({'station':sid,'year':year,'error_type':type(exc).__name__,'error':str(exc)})

    # 2) Detectar sólo huecos REALES dentro de la cobertura del archivo.
    #    Una fecha posterior al último día publicado NO es una avería.
    outage_candidates=[]
    outside_archive_coverage_count=0
    outside_archive_coverage_sample=[]
    d=end
    while d>=effective_start:
        ds=d.isoformat()
        for sid in FIXED_STATION_IDS:
            idx=target_indexes.get((sid,d.year))
            if idx is None:
                continue
            cov=coverage_cache.get((sid,d.year),coverage_for(idx))
            min_day=cov.get('min_day'); max_day=cov.get('max_day')
            if not min_day or not max_day or ds < min_day or ds > max_day:
                outside_archive_coverage_count += 1
                if len(outside_archive_coverage_sample)<20:
                    outside_archive_coverage_sample.append({
                        'target_station':sid,'target_name':FIXED_STATIONS[sid],'day':ds,
                        'coverage_min':min_day,'coverage_max':max_day,
                        'reason':'date_outside_annual_archive_coverage',
                    })
                continue
            flags=idx.get(ds)
            if not flags or not flags.get('operational'):
                outage_candidates.append({
                    'target_station':sid,'target_name':FIXED_STATIONS[sid],'day':ds,
                    'own_flags':flags,
                    'outage_reason':'missing_day_within_coverage' if flags is None else 'non_operational_day',
                    'target_coverage':cov,
                })
        d-=timedelta(days=1)

    # 3) Para huecos reales, buscar la estación más cercana operativa en ESA fecha.
    substitutions=[]; unresolved=[]; candidate_cache={}
    for outage in outage_candidates:
        if len(substitutions)>=stop_after:
            break
        sid=outage['target_station']; ds=outage['day']; year=int(ds[:4])
        try:
            candidates=candidate_cache.get(sid)
            if candidates is None:
                candidates=await _v221051_backup_candidates(sid)
                candidate_cache[sid]=candidates
            attempts=[]; chosen=None
            available_ids=archive_stations_by_year.get(year,set())
            for cand in candidates:
                csid=str(cand['station_id']).upper()
                base_attempt={'station':csid,'distance_km':cand['distance_km']}
                if available_ids and csid not in available_ids:
                    attempts.append({**base_attempt,'skipped':True,'reason':'station_not_in_annual_archive'})
                    continue
                try:
                    cidx=await get_index(csid,year)
                    ccov=coverage_cache.get((csid,year),coverage_for(cidx))
                    cmin=ccov.get('min_day'); cmax=ccov.get('max_day')
                    if not cmin or not cmax or ds < cmin or ds > cmax:
                        attempts.append({
                            **base_attempt,'operational':False,'reason':'date_outside_candidate_archive_coverage',
                            'coverage_min':cmin,'coverage_max':cmax,
                        })
                        continue
                    cflags=cidx.get(ds)
                    diag={
                        **base_attempt,
                        'day_found':cflags is not None,
                        'temperature':bool(cflags and cflags.get('temperature')),
                        'humidity':bool(cflags and cflags.get('humidity')),
                        'wind_kmh':bool(cflags and cflags.get('wind_kmh')),
                        'points_after_1130':(cflags or {}).get('points_after_1130',0),
                        'operational':bool(cflags and cflags.get('operational')),
                        'coverage_min':cmin,'coverage_max':cmax,
                    }
                    if diag['operational']:
                        chosen=(cand,cflags,ccov)
                        attempts.append(diag)
                        break
                    attempts.append(diag)
                except Exception as exc:
                    attempts.append({**base_attempt,'error':f'{type(exc).__name__}: {exc}'})
            if chosen:
                cand,cflags,ccov=chosen
                substitutions.append({
                    **outage,
                    'substitution_used':True,
                    'source_station':cand['station_id'],
                    'source_station_name':cand.get('station_name') or cand['station_id'],
                    'distance_km':cand['distance_km'],
                    'source_flags':cflags,
                    'source_coverage':ccov,
                    'attempts_before_choice':attempts,
                    'provenance':'índice del archivo anual oficial Euskalmet',
                })
            else:
                unresolved.append({**outage,'attempts':attempts})
        except Exception as exc:
            unresolved.append({**outage,'error_type':type(exc).__name__,'error':str(exc)})

    elapsed=round(time.perf_counter()-started,3)
    target_coverage={
        f'{sid}:{year}':coverage_cache.get((sid,year))
        for year in years for sid in FIXED_STATION_IDS
        if (sid,year) in coverage_cache
    }
    return {
        'ok':True,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL - FECHAS MENSUALES CORREGIDAS',
        'writes_to_database':False,
        'strategy':'ZIP anual oficial -> respetar cobertura publicada -> detectar huecos reales -> respaldo por índice',
        'requested_start':start.isoformat(),'requested_end':end.isoformat(),
        'effective_start':effective_start.isoformat(),'years':years,
        'target_station_year_indexes':len(target_indexes),
        'target_coverage':target_coverage,
        'archive_station_counts':{str(y):len(archive_stations_by_year.get(y,set())) for y in years},
        'index_error_count':len(index_errors),'index_errors':index_errors[:20],
        'outside_archive_coverage_count':outside_archive_coverage_count,
        'outside_archive_coverage_sample':outside_archive_coverage_sample,
        'outage_candidate_count':len(outage_candidates),
        'outage_candidates':outage_candidates[:100],
        'substitution_count':len(substitutions),
        'substitutions':substitutions[:stop_after],
        'unresolved_count':len(unresolved),
        'unresolved':unresolved[:20],
        'calculation_seconds':elapsed,
        'note':(
            'Las fechas posteriores al último día realmente publicado en el ZIP anual no se consideran averías. '
            'Una sustitución sólo se busca para huecos dentro de la cobertura temporal de la estación objetivo. '
            'Cada intento de estación candidata incluye day_found, T/HR/viento, puntos posteriores a 11:30 y cobertura.'
        ),
    }


# -----------------------------------------------------------------------------
# V22.10.5.12 - BUSCADOR DE HUECOS REALES EN TODA LA RED DEL ARCHIVO ANUAL
# Diagnóstico: localiza discontinuidades internas reales antes de probar respaldo.
# No escribe en SQLite ni recalcula FWI.
# -----------------------------------------------------------------------------

async def _v221052_catalog_candidates_for_any_station(target_station, year, day_iso, index_getter, archive_ids, limit=8):
    """Nearest archived stations with coordinates, evaluated on one indexed day."""
    target_station=str(target_station).upper().strip()
    catalog=await _v221051_station_catalog()
    cmap={str(x.get('station_id','')).upper():x for x in catalog if x.get('station_id')}
    target=cmap.get(target_station)
    if not target:
        return [], 'target_station_missing_from_catalog'
    try:
        tlat=float(target['lat']); tlon=float(target['lon'])
    except Exception:
        return [], 'target_station_without_coordinates'

    ranked=[]
    for sid in archive_ids:
        sid=str(sid).upper()
        if sid==target_station:
            continue
        st=cmap.get(sid)
        if not st:
            continue
        try:
            dist=_v22105_haversine_coords(tlat,tlon,float(st['lat']),float(st['lon']))
        except Exception:
            continue
        ranked.append((float(dist),sid,st))
    ranked.sort(key=lambda x:(x[0],x[1]))

    attempts=[]
    for dist,sid,st in ranked:
        try:
            idx=await index_getter(sid,year)
            flags=idx.get(day_iso)
            row={
                'station':sid,
                'station_name':st.get('station_name') or st.get('name') or sid,
                'distance_km':round(dist,2),
                'day_found':flags is not None,
                'temperature':bool(flags and flags.get('temperature')),
                'humidity':bool(flags and flags.get('humidity')),
                'wind_kmh':bool(flags and flags.get('wind_kmh')),
                'points_after_1130':(flags or {}).get('points_after_1130',0),
                'operational':bool(flags and flags.get('operational')),
            }
            attempts.append(row)
            if len([x for x in attempts if x.get('operational')])>=limit:
                break
            if len(attempts)>=max(limit*4,20):
                break
        except Exception as exc:
            attempts.append({'station':sid,'distance_km':round(dist,2),'operational':False,
                             'error':f'{type(exc).__name__}: {exc}'})
            if len(attempts)>=max(limit*4,20):
                break
    operational=[x for x in attempts if x.get('operational')][:limit]
    return operational, None


@app.get('/debug/v221052/find-real-archive-gaps/{year}')
async def debug_v221052_find_real_archive_gaps(year:int, stop_after:int=10, max_stations:int=200, nearest:int=5):
    """Find real internal meteorological gaps across all stations in an annual ZIP.

    A candidate gap must be strictly inside the station's indexed coverage and is
    classified using the previous/next day so archive boundaries are not confused
    with outages. For each gap it reports missing variables and the nearest
    operational alternatives on the same date.
    """
    year=int(year)
    stop_after=max(1,min(int(stop_after),50))
    max_stations=max(1,min(int(max_stations),500))
    nearest=max(1,min(int(nearest),10))
    started=time.perf_counter()

    try:
        archive_ids=list(await _v221052_archive_station_ids(year))[:max_stations]
    except Exception as exc:
        return {'ok':False,'writes_to_database':False,'year':year,
                'error_type':type(exc).__name__,'error':str(exc)}

    idx_cache={}
    async def get_idx(sid,yr):
        key=(str(sid).upper(),int(yr))
        if key not in idx_cache:
            idx_cache[key]=await _v221052_station_year_availability(key[0],key[1])
        return idx_cache[key]

    gaps=[]; station_errors=[]; scanned=0; fully_operational=0
    for sid in archive_ids:
        if len(gaps)>=stop_after:
            break
        scanned+=1
        try:
            idx=await get_idx(sid,year)
        except Exception as exc:
            station_errors.append({'station':sid,'error_type':type(exc).__name__,'error':str(exc)})
            continue
        if not idx:
            continue
        days=sorted(idx.keys())
        if len(days)<3:
            continue
        first=date.fromisoformat(days[0]); last=date.fromisoformat(days[-1])
        station_gap_found=False
        d=first+timedelta(days=1)
        while d<last and len(gaps)<stop_after:
            ds=d.isoformat(); flags=idx.get(ds)
            if flags and flags.get('operational'):
                d+=timedelta(days=1); continue
            prev_ds=(d-timedelta(days=1)).isoformat()
            next_ds=(d+timedelta(days=1)).isoformat()
            prev_flags=idx.get(prev_ds); next_flags=idx.get(next_ds)
            prev_ok=bool(prev_flags and prev_flags.get('operational'))
            next_ok=bool(next_flags and next_flags.get('operational'))
            # Prefer genuine internal discontinuities surrounded by valid days.
            # Keep non-isolated gaps too, but label them explicitly.
            missing=[]
            for k in ('temperature','humidity','wind_kmh'):
                if not (flags and flags.get(k)):
                    missing.append(k)
            kind='isolated_internal_gap' if prev_ok and next_ok else 'internal_gap_run'
            alternatives,alt_error=await _v221052_catalog_candidates_for_any_station(
                sid,year,ds,get_idx,set(archive_ids),limit=nearest
            )
            gaps.append({
                'station':sid,
                'day':ds,
                'gap_type':kind,
                'day_found':flags is not None,
                'previous_day_ok':prev_ok,
                'next_day_ok':next_ok,
                'missing_fields':missing,
                'own_flags':flags,
                'coverage_min':days[0],
                'coverage_max':days[-1],
                'nearest_operational_candidates':alternatives,
                'candidate_error':alt_error,
            })
            station_gap_found=True
            d+=timedelta(days=1)
        if not station_gap_found and all(bool(v and v.get('operational')) for v in idx.values()):
            fully_operational+=1

    isolated=sum(1 for g in gaps if g['gap_type']=='isolated_internal_gap')
    elapsed=round(time.perf_counter()-started,3)
    return {
        'ok':True,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL - BUSCADOR HUECOS REALES',
        'writes_to_database':False,
        'year':year,
        'archive_station_count':len(archive_ids),
        'stations_scanned':scanned,
        'fully_operational_stations_seen':fully_operational,
        'stop_after':stop_after,
        'gap_count':len(gaps),
        'isolated_gap_count':isolated,
        'gaps':gaps,
        'station_error_count':len(station_errors),
        'station_errors':station_errors[:20],
        'calculation_seconds':elapsed,
        'note':(
            'Sólo considera huecos estrictamente dentro de la cobertura indexada de cada estación. '
            'previous_day_ok/next_day_ok permiten distinguir una discontinuidad real de un tramo largo. '
            'Las candidatas se buscan únicamente entre estaciones presentes en el ZIP anual y operativas ese mismo día.'
        ),
    }


# -----------------------------------------------------------------------------
# V22.10.5.12 - EPISODIOS DE AVERÍA + RESPALDO ESTABLE CON VARIABLES COMPLETAS
# Agrupa huecos consecutivos y prioriza una misma estación de respaldo durante
# todo el episodio. Una candidata sólo es válida si dispone de T, HR, viento y
# lluvia suficiente para construir la ventana de precipitación de 24 h.
# -----------------------------------------------------------------------------

V221052_BACKUP_REQUIRED_FIELDS=('temperature','humidity','wind_kmh','rain_24h_ready')


def _v221052_backup_day_diagnostic(idx, day_iso):
    flags=idx.get(day_iso)
    if flags is None:
        return {
            'day_found':False,'temperature':False,'humidity':False,'wind_kmh':False,
            'rain_mm':False,'rain_24h_ready':False,'backup_eligible':False,
            'missing_required_fields':['day_not_found']
        }
    missing=[]
    for key in ('temperature','humidity','wind_kmh'):
        if not flags.get(key): missing.append(key)
    if not flags.get('rain_mm'): missing.append('rain_mm_current_day')
    if not flags.get('rain_24h_ready'): missing.append('rain_24h_window')
    return {
        'day_found':True,
        'temperature':bool(flags.get('temperature')),
        'humidity':bool(flags.get('humidity')),
        'wind_kmh':bool(flags.get('wind_kmh')),
        'rain_mm':bool(flags.get('rain_mm')),
        'rain_points':int(flags.get('rain_points') or 0),
        'rain_24h_ready':bool(flags.get('rain_24h_ready')),
        'points_after_1130':int(flags.get('points_after_1130') or 0),
        'operational':bool(flags.get('operational')),
        'backup_eligible':bool(flags.get('backup_eligible')),
        'missing_required_fields':missing,
    }


async def _v221052_rank_episode_backups(target_station, year, episode_days, index_getter, archive_ids, limit=5):
    """Rank candidates by continuity across the whole outage episode.

    Preferred candidate = nearest station with all required variables on every day.
    If none covers the whole run, rank by number/percentage of eligible days, then distance.
    """
    target_station=str(target_station).upper().strip()
    catalog=await _v221051_station_catalog()
    cmap={str(x.get('station_id','')).upper():x for x in catalog if x.get('station_id')}
    target=cmap.get(target_station)
    if not target:
        return [], 'target_station_missing_from_catalog'
    try:
        tlat=float(target['lat']); tlon=float(target['lon'])
    except Exception:
        return [], 'target_station_without_coordinates'

    ranked_geo=[]
    for sid in archive_ids:
        sid=str(sid).upper()
        if sid==target_station: continue
        st=cmap.get(sid)
        if not st: continue
        try:
            dist=_v22105_haversine_coords(tlat,tlon,float(st['lat']),float(st['lon']))
        except Exception:
            continue
        ranked_geo.append((float(dist),sid,st))
    ranked_geo.sort(key=lambda x:(x[0],x[1]))
    evaluated=[]
    for dist,sid,st in ranked_geo:
        try:
            idx=await index_getter(sid,year)
        except Exception as exc:
            evaluated.append({'station':sid,'station_name':st.get('station_name') or st.get('name') or sid,
                              'distance_km':round(dist,2),'eligible_days':0,'coverage_pct':0.0,
                              'full_episode_coverage':False,'error':f'{type(exc).__name__}: {exc}'})
            continue
        day_details=[]
        eligible=0
        for ds in episode_days:
            diag=_v221052_backup_day_diagnostic(idx,ds)
            diag['day']=ds
            day_details.append(diag)
            if diag.get('backup_eligible'): eligible+=1
        total=len(episode_days)
        coverage=round(100.0*eligible/total,1) if total else 0.0
        evaluated.append({
            'station':sid,
            'station_name':st.get('station_name') or st.get('name') or sid,
            'distance_km':round(dist,2),
            'eligible_days':eligible,
            'episode_days':total,
            'coverage_pct':coverage,
            'full_episode_coverage':bool(total and eligible==total),
            'required_variables':['temperature','humidity','wind_kmh','rain_mm_24h'],
            'day_details':day_details,
        })

    # Primero cobertura completa; después mayor cobertura parcial; luego proximidad.
    evaluated.sort(key=lambda r:(not r.get('full_episode_coverage'),-int(r.get('eligible_days') or 0),float(r.get('distance_km') or 1e9),r.get('station','')))
    return evaluated[:max(limit,1)], None


@app.get('/debug/v221052/find-real-outage-episodes/{year}')
async def debug_v221052_find_real_outage_episodes(year:int, stop_after:int=10, max_stations:int=200, nearest:int=5):
    """Agrupa huecos consecutivos y busca una estación de respaldo estable.

    Una estación de respaldo sólo se considera apta si dispone, ese día, de:
    temperatura, humedad, viento y precipitación suficiente para construir lluvia 24 h.
    La dirección del viento se mantiene como dato deseable pero no bloqueante, igual que en
    el cálculo operativo actual, que puede continuar con direction=None.
    """
    year=int(year)
    stop_after=max(1,min(int(stop_after),50))
    max_stations=max(1,min(int(max_stations),500))
    nearest=max(1,min(int(nearest),10))
    started=time.perf_counter()

    try:
        archive_ids=list(await _v221052_archive_station_ids(year))[:max_stations]
    except Exception as exc:
        return {'ok':False,'writes_to_database':False,'year':year,
                'error_type':type(exc).__name__,'error':str(exc)}

    idx_cache={}
    async def get_idx(sid,yr):
        key=(str(sid).upper(),int(yr))
        if key not in idx_cache:
            idx_cache[key]=await _v221052_station_year_availability(key[0],key[1])
        return idx_cache[key]

    episodes=[]; station_errors=[]; stations_scanned=0
    for sid in archive_ids:
        if len(episodes)>=stop_after: break
        stations_scanned+=1
        try:
            idx=await get_idx(sid,year)
        except Exception as exc:
            station_errors.append({'station':sid,'error_type':type(exc).__name__,'error':str(exc)})
            continue
        if not idx: continue
        days=sorted(idx.keys())
        if len(days)<3: continue
        first=date.fromisoformat(days[0]); last=date.fromisoformat(days[-1])

        # Hueco objetivo: falta T/HR/viento. La lluvia se usa para filtrar sustitutas,
        # porque una estación puede medir T/HR/viento pero no disponer de pluviómetro.
        gap_days=[]
        d=first+timedelta(days=1)
        while d<last:
            ds=d.isoformat(); f=idx.get(ds)
            if not (f and f.get('operational')):
                gap_days.append(ds)
            d+=timedelta(days=1)
        if not gap_days: continue

        # Agrupar fechas consecutivas en episodios.
        runs=[]; current=[]; prev=None
        for ds in gap_days:
            dd=date.fromisoformat(ds)
            if prev is None or dd==prev+timedelta(days=1):
                current.append(ds)
            else:
                if current: runs.append(current)
                current=[ds]
            prev=dd
        if current: runs.append(current)

        for run in runs:
            if len(episodes)>=stop_after: break
            start_ds,end_ds=run[0],run[-1]
            prev_ds=(date.fromisoformat(start_ds)-timedelta(days=1)).isoformat()
            next_ds=(date.fromisoformat(end_ds)+timedelta(days=1)).isoformat()
            prev_ok=bool(idx.get(prev_ds) and idx[prev_ds].get('operational'))
            next_ok=bool(idx.get(next_ds) and idx[next_ds].get('operational'))

            missing_union=set()
            own_day_details=[]
            for ds in run:
                f=idx.get(ds)
                missing=[k for k in ('temperature','humidity','wind_kmh') if not (f and f.get(k))]
                missing_union.update(missing)
                own_day_details.append({'day':ds,'day_found':f is not None,'missing_fields':missing,'own_flags':f})

            backups,err=await _v221052_rank_episode_backups(sid,year,run,get_idx,set(archive_ids),limit=nearest)
            stable=next((b for b in backups if b.get('full_episode_coverage')),None)
            episodes.append({
                'station':sid,
                'start_day':start_ds,
                'end_day':end_ds,
                'duration_days':len(run),
                'previous_day_ok':prev_ok,
                'next_day_ok':next_ok,
                'episode_type':'isolated_gap' if len(run)==1 and prev_ok and next_ok else 'continuous_outage_run',
                'missing_fields':sorted(missing_union),
                'required_backup_variables':['temperature','humidity','wind_kmh','rain_mm_24h'],
                'own_day_details':own_day_details,
                'preferred_stable_backup':stable,
                'backup_candidates':backups,
                'candidate_error':err,
                'fallback_policy':(
                    'Mantener la misma sustituta durante todo el episodio si cubre todas las variables requeridas. '
                    'Si falla un día concreto, usar la siguiente candidata elegible de ese día.'
                ),
            })

    elapsed=round(time.perf_counter()-started,3)
    stable_count=sum(1 for e in episodes if e.get('preferred_stable_backup'))
    return {
        'ok':True,
        'version':'V22.10.5.12 RESPALDO EUSKALMET FINAL - SUSTITUCIÓN ESTACIÓN COMPLETA + AVISO WEB',
        'writes_to_database':False,
        'year':year,
        'archive_station_count':len(archive_ids),
        'stations_scanned':stations_scanned,
        'episode_count':len(episodes),
        'episodes_with_stable_backup':stable_count,
        'stop_after':stop_after,
        'required_backup_variables':['temperature','humidity','wind_kmh','rain_mm_24h'],
        'wind_direction_required':False,
        'episodes':episodes,
        'station_error_count':len(station_errors),
        'station_errors':station_errors[:20],
        'calculation_seconds':elapsed,
        'note':(
            'No basta con que una estación tenga T/HR/viento: para ser sustituta se exige también '
            'precipitación utilizable en la ventana de 24 h. Los huecos consecutivos se agrupan en episodios '
            'y se prioriza una sustituta estable para todo el tramo.'
        ),
    }


@app.get('/debug/v221052/history-db-performance')
async def debug_v221052_history_db_performance():
    """Mide cobertura y velocidad de lectura SQL de las cinco estaciones."""
    result=[]
    with con() as c:
        for sid in FIXED_STATION_IDS:
            t0=time.perf_counter()
            row=c.execute(
                """SELECT MIN(day) min_day,MAX(day) max_day,COUNT(*) n,
                          SUM(CASE WHEN station_fallback_used=1 THEN 1 ELSE 0 END) fallback_days
                   FROM weather_daily WHERE station_id=?""",(sid,)
            ).fetchone()
            ms=round((time.perf_counter()-t0)*1000,2)
            result.append({'station_id':sid,'name':FIXED_STATIONS[sid],**dict(row),'query_ms':ms})
    return {'ok':True,'version':'V22.10.5.12 HISTÓRICO DB RÁPIDO','stations':result,'writes_to_database':False}

# ============================================================
# V22.10.5.12 - CONSTRUCTOR HISTÓRICO 2010-2025
# - usa el motor local rápido de ZIP anual
# - sustitución de estación completa, nunca mezcla variables
# - propaga FFMC/DMC/DC cronológicamente
# - escritura por lotes/transacción SQLite
# - trabajo en segundo plano + estado consultable
# ============================================================
V22_HISTORY_WRITE_ENABLED=os.getenv('V22_HISTORY_WRITE_ENABLED','0').strip().lower() in ('1','true','yes','on')
_V22_HISTORY_JOB={
    'running':False,'started_at':None,'finished_at':None,'station':None,'day':None,
    'rows_written':0,'failures':[],'start_year':None,'end_year':None,'message':'sin iniciar'
}

def _v221052_history_seed(station, start_day):
    with con() as c:
        row=c.execute(
            "SELECT day,ffmc,dmc,dc FROM fwi_daily WHERE station_id=? AND day<? ORDER BY day DESC LIMIT 1",
            (station,start_day.isoformat())
        ).fetchone()
    if row:
        return float(row['ffmc']),float(row['dmc']),float(row['dc']),row['day']
    return float(INITIAL[0]),float(INITIAL[1]),float(INITIAL[2]),None

def _v221052_history_write_batch(weather_rows, fwi_rows):
    if not weather_rows: return
    with con() as c:
        c.executemany("""
        INSERT INTO weather_daily(
          station_id,day,temperature,humidity,wind_kmh,rain_mm,source,created_at,
          observation_time,rain_points_present,rain_points_missing,rain_coverage_pct,
          rain_quality,data_quality,temperature_time,humidity_time,wind_time,
          temperature_delta_min,humidity_delta_min,wind_delta_min,noon_fallback_used,
          meteo_source_station,station_fallback_used,station_fallback_distance_km
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(station_id,day) DO UPDATE SET
          temperature=excluded.temperature,humidity=excluded.humidity,wind_kmh=excluded.wind_kmh,
          rain_mm=excluded.rain_mm,source=excluded.source,created_at=excluded.created_at,
          observation_time=excluded.observation_time,rain_points_present=excluded.rain_points_present,
          rain_points_missing=excluded.rain_points_missing,rain_coverage_pct=excluded.rain_coverage_pct,
          rain_quality=excluded.rain_quality,data_quality=excluded.data_quality,
          temperature_time=excluded.temperature_time,humidity_time=excluded.humidity_time,
          wind_time=excluded.wind_time,temperature_delta_min=excluded.temperature_delta_min,
          humidity_delta_min=excluded.humidity_delta_min,wind_delta_min=excluded.wind_delta_min,
          noon_fallback_used=excluded.noon_fallback_used,meteo_source_station=excluded.meteo_source_station,
          station_fallback_used=excluded.station_fallback_used,
          station_fallback_distance_km=excluded.station_fallback_distance_km
        """, weather_rows)
        c.executemany("""
        INSERT INTO fwi_daily(
          station_id,day,ffmc,dmc,dc,isi,bui,fwi,danger_level,ire_gip,ire_gip_level,
          wind_direction_deg,wind_factor,season_factor,created_at,wind_direction_cardinal,
          season_name,data_quality,rain_quality,rain_points_present,rain_points_missing,
          rain_coverage_pct,noon_fallback_used,temperature_time,humidity_time,wind_time
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(station_id,day) DO UPDATE SET
          ffmc=excluded.ffmc,dmc=excluded.dmc,dc=excluded.dc,isi=excluded.isi,bui=excluded.bui,
          fwi=excluded.fwi,danger_level=excluded.danger_level,ire_gip=excluded.ire_gip,
          ire_gip_level=excluded.ire_gip_level,wind_direction_deg=excluded.wind_direction_deg,
          wind_factor=excluded.wind_factor,season_factor=excluded.season_factor,
          created_at=excluded.created_at,wind_direction_cardinal=excluded.wind_direction_cardinal,
          season_name=excluded.season_name,data_quality=excluded.data_quality,
          rain_quality=excluded.rain_quality,rain_points_present=excluded.rain_points_present,
          rain_points_missing=excluded.rain_points_missing,rain_coverage_pct=excluded.rain_coverage_pct,
          noon_fallback_used=excluded.noon_fallback_used,temperature_time=excluded.temperature_time,
          humidity_time=excluded.humidity_time,wind_time=excluded.wind_time
        """, fwi_rows)
        c.commit()

async def _v221052_build_history_job(start_year:int,end_year:int,replace:bool=False):
    global _V22_HISTORY_JOB
    _V22_HISTORY_JOB.update({
        'running':True,'started_at':datetime.now().isoformat(timespec='seconds'),'finished_at':None,
        'station':None,'day':None,'rows_written':0,'failures':[],
        'start_year':start_year,'end_year':end_year,'message':'construyendo histórico'
    })
    try:
        start_day=date(start_year,1,1); end_day=date(end_year,12,31)
        for sid in FIXED_STATION_IDS:
            pf,pd,pc,seed_day=_v221052_history_seed(sid,start_day)
            weather_batch=[]; fwi_batch=[]
            cur=start_day
            while cur<=end_day:
                _V22_HISTORY_JOB['station']=sid; _V22_HISTORY_JOB['day']=cur.isoformat()
                # Reanudación: si ya existe el día y no se fuerza reemplazo, usamos su estado
                # como memoria y evitamos recalcularlo.
                if not replace:
                    with con() as c:
                        existing=c.execute(
                            "SELECT ffmc,dmc,dc FROM fwi_daily WHERE station_id=? AND day=?",
                            (sid,cur.isoformat())
                        ).fetchone()
                    if existing:
                        pf,pd,pc=float(existing['ffmc']),float(existing['dmc']),float(existing['dc'])
                        cur+=timedelta(days=1); continue
                try:
                    met=await v22105_weather_with_station_fallback(sid,cur)
                    vals=(float(met['temperature']),float(met['humidity']),float(met['wind_kmh']),float(met['rain_mm']))
                    direction=met.get('wind_direction_deg')
                    res=calculate(*vals,month=cur.month,prev_ffmc=pf,prev_dmc=pd,prev_dc=pc)
                    season_name,sf=ire_gip_season(cur)
                    wf=ire_gip_wind_factor(direction,vals[2])
                    ire=min(100.0,max(0.0,float(res.fwi)*wf*sf))
                    now=datetime.now().isoformat(timespec='seconds')
                    weather_batch.append((
                        sid,cur.isoformat(),*vals,met.get('source'),now,met.get('observation_time','12:00'),
                        met.get('rain_points_present'),met.get('rain_points_missing'),met.get('rain_coverage_pct'),
                        met.get('rain_quality'),met.get('data_quality'),met.get('temperature_time'),
                        met.get('humidity_time'),met.get('wind_time'),met.get('temperature_delta_min'),
                        met.get('humidity_delta_min'),met.get('wind_delta_min'),1 if met.get('noon_fallback_used') else 0,
                        met.get('meteo_source_station',sid),1 if met.get('station_fallback_used') else 0,
                        met.get('station_fallback_distance_km',0.0)
                    ))
                    fwi_batch.append((
                        sid,cur.isoformat(),res.ffmc,res.dmc,res.dc,res.isi,res.bui,res.fwi,
                        v22_local_level(sid,res.fwi),round(ire,2),v22_local_level(sid,ire),
                        round(direction,1) if direction is not None else None,round(wf,3),round(sf,3),now,
                        wind_cardinal(direction),season_name,met.get('data_quality'),met.get('rain_quality'),
                        met.get('rain_points_present'),met.get('rain_points_missing'),met.get('rain_coverage_pct'),
                        1 if met.get('noon_fallback_used') else 0,met.get('temperature_time'),
                        met.get('humidity_time'),met.get('wind_time')
                    ))
                    pf,pd,pc=float(res.ffmc),float(res.dmc),float(res.dc)
                    if len(weather_batch)>=100:
                        await asyncio.to_thread(_v221052_history_write_batch,weather_batch,fwi_batch)
                        _V22_HISTORY_JOB['rows_written']+=len(weather_batch)
                        weather_batch=[]; fwi_batch=[]
                except Exception as exc:
                    # No inventamos estado FFMC/DMC/DC. Un hueco no resoluble corta esta estación
                    # para preservar la continuidad matemática; queda registrado para diagnóstico.
                    _V22_HISTORY_JOB['failures'].append({
                        'station':sid,'day':cur.isoformat(),'error_type':type(exc).__name__,'error':str(exc)
                    })
                    if weather_batch:
                        await asyncio.to_thread(_v221052_history_write_batch,weather_batch,fwi_batch)
                        _V22_HISTORY_JOB['rows_written']+=len(weather_batch)
                    weather_batch=[]; fwi_batch=[]
                    break
                cur+=timedelta(days=1)
            if weather_batch:
                await asyncio.to_thread(_v221052_history_write_batch,weather_batch,fwi_batch)
                _V22_HISTORY_JOB['rows_written']+=len(weather_batch)
        _V22_HISTORY_JOB['message']='histórico finalizado' if not _V22_HISTORY_JOB['failures'] else 'finalizado con incidencias'
    except Exception as exc:
        _V22_HISTORY_JOB['failures'].append({'fatal':True,'error_type':type(exc).__name__,'error':str(exc)})
        _V22_HISTORY_JOB['message']='error fatal'
    finally:
        _V22_HISTORY_JOB['running']=False
        _V22_HISTORY_JOB['finished_at']=datetime.now().isoformat(timespec='seconds')

@app.get('/admin/v221052/history-build/start')
async def admin_v221052_history_build_start(start_year:int=2010,end_year:int=2025,replace:bool=False):
    if not V22_HISTORY_WRITE_ENABLED:
        return {
            'ok':False,'error':'Escritura histórica desactivada',
            'how_to_enable':'Define V22_HISTORY_WRITE_ENABLED=1 y reinicia Uvicorn.',
            'writes_to_database':False
        }
    if _V22_HISTORY_JOB.get('running'):
        return {'ok':False,'error':'Ya hay una construcción histórica en curso','status':dict(_V22_HISTORY_JOB)}
    if start_year<2000 or end_year>date.today().year or end_year<start_year:
        return {'ok':False,'error':'Rango de años no válido'}
    asyncio.create_task(_v221052_build_history_job(start_year,end_year,replace))
    return {
        'ok':True,'started':True,'period':[start_year,end_year],'replace':replace,
        'status_url':'/admin/v221052/history-build/status',
        'note':'El proceso continúa en segundo plano. La navegación web puede seguir usándose.'
    }

@app.get('/admin/v221052/history-build/status')
async def admin_v221052_history_build_status():
    return {'ok':True,**dict(_V22_HISTORY_JOB),'writes_to_database':bool(V22_HISTORY_WRITE_ENABLED)}

@app.get('/admin/v221052/history-build/coverage')
async def admin_v221052_history_build_coverage():
    with con() as c:
        rows=c.execute("""
          SELECT f.station_id, MIN(f.day) AS min_day, MAX(f.day) AS max_day,
                 COUNT(*) AS fwi_days,
                 SUM(CASE WHEN w.station_fallback_used=1 THEN 1 ELSE 0 END) AS fallback_days
          FROM fwi_daily f LEFT JOIN weather_daily w
            ON w.station_id=f.station_id AND w.day=f.day
          WHERE f.station_id IN ('C023','C017','C058','C026','C028')
          GROUP BY f.station_id ORDER BY f.station_id
        """).fetchall()
    return {'ok':True,'coverage':[dict(r) for r in rows]}


# ============================================================
# BASUGIX V22.10.5.12 — ARRANQUE DIRECTO CON "py archivo.py"
# ============================================================
if __name__ == "__main__":
    print("IRE-GIP / BASUGIX — servidor iniciándose...")
    print("Abre: http://127.0.0.1:8000")
    print("Pulsa Ctrl+C para detener el servidor.")
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
    )