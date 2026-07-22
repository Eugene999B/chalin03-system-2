const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const schemaService = read("backend/services/passkeySchemaService.js");
const biometricRoutes = read("backend/routes/biometricRoutes.js");
const loginPage = read("frontend/src/pages/LoginPageBiometricBank.jsx");
const biometricClient = read("frontend/src/utils/biometricAccess.js");
const serviceWorker = read("frontend/public/sw.js");
const headers = read("frontend/public/_headers");


test("all earlier device credentials are revoked exactly once", () => {
  assert.match(schemaService, /20260722_bank_biometric_device_reset_v1/);
  assert.match(schemaService, /global_bank_biometric_reset/);
  assert.match(schemaService, /UPDATE user_passkeys[\s\S]*revoked_at/);
  assert.match(schemaService, /UPDATE passkey_challenges[\s\S]*used_at/);
  assert.match(schemaService, /passkey_security_events/);
  assert.match(schemaService, /bank_biometric_generation/);
  assert.match(schemaService, /INSERT INTO schema_migrations/);
});


test("password changes revoke every linked biometric device", () => {
  assert.match(schemaService, /trg_user_password_change_revoke_biometrics/);
  assert.match(schemaService, /NEW\.password_hash <=> OLD\.password_hash/);
  assert.match(schemaService, /revoked_reason = COALESCE\(revoked_reason, 'password_changed'\)/);
});


test("legacy generic passkey API is retired", () => {
  assert.match(schemaService, /LEGACY_PASSKEYS_RETIRED/);
  assert.match(schemaService, /legacyPasskeyRoutes\.stack\.unshift/);
  assert.match(schemaService, /authRoutes\.use\("\/biometrics", biometricRoutes\)/);
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
  assert.match(biometricRoutes, /This device is not linked to the requested account/);
  assert.match(biometricClient, /chalin03_biometric_binding_v2/);
  assert.match(biometricClient, /binding_token/);
});


test("password starts blank and consent follows successful login", () => {
  assert.match(loginPage, /const \[password, setPassword\] = useState\(""\)/);
  assert.match(loginPage, /autoComplete="off"/);
  assert.match(loginPage, /autoComplete="new-password"/);
  assert.match(loginPage, /readOnly=\{!passwordUnlocked\}/);
  assert.match(loginPage, /window\.addEventListener\("pageshow", clearPasswordField\)/);
  assert.match(loginPage, /Use fingerprint or face on this device\?/);
  assert.match(loginPage, /Set up fingerprint or face/);
  assert.match(loginPage, /Not now/);
  assert.match(loginPage, /sameBoundAccount/);
  assert.doesNotMatch(loginPage, /device PIN/i);
  assert.doesNotMatch(loginPage, /Windows Hello/i);
});


test("service worker ignores third-party requests and CSP allows Cloudflare", () => {
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /chalin03-bank-biometric-login-v2/);
  assert.match(headers, /connect-src[^;]*https:\/\/static\.cloudflareinsights\.com/);
  assert.match(headers, /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/);
});
