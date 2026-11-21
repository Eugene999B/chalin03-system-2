const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TEMPORARY_FINANCE_MACHINE_CORRECTIONS_ENABLED,
  getFinanceMachineEditability,
} = require("../services/equipmentFinanceTemporaryMachineEditPolicy");

test("temporary corrections are explicitly reversible", () => {
  assert.equal(TEMPORARY_FINANCE_MACHINE_CORRECTIONS_ENABLED, true);
});

test("unlinked and available machines retain normal editing", () => {
  assert.deepEqual(getFinanceMachineEditability({ sale_status: "available" }), {
    editable: true,
    temporary_correction: false,
  });
});

test("linked in-progress machines enter supervised correction mode", () => {
  for (const machine of [
    { sale_status: "available", active_application_count: 1 },
    { sale_status: "reserved", active_sale_lock_count: 1 },
    { sale_status: "installment_active", active_agreement_count: 1 },
  ]) {
    assert.deepEqual(getFinanceMachineEditability(machine), {
      editable: true,
      temporary_correction: true,
    });
  }
});

test("sold/cancelled, hire-active and unlinked reserved machines remain locked", () => {
  for (const machine of [
    { sale_status: "sold", active_agreement_count: 1 },
    { sale_status: "cancelled", active_sale_lock_count: 1 },
    { sale_status: "available", active_hire_count: 1 },
    { sale_status: "reserved" },
    { sale_status: "installment_active" },
  ]) {
    assert.equal(getFinanceMachineEditability(machine).editable, false);
  }
});
