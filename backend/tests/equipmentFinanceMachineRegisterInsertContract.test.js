const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const servicePath = path.join(
  __dirname,
  "..",
  "services",
  "equipmentFinanceMachineRegisterService.js"
);

test("excavator register INSERT keeps fleet_assets columns and values aligned", () => {
  const source = fs.readFileSync(servicePath, "utf8");
  const match = source.match(
    /INSERT INTO fleet_assets \(([\s\S]*?)\) VALUES \(([\s\S]*?)\)`/m
  );

  assert.ok(match, "fleet_assets insert statement must remain present");

  const columns = match[1]
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const values = match[2]
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  assert.equal(columns.length, 39);
  assert.equal(values.length, columns.length);
  assert.equal(columns[28], "minimum_selling_price");
  assert.equal(values[28], "?");
  assert.equal(columns[29], "standard_hire_rate");
  assert.equal(values[29], "0");
});
