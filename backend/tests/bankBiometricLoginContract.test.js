const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const schemaService = read("backend/services/passkeySchemaService.js");
const passkeyRoutes = read("backend/routes/passkeyRoutes.js");
const biometricRoutes = read("backend/routes/biometricRoutes.js");
const loginEntry = read("frontend/src/pages/LoginPage.jsx");
const loginPage = read("frontend/src/pages/LoginPageGroupOperations.jsx");
const biometricClient = read("frontend/src/utils/biometricAccess.js");
const passwordPage = read("frontend/src/pages/ChangePasswordPage.jsx");
const groupStyles = read("frontend/src/styles/groupOperationsLogin.css");
const mobileAdminStyles = read("frontend/src/styles/adminMobileHotfix.css");
const serviceWorker = read("frontend/public/sw.js");
const headers = read("frontend/public/_headers");

test("historical biometric credentials remain revocable after web login retirement", () => {
  assert.match(schemaService, /20260722_bank_biometric_device_reset_v1/);
  assert.match(schemaService, /UPDATE user_passkeys[\s\S]*revoked_at/);
  assert.match(schemaService, /trg_user_password_change_revoke_biometrics/);
});

test("browser passkey and biometric APIs are retired fail-closed", () => {
  for (const source of [passkeyRoutes, biometricRoutes]) {
    assert.match(source, /status\(410\)/);
    assert.match(source, /WEB_(?:PASSKEY|BIOMETRIC)_LOGIN_DISABLED/);
    assert.doesNotMatch(source, /simplewebauthn|generateAuthenticationOptions|verifyAuthenticationResponse/i);
  }
});

test("frontend never advertises or invokes browser biometric availability", () => {
  assert.match(biometricClient, /WEB_BIOMETRIC_ENABLED = false/);
  assert.match(biometricClient, /isBiometricAccessAvailable\(\)[\s\S]*return false/);
  assert.match(biometricClient, /WEB_BIOMETRIC_DISABLED/);
  assert.match(biometricClient, /localStorage\.removeItem\(BINDING_KEY\)/);
  assert.doesNotMatch(
    biometricClient,
    /isUserVerifyingPlatformAuthenticatorAvailable|startAuthentication|startRegistration/
  );
});

test("account security is password-only and explains why browser passkeys are rejected", () => {
  assert.match(passwordPage, /Password Security/);
  assert.match(passwordPage, /Browser fingerprint, face, passkey and device screen-lock login are/);
  assert.match(passwordPage, /password login is the approved method/);
  assert.doesNotMatch(passwordPage, /auth\/biometrics\/devices/);
  assert.doesNotMatch(passwordPage, /registerBiometricDevice|isBiometricAccessAvailable/);
});

test("password starts blank, group story is shown and every login opens a dashboard", () => {
  assert.match(loginEntry, /LoginPageGroupOperations/);
  assert.match(loginPage, /const \[password, setPassword\] = useState\(""\)/);
  assert.match(loginPage, /autoComplete="off"/);
  assert.match(loginPage, /autoComplete="new-password"/);
  assert.match(loginPage, /readOnly=\{!passwordUnlocked\}/);
  assert.match(loginPage, /window\.addEventListener\("pageshow", clearPasswordField\)/);
  assert.match(loginEntry, /unlockPasswordOnFirstTap/);
  assert.match(loginEntry, /input\.readOnly = false/);
  assert.match(loginEntry, /openEmergencyCommand/);
  assert.match(loginPage, /Chalin 03 Group Operations/);
  assert.match(loginPage, /Three connected businesses/);
  assert.match(loginPage, /DASHBOARD_PATHS/);
  assert.match(loginPage, /Opening your dashboard/);
  assert.match(groupStyles, /group-operations-map/);
});

test("mobile administration layouts override route-level desktop widths", () => {
  assert.match(mobileAdminStyles, /\.upm-table-wrap \.upm-permission-table/);
  assert.match(mobileAdminStyles, /min-width:\s*0 !important/);
  assert.match(mobileAdminStyles, /delegate-capability-grid input\[type="checkbox"\]/);
  assert.match(mobileAdminStyles, /users-store-strip/);
  assert.match(mobileAdminStyles, /grid-template-columns:\s*repeat\(2/);
});

test("service worker ignores external and API traffic and rotates deployment-specific caches", () => {
  assert.match(serviceWorker, /const CACHE_PREFIX = "chalin03-"/);
  assert.match(
    serviceWorker,
    /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
  );
  assert.match(
    serviceWorker,
    /const CACHE_NAME = `\$\{CACHE_PREFIX\}app-shell-\$\{safeRelease\}`/
  );
  assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api"\)/);
  assert.match(serviceWorker, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);
  assert.match(serviceWorker, /caches\.delete\(name\)/);
  assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
  assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);
  assert.match(headers, /connect-src[^;]*https:\/\/static\.cloudflareinsights\.com/);
  assert.match(headers, /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/);
});
