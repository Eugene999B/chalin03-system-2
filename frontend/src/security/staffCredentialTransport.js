// Credentials are only sent to the exact configured API origin. This also
// accommodates development without trusting an arbitrary absolute URL.
const STAFF_ORIGINS=new Set(["https://work.chalin03.com","https://staff.chalin03.com"]);
const API_ORIGIN="https://api.chalin03.com";
export function staffCookieCredentials(target,pageOrigin=globalThis.location?.origin){
 try{return STAFF_ORIGINS.has(pageOrigin)&&new URL(target,pageOrigin).origin===API_ORIGIN;}catch{return false;}
}
export function trustedApiTarget(target,base,pageOrigin=globalThis.location?.origin||"http://localhost:5173"){
 const allowed=new URL(base,pageOrigin),url=new URL(target,allowed.href.endsWith("/")?allowed.href:allowed.href+"/");
 if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.origin!==allowed.origin)throw new Error("Unapproved API destination");
 return url;
}
export function financeCredentialTarget(source,base,pageOrigin=globalThis.location?.origin||"http://localhost:5173"){
 const value=String(source||"").trim();
 const official=STAFF_ORIGINS.has(pageOrigin);
 const apiBase=official?API_ORIGIN+"/api":base;
 const allowed=new URL(apiBase,pageOrigin);
 let url;
 if(/^https?:\/\//i.test(value)){
  url=new URL(value);
  if(official&&url.origin===pageOrigin&&url.pathname.startsWith("/api/"))url=new URL(url.pathname+url.search,API_ORIGIN);
 }else{
  const relative=value.replace(/^\/api(?=\/)/,"").replace(/^\//,"");
  url=new URL(relative,allowed.href.replace(/\/$/,"")+"/");
 }
 if(url.username||url.password||url.origin!==allowed.origin||!url.pathname.startsWith(allowed.pathname.replace(/\/$/,"")+"/")||url.hash)throw new Error("Unapproved protected image destination");
 return url.href;
}
