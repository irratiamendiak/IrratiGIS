const ORIGIN="https://irratiamendiak.github.io";
const SERVICE="IRRATIGIS_BACKEND";
function cors(origin=""){return {"Access-Control-Allow-Origin":origin===ORIGIN?origin:ORIGIN,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization, security-token, security-user-id","Vary":"Origin"}}
function out(body,status,origin,extra={}){const h=new Headers(cors(origin));Object.entries(extra).forEach(([k,v])=>h.set(k,v));return new Response(body,{status,headers:h})}
export default {async fetch(request,env){const origin=request.headers.get("Origin")||"";if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});const u=new URL(request.url);if(!u.pathname.startsWith("/api/"))return out("Not found",404,origin);if(u.pathname==="/api/meteosat"&&request.method==="GET"){
  const slot=(u.searchParams.get("slot")||"").replace(/[^0-9]/g,"");
  if(!/^\d{12}$/.test(slot))return out("Invalid slot",400,origin);
  const y=slot.slice(0,4),m=slot.slice(4,6),d=slot.slice(6,8);
  const remote=`https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MSG/FRP-PIXEL/HDF5/${y}/${m}/${d}/HDF5_LSASAF_MSG_FRP-PIXEL-ListProduct_MSG-Disk_${slot}`;
  try{
    const r=await fetch(remote,{cf:{cacheTtl:0,cacheEverything:false}});
    if(!r.ok)return out("Upstream unavailable",r.status,origin);
    return out(r.body,200,origin,{"Content-Type":r.headers.get("Content-Type")||"application/octet-stream","Cache-Control":"public,max-age=300"});
  }catch(e){return out("Upstream error",502,origin)}
}
const upstream=await env[SERVICE].fetch(new Request(request));const outHeaders=new Headers(upstream.headers);outHeaders.set("Cache-Control","no-store");for(const [k,v] of Object.entries(cors(origin)))outHeaders.set(k,v);return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:outHeaders})}};
