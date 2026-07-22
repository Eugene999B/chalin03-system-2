import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const loginEntry = read("src/pages/LoginPage.jsx");
const login = read("src/pages/LoginPageV5.jsx");
const loginStyles = [
  read("src/styles/commandGateV5.css"),
  read("src/styles/commandGateV5Overlays.css"),
  read("src/styles/commandGateV5Mobile.css"),
].join("\n");
const serviceWorker = read("public/sw.js");
const security = read("src/pages/ChangePasswordPage.jsx");
const main = read("src/main.jsx");
const arrival = read("src/components/CommandArrivalBanner.jsx");
const passkeyRoutes = read("../backend/routes/passkeyRoutes.js");
const server = read("../backend/server.js");
const authRoutes = read("../backend/routes/authRoutes.js");
const migration = read("../database/migrations/20260722_command_gate_passkeys.sql");

assert.match(loginEntry, /LoginPageV5/);
assert.match(login, /Sign in to Chalin 03/);
assert.match(login, /Sign in with face or fingerprint/);
assert.match(login, /Fresh verification is required every time/);
assert.match(login, /authenticateWithPasskey/);
assert.match(login, /registerPasskey/);
assert.match(login, /automaticDeviceSetup/);
assert.match(login, /biometricState/);
assert.match(login, /Waiting for device verification/);
assert.match(login, /Secure verification complete/);
assert.match(login, /FLOW_STEPS/);
assert.match(login, /Operations ready/);
assert.match(login, /window\.setTimeout\(resolve, 520\)/);
assert.match(login, /isLoggedIn && !postLoginProcessing/);
assert.match(login, /request-otp/);
assert.match(login, /getPostLoginDestination/);
assert.match(login, /Emergency Operations/);
assert.match(login, /\/chalin03-logo\.png/);
assert.doesNotMatch(login, /src="\/logo\.png"/);
assert.doesNotMatch(login, />C03</);
assert.match(loginStyles, /@media\(max-width:640px\)/);
assert.match(loginStyles, /grid-template-columns:repeat\(3,1fr\)/);
assert.match(loginStyles, /gate5-bio/);
assert.match(loginStyles, /gate5-flow/);
assert.match(loginStyles, /gate5-intro/);
assert.match(serviceWorker, /command-gate-v5/);
assert.match(security, /registerPasskey/);
assert.match(security, /auth\/passkeys/);
assert.match(security, /Temporary station mode/);
assert.match(main, /EmergencyCommandOverlay/);
assert.match(main, /CommandArrivalBanner/);
assert.match(main, /installCommandGateHistoryTracker/);
assert.match(arrival, /Welcome back/);
assert.match(passkeyRoutes, /userVerification:\s*"required"/);
assert.match(passkeyRoutes, /requireUserVerification:\s*true/);
assert.match(passkeyRoutes, /expectedUserHandle/);
assert.match(server, /\/api\/auth\/passkeys/);
assert.match(authRoutes, /router\.commandGateAuth\s*=\s*Object\.freeze/);
assert.match(migration, /ADDITIVE MIGRATION ONLY/);
assert.match(migration, /BACKUP REQUIRED/);
assert.match(migration, /schema_migrations/);

console.log("Command Gate V5 biometric, logo and workflow contracts passed.");
