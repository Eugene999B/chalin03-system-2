const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  FinanceScheduleError,
  buildFinanceSchedule,
  dateValue,
} = require("../services/equipmentFinanceScheduleService");
const {
  buildReconciliation,
} = require("../services/equipmentFinanceReconciliationService");
const {
  validChecksum,
  verificationToken,
  verificationUrl,
} = require("../services/equipmentFinanceVerificationService");
const {
  deliveryReplayMatches,
  ownershipReplayMatches,
  realDate,
} = require("../middleware/equipmentFinanceLifecycleIntegrityGuard");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

function criticalFields(result) {
  return result.mismatches
    .filter((entry) => entry.severity === "critical")
    .map((entry) => entry.field);
}

function baseAgreement(overrides = {}) {
  return {
    id: 10,
    agreement_number: "EFA-TEST-001",
    sale_type: "installment",
    activation_source: "approved_credit_application",
    agreement_status: "approved",
    equipment_commitment_status: "not_reserved",
    total_amount: 1000,
    deposit_required: 200,
    financed_amount: 800,
    amount_paid: 0,
    deposit_received: 0,
    late_charges_total: 0,
    waived_charges_total: 0,
    outstanding_balance: 1000,
    overdue_amount: 0,
    first_due_date: "2026-08-10",
    next_due_date: null,
    final_due_date: "2026-11-10",
    ...overrides,
  };
}

function baseEvidence(overrides = {}) {
  return {
    amount_paid: 0,
    deposit_received: 0,
    allocatable_payment_amount: 0,
    active_payment_count: 0,
    scheduled_amount: 800,
    schedule_amount_paid: 0,
    late_charges: 0,
    waived_charges: 0,
    overdue_amount: 0,
    next_due_date: null,
    oldest_overdue_date: null,
    first_schedule_due_date: "2026-08-10",
    final_schedule_due_date: "2026-11-10",
    schedule_line_count: 4,
    distinct_sequence_count: 4,
    non_positive_schedule_count: 0,
    rescheduled_line_count: 0,
    active_allocated_amount: 0,
    voided_allocated_amount: 0,
    rescheduled_allocated_amount: 0,
    cross_agreement_allocation_count: 0,
    negative_allocation_count: 0,
    ledger_debits: 0,
    ledger_credits: 0,
    ...overrides,
  };
}

test("Finance QR payload is now a stable Chalin 03 online verification URL", () => {
  const document = {
    id: 91,
    document_number: "EFA-DOC-091",
    snapshot_checksum:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };
  const token = verificationToken(document);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(token, verificationToken({ ...document }));
  assert.equal(
    verificationUrl(document),
    `https://chalin03.com/api/finance-verification/91/${token}`
  );
  assert.equal(validChecksum(document.snapshot_checksum), true);
  assert.equal(validChecksum("not-a-checksum"), false);
});

test("Finance document design no longer emits the old raw QR text payload", () => {
  const design = read(
    "backend",
    "services",
    "equipmentFinanceDocumentDesignV2Service.js"
  );
  assert.match(design, /verificationUrl\(document\)/);
  assert.doesNotMatch(design, /CHALIN03-FINANCE-LOGO-LED-V3/);
});

test("public Finance verifier is read-only, rate limited and privacy masking is explicit", () => {
  const route = read(
    "backend",
    "routes",
    "equipmentFinancePublicVerificationRoutes.js"
  );
  const service = read(
    "backend",
    "services",
    "equipmentFinanceVerificationService.js"
  );
  assert.match(route, /verificationLimiter/);
  assert.match(route, /Cache-Control", "no-store/);
  assert.match(route, /sensitive identity and contact information/i);
  assert.match(route, /issuance fingerprint/i);
  assert.match(service, /maskName/);
  assert.match(service, /maskPhone/);
  assert.match(service, /maskSerial/);
  assert.match(service, /checksum_bound/);
  assert.match(service, /issuance_fingerprint_bound_to_qr_reference/);
  assert.match(service, /superseded/);
  assert.match(service, /revoked/);
});

test("weekend adjustment cannot collapse multiple custom installments onto one date", () => {
  const result = buildFinanceSchedule({
    selling_price: 1000,
    deposit: 100,
    payment_frequency: "custom",
    custom_interval_days: 1,
    installment_count: 4,
    first_due_date: "2026-08-08",
    non_working_day_rule: "next_weekday",
  });
  const dates = result.schedule.map((row) => row.due_date);
  assert.deepEqual(dates, [...new Set(dates)]);
  for (let index = 1; index < dates.length; index += 1) {
    assert.ok(dates[index] > dates[index - 1]);
  }
  assert.ok(result.calculation_policy.collision_adjustments >= 1);
  assert.equal(result.calculation_policy.duplicate_due_dates_allowed, false);
});

test("company non-working dates are honored in addition to weekends", () => {
  const result = buildFinanceSchedule({
    selling_price: 900,
    deposit: 100,
    payment_frequency: "weekly",
    installment_count: 2,
    first_due_date: "2026-08-10",
    non_working_day_rule: "next_weekday",
    non_working_dates: ["2026-08-10"],
  });
  assert.equal(result.schedule[0].due_date, "2026-08-11");
  assert.equal(result.calculation_policy.company_non_working_dates_supported, true);
});

test("Finance schedule rejects impossible dates and past activation dates when a minimum is supplied", () => {
  assert.equal(dateValue("2026-02-30"), null);
  assert.throws(
    () =>
      buildFinanceSchedule({
        selling_price: 1000,
        deposit: 100,
        payment_frequency: "monthly",
        installment_count: 3,
        first_due_date: "2026-08-06",
        minimum_first_due_date: "2026-08-07",
        non_working_day_rule: "exact",
      }),
    (error) =>
      error instanceof FinanceScheduleError &&
      error.code === "FINANCE_FIRST_DUE_DATE_IN_PAST"
  );
});

test("reconciliation treats schedule principal not matching financed principal as critical", () => {
  const result = buildReconciliation(
    baseAgreement(),
    baseEvidence({ scheduled_amount: 799 })
  );
  assert.ok(criticalFields(result).includes("schedule_principal_total"));
});

test("reconciliation treats total != deposit + financed principal as critical", () => {
  const result = buildReconciliation(
    baseAgreement({ financed_amount: 750 }),
    baseEvidence({ scheduled_amount: 750 })
  );
  assert.ok(criticalFields(result).includes("agreement_principal_identity"));
});

test("reconciliation rejects duplicate sequence evidence and cross-agreement allocations", () => {
  const result = buildReconciliation(
    baseAgreement(),
    baseEvidence({
      schedule_line_count: 4,
      distinct_sequence_count: 3,
      cross_agreement_allocation_count: 1,
    })
  );
  const fields = criticalFields(result);
  assert.ok(fields.includes("schedule_sequence_uniqueness"));
  assert.ok(fields.includes("cross_agreement_payment_allocations"));
});

test("lifecycle guard validates real dates and exact idempotency replay details", () => {
  assert.equal(realDate("2026-02-30"), null);
  assert.equal(realDate("2026-08-07"), "2026-08-07");
  assert.equal(
    deliveryReplayMatches(
      {
        condition_status: "good",
        meter_reading: 1200,
        fuel_level_percent: 50,
        receiving_person: "Kwame Mensah",
      },
      {
        condition_status: "good",
        meter_reading: "1200.00",
        fuel_level_percent: "50",
        receiving_person: "Kwame Mensah",
      }
    ),
    true
  );
  assert.equal(
    deliveryReplayMatches(
      {
        condition_status: "good",
        meter_reading: 1200,
        fuel_level_percent: 50,
        receiving_person: "Kwame Mensah",
      },
      {
        condition_status: "damaged",
        meter_reading: 1200,
        fuel_level_percent: 50,
        receiving_person: "Kwame Mensah",
      }
    ),
    false
  );
  assert.equal(
    ownershipReplayMatches(
      { transfer_date: "2026-08-07", registration_transfer_reference: "DVLA-44" },
      { transfer_date: "2026-08-07", registration_transfer_reference: "DVLA-44" }
    ),
    true
  );
});

test("activation and document issue controls are mounted before financial mutations", () => {
  const reminderService = read(
    "backend",
    "services",
    "equipmentSalesReminderService.js"
  );
  const activationGuard = read(
    "backend",
    "middleware",
    "equipmentFinanceActivationIntegrityGuard.js"
  );
  const documentRoutes = read(
    "backend",
    "routes",
    "equipmentFinanceDocumentCompletionRoutes.js"
  );
  assert.match(reminderService, /equipmentFinanceActivationIntegrityGuard/);
  assert.match(reminderService, /equipmentFinanceLifecycleIntegrityGuard/);
  assert.match(activationGuard, /evaluateCreditApplication/);
  assert.match(activationGuard, /AFFORDABILITY_RECHECK_FAILED/);
  assert.match(activationGuard, /FIRST_DUE_DATE_PASSED/);
  assert.match(documentRoutes, /EXECUTIVE_ISSUE_ROLES/);
  assert.match(documentRoutes, /LEGAL_ISSUE_ROLES/);
  assert.match(documentRoutes, /EQUIPMENT_FINANCE_DOCUMENT_ISSUE_ROLE_REQUIRED/);
});
