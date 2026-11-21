/** CHALIN03's public businesses are independent browser origins.
 * This follows the canonical-host boundary pattern used by KOFAD.
 * Production cross-division navigation must NOT use /shop on the current host.
 */
export const OFFICIAL_SITES=Object.freeze({
  company:"https://chalin03.com",
  homepage:"https://homepage.chalin03.com",
  parts:"https://spareparts.chalin03.com",
  excavators:"https://excavators.chalin03.com",
  machines:"https://machines.chalin03.com",
  motorcycles:"https://motorcycles.chalin03.com",
  automobiles:"https://automobiles.chalin03.com",
  gold:"https://gold.chalin03.com",
  transport:"https://transport.chalin03.com",
  hire:"https://hire.chalin03.com",
  help:"https://help.chalin03.com",
  work:"https://work.chalin03.com",
});
export const PATH_ON_PREVIEW=Object.freeze({
  company:"/",homepage:"/",parts:"/shop",excavators:"/excavators",machines:"/heavy-machines",
  motorcycles:"/motorcycles",automobiles:"/automobiles",gold:"/gold",
  transport:"/machine-transport",hire:"/equipment-hire-services",
  help:"/customer-help",work:"/login",
});
export const SECTOR_TO_SITE=Object.freeze({
  excavators:"excavators","heavy-machines":"machines",
  motorcycles:"motorcycles",automobiles:"automobiles",gold:"gold",
  "machine-transport":"transport","equipment-hire":"hire",
  "spare-parts":"parts",general:"help",
});
function previewHost(hostname){
 return hostname==="localhost"||hostname==="127.0.0.1"||hostname.endsWith(".pages.dev")||hostname.endsWith(".railway.app");
}
export function siteForHostname(hostname){
 const host=String(hostname||"").toLowerCase().replace(/:\d+$/,"");
 const found=Object.entries(OFFICIAL_SITES).find(([,origin])=>new URL(origin).hostname===host);
 return found?.[0]|| (host==="www.chalin03.com"?"company":null);
}
export function siteHref(site,path="",query=""){
 const key=Object.hasOwn(OFFICIAL_SITES,site)?site:"company";
 const hostname=typeof window==="undefined"?"":window.location.hostname;
 const preview=previewHost(hostname);
 const relative=String(path||"").replace(/^\/+/, "");
 const finalUrl=preview ? (relative?"/"+relative:PATH_ON_PREVIEW[key]) : (OFFICIAL_SITES[key]+"/"+relative);
 const qs=String(query||"").replace(/^\?/,"");
 return qs?finalUrl+(finalUrl.includes("?")?"&":"?")+qs:finalUrl;
}
export function sectorHref(sector,model=""){
 const key=SECTOR_TO_SITE[sector]||"help";
 const q=new URLSearchParams({sector});
 if(model)q.set("model",model);
 return siteHref(key,"enquire",q.toString());
}
export function getOfficialSite(){
 return typeof window==="undefined"?null:siteForHostname(window.location.hostname);
}
