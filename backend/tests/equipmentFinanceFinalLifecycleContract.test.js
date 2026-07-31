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
const professionalReminder = read(
  "backend/services/equipmentFinanceProfessionalReminderService.js"
);
const workspacePage = read("frontend/src/pages/EquipmentSalesWorkspacePage.jsx");
const lifecyclePage = read("frontend/src/pages/EquipmentFinanceFinalLifecyclePage.jsx");
const lifecycleCss = read(
  "frontend/src/styles/equipmentFinanceLifecycleProfessional.css"
);
const financeLayout = read("frontend/src/layouts/InstallmentFinanceLayout.jsx");

function stripSqlComments(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

test("final Finance lifecycle exposes one company-wide controlled API", () => {
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

  assert.match(route, /scope: "company_wide_finance"/);
  assert.match(route, /hire_location_selection_required: false/);
  assert.match(route, /COLLECTION_ROLES/);
  assert.match(route, /collections_officer/);
  assert.match(route, /equipment_business_accountant/);
  assert.match(route, /FINALISATION_ROLES/);
  assert.match(route, /isOriginalSystemAdministrator/);
  assert.match(route, /workspaceRoleFor/);
  assert.match(route, /requirePermission\("fleet\.assets\.manage"\)/);
});

test("controlled collections support partial and above-period payments safely", () => {
  assert.match(route, /finance-collection/);
  assert.match(route, /installment_collection/);
  assert.match(route, /settlement/);
  assert.match(route, /equipment_sale_payment_allocations/);
  assert.match(route, /allocateCollection/);
  assert.match(route, /ORDER BY due_date, sequence_number/);
  assert.match(route, /Math\.min\(remaining, lineBalance\)/);
  assert.match(route, /FINANCE_COLLECTION_EXCEEDS_ACCOUNT_BALANCE/);
  assert.match(route, /FINANCE_COLLECTION_ALLOCATION_INCOMPLETE/);
  assert.match(route, /idempotency_key/);
  assert.match(route, /receipt_number/);
  assert.match(route, /replayed: true/);
});

test("boss payment alert begins only after the collection commits", () => {
  const commitIndex = route.indexOf("await connection.commit();", route.indexOf("/collections"));
  const alertIndex = route.indexOf("await sendBossPaymentAlert", route.indexOf("/collections"));
  assert.ok(commitIndex > -1);
  assert.ok(alertIndex > commitIndex);
  assert.match(route, /boss_payment_alert: bossAlert/);
  assert.match(route, /automatic_sms_sent: Boolean\(bossAlert\.ok\)/);
  assert.doesNotMatch(
    route,
    /sendBossPaymentAlert[\s\S]{0,500}await connection\.commit\(\)/
  );
});

test("delivery and ownership remain Finance evidence without Hire writes", () => {
  assert.match(route, /finance_controlled/);
  assert.match(route, /EQUIPMENT_FINANCE_DELIVERY_COMPLETED/);
  assert.match(route, /EQUIPMENT_FINANCE_OWNERSHIP_TRANSFERRED/);
  assert.match(route, /active_hire_count/);
  assert.match(route, /outstanding_balance/);
  assert.match(route, /delivery_status/);
  assert.match(route, /sale_status = 'sold'/);
  assert.match(route, /automatic_sms_sent: false/);
  assert.match(route, /sms: \{ sent: false, automatic: false \}/);
  assert.doesNotMatch(
    route,
    /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:hire_contracts|hire_jobs|hire_dispatches|hire_invoices|hire_payments|hire_returns|worker_assignments)\b/i
  );
});

test("database migration enforces the original approved-credit lifecycle", () => {
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

test("automatic installment reminders are settings-controlled and deduplicated", () => {
  assert.match(reminderService, /startProfessionalReminderScheduler/);
  assert.match(reminderService, /runProfessionalReminderSync/);
  assert.match(reminderService, /AUTOMATIC_SMS_APPROVED = true/);
  assert.match(reminderService, /company-wide Finance settings row/);
  assert.match(reminderService, /"\/finance-lifecycle"/);
  assert.match(professionalReminder, /automatic_reminders_enabled/);
  assert.match(professionalReminder, /minimum_hours_between_sms/);
  assert.match(professionalReminder, /max_sms_7_days/);
  assert.match(professionalReminder, /max_sms_30_days/);
  assert.match(professionalReminder, /INSERT IGNORE INTO equipment_sales_reminder_log/);
  assert.match(professionalReminder, /Africa\/Accra/);
});

test("Finance UI exposes professional stages and full uncropped machine evidence", () => {
  assert.match(workspacePage, /EquipmentFinanceProfessionalPage/);
  for (const stage of [
    "machines",
    "settings",
    "documents",
    "staff",
    "collections",
    "delivery",
    "ownership",
  ]) {
    assert.match(workspacePage, new RegExp(stage));
  }

  assert.match(lifecyclePage, /company-wide Installment Finance portfolio/i);
  assert.match(lifecyclePage, /partial, exact or above-period/i);
  assert.match(lifecyclePage, /boss_payment_alert/);
  assert.match(lifecyclePage, /Boss alert/);
  assert.doesNotMatch(lifecyclePage, /WorkspaceContext/);
  assert.doesNotMatch(lifecyclePage, /selectedHireLocation/);
  assert.match(lifecycleCss, /object-fit: contain/);
  assert.match(lifecycleCss, /finance-lifecycle__machine-photo/);
  assert.match(lifecycleCss, /finance-lifecycle__drawer-machine/);

  for (const title of [
    "Excavator Register",
    "Agreement Documents",
    "Installment Collections",
    "Arrears & Follow-up",
    "Delivery & Handover",
    "Ownership Transfer",
    "Finance Settings",
    "Equipment Staff",
  ]) {
    assert.match(financeLayout, new RegExp(title.replace(/[&]/g, "\\&")));
  }
  assert.match(financeLayout, /stage=customers/);
  assert.match(financeLayout, /stage=documents/);
  assert.match(financeLayout, /stage=settings/);
  assert.match(financeLayout, /equipmentFinanceLifecycleProfessional\.css/);
});
