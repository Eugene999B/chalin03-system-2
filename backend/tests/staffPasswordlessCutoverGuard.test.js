"use strict";
const assert=require("node:assert/strict"),test=require("node:test");
const {isRetiredLegacyAuthRequest}=require("../services/staffPasswordlessCutoverGuard");
test("all legacy password and biometric sign-in endpoints are retired after cutover",()=>{
 for(const p of ["/login","/forgot-password","/change-password","/recovery/request-otp",
  "/recovery/reset-password","/passkeys/authentication","/passkeys/authentication/options",
  "/passkeys/authentication/verify"])
  assert.equal(isRetiredLegacyAuthRequest("POST",p),true,p);
});
test("real TOTP and account settings endpoints remain available",()=>{
 for(const p of ["/passwordless/start","/passwordless/sms/verify","/passwordless/verify",
  "/passwordless/setup/confirm","/passwordless/administrator/start","/passwordless/google/start",
  "/passwordless/google/callback","/me","/logout"])assert.equal(isRetiredLegacyAuthRequest("POST",p),false,p);
 assert.equal(isRetiredLegacyAuthRequest("GET","/login"),false);
});
