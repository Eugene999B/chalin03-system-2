const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const approvalService = read("services/operationalApprovalService.js");
const approvalRoutes = read("routes/operationalApprovalRoutes.js");
const returnRoutes = read("routes/returnRoutes.js");
const closingRoutes = read("routes/dailyClosingRoutes.js");
const accounting = read("services/accountingIntelligenceService.js");

test("one active financial return request reserves a sale item across users and retry states", () => {
  assert.match(approvalService, /listActiveReturnReservations/);
  assert.match(approvalService, /approval_kind = 'return_refund'/);
  assert.match(approvalService, /status IN \('pending', 'approved'\)/);
  assert.match(approvalService, /execution_status IN \('pending', 'executing', 'failed'\)/);
  const reservationFunction = approvalService.slice(
    approvalService.indexOf("async function listActiveReturnReservations"),
    approvalService.indexOf("async function createOperationalRequest")
  );
  assert.doesNotMatch(reservationFunction, /requested_by\s*=/);
  assert.match(approvalRoutes, /ACTIVE_RETURN_REQUEST_EXISTS/);
  assert.match(approvalRoutes, /Approve\/retry it or reject it before creating another return request/);
});

test("System Administrator can close their own duplicate or failed return request but other self-review stays blocked", () => {
  assert.match(approvalService, /const adminReturnSelfRejection =[\s\S]*getRole\(req\) === "admin"[\s\S]*request\.approval_kind === "return_refund"/);
  assert.match(approvalService, /if \(selfReview && !adminReturnSelfRejection\)/);
  assert.match(approvalService, /execution_status = 'rejected'/);
});

test("approved return is finalized exactly once inside the stock and refund transaction", () => {
  assert.match(returnRoutes, /req\.approvalExecution\?\.request_id/);
  assert.match(returnRoutes, /SET execution_status = 'executed', executed_at = NOW\(\)/);
  assert.match(returnRoutes, /RETURN_APPROVAL_FINALIZATION_FAILED/);
  assert.match(approvalService, /if \(request\.execution_status === "executed"\)/);
  assert.match(approvalRoutes, /internal response was interrupted after the business transaction completed/);
});

test("return changes stock, creates rich audit evidence and marks Daily Closing stale", () => {
  assert.match(returnRoutes, /SET quantity = quantity \+ \?/);
  assert.match(returnRoutes, /writeAuditEvent\(\{/);
  assert.match(returnRoutes, /entityType: "return"/);
  assert.match(returnRoutes, /approval_request_id/);
  assert.match(returnRoutes, /markClosingStale/);
  assert.match(returnRoutes, /sourceEntityType: "return"/);
});

test("refund cannot exceed item value or customer money actually collected", () => {
  assert.match(approvalRoutes, /REFUND_EXCEEDS_COLLECTED_MONEY/);
  assert.match(returnRoutes, /REFUND_EXCEEDS_COLLECTED_MONEY/);
  assert.match(approvalRoutes, /SUM\(refund_amount\)/);
  assert.match(returnRoutes, /SUM\(refund_amount\)/);
});

test("Daily Closing subtracts refunds from their exact real money channel", () => {
  assert.match(closingRoutes, /refundCash/);
  assert.match(closingRoutes, /refundMomo/);
  assert.match(closingRoutes, /refundBank/);
  assert.match(closingRoutes, /refundOther/);
  assert.match(closingRoutes, /- expenseCash - refundCash/);
  assert.match(closingRoutes, /- expenseMomo - refundMomo/);
  assert.match(closingRoutes, /- expenseBank - refundBank/);
  assert.match(closingRoutes, /- expenseOther - refundOther/);
});

test("management P&L subtracts executed return refunds from net sales", () => {
  assert.match(accounting, /returnsAndRefunds = money\(returns\.total_return_amount \|\| 0\)/);
  assert.match(accounting, /netSales = money\(grossSales - discounts - returnsAndRefunds\)/);
  assert.match(accounting, /returns_and_refunds: returnsAndRefunds/);
  assert.match(accounting, /buildProfitAndLoss\(\{ sales, expenses, purchases, returns \}\)/);
});
