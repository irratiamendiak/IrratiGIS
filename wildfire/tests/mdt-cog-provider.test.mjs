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
  assert.equal(reader.sample(175,-187),32);
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

test("reuses an already loaded raster window for a contained request",async()=>{
  const image=fakeImage(14); let reads=0;
  const original=image.readRasters;
  image.readRasters=async options=>{reads++;return original(options);};
  const reader=loadProvider([image]).create({url:"https://example.test/dem.tif"});
  await reader.open();
  const first=await reader.loadBounds([160,-320,320,-160]);
  const second=await reader.loadBounds([180,-300,300,-180]);
  assert.equal(reads,1);
  assert.equal(first.reused,false);
  assert.equal(second.reused,true);
  assert.equal(reader.sample(200,-228),32);
});

test("rejects malformed projected bounds instead of issuing a raster read",async()=>{
  const reader=loadProvider([fakeImage(14)]).create({url:"https://example.test/dem.tif"});
  await reader.open();
  await assert.rejects(reader.loadBounds([10,20,10,40]),/xmin, ymin, xmax, ymax/);
  await assert.rejects(reader.canLoadBounds([0,1,2,NaN]),/xmin, ymin, xmax, ymax/);
});

test("treats GDAL no-data sentinel values as missing elevations",async()=>{
  const image=fakeImage(16);
  image.getFileDirectory=()=>({GDAL_NODATA:"-9999\\0"});
  image.readRasters=async({window:w})=>{
    const [x0,y0,x1,y1]=w,out=new Float32Array((x1-x0)*(y1-y0)).fill(100);
    out[(20-y0)*(x1-x0)+(12-x0)]=-9999;
    return out;
  };
  const reader=loadProvider([image]).create({url:"https://example.test/dem.tif"});
  await reader.open();
  await reader.loadBounds([160,-320,320,-160]);
  assert.ok(Number.isNaN(reader.sample(200,-228)));
});


test("rejects requests extending beyond the full COG raster coverage",async()=>{
  const reader=loadProvider([fakeImage(14)]).create({url:"https://example.test/dem.tif"});
  await reader.open();
  const outside=[2000,-320,2200,-160];
  assert.equal(await reader.canLoadBounds(outside),false);
  await assert.rejects(reader.loadBounds(outside),/excede la cobertura del MDT LiDAR/);
});
