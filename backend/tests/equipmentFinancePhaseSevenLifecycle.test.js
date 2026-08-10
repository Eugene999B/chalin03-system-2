const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const reconciliation = read(
  "backend",
  "services",
  "equipmentFinanceReconciliationService.js"
);
const lifecycle = read("backend", "routes", "equipmentFinanceFinalLifecycleRoutes.js");
const deposit = read("backend", "routes", "equipmentFinanceDepositReservationRoutes.js");
const delivery = read(
  "backend",
  "services",
  "equipmentFinanceDeliveryConfirmationService.js"
);
const reports = read("backend", "services", "equipmentFinancePhaseSixService.js");
const arrears = read("backend", "services", "equipmentFinanceArrearsService.js");
const readModel = read(
  "backend",
  "services",
  "equipmentInstallmentReadModelService.js"
);
const corrections = read(
  "backend",
  "services",
  "equipmentFinanceCorrectionService.js"
);
const professional = read(
  "backend",
  "services",
  "equipmentFinanceProfessionalService.js"
);
const exportsRoute = read(
  "backend",
  "routes",
  "equipmentFinanceExportPeriodRoutes.js"
);
const recovery = read(
  "backend",
  "services",
  "equipmentFinanceRecoveryGovernanceService.js"
);
const collectionsPage = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceCollectionsMinimalPage.jsx"
);
const finalLifecyclePage = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceFinalLifecyclePage.jsx"
);
const reportsPage = read(
  "frontend",
  "src",
  "pages",
  "EquipmentSalesReportsPage.jsx"
);
const operationsPage = read(
  "frontend",
  "src",
  "pages",
  "EquipmentFinanceOperationalPolishPage.jsx"
);
const legacySales = read("backend", "routes", "equipmentSalesRoutes.js");

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test("Phase 7 defines one evidence-based Finance reconciliation authority", () => {
  assert.match(reconciliation, /activation_source = 'approved_credit_application'/);
  assert.match(reconciliation, /payment\.is_voided = FALSE/);
  assert.match(reconciliation, /schedule\.schedule_status <> 'rescheduled'/);
  assert.match(reconciliation, /ledger\.direction = 'debit'/);
  assert.match(reconciliation, /ledger\.direction = 'credit'/);
  assert.match(
    reconciliation,
    /total_amount[\s\S]*late_charges[\s\S]*waived_charges[\s\S]*ledger_debits[\s\S]*amount_paid[\s\S]*ledger_credits/
  );
  assert.match(reconciliation, /EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED/);
  assert.match(reconciliation, /EQUIPMENT_FINANCE_POST_UPDATE_RECONCILIATION_FAILED/);
  assert.match(reconciliation, /reconcileFinancePortfolio/);
  assert.match(reconciliation, /allocatable_payment_amount/);
  assert.match(reconciliation, /schedule_allocation_evidence/);
});

test("critical Finance mutations fail closed and return post-trigger values", () => {
  assert.match(lifecycle, /assertFinanceMutationSafe/);
  assert.match(lifecycle, /refreshFinanceAgreementFromEvidence/);
  assert.match(deposit, /assertFinanceMutationSafe/);
  assert.match(deposit, /refreshFinanceAgreementFromEvidence/);
  assert.match(delivery, /assertFinanceMutationSafe/);
  assert.match(delivery, /refreshFinanceAgreementFromEvidence/);
  assert.match(corrections, /refreshFinanceAgreementFromEvidence/);
  assert.match(
    reconciliation,
    /UPDATE equipment_sale_agreements[\s\S]*const after = await reconcileFinanceAgreement[\s\S]*EQUIPMENT_FINANCE_POST_UPDATE_RECONCILIATION_FAILED/
  );
});

test("rescheduled schedule rows are never treated as collectible open installments", () => {
  for (const source of [lifecycle, reports, readModel]) {
    assert.doesNotMatch(source, /NOT IN \('paid','cancelled','waived'\)(?!,'rescheduled')/);
  }
  assert.match(readModel, /NOT IN \('paid','cancelled','waived','rescheduled'\)/);
});

test("portfolio and cash-flow collections are scoped to approved-credit Finance", () => {
  assert.ok(count(reports, /INNER JOIN equipment_sale_agreements agreement ON agreement\.id = payment\.agreement_id/g) >= 5);
  assert.ok(count(reports, /agreement\.sale_type = 'installment'/g) >= 7);
  assert.ok(count(reports, /agreement\.activation_source = 'approved_credit_application'/g) >= 7);
  assert.doesNotMatch(
    reports,
    /FROM equipment_sale_payments\s+WHERE is_voided = FALSE AND DATE\(payment_date\)/
  );
});

test("promise-to-pay status is backed by active receipts rather than notes or waivers", () => {
  assert.match(arrears, /loadPaymentEvidence/);
  assert.match(arrears, /payment\.is_voided = FALSE/);
  assert.match(arrears, /paymentBackedAmount/);
  assert.match(arrears, /paymentBackedAmount \+ 0\.01 >= promiseAmount/);
  assert.doesNotMatch(arrears, /newerSettlement/);
  assert.doesNotMatch(arrears, /outstanding <= targetOutstanding/);
});

test("Finance audit evidence no longer reads or writes the Hire workspace", () => {
  for (const source of [lifecycle, deposit, delivery, arrears, exportsRoute]) {
    assert.doesNotMatch(source, /workspaceCode:\s*"equipment_hire"/);
    assert.doesNotMatch(source, /workspace_code IN \([^)]*'equipment_hire'/);
  }
  assert.match(arrears, /activity\.workspace_code = \?/);
});

test("company-wide Finance exports tolerate null origin locations", () => {
  assert.match(exportsRoute, /LEFT JOIN business_locations bl/);
  assert.match(exportsRoute, /esa\.sale_type = 'installment'/);
  assert.match(exportsRoute, /esa\.activation_source = 'approved_credit_application'/);
  assert.doesNotMatch(exportsRoute, /WHERE \$\{location\.sql\}/);
});

test("official statements and documents expose reconciliation state", () => {
  assert.match(reports, /reconcileFinanceAgreement/);
  assert.match(reports, /reconciliation:\s*\{/);
  assert.match(professional, /reconcileFinanceAgreement/);
  assert.match(professional, /snapshot\.reconciliation\.consistent/);
  assert.match(professional, /EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED/);
});

test("reschedule and default decisions reconcile before and after governed changes", () => {
  assert.match(recovery, /assertFinanceMutationSafe/);
  assert.match(recovery, /refreshFinanceAgreementFromEvidence/);
  assert.match(recovery, /schedule_status = 'rescheduled'/);
  assert.match(recovery, /schedule_status IN \('upcoming','due','partial','overdue'\)/);
});

test("Finance staff see reconciliation warnings and blocked actions", () => {
  assert.match(collectionsPage, /finance-reconciliation-warning/);
  assert.match(collectionsPage, /detail\?\.reconciliation\?\.consistent === false/);
  assert.match(finalLifecyclePage, /final-lifecycle-reconciliation-warning/);
  assert.match(reportsPage, /statement-reconciliation-warning/);
  assert.match(reportsPage, /portfolio-reconciliation-warning/);
  assert.match(operationsPage, /operations-reconciliation-warning/);
});

test("the resilient read model is company-wide and has no silent 500-record truncation", () => {
  assert.match(readModel, /activation_source = 'approved_credit_application'/);
  assert.doesNotMatch(readModel, /Math\.min\(Number\(limit\)[\s\S]*500/);
  assert.doesNotMatch(readModel, /filtered\.slice\(0, Math\.max\(1, Math\.min/);
});


test("portfolio totals and lifecycle queues use batched reconciliation without image-heavy lists", () => {
  assert.match(reports, /reconcileFinancePortfolio/);
  assert.match(reports, /reconciliation_attention_count/);
  assert.match(lifecycle, /accountListSql/);
  assert.match(lifecycle, /reconcileFinancePortfolio/);
  const listSource = lifecycle.slice(lifecycle.indexOf("function accountListSql"), lifecycle.indexOf("async function getAccount"));
  assert.doesNotMatch(listSource, /main_image_url/);
  assert.doesNotMatch(lifecycle, /LIMIT 500/);
});

test("legacy Equipment Sales writes are fenced away from approved-credit Finance", () => {
  assert.match(legacySales, /function assertLegacyCommercialAgreement/);
  assert.match(legacySales, /activation_source === "approved_credit_application"/);
  assert.match(legacySales, /EQUIPMENT_FINANCE_CONTROLLED_WORKFLOW_REQUIRED/);
  assert.ok(count(legacySales, /assertLegacyCommercialAgreement\(agreement\)/g) >= 4);
});
