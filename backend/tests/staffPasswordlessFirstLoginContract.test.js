"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=(p)=>fs.readFileSync(path.resolve(__dirname,"..",p),"utf8");
const source=read("routes/staffPasswordlessRoutes.js");
test("original account enrollment from login requires signed-in same-account proof",()=>{
 assert.match(source,/router\.post\("\/start\/verified",requireAuth/);
 assert.match(source,/isOriginalSystemAdministrator\(req\.user\)/);
 assert.match(source,/isOriginalSystemAdministrator\(candidate\)/);
 assert.match(source,/Number\(candidate\.id\)!==Number\(req\.user\.id\)/);
 assert.match(source,/created_at>=DATE_SUB\(UTC_TIMESTAMP\(\),INTERVAL 10 MINUTE\)/);
 assert.match(source,/revoked_at IS NULL/);
 assert.match(source,/expires_at>UTC_TIMESTAMP\(\)/);
 assert.match(source,/if\(await enrolled\(candidate\.id\)\)return deny\(res,409\)/);
});
test("ordinary first-time staff still use SMS, original account never has anonymous bypass",()=>{
 assert.match(source,/if\(isOriginalSystemAdministrator\(user\)&&!alreadyEnrolled\)/);
 assert.match(source,/router\.post\("\/first-setup\/verify"/);
 assert.match(source,/bcrypt\.compare\(password,user\.password_hash\)/);
 assert.match(source,/challengeRow\(conn,token,\["admin_setup"\]\)/);
 assert.match(source,/getSmsConfig\(\)/);
 assert.match(source,/sendSmsAlertToPhone/);
 assert.match(source,/\/sms\/verify/);
 assert.match(source,/\/setup\/confirm/);
});
test("authenticator and recovery code sign-in remain separate from bootstrap",()=>{
 assert.match(source,/router\.post\("\/verify"/);
 assert.match(source,/staff_passwordless_backup_codes/);
 assert.match(source,/counter>Number\(credential\.last_totp_counter\)/);
});
