const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

const route = read("../routes/customerStatementWorkspaceRoutes.js");
const server = read("../server.js");
const page = read("../../frontend/src/pages/CustomerStatementWorkspacePage.jsx");
const statementEntry = read("../../frontend/src/pages/CustomerStatementPage.jsx");
const debtPanel = read("../../frontend/src/components/CustomerDebtPrintPanel.jsx");
const layout = read("../../frontend/src/components/Layout.jsx");
const sidebarNavigation = read(
  "../../frontend/src/components/CompactSidebarNavigation.jsx"
);
const sidebarAccount = read("../../frontend/src/components/SidebarAccountMenu.jsx");

test("customer statement uses one filter-driven report dataset", () => {
  assert.match(route, /router\.get\("\/report"/);
  assert.match(route, /appendDateFilter/);
  assert.match(route, /appendCustomerFilter/);
  assert.match(route, /LOWER\(COALESCE\(\$\{alias\}\.customer_name/);
  assert.match(route, /FROM sale_items si/);
  assert.match(route, /customerSummaries/);
  assert.match(route, /transactions/);
  assert.match(route, /itemRows/);
  assert.match(server, /customerStatementWorkspaceRoutes/);
  assert.match(server, /\/api\/customer-statement-workspace/);
});

test("the redesigned page shows filtered views and purchased items", () => {
  assert.match(statementEntry, /CustomerStatementWorkspacePage/);
  assert.match(page, /Customer Statement & Account Analysis/);
  assert.match(page, /Apply Filters/);
  assert.match(page, /Customer Name or Phone/);
  assert.match(page, /Screen = Export/);
  assert.match(page, /Customer Summary/);
  assert.match(page, /Transaction Ledger/);
  assert.match(page, /Items Purchased/);
  assert.match(page, /PAGE_SIZE = 25/);
  assert.match(page, /report\?\.items/);
});

test("exports use the same filters for print PDF Word and Excel", () => {
  assert.match(route, /router\.get\("\/export\/:format"/);
  assert.match(route, /\["pdf", "print", "word", "excel"\]/);
  assert.match(route, /application\/msword/);
  assert.match(route, /ExcelJS\.Workbook/);
  assert.match(route, /application\/pdf/);
  assert.match(page, /exportReport\("print"\)/);
  assert.match(page, /exportReport\("pdf"\)/);
  assert.match(page, /exportReport\("word"\)/);
  assert.match(page, /exportReport\("excel"\)/);
  assert.match(debtPanel, /debt_status/);
  assert.match(debtPanel, /customer-statement-workspace\/export/);
});

test("desktop sidebar removes duplicate command card and uses compact sections", () => {
  assert.match(layout, /CompactSidebarNavigation/);
  assert.match(layout, /SidebarAccountMenu/);
  assert.doesNotMatch(layout, /className="premium-command-button"/);
  assert.match(sidebarNavigation, /aria-expanded/);
  assert.match(sidebarNavigation, /active-section/);
  assert.match(sidebarAccount, /InstallAppButton/);
  assert.match(sidebarAccount, /Change Password/);
  assert.match(sidebarAccount, /Logout/);
});
