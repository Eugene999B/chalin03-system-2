const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const routes = read("backend", "routes", "debtRoutes.js");
const page = read("frontend", "src", "pages", "DebtsPage.jsx");
const css = read("frontend", "src", "styles", "debtDesk.css");

const DEBT_DELETE = /DELETE\s+FROM\s+(?:debts|debt_payments)\b/i;
const RUNTIME_DDL = /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|DATABASE)\b/i;

test("Debt Desk resolves the current sale identity without deleting snapshots", () => {
  assert.match(
    routes,
    /COALESCE\(NULLIF\(s\.customer_name, ''\), NULLIF\(c\.name, ''\), NULLIF\(d\.customer_name, ''\)/
  );
  assert.match(routes, /debt_customer_name_snapshot/);
  assert.match(routes, /sale_customer_name/);
  assert.match(page, /Current customer names shown/);
  assert.match(page, /Original snapshots remain preserved for audit/);
  assert.doesNotMatch(routes, DEBT_DELETE);
  assert.doesNotMatch(routes, RUNTIME_DDL);
});

test("customer-first endpoints keep receipt detail while simplifying navigation", () => {
  assert.match(routes, /router\.get\("\/customers"/);
  assert.match(routes, /router\.get\("\/customers\/:customerKey"/);
  assert.match(routes, /customer-\(\\d\+\)/);
  assert.match(routes, /legacy-\(\\d\+\)/);
  assert.match(page, /Customer Debt Desk/);
  assert.match(page, /Search customer name, phone or location/);
  assert.match(page, /Pay full balance/);
  assert.match(page, /Record partial payment/);
  assert.doesNotMatch(page, /Choose debt/);
});

test("one customer payment is transactional, locked and allocated oldest due first", () => {
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
  assert.match(page, /Payment allocation preview/);
  assert.match(page, /Oldest due first/);
});

test("full settlement is exact and partial settlement cannot overpay", () => {
  assert.match(routes, /payFullBalance \? previousOutstanding/);
  assert.match(routes, /PAYMENT_EXCEEDS_CUSTOMER_BALANCE/);
  assert.match(routes, /newOutstanding <= 0/);
  assert.match(routes, /outstanding debt has been paid in full/);
  assert.match(page, /Full balance ·/);
  assert.match(page, /Amount cannot exceed/);
  assert.match(page, /Confirm \$\{money\(cleanPaymentAmount\)\} payment/);
});

test("payment retries are idempotency-gated and audit evidence stays append-only", () => {
  assert.match(routes, /cleanPaymentRequestKey/);
  assert.match(routes, /\[DebtDesk:\$\{requestKey\}\]/);
  assert.match(routes, /DUPLICATE_DEBT_PAYMENT_REQUEST/);
  assert.match(routes, /LEFT\(notes, \?\) = \?/);
  assert.match(page, /request_key: paymentRequestKey/);
  assert.match(page, /makeRequestKey/);
  assert.doesNotMatch(routes, /UPDATE debt_payments/);
});

test("advanced controls remain available but no longer dominate the daily workflow", () => {
  assert.match(page, /Advanced debt tools/);
  assert.match(page, /Duplicate-customer merge, reminder settings and receipt-level audit view/);
  assert.match(page, /showAdvancedTools \?/);
  assert.match(page, /CustomerDebtConsolidationPanel/);
  assert.match(css, /debt-desk__advanced/);
});

test("Debt Desk is responsive and keeps the customer file usable on phones", () => {
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s+minmax\(390px,\s*\.?92fr\)/);
  assert.match(css, /@media \(max-width:980px\)/);
  assert.match(css, /position:fixed;inset:0;z-index:1200/);
  assert.match(css, /min-height:100dvh/);
  assert.match(css, /focus-visible/);
});
