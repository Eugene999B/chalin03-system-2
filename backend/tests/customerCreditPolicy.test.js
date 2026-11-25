"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { creditLimitPesewas, evaluateCredit, repaymentDueDate } = require("../services/customerCreditPolicy");

test("initial limit and maximum; strictly monotonic whole-score curve", () => {
  assert.equal(creditLimitPesewas(0), 0);
  assert.equal(creditLimitPesewas(30), 2_500_000);
  assert.equal(creditLimitPesewas(100), 20_000_000);
  for (let i = 1; i <= 100; i++) assert.ok(creditLimitPesewas(i) > creditLimitPesewas(i - 1));
});
test("existing balance and reservations reduce available credit", () => {
  const base = { outstandingPesewas: 2_000_000, reservedPesewas: 100_000 };
  assert.equal(evaluateCredit({...base, newCreditPesewas: 400_000}).decision, "within_limit");
  const over = evaluateCredit({...base, newCreditPesewas: 400_001});
  assert.equal(over.decision, "approval_required");
  assert.equal(over.availablePesewas, 400_000);
  assert.equal(over.overLimitPesewas, 1);
});
test("grandfathered over-limit customer can pay in full but not take new credit", () => {
  const base = { outstandingPesewas: 3_000_000, reservedPesewas: 0 };
  assert.equal(evaluateCredit({...base, newCreditPesewas: 0}).decision, "non_credit");
  assert.equal(evaluateCredit({...base, newCreditPesewas: 1}).decision, "approval_required");
});
test("invalid or missing amounts fail closed", () => {
  for (const amount of [-1, 1.5, NaN, Infinity, "100", undefined]) {
    assert.throws(() => evaluateCredit({outstandingPesewas: amount, reservedPesewas: 0, newCreditPesewas: 1}), RangeError);
  }
  assert.throws(() => creditLimitPesewas(101), RangeError);
  assert.throws(() => evaluateCredit({outstandingPesewas: Number.MAX_SAFE_INTEGER, reservedPesewas: 1, newCreditPesewas: 0}), RangeError);
});
test("calendar month clamping and configurable terms", () => {
  assert.equal(repaymentDueDate("2026-11-25"), "2026-12-25");
  assert.equal(repaymentDueDate("2026-01-31"), "2026-02-28");
  assert.equal(repaymentDueDate("2028-01-31"), "2028-02-29");
  assert.equal(repaymentDueDate("2026-12-31", 2), "2027-02-28");
  assert.throws(() => repaymentDueDate("2026-02-30"), RangeError);
  assert.throws(() => repaymentDueDate("2026-11-25", 0), RangeError);
});
