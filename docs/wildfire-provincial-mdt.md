# Provincial MDT in Suteen Bilakaera

## Purpose

The wildfire terrain loader can read the Gipuzkoa LiDAR 2017 DEM from a public Cloud Optimized GeoTIFF (COG) using HTTP byte-range requests. It transforms WGS84 coordinates to EPSG:25830 and samples elevation from a regional raster window.

The current browser simulation samples terrain at approximately the scale of its former Terrarium z13 source (~14 m). The reader therefore selects the COG overview closest to 14 m when overviews are available. This first integration changes the elevation source without claiming that the existing simplified spread model has become a 1 m-resolution model. The original 1 m source remains preserved for later higher-resolution workflows.

## Publish and configure

1. Publish `gipuzkoa_mdt_lidar_2017_1m.tif` as a COG in object storage (Cloudflare R2 is the intended destination).
2. Enable HTTPS public read access, CORS for the IrratiGIS Pages origin, and HTTP Range requests (valid `206 Partial Content` responses).
3. Build internal overviews suitable for regional sampling (for example 8, 16 and 32 m), preserving the original 1 m base resolution.
4. Set `window.IRRATIGIS_MDT_COG_URL` in `wildfire/terrain-config.js` to the public HTTPS COG URL.
5. Set `window.IRRATIGIS_MDT_TARGET_RESOLUTION_M` to the desired overview resolution; default is 14 m.

Do not put credentials or signed secrets in this public configuration file. The GitHub Actions artifact URL is not a permanent public raster endpoint and must not be used as the visor source.

## Runtime behaviour

- Empty URL: existing Terrarium source remains active.
- COG open failure: simulation falls back to Terrarium and reports the failure in terrain details.
- Successful load: the reader preloads a projected window around the incident and samples in EPSG:25830.
- NoData or locations outside the loaded COG window fall back to Terrarium for continuity; the panel labels this fallback. Effective terrain can therefore be mixed.
- The panel reports the overview resolution actually selected.
- Fuel classification, weather inputs and simplified spread equations are unchanged.

## Limitation

This does not yet make the simulation a 1 m terrain solver. It uses an overview close to the previous ~14 m Terrarium scale so the browser simulation remains tractable. The COG must be published and configured before the visor can read the provincial MDT; until then it remains on Terrarium. This does not validate the Rothermel-like model.
