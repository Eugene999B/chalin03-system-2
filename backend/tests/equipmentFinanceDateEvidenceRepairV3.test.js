const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
function read(...parts) { return fs.readFileSync(path.join(root, ...parts), "utf8"); }

test("Controlled maintenance retains date-evidence repair without automatic deployment mutation", () => {
  const railway = JSON.parse(read("backend", "package.json")).scripts["maintenance:legacy-predeploy-repairs"];
  assert.deepEqual(JSON.parse(read("railway.json")).deploy.preDeployCommand, []);
  assert.match(railway, /runEquipmentFinanceDateEvidenceRepairV3\.js/);
  assert.match(railway, /runEquipmentFinanceRuntimeContractRepairV2\.js/);
});

test("Date-evidence repair uses quotation data and refreshes agreement schedule dates", () => {
  const repair = read("backend", "scripts", "runEquipmentFinanceDateEvidenceRepairV3.js");
  assert.match(repair, /quotation\.proposed_first_due_date/);
  assert.match(repair, /first_due_date/);
  assert.match(repair, /next_due_date/);
  assert.match(repair, /final_due_date/);
  assert.match(repair, /schedule_date/);
  assert.doesNotMatch(repair, /application\.proposed_first_due_date/);
  assert.match(repair, /0000-/);
});
