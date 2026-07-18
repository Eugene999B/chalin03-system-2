const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Release 3F-C3 migration is additive and preserves historical expense treatment", () => {
  const migration = read(
    "database/migrations/20260718_release3fc3_mobile_id_expense_funding.sql"
  );
  const verify = read(
    "database/migrations/20260718_release3fc3_mobile_id_expense_funding_verify.sql"
  );

  assert.match(migration, /funding_source/);
  assert.match(migration, /affects_daily_closing/);
  assert.match(migration, /closing_treatment_note/);
  assert.match(migration, /DEFAULT 1 AFTER `funding_source`/);
  assert.match(migration, /DEFAULT ''today_sales_receipts''/);
  assert.match(migration, /release3fc3_mobile_id_expense_funding/);
  assert.doesNotMatch(
    migration,
    /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM\s+expenses|CREATE\s+DATABASE|^\s*USE\s+/im
  );
  assert.match(verify, /problem_count/);
  assert.match(verify, /affects_daily_closing = 1/);
});

test("Release 3F-C3 expense API requires a truthful funding decision", () => {
  const routes = read("backend/routes/expenseRoutes.js");

  assert.match(routes, /EXPENSE_FUNDING_SOURCES/);
  assert.match(routes, /parseRequiredBoolean/);
  assert.match(routes, /Today's Sales Receipts/);
  assert.match(routes, /affects_daily_closing/);
  assert.match(routes, /funding_source/);
  assert.match(routes, /closing_treatment_note/);
  assert.match(routes, /closing_expenses/);
  assert.match(routes, /externally_funded_expenses/);
});

test("Release 3F-C3 Daily Closing deducts only eligible expenses", () => {
  const routes = read("backend/routes/dailyClosingRoutes.js");
  const page = read("frontend/src/pages/DailyClosingPage.jsx");

  assert.match(routes, /const closingExpenses = expenses\.filter/);
  assert.match(routes, /Number\(item\.affects_daily_closing \?\? 1\) === 1/);
  assert.match(routes, /closing_expenses_total/);
  assert.match(routes, /external_expenses_total/);
  assert.match(routes, /ACCOUNTING ONLY/);
  assert.match(page, /Only expenses explicitly paid from today/);
  assert.match(page, /Accounting only — does not reduce closing/);
});

test("Release 3F-C3 mobile layouts convert wide tables into readable cards", () => {
  const installmentPage = read("frontend/src/pages/InstallmentsPage.jsx");
  const installmentCss = read("frontend/src/styles/installments.css");
  const permissionPage = read("frontend/src/pages/UserPermissionManagerPage.jsx");
  const permissionCss = read("frontend/src/styles/userPermissionManager.css");

  assert.match(installmentPage, /installment-table--agreements/);
  assert.match(installmentPage, /installment-table--schedule/);
  assert.match(installmentPage, /data-label="Outstanding"/);
  assert.match(installmentCss, /Release 3F-C3 mobile-first installment workspace/);
  assert.match(installmentCss, /content: attr\(data-label\)/);

  assert.match(permissionPage, /upm-history-table/);
  assert.match(permissionPage, /data-label="Controls"/);
  assert.match(permissionCss, /Release 3F-C3 mobile-first permission administration/);
  assert.match(permissionCss, /content: attr\(data-label\)/);
});

test("Release 3F-C3 worker card is modern, verifiable and clearly non-government", () => {
  const printRoutes = read("backend/routes/workerPrintRoutes.js");
  const workerPage = read("frontend/src/pages/ExpandedWorkerProfilePage.jsx");
  const workerCss = read("frontend/src/styles/expandedWorkerProfile.css");

  assert.match(printRoutes, /GHANA_RED/);
  assert.match(printRoutes, /GHANA_GREEN/);
  assert.match(printRoutes, /drawCardSecurityBars/);
  assert.match(printRoutes, /EMPLOYEE IDENTITY CARD/);
  assert.match(printRoutes, /not a national or government identity document/i);
  assert.match(workerPage, /worker-id-mini-card/);
  assert.match(workerCss, /Release 3F-C3 modern employee ID preview/);
});
