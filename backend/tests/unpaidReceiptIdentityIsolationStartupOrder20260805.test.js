const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
);

test("identity isolation runs after exact Mickey repair in controlled maintenance", () => {
  const maintenance = packageJson.scripts["maintenance:legacy-startup-repairs"];
  const exact = maintenance.indexOf("runMasterMickeyJuly31ExactDebtRepair20260805.js");
  const isolation = maintenance.indexOf("runUnpaidReceiptIdentityIsolation20260805.js");
  assert.ok(exact >= 0);
  assert.ok(isolation > exact);
  assert.equal(
    packageJson.scripts.start,
    "node -r ./services/exportWorkbookSafetyBootstrap.js server.js"
  );
});
