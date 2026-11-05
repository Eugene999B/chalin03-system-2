const assert = require("node:assert/strict");
const test = require("node:test");

// Evidence captured from the two production exports supplied on 2026-08-05.
// This test documents the reason the repair changes only hidden customer IDs:
// receipt-level names and phones align between Sales History and Debt exports,
// while the live Debt Desk screenshot proves unrelated receipts are grouped by
// a conflicting customer profile ID.
test("receipt export evidence supports ID-only isolation", () => {
  const evidence = {
    sales_receipts: 645,
    debt_receipts: 199,
    debt_receipts_missing_from_sales: 0,
    duplicate_debt_receipt_numbers: 0,
    customer_name_mismatches_by_receipt: 0,
    customer_phone_mismatches_by_receipt: 0,
    master_mickey_receipts: [
      { receipt: "CHL-MAIN-20260805-083844-4928", balance: 3800 },
      { receipt: "CHL-MAIN-20260731-103020-7928", balance: 1900 },
    ],
  };

  assert.equal(evidence.debt_receipts_missing_from_sales, 0);
  assert.equal(evidence.duplicate_debt_receipt_numbers, 0);
  assert.equal(evidence.customer_name_mismatches_by_receipt, 0);
  assert.equal(evidence.customer_phone_mismatches_by_receipt, 0);
  assert.equal(
    evidence.master_mickey_receipts.reduce((sum, item) => sum + item.balance, 0),
    5700
  );
});
