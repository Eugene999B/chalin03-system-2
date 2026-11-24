"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {rotationBinding,liveRotationRow,retireAuthenticatorAccess}=require("../services/staffAuthenticatorLifecycle");
const env={STAFF_PASSWORDLESS_HMAC_KEY:"A".repeat(48)};
const user={id:7,session_id:"session-example",token_version:4};
test("rotation grant binds account, session, version and challenge",()=>{
 const hash=rotationBinding("challenge",user,env);
 assert.match(hash,/^[a-f0-9]{64}$/);
 for(const other of [{...user,id:8},{...user,session_id:"another"},{...user,token_version:5}])assert.notEqual(hash,rotationBinding("challenge",other,env));
 assert.notEqual(hash,rotationBinding("other-challenge",user,env));
});
test("rotation requires active identity and matching live session",async()=>{
 const db={query:async(sql)=>sql.includes("FROM users")?[[{id:7,is_active:1,is_login_locked:0,token_version:4}]]:sql.includes("identities")?[[{user_id:7}]]:[[{}]]};
 assert.equal(await liveRotationRow(db,user),true);
 assert.equal(await liveRotationRow(db,{...user,token_version:3}),false);
 const noSession={query:async(sql)=>sql.includes("auth_sessions")?[[]]:db.query(sql)};
 assert.equal(await liveRotationRow(noSession,user),false);
});
test("retirement invalidates all credential and session classes for only selected user",async()=>{
 const calls=[];await retireAuthenticatorAccess({query:async(sql,params)=>{calls.push({sql,params});}},7,"rotation");
 assert.equal(calls.length,6);
 assert.ok(calls.every(c=>c.params.at(-1)===7));
 for(const table of ["users","auth_sessions","protected_action_sessions","staff_passwordless_challenges","staff_passwordless_google_links","staff_passwordless_backup_codes"])assert.ok(calls.some(c=>c.sql.includes(table)));
 assert.ok(calls.every(c=>!c.sql.includes("permission")&&!c.sql.includes("role")));
});
test("public first setup rejects rotation challenges and staff reset preserves owner gate",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../routes/staffPasswordlessRoutes.js"),"utf8");
 assert.match(source,/row\.verified_at\|\|row\.pending_ciphertext/);
 assert.match(source,/router\.post\("\/account\/rotate\/start",requireAuth/);
 assert.match(source,/router\.post\("\/account\/rotate\/confirm",requireAuth/);
 assert.match(source,/safeEqualHex\(row\.sms_pin_digest,rotationBinding/);
 assert.match(source,/router\.post\("\/administrator\/revoke-authenticator",requireAuth/);
 assert.match(source,/PASSWORDLESS_ENFORCEMENT_REQUIRED/);
});
