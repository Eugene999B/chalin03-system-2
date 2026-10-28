"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { activationCandidate } = require("../routes/equipmentFinanceAgreementActivationRoutes");

const baseCandidate = {
  id: 28, application_number: "ECAPP-028",
  application_status: "approved",
  customer_id: 5, customer_name: "Fixture Customer", customer_phone: "0240000000",
  quotation_id: 66, quotation_number: "EIO-066", quotation_status: "approved",
  quoted_total: 1000, proposed_deposit: 200, financed_amount: 800,
  proposed_frequency: "monthly", proposed_installment_count: 4,
  proposed_first_due_date: "2026-11-10", proposed_periodic_amount: 200,
  proposed_non_working_day_rule: "exact",
  asset_id: 8, asset_exists: 8, asset_is_active: 1,
  operational_purpose: "sale_only", sale_status: "available",
  quotation_item_id: 88, asset_code_snapshot: "EX-008",
  asset_name_snapshot: "Test excavator", asset_type_snapshot: "excavator",
  conflicting_agreement_exists: 0, agreement_id: null,
};

test("approved, available, uncontested Finance application can prepare agreement", () => {
  const result = activationCandidate(baseCandidate);
  assert.equal(result.activation_ready, true);
  assert.deepEqual(result.activation_blockers, []);
  assert.equal(result.periodic_amount, 200);
});

test("Finance activation explains every active business blocker before creation", () => {
  const result = activationCandidate({
    ...baseCandidate,
    quotation_status: "draft",
    customer_phone: null,
    sale_status: "reserved",
    asset_type_snapshot: "",
    conflicting_agreement_exists: 1,
  });
  assert.equal(result.activation_ready, false);
  const joined = result.activation_blockers.join(" | ");
  assert.match(joined, /quotation is draft/);
  assert.match(joined, /telephone number is missing/);
  assert.match(joined, /sale status is reserved/);
  assert.match(joined, /identity snapshot/);
  assert.match(joined, /another Finance agreement/);
});

test("missing Finance links remain visible as blocked rather than vanishing from the register", () => {
  const result = activationCandidate({
    ...baseCandidate,
    quotation_id: null, quotation_number: null, asset_id: null,
    asset_exists: null, quotation_item_id: null,
  });
  assert.equal(result.activation_ready, false);
  assert.ok(result.activation_blockers.some((reason) => /no linked Finance quotation/.test(reason)));
  assert.ok(result.activation_blockers.some((reason) => /no longer exists/.test(reason)));
});

test("approved but irreconcilable payment schedule cannot prepare agreement", () => {
  const result = activationCandidate({
    ...baseCandidate, financed_amount: 900,
  });
  assert.equal(result.activation_ready, false);
  assert.ok(result.activation_blockers.some((reason) => /financed amount does not reconcile/.test(reason)));
});

test("agreement activation preflight never bypasses atomic creation safeguards", () => {
  const route = fs.readFileSync(path.join(__dirname,"../routes/equipmentFinanceAgreementActivationRoutes.js"),"utf8");
  assert.match(route, /EXISTS \(/);
  assert.match(route, /LEFT JOIN fleet_assets asset/);
  assert.match(route, /LEFT JOIN hire_customers customer/);
  assert.match(route, /AND existing\.agreement_status NOT IN/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /assertActivationOfficer\(req\)/);
  assert.match(route, /termsAccepted !== true/);
  assert.doesNotMatch(route, /UPDATE fleet_assets/);
});

test("Prepare Agreement page explains disabled buttons and displays the actual 409 inside the dialog", () => {
  const ui = fs.readFileSync(path.join(__dirname,"../../frontend/src/pages/EquipmentFinanceAgreementActivationPage.jsx"),"utf8");
  assert.match(ui, /Why this application cannot proceed/);
  assert.match(ui, /activation_blockers/);
  assert.match(ui, /Resolve blockers first/);
  assert.match(ui, /Reference: \$\{code\}/);
  assert.match(ui, /role="alert">\{problem\}/);
});

test("Active sale lock is surfaced before the database trigger can reject activation", () => {
  const result = activationCandidate({ ...baseCandidate, active_sale_lock_exists: 1 });
  assert.equal(result.activation_ready, false);
  assert.match(result.activation_blockers.join(" "), /active sale or installment reservation lock/);
});

test("Approved critical-risk applications and historical due dates carry warnings without rewriting approvals", () => {
  const result = activationCandidate({
    ...baseCandidate,
    created_at: "2026-10-26T10:00:00.000Z",
    proposed_first_due_date: "2026-10-24",
    affordability_status: "not_assessed",
    risk_band: "critical",
  });
  assert.equal(result.activation_ready, true);
  assert.match(result.activation_advisories.join(" "), /first installment due date predates the application/);
  assert.match(result.activation_advisories.join(" "), /Affordability has not been assessed or credit risk is critical/);
});

test("MySQL DATETIME objects do not create false historical-due warnings", () => {
  const result = activationCandidate({
    ...baseCandidate,
    created_at: new Date("2026-10-26T12:00:00.000Z"),
    proposed_first_due_date: "2026-11-10",
  });
  assert.equal(result.activation_advisories.some((warning) => /predates the application/.test(warning)), false);
});

test("MySQL DATETIME objects flag genuinely earlier first due dates", () => {
  const result = activationCandidate({
    ...baseCandidate,
    created_at: new Date("2026-10-26T12:00:00.000Z"),
    proposed_first_due_date: "2026-10-24",
  });
  assert.equal(result.activation_advisories.some((warning) => /predates the application/.test(warning)), true);
});
