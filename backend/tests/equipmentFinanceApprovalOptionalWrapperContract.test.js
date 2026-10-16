const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../frontend/src/pages/EquipmentFinanceApplicationsOptionalPage.jsx"
  ),
  "utf8"
);

test("the optional approval wrapper is declarative and cannot starve application reads", () => {
  assert.match(source, /<EquipmentFinanceApplicationsPage \/>/);
  assert.match(source, /Optional-information rule:/);
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /textContent\s*=/);
  assert.doesNotMatch(source, /querySelector/);
  assert.doesNotMatch(source, /useLayoutEffect/);
});
