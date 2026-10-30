"""Download a catalogued source while preserving provenance and safe extraction."""
from __future__ import annotations
import argparse
import hashlib
import json
import shutil
import stat
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_extract_zip(archive: Path, destination: Path) -> list[str]:
    """Extract ZIP members only if every path remains inside destination."""
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    extracted: list[str] = []
    with zipfile.ZipFile(archive) as zf:
        for member in zf.infolist():
            name = member.filename
            if not name or "\x00" in name:
                raise ValueError("ZIP contains an invalid member name")
            pure = PurePosixPath(name)
            if pure.is_absolute() or "\\\\" in name or ":" in pure.parts[0] or any(part in ("..", "") for part in pure.parts):
                raise ValueError(f"Unsafe ZIP path: {name}")
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise ValueError(f"ZIP symlink is not allowed: {name}")
            target = (root / Path(*pure.parts)).resolve()
            if target != root and root not in target.parents:
                raise ValueError(f"ZIP path escapes destination: {name}")
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            extracted.append(str(target.relative_to(root)))
    return extracted


def download_source(catalog_path: Path, source_id: str, output_root: Path,
                    force: bool = False) -> dict:
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    matches = [s for s in catalog.get("sources", []) if s.get("id") == source_id]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one source with id {source_id!r}")
    source = matches[0]
    url = source.get("distribution_url")
    if not url:
        raise ValueError(f"Source {source_id} has no resolved distribution_url")
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Only HTTPS distribution URLs are allowed")
    filename = Path(parsed.path).name
    if not filename:
        raise ValueError("Distribution URL has no filename")
    source_dir = output_root / source_id
    source_dir.mkdir(parents=True, exist_ok=True)
    archive = source_dir / filename
    if archive.exists() and not force:
        raise FileExistsError(f"{archive} exists; use --force to replace it")
    request = urllib.request.Request(url, headers={"User-Agent": "IrratiGIS-Wildfire-DataIngestion/0.1"})
    with urllib.request.urlopen(request, timeout=90) as response:
        with tempfile.NamedTemporaryFile(dir=source_dir, delete=False) as tmp:
            temp_path = Path(tmp.name)
            shutil.copyfileobj(response, tmp)
    temp_path.replace(archive)
    digest = sha256_file(archive)
    extracted: list[str] = []
    if zipfile.is_zipfile(archive):
        extracted = safe_extract_zip(archive, source_dir / "extracted")
    record = {
        "source_id": source_id,
        "source_url": url,
        "landing_page": source.get("landing_page"),
        "downloaded_at_utc": datetime.now(timezone.utc).isoformat(),
        "archive_path": str(archive),
        "sha256": digest,
        "bytes": archive.stat().st_size,
        "extracted_files": extracted,
        "attribution": source.get("attribution"),
        "license": source.get("license"),
        "reference_date": source.get("reference_date"),
        "status": "downloaded_unreviewed"
    }
    (source_dir / "download_manifest.json").write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--output", type=Path, default=Path("data/raw"))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        record = download_source(args.catalog, args.source_id, args.output, args.force)
    except (OSError, ValueError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(record, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
