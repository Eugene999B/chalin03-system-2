const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const processing = require("../services/payrollProcessingService");
const routes = read("backend/routes/payrollProcessingRoutes.js");
const serviceSource = read("backend/services/payrollProcessingService.js");
const server = read("backend/server.js");

function rule(id, code, configuration) {
  return {
    id,
    rule_code: code,
    version_label: "TEST-V1",
    scope_code: "spare_parts",
    configuration,
  };
}

test("payroll calculation consumes versioned rule data instead of embedded statutory rates", () => {
  const calculation = processing.calculatePayrollEntry({
    worker: {
      id: 11,
      employment_start_date: "2026-08-01",
      employment_end_date: null,
    },
    profile: {
      id: 22,
      pay_frequency: "monthly",
      basic_salary: 3000,
    },
    components: [
      {
        id: 1,
        component_code: "transport",
        component_name: "Transport allowance",
        component_type: "earning",
        calculation_type: "fixed",
        amount_value: 300,
        taxable: true,
        pensionable: false,
      },
      {
        id: 2,
        component_code: "staff_deduction",
        component_name: "Staff deduction",
        component_type: "deduction",
        calculation_type: "fixed",
        amount_value: 100,
        taxable: false,
        pensionable: false,
      },
    ],
    statutoryRules: [
      rule(10, "test_tax", {
        calculation_type: "percentage",
        line_type: "deduction",
        line_code: "test_tax",
        line_name: "Test tax",
        basis: "taxable_gross",
        rate_percent: 10,
      }),
      rule(11, "test_employer", {
        calculation_type: "percentage",
        line_type: "employer_contribution",
        line_code: "test_employer",
        line_name: "Test employer contribution",
        basis: "gross_earnings",
        rate_percent: 5,
      }),
    ],
    period: {
      period_start: "2026-08-01",
      period_end: "2026-08-30",
    },
  });

  assert.equal(calculation.basic_earned, 3000);
  assert.equal(calculation.gross_earnings, 3300);
  assert.equal(calculation.total_deductions, 430);
  assert.equal(calculation.employer_contributions, 165);
  assert.equal(calculation.net_salary, 2870);
});

test("progressive statutory bands are evaluated from rule configuration", () => {
  const line = processing.evaluateStatutoryRule(
    rule(12, "progressive_fixture", {
      calculation_type: "progressive_bands",
      line_type: "deduction",
      line_code: "progressive_fixture",
      line_name: "Progressive fixture",
      basis: "gross_earnings",
      bands: [
        { up_to: 1000, rate_percent: 0 },
        { up_to: 2000, rate_percent: 10 },
        { up_to: null, rate_percent: 20 },
      ],
    }),
    { basic_earned: 3000, gross_earnings: 3000, taxable_gross: 3000 }
  );

  assert.equal(line.amount, 300);
});

test("processing routes enforce maker checker permissions and preserved reversals", () => {
  assert.match(routes, /processing\/periods\/:periodId\/validate/);
  assert.match(routes, /processing\/periods\/:periodId\/prepare/);
  assert.match(routes, /processing\/periods\/:periodId\/approve/);
  assert.match(routes, /processing\/periods\/:periodId\/lock/);
  assert.match(routes, /processing\/entries\/:entryId\/payments/);
  assert.match(routes, /processing\/payments\/:paymentId\/reversal-request/);
  assert.match(routes, /processing\/adjustments\/:requestId\/decision/);
  assert.match(routes, /processing\/periods\/:periodId\/reconcile/);
  assert.match(routes, /requirePermission\("payroll\.prepare"\)/);
  assert.match(routes, /requirePermission\("payroll\.approve"\)/);
  assert.match(routes, /requirePermission\("payroll\.pay"\)/);
  assert.match(routes, /requirePermission\("payroll\.adjust"\)/);
  assert.match(routes, /requirePermission\("payroll\.audit"\)/);
  assert.match(serviceSource, /PAYROLL_PERIOD_SELF_APPROVAL_FORBIDDEN/);
  assert.match(serviceSource, /PAYROLL_ADJUSTMENT_SELF_APPROVAL_FORBIDDEN/);
  assert.match(serviceSource, /reversal_of_payment_id/);
});

test("payment processing is idempotent, reference-safe and based on preserved evidence", () => {
  assert.match(serviceSource, /payroll-payment:\$\{entryId\}:/);
  assert.match(serviceSource, /PAYROLL_PAYMENT_IDEMPOTENCY_REQUIRED/);
  assert.match(serviceSource, /PAYROLL_PAYMENT_REFERENCE_DUPLICATE/);
  assert.match(serviceSource, /PAYROLL_PAYMENT_EXCEEDS_BALANCE/);
  assert.match(serviceSource, /calculation_checksum_sha256/);
  assert.match(serviceSource, /PAYROLL_CALCULATION_CHECKSUM_MISMATCH/);
  assert.match(serviceSource, /payment_status IN \('posted','reversal_pending'\)/);
  assert.match(serviceSource, /pending_adjustments/);
});

test("server mounts processing behind the existing sensitive payroll boundary", () => {
  assert.match(server, /payrollProcessingRoutes/);
  assert.match(server, /app\.use\("\/api\/payroll", requireAuth, payrollBoundary, payrollProcessingRoutes\)/);
  assert.match(server, /app\.use\("\/api\/payroll", sensitiveAdminLimiter\)/);
});
