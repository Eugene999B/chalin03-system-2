/**
 * KOFAD-style origin boundary for CHALIN03 Cloudflare Pages.
 * A customer on spareparts.chalin03.com gets an actual spare-parts shop,
 * not /shop stuck on whichever business site they happen to be visiting.
 * Do not forward POST, auth or payment request bodies to another origin.
 */
const ROOT="https://homepage.chalin03.com";
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
  return host==="chalin03.com"?ROOT+"/"+url.search:null;
 }
 if(path==="/login"||path==="/owner-recovery"||path==="/help"||isPrivatePath(path)){
  return site==="https://work.chalin03.com"?null:"https://work.chalin03.com"+path+url.search;
 }
 if(path==="/enquire"){
  const sector=url.searchParams.get("sector")||"general";
  const target=SECTOR_SITES[sector]||SECTOR_SITES.general;
  return site===target?null:target+"/enquire"+url.search;
 }
 if(path==="/company"||path==="/company/")return ROOT+"/"+url.search;
 if(PATH_SITES[path]){
  const target=PATH_SITES[path];
  return target===site?target+"/"+url.search:target+"/"+url.search;
 }
 // Staff has many protected deep routes (finance, expenses, reports, payroll,
 // auditing, etc.). Do not redirect unknown staff paths off the staff origin.
 if(site==="https://work.chalin03.com")return null;
 if(PUBLIC_HOSTS.has(host)){
  // Unknown non-public paths are legacy staff bookmarks, not company pages.
  // Keep the original path and query when moving employees to work.
  return "https://work.chalin03.com"+path+url.search;
 }
 return null;
}

const SEARCH_INFO={
 "homepage.chalin03.com":["CHALIN03 Company Limited | Excavators, Parts, Vehicles & Gold","CHALIN03 in Dunkwa, Ghana: excavators, spare parts, heavy machinery, automobiles, motorcycles, gold buying and refining, equipment hire and transport."],
 "spareparts.chalin03.com":["Spare Parts & Lubricants | CHALIN03 Ghana","Shop excavator parts, filters, oils and tools. Browse CHALIN03 Main Store products and prices."],
 "excavators.chalin03.com":["Excavators for Sale & Installment Finance | CHALIN03 Ghana","Browse excavator makes and models. Ask about available machines, ready-cash prices and installment finance."],
 "machines.chalin03.com":["Heavy-Duty Machinery | CHALIN03 Ghana","Explore bulldozers, wheel loaders, graders, rollers and other heavy-duty machinery."],
 "automobiles.chalin03.com":["Cars, Pickups & Commercial Vehicles | CHALIN03 Ghana","Discuss available cars, pickups, SUVs and commercial vehicles with our Dunkwa team."],
 "motorcycles.chalin03.com":["Motorcycles | CHALIN03 Ghana","Explore commuter bikes, scooters, delivery motorcycles and utility bikes."],
 "gold.chalin03.com":["Gold Buying & Refining | CHALIN03 Ghana","CHALIN03 buys and refines gold. Contact our team in Dunkwa to discuss gold buying and refining services."],
 "transport.chalin03.com":["Machine Transport & Lifting | CHALIN03 Ghana","Enquire about heavy equipment loading, low-bed haulage and machine relocation."],
 "hire.chalin03.com":["Equipment Hire | CHALIN03 Ghana","Ask about excavator and equipment hire in Ghana."],
 "help.chalin03.com":["Customer Help | CHALIN03 Ghana","Contact CHALIN03 about parts, machines, vehicles, gold and equipment services."]
};
async function publicResponse(context,url){
 const host=url.hostname.toLowerCase(),path=url.pathname;
 const info=SEARCH_INFO[host];
 if((path==="/robots.txt"||path==="/sitemap.xml")&&HOSTS[host]){
  const root=host==="chalin03.com"||host==="www.chalin03.com"?ROOT:url.origin;
  const publicHost=Boolean(info)||host==="chalin03.com"||host==="www.chalin03.com";
  const robots=publicHost?"User-agent: *\nAllow: /\n\nSitemap: "+root+"/sitemap.xml\n":"User-agent: *\nDisallow: /\n";
  const sitemap='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+(publicHost?"<url><loc>"+root+"/</loc></url>":"")+'</urlset>';
  return new Response(path==="/robots.txt"?robots:sitemap,{headers:{"Content-Type":path==="/robots.txt"?"text/plain; charset=utf-8":"application/xml; charset=utf-8","Cache-Control":"public, max-age=3600"}});
 }
 const response=await context.next();
 const h=new Headers(response.headers);
 if(/^\/(?:favicon(?:[-.]|$)|apple-touch-icon\.png$)/i.test(path)&&HOSTS[host]&&host!=="work.chalin03.com"){
  h.delete("X-Robots-Tag");h.set("Cache-Control","public, max-age=86400");
  return new Response(response.body,{status:response.status,headers:h});
 }
 if(!h.get("Content-Type")?.includes("text/html"))return response;
 if(!info||path!=="/"){h.set("X-Robots-Tag","noindex, nofollow, noarchive");return new Response(response.body,{status:response.status,headers:h});}
 h.set("X-Robots-Tag","index, follow, max-image-preview:large");
 const canonical=url.origin+"/";
 const structured={"@context":"https://schema.org","@type":"WebSite",name:"CHALIN03 Company Limited",alternateName:"CHALIN03",url:canonical,publisher:{"@type":"Organization",name:"CHALIN03 Company Limited",url:ROOT+"/",logo:ROOT+"/chalin03-logo.png",telephone:"+233249469080",address:{"@type":"PostalAddress",streetAddress:"Dunkwa Police Barrier",addressLocality:"Dunkwa",addressCountry:"GH"}}};
 if(typeof HTMLRewriter==="undefined")return new Response(response.body,{status:response.status,headers:h});
 return new HTMLRewriter()
  .on("title",{element(el){el.setInnerContent(info[0]);}})
  .on('meta[name="description"]',{element(el){el.setAttribute("content",info[1]);}})
  .on('meta[name="robots"]',{element(el){el.setAttribute("content","index, follow, max-image-preview:large");}})
  .on('link[rel="canonical"]',{element(el){el.setAttribute("href",canonical);}})
  .on("head",{element(el){el.append('<script type="application/ld+json">'+JSON.stringify(structured).replace(/</g,"\\u003c")+'</script>',{html:true});}})
  .transform(new Response(response.body,{status:response.status,headers:h}));
}

export async function onRequest(context){
 const request=context.request;
 const url=new URL(request.url);
 const target=targetFor(url);
 if(!target)return publicResponse(context,url);
 if(request.method!=="GET"&&request.method!=="HEAD"){
  return new Response("Open the page on its official CHALIN03 address before submitting.",{
   status:409,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}
  });
 }
 const destination=new URL(target);
 // Guard against redirects to non-official hosts and self-redirect loops.
 if(!Object.values(HOSTS).some(x=>destination.origin===x)||destination.href===url.href)return context.next();
 const permanent=url.pathname==="/"&&(url.hostname==="chalin03.com"||url.hostname==="www.chalin03.com");
 return new Response(null,{status:permanent?301:302,headers:{
  Location:destination.href,
  "Cache-Control":"no-store, max-age=0",
  "Vary":"Host",
  "X-Chalin03-Site-Boundary":"official-sites-v2"
 }});
}
export {HOSTS,PATH_SITES,SECTOR_SITES,targetFor};
