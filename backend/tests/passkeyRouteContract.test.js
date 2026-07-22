const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Command Gate passkey routes use real WebAuthn verification", () => {
  const source = read("routes/passkeyRoutes.js");

  assert.match(source, /generateRegistrationOptions/);
  assert.match(source, /verifyRegistrationResponse/);
  assert.match(source, /generateAuthenticationOptions/);
  assert.match(source, /verifyAuthenticationResponse/);
  assert.match(source, /userVerification:\s*"required"/);
  assert.match(source, /residentKey:\s*"required"/);
  assert.match(source, /createSession/);
  assert.match(source, /PASSKEY_LOGIN/);
});

test("passkey registration and device management require authentication", () => {
  const source = read("routes/passkeyRoutes.js");

  assert.match(source, /router\.get\("\/",\s*requireAuth/);
  assert.match(source, /router\.post\("\/registration\/options",\s*requireAuth/);
  assert.match(source, /router\.post\("\/registration\/verify",\s*requireAuth/);
  assert.match(source, /router\.delete\("\/:passkeyId",\s*requireAuth/);
});

test("authentication challenge is one-time and short lived", () => {
  const source = read("routes/passkeyRoutes.js");

  assert.match(source, /PASSKEY_CHALLENGE_MINUTES\s*=\s*5/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /SET used_at = NOW\(\)/);
  assert.match(source, /expires_at/);
});

test("server mounts passkey routes and initializes the compact schema", () => {
  const server = read("server.js");

  assert.match(server, /passkeyRoutes/);
  assert.match(server, /ensurePasskeySchema/);
  assert.match(server, /\/api\/auth\/passkeys/);
  assert.match(server, /await ensurePasskeySchema\(\)/);
});

test("passkey schema stores credentials and compact challenge records only", () => {
  const schema = read("services/passkeySchemaService.js");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS user_passkeys/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS passkey_challenges/);
  assert.doesNotMatch(schema, /\b(video|image|photo|audio)_/i);
});


test("auth routes expose only the helpers required by Command Gate", () => {
  const source = read("routes/authRoutes.js");

  assert.match(source, /router\.commandGateAuth\s*=\s*Object\.freeze/);
  assert.match(source, /resolveLoginWorkspace/);
  assert.match(source, /resolveLoginBranch/);
  assert.match(source, /createToken/);
});

test("passkey dependencies are declared for backend and browser", () => {
  const backendPackage = JSON.parse(read("package.json"));
  const frontendPackage = JSON.parse(
    fs.readFileSync(path.resolve(root, "../frontend/package.json"), "utf8")
  );

  assert.ok(backendPackage.dependencies["@simplewebauthn/server"]);
  assert.ok(frontendPackage.dependencies["@simplewebauthn/browser"]);
});
