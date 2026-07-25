const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(backendRoot, relativePath), "utf8");

test("Owner Break-Glass login has one MFA-enforcing implementation", () => {
  const secureRoutes = read("routes/ownerSecurityRoutes.js");
  const legacyRoutes = read("routes/release2FinalRoutes.js");
  const server = read("server.js");

  assert.match(secureRoutes, /router\.post\(\s*["']\/owner\/login["']/);
  assert.match(secureRoutes, /mfa_code|recovery_code/);
  assert.doesNotMatch(legacyRoutes, /router\.post\(\s*["']\/owner\/login["']/);
  assert.match(
    server,
    /app\.use\(["']\/api\/release2-final["'],\s*ownerSecurityRoutes\)/
  );
});

test("Daily Closing exposes correction evidence consistently in all outputs", () => {
  const source = read("routes/dailyClosingRoutes.js");

  assert.match(source, /function buildExpenseCorrectionPresentation/);
  assert.match(source, /e\.is_voided/);
  assert.match(source, /e\.is_reversal/);
  assert.match(source, /display_category: `\$\{statusLabel\} — \$\{category\}`/);
  assert.match(source, /expense\.display_category \|\| expense\.category/);
  assert.match(source, /expense\.display_description \|\| expense\.description/);
  assert.match(source, /item\.display_category \|\| item\.category/);
  assert.match(source, /item\.display_description \|\| item\.description/);
  assert.match(source, /wordCell\(expense\.display_category \|\| expense\.category/);
});
