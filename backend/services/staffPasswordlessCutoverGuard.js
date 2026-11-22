"use strict";
const {enforced,assertConfigured}=require("./staffPasswordlessCrypto");
const PASSWORD_ROUTES=new Set([
 "/login","/change-password","/forgot-password",
 "/recovery/request-otp","/recovery/reset-password",
 "/passkeys/authentication/options","/passkeys/authentication/verify",
 "/passkeys/authentication"
]);
function isRetiredLegacyAuthRequest(method,path){
 const m=String(method||"GET").toUpperCase();
 const p=String(path||"").split("?")[0].replace(/\/+$/,"")||"/";
 return m!=="GET"&&(PASSWORD_ROUTES.has(p)||p.startsWith("/recovery/")||p.startsWith("/passkeys/authentication/"));
}
function blockLegacySignInWhenEnforced(req,res,next){
 if(!enforced())return next();
 assertConfigured();
 if(!isRetiredLegacyAuthRequest(req.method,req.path))return next();
 res.setHeader("Cache-Control","no-store");
 return res.status(410).json({status:"error",code:"PASSWORD_SIGNIN_RETIRED",
  message:"Password access is disabled. Sign in with an Authenticator code or a one-time recovery code."});
}
module.exports={isRetiredLegacyAuthRequest,blockLegacySignInWhenEnforced};
