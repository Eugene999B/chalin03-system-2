const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const service = read(
  "backend",
  "services",
  "equipmentFinanceRecoveryGovernanceService.js"
);
const routes = read(
  "backend",
  "routes",
  "equipmentFinanceRecoveryGovernanceRoutes.js"
);
const commandRoutes = read(
  "backend",
  "routes",
  "equipmentInstallmentCommandRoutes.js"
);
const auditService = read("backend", "services", "auditTrailService.js");
const page = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceRecoveryGovernancePage.jsx"
);
const dispatcher = read(
  "frontend",
  "src",
  "pages",
  "EquipmentSalesWorkspacePage.jsx"
);
const layout = read(
  "frontend",
  "src",
  "layouts",
  "InstallmentFinanceLayout.jsx"
);

const HIRE_WRITE =
  /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:hire_contracts|hire_jobs|hire_dispatches|hire_invoices|hire_payments|hire_returns|hire_contract_assets)\b/i;
const PAYMENT_WRITE =
  /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:equipment_sale_payments|equipment_sale_payment_allocations)\b/i;
const FLEET_WRITE =
  /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:fleet_assets|equipment_asset_sale_locks|equipment_deliveries|equipment_ownership_transfers)\b/i;
const DESTRUCTIVE_SCHEDULE = /DELETE\s+FROM\s+equipment_installment_schedule/i;
const DDL = /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|DATABASE)\b/i;

test("Finance governance is company-wide and approved-credit only", () => {
  assert.match(service, /FINANCE_WORKSPACE = "equipment_installment_finance"/);
  assert.match(service, /activation_source = 'approved_credit_application'/);
  assert.match(service, /scope: "company_wide"/);
  assert.match(service, /hire_location_selection_required: false/);
  assert.match(service, /hire_workflow_access: false/);
  assert.match(service, /automatic_sms_enabled: false/);
  assert.match(service, /MINIMUM_DEFAULT_DAYS = 30/);
  assert.doesNotMatch(service, /selectedLocationId|req\.hireLocationScope/);
});

test("governance requests and decisions preserve independent control", () => {
  for (const action of [
    "EQUIPMENT_FINANCE_RESCHEDULE_REQUESTED",
    "EQUIPMENT_FINANCE_RESCHEDULE_APPROVED",
    "EQUIPMENT_FINANCE_RESCHEDULE_REJECTED",
    "EQUIPMENT_FINANCE_DEFAULT_REVIEW_REQUESTED",
    "EQUIPMENT_FINANCE_DEFAULT_DECLARED",
    "EQUIPMENT_FINANCE_DEFAULT_REJECTED",
    "EQUIPMENT_FINANCE_RECOVERY_ACTION_RECORDED",
  ]) {
    assert.match(service, new RegExp(action));
  }
  assert.match(service, /independent_approval_required: true/);
  assert.match(service, /FINANCE_GOVERNANCE_INDEPENDENT_APPROVER_REQUIRED/);
  assert.match(service, /request\.user_id/);
  assert.match(service, /request_activity_id/);
  assert.match(service, /original_request_preserved: true/);
  assert.match(service, /FOR UPDATE/);
  assert.match(auditService, /return Number\(result\?\.insertId/);
});

test("reschedule approval preserves paid evidence and replaces open lines safely", () => {
  assert.match(service, /financial_snapshot/);
  assert.match(service, /fingerprint/);
  assert.match(service, /FINANCE_RESCHEDULE_REQUEST_STALE/);
  assert.match(
    service,
    /schedule_status = 'rescheduled'[\s\S]*schedule_status IN \('upcoming','due','partial','overdue'\)/
  );
  assert.match(service, /INSERT INTO equipment_installment_schedule/);
  assert.match(service, /paid_schedule_lines_preserved: true/);
  assert.match(service, /outstanding_balance_preserved/);
  assert.match(service, /amount_paid_preserved/);
  assert.match(service, /payment_records_changed: false/);
  assert.match(service, /balance_changed: false/);
  assert.doesNotMatch(service, DESTRUCTIVE_SCHEDULE);
  assert.doesNotMatch(service, PAYMENT_WRITE);
});

test("default review changes status only after threshold and independent approval", () => {
  assert.match(service, /days_past_due/);
  assert.match(service, /FINANCE_DEFAULT_THRESHOLD_NOT_REACHED/);
  assert.match(
    service,
    /UPDATE equipment_sale_agreements[\s\S]*SET agreement_status = 'defaulted'[\s\S]*WHERE id = \?/
  );
  assert.match(service, /schedule_changed: false/);
  assert.match(service, /balance_changed: false/);
  assert.match(service, /fleet_status_changed: false/);
  assert.match(service, /ownership_status_changed: false/);
  assert.match(service, /repossession_created: false/);
  assert.match(service, /legal_action_created: false/);
});

test("recovery actions are evidence-only and never execute Hire or fleet work", () => {
  assert.match(service, /RECOVERY_ACTION_TYPES/);
  assert.match(service, /agreement\.agreement_status !== "defaulted"/);
  assert.match(service, /repossession_review/);
  assert.match(service, /legal_referral/);
  assert.match(service, /repossession_executed: false/);
  assert.match(service, /legal_case_created: false/);
  assert.match(service, /hire_work_created: false/);
  assert.match(service, /automatic_sms_sent: false/);
  assert.doesNotMatch(service, HIRE_WRITE);
  assert.doesNotMatch(service, FLEET_WRITE);
  assert.doesNotMatch(service, DDL);
  assert.doesNotMatch(service, /sendSms|sendManualInstallmentReminder|sendSmsAlertToPhone/);
});

test("governance API is protected by Finance roles and command routing", () => {
  assert.match(commandRoutes, /equipmentFinanceRecoveryGovernanceRoutes/);
  assert.match(commandRoutes, /router\.use\("\/governance"/);
  for (const endpoint of [
    "reschedule-requests",
    "default-requests",
    "requests/:requestId/decisions",
    "recovery-actions",
  ]) {
    assert.match(routes, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.match(routes, /requirePermission\("fleet\.assets\.view"\)/);
  assert.match(routes, /requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(routes, /APPROVAL_ROLES = new Set\(\["finance_manager"\]\)/);
  assert.match(routes, /isOriginalSystemAdministrator/);
});

test("Finance governance interface is discoverable and stays outside Hire", () => {
  assert.match(dispatcher, /EquipmentFinanceRecoveryGovernancePage/);
  assert.match(dispatcher, /stage === "governance"/);
  assert.match(layout, /Rescheduling, Default & Recovery/);
  assert.match(layout, /stage=governance/);
  assert.match(page, /Rescheduling, Default & Recovery Governance/);
  assert.match(page, /Prepare reschedule request/);
  assert.match(page, /Prepare default review/);
  assert.match(page, /Record recovery action/);
  assert.match(page, /different Finance Manager/);
  assert.match(page, /No Hire location selection/);
  assert.match(page, /No automatic SMS or WhatsApp/);
  assert.doesNotMatch(page, /\/equipment-hire|\/hire-commercial/);
  assert.doesNotMatch(page, /sendSms|automatic_sms_enabled/);
});
