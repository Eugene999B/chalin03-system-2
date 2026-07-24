const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}


test("Command Gate browser passkey routes are retired fail-closed", () => {
  const source = read("routes/passkeyRoutes.js");

  assert.match(source, /WEB_PASSKEY_LOGIN_DISABLED/);
  assert.match(source, /status\(410\)/);
  assert.match(source, /router\.use\(sendRetiredResponse\)/);
  assert.doesNotMatch(
    source,
    /generateRegistrationOptions|verifyRegistrationResponse|generateAuthenticationOptions|verifyAuthenticationResponse/
  );
});


test("retired passkey endpoints cannot create sessions or credentials", () => {
  const source = read("routes/passkeyRoutes.js");

  assert.doesNotMatch(source, /createSession|INSERT INTO user_passkeys|passkey_challenges/);
  assert.match(source, /account-password login only/);
});


test("server retains the retired route boundary while password login remains active", () => {
  const server = read("server.js");
  const auth = read("routes/authRoutes.js");

  assert.match(server, /passkeyRoutes/);
  assert.match(server, /\/api\/auth\/passkeys/);
  assert.match(auth, /router\.post\([\s\S]*"\/login"/);
  assert.match(auth, /bcrypt\.compare/);
});


test("historical credential tables remain available for revocation and audit only", () => {
  const schema = read("services/passkeySchemaService.js");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_passkeys/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS passkey_challenges/);
  assert.match(schema, /revoked_at/);
  assert.doesNotMatch(schema, /\b(video|image|photo|audio)_/i);
});


test("auth routes expose only the helpers required by Command Gate", () => {
  const source = read("routes/authRoutes.js");

  assert.match(source, /router\.commandGateAuth\s*=\s*Object\.freeze/);
  assert.match(source, /resolveLoginWorkspace/);
  assert.match(source, /resolveLoginBranch/);
  assert.match(source, /createToken/);
});
