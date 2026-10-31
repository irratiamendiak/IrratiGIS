"""Fetch bounded WCS tiles intersecting the prepared Gipuzkoa boundary.

This is a controlled ingestion utility, not a province-wide run. It requests
intersecting grid windows, clips each raster to the actual AOI geometry,
and writes a manifest for every requested tile. No-data assessment is left
explicit in the manifest for downstream QA.
"""
from __future__ import annotations

import argparse
import json
import math
import numpy as np
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import rasterio
from rasterio.io import MemoryFile
from rasterio.mask import mask
from shapely.geometry import box, mapping
from shapely.ops import unary_union

WCS_URL = (
    "https://www.geo.euskadi.eus/geoeuskadi/services/U11/"
    "WCS_KARTOGRAFIA/MapServer/WCSServer"
)
COVERAGE = "MDT_LIDAR_2017_1M"
CRS = "EPSG:25830"


def iter_windows(bounds: tuple[float, float, float, float], size: int):
    minx, miny, maxx, maxy = bounds
    x = math.floor(minx / size) * size
    while x < maxx:
        y = math.floor(miny / size) * size
        while y < maxy:
            yield box(x, y, x + size, y + size)
            y += size
        x += size


def request_geotiff(bounds: tuple[float, float, float, float], timeout: int) -> bytes:
    params = {
        "service": "WCS", "version": "1.0.0", "request": "GetCoverage",
        "coverage": COVERAGE, "CRS": CRS,
        "BBOX": ",".join(f"{v:.3f}" for v in bounds),
        "resX": "1", "resY": "1", "format": "GeoTIFF",
    }
    url = WCS_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "IrratiGIS-WCS-AOI/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        payload = response.read()
    if payload[:2] not in (b"II", b"MM"):
        raise ValueError("WCS response is not a TIFF (possible service exception)")
    return payload


def run(boundary_path: Path, output: Path, tile_size: int, max_tiles: int,
        timeout: int) -> dict:
    if tile_size <= 0 or max_tiles <= 0:
        raise ValueError("tile-size and max-tiles must be positive")
    boundary = gpd.read_file(boundary_path, layer="pilot_boundary")
    if boundary.empty or boundary.geometry.isna().any() or boundary.geometry.is_empty.any():
        raise ValueError("pilot_boundary layer is empty or has invalid null geometries")
    if boundary.crs is None:
        raise ValueError("Boundary has no CRS")
    boundary = boundary.to_crs(CRS)
    geom = unary_union(list(boundary.geometry))
    candidates = [tile for tile in iter_windows(geom.bounds, tile_size) if tile.intersects(geom)]
    if len(candidates) > max_tiles:
        raise ValueError(
            f"AOI intersects {len(candidates)} tiles, exceeding --max-tiles={max_tiles}; "
            "reduce tile size or explicitly raise the safety limit"
        )

    output.mkdir(parents=True, exist_ok=True)
    records = []
    for idx, tile in enumerate(candidates, start=1):
        bounds = tuple(float(v) for v in tile.bounds)
        record = {
            "tile": idx, "bbox_epsg25830": list(bounds),
            "intersects_aoi": True, "status": "pending",
        }
        try:
            payload = request_geotiff(bounds, timeout)
            with MemoryFile(payload) as mem:
                with mem.open() as src:
                    clipped, transform = mask(
                        src, [mapping(geom)], crop=True, all_touched=False,
                        filled=False
                    )
                    meta = src.meta.copy()
                    nodata = src.nodata if src.nodata is not None else -9999.0
                    meta.update(
                        driver="GTiff", height=clipped.shape[1],
                        width=clipped.shape[2], transform=transform,
                        compress="deflate", tiled=True, nodata=nodata,
                    )
                    path = output / f"mdt_{idx:04d}.tif"
                    valid_mask = ~clipped.mask
                    spatial_valid = np.any(valid_mask, axis=0)
                    valid = int(spatial_valid.sum())
                    filled = clipped.filled(nodata)
                    with rasterio.open(path, "w", **meta) as dst:
                        dst.write(filled)
                        dst.write_mask(spatial_valid.astype("uint8") * 255)
                    record.update({
                        "status": "downloaded_clipped",
                        "file": path.name, "bytes": path.stat().st_size,
                        "width": int(clipped.shape[2]), "height": int(clipped.shape[1]),
                        "valid_pixel_count": valid,
                        "nodata": src.nodata,
                    })
        except (OSError, ValueError, rasterio.errors.RasterioError, urllib.error.URLError) as exc:
            record.update({"status": "failed", "error": str(exc)})
        records.append(record)
        (output / "wcs_aoi_manifest.json").write_text(
            json.dumps({
                "aoi": "Gipuzkoa", "coverage": COVERAGE, "crs": CRS,
                "tile_size_m": tile_size, "created_utc": datetime.now(timezone.utc).isoformat(),
                "requested_tiles": len(candidates), "tiles": records,
            }, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    failed = sum(r["status"] != "downloaded_clipped" for r in records)
    return {"requested_tiles": len(records), "failed_tiles": failed, "output": str(output)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--boundary", type=Path, required=True,
                        help="GeoPackage containing the pilot_boundary layer")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tile-size", type=int, default=1000,
                        help="WCS request side length in metres (default: 1000)")
    parser.add_argument("--max-tiles", type=int, default=25,
                        help="Safety cap; raise explicitly for larger AOIs")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    try:
        result = run(args.boundary, args.output, args.tile_size, args.max_tiles, args.timeout)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 1 if result["failed_tiles"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
