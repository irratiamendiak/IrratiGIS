CREATE TABLE IF NOT EXISTS burn_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_date TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  burn_key TEXT NOT NULL,
  anyo INTEGER,
  codigo TEXT,
  codigo_tipo TEXT,
  numero_autorizacion TEXT,
  titular TEXT,
  municipio TEXT,
  fecha_inicio TEXT,
  fecha_fin TEXT,
  estado TEXT,
  latitud REAL,
  longitud REAL,
  tipo_quema TEXT,
  superficie REAL,
  codigo_sigpac TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE(observed_date, burn_key)
);

CREATE INDEX IF NOT EXISTS idx_burn_observations_date
  ON burn_observations(observed_date);

CREATE INDEX IF NOT EXISTS idx_burn_observations_coords
  ON burn_observations(latitud, longitud);

CREATE TABLE IF NOT EXISTS burn_daily_runs (
  observed_date TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  burn_count INTEGER NOT NULL DEFAULT 0
);
