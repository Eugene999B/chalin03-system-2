const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const backend = path.join(root, "backend");
const frontend = path.join(root, "frontend", "src");
const migration = fs.readFileSync(
  path.join(root, "database", "migrations", "20260801_equipment_finance_company_wide_stabilization.sql"),
  "utf8"
);
const triggerMigration = fs.readFileSync(
  path.join(root, "database", "migrations", "20260801_equipment_finance_company_wide_trigger_correction.sql"),
  "utf8"
);
const verifier = fs.readFileSync(
  path.join(root, "database", "migrations", "20260801_equipment_finance_company_wide_stabilization_verify.sql"),
  "utf8"
);
const startRoute = fs.readFileSync(
  path.join(backend, "routes", "equipmentFinancePhaseOneRoutes.js"),
  "utf8"
);
const applicationRoute = fs.readFileSync(
  path.join(backend, "routes", "equipmentFinanceCompanyWideApplicationRoutes.js"),
  "utf8"
);
const lifecycleRoute = fs.readFileSync(
  path.join(backend, "routes", "equipmentFinanceCompanyWideLifecycleRoutes.js"),
  "utf8"
);
const independentRoute = fs.readFileSync(
  path.join(backend, "routes", "equipmentFinanceIndependentRoutes.js"),
  "utf8"
);
const packageJson = fs.readFileSync(path.join(backend, "package.json"), "utf8");
const wizard = fs.readFileSync(
  path.join(frontend, "pages", "EquipmentFinanceStartWizardPage.jsx"),
  "utf8"
);
const layout = fs.readFileSync(
  path.join(frontend, "layouts", "InstallmentFinanceLayout.jsx"),
  "utf8"
);
const workspace = fs.readFileSync(
  path.join(frontend, "pages", "EquipmentSalesWorkspacePage.jsx"),
  "utf8"
);

test("Finance application-linked records become nullable and company-wide without altering Hire operational tables", () => {
  for (const table of [
    "equipment_credit_applications",
    "equipment_sales_quotations",
    "equipment_sales_quotation_items",
    "equipment_sale_agreements",
    "equipment_asset_sale_locks",
    "equipment_sale_payments",
    "equipment_deliveries",
    "equipment_ownership_transfers",
    "equipment_sales_reminder_log",
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*?hire_location_id INT NULL`));
  }
  assert.match(migration, /INNER JOIN equipment_credit_applications application/);
  assert.match(migration, /activation_source = 'approved_credit_application'/);
  assert.doesNotMatch(migration, /UPDATE\s+hire_contracts\s+SET\s+hire_location_id\s*=\s*NULL/i);
  assert.doesNotMatch(migration, /UPDATE\s+hire_jobs\s+SET\s+hire_location_id\s*=\s*NULL/i);
  assert.doesNotMatch(migration, /TRUNCATE\s+TABLE|DROP\s+DATABASE/i);
});

test("all Finance database guards identify the agreement instead of comparing Hire locations", () => {
  for (const trigger of [
    "trg_equipment_finance_payment_gate_before_insert",
    "trg_equipment_finance_reservation_gate_before_insert",
    "trg_equipment_finance_commitment_gate_before_update",
    "trg_equipment_finance_delivery_gate_before_insert",
    "trg_equipment_finance_ownership_gate_before_insert",
  ]) {
    assert.match(triggerMigration, new RegExp(`CREATE TRIGGER ${trigger}`));
  }
  assert.match(triggerMigration, /SET NEW\.hire_location_id = NULL/g);
  assert.doesNotMatch(
    triggerMigration,
    /NEW\.hire_location_id\s*<>|hire_location_id\s*=\s*NEW\.hire_location_id/i
  );
  assert.match(triggerMigration, /Equipment active on Hire cannot/);
  assert.match(triggerMigration, /idempotency_key/);
});

test("verifier blocks incomplete location removal and invalid interval terms", () => {
  for (const resultName of [
    "missing_finance_stabilization_columns",
    "non_nullable_finance_location_columns",
    "finance_records_with_hire_location",
    "invalid_finance_interval_terms",
    "invalid_company_wide_agreement_intervals",
    "finance_stabilization_migration_record_missing",
  ]) {
    assert.match(verifier, new RegExp(resultName));
  }
});

test("Start New Installment never resolves or writes a Hire location", () => {
  assert.doesNotMatch(startRoute, /resolveHireLocationScope|selectedLocationId|locationId\(req\)/);
  assert.doesNotMatch(startRoute, /ORDER BY 0 DESC/);
  assert.match(startRoute, /hire_location_id:\s*null/g);
  assert.match(startRoute, /workspaceCode:\s*"equipment_installment_finance"/);
  assert.match(startRoute, /affordability_status:\s*"not_assessed"/);
  assert.match(startRoute, /schedule-preview/);
});

test("applications enforce independent review and keep draft requirements separate from submission", () => {
  assert.match(applicationRoute, /EQUIPMENT_FINANCE_INDEPENDENT_REVIEW_REQUIRED/);
  assert.match(applicationRoute, /Only a draft or changes-requested application can be edited/);
  assert.match(applicationRoute, /Complete the customer affordability income before submission/);
  assert.match(applicationRoute, /Verify the required KYC evidence before approving/);
  assert.doesNotMatch(applicationRoute, /Choose a specific equipment location/);
});

test("collections, delivery and ownership use company-wide Finance evidence", () => {
  assert.match(lifecycleRoute, /hire_location_id:\s*null/g);
  assert.match(lifecycleRoute, /oldest_due_first_then_future_schedule/);
  assert.match(lifecycleRoute, /verifiedCaseDocument/);
  assert.match(lifecycleRoute, /customer_signature_document_id/);
  assert.match(lifecycleRoute, /ownership_document_id/);
  assert.match(lifecycleRoute, /sendBossPaymentAlert/);
  assert.doesNotMatch(lifecycleRoute, /selectedLocationId|resolveHireLocationScope/);
});

test("company-wide routers shadow legacy location-scoped Finance endpoints", () => {
  assert.match(independentRoute, /credit-applications", equipmentFinanceApplicationDetailRoutes/);
  assert.match(independentRoute, /credit-applications", equipmentFinanceCompanyWideApplicationRoutes/);
  assert.match(independentRoute, /finance-lifecycle", equipmentFinanceCompanyWideLifecycleRoutes/);
  assert.ok(
    independentRoute.indexOf("equipmentFinanceCompanyWideApplicationRoutes") <
      independentRoute.indexOf("equipmentFinanceProfessionalRoutes")
  );
});

test("Railway runs and verifies both stabilization migrations before API startup", () => {
  assert.match(packageJson, /runEquipmentFinanceCompanyWideStabilizationStartup\.js/);
  assert.match(packageJson, /runEquipmentFinanceCompanyWideTriggerCorrectionStartup\.js/);
  assert.ok(
    packageJson.indexOf("runEquipmentFinanceCompanyWideStabilizationStartup.js") <
      packageJson.indexOf("runEquipmentFinanceCompanyWideTriggerCorrectionStartup.js")
  );
  assert.ok(
    packageJson.indexOf("runEquipmentFinanceCompanyWideTriggerCorrectionStartup.js") <
      packageJson.indexOf("server.js")
  );
});

test("phone workflow exposes exact dates and optional draft assessment", () => {
  assert.match(wizard, /Choose number of days/);
  assert.match(wizard, /Exact schedule preview/);
  assert.match(wizard, /Everything on this step is optional when creating the draft/);
  assert.match(wizard, /These items do not block draft creation/);
  assert.match(wizard, /query\.get\("asset"\)/);
  assert.doesNotMatch(wizard, /Choose a Hire location|Choose a Finance location/);
  assert.match(workspace, /EquipmentFinanceCompanyWideApplicationsPage/);
  assert.match(workspace, /EquipmentFinanceCompanyWideLifecyclePage/);
});

test("legacy Finance bookmarks redirect away from Hire pages", () => {
  assert.match(layout, /LEGACY_FINANCE_REDIRECTS/);
  assert.match(layout, /applications\?stage=machines/);
  assert.match(layout, /applications\?stage=customers/);
  assert.match(layout, /equipment-installment-finance\/reports/);
  assert.match(layout, /equipment-installment-finance\/workforce/);
});
