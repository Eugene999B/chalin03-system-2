const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Railway pre-deploy supports repository-root and backend-root service configurations", () => {
  const railwayConfig = fs.readFileSync(
    path.join(__dirname, "../../railway.json"),
    "utf8"
  );

  assert.match(
    railwayConfig,
    /if \[ -f backend\/scripts\/runCustomerFeatureControlsProductionMigration\.js \]/
  );
  assert.match(
    railwayConfig,
    /NODE_ENV=production node backend\/scripts\/runCustomerFeatureControlsProductionMigration\.js/
  );
  assert.match(
    railwayConfig,
    /NODE_ENV=production node scripts\/runCustomerFeatureControlsProductionMigration\.js/
  );
});
