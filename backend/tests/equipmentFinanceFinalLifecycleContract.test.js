const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const route = read("backend/routes/equipmentFinanceFinalLifecycleRoutes.js");
const migration = read(
  "database/migrations/20260729_equipment_finance_final_lifecycle.sql"
);
const verifier = read(
  "database/migrations/20260729_equipment_finance_final_lifecycle_verify.sql"
);
const reminderService = read("backend/services/equipmentSalesReminderService.js");
const workspacePage = read("frontend/src/pages/EquipmentSalesWorkspacePage.jsx");
const lifecyclePage = read("frontend/src/pages/EquipmentFinanceFinalLifecyclePage.jsx");
const lifecycleCss = read("frontend/src/styles/equipmentFinanceFinalLifecycle.css");
const financeLayout = read("frontend/src/layouts/InstallmentFinanceLayout.jsx");
const serviceWorker = read("frontend/public/sw.js");
const runbook = read("docs/EQUIPMENT_FINANCE_FINAL_LIFECYCLE_PRODUCTION_RUNBOOK.md");

function stripSqlComments(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

test("final Finance lifecycle exposes separate controlled endpoints", () => {
  for (const pattern of [
    /router\.get\("\/readiness"/,
    /router\.get\("\/accounts"/,
    /"\/accounts\/:agreementId"/,
    /"\/accounts\/:agreementId\/collections"/,
    /"\/accounts\/:agreementId\/delivery"/,
    /"\/accounts\/:agreementId\/ownership-transfer"/,
  ]) {
    assert.match(route, pattern);
  }

  assert.match(route, /COLLECTION_ROLES/);
  assert.match(route, /collections_officer/);
  assert.match(route, /FINALISATION_ROLES/);
  assert.match(route, /isOriginalSystemAdministrator/);
  assert.match(route, /workspaceRoleFor/);
  assert.match(route, /requirePermission\("fleet\.assets\.manage"\)/);
});

test("controlled collections allocate schedules and use secure idempotency", () => {
  assert.match(route, /finance-collection/);
  assert.match(route, /installment_collection/);
  assert.match(route, /settlement/);
  assert.match(route, /equipment_sale_payment_allocations/);
  assert.match(route, /allocateCollection/);
  assert.match(route, /idempotency_key/);
  assert.match(route, /crypto\.randomInt/);
  assert.match(route, /receipt_number/);
  assert.match(route, /replayed: true/);
});

test("delivery and ownership remain Finance evidence without Hire or SMS writes", () => {
  assert.match(route, /finance_controlled/);
  assert.match(route, /EQUIPMENT_FINANCE_DELIVERY_COMPLETED/);
  assert.match(route, /EQUIPMENT_FINANCE_OWNERSHIP_TRANSFERRED/);
  assert.match(route, /active_hire_count/);
  assert.match(route, /outstanding_balance/);
  assert.match(route, /delivery_status/);
  assert.match(route, /sale_status = 'sold'/);
  assert.match(route, /automatic_sms_sent: false/);
  assert.match(route, /sms: \{ sent: false, automatic: false \}/);
  assert.doesNotMatch(route, /sendSmsAlertToPhone|sendAgreementSms|sendManualInstallmentReminder/);
  assert.doesNotMatch(
    route,
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:hire_contracts|hire_jobs|hire_dispatches|hire_invoices|hire_payments|hire_returns|worker_assignments)\b/i
  );
});

test("database migration enforces the final approved-credit lifecycle", () => {
  assert.match(migration, /-- ADDITIVE MIGRATION ONLY\./);
  assert.match(migration, /-- FORWARD-ONLY CHANGE\./);
  assert.match(migration, /BACKUP REQUIRED BEFORE PRODUCTION EXECUTION/);
  assert.match(migration, /Never run database\/schema\.sql against production/);

  for (const name of [
    "controlled_delivery_completed_at",
    "controlled_delivery_completed_by",
    "controlled_ownership_completed_at",
    "controlled_ownership_completed_by",
    "handover_stage",
    "transfer_stage",
    "idempotency_key",
  ]) {
    assert.match(migration, new RegExp(name));
  }

  for (const trigger of [
    "trg_equipment_finance_payment_gate_before_insert",
    "trg_equipment_finance_delivery_gate_before_insert",
    "trg_equipment_finance_ownership_gate_before_insert",
    "trg_equipment_finance_lifecycle_agreement_before_update",
  ]) {
    assert.match(migration, new RegExp(trigger));
  }

  assert.match(migration, /Use the controlled Finance deposit or collection endpoint/);
  assert.match(migration, /Use the controlled Finance delivery-handover endpoint/);
  assert.match(migration, /Use the controlled Finance ownership-transfer endpoint/);
  assert.match(migration, /Equipment active on Hire cannot/);
});

test("final lifecycle verifier is read-only and covers every safety count", () => {
  for (const resultName of [
    "missing_final_lifecycle_columns",
    "missing_final_lifecycle_indexes",
    "missing_final_lifecycle_foreign_keys",
    "missing_final_lifecycle_triggers",
    "bypassed_controlled_finance_payments",
    "invalid_controlled_finance_collections",
    "invalid_controlled_finance_deliveries",
    "invalid_controlled_finance_ownership_transfers",
    "uncontrolled_finance_delivery_statuses",
    "uncontrolled_finance_ownership_statuses",
    "controlled_finance_assets_active_on_hire",
  ]) {
    assert.match(verifier, new RegExp(resultName));
  }

  assert.doesNotMatch(
    stripSqlComments(verifier),
    /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL|REPLACE)\b/i
  );
});

test("automatic installment SMS is frozen until separately approved", () => {
  assert.match(reminderService, /EQUIPMENT_INSTALLMENT_AUTOMATIC_SMS_APPROVED/);
  assert.match(reminderService, /AUTOMATIC_SMS_APPROVED/);
  assert.match(reminderService, /automatic_sms_enabled: false/);
  assert.match(reminderService, /requires a separate approved release/);
  assert.match(reminderService, /"\/finance-lifecycle"/);
  assert.match(reminderService, /equipmentFinanceFinalLifecycleRoutes/);
});

test("Finance UI exposes final stages and blocks hidden Hire routes", () => {
  assert.match(workspacePage, /EquipmentFinanceFinalLifecyclePage/);
  assert.match(workspacePage, /collections/);
  assert.match(workspacePage, /delivery/);
  assert.match(workspacePage, /ownership/);

  assert.match(lifecyclePage, /finance-lifecycle/);
  assert.match(lifecyclePage, /crypto\?\.randomUUID/);
  assert.match(lifecyclePage, /finance-collection/);
  assert.match(lifecyclePage, /finance-delivery/);
  assert.match(lifecyclePage, /finance-ownership/);
  assert.match(lifecyclePage, /Collections Officer/);
  assert.match(lifecyclePage, /will not send automatic or transaction-triggered SMS/);
  assert.doesNotMatch(lifecyclePage, /\/equipment-hire-operations/);
  assert.doesNotMatch(lifecyclePage, /sendSms|WhatsApp/);

  for (const title of [
    "Installment Collections",
    "Delivery Handover",
    "Ownership Transfer",
  ]) {
    assert.match(financeLayout, new RegExp(title));
  }
  assert.match(financeLayout, /BLOCKED_FINANCE_PATHS/);
  assert.match(financeLayout, /Finance Customers & Portfolio/);
  assert.match(financeLayout, /stage=customers/);
  assert.doesNotMatch(
    financeLayout,
    /BLOCKED_FINANCE_PATHS[\s\S]*equipment-installment-finance\/customers/
  );
  assert.match(financeLayout, /equipment-installment-finance\/workers/);
  assert.match(financeLayout, /isBlockedFinancePath/);
  assert.match(lifecycleCss, /@media \(max-width: 760px\)/);
  assert.match(lifecycleCss, /@media \(max-width: 480px\)/);
});

test("cache and runbook preserve the fail-closed production boundary", () => {
  assert.match(serviceWorker, /chalin03-finance-final-lifecycle-v24/);
  assert.match(serviceWorker, /chalin03-finance-deposit-reservation-v23/);
  assert.match(runbook, /20260729_equipment_credit_application_foundation\.sql/);
  assert.match(runbook, /20260729_equipment_finance_agreement_activation\.sql/);
  assert.match(runbook, /20260729_equipment_finance_deposit_reservation\.sql/);
  assert.match(runbook, /20260729_equipment_finance_final_lifecycle\.sql/);
  assert.match(runbook, /Every result below must be exactly `0`/);
  assert.match(runbook, /Automatic installment SMS remains disabled/);
  assert.match(runbook, /Never run `database\/schema\.sql` against production/);
});
