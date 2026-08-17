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
  assert.ok(service.includes(RESET_CONFIRMATION));
  assert.ok(service.includes("confirmation"));
});

test("live Installment reset requires current password and fresh dry-run fingerprint", () => {
  assert.ok(service.includes("bcrypt.compare"));
  assert.ok(service.includes("dryRunFingerprint"));
  assert.ok(service.includes("RESET_DRY_RUN_STALE"));
});

test("reset scope is Installment-only and preserves shared business data", () => {
  assert.ok(service.includes("equipment_credit_applications"));
  assert.ok(service.includes("equipment_sale_agreements"));
  assert.ok(service.includes("equipment_installment_schedule"));
  assert.ok(service.includes("shared customer identities"));
  assert.ok(service.includes("excavator master records and photographs"));
  assert.doesNotMatch(service, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(service, /DROP\s+TABLE/i);
});

test("execute path inspects live columns instead of assuming agreement/application schemas", () => {
  assert.ok(service.includes("information_schema.COLUMNS"));
  assert.ok(service.includes("tableColumns"));
  assert.ok(service.includes("credit_application_id"));
  assert.ok(service.includes("payment_id"));
  assert.ok(service.includes("dedicated_installment_table"));
  assert.ok(service.includes("applicationColumns.has(\"quotation_id\")"));
});

test("routes require original System Administrator and management permission", () => {
  assert.ok(routes.includes('requirePermission("fleet.assets.manage")'));
  assert.ok(routes.includes("isOriginalSystemAdministrator"));
  assert.ok(routes.includes("password: req.body?.password"));
  assert.ok(routes.includes("dryRunFingerprint: req.body?.dry_run_fingerprint"));
});

test("UI requires password and exact confirmation before reset", () => {
  assert.ok(page.includes("Current password"));
  assert.ok(page.includes("RESET INSTALLMENT FINANCE"));
  assert.ok(page.includes("Reset Installment Finance Data"));
  assert.ok(page.includes("dry_run_fingerprint"));
});
