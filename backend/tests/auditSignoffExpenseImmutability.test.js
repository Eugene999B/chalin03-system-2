const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.join(__dirname, "..");
const repositoryRoot = path.join(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("audit sign-offs remain immutable compliance evidence", () => {
  const routeSource = read("backend/routes/auditSignoffRoutes.js");
  const archiveSource = read("frontend/src/pages/AuditSignoffHistoryPage.jsx");

  assert.doesNotMatch(routeSource, /DELETE\s+FROM\s+audit_signoffs/i);
  assert.match(routeSource, /AUDIT_SIGNOFF_IMMUTABLE/);
  assert.match(routeSource, /BLOCK_DELETE_AUDIT_SIGNOFF/);
  assert.match(routeSource, /permanent compliance evidence/i);

  assert.doesNotMatch(archiveSource, /deleteSignoff/);
  assert.doesNotMatch(
    archiveSource,
    /axiosClient\.delete\(\s*`\/audit-signoffs\//
  );
  assert.doesNotMatch(
    archiveSource,
    /onClick=\{\(\) => deleteSignoff\(item\)\}/
  );
  assert.match(archiveSource, /Permanent evidence/);
  assert.match(archiveSource, /controlled review, unlock/);
});

test("legacy expense deletion cannot bypass the Phase 1 void ledger", () => {
  const expenseRouteSource = read("backend/routes/expenseRoutes.js");
  const reversalRouteSource = read("backend/routes/expenseReversalRoutes.js");
  const operationsContractSource = read(
    "backend/tests/operationsRouteReleaseContract.test.js"
  );

  assert.doesNotMatch(expenseRouteSource, /DELETE\s+FROM\s+expenses/i);
  assert.doesNotMatch(expenseRouteSource, /DELETE_EXPENSE/);
  assert.doesNotMatch(
    operationsContractSource,
    /\/\/ DELETE \/api\/expenses\/:id/
  );
  assert.match(reversalRouteSource, /EXPENSE_VOIDED/);
  assert.match(reversalRouteSource, /is_reversal/);
  assert.match(reversalRouteSource, /reversal_of_expense_id/);
  assert.match(reversalRouteSource, /INDEPENDENT_APPROVER_REQUIRED/);
});
