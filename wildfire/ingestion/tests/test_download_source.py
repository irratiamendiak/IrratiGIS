import tempfile
import unittest
import zipfile
from pathlib import Path
from wildfire.ingestion.download_source import safe_extract_zip


class SafeZipExtractionTests(unittest.TestCase):
    def test_extracts_regular_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / "ok.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.writestr("boundary/territories.shp", b"shape")
            extracted = safe_extract_zip(archive, root / "out")
            self.assertEqual(extracted, ["boundary/territories.shp"])
            self.assertEqual((root / "out/boundary/territories.shp").read_bytes(), b"shape")

    def test_rejects_parent_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / "bad.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.writestr("../escape.txt", b"bad")
            with self.assertRaises(ValueError):
                safe_extract_zip(archive, root / "out")
            self.assertFalse((root / "escape.txt").exists())


if __name__ == "__main__":
    unittest.main()
