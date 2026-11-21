const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  calculateReturnSettlement,
  REQUEST_TYPES,
} = require("../services/equipmentFinanceCorrectionService");

const ROOT = path.resolve(__dirname, "../..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const serviceSource = read("backend/services/equipmentFinanceCorrectionService.js");
const routeSource = read("backend/routes/equipmentFinanceCorrectionRoutes.js");
const independentRoutesSource = read("backend/routes/equipmentFinanceIndependentRoutes.js");
const startupSource = read("backend/scripts/runEquipmentFinancePhaseFourStartup.js");
const migrationSource = read(
  "database/migrations/20260801_equipment_finance_phase4_corrections_settlements.sql"
);
const balanceGuardSource = read(
  "database/migrations/20260801_equipment_finance_phase4_balance_guard.sql"
);
const verifySource = read(
  "database/migrations/20260801_equipment_finance_phase4_corrections_settlements_verify.sql"
);

function withoutSqlComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

test("return settlement follows the approved accounting formula", () => {
  const settlement = calculateReturnSettlement({
    outstandingBalance: 800,
    approvedReturnCredit: 500,
    refundableAmount: 50,
    penaltyAmount: 25,
    damageAmount: 75,
    allowCustomerRefundDue: true,
  });

  assert.deepEqual(settlement, {
    outstanding_balance: 800,
    approved_return_credit: 500,
    refundable_amount: 50,
    penalty_amount: 25,
    damage_amount: 75,
    raw_settlement_balance: 350,
    final_settlement_balance: 350,
    refund_due: 0,
    formula:
      "outstanding_balance - approved_return_credit - refundable_amount + penalty_amount + damage_amount",
  });
});

test("excess approved credits never create a negative debt", () => {
  const settlement = calculateReturnSettlement({
    outstandingBalance: 300,
    approvedReturnCredit: 350,
    refundableAmount: 25,
    penaltyAmount: 0,
    damageAmount: 0,
    allowCustomerRefundDue: true,
  });

  assert.equal(settlement.final_settlement_balance, 0);
  assert.equal(settlement.refund_due, 75);
});

test("Phase 4 supports every requested correction category", () => {
  assert.deepEqual(
    [...REQUEST_TYPES].sort(),
    [
      "asset_return",
      "charge_waiver",
      "draft_cancellation",
      "payment_reversal",
      "repossession",
    ]
  );
});

test("corrections preserve originals and require an independent decision", () => {
  assert.match(serviceSource, /requested_by[^\n]*===?[^\n]*actorId|Number\(request\.requested_by/);
  assert.match(serviceSource, /EQUIPMENT_FINANCE_INDEPENDENT_APPROVER_REQUIRED/);
  assert.match(serviceSource, /is_voided = TRUE/);
  assert.match(serviceSource, /allocations_preserved_and_reversed/);
  assert.match(serviceSource, /original_records_deleted: false/);
  assert.doesNotMatch(serviceSource, /DELETE\s+FROM\s+equipment_sale_payments/i);
  assert.doesNotMatch(serviceSource, /DELETE\s+FROM\s+equipment_sale_payment_allocations/i);
});

test("approved returns post separate accounting entries and release the machine", () => {
  assert.match(serviceSource, /approved_return_credit/);
  assert.match(serviceSource, /approved_refundable_amount/);
  assert.match(serviceSource, /approved_return_penalty/);
  assert.match(serviceSource, /approved_damage_charge/);
  assert.match(serviceSource, /return_settlement/);
  assert.match(serviceSource, /equipment_commitment_status = 'released'/);
  assert.match(serviceSource, /sale_status IN \('reserved','installment_active','cancelled'\) THEN 'available'/);
  assert.match(serviceSource, /settlement\.final_settlement_balance <= 0\.01 \? "cancelled" : "defaulted"/);
});

test("the API exposes policy, preview, request, decision and account-file endpoints", () => {
  assert.match(routeSource, /router\.get\(\s*"\/policy"/);
  assert.match(routeSource, /router\.put\(\s*"\/policy"/);
  assert.match(routeSource, /"\/settlement-preview"/);
  assert.match(routeSource, /"\/accounts\/:agreementId\/requests"/);
  assert.match(routeSource, /"\/requests\/:requestId\/decision"/);
  assert.match(routeSource, /REQUEST_ROLES/);
  assert.match(routeSource, /APPROVAL_ROLES/);
  assert.match(independentRoutesSource, /router\.use\("\/finance-corrections", equipmentFinanceCorrectionRoutes\)/);
});

test("the additive migration records policy, requests, ledger and return settlements", () => {
  const executable = withoutSqlComments(migrationSource);
  assert.match(migrationSource, /ADDITIVE MIGRATION ONLY/);
  assert.match(migrationSource, /BACKUP REQUIRED/);
  assert.match(executable, /CREATE TABLE IF NOT EXISTS equipment_finance_correction_policies/);
  assert.match(executable, /CREATE TABLE IF NOT EXISTS equipment_finance_correction_requests/);
  assert.match(executable, /CREATE TABLE IF NOT EXISTS equipment_finance_ledger_entries/);
  assert.match(executable, /CREATE TABLE IF NOT EXISTS equipment_finance_asset_returns/);
  assert.match(executable, /policy_snapshot_json/);
  assert.match(executable, /financial_snapshot_json/);
  assert.match(executable, /proposed_entries_json/);
  assert.match(executable, /INSERT INTO schema_migrations/);
  assert.doesNotMatch(executable, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(executable, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(executable, /\bTRUNCATE\b/i);
  assert.doesNotMatch(withoutSqlComments(verifySource), /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
});

test("the balance guard protects existing payment flows from stale simple balances", () => {
  assert.match(balanceGuardSource, /trg_equipment_finance_phase4_balance_guard_before_update/);
  assert.match(balanceGuardSource, /equipment_finance_ledger_entries/);
  assert.match(balanceGuardSource, /ledger\.direction = 'debit'/);
  assert.match(balanceGuardSource, /ledger\.direction = 'credit'/);
  assert.match(balanceGuardSource, /payment\.is_voided = FALSE/);
  assert.match(balanceGuardSource, /schedule\.late_charge_amount/);
  assert.match(balanceGuardSource, /schedule\.waived_charge_amount/);
  assert.match(balanceGuardSource, /SET NEW\.outstanding_balance = v_balance/);
});

test("Railway startup applies and verifies every Phase 4 release", () => {
  assert.match(startupSource, /equipment_finance_phase4_corrections_settlements/);
  assert.match(startupSource, /equipment_finance_phase4_balance_guard/);
  assert.match(
    startupSource,
    /20260803_equipment_finance_phase4_deposit_reservation_integrity/
  );
  assert.match(startupSource, /information_schema\.TABLES/);
  assert.match(startupSource, /SELECT GET_LOCK/);
  assert.match(startupSource, /validateCorrectionSchema/);
  assert.match(startupSource, /validateBalanceGuard/);
  assert.match(startupSource, /validateDepositReservationIntegrity/);
  assert.match(startupSource, /hasExecutableSql/);
});

