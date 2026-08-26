const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("customer feature control startup file is readable", () => {
  const filePath = path.join(__dirname, "../scripts/runCustomerFeatureControlsSchemaStartup.js");
  assert.equal(fs.existsSync(filePath), true);
});
