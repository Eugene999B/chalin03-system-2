const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const serviceSource = read("services/inventoryReturnTraceabilityService.js");
const validatorSource = read("validation/financialRequestValidators.js");
const saleCatalogueSource = read("routes/inventorySaleCatalogueRoutes.js");

const {
  lockReturnUnitSelection,
  normalizeReturnUnitSelection,
  returnUnitIdsRequired,
} = require("../services/inventoryReturnTraceabilityService");
const {
  normalizeReturnUnitIds,
  validateReturnCreateRequest,
} = require("../validation/financialRequestValidators");

test("ordinary returns preserve their legacy sanitized request when no physical IDs are supplied", () => {
  const result = validateReturnCreateRequest({
    body: {
      sale_id: 10,
      product_id: 20,
      quantity: 1,
      reason: "Customer returned unopened item",
      return_type: "stock_only",
      refund_amount: 0,
      refund_method: "none",
      refund_reference: "",
      approver_username: "",
      approver_password: "",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.value.body, "unit_ids"), false);
});

test("explicit serialized return IDs must be valid, unique and exactly match return quantity", () => {
  assert.match(validatorSource, /normalizeReturnUnitIds/);
  assert.deepEqual(normalizeReturnUnitIds(["so4l-k7m4q9xd"], 1), {
    ok: true,
    unit_ids: ["SO4L-K7M4Q9XD"],
    errors: [],
  });
  const duplicate = normalizeReturnUnitIds(
    ["SO4L-K7M4Q9XD", "so4l-k7m4q9xd"],
    2
  );
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors[0].code, "DUPLICATE_RETURN_INVENTORY_UNIT_ID");
  const wrongCount = normalizeReturnUnitIds(["SO4L-K7M4Q9XD"], 2);
  assert.equal(wrongCount.ok, false);
  assert.equal(wrongCount.errors[0].code, "RETURN_INVENTORY_UNIT_COUNT_MISMATCH");
});

test("only enforced serialized products require exact return identities", () => {
  assert.equal(
    returnUnitIdsRequired({
      inventory_tracking_mode: "serialized",
      inventory_traceability_state: "enforced",
    }),
    true
  );
  assert.equal(
    returnUnitIdsRequired({
      inventory_tracking_mode: "serialized",
      inventory_traceability_state: "setup",
    }),
    false
  );
  assert.equal(
    returnUnitIdsRequired({
      inventory_tracking_mode: "quantity",
      inventory_traceability_state: "off",
    }),
    false
  );
});

test("serialized return lock requires sold units from the same sale product and store", async () => {
  const connection = {
    async query(sql, params) {
      assert.match(sql, /FROM inventory_units/);
      assert.match(sql, /FOR UPDATE/);
      assert.deepEqual(params, ["SO4L-K7M4Q9XD"]);
      return [[{
        id: 71,
        unit_code: "SO4L-K7M4Q9XD",
        product_id: 44,
        current_branch_id: 1,
        status: "sold",
        sale_id: 900,
        sale_item_id: 901,
        return_id: null,
      }]];
    },
  };

  const result = await lockReturnUnitSelection(connection, {
    branchId: 1,
    saleId: 900,
    product: {
      id: 44,
      name: "Star Oil 4L",
      inventory_tracking_mode: "serialized",
      inventory_traceability_state: "enforced",
    },
    quantity: 1,
    unitCodes: ["SO4L-K7M4Q9XD"],
  });
  assert.equal(result.required, true);
  assert.deepEqual(result.unit_codes, ["SO4L-K7M4Q9XD"]);
  assert.equal(result.units[0].sale_item_id, 901);
});

test("wrong-sale and already-returned identities are rejected before return commit", async () => {
  const baseProduct = {
    id: 44,
    name: "Star Oil 4L",
    inventory_tracking_mode: "serialized",
    inventory_traceability_state: "enforced",
  };

  await assert.rejects(
    lockReturnUnitSelection(
      {
        async query() {
          return [[{
            id: 71,
            unit_code: "SO4L-K7M4Q9XD",
            product_id: 44,
            current_branch_id: 1,
            status: "sold",
            sale_id: 899,
            sale_item_id: 901,
            return_id: null,
          }]];
        },
      },
      {
        branchId: 1,
        saleId: 900,
        product: baseProduct,
        quantity: 1,
        unitCodes: ["SO4L-K7M4Q9XD"],
      }
    ),
    (error) => error.code === "TRACEABILITY_RETURN_UNIT_WRONG_SALE"
  );

  await assert.rejects(
    lockReturnUnitSelection(
      {
        async query() {
          return [[{
            id: 71,
            unit_code: "SO4L-K7M4Q9XD",
            product_id: 44,
            current_branch_id: 1,
            status: "returned_quarantine",
            sale_id: 900,
            sale_item_id: 901,
            return_id: 902,
          }]];
        },
      },
      {
        branchId: 1,
        saleId: 900,
        product: baseProduct,
        quantity: 1,
        unitCodes: ["SO4L-K7M4Q9XD"],
      }
    ),
    (error) => error.code === "TRACEABILITY_RETURN_UNIT_ALREADY_RETURNED"
  );
});

test("return commit moves sold identities to returned quarantine with append-only evidence", () => {
  assert.match(serviceSource, /RETURNED_QUARANTINE/);
  assert.match(serviceSource, /return_received_quarantine/);
  assert.match(serviceSource, /appendUnitEvent/);
  assert.match(serviceSource, /return_id = \?/);
  assert.match(serviceSource, /TRACEABILITY_RETURN_UNIT_COMMIT_CONFLICT/);
});

test("enforced serialized checkout availability counts active IDs, not quarantine or damaged inventory", () => {
  assert.match(saleCatalogueSource, /u\.status = 'active'/);
  assert.match(saleCatalogueSource, /p\.quantity AS system_quantity/);
  assert.match(saleCatalogueSource, /returned_quarantine_is_not_sellable: true/);
});

test("unit code selection itself normalizes case and rejects duplicates", () => {
  assert.deepEqual(normalizeReturnUnitSelection(["so4l-k7m4q9xd"]), ["SO4L-K7M4Q9XD"]);
  assert.throws(
    () => normalizeReturnUnitSelection(["SO4L-K7M4Q9XD", "so4l-k7m4q9xd"]),
    (error) => error.code === "TRACEABILITY_DUPLICATE_RETURN_UNIT"
  );
});
