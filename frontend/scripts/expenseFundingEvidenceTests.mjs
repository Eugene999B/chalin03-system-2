import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const evidence = read("src/components/AdvancedAccountingExpenseFundingEvidence.jsx");
const main = read("src/main.jsx");
const expenses = read("src/pages/ExpensesPage.jsx");
const dailyClosing = read("src/pages/DailyClosingPage.jsx");
const accountingRoutes = read("../backend/routes/accountingIntelligenceRoutes.js");
const evidenceService = read("../backend/services/expenseFundingEvidenceService.js");

assert.match(main, /AdvancedAccountingExpenseFundingEvidence/);
assert.match(evidence, /\/accounting-intelligence\/expense-funding/);
assert.match(evidence, /Daily Closing & Accounting Evidence/);
assert.match(evidence, /All valid expenses reduce profit/);
assert.match(evidence, /Deducted from today&apos;s receipts/);
assert.match(evidence, /Accounting only/);
assert.match(evidence, /Cash closing deduction/);
assert.match(evidence, /by_funding_source/);
assert.match(evidence, /closing_deductions/);

assert.match(expenses, /value="today_sales_receipts"/);
assert.match(expenses, /This expense will reduce Daily Closing/);
assert.match(expenses, /deducted from today's/);
assert.match(dailyClosing, /Closing deduction:/);
assert.match(dailyClosing, /Accounting only:/);
assert.match(dailyClosing, /Deduct from \$\{String/);

assert.match(accountingRoutes, /expense_funding_evidence/);
assert.match(accountingRoutes, /"\/expense-funding"/);
assert.match(evidenceService, /receipts_funded_expenses/);
assert.match(evidenceService, /externally_funded_expenses/);
assert.match(evidenceService, /deduct_from_\$\{String/);

console.log("Expense funding evidence contracts passed.");
