const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function compact(value) {
  return String(value).replace(/\s+/g, " ");
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

test("server exposes the consolidation route inside Spare Parts after return reconciliation", () => {
  const server = read("backend/server.js");
  const source = compact(server);

  assert.match(
    server,
    /const customerDebtConsolidationRoutes = require\("\.\/routes\/customerDebtConsolidationRoutes"\);/
  );
  assert.match(
    source,
    /"\/api\/debt-customers", requireAuth, sparePartsBoundary, reconcileCreditReturnDebts, customerDebtConsolidationRoutes/
  );
});

test("exact customer exports use customer id and retain print and downloads", () => {
  const workspaceRoute = read("backend/routes/customerStatementWorkspaceRoutes.js");
  const printPanel = read("frontend/src/components/CustomerDebtPrintPanel.jsx");

  assert.match(workspaceRoute, /customerId = positiveId\(req\.query\.customer_id\)/);
  assert.match(workspaceRoute, /appendCustomerIdFilter/);
  assert.match(printPanel, /preferredCustomerId = null/);
  assert.match(printPanel, /customer_id: filters\.customer_id/);
  assert.match(printPanel, /exactCustomerSelected \? "" : defaultFromDate\(\)/);
  assert.match(printPanel, /exactCustomerSelected \? "" : dateInputValue\(new Date\(\)\)/);
  assert.match(printPanel, /Complete Customer Debt Statement/);
  assert.match(printPanel, /readOnly=\{exactCustomerSelected\}/);
  assert.match(printPanel, /createReport\("print"\)/);
  assert.match(printPanel, /createReport\("pdf"\)/);
  assert.match(printPanel, /createReport\("word"\)/);
  assert.match(printPanel, /createReport\("excel"\)/);
});

test("Debt Desk uses the live-safe reader while professional consolidation stays visible", () => {
  const page = read("frontend/src/pages/DebtsPage.jsx");
  const component = read("frontend/src/components/CustomerDebtConsolidationPanel.jsx");
  const css = read("frontend/src/styles/customerDebtConsolidation.css");
  const hotfixCss = read("frontend/src/styles/debtDeskLiveHotfix.css");

  assert.match(page, /Customer Debt Desk/);
  assert.match(page, /axiosClient\.get\("\/debts"\)/);
  assert.doesNotMatch(page, /axiosClient\.get\("\/debts\/customers",\s*\{/);
  assert.match(page, /buildDebtDeskAccounts/);
  assert.match(page, /showAdvancedTools, setShowAdvancedTools/);
  assert.match(page, /Customer identity and debt controls/);
  assert.match(page, /Resolve duplicate customers/);
  assert.match(page, /CustomerDebtConsolidationPanel/);
  assert.doesNotMatch(page, /showIndividualDebts, setShowIndividualDebts/);
  assert.match(component, /One customer, one clear debt overview/);
  assert.match(component, /Open Full Debt Breakdown/);
  assert.match(component, /Merge Duplicate Customers/);
  assert.match(component, /CustomerDebtPrintPanel/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /\.customer-debt-detail-modal/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(hotfixCss, /customer-debt-merge-panel/);
  assert.match(hotfixCss, /@media \(max-width: 700px\)/);
  assert.match(hotfixCss, /@media \(max-width: 420px\)/);
});

test("service worker protects the verified Debt Desk from retired build assets", () => {
  const serviceWorker = read("frontend/public/sw.js");
  const indexHtml = read("frontend/index.html");

  assert.match(serviceWorker, /const CACHE_PREFIX = "chalin03-"/);
  assert.match(
    serviceWorker,
    /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
  );
  assert.match(serviceWorker, /isBuildAssetRequest\(request, url\)/);
  assert.match(serviceWorker, /networkBuildAsset\(request\)/);
  assert.match(serviceWorker, /CHALIN03_ASSET_MISMATCH/);
  assert.match(serviceWorker, /X-Chalin03-Asset-Mismatch/);
  assert.doesNotMatch(serviceWorker, /debt-responsive-hotfix\.css/);
  assert.doesNotMatch(serviceWorker, /debt-mobile-contrast-hotfix\.css/);
  assert.doesNotMatch(indexHtml, /debt-responsive-hotfix\.css/);
  assert.doesNotMatch(indexHtml, /debt-mobile-contrast-hotfix\.css/);
});