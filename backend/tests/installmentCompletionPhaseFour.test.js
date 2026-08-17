const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const { RESET_CONFIRMATION, resolveFinanceResetAvailability } = require("../services/installmentCompletionPhaseFourService");
const service = read("backend", "services", "installmentCompletionPhaseFourService.js");
const routes = read("backend", "routes", "installmentCompletionPhaseFourRoutes.js");
const page = read("frontend", "src", "pages", "InstallmentCompletionPhaseFourPage.jsx");

test("live Installment reset is available without test-environment gating", () => {
  const availability = resolveFinanceResetAvailability({ NODE_ENV: "production" }, "railway");
  assert.equal(availability.enabled, true);
  assert.equal(availability.production_permanently_blocked, false);
  assert.equal(availability.requires_password_reauthentication, true);
  assert.equal(availability.requires_exact_confirmation, true);
  assert.equal(availability.code, "LIVE_FINANCE_RESET_REQUIRES_REAUTH");
});

test("server safety switch can disable the reset", () => {
  const availability = resolveFinanceResetAvailability({ NODE_ENV: "production", FINANCE_RESET_DISABLED: "true" }, "railway");
  assert.equal(availability.enabled, false);
  assert.equal(availability.code, "FINANCE_RESET_DISABLED");
});

test("dry run stays read-only and destructive SQL remains transactional", () => {
  const dryRunStart = service.indexOf("async function buildFinanceResetDryRun");
  const executeStart = service.indexOf("async function executeFinanceTestReset");
  const dryRunSource = service.slice(dryRunStart, executeStart);
  assert.ok(dryRunStart >= 0 && executeStart > dryRunStart);
  assert.doesNotMatch(dryRunSource, /\bDELETE\s+FROM\b|\bUPDATE\s+[`A-Za-z0-9_]+\b|\bTRUNCATE\s+TABLE\b|\bDROP\s+TABLE\b/i);
  assert.match(service, /await db\.beginTransaction\(\)/);
  assert.match(service, /await db\.commit\(\)/);
  assert.match(service, /await db\.rollback\(\)/);
  assert.match(service, /RESET INSTALLMENT FINANCE/);
  assert.doesNotMatch(service, /NODE_ENV=test/);
  assert.doesNotMatch(service, /ALLOW_FINANCE_TEST_RESET=true/);
  assert.doesNotMatch(service, /database name containing _test/);
});

test("reset execution requires password re-authentication and exact phrase", () => {
  assert.match(service, /bcrypt\.compare/);
  assert.match(service, /FINANCE_RESET_PASSWORD_REQUIRED/);
  assert.match(service, /FINANCE_RESET_REAUTH_FAILED/);
  assert.match(service, /FINANCE_RESET_CONFIRMATION_REQUIRED/);
  assert.match(routes, /password: req\.body\?\.password/);
  assert.match(routes, /isOriginalSystemAdministrator/);
  assert.match(routes, /fleet\.assets\.manage/);
  assert.equal(RESET_CONFIRMATION, "RESET INSTALLMENT FINANCE");
});

test("user-facing reset centre uses password plus exact typed confirmation", () => {
  assert.match(page, /Current System Administrator password/);
  assert.match(page, /type=\"password\"/);
  assert.match(page, /RESET INSTALLMENT FINANCE/);
  assert.match(page, /Reset Installment Finance Data/);
  assert.doesNotMatch(page, /production reset is permanently blocked/i);
  assert.doesNotMatch(page, /PRODUCTION_FINANCE_RESET_PERMANENTLY_BLOCKED/);
});
