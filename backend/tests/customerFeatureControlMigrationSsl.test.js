const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("customer feature migration honors DB_SSL_REJECT_UNAUTHORIZED", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../scripts/runCustomerFeatureControlsProductionMigration.js"),
    "utf8"
  );

  assert.match(source, /DB_SSL_REJECT_UNAUTHORIZED/);
  assert.match(source, /rejectUnauthorized/);
  assert.doesNotMatch(source, /rejectUnauthorized:\s*true\s*\}\s*:\s*\{\s*rejectUnauthorized:\s*true/);
});
