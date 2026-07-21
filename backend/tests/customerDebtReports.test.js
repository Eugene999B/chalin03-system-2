const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoute = fs.readFileSync(
  path.resolve(__dirname, "../routes/customerDebtReportRoutes.js"),
  "utf8"
);
const serverSource = fs.readFileSync(
  path.resolve(__dirname, "../server.js"),
  "utf8"
);
const statementPage = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../frontend/src/pages/CustomerStatementPage.jsx"
  ),
  "utf8"
);
const debtsPage = fs.readFileSync(
  path.resolve(__dirname, "../../frontend/src/pages/DebtsPage.jsx"),
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
  assert.match(backendRoute, /FROM sale_items si/);
  assert.match(backendRoute, /sale\.items =/);
  assert.match(statementPage, /Items Bought/);
  assert.match(statementPage, /sale\.items/);
  assert.match(statementPage, /customer-debt-reports\/statement/);
});

test("print API supports document choice, date ranges and customer scope", () => {
  assert.match(backendRoute, /router\.get\("\/pdf"/);
  assert.match(backendRoute, /reportType === "statement"/);
  assert.match(backendRoute, /\["selected", "all"\]/);
  assert.match(backendRoute, /DATE\(\$\{alias\}\.\$\{column\}\) >= \?/);
  assert.match(backendRoute, /DATE\(\$\{alias\}\.\$\{column\}\) <= \?/);
  assert.match(backendRoute, /Customer Debt Report/);
  assert.match(backendRoute, /clauses\.join\(" OR "\)/);
  assert.match(backendRoute, /writeAuditEvent\([\s\S]*\)\.catch/);
  assert.match(serverSource, /customerDebtReportRoutes/);
  assert.match(serverSource, /\/api\/customer-debt-reports/);
});

test("shared print panel is available from statements and debts", () => {
  assert.match(printPanel, /Customer Statement/);
  assert.match(printPanel, /Debt Report/);
  assert.match(printPanel, /Selected Customer/);
  assert.match(printPanel, /All Customers/);
  assert.match(printPanel, /type="date"/);
  assert.match(printPanel, /Open Printable PDF/);
  assert.match(printPanel, /window\.open\(blobUrl/);
  assert.match(printPanel, /PDF was downloaded/);
  assert.match(statementPage, /<CustomerDebtPrintPanel/);
  assert.match(debtsPage, /<CustomerDebtPrintPanel/);
});
