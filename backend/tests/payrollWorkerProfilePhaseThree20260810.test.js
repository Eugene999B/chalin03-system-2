const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const routes = read("backend/routes/payrollFoundationRoutes.js");
const foundation = read("backend/services/payrollFoundationService.js");
const profile = read("backend/services/payrollWorkerProfileService.js");

test("payroll worker profile endpoint remains permission and category guarded", () => {
  assert.match(routes, /\/workers\/:workerId\/profile/);
  assert.match(routes, /requirePermission\("payroll\.view"\)/);
  assert.match(routes, /workerPayrollProfile/);
  assert.match(foundation, /PAYROLL_WORKER_CATEGORY_MISMATCH/);
  assert.match(profile, /loadWorkerForWorkspace/);
  assert.match(profile, /workspace_code = \?/);
});

test("worker payroll profile is read-only and reconciles authoritative payroll tables", () => {
  for (const table of [
    "payroll_compensation_profiles",
    "payroll_entries",
    "payroll_periods",
    "payroll_salary_payments",
    "payroll_worker_loans",
    "payroll_loan_transactions",
    "payroll_payslips",
  ]) {
    assert.match(profile, new RegExp(table));
  }
  assert.doesNotMatch(profile, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(profile, /\bUPDATE\s+payroll_/i);
  assert.doesNotMatch(profile, /\bDELETE\s+FROM\s+payroll_/i);
});

test("profile summary exposes current month, YTD, tenure and loan balances without copying salary onto workers", () => {
  assert.match(profile, /current_month_status/);
  assert.match(profile, /processed_months/);
  assert.match(profile, /paid_months/);
  assert.match(profile, /ytd_gross_earnings/);
  assert.match(profile, /ytd_net_salary/);
  assert.match(profile, /ytd_amount_paid/);
  assert.match(profile, /outstanding_salary/);
  assert.match(profile, /loan_advance_outstanding/);
  assert.match(profile, /tenure_days/);
  assert.match(profile, /salary_source:\s*"payroll_compensation_profiles"/);
});
