const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const routes = read("backend", "routes", "debtRoutes.js");
const mergeRoutes = read("backend", "routes", "topDebtAccountMergeRoutes.js");
const page = read("frontend", "src", "pages", "DebtsPage.jsx");
const legacyPage = read("frontend", "src", "pages", "LegacyDebtsPage.jsx");
const tools = read("frontend", "src", "components", "TopDebtDeskTools.jsx");
const css = read("frontend", "src", "styles", "debtDesk.css");
const toolsCss = read("frontend", "src", "styles", "topDebtDeskTools.css");

const DEBT_DELETE = /DELETE\s+FROM\s+(?:debts|debt_payments)\b/i;
const RUNTIME_DDL = /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|DATABASE)\b/i;

test("Debt Desk resolves the current sale identity without deleting snapshots", () => {
  assert.match(
    routes,
    /COALESCE\(NULLIF\(s\.customer_name, ''\), NULLIF\(c\.name, ''\), NULLIF\(d\.customer_name, ''\)/
  );
  assert.match(routes, /debt_customer_name_snapshot/);
  assert.match(routes, /sale_customer_name/);
  assert.match(legacyPage, /Current customer names shown/);
  assert.match(legacyPage, /Original snapshots remain preserved\s+for audit/);
  assert.match(legacyPage, /identity_changed/);
  assert.doesNotMatch(routes, DEBT_DELETE);
  assert.doesNotMatch(routes, RUNTIME_DDL);
});

test("customer-first navigation retains the proven detail and payment fallbacks", () => {
  assert.match(routes, /router\.get\("\/customers"/);
  assert.match(routes, /router\.get\("\/customers\/:customerKey"/);
  assert.match(routes, /customer-\(\\d\+\)/);
  assert.match(routes, /legacy-\(\\d\+\)/);
  assert.match(page, /LegacyDebtsPage/);
  assert.match(legacyPage, /Customer Debt Desk/);
  assert.match(legacyPage, /axiosClient\.get\("\/debts"\)/);
  assert.doesNotMatch(legacyPage, /axiosClient\.get\("\/debts\/customers",\s*\{/);
  assert.match(legacyPage, /buildDebtDeskAccounts/);
  assert.match(legacyPage, /\/debt-customers\/\$\{linkedMatch\[1\]\}/);
  assert.match(legacyPage, /\/debts\/\$\{legacyMatch\[1\]\}/);
  assert.match(legacyPage, /Search customer name, phone or location/);
  assert.match(legacyPage, /Pay full balance/);
  assert.match(legacyPage, /Record partial payment/);
  assert.doesNotMatch(legacyPage, /Choose debt/);
});

test("one customer payment remains transactional, locked and oldest-due first", () => {
  assert.match(routes, /router\.post\("\/customers\/:customerKey\/payments"/);
  assert.match(routes, /beginTransaction/);
  assert.match(routes, /FOR UPDATE/);
  assert.match(
    routes,
    /CASE WHEN d\.due_date IS NULL THEN 1 ELSE 0 END,[\s\S]*d\.due_date ASC,[\s\S]*d\.created_at ASC/
  );
  assert.match(routes, /INSERT INTO debt_payments/);
  assert.match(routes, /UPDATE debts/);
  assert.match(routes, /UPDATE sales/);
  assert.match(routes, /allocation_method: "oldest_due_first"/);
  assert.match(routes, /CUSTOMER_DEBT_PAYMENT/);
  assert.match(routes, /markClosingStale/);
  assert.match(legacyPage, /Payment allocation preview/);
  assert.match(legacyPage, /Oldest due first/);
});

test("full settlement is exact and partial settlement cannot overpay", () => {
  assert.match(routes, /payFullBalance \? previousOutstanding/);
  assert.match(routes, /PAYMENT_EXCEEDS_CUSTOMER_BALANCE/);
  assert.match(routes, /newOutstanding <= 0/);
  assert.match(routes, /outstanding debt has been paid in full/);
  assert.match(legacyPage, /Full balance ·/);
  assert.match(legacyPage, /Amount cannot exceed/);
  assert.match(legacyPage, /Confirm \$\{money\(cleanPaymentAmount\)\} payment/);
});

test("payment retries remain idempotency-gated and append-only", () => {
  assert.match(routes, /cleanPaymentRequestKey/);
  assert.match(routes, /\[DebtDesk:\$\{requestKey\}\]/);
  assert.match(routes, /DUPLICATE_DEBT_PAYMENT_REQUEST/);
  assert.match(routes, /LEFT\(notes, \?\) = \?/);
  assert.match(legacyPage, /request_key: paymentRequestKey/);
  assert.match(legacyPage, /makeRequestKey/);
  assert.doesNotMatch(routes, /UPDATE debt_payments/);
});

test("top-only duplicate resolution uses the authoritative account list", () => {
  assert.match(page, /TopDebtDeskTools/);
  assert.match(page, /LegacyDebtsPage/);
  assert.match(page, /top-only-debt-desk/);
  assert.match(tools, /Single authoritative debt workspace/);
  assert.match(tools, /axiosClient\.get\("\/debts"\)/);
  assert.match(tools, /Merge accounts/);
  assert.match(tools, /Debt reminder settings/);
  assert.match(tools, /\/debt-customers\/merge-accounts/);
  assert.match(tools, /Receipt-level accounts are allowed here/);
  assert.match(tools, /Protected during merge/);
  assert.match(mergeRoutes, /router\.post\(\s*"\/merge-accounts"/);
  assert.match(mergeRoutes, /MERGE_DEBT_DESK_ACCOUNTS/);
  assert.match(mergeRoutes, /assertFinancialSnapshot/);
  assert.match(mergeRoutes, /assertLegacyRowsPreserved/);
  assert.doesNotMatch(mergeRoutes, DEBT_DELETE);
  assert.match(toolsCss, /\.top-only-debt-desk \.debt-desk__advanced/);
  assert.match(toolsCss, /\.top-only-debt-desk \.debt-desk__identity-centre-callout/);
  assert.match(toolsCss, /\.top-debt-tools__backdrop/);
  assert.match(toolsCss, /@media \(max-width: 600px\)/);
});

test("Debt Desk remains responsive and usable on phones", () => {
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s+minmax\(390px,\s*\.?92fr\)/);
  assert.match(css, /@media \(max-width:980px\)/);
  assert.match(css, /position:fixed;inset:0;z-index:1200/);
  assert.match(css, /min-height:100dvh/);
  assert.match(css, /focus-visible/);
  assert.match(toolsCss, /grid-template-columns: 1fr/);
  assert.match(toolsCss, /width: 100%/);
});
