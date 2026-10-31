# Terrain and fuel landscape preparation

This utility prepares aligned terrain/fuel rasters for subsequent review and model-specific packaging.

## Inputs
Required:
- DEM GeoTIFF with CRS and elevation in metres.
- Fire behaviour fuel model raster with integer model codes (0–255).
- Canopy cover raster in percent (0–100).

Optional crown-fuel group (provide all three or none):
- Canopy/stand height in metres.
- Canopy base height in metres.
- Canopy bulk density in kg/m³.

## Run

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r wildfire/terrain/requirements.txt
python wildfire/terrain/prepare_landscape.py \
  --dem data/dem.tif \
  --fuel-model data/fuel_model.tif \
  --canopy-cover data/canopy_cover.tif \
  --output build/landscape
```

For Euskadi, the default target CRS is EPSG:25830 (ETRS89 / UTM zone 30N), with a 10 m target cell size. Override `--crs` and `--resolution` for other territories or justified analysis scales.

## Outputs
- One aligned GeoTIFF per layer.
- `wildfire_landscape.tif`: multiband landscape stack in this order: elevation, slope, aspect, fuel model, canopy cover; optional canopy height, canopy base height, canopy bulk density.
- `landscape_manifest.json`: CRS, grid geometry, sources, source resolutions, resampling methods and warnings.

The stack uses the conventional landscape encodings documented for FlamMap (including height ×10 and canopy bulk density ×100). Confirm exact compatibility against the installed FlamMap/FARSITE version and its import workflow before operational use.

## Quality controls and limitations
- All layers are reprojected onto the same snapped metric grid.
- Categorical fuel codes use nearest-neighbour resampling; continuous layers use bilinear resampling.
- Slope/aspect are derived from the DEM using a central-difference gradient.
- Basic value ranges and missing-data conditions are checked.
- If source resolution is coarser than the requested grid, a warning is emitted. Resampling does not increase source information.
- Fuel code taxonomy, vegetation classification, canopy data, fuel moisture and meteorological observations require domain review and provenance.
- This tool does not create a validated LCP, does not launch FlamMap/FARSITE and does not predict fire spread.
- No synthetic fuel or canopy data are generated for missing cells.
