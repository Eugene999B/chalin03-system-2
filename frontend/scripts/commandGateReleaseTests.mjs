import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const login = read("src/pages/LoginPage.jsx");
const security = read("src/pages/ChangePasswordPage.jsx");
const main = read("src/main.jsx");
const passkeyRoutes = read("../backend/routes/passkeyRoutes.js");
const server = read("../backend/server.js");
const authRoutes = read("../backend/routes/authRoutes.js");
const migration = read("../database/migrations/20260722_command_gate_passkeys.sql");

assert.match(login, /Unlock Chalin 03/);
assert.match(login, /authenticateWithPasskey/);
assert.match(login, /persistPasskeySession/);
assert.match(login, /Password login/);
assert.match(login, /Emergency operations/);
assert.match(login, /request-otp/);
assert.match(login, /getPostLoginDestination/);
assert.match(security, /registerPasskey/);
assert.match(security, /auth\/passkeys/);
assert.match(security, /Temporary station mode/);
assert.match(main, /EmergencyCommandOverlay/);
assert.match(main, /installCommandGateHistoryTracker/);
assert.match(passkeyRoutes, /requireUserVerification:\s*true/);
assert.match(passkeyRoutes, /expectedUserHandle/);
assert.match(server, /\/api\/auth\/passkeys/);
assert.match(authRoutes, /router\.commandGateAuth\s*=\s*Object\.freeze/);
assert.match(migration, /ADDITIVE MIGRATION ONLY/);
assert.match(migration, /BACKUP REQUIRED/);
assert.match(migration, /schema_migrations/);

console.log("Command Gate release contracts passed.");
