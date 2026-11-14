"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calculateReturnLimit } = require("../services/sparePartsReturnLimitService");

const read = (relative) =>
  fs.readFileSync(path.resolve(__dirname, "..", relative), "utf8");
const returns = read("routes/returnRoutes.js");
const approvals = read("routes/operationalApprovalRoutes.js");

function section(source, first, last) {
  const start = source.indexOf(first);
  assert.ok(start >= 0, "Missing section start: " + first);
  const end = source.indexOf(last, start + first.length);
  assert.ok(end > start, "Missing section end: " + last);
  return source.slice(start, end);
}

test("receipt items expose weighted historical unit price instead of zero or maximum sale-line price", () => {
  const source = section(
    returns,
    "const [items] = await pool.query(",
    "const activeReservations = await listActiveReturnReservations"
  );
  assert.match(source, /SUM\(si\.line_total\) AS historical_item_gross/);
  assert.match(source, /ROUND\(SUM\(si\.line_total\) \/ NULLIF\(SUM\(si\.quantity\), 0\), 2\) AS unit_price/);
  assert.match(source, /MAX\(si\.product_name\) AS product_name/);
  assert.match(source, /GROUP BY si\.sale_id, si\.product_id/);
  assert.doesNotMatch(source, /MAX\(si\.unit_price\)/);
});

test("financial return execution receives original gross value inside the locked receipt transaction", () => {
  const source = section(
    returns,
    "const [saleItems] = await connection.query(",
    "const [products] = await connection.query("
  );
  assert.match(source, /SUM\(si\.line_total\) AS historical_item_gross/);
  assert.match(source, /MAX\(si\.product_name\) AS product_name/);
  assert.doesNotMatch(source, /MAX\(si\.unit_price\)/);
  assert.match(returns, /historicalItemGross: saleItem\.historical_item_gross/);
  assert.match(returns, /REFUND_EXCEEDS_COLLECTED_MONEY/);
  assert.match(returns, /RETURN_APPROVAL_FINALIZATION_FAILED/);
});

test("refund submission uses the same historical, discounted and taxed limit as execution", () => {
  const source = section(
    approvals,
    "async function createReturnRefundRequest(",
    "async function createSaleVoidRequest("
  );
  assert.match(source, /SUM\(si\.line_total\) AS historical_item_gross/);
  assert.match(source, /calculateReturnLimit\(/);
  assert.match(source, /saleDiscount: sale\.discount_amount/);
  assert.match(source, /saleTax: sale\.tax_amount/);
  assert.match(source, /previouslyRefundedForItem/);
  assert.match(source, /refundAmount - limit\.maximum_refund/);
  assert.match(source, /reservedRefundAmount/);
  assert.doesNotMatch(source, /MAX\(si\.unit_price\)/);
});

test("read-only refund quote is branch-limited and accounts for previous returns and pending requests", () => {
  const source = section(returns, '"/sales/:saleId/refund-quote"', "// GET /api/returns");
  assert.match(source, /requireAuth/);
  assert.match(source, /requireRole\("admin", "manager"\)/);
  assert.match(source, /saleId, branchId/);
  assert.match(source, /listActiveReturnReservations/);
  assert.match(source, /historicalItemGross: items\[0\]\.historical_item_gross/);
  assert.match(source, /previouslyRefundedForItem/);
  assert.match(source, /Number\(previousReceiptRefunds\[0\]\.refunded_total/);
  assert.match(source, /maximum_refund: Math\.min\(limit\.maximum_refund, collectedRemaining\)/);
});

test("mixed price lines are valued by their historical aggregate, discount and tax", () => {
  // One item was sold at GHS 30, two more at GHS 40: gross 110.
  // Receipt gross 200, discount 20, tax 10 -> paid invoice total 190.
  const common = {
    saleSubtotal: "200.00",
    saleDiscount: "20.00",
    saleTax: "10.00",
    saleTotal: "190.00",
    historicalItemGross: "110.00",
    soldQuantity: 3,
    returnQuantity: 2,
  };
  const limit = calculateReturnLimit(common);
  assert.equal(limit.original_item_customer_value, 104.5);
  assert.equal(limit.estimated_return_amount, 69.67);
  assert.equal(limit.maximum_refund, 69.67);
  const prior = calculateReturnLimit({
    ...common,
    previouslyRefundedForItem: "80.00",
  });
  assert.equal(prior.maximum_refund, 24.5);
  assert.throws(() => calculateReturnLimit({ ...common, returnQuantity: 4 }), /quantity/);
});
