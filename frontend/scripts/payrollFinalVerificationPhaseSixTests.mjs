import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const app = read("src/App.jsx");
const workerProfile = read("src/pages/ExpandedWorkerProfilePage.jsx");
const workerPayroll = read("src/components/WorkerPayrollPanel.jsx");
const workerPayrollCss = read("src/styles/workerPayrollPanel.css");
const processing = read("src/pages/PayrollProcessingCentrePage.jsx");
const processingCss = read("src/styles/payrollProcessingCentre.css");
const spareLayout = read("src/components/Layout.jsx");
const miningLayout = read("src/layouts/MiningLayout.jsx");
const hireLayout = read("src/layouts/EquipmentHireLayout.jsx");
const financeLayout = read("src/layouts/InstallmentFinanceLayout.jsx");

assert.equal((app.match(/path="payroll"/g) || []).length, 4, "all four authorised business surfaces should route to Payroll Processing");
assert.match(app, /payroll\.view/);

for (const [name, layout] of [
  ["Spare Parts", spareLayout],
  ["Mining", miningLayout],
  ["Equipment Hire", hireLayout],
  ["Installment Finance", financeLayout],
]) {
  assert.match(layout, /Payroll Processing/, `${name} should expose the shared Payroll Processing entry point`);
  assert.match(layout, /payroll\.view/, `${name} payroll navigation must remain permission gated`);
}

assert.match(workerProfile, /payroll\.view/, "salary history must require explicit payroll.view permission");
assert.match(workerProfile, /Salary & Payroll/);
assert.match(workerPayroll, /hasPermission\("payroll\.payslip\.issue"\)/, "payslip issuance must remain separately permission gated");
assert.match(workerPayroll, /entry\.entry_status === "paid"/);
assert.match(workerPayroll, /\["reconciled", "closed"\]\.includes\(entry\.period_status\)/);
assert.match(workerPayroll, /responseType: "blob"/, "protected payslip PDF should be fetched through authenticated axios");
assert.match(workerPayroll, /verification_url/);

for (const source of [workerPayrollCss, processingCss]) {
  assert.match(source, /@media \(max-width: 720px\)/, "payroll surfaces must retain phone-width layout rules");
}
assert.match(workerPayrollCss, /grid-template-columns: 1fr/);
assert.match(processingCss, /grid-template-columns: 1fr/);

assert.match(processing, /Validate/);
assert.match(processing, /Prepare for Review/);
assert.match(processing, /Approve Payroll/);
assert.match(processing, /Lock for Payment/);
assert.match(processing, /Post Salary Payment/);
assert.match(processing, /Request Reversal/);
assert.match(processing, /Reconcile Payments/);
assert.match(processing, /payroll-payment:\$\{entryId\}/, "duplicate-click protection should use the payroll idempotency-key protocol");
assert.match(processing, /No statutory rate is hard-coded here/);

assert.doesNotMatch(workerPayroll, /workers\.view[^\n]+payroll/i, "ordinary worker visibility must not substitute for payroll permission");
assert.doesNotMatch(processing, /PAYE[^\n]{0,80}=\s*\d+(?:\.\d+)?\s*%/i, "PAYE rates must remain versioned backend data rather than frontend constants");
assert.doesNotMatch(processing, /SSNIT[^\n]{0,80}=\s*\d+(?:\.\d+)?\s*%/i, "SSNIT rates must remain versioned backend data rather than frontend constants");

console.log("Payroll Phase 6 frontend final-verification contracts passed.");
