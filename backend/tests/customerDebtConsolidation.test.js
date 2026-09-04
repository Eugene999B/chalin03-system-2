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

test("preserved customer debt consolidation backend retains the reviewed merge", () => {
  const route = read("backend/routes/legacyCustomerDebtConsolidationRoutes.js");
  const wrapper = read("backend/routes/customerDebtConsolidationRoutes.js");

  assert.match(route, /router\.get\("\/",/);
  assert.match(route, /router\.get\("\/:customerId",/);
  assert.match(route, /requireRole\("admin", "manager"\)/);
  assert.match(route, /UPDATE sales\s+SET customer_id = \?/);
  assert.match(route, /UPDATE debts\s+SET customer_id = \?/);
  assert.match(route, /UPDATE installment_agreements\s+SET customer_id = \?/);
  assert.match(route, /DELETE FROM customers/);
  assert.match(route, /MERGE_CUSTOMER_IDENTITIES/);
  assert.match(route, /Original sales, receipts, debt records and payments were preserved/);
  assert.match(wrapper, /topDebtAccountMergeRoutes/);
  assert.match(wrapper, /legacyCustomerDebtConsolidationRoutes/);
  assert.ok(
    wrapper.indexOf("router.use(topDebtAccountMergeRoutes)") <
      wrapper.indexOf("router.use(legacyCustomerDebtConsolidationRoutes)")
  );
});

test("preserved customer debt breakdown contains receipts, items and payments", () => {
  const route = read("backend/routes/legacyCustomerDebtConsolidationRoutes.js");

  assert.match(route, /s\.receipt_number/);
  assert.match(route, /FROM sale_items/);
  assert.match(route, /FROM debt_payments/);
  assert.match(route, /items: itemsBySale/);
  assert.match(route, /payments: paymentsByDebt/);
});

test("top account merge accepts saved and receipt-level keys without changing money", () => {
  const route = read("backend/routes/topDebtAccountMergeRoutes.js");

  assert.match(route, /\^\(customer\|legacy\)-\(\\d\+\)\$/);
  assert.match(route, /router\.post\(\s*"\/merge-accounts"/);
  assert.match(route, /requireRole\("admin", "manager"\)/);
  assert.match(route, /target\.type !== "customer"/);
  assert.match(route, /UPDATE debts\s+SET customer_id = \?/);
  assert.match(route, /UPDATE sales\s+SET customer_id = \?/);
  assert.match(route, /DELETE FROM customers/);
  assert.match(route, /assertFinancialSnapshot/);
  assert.match(route, /assertLegacyRowsPreserved/);
  assert.match(route, /payment_history_changed: false/);
  assert.match(route, /financial_values_changed: false/);
  assert.doesNotMatch(
    route,
    /SET\s+(?:amount_owed|amount_paid|balance|status|total|quantity)\s*=/i
  );
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
  assert.match(printPanel, /Complete Customer Debt Statement/);
  assert.match(printPanel, /createReport\("print"\)/);
  assert.match(printPanel, /createReport\("pdf"\)/);
  assert.match(printPanel, /createReport\("word"\)/);
  assert.match(printPanel, /createReport\("excel"\)/);
});

test("Debt page shows only the authoritative top workspace", () => {
  const page = read("frontend/src/pages/DebtsPage.jsx");
  const legacyPage = read("frontend/src/pages/LegacyDebtsPage.jsx");
  const tools = read("frontend/src/components/TopDebtDeskTools.jsx");
  const css = read("frontend/src/styles/topDebtDeskTools.css");

  assert.match(page, /TopDebtDeskTools/);
  assert.match(page, /LegacyDebtsPage/);
  assert.match(page, /top-only-debt-desk/);
  assert.match(legacyPage, /Customer Debt Desk/);
  assert.match(legacyPage, /axiosClient\.get\("\/debts"\)/);
  assert.match(legacyPage, /buildDebtDeskAccounts/);
  assert.match(tools, /Single authoritative debt workspace/);
  assert.match(tools, /axiosClient\.get\("\/debts"\)/);
  assert.match(tools, /\/debt-customers\/merge-accounts/);
  assert.match(tools, /DebtReminderSettingsPanel/);
  assert.match(tools, /customer-\$\{customerId\}/);
  assert.match(tools, /legacy-\$\{debt\.id\}/);
  assert.match(css, /\.top-only-debt-desk \.debt-desk__advanced/);
  assert.match(css, /\.top-only-debt-desk \.debt-desk__identity-centre-callout/);
  assert.match(css, /\.top-debt-tools__backdrop/);
  assert.match(css, /@media \(max-width: 600px\)/);
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
