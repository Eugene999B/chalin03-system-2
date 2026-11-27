"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const s=require("../services/staffGoogleOidcService");
const env={GOOGLE_OIDC_CLIENT_ID:"example-app-id.apps.googleusercontent.com",
 GOOGLE_OIDC_CLIENT_SECRET:"test-not-a-real-google-secret",
 GOOGLE_OIDC_REDIRECT_URI:"https://api.chalin03.com/api/auth/passwordless/google/callback"};
test("Google link is unavailable unless credentials and exact redirect are configured",()=>{
 assert.equal(s.configured({}),false);assert.equal(s.configured(env),true);
 assert.equal(s.configured({...env,GOOGLE_OIDC_REDIRECT_URI:"https://evil.invalid/"}),false);
});
test("PKCE, OAuth state and nonce are present in Google authorization URL",()=>{
 const state=s.randomUrlSafe(),nonce=s.randomUrlSafe(),verifier=s.randomUrlSafe(48);
 const u=new URL(s.authorizeUrl({state,nonce,verifier,env}));
 assert.equal(u.origin,"https://accounts.google.com");
 assert.equal(u.searchParams.get("state"),state);
 assert.equal(u.searchParams.get("nonce"),nonce);
 assert.equal(u.searchParams.get("code_challenge"),s.shaBase64Url(verifier));
 assert.equal(u.searchParams.get("scope"),"openid email profile");
});
test("ID-token verification checks cryptographic signature, Google audience, nonce and email verification",()=>{
 const {publicKey,privateKey}=crypto.generateKeyPairSync("rsa",{modulusLength:2048});
 const jwk=publicKey.export({format:"jwk"});jwk.kid="test-key";jwk.use="sig";
 const now=Date.now(),clientId=env.GOOGLE_OIDC_CLIENT_ID,nonce="bound-random-nonce";
 function sign(c){
  const head=Buffer.from(JSON.stringify({alg:"RS256",typ:"JWT",kid:jwk.kid})).toString("base64url");
  const payload=Buffer.from(JSON.stringify(c)).toString("base64url");
  const signing=head+"."+payload,signature=crypto.sign("RSA-SHA256",Buffer.from(signing),privateKey).toString("base64url");
  return signing+"."+signature;
 }
 const claims={iss:"https://accounts.google.com",aud:clientId,sub:"uid-123456",nonce,exp:Math.floor(now/1000)+120,
  iat:Math.floor(now/1000),email:"staff@example.com",email_verified:true};
 const valid=sign(claims);
 assert.deepEqual(s.verifyGoogleIdToken(valid,{keys:[jwk]},{clientId,expectedNonce:nonce,now}),{sub:claims.sub,email:claims.email});
 assert.throws(()=>s.verifyGoogleIdToken(valid,{keys:[jwk]},{clientId:"other-client",expectedNonce:nonce,now}),/audience/);
 assert.throws(()=>s.verifyGoogleIdToken(valid,{keys:[jwk]},{clientId,expectedNonce:"other",now}),/nonce/);
 assert.throws(()=>s.verifyGoogleIdToken(sign({...claims,email_verified:false}),{keys:[jwk]},{clientId,expectedNonce:nonce,now}),/Unverified/);
 assert.throws(()=>s.verifyGoogleIdToken(sign({...claims,exp:Math.floor(now/1000)-1}),{keys:[jwk]},{clientId,expectedNonce:nonce,now}),/Expired/);
 const [head,payload,signature]=valid.split(".");
 const mutated=signature[0]==="A"?"B":"A";
 const tampered=head+"."+payload+"."+mutated+signature.slice(1);
 assert.throws(()=>s.verifyGoogleIdToken(tampered,{keys:[jwk]},{clientId,expectedNonce:nonce,now}),/signature/);
});
