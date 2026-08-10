from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
def r(p): return (ROOT/p).read_text(encoding='utf-8')
def w(p,t): (ROOT/p).write_text(t,encoding='utf-8')
def rep(p,a,b):
    t=r(p); n=t.count(a)
    if n!=1: raise SystemExit(f'{p}: expected one match, got {n}: {a[:80]!r}')
    w(p,t.replace(a,b,1))

p='backend/routes/workerProfileExpansionRoutes.js'
rep(p,'''const {
  allocateWorkerIdentity,
  cardDatesForReissue,
  ensureWorkerIdentitySchema,
} = require("../services/workerIdentityService");
''','''const {
  allocateWorkerIdentity,
  cardDatesForReissue,
  ensureWorkerIdentitySchema,
} = require("../services/workerIdentityService");
const {
  assertSchemaReady,
} = require("../services/payrollFoundationService");
''')
rep(p,'''}

function redactWorkerDetail(detail, req) {''','''}

function initialSalaryPayload(body = {}) {
  const amount = Number(body.basic_salary);
  const payFrequency = cleanText(body.pay_frequency || "monthly", 30).toLowerCase();
  const effectiveFrom = dateOnly(body.salary_effective_from || body.employment_start_date);
  const changeReason = nullableText(body.salary_change_reason, 1000) ||
    "Initial salary activated automatically when the worker profile was created.";

  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error("Enter a positive basic salary before creating the worker.");
    error.statusCode = 400;
    error.code = "WORKER_INITIAL_SALARY_REQUIRED";
    throw error;
  }
  if (!["monthly", "weekly", "biweekly"].includes(payFrequency)) {
    const error = new Error("Choose a valid salary pay frequency.");
    error.statusCode = 400;
    error.code = "WORKER_INITIAL_PAY_FREQUENCY_INVALID";
    throw error;
  }
  if (!effectiveFrom) {
    const error = new Error("Employment start date is required because it is also the initial salary effective date.");
    error.statusCode = 400;
    error.code = "WORKER_INITIAL_SALARY_EFFECTIVE_DATE_REQUIRED";
    throw error;
  }
  return {
    basic_salary: Number(amount.toFixed(2)),
    pay_frequency: payFrequency,
    effective_from: effectiveFrom,
    change_reason: changeReason,
  };
}

function redactWorkerDetail(detail, req) {''')
rep(p,'''  requirePermission(
    "workers.manage",
    "workers.sensitive.view"
  ),
  asyncHandler(async (req, res) => {
    const payload = profilePayload(req.body);
''','''  requirePermission(
    "workers.manage",
    "workers.sensitive.view",
    "payroll.manage"
  ),
  asyncHandler(async (req, res) => {
    const payload = profilePayload(req.body);
    const initialSalary = initialSalaryPayload(req.body);
''')
rep(p,'''    try {
      await connection.beginTransaction();
      identity = await allocateWorkerIdentity(
''','''    try {
      await connection.beginTransaction();
      await assertSchemaReady(connection);
      identity = await allocateWorkerIdentity(
''')
rep(p,'''        values
      );

      await connection.query(
        `INSERT INTO worker_profile_change_history (
''','''        values
      );

      const [salaryResult] = await connection.query(
        `INSERT INTO payroll_compensation_profiles (
           worker_id, workspace_code, effective_from, currency_code, pay_frequency,
           basic_salary, status, change_reason, created_by, approved_at
         ) VALUES (?, ?, ?, 'GHS', ?, ?, 'approved', ?, ?, CURRENT_TIMESTAMP)`,
        [
          result.insertId,
          workspaceCode,
          initialSalary.effective_from,
          initialSalary.pay_frequency,
          initialSalary.basic_salary,
          initialSalary.change_reason,
          req.user.id,
        ]
      );

      await connection.query(
        `INSERT INTO worker_profile_change_history (
''')
rep(p,'''            employee_number_is_automatic: true,
            card_validity_months: identity.validityMonths,
          }),
''','''            employee_number_is_automatic: true,
            card_validity_months: identity.validityMonths,
            initial_salary_auto_activated: true,
            initial_salary_profile_id: salaryResult.insertId,
            initial_pay_frequency: initialSalary.pay_frequency,
          }),
''')
rep(p,'''        details:
          `Expanded worker profile ${payload.employee_number} was created with automatic identity and ${identity.validityMonths}-month card validity.`,
      });

      return res.status(201).json({
        status: "success",
        message:
          `Worker profile created. Employee number ${payload.employee_number} and card expiry ${payload.id_card_expiry_date} were generated automatically.`,
        employee_number_is_automatic: true,
        card_validity_months: identity.validityMonths,
        worker: await loadExpandedWorker(result.insertId, req),
      });
''','''        details:
          `Expanded worker profile ${payload.employee_number} was created with automatic identity and an active initial payroll salary record.`,
        metadata: {
          initial_salary_profile_id: salaryResult.insertId,
          initial_salary_effective_from: initialSalary.effective_from,
          initial_pay_frequency: initialSalary.pay_frequency,
        },
      });

      return res.status(201).json({
        status: "success",
        message:
          `Worker profile created. Employee number ${payload.employee_number} was generated automatically and the initial salary is active in Payroll.`,
        employee_number_is_automatic: true,
        card_validity_months: identity.validityMonths,
        initial_salary_auto_activated: true,
        initial_salary: {
          profile_id: salaryResult.insertId,
          basic_salary: initialSalary.basic_salary,
          pay_frequency: initialSalary.pay_frequency,
          effective_from: initialSalary.effective_from,
        },
        worker: await loadExpandedWorker(result.insertId, req),
      });
''')

p='backend/services/payrollProcessingService.js'
rep(p,'''      compensation_profile_id: profiles[0].id,
      gross_earnings: calculation.gross_earnings,
''','''      compensation_profile_id: profiles[0].id,
      basic_salary: money(profiles[0].basic_salary),
      pay_frequency: profiles[0].pay_frequency,
      gross_earnings: calculation.gross_earnings,
''')

q=ROOT/'backend/tests/payrollWorkerOnboardingSimplification20260810.test.js'
q.write_text(r'''const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "../..");
const workerRoutes = fs.readFileSync(path.join(root, "backend/routes/workerProfileExpansionRoutes.js"), "utf8");
const workerPage = fs.readFileSync(path.join(root, "frontend/src/pages/ExpandedWorkerProfilePage.jsx"), "utf8");
const payrollPanel = fs.readFileSync(path.join(root, "frontend/src/components/WorkerPayrollPanel.jsx"), "utf8");
const processing = fs.readFileSync(path.join(root, "backend/services/payrollProcessingService.js"), "utf8");
const start = workerRoutes.indexOf('router.post(\n  "/workers-expanded"');
const end = workerRoutes.indexOf('router.get(\n  "/workers-expanded/:id"', start);
const createRoute = workerRoutes.slice(start, end);

test("worker onboarding requires payroll authority and starting salary", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(createRoute, /"workers\.manage"[\s\S]*"workers\.sensitive\.view"[\s\S]*"payroll\.manage"/);
  assert.match(workerRoutes, /function initialSalaryPayload/);
  assert.match(workerRoutes, /WORKER_INITIAL_SALARY_REQUIRED/);
  assert.match(workerRoutes, /body\.salary_effective_from \|\| body\.employment_start_date/);
  assert.match(workerPage, /Basic salary \(GHS\)/);
  assert.match(workerPage, /Create Worker & Activate Salary/);
});

test("worker and salary are written atomically without adding salary to worker_profiles", () => {
  assert.match(createRoute, /beginTransaction\(\)[\s\S]*assertSchemaReady\(connection\)/);
  assert.match(createRoute, /INSERT INTO worker_profiles/);
  assert.match(createRoute, /INSERT INTO payroll_compensation_profiles/);
  assert.match(createRoute, /'approved'/);
  assert.match(createRoute, /initial_salary_auto_activated: true/);
  assert.ok(createRoute.indexOf("INSERT INTO worker_profiles") < createRoute.indexOf("INSERT INTO payroll_compensation_profiles"));
  assert.ok(createRoute.indexOf("INSERT INTO payroll_compensation_profiles") < createRoute.indexOf("connection.commit()"));
  const cols = workerRoutes.match(/const PROFILE_EDIT_COLUMNS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(cols);
  assert.doesNotMatch(cols[1], /basic_salary|pay_frequency/);
});

test("payroll preview exposes the worker salary source and change UI", () => {
  assert.match(processing, /basic_salary: money\(profiles\[0\]\.basic_salary\)/);
  assert.match(processing, /pay_frequency: profiles\[0\]\.pay_frequency/);
  assert.match(payrollPanel, /Change Salary/);
  assert.match(payrollPanel, /Existing recurring allowances and deductions are carried forward automatically/);
});
''',encoding='utf-8')
print('backend payroll simplification patched')
