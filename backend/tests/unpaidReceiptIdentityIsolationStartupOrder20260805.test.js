const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
);

test("identity isolation runs after exact Mickey repair and before server", () => {
  const start = packageJson.scripts.start;
  const exact = start.indexOf("runMasterMickeyJuly31ExactDebtRepair20260805.js");
  const isolation = start.indexOf("runUnpaidReceiptIdentityIsolation20260805.js");
  const server = start.indexOf("server.js");
  assert.ok(exact >= 0);
  assert.ok(isolation > exact);
  assert.ok(server > isolation);
});
