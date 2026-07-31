const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const migration = read(
  "database",
  "migrations",
  "20260731_equipment_finance_professional_rebuild.sql"
);
const verifier = read(
  "database",
  "migrations",
  "20260731_equipment_finance_professional_rebuild_verify.sql"
);
const professionalService = read(
  "backend",
  "services",
  "equipmentFinanceProfessionalService.js"
);
const imageService = read(
  "backend",
  "services",
  "equipmentFinanceImageCompatibilityService.js"
);
const machineService = read(
  "backend",
  "services",
  "equipmentFinanceMachineRegisterService.js"
);
const professionalRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceProfessionalRoutes.js"
);
const machineRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceMachineRegisterRoutes.js"
);
const independentRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceIndependentRoutes.js"
);
const lifecycleRoutes = read(
  "backend",
  "routes",
  "equipmentFinanceFinalLifecycleRoutes.js"
);
const reminderService = read(
  "backend",
  "services",
  "equipmentFinanceProfessionalReminderService.js"
);
const divisionAccess = read(
  "backend",
  "security",
  "equipmentDivisionAccess.js"
);
const divisionAdmin = read(
  "backend",
  "routes",
  "equipmentDivisionAdminRoutes.js"
);
const page = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceProfessionalPage.jsx"
);
const layout = read(
  "frontend",
  "src",
  "layouts",
  "InstallmentFinanceLayout.jsx"
);
const css = read(
  "frontend",
  "src",
  "styles",
  "equipmentFinanceProfessional.css"
);

function stripSqlComments(source) {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

test("professional Finance migration is additive and preserves all existing business records", () => {
  assert.match(migration, /ADDITIVE MIGRATION ONLY/);
  assert.match(migration, /FORWARD-ONLY CHANGE/);
  assert.match(migration, /Existing Finance applications, agreements, schedules, payments, deliveries/);
  assert.doesNotMatch(
    stripSqlComments(migration),
    /\b(?:TRUNCATE|DROP\s+TABLE|DELETE\s+FROM|RENAME\s+TABLE)\b/i
  );

  for (const table of [
    "equipment_finance_settings",
    "equipment_finance_settings_history",
    "equipment_finance_document_signatures",
    "equipment_finance_issued_documents",
    "equipment_finance_payment_alerts",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }

  for (const column of [
    "registration_number",
    "customs_reference",
    "title_document_reference",
    "insurance_reference",
    "minimum_selling_price",
    "terms_version",
    "agreement_document_number",
    "agreement_issued_at",
    "agreement_signed_at",
  ]) {
    assert.match(migration, new RegExp(column));
  }
});

test("professional verifier is read-only and checks every new control", () => {
  for (const result of [
    "missing_professional_finance_tables",
    "missing_professional_finance_columns",
    "missing_professional_finance_indexes",
    "missing_professional_finance_foreign_keys",
    "invalid_professional_finance_settings",
    "duplicate_professional_finance_settings",
    "invalid_professional_finance_documents",
    "invalid_professional_finance_signatures",
    "invalid_professional_finance_payment_alerts",
    "professional_finance_migration_record_missing",
  ]) {
    assert.match(verifier, new RegExp(result));
  }
  assert.doesNotMatch(
    stripSqlComments(verifier),
    /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL|REPLACE)\b/i
  );
});

test("one authoritative lifecycle route returns controlled readiness instead of raw 500", () => {
  assert.doesNotMatch(
    independentRoutes,
    /router\.get\(\s*"\/finance-lifecycle\/accounts"/
  );
  assert.match(independentRoutes, /router\.use\("\/finance-lifecycle"/);
  assert.match(independentRoutes, /assertProfessionalSchema/);
  assert.match(independentRoutes, /status: "error"/);
  assert.match(independentRoutes, /readiness/);
  assert.match(lifecycleRoutes, /router\.get\("\/accounts"/);
  assert.match(lifecycleRoutes, /assertSchemaReady/);
  assert.match(lifecycleRoutes, /503/);
});

test("excavator register captures exact identity, pricing, yard and protected photo evidence", () => {
  for (const field of [
    "asset_code",
    "asset_name",
    "make",
    "model",
    "model_year",
    "serial_number",
    "chassis_number",
    "engine_number",
    "registration_number",
    "customs_reference",
    "title_document_reference",
    "insurance_reference",
    "target_selling_price",
    "minimum_selling_price",
    "current_meter",
  ]) {
    assert.match(machineService, new RegExp(field));
    assert.match(page, new RegExp(field));
  }
  assert.match(machineService, /serial number or chassis number/i);
  assert.match(machineService, /active_hire_count/);
  assert.match(machineService, /Another machine already uses/);
  assert.match(machineService, /EQUIPMENT_FINANCE_MACHINE_REGISTERED/);
  assert.match(machineRoutes, /normalizePhotoPayload/);
  assert.match(machineRoutes, /legacy_webp_download_compatibility: true/);
  assert.match(page, /capture="environment"/);
  assert.match(page, /main document photo/i);
  assert.match(page, /full main excavator photo/i);
  assert.match(css, /object-fit: contain/);
  assert.doesNotMatch(css, /object-fit:\s*cover/);
});

test("WebP camera and signature evidence becomes PDF-safe without cropping", () => {
  assert.match(imageService, /require\("sharp"\)/);
  assert.match(imageService, /image\/(?:jpeg\|jpg\|png\|webp)/);
  assert.match(imageService, /fit: "inside"/);
  assert.match(imageService, /withoutEnlargement: true/);
  assert.match(imageService, /flatten/);
  assert.match(imageService, /jpeg/);
  assert.match(imageService, /MAX_PROTECTED_IMAGE_BYTES/);
  assert.match(imageService, /normalizeSnapshotImages/);
  assert.match(imageService, /service\.getIssuedDocument = async/);
  assert.match(imageService, /service\.saveSignature = async/);
  assert.match(machineRoutes, /installFinanceImageCompatibility\(\)/);
});

test("Finance settings cover commercial, reminder, document and legal controls with history", () => {
  for (const setting of [
    "boss_payment_alert_enabled",
    "boss_payment_alert_phone",
    "automatic_reminders_enabled",
    "minimum_deposit_percent",
    "maximum_term_months",
    "maximum_installment_count",
    "default_payment_frequency",
    "default_grace_days",
    "late_charge_type",
    "delivery_policy",
    "delivery_threshold_percent",
    "allow_partial_payments",
    "advance_excess_to_future",
    "default_review_missed_installments",
    "notice_cure_days",
    "legal_review_status",
    "agreement_terms",
    "authorised_seller_name",
    "authorised_seller_signature_data_url",
  ]) {
    assert.match(migration, new RegExp(setting));
    assert.match(professionalService, new RegExp(setting));
  }
  assert.match(professionalService, /equipment_finance_settings_history/);
  assert.match(professionalService, /change reason/i);
  assert.match(professionalService, /Approved legal terms require/);
  assert.match(page, /Finance Settings/);
  assert.match(page, /Boss payment-alert phone/);
  assert.match(page, /Versioned agreement terms/);
});

test("agreement document pack is automatic, versioned, signed and checksum protected", () => {
  for (const evidence of [
    "buyer",
    "guarantor",
    "asset_code",
    "serial_number",
    "chassis_number",
    "schedule",
    "media",
    "signatures",
    "agreement_terms",
  ]) {
    assert.match(professionalService, new RegExp(evidence));
  }
  assert.match(professionalService, /snapshot_checksum/);
  assert.match(professionalService, /createHash\("sha256"\)/);
  assert.match(professionalService, /application\/msword/);
  assert.match(professionalService, /PDFDocument/);
  assert.match(professionalService, /EXCAVATOR SALE & INSTALLMENT AGREEMENT/);
  assert.match(professionalService, /Machine Identity and Photo Annexure/);
  assert.match(professionalService, /Installment payment schedule/i);
  assert.match(professionalService, /Terms and conditions/i);
  assert.match(professionalRoutes, /\/professional\/documents\/issue/);
  assert.match(professionalRoutes, /\/professional\/documents\/:documentId\/download/);
  assert.match(professionalRoutes, /\/professional\/agreements\/:agreementId\/signatures/);
  assert.match(professionalService, /EQUIPMENT_FINANCE_TERMS_APPROVAL_REQUIRED/);
});

test("late, partial and above-period payments preserve exact schedule evidence", () => {
  assert.match(lifecycleRoutes, /Math\.min\(remaining, lineBalance\)/);
  assert.match(lifecycleRoutes, /ORDER BY due_date, sequence_number/);
  assert.match(lifecycleRoutes, /schedule_status = \?/);
  assert.match(lifecycleRoutes, /"paid" : "partial"/);
  assert.match(lifecycleRoutes, /payment exceeds the final account balance/i);
  assert.match(lifecycleRoutes, /FINANCE_COLLECTION_EXCEEDS_ACCOUNT_BALANCE/);
  assert.match(lifecycleRoutes, /Final settlement recorded/);
  assert.match(page, /Advance payment above the period into future schedule lines/);
});

test("boss alert is external post-commit evidence and never rolls back a payment", () => {
  const collectionStart = lifecycleRoutes.indexOf("/collections");
  const commit = lifecycleRoutes.indexOf("await connection.commit();", collectionStart);
  const alert = lifecycleRoutes.indexOf("await sendBossPaymentAlert", collectionStart);
  assert.ok(commit > collectionStart);
  assert.ok(alert > commit);
  assert.match(professionalService, /Finance boss payment alert failed after committed payment/);
  assert.match(professionalService, /equipment_finance_payment_alerts/);
  assert.match(professionalService, /sourceReference: `equipment-finance-payment:/);
  assert.match(professionalService, /replayed: true/);
});

test("reminders are Ghana-time, configurable, limited and duplicate protected", () => {
  assert.match(reminderService, /Africa\/Accra/);
  assert.match(reminderService, /due_soon/);
  assert.match(reminderService, /due_today/);
  assert.match(reminderService, /overdue/);
  assert.match(reminderService, /automatic_reminders_enabled/);
  assert.match(reminderService, /max_sms_7_days/);
  assert.match(reminderService, /max_sms_30_days/);
  assert.match(reminderService, /minimum_hours_between_sms/);
  assert.match(reminderService, /INSERT IGNORE INTO equipment_sales_reminder_log/);
  assert.match(professionalRoutes, /RUN INSTALLMENT REMINDERS/);
});

test("approved dual Equipment roles use one login while exact actions remain protected", () => {
  for (const role of [
    "equipment_business_manager",
    "equipment_business_accountant",
    "equipment_business_auditor",
  ]) {
    assert.match(divisionAccess, new RegExp(role));
    assert.match(divisionAdmin, new RegExp(role));
    assert.match(page, new RegExp(labelForRegex(role)));
  }
  assert.match(divisionAccess, /DUAL_DIVISION_ROLES/);
  assert.match(divisionAccess, /SHARED_REGISTER_WRITE_ROLES/);
  assert.match(divisionAdmin, /revokeUserSessions/);
  assert.match(divisionAdmin, /EQUIPMENT_STAFF_DIVISION_ASSIGNED/);
  assert.match(divisionAdmin, /action_permissions_remain_separate: true/);
});

function labelForRegex(role) {
  return role
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

test("professional UI exposes the complete excavator Finance lifecycle", () => {
  for (const title of [
    "Finance Command Centre",
    "Excavator Register",
    "Finance Customers",
    "Credit Applications & Approval",
    "Agreement Activation",
    "Agreement Documents",
    "Deposit & Reservation",
    "Installment Collections",
    "Arrears & Follow-up",
    "Rescheduling, Waivers & Recovery",
    "Delivery & Handover",
    "Ownership Transfer",
    "Finance Documents & Reports",
    "Finance Settings",
    "Equipment Staff",
  ]) {
    assert.match(layout, new RegExp(title.replace(/[&]/g, "\\&")));
  }
  assert.match(page, /MachineRegister/);
  assert.match(page, /SettingsWorkspace/);
  assert.match(page, /DocumentStudio/);
  assert.match(page, /StaffWorkspace/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media print/);
});
