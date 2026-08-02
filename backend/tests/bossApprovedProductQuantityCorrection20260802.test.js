const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CORRECTION_RECORD,
  PRODUCT_CORRECTIONS,
  TARGET_BRANCH_ID,
  adjustmentType,
  chooseUniqueProduct,
  normalizeProductName,
  resolveCorrections,
  scoreName,
} = require("../scripts/runBossApprovedProductQuantityCorrection20260802");

const source = fs.readFileSync(
  path.resolve(
    __dirname,
    "../scripts/runBossApprovedProductQuantityCorrection20260802.js"
  ),
  "utf8"
);

test("the boss-approved correction contains exactly the requested 20 quantities", () => {
  assert.equal(TARGET_BRANCH_ID, 1);
  assert.equal(PRODUCT_CORRECTIONS.length, 20);
  assert.deepEqual(
    Object.fromEntries(
      PRODUCT_CORRECTIONS.map((item) => [item.label, item.quantity])
    ),
    {
      "Fan belt box 1360": 17,
      "Locker bolt": 73,
      "80 Bushing": 22,
      "Key nob Liugong": 6,
      "Coolant No:1": 30,
      Cutter: 0,
      "Cylinder engine 6": 0,
      "Fan pulley cap": 4,
      "Water separator Sany/Liugong/JCB": 21,
      "Fuel filter (FF5544)": 61,
      "Oil filter (LF3349)": 30,
      "Pilot filter Liugong": 8,
      Hammer: 4,
      "Gear lever Sany": 2,
      "Key nob JCB": 2,
      "Torch light": 9,
      Grease: 42,
      "GTT oil 1L": 31,
      "Sinopec gear oil": 24,
      "Sinopec Hydraulic Oil": 42,
    }
  );
});

test("normalization ignores capitalization, punctuation, spacing and word order", () => {
  assert.equal(
    normalizeProductName("Water Separator: JCB / SANY / LiuGong"),
    normalizeProductName("water separator sany liugong jcb")
  );
  assert.equal(
    normalizeProductName("FF-5544 Fuel Filter"),
    normalizeProductName("Fuel filter (FF5544)")
  );
  assert.equal(
    normalizeProductName("G.T.T. Oil 1 Litre"),
    normalizeProductName("GTT oil 1L")
  );
  assert.equal(
    normalizeProductName("Liugong KEY KNOB"),
    normalizeProductName("Key nob Liugong")
  );
  assert.equal(
    normalizeProductName("No. 1 Coolant"),
    normalizeProductName("Coolant No:1")
  );
  assert.equal(
    normalizeProductName("Torchlight"),
    normalizeProductName("Torch light")
  );
});

test("all 20 instructions safely resolve against mixed-order database names", () => {
  const variations = [
    "1360 FAN BELT BOX",
    "Lock Bolt",
    "Bushing 80",
    "LIUGONG Key Knob",
    "No. 1 Coolant",
    "CUTTER",
    "Engine Cylinder 6",
    "Pulley Fan Cap",
    "JCB / Liugong / Sany Water Separator",
    "FF-5544 Fuel Filter",
    "LF 3349 Oil Filter",
    "Liugong Pilot Filter",
    "Hammer",
    "Sany Gear Lever",
    "JCB Key Knob",
    "Torchlight",
    "Grease",
    "GTT Oil 1 Litre",
    "Gear Oil Sinopec",
    "Hydraulic Oil Sinopec",
  ];
  const products = variations.map((name, index) => ({
    id: index + 1,
    branch_id: 1,
    name,
    quantity: 999,
    cost_price: 10,
    is_active: 1,
  }));

  const resolved = resolveCorrections(products);
  assert.equal(resolved.length, 20);
  assert.equal(new Set(resolved.map((item) => item.product.id)).size, 20);
  assert.deepEqual(
    resolved.map((item) => item.quantity),
    PRODUCT_CORRECTIONS.map((item) => item.quantity)
  );
  assert.ok(resolved.every((item) => item.match_score >= 0.84));
});

test("single-word products require an exact normalized name", () => {
  assert.equal(scoreName("Hammer", "Hydraulic Hammer"), 0);
  assert.equal(scoreName("Grease", "Grease Gun"), 0);
  assert.equal(scoreName("Cutter", "Bolt Cutter"), 0);
  assert.equal(scoreName("Hammer", "HAMMER"), 1);
});

test("brand and model tokens cannot be silently substituted", () => {
  assert.equal(scoreName("Key knob Liugong", "Key knob JCB"), 0);
  assert.equal(scoreName("Fuel filter FF5544", "Fuel filter FF5052"), 0);
  assert.equal(scoreName("Oil filter LF3349", "Oil filter LF9009"), 0);
});

test("ambiguous matches fail before any stock update", () => {
  const correction = PRODUCT_CORRECTIONS.find(
    (item) => item.label === "Sinopec gear oil"
  );
  assert.throws(
    () =>
      chooseUniqueProduct(correction, [
        { id: 1, name: "Sinopec Gear Oil" },
        { id: 2, name: "Gear Oil Sinopec" },
      ]),
    /Ambiguous product match/
  );
});

test("one database product cannot satisfy two correction instructions", () => {
  assert.throws(
    () =>
      resolveCorrections(
        [{ id: 1, name: "Hammer", quantity: 10, cost_price: 20 }],
        [
          { label: "Hammer A", quantity: 1, aliases: ["Hammer"] },
          { label: "Hammer B", quantity: 2, aliases: ["Hammer"] },
        ]
      ),
    /matched more than one correction target/
  );
});

test("adjustment direction is recorded correctly", () => {
  assert.equal(adjustmentType(10, 20), "increase");
  assert.equal(adjustmentType(20, 10), "decrease");
  assert.equal(adjustmentType(10, 10), "set");
});

test("the production correction is atomic, one-time and fully audited", () => {
  assert.equal(
    CORRECTION_RECORD,
    "20260802_boss_approved_product_quantity_correction"
  );
  assert.match(source, /SELECT GET_LOCK\(\?, 30\) AS acquired/);
  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /UPDATE products/);
  assert.match(source, /INSERT INTO stock_adjustments/);
  assert.match(source, /movement_type,[\s\S]*'physical_count'/);
  assert.match(source, /BOSS_APPROVED_STOCK_COUNT_CORRECTION/);
  assert.match(source, /INSERT INTO schema_migrations/);
  assert.match(source, /commit\(\)/);
  assert.match(source, /rollback\(\)/);
  assert.match(source, /CHALIN03_EXPECTED_DATABASE/);
  assert.match(source, /already applied/);
  assert.doesNotMatch(source, /DELETE\s+FROM/i);
  assert.doesNotMatch(source, /TRUNCATE/i);
  assert.doesNotMatch(source, /DROP\s+(TABLE|DATABASE)/i);
});
