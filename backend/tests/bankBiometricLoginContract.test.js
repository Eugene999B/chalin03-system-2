const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const schemaService = read("backend/services/passkeySchemaService.js");
const biometricRoutes = read("backend/routes/biometricRoutes.js");
const server = read("backend/server.js");
const safetyMigration = read(
  "database/migrations/20260723_release31_database_safety_guards.sql"
);
const loginEntry = read("frontend/src/pages/LoginPage.jsx");
const loginPage = read("frontend/src/pages/LoginPageGroupOperations.jsx");
const biometricClient = read("frontend/src/utils/biometricAccess.js");
const groupStyles = read("frontend/src/styles/groupOperationsLogin.css");
const mobileAdminStyles = read("frontend/src/styles/adminMobileHotfix.css");
const serviceWorker = read("frontend/public/sw.js");
const headers = read("frontend/public/_headers");


test("biometric generation is verified without rerunning the global device reset", () => {
  assert.match(schemaService, /20260722_bank_biometric_device_reset_v1/);
  assert.match(schemaService, /bank_biometric_generation/);
  assert.match(schemaService, /generationReady/);
  assert.match(schemaService, /information_schema\.TABLES/);
  assert.match(schemaService, /information_schema\.TRIGGERS/);
  assert.doesNotMatch(schemaService, /CREATE TABLE|ALTER TABLE|DROP TRIGGER/i);
  assert.doesNotMatch(schemaService, /INSERT INTO schema_migrations/i);
});


test("password changes revoke every linked biometric device through controlled migration", () => {
  assert.match(safetyMigration, /trg_user_password_change_revoke_biometrics/);
  assert.match(safetyMigration, /NEW\.password_hash <=> OLD\.password_hash/);
  assert.match(
    safetyMigration,
    /revoked_reason = COALESCE\(revoked_reason, 'password_changed'\)/
  );
  assert.match(schemaService, /PASSWORD_REVOCATION_TRIGGER/);
});


test("legacy generic passkey API is explicitly retired and biometrics are rate limited", () => {
  assert.match(server, /LEGACY_PASSKEYS_RETIRED/);
  assert.match(server, /BIOMETRIC_RATE_LIMITED/);
  assert.match(server, /windowMs:\s*15 \* 60 \* 1000/);
  assert.match(server, /max:\s*40/);
  assert.match(server, /app\.use\("\/api\/auth\/biometrics", biometricLimiter, biometricRoutes\)/);
  assert.match(server, /app\.use\("\/api\/auth\/passkeys"/);
  assert.doesNotMatch(server, /legacyPasskeyRoutes\.stack|process\.nextTick/);
});


test("registration requires a recent password session and local platform verification", () => {
  assert.match(biometricRoutes, /RECENT_PASSWORD_LOGIN_REQUIRED/);
  assert.match(biometricRoutes, /RECENT_PASSWORD_MINUTES = 5/);
  assert.match(biometricRoutes, /authenticatorAttachment:\s*"platform"/);
  assert.match(biometricRoutes, /preferredAuthenticatorType:\s*"localDevice"/);
  assert.match(biometricRoutes, /residentKey:\s*"required"/);
  assert.match(biometricRoutes, /userVerification:\s*"required"/);
  assert.match(biometricRoutes, /requireUserVerification:\s*true/);
  assert.match(biometricRoutes, /LOCAL_BIOMETRIC_REQUIRED/);
});


test("biometric login is bound to one browser token, credential and account", () => {
  assert.match(biometricRoutes, /device_binding_hash/);
  assert.match(biometricRoutes, /bindingHash\(rawToken\)/);
  assert.match(biometricRoutes, /allowCredentials/);
  assert.match(biometricRoutes, /passkey_id/);
  assert.match(biometricRoutes, /credential\.credential_id !== response\.id/);
  assert.match(
    biometricRoutes,
    /This device is not linked to the requested account/
  );
  assert.match(biometricClient, /chalin03_biometric_binding_v2/);
  assert.match(biometricClient, /binding_token/);
});


test("setup is offered only when a platform authenticator is reported", () => {
  assert.match(
    biometricClient,
    /isUserVerifyingPlatformAuthenticatorAvailable/
  );
  assert.match(biometricClient, /platformAvailabilityResolved/);
  assert.match(biometricClient, /PLATFORM_BIOMETRIC_UNAVAILABLE/);
  assert.match(loginPage, /const \[biometricAvailable, setBiometricAvailable\]/);
  assert.match(loginPage, /if \(biometricAvailable && !sameBoundAccount\)/);
  assert.match(loginPage, /consentOpen && biometricAvailable/);
});


test("password starts blank, group story is shown and every login opens a dashboard", () => {
  assert.match(loginEntry, /LoginPageGroupOperations/);
  assert.match(loginPage, /const \[password, setPassword\] = useState\(""\)/);
  assert.match(loginPage, /autoComplete="off"/);
  assert.match(loginPage, /autoComplete="new-password"/);
  assert.match(loginPage, /readOnly=\{!passwordUnlocked\}/);
  assert.match(
    loginPage,
    /window\.addEventListener\("pageshow", clearPasswordField\)/
  );
  assert.match(loginEntry, /unlockPasswordOnFirstTap/);
  assert.match(loginEntry, /input\.readOnly = false/);
  assert.match(loginEntry, /openEmergencyCommand/);
  assert.match(loginPage, /Chalin 03 Group Operations/);
  assert.match(loginPage, /Three connected businesses/);
  assert.match(loginPage, /DASHBOARD_PATHS/);
  assert.match(loginPage, /Opening your dashboard/);
  assert.match(loginPage, /Use fingerprint or face on this device\?/);
  assert.match(loginPage, /Set up fingerprint or face/);
  assert.match(loginPage, /Not now/);
  assert.match(loginPage, /sameBoundAccount/);
  assert.doesNotMatch(loginPage, /Password first\. Fingerprint/i);
  assert.doesNotMatch(loginPage, /device PIN/i);
  assert.doesNotMatch(loginPage, /Windows Hello/i);
  assert.match(groupStyles, /group-operations-map/);
});


test("mobile administration layouts override route-level desktop widths", () => {
  assert.match(
    mobileAdminStyles,
    /\.upm-table-wrap \.upm-permission-table/
  );
  assert.match(mobileAdminStyles, /min-width:\s*0 !important/);
  assert.match(
    mobileAdminStyles,
    /delegate-capability-grid input\[type="checkbox"\]/
  );
  assert.match(mobileAdminStyles, /users-store-strip/);
  assert.match(mobileAdminStyles, /grid-template-columns:\s*repeat\(2/);
});


test("service worker ignores third-party requests and refreshes the mobile release", () => {
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /chalin03-group-login-mobile-admin-v4/);
  assert.match(
    headers,
    /connect-src[^;]*https:\/\/static\.cloudflareinsights\.com/
  );
  assert.match(
    headers,
    /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/
  );
});
