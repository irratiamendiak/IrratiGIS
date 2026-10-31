"""Inspect raster metadata inside a source ZIP without building a mosaic."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path

import rasterio

from wildfire.ingestion.download_source import safe_extract_zip

RASTER_SUFFIXES = {".tif", ".tiff", ".asc", ".img", ".vrt", ".bil"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def infer_epsg_from_prj(text: str) -> str | None:
    """Recognize the explicit geoEuskadi ETRS89 / UTM zone 30 sidecar signature."""
    normalized = re.sub(r"\s+", " ", text.upper())
    if ("AI_ETRS89" in normalized and "UTM" in normalized
            and re.search(r"ZONE\s+30\b", normalized)
            and "GRS80" in normalized):
        return "EPSG:25830"
    return None


def inspect_archive(archive: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="irrati-mdt-") as tmp:
        extracted = safe_extract_zip(archive, Path(tmp))
        rasters = sorted(
            path for path in Path(tmp).rglob("*")
            if path.is_file() and path.suffix.lower() in RASTER_SUFFIXES
        )
        if not rasters:
            raise ValueError(
                "ZIP contains no supported raster (.tif, .tiff, .asc, .img, .vrt, .bil)"
            )
        records = []
        for path in rasters:
            with rasterio.open(path) as ds:
                bounds = ds.bounds
                prj_path = path.with_suffix(".prj")
                prj_text = (
                    prj_path.read_text(encoding="utf-8", errors="replace")
                    if prj_path.exists() else None
                )
                inferred_epsg = infer_epsg_from_prj(prj_text) if prj_text else None
                records.append({
                    "member": path.relative_to(tmp).as_posix(),
                    "driver": ds.driver,
                    "width": ds.width,
                    "height": ds.height,
                    "band_count": ds.count,
                    "dtypes": list(ds.dtypes),
                    "crs": ds.crs.to_string() if ds.crs else None,
                    "crs_epsg": ds.crs.to_epsg() if ds.crs else None,
                    "crs_inferred_from_prj": inferred_epsg,
                    "projection_file": prj_path.relative_to(tmp).as_posix() if prj_text else None,
                    "projection_text": prj_text,
                    "transform": list(ds.transform)[:6],
                    "bounds": [bounds.left, bounds.bottom, bounds.right, bounds.top],
                    "resolution": list(ds.res),
                    "nodata": ds.nodata,
                    "block_shapes": [list(shape) for shape in ds.block_shapes],
                })
        return {
            "archive": archive.name,
            "archive_bytes": archive.stat().st_size,
            "archive_sha256": sha256_file(archive),
            "extracted_members": extracted,
            "rasters": records,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        report = inspect_archive(args.archive)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
