const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("customer feature controls production migration is additive and isolated", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../../database/migrations/20260826_customer_feature_controls.sql"),
    "utf8"
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer_feature_controls/);
  assert.match(sql, /customer_identity_editing_enabled TINYINT\(1\)/);
  assert.match(sql, /customer_merge_enabled TINYINT\(1\)/);
  assert.match(sql, /branch_id INT NOT NULL PRIMARY KEY/);
  assert.match(sql, /created_at DATETIME NOT NULL/);
  assert.match(sql, /updated_at DATETIME NOT NULL/);
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
  assert.doesNotMatch(sql, /TRUNCATE/i);
});

test("Railway pre-deploy runs the customer feature controls migration before npm start", () => {
  const railway = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../railway.json"), "utf8")
  );

  assert.match(
    railway.deploy.preDeployCommand,
    /runCustomerFeatureControlsProductionMigration\.js/
  );
  assert.equal(railway.deploy.startCommand, "npm start");
});
