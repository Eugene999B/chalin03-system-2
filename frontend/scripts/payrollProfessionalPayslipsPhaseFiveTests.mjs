import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const panel = read("src/components/WorkerPayrollPanel.jsx");
const styles = read("src/styles/workerPayrollPanel.css");

assert.match(panel, /useAuth\(\)/, "worker payroll panel should use the authenticated permission context");
assert.match(panel, /hasPermission\("payroll\.payslip\.issue"\)/, "payslip issuance must remain permission gated");
assert.match(panel, /entry\.entry_status === "paid"/, "issuance UI must require a fully paid worker entry");
assert.match(panel, /\["reconciled", "closed"\]\.includes\(entry\.period_status\)/, "issuance UI must require reconciled or closed payroll");
assert.match(panel, /\/payroll\/payslips\/entries\/\$\{entry\.id\}\/issue/, "worker profile must use the protected payslip issuance endpoint");
assert.match(panel, /responseType: "blob"/, "PDF viewing must use authenticated blob retrieval rather than exposing a protected API URL");
assert.match(panel, /\/payroll\/payslips\/\$\{payslip\.id\}\/pdf/, "worker profile must request the protected professional PDF endpoint");
assert.match(panel, /verification_url/, "verification action must resolve the server-issued verification URL");
assert.match(panel, /worker-professional-payslips/, "worker profile should expose a stable Professional Payslips surface");
assert.match(panel, /Issue Payslip/, "eligible payroll issuers should have an explicit issue action");
assert.match(panel, /View PDF/, "authorised payroll viewers should be able to open the professional PDF");
assert.match(panel, /Verify QR Record/, "authorised payroll viewers should be able to open public verification");
assert.doesNotMatch(panel, /window\.open\(`?\/payroll\/payslips/, "protected PDF endpoints must not be opened without authenticated axios retrieval");

assert.match(styles, /worker-payroll__payslip-grid/, "Professional Payslips should have dedicated responsive layout styles");
assert.match(styles, /worker-payroll__status\.is-current/, "current payslips should have a clear status treatment");
assert.match(styles, /worker-payroll__status\.is-revoked/, "revoked payslips should have a clear status treatment");
assert.match(styles, /worker-payroll__status\.is-superseded/, "superseded payslips should have a clear status treatment");

console.log("Professional Payroll Payslips Phase 5 frontend contracts passed.");
