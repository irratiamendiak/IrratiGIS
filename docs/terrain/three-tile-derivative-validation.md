# Terrain derivatives — three-tile pilot validation

**Status:** processing pipeline passed on a limited sample. This is not a province-wide terrain dataset.

## Run and source

- GitHub Actions run: [41169901203](https://github.com/irratiamendiak/IrratiGIS/actions/runs/41169901203)
- Artifact: `gipuzkoa-mdt-relief-preview` (28,449,686 bytes; 27.1 MB as displayed by GitHub)
- Artifact SHA-256: `884b984757200d52091ca75902d38619a79ddf875fe0f143f681a5d2a4967b3a`
- Sample: three selected MDT LiDAR 2017 tiles, clipped to the pilot boundary.
- CRS: EPSG:25830; cell size: 1 m; output extent: 10,210 × 7,190 cells.
- Derivatives: Horn 3×3; slope in degrees; aspect clockwise from north, with -1 for flat cells; hillshade with azimuth 315° and altitude 45°.

## Results

| Metric | Result |
|---|---:|
| Valid DEM cells | 2,972,807 |
| Cells with valid 3×3 derivative neighbourhood | 2,948,834 |
| Valid DEM cells withheld from derivatives due to edge/NoData neighbours | 23,973 |
| Mean slope | 28.5863° |
| Slope range | 0–86.9509° |
| Flat cells (aspect marked -1) | 70,932 |

The quality mask uses 0 for DEM NoData, 1 for cells with computed derivatives, and 2 for valid elevation cells where the 3×3 neighbourhood is incomplete. No missing elevation values are interpolated.

## Outputs in the run artifact

- `mdt_relief_preview/gipuzkoa_mdt_relief_preview_3_tiles.tif`
- `mdt_relief_preview/gipuzkoa_mdt_relief_preview_3_tiles.png`
- `terrain_derivatives/slope_degrees.tif`
- `terrain_derivatives/aspect_degrees.tif`
- `terrain_derivatives/hillshade.tif`
- `terrain_derivatives/terrain_quality_mask.tif`
- `terrain_derivatives/terrain_derivatives_report.json`

## Interpretation and next gate

This confirms that the derivative script and workflow complete for the sampled area. It does **not** establish complete Gipuzkoa coverage, source vertical accuracy, or fire-model validity.

Before province-wide processing, perform a unique-cell coverage/NoData audit and a tile-boundary seam check. Then process the 304 selected source sheets in controlled batches, retaining source IDs, checksums, CRS, NoData and quality summaries. Keep native source resolution and do not infer 1 m positional or vertical accuracy from pixel size alone.
