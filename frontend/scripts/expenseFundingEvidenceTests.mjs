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
const operationalRoot = read("src/OperationalAppRoot.jsx");
const publicRoot = read("src/chalin-one/PublicChalinOneEntry.jsx");
const accountingRoutes = read("../backend/routes/accountingIntelligenceRoutes.js");
const evidenceService = read("../backend/services/expenseFundingEvidenceService.js");

assert.match(operationalRoot, /AdvancedAccountingExpenseFundingEvidence/);
assert.doesNotMatch(main, /AdvancedAccountingExpenseFundingEvidence/);
assert.doesNotMatch(publicRoot, /AdvancedAccountingExpenseFundingEvidence/);
assert.match(main, /import\("\.\/OperationalAppRoot\.jsx"\)/);
assert.match(evidence, /\/accounting-intelligence\/expense-funding/);
assert.match(evidence, /Daily Closing & Accounting Evidence/);
assert.match(evidence, /All valid expenses reduce profit/);
assert.match(evidence, /receipts_funded_expenses/);
assert.match(evidence, /externally_funded_expenses/);
assert.match(evidence, /closing_deductions/);
assert.match(evidence, /by_funding_source/);
assert.match(evidence, /channels\.cash/);
assert.match(evidence, /channels\.momo/);
assert.match(evidence, /channels\.bank/);
assert.match(evidence, /channels\.other/);

assert.match(accountingRoutes, /expense_funding_evidence/);
assert.match(accountingRoutes, /"\/expense-funding"/);
assert.match(accountingRoutes, /attachExpenseFundingEvidence/);
assert.match(evidenceService, /funding_source = 'today_sales_receipts'/);
assert.match(evidenceService, /affects_daily_closing = 1/);
assert.match(evidenceService, /receipts_funded_expenses/);
assert.match(evidenceService, /externally_funded_expenses/);
assert.match(evidenceService, /cash_closing_deduction/);
assert.match(evidenceService, /momo_closing_deduction/);
assert.match(evidenceService, /bank_closing_deduction/);
assert.match(evidenceService, /other_closing_deduction/);

console.log("Expense funding evidence contracts passed.");
