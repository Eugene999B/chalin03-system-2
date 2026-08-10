const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(backendDir, "package.json"), "utf8")
);
const source = fs.readFileSync(
  path.join(
    backendDir,
    "scripts",
    "runKwabenaProductQuantityCorrection20260806.js"
  ),
  "utf8"
);
const correction = require("../scripts/runKwabenaProductQuantityCorrection20260806");

const expected = [
  [313, "Bearing Case", "None", 8, 4],
  [263, "Small China Fan Belt", "None", 49, 13],
  [205, "Track Shoe Bolt", "All", 466, 152],
  [96, "Binding Wire", "Alovia", 1, 0],
  [218, "Grease Gun Mouth", "All", 32, 27],
  [200, "Hammer", "All", 2, 1],
  [32, "Air Cleaner", "Sany", 6, 0],
  [46, "70 Pin Medium", "All", 14, 12],
];

test("contains the exact eight exported Main Store IDs and requested quantities", () => {
  assert.equal(correction.SOURCE_EXPORT, "chalin03-main-products (5)(1).xlsx");
  assert.equal(correction.EXPORT_GENERATED_AT, "2026-08-04 22:57:50 UTC");
  assert.equal(correction.EXPECTED_CORRECTION_COUNT, 8);
  assert.deepEqual(
    correction.PRODUCT_CORRECTIONS.map((item) => [
      item.product_id,
      item.exported_name,
      item.exported_size,
      item.exported_quantity,
      item.quantity,
    ]),
    expected
  );
  assert.equal(
    correction.PRODUCT_CORRECTIONS.reduce(
      (sum, item) => sum + item.quantity - item.exported_quantity,
      0
    ),
    -369
  );
});

test("duplicate and shorthand names resolve only to reviewed active identities", () => {
  const fanBelt = correction.PRODUCT_CORRECTIONS.find(
    (item) => item.requested_name === "Small China fan belt"
  );
  const sanyCleaner = correction.PRODUCT_CORRECTIONS.find(
    (item) => item.requested_name === "Sany Air cleaner"
  );
  assert.equal(fanBelt.product_id, 263);
  assert.match(fanBelt.matching_note, /inactive duplicate product ID 252 was excluded/);
  assert.equal(sanyCleaner.product_id, 32);
  assert.equal(sanyCleaner.exported_name, "Air Cleaner");
  assert.equal(sanyCleaner.exported_size, "Sany");
});

test("all eight rows resolve only by ID, branch, active status, name and size", () => {
  const products = correction.PRODUCT_CORRECTIONS.map((item) => ({
    id: item.product_id,
    branch_id: 1,
    name: item.exported_name,
    size: item.exported_size,
    quantity: item.exported_quantity,
    cost_price: 10,
    selling_price: 20,
    barcode: null,
    is_active: 1,
  }));
  const resolved = correction.resolveExactCorrections(products);
  assert.equal(resolved.length, 8);
  assert.ok(
    resolved.every(
      (item) => item.match_method === "exact_product_id_and_exported_identity"
    )
  );

  assert.throws(
    () =>
      correction.resolveExactCorrections(
        products.map((item) =>
          item.id === 313 ? { ...item, name: "Another Bearing" } : item
        )
      ),
    /name changed/
  );
  assert.throws(
    () =>
      correction.resolveExactCorrections(
        products.map((item) =>
          item.id === 32 ? { ...item, size: "Liugong" } : item
        )
      ),
    /size changed/
  );
  assert.throws(
    () =>
      correction.resolveExactCorrections(
        products.map((item) =>
          item.id === 205 ? { ...item, branch_id: 2 } : item
        )
      ),
    /not branch 1/
  );
  assert.throws(
    () =>
      correction.resolveExactCorrections(
        products.map((item) =>
          item.id === 263 ? { ...item, is_active: 0 } : item
        )
      ),
    /not active/
  );
});

test("definition validation rejects missing, duplicate and invalid quantities", () => {
  assert.deepEqual(correction.validateCorrectionDefinitions(), [
    32, 46, 96, 200, 205, 218, 263, 313,
  ]);
  assert.throws(
    () =>
      correction.validateCorrectionDefinitions([
        ...correction.PRODUCT_CORRECTIONS.slice(0, 7),
      ]),
    /Expected exactly 8/
  );
  assert.throws(
    () =>
      correction.validateCorrectionDefinitions([
        ...correction.PRODUCT_CORRECTIONS.slice(0, 7),
        { ...correction.PRODUCT_CORRECTIONS[0] },
      ]),
    /Duplicate correction product ID/
  );
  assert.throws(
    () =>
      correction.validateCorrectionDefinitions(
        correction.PRODUCT_CORRECTIONS.map((item, index) =>
          index === 0 ? { ...item, quantity: -1 } : item
        )
      ),
    /Invalid target quantity/
  );
});

test("correction is production-only, one-time, locked, transactional and audited", () => {
  assert.equal(
    correction.CORRECTION_RECORD,
    "20260806_kwabena_main_store_quantity_correction"
  );
  assert.match(source, /NODE_ENV/);
  assert.match(source, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(source, /SELECT GET_LOCK/);
  assert.ok(correction.CORRECTION_LOCK.length <= 64);
  assert.match(source, /schema_migrations/);
  assert.match(source, /beginTransaction/);
  assert.match(source, /commit/);
  assert.match(source, /rollback/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /KWABENA_MAIN_STORE_QUANTITY_CORRECTION/);
  assert.match(source, /INSERT INTO stock_adjustments/);
  assert.match(source, /'physical_count'/);
});

test("only product quantity is updated and destructive or financial rewrites are absent", () => {
  const updates = [...source.matchAll(/UPDATE\s+([a-z_]+)/gi)].map(
    (match) => match[1].toLowerCase()
  );
  assert.deepEqual(updates, ["products"]);
  assert.match(source, /SET quantity = \?/);
  assert.doesNotMatch(
    source,
    /SET\s+(?:cost_price|selling_price|name|size|barcode|is_active)\s*=/i
  );
  assert.doesNotMatch(source, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(source, /\bTRUNCATE\b/i);
  assert.doesNotMatch(source, /\bDROP\s+(?:TABLE|DATABASE)\b/i);
  assert.doesNotMatch(
    source,
    /UPDATE\s+(?:sales|debts|debt_payments|purchases|returns|daily_closings)/i
  );
});

test("controlled maintenance runs the correction after prior stock counts and before customer repairs", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const previous = maintenance.indexOf(
    "runBossApprovedProductQuantityCorrection20260804.js"
  );
  const current = maintenance.indexOf(
    "runKwabenaProductQuantityCorrection20260806.js"
  );
  const next = maintenance.indexOf("runCustomerMergeAuditDateSanitizer20260805.js");
  assert.ok(previous >= 0 && current > previous && next > current);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
  assert.equal(
    packageJson.scripts["repair:kwabena-main-store-quantities:20260806:production"],
    "node scripts/runKwabenaProductQuantityCorrection20260806.js"
  );
});

test("adjustment direction stays truthful", () => {
  assert.equal(correction.adjustmentType(10, 4), "decrease");
  assert.equal(correction.adjustmentType(4, 10), "increase");
  assert.equal(correction.adjustmentType(4, 4), "set");
});
