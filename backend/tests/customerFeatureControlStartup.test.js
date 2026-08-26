const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("customer feature control startup creates the production-safe schema", () => {
  const filePath = path.join(
    __dirname,
    "../scripts/runCustomerFeatureControlsSchemaStartup.js"
  );
  const source = fs.readFileSync(filePath, "utf8");

  assert.match(source, /CREATE TABLE IF NOT EXISTS customer_feature_controls/);
  assert.match(source, /branch_id INT NOT NULL PRIMARY KEY/);
  assert.match(source, /customer_identity_editing_enabled TINYINT\(1\)/);
  assert.match(source, /customer_merge_enabled TINYINT\(1\)/);
  assert.match(source, /created_at DATETIME NOT NULL/);
  assert.match(source, /updated_at DATETIME NOT NULL/);
});
