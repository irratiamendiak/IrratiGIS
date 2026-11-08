/* IrratiGIS provincial MDT reader.
 * Reads a regional window from a Cloud Optimized GeoTIFF (COG) using HTTP Range.
 * The source URL is configured in wildfire/terrain-config.js. No data is bundled here.
 */
(function (root) {
  "use strict";
  function create(options) {
    const url = options && options.url;
    const targetResolution = (options && options.targetResolutionM) || 14;
    let image = null, raster = null, windowInfo = null, noData = null, sourceResolution = null;
    function pixelOf(x, y) {
      const origin = image.getOrigin(), resolution = image.getResolution();
      return [(x-origin[0])/resolution[0], (y-origin[1])/resolution[1]];
    }
    async function open() {
      if (!url) throw new Error("No se ha configurado la URL del MDT provincial.");
      if (!root.GeoTIFF || typeof root.GeoTIFF.fromUrl !== "function") throw new Error("No se ha podido cargar el lector GeoTIFF.");
      const tiff = await root.GeoTIFF.fromUrl(url, { forceXHR: true });
      const count = await tiff.getImageCount();
      let chosen = await tiff.getImage(0), best = Infinity;
      for (let i=0;i<count;i++) {
        const candidate=await tiff.getImage(i), res=candidate.getResolution();
        const size=Math.max(Math.abs(res[0]),Math.abs(res[1]));
        if (!Number.isFinite(size)||size<=0) continue;
        const score=Math.abs(Math.log(size/targetResolution));
        if(score<best){best=score;chosen=candidate;}
      }
      image=chosen;
      const res=image.getResolution();
      sourceResolution=Math.max(Math.abs(res[0]),Math.abs(res[1]));
      const rawNoData=image.getFileDirectory()?.GDAL_NODATA;
      noData=rawNoData===undefined?null:Number(String(rawNoData).replace(/\0/g,""));
      return {width:image.getWidth(),height:image.getHeight(),resolutionM:sourceResolution,noData};
    }
    async function loadBounds(bounds25830) {
      if(!image) await open();
      const xs=[bounds25830[0],bounds25830[2]], ys=[bounds25830[1],bounds25830[3]];
      const corners=[[xs[0],ys[0]],[xs[0],ys[1]],[xs[1],ys[0]],[xs[1],ys[1]]].map(([x,y])=>pixelOf(x,y));
      const pad=3;
      const x0=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[0])))-pad);
      const y0=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[1])))-pad);
      const x1=Math.min(image.getWidth(),Math.ceil(Math.max(...corners.map(p=>p[0])))+pad+1);
      const y1=Math.min(image.getHeight(),Math.ceil(Math.max(...corners.map(p=>p[1])))+pad+1);
      if(x1<=x0||y1<=y0) throw new Error("La ventana solicitada queda fuera de la cobertura del MDT.");
      raster=await image.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true});
      windowInfo={x0,y0,x1,y1,width:x1-x0,height:y1-y0};
      return {resolutionM:sourceResolution,width:windowInfo.width,height:windowInfo.height,cells:windowInfo.width*windowInfo.height};
    }
    function sample(x,y) {
      if(!image||!raster||!windowInfo) return NaN;
      const p=pixelOf(x,y), fx=p[0]-.5-windowInfo.x0, fy=p[1]-.5-windowInfo.y0;
      const ix=Math.floor(fx),iy=Math.floor(fy),ax=fx-ix,ay=fy-iy;
      if(ix<0||iy<0||ix+1>=windowInfo.width||iy+1>=windowInfo.height) return NaN;
      const at=(col,row)=>{const v=Number(raster[row*windowInfo.width+col]);return Number.isFinite(v)&&(noData===null||v!==noData)?v:NaN;};
      const a=at(ix,iy),b=at(ix+1,iy),c=at(ix,iy+1),d=at(ix+1,iy+1);
      if(![a,b,c,d].every(Number.isFinite)) return NaN;
      return a*(1-ax)*(1-ay)+b*ax*(1-ay)+c*(1-ax)*ay+d*ax*ay;
    }
    return {open,loadBounds,sample,get resolutionM(){return sourceResolution;},get loadedBounds(){return windowInfo?{...windowInfo}:null;}};
  }
  root.IrratiMdtProvider={create};
})(window);
