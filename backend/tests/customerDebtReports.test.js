const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const workspaceRoute = fs.readFileSync(
  path.resolve(__dirname, "../routes/customerStatementWorkspaceRoutes.js"),
  "utf8"
);
const serverSource = fs.readFileSync(
  path.resolve(__dirname, "../server.js"),
  "utf8"
);
const statementEntry = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../frontend/src/pages/CustomerStatementPage.jsx"
  ),
  "utf8"
);
const statementWorkspace = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../frontend/src/pages/CustomerStatementWorkspacePage.jsx"
  ),
  "utf8"
);
const debtsPage = fs.readFileSync(
  path.resolve(__dirname, "../../frontend/src/pages/LegacyDebtsPage.jsx"),
  "utf8"
);
const consolidationPanel = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../frontend/src/components/CustomerDebtConsolidationPanel.jsx"
  ),
  "utf8"
);
const printPanel = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../frontend/src/components/CustomerDebtPrintPanel.jsx"
  ),
  "utf8"
);

test("customer statement data includes purchased sale items", () => {
  assert.match(workspaceRoute, /FROM sale_items si/);
  assert.match(workspaceRoute, /sale\.items =/);
  assert.match(statementWorkspace, /Items Purchased/);
  assert.match(statementWorkspace, /report\?\.items/);
  assert.match(statementWorkspace, /customer-statement-workspace\/report/);
  assert.match(statementEntry, /CustomerStatementWorkspacePage/);
});

test("filter API supports date ranges, optional customer and all export formats", () => {
  assert.match(workspaceRoute, /router\.get\("\/report"/);
  assert.match(workspaceRoute, /router\.get\("\/export\/:format"/);
  assert.match(workspaceRoute, /appendDateFilter/);
  assert.match(workspaceRoute, /appendCustomerFilter/);
  assert.match(workspaceRoute, /\["pdf", "print", "word", "excel"\]/);
  assert.match(workspaceRoute, /application\/msword/);
  assert.match(workspaceRoute, /ExcelJS\.Workbook/);
  assert.match(workspaceRoute, /writeAuditEvent/);
  assert.match(serverSource, /customerStatementWorkspaceRoutes/);
  assert.match(serverSource, /\/api\/customer-statement-workspace/);
});

test("filtered exports remain available from statements and the preserved identity tools", () => {
  assert.match(statementWorkspace, /Customer Name or Phone/);
  assert.match(statementWorkspace, /Leave blank for all customers/);
  assert.match(statementWorkspace, /Apply Filters/);
  assert.match(statementWorkspace, /exportReport\("print"\)/);
  assert.match(statementWorkspace, /exportReport\("pdf"\)/);
  assert.match(statementWorkspace, /exportReport\("word"\)/);
  assert.match(statementWorkspace, /exportReport\("excel"\)/);
  assert.match(printPanel, /Customer Name or Phone/);
  assert.match(printPanel, /Leave blank for all customers/);
  assert.match(printPanel, /Debt Status/);
  assert.match(printPanel, /createReport\("print"\)/);
  assert.match(printPanel, /createReport\("word"\)/);
  assert.match(printPanel, /createReport\("excel"\)/);
  assert.match(debtsPage, /CustomerDebtConsolidationPanel/);
  assert.match(debtsPage, /Customer identity and debt controls/);
  assert.match(debtsPage, /exports and\s+receipt-level audit/);
  assert.match(consolidationPanel, /<CustomerDebtPrintPanel/);
  assert.match(consolidationPanel, /reportType="debt"/);
});
