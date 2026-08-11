"use strict";

const fs = require("node:fs");
const path = require("node:path");

const HIRE_SOURCE_BASE_COMMIT = "ea56a1840ded7eb5a7c37507e88266250b8535e1";

const HIRE_RUNTIME_FILES = Object.freeze([
  "services/aiHireIntelligenceService.js",
  "ai-tools/hireTools.js",
  "routes/hireCommercialRoutes.js",
  "routes/equipmentHireRoutes.js",
  "services/hireLocationScope.js",
]);

const HIRE_EXPERT_PACK = Object.freeze({
  key: "equipment_hire_operations",
  title: "Equipment Hire Operations, Commercial Flow & Fleet Performance Intelligence",
  version: "2026-08-11-source-derived-v1",
  authority: "verified_current_source_contract",
  reviewed_source_lineage: "chalin-one Equipment Hire commercial/control and AI intelligence runtime",
  verified_release_commit: HIRE_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "docs/EQUIPMENT_HIRE_GUIDE.md",
    "docs/EQUIPMENT_HIRE_FINANCE_CONTEXT_SEPARATION.md",
    "backend/routes/hireCommercialRoutes.js",
    "backend/routes/equipmentHireRoutes.js",
    "backend/services/aiHireIntelligenceService.js",
    "backend/ai-tools/hireTools.js",
    "backend/services/hireLocationScope.js",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "location_scoped_hire_workspace",
      statement:
        "Equipment Hire is a location-scoped operating workspace separated from Spare Parts, Mining and the company-wide Installment Finance operating context. Hire staff select an authorized active base, yard or location before working with Hire records.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_HIRE_GUIDE.md",
        "docs/EQUIPMENT_HIRE_FINANCE_CONTEXT_SEPARATION.md",
        "hireLocationScope.resolveHireLocationScope",
      ]),
    }),
    Object.freeze({
      key: "commercial_operating_chain",
      statement:
        "The verified Hire flow connects customer and enquiry, equipment availability and approved rate cards, quotation and approval, contract, asset assignment/dispatch, customer-approved work logs, invoice, payment/receipt, return inspection and contract closure review.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_HIRE_GUIDE.md commercial and operational workflow",
        "hireCommercialRoutes",
      ]),
    }),
    Object.freeze({
      key: "quotation_pipeline_boundary",
      statement:
        "Open quotation value is commercial pipeline exposure. A draft, approved or accepted quotation is not by itself recognized revenue, collected cash or profit, and should not be reported as such.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService pipeline.open_quotation_value",
        "hireCommercialRoutes quotation lifecycle",
      ]),
    }),
    Object.freeze({
      key: "work_to_invoice_control",
      statement:
        "Customer work is represented through Hire work logs. Approved work logs that have no invoice line are a billing-completeness and timing signal; they do not prove that revenue was lost or that the underlying amount is known from the aggregate count alone.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService work.approved_uninvoiced_work_logs",
        "hireCommercialRoutes work-log and invoice flow",
      ]),
    }),
    Object.freeze({
      key: "billing_collection_boundary",
      statement:
        "Hire invoiced amount, paid amount, outstanding balance, overdue balance and collection rate describe billing and cash conversion. Paid cash is not Hire profit, and the current Hire AI snapshot does not include the operating-cost evidence required to certify profit or margin.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService receivables",
        "aiHireIntelligenceService buildReceivablesHealth",
      ]),
    }),
    Object.freeze({
      key: "fleet_availability_boundary",
      statement:
        "Fleet health distinguishes total, available/idle and maintenance/breakdown assets plus Hire asset assignments. These counts are availability and deployment-control signals; they are not a certified time-based utilization percentage unless the required operating-capacity evidence is available.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService fleet",
        "aiHireIntelligenceService buildFleetHealth",
      ]),
    }),
    Object.freeze({
      key: "recorded_hours_boundary",
      statement:
        "The current Hire snapshot exposes 30-day billable hours and breakdown hours from Hire work logs. Their mix can identify downtime pressure, but it does not by itself prove the mechanical cause or full fleet utilization because scheduled/available capacity hours are not present in this aggregate.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService work.billable_hours_30d",
        "aiHireIntelligenceService work.breakdown_hours_30d",
      ]),
    }),
    Object.freeze({
      key: "returns_and_closure_controls",
      statement:
        "Returns due or incomplete, returned contracts pending closure and contracts ready for closure are operational-control signals. They identify lifecycle backlog and equipment-release/closure work but should not be converted into a financial loss amount without supporting evidence.",
      source_basis: Object.freeze([
        "aiHireIntelligenceService returns",
        "docs/EQUIPMENT_HIRE_GUIDE.md return and closure workflow",
      ]),
    }),
    Object.freeze({
      key: "independent_commercial_approval",
      statement:
        "Where the Hire commercial workflow requires approval, the creator cannot approve their own record. Independent approval is a server-enforced control rather than an AI judgment.",
      source_basis: Object.freeze([
        "hireCommercialRoutes.independentApproval",
      ]),
    }),
    Object.freeze({
      key: "shared_machine_finance_boundary",
      statement:
        "Equipment Hire and Installment Finance share machine identity only. Finance does not use the Hire active-location operating context, while an active Hire assignment can block Finance reservation, delivery or ownership-transfer actions for that machine.",
      source_basis: Object.freeze([
        "docs/EQUIPMENT_HIRE_FINANCE_CONTEXT_SEPARATION.md",
      ]),
    }),
  ]),
  workflows: Object.freeze([
    Object.freeze({
      key: "commercial_conversion",
      path: "Customer -> Enquiry -> Availability/Rate Check -> Quotation -> Approval -> Contract",
      interpretation:
        "Separate pipeline value and approval backlog from actual contracted, invoiced and collected business. A quotation is a commercial opportunity, not booked profit.",
    }),
    Object.freeze({
      key: "equipment_deployment",
      path: "Contract -> Asset Assignment -> Dispatch -> Work Logs -> Return Inspection -> Equipment Release",
      interpretation:
        "Availability, maintenance/breakdown state, assignments, returns and closure controls explain operational readiness. Asset counts alone are not a time-based utilization calculation.",
    }),
    Object.freeze({
      key: "work_to_cash",
      path: "Approved Work Log -> Invoice -> Payment/Receipt -> Outstanding/Aging Review",
      interpretation:
        "Uninvoiced approved work is a billing-completeness signal; outstanding and overdue invoices explain cash-conversion pressure. Collections are not profit by themselves.",
    }),
    Object.freeze({
      key: "return_to_closure",
      path: "Return Inspection -> Damage/Deposit Review -> Asset Release -> Operational Closure -> Financial Balance Review",
      interpretation:
        "Return and closure backlog can keep contracts operationally incomplete even after equipment comes back, while closed balances remain a separate financial-control issue.",
    }),
    Object.freeze({
      key: "hire_performance",
      path: "Commercial Pipeline + Fleet Availability + Work/Billing Controls + Receivables/Aging + Returns/Closure -> Hire Performance Diagnosis",
      interpretation:
        "Diagnose pipeline, fleet readiness, work-to-invoice completeness, cash conversion and lifecycle controls separately. Do not invent Hire profit when operating-cost evidence is absent.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "Are active enquiries and draft quotations accumulating before approval or contract conversion?",
    "Do active contracts have matching Hire asset assignments, and are maintenance/breakdown assets constraining availability?",
    "Are draft work logs delaying approval or customer billing?",
    "Are approved work logs still uninvoiced, creating a billing-completeness backlog?",
    "Is the collection rate weak because outstanding or overdue invoices are accumulating?",
    "Which receivables aging buckets contain the oldest outstanding balances?",
    "Are returns due/incomplete or returned contracts waiting for operational closure?",
    "Are completed/closed contracts carrying outstanding financial balances?",
    "Is the user asking for Hire profit even though the current governed Hire snapshot has billing and collections but no operating-cost/profit evidence?",
  ]),
  reasoning_rules: Object.freeze([
    "Never treat open quotation value as recognized revenue, collected cash or profit.",
    "Treat invoiced amount as billing evidence and paid amount as cash-collection evidence; neither alone proves profit.",
    "Treat approved uninvoiced work logs as a billing-completeness/timing signal, not automatic revenue loss.",
    "Treat fleet counts and Hire assignments as availability/deployment controls, not a certified time-based utilization percentage.",
    "Use recorded billable/breakdown-hour mix only as a downtime-pressure signal unless scheduled-capacity evidence is available.",
    "Separate commercial pipeline pressure, fleet readiness, billing completeness, cash conversion and return/closure controls before assigning a root cause.",
    "For a live Hire location question, use governed Equipment Hire live tools; do not answer from this static expert pack alone.",
    "State explicitly when the available evidence supports an operational or receivables conclusion but cannot support a certified profit/margin conclusion.",
  ]),
  boundaries: Object.freeze({
    aggregate_live_tools_are_hire_location_scoped: true,
    open_quotation_value_is_pipeline_not_revenue: true,
    paid_amount_is_cash_collection_not_profit: true,
    fleet_assignment_counts_are_not_time_based_utilization: true,
    current_hire_snapshot_has_no_certified_profit_or_margin: true,
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
  if (/\b(?:equipment hire|hire fleet|hire contract|hire quotation|hire receivable|hire invoice|hire return|hire location|hire yard|hire base)\b/i.test(text)) {
    return true;
  }
  const hireTopic = /\b(?:enquiry|quotation|contract|fleet|asset|dispatch|work log|job card|invoice|receivable|collection|return|closure|maintenance|breakdown|utili[sz]ation|billable)\b/i.test(text);
  const hireAnchor = /\b(?:hire|rental|rented|equipment hire)\b/i.test(text);
  return hireTopic && hireAnchor;
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
