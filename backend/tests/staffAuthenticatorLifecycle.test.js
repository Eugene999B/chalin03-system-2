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
 assert.doesNotMatch(source,/PASSWORDLESS_ENFORCEMENT_REQUIRED/);
 assert.match(source,/verifyStaffProtectedAction\(/);
 assert.match(source,/liveRotationRow\(conn,req.user\)/);
 assert.match(source,/legacy_signin_retired:true/);
});

test("protected action approval cannot be transferred to another session or token generation",()=>{
 const {protectedActionHash}=require("../services/protectedActionHash");
 const first=protectedActionHash("test-token",user);
 assert.notEqual(first,protectedActionHash("test-token",{...user,session_id:"other"}));
 assert.notEqual(first,protectedActionHash("test-token",{...user,token_version:5}));
 assert.throws(()=>protectedActionHash("test-token",{id:7}));
});
test("Google callback may only attach to an active original initiating session",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../routes/staffGoogleLinkRoutes.js"),"utf8");
 assert.match(source,/UPDATE staff_passwordless_identities i INNER JOIN auth_sessions a ON a.user_id=i.user_id AND a.session_id=\? AND a.revoked_at IS NULL/);
});

const {unlockStaffAccess}=require("../services/staffAuthenticatorLifecycle");
const {recoveryAllowed,recoveryMode,RECOVERY_WINDOW_SQL}=require("../services/staffRecoveryPolicy");
test("owner recovery permits locked and unenrolled active ordinary staff but not protected or inactive accounts",()=>{const actor={id:1};const target={id:700,username:"staff",role:"manager",is_active:1,is_login_locked:1};assert.equal(recoveryAllowed(actor,target),true);assert.equal(recoveryAllowed(actor,{...target,is_active:0}),false);assert.equal(recoveryAllowed(actor,{...target,role:"admin"}),false);assert.equal(recoveryAllowed(actor,{...target,id:1}),false);assert.equal(recoveryMode("unknown"),null);assert.equal(recoveryMode("unlock"),"unlock");});
test("unlock revokes only selected staff sessions and outstanding challenges, retaining enrolled credentials",async()=>{const calls=[];await unlockStaffAccess({query:async(sql,params)=>calls.push({sql,params})},700);assert.equal(calls.length,5);assert.ok(calls.every(c=>c.params.at(-1)===700));assert.ok(calls.every(c=>!c.sql.includes("DELETE")&&!c.sql.includes("role")&&!c.sql.includes("permission")));assert.match(RECOVERY_WINDOW_SQL,/STAFF_ACCOUNT_SECURITY_RESET/);assert.match(RECOVERY_WINDOW_SQL,/outcome='success'/);});

test("legacy password remains retired after owner reset even without an enrolled identity",async()=>{
 const {legacyStaffLoginRetired}=require("../services/staffRecoveryPolicy");
 const calls=[];
 const db={query:async(sql,params)=>{calls.push({sql,params});return sql.includes("staff_passwordless_identities")?[[]]:[[{id:9}]];}};
 assert.equal(await legacyStaffLoginRetired(db,700),true);
 assert.deepEqual(calls.map(c=>c.params),[[700],["700"]]);
 assert.match(calls[1].sql,/STAFF_AUTHENTICATOR_REVOKED/);
 assert.equal(await legacyStaffLoginRetired({query:async()=>[[]]},700),false);
 assert.equal(await legacyStaffLoginRetired({query:async()=>[[{user_id:700}]]},700),true);
 await assert.rejects(legacyStaffLoginRetired({query:async()=>{throw Error("database unavailable");}},700));
});
test("pilot password login and password recovery consult the per-account retirement gate",()=>{
 const auth=fs.readFileSync(path.join(__dirname,"../routes/authRoutes.js"),"utf8");
 const recovery=fs.readFileSync(path.join(__dirname,"../services/accountRecoveryService.js"),"utf8");
 assert.match(auth,/await legacyStaffLoginRetired\(pool,user.id\)/);
 assert.equal((recovery.match(/await legacyStaffLoginRetired\(connection,user.id\)/g)||[]).length,2);
});
