const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const payslips = require("../services/payrollPayslipService");
const serviceSource = read("backend/services/payrollPayslipService.js");
const pdfSource = read("backend/services/payrollPayslipPdfService.js");
const payslipRoutes = read("backend/routes/payrollPayslipRoutes.js");
const verificationRoutes = read("backend/routes/payrollPayslipVerificationRoutes.js");
const workerVerificationRoutes = read("backend/routes/workerCardVerificationRoutes.js");
const processingRoutes = read("backend/routes/payrollProcessingRoutes.js");
const foundationMigration = read("database/migrations/20260810_payroll_financial_foundation.sql");

test("payslip verification URLs use the shared public verification centre with opaque references", () => {
  const previous = process.env.PAYROLL_PAYSLIP_VERIFY_BASE_URL;
  process.env.PAYROLL_PAYSLIP_VERIFY_BASE_URL = "https://verify.example.test/";
  try {
    assert.equal(
      payslips.buildPayslipVerificationUrl("abcdefghijklmnopqrstuvwxyz012345"),
      "https://verify.example.test/api/release2-final/verification/payroll-payslip/abcdefghijklmnopqrstuvwxyz012345"
    );
  } finally {
    if (previous === undefined) delete process.env.PAYROLL_PAYSLIP_VERIFY_BASE_URL;
    else process.env.PAYROLL_PAYSLIP_VERIFY_BASE_URL = previous;
  }
  assert.match(serviceSource, /crypto\.randomBytes\(24\)\.toString\("base64url"\)/);
  assert.doesNotMatch(serviceSource, /verification_reference:\s*entry\.employee_number/);
});

test("public employee identity is deliberately masked", () => {
  assert.equal(payslips.maskEmployeeName("Kwame Mensah Owusu"), "Kwame O.");
  assert.equal(payslips.maskEmployeeNumber("EMP-000123"), "EM******23");
  assert.equal(payslips.maskEmployeeNumber("123"), "1***");
});

test("payslips can only be issued from fully paid reconciled immutable payroll evidence", () => {
  assert.match(serviceSource, /\["reconciled", "closed"\]/);
  assert.match(serviceSource, /entry_status[^\n]+paid/);
  assert.match(serviceSource, /PAYROLL_PAYSLIP_ENTRY_NOT_PAID/);
  assert.match(serviceSource, /calculation_checksum_sha256/);
  assert.match(serviceSource, /PAYROLL_PAYSLIP_ENTRY_CHECKSUM_MISSING/);
  assert.match(serviceSource, /request_status = 'pending'/);
  assert.match(serviceSource, /PAYROLL_PAYSLIP_ADJUSTMENT_PENDING/);
  assert.match(serviceSource, /payment_status = 'posted'/);
  assert.match(serviceSource, /PAYROLL_PAYSLIP_PAYMENT_EVIDENCE_MISMATCH/);
  assert.match(serviceSource, /checksumSnapshot\(snapshot\)/);
});

test("issued payslip snapshots preserve payroll detail, payment evidence and YTD totals", () => {
  assert.match(serviceSource, /document_type: "chalin03_payroll_payslip"/);
  assert.match(serviceSource, /employee_number: entry\.employee_number/);
  assert.match(serviceSource, /department: entry\.department/);
  assert.match(serviceSource, /role: entry\.job_title/);
  assert.match(serviceSource, /employment_days:/);
  assert.match(serviceSource, /payable_days:/);
  assert.match(serviceSource, /gross_earnings:/);
  assert.match(serviceSource, /total_deductions:/);
  assert.match(serviceSource, /employer_contributions:/);
  assert.match(serviceSource, /net_salary:/);
  assert.match(serviceSource, /destination_masked/);
  assert.match(serviceSource, /payment_reference/);
  assert.match(serviceSource, /payment_date/);
  assert.match(serviceSource, /const ytd = await loadYtdTotals/);
  assert.match(serviceSource, /source_integrity:/);
});

test("revoked versions remain revoked when a later immutable version is issued", () => {
  assert.match(serviceSource, /supersedes_payslip_id/);
  assert.doesNotMatch(serviceSource, /latest\.issue_status !== "superseded"/);
  assert.doesNotMatch(serviceSource, /UPDATE payroll_payslips SET issue_status = 'superseded' WHERE id = \?/);
});

test("protected payslip routes enforce view, issue and adjustment permissions", () => {
  assert.match(payslipRoutes, /payslips\/entries\/:entryId\/issue/);
  assert.match(payslipRoutes, /requirePermission\("payroll\.payslip\.issue"\)/);
  assert.match(payslipRoutes, /requirePermission\("payroll\.view"\)/);
  assert.match(payslipRoutes, /requirePermission\("payroll\.adjust"\)/);
  assert.match(payslipRoutes, /Content-Type", "application\/pdf"/);
  assert.match(payslipRoutes, /Cache-Control", "private, no-store"/);
  assert.match(processingRoutes, /router\.use\(payrollPayslipRoutes\)/);
});

test("approved salary reversals invalidate current payslips and public verification rechecks source state", () => {
  assert.match(processingRoutes, /revokeCurrentPayslipsForEntry/);
  assert.match(processingRoutes, /result\.status === "executed"/);
  assert.match(serviceSource, /WHERE payroll_entry_id = \? AND issue_status = 'current'/);
  assert.match(serviceSource, /entry\.entry_status/);
  assert.match(serviceSource, /period\.status AS period_status/);
  assert.match(serviceSource, /active_paid/);
  assert.match(serviceSource, /pending_adjustments/);
  assert.match(serviceSource, /storedState === "current" && !underlyingCurrent \? "revoked"/);
});

test("public verification is shared, rate limited, privacy safe and non-indexable", () => {
  assert.match(workerVerificationRoutes, /router\.use\("\/verification", payrollPayslipVerificationRoutes\)/);
  assert.match(verificationRoutes, /rateLimit\(/);
  assert.match(verificationRoutes, /VERIFICATION_RATE_LIMITED/);
  assert.match(verificationRoutes, /VERIFIED CHALIN 03 PAYSLIP/);
  assert.match(verificationRoutes, /Chalin 03 Verification Centre/);
  assert.match(verificationRoutes, /noindex, nofollow, noarchive/);
  assert.match(verificationRoutes, /Content-Security-Policy/);
  assert.match(verificationRoutes, /Bank or mobile-money destinations, deductions and detailed payroll lines are not exposed/);
  assert.match(serviceSource, /Record matches Chalin 03 payroll system\./);
});

test("professional PDF includes branded identity, itemized payroll, YTD, payment evidence, checksum and QR", () => {
  assert.match(pdfSource, /CHALIN 03 COMPANY LIMITED/);
  assert.match(pdfSource, /PROFESSIONAL PAYSLIP/);
  assert.match(pdfSource, /Earnings, deductions and employer contributions/);
  assert.match(pdfSource, /Year-to-date totals/);
  assert.match(pdfSource, /Payment evidence/);
  assert.match(pdfSource, /createPayslipVerificationQr/);
  assert.match(pdfSource, /PAYSLIP CHECKSUM/);
  assert.match(pdfSource, /destination_masked/);
  assert.match(pdfSource, /payment_reference/);
});

test("foundation keeps payslip history non-destructive", () => {
  assert.match(foundationMigration, /CREATE TABLE IF NOT EXISTS payroll_payslips/);
  assert.match(foundationMigration, /issue_status ENUM\('current', 'superseded', 'revoked'\)/);
  assert.match(foundationMigration, /snapshot_json JSON NOT NULL/);
  assert.match(foundationMigration, /checksum_sha256 CHAR\(64\) NOT NULL/);
  assert.match(foundationMigration, /verification_reference VARCHAR\(191\)/);
  assert.match(foundationMigration, /FOREIGN KEY \(payroll_entry_id\) REFERENCES payroll_entries\(id\) ON DELETE RESTRICT/);
});
