const ORIGIN="https://feature-wildfire-propagation.irratigis-wildfire-preview.pages.dev";
const SERVICE="IRRATIGIS_BACKEND";
const ASSETS={
  "/terrain/mdt-lidar-2017-16m-deflate.cog.tif":"https://pub-997427d08539450780c6722ce7d23750.r2.dev/terrain/gipuzkoa/mdt-lidar-2017-16m-deflate.cog.tif",
  "/data/forestal.pmtiles":"https://pub-997427d08539450780c6722ce7d23750.r2.dev/neatogeo_forestal_gipuzkoa%281%29.pmtiles"
};
function cors(){
  return {
    "Access-Control-Allow-Origin":ORIGIN,
    "Access-Control-Allow-Methods":"GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, Authorization, Range, If-Range, security-token, security-user-id",
    "Access-Control-Expose-Headers":"Accept-Ranges, Content-Range, Content-Length, ETag, Last-Modified",
    "Vary":"Origin"
  };
}
function withCors(headers){
  const h=new Headers(headers);
  for(const [k,v] of Object.entries(cors()))h.set(k,v);
  return h;
}
function out(body,status,extra={}){
  const h=withCors(extra);
  h.set("Cache-Control","no-store");
  return new Response(body,{status,headers:h});
}
export default {
  async fetch(request,env){
    const u=new URL(request.url);
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors()});
    // Proxy immutable raster/vector assets and preserve byte-range responses for COG/PMTiles.
    if(ASSETS[u.pathname]){
      if(request.method!=="GET"&&request.method!=="HEAD")return out("Method not allowed",405,{"Allow":"GET, HEAD, OPTIONS"});
      const headers=new Headers();
      for(const name of ["Range","If-Range","If-None-Match"])if(request.headers.has(name))headers.set(name,request.headers.get(name));
      const upstream=await fetch(ASSETS[u.pathname],{method:request.method,headers,redirect:"follow"});
      const responseHeaders=withCors(upstream.headers);
      responseHeaders.set("Cache-Control","public, max-age=3600");
      return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
    }
    if(!u.pathname.startsWith("/api/"))return out("Not found",404);
    const upstream=await env[SERVICE].fetch(new Request(request));
    const headers=withCors(upstream.headers);
    headers.set("Cache-Control","no-store");
    return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers});
  }
};
