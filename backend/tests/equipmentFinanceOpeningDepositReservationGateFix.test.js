const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const sql = fs.readFileSync(
  path.join(
    root,
    "backend/database/migrations/20260825_equipment_finance_opening_deposit_reservation_gate_fix.sql"
  ),
  "utf8"
);
const runner = fs.readFileSync(
  path.join(
    root,
    "backend/scripts/runEquipmentFinanceOpeningDepositFoundationRepair.js"
  ),
  "utf8"
);

test("the reservation-gate fix replaces the exact invalid trigger", () => {
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_equipment_finance_reservation_gate_before_insert/);
  assert.match(sql, /CREATE TRIGGER trg_equipment_finance_reservation_gate_before_insert/);
});

test("reservation remains gated by approved credit, exact machine, full deposit and availability", () => {
  assert.match(sql, /v_application_status <> 'approved'/);
  assert.match(sql, /NEW\.asset_id <> v_agreement_asset_id/);
  assert.match(sql, /NEW\.lock_status <> 'installment_active'/);
  assert.match(sql, /v_deposit_received \+ 0\.01 < v_deposit_required/);
  assert.match(sql, /asset\.sale_status = 'available'/);
  assert.match(sql, /hire_asset\.status IN \('assigned','dispatched','active'\)/);
});

test("the production repair runner executes the reservation-gate correction before verification", () => {
  assert.match(
    runner,
    /20260825_equipment_finance_opening_deposit_reservation_gate_fix\.sql/
  );
  assert.match(
    runner,
    /await executeSqlFile\(connection, reservationGateFixFile\);/
  );
  assert.match(runner, /await verifyRequiredTriggers\(connection\);/);
});
