import json
import unittest
from pathlib import Path
from wildfire.ingestion.validate_catalog import validate_catalog

CATALOG = Path(__file__).parents[1] / "sources.euskadi-gipuzkoa.json"

class CatalogueValidationTests(unittest.TestCase):
    def test_repository_catalogue_is_valid(self):
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
        self.assertEqual(validate_catalog(data), [])
    def test_rejects_non_https_landing_page(self):
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
        data["sources"][0]["landing_page"] = "http://example.org/data"
        self.assertTrue(any("landing_page" in e for e in validate_catalog(data)))
    def test_rejects_duplicate_ids(self):
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
        data["sources"][1]["id"] = data["sources"][0]["id"]
        self.assertTrue(any("duplicate source id" in e for e in validate_catalog(data)))
    def test_rejects_invalid_checksum(self):
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
        data["sources"][0]["checksum_sha256"] = "not-a-checksum"
        self.assertTrue(any("checksum_sha256" in e for e in validate_catalog(data)))

if __name__ == "__main__":
    unittest.main()
