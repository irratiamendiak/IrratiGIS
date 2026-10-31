#!/usr/bin/env python3
"""Audit unique-cell DEM coverage/NoData and adjacent tile seams.

The coverage audit reads a single clipped/mosaicked DEM once, by windows, so
overlapping source tiles are not double-counted. Seam checks compare actual
overlap pixels between source tiles and report exact agreement and differences.
"""
from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import Window, from_bounds


def coverage_audit(path: Path, boundary_path: Path | None, boundary_layer: str | None,
                   block_size: int = 1024) -> dict:
    import geopandas as gpd

    boundary = None
    if boundary_path:
        boundary = gpd.read_file(boundary_path, layer=boundary_layer)
        if boundary.empty or boundary.crs is None:
            raise ValueError("Boundary layer is empty or has no CRS")
    with rasterio.open(path) as src:
        if src.count != 1 or src.crs is None or src.nodata is None:
            raise ValueError("Coverage input must be a single-band raster with CRS and declared NoData")
        if boundary is not None:
            boundary = boundary.to_crs(src.crs)
            geoms = [g.__geo_interface__ for g in boundary.geometry if g is not None and not g.is_empty]
            if not geoms:
                raise ValueError("Boundary has no usable geometries")
        else:
            geoms = None
        total = valid = nodata = 0
        minimum = maximum = None
        for row in range(0, src.height, block_size):
            for col in range(0, src.width, block_size):
                h, w = min(block_size, src.height-row), min(block_size, src.width-col)
                win = Window(col, row, w, h)
                arr = src.read(1, window=win)
                inside = np.ones((h,w), dtype=bool) if geoms is None else geometry_mask(
                    geoms, out_shape=(h,w), transform=src.window_transform(win), invert=True, all_touched=False)
                mask = inside & np.isfinite(arr)
                n = int(inside.sum())
                good = mask & (arr != src.nodata)
                total += n
                valid += int(good.sum())
                nodata += int((inside & ~good).sum())
                if good.any():
                    vals = arr[good]
                    lo, hi = float(vals.min()), float(vals.max())
                    minimum = lo if minimum is None else min(minimum, lo)
                    maximum = hi if maximum is None else max(maximum, hi)
        return {
            "raster": str(path), "crs": src.crs.to_string(),
            "cell_size": [abs(float(src.transform.a)), abs(float(src.transform.e))],
            "counting": "unique raster cells; each cell counted once",
            "cells_inside_boundary": total, "valid_elevation_cells": valid,
            "nodata_or_nonfinite_cells_inside_boundary": nodata,
            "valid_fraction": valid/total if total else None,
            "min_elevation": minimum, "max_elevation": maximum,
        }


def seam_audit(paths: list[Path]) -> list[dict]:
    results=[]
    for left_path, right_path in itertools.combinations(sorted(paths),2):
        with rasterio.open(left_path) as a, rasterio.open(right_path) as b:
            if a.crs != b.crs:
                results.append({"tile_a":str(left_path),"tile_b":str(right_path),"status":"incompatible_crs"})
                continue
            if a.count != 1 or b.count != 1 or a.nodata is None or b.nodata is None:
                results.append({"tile_a":str(left_path),"tile_b":str(right_path),"status":"unsupported_raster"})
                continue
            left=max(a.bounds.left,b.bounds.left); right=min(a.bounds.right,b.bounds.right)
            bottom=max(a.bounds.bottom,b.bounds.bottom); top=min(a.bounds.top,b.bounds.top)
            if right <= left or top <= bottom:
                results.append({"tile_a":str(left_path),"tile_b":str(right_path),"status":"no_overlap"})
                continue
            wa=from_bounds(left,bottom,right,top,a.transform).round_offsets().round_lengths()
            wb=from_bounds(left,bottom,right,top,b.transform).round_offsets().round_lengths()
            aa=a.read(1,window=wa,masked=True); bb=b.read(1,window=wb,masked=True)
            if aa.shape != bb.shape:
                results.append({"tile_a":str(left_path),"tile_b":str(right_path),"status":"grid_mismatch","shape_a":aa.shape,"shape_b":bb.shape})
                continue
            valid=~np.ma.getmaskarray(aa)&~np.ma.getmaskarray(bb)&np.isfinite(aa.data)&np.isfinite(bb.data)
            dif=np.abs(aa.data.astype("float64")-bb.data.astype("float64"))
            n=int(valid.sum())
            results.append({
                "tile_a":str(left_path),"tile_b":str(right_path),"status":"compared",
                "overlap_cells":int(valid.size),"comparable_valid_cells":n,
                "exact_match_cells":int((valid&(dif==0)).sum()),
                "different_cells":int((valid&(dif>0)).sum()),
                "max_abs_difference":float(dif[valid].max()) if n else None,
                "mean_abs_difference":float(dif[valid].mean()) if n else None,
            })
    return results


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--mosaic",type=Path,required=True)
    p.add_argument("--boundary",type=Path)
    p.add_argument("--boundary-layer")
    p.add_argument("--tiles",type=Path,nargs="*",default=[])
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--block-size",type=int,default=1024)
    a=p.parse_args()
    if a.block_size<64: raise SystemExit("--block-size must be >=64")
    report={"coverage":coverage_audit(a.mosaic,a.boundary,a.boundary_layer,a.block_size),
            "seams":seam_audit(a.tiles),
            "limitations":["Coverage is evaluated only over the supplied mosaic and boundary.",
                           "Seam comparison requires source tile rasters with compatible aligned grids.",
                           "No result here establishes vertical accuracy or fire-model validity."]}
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,indent=2))


if __name__=="__main__":
    main()
