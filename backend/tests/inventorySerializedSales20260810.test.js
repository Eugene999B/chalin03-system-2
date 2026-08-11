const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const serviceSource = read("services/inventorySaleTraceabilityService.js");
const validatorSource = read("validation/financialRequestValidators.js");
const productRouterSource = read("routes/productRoutes.js");
const productListSource = read("routes/productInventoryListRoutes.js");

const {
  lockSaleUnitSelection,
  normalizeUnitSelection,
} = require("../services/inventorySaleTraceabilityService");
const {
  normalizeUnitIds,
} = require("../validation/financialRequestValidators");

test("serialized checkout transaction engine exists without claiming legacy sale-route integration yet", () => {
  assert.match(serviceSource, /lockSaleTraceabilitySelections/);
  assert.match(serviceSource, /markSaleUnitsSold/);
  assert.match(serviceSource, /sale_item_id/);
  assert.match(serviceSource, /sale_completed/);
  assert.match(serviceSource, /FOR UPDATE/);
});

test("sale request validation accepts normalized optional physical unit IDs without replacing legacy financial validation", () => {
  assert.match(validatorSource, /financialRequestValidatorsCore/);
  assert.match(validatorSource, /INVENTORY_UNIT_CODE_PATTERN/);
  assert.match(validatorSource, /unit_ids/);
  const normalized = normalizeUnitIds(["so4l-k7m4q9xd"], { itemIndex: 0, quantity: 1 });
  assert.deepEqual(normalized, {
    ok: true,
    unit_ids: ["SO4L-K7M4Q9XD"],
    errors: [],
  });
  const duplicate = normalizeUnitIds(
    ["SO4L-K7M4Q9XD", "so4l-k7m4q9xd"],
    { itemIndex: 0, quantity: 2 }
  );
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors[0].code, "DUPLICATE_INVENTORY_UNIT_ID");
  const tooMany = normalizeUnitIds(["SO4L-K7M4Q9XD"], { itemIndex: 0, quantity: 0 });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.errors[0].code, "INVENTORY_UNIT_COUNT_EXCEEDS_QUANTITY");
});

test("ordinary product catalogue exposes server tracking policy while preserving the legacy product router", () => {
  assert.match(productRouterSource, /productInventoryListRoutes/);
  assert.match(productRouterSource, /productCoreRoutes/);
  assert.match(productListSource, /inventory_tracking_mode/);
  assert.match(productListSource, /inventory_product_code/);
  assert.match(productListSource, /inventory_risk_tier/);
  assert.match(productListSource, /inventory_traceability_state/);
  assert.match(productListSource, /serialized_checkout_requires_unit_ids_only_when_enforced/);
});

test("serialized enforcement requires exact active unit identities", () => {
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_COUNT_MISMATCH/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_NOT_FOUND/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_WRONG_PRODUCT/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_WRONG_STORE/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_NOT_ACTIVE/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_ALREADY_SOLD/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_COMMIT_CONFLICT/);
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
