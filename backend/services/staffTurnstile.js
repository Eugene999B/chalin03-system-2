"use strict";
const ACTION="staff_login";
const ALLOWED_HOSTS=new Set(["work.chalin03.com","chalin03.com","www.chalin03.com"]);
function turnstileConfig(env=process.env){
 const siteKey=String(env.STAFF_TURNSTILE_SITE_KEY||"").trim();
 const secret=String(env.STAFF_TURNSTILE_SECRET_KEY||"").trim();
 return {siteKey,secret,enabled:Boolean(siteKey||secret),ready:Boolean(siteKey&&secret)};
}
async function verifyStaffTurnstile(token,{env=process.env,fetchImpl=globalThis.fetch}={}){
 const c=turnstileConfig(env);
 if(!c.enabled)return {ok:true};
 if(!c.ready)return {ok:false,unavailable:true};
 if(typeof token!=="string"||token.length===0||token.length>2048)return {ok:false};
 try{
  const response=await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
   method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
   body:new URLSearchParams({secret:c.secret,response:token}),signal:AbortSignal.timeout(6000)
  });
  if(!response.ok)return {ok:false,unavailable:true};
  const result=await response.json();
  return {ok:result.success===true&&result.action===ACTION&&ALLOWED_HOSTS.has(String(result.hostname||"").toLowerCase())};
 }catch{return {ok:false,unavailable:true};}
}
module.exports={turnstileConfig,verifyStaffTurnstile};
