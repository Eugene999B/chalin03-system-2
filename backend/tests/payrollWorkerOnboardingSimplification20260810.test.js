const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "../..");
const workerRoutes = fs.readFileSync(path.join(root, "backend/routes/workerProfileExpansionRoutes.js"), "utf8");
const payrollFoundation = fs.readFileSync(path.join(root, "backend/services/payrollFoundationService.js"), "utf8");
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

test("initial salary activation is explicit without pretending an independent approval", () => {
  const salaryInsert = createRoute.match(/INSERT INTO payroll_compensation_profiles \(([\s\S]*?)\) VALUES/);
  assert.ok(salaryInsert, "worker onboarding should insert the initial payroll compensation profile");
  assert.match(salaryInsert[1], /created_by/);
  assert.match(salaryInsert[1], /approved_at/);
  assert.doesNotMatch(salaryInsert[1], /approved_by/);
  assert.match(payrollFoundation, /PAYROLL_PROFILE_SELF_APPROVAL_FORBIDDEN/);
  assert.match(payrollFoundation, /Number\(profile\.created_by\) === Number\(actorId\)/);
  assert.match(payrollFoundation, /Number\(profile\.submitted_by\) === Number\(actorId\)/);
});

test("payroll preview exposes the worker salary source and change UI", () => {
  assert.match(processing, /basic_salary: money\(profiles\[0\]\.basic_salary\)/);
  assert.match(processing, /pay_frequency: profiles\[0\]\.pay_frequency/);
  assert.match(payrollPanel, /Change Salary/);
  assert.match(payrollPanel, /Existing recurring allowances and deductions are carried forward automatically/);
});
