import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadProvider(images) {
  const sandbox = {
    window: {},
    GeoTIFF: {
      fromUrl: async () => ({
        getImageCount: async () => images.length,
        getImage: async i => images[i]
      })
    }
  };
  sandbox.window.GeoTIFF = sandbox.GeoTIFF;
  vm.runInNewContext(fs.readFileSync("wildfire/terrain/mdt-cog-provider.js", "utf8"), sandbox);
  return sandbox.window.IrratiMdtProvider;
}

function fakeImage(resolution) {
  return {
    getResolution: () => [resolution, -resolution],
    getOrigin: () => [0, 100],
    getWidth: () => 100,
    getHeight: () => 100,
    getFileDirectory: () => ({ GDAL_NODATA: "-9999" }),
    readRasters: async ({ window: w }) => {
      const [x0, y0, x1, y1] = w;
      const out = new Float32Array((x1-x0)*(y1-y0));
      for (let y=y0; y<y1; y++) for (let x=x0; x<x1; x++) {
        out[(y-y0)*(x1-x0)+(x-x0)] = x + y;
      }
      return out;
    }
  };
}

test("selects overview closest to target resolution and samples projected coordinates", async () => {
  const provider = loadProvider([fakeImage(1), fakeImage(8), fakeImage(16), fakeImage(32)]);
  const reader = provider.create({ url: "https://example.test/dem.tif", targetResolutionM: 14 });
  const info = await reader.open();
  assert.equal(info.resolutionM, 16);
  await reader.loadBounds([10, 80, 20, 90]);
  const value = reader.sample(12.5, 87.5);
  assert.ok(Number.isFinite(value));
  assert.equal(value, 22);
});

test("returns NaN outside the loaded window", async () => {
  const provider = loadProvider([fakeImage(14)]);
  const reader = provider.create({ url: "https://example.test/dem.tif" });
  await reader.open();
  await reader.loadBounds([10, 80, 20, 90]);
  assert.ok(Number.isNaN(reader.sample(500, 500)));
});

test("refuses to open without a configured URL", async () => {
  const provider = loadProvider([fakeImage(14)]);
  const reader = provider.create({ url: "" });
  await assert.rejects(reader.open(), /URL del MDT provincial/);
});
