#!/usr/bin/env python3
"""Audit actual MDT elevation pixels inside the Gipuzkoa pilot boundary.

Downloads one selected ZIP at a time, reads ASCII-grid blocks, and counts valid
and NoData cells inside the boundary. It writes compact reports only.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import json
import math
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from rasterio.windows import Window


def audit_one(row, geometry, crs, timeout, max_bytes):
    result = {
        "HOJA": row["HOJA"], "url": row["url"], "sha256": None,
        "raster_crs": None, "crs_matches_epsg25830": False, "prj_signature_matches_epsg25830": False,
        "width": None, "height": None, "pixel_x": None, "pixel_y": None,
        "nodata": None, "pilot_cells_examined": 0, "valid_cells_inside_pilot": 0,
        "nodata_cells_inside_pilot": 0, "valid_percent_inside_tile_intersection": None,
        "min_elevation_m": None, "max_elevation_m": None, "mean_elevation_m": None,
        "error": None,
    }
    digest = hashlib.sha256()
    try:
        with tempfile.TemporaryDirectory() as td:
            zip_path = Path(td) / "tile.zip"
            request = urllib.request.Request(row["url"], headers={"User-Agent": "IrratiGIS-MDT-pixel-audit/1.0"})
            total = 0
            with urllib.request.urlopen(request, timeout=timeout) as response, zip_path.open("wb") as out:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError(f"ZIP exceeds {max_bytes} byte safety limit")
                    digest.update(chunk)
                    out.write(chunk)
            result["sha256"] = digest.hexdigest()
            with zipfile.ZipFile(zip_path) as archive:
                bad = archive.testzip()
                if bad:
                    raise ValueError(f"ZIP CRC failure: {bad}")
                asc = [n for n in archive.namelist() if n.lower().endswith(".asc")]
                if len(asc) != 1:
                    raise ValueError(f"Expected one ASC, found {len(asc)}")
                asc_name = asc[0]
                prj = [n for n in archive.namelist() if n.lower().endswith(".prj")]
                prj_name = next((n for n in prj if PurePosixPath(n).stem.lower() == PurePosixPath(asc_name).stem.lower()), prj[0] if len(prj) == 1 else None)
                asc_path = Path(td) / "tile.asc"
                asc_path.write_bytes(archive.read(asc_name))
                if prj_name:
                    (Path(td) / "tile.prj").write_bytes(archive.read(prj_name))
            prj_text = (Path(td) / "tile.prj").read_text(encoding="utf-8", errors="replace") if prj_name else ""
            prj_norm = " ".join(prj_text.lower().replace("_", "").split())
            legacy_signature = all(token in prj_norm for token in (
                "projection utm", "zone 30", "datum aietrs89", "spheroid grs80", "units meters"
            ))
            with rasterio.open(asc_path) as src:
                raster_crs = src.crs.to_string() if src.crs else None
                native_crs_matches = bool(src.crs and src.crs.to_epsg() == 25830)
                result.update({
                    "raster_crs": raster_crs or ("legacy .prj signature: AI_ETRS89 / UTM zone 30 / GRS80" if legacy_signature else None),
                    "crs_matches_epsg25830": native_crs_matches or (src.crs is None and legacy_signature),
                    "prj_signature_matches_epsg25830": legacy_signature,
                    "width": src.width, "height": src.height,
                    "pixel_x": abs(src.transform.a), "pixel_y": abs(src.transform.e),
                    "nodata": src.nodata,
                })
                if not native_crs_matches and not (src.crs is None and legacy_signature):
                    raise ValueError(f"CRS not verifiable as EPSG:25830; GDAL CRS={src.crs}, legacy PRJ signature={legacy_signature}, PRJ={prj_text[:300]!r}")
                if not math.isclose(abs(src.transform.a), 1.0, abs_tol=1e-6) or not math.isclose(abs(src.transform.e), 1.0, abs_tol=1e-6):
                    raise ValueError(f"Unexpected pixel size: {src.transform}")
                count = 0
                valid_count = 0
                nodata_count = 0
                vmin, vmax, total_sum = float("inf"), float("-inf"), 0.0
                for _, window in src.block_windows(1):
                    data = src.read(1, window=window, masked=False)
                    inside = geometry_mask(
                        [geometry.__geo_interface__], out_shape=data.shape,
                        transform=src.window_transform(window), invert=True, all_touched=False,
                    )
                    if not inside.any():
                        continue
                    selected = data[inside]
                    valid = np.isfinite(selected)
                    if src.nodata is not None:
                        valid &= selected != src.nodata
                    vals = selected[valid]
                    count += selected.size
                    valid_count += vals.size
                    nodata_count += selected.size - vals.size
                    if vals.size:
                        vmin = min(vmin, float(vals.min()))
                        vmax = max(vmax, float(vals.max()))
                        total_sum += float(vals.astype(np.float64).sum())
                result["pilot_cells_examined"] = int(count)
                result["valid_cells_inside_pilot"] = int(valid_count)
                result["nodata_cells_inside_pilot"] = int(nodata_count)
                result["valid_percent_inside_tile_intersection"] = round(100 * valid_count / count, 6) if count else None
                result["min_elevation_m"] = vmin if valid_count else None
                result["max_elevation_m"] = vmax if valid_count else None
                result["mean_elevation_m"] = total_sum / valid_count if valid_count else None
        return result
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--availability", type=Path, required=True)
    parser.add_argument("--boundary", type=Path, required=True)
    parser.add_argument("--boundary-layer", default="pilot_boundary")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--max-mb", type=int, default=500)
    args = parser.parse_args()

    import geopandas as gpd
    boundary = gpd.read_file(args.boundary, layer=args.boundary_layer)
    if boundary.crs is None:
        parser.error("Boundary has no CRS")
    boundary = boundary.to_crs("EPSG:25830")
    geometry = boundary.geometry.union_all()
    if geometry.is_empty or not geometry.is_valid:
        parser.error("Pilot boundary geometry is empty or invalid")

    source = json.loads(args.availability.read_text(encoding="utf-8"))
    rows = [r for r in source.get("results", []) if r.get("available") is True]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(audit_one, row, geometry, boundary.crs, args.timeout, args.max_mb * 1024 * 1024) for row in rows]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
            if len(results) % 10 == 0 or len(results) == len(rows):
                print(f"Pixel-audited {len(results)}/{len(rows)} tiles", flush=True)
    results.sort(key=lambda r: r["HOJA"])
    fields = list(results[0].keys()) if results else []
    with (args.output_dir / "mdt_2017_pixel_audit.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(results)

    total_examined = sum(r["pilot_cells_examined"] for r in results)
    total_valid = sum(r["valid_cells_inside_pilot"] for r in results)
    total_nodata = sum(r["nodata_cells_inside_pilot"] for r in results)
    summary = {
        "tile_count": len(results),
        "tiles_without_errors": sum(not r["error"] for r in results),
        "tiles_with_errors": sum(bool(r["error"]) for r in results),
        "total_tile_cell_intersections_counted": total_examined,
        "valid_cell_intersections_counted": total_valid,
        "nodata_cell_intersections_counted": total_nodata,
        "valid_percent_across_tile_intersections": round(100 * total_valid / total_examined, 6) if total_examined else None,
        "important_interpretation": "Counts are summed per tile and therefore double-count overlapping sheet areas. This percentage is not the unique-area coverage percentage of Gipuzkoa.",
        "elevation_min_m": min((r["min_elevation_m"] for r in results if r["min_elevation_m"] is not None), default=None),
        "elevation_max_m": max((r["max_elevation_m"] for r in results if r["max_elevation_m"] is not None), default=None),
        "resolution_values_m": sorted({r["pixel_x"] for r in results if r["pixel_x"] is not None}),
        "crs_all_epsg25830": all(r["crs_matches_epsg25830"] for r in results if not r["error"]),
        "legacy_prj_signature_count": sum(r["prj_signature_matches_epsg25830"] for r in results),
        "note": "Per-tile actual pixel-value audit inside the pilot polygon. Overlaps are counted once per tile; a final mosaic-level unique-cell audit is still required.",
        "results": results,
    }
    (args.output_dir / "mdt_2017_pixel_audit.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "results"}, ensure_ascii=False, indent=2))
    if summary["tiles_with_errors"]:
        print("ERROR SAMPLE:", next(r["error"] for r in results if r["error"]), flush=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
