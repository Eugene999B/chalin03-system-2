const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const middleware = fs.readFileSync(
  path.join(root, "middleware/creditReturnDebtReconciliationMiddleware.js"),
  "utf8"
);
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

function compact(value) {
  return String(value).replace(/\s+/g, " ");
}

test("returned credit value reduces debt exactly once without double-refunding", () => {
  assert.match(middleware, /returnedValue\s*-\s*refundedValue/);
  assert.match(middleware, /Math\.min\(unappliedCredit, oldBalance\)/);
  assert.match(middleware, /Math\.max\(\s*Number\(debt\.amount_paid/);
  assert.match(
    middleware,
    /GREATEST\(COALESCE\(balance, 0\) - \?, 0\)/
  );
  assert.match(middleware, /\[CreditReturn:\$\{returnRow\.id\}\]/);
  assert.match(middleware, /marker\.details LIKE CONCAT/);
});

test("existing returned-credit sales are reconciled transactionally and audited", () => {
  assert.match(middleware, /GET_LOCK/);
  assert.match(middleware, /beginTransaction\(\)/);
  assert.match(middleware, /FOR UPDATE/);
  assert.match(middleware, /connection\.commit\(\)/);
  assert.match(middleware, /connection\.rollback\(\)/);
  assert.match(middleware, /APPLY_CREDIT_RETURN_TO_DEBT/);
  assert.doesNotMatch(middleware, /DELETE\s+FROM\s+(debts|debt_payments|returns|sales)/i);
});

test("all debt-facing Spare Parts routes reconcile before reading or collecting", () => {
  const source = compact(server);
  assert.match(
    source,
    /"\/api\/debts", requireAuth, sparePartsBoundary, reconcileCreditReturnDebts, debtRoutes/
  );
  assert.match(
    source,
    /"\/api\/debt-customers", requireAuth, sparePartsBoundary, reconcileCreditReturnDebts, customerDebtConsolidationRoutes/
  );
  assert.match(
    source,
    /"\/api\/customer-debt-reports", requireAuth, sparePartsBoundary, reconcileCreditReturnDebts, customerDebtReportRoutes/
  );
  assert.match(
    source,
    /"\/api\/customer-statements", requireAuth, sparePartsBoundary, reconcileCreditReturnDebts, customerStatementRoutes/
  );
});

test("read screens remain available while financial writes fail closed on reconciliation error", () => {
  assert.match(middleware, /\["POST", "PUT", "PATCH", "DELETE"\]/);
  assert.match(middleware, /CREDIT_RETURN_DEBT_RECONCILIATION_FAILED/);
  assert.match(middleware, /warning: "reconciliation_failed"/);
});
