/**
 * KOFAD-style origin boundary for CHALIN03 Cloudflare Pages.
 * A customer on spareparts.chalin03.com gets an actual spare-parts shop,
 * not /shop stuck on whichever business site they happen to be visiting.
 * Do not forward POST, auth or payment request bodies to another origin.
 */
const ROOT="https://chalin03.com";
const HOSTS=Object.freeze({
  "chalin03.com":ROOT,
  "www.chalin03.com":ROOT,
  "homepage.chalin03.com":"https://homepage.chalin03.com",
  "spareparts.chalin03.com":"https://spareparts.chalin03.com",
  "excavators.chalin03.com":"https://excavators.chalin03.com",
  "machines.chalin03.com":"https://machines.chalin03.com",
  "motorcycles.chalin03.com":"https://motorcycles.chalin03.com",
  "automobiles.chalin03.com":"https://automobiles.chalin03.com",
  "gold.chalin03.com":"https://gold.chalin03.com",
  "transport.chalin03.com":"https://transport.chalin03.com",
  "hire.chalin03.com":"https://hire.chalin03.com",
  "help.chalin03.com":"https://help.chalin03.com",
  "work.chalin03.com":"https://work.chalin03.com"
});
const PATH_SITES=Object.freeze({
  "/shop":"https://spareparts.chalin03.com",
  "/excavators":"https://excavators.chalin03.com",
  "/heavy-machines":"https://machines.chalin03.com",
  "/motorcycles":"https://motorcycles.chalin03.com",
  "/automobiles":"https://automobiles.chalin03.com",
  "/gold":"https://gold.chalin03.com",
  "/machine-transport":"https://transport.chalin03.com",
  "/equipment-hire-services":"https://hire.chalin03.com",
  "/customer-help":"https://help.chalin03.com"
});
const SECTOR_SITES=Object.freeze({
  excavators:"https://excavators.chalin03.com",
  "heavy-machines":"https://machines.chalin03.com",
  motorcycles:"https://motorcycles.chalin03.com",
  automobiles:"https://automobiles.chalin03.com",
  gold:"https://gold.chalin03.com",
  "machine-transport":"https://transport.chalin03.com",
  "equipment-hire":"https://hire.chalin03.com",
  "spare-parts":"https://spareparts.chalin03.com",
  general:"https://help.chalin03.com"
});
const PUBLIC_HOSTS=new Set(Object.entries(HOSTS).filter(([h])=>!h.startsWith("work.")&&!h.startsWith("www.")).map(([h])=>h));
const PUBLIC_ASSETS=/^\/(?:assets\/|images\/|favicon(?:[-.]|$)|apple-touch-icon|site\.webmanifest|manifest|chalin03-logo|sw\.js$|browser-cache-recovery\.js$|robots\.txt$|sitemap\.xml$|\.well-known\/)/i;
const EXTENSION=/\.(?:css|js|mjs|webp|png|jpg|jpeg|avif|gif|ico|svg|woff2?|ttf|map|txt|xml|webmanifest)$/i;
const STAFF_PREFIXES=["/products","/new-sale","/sales-history","/installments","/debts","/reports","/audit-","/mining-","/equipment-hire-operations","/equipment-installment-finance","/group-executive-control","/online-orders","/online-catalogue","/users-settings","/backup","/system-operations"];
const STATIC_PUBLIC_PREFIXES=["/company/"];
function safeAsset(path){
 return path==="/api"||path.startsWith("/api/")||PUBLIC_ASSETS.test(path)||EXTENSION.test(path);
}
function isPrivatePath(path){
 if(path==="/login"||path==="/owner-recovery"||path==="/help"||path==="/")return false;
 return STAFF_PREFIXES.some(p=>path===p||path.startsWith(p+"/"));
}
function targetFor(url){
 const host=url.hostname.toLowerCase(),path=url.pathname;
 if(!HOSTS[host]||safeAsset(path))return null;
 if(host==="www.chalin03.com")return ROOT+path+url.search;
 const site=HOSTS[host];
 if(path==="/"){
  return null;
 }
 if(path==="/login"||path==="/owner-recovery"||path==="/help"||isPrivatePath(path)){
  return site==="https://work.chalin03.com"?null:"https://work.chalin03.com"+path+url.search;
 }
 if(path==="/enquire"){
  const sector=url.searchParams.get("sector")||"general";
  const target=SECTOR_SITES[sector]||SECTOR_SITES.general;
  return site===target?null:target+"/enquire"+url.search;
 }
 if(path==="/company"||path==="/company/")return ROOT+url.search;
 if(PATH_SITES[path]){
  const target=PATH_SITES[path];
  return target===site?target+"/"+url.search:target+"/"+url.search;
 }
 if(site==="https://work.chalin03.com"||PUBLIC_HOSTS.has(host)){
  if(path==="/")return null;
  return ROOT+"/"+url.search;
 }
 return null;
}
export async function onRequest(context){
 const request=context.request;
 const url=new URL(request.url);
 const target=targetFor(url);
 if(!target)return context.next();
 if(request.method!=="GET"&&request.method!=="HEAD"){
  return new Response("Open the page on its official CHALIN03 address before submitting.",{
   status:409,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}
  });
 }
 const destination=new URL(target);
 // Guard against redirects to non-official hosts and self-redirect loops.
 if(!Object.values(HOSTS).some(x=>destination.origin===x)||destination.href===url.href)return context.next();
 return new Response(null,{status:302,headers:{
  Location:destination.href,
  "Cache-Control":"no-store, max-age=0",
  "Vary":"Host",
  "X-Chalin03-Site-Boundary":"official-sites-v2"
 }});
}
export {HOSTS,PATH_SITES,SECTOR_SITES,targetFor};
