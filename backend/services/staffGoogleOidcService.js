"use strict";
const crypto=require("node:crypto");

function configured(env=process.env){
 const clientId=String(env.GOOGLE_OIDC_CLIENT_ID||"");
 const clientSecret=String(env.GOOGLE_OIDC_CLIENT_SECRET||"");
 const redirectUri=String(env.GOOGLE_OIDC_REDIRECT_URI||"");
 return clientId.length>12&&clientSecret.length>12&&redirectUri==="https://api.chalin03.com/api/auth/passwordless/google/callback";
}
function randomUrlSafe(n=32){return crypto.randomBytes(n).toString("base64url");}
function shaBase64Url(input){return crypto.createHash("sha256").update(input).digest("base64url");}
function authorizeUrl({state,nonce,verifier,env=process.env}){
 if(!configured(env))throw new Error("Google OIDC server configuration missing");
 const u=new URL("https://accounts.google.com/o/oauth2/v2/auth");
 const entries={client_id:env.GOOGLE_OIDC_CLIENT_ID,redirect_uri:env.GOOGLE_OIDC_REDIRECT_URI,response_type:"code",
 scope:"openid email profile",state,nonce,code_challenge:shaBase64Url(verifier),code_challenge_method:"S256",prompt:"select_account"};
 for(const [k,v] of Object.entries(entries))u.searchParams.set(k,v);
 return u.toString();
}
function decodePart(base64){
 if(typeof base64!=="string"||base64.length>12000||!/^[A-Za-z0-9_-]+$/.test(base64))throw new Error("Invalid OIDC token section");
 return JSON.parse(Buffer.from(base64,"base64url").toString("utf8"));
}
function verifyGoogleIdToken(jwt,jwks,{clientId,expectedNonce,now=Date.now()}={}){
 const sections=String(jwt||"").split(".");
 if(sections.length!==3)throw new Error("Invalid Google identity token");
 const header=decodePart(sections[0]),claims=decodePart(sections[1]);
 if(header.alg!=="RS256"||header.typ&&header.typ!=="JWT"||!header.kid)throw new Error("Unsupported ID token signature");
 const jwk=(jwks?.keys||[]).find(x=>x.kid===header.kid&&x.kty==="RSA"&&x.use!=="enc"&&(!x.alg||x.alg==="RS256"));
 if(!jwk)throw new Error("Google signing key not found");
 const key=crypto.createPublicKey({key:jwk,format:"jwk"});
 const ok=crypto.verify("RSA-SHA256",Buffer.from(sections[0]+"."+sections[1]),key,Buffer.from(sections[2],"base64url"));
 if(!ok)throw new Error("Invalid Google token signature");
 const seconds=Math.floor(now/1000);
 const audience=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(!audience.includes(clientId)||claims.azp&&claims.azp!==clientId)throw new Error("Wrong Google token audience");
 if(!["https://accounts.google.com","accounts.google.com"].includes(claims.iss))throw new Error("Wrong identity issuer");
 if(typeof claims.exp!=="number"||claims.exp<=seconds||typeof claims.iat!=="number"||claims.iat>seconds+60)throw new Error("Expired Google token");
 if(typeof claims.nonce!=="string"||typeof expectedNonce!=="string"||
  !crypto.timingSafeEqual(Buffer.from(shaBase64Url(claims.nonce)),Buffer.from(shaBase64Url(expectedNonce))))throw new Error("Invalid Google nonce");
 if(!claims.sub||String(claims.sub).length>255||claims.email_verified!==true||typeof claims.email!=="string"||claims.email.length>255)throw new Error("Unverified Google identity");
 return {sub:String(claims.sub),email:claims.email};
}
async function getGoogleIdToken({code,verifier,env=process.env,fetchImpl=fetch}){
 if(!configured(env))throw new Error("Google OIDC is not configured");
 const req=new URLSearchParams({code,client_id:env.GOOGLE_OIDC_CLIENT_ID,
  client_secret:env.GOOGLE_OIDC_CLIENT_SECRET,redirect_uri:env.GOOGLE_OIDC_REDIRECT_URI,
  code_verifier:verifier,grant_type:"authorization_code"});
 const response=await fetchImpl("https://oauth2.googleapis.com/token",{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:req.toString(),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error("Google OAuth exchange failed");
 const result=await response.json();
 if(!result.id_token||String(result.id_token).length>24000)throw new Error("Google did not return a valid ID token");
 return result.id_token;
}
async function fetchGoogleJwks(fetchImpl=fetch){
 const response=await fetchImpl("https://www.googleapis.com/oauth2/v3/certs",{
  headers:{"Accept":"application/json"},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error("Google signing-key lookup failed");
 const j=await response.json();
 if(!Array.isArray(j.keys)||j.keys.length>25)throw new Error("Unexpected Google signing keys");
 return j;
}
module.exports={configured,authorizeUrl,randomUrlSafe,shaBase64Url,verifyGoogleIdToken,getGoogleIdToken,fetchGoogleJwks};
