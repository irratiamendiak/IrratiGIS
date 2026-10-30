#!/usr/bin/env python3
"""Derive slope, aspect, hillshade and a terrain-quality mask from a verified DEM.

Input is an already mosaicked, projected elevation GeoTIFF. Processing is
windowed with a one-cell halo; no resampling is performed. The script refuses
geographic CRS, non-square/non-metric cells and unknown NoData values.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window


def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dem", required=True, type=Path)
    p.add_argument("--output-dir", required=True, type=Path)
    p.add_argument("--block-size", type=int, default=1024)
    p.add_argument("--azimuth", type=float, default=315.0)
    p.add_argument("--altitude", type=float, default=45.0)
    return p.parse_args()


def write_profile(src, dtype, nodata, compress="DEFLATE"):
    profile = src.profile.copy()
    profile.update(
        driver="GTiff", count=1, dtype=dtype, nodata=nodata,
        compress=compress, predictor=3 if dtype.startswith("float") else 2,
        tiled=True, blockxsize=256, blockysize=256,
        BIGTIFF="IF_SAFER",
    )
    return profile


def main():
    args = parse_args()
    if args.block_size < 64:
        raise SystemExit("--block-size must be at least 64")
    if not (0 <= args.azimuth < 360 and 0 < args.altitude <= 90):
        raise SystemExit("Invalid illumination azimuth/altitude")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    with rasterio.open(args.dem) as src:
        if src.count != 1:
            raise SystemExit("DEM must contain exactly one band")
        if src.crs is None or not src.crs.is_projected:
            raise SystemExit("DEM CRS must be a declared projected CRS")
        if src.nodata is None:
            raise SystemExit("DEM must declare NoData; refusing to guess it")
        if not math.isclose(abs(src.transform.a), abs(src.transform.e), rel_tol=0, abs_tol=1e-8):
            raise SystemExit("DEM cells must be square; no resampling is performed")
        cell = abs(float(src.transform.a))
        if cell <= 0:
            raise SystemExit("Invalid cell size")
        units = (src.crs.linear_units or "").lower()
        if units not in ("metre", "meter", "metres", "meters"):
            raise SystemExit(f"DEM CRS linear units must be metres, got {src.crs.linear_units!r}")

        outputs = {
            "slope_degrees": args.output_dir / "slope_degrees.tif",
            "aspect_degrees": args.output_dir / "aspect_degrees.tif",
            "hillshade": args.output_dir / "hillshade.tif",
            "terrain_quality_mask": args.output_dir / "terrain_quality_mask.tif",
        }
        float_profile = write_profile(src, "float32", -9999.0)
        shade_profile = write_profile(src, "uint8", 0)
        quality_profile = write_profile(src, "uint8", 0)
        stats = {
            "valid_dem_cells": 0, "derivative_valid_cells": 0,
            "edge_or_nodata_neighbour_cells": 0,
            "slope_min_deg": None, "slope_max_deg": None,
            "slope_sum_deg": 0.0, "aspect_flat_cells": 0,
        }
        slope_hist = np.zeros(10, dtype=np.int64)

        with rasterio.open(outputs["slope_degrees"], "w", **float_profile) as slope_dst, \
             rasterio.open(outputs["aspect_degrees"], "w", **float_profile) as aspect_dst, \
             rasterio.open(outputs["hillshade"], "w", **shade_profile) as shade_dst, \
             rasterio.open(outputs["terrain_quality_mask"], "w", **quality_profile) as quality_dst:

            for row in range(0, src.height, args.block_size):
                for col in range(0, src.width, args.block_size):
                    h = min(args.block_size, src.height - row)
                    w = min(args.block_size, src.width - col)
                    r0, c0 = max(0, row - 1), max(0, col - 1)
                    r1, c1 = min(src.height, row + h + 1), min(src.width, col + w + 1)
                    halo = src.read(1, window=Window(c0, r0, c1-c0, r1-r0)).astype("float64")
                    valid_halo = np.isfinite(halo) & (halo != src.nodata)
                    fill = np.where(valid_halo, halo, 0.0)

                    # The inner block coordinates within the halo buffer.
                    ir, ic = row-r0, col-c0
                    center = fill[ir:ir+h, ic:ic+w]
                    center_valid = valid_halo[ir:ir+h, ic:ic+w]
                    neighbourhood = np.ones((h, w), dtype=bool)
                    for dr in (-1, 0, 1):
                        for dc in (-1, 0, 1):
                            rr0, rr1 = ir+dr, ir+dr+h
                            cc0, cc1 = ic+dc, ic+dc+w
                            if rr0 < 0 or cc0 < 0 or rr1 > valid_halo.shape[0] or cc1 > valid_halo.shape[1]:
                                neighbourhood &= False
                            else:
                                neighbourhood &= valid_halo[rr0:rr1, cc0:cc1]
                    derivative_valid = center_valid & neighbourhood

                    z1=fill[ir-1:ir-1+h,ic-1:ic-1+w]; z2=fill[ir-1:ir-1+h,ic:ic+w]; z3=fill[ir-1:ir-1+h,ic+1:ic+1+w]
                    z4=fill[ir:ir+h,ic-1:ic-1+w];                                      z6=fill[ir:ir+h,ic+1:ic+1+w]
                    z7=fill[ir+1:ir+1+h,ic-1:ic-1+w]; z8=fill[ir+1:ir+1+h,ic:ic+w]; z9=fill[ir+1:ir+1+h,ic+1:ic+1+w]
                    dzdx=((z3+2*z6+z9)-(z1+2*z4+z7))/(8.0*cell)
                    # Raster rows increase southward; convert row derivative to northward y.
                    dzdy_north=-((z7+2*z8+z9)-(z1+2*z2+z3))/(8.0*cell)
                    grad=np.hypot(dzdx,dzdy_north)
                    slope=np.degrees(np.arctan(grad)).astype("float32")
                    aspect=(np.degrees(np.arctan2(-dzdx,-dzdy_north))+360.0)%360.0
                    flat=grad < 1e-10
                    aspect=aspect.astype("float32")
                    aspect[flat]=-1.0

                    az=math.radians(args.azimuth)
                    alt=math.radians(args.altitude)
                    slope_rad=np.arctan(grad)
                    aspect_rad=np.radians(np.where(flat,0.0,aspect))
                    illumination=(np.sin(alt)*np.cos(slope_rad) +
                                  np.cos(alt)*np.sin(slope_rad)*np.cos(az-aspect_rad))
                    shade=np.clip(illumination,0,1)
                    shade8=np.rint(shade*255).astype("uint8")

                    slope_out=np.full((h,w),-9999.0,dtype="float32")
                    aspect_out=np.full((h,w),-9999.0,dtype="float32")
                    shade_out=np.zeros((h,w),dtype="uint8")
                    quality=np.zeros((h,w),dtype="uint8")
                    quality[center_valid]=2
                    quality[derivative_valid]=1
                    slope_out[derivative_valid]=slope[derivative_valid]
                    aspect_out[derivative_valid]=aspect[derivative_valid]
                    shade_out[derivative_valid]=shade8[derivative_valid]

                    win=Window(col,row,w,h)
                    slope_dst.write(slope_out,1,window=win)
                    aspect_dst.write(aspect_out,1,window=win)
                    shade_dst.write(shade_out,1,window=win)
                    quality_dst.write(quality,1,window=win)

                    nvalid=int(center_valid.sum())
                    nderiv=int(derivative_valid.sum())
                    stats["valid_dem_cells"]+=nvalid
                    stats["derivative_valid_cells"]+=nderiv
                    stats["edge_or_nodata_neighbour_cells"]+=nvalid-nderiv
                    if nderiv:
                        vals=slope[derivative_valid]
                        stats["slope_min_deg"]=float(vals.min()) if stats["slope_min_deg"] is None else min(stats["slope_min_deg"],float(vals.min()))
                        stats["slope_max_deg"]=float(vals.max()) if stats["slope_max_deg"] is None else max(stats["slope_max_deg"],float(vals.max()))
                        stats["slope_sum_deg"]+=float(vals.sum(dtype="float64"))
                        stats["aspect_flat_cells"]+=int(flat[derivative_valid].sum())
                        slope_hist+=np.histogram(vals,bins=np.linspace(0,90,11))[0]

        n=stats["derivative_valid_cells"]
        report={
            "source_dem":str(args.dem),
            "crs":src.crs.to_string(),
            "cell_size_m":cell,
            "width":src.width,"height":src.height,
            "nodata_value":src.nodata,
            "derivative_method":"Horn 3x3",
            "aspect_convention":"degrees clockwise from north; -1 for flat cells",
            "hillshade":{"azimuth_degrees":args.azimuth,"altitude_degrees":args.altitude,"encoding":"uint8 0-255"},
            **stats,
            "slope_mean_deg":stats["slope_sum_deg"]/n if n else None,
            "slope_histogram_0_9_90_degrees":slope_hist.tolist(),
            "quality_mask_codes":{"0":"DEM NoData","1":"valid 3x3 neighbourhood; derivative calculated","2":"valid DEM cell but neighbourhood incomplete; derivative withheld"},
            "outputs":{k:str(v) for k,v in outputs.items()},
            "limitations":[
                "No resampling or claim of improved source accuracy.",
                "Derivatives are withheld where any cell in the 3x3 neighbourhood is NoData or outside the raster.",
                "Input DEM coverage, vertical accuracy and source lineage must be independently verified.",
                "A successful run does not validate fuel models or fire-spread predictions."
            ]
        }
        (args.output_dir/"terrain_derivatives_report.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
        print(json.dumps({k:v for k,v in report.items() if k not in ("outputs","limitations")},indent=2))


if __name__=="__main__":
    main()
