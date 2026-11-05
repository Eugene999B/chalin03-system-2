const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const {
  CATEGORY_CODES,
  normalizeCategory,
} = require("../services/categoryIsolationService");
const {
  EQUIPMENT_DIVISIONS,
  hasEquipmentDivisionAccess,
  requiredEquipmentDivisionForRequest,
} = require("../security/equipmentDivisionAccess");
const {
  calculatePayrollEntry,
  evaluateStatutoryRule,
} = require("../services/payrollProcessingService");
const {
  buildPayslipVerificationUrl,
  maskEmployeeName,
  maskEmployeeNumber,
} = require("../services/payrollPayslipService");

const processingSource = read("backend/services/payrollProcessingService.js");
const payslipSource = read("backend/services/payrollPayslipService.js");
const payslipRoutes = read("backend/routes/payrollPayslipRoutes.js");
const verificationRoutes = read("backend/routes/payrollPayslipVerificationRoutes.js");
const processingRoutes = read("backend/routes/payrollProcessingRoutes.js");
const permissionCatalog = read("backend/security/permissionCatalog.js");
const serverSource = read("backend/server.js");
const resetSource = read("backend/scripts/resetDatabaseFromBackup.js");
const restoreVerifySource = read("backend/scripts/verifyRestoredDatabase.js");
const migrationSource = read("database/migrations/20260810_payroll_financial_foundation.sql");

function monthlyFixture(overrides = {}) {
  return calculatePayrollEntry({
    worker: {
      id: 1,
      employment_start_date: "2020-01-01",
      employment_end_date: null,
      ...overrides.worker,
    },
    profile: {
      id: 11,
      basic_salary: 3100,
      pay_frequency: "monthly",
      ...overrides.profile,
    },
    components: overrides.components || [],
    statutoryRules: overrides.statutoryRules || [],
    period: {
      id: 21,
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      ...overrides.period,
    },
  });
}

test("payroll category boundaries preserve Spare Parts, Mining and Equipment Business isolation", () => {
  assert.deepEqual([...CATEGORY_CODES], ["spare_parts", "mining", "equipment_hire"]);
  assert.equal(normalizeCategory("Spare Parts"), "spare_parts");
  assert.equal(normalizeCategory("Mining"), "mining");
  assert.equal(normalizeCategory("Equipment Hire"), "equipment_hire");
  assert.equal(normalizeCategory("finance"), null, "Finance remains a protected Equipment Business division, not a fourth workspace");
});

test("Equipment Hire and Installment Finance staff remain independently authorised inside Equipment Business", () => {
  const hireOfficer = { workspace_code: "equipment_hire", workspace_role: "hire_officer" };
  const financeManager = { workspace_code: "equipment_hire", workspace_role: "finance_manager" };
  const dualManager = { workspace_code: "equipment_hire", workspace_role: "equipment_business_manager" };

  assert.equal(hasEquipmentDivisionAccess(hireOfficer, EQUIPMENT_DIVISIONS.HIRE), true);
  assert.equal(hasEquipmentDivisionAccess(hireOfficer, EQUIPMENT_DIVISIONS.FINANCE), false);
  assert.equal(hasEquipmentDivisionAccess(financeManager, EQUIPMENT_DIVISIONS.FINANCE), true);
  assert.equal(hasEquipmentDivisionAccess(financeManager, EQUIPMENT_DIVISIONS.HIRE), false);
  assert.equal(hasEquipmentDivisionAccess(dualManager, EQUIPMENT_DIVISIONS.HIRE), true);
  assert.equal(hasEquipmentDivisionAccess(dualManager, EQUIPMENT_DIVISIONS.FINANCE), true);
  assert.equal(
    requiredEquipmentDivisionForRequest({ baseUrl: "/api/equipment-catalogue", path: "/sales/applications", method: "GET" }),
    EQUIPMENT_DIVISIONS.FINANCE
  );
});

test("new starters and leavers are prorated by actual overlap days rather than calendar months", () => {
  const fullMonth = monthlyFixture();
  assert.equal(fullMonth.employment_days, 31);
  assert.equal(fullMonth.payable_days, 31);
  assert.equal(fullMonth.basic_earned, 3100);

  const starter = monthlyFixture({ worker: { employment_start_date: "2026-08-16", employment_end_date: null } });
  assert.equal(starter.payable_days, 16);
  assert.equal(starter.basic_earned, 1600);

  const leaver = monthlyFixture({ worker: { employment_start_date: "2020-01-01", employment_end_date: "2026-08-20" } });
  assert.equal(leaver.payable_days, 20);
  assert.equal(leaver.basic_earned, 2000);

  const notYetEmployed = monthlyFixture({ worker: { employment_start_date: "2026-09-01", employment_end_date: null } });
  assert.equal(notYetEmployed.payable_days, 0);
  assert.equal(notYetEmployed.basic_earned, 0);
});

test("statutory calculations preserve the exact approved rule version in payroll evidence", () => {
  const rule = {
    id: 77,
    rule_code: "test_pension",
    version_label: "2026-v2",
    scope_code: "group",
    configuration_json: JSON.stringify({
      calculation_type: "percentage",
      line_type: "deduction",
      line_code: "test_pension",
      line_name: "Test Pension",
      basis: "gross_earnings",
      rate_percent: 5,
    }),
  };
  const line = evaluateStatutoryRule(rule, {
    basic_earned: 3000,
    taxable_gross: 3200,
    gross_earnings: 3200,
  });
  assert.equal(line.amount, 160);
  assert.equal(line.source_type, "statutory_rule");
  assert.equal(line.source_reference, "77");
  assert.equal(line.metadata.version_label, "2026-v2");
  assert.equal(line.metadata.calculation_basis, 3200);

  const calculated = monthlyFixture({ statutoryRules: [rule] });
  const statutoryLine = calculated.lines.find((item) => item.line_code === "test_pension");
  assert.ok(statutoryLine);
  assert.equal(statutoryLine.metadata.version_label, "2026-v2");
});

test("maker-checker, immutable checksum and lock-before-pay controls remain release-blocking", () => {
  assert.match(processingSource, /PAYROLL_PERIOD_SELF_APPROVAL_FORBIDDEN/);
  assert.match(processingSource, /verifyStoredEntryChecksum/);
  assert.match(processingSource, /PAYROLL_CALCULATION_CHECKSUM_MISMATCH/);
  assert.match(processingSource, /Only payroll submitted for review can be approved/);
  assert.match(processingSource, /Approve payroll before locking it for payment/);
  assert.match(processingSource, /Salary payments can only be posted after payroll is approved and locked/);
  assert.match(processingSource, /statutory_snapshot_json/);
  assert.match(processingSource, /calculation_checksum_sha256/);
});

test("duplicate clicks and duplicate salary references stay idempotent and non-destructive", () => {
  assert.match(processingSource, /payroll-payment:\$\{entryId\}:/);
  assert.match(processingSource, /PAYROLL_PAYMENT_IDEMPOTENCY_REQUIRED/);
  assert.match(processingSource, /WHERE idempotency_key = \? LIMIT 1 FOR UPDATE/);
  assert.match(processingSource, /replayed: true/);
  assert.match(processingSource, /PAYROLL_PAYMENT_REFERENCE_DUPLICATE/);
  assert.match(processingSource, /reversal_of_payment_id/);
  assert.doesNotMatch(processingSource, /DELETE FROM payroll_salary_payments/i);
  assert.doesNotMatch(processingSource, /DELETE FROM payroll_entries/i);
});

test("all sensitive payroll APIs keep explicit payroll permissions and authenticated category boundaries", () => {
  for (const permission of [
    "payroll.view",
    "payroll.manage",
    "payroll.prepare",
    "payroll.approve",
    "payroll.pay",
    "payroll.payslip.issue",
    "payroll.adjust",
    "payroll.audit",
  ]) {
    assert.match(permissionCatalog, new RegExp(permission.replaceAll(".", "\\.")));
  }
  assert.match(processingRoutes, /requirePermission\("payroll\.prepare"\)/);
  assert.match(processingRoutes, /requirePermission\("payroll\.approve"\)/);
  assert.match(processingRoutes, /requirePermission\("payroll\.pay"\)/);
  assert.match(processingRoutes, /requirePermission\("payroll\.audit"\)/);
  assert.match(payslipRoutes, /requirePermission\("payroll\.payslip\.issue"\)/);
  assert.match(payslipRoutes, /requirePermission\("payroll\.view"\)/);
  assert.match(serverSource, /app\.use\("\/api\/payroll", requireAuth, payrollBoundary, payrollFoundationRoutes\)/);
  assert.match(serverSource, /app\.use\("\/api\/payroll", requireAuth, payrollBoundary, payrollProcessingRoutes\)/);
});

test("professional payslip verification remains opaque, masked, rate-limited and source-state aware", () => {
  const previous = process.env.PAYROLL_PAYSLIP_VERIFY_BASE_URL;
  process.env.PAYROLL_PAYSLIP_VERIFY_BASE_URL = "https://verify.example.test";
  try {
    const url = buildPayslipVerificationUrl("abcdefghijklmnopqrstuvwxyz0123456789ABCD");
    assert.match(url, /^https:\/\/verify\.example\.test\/api\/release2-final\/verification\/payroll-payslip\//);
  } finally {
    if (previous === undefined) delete process.env.PAYROLL_PAYSLIP_VERIFY_BASE_URL;
    else process.env.PAYROLL_PAYSLIP_VERIFY_BASE_URL = previous;
  }
  assert.equal(maskEmployeeName("Kwame Mensah Owusu"), "Kwame O.");
  assert.equal(maskEmployeeNumber("EMP-000123"), "EM******23");
  assert.match(payslipSource, /crypto\.randomBytes\(24\)/);
  assert.match(payslipSource, /storedState === "current" && !underlyingCurrent \? "revoked"/);
  assert.match(payslipSource, /pending_adjustments/);
  assert.match(verificationRoutes, /rateLimit\(/);
  assert.match(verificationRoutes, /noindex, nofollow, noarchive/);
  assert.match(verificationRoutes, /Content-Security-Policy/);
  assert.match(verificationRoutes, /detailed payroll lines are not exposed/);
});

test("payroll backup and restore verification cover every payroll financial table and refuse unsafe resets", () => {
  const payrollTables = [
    "payroll_statutory_rule_versions",
    "payroll_compensation_profiles",
    "payroll_recurring_components",
    "payroll_periods",
    "payroll_entries",
    "payroll_entry_lines",
    "payroll_salary_payments",
    "payroll_adjustment_requests",
    "payroll_worker_loans",
    "payroll_loan_transactions",
    "payroll_payslips",
  ];
  for (const table of payrollTables) {
    assert.match(resetSource, new RegExp(`"${table}"`), `${table} must be restorable`);
    assert.match(restoreVerifySource, new RegExp(`"${table}"`), `${table} must be restore-verified`);
  }
  assert.match(resetSource, /Refusing destructive reset unless DB_HOST is localhost/);
  assert.match(resetSource, /Refusing Railway-like host or database name/);
  assert.match(resetSource, /Refusing destructive reset unless DB_NAME ends in _test/);
  assert.match(resetSource, /Backup SHA-256 does not match the expected value/);
});

test("payroll schema remains additive and preserves financial history with restrictive foreign keys", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS payroll_compensation_profiles/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS payroll_periods/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS payroll_entries/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS payroll_salary_payments/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS payroll_payslips/);
  assert.match(migrationSource, /ON DELETE RESTRICT/);
  assert.doesNotMatch(migrationSource, /DROP TABLE/i);
  assert.doesNotMatch(migrationSource, /TRUNCATE TABLE/i);
});
