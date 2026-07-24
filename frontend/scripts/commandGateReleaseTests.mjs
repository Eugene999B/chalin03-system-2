import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const loginEntry = read("src/pages/LoginPage.jsx");
const loginPage = read("src/pages/LoginPageGroupOperations.jsx");
const biometricClient = read("src/utils/biometricAccess.js");
const security = read("src/pages/ChangePasswordPage.jsx");
const main = read("src/main.jsx");
const passkeyRoutes = read("../backend/routes/passkeyRoutes.js");
const biometricRoutes = read("../backend/routes/biometricRoutes.js");

assert.match(loginEntry, /LoginPageGroupOperations/);
assert.match(loginEntry, /unlockPasswordOnFirstTap/);
assert.match(loginPage, /Chalin 03 Group Operations/);
assert.match(loginPage, /Three connected businesses/);
assert.match(loginPage, /GroupOperationsMap/);
assert.match(loginPage, /DASHBOARD_PATHS/);
assert.match(loginPage, /Opening your dashboard/);
assert.match(loginPage, /autoComplete="off"/);
assert.match(loginPage, /autoComplete="new-password"/);
assert.match(loginPage, /readOnly=\{!passwordUnlocked\}/);
assert.match(loginPage, /window\.addEventListener\("pageshow", clearPasswordField\)/);

assert.match(biometricClient, /WEB_BIOMETRIC_ENABLED = false/);
assert.match(biometricClient, /isBiometricAccessAvailable\(\)[\s\S]*return false/);
assert.match(biometricClient, /WEB_BIOMETRIC_DISABLED/);
assert.match(biometricClient, /localStorage\.removeItem\(BINDING_KEY\)/);
assert.doesNotMatch(
  biometricClient,
  /isUserVerifyingPlatformAuthenticatorAvailable|startAuthentication|startRegistration/
);

for (const source of [passkeyRoutes, biometricRoutes]) {
  assert.match(source, /status\(410\)/);
  assert.match(source, /WEB_(?:PASSKEY|BIOMETRIC)_LOGIN_DISABLED/);
  assert.doesNotMatch(source, /simplewebauthn|verifyAuthenticationResponse/i);
}

assert.match(security, /Password Security/);
assert.match(security, /Browser fingerprint, face, passkey and device screen-lock login are/);
assert.match(security, /password login is the approved method/);
assert.match(security, /clearStoredBiometricBinding/);
assert.doesNotMatch(security, /auth\/biometrics\/devices/);
assert.doesNotMatch(security, /isBiometricAccessAvailable|registerBiometricDevice/);

assert.match(main, /AdvancedAccountingExpenseFundingEvidence/);
assert.match(main, /EmergencyCommandOverlay/);
assert.match(main, /CommandArrivalBanner/);

console.log("Password-only Command Gate contract passed.");
