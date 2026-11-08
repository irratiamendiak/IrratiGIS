import unittest

import numpy as np

from wildfire.terrain.prepare_landscape import derive_slope_aspect, validate_layer


class LandscapePreparationTests(unittest.TestCase):
    def test_slope_and_aspect_are_derived_in_degrees(self):
        rows, cols = np.indices((9, 9))
        elevation = 100.0 - 2.0 * rows + cols
        slope, aspect = derive_slope_aspect(elevation, 10.0)
        expected_slope = np.degrees(np.arctan(np.hypot(0.1, 0.2)))
        self.assertAlmostEqual(float(slope[4, 4]), expected_slope, places=4)
        self.assertGreaterEqual(float(aspect[4, 4]), 0.0)
        self.assertLess(float(aspect[4, 4]), 360.0)

    def test_nodata_neighbourhood_is_masked(self):
        elevation = np.arange(81, dtype=np.float32).reshape(9, 9)
        elevation[4, 4] = np.nan
        slope, aspect = derive_slope_aspect(elevation, 10.0)
        self.assertTrue(np.isnan(slope[4, 4]))
        self.assertTrue(np.isnan(aspect[3, 4]))
        self.assertTrue(np.isfinite(slope[1, 1]))

    def test_fuel_model_requires_integer_codes(self):
        with self.assertRaisesRegex(ValueError, "integer class codes"):
            validate_layer("fuel_model", np.array([[1.0, 2.5]], dtype=np.float32))

    def test_canopy_cover_range_is_checked(self):
        with self.assertRaisesRegex(ValueError, "outside expected range"):
            validate_layer("canopy_cover", np.array([[0.0, 105.0]], dtype=np.float32))

    def test_empty_layer_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "no valid cells"):
            validate_layer("slope", np.full((2, 2), np.nan))


if __name__ == "__main__":
    unittest.main()
