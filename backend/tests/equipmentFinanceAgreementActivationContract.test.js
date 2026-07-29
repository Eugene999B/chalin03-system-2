const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const route = read(
  "backend/routes/equipmentFinanceAgreementActivationRoutes.js"
);
const schemaService = read("backend/services/equipmentSalesSchemaService.js");
const migration = read(
  "database/migrations/20260729_equipment_finance_agreement_activation.sql"
);
const verification = read(
  "database/migrations/20260729_equipment_finance_agreement_activation_verify.sql"
);

const combinedRuntime = `${route}\n${schemaService}`;

test("Finance activation is mounted only below the protected Equipment Sales router", () => {
  assert.match(
    schemaService,
    /require\("\.\.\/routes\/equipmentFinanceAgreementActivationRoutes"\)/
  );
  assert.match(schemaService, /"\/agreement-activations"/);
  assert.match(
    schemaService,
    /__chalin03FinanceAgreementActivationMounted/
  );
  assert.doesNotMatch(route, /server\.js|app\.use\(|requireAuth/);
});

test("only an approved Finance application can create an installment agreement", () => {
  assert.match(route, /application\.application_status !== "approved"/);
  assert.match(route, /application\.kyc_status !== "verified"/);
  assert.match(route, /\["eligible", "manual_review"\]/);
  assert.match(route, /ACTIVATION_ROLES/);
  assert.match(route, /finance_manager/);
  assert.match(route, /finance_accountant/);
  assert.match(route, /isOriginalSystemAdministrator/);
  assert.match(route, /terms_accepted/);
  assert.match(route, /credit_application_id: application\.id/);
  assert.match(route, /agreement_status: "approved"/);
  assert.match(route, /approval_status: "approved"/);
  assert.match(route, /INSERT INTO equipment_installment_schedule/);
  assert.match(route, /agreement_id = \?/);
});

test("activation does not perform Hire work, collect money, reserve a machine or send SMS", () => {
  for (const forbidden of [
    /INSERT INTO hire_contracts/i,
    /INSERT INTO hire_contract_assets/i,
    /INSERT INTO hire_dispatch/i,
    /INSERT INTO hire_invoices/i,
    /INSERT INTO hire_returns/i,
    /INSERT INTO equipment_sale_payments/i,
    /INSERT INTO equipment_asset_sale_locks/i,
    /UPDATE fleet_assets/i,
    /sendSmsAlertToPhone/i,
    /sendAgreementSms/i,
  ]) {
    assert.doesNotMatch(route, forbidden);
  }

  assert.match(route, /equipment_commitment_status: "not_reserved"/);
  assert.match(route, /equipment_reserved: false/);
  assert.match(route, /hire_contract_created: false/);
  assert.match(route, /payment_recorded: false/);
  assert.match(route, /sms_sent: false/);
});

test("database gate blocks new quotation-only installment agreements but preserves legacy updates", () => {
  assert.match(
    migration,
    /trg_equipment_installment_credit_gate_before_insert/
  );
  assert.match(
    migration,
    /trg_equipment_installment_credit_gate_before_update/
  );
  assert.match(
    migration,
    /Installment agreements require an approved Finance credit application/
  );
  assert.match(migration, /application_status = 'approved'/);
  assert.match(migration, /kyc_status = 'verified'/);
  assert.match(
    migration,
    /affordability_status IN \('eligible','manual_review'\)/
  );
  assert.match(migration, /OLD\.activation_source = 'legacy'/);
  assert.match(migration, /equipment_commitment_status = 'not_reserved'/);
  assert.doesNotMatch(migration, /INSERT INTO hire_/i);
  assert.doesNotMatch(migration, /UPDATE hire_/i);
});

test("activation migration is additive, idempotent and read-only verification is complete", () => {
  assert.match(migration, /ADD COLUMN/);
  assert.match(migration, /ADD CONSTRAINT/);
  assert.match(migration, /schema_migrations/);
  assert.match(migration, /ON DUPLICATE KEY UPDATE/);
  assert.match(migration, /BACKUP REQUIRED/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);

  for (const expected of [
    "missing_activation_columns",
    "missing_activation_indexes",
    "missing_activation_foreign_keys",
    "missing_activation_triggers",
    "duplicate_credit_application_agreement_links",
    "invalid_activated_credit_applications",
    "invalid_linked_finance_agreements",
    "forbidden_hire_link_columns",
    "activation_migration_record_missing",
  ]) {
    assert.match(verification, new RegExp(expected));
  }
  assert.doesNotMatch(
    verification,
    /\b(?:INSERT\s+INTO|UPDATE\s+[`A-Za-z]|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+(?:TABLE|TRIGGER|PROCEDURE|INDEX)|CREATE\s+(?:TABLE|TRIGGER|PROCEDURE|INDEX))\b/i
  );
});

test("runtime readiness is read-only and fails closed before activation", () => {
  assert.match(route, /information_schema\.COLUMNS/);
  assert.match(route, /information_schema\.TRIGGERS/);
  assert.match(route, /EQUIPMENT_FINANCE_ACTIVATION_FOUNDATION_REQUIRED/);
  assert.match(route, /router\.get\(\s*"\/readiness"/);
  assert.match(route, /router\.get\(\s*"\/candidates"/);
  assert.match(route, /router\.post\(\s*"\/:applicationId"/);
  assert.doesNotMatch(combinedRuntime, /CREATE TABLE|ALTER TABLE|DROP TABLE/i);
});
