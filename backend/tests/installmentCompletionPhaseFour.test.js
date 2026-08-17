const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const service = read("backend", "services", "installmentFinanceLiveResetService.js");
const routes = read("backend", "routes", "installmentCompletionPhaseFourRoutes.js");
const page = read("frontend", "src", "pages", "InstallmentCompletionPhaseFourPage.jsx");

const RESET_CONFIRMATION = "RESET INSTALLMENT FINANCE";

test("live Installment reset requires the exact confirmation phrase", () => {
  assert.match(service, new RegExp(RESET_CONFIRMATION.replace(/ /g, "\\s+")));
  assert.match(service, /confirmation/);
});

test("live Installment reset requires current password and fresh dry-run fingerprint", () => {
  assert.match(service, /bcrypt\\.compare/);
  assert.match(service, /dryRunFingerprint/);
  assert.match(service, /RESET_DRY_RUN_STALE/);
});

test("reset scope is Installment-only and preserves shared business data", () => {
  assert.match(service, /equipment_credit_applications/);
  assert.match(service, /equipment_sale_agreements/);
  assert.match(service, /equipment_installment_schedule/);
  assert.match(service, /shared customer identities/);
  assert.match(service, /excavator master records and photographs/);
  assert.doesNotMatch(service, /TRUNCATE\\s+TABLE/i);
  assert.doesNotMatch(service, /DROP\\s+TABLE/i);
});

test("routes require original System Administrator and management permission", () => {
  assert.match(routes, /requirePermission\("fleet\\.assets\\.manage"\)/);
  assert.match(routes, /isOriginalSystemAdministrator/);
  assert.match(routes, /password: req\.body\?\.password/);
  assert.match(routes, /dryRunFingerprint: req\.body\?\.dry_run_fingerprint/);
});

test("UI requires password and exact confirmation before reset", () => {
  assert.match(page, /Current password/);
  assert.match(page, /RESET INSTALLMENT FINANCE/);
  assert.match(page, /Reset Installment Finance Data/);
  assert.match(page, /dry_run_fingerprint/);
});
