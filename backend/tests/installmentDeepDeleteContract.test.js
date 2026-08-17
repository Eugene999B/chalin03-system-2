const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Installment deep delete is mounted and targets the real master tables", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(packageJson.scripts.start, /installmentDeepDeleteRouteBootstrap\.js/);

  const route = read("routes/installmentDeepDeleteRoutesV10.js");
  assert.match(route, /hire_customers/);
  assert.match(route, /fleet_assets/);
  assert.match(route, /completion-phase-four\/entity\/:entityType\/:entityId\/delete/);
  assert.match(route, /completion-phase-four\/reset\/execute/);
  assert.match(route, /RESET INSTALLMENT FINANCE/);
});

test("Installment delete dialog and Reset Centre consume the deep trial scope", () => {
  const dialog = fs.readFileSync(path.join(root, "..", "frontend/src/components/InstallmentEntityDeleteDialog.jsx"), "utf8");
  const reset = fs.readFileSync(path.join(root, "..", "frontend/src/pages/InstallmentCompletionPhaseFourPage.jsx"), "utf8");
  assert.match(dialog, /trial_record/);
  assert.match(dialog, /DELETE INSTALLMENT/);
  assert.match(reset, /dryRun\.customers/);
  assert.match(reset, /dryRun\.excavators/);
  assert.match(reset, /dryRun\.items/);
});
