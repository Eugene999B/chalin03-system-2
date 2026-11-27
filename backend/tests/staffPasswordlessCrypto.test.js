"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {totpAt}=require("../services/ownerMfaService"),f=require("../services/staffPasswordlessCrypto");
const env={STAFF_PASSWORDLESS_HMAC_KEY:"A".repeat(48),
 STAFF_PASSWORDLESS_ENCRYPTION_KEY:"B".repeat(48),STAFF_PASSWORDLESS_PILOT:"true"};
test("feature disabled unless explicitly configured",()=>{
 assert.equal(f.assertConfigured({}),false);assert.equal(f.assertConfigured(env),true);
 assert.throws(()=>f.assertConfigured({...env,STAFF_PASSWORDLESS_HMAC_KEY:"short"}),/32/);
 assert.throws(()=>f.assertConfigured({...env,STAFF_PASSWORDLESS_ENCRYPTION_KEY:env.STAFF_PASSWORDLESS_HMAC_KEY}),/independent/);
});
test("challenge and OTP digests are scoped and non-reversible",()=>{
 const token=f.newChallenge(),otp=f.newSmsCode(),hash=f.smsDigest(token,otp,env);
 assert.match(otp,/^\d{6}$/);assert.match(hash,/^[a-f0-9]{64}$/);
 assert.equal(f.verifySms(token,otp,hash,env),true);
 assert.equal(f.verifySms(token,"123",hash,env),false);
 assert.equal(f.verifySms(f.newChallenge(),otp,hash,env),false);
 assert.notEqual(f.digestChallenge(token,env),token);
});
test("encrypted TOTP secret can only be opened with the correct key and tag",()=>{
 const v=f.newAuthenticator("worker"),box=f.encryptSecret(v.secret,env);
 assert.notEqual(box.ciphertext,v.secret);
 assert.equal(f.decryptSecret(box,env),v.secret);
 assert.throws(()=>f.decryptSecret({...box,tag:"AAAAAAAAAAAAAAAAAAAAAA=="},env));
 assert.match(v.uri,/^otpauth:\/\/totp\//);
});
test("six-digit authenticator codes match a specific counter",()=>{
 const v=f.newAuthenticator("staff"),now=Date.now(),otp=totpAt(v.secret,{timestamp:now});
 assert.equal(typeof f.matchedCounter(v.secret,otp,now),"number");
 assert.equal(f.matchedCounter(v.secret,"123",now),null);
});
test("backup codes are random and user-scoped",()=>{
 const items=f.newBackupCodes(7,env);
 assert.equal(items.length,10);assert.equal(new Set(items.map(x=>x.code)).size,10);
 for(const item of items){assert.match(item.digest,/^[a-f0-9]{64}$/);assert.notEqual(item.digest,f.recoveryDigest(9,item.code,env))}
});
test("staff notice includes short first-time procedure and no credentials",()=>{
 const v=f.noticeText();assert.match(v,/Google Authenticator/);assert.match(v,/backup codes/);assert.ok(v.length<=240);
});
