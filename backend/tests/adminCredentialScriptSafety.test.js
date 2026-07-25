const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const scriptsRoot = path.join(backendRoot, "scripts");
const packageJson = fs.readFileSync(
  path.join(backendRoot, "package.json"),
  "utf8"
);
const createAdmin = fs.readFileSync(
  path.join(scriptsRoot, "createAdmin.js"),
  "utf8"
);

test("unsafe fixed-credential administrator reset script is absent", () => {
  assert.equal(
    fs.existsSync(path.join(scriptsRoot, "resetAdminPassword.js")),
    false
  );
  assert.doesNotMatch(packageJson, /resetAdminPassword|reset-admin/i);
});

test("manual administrator creation is environment-only and production-blocked", () => {
  assert.match(createAdmin, /process\.env\.ADMIN_PASSWORD/);
  assert.match(createAdmin, /NODE_ENV/);
  assert.match(createAdmin, /Refusing to create or reset an administrator/);
  assert.match(createAdmin, /password\.length < 16/);
  assert.match(createAdmin, /token_version = COALESCE\(token_version, 0\) \+ 1/);
  assert.match(createAdmin, /UPDATE auth_sessions[\s\S]*revoked_at/);
  assert.doesNotMatch(createAdmin, /admin123|password123|changeme/i);
  assert.doesNotMatch(createAdmin, /console\.log\([^\n]*password\s*\)/i);
});

test("backend scripts contain no known fixed default administrator password", () => {
  const unsafeMatches = [];

  for (const fileName of fs.readdirSync(scriptsRoot)) {
    if (!fileName.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(scriptsRoot, fileName), "utf8");
    if (/admin123|password123|default_admin_password|changeme123/i.test(source)) {
      unsafeMatches.push(fileName);
    }
  }

  assert.deepEqual(unsafeMatches, []);
});
