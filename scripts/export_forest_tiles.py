#!/usr/bin/env python3
"""Export vector PBF tiles from a forest MBTiles database to XYZ static files."""
import argparse
import sqlite3
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mbtiles", type=Path, help="Input forest MBTiles")
    parser.add_argument("--out", type=Path, default=Path("forest-tiles"))
    args = parser.parse_args()
    db = sqlite3.connect(f"file:{args.mbtiles.resolve()}?mode=ro", uri=True)
    rows = db.execute("SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles")
    count = 0
    for z, x, y_tms, data in rows:
        y_xyz = (1 << z) - 1 - y_tms
        target = args.out / str(z) / str(x) / f"{y_xyz}.pbf"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        count += 1
    db.close()
    print(f"Exported {count} tiles to {args.out.resolve()}")

if __name__ == "__main__":
    main()
