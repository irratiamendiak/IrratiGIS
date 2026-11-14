/* IrratiGIS provincial MDT reader.
 * Reads a regional window from a Cloud Optimized GeoTIFF (COG) using HTTP Range.
 * The source URL is configured in wildfire/terrain-config.js. No data is bundled here.
 */
(function (root) {
  "use strict";
  function create(options) {
    const url = options && options.url;
    const targetResolution = (options && options.targetResolutionM) || 14;
    let image = null, raster = null, windowInfo = null, noData = null, sourceResolution = null, opening = null;
    function pixelOf(x, y) {
      const origin = image.getOrigin(), resolution = image.getResolution();
      return [(x-origin[0])/resolution[0], (y-origin[1])/resolution[1]];
    }
    async function open() {
      if (!url) throw new Error("No se ha configurado la URL del MDT provincial.");
      if (!root.GeoTIFF || typeof root.GeoTIFF.fromUrl !== "function") throw new Error("No se ha podido cargar el lector GeoTIFF.");
      // GeoTIFF.js usa FetchSource por defecto. Forzar XHR puede convertir
      // errores CORS/Range de R2 en el mensaje opaco "Request failed".
      let tiff;
      try {
        tiff = await root.GeoTIFF.fromUrl(url);
      } catch (error) {
        const detail = error && error.message ? error.message : String(error);
        throw new Error("No se pudo abrir el COG MDT por HTTP Range (" + detail +
          "). Comprueba CORS para este dominio y que el servidor admita solicitudes GET con Range.");
      }
      const count = await tiff.getImageCount();
      const candidates = [];
      for (let i=0; i<count; i++) {
        const base = await tiff.getImage(i);
        candidates.push(base);
        // COG overviews are commonly stored as SubIFDs, not as top-level IFDs.
        // GeoTIFF.js exposes those through getOverviewCount()/getOverview().
        if (typeof base.getOverviewCount === "function" && typeof base.getOverview === "function") {
          let overviewCount = 0;
          try { overviewCount = await base.getOverviewCount(); } catch (_) {}
          for (let j=0; j<overviewCount; j++) {
            try { candidates.push(await base.getOverview(j)); } catch (_) {}
          }
        }
      }
      let chosen = null, best = Infinity;
      for (const candidate of candidates) {
        try {
          const res = candidate.getResolution();
          const origin = candidate.getOrigin();
          if (!res || !origin || !res.every(Number.isFinite) || !origin.every(Number.isFinite)) continue;
          const size = Math.max(Math.abs(res[0]), Math.abs(res[1]));
          if (!Number.isFinite(size) || size <= 0) continue;
          const score = Math.abs(Math.log(size/targetResolution));
          if (score < best) { best = score; chosen = candidate; }
        } catch (_) {
          // Ignore masks/auxiliary directories without affine georeferencing.
        }
      }
      if (!chosen) throw new Error("El COG no contiene ninguna imagen con georreferenciación afín válida.");
      image = chosen;
      const res = image.getResolution();
      sourceResolution = Math.max(Math.abs(res[0]), Math.abs(res[1]));
      if (sourceResolution < targetResolution*0.5 || sourceResolution > targetResolution*2) {
        throw new Error("No se encontró un overview adecuado: resolución más cercana detectada " +
          sourceResolution.toFixed(2) + " m (objetivo " + targetResolution + " m).");
      }
      const rawNoData = image.getFileDirectory()?.GDAL_NODATA;
      noData = rawNoData === undefined ? null : Number(String(rawNoData).replace(/\\0/g, ""));
      return {width:image.getWidth(),height:image.getHeight(),resolutionM:sourceResolution,noData};
    }
    async function ensureOpen() {
      if (image) return;
      if (!opening) opening = open();
      try { await opening; } catch (error) { opening = null; throw error; }
    }
    function windowForBounds(bounds25830) {
      const xs=[bounds25830[0],bounds25830[2]], ys=[bounds25830[1],bounds25830[3]];
      const corners=[[xs[0],ys[0]],[xs[0],ys[1]],[xs[1],ys[0]],[xs[1],ys[1]]].map(([x,y])=>pixelOf(x,y));
      const pad=3, px=corners.map(p=>p[0]), py=corners.map(p=>p[1]);
      const x0=Math.floor(Math.min(...px))-pad, y0=Math.floor(Math.min(...py))-pad;
      const x1=Math.ceil(Math.max(...px))+pad+1, y1=Math.ceil(Math.max(...py))+pad+1;
      return {x0,y0,x1,y1};
    }
    async function canLoadBounds(bounds25830) {
      await ensureOpen();
      const w=windowForBounds(bounds25830);
      return w.x0>=0&&w.y0>=0&&w.x1<=image.getWidth()&&w.y1<=image.getHeight()&&w.x1>w.x0&&w.y1>w.y0;
    }
    async function loadBounds(bounds25830) {
      await ensureOpen();
      const {x0,y0,x1,y1}=windowForBounds(bounds25830);
      // No recortar silenciosamente la ventana: el simulador necesita conocer
      // si el MDT cubre toda el área solicitada.
      if(x0<0||y0<0||x1>image.getWidth()||y1>image.getHeight()){
        throw new Error(
          "La ventana de simulación excede la cobertura del MDT LiDAR. " +
          "Solicitada (píxeles): ["+x0+","+y0+","+x1+","+y1+"], " +
          "disponible: [0,0,"+image.getWidth()+","+image.getHeight()+"]."
        );
      }
      if(x1<=x0||y1<=y0) throw new Error("La ventana solicitada queda fuera de la cobertura del MDT.");
      const nextRaster=await image.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true});
      const nextWindow={x0,y0,x1,y1,width:x1-x0,height:y1-y0};
      // Each load returns an immutable sampling snapshot. Concurrent users (3D tiles
      // and fire simulation) no longer overwrite one another's active raster window.
      raster=nextRaster;
      windowInfo=nextWindow;
      const sampleWindow=(x,y)=>{
        const p=pixelOf(x,y), fx=p[0]-.5-nextWindow.x0, fy=p[1]-.5-nextWindow.y0;
        const ix=Math.floor(fx),iy=Math.floor(fy),ax=fx-ix,ay=fy-iy;
        if(ix<0||iy<0||ix+1>=nextWindow.width||iy+1>=nextWindow.height) return NaN;
        const at=(col,row)=>{const v=Number(nextRaster[row*nextWindow.width+col]);return Number.isFinite(v)&&(noData===null||v!==noData)?v:NaN;};
        const a=at(ix,iy),b=at(ix+1,iy),c=at(ix,iy+1),d=at(ix+1,iy+1);
        if(![a,b,c,d].every(Number.isFinite)) return NaN;
        return a*(1-ax)*(1-ay)+b*ax*(1-ay)+c*(1-ax)*ay+d*ax*ay;
      };
      return {resolutionM:sourceResolution,width:nextWindow.width,height:nextWindow.height,cells:nextWindow.width*nextWindow.height,sample:sampleWindow};
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
    return {open,canLoadBounds,loadBounds,sample,get resolutionM(){return sourceResolution;},get loadedBounds(){return windowInfo?{...windowInfo}:null;}};
  }
  root.IrratiMdtProvider={create};
})(window);
