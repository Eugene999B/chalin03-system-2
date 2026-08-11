"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_PROVIDER_ROUTED_TOOLS,
  recentUserRoutingQuestions,
  selectRelevantProviderTools,
} = require("../services/aiProviderToolRoutingService");
const {
  generateProviderResponse,
} = require("../services/aiProviderService");

function tool(key, description) {
  return Object.freeze({
    key,
    title: key.replace(/[._-]+/g, " "),
    description,
    risk_level: 1,
    input_schema: { type: "object", properties: {} },
  });
}

function mixedToolCatalogue() {
  return Object.freeze([
    tool("spare_parts.operations_snapshot", "Spare Parts sales sold revenue purchase return expense store performance snapshot"),
    tool("spare_parts.collections_health", "Spare Parts customer debt debtor outstanding arrears collection payment health"),
    tool("spare_parts.inventory_health", "Spare Parts stock inventory quantity reorder dead stock valuation"),
    tool("payroll.worker_lookup", "Worker employee employment HR profile lookup"),
    tool("payroll.compensation_snapshot", "Payroll salary wage allowance deduction payslip worker compensation"),
    tool("mining.operations_snapshot", "Mining site production shift ore operations"),
    tool("mining.fuel_health", "Mining fuel usage stockpile diesel operations"),
    tool("equipment_hire.operations_snapshot", "Equipment hire rental contract dispatch fleet operations"),
    tool("equipment_hire.receivables_health", "Equipment hire invoice receivable debt collection overdue"),
    tool("equipment_finance.portfolio_health", "Installment equipment finance account repayment portfolio health"),
    tool("equipment_finance.arrears_health", "Installment finance arrears overdue repayment debt"),
    tool("audit.activity_trace", "Audit activity log trace anomaly suspicious changes"),
    tool("documents.report_context", "PDF Excel XLSX CSV Word DOCX report statement document context"),
    tool("system.scope_summary", "Authorized CHALIN scope summary"),
    tool("system.feature_status", "CHALIN feature availability read"),
    tool("content.public_summary", "Published public content summary"),
    tool("equipment.asset_lookup", "Equipment asset lookup"),
    tool("mining.contractor_lookup", "Mining contractor lookup"),
    tool("people.document_lookup", "Employment document lookup"),
    tool("finance.generic_lookup", "Finance record lookup"),
  ]);
}

test("large mixed catalogue is pruned to sales/debt tools for a sales-and-debt question", () => {
  const routing = selectRelevantProviderTools({
    messages: [
      { role: "user", content: "Tell me today's sales and current customer debt at Main Store" },
    ],
    tools: mixedToolCatalogue(),
  });

  assert.equal(routing.mode, "prompt_ranked");
  assert.ok(routing.original_count > MAX_PROVIDER_ROUTED_TOOLS);
  assert.ok(routing.selected_count <= MAX_PROVIDER_ROUTED_TOOLS);
  assert.ok(routing.selected_keys.includes("spare_parts.operations_snapshot"));
  assert.ok(routing.selected_keys.includes("spare_parts.collections_health"));
  assert.equal(routing.selected_keys.includes("payroll.compensation_snapshot"), false);
  assert.equal(routing.selected_keys.includes("mining.fuel_health"), false);
});

test("short date follow-up inherits recent user task for tool routing", () => {
  const messages = [
    { role: "user", content: "How much did Main Store sell today?" },
    { role: "assistant", content: "Main Store sales answer." },
    { role: "user", content: "What about yesterday?" },
  ];
  const questions = recentUserRoutingQuestions(messages);
  const routing = selectRelevantProviderTools({ messages, tools: mixedToolCatalogue() });

  assert.deepEqual(questions, ["How much did Main Store sell today?", "What about yesterday?"]);
  assert.equal(routing.mode, "prompt_ranked");
  assert.ok(routing.selected_keys.includes("spare_parts.operations_snapshot"));
  assert.equal(routing.selected_keys.includes("payroll.compensation_snapshot"), false);
});

test("payroll question routes payroll and worker tools without unrelated sales/mining tools", () => {
  const routing = selectRelevantProviderTools({
    messages: [
      { role: "user", content: "Show the current payroll salary for this worker" },
    ],
    tools: mixedToolCatalogue(),
  });

  assert.equal(routing.mode, "prompt_ranked");
  assert.ok(routing.selected_keys.includes("payroll.compensation_snapshot"));
  assert.ok(routing.selected_keys.includes("payroll.worker_lookup"));
  assert.equal(routing.selected_keys.includes("spare_parts.operations_snapshot"), false);
  assert.equal(routing.selected_keys.includes("mining.operations_snapshot"), false);
});

test("small already-authorized catalogue is preserved intact", () => {
  const tools = mixedToolCatalogue().slice(0, 4);
  const routing = selectRelevantProviderTools({
    messages: [{ role: "user", content: "sales today" }],
    tools,
  });
  assert.equal(routing.mode, "all_small_catalogue");
  assert.equal(routing.selected_count, tools.length);
  assert.deepEqual(routing.tools, tools);
});

test("low-confidence routing falls back to full authorized catalogue rather than guessing", () => {
  const tools = Array.from({ length: 14 }, (_, index) =>
    tool(`opaque.read.${index + 1}`, `Capability alpha${index} beta${index}`)
  );
  const routing = selectRelevantProviderTools({
    messages: [{ role: "user", content: "Please continue" }],
    tools,
  });

  assert.equal(routing.mode, "fallback_full_catalogue");
  assert.equal(routing.selected_count, tools.length);
});

test("provider boundary sends only routed tools to a private provider call", async () => {
  const observed = [];
  const provider = {
    key: "capture",
    async generate(input) {
      observed.push(input);
      return {
        text: "Captured routed tools.",
        model_key: "capture-v1",
        input_tokens: 10,
        output_tokens: 5,
        cost_micros: 0,
        finish_reason: "stop",
        tool_calls: [],
        provider_store_enabled: false,
      };
    },
  };

  await generateProviderResponse({
    provider,
    messages: [
      { role: "system", content: "Private governed CHALIN intelligence." },
      { role: "user", content: "Tell me today's sales and current customer debt at Main Store" },
    ],
    tools: mixedToolCatalogue(),
    providerContext: {
      persona: "copilot",
      data_classification: "internal",
      live_data_required: true,
    },
  });

  assert.equal(observed.length, 1);
  const keys = observed[0].tools.map((item) => item.key);
  assert.ok(keys.length <= MAX_PROVIDER_ROUTED_TOOLS);
  assert.ok(keys.includes("spare_parts.operations_snapshot"));
  assert.ok(keys.includes("spare_parts.collections_health"));
  assert.equal(keys.includes("payroll.compensation_snapshot"), false);
  assert.equal(observed[0].provider_context.provider_tool_routing_mode, "prompt_ranked");
  assert.equal(observed[0].provider_context.provider_tool_original_count, mixedToolCatalogue().length);
  assert.equal(observed[0].provider_context.provider_tool_selected_count, keys.length);
});
