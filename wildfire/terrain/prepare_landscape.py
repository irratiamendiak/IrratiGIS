#!/usr/bin/env python3
"""Prepare a co-registered FlamMap/FARSITE landscape from source GeoTIFFs.

This is a preprocessing utility, not a fire-spread model. It never invents
fuel/canopy information: missing layers are reported and remain missing.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds

BANDS = [
    ("elevation", "m", 1.0, "Elevation (m)"),
    ("slope", "degrees", 1.0, "Slope (degrees)"),
    ("aspect", "degrees", 1.0, "Aspect (degrees clockwise from north)"),
    ("fuel_model", "class", 1.0, "Fire behaviour fuel model code"),
    ("canopy_cover", "percent", 1.0, "Canopy cover (%)"),
]
OPTIONAL_BANDS = [
    ("canopy_height", "m x 10", 10.0, "Canopy/stand height (m x 10)"),
    ("canopy_base_height", "m x 10", 10.0, "Canopy base height (m x 10)"),
    ("canopy_bulk_density", "kg/m3 x 100", 100.0, "Canopy bulk density (kg/m3 x 100)"),
]


def source_resolution(dataset: rasterio.DatasetReader) -> float:
    return max(abs(dataset.transform.a), abs(dataset.transform.e))


def make_target_grid(dem_path: Path, target_crs: str, resolution: float):
    with rasterio.open(dem_path) as src:
        if not src.crs:
            raise ValueError(f"DEM has no CRS: {dem_path}")
        bounds = transform_bounds(src.crs, target_crs, *src.bounds, densify_pts=21)
        left = math.floor(bounds[0] / resolution) * resolution
        bottom = math.floor(bounds[1] / resolution) * resolution
        right = math.ceil(bounds[2] / resolution) * resolution
        top = math.ceil(bounds[3] / resolution) * resolution
        width = int(round((right - left) / resolution))
        height = int(round((top - bottom) / resolution))
        if width < 2 or height < 2:
            raise ValueError("Target grid is empty or too small.")
        return from_origin(left, top, resolution, resolution), width, height


def warp_band(path: Path, dst_crs, dst_transform, width, height, categorical=False):
    with rasterio.open(path) as src:
        if not src.crs:
            raise ValueError(f"Raster has no CRS: {path}")
        data = np.full((height, width), np.nan, dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1),
            destination=data,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src.nodata,
            dst_transform=dst_transform,
            dst_crs=dst_crs,
            dst_nodata=np.nan,
            resampling=Resampling.nearest if categorical else Resampling.bilinear,
            init_dest_nodata=True,
        )
        return data, {
            "path": str(path),
            "crs": src.crs.to_string(),
            "native_resolution_m_approx": source_resolution(src),
            "nodata": src.nodata,
            "resampling": "nearest" if categorical else "bilinear",
        }


def derive_slope_aspect(elevation: np.ndarray, resolution: float):
    valid = np.isfinite(elevation)
    # Fill nodata temporarily for gradients; invalidate cells touching nodata.
    if not valid.all():
        filled = elevation.copy()
        if valid.any():
            filled[~valid] = float(np.nanmedian(elevation))
        else:
            raise ValueError("DEM contains no valid cells.")
    else:
        filled = elevation
    # Array rows run southward; convert row gradient to north-positive gradient.
    dz_drow, dz_dx = np.gradient(filled.astype(np.float64), resolution, resolution)
    dz_dy = -dz_drow
    slope = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy))).astype(np.float32)
    aspect = (np.degrees(np.arctan2(-dz_dx, -dz_dy)) + 360.0) % 360.0
    aspect = aspect.astype(np.float32)
    aspect[np.hypot(dz_dx, dz_dy) < 1e-8] = 0.0
    # A 1-cell neighbourhood around NoData is not a reliable derivative.
    invalid_neighbour = ~valid.copy()
    invalid_neighbour[1:, :] |= ~valid[:-1, :]
    invalid_neighbour[:-1, :] |= ~valid[1:, :]
    invalid_neighbour[:, 1:] |= ~valid[:, :-1]
    invalid_neighbour[:, :-1] |= ~valid[:, 1:]
    slope[invalid_neighbour] = np.nan
    aspect[invalid_neighbour] = np.nan
    return slope, aspect


def validate_layer(name: str, data: np.ndarray):
    valid = data[np.isfinite(data)]
    if valid.size == 0:
        raise ValueError(f"Layer '{name}' has no valid cells.")
    limits = {
        "slope": (0, 90),
        "aspect": (0, 360),
        "fuel_model": (0, 255),
        "canopy_cover": (0, 100),
        "canopy_height": (0, 100),
        "canopy_base_height": (0, 100),
        "canopy_bulk_density": (0, 10),
    }
    if name in limits:
        lo, hi = limits[name]
        if float(valid.min()) < lo or float(valid.max()) > hi:
            raise ValueError(
                f"Layer '{name}' outside expected range [{lo}, {hi}]: "
                f"{float(valid.min()):.3f}..{float(valid.max()):.3f}. "
                "Check source units and classification."
            )
    if name == "fuel_model" and not np.allclose(valid, np.rint(valid), atol=1e-4):
        raise ValueError("Fuel model must contain integer class codes, not continuous values.")


def write_raster(path: Path, data: np.ndarray, crs, transform, description: str):
    profile = {
        "driver": "GTiff", "height": data.shape[0], "width": data.shape[1],
        "count": 1, "dtype": "float32", "crs": crs, "transform": transform,
        "nodata": -9999.0, "compress": "deflate", "predictor": 3,
        "tiled": True, "BIGTIFF": "IF_SAFER",
    }
    out = np.where(np.isfinite(data), data, -9999.0).astype(np.float32)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(out, 1)
        dst.set_band_description(1, description)
        dst.update_tags(AREA_OR_POINT="Area")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dem", required=True, type=Path, help="Elevation GeoTIFF")
    parser.add_argument("--fuel-model", required=True, type=Path, help="Fire behaviour fuel model raster")
    parser.add_argument("--canopy-cover", required=True, type=Path, help="Canopy cover raster (percent)")
    parser.add_argument("--canopy-height", type=Path)
    parser.add_argument("--canopy-base-height", type=Path)
    parser.add_argument("--canopy-bulk-density", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--crs", default="EPSG:25830", help="Projected metric CRS; Euskadi default EPSG:25830")
    parser.add_argument("--resolution", type=float, default=10.0, help="Target pixel size in CRS units; default 10 m")
    args = parser.parse_args(argv)

    if args.resolution <= 0:
        parser.error("--resolution must be greater than zero")
    if not args.dem.exists() or not args.fuel_model.exists() or not args.canopy_cover.exists():
        parser.error("DEM, fuel model and canopy cover files must exist.")
    optional_paths = [args.canopy_height, args.canopy_base_height, args.canopy_bulk_density]
    if any(optional_paths) and not all(optional_paths):
        parser.error("For crown-fuel analysis provide all three canopy layers: height, base height and bulk density.")

    args.output.mkdir(parents=True, exist_ok=True)
    transform, width, height = make_target_grid(args.dem, args.crs, args.resolution)
    dem, dem_meta = warp_band(args.dem, args.crs, transform, width, height)
    fuel, fuel_meta = warp_band(args.fuel_model, args.crs, transform, width, height, categorical=True)
    canopy, canopy_meta = warp_band(args.canopy_cover, args.crs, transform, width, height, categorical=False)
    slope, aspect = derive_slope_aspect(dem, args.resolution)

    layers = {
        "elevation": dem, "slope": slope, "aspect": aspect,
        "fuel_model": fuel, "canopy_cover": canopy,
    }
    sources = {
        "elevation": dem_meta, "fuel_model": fuel_meta, "canopy_cover": canopy_meta,
    }
    for name, path in [
        ("canopy_height", args.canopy_height),
        ("canopy_base_height", args.canopy_base_height),
        ("canopy_bulk_density", args.canopy_bulk_density),
    ]:
        if path:
            layers[name], sources[name] = warp_band(path, args.crs, transform, width, height)

    warnings = []
    for name, data in layers.items():
        validate_layer(name, data)
        if name in sources and sources[name]["native_resolution_m_approx"] > args.resolution * 1.25:
            warnings.append(
                f"{name}: source resolution ~{sources[name]['native_resolution_m_approx']:.1f} m "
                f"is coarser than target {args.resolution:g} m; resampling does not add information."
            )

    raster_paths = {}
    for name, data in layers.items():
        filename = args.output / f"{name}.tif"
        write_raster(filename, data, args.crs, transform, dict(BANDS + OPTIONAL_BANDS)[name])
        raster_paths[name] = filename.name

    # Multiband GeoTIFF follows the documented landscape theme order.
    ordered = [name for name, _, _, _ in BANDS]
    if all(name in layers for name, _, _, _ in OPTIONAL_BANDS):
        ordered += [name for name, _, _, _ in OPTIONAL_BANDS]
    stack_path = args.output / "wildfire_landscape.tif"
    profile = {
        "driver": "GTiff", "height": height, "width": width, "count": len(ordered),
        "dtype": "int16", "crs": args.crs, "transform": transform,
        "nodata": -9999, "compress": "deflate", "predictor": 2,
        "tiled": True, "BIGTIFF": "IF_SAFER",
    }
    with rasterio.open(stack_path, "w", **profile) as dst:
        for index, name in enumerate(ordered, start=1):
            scale = dict((n, s) for n, _, s, _ in BANDS + OPTIONAL_BANDS)[name]
            data = np.where(np.isfinite(layers[name]), np.rint(layers[name] * scale), -9999)
            if np.any((data[np.isfinite(layers[name])] < -32768) | (data[np.isfinite(layers[name])] > 32767)):
                raise ValueError(f"Layer '{name}' exceeds int16 range after unit encoding.")
            dst.write(data.astype(np.int16), index)
            dst.set_band_description(index, name)
            dst.update_tags(index, units=dict((n, u) for n, u, _, _ in BANDS + OPTIONAL_BANDS)[name])
        dst.update_tags(
            product="IrratiGIS Wildfire Intelligence landscape",
            schema_version="1.0.0",
            generated_at=datetime.now(timezone.utc).isoformat(),
            resolution_m=str(args.resolution),
            crs=args.crs,
            source_resampling="categorical=nearest;continuous=bilinear",
        )

    manifest = {
        "schema_version": "1.0.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target": {
            "crs": args.crs, "resolution_m": args.resolution,
            "width": width, "height": height,
            "bounds": [transform.c, transform.f - height * args.resolution,
                       transform.c + width * args.resolution, transform.f],
            "pixel_count": width * height,
        },
        "stack": stack_path.name,
        "stack_band_order": ordered,
        "layers": raster_paths,
        "sources": sources,
        "warnings": warnings,
        "validation": {
            "status": "warnings" if warnings else "passed",
            "crown_fire_layers_included": len(ordered) == 8,
            "fire_model_ready": False,
            "reason": "A qualified operator must verify fuel classifications, fuel moistures, weather streams, units and model-specific landscape compatibility before execution.",
        },
    }
    (args.output / "landscape_manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
