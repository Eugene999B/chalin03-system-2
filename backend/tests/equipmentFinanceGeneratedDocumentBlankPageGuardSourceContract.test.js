const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

test("blank-page protection is narrowly scoped to Finance footers", () => {
  const guard = source("services/equipmentFinancePdfBlankPageGuardService.js");
  assert.match(guard, /FINANCE_FOOTER_PREFIX/);
  assert.match(guard, /page\.margins\.bottom = 0/);
  assert.match(guard, /page\.margins\.bottom = originalBottomMargin/);
  assert.doesNotMatch(guard, /addPage\s*\(/);
});
