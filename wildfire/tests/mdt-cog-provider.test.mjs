import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
function loadProvider(images) {
  const sandbox={window:{}};
  sandbox.window.GeoTIFF={fromUrl:async()=>({getImageCount:async()=>images.length,getImage:async i=>images[i]})};
  vm.runInNewContext(fs.readFileSync("wildfire/terrain/mdt-cog-provider.js","utf8"),sandbox);
  return sandbox.window.IrratiMdtProvider;
}
function fakeImage(resolution) {
  return {
    getResolution:()=>[resolution,-resolution],getOrigin:()=>[0,100],getWidth:()=>100,getHeight:()=>100,
    getFileDirectory:()=>({GDAL_NODATA:"-9999"}),
    readRasters:async({window:w})=>{
      const [x0,y0,x1,y1]=w,out=new Float32Array((x1-x0)*(y1-y0));
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)out[(y-y0)*(x1-x0)+(x-x0)]=x+y;
      return out;
    }
  };
}
test("selects overview closest to target and samples projected coordinates",async()=>{
  const reader=loadProvider([fakeImage(1),fakeImage(8),fakeImage(16),fakeImage(32)]).create({url:"https://example.test/dem.tif",targetResolutionM:14});
  const info=await reader.open();assert.equal(info.resolutionM,16);
  await reader.loadBounds([160,-320,320,-160]);
  assert.equal(reader.sample(200,-228),32);
});
test("returns NaN outside loaded window",async()=>{
  const reader=loadProvider([fakeImage(14)]).create({url:"https://example.test/dem.tif"});
  await reader.open();await reader.loadBounds([160,-320,320,-160]);
  assert.ok(Number.isNaN(reader.sample(500,500)));
});
test("refuses to open without a configured URL",async()=>{
  const reader=loadProvider([fakeImage(14)]).create({url:""});
  await assert.rejects(reader.open(),/URL del MDT provincial/);
});

test("rejects a 1 m-only COG instead of loading an enormous browser window",async()=>{
  const reader=loadProvider([fakeImage(1)]).create({url:"https://example.test/dem.tif",targetResolutionM:14});
  await assert.rejects(reader.open(),/overview adecuado/);
});

test("uses the fetch-based GeoTIFF source instead of forced XHR",async()=>{
  let receivedOptions="not-called";
  const sandbox={window:{GeoTIFF:{fromUrl:async(_url,options)=>{receivedOptions=options;return {getImageCount:async()=>1,getImage:async()=>fakeImage(14)};}}}};
  vm.runInNewContext(fs.readFileSync("wildfire/terrain/mdt-cog-provider.js","utf8"),sandbox);
  const reader=sandbox.window.IrratiMdtProvider.create({url:"https://example.test/dem.tif"});
  await reader.open();
  assert.equal(receivedOptions,undefined);
});
test("explains network/Range failures when opening the COG",async()=>{
  const sandbox={window:{GeoTIFF:{fromUrl:async()=>{throw new Error("Failed to fetch");}}}};
  vm.runInNewContext(fs.readFileSync("wildfire/terrain/mdt-cog-provider.js","utf8"),sandbox);
  const reader=sandbox.window.IrratiMdtProvider.create({url:"https://example.test/dem.tif"});
  await assert.rejects(reader.open(),/HTTP Range.*Failed to fetch.*CORS/);
});

test("deduplicates concurrent opens and keeps independent raster snapshots",async()=>{
  let opens=0;
  const sandbox={window:{GeoTIFF:{fromUrl:async()=>{opens++;await Promise.resolve();return {
    getImageCount:async()=>1,getImage:async()=>fakeImage(16)
  };}}}};
  vm.runInNewContext(fs.readFileSync("wildfire/terrain/mdt-cog-provider.js","utf8"),sandbox);
  const reader=sandbox.window.IrratiMdtProvider.create({url:"https://example.test/dem.tif",targetResolutionM:16});
  const [first,second]=await Promise.all([
    reader.loadBounds([160,-320,320,-160]),
    reader.loadBounds([320,-480,480,-320])
  ]);
  assert.equal(opens,1);
  assert.equal(first.sample(200,-228),32);
  assert.equal(second.sample(360,-388),52);
});
