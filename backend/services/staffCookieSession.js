"use strict";
const crypto=require("node:crypto");
const STAFF_ORIGIN="https://work.chalin03.com";
const API_HOST="api.chalin03.com";
const COOKIE="__Host-chalin03-staff-session";
const MARKER="c03-cookie-v1.";
const MAX_SECONDS=8*60*60;
const JWT_PATTERN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
function enabled(env=process.env){return env.STAFF_COOKIE_SESSIONS_ENABLED==="true";}
function staffRequest(req){return req.headers?.origin===STAFF_ORIGIN&&String(req.headers?.host||"").toLowerCase()===API_HOST;}
function markerFor(jwt){return MARKER+crypto.createHash("sha256").update("CHALIN03-cookie-session-v1:"+jwt).digest("hex");}
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function getCookie(raw){
 if(typeof raw!=="string"||raw.length>16000)return null;
 const matches=raw.split(";").map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+"="));
 if(matches.length!==1)return null;
 const token=matches[0].slice(COOKIE.length+1);
 return token.length<=3800&&JWT_PATTERN.test(token)?token:null;
}
function resolveStaffBearer(req,bearer){
 if(typeof bearer!=="string"||!bearer.startsWith(MARKER))return {token:bearer,cookie:false};
 if(!staffRequest(req)||!/^c03-cookie-v1\.[a-f0-9]{64}$/.test(bearer))return {token:null,cookie:false};
 const token=getCookie(req.headers?.cookie);
 if(!token||!equal(markerFor(token),bearer))return {token:null,cookie:false};
 return {token,cookie:true};
}
function cookieOptions(){return {httpOnly:true,secure:true,sameSite:"strict",path:"/"};}
function issueStaffSession(req,res,data,env=process.env){
 if(!enabled(env)||!staffRequest(req))return data;
 const token=data?.token;
 if(typeof token!=="string"||token.length>3800||!JWT_PATTERN.test(token))throw new Error("Session credential could not be delivered securely");
 res.cookie(COOKIE,token,{...cookieOptions(),maxAge:MAX_SECONDS*1000});
 res.set("Cache-Control","no-store");
 return {...data,token:markerFor(token),session_transport:"http_only_cookie"};
}
function clearStaffSession(req,res){
 if(req.staffCookieSession===true&&staffRequest(req))res.clearCookie(COOKIE,cookieOptions());
}
module.exports={enabled,staffRequest,markerFor,resolveStaffBearer,issueStaffSession,clearStaffSession,COOKIE,MARKER};
