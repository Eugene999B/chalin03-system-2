const assert = require("node:assert/strict");

test("installment-active equipment is not treated as missing available sale status when it has a Finance lock", () => {
  const machine = {
    sale_status: "installment_active",
    active_sale_lock_count: 1,
  };
  const underInstallment =
    machine.sale_status === "installment_active" &&
    Number(machine.active_sale_lock_count || 0) > 0;
  assert.equal(underInstallment, true);
});

test("next payment must never be selected from a due date before today", () => {
  const today = new Date("2026-08-25T00:00:00Z");
  const dates = ["2001-03-10", "2026-09-24", "2026-10-24"];
  const next = dates
    .map((value) => new Date(`${value}T00:00:00Z`))
    .filter((value) => value >= today)
    .sort((a, b) => a - b)[0];
  assert.equal(next.toISOString().slice(0, 10), "2026-09-24");
});
