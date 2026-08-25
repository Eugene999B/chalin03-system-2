const assert = require("assert");
const { calculateLateFee, lateFeeClause } = require("../services/equipmentFinanceLateFeePolicyService");

assert.strictEqual(
  calculateLateFee({ lateChargeType: "fixed", lateChargeValue: 250, lateChargeCap: 0, overdueAmount: 1000 }),
  250
);
assert.strictEqual(
  calculateLateFee({ lateChargeType: "percentage", lateChargeValue: 10, lateChargeCap: 50, overdueAmount: 1000 }),
  50
);
assert.strictEqual(
  calculateLateFee({ lateChargeType: "none", lateChargeValue: 10, lateChargeCap: 0, overdueAmount: 1000 }),
  0
);
assert.match(
  lateFeeClause({ lateChargeType: "fixed", lateChargeValue: 250, lateChargeCap: 500 }),
  /GHS 250\.00/,
);
assert.match(
  lateFeeClause({ lateChargeType: "percentage", lateChargeValue: 10, lateChargeCap: 500 }),
  /10%/,
);
console.log("Equipment Finance late-fee policy checks passed.");
