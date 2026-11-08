# Provincial MDT in Suteen Bilakaera

## Purpose

The wildfire terrain loader can read the Gipuzkoa LiDAR 2017 DEM from a public Cloud Optimized GeoTIFF (COG) using HTTP byte-range requests. It transforms WGS84 ignition/trajectory coordinates to EPSG:25830 and samples elevation from a regional raster window.

The simulation currently samples terrain at roughly the scale of its previous Terrarium z13 source (~14 m). The reader therefore selects the COG overview closest to 14 m when overviews are available. This is an intentional first integration step: it changes the elevation source without pretending that the existing simplified spread model has become a 1 m-resolution model. The 1 m source remains preserved and can support a later higher-resolution terrain workflow.

## Publish/configure the source

1. Publish `gipuzkoa_mdt_lidar_2017_1m.tif` as a COG in object storage (Cloudflare R2 is the intended destination).
2. Enable HTTPS public read access, CORS for the IrratiGIS Pages origin, and HTTP Range requests (`Accept-Ranges: bytes` / valid `206 Partial Content` responses).
3. Build internal overviews suitable for regional sampling (for example 8, 16 and 32 m). Keep the original 1 m base resolution intact.
4. Set `window.IRRATIGIS_MDT_COG_URL` in `wildfire/terrain-config.js` to the public HTTPS COG URL.
5. Set `window.IRRATIGIS_MDT_TARGET_RESOLUTION_M` to the desired overview resolution; default is 14 m.

Do not put credentials or signed secrets in this public configuration file. The COG URL must be public-read or served through a separate authenticated proxy. The GitHub Actions artifact URL is not a permanent public raster endpoint and must not be used as the visor source.

## Runtime behaviour

- If the COG URL is empty, the existing Terrarium elevation source remains active.
- If the COG cannot be opened, the simulation falls back to Terrarium and reports the failure in the terrain details.
- When loaded, the reader preloads a local projected window for the incident area and samples it in EPSG:25830.
- NoData or locations outside the loaded COG window fall back to Terrarium for continuity; the panel explicitly labels this as a fallback. This means the effective terrain source can be mixed and must be checked before interpreting a scenario.
- The panel reports the COG overview resolution actually selected.
- The provider does not alter fuel classification, weather inputs, or the simplified spread equations.

## Important limitation

This first connection does **not** yet make the simulation a 1 m terrain solver. It uses a COG overview close to the former ~14 m Terrarium scale so that the current browser simulation remains tractable. Nor does it validate the Rothermel-like model. The COG must be published and configured before the visor can actually read the provincial MDT; until then, the simulation correctly remains on Terrarium.
