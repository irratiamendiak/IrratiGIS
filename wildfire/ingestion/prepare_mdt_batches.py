#!/usr/bin/env python3
"""Split an MDT ZIP-availability manifest into deterministic, resumable batches.

This only prepares input manifests; it does not download source rasters.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def build_batches(rows: list[dict], batch_size: int) -> list[list[dict]]:
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    available = sorted(
        (row for row in rows if row.get("available") is True),
        key=lambda row: str(row.get("HOJA", "")),
    )
    return [available[i : i + batch_size] for i in range(0, len(available), batch_size)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--availability", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--batch-size", type=int, default=10)
    args = parser.parse_args()

    source = json.loads(args.availability.read_text(encoding="utf-8"))
    rows = source.get("results", [])
    if not isinstance(rows, list):
        parser.error("Availability manifest must contain a results array")

    batches = build_batches(rows, args.batch_size)
    if not batches:
        parser.error("No available ZIPs in availability manifest")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest_batches = []
    for index, batch in enumerate(batches, start=1):
        name = f"batch-{index:03d}.json"
        payload = {
            "batch_id": index,
            "batch_count": len(batches),
            "batch_size": args.batch_size,
            "available_count": len(batch),
            "results": batch,
        }
        encoded = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        (args.output_dir / name).write_bytes(encoded)
        manifest_batches.append({
            "batch_id": index,
            "file": name,
            "tile_count": len(batch),
            "tiles": [str(row.get("HOJA", "")) for row in batch],
            "sha256": hashlib.sha256(encoded).hexdigest(),
        })

    manifest = {
        "source": str(args.availability),
        "available_tile_count": sum(len(batch) for batch in batches),
        "batch_size": args.batch_size,
        "batch_count": len(batches),
        "resume_guidance": "Run only missing/failed batch files; completed batch outputs can be retained independently.",
        "batches": manifest_batches,
    }
    (args.output_dir / "batch-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({
        "available_tile_count": manifest["available_tile_count"],
        "batch_count": manifest["batch_count"],
        "batch_size": args.batch_size,
        "manifest": str(args.output_dir / "batch-manifest.json"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
