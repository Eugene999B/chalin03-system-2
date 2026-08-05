const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const matchingService = require("../services/customerIdentityMatchingService");

test("customer identity API includes every customer and duplicate suggestions", () => {
  const route = read("backend/routes/customerDebtConsolidationRoutes.js");
  const service = read("backend/services/customerIdentityMatchingService.js");

  assert.match(route, /router\.get\("\/directory",/);
  assert.match(route, /FROM customers/);
  assert.match(route, /LEFT JOIN \(\s*SELECT\s+branch_id,\s+customer_id,\s+COUNT\(\*\) AS sale_count/);
  assert.match(route, /router\.get\("\/duplicate-suggestions",/);
  assert.match(route, /customerIdentityMatchingService/);
  assert.match(service, /function normalizePhone/);
  assert.match(service, /function soundex/);
  assert.match(service, /function diceCoefficient/);
  assert.match(service, /function tokenJaccard/);
  assert.match(service, /function duplicateGroups/);
});

test("matching algorithm normalizes Ghana phone formats and ranks strong duplicates", () => {
  assert.equal(
    matchingService.normalizePhone("024 123 4567"),
    matchingService.normalizePhone("+233 24 123 4567")
  );

  const comparison = matchingService.compareCustomerPair(
    {
      customer_id: 10,
      customer_name: "Mr. Kofi Mensah",
      customer_phone: "024 123 4567",
      customer_location: "Dunkwa-on-Offin",
      sale_count: 6,
      debt_count: 1,
    },
    {
      customer_id: 29,
      customer_name: "Kofi Mensa",
      customer_phone: "+233241234567",
      customer_location: "Dunkwa on Offin",
      sale_count: 1,
      debt_count: 0,
    }
  );

  assert.ok(comparison.score >= 88);
  assert.equal(comparison.confidence, "very_likely");
  assert.equal(comparison.recommended_master_id, 10);
  assert.ok(comparison.reasons.some((reason) => /phone/i.test(reason)));
});

test("matching algorithm penalizes conflicting valid phone numbers", () => {
  const comparison = matchingService.compareCustomerPair(
    {
      customer_id: 1,
      customer_name: "Ama Boateng",
      customer_phone: "0241111111",
      customer_location: "Dunkwa",
    },
    {
      customer_id: 2,
      customer_name: "Ama Boateng",
      customer_phone: "0209999999",
      customer_location: "Dunkwa",
    }
  );

  assert.ok(comparison.warnings.some((warning) => /different phone/i.test(warning)));
  assert.ok(comparison.score < 74);
});

test("merge preview and transaction-safe merge protect linked records", () => {
  const route = read("backend/routes/customerDebtConsolidationRoutes.js");

  assert.match(route, /router\.post\(\s*"\/merge-preview"/);
  assert.match(route, /requireRole\("admin", "manager"\)/);
  assert.match(route, /information_schema\.KEY_COLUMN_USAGE/);
  assert.match(route, /REFERENCED_TABLE_NAME = 'customers'/);
  assert.match(route, /await connection\.beginTransaction\(\)/);
  assert.match(route, /await connection\.commit\(\)/);
  assert.match(route, /await connection\.rollback\(\)/);
  assert.match(route, /ER_DUP_ENTRY/);
  assert.match(route, /No data was changed/);
  assert.match(route, /MERGE_CUSTOMER_IDENTITIES/);
});

test("customer statements keep merging compact, optional and mobile safe", () => {
  const page = read("frontend/src/pages/CustomerStatementPage.jsx");
  const panel = read("frontend/src/components/CustomerIdentityManagementPanel.jsx");
  const css = read("frontend/src/styles/customerIdentityManagement.css");

  assert.match(page, /CustomerIdentityManagementPanel/);
  assert.match(page, /CustomerStatementWorkspacePage/);
  assert.match(page, /statementRefreshKey/);
  assert.match(panel, /Merge duplicate customers/);
  assert.match(panel, /Open merge tool/);
  assert.match(panel, /Customer Identity Centre/);
  assert.match(panel, /Complete customer directory/);
  assert.match(panel, /Duplicate suggestions/);
  assert.match(panel, /useState\(false\)/);
  assert.match(panel, /cim-workspace-backdrop/);
  assert.match(panel, /setWorkspaceOpen\(false\)/);
  assert.match(panel, /\/debt-customers\/directory/);
  assert.match(panel, /\/debt-customers\/duplicate-suggestions/);
  assert.match(panel, /\/debt-customers\/merge-preview/);
  assert.match(panel, /\/debt-customers\/merge/);
  assert.match(panel, /type MERGE/i);
  assert.match(css, /\.cim-launcher/);
  assert.match(css, /\.cim-workspace-backdrop/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /\.cim-table td::before/);
  assert.match(css, /\.cim-modal-backdrop/);
});
