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
      noData = rawNoData === undefined ? null : Number(String(rawNoData).replace(/\0/g, "").replace(/\\0/g, "").trim());
      return {width:image.getWidth(),height:image.getHeight(),resolutionM:sourceResolution,noData};
    }
    function windowForBounds(bounds25830) {
      if (!Array.isArray(bounds25830) || bounds25830.length !== 4 ||
          !bounds25830.every(Number.isFinite) ||
          !(bounds25830[0] < bounds25830[2]) || !(bounds25830[1] < bounds25830[3])) {
        throw new TypeError("Los límites del MDT deben ser [xmin, ymin, xmax, ymax] en EPSG:25830.");
      }
      const xs=[bounds25830[0],bounds25830[2]], ys=[bounds25830[1],bounds25830[3]];
      const corners=[[xs[0],ys[0]],[xs[0],ys[1]],[xs[1],ys[0]],[xs[1],ys[1]]].map(([x,y])=>pixelOf(x,y));
      const pad=3, px=corners.map(p=>p[0]), py=corners.map(p=>p[1]);
      const x0=Math.floor(Math.min(...px))-pad, y0=Math.floor(Math.min(...py))-pad;
      const x1=Math.ceil(Math.max(...px))+pad+1, y1=Math.ceil(Math.max(...py))+pad+1;
      return {x0,y0,x1,y1};
    }
    async function canLoadBounds(bounds25830) {
      if (!image) await open();
      const w=windowForBounds(bounds25830);
      return w.x0>=0&&w.y0>=0&&w.x1<=image.getWidth()&&w.y1<=image.getHeight()&&w.x1>w.x0&&w.y1>w.y0;
    }
    async function loadBounds(bounds25830) {
      if (!image) await open();
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
      // Reuse the current raster when it already contains the requested window.
      // This is common when the user reruns a scenario from the same ignition.
      if (raster && windowInfo &&
          x0>=windowInfo.x0 && y0>=windowInfo.y0 &&
          x1<=windowInfo.x1 && y1<=windowInfo.y1) {
        return {resolutionM:sourceResolution,width:windowInfo.width,height:windowInfo.height,
          cells:windowInfo.width*windowInfo.height,reused:true};
      }
      raster=await image.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true});
      windowInfo={x0,y0,x1,y1,width:x1-x0,height:y1-y0};
      return {resolutionM:sourceResolution,width:windowInfo.width,height:windowInfo.height,
        cells:windowInfo.width*windowInfo.height,reused:false};
    }
    function sample(x,y) {
      if(!image||!raster||!windowInfo) return NaN;
      const p=pixelOf(x,y), fx=p[0]-.5-windowInfo.x0, fy=p[1]-.5-windowInfo.y0;
      const ix=Math.floor(fx),iy=Math.floor(fy),ax=fx-ix,ay=fy-iy;
      const at=(col,row)=>{
        if(col<0||row<0||col>=windowInfo.width||row>=windowInfo.height) return NaN;
        const v=Number(raster[row*windowInfo.width+col]);
        if(!Number.isFinite(v)) return NaN;
        if(noData!==null && (Number.isNaN(noData)?Number.isNaN(v):v===noData)) return NaN;
        return v;
      };
      // Interpolar con los píxeles válidos. En MDT LiDAR pueden existir
      // celdas NoData aisladas (vegetación/agua/bordes); exigir siempre los
      // cuatro vecinos hacía fallar incluso la ignición aunque el COG y su
      // cobertura estuvieran correctamente cargados.
      const corners=[
        [ix,iy,(1-ax)*(1-ay)],
        [ix+1,iy,ax*(1-ay)],
        [ix,iy+1,(1-ax)*ay],
        [ix+1,iy+1,ax*ay]
      ];
      let weighted=0,weight=0;
      for(const [col,row,w] of corners){
        if(w<=1e-9) continue;
        const v=at(col,row);
        if(Number.isFinite(v)){weighted+=v*w;weight+=w;}
      }
      if(weight>1e-9) return weighted/weight;
      // Si el centro cae justo sobre una celda NoData, utilizar el píxel
      // válido más cercano dentro de un radio máximo de 1,5 celdas.
      let nearest=NaN,best=Infinity;
      for(let row=Math.max(0,iy-1);row<=Math.min(windowInfo.height-1,iy+2);row++){
        for(let col=Math.max(0,ix-1);col<=Math.min(windowInfo.width-1,ix+2);col++){
          const v=at(col,row); if(!Number.isFinite(v)) continue;
          const dist=Math.hypot(col-(fx),row-(fy));
          if(dist<=1.5&&dist<best){best=dist;nearest=v;}
        }
      }
      return nearest;
    }
    return {open,canLoadBounds,loadBounds,sample,get resolutionM(){return sourceResolution;},get loadedBounds(){return windowInfo?{...windowInfo}:null;}};
  }
  root.IrratiMdtProvider={create};
})(window);
