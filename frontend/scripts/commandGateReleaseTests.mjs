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
const groupStyles = read("src/styles/groupOperationsLogin.css");
const adminMobileStyles = read("src/styles/adminMobileHotfix.css");
const mobileStyles = read("src/styles/mobileExperience.css");
const mobileNavigation = read("src/components/CompactSidebarNavigation.jsx");
const historyTracker = read("src/utils/commandGateHistoryTracker.js");
const serviceWorker = read("public/sw.js");
const headers = read("public/_headers");
const security = read("src/pages/ChangePasswordPage.jsx");
const main = read("src/main.jsx");
const arrival = read("src/components/CommandArrivalBanner.jsx");
const passkeyRoutes = read("../backend/routes/passkeyRoutes.js");
const biometricRoutes = read("../backend/routes/biometricRoutes.js");
const schemaService = read("../backend/services/passkeySchemaService.js");
const authRoutes = read("../backend/routes/authRoutes.js");

assert.match(loginEntry, /LoginPageGroupOperations/);
assert.match(loginEntry, /unlockPasswordOnFirstTap/);
assert.match(loginEntry, /openEmergencyCommand/);
assert.match(loginEntry, /arrival\.emergencyMode/);
assert.match(loginPage, /Chalin 03 Group Operations/);
assert.match(loginPage, /One company\./);
assert.match(loginPage, /Three connected businesses/);
assert.match(loginPage, /GroupOperationsMap/);
assert.match(loginPage, /DASHBOARD_PATHS/);
assert.match(loginPage, /Opening your dashboard/);
assert.match(loginPage, /autoComplete="off"/);
assert.match(loginPage, /autoComplete="new-password"/);
assert.match(loginPage, /readOnly=\{!passwordUnlocked\}/);
assert.match(loginPage, /data-lpignore="true"/);
assert.match(loginPage, /data-1p-ignore="true"/);
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

assert.match(schemaService, /UPDATE user_passkeys/);
assert.match(schemaService, /UPDATE passkey_challenges/);
assert.match(schemaService, /trg_user_password_change_revoke_biometrics/);
assert.match(schemaService, /authRoutes\.use\("\/biometrics", biometricLimiter, biometricRoutes\)/);

assert.match(security, /Password Security/);
assert.match(security, /Browser fingerprint, face, passkey and device screen-lock login are/);
assert.match(security, /password login is the approved method/);
assert.match(security, /clearStoredBiometricBinding/);
assert.doesNotMatch(security, /auth\/biometrics\/devices/);
assert.doesNotMatch(security, /isBiometricAccessAvailable|registerBiometricDevice/);

assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
assert.match(serviceWorker, /chalin03-group-login-mobile-admin-v4/);
assert.match(headers, /connect-src[^;]*https:\/\/static\.cloudflareinsights\.com/);
assert.match(headers, /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/);

assert.match(groupStyles, /group-operations-map/);
assert.match(groupStyles, /@media \(max-width: 760px\)/);
assert.match(adminMobileStyles, /\.upm-table-wrap \.upm-permission-table/);
assert.match(adminMobileStyles, /min-width:\s*0 !important/);
assert.match(adminMobileStyles, /delegate-capability-grid input\[type="checkbox"\]/);
assert.match(adminMobileStyles, /users-store-strip/);
assert.match(adminMobileStyles, /grid-template-columns:\s*repeat\(2/);
assert.match(main, /adminMobileHotfix\.css/);
assert.match(mobileStyles, /Dedicated mobile operating layer/);
assert.match(mobileStyles, /\.compact-sidebar-navigation\.is-mobile-navigation/);
assert.match(mobileNavigation, /isMobileNavigation/);
assert.match(historyTracker, /chalin-route-/);
assert.match(main, /EmergencyCommandOverlay/);
assert.match(main, /CommandArrivalBanner/);
assert.match(arrival, /Welcome back/);
assert.match(authRoutes, /router\.commandGateAuth\s*=\s*Object\.freeze/);

console.log("Password-only group login and mobile administration contracts passed.");
