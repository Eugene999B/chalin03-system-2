const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");


test("all browser passkey and biometric endpoints fail closed", () => {
  const passkeys = read("backend/routes/passkeyRoutes.js");
  const biometrics = read("backend/routes/biometricRoutes.js");

  for (const source of [passkeys, biometrics]) {
    assert.match(source, /router\.use\(sendRetiredResponse\)/);
    assert.match(source, /status\(410\)/);
    assert.match(source, /WEB_(?:PASSKEY|BIOMETRIC)_LOGIN_DISABLED/);
    assert.doesNotMatch(
      source,
      /generateRegistrationOptions|generateAuthenticationOptions|verifyRegistrationResponse|verifyAuthenticationResponse/
    );
  }
});


test("expense funding evidence separates profit treatment from Daily Closing treatment", () => {
  const service = read("backend/services/expenseFundingEvidenceService.js");

  assert.match(service, /funding_source = 'today_sales_receipts'/);
  assert.match(service, /affects_daily_closing = 1/);
  assert.match(service, /cash_closing_deduction/);
  assert.match(service, /momo_closing_deduction/);
  assert.match(service, /bank_closing_deduction/);
  assert.match(service, /other_closing_deduction/);
  assert.match(service, /accounting_treatment:\s*"operating_expense"/);
  assert.match(service, /accounting_only_no_daily_closing_deduction/);
  assert.match(service, /Every valid business expense reduces profit for accounting/);
});


test("advanced accounting overview and dedicated endpoint return funding evidence", () => {
  const routes = read("backend/routes/accountingIntelligenceRoutes.js");

  assert.match(routes, /loadExpenseFundingEvidence/);
  assert.match(routes, /attachExpenseFundingEvidence/);
  assert.match(routes, /expense_funding_evidence/);
  assert.match(routes, /router\.get\([\s\S]*"\/expense-funding"/);
  assert.match(routes, /receipts_funded_expenses/);
  assert.match(routes, /externally_funded_expenses/);
});


test("existing expense entry and Daily Closing remain strict and channel-specific", () => {
  const expenseRoutes = read("backend/routes/expenseRoutes.js");
  const closingRoutes = read("backend/routes/dailyClosingRoutes.js");

  assert.match(
    expenseRoutes,
    /affectsDailyClosing && fundingSource !== "today_sales_receipts"/
  );
  assert.match(
    expenseRoutes,
    /!affectsDailyClosing && fundingSource === "today_sales_receipts"/
  );
  assert.match(closingRoutes, /const closingExpenses = expenses\.filter/);
  assert.match(closingRoutes, /saleCashReceived[\s\S]*- expenseCash/);
  assert.match(closingRoutes, /saleMomoReceived \+ debtMomo - expenseMomo/);
  assert.match(closingRoutes, /saleBankReceived \+ debtBank - expenseBank/);
  assert.match(closingRoutes, /saleOtherReceived \+ debtOther - expenseOther/);
});
