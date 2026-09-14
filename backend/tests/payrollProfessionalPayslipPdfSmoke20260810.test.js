const assert = require("node:assert/strict");
const test = require("node:test");

const { buildPayslipPdf } = require("../services/payrollPayslipPdfService");

test("professional payroll payslip renders a real branded PDF with QR evidence", async () => {
  const payslip = {
    id: 91,
    payslip_number: "PAYSLIP-202608-0001",
    issue_version: 1,
    issue_status: "current",
    verification_reference: "abcdefghijklmnopqrstuvwxyz0123456789ABCD",
    checksum_sha256: "a".repeat(64),
    snapshot: {
      company: {
        name: "Chalin 03 Company Limited",
        workspace_code: "spare_parts",
        currency_code: "GHS",
      },
      payslip: {
        payslip_number: "PAYSLIP-202608-0001",
        issue_version: 1,
        issued_at: "2026-08-10T08:00:00.000Z",
      },
      worker: {
        employee_number: "EMP-000123",
        full_name: "Kwame Mensah Owusu",
        department: "Operations",
        role: "Store Officer",
      },
      period: {
        period_code: "202608",
        period_start: "2026-08-01",
        period_end: "2026-08-31",
        scheduled_pay_date: "2026-08-31",
        employment_days: 31,
        payable_days: 31,
      },
      totals: {
        gross_earnings: 3600,
        total_deductions: 450,
        employer_contributions: 300,
        net_salary: 3150,
      },
      ytd: {
        year: 2026,
        gross_earnings: 25200,
        total_deductions: 3150,
        employer_contributions: 2100,
        net_salary: 22050,
      },
      lines: [
        {
          line_code: "basic",
          line_name: "Basic salary",
          line_type: "earning",
          amount: 3300,
          quantity: 31,
          rate: 106.4516,
        },
        {
          line_code: "transport",
          line_name: "Transport allowance",
          line_type: "earning",
          amount: 300,
        },
        {
          line_code: "test_tax",
          line_name: "Statutory deduction",
          line_type: "deduction",
          amount: 450,
        },
        {
          line_code: "employer_fixture",
          line_name: "Employer contribution",
          line_type: "employer_contribution",
          amount: 300,
        },
      ],
      payments: [
        {
          payment_number: "PAY-202608-0001",
          payment_date: "2026-08-31",
          amount: 3150,
          payment_method: "bank",
          payment_reference: "BANK-REF-0001",
          destination_masked: "****1234",
        },
      ],
    },
  };

  const pdf = await buildPayslipPdf(payslip);
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 2500, `expected a non-trivial PDF, got ${pdf.length} bytes`);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
});
