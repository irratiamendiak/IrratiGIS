#!/usr/bin/env python3
"""Create a real, small-area shaded-relief preview from the first three MDT tiles.

This is a preview only; it does not claim full Gipuzkoa coverage.
"""
from __future__ import annotations
import argparse, json, tempfile, urllib.request, zipfile
from pathlib import Path, PurePosixPath
import numpy as np
import rasterio
from rasterio.mask import mask
from rasterio.merge import merge
from rasterio.crs import CRS
import geopandas as gpd
import matplotlib.pyplot as plt


def read_tile(row, workdir):
    req = urllib.request.Request(row["url"], headers={"User-Agent": "IrratiGIS-relief-preview/1.0"})
    zip_path = workdir / (row["HOJA"] + ".zip")
    with urllib.request.urlopen(req, timeout=180) as response, zip_path.open("wb") as out:
        while chunk := response.read(1024 * 1024):
            out.write(chunk)
    with zipfile.ZipFile(zip_path) as z:
        z.testzip()
        asc = [n for n in z.namelist() if n.lower().endswith(".asc")]
        prj = [n for n in z.namelist() if n.lower().endswith(".prj")]
        if len(asc) != 1 or not prj:
            raise ValueError(f"{row['HOJA']}: expected one ASC and a PRJ")
        prj_name = next((n for n in prj if PurePosixPath(n).stem.lower() == PurePosixPath(asc[0]).stem.lower()), prj[0])
        prj_text = z.read(prj_name).decode("utf-8", errors="replace").lower().replace("_", "")
        if not all(t in prj_text for t in ("projection    utm", "zone          30", "datum          aietrs89", "spheroid      grs80", "units         meters")):
            # Whitespace-independent fallback for the legacy ESRI projection sidecar.
            compact = " ".join(prj_text.split())
            if not all(t in compact for t in ("projection utm", "zone 30", "datum aietrs89", "spheroid grs80", "units meters")):
                raise ValueError(f"{row['HOJA']}: unrecognized PRJ signature")
        asc_path = workdir / (row["HOJA"] + ".asc")
        asc_path.write_bytes(z.read(asc[0]))
    with rasterio.open(asc_path) as src:
        if abs(src.transform.a - 1) > 1e-6 or abs(src.transform.e + 1) > 1e-6:
            raise ValueError(f"{row['HOJA']}: expected 1 m cells")
        # The source PRJ signature has been checked; write an equivalent, explicit EPSG:25830 working copy.
        profile = src.profile.copy()
        profile.update(driver="GTiff", crs=CRS.from_epsg(25830), compress="DEFLATE", predictor=3)
        tile_tif = workdir / (row["HOJA"] + ".tif")
        with rasterio.open(tile_tif, "w", **profile) as dst:
            dst.write(src.read(1), 1)
    return rasterio.open(tile_tif)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--availability", type=Path, required=True)
    p.add_argument("--boundary", type=Path, required=True)
    p.add_argument("--boundary-layer", default="pilot_boundary")
    p.add_argument("--output-dir", type=Path, required=True)
    a = p.parse_args()
    rows = sorted((x for x in json.loads(a.availability.read_text())["results"] if x.get("available")), key=lambda x:x["HOJA"])[:3]
    if len(rows) != 3:
        raise SystemExit(f"Need three available tiles; got {len(rows)}")
    boundary = gpd.read_file(a.boundary, layer=a.boundary_layer).to_crs("EPSG:25830")
    geom = boundary.geometry.union_all()
    a.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        workdir = Path(td)
        datasets = [read_tile(row, workdir) for row in rows]
        mosaic, transform = merge(datasets, nodata=-9999, method="first")
        profile = datasets[0].profile.copy()
        profile.update(driver="GTiff", height=mosaic.shape[1], width=mosaic.shape[2],
                       transform=transform, crs="EPSG:25830", nodata=-9999,
                       compress="DEFLATE", predictor=3, tiled=True, blockxsize=256, blockysize=256)
        mosaic_path = workdir / "three_tile_mosaic.tif"
        with rasterio.open(mosaic_path, "w", **profile) as dst:
            dst.write(mosaic)
        with rasterio.open(mosaic_path) as src:
            clipped, clipped_transform = mask(src, [geom.__geo_interface__], crop=True, nodata=-9999)
            clipped_profile = src.profile.copy()
            clipped_profile.update(height=clipped.shape[1], width=clipped.shape[2],
                                   transform=clipped_transform, nodata=-9999,
                                   tiled=True, blockxsize=256, blockysize=256)
            out_tif = a.output_dir / "gipuzkoa_mdt_relief_preview_3_tiles.tif"
            with rasterio.open(out_tif, "w", **clipped_profile) as dst:
                dst.write(clipped)
        dem = clipped[0].astype("float32")
        valid = np.isfinite(dem) & (dem != -9999)
        if valid.sum() == 0:
            raise ValueError("No valid elevation cells after clipping")
        # Hillshade from the 1 m DEM; displayed at reduced image resolution for usability.
        gy, gx = np.gradient(np.where(valid, dem, np.nanmedian(dem[valid])))
        slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
        aspect = np.arctan2(-gx, gy)
        az, alt = np.deg2rad(315), np.deg2rad(45)
        shade = np.sin(alt)*np.sin(slope) + np.cos(alt)*np.cos(slope)*np.cos(az-aspect)
        shade = np.clip(shade, 0, 1)
        lo, hi = np.percentile(dem[valid], [2, 98])
        fig, ax = plt.subplots(figsize=(12, 9), dpi=180)
        img = ax.imshow(np.ma.masked_where(~valid, dem), cmap="terrain", vmin=lo, vmax=hi)
        ax.imshow(np.ma.masked_where(~valid, shade), cmap="gray", alpha=0.38, vmin=0, vmax=1)
        ax.set_axis_off()
        ax.set_title("IRRATIGIS · MDT LiDAR 2017\nRelieve sombreado · vista preliminar de 3 hojas (1 m)",
                     loc="left", fontsize=15, fontweight="bold")
        cb = fig.colorbar(img, ax=ax, fraction=0.035, pad=0.02)
        cb.set_label("Elevación (m)")
        fig.text(0.02, 0.02, "Cobertura parcial: solo 3 de 304 hojas seleccionadas. No es una cobertura provincial completa.",
                 fontsize=8, color="#444")
        fig.tight_layout()
        fig.savefig(a.output_dir / "gipuzkoa_mdt_relief_preview_3_tiles.png", bbox_inches="tight")
        plt.close(fig)
        for ds in datasets: ds.close()
    print(json.dumps({"tiles": [x["HOJA"] for x in rows], "crs":"EPSG:25830",
                      "resolution_m":1, "valid_cells":int(valid.sum()),
                      "min_elevation_m":float(np.nanmin(dem[valid])),
                      "max_elevation_m":float(np.nanmax(dem[valid])),
                      "outputs":["gipuzkoa_mdt_relief_preview_3_tiles.png","gipuzkoa_mdt_relief_preview_3_tiles.tif"]}, indent=2))


if __name__ == "__main__":
    main()
