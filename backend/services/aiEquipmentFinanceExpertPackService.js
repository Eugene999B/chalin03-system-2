"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EQUIPMENT_FINANCE_SOURCE_BASE_COMMIT =
  "6956c7e76e2db62a411eb3727a9ca8e86a1ad38f";

const EQUIPMENT_FINANCE_RUNTIME_FILES = Object.freeze([
  "services/aiEquipmentFinanceIntelligenceService.js",
  "ai-tools/equipmentFinanceTools.js",
  "routes/equipmentFinanceIndependentRoutes.js",
  "routes/equipmentFinanceAgreementActivationRoutes.js",
  "services/equipmentFinancePhaseSixService.js",
]);

const EQUIPMENT_FINANCE_EXPERT_PACK = Object.freeze({
  key: "equipment_installment_finance",
  title: "Equipment Installment Finance, Collections & Portfolio Intelligence",
  version: "2026-08-11-source-derived-v1",
  authority: "verified_current_source_contract",
  reviewed_source_lineage:
    "chalin-one independent Equipment Finance lifecycle, schedule, reconciliation, reporting and AI intelligence runtime",
  verified_release_commit: EQUIPMENT_FINANCE_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "docs/EQUIPMENT_SALES_AND_HIRE_IMPLEMENTATION.md",
    "backend/routes/equipmentFinanceIndependentRoutes.js",
    "backend/routes/equipmentFinanceAgreementActivationRoutes.js",
    "backend/routes/equipmentFinanceScheduleRoutes.js",
    "backend/services/equipmentFinancePhaseSixService.js",
    "backend/services/aiEquipmentFinanceIntelligenceService.js",
    "backend/ai-tools/equipmentFinanceTools.js",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "independent_company_wide_finance_scope",
      statement:
        "Equipment Installment Finance is an independent Finance division inside the Equipment workspace. Its governed AI aggregates are company-wide Finance views and do not require an Equipment Hire location selection. Hire-only operational records and Finance-only installment records remain separate authority domains even though both use the shared equipment master.",
      source_basis: Object.freeze([
        "equipmentFinanceIndependentRoutes.financePolicy",
        "equipmentFinanceTools required_equipment_division",
        "aiEquipmentFinanceIntelligenceService Finance scope",
      ]),
    }),
    Object.freeze({
      key: "credit_to_agreement_lifecycle",
      statement:
        "The verified Finance lifecycle progresses from credit application and KYC/affordability review into an approved Finance agreement, installment schedule, payment/allocation, arrears and reconciliation controls, then controlled delivery/completion and ownership-transfer processes. Creating or previewing one stage must not be treated as proof that later stages are complete.",
      source_basis: Object.freeze([
        "equipmentFinanceIndependentRoutes mounted Finance lifecycle routes",
        "equipmentFinanceAgreementActivationRoutes",
        "docs/EQUIPMENT_SALES_AND_HIRE_IMPLEMENTATION.md installment workflow",
      ]),
    }),
    Object.freeze({
      key: "agreement_activation_gate",
      statement:
        "Finance agreement activation is a controlled step for an approved credit application. Activation candidates require an approved application, verified KYC and affordability status eligible or manual-review, and the runtime has database integrity gates for Finance agreement creation. An application approval is therefore not itself an active installment agreement.",
      source_basis: Object.freeze([
        "equipmentFinanceIndependentRoutes agreement activation candidates",
        "equipmentFinanceAgreementActivationRoutes activation roles and credit-gate triggers",
      ]),
    }),
    Object.freeze({
      key: "schedule_preview_is_read_only",
      statement:
        "Installment schedule preview calculates exact installment dates without creating an application or agreement, recording a payment, reserving equipment or changing Hire records. The Finance lifecycle supports configured frequencies and schedule rules, so preview evidence must not be described as a committed repayment plan until the governed agreement lifecycle commits it.",
      source_basis: Object.freeze([
        "equipmentFinanceScheduleRoutes /phase-one/schedule-preview safeguards",
        "equipmentFinanceIndependentRoutes.financePolicy exact schedule controls",
      ]),
    }),
    Object.freeze({
      key: "shared_asset_conflict_boundary",
      statement:
        "Finance uses the same fleet_assets equipment master as Hire. Sale-capable availability, reservation/installment holds, sold state and Hire conflicts must be enforced by the transactional equipment services; AI aggregate evidence must never bypass shared-asset conflict controls or infer that a machine is releasable from a count alone.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_SALES_AND_HIRE_IMPLEMENTATION.md shared equipment master and double-booking safety",
        "aiEquipmentFinanceIntelligenceService.loadSalesInventory",
      ]),
    }),
    Object.freeze({
      key: "portfolio_value_collection_balance_distinction",
      statement:
        "Finance portfolio value, deposits received, lifetime collections, outstanding balance and overdue balance are distinct measures. Portfolio value is contracted installment sale value, collections are recorded non-void payments, outstanding is the remaining agreement balance, and overdue is the past-due portion. None of these measures alone is Finance profit.",
      source_basis: Object.freeze([
        "equipmentFinancePhaseSixService.getPortfolioDashboard summary",
        "aiEquipmentFinanceIntelligenceService.safePortfolio",
      ]),
    }),
    Object.freeze({
      key: "outstanding_is_not_arrears",
      statement:
        "Outstanding balance and arrears are not interchangeable. Outstanding can include amounts that remain payable but are not yet due; arrears are derived from unpaid installment schedule obligations whose due dates have passed, including applicable late-charge and waiver effects in the schedule calculation.",
      source_basis: Object.freeze([
        "equipmentFinancePhaseSixService.getArrearsReport",
        "equipmentFinancePhaseSixService portfolio aging construction",
      ]),
    }),
    Object.freeze({
      key: "arrears_aging_is_control_evidence",
      statement:
        "Finance arrears are grouped into 1-30, 31-60, 61-90 and over-90-day aging buckets using past-due schedule evidence. Older aging, missed schedule lines and rising arrears are collection-risk signals; they do not by themselves prove fraud, default loss or the recoverable amount after all legal/commercial actions.",
      source_basis: Object.freeze([
        "equipmentFinancePhaseSixService.getArrearsReport aging_bucket",
        "aiEquipmentFinanceIntelligenceService.aggregateArrearsRows",
      ]),
    }),
    Object.freeze({
      key: "cashflow_ratio_boundary",
      statement:
        "The governed Finance cash-flow view separately totals actual non-void collections and open scheduled amounts in the selected period. Its collection-versus-open-schedule percentage is a management comparison, not automatically an on-time collection rate, because actual payments and currently open schedule amounts are not guaranteed to be a one-to-one matched due cohort.",
      source_basis: Object.freeze([
        "equipmentFinancePhaseSixService.getCashFlowReport",
        "aiEquipmentFinanceIntelligenceService.loadCashFlowHealth",
      ]),
    }),
    Object.freeze({
      key: "reconciliation_is_integrity_control",
      statement:
        "Finance portfolio reporting separately counts agreements that require reconciliation attention. Agreement statements are rebuilt from agreement, schedule, payment and allocation records, and voided payments are excluded from collection totals while remaining part of the audit system. Reconciliation mismatch is a data/integrity control signal, not a profit calculation.",
      source_basis: Object.freeze([
        "equipmentFinancePhaseSixService reconciliation integration",
        "equipmentFinancePhaseSixService customer statement contract",
      ]),
    }),
    Object.freeze({
      key: "application_pipeline_is_not_booked_portfolio",
      statement:
        "Draft, submitted, under-review, changes-requested, approved or declined credit applications are pipeline/control states. Approved applications, KYC verification, affordability eligibility and high-risk counts describe origination readiness and risk; they are not automatically active agreements, booked collections or realized sales.",
      source_basis: Object.freeze([
        "aiEquipmentFinanceIntelligenceService.loadApplicationPipeline",
        "equipmentFinanceIndependentRoutes agreement activation candidates",
      ]),
    }),
    Object.freeze({
      key: "aggregate_ai_privacy_boundary",
      statement:
        "The registered Equipment Finance AI views are confidential aggregate-only snapshots. They deliberately expose no customer rows, names, phone numbers or agreement-level records. Customer-specific statements and cases remain on ordinary authenticated Finance routes rather than these aggregate AI tools.",
      source_basis: Object.freeze([
        "equipmentFinanceTools evidence metadata",
        "aiEquipmentFinanceIntelligenceService safePortfolio/loadArrearsHealth/loadCashFlowHealth",
      ]),
    }),
    Object.freeze({
      key: "no_certified_finance_profit_in_current_snapshot",
      statement:
        "The current governed Finance AI snapshots expose contracted portfolio value, payment collections, balances, arrears, reconciliation, application pipeline and sale-capable equipment counts. They do not expose a complete accounting cost, financing-cost, impairment or profit model, so CHALIN must not invent certified Finance profit, margin or investment yield from these aggregates.",
      source_basis: Object.freeze([
        "aiEquipmentFinanceIntelligenceService",
        "equipmentFinanceTools registered Risk-1 views",
      ]),
    }),
  ]),
  workflows: Object.freeze([
    Object.freeze({
      key: "origination_to_activation",
      path: "Customer/Equipment -> Credit Application -> KYC -> Affordability/Risk Review -> Approval -> Finance Agreement Activation",
      interpretation:
        "Separate origination pipeline from booked portfolio. Approval/readiness evidence does not become an active installment agreement until the governed activation lifecycle succeeds.",
    }),
    Object.freeze({
      key: "agreement_to_schedule",
      path: "Activated Agreement -> Deposit/Financed Amount -> Exact Installment Schedule -> Due Dates",
      interpretation:
        "A schedule preview is read-only; committed schedule obligations belong to the activated agreement. Outstanding future obligations and past-due arrears must remain separate.",
    }),
    Object.freeze({
      key: "schedule_to_collections",
      path: "Schedule Obligation -> Payment -> Allocation -> Remaining Balance -> Arrears/Aging -> Reconciliation",
      interpretation:
        "Collections are non-void payments applied through the Finance records. Arrears are the past-due portion of unpaid schedule obligations, while outstanding can also include future obligations.",
    }),
    Object.freeze({
      key: "asset_and_delivery_control",
      path: "Shared Fleet Asset -> Finance Commitment/Reservation -> Controlled Delivery -> Settlement/Completion -> Ownership Transfer",
      interpretation:
        "Shared-asset state, delivery authorization, financial settlement and ownership completion are connected controls but one must not be used as proof that the others are complete.",
    }),
    Object.freeze({
      key: "finance_performance",
      path: "Origination Pipeline + Portfolio Conversion + Collections + Outstanding/Arrears Aging + Reconciliation + Asset Availability -> Finance Performance Diagnosis",
      interpretation:
        "Diagnose origination, cash conversion, delinquency, integrity and fulfillment pressure without relabeling portfolio value or collections as profit.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "How much of the active Finance portfolio remains outstanding, and what portion is actually overdue?",
    "Is arrears pressure concentrated in 1-30, 31-60, 61-90 or over-90-day aging?",
    "Are collections weak relative to open scheduled amounts for the selected reporting period, while keeping the ratio's cohort limitation explicit?",
    "Are reconciliation-attention agreements weakening confidence in portfolio totals?",
    "Are approved/under-review applications blocked by KYC, affordability/manual review or risk controls?",
    "Are sale-capable assets available to fulfill approved Finance demand, or are they held/sold/maintenance constrained?",
    "Is the user confusing application approval with agreement activation, or outstanding balance with arrears?",
    "Is the user asking for Finance profit/yield even though the governed aggregate has no complete cost/profit model?",
  ]),
  reasoning_rules: Object.freeze([
    "Never equate Finance portfolio value with cash collected or profit.",
    "Never equate outstanding balance with arrears; arrears are the past-due schedule portion.",
    "Treat approved credit applications as origination readiness until governed agreement activation succeeds.",
    "Treat collection-versus-open-schedule percentage as a management comparison, not automatically an on-time collection rate.",
    "Treat reconciliation attention as an integrity/control signal and state when it weakens confidence.",
    "Treat shared fleet availability as fulfillment evidence, not permission to reserve, deliver or transfer a machine.",
    "Do not expose customer/agreement rows through aggregate Finance AI tools.",
    "For live Finance figures, use governed Equipment Finance read tools; do not answer from this static expert pack alone.",
    "Do not invent Finance profit, margin, impairment loss or yield from the current aggregate snapshots.",
  ]),
  boundaries: Object.freeze({
    finance_scope_is_company_wide: true,
    hire_location_selection_not_required_for_finance_ai: true,
    finance_and_hire_divisions_are_separate: true,
    application_approval_is_not_agreement_activation: true,
    schedule_preview_is_read_only: true,
    outstanding_is_not_arrears: true,
    cashflow_ratio_is_not_automatic_on_time_collection_rate: true,
    aggregate_ai_exposes_no_customer_rows: true,
    current_finance_snapshot_has_no_certified_profit: true,
    expert_pack_is_product_knowledge_not_live_finance_data: true,
  }),
});

function runtimePath(relative) {
  return path.resolve(__dirname, "..", relative);
}

function equipmentFinanceRuntimeAvailability() {
  const files = EQUIPMENT_FINANCE_RUNTIME_FILES.map((relative) =>
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
  if (/\b(?:equipment finance|installment finance|instalment finance|finance portfolio|finance agreement|credit application|affordability review|repayment schedule|installment schedule|instalment schedule|finance arrears|installment arrears|instalment arrears|ownership transfer)\b/i.test(text)) {
    return true;
  }
  const financeTopic = /\b(?:application|kyc|affordability|agreement|deposit|schedule|repayment|payment|allocation|arrears|aging|ageing|reconciliation|delivery|settlement|ownership|portfolio|collections?)\b/i.test(text);
  const financeAnchor = /\b(?:finance|installment|instalment|credit|financed)\b/i.test(text);
  return financeTopic && financeAnchor;
}

function getEquipmentFinanceExpertPack({ includeAvailability = true } = {}) {
  return Object.freeze({
    ...EQUIPMENT_FINANCE_EXPERT_PACK,
    deployment_availability: includeAvailability
      ? equipmentFinanceRuntimeAvailability()
      : null,
  });
}

module.exports = {
  EQUIPMENT_FINANCE_EXPERT_PACK,
  EQUIPMENT_FINANCE_RUNTIME_FILES,
  EQUIPMENT_FINANCE_SOURCE_BASE_COMMIT,
  equipmentFinanceRuntimeAvailability,
  getEquipmentFinanceExpertPack,
  isEquipmentFinanceExpertPrompt,
  runtimePath,
};
