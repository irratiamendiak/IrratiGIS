#!/usr/bin/env python3
"""Download every intersecting geoEuskadi 1 m MDT sheet and build a provincial mosaic.

The workflow is deliberately streaming: one ZIP/ASCII grid is held at a time,
and raster windows are copied into a tiled GeoTIFF. No province-sized NumPy
array is allocated. Missing or invalid source sheets fail the run rather than
being silently skipped.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.windows import Window
from pyproj import CRS as PyprojCRS

from wildfire.ingestion.create_mdt_relief_preview import validate_prj
from wildfire.terrain.audit_dem_coverage_and_seams import coverage_audit

USER_AGENT = "IrratiGIS-Gipuzkoa-MDT-full-coverage/1.0"
NODATA = -9999.0


def download(url: str, path: Path, timeout: int = 180, retries: int = 2) -> tuple[str, int]:
    last_error = None
    for attempt in range(retries + 1):
        digest = hashlib.sha256()
        size = 0
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=timeout) as response, path.open("wb") as out:
                if not 200 <= response.status < 300:
                    raise RuntimeError(f"HTTP {response.status}")
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
            return digest.hexdigest(), size
        except Exception as exc:
            last_error = str(exc)
            path.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Download failed after {retries + 1} attempts: {url}: {last_error}")


def extract_ascii(zip_path: Path, work: Path, sheet: str) -> Path:
    with zipfile.ZipFile(zip_path) as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError(f"{sheet}: corrupt ZIP member {bad}")
        asc = [n for n in archive.namelist() if n.lower().endswith(".asc") and not n.startswith("__MACOSX/")]
        prj = [n for n in archive.namelist() if n.lower().endswith(".prj") and not n.startswith("__MACOSX/")]
        if len(asc) != 1 or not prj:
            raise ValueError(f"{sheet}: expected exactly one ASC and at least one PRJ; found {len(asc)} ASC, {len(prj)} PRJ")
        asc_name = asc[0]
        prj_name = next((n for n in prj if PurePosixPath(n).stem.casefold() == PurePosixPath(asc_name).stem.casefold()), prj[0])
        crs = validate_prj(archive.read(prj_name), sheet)
        if not crs.equals(PyprojCRS.from_epsg(25830)):
            raise ValueError(f"{sheet}: source CRS is not EPSG:25830")
        asc_path = work / f"{sheet}.asc"
        asc_path.write_bytes(archive.read(asc_name))
        asc_path.with_suffix(".prj").write_text(crs.to_wkt(version="WKT1_GDAL"), encoding="utf-8")
        return asc_path


def initialize_mosaic(path: Path, boundary, block_size: int) -> tuple[dict, tuple[float, float, float, float]]:
    minx, miny, maxx, maxy = boundary.bounds
    left, bottom, right, top = math.floor(minx), math.floor(miny), math.ceil(maxx), math.ceil(maxy)
    width, height = right - left, top - bottom
    if width <= 0 or height <= 0:
        raise ValueError("Invalid provincial boundary extent")
    transform = rasterio.transform.from_origin(left, top, 1.0, 1.0)
    profile = {
        "driver": "GTiff", "height": height, "width": width, "count": 1,
        "dtype": "float32", "crs": "EPSG:25830", "transform": transform,
        "nodata": NODATA, "compress": "DEFLATE", "predictor": 3,
        "tiled": True, "blockxsize": 512, "blockysize": 512,
        "BIGTIFF": "IF_SAFER",
    }
    with rasterio.open(path, "w", **profile) as dst:
        fill = np.full((block_size, block_size), NODATA, dtype=np.float32)
        for row in range(0, height, block_size):
            for col in range(0, width, block_size):
                h, w = min(block_size, height-row), min(block_size, width-col)
                dst.write(fill[:h, :w], 1, window=Window(col, row, w, h))
    return profile, (left, bottom, right, top)


def paste_tile(src, dst, sheet: str, block_size: int) -> dict:
    if src.count != 1 or src.crs is None or src.crs != rasterio.crs.CRS.from_epsg(25830):
        raise ValueError(f"{sheet}: raster must be single-band EPSG:25830")
    if src.nodata is None:
        raise ValueError(f"{sheet}: raster has no declared NoData")
    if abs(src.transform.a - 1.0) > 1e-6 or abs(src.transform.e + 1.0) > 1e-6 or abs(src.transform.b) > 1e-10 or abs(src.transform.d) > 1e-10:
        raise ValueError(f"{sheet}: expected north-up 1 m grid")
    left, top = src.transform.c, src.transform.f
    col0 = int(round(left - dst.transform.c))
    row0 = int(round(dst.transform.f - top))
    if abs((left - dst.transform.c) - col0) > 1e-5 or abs((dst.transform.f - top) - row0) > 1e-5:
        raise ValueError(f"{sheet}: source grid is not aligned to the provincial 1 m lattice")

    inside_valid = inserted = overlap = different = 0
    max_diff = 0.0
    for sr in range(0, src.height, block_size):
        for sc in range(0, src.width, block_size):
            h, w = min(block_size, src.height-sr), min(block_size, src.width-sc)
            dr, dc = row0 + sr, col0 + sc
            # Clip source windows to the provincial output rectangle.
            r_start, c_start = max(0, -dr), max(0, -dc)
            r_end = min(h, dst.height-dr), min(w, dst.width-dc)
            if r_end <= c_start or r_end <= 0 or r_start >= h or r_start >= h:
                continue
            # Recompute a rectangular intersection in source-block coordinates.
            rr0, cc0 = max(0, -dr), max(0, -dc)
            rr1, cc1 = min(h, dst.height-dr), min(w, dst.width-dc)
            if rr1 <= rr0 or cc1 <= cc0:
                continue
            sh, sw = rr1-rr0, cc1-cc0
            src_win = Window(sc+cc0, sr+rr0, sw, sh)
            dst_win = Window(dc+cc0, dr+rr0, sw, sh)
            values = src.read(1, window=src_win).astype(np.float32, copy=False)
            valid = np.isfinite(values) & (values != src.nodata)
            inside_valid += int(valid.sum())
            if not valid.any():
                continue
            existing = dst.read(1, window=dst_win)
            existing_valid = np.isfinite(existing) & (existing != NODATA)
            both = valid & existing_valid
            if both.any():
                delta = np.abs(values[both].astype(np.float64)-existing[both].astype(np.float64))
                overlap += int(both.sum())
                different += int((delta > 0).sum())
                max_diff = max(max_diff, float(delta.max()))
            fill = valid & ~existing_valid
            if fill.any():
                existing[fill] = values[fill]
                inserted += int(fill.sum())
                dst.write(existing, 1, window=dst_win)
    return {
        "sheet": sheet, "raster_bounds": [src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top],
        "valid_source_cells_in_provincial_extent": inside_valid,
        "new_unique_cells_inserted": inserted, "overlap_comparable_cells": overlap,
        "overlap_different_cells": different, "max_overlap_difference_m": max_diff,
    }


def build(availability_path: Path, boundary_path: Path, boundary_layer: str,
          output_dir: Path, block_size: int = 1024) -> dict:
    availability = json.loads(availability_path.read_text(encoding="utf-8"))
    rows = sorted(availability.get("results", []), key=lambda x: str(x.get("HOJA", "")))
    if not rows:
        raise ValueError("Availability file contains no selected sheets")
    missing = [r.get("HOJA") for r in rows if r.get("available") is not True]
    if missing:
        raise ValueError(f"Refusing partial provincial build: {len(missing)} sheets unavailable/indeterminate: {missing[:20]}")
    sheets = [str(r["HOJA"]) for r in rows]
    if len(sheets) != len(set(sheets)):
        raise ValueError("Duplicate HOJA identifiers in availability index")

    boundary_gdf = gpd.read_file(boundary_path, layer=boundary_layer)
    if boundary_gdf.empty or boundary_gdf.crs is None:
        raise ValueError("Provincial boundary is empty or has no CRS")
    if boundary_gdf.geometry.isna().any() or boundary_gdf.geometry.is_empty.any() or (~boundary_gdf.geometry.is_valid).any():
        raise ValueError("Provincial boundary contains unusable geometry")
    boundary_gdf = boundary_gdf.to_crs("EPSG:25830")
    boundary = boundary_gdf.geometry.union_all()

    output_dir.mkdir(parents=True, exist_ok=True)
    mosaic_path = output_dir / "gipuzkoa_mdt_lidar_2017_1m.tif"
    _, extent = initialize_mosaic(mosaic_path, boundary, block_size)
    tile_reports = []
    with rasterio.open(mosaic_path, "r+") as dst:
        for index, row in enumerate(rows, start=1):
            sheet = str(row["HOJA"])
            with tempfile.TemporaryDirectory(prefix=f"mdt-{sheet}-") as td:
                work = Path(td)
                zip_path = work / f"{sheet}.zip"
                digest, size = download(row["url"], zip_path)
                asc_path = extract_ascii(zip_path, work, sheet)
                with rasterio.open(asc_path) as src:
                    report = paste_tile(src, dst, sheet, block_size)
                report.update({"archive_bytes": size, "archive_sha256": digest, "url": row["url"]})
                tile_reports.append(report)
            print(json.dumps({"progress": index, "total": len(rows), "sheet": sheet,
                              "new_unique_cells": report["new_unique_cells_inserted"],
                              "overlap_cells": report["overlap_comparable_cells"]}), flush=True)

    audit = coverage_audit(mosaic_path, boundary_path, boundary_layer, block_size)
    total_overlap = sum(x["overlap_comparable_cells"] for x in tile_reports)
    total_different = sum(x["overlap_different_cells"] for x in tile_reports)
    report = {
        "dataset": "MDT LiDAR 2017 1 m · geoEuskadi",
        "publisher": "Eusko Jaurlaritza / Gobierno Vasco",
        "license": "CC BY 3.0",
        "attribution": "Eusko Jaurlaritza / Gobierno Vasco",
        "source_reference": "wildfire/ingestion/sources.euskadi-gipuzkoa.json:euskadi_mdt_lidar_2017_1m_tiles",
        "crs": "EPSG:25830", "cell_size_m": 1,
        "boundary_extent_epsg25830": list(extent),
        "sheet_count_indexed": len(rows), "sheet_count_downloaded_and_validated": len(tile_reports),
        "downloaded_archive_bytes": sum(x["archive_bytes"] for x in tile_reports),
        "coverage": audit,
        "overlap_quality": {
            "comparable_cells": total_overlap, "different_cells": total_different,
            "max_abs_difference_m": max((x["max_overlap_difference_m"] for x in tile_reports), default=0),
            "note": "Overlaps compare each incoming tile against already populated mosaic cells; first valid value is retained deterministically."
        },
        "tiles": tile_reports,
        "limitations": [
            "A valid-cell percentage is measured against the complete official provincial boundary.",
            "NoData cells are retained and reported, not interpolated or fabricated.",
            "The source lineage is 2008-2017; 1 m grid spacing does not imply 1 m vertical accuracy or current terrain.",
            "Overlap agreement is not a substitute for independent vertical-accuracy validation."
        ],
        "mosaic": str(mosaic_path),
    }
    report_path = output_dir / "gipuzkoa_mdt_full_coverage_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "sheet_count": len(rows), "downloaded_archive_gb": round(report["downloaded_archive_bytes"]/1e9, 3),
        "valid_fraction": audit["valid_fraction"],
        "valid_cells": audit["valid_elevation_cells"],
        "nodata_cells": audit["nodata_or_nonfinite_cells_inside_boundary"],
        "overlap_different_cells": total_different,
        "mosaic": str(mosaic_path), "report": str(report_path),
    }, ensure_ascii=False, indent=2), flush=True)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--availability", type=Path, required=True)
    parser.add_argument("--boundary", type=Path, required=True)
    parser.add_argument("--boundary-layer", default="pilot_boundary")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--block-size", type=int, default=1024)
    args = parser.parse_args()
    if args.block_size < 128:
        parser.error("--block-size must be >=128")
    build(args.availability, args.boundary, args.boundary_layer, args.output_dir, args.block_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
