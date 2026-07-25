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


test("historical credentials remain revocable without runtime schema mutation", () => {
  const schema = read("services/passkeySchemaService.js");

  assert.match(schema, /information_schema\.TABLES/);
  assert.match(schema, /UPDATE user_passkeys[\s\S]*revoked_at/);
  assert.match(schema, /historical_credentials_revoked/);
  assert.match(schema, /runtime_mutation_disabled/);
  assert.doesNotMatch(schema, /\bCREATE\s+(?:TABLE|TRIGGER|INDEX)\b/i);
  assert.doesNotMatch(schema, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(schema, /\bDROP\s+(?:TABLE|TRIGGER|INDEX)\b/i);
  assert.doesNotMatch(schema, /\b(video|image|photo|audio)_/i);
});


test("auth routes expose only the helpers required by Command Gate", () => {
  const source = read("routes/authRoutes.js");

  assert.match(source, /router\.commandGateAuth\s*=\s*Object\.freeze/);
  assert.match(source, /resolveLoginWorkspace/);
  assert.match(source, /resolveLoginBranch/);
  assert.match(source, /createToken/);
});
