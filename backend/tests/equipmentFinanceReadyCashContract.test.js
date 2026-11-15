"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const readyCash = read("backend", "routes", "equipmentFinanceReadyCashRoutes.js");
const financeRouter = read("backend", "routes", "equipmentFinanceIndependentRoutes.js");
const financeShell = read("frontend", "src", "layouts", "InstallmentFinanceLayout.jsx");
const financeStage = read("frontend", "src", "pages", "EquipmentSalesWorkspacePage.jsx");

test("Ready Cash uses the independent company-wide Finance router and standard permission gates", () => {
  assert.match(financeRouter, /require\("\.\/equipmentFinanceReadyCashRoutes"\)/);
  assert.match(financeRouter, /router\.use\(equipmentFinanceReadyCashRoutes\)/);
  assert.match(readyCash, /router\.post\("\/ready-cash\/checkout", requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(readyCash, /router\.post\("\/ready-cash\/:agreementId\/handover", requirePermission\("fleet\.assets\.manage"\)/);
  assert.match(readyCash, /hire_location_id: null/);
  assert.match(financeShell, /Ready Cash · Full Payment/);
  assert.match(financeStage, /stage === "ready-cash"/);
});

test("Ready Cash is a full-payment sale option, not a payment-method or gateway integration", () => {
  assert.match(readyCash, /sale_option !== "ready_cash"/);
  assert.match(readyCash, /full_payment_confirmed !== true/);
  assert.match(readyCash, /full_payment_reference/);
  assert.match(readyCash, /customer_terms_accepted !== true/);
  assert.doesNotMatch(readyCash, /paymentMethod !== "cash"/);
  assert.doesNotMatch(readyCash, /cash_received_confirmed !== true/);
  assert.doesNotMatch(readyCash, /cash_shift_reference/);
  assert.match(readyCash, /cents\(machine\.target_selling_price\)/);
  assert.match(readyCash, /totalCents !== requestedCents/);
  assert.match(readyCash, /Number\(conflict\.active_hires\)/);
  assert.match(readyCash, /Number\(conflict\.active_sale_locks\)/);
  assert.match(readyCash, /Number\(conflict\.active_finance_applications\)/);
  assert.match(readyCash, /Number\(conflict\.existing_sales\)/);
});

test("One transaction saves a historical cash receipt and asset reservation; no credit or installment schedule", () => {
  assert.match(readyCash, /await transaction\(async \(connection\) => \{/);
  assert.match(readyCash, /await conn\.beginTransaction\(\)/);
  assert.match(readyCash, /await conn\.commit\(\)/);
  assert.match(readyCash, /await conn\.rollback\(\)/);
  assert.match(readyCash, /INSERT INTO equipment_sales_quotations SET/);
  assert.match(readyCash, /INSERT INTO equipment_sales_quotation_items SET/);
  assert.match(readyCash, /INSERT INTO equipment_sale_agreements SET/);
  assert.match(readyCash, /INSERT INTO equipment_sale_payments SET/);
  assert.match(readyCash, /INSERT INTO equipment_asset_sale_locks/);
  assert.match(readyCash, /idempotency_key: requestKey/);
  assert.match(readyCash, /sale_type: "cash"/);
  assert.match(readyCash, /financed_amount: 0, scheduled_total: 0/);
  assert.match(readyCash, /amount_paid: money, outstanding_balance: 0/);
  assert.match(readyCash, /payment_category: "settlement"/);
  assert.match(readyCash, /sale_status = 'reserved'/);
  assert.doesNotMatch(readyCash, /INSERT INTO equipment_installment_schedule/);
});

test("Sold status requires independent manager, signed handover, nonvoided receipt and exact collection reconciliation", () => {
  assert.match(readyCash, /MANAGER_ROLES\.has\(role\)/);
  assert.match(readyCash, /Number\(agreement\.created_by\) === userId/);
  assert.match(readyCash, /READY_CASH_INDEPENDENT_HANDOVER_REQUIRED/);
  assert.match(readyCash, /signed_handover_confirmed !== true/);
  assert.match(readyCash, /handover_reference/);
  assert.match(readyCash, /payment_category = 'settlement'/);
  assert.match(readyCash, /cents\(paymentTotals\[0\]\?\.net_collected\) !== cents\(agreement\.total_amount\)/);
  assert.match(readyCash, /INSERT INTO equipment_deliveries SET/);
  assert.match(readyCash, /INSERT INTO equipment_ownership_transfers SET/);
  assert.match(readyCash, /UPDATE fleet_assets SET sale_status = 'sold'/);
  assert.match(readyCash, /EQUIPMENT_READY_CASH_OWNERSHIP_TRANSFERRED/);
});

test("Payment retry is idempotent and cannot attach a reference to a different buyer or asset", () => {
  assert.match(readyCash, /WHERE p\.idempotency_key = \? LIMIT 1/);
  assert.match(readyCash, /Number\(record\.customer_id\) !== customerId/);
  assert.match(readyCash, /Number\(record\.asset_id\) !== assetId/);
  assert.match(readyCash, /READY_CASH_IDEMPOTENCY_CONFLICT/);
  assert.match(readyCash, /READY_CASH_ORIGINAL_PAYMENT_REVERSED/);
  assert.match(readyCash, /record\.sale_type !== "cash"/);
  assert.match(readyCash, /Number\(record\.is_voided\) === 1/);
  assert.match(readyCash, /READY_CASH_REFERENCE_REQUIRED/);
  assert.match(readyCash, /duplicate: true, paid_in_full: true/);
});
