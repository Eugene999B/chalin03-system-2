const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("Finance runtime contract repair is part of Railway pre-deploy", () => {
  const railway = read("railway.json");
  assert.match(railway, /node scripts\/runEquipmentFinanceRuntimeContractRepairV2\.js/);
  assert.match(railway, /runEquipmentFinanceProductionPredeployRepair\.js/);
  assert.match(railway, /finalizeEquipmentFinanceOpeningDepositReservationTrigger\.js/);
  assert.match(railway, /verifyEquipmentFinanceDepositReadiness\.js/);
});

test("Finance runtime contract uses the real quotation due-date source", () => {
  const repair = read("backend", "scripts", "runEquipmentFinanceRuntimeContractRepairV2.js");
  assert.match(repair, /equipment_sales_quotations/);
  assert.match(repair, /quotation\.proposed_first_due_date/);
  assert.doesNotMatch(repair, /application\.proposed_first_due_date/);
  assert.match(repair, /agreement\.quotation_id/);
});

test("Finance runtime contract normalizes legacy payment schema", () => {
  const repair = read("backend", "scripts", "runEquipmentFinanceRuntimeContractRepairV2.js");
  assert.match(repair, /installment_collection/);
  assert.match(repair, /opening_deposit/);
  assert.match(repair, /reservation_effect/);
  assert.match(repair, /equipment_sale_agreements[\s\S]*hire_location_id INT NULL/);
  assert.match(repair, /equipment_sale_payments[\s\S]*hire_location_id INT NULL/);
  assert.match(repair, /equipment_asset_sale_locks[\s\S]*hire_location_id INT NULL/);
});

test("Finance runtime contract repairs and prevents impossible installment dates", () => {
  const repair = read("backend", "scripts", "runEquipmentFinanceRuntimeContractRepairV2.js");
  assert.match(repair, /first_due_date < DATE\(agreement\.created_at\)/);
  assert.match(repair, /schedule\.due_date < DATE\(agreement\.created_at\)/);
  assert.match(repair, /trg_equipment_finance_schedule_date_gate_before_insert/);
  assert.match(repair, /trg_equipment_finance_schedule_date_gate_before_update/);
  assert.match(repair, /trg_equipment_finance_agreement_date_gate_before_insert/);
  assert.match(repair, /impossible_agreement_dates/);
  assert.match(repair, /impossible_schedule_dates/);
});
