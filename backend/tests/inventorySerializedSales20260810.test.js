const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const serviceSource = read("services/inventorySaleTraceabilityService.js");
const saleRouteSource = read("routes/saleRoutes.js");
const validatorSource = read("validation/financialRequestValidators.js");
const productRouterSource = read("routes/productRoutes.js");
const saleCatalogueSource = read("routes/inventorySaleCatalogueRoutes.js");
const saleScanSource = read("routes/inventorySaleScanRoutes.js");
const traceabilityRouterSource = read("routes/inventoryTraceabilityRoutes.js");

const {
  lockSaleUnitSelection,
  normalizeUnitSelection,
} = require("../services/inventorySaleTraceabilityService");
const {
  normalizeUnitIds,
  validateSaleCreateRequest,
} = require("../validation/financialRequestValidators");

test("serialized checkout engine is wired into the existing atomic sale transaction", () => {
  assert.match(saleRouteSource, /inventorySaleTraceabilityService/);
  assert.match(saleRouteSource, /lockSaleTraceabilitySelections/);
  assert.match(saleRouteSource, /markSaleUnitsSold/);
  assert.match(saleRouteSource, /inventory_tracking_mode/);
  assert.match(saleRouteSource, /inventory_traceability_state/);
  assert.match(
    saleRouteSource,
    /const saleTraceabilitySelections = await lockSaleTraceabilitySelections\(connection, \{[\s\S]*branchId,[\s\S]*saleItems,[\s\S]*\}\);/
  );
  assert.match(saleRouteSource, /const \[saleItemResult\] = await connection\.query/);
  assert.match(saleRouteSource, /saleItemId: saleItemResult\.insertId/);
  assert.match(saleRouteSource, /saleItem\.unit_ids = soldUnits\.map/);
  assert.match(saleRouteSource, /await connection\.commit\(\)/);
});

test("serialized checkout transaction engine locks and commits exact physical identities", () => {
  assert.match(serviceSource, /lockSaleTraceabilitySelections/);
  assert.match(serviceSource, /markSaleUnitsSold/);
  assert.match(serviceSource, /sale_item_id/);
  assert.match(serviceSource, /sale_completed/);
  assert.match(serviceSource, /FOR UPDATE/);
  assert.match(serviceSource, /TRACEABILITY_SALE_UNIT_COMMIT_CONFLICT/);
});

test("sale request validation extends physical unit IDs without changing ordinary sanitized sales", () => {
  assert.match(validatorSource, /financialRequestValidatorsCore/);
  assert.match(validatorSource, /INVENTORY_UNIT_CODE_PATTERN/);
  assert.match(validatorSource, /unit_ids/);

  const ordinary = validateSaleCreateRequest({
    body: {
      customer_name: "Walk In",
      customer_phone: "",
      customer_location: "",
      payment_type: "cash",
      amount_tendered: "20.00",
      amount_paid: "20.00",
      discount_amount: "0",
      payment_allocations: {},
      installment_plan: null,
      items: [{ product_id: 7, quantity: 1 }],
    },
  });
  assert.equal(ordinary.ok, true);
  assert.deepEqual(ordinary.value.body.items, [{ product_id: 7, quantity: 1 }]);

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
});

test("legacy product router remains in its established source location and sale catalogue adds tracking policy separately", () => {
  assert.match(productRouterSource, /validateRequest\(validateStockAdjustmentRequest\)/);
  assert.match(productRouterSource, /STOCK_CHANGE_REQUIRES_MOVEMENT/);
  assert.match(saleCatalogueSource, /inventory_tracking_mode/);
  assert.match(saleCatalogueSource, /inventory_product_code/);
  assert.match(saleCatalogueSource, /inventory_risk_tier/);
  assert.match(saleCatalogueSource, /inventory_traceability_state/);
  assert.match(saleCatalogueSource, /final_unit_validation_inside_sale_transaction/);
  assert.match(traceabilityRouterSource, /router\.use\("\/sale-products", inventorySaleCatalogueRoutes\)/);
});

test("cashier sale scanner exposes only minimal sale eligibility, not forensic unit history", () => {
  assert.match(saleScanSource, /requireRole\("admin", "manager", "cashier"\)/);
  assert.match(saleScanSource, /same_store/);
  assert.match(saleScanSource, /already_sold/);
  assert.match(saleScanSource, /cashier_forensic_history_exposed: false/);
  assert.doesNotMatch(saleScanSource, /inventory_unit_events/);
  assert.match(traceabilityRouterSource, /router\.use\("\/sale-scan", inventorySaleScanRoutes\)/);
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
