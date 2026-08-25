const assert = require("assert");
const { agreementLateFeePolicy, calculateProspectiveLateFee, nextDueFromSchedule } = require("../services/equipmentFinanceAuthoritativePolicyService");

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
  assert.strictEqual(
    calculateProspectiveLateFee({ agreement, overdueBalance: 1000, alreadyApplied: 0 }),
    0
  );
}

function testNoSecondLateFeeWarningAfterAppliedCharge() {
  const agreement = {
    policy_version_snapshot: "FIN-TERMS-7",
    late_charge_type_snapshot: "fixed",
    late_charge_value_snapshot: 250,
    late_charge_cap_snapshot: 500,
  };
  assert.strictEqual(
    calculateProspectiveLateFee({ agreement, overdueBalance: 1000, alreadyApplied: 250 }),
    0
  );
  assert.strictEqual(
    calculateProspectiveLateFee({ agreement, overdueBalance: 1000, alreadyApplied: 0 }),
    250
  );
}

function testNextDueUsesOnlyUnpaidCurrentOrFutureRows() {
  const next = nextDueFromSchedule([
    { sequence_number: 1, due_date: "2001-08-19", scheduled_amount: 1000, late_charge_amount: 0, waived_charge_amount: 0, amount_paid: 0 },
    { sequence_number: 2, due_date: "2026-09-19", scheduled_amount: 1000, late_charge_amount: 0, waived_charge_amount: 0, amount_paid: 0 },
  ], "2026-08-25");
  assert.strictEqual(next.row.sequence_number, 2);
  assert.strictEqual(next.dueDate, "2026-09-19");
}

testAgreementPolicySnapshot();
testLegacyAgreementDoesNotAdvertiseAnUnverifiedFee();
testNoSecondLateFeeWarningAfterAppliedCharge();
testNextDueUsesOnlyUnpaidCurrentOrFutureRows();
console.log("Equipment Finance professional hardening tests passed.");
