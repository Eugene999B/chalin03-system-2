"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FINANCE_SOURCE_BASE_COMMIT = "6956c7e76e2db62a411eb3727a9ca8e86a1ad38f";

const FINANCE_RUNTIME_FILES = Object.freeze([
  "services/aiEquipmentFinanceIntelligenceService.js",
  "ai-tools/equipmentFinanceTools.js",
  "services/equipmentFinancePhaseSixService.js",
  "services/equipmentFinanceReconciliationService.js",
  "routes/equipmentFinanceIndependentRoutes.js",
]);

const EQUIPMENT_FINANCE_EXPERT_PACK = Object.freeze({
  key: "equipment_finance_operations",
  title: "Equipment Installment Finance, Portfolio & Collections Intelligence",
  version: "2026-08-11-source-derived-v1",
  authority: "verified_current_source_contract",
  reviewed_source_lineage: "chalin-one Equipment Finance lifecycle, reporting and AI intelligence runtime",
  verified_release_commit: FINANCE_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "docs/EQUIPMENT_FINANCE_AGREEMENT_ACTIVATION_RUNBOOK.md",
    "docs/EQUIPMENT_FINANCE_DEPOSIT_RESERVATION_PRODUCTION_RUNBOOK.md",
    "docs/EQUIPMENT_FINANCE_FINAL_LIFECYCLE_PRODUCTION_RUNBOOK.md",
    "docs/EQUIPMENT_HIRE_FINANCE_CONTEXT_SEPARATION.md",
    "backend/services/aiEquipmentFinanceIntelligenceService.js",
    "backend/services/equipmentFinancePhaseSixService.js",
    "backend/services/equipmentFinanceReconciliationService.js",
    "backend/ai-tools/equipmentFinanceTools.js",
    "backend/routes/equipmentFinanceIndependentRoutes.js",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "company_wide_finance_scope",
      statement:
        "Equipment Installment Finance uses a company-wide Finance operating scope inside the Equipment workspace. Finance intelligence does not require the Equipment Hire active-location selection, even though Hire and Finance share machine identity.",
      source_basis: Object.freeze([
        "aiEquipmentFinanceIntelligenceService safe scope",
        "equipmentFinanceTools required_equipment_division",
        "docs/EQUIPMENT_HIRE_FINANCE_CONTEXT_SEPARATION.md",
      ]),
    }),
    Object.freeze({
      key: "credit_application_pipeline",
      statement:
        "The Finance application pipeline separates draft/submitted/under-review/changes-requested/approved/declined/withdrawn applications plus KYC, affordability and risk status. An approved application is a credit decision stage; it is not itself an activated agreement, a collected deposit or a reserved machine.",
      source_basis: Object.freeze([
        "aiEquipmentFinanceIntelligenceService.loadApplicationPipeline",
        "docs/EQUIPMENT_FINANCE_AGREEMENT_ACTIVATION_RUNBOOK.md",
      ]),
    }),
    Object.freeze({
      key: "agreement_activation_boundary",
      statement:
        "Agreement activation creates the approved Finance agreement and installment schedule from an independently approved credit application. Activation alone does not collect money, reserve the machine, create delivery evidence, transfer ownership or send SMS.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_FINANCE_AGREEMENT_ACTIVATION_RUNBOOK.md",
      ]),
    }),
    Object.freeze({
      key: "deposit_reservation_boundary",
      statement:
        "A partial opening deposit records Finance payment/receipt evidence and updates Finance balances but does not reserve the machine. Reservation occurs only after the full required deposit is covered and an authorized Finance operator explicitly confirms reservation.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_FINANCE_DEPOSIT_RESERVATION_PRODUCTION_RUNBOOK.md",
      ]),
    }),
    Object.freeze({
      key: "controlled_final_lifecycle",
      statement:
        "Approved-credit Finance lifecycle continues through installment collections and receipts, controlled delivery handover and final ownership transfer. Delivery remains gated by the approved delivery threshold, and ownership transfer remains blocked while any Finance balance remains.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_FINANCE_FINAL_LIFECYCLE_PRODUCTION_RUNBOOK.md",
      ]),
    }),
    Object.freeze({
      key: "portfolio_accounting_boundaries",
      statement:
        "Finance portfolio value is aggregate agreement value, collections are recorded cash receipts, outstanding balance is unpaid portfolio balance, and overdue/arrears are delinquency evidence. These measures should not be added together or treated as certified profit. Deposit received is part of the agreement payment state rather than an extra amount to add on top of total collections.",
      source_basis: Object.freeze([
        "equipmentFinancePhaseSixService.getPortfolioDashboard",
        "docs/EQUIPMENT_FINANCE_DEPOSIT_RESERVATION_PRODUCTION_RUNBOOK.md partial deposit behaviour",
      ]),
    }),
    Object.freeze({
      key: "arrears_outstanding_boundary",
      statement:
        "Outstanding balance covers unpaid Finance balance generally. Arrears/overdue amount is the past-due portion calculated from open installment schedule obligations. Overdue should therefore be treated as a subset/condition of outstanding exposure rather than a second independent balance to add to it.",
      source_basis: Object.freeze([
        "equipmentFinancePhaseSixService.getPortfolioDashboard",
        "equipmentFinancePhaseSixService.getArrearsReport",
      ]),
    }),
    Object.freeze({
      key: "cashflow_reference_boundary",
      statement:
        "Finance cash-flow health compares actual collections with open scheduled amounts in the selected period. That ratio is a cash-conversion reference, not automatically an accounting collection rate, revenue margin or profit measure, because actual receipts and open schedule obligations represent different payment/lifecycle events.",
      source_basis: Object.freeze([
        "aiEquipmentFinanceIntelligenceService.loadCashFlowHealth",
        "equipmentFinancePhaseSixService.getCashFlowReport",
      ]),
    }),
    Object.freeze({
      key: "reconciliation_control",
      statement:
        "Portfolio reporting includes reconciliation-consistency evidence. Agreements requiring reconciliation attention are a control exception and should be investigated before management relies on their derived balances as clean Finance performance evidence.",
      source_basis: Object.freeze([
        "equipmentFinancePhaseSixService.getPortfolioDashboard",
        "equipmentFinanceReconciliationService",
      ]),
    }),
    Object.freeze({
      key: "sales_inventory_boundary",
      statement:
        "Finance sales pipeline can see aggregate sale-capable fleet availability, held-for-finance status, sold status and maintenance/breakdown counts. Those machine counts are inventory/lifecycle signals; they do not themselves prove credit demand, collections performance or Finance profit.",
      source_basis: Object.freeze([
        "aiEquipmentFinanceIntelligenceService.loadSalesInventory",
      ]),
    }),
    Object.freeze({
      key: "hire_finance_machine_separation",
      statement:
        "Equipment Hire and Installment Finance share machine identity only. Finance does not create Hire enquiries, quotations, contracts, jobs, invoices, payments or returns, and controlled Finance reservation/delivery/ownership actions must not conflict with an active Hire assignment for the same machine.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_FINANCE_FINAL_LIFECYCLE_PRODUCTION_RUNBOOK.md",
        "docs/EQUIPMENT_FINANCE_DEPOSIT_RESERVATION_PRODUCTION_RUNBOOK.md",
        "docs/EQUIPMENT_HIRE_FINANCE_CONTEXT_SEPARATION.md",
      ]),
    }),
    Object.freeze({
      key: "aggregate_privacy_boundary",
      statement:
        "Current Finance AI tools expose company-wide aggregate portfolio, arrears, cash-flow and application/inventory evidence without customer-row identities. Applicant/customer-level records remain outside these aggregate read-only tools.",
      source_basis: Object.freeze([
        "aiEquipmentFinanceIntelligenceService customer_rows_exposed=false",
        "equipmentFinanceTools confidential aggregate evidence",
      ]),
    }),
  ]),
  workflows: Object.freeze([
    Object.freeze({
      key: "credit_to_activation",
      path: "Sales Opportunity/Quotation -> Credit Application -> KYC/Affordability/Risk -> Independent Review/Approval -> Agreement Activation",
      interpretation:
        "Keep credit decision, agreement creation and later money/machine commitment as separate controlled stages. Approved applications are not yet activated accounts.",
    }),
    Object.freeze({
      key: "activation_to_reservation",
      path: "Activated Agreement -> Opening Deposit -> Full Deposit Coverage -> Explicit Machine Reservation",
      interpretation:
        "Partial deposit is a Finance receipt, not a machine reservation. Reservation is a later explicit control after the deposit threshold is satisfied.",
    }),
    Object.freeze({
      key: "collections_to_settlement",
      path: "Installment Schedule -> Collections/Receipts -> Allocation/Reconciliation -> Outstanding/Arrears Review -> Final Settlement",
      interpretation:
        "Collections reduce the account balance; arrears isolate delinquency. Reconciliation exceptions must be resolved before balances are treated as clean management evidence.",
    }),
    Object.freeze({
      key: "delivery_to_ownership",
      path: "Approved Delivery Threshold -> Delivery Handover -> Remaining Collections -> Zero Balance -> Ownership Transfer",
      interpretation:
        "Delivery and ownership are distinct lifecycle gates. Delivery does not mean the customer owns the machine, and ownership transfer remains blocked while a balance remains.",
    }),
    Object.freeze({
      key: "finance_performance",
      path: "Application/KYC/Risk Pipeline + Sale Inventory + Portfolio/Collections + Arrears/Aging + Reconciliation -> Finance Performance Diagnosis",
      interpretation:
        "Diagnose conversion, inventory availability, cash conversion, delinquency and ledger integrity separately. Do not invent Finance profit from portfolio/collection aggregates.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "Are submitted or under-review credit applications accumulating before approval?",
    "Are KYC-pending, manual-affordability-review or high/critical-risk applications slowing conversion?",
    "Are approved applications translating into active Finance agreements, or is activation/reservation the bottleneck?",
    "Is sale-capable equipment actually available, or held for Finance/maintenance/breakdown?",
    "How much of the Finance portfolio is outstanding, and what portion is overdue/arrears?",
    "Which arrears aging buckets contain the oldest exposure?",
    "Are actual collections weak relative to the current open scheduled-obligation reference?",
    "Are there agreements requiring reconciliation attention before balances can be trusted?",
    "Are management questions incorrectly adding deposits, collections, outstanding and overdue as if they were separate revenue/profit measures?",
  ]),
  reasoning_rules: Object.freeze([
    "Never treat an approved credit application as an activated agreement, collected deposit or reserved machine.",
    "Never treat a partial opening deposit as machine reservation.",
    "Do not add deposit received on top of total amount paid/collections when the deposit is already part of Finance payment state.",
    "Treat overdue/arrears as delinquent exposure within outstanding balance, not a separate balance to double-count.",
    "Treat portfolio value as agreement-value exposure and collections as cash receipts; neither alone proves profit.",
    "Treat collection-versus-open-schedule percentage as a cash-conversion reference, not certified accounting profit or margin.",
    "Separate application/KYC/risk conversion, sale inventory, portfolio performance, cash conversion, arrears/aging and reconciliation integrity before assigning a cause.",
    "For current Finance figures, use governed company-wide Equipment Finance live tools; do not answer from this static expert pack alone.",
    "Never expose customer-row identities from an aggregate Finance intelligence answer unless a separately authorized governed customer-level path exists.",
  ]),
  boundaries: Object.freeze({
    finance_scope_is_company_wide: true,
    hire_location_selection_not_required_for_finance_ai: true,
    approved_application_is_not_activated_agreement: true,
    partial_deposit_is_not_machine_reservation: true,
    overdue_is_part_of_outstanding_exposure: true,
    deposits_must_not_be_double_counted_with_collections: true,
    portfolio_and_collections_are_not_certified_profit: true,
    aggregate_finance_tools_expose_no_customer_rows: true,
    expert_pack_is_product_knowledge_not_live_finance_data: true,
  }),
});

function runtimePath(relative) {
  return path.resolve(__dirname, "..", relative);
}

function financeRuntimeAvailability() {
  const files = FINANCE_RUNTIME_FILES.map((relative) =>
    Object.freeze({
      path: `backend/${relative}`,
      present: fs.existsSync(runtimePath(relative)),
    })
  );
  const presentCount = files.filter((item) => item.present).length;
  const total = files.length;
  return Object.freeze({
    status:
      presentCount === total
        ? "available_in_current_source_tree"
        : presentCount === 0
          ? "not_present_in_current_source_tree"
          : "partially_present_in_current_source_tree",
    present_file_count: presentCount,
    expected_file_count: total,
    files: Object.freeze(files),
    warning:
      presentCount === total
        ? null
        : "The verified Equipment Finance expert contract is not fully present in this source tree. Explain only the verified design and do not claim missing live Finance diagnostics are executable here.",
  });
}

function isEquipmentFinanceExpertPrompt(value) {
  const text = String(value ?? "").trim().slice(0, 16000);
  if (!text) return false;
  if (/\b(?:equipment finance|installment finance|instalment finance|finance portfolio|finance arrears|finance cash[- ]?flow|credit application|installment account|instalment account|machine finance|equipment credit)\b/i.test(text)) {
    return true;
  }
  const financeTopic = /\b(?:application|kyc|affordability|risk|agreement|deposit|reservation|installment|instalment|collection|arrears|overdue|portfolio|ownership transfer|finance)\b/i.test(text);
  const equipmentAnchor = /\b(?:equipment|machine|finance|installment|instalment|credit)\b/i.test(text);
  return financeTopic && equipmentAnchor;
}

function getEquipmentFinanceExpertPack({ includeAvailability = true } = {}) {
  return Object.freeze({
    ...EQUIPMENT_FINANCE_EXPERT_PACK,
    deployment_availability: includeAvailability ? financeRuntimeAvailability() : null,
  });
}

module.exports = {
  EQUIPMENT_FINANCE_EXPERT_PACK,
  FINANCE_RUNTIME_FILES,
  FINANCE_SOURCE_BASE_COMMIT,
  financeRuntimeAvailability,
  getEquipmentFinanceExpertPack,
  isEquipmentFinanceExpertPrompt,
  runtimePath,
};
