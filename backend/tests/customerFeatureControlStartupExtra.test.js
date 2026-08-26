const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("customer feature control startup is present", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../scripts/runCustomerFeatureControlsSchemaStartup.js"),
    "utf8"
  );
  assert.match(source, /CREATE TABLE IF NOT EXISTS customer_feature_controls/);
});
