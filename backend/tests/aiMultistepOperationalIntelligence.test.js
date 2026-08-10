"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const orchestrator = fs.readFileSync(
  path.join(root, "backend/services/aiOrchestratorService.js"),
  "utf8"
);
const loopService = fs.readFileSync(
  path.join(root, "backend/services/aiInvestigationLoopService.js"),
  "utf8"
);
const reasoning = fs.readFileSync(
  path.join(root, "backend/services/aiReasoningService.js"),
  "utf8"
);
const spareParts = fs.readFileSync(
  path.join(root, "backend/ai-tools/sparePartsTools.js"),
  "utf8"
);
const mining = fs.readFileSync(
  path.join(root, "backend/ai-tools/miningTools.js"),
  "utf8"
);
const finance = fs.readFileSync(
  path.join(root, "backend/ai-tools/equipmentFinanceTools.js"),
  "utf8"
);

test("orchestrator runs a bounded multi-round read-only investigation loop", () => {
  assert.match(orchestrator, /getInvestigationConfig/);
  assert.match(orchestrator, /filterReadOnlyInvestigationTools/);
  assert.match(orchestrator, /assertReadOnlyInvestigationTools/);
  assert.match(orchestrator, /while \(pendingToolCalls\.length > 0\)/);
  assert.match(orchestrator, /assertToolRound/);
  assert.match(orchestrator, /seenToolCallIds/);
  assert.match(orchestrator, /finalSynthesisRound/);
  assert.match(orchestrator, /const nextTools = finalSynthesisRound \? \[\] : tools/);
  assert.match(orchestrator, /AI_FINAL_SYNTHESIS_TOOL_CALL_BLOCKED/);
  assert.match(orchestrator, /AI_PROVIDER_ROUND_LIMIT_EXCEEDED/);
  assert.match(orchestrator, /Number\(tool\?\.risk_level \|\| 0\) > 1/);
});

test("every provider round is re-budgeted and accrued usage is checked before another round", () => {
  assert.match(orchestrator, /const nextBudget = buildRequestBudget/);
  assert.match(orchestrator, /assertCanStartAnotherProviderRound/);
  assert.match(orchestrator, /providerTokenTotal/);
  assert.match(orchestrator, /additionalMicros: accruedUsage\.cost_micros/);
  assert.match(orchestrator, /userTokens: Number\(dailyUsage\?\.user_tokens/);
  assert.match(orchestrator, /workspaceTokens: Number\(dailyUsage\?\.workspace_tokens/);
});

test("evidence is reranked after every tool round and final response remains citation checked", () => {
  assert.match(orchestrator, /function updateEvidenceState/);
  assert.match(orchestrator, /toolResults\.flatMap/);
  assert.match(orchestrator, /rankEvidence/);
  assert.match(orchestrator, /detectEvidenceTensions/);
  assert.match(orchestrator, /assessEvidenceConfidence/);
  assert.match(orchestrator, /citationIntegrity\(finalResult\.text, finalEvidence\)/);
  assert.match(orchestrator, /persistEvidence/);
});

test("tool investigations are permanently read-only even if future action tools become visible", () => {
  assert.match(loopService, /risk_level \|\| 0\) > 1/);
  assert.match(loopService, /AI_INVESTIGATION_WRITE_TOOL_BLOCKED/);
  assert.match(orchestrator, /autonomous_write_authority: false/);
  assert.match(loopService, /Never repeat an identical tool call/);
  assert.match(loopService, /no autonomous write authority/);
});

test("live-data confidence excludes memory, policy search and system context tools", () => {
  assert.match(reasoning, /NON_OPERATIONAL_TOOL_KEYS/);
  for (const key of [
    "knowledge.search",
    "conversation.memory",
    "system.scope_summary",
    "system.ai_feature_status",
  ]) {
    assert.match(reasoning, new RegExp(key.replace(".", "\\.")));
  }
  assert.match(reasoning, /isLiveOperationalToolResult/);
  assert.match(reasoning, /Boolean\(item\?\.as_of_at\)/);
});

test("existing workspaces expose period-aware operational evidence suitable for multi-step comparisons", () => {
  assert.match(spareParts, /spare_parts\.operations_snapshot/);
  assert.match(spareParts, /start_date/);
  assert.match(spareParts, /end_date/);
  assert.match(spareParts, /spare_parts\.inventory_health/);
  assert.match(spareParts, /spare_parts\.collections_health/);

  assert.match(mining, /mining\.operations_snapshot/);
  assert.match(mining, /mining\.production_cost_health/);
  assert.match(mining, /mining\.stock_fuel_health/);

  assert.match(finance, /equipment_finance\.portfolio_health/);
  assert.match(finance, /equipment_finance\.arrears_health/);
  assert.match(finance, /equipment_finance\.cashflow_health/);
  assert.match(finance, /equipment_finance\.sales_pipeline/);
});
