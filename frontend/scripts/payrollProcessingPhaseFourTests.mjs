import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const app = read("src/App.jsx");
const page = read("src/pages/PayrollProcessingCentrePage.jsx");
const css = read("src/styles/payrollProcessingCentre.css");
const spareLayout = read("src/components/Layout.jsx");
const miningLayout = read("src/layouts/MiningLayout.jsx");
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");
const financeLayout = read("src/layouts/InstallmentFinanceLayout.jsx");

assert.match(app, /PayrollProcessingCentrePage/);
assert.equal((app.match(/path="payroll"/g) || []).length, 4);
assert.match(app, /payroll\.view/);

assert.match(page, /Run Monthly Payroll/);
assert.match(page, /Workers and salaries come automatically from Worker Profiles/);
assert.match(page, /Preview Workers &amp; Salaries/);
assert.match(page, /Confirm &amp; Send for Approval/);
assert.match(page, /Payroll Settings/);
assert.match(page, /Basic salary/);
assert.match(page, /Approve Payroll/);
assert.match(page, /Lock for Payment/);
assert.match(page, /Reconcile Payments/);
assert.match(page, /Post Salary Payment/);
assert.match(page, /Request Reversal/);
assert.match(page, /Corrections/);
assert.match(page, /payroll-payment:\$\{entryId\}/);
assert.match(page, /processing\/periods\/\$\{selectedId\}\/validate/);
assert.match(page, /processing\/entries\/\$\{selectedEntry\.id\}\/payments/);
assert.match(page, /processing\/payments\/\$\{reversalPaymentId\}\/reversal-request/);
assert.match(page, /processing\/adjustments\/\$\{adjustment\.id\}\/decision/);

for (const layout of [spareLayout, miningLayout, hireLayout, financeLayout]) {
  assert.match(layout, /Payroll Processing/);
  assert.match(layout, /payroll\.view/);
}

assert.match(css, /payroll-centre__workflow/);
assert.match(css, /@media \(max-width: 720px\)/);

console.log("Payroll Processing Phase 4 source contract passed.");
