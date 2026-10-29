const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CORRECTION_RECORD,
  EXPORT_GENERATED_AT,
  PRODUCT_CORRECTIONS,
  TARGET_BRANCH_ID,
  adjustmentType,
  normalizeIdentity,
  resolveExactCorrections,
  validateCorrectionDefinitions,
} = require("../scripts/runBossApprovedProductQuantityCorrection20260802");

const source = fs.readFileSync(
  path.resolve(
    __dirname,
    "../scripts/runBossApprovedProductQuantityCorrection20260802.js"
  ),
  "utf8"
);

test("the correction contains the exact 24 exported production IDs and requested quantities", () => {
  assert.equal(TARGET_BRANCH_ID, 1);
  assert.equal(PRODUCT_CORRECTIONS.length, 24);
  assert.equal(EXPORT_GENERATED_AT, "2026-08-02 09:07:30 UTC");
  assert.deepEqual(
    Object.fromEntries(
      PRODUCT_CORRECTIONS.map((item) => [item.product_id, item.quantity])
    ),
    {
      106: 17,
      206: 73,
      243: 22,
      249: 6,
      16: 30,
      181: 0,
      253: 0,
      246: 4,
      23: 21,
      21: 61,
      20: 30,
      55: 8,
      200: 4,
      37: 2,
      50: 2,
      27: 9,
      30: 42,
      13: 31,
      5: 24,
      4: 42,
      46: 14,
      275: 15,
      38: 10,
      159: 8,
    }
  );
  assert.equal(new Set(PRODUCT_CORRECTIONS.map((item) => item.product_id)).size, 24);
});

test("the exported identities distinguish duplicate names and inactive alternatives", () => {
  const byId = new Map(PRODUCT_CORRECTIONS.map((item) => [item.product_id, item]));
  assert.deepEqual(
    {
      id: byId.get(243).product_id,
      name: byId.get(243).exported_name,
      size: byId.get(243).exported_size,
    },
    { id: 243, name: "80 bushing", size: "All" }
  );
  assert.deepEqual(
    {
      id: byId.get(246).product_id,
      name: byId.get(246).exported_name,
      size: byId.get(246).exported_size,
    },
    { id: 246, name: "Fan Pulley Cap", size: "All" }
  );
  assert.deepEqual(
    {
      id: byId.get(55).product_id,
      name: byId.get(55).exported_name,
      size: byId.get(55).exported_size,
    },
    { id: 55, name: "Pilot Filter", size: "Liugong" }
  );
  assert.deepEqual(
    {
      id: byId.get(37).product_id,
      name: byId.get(37).exported_name,
      size: byId.get(37).exported_size,
    },
    { id: 37, name: "Gear Lever", size: "Sany" }
  );
});

test("identity verification ignores capitalization and punctuation but not the actual exported row", () => {
  assert.equal(normalizeIdentity("Fuel Filter (FF5544)"), "fuel filter ff5544");
  assert.equal(normalizeIdentity("fuel-filter FF5544"), "fuel filter ff5544");
  assert.notEqual(normalizeIdentity("Pilot Filter JCB"), normalizeIdentity("Pilot Filter Liugong"));
});

test("all 24 exported rows resolve only by their exact product IDs", () => {
  const rows = PRODUCT_CORRECTIONS.map((item) => ({
    id: item.product_id,
    branch_id: 1,
    name: item.exported_name,
    size: item.exported_size,
    quantity: 999,
    cost_price: 10,
    is_active: 1,
  }));

  const resolved = resolveExactCorrections(rows);
  assert.equal(resolved.length, 24);
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
    quantity: 1,
    cost_price: 1,
    is_active: 1,
  }));
  assert.throws(() => resolveExactCorrections(rows), /product IDs are missing: 106/);
});

test("changed name, changed size, wrong branch, or inactive status fails closed", () => {
  const baseRows = PRODUCT_CORRECTIONS.map((item) => ({
    id: item.product_id,
    branch_id: 1,
    name: item.exported_name,
    size: item.exported_size,
    quantity: 1,
    cost_price: 1,
    is_active: 1,
  }));

  const wrongName = baseRows.map((row) => ({ ...row }));
  wrongName[0].name = "Fan Belt 1400 Box";
  assert.throws(() => resolveExactCorrections(wrongName), /name changed/);

  const wrongSize = baseRows.map((row) => ({ ...row }));
  wrongSize.find((row) => row.id === 55).size = "JCB";
  assert.throws(() => resolveExactCorrections(wrongSize), /size changed/);

  const wrongBranch = baseRows.map((row) => ({ ...row }));
  wrongBranch[0].branch_id = 2;
  assert.throws(() => resolveExactCorrections(wrongBranch), /not branch 1/);

  const inactive = baseRows.map((row) => ({ ...row }));
  inactive[0].is_active = 0;
  assert.throws(() => resolveExactCorrections(inactive), /not active/);
});

test("definition validation rejects duplicate IDs and invalid quantities", () => {
  assert.equal(validateCorrectionDefinitions().length, 24);

  const duplicate = PRODUCT_CORRECTIONS.map((item) => ({ ...item }));
  duplicate[1].product_id = duplicate[0].product_id;
  assert.throws(() => validateCorrectionDefinitions(duplicate), /Duplicate correction/);

  const invalid = PRODUCT_CORRECTIONS.map((item) => ({ ...item }));
  invalid[0].quantity = -1;
  assert.throws(() => validateCorrectionDefinitions(invalid), /Invalid quantity/);
});

test("adjustment direction is recorded correctly", () => {
  assert.equal(adjustmentType(10, 20), "increase");
  assert.equal(adjustmentType(20, 10), "decrease");
  assert.equal(adjustmentType(10, 10), "set");
});

test("the production correction is atomic, one-time, ID-locked and fully audited", () => {
  assert.equal(
    CORRECTION_RECORD,
    "20260802_boss_approved_product_quantity_correction"
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
  assert.doesNotMatch(source, /MIN_MATCH_SCORE|MIN_MATCH_MARGIN/);
  assert.doesNotMatch(source, /DELETE\s+FROM/i);
  assert.doesNotMatch(source, /TRUNCATE/i);
  assert.doesNotMatch(source, /DROP\s+(TABLE|DATABASE)/i);
});
