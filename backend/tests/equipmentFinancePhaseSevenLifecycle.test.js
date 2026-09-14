const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const reconciliation = read("backend", "services", "equipmentFinanceReconciliationService.js");
const reconciliationBase = read("backend", "services", "equipmentFinanceReconciliationServiceBase.js");
const lifecycle = read("backend", "routes", "equipmentFinanceFinalLifecycleRoutes.js");
const deposit = read("backend", "routes", "equipmentFinanceDepositReservationRoutes.js");
const delivery = read("backend", "services", "equipmentFinanceDeliveryConfirmationService.js");
const reports = read("backend", "services", "equipmentFinancePhaseSixService.js");
const arrears = read("backend", "services", "equipmentFinanceArrearsService.js");
const readModel = read("backend", "services", "equipmentInstallmentReadModelService.js");
const corrections = read("backend", "services", "equipmentFinanceCorrectionService.js");
const professional = read("backend", "services", "equipmentFinanceProfessionalService.js");
const exportsRoute = read("backend", "routes", "equipmentFinanceExportPeriodRoutes.js");
const recovery = read("backend", "services", "equipmentFinanceRecoveryGovernanceService.js");
const collectionsPage = read("frontend", "src", "pages", "EquipmentFinanceCollectionsMinimalPage.jsx");
const finalLifecyclePage = read("frontend", "src", "pages", "EquipmentFinanceFinalLifecyclePage.jsx");
const reportsPage = read("frontend", "src", "pages", "EquipmentSalesReportsPage.jsx");
const operationsPage = read("frontend", "src", "pages", "EquipmentFinanceOperationalPolishPage.jsx");
const legacySales = read("backend", "routes", "equipmentSalesRoutes.js");

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

test("Phase 7 defines one evidence-based Finance reconciliation authority", () => {
  assert.match(reconciliation, /require\("\.\/equipmentFinanceReconciliationServiceBase"\)/);
  assert.match(reconciliationBase, /activation_source\s*=\s*'approved_credit_application'/);
  assert.match(reconciliationBase, /payment\.is_voided = FALSE/);
  assert.match(reconciliationBase, /schedule\.schedule_status/);
  assert.match(reconciliationBase, /ledger\.direction = 'debit'/);
  assert.match(reconciliationBase, /ledger\.direction = 'credit'/);
  assert.match(reconciliationBase, /total_amount[\s\S]*late_charges[\s\S]*waived_charges[\s\S]*ledger_debits[\s\S]*amount_paid[\s\S]*ledger_credits/);
  assert.match(reconciliationBase, /EQUIPMENT_FINANCE_RECONCILIATION_REQUIRED/);
  assert.match(reconciliationBase, /reconcileFinancePortfolio/);
  assert.match(reconciliationBase, /allocatable_payment_amount/);
  assert.match(reconciliationBase, /schedule_allocation_evidence/);
  assert.match(reconciliation, /getAgreementScheduleTruth/);
  assert.match(reconciliation, /getPortfolioScheduleTruth/);
});

test("critical Finance mutations fail closed and return authoritative values", () => {
  assert.match(lifecycle, /assertFinanceMutationSafe/);
  assert.match(lifecycle, /refreshFinanceAgreementFromEvidence/);
  assert.match(deposit, /loadControlledDepositEvidence/);
  assert.match(deposit, /EQUIPMENT_FINANCE_DEPOSIT_EVIDENCE_RECONCILIATION_REQUIRED/);
  assert.match(deposit, /FOR UPDATE/);
  assert.match(delivery, /assertFinanceMutationSafe/);
  assert.match(delivery, /refreshFinanceAgreementFromEvidence/);
  assert.match(corrections, /refreshFinanceAgreementFromEvidence/);
  assert.match(reconciliation, /UPDATE equipment_sale_agreements/);
  assert.match(reconciliation, /values\.first_schedule_due_date/);
  assert.match(reconciliation, /values\.next_due_date/);
  assert.match(reconciliation, /values\.final_schedule_due_date/);
  assert.match(reconciliation, /return reconcileFinanceAgreement\(agreementId, \{ connection, lock: false \}\)/);
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
  assert.doesNotMatch(reports, /FROM equipment_sale_payments\s+WHERE is_voided = FALSE AND DATE\(payment_date\)/);
});
