const assert = require("assert");
const {
  agreementLateFeePolicy,
  calculateProspectiveLateFee,
  nextDueFromSchedule,
} = require("../services/equipmentFinanceAuthoritativePolicyService");
const { calculateFee } = require("../services/equipmentFinanceLateFeeApplicationService");
const { buildFinanceSchedule } = require("../services/equipmentFinanceScheduleService");
const { requestContext } = require("../middleware/requestContext");

function testAgreementPolicySnapshot() {
  const agreement = {
    policy_version_snapshot: "FIN-TERMS-7",
    late_charge_type_snapshot: "fixed",
    late_charge_value_snapshot: 250,
    late_charge_cap_snapshot: 500,
    grace_days_snapshot: 3,
  };
  const policy = agreementLateFeePolicy(agreement);
  assert.strictEqual(policy.version, "FIN-TERMS-7");
  assert.strictEqual(policy.type, "fixed");
  assert.strictEqual(policy.value, 250);
  assert.strictEqual(policy.cap, 500);
  assert.strictEqual(policy.graceDays, 3);
  assert.strictEqual(policy.legacyReviewRequired, false);
}

function testLegacyAgreementDoesNotAdvertiseAnUnverifiedFee() {
  const agreement = {
    policy_version_snapshot: "LEGACY-REVIEW-FIN-TERMS-1",
    late_charge_type_snapshot: "fixed",
    late_charge_value_snapshot: 250,
    late_charge_cap_snapshot: 500,
  };
  assert.strictEqual(calculateProspectiveLateFee({ agreement, overdueBalance: 1000, alreadyApplied: 0 }), 0);
}

function testNoSecondLateFeeWarningAfterAppliedCharge() {
  const agreement = {
    policy_version_snapshot: "FIN-TERMS-7",
    late_charge_type_snapshot: "fixed",
    late_charge_value_snapshot: 250,
    late_charge_cap_snapshot: 500,
  };
  assert.strictEqual(calculateProspectiveLateFee({ agreement, overdueBalance: 1000, alreadyApplied: 250 }), 0);
  assert.strictEqual(calculateProspectiveLateFee({ agreement, overdueBalance: 1000, alreadyApplied: 0 }), 250);
}

function testLateFeeApplicationCalculator() {
  assert.strictEqual(calculateFee({ type: "fixed", value: 250, cap: 500, legacyReviewRequired: false }, 1000), 250);
  assert.strictEqual(calculateFee({ type: "percentage", value: 10, cap: 75, legacyReviewRequired: false }, 1000), 75);
  assert.strictEqual(calculateFee({ type: "fixed", value: 250, cap: 500, legacyReviewRequired: true }, 1000), 0);
}

function testNextDueUsesOnlyUnpaidCurrentOrFutureRows() {
  const next = nextDueFromSchedule([
    { sequence_number: 1, due_date: "2001-08-19", scheduled_amount: 1000, late_charge_amount: 0, waived_charge_amount: 0, amount_paid: 0 },
    { sequence_number: 2, due_date: "2026-09-19", scheduled_amount: 1000, late_charge_amount: 0, waived_charge_amount: 0, amount_paid: 0 },
  ], "2026-08-25");
  assert.strictEqual(next.row.sequence_number, 2);
  assert.strictEqual(next.dueDate, "2026-09-19");
}

function testScheduleExplainsDateAdjustments() {
  const schedule = buildFinanceSchedule({
    selling_price: 120000,
    deposit: 20000,
    payment_frequency: "monthly",
    installment_count: 3,
    first_due_date: "2026-08-30",
    non_working_day_rule: "next_weekday",
  });
  assert.ok(Array.isArray(schedule.calculation_policy.date_adjustments));
  assert.ok(schedule.calculation_policy.date_adjustments.length >= 1);
  assert.strictEqual(schedule.calculation_policy.date_adjustments[0].original_due_date, "2026-08-30");
  assert.notStrictEqual(schedule.calculation_policy.date_adjustments[0].adjusted_due_date, "2026-08-30");
}

function testLegacyApiIsExplicitlyRetired() {
  let status = null;
  let payload = null;
  const req = { path: "/api/installments/agreements", method: "GET", headers: {} };
  const res = {
    setHeader() {},
    status(code) { status = code; return this; },
    json(value) { payload = value; return this; },
  };
  requestContext(req, res, () => assert.fail("Legacy installment route must not reach next middleware."));
  assert.strictEqual(status, 410);
  assert.strictEqual(payload.code, "LEGACY_INSTALLMENT_API_RETIRED");
}

testAgreementPolicySnapshot();
testLegacyAgreementDoesNotAdvertiseAnUnverifiedFee();
testNoSecondLateFeeWarningAfterAppliedCharge();
testLateFeeApplicationCalculator();
testNextDueUsesOnlyUnpaidCurrentOrFutureRows();
testScheduleExplainsDateAdjustments();
testLegacyApiIsExplicitlyRetired();
console.log("Equipment Finance professional hardening tests passed.");
