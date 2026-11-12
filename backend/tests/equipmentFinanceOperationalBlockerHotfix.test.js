const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  normalizeEquipmentAssetSaleLockStatement,
} = require("../config/db");

const backendRoot = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

test("opening-deposit lock reads use the real asset_id primary key", () => {
  const original = `SELECT sale_lock.id, sale_lock.agreement_id
    FROM equipment_asset_sale_locks sale_lock
    WHERE sale_lock.asset_id = ?
    ORDER BY sale_lock.id`;
  const normalized = normalizeEquipmentAssetSaleLockStatement(original);

  assert.doesNotMatch(normalized, /sale_lock\.id/);
  assert.match(normalized, /SELECT sale_lock\.asset_id/);
  assert.match(normalized, /ORDER BY sale_lock\.asset_id/);
});

test("sale-lock compatibility preserves query option objects and unrelated SQL", () => {
  const options = {
    sql: "SELECT sale_lock.id FROM equipment_asset_sale_locks sale_lock WHERE sale_lock.asset_id = ?",
    rowsAsArray: true,
  };
  const normalized = normalizeEquipmentAssetSaleLockStatement(options);
  assert.notEqual(normalized, options);
  assert.equal(normalized.rowsAsArray, true);
  assert.match(normalized.sql, /sale_lock\.asset_id/);

  const unrelated = "SELECT id FROM equipment_sale_agreements WHERE id = ?";
  assert.equal(normalizeEquipmentAssetSaleLockStatement(unrelated), unrelated);
});

test("production startup enables the existing company-approved Finance terms", () => {
  const script = source("scripts/runEquipmentFinanceTermsApprovalRepair20260806.js");
  const packageJson = source("package.json");

  assert.match(script, /legal_review_status = 'approved'/);
  assert.match(script, /terms_version/);
  assert.match(script, /CHAR_LENGTH\(agreement_terms\)/);
  assert.match(script, /beginTransaction\(\)/);
  assert.match(script, /rollback\(\)/);
  assert.doesNotMatch(script, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE/i);
  assert.match(packageJson, /runEquipmentFinanceTermsApprovalRepair20260806\.js/);
});
