import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadAdapter(){
  let reads=0,protocol=null;
  const fakeImage={
    getResolution:()=>[1,-1],
    getOrigin:()=>[-180,90],
    getWidth:()=>360,
    getHeight:()=>180,
    getFileDirectory:()=>({GDAL_NODATA:"-9999"}),
    readRasters:async({window})=>{
      reads++;
      const [x0,y0,x1,y1]=window;
      return new Float32Array((x1-x0)*(y1-y0)).fill(123);
    }
  };
  const window={
    IRRATIGIS_MDT_COG_URL:"https://example.test/gipuzkoa-mdt.cog.tif",
    IRRATIGIS_MDT_TARGET_RESOLUTION_M:14,
    proj4:()=>({forward:([x,y])=>[x,y]}),
    GeoTIFF:{fromUrl:async()=>({getImageCount:async()=>1,getImage:async()=>fakeImage})},
    maplibregl:{addProtocol:(name,handler)=>{protocol={name,handler};}}
  };
  vm.runInNewContext(fs.readFileSync("wildfire/terrain/lidar-dem-tiles.js","utf8"),{window});
  return {api:window.IrratiLidarDemTiles,get reads(){return reads;},protocol};
}

test("registers a MapLibre raster-dem protocol backed by the provincial LiDAR COG",()=>{
  const adapter=loadAdapter();
  assert.equal(adapter.protocol.name,"lidar-dem");
  assert.equal(typeof adapter.api.getElevationGrid,"function");
});

test("reprojects and samples a LiDAR tile grid, including a one-pixel edge for Horn slope",async()=>{
  const adapter=loadAdapter();
  const grid=await adapter.api.getElevationGrid(1,1,1,1);
  assert.equal(grid.width,258);
  assert.equal(grid.data.length,258*258);
  assert.ok(grid.data.some(Number.isFinite));
  assert.ok(grid.data.filter(Number.isFinite).every(v=>v===123));
  assert.equal(adapter.reads,1);
  await adapter.api.getElevationGrid(1,1,1,1);
  assert.equal(adapter.reads,1,"repeated tile requests should use the in-memory cache");
});
