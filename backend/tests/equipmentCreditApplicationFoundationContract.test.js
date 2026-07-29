const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("credit application migration is additive, idempotent and auditable", () => {
  const migration = read(
    "database",
    "migrations",
    "20260729_equipment_credit_application_foundation.sql"
  );
  const verifier = read(
    "database",
    "migrations",
    "20260729_equipment_credit_application_foundation_verify.sql"
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_credit_applications/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_credit_application_kyc/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_credit_application_decisions/);
  assert.match(migration, /application_status ENUM/);
  assert.match(migration, /affordability_status ENUM/);
  assert.match(migration, /customer_consent_confirmed BOOLEAN/);
  assert.match(migration, /UNIQUE KEY uq_equipment_credit_decision_version/);
  assert.match(migration, /20260729_equipment_credit_application_foundation/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM|UPDATE equipment_sale_agreements|UPDATE fleet_assets/i);

  assert.match(verifier, /missing_credit_tables/);
  assert.match(verifier, /missing_credit_columns/);
  assert.match(verifier, /invalid_credit_application_rows/);
  assert.match(verifier, /orphan_credit_evidence_rows/);
  assert.doesNotMatch(verifier, /INSERT INTO|UPDATE |DELETE FROM|DROP |ALTER /i);
});

test("credit application API is mounted under the protected equipment sales router", () => {
  const schemaService = read(
    "backend",
    "services",
    "equipmentSalesSchemaService.js"
  );
  const route = read(
    "backend",
    "routes",
    "equipmentCreditApplicationRoutes.js"
  );

  assert.match(schemaService, /equipmentCreditApplicationRoutes/);
  assert.match(schemaService, /"\/credit-applications"/);
  assert.match(schemaService, /__chalin03CreditApplicationsMounted/);

  assert.match(route, /router\.get\(\s*"\/readiness"/);
  assert.match(route, /router\.get\("\/"/);
  assert.match(route, /router\.get\("\/:id"/);
  assert.match(route, /router\.post\("\/"/);
  assert.match(route, /router\.put\("\/:id"/);
  assert.match(route, /"\/:id\/assess"/);
  assert.match(route, /"\/:id\/submit"/);
  assert.match(route, /"\/:id\/kyc\/verify"/);
  assert.match(route, /"\/:id\/review"/);
  assert.match(route, /requirePermission\("fleet\.assets\.view"\)/);
  assert.match(route, /requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(route, /EQUIPMENT_CREDIT_REVIEW_PERMISSION_REQUIRED/);
});

test("credit application review is decision-only and cannot activate agreements", () => {
  const route = read(
    "backend",
    "routes",
    "equipmentCreditApplicationRoutes.js"
  );

  assert.match(route, /application_status = \?/);
  assert.match(route, /Verify the required KYC evidence before approving/);
  assert.match(route, /An affordability-ineligible application cannot be approved/);
  assert.match(route, /equipment_credit_application_decisions/);
  assert.match(route, /writeAuditEvent/);
  assert.doesNotMatch(route, /INSERT INTO equipment_sale_agreements/);
  assert.doesNotMatch(route, /UPDATE equipment_sale_agreements/);
  assert.doesNotMatch(route, /INSERT INTO equipment_asset_sale_locks/);
  assert.doesNotMatch(route, /UPDATE fleet_assets/);
  assert.doesNotMatch(route, /equipment_installment_schedule/);
  assert.doesNotMatch(route, /equipment_sale_payments/);
});

test("affordability policy records explicit internal controls", () => {
  const policy = read(
    "backend",
    "services",
    "equipmentCreditApplicationPolicy.js"
  );

  assert.match(policy, /standardDebtServiceRatioPercent: 40/);
  assert.match(policy, /maximumDebtServiceRatioPercent: 60/);
  assert.match(policy, /minimumDepositRatioPercent: 20/);
  assert.match(policy, /guarantorRequiredFromAmount: 100000/);
  assert.match(policy, /monthlyEquivalent/);
  assert.match(policy, /debt_service_ratio_percent/);
  assert.match(policy, /total_commitment_ratio_percent/);
  assert.match(policy, /affordability_status/);
  assert.match(policy, /risk_band/);
});
