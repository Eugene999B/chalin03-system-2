"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { activationCandidate } = require("../routes/equipmentFinanceAgreementActivationRoutes");
const { REVIEW_TRANSITIONS, assertNewScheduleDate } = require("../routes/equipmentFinancePhaseThreeWorkflowRoutes");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const sample = {
  id: 28, application_number: "ECAPP-FIXTURE-28",
  application_status: "approved", created_at: new Date("2026-10-26T12:00:00Z"),
  customer_id: 21, customer_name: "Fixture", customer_phone: "0240000000",
  quotation_id: 31, quotation_number: "EIO-FIXTURE", quotation_status: "approved",
  quotation_first_due_date: "2025-10-24",
  quoted_total: 1800000, proposed_deposit: 1750000,
  financed_amount: 50000, proposed_frequency: "weekly",
  proposed_installment_count: 1, proposed_first_due_date: "2025-10-24",
  proposed_periodic_amount: 50000, proposed_non_working_day_rule: "exact",
  asset_id: 22, asset_exists: 22, asset_is_active: 1, asset_code_snapshot: "EXC-022",
  operational_purpose: "sale_only", sale_status: "available",
  quotation_item_id: 3, asset_name_snapshot: "Excavator", asset_type_snapshot: "excavator",
  conflicting_agreement_exists: 0, active_sale_lock_exists: 0, agreement_id: null,
};

test("Past first due date is a hard blocker rather than a nonblocking advisory", () => {
  const candidate = activationCandidate(sample);
  assert.equal(candidate.activation_ready, false);
  assert.equal(candidate.correction_required, true);
  assert.match(candidate.activation_blockers.join(" "), /2025-10-24/);
  assert.match(candidate.activation_blockers.join(" "), /reapprove the current schedule/);
});

test("Mismatched approved application and quotation dates are visibly blocked", () => {
  const candidate = activationCandidate({
    ...sample, proposed_first_due_date: "2026-12-01", quotation_first_due_date: "2026-11-30",
  });
  assert.equal(candidate.activation_ready, false);
  assert.equal(candidate.correction_required, true);
  assert.match(candidate.activation_blockers.join(" "), /different first installment dates/);
});

test("Fresh valid approved dates can reach the agreement review step", () => {
  const candidate = activationCandidate({
    ...sample,
    proposed_first_due_date: "2099-11-10",
    quotation_first_due_date: "2099-11-10",
  });
  assert.equal(candidate.activation_ready, true);
  assert.equal(candidate.correction_required, false);
});

test("Approval gate enforces current date and application creation chronology", () => {
  assert.throws(
    () => assertNewScheduleDate({ proposed_first_due_date: "2025-10-24", created_at: "2026-10-26" }, "2026-10-28"),
    (error) => error.code === "EQUIPMENT_FINANCE_APPROVAL_FIRST_DUE_INVALID"
  );
  assert.doesNotThrow(() =>
    assertNewScheduleDate({ proposed_first_due_date: "2026-11-10", created_at: "2026-10-26" }, "2026-10-28")
  );
  assert.throws(
    () => assertNewScheduleDate({ proposed_first_due_date: "2026-10-28", created_at: "2026-10-29" }, "2026-10-28"),
    (error) => error.statusCode === 409
  );
});

test("Only approved, unactivated applications can be returned for audited correction", () => {
  assert.equal(REVIEW_TRANSITIONS.request_approved_correction.to, "changes_requested");
  assert.equal(REVIEW_TRANSITIONS.request_approved_correction.from.has("approved"), true);
  assert.equal(REVIEW_TRANSITIONS.request_approved_correction.from.has("submitted"), false);
  const code = read("routes/equipmentFinancePhaseThreeWorkflowRoutes.js");
  assert.match(code, /action === "request_approved_correction"/);
  assert.match(code, /SELECT id FROM equipment_sale_agreements WHERE credit_application_id = \? LIMIT 1 FOR UPDATE/);
  assert.match(code, /EQUIPMENT_FINANCE_APPROVED_CORRECTION_AGREEMENT_EXISTS/);
  assert.match(code, /requires_fresh_manager_approval: true/);
  assert.match(code, /customer_schedule_confirmation_required: true/);
  assert.match(code, /recordDecision\(/);
});

test("Staff can navigate directly from blocked preparation to application review and reapproval", () => {
  const activation = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/EquipmentFinanceAgreementActivationPage.jsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/EquipmentFinanceApplicationsPage.jsx"), "utf8");
  assert.match(activation, /Return for schedule correction/);
  assert.match(activation, /stage=applications-core&application=/);
  assert.match(app, /request_approved_correction/);
  assert.match(app, /Return approval for correction/);
  assert.match(app, /customer’s confirmation of corrected terms/);
});

test("New Finance offers and resubmitted drafts enforce valid current due dates", () => {
  assert.match(read("routes/equipmentFinancePhaseOneRoutes.js"), /minimum_first_due_date: today\(\)/);
  assert.match(read("routes/equipmentFinanceDraftRecoveryRoutes.js"), /minimum_first_due_date:/);
});
