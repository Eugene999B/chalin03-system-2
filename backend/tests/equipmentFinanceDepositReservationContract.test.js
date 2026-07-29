const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const route = read(
  "backend/routes/equipmentFinanceDepositReservationRoutes.js"
);
const schemaService = read("backend/services/equipmentSalesSchemaService.js");
const migration = read(
  "database/migrations/20260729_equipment_finance_deposit_reservation.sql"
);
const verification = read(
  "database/migrations/20260729_equipment_finance_deposit_reservation_verify.sql"
);
const combinedRuntime = `${route}\n${schemaService}`;

test("Finance deposit routes are mounted only below the protected Equipment Sales router", () => {
  assert.match(
    schemaService,
    /require\("\.\.\/routes\/equipmentFinanceDepositReservationRoutes"\)/
  );
  assert.match(schemaService, /"\/deposit-reservations"/);
  assert.match(
    schemaService,
    /__chalin03FinanceDepositReservationMounted/
  );
  assert.doesNotMatch(route, /server\.js|app\.use\(|requireAuth/);
});

test("only Finance Manager, Finance Accountant or protected System Administrator can collect the opening deposit", () => {
  assert.match(route, /finance_manager/);
  assert.match(route, /finance_accountant/);
  assert.match(route, /isOriginalSystemAdministrator/);
  assert.match(route, /assertDepositOfficer/);
  assert.match(route, /requirePermission\("fleet\.assets\.manage"\)/);
  assert.doesNotMatch(route, /hire_officer|dispatcher|fleet_officer/);
});

test("partial deposits do not reserve equipment and full deposits reserve atomically", () => {
  assert.match(route, /depositAfter/);
  assert.match(route, /depositComplete/);
  assert.match(route, /confirm_reservation/);
  assert.match(route, /payment_stage,\n\s+reservation_effect/);
  assert.match(route, /'opening_deposit'/);
  assert.match(route, /INSERT INTO equipment_asset_sale_locks/);
  assert.match(route, /lock_status,\n\s+lock_reason/);
  assert.match(route, /'installment_active'/);
  assert.match(route, /equipment_commitment_status = 'reserved'/);
  assert.match(route, /agreement_status = 'active'/);
  assert.match(route, /Partial opening deposit recorded/);
  assert.match(route, /machine remains available and unreserved/i);
});

test("deposit workflow is idempotent and does not allocate installment schedules", () => {
  assert.match(route, /idempotency_key/);
  assert.match(route, /already_recorded/);
  assert.match(migration, /uq_equipment_finance_payment_idempotency/);
  assert.doesNotMatch(route, /equipment_sale_payment_allocations/);
  assert.doesNotMatch(route, /UPDATE equipment_installment_schedule/);
});

test("deposit and reservation create no Hire work, delivery, ownership transfer or SMS", () => {
  for (const forbidden of [
    /INSERT INTO hire_contracts/i,
    /INSERT INTO hire_contract_assets/i,
    /INSERT INTO hire_dispatch/i,
    /INSERT INTO hire_invoices/i,
    /INSERT INTO hire_returns/i,
    /INSERT INTO equipment_deliveries/i,
    /INSERT INTO equipment_ownership_transfers/i,
    /sendSmsAlertToPhone/i,
    /sendAgreementSms/i,
  ]) {
    assert.doesNotMatch(route, forbidden);
  }
  assert.match(route, /hire_contract_created: false/);
  assert.match(route, /delivery_created: false/);
  assert.match(route, /ownership_transferred: false/);
  assert.match(route, /sms_sent: false/);
});

test("database triggers block generic payment bypasses and premature reservations", () => {
  assert.match(
    migration,
    /trg_equipment_finance_payment_gate_before_insert/
  );
  assert.match(
    migration,
    /trg_equipment_finance_reservation_gate_before_insert/
  );
  assert.match(
    migration,
    /trg_equipment_finance_commitment_gate_before_update/
  );
  assert.match(
    migration,
    /Use the controlled Finance collection stage for approved-credit agreements/
  );
  assert.match(
    migration,
    /required opening deposit must be complete before reservation/i
  );
  assert.match(migration, /hire_asset\.status IN \('assigned','dispatched','active'\)/);
  assert.match(migration, /Finance deposit balance must match controlled opening-deposit receipts/);
  assert.doesNotMatch(migration, /INSERT INTO hire_/i);
  assert.doesNotMatch(migration, /UPDATE hire_/i);
});

test("migration is additive and verification is read-only and complete", () => {
  assert.match(migration, /ADDITIVE MIGRATION ONLY/);
  assert.match(migration, /BACKUP REQUIRED/);
  assert.match(migration, /ADD COLUMN/);
  assert.match(migration, /ADD CONSTRAINT/);
  assert.match(migration, /schema_migrations/);
  assert.match(migration, /ON DUPLICATE KEY UPDATE/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);

  for (const expected of [
    "missing_deposit_reservation_columns",
    "missing_deposit_reservation_indexes",
    "missing_deposit_reservation_foreign_keys",
    "missing_deposit_reservation_triggers",
    "bypassed_controlled_finance_payments",
    "invalid_opening_deposit_payments",
    "invalid_controlled_deposit_balances",
    "invalid_reserved_finance_agreements",
    "invalid_controlled_finance_sale_locks",
    "reserved_finance_assets_active_on_hire",
    "forbidden_deposit_hire_link_columns",
    "deposit_reservation_migration_record_missing",
  ]) {
    assert.match(verification, new RegExp(expected));
  }

  assert.doesNotMatch(
    verification,
    /\b(?:INSERT\s+INTO|UPDATE\s+[`a-z]|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+(?:TABLE|TRIGGER|PROCEDURE)|CREATE\s+(?:TABLE|TRIGGER|PROCEDURE)|TRUNCATE\s+TABLE)\b/i
  );
});

test("runtime readiness is read-only and fails closed", () => {
  assert.match(route, /information_schema\.COLUMNS/);
  assert.match(route, /information_schema\.TRIGGERS/);
  assert.match(route, /EQUIPMENT_FINANCE_DEPOSIT_FOUNDATION_REQUIRED/);
  assert.match(route, /router\.get\("\/readiness"/);
  assert.match(route, /router\.get\("\/candidates"/);
  assert.match(route, /router\.post\(\n\s+"\/:agreementId\/deposit"/);
  assert.doesNotMatch(combinedRuntime, /CREATE TABLE|ALTER TABLE|DROP TABLE/i);
});
