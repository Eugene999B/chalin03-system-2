import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const profile = read("src/pages/ExpandedWorkerProfilePage.jsx");
const payroll = read("src/components/WorkerPayrollPanel.jsx");
const styles = read("src/styles/workerPayrollPanel.css");

assert.match(profile, /WorkerPayrollPanel/);
assert.match(profile, /payroll\.view/);
assert.match(profile, /Salary & Payroll/);
assert.match(profile, /activeTab === "payroll"/);

assert.match(payroll, /\/payroll\/workers\/\$\{workerId\}\/profile/);
assert.match(payroll, /Confidential payroll record/);
assert.match(payroll, /Current basic salary/);
assert.match(payroll, /Processed months/);
assert.match(payroll, /YTD net salary/);
assert.match(payroll, /Payroll timeline/);
assert.match(payroll, /Salary changes/);
assert.match(payroll, /Salary payment history/);
assert.match(payroll, /Loans & salary advances/);

// Salary management is intentionally available here: draft, submit and approve,
// plus immutable payslip issuance. Keep every other mutation method forbidden.
const postCalls = [...payroll.matchAll(/axiosClient\.post\(/g)];
assert.equal(postCalls.length, 5, "worker payroll panel should expose exactly salary create/auto-submit/manual-submit/approve plus payslip issue");
assert.match(payroll, /\/payroll\/workers\/\$\{workerId\}\/compensation/);
assert.match(payroll, /\/payroll\/compensation\/\$\{profileId\}\/submit/);
assert.match(payroll, /\/payroll\/compensation\/\$\{item\.id\}\/approve/);
assert.match(payroll, /axiosClient\.post\(`\/payroll\/payslips\/entries\/\$\{entry\.id\}\/issue`/);
assert.match(payroll, /Change Salary/);
assert.match(payroll, /Save & Send for Approval/);
assert.doesNotMatch(payroll, /axiosClient\.(put|delete|patch)\(/);

assert.match(styles, /worker-payroll__metrics/);
assert.match(styles, /@media \(max-width: 720px\)/);

console.log("Payroll Worker Profile Phase 3 source contract passed.");
