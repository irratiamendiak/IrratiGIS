"""Inspect GeoTIFF metadata inside a source ZIP without building a mosaic."""
from __future__ import annotations
import argparse
import json
import sys
import tempfile
from pathlib import Path
import rasterio
from wildfire.ingestion.download_source import safe_extract_zip

def inspect_archive(archive: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="irrati-mdt-") as tmp:
        extracted = safe_extract_zip(archive, Path(tmp))
        rasters = sorted(Path(tmp).rglob("*.tif")) + sorted(Path(tmp).rglob("*.tiff"))
        if not rasters:
            raise ValueError("ZIP contains no .tif/.tiff raster")
        records = []
        for path in rasters:
            with rasterio.open(path) as ds:
                bounds = ds.bounds
                records.append({
                    "member": path.relative_to(tmp).as_posix(),
                    "driver": ds.driver,
                    "width": ds.width, "height": ds.height,
                    "band_count": ds.count,
                    "dtypes": list(ds.dtypes),
                    "crs": ds.crs.to_string() if ds.crs else None,
                    "transform": list(ds.transform)[:6],
                    "bounds": [bounds.left, bounds.bottom, bounds.right, bounds.top],
                    "resolution": list(ds.res),
                    "nodata": ds.nodata,
                    "block_shapes": [list(x) for x in ds.block_shapes],
                })
        return {"archive": archive.name, "archive_bytes": archive.stat().st_size,
                "extracted_members": extracted, "rasters": records}

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
