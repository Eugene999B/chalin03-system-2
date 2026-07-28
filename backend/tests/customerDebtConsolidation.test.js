const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("customer debt consolidation backend preserves records and merges identities", () => {
  const route = read("backend/routes/customerDebtConsolidationRoutes.js");

  assert.match(route, /router\.get\("\/",/);
  assert.match(route, /router\.get\("\/:customerId",/);
  assert.match(route, /requireRole\("admin", "manager"\)/);
  assert.match(route, /UPDATE sales\s+SET customer_id = \?/);
  assert.match(route, /UPDATE debts\s+SET customer_id = \?/);
  assert.match(route, /UPDATE installment_agreements\s+SET customer_id = \?/);
  assert.match(route, /DELETE FROM customers/);
  assert.match(route, /MERGE_CUSTOMER_IDENTITIES/);
  assert.match(route, /Original sales, receipts, debt records and payments were preserved/);
});

test("customer debt breakdown contains receipts, items and payments", () => {
  const route = read("backend/routes/customerDebtConsolidationRoutes.js");

  assert.match(route, /s\.receipt_number/);
  assert.match(route, /FROM sale_items/);
  assert.match(route, /FROM debt_payments/);
  assert.match(route, /items: itemsBySale/);
  assert.match(route, /payments: paymentsByDebt/);
});

test("server exposes the consolidation route inside Spare Parts", () => {
  const server = read("backend/server.js");

  assert.match(
    server,
    /const customerDebtConsolidationRoutes = require\("\.\/routes\/customerDebtConsolidationRoutes"\);/
  );
  assert.match(
    server,
    /app\.use\("\/api\/debt-customers", requireAuth, sparePartsBoundary, customerDebtConsolidationRoutes\);/
  );
});

test("exact customer exports use customer id and retain print and downloads", () => {
  const workspaceRoute = read("backend/routes/customerStatementWorkspaceRoutes.js");
  const printPanel = read("frontend/src/components/CustomerDebtPrintPanel.jsx");

  assert.match(workspaceRoute, /customerId = positiveId\(req\.query\.customer_id\)/);
  assert.match(workspaceRoute, /appendCustomerIdFilter/);
  assert.match(printPanel, /preferredCustomerId = null/);
  assert.match(printPanel, /customer_id: filters\.customer_id/);
  assert.match(printPanel, /createReport\("print"\)/);
  assert.match(printPanel, /createReport\("pdf"\)/);
  assert.match(printPanel, /createReport\("word"\)/);
  assert.match(printPanel, /createReport\("excel"\)/);
});

test("Debts page defaults to customer consolidation with optional audit records", () => {
  const page = read("frontend/src/pages/DebtsPage.jsx");
  const component = read("frontend/src/components/CustomerDebtConsolidationPanel.jsx");
  const css = read("frontend/src/styles/customerDebtConsolidation.css");

  assert.match(page, /CustomerDebtConsolidationPanel/);
  assert.match(page, /showIndividualDebts, setShowIndividualDebts/);
  assert.match(component, /One customer, one clear debt overview/);
  assert.match(component, /Open Full Debt Breakdown/);
  assert.match(component, /Merge Duplicate Customers/);
  assert.match(component, /CustomerDebtPrintPanel/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\.customer-debt-detail-modal/);
});

test("service worker cache is advanced for the customer debt release", () => {
  const serviceWorker = read("frontend/public/sw.js");
  assert.match(serviceWorker, /chalin03-customer-debt-consolidation-v9/);
});
