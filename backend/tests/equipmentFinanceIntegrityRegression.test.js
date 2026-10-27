"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { operationalize } = require("../services/equipmentFinanceReconciliationService");
const { buildReconciliation } = require("../services/equipmentFinanceReconciliationServiceBase");
const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const uiSource = (file) => fs.readFileSync(path.join(__dirname, "../../frontend/src", file), "utf8");

test("Finance reconciliation wrapper never turns a critical mismatch into a healthy account", () => {
  const initial = {
    agreement: { agreement_status: "active", created_at: "2026-10-01" },
    agreement_id: 22,
    calculated: { agreement_status: "active", next_due_date: null },
    evidence: {},
    consistent: false,
    mismatches: [{ field: "schedule_principal_total", severity: "critical" }],
  };
  const report = operationalize(initial, {}, null);
  assert.equal(report.consistent, false);
  assert.equal(report.collection_operational, false);
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.next_due_date, null);
  assert.equal(report.first_due_date, null);
  assert.equal(report.final_due_date, null);
});

test("Terminal Finance agreements have no next collection date despite stale schedule data", () => {
  const result = operationalize({
    agreement: { agreement_status: "completed", next_due_date: "2026-11-10" },
    calculated: { agreement_status: "completed", next_due_date: "2026-11-10" },
    consistent: true, mismatches: [],
  }, { next_due_date: "2026-11-10", first_due_date: "2026-01-10", final_due_date: "2026-11-10" });
  assert.equal(result.next_due_date, null);
  assert.equal(result.calculated.next_due_date, null);
  assert.equal(result.first_due_date, "2026-01-10");
  assert.equal(result.final_due_date, "2026-11-10");
});

test("Healthy Finance account retains its documented next unpaid schedule date", () => {
  const result = operationalize({
    agreement: { agreement_status: "active" },
    calculated: { agreement_status: "active" },
    consistent: true, mismatches: [],
  }, { next_due_date: "2026-11-05" });
  assert.equal(result.consistent, true);
  assert.equal(result.collection_operational, true);
  assert.equal(result.next_due_date, "2026-11-05");
});

test("Base Finance evidence catches corrupted principal and schedule identities", () => {
  const result = buildReconciliation({
    id: 4, agreement_number: "FIN-4", agreement_status: "active",
    total_amount: 1000, financed_amount: 900, deposit_required: 100,
    outstanding_balance: 1000, amount_paid: 0, next_due_date: null,
  }, {
    scheduled_amount: 700, schedule_line_count: 2, distinct_sequence_count: 1,
    amount_paid: 0, deposit_received: 0,
  });
  assert.equal(result.consistent, false);
  assert.ok(result.mismatches.some((item) => item.field === "schedule_principal_total" && item.severity === "critical"));
  assert.ok(result.mismatches.some((item) => item.field === "schedule_sequence_uniqueness" && item.severity === "critical"));
});

test("Finance mutation guard invokes the base critical-mismatch guard and verifies repair", () => {
  const guard = source("services/equipmentFinanceReconciliationService.js");
  assert.match(guard, /await base\.assertFinanceMutationSafe\(agreementId, options\)/);
  assert.match(guard, /filter\(\(item\) => item\.severity === "critical"\)/);
  assert.match(guard, /FINANCE_POST_UPDATE_RECONCILIATION_FAILED/);
  assert.doesNotMatch(guard, /consistent:\s*true/);
});

test("Finance reports fail closed on database errors and discard stale portfolio numbers", () => {
  const resilience = source("services/equipmentFinancePortfolioResilience.js");
  assert.match(resilience, /throw error;/);
  assert.match(resilience, /FINANCE_PORTFOLIO_UNAVAILABLE/);
  assert.doesNotMatch(resilience, /fallback_error_code:/);
  const reports = uiSource("pages/EquipmentSalesReportsPage.jsx");
  assert.match(reports, /setPortfolio\(null\)/);
  assert.match(reports, /portfolio\?\.reconciliation_warning/);
  assert.match(reports, /String\(account\.agreement_id\) === String\(selectedAgreementId\)/);
});

test("Finance schedule truth does not declare fully settled schedule lines due", () => {
  const truth = source("services/equipmentFinanceScheduleTruthService.js");
  assert.match(truth, /COALESCE\(s\.waived_charge_amount, 0\) > COALESCE\(s\.amount_paid, 0\) \+ 0\.009/);
});
