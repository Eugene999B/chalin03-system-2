const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Finance payment history is isolated, filtered and exact-payment safe", () => {
  const service = read("services/equipmentFinancePaymentHistoryService.js");
  const routes = read("routes/equipmentFinancePhaseSixRoutes.js");

  for (const contract of [
    "equipment_sale_payments",
    "equipment_sale_agreements",
    "agreement.sale_type = 'installment'",
    "agreement.activation_source = 'approved_credit_application'",
    "payment.payment_date >= ?",
    "DATE_ADD(?, INTERVAL 1 DAY)",
    "LIMIT ? OFFSET ?",
    "customer_name_snapshot",
    "customer_phone_snapshot",
    "asset_name_snapshot",
    "receipt_number",
    "is_voided",
    "payment_method",
    "payment_category",
    "INVALID_PAYMENT_HISTORY_DATE_RANGE",
    "FINANCE_PAYMENT_HISTORY_SCHEMA_NOT_READY",
  ]) {
    assert.match(service, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(service, /ORDER BY\s+\$\{[^}]*sort/i);
  assert.match(routes, /listPaymentHistory/);
  assert.match(routes, /\/phase6\/payment-history/);
  assert.match(routes, /fleet\.assets\.view/);
});

console.log("Equipment Finance payment history backend contracts passed.");
