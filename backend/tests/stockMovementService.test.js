const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MOVEMENT_TYPES,
  calculateStockAfter,
  movementLabel,
  validateMovementCompatibility,
} = require("../services/stockMovementService");

test("stock movement calculations never allow negative stock", () => {
  assert.equal(
    calculateStockAfter({ currentQuantity: 10, adjustmentType: "increase", quantity: 5 }),
    15
  );
  assert.equal(
    calculateStockAfter({ currentQuantity: 10, adjustmentType: "decrease", quantity: 4 }),
    6
  );
  assert.equal(
    calculateStockAfter({ currentQuantity: 10, adjustmentType: "set", quantity: 2 }),
    2
  );
  assert.throws(
    () =>
      calculateStockAfter({
        currentQuantity: 2,
        adjustmentType: "decrease",
        quantity: 3,
      }),
    /less than zero/
  );
});

test("restock is distinct from correction categories", () => {
  assert.equal(movementLabel(MOVEMENT_TYPES.QUICK_RESTOCK), "Quick Restock");
  assert.equal(
    validateMovementCompatibility("decrease", MOVEMENT_TYPES.DAMAGED),
    MOVEMENT_TYPES.DAMAGED
  );
  assert.throws(
    () => validateMovementCompatibility("increase", MOVEMENT_TYPES.QUICK_RESTOCK),
    /not valid/
  );
});
