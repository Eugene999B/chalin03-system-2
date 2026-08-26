const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Railway customer feature migration explicitly runs in production mode", () => {
  const railwayConfig = fs.readFileSync(
    path.join(__dirname, "../../railway.json"),
    "utf8"
  );

  assert.match(
    railwayConfig,
    /NODE_ENV=production node backend\/scripts\/runCustomerFeatureControlsProductionMigration\.js/
  );
  assert.doesNotMatch(
    railwayConfig,
    /&& node backend\/scripts\/runCustomerFeatureControlsProductionMigration\.js/\n?/, 
  );
});
