"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MINING_SOURCE_BASE_COMMIT = "ecc1d2b6b529dff0a5690f8ea5af02e65c03136c";

const MINING_RUNTIME_FILES = Object.freeze([
  "services/aiMiningIntelligenceService.js",
  "ai-tools/miningTools.js",
  "routes/miningControlRoutes.js",
  "services/miningSiteScope.js",
]);

const MINING_EXPERT_PACK = Object.freeze({
  key: "mining_operations",
  title: "Mining Operations & Site Performance Intelligence",
  version: "2026-08-11-source-derived-v1",
  authority: "verified_current_source_contract",
  reviewed_source_lineage: "chalin-one Mining operations/control and AI intelligence runtime",
  verified_release_commit: MINING_SOURCE_BASE_COMMIT,
  source_paths: Object.freeze([
    "docs/MINING_OPERATIONS_GUIDE.md",
    "backend/routes/miningControlRoutes.js",
    "backend/services/aiMiningIntelligenceService.js",
    "backend/ai-tools/miningTools.js",
    "backend/services/miningSiteScope.js",
  ]),
  facts: Object.freeze([
    Object.freeze({
      key: "site_scoped_workflow",
      statement:
        "Mining Operations is site-scoped and separated from Spare Parts and Equipment Hire. Authorized users select a Mining site, and operational records, workers, permissions, reports and documents remain constrained to the selected Mining site.",
      source_basis: Object.freeze([
        "docs/MINING_OPERATIONS_GUIDE.md",
        "miningSiteScope.resolveMiningSiteScope",
        "miningControlRoutes router site-scope middleware",
      ]),
    }),
    Object.freeze({
      key: "operating_chain",
      statement:
        "The verified Mining operating chain connects shift/crew logs, production records, stockpile movements, dispatch, equipment hours, fuel receipts/issues/reconciliation, expenses, incidents and site closing. Site closing is the control point that reconciles these operating records for the period.",
      source_basis: Object.freeze([
        "docs/MINING_OPERATIONS_GUIDE.md controlled workflow",
        "miningControlRoutes dashboard and closing controls",
      ]),
    }),
    Object.freeze({
      key: "production_and_dispatch_are_different",
      statement:
        "Recorded production quantity and approved dispatched quantity are separate measures. A gap can reflect stockpile accumulation, timing, pending dispatch approval or other flow conditions; it must not automatically be labeled loss or theft.",
      source_basis: Object.freeze([
        "aiMiningIntelligenceService production summary",
        "aiMiningIntelligenceService dispatch summary",
      ]),
    }),
    Object.freeze({
      key: "cost_per_unit_boundary",
      statement:
        "The current Mining intelligence cost-per-unit metric is recorded Mining operating expenses divided by recorded production quantity for the selected period. It is an operating-efficiency indicator, not certified total production cost, accounting profit or statutory margin.",
      source_basis: Object.freeze([
        "aiMiningIntelligenceService normalizedSummary.cost_per_unit",
        "miningControlRoutes dashboard cost_per_unit",
      ]),
    }),
    Object.freeze({
      key: "utilization_definition",
      statement:
        "Equipment utilization is calculated from recorded working hours divided by working plus idle plus breakdown hours. Low utilization can be associated with idle time or breakdown time, but the aggregate alone does not prove the root cause.",
      source_basis: Object.freeze([
        "aiMiningIntelligenceService normalizedSummary.utilization_percent",
      ]),
    }),
    Object.freeze({
      key: "fuel_and_stock_are_constraints",
      statement:
        "Mining intelligence treats low fuel-tank levels and low stockpile levels as operational warnings. Current tank and stockpile balances are point-in-time control signals; they are not by themselves period fuel-consumption or production-loss calculations.",
      source_basis: Object.freeze([
        "aiMiningIntelligenceService buildAlerts",
        "aiMiningIntelligenceService buildStockFuelHealth",
      ]),
    }),
    Object.freeze({
      key: "incidents_and_closings_are_controls",
      statement:
        "Open serious incidents, pending crews, pending dispatches and pending site closings are control and operational-risk signals. They can explain why management attention is required but should not be converted into a financial-loss amount without supporting evidence.",
      source_basis: Object.freeze([
        "aiMiningIntelligenceService buildAlerts",
        "aiMiningIntelligenceService buildProductionCostHealth",
      ]),
    }),
    Object.freeze({
      key: "no_revenue_profit_in_current_mining_snapshot",
      statement:
        "The current governed Mining AI snapshots expose production, operating expense, equipment, stockpile, fuel, dispatch, crew, incident and closing measures. They do not expose Mining revenue or certified Mining profit, so CHALIN must not invent profit from those snapshots.",
      source_basis: Object.freeze([
        "aiMiningIntelligenceService loadMiningIntelligence",
        "miningTools registered Risk-1 views",
      ]),
    }),
  ]),
  workflows: Object.freeze([
    Object.freeze({
      key: "shift_to_output",
      path: "Authorized Mining Site -> Shift/Crew -> Production -> Stockpile -> Dispatch",
      interpretation:
        "Production and dispatch should be compared as linked but distinct operating-flow measures; timing and stockpile accumulation must be considered before declaring a variance abnormal.",
    }),
    Object.freeze({
      key: "equipment_efficiency",
      path: "Equipment Logs -> Working + Idle + Breakdown Hours -> Utilization -> Production Efficiency",
      interpretation:
        "Low utilization or high breakdown hours can pressure output and raise operating cost per recorded unit, but aggregate correlation is not proof of a specific mechanical cause.",
    }),
    Object.freeze({
      key: "fuel_control",
      path: "Fuel Receipt/Transfer -> Tank Balance -> Asset/Shift Issue -> Reconciliation -> Operational Availability",
      interpretation:
        "Fuel availability and reconciliation are operational controls. Low tank balance may constrain work; balance alone does not establish fuel consumption efficiency or loss.",
    }),
    Object.freeze({
      key: "site_control",
      path: "Production + Dispatch + Stockpiles + Fuel + Expenses + Equipment + Incidents + Crew -> Site Closing/Review",
      interpretation:
        "Site closing is the cross-module control point for reviewing whether the period's operational records reconcile before approval.",
    }),
    Object.freeze({
      key: "site_performance",
      path: "Production Attainment + Operating Cost/Unit + Equipment Utilization + Flow Constraints + Control/Safety Signals -> Site Performance Diagnosis",
      interpretation:
        "Separate output pressure, operating-efficiency pressure, equipment downtime, stock/fuel constraints and control risk. Do not relabel these as profit unless revenue and reliable cost evidence exist.",
    }),
  ]),
  diagnostic_questions: Object.freeze([
    "Is recorded production below the configured daily-target reference for the selected period?",
    "Is operating cost per recorded production unit high because expenses rose, production fell, or both?",
    "Is equipment utilization low, and is the pressure primarily idle hours, breakdown hours or both?",
    "Are low fuel-tank levels or low stockpile balances creating an operational constraint?",
    "Is dispatch lagging recorded production because material is accumulating in stockpiles or approvals are pending?",
    "Are serious incidents or unresolved operational controls affecting site performance or confidence?",
    "Are site closings or crew/dispatch approvals still pending, weakening period completeness?",
    "Is the user asking for Mining profit even though the current governed evidence has no Mining revenue/profit measure?",
  ]),
  reasoning_rules: Object.freeze([
    "Never equate Mining production quantity with revenue or profit.",
    "Treat cost per unit as recorded operating expense divided by recorded production, not certified total production cost.",
    "Separate production/output pressure from equipment-utilization pressure and from control/safety risk.",
    "Treat production-versus-dispatch gaps as flow/timing signals before assuming loss.",
    "Treat current fuel and stockpile balances as point-in-time constraints, not period-consumption proof.",
    "For a live site/date question, use governed Mining live tools; do not answer from this static expert pack alone.",
    "State when evidence supports an operational-efficiency conclusion but not a financial-profit conclusion.",
  ]),
  boundaries: Object.freeze({
    aggregate_live_tools_are_site_scoped: true,
    current_cost_per_unit_is_operating_expense_per_recorded_output: true,
    current_mining_snapshot_has_no_revenue_or_certified_profit: true,
    production_dispatch_gap_is_not_automatic_loss: true,
    expert_pack_is_product_knowledge_not_live_site_data: true,
  }),
});

function runtimePath(relative) {
  return path.resolve(__dirname, "..", relative);
}

function miningRuntimeAvailability() {
  const files = MINING_RUNTIME_FILES.map((relative) =>
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
        : "The verified Mining expert contract is not fully present in this source tree. Explain only the verified design and do not claim missing live diagnostics are executable here.",
  });
}

function isMiningExpertPrompt(value) {
  const text = String(value ?? "").trim().slice(0, 16000);
  if (!text) return false;
  if (/\b(?:mining|mine site|mining site|stockpile|site closing|mining dispatch|mining fuel|mining production)\b/i.test(text)) {
    return true;
  }
  const operationalTopic = /\b(?:production|dispatch|fuel|diesel|stockpile|equipment|utili[sz]ation|breakdown|operating cost|cost per unit|incident|crew|site performance)\b/i.test(text);
  const miningAnchor = /\b(?:mine|mining|site|ore|stockpile|pit|plant)\b/i.test(text);
  return operationalTopic && miningAnchor;
}

function getMiningExpertPack({ includeAvailability = true } = {}) {
  return Object.freeze({
    ...MINING_EXPERT_PACK,
    deployment_availability: includeAvailability ? miningRuntimeAvailability() : null,
  });
}

module.exports = {
  MINING_EXPERT_PACK,
  MINING_RUNTIME_FILES,
  MINING_SOURCE_BASE_COMMIT,
  getMiningExpertPack,
  isMiningExpertPrompt,
  miningRuntimeAvailability,
  runtimePath,
};
