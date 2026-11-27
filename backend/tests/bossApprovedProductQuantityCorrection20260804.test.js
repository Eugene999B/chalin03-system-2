const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CORRECTION_RECORD,
  EXPECTED_CORRECTION_COUNT,
  EXPORT_GENERATED_AT,
  PRODUCT_CORRECTIONS,
  SOURCE_EXPORT,
  TARGET_BRANCH_ID,
  adjustmentType,
  normalizeIdentity,
  resolveExactCorrections,
  validateCorrectionDefinitions,
} = require("../scripts/runBossApprovedProductQuantityCorrection20260804");

const source = fs.readFileSync(
  path.resolve(
    __dirname,
    "../scripts/runBossApprovedProductQuantityCorrection20260804.js"
  ),
  "utf8"
);

test("the correction contains the exact 52 exported production IDs and boss quantities", () => {
  assert.equal(TARGET_BRANCH_ID, 1);
  assert.equal(EXPECTED_CORRECTION_COUNT, 52);
  assert.equal(PRODUCT_CORRECTIONS.length, 52);
  assert.equal(EXPORT_GENERATED_AT, "2026-08-04 06:40:42 UTC");
  assert.equal(SOURCE_EXPORT, "chalin03-main-products.xlsx");
  assert.deepEqual(
    Object.fromEntries(
      PRODUCT_CORRECTIONS.map((item) => [item.product_id, item.quantity])
    ),
    {
      141: 11,
      110: 6,
      105: 9,
      264: 12,
      106: 17,
      263: 51,
      104: 90,
      267: 0,
      250: 2,
      206: 65,
      62: 6,
      243: 22,
      276: 2,
      249: 6,
      16: 30,
      181: 0,
      117: 3,
      246: 4,
      55: 8,
      116: 6,
      200: 4,
      228: 19,
      37: 2,
      50: 2,
      51: 5,
      140: 20,
      30: 42,
      5: 24,
      13: 31,
      9: 32,
      4: 42,
      223: 32,
      101: 4,
      100: 27,
      46: 14,
      112: 4,
      269: 5,
      275: 15,
      185: 4,
      197: 5,
      191: 8,
      193: 9,
      175: 19,
      80: 0,
      78: 1,
      74: 3,
      240: 39,
      85: 8,
      82: 8,
      314: 4,
      38: 10,
      159: 8,
    }
  );
  assert.equal(new Set(PRODUCT_CORRECTIONS.map((item) => item.product_id)).size, 52);
});

test("the exported snapshot reconciles to 29 decreases, 5 increases and 18 unchanged quantities", () => {
  const changes = PRODUCT_CORRECTIONS.map(
    (item) => item.quantity - item.exported_quantity
  );
  assert.equal(changes.filter((value) => value < 0).length, 29);
  assert.equal(changes.filter((value) => value > 0).length, 5);
  assert.equal(changes.filter((value) => value === 0).length, 18);
  assert.equal(changes.reduce((sum, value) => sum + value, 0), -178);
});

test("duplicate and shorthand product names resolve to the intended active exported rows", () => {
  const byId = new Map(PRODUCT_CORRECTIONS.map((item) => [item.product_id, item]));

  assert.deepEqual(
    {
      id: byId.get(243).product_id,
      name: byId.get(243).exported_name,
      size: byId.get(243).exported_size,
      quantity: byId.get(243).quantity,
    },
    { id: 243, name: "80 bushing", size: "All", quantity: 22 }
  );
  assert.deepEqual(
    {
      id: byId.get(263).product_id,
      name: byId.get(263).exported_name,
      size: byId.get(263).exported_size,
      quantity: byId.get(263).quantity,
    },
    { id: 263, name: "Small China Fan Belt", size: "None", quantity: 51 }
  );
  assert.deepEqual(
    {
      id: byId.get(246).product_id,
      name: byId.get(246).exported_name,
      size: byId.get(246).exported_size,
      quantity: byId.get(246).quantity,
    },
    { id: 246, name: "Fan Pulley Cap", size: "All", quantity: 4 }
  );
  assert.deepEqual(
    {
      id: byId.get(185).product_id,
      name: byId.get(185).exported_name,
      size: byId.get(185).exported_size,
      quantity: byId.get(185).quantity,
    },
    { id: 185, name: "Spanner 27", size: "All", quantity: 4 }
  );
  assert.deepEqual(
    {
      id: byId.get(37).product_id,
      name: byId.get(37).exported_name,
      size: byId.get(37).exported_size,
      quantity: byId.get(37).quantity,
    },
    { id: 37, name: "Gear Lever", size: "Sany", quantity: 2 }
  );
  assert.deepEqual(
    {
      id: byId.get(264).product_id,
      name: byId.get(264).exported_name,
      size: byId.get(264).exported_size,
      quantity: byId.get(264).quantity,
    },
    { id: 264, name: "Water Engine Fan Belt", size: "None", quantity: 12 }
  );
});

test("identity verification ignores capitalization and punctuation but not another exported row", () => {
  assert.equal(normalizeIdentity("T pipe With Ring"), "t pipe with ring");
  assert.equal(normalizeIdentity("T-pipe with ring"), "t pipe with ring");
  assert.notEqual(
    normalizeIdentity("Gear Lever Sany"),
    normalizeIdentity("Gear Lever XCM")
  );
});

test("all 52 exported rows resolve only by exact product ID, branch, active status, name and size", () => {
  const rows = PRODUCT_CORRECTIONS.map((item) => ({
    id: item.product_id,
    branch_id: 1,
    name: item.exported_name,
    size: item.exported_size,
    quantity: item.exported_quantity,
    cost_price: 10,
    is_active: 1,
  }));

  const resolved = resolveExactCorrections(rows);
  assert.equal(resolved.length, 52);
  assert.deepEqual(
    resolved.map((item) => item.product.id),
    PRODUCT_CORRECTIONS.map((item) => item.product_id)
  );
  assert.ok(
    resolved.every(
      (item) => item.match_method === "exact_product_id_and_exported_identity"
    )
  );
});

test("a missing exported product ID aborts the whole correction", () => {
  const rows = PRODUCT_CORRECTIONS.slice(1).map((item) => ({
    id: item.product_id,
    branch_id: 1,
    name: item.exported_name,
    size: item.exported_size,
    quantity: item.exported_quantity,
    cost_price: 1,
    is_active: 1,
  }));
  assert.throws(() => resolveExactCorrections(rows), /product IDs are missing: 141/);
});

test("changed name, changed size, wrong branch, or inactive status fails closed", () => {
  const baseRows = PRODUCT_CORRECTIONS.map((item) => ({
    id: item.product_id,
    branch_id: 1,
    name: item.exported_name,
    size: item.exported_size,
    quantity: item.exported_quantity,
    cost_price: 1,
    is_active: 1,
  }));

  const wrongName = baseRows.map((row) => ({ ...row }));
  wrongName[0].name = "Different T Pipe";
  assert.throws(() => resolveExactCorrections(wrongName), /name changed/);

  const wrongSize = baseRows.map((row) => ({ ...row }));
  wrongSize.find((row) => row.id === 37).size = "XCM";
  assert.throws(() => resolveExactCorrections(wrongSize), /size changed/);

  const wrongBranch = baseRows.map((row) => ({ ...row }));
  wrongBranch[0].branch_id = 2;
  assert.throws(() => resolveExactCorrections(wrongBranch), /not branch 1/);

  const inactive = baseRows.map((row) => ({ ...row }));
  inactive[0].is_active = 0;
  assert.throws(() => resolveExactCorrections(inactive), /not active/);
});

test("definition validation rejects duplicate IDs and invalid target or exported quantities", () => {
  assert.equal(validateCorrectionDefinitions().length, 52);

  const duplicate = PRODUCT_CORRECTIONS.map((item) => ({ ...item }));
  duplicate[1].product_id = duplicate[0].product_id;
  assert.throws(() => validateCorrectionDefinitions(duplicate), /Duplicate correction/);

  const invalidTarget = PRODUCT_CORRECTIONS.map((item) => ({ ...item }));
  invalidTarget[0].quantity = -1;
  assert.throws(() => validateCorrectionDefinitions(invalidTarget), /Invalid quantity/);

  const invalidExport = PRODUCT_CORRECTIONS.map((item) => ({ ...item }));
  invalidExport[0].exported_quantity = -1;
  assert.throws(
    () => validateCorrectionDefinitions(invalidExport),
    /Invalid exported quantity/
  );
});

test("adjustment direction is recorded correctly", () => {
  assert.equal(adjustmentType(10, 20), "increase");
  assert.equal(adjustmentType(20, 10), "decrease");
  assert.equal(adjustmentType(10, 10), "set");
});

test("the production correction is atomic, one-time, ID-locked and fully audited", () => {
  assert.equal(
    CORRECTION_RECORD,
    "20260804_boss_approved_product_quantity_correction"
  );
  assert.match(source, /SELECT GET_LOCK\(\?, 30\) AS acquired/);
  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /WHERE id IN \(\$\{placeholders\}\)/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /exact_product_id_and_exported_identity/);
  assert.match(source, /UPDATE products/);
  assert.match(source, /verifyUpdatedQuantity/);
  assert.match(source, /INSERT INTO stock_adjustments/);
  assert.match(source, /movement_type,[\s\S]*'physical_count'/);
  assert.match(source, /BOSS_APPROVED_STOCK_COUNT_CORRECTION/);
  assert.match(source, /INSERT INTO schema_migrations/);
  assert.match(source, /commit\(\)/);
  assert.match(source, /rollback\(\)/);
  assert.match(source, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(source, /already applied/);
  assert.match(source, /source_export: SOURCE_EXPORT/);
  assert.doesNotMatch(source, /MIN_MATCH_SCORE|MIN_MATCH_MARGIN/);
  assert.doesNotMatch(source, /DELETE\s+FROM/i);
  assert.doesNotMatch(source, /TRUNCATE/i);
  assert.doesNotMatch(source, /DROP\s+(TABLE|DATABASE)/i);
});
