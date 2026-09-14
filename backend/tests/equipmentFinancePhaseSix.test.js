const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(root, "..");

function read(relativePath) {
  return fs.readFileSync(path.resolve(repositoryRoot, relativePath), "utf8");
}

test("Phase 6 is isolated to Equipment Finance and exposes the complete production surface", () => {
  const routes = read("backend/routes/equipmentFinancePhaseSixRoutes.js");
  const service = read("backend/services/equipmentFinancePhaseSixService.js");
  const independentRoutes = read("backend/routes/equipmentFinanceIndependentRoutes.js");

  for (const endpoint of [
    "/phase6/portfolio",
    "/phase6/arrears",
    "/phase6/cash-flow",
    "/phase6/messages/sync",
    "/phase6/reminders/run",
    "/phase6/accounts/:agreementId/statement.pdf",
    "/phase6/payments/:paymentId/thermal-receipt.pdf",
    "/phase6/accounting-export.csv",
    "/phase6/accounting-export.xlsx",
  ]) {
    assert.match(routes, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(service, /customer_receipt_cutover_at/);
  assert.match(service, /startProfessionalReminderScheduler/);
  assert.match(service, /equipment_finance_payment_alerts/);
  assert.match(service, /equipment_finance_phase6_message_log/);
  assert.match(service, /equipment_sale_payment_allocations/);
  assert.match(service, /oldest/i);
  assert.match(independentRoutes, /equipmentFinancePhaseSixRoutes/);
  assert.doesNotMatch(routes, /\/api\/debts|spare_parts|sale_items/);
  assert.doesNotMatch(service, /\bdebts\b|spare_parts|sale_items/);
});

test("Phase 6 migration is additive, idempotent and retained in controlled maintenance", () => {
  const migration = read(
    "database/migrations/20260802_equipment_finance_phase6_reporting_notifications.sql"
  );
  const verifier = read(
    "database/migrations/20260802_equipment_finance_phase6_reporting_notifications_verify.sql"
  );
  const startup = read("backend/scripts/runEquipmentFinancePhaseSixStartup.js");
  const packageJson = JSON.parse(read("backend/package.json"));

  assert.match(migration, /ADDITIVE MIGRATION ONLY/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_finance_phase6_message_log/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_finance_phase6_export_log/);
  assert.match(migration, /customer_receipt_cutover_at/);
  assert.match(migration, /ON DUPLICATE KEY UPDATE/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM equipment_sale/);
  assert.match(verifier, /invalid_automatic_receipt_history/);
  assert.match(startup, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(startup, /GET_LOCK/);
  assert.match(startup, /validateVerifierResults/);
  assert.match(
    packageJson.scripts["maintenance:legacy-startup-repairs"],
    /runEquipmentFinancePhaseSixStartup\.js/
  );
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts["migrate:equipment-finance:phase6:production"],
    "node scripts/runEquipmentFinancePhaseSixStartup.js"
  );
});

test("Payment messages remain after-commit, duplicate safe and non-transactional", () => {
  const lifecycle = read("backend/routes/equipmentFinanceFinalLifecycleRoutes.js");
  const service = read("backend/services/equipmentFinancePhaseSixService.js");

  const commitIndex = lifecycle.indexOf("await connection.commit()");
  const bossAlertIndex = lifecycle.indexOf("sendBossPaymentAlert", commitIndex);
  assert.ok(commitIndex >= 0, "collection route must commit the payment");
  assert.ok(bossAlertIndex > commitIndex, "boss notification remains after payment commit");

  assert.match(service, /INSERT IGNORE INTO equipment_finance_phase6_message_log/);
  assert.match(service, /finance-payment-receipt:\$\{payment\.id\}/);
  assert.match(service, /payment\.payment_date >= CAST\(state\.state_value AS DATETIME\)/);
  assert.match(service, /console\.error\("Equipment Finance customer payment SMS scheduler failed:/);
});
