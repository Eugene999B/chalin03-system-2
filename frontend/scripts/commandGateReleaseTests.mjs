import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const loginEntry = read("src/pages/LoginPage.jsx");
const loginPage = read("src/pages/LoginPageBiometricBank.jsx");
const biometricClient = read("src/utils/biometricAccess.js");
const biometricStyles = read("src/styles/biometricBankLogin.css");
const mobileStyles = read("src/styles/mobileExperience.css");
const mobileNavigation = read("src/components/CompactSidebarNavigation.jsx");
const historyTracker = read("src/utils/commandGateHistoryTracker.js");
const serviceWorker = read("public/sw.js");
const headers = read("public/_headers");
const security = read("src/pages/ChangePasswordPage.jsx");
const main = read("src/main.jsx");
const arrival = read("src/components/CommandArrivalBanner.jsx");
const biometricRoutes = read("../backend/routes/biometricRoutes.js");
const schemaService = read("../backend/services/passkeySchemaService.js");
const authRoutes = read("../backend/routes/authRoutes.js");

assert.match(loginEntry, /LoginPageBiometricBank/);
assert.match(loginPage, /Use fingerprint or face on this device\?/);
assert.match(loginPage, /Set up fingerprint or face/);
assert.match(loginPage, /Not now/);
assert.match(loginPage, /Continue as \$\{boundAccountName\}/);
assert.match(loginPage, /sameBoundAccount/);
assert.match(loginPage, /supportsBiometricAccess/);
assert.match(loginPage, /autoComplete="off"/);
assert.match(loginPage, /autoComplete="new-password"/);
assert.match(loginPage, /readOnly=\{!passwordUnlocked\}/);
assert.match(loginPage, /data-lpignore="true"/);
assert.match(loginPage, /data-1p-ignore="true"/);
assert.match(loginPage, /window\.addEventListener\("pageshow", clearPasswordField\)/);
assert.doesNotMatch(loginPage, /device PIN/i);
assert.doesNotMatch(loginPage, /Windows Hello/i);
assert.doesNotMatch(loginPage, /security key/i);
assert.doesNotMatch(loginPage, /passkey/i);

assert.match(biometricClient, /chalin03_biometric_binding_v2/);
assert.match(biometricClient, /binding_token/);
assert.match(biometricClient, /authentication\/options/);
assert.match(biometricClient, /registration\/options/);
assert.match(biometricClient, /startAuthentication/);
assert.match(biometricClient, /startRegistration/);
assert.match(biometricClient, /clearStoredBiometricBinding/);

assert.match(biometricRoutes, /authenticatorAttachment:\s*"platform"/);
assert.match(biometricRoutes, /preferredAuthenticatorType:\s*"localDevice"/);
assert.match(biometricRoutes, /userVerification:\s*"required"/);
assert.match(biometricRoutes, /requireUserVerification:\s*true/);
assert.match(biometricRoutes, /allowCredentials/);
assert.match(biometricRoutes, /device_binding_hash/);
assert.match(biometricRoutes, /RECENT_PASSWORD_LOGIN_REQUIRED/);
assert.match(biometricRoutes, /This device is not linked to the requested account/);
assert.doesNotMatch(biometricRoutes, /cross-platform/);

assert.match(schemaService, /global_bank_biometric_reset/);
assert.match(schemaService, /UPDATE user_passkeys/);
assert.match(schemaService, /UPDATE passkey_challenges/);
assert.match(schemaService, /bank_biometric_generation/);
assert.match(schemaService, /trg_user_password_change_revoke_biometrics/);
assert.match(schemaService, /LEGACY_PASSKEYS_RETIRED/);
assert.match(schemaService, /authRoutes\.use\("\/biometrics", biometricRoutes\)/);

assert.match(serviceWorker, /url\.origin !== self\.location\.origin/);
assert.match(serviceWorker, /chalin03-bank-biometric-login-v2/);
assert.match(headers, /connect-src[^;]*https:\/\/static\.cloudflareinsights\.com/);
assert.match(headers, /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/);

assert.match(security, /auth\/biometrics\/devices/);
assert.match(security, /clearStoredBiometricBinding/);
assert.match(security, /fingerprint and face devices were revoked/i);
assert.doesNotMatch(security, /device PIN/i);
assert.doesNotMatch(security, /Windows Hello/i);
assert.doesNotMatch(security, /passkey/i);

assert.match(biometricStyles, /biometric-consent/);
assert.match(biometricStyles, /@media \(max-width: 760px\)/);
assert.match(mobileStyles, /Dedicated mobile operating layer/);
assert.match(mobileStyles, /\.compact-sidebar-navigation\.is-mobile-navigation/);
assert.match(mobileNavigation, /isMobileNavigation/);
assert.match(historyTracker, /chalin-route-/);
assert.match(main, /EmergencyCommandOverlay/);
assert.match(main, /CommandArrivalBanner/);
assert.match(arrival, /Welcome back/);
assert.match(authRoutes, /router\.commandGateAuth\s*=\s*Object\.freeze/);

console.log("Bank biometric login and dedicated mobile experience contracts passed.");
