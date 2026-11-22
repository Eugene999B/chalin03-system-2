import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const page=read("src/pages/StaffPasswordlessLogin.jsx");
const wrapper=read("src/pages/LoginPageGroupOperations.jsx");
const settings=read("src/pages/StaffAccountSecurityPage.jsx");
const css=read("src/styles/loginPasswordlessClassic.css");
const entry=read("src/pages/LoginPage.jsx");
const api=read("../backend/routes/staffPasswordlessRoutes.js");
for(const marker of ["gate4__topbar","gate4__brand","gate4__logo","gate4__online","gate4__layout",
 "gate4__workspace-tabs","gate4__context-strip","gate4__field--store","gate4__form",
 "gate4__submit","group-login--"])assert.ok(page.includes(marker),"Original design missing: "+marker);
for(const marker of ["submitIdentifier","submitSms","submitAuthenticator","stage === \"sms\"",
 "stage === \"authenticator\"","step === \"setup\"","step === \"backup\"",
 "backupMode","/sms/verify","/setup/confirm","/verify","downloadRecoveryImage",
 "recoveryCodes","completePasswordlessLogin"])assert.ok(page.includes(marker),"Security journey missing: "+marker);
assert.doesNotMatch(page,/administrator first-time|administrator setup|admin_setup/i,"No visible administrator bypass");
assert.doesNotMatch(wrapper,/showAdminBootstrap|admin_setup=1|<StaffPasswordlessLogin showAdminBootstrap/);
assert.match(settings,/gate4__topbar/,"Account security uses original visual system");
assert.doesNotMatch(settings,/>Set up administrator|>Administrator first-time setup/i);
assert.match(settings,/is_original_system_administrator && !initialStart.current/,"Only trusted original account can self-enroll");
assert.match(settings,/\/administrator\/start/,"Trusted-session setup endpoint still protected");
assert.match(api,/isOriginalSystemAdministrator\(user\)&&!alreadyEnrolled/,"Anonymous original admin enrollment blocked");
assert.match(api,/\/administrator\/start",requireAuth/,"Administrator enrollment requires valid session");
assert.match(page,/step === "identity"/,"Identity confirmation stage is present");
assert.match(page,/type="password"/,"Only first enrollment uses existing credential for identity proof");
assert.match(page,/submitFirstSetupIdentity/,"Owner proof leads to QR setup");
assert.match(page,/first-setup\/verify/,"One-time verification posts to backend");
assert.doesNotMatch(wrapper,/first_setup|admin_setup/,"No hidden password login URL");
assert.match(wrapper,/setMode\("passwordless"\)/,"API outage must never reveal legacy form");
assert.match(api,/router\.post\("\/first-setup\/verify"/,"One-time enrollment endpoint exists");
assert.match(api,/bcrypt\.compare\(password,user\.password_hash\)/,"Must authenticate owner before emitting TOTP secret");
assert.match(css,/\.gate4-passwordless/);
assert.match(api,/\/start\/verified",requireAuth/,"Trusted original account requires valid session");
assert.match(page,/allowSignedInSetup \? "\/start\/verified" : "\/start"/,"Trusted flow routes to verified endpoint");
assert.match(entry,/needsInitialSetup === true/,"Original account can enter its name from a verified device");
assert.match(entry,/auth\/passwordless\/account\/status/,"Enrollment status checked from server");
console.log("CHALIN03 original-design passwordless flow contract passed");
