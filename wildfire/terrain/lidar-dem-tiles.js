/* Browser-side LiDAR DEM tile adapter for MapLibre and Leaflet.
 * Reprojects the configured Gipuzkoa EPSG:25830 COG to Web Mercator tiles.
 * The source data are the provincial LiDAR MDT; Mapbox RGB is only the tile encoding.
 */
(function(root){
  "use strict";
  const CACHE_LIMIT=96;
  const cache=new Map(), pending=new Map();
  let tiffPromise=null, imagePromise=null, projector=null, noData=null;
  const url=String(root.IRRATIGIS_MDT_COG_URL||"").trim();
  const targetResolution=Number(root.IRRATIGIS_MDT_TARGET_RESOLUTION_M)||14;
  const MAX_LAT=85.0511287798066;

  function project(){
    if(projector)return projector;
    if(typeof root.proj4!=="function")throw new Error("No está disponible Proj4 para transformar el MDT LiDAR.");
    projector=root.proj4(
      "+proj=longlat +datum=WGS84 +no_defs",
      "+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs"
    );
    return projector;
  }
  async function image(){
    if(!url)throw new Error("No está configurada la URL del MDT LiDAR de Gipuzkoa.");
    if(!root.GeoTIFF||typeof root.GeoTIFF.fromUrl!=="function")throw new Error("No está disponible GeoTIFF.js para leer el MDT LiDAR.");
    if(!tiffPromise)tiffPromise=root.GeoTIFF.fromUrl(url);
    const tiff=await tiffPromise;
    if(!imagePromise)imagePromise=(async()=>{
      const count=await tiff.getImageCount();
      let chosen=null,best=Infinity;
      for(let i=0;i<count;i++){
        const base=await tiff.getImage(i), candidates=[base];
        if(typeof base.getOverviewCount==="function"&&typeof base.getOverview==="function"){
          let n=0;try{n=await base.getOverviewCount();}catch(_){}
          for(let j=0;j<n;j++)try{candidates.push(await base.getOverview(j));}catch(_){}
        }
        for(const candidate of candidates){
          try{
            const res=candidate.getResolution(),origin=candidate.getOrigin();
            if(!res||!origin||!res.every(Number.isFinite)||!origin.every(Number.isFinite))continue;
            const size=Math.max(Math.abs(res[0]),Math.abs(res[1]));
            if(!(size>0))continue;
            const score=Math.abs(Math.log(size/targetResolution));
            if(score<best){best=score;chosen=candidate;}
          }catch(_){}
        }
      }
      if(!chosen)throw new Error("El COG LiDAR no contiene una imagen georreferenciada válida.");
      const raw=chosen.getFileDirectory()?.GDAL_NODATA;
      noData=raw===undefined?null:Number(String(raw).replace(/\0/g,"").trim());
      return chosen;
    })();
    return imagePromise;
  }
  function lonLatAt(px,py,z){
    const n=Math.pow(2,z),gx=px/(256*n),gy=py/(256*n);
    const lon=gx*360-180;
    const lat=Math.atan(Math.sinh(Math.PI*(1-2*gy)))*180/Math.PI;
    return [lon,Math.max(-MAX_LAT,Math.min(MAX_LAT,lat))];
  }
  function pixelOf(img,xy){
    const origin=img.getOrigin(),res=img.getResolution();
    return [(xy[0]-origin[0])/res[0],(xy[1]-origin[1])/res[1]];
  }
  function valid(v){return Number.isFinite(v)&&(noData===null||(Number.isNaN(noData)?!Number.isNaN(v):v!==noData));}
  function touch(key,value){
    cache.delete(key);cache.set(key,value);
    while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
  }
  async function buildGrid(z,x,y,pad){
    const img=await image(), n=Math.pow(2,z), width=256+2*pad;
    const corners=[
      lonLatAt(x*256-pad,y*256-pad,z),
      lonLatAt((x+1)*256+pad,(y+1)*256+pad,z),
      lonLatAt((x+1)*256+pad,y*256-pad,z),
      lonLatAt(x*256-pad,(y+1)*256+pad,z)
    ].map(ll=>project().forward(ll)).map(xy=>pixelOf(img,xy));
    const px=corners.map(p=>p[0]),py=corners.map(p=>p[1]),margin=2;
    const x0=Math.max(0,Math.floor(Math.min(...px))-margin);
    const y0=Math.max(0,Math.floor(Math.min(...py))-margin);
    const x1=Math.min(img.getWidth(),Math.ceil(Math.max(...px))+margin+1);
    const y1=Math.min(img.getHeight(),Math.ceil(Math.max(...py))+margin+1);
    const out=new Float32Array(width*width);out.fill(NaN);
    if(x1<=x0||y1<=y0)return {width,data:out};
    const raster=await img.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true});
    const sample=(px0,py0)=>{
      if(!Number.isFinite(px0)||!Number.isFinite(py0)||px0<0||py0<0||px0>=img.getWidth()||py0>=img.getHeight())return NaN;
      const fx=px0-.5-x0,fy=py0-.5-y0,ix=Math.floor(fx),iy=Math.floor(fy),ax=fx-ix,ay=fy-iy;
      const at=(cx,cy)=>{
        if(cx<0||cy<0||cx>=x1-x0||cy>=y1-y0)return NaN;
        const v=Number(raster[cy*(x1-x0)+cx]);return valid(v)?v:NaN;
      };
      const vals=[[ix,iy,(1-ax)*(1-ay)],[ix+1,iy,ax*(1-ay)],[ix,iy+1,(1-ax)*ay],[ix+1,iy+1,ax*ay]];
      let sum=0,w=0;
      for(const [cx,cy,weight] of vals){if(weight<=1e-9)continue;const v=at(cx,cy);if(Number.isFinite(v)){sum+=v*weight;w+=weight;}}
      return w>1e-9?sum/w:NaN;
    };
    for(let row=0;row<width;row++){
      for(let col=0;col<width;col++){
        const ll=lonLatAt(x*256+col-pad+.5,y*256+row-pad+.5,z);
        const xy=project().forward(ll),p=pixelOf(img,xy);
        out[row*width+col]=sample(p[0],p[1]);
      }
    }
    return {width,data:out};
  }
  async function getElevationGrid(z,x,y,pad=0){
    const key=z+"/"+x+"/"+y+"/"+pad;
    if(cache.has(key)){const v=cache.get(key);touch(key,v);return v;}
    if(pending.has(key))return pending.get(key);
    const promise=buildGrid(z,x,y,pad).then(v=>{touch(key,v);return v;}).finally(()=>pending.delete(key));
    pending.set(key,promise);return promise;
  }
  async function pngForTile(z,x,y){
    const grid=await getElevationGrid(z,x,y,0),canvas=document.createElement("canvas");
    canvas.width=canvas.height=256;
    const ctx=canvas.getContext("2d"),im=ctx.createImageData(256,256);
    for(let i=0;i<grid.data.length;i++){
      const elevation=grid.data[i],k=i*4;
      if(!Number.isFinite(elevation)){im.data[k+3]=0;continue;}
      const encoded=Math.max(0,Math.min(16777215,Math.round((elevation+10000)*10)));
      im.data[k]=Math.floor(encoded/65536);
      im.data[k+1]=Math.floor(encoded/256)%256;
      im.data[k+2]=encoded%256;
      im.data[k+3]=255;
    }
    ctx.putImageData(im,0,0);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("No se pudo codificar la tesela LiDAR.")),"image/png"));
    return blob.arrayBuffer();
  }
  if(root.maplibregl&&typeof root.maplibregl.addProtocol==="function"){
    try{
      root.maplibregl.addProtocol("lidar-dem",async params=>{
        const match=/^lidar-dem:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
        if(!match)throw new Error("URL de tesela LiDAR no válida: "+params.url);
        const data=await pngForTile(Number(match[1]),Number(match[2]),Number(match[3]));
        return {data};
      });
    }catch(error){if(!String(error&&error.message||error).includes("already"))throw error;}
  }
  root.IrratiLidarDemTiles={getElevationGrid};
})(window);
