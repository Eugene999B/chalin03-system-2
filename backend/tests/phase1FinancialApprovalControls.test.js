const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");
const readBackend = (relativePath) =>
  fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
const readProject = (relativePath) =>
  fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

test("expense correction preserves the original and creates a linked negative reversal", () => {
  const source = readBackend("routes/expenseReversalRoutes.js");

  assert.doesNotMatch(source, /DELETE\s+FROM\s+expenses/i);
  assert.match(source, /SET is_voided = 1/);
  assert.match(source, /void_approved_by = \?/);
  assert.match(source, /INSERT INTO expenses/);
  assert.match(source, /is_reversal/);
  assert.match(source, /reversal_of_expense_id/);
  assert.match(source, /-Math\.abs\(Number\(expense\.amount/);
  assert.match(source, /verifyIndependentBranchApprover/);
  assert.match(source, /reason\.length < 8/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /await connection\.commit\(\)/);
});

test("the additive migration records void, approval and reversal evidence", () => {
  const migration = readProject(
    "database/migrations/20260725_phase1_financial_control_hardening.sql"
  );
  const verification = readProject(
    "database/migrations/20260725_phase1_financial_control_hardening_verify.sql"
  );

  for (const column of [
    "is_voided",
    "void_reason",
    "void_reference",
    "voided_by",
    "voided_at",
    "void_approved_by",
    "void_approved_at",
    "is_reversal",
    "reversal_of_expense_id",
    "reversal_reference",
  ]) {
    assert.match(migration, new RegExp(`'${column}'`));
    assert.match(verification, new RegExp(`'${column}'`));
  }

  assert.match(migration, /ADDITIVE MIGRATION ONLY/);
  assert.match(migration, /BACKUP REQUIRED/);
  assert.match(migration, /20260725_phase1_financial_control_hardening/);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(
    verification.replace(/--.*$/gm, ""),
    /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|CALL)\b/i
  );
  assert.match(verification, /ROUND\(reversal\.amount \+ original\.amount, 2\) = 0\.00/);
  assert.match(verification, /voided_by = original\.void_approved_by/);
});

test("Spare Parts store context fails closed without a selected store", () => {
  const source = readBackend("middleware/sparePartsBranchContextMiddleware.js");

  assert.match(source, /STORE_CONTEXT_REQUIRED/);
  assert.match(source, /STORE_CONTEXT_INVALID/);
  assert.match(source, /STORE_ACCESS_DENIED/);
  assert.doesNotMatch(source, /default_branch_id\s*\|\|\s*1/);
  assert.doesNotMatch(source, /return\s+1/);
  assert.match(source, /user_branch_access/);
});

test("Mining and stock-transfer approvals block the record preparer", () => {
  const source = readBackend("middleware/independentApprovalMiddleware.js");
  const server = readBackend("server.js");

  assert.match(source, /created_by/);
  assert.match(source, /requested_by/);
  assert.match(source, /INDEPENDENT_APPROVER_REQUIRED/);
  assert.match(source, /preventMiningSelfApproval/);
  assert.match(source, /preventStockTransferSelfApproval/);
  assert.match(server, /preventMiningSelfApproval/);
  assert.match(server, /preventStockTransferSelfApproval/);
});

test("the Expenses UI uses masked independent approval instead of Delete", () => {
  const page = readProject("frontend/src/pages/ExpensesPage.jsx");
  const panel = readProject("frontend/src/components/ExpenseVoidApprovalPanel.jsx");

  assert.match(page, /ExpenseVoidApprovalPanel/);
  assert.match(page, />\s*Void\s*</);
  assert.doesNotMatch(page, />\s*Delete\s*</);
  assert.match(panel, /type="password"/);
  assert.match(panel, /approver_username/);
  assert.match(panel, /approver_password/);
  assert.match(panel, /void_reason/);
  assert.match(panel, /axiosClient\.delete/);
});

test("production startup requires the Phase 1 migration before traffic", () => {
  const readiness = readBackend("services/productionSchemaReadinessService.js");
  const server = readBackend("server.js");

  assert.match(readiness, /20260725_phase1_financial_control_hardening/);
  assert.match(readiness, /Required migration/);
  assert.match(readiness, /reversal_of_expense_id/);
  assert.match(readiness, /user_branch_access/);
  assert.match(server, /validateProductionSchemaReadiness/);
});
