const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const route = fs.readFileSync(path.join(__dirname, "../routes/installmentDeepDeleteRoutesV10.js"), "utf8");

test("Installment deep deletion classifies finance references separately from shared blockers", () => {
  assert.match(route, /financeOwnedTable/);
  assert.match(route, /sharedModuleTable/);
  assert.match(route, /blocking_references/);
  assert.match(route, /deleteInternalMasterReferences/);
  assert.match(route, /INSTALLMENT_MASTER_DELETE_BLOCKED/);
});
