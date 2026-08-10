const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const validatorSource = read("validation/financialRequestValidators.js");
const saleRouteSource = read("routes/saleRoutes.js");
const serviceSource = read("services/inventorySaleTraceabilityService.js");

const {
  lockSaleUnitSelection,
  normalizeUnitSelection,
} = require("../services/inventorySaleTraceabilityService");

test("sale request validator accepts only normalized physical unit ID arrays", () => {
  assert.match(validatorSource, /INVENTORY_UNIT_CODE_PATTERN/);
  assert.match(validatorSource, /"unit_ids"/);
  assert.match(validatorSource, /unit_ids: unitIds/);
  assert.match(validatorSource, /DUPLICATE_INVENTORY_UNIT_ID/);
  assert.match(validatorSource, /INVALID_INVENTORY_UNIT_ID/);
});

test("sale transaction imports traceability locks and commits exact units with sale item IDs", () => {
  assert.match(saleRouteSource, /inventorySaleTraceabilityService/);
  assert.match(saleRouteSource, /lockSaleTraceabilitySelections/);
  assert.match(saleRouteSource, /markSaleUnitsSold/);
  assert.match(saleRouteSource, /inventory_tracking_mode/);
  assert.match(saleRouteSource, /inventory_traceability_state/);
  assert.match(saleRouteSource, /const \[saleItemResult\] = await connection\.query/);
  assert.match(saleRouteSource, /saleItemId: saleItemResult\.insertId/);
  assert.match(saleRouteSource, /await connection\.commit\(\)/);
});

test("serialized enforcement requires exact active unit identities", () => {
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_COUNT_MISMATCH/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_NOT_FOUND/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_WRONG_PRODUCT/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_WRONG_STORE/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_NOT_ACTIVE/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_ALREADY_SOLD/);
  assert.match(serviceSource, /FOR UPDATE/);
});

test("unit selection normalizes case and rejects duplicates", () => {
  assert.deepEqual(normalizeUnitSelection(["so4l-k7m4q9xd"]), ["SO4L-K7M4Q9XD"]);
  assert.throws(
    () => normalizeUnitSelection(["SO4L-K7M4Q9XD", "so4l-k7m4q9xd"]),
    (error) => error.code === "TRACEABILITY_DUPLICATE_UNIT_IN_ITEM"
  );
});

test("enforced product lock accepts only same-product active units in the same store", async () => {
  const connection = {
    async query(sql, params) {
      assert.match(sql, /FROM inventory_units/);
      assert.match(sql, /FOR UPDATE/);
      assert.deepEqual(params, ["SO4L-K7M4Q9XD"]);
      return [[{
        id: 21,
        unit_code: "SO4L-K7M4Q9XD",
        product_id: 44,
        current_branch_id: 1,
        status: "active",
        sale_id: null,
        sale_item_id: null,
        product_name: "Star Oil 4L",
      }]];
    },
  };

  const selection = await lockSaleUnitSelection(connection, {
    branchId: 1,
    product: {
      id: 44,
      name: "Star Oil 4L",
      inventory_tracking_mode: "serialized",
      inventory_traceability_state: "enforced",
    },
    quantity: 1,
    unitCodes: ["SO4L-K7M4Q9XD"],
  });

  assert.equal(selection.required, true);
  assert.deepEqual(selection.unit_codes, ["SO4L-K7M4Q9XD"]);
  assert.equal(selection.units[0].id, 21);
});

test("enforced product refuses a missing physical unit selection before any database lookup", async () => {
  const connection = {
    async query() {
      throw new Error("query should not run");
    },
  };

  await assert.rejects(
    lockSaleUnitSelection(connection, {
      branchId: 1,
      product: {
        id: 44,
        name: "Star Oil 4L",
        inventory_tracking_mode: "serialized",
        inventory_traceability_state: "enforced",
      },
      quantity: 2,
      unitCodes: ["SO4L-K7M4Q9XD"],
    }),
    (error) => error.code === "TRACEABILITY_SALE_UNIT_COUNT_MISMATCH"
  );
});
