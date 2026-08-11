"use strict";

const fs = require("node:fs");
const path = require("node:path");

const HIRE_SOURCE_BASE_COMMIT = "ea56a1840ded7eb5a7c37507e88266250b8535e1";

const HIRE_RUNTIME_FILES = Object.freeze([
  "services/aiHireIntelligenceService.js",
  "ai-tools/hireTools.js",
  "routes/equipmentHireRoutes.js",
  "services/hireLocationScope.js",
]);

const HIRE_EXPERT_PACK = Object.freeze({
  key: "equipment_hire_operations",
  title: "Equipment Hire Commercial, Fleet & Contract Intelligence",
  version: "2026-08-11-source-derived-v1",
  authority: "verified_current_source_contract",
  reviewed_source_lineage:
    "chalin-one Equipment Hire operations, location scope, shared fleet and AI intelligence runtime",
  verified_release_commit: HIRE_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "backend/routes/equipmentHireRoutes.js",
    "backend/services/hireLocationScope.js",
    "backend/services/aiHireIntelligenceService.js",
    "backend/ai-tools/hireTools.js",
    "frontend/src/pages/EquipmentHireOperationsPage.jsx",
    "docs/EQUIPMENT_SALES_AND_HIRE_IMPLEMENTATION.md",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "location_scoped_workspace",
      statement:
        "Equipment Hire is an independent location-scoped operating workspace. Live Hire records must stay inside the authenticated user's authorized Hire location, and Hire locations are not interchangeable with Spare Parts stores or Mining sites.",
      source_basis: Object.freeze([
        "hireLocationScope.resolveHireLocationScope",
        "equipmentHireRoutes location-scope middleware",
        "hireTools scope_requirements.hire_location",
      ]),
    }),
    Object.freeze({
      key: "commercial_operating_chain",
      statement:
        "The verified Hire operating chain is Customer -> Enquiry -> Fleet Availability -> Quotation -> Contract -> Asset Assignment/Dispatch -> Work Logs -> Invoice/Payment -> Return Inspection -> Operational and financial closure review.",
      source_basis: Object.freeze([
        "EquipmentHireOperationsPage tabs and forms",
        "equipmentHireRoutes status contracts",
        "aiHireIntelligenceService pipeline/work/receivables/returns summaries",
      ]),
    }),
    Object.freeze({
      key: "shared_fleet_source_of_truth",
      statement:
        "fleet_assets is the shared equipment master for heavy equipment. Hire availability, assignments, dispatch, maintenance and the Equipment Sales/Finance conflict controls refer back to the same asset identity rather than creating duplicate equipment records.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_SALES_AND_HIRE_IMPLEMENTATION.md shared equipment master",
        "aiHireIntelligenceService fleet summary",
      ]),
    }),
    Object.freeze({
      key: "double_booking_boundary",
      statement:
        "A unit that is sold, sale-reserved or actively committed to a conflicting commercial lifecycle must not be silently assigned to Hire, and a unit actively assigned/dispatched/on Hire must not be sold through a conflicting workflow. These conflicts are governed by the shared fleet and transactional business services, not by AI inference.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_SALES_AND_HIRE_IMPLEMENTATION.md double-booking safety",
      ]),
    }),
    Object.freeze({
      key: "quotation_is_pipeline_not_revenue",
      statement:
        "Open quotation value is commercial pipeline evidence. A quotation is not an invoice, collected cash, earned accounting revenue or profit, so CHALIN must not report quotation value as realized business performance.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService pipeline.open_quotation_value",
        "equipmentHireRoutes quotation statuses",
      ]),
    }),
    Object.freeze({
      key: "invoice_payment_receivable_distinction",
      statement:
        "Hire invoice amount, amount paid and outstanding balance are different measures. Non-void invoice totals represent billed commercial value, payments represent cash collection, and outstanding/overdue balances represent receivables. Collection rate is paid amount divided by invoiced amount in the governed aggregate.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService receivables summary",
        "equipmentHireRoutes invoice/payment statuses",
      ]),
    }),
    Object.freeze({
      key: "uninvoiced_work_is_billing_risk",
      statement:
        "Approved work logs that have no invoice line are an invoicing-lag/control signal. They may indicate work that still needs billing review, but the aggregate alone does not prove lost revenue, fraud or the exact amount that should be invoiced.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService approved_uninvoiced_work_logs",
      ]),
    }),
    Object.freeze({
      key: "fleet_health_is_not_profit",
      statement:
        "Fleet availability, maintenance/breakdown assets, assets on Hire and recorded work/breakdown hours describe operating capacity and reliability. They can pressure commercial performance but do not by themselves establish Hire profit because the current governed snapshot does not expose a complete Hire cost model.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService fleet/work summaries",
        "hireTools equipment_hire.fleet_health",
      ]),
    }),
    Object.freeze({
      key: "return_and_closure_are_separate_controls",
      statement:
        "Returning equipment does not automatically prove the contract is fully closed. The governed snapshot separately tracks incomplete returns, returned-pending-closure contracts, contracts ready for closure review and balances that can remain outstanding.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService returns and pipeline summaries",
        "equipmentHireRoutes contract and asset statuses",
      ]),
    }),
    Object.freeze({
      key: "no_certified_profit_in_current_hire_snapshot",
      statement:
        "The current governed Equipment Hire AI snapshots expose fleet, pipeline, work-log, invoicing, collection, receivable, return and closure measures. They do not expose a complete Hire operating-cost/COGS model or certified Hire profit, so CHALIN must not invent a profit figure from these snapshots.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService loadHireIntelligence",
        "hireTools registered Risk-1 views",
      ]),
    }),
  ]),
  workflows: Object.freeze([
    Object.freeze({
      key: "lead_to_contract",
      path: "Customer -> Enquiry -> Fleet Availability -> Quotation -> Approval/Acceptance -> Hire Contract",
      interpretation:
        "Separate demand/pipeline evidence from realized business. Quotation value is potential commercial value until the governed workflow progresses into contracted and invoiced work.",
    }),
    Object.freeze({
      key: "contract_to_work",
      path: "Hire Contract -> Asset Assignment -> Dispatch -> Active Hire -> Work Logs",
      interpretation:
        "Shared Fleet availability and conflict controls determine whether the right equipment can be committed. Work evidence should be reviewed before billing conclusions are drawn.",
    }),
    Object.freeze({
      key: "work_to_cash",
      path: "Approved Work Logs -> Invoice -> Payment -> Outstanding/Overdue Receivable",
      interpretation:
        "Separate billing from cash conversion. Uninvoiced approved work is a billing-review signal; outstanding invoices are receivables, and payments are collections rather than profit.",
    }),
    Object.freeze({
      key: "return_to_closure",
      path: "Return Inspection -> Asset Returned -> Operational Closure Review -> Financial Balance Review -> Contract Completion",
      interpretation:
        "Asset return, operational completion and financial settlement are connected but distinct controls; one must not be used as proof that the others are complete.",
    }),
    Object.freeze({
      key: "hire_performance",
      path: "Demand Pipeline + Fleet Capacity/Reliability + Work-to-Invoice Conversion + Collections/Receivables + Return/Closure Controls -> Hire Performance Diagnosis",
      interpretation:
        "Diagnose commercial and operating pressure without turning quotation value, invoices, payments or fleet activity into unsupported profit claims.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "Are active Hire contracts backed by active equipment assignments, or is there a contract/asset mismatch?",
    "Are maintenance or breakdown conditions constraining fleet availability or commercial capacity?",
    "Are approved work logs waiting for invoicing, creating billing lag or control risk?",
    "How much billed Hire value has converted to cash, and how much remains outstanding or overdue?",
    "Is overdue receivable pressure concentrated in current, 1-30, 31-60, 61-90 or over-90-day aging buckets?",
    "Are returns overdue/incomplete or returned contracts still waiting for operational closure review?",
    "Is open quotation value being discussed correctly as pipeline rather than booked revenue?",
    "Is the user asking for Hire profit even though the current governed evidence has no complete cost/profit measure?",
  ]),
  reasoning_rules: Object.freeze([
    "Never report open quotation value as realized revenue, collected cash or profit.",
    "Separate invoiced commercial value from payments and from outstanding/overdue receivables.",
    "Treat approved uninvoiced work as a billing-review signal, not automatic lost revenue.",
    "Treat fleet maintenance/breakdown and asset deployment as operating-capacity evidence, not direct proof of financial loss.",
    "Treat equipment return, operational closure and financial settlement as connected but distinct controls.",
    "Do not invent Equipment Hire profit from the current governed snapshot because a complete Hire cost model is not present.",
    "For a live Hire location question, use governed Equipment Hire live tools rather than this static expert pack alone.",
  ]),
  boundaries: Object.freeze({
    aggregate_live_tools_are_hire_location_scoped: true,
    shared_fleet_is_asset_source_of_truth: true,
    quotation_value_is_pipeline_not_realized_revenue: true,
    invoice_payment_receivable_are_distinct: true,
    approved_uninvoiced_work_is_not_automatic_lost_revenue: true,
    current_hire_snapshot_has_no_certified_profit: true,
    expert_pack_is_product_knowledge_not_live_hire_data: true,
  }),
});

function runtimePath(relative) {
  return path.resolve(__dirname, "..", relative);
}

function hireRuntimeAvailability() {
  const files = HIRE_RUNTIME_FILES.map((relative) =>
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
        : "The verified Equipment Hire expert contract is not fully present in this source tree. Explain only the verified design and do not claim missing live diagnostics are executable here.",
  });
}

function isHireExpertPrompt(value) {
  const text = String(value ?? "").trim().slice(0, 16000);
  if (!text) return false;
  if (/\b(?:equipment hire|hire operations|hire contract|hire quotation|hire invoice|hire receivable|hire location|hire fleet|rental fleet|rental contract)\b/i.test(text)) {
    return true;
  }
  const operationalTopic = /\b(?:quotation|contract|dispatch|work log|invoice|receivable|collection|return|fleet|availability|maintenance|breakdown|utili[sz]ation|asset assignment)\b/i.test(text);
  const hireAnchor = /\b(?:hire|rental|equipment|fleet|excavator|machine)\b/i.test(text);
  return operationalTopic && hireAnchor;
}

function getHireExpertPack({ includeAvailability = true } = {}) {
  return Object.freeze({
    ...HIRE_EXPERT_PACK,
    deployment_availability: includeAvailability ? hireRuntimeAvailability() : null,
  });
}

module.exports = {
  HIRE_EXPERT_PACK,
  HIRE_RUNTIME_FILES,
  HIRE_SOURCE_BASE_COMMIT,
  getHireExpertPack,
  hireRuntimeAvailability,
  isHireExpertPrompt,
  runtimePath,
};
