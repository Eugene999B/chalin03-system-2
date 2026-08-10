const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const routes = read("backend/routes/payrollFoundationRoutes.js");
const service = read("backend/services/payrollFoundationService.js");

test("payroll worker profile endpoint remains permission and category guarded", () => {
  assert.match(routes, /requirePermission\("payroll\.view"\)/);
  assert.match(service, /PAYROLL_WORKER_CATEGORY_MISMATCH/);
});
