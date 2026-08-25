const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(
  __dirname,
  "../database/migrations/20260825_equipment_finance_opening_deposit_trigger_fix.sql"
);
const sql = fs.readFileSync(file, "utf8");

test("Opening Deposit trigger fix replaces all three protected Finance gates", () => {
  for (const triggerName of [
    "trg_equipment_finance_payment_gate_before_insert",
    "trg_equipment_finance_reservation_gate_before_insert",
    "trg_equipment_finance_commitment_gate_before_update",
  ]) {
    assert.match(sql, new RegExp(`DROP TRIGGER IF EXISTS ${triggerName}`));
    assert.match(sql, new RegExp(`CREATE TRIGGER ${triggerName}`));
  }
});

test("unreserved approved-credit agreements cannot be promoted by the balance guard", () => {
  assert.match(
    sql,
    /ELSEIF NEW\.equipment_commitment_status = 'not_reserved' THEN\s+SET NEW\.agreement_status = 'approved';/s
  );
  assert.doesNotMatch(
    sql,
    /IF NEW\.deposit_received\s*>=\s*NEW\.deposit_required[\s\S]{0,400}SET NEW\.agreement_status = 'active';/i
  );
});

test("reservation remains gated by approved credit, exact machine, full deposit and availability", () => {
  assert.match(sql, /NEW\.lock_status <> 'installment_active'/);
  assert.match(sql, /NEW\.asset_id <> v_agreement_asset_id/);
  assert.match(sql, /v_application_status <> 'approved'/);
  assert.match(sql, /v_deposit_received < v_deposit_required/);
  assert.match(sql, /asset\.sale_status = 'available'/);
  assert.match(sql, /hire_asset\.status IN \('assigned','dispatched','active'\)/);
});

test("activation requires a real reservation before the agreement can become active", () => {
  assert.match(sql, /OLD\.agreement_status NOT IN \('active','due_soon','payment_due','overdue'\)/);
  assert.match(sql, /NEW\.agreement_status IN \('active','due_soon','payment_due','overdue'\)/);
  assert.match(sql, /NEW\.equipment_commitment_status <> 'reserved'/);
  assert.match(sql, /A controlled Finance agreement cannot become active before equipment reservation\./);
});
