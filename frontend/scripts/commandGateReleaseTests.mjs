import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const loginEntry = read("src/pages/LoginPage.jsx");
const login = read("src/pages/LoginPageV4.jsx");
const loginStyles = read("src/styles/commandGateV4.css");
const security = read("src/pages/ChangePasswordPage.jsx");
const main = read("src/main.jsx");
const arrival = read("src/components/CommandArrivalBanner.jsx");
const passkeyRoutes = read("../backend/routes/passkeyRoutes.js");
const server = read("../backend/server.js");
const authRoutes = read("../backend/routes/authRoutes.js");
const migration = read("../database/migrations/20260722_command_gate_passkeys.sql");

assert.match(loginEntry, /LoginPageV4/);
assert.match(login, /Sign in to Chalin 03/);
assert.match(login, /Continue with face or fingerprint/);
assert.match(login, /Verification is required every time/);
assert.match(login, /authenticateWithPasskey/);
assert.match(login, /registerPasskey/);
assert.match(login, /automaticDeviceSetup/);
assert.match(login, /isLoggedIn && !postLoginProcessing/);
assert.match(login, /gate4-intro/);
assert.match(login, /ENTRANCE_STEPS/);
assert.match(login, /Launching operations/);
assert.match(login, /request-otp/);
assert.match(login, /getPostLoginDestination/);
assert.match(login, /Emergency Operations/);
assert.match(loginStyles, /@media \(max-width: 640px\)/);
assert.match(loginStyles, /grid-template-columns: repeat\(3, 1fr\)/);
assert.match(loginStyles, /gate4-sequence/);
assert.match(loginStyles, /gate4-intro/);
assert.match(security, /registerPasskey/);
assert.match(security, /auth\/passkeys/);
assert.match(security, /Temporary station mode/);
assert.match(main, /EmergencyCommandOverlay/);
assert.match(main, /CommandArrivalBanner/);
assert.match(main, /installCommandGateHistoryTracker/);
assert.match(arrival, /Welcome back/);
assert.match(passkeyRoutes, /requireUserVerification:\s*true/);
assert.match(passkeyRoutes, /expectedUserHandle/);
assert.match(server, /\/api\/auth\/passkeys/);
assert.match(authRoutes, /router\.commandGateAuth\s*=\s*Object\.freeze/);
assert.match(migration, /ADDITIVE MIGRATION ONLY/);
assert.match(migration, /BACKUP REQUIRED/);
assert.match(migration, /schema_migrations/);

console.log("Command Gate V4 mobile and passkey contracts passed.");
