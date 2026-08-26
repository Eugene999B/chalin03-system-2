const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("customer feature control startup is included in backend start", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.match(pkg.scripts.start, /runCustomerFeatureControlsSchemaStartup/);
});
