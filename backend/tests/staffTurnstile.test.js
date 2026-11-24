const {test}=require("node:test");
const assert=require("node:assert/strict");
const {verifyStaffTurnstile,turnstileConfig}=require("../services/staffTurnstile");
const env={STAFF_TURNSTILE_SITE_KEY:"site-key-for-test",STAFF_TURNSTILE_SECRET_KEY:"secret-for-test"};
test("staff challenge is optional until configured and fails closed on incomplete configuration",async()=>{
 assert.equal((await verifyStaffTurnstile(undefined,{env:{}})).ok,true);
 assert.equal(turnstileConfig(env).ready,true);
 assert.deepEqual(await verifyStaffTurnstile("test",{env:{STAFF_TURNSTILE_SITE_KEY:"test"}}),{ok:false,unavailable:true});
 assert.equal((await verifyStaffTurnstile(undefined,{env})).ok,false);
});
test("staff challenge requires success, permitted hostname and expected action",async()=>{
 let sent;
 const mock=async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({success:true,hostname:"work.chalin03.com",action:"staff_login"})};};
 assert.equal((await verifyStaffTurnstile("valid-token",{env,fetchImpl:mock})).ok,true);
 assert.equal(sent.url,"https://challenges.cloudflare.com/turnstile/v0/siteverify");
 assert.equal(sent.options.body.get("response"),"valid-token");
 for(const result of [{success:false,hostname:"work.chalin03.com",action:"staff_login"},{success:true,hostname:"other.example",action:"staff_login"},{success:true,hostname:"work.chalin03.com",action:"other"}]){
 assert.equal((await verifyStaffTurnstile("token",{env,fetchImpl:async()=>({ok:true,json:async()=>result})})).ok,false);
 }
 assert.deepEqual(await verifyStaffTurnstile("token",{env,fetchImpl:async()=>{throw Error("network")}}),{ok:false,unavailable:true});
});