const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("customer feature control startup is wired before backend start", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")
  );
  assert.match(packageJson.scripts.start, /runCustomerFeatureControlsSchemaStartup\.js/);
});
