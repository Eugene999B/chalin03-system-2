const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { planUnpaidScheduleVariation } = require("../services/equipmentFinancePriceVariationService");

const root = path.resolve(__dirname, "..");
const machine = fs.readFileSync(path.join(root, "services/equipmentFinanceMachineRegisterService.js"), "utf8");
const price = fs.readFileSync(path.join(root, "services/equipmentFinancePriceVariationService.js"), "utf8");
const route = fs.readFileSync(path.join(root, "routes/equipmentFinanceMachineRegisterRoutes.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "../frontend/src/pages/EquipmentFinanceExcavatorsPage.jsx"), "utf8");

test("authorised machine save synchronises its active installment agreement in same transaction", () => {
  assert.match(machine, /beginTransaction\(\)/);
  assert.match(machine, /syncActiveAgreementPriceFromMachine\(\{/);
  assert.match(machine, /await connection\.commit\(\)/);
  const relevant = machine.slice(machine.indexOf("async function updateFinanceMachine"));
  assert.ok(relevant.indexOf("await syncActiveAgreementPriceFromMachine") <
    relevant.indexOf("await connection.commit()"));
  assert.match(machine, /finance_price_correction: financePriceCorrection/);
  assert.match(route, /machine\?\.finance_price_correction/);
});

test("the same previously edited selling price can be saved to correct an existing active agreement", () => {
  assert.match(machine, /machine\.target_selling_price === undefined/);
  assert.match(machine, /machine\.target_selling_price !== undefined/);
  assert.match(ui, /If you edited the price earlier, save the same price again/);
});

test("automatic financial correction is limited to a single active installment", () => {
  assert.match(price, /agreement\.sale_type = 'installment'/);
  assert.match(price, /agreement\.activation_source = 'approved_credit_application'/);
  assert.match(price, /rows\.length !== 1/);
  assert.match(price, /if \(!reconciled\.consistent\)/);
  assert.match(price, /if \(!after\.consistent\)/);
  assert.match(price, /UPDATE equipment_installment_schedule/);
  assert.match(price, /UPDATE equipment_sale_agreements/);
  assert.doesNotMatch(price, /UPDATE equipment_sale_payments|DELETE FROM equipment_sale_payments|UPDATE equipment_finance_issued_documents/);
});

test("automated price reduction keeps paid installments and receipt allocations unchanged", () => {
  const original = [
    { id: 1, sequence_number: 1, scheduled_amount: 3000, amount_paid: 3000, schedule_status: "paid" },
    { id: 2, sequence_number: 2, scheduled_amount: 3000, amount_paid: 1000, schedule_status: "partial" },
    { id: 3, sequence_number: 3, scheduled_amount: 3000, amount_paid: 0, schedule_status: "upcoming" },
  ];
  const plan = planUnpaidScheduleVariation({ oldPrice: 12000, newPrice: 8500,
    depositRequired: 3000, paymentsReceived: 7000, schedule: original });
  assert.deepEqual(plan.schedule_updates.map(line => line.id), [2, 3]);
  assert.equal(original[0].scheduled_amount, 3000);
  assert.equal(original[0].amount_paid, 3000);
  assert.throws(() => planUnpaidScheduleVariation({ oldPrice: 12000, newPrice: 6500,
    depositRequired: 3000, paymentsReceived: 7000, schedule: original }), /cover all receipts/);
});
