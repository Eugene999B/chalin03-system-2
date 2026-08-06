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
  const route = read("backend/routes/legacyCustomerDebtConsolidationRoutes.js");
  const wrapper = read("backend/routes/customerDebtConsolidationRoutes.js");
  const service = read("backend/services/customerIdentityMatchingService.js");

  assert.match(route, /router\.get\("\/directory",/);
  assert.match(route, /FROM customers/);
  assert.match(route, /LEFT JOIN \(\s*SELECT\s+branch_id,\s+customer_id,\s+COUNT\(\*\) AS sale_count/);
  assert.match(route, /router\.get\("\/duplicate-suggestions",/);
  assert.match(route, /customerIdentityMatchingService/);
  assert.match(wrapper, /legacyCustomerDebtConsolidationRoutes/);
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

test("preserved merge preview and transaction-safe merge protect linked records", () => {
  const route = read("backend/routes/legacyCustomerDebtConsolidationRoutes.js");
  const wrapper = read("backend/routes/customerDebtConsolidationRoutes.js");

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
  assert.match(wrapper, /topDebtAccountMergeRoutes/);
});

test("emergency containment freezes old customer merges before normal legacy routes", () => {
  const systemRoutes = read("backend/routes/systemRoutes.js");

  assert.match(systemRoutes, /CUSTOMER_MERGE_EMERGENCY_FREEZE/);
  assert.match(systemRoutes, /router\.post\("\/debt-customers\/merge"/);
  assert.match(systemRoutes, /router\.post\("\/debt-customers\/merge-preview"/);
  assert.match(systemRoutes, /status: "error"/);
  assert.match(systemRoutes, /merge_writes_frozen: true/);
  assert.match(systemRoutes, /customerMergeRecoveryRoutes/);
});

test("merge recovery is admin-only, receipt-specific and never recalculates money", () => {
  const route = read("backend/routes/customerMergeRecoveryRoutes.js");

  assert.match(route, /requireRole\("admin"\)/);
  assert.match(route, /MERGE_CUSTOMER_IDENTITIES/);
  assert.match(route, /UNDO_CUSTOMER_IDENTITY_MERGE/);
  assert.match(route, /router\.get\("\/today"/);
  assert.match(route, /router\.get\("\/integrity"/);
  assert.match(route, /router\.post\("\/:activityId\/reverse"/);
  assert.match(route, /Type UNDO MERGE exactly/);
  assert.match(route, /SELECT id, customer_id, receipt_number/);
  assert.match(route, /UPDATE sales\s+SET customer_id = \?/);
  assert.match(route, /UPDATE debts\s+SET customer_id = \?/);
  assert.match(route, /UPDATE installment_agreements\s+SET customer_id = \?/);
  assert.match(route, /await connection\.beginTransaction\(\)/);
  assert.match(route, /await connection\.commit\(\)/);
  assert.match(route, /await connection\.rollback\(\)/);
  assert.doesNotMatch(route, /SET amount_owed =/);
  assert.doesNotMatch(route, /SET amount_paid =/);
  assert.doesNotMatch(route, /SET balance =/);
  assert.doesNotMatch(route, /DELETE FROM debts/);
  assert.doesNotMatch(route, /DELETE FROM debt_payments/);
  assert.doesNotMatch(route, /DELETE FROM sales/);
});

test("customer statements expose a responsive evidence-first emergency review", () => {
  const page = read("frontend/src/pages/CustomerStatementPage.jsx");
  const panel = read("frontend/src/components/CustomerMergeEmergencyPanel.jsx");
  const css = read("frontend/src/styles/customerMergeEmergency.css");

  assert.match(page, /CustomerMergeEmergencyPanel/);
  assert.match(page, /CustomerStatementWorkspacePage/);
  assert.match(page, /statementRefreshKey/);
  assert.doesNotMatch(page, /CustomerIdentityManagementPanel/);
  assert.match(panel, /Customer merges are temporarily frozen/);
  assert.match(panel, /Open emergency review/);
  assert.match(panel, /Customer Merge & Debt Recovery/);
  assert.match(panel, /Today&apos;s merges/);
  assert.match(panel, /Debt integrity review/);
  assert.match(panel, /\/customer-merge-recovery\/today/);
  assert.match(panel, /\/customer-merge-recovery\/integrity/);
  assert.match(panel, /\/customer-merge-recovery\/\$\{merge\.activity_id\}\/reverse/);
  assert.match(panel, /UNDO MERGE/);
  assert.match(panel, /Do not use Sales History totals to overwrite debt/);
  assert.match(css, /\.cmr-shell/);
  assert.match(css, /\.cmr-workspace/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /\.cmr-transaction-table td::before/);
});
