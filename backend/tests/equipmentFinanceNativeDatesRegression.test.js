"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { dateOnly } = require("../services/equipmentFinanceDateOnlyService");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("native MySQL Date objects preserve correct 15 and 29 October 2026", () => {
  assert.equal(dateOnly(new Date("2026-10-15T00:00:00.000Z")), "2026-10-15");
  assert.equal(dateOnly(new Date("2026-10-29T00:00:00.000Z")), "2026-10-29");
});

test("SQL date strings and native Date objects result in the same date evidence", () => {
  for (const date of ["2026-10-01", "2026-10-15", "2026-10-29", "2026-11-14"]) {
    assert.equal(dateOnly(date), date);
    assert.equal(dateOnly(date + "T00:00:00.000Z"), date);
    assert.equal(dateOnly(new Date(date + "T00:00:00Z")), date);
  }
});

test("reject malformed, impossible, null and invalid dates", () => {
  for (const date of [null, "", "Thu Oct 15", "0000-00-00", "2026-02-30", "2026-13-01", new Date("invalid")]) {
    assert.equal(dateOnly(date), null);
  }
});

test("all Finance reconciliation date paths use the same strict normalizer", () => {
  for (const name of [
    "services/equipmentFinanceReconciliationServiceBase.js",
    "services/equipmentFinanceScheduleTruthService.js",
    "services/equipmentFinanceReconciliationService.js",
  ]) {
    const source = read(name);
    assert.match(source, /require\("\.\/equipmentFinanceDateOnlyService"\)/, name);
    assert.match(source, /return dateOnly\(value\)/, name);
    assert.doesNotMatch(source, /String\(value\)\.slice\(0, 10\)/, name);
  }
});
