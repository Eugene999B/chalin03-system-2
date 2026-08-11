"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  expertPacksForPrompt,
  getExpertPack,
} = require("../services/aiExpertPackService");
const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
  productKnowledgeInstruction,
} = require("../services/aiProductKnowledgeService");
const {
  buildCustomerAccountingCollectionsDiagnostics,
} = require("../services/aiCustomerAccountingCollectionsDiagnosticsService");
const { registerSparePartsAiTools } = require("../ai-tools/sparePartsTools");
const { registerCustomerIdentityAiTools } = require("../ai-tools/customerIdentityTools");
const {
  LocalCustomerAccountingGovernedProvider,
  composeCustomerAccountingAnswer,
  composeCustomerAccountingProductAnswer,
  localCustomerAccountingToolCall,
  shouldUseCustomerAccountingTool,
} = require("../ai-providers/localCustomerAccountingGovernedProvider");

function fixture() {
  return {
    scope: {
      branch_id: 4,
      branch_code: "MAIN",
      branch_name: "Main Store",
      start_date: "2026-08-01",
      end_date: "2026-08-11",
      days: 11,
    },
    sales: {
      transaction_count: 20,
      total_sales: 100000,
      total_paid: 60000,
      total_balance: 40000,
      total_discount: 1000,
      collection_rate: 60,
    },
    debts: {
      active_debt_count: 8,
      total_debt_balance: 70000,
      new_debt_amount: 50000,
      debt_payments: 20000,
      aging: [
        { bucket: "0-30 days", count: 3, total: 20000 },
        { bucket: "31-60 days", count: 2, total: 15000 },
        { bucket: "61-90 days", count: 1, total: 10000 },
        { bucket: "Over 90 days", count: 2, total: 25000 },
      ],
    },
    purchases: {
      total_purchases: 60000,
      amount_paid: 45000,
      balance: 15000,
    },
    profit_and_loss: {
      estimated_net_before_stock_cost: 30000,
      warning:
        "Management estimate only. True profit requires reliable cost of goods sold and accountant-reviewed statutory treatment.",
    },
    audit: {
      audit_score: 72,
      audit_status: "REVIEW",
      flags: [],
    },
    recommendations: [
      { priority: "high", title: "Collect aged debt", action: "Prioritize older receivables." },
    ],
    generated_at: "2026-08-11T13:00:00.000Z",
  };
}

const context = Object.freeze({
  actor: Object.freeze({ id: 1, role: "admin" }),
  scope: Object.freeze({
    persona: "copilot",
    workspace_code: "spare_parts",
    branch_id: 4,
    mining_site_id: null,
    hire_location_id: null,
  }),
});

test("customer accounting expert pack teaches receivable and identity boundaries", () => {
  const pack = getExpertPack("customers_accounting_collections");
  assert.equal(pack.key, "customers_accounting_collections");
  assert.equal(pack.deployment_availability.status, "available_in_current_source_tree");
  assert.equal(pack.boundaries.period_sales_balance_may_overlap_current_debt_balance, true);
  assert.equal(pack.boundaries.debt_payment_is_not_new_sale, true);
  assert.equal(pack.boundaries.collection_rate_is_cash_conversion_not_profit, true);
  assert.equal(pack.boundaries.aging_is_not_automatic_writeoff, true);
  assert.equal(pack.boundaries.supplier_payables_are_not_customer_receivables, true);
  assert.equal(pack.boundaries.management_ledger_is_not_certified_statutory_ledger, true);
  assert.equal(pack.boundaries.aggregate_collections_has_no_customer_identity, true);
  assert.equal(pack.boundaries.duplicate_customer_tool_is_sensitive_suggestion_only, true);
});

test("customer accounting expert selection is specific and can combine with Spare Parts", () => {
  const accounting = expertPacksForPrompt(
    "How does customer debt aging and collections accounting work in CHALIN?"
  );
  assert.equal(
    accounting.some((pack) => pack.key === "customers_accounting_collections"),
    true
  );

  const mining = expertPacksForPrompt("How does Mining stockpile performance work in CHALIN?");
  assert.equal(
    mining.some((pack) => pack.key === "customers_accounting_collections"),
    false
  );

  const combined = expertPacksForPrompt(
    "How do Spare Parts sales become customer receivables and debt collections?"
  );
  assert.equal(combined.some((pack) => pack.key === "spare_parts_operations"), true);
  assert.equal(combined.some((pack) => pack.key === "customers_accounting_collections"), true);
});

test("product knowledge gets accounting rules while current customer debt stays governed", () => {
  const instruction = productKnowledgeInstruction(
    "How does customer debt accounting work in CHALIN?"
  );
  assert.match(instruction, /Customers, Receivables, Accounting & Collections Intelligence/);
  assert.match(instruction, /Never add selected-period sales balance and current active debt balance/i);
  assert.match(instruction, /Never treat a later debt payment as a second sale/i);
  assert.equal(
    isChalinProductKnowledgeTurn("How does customer debt accounting work in CHALIN?"),
    true
  );

  for (const prompt of [
    "Show me current customer debt balance",
    "What are our overdue customer receivables today?",
    "Give me current debt collections",
  ]) {
    assert.equal(isLikelyLiveRecordRequest(prompt), true, prompt);
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
  }
});

test("customer accounting diagnostics separate period balance, current debt and debt payments", () => {
  const output = buildCustomerAccountingCollectionsDiagnostics(fixture(), context);
  assert.equal(output.scope.branch_id, 4);
  assert.equal(output.performance_view.collection_rate, 60);
  assert.equal(output.performance_view.period_sales_balance, 40000);
  assert.equal(output.performance_view.total_debt_balance, 70000);
  assert.equal(output.performance_view.debt_payment_to_new_debt_reference_percent, 40);
  assert.equal(output.performance_view.older_debt_count, 3);
  assert.equal(output.performance_view.older_debt_total, 35000);
  assert.equal(output.performance_view.older_debt_share_percent, 50);
  assert.equal(output.certainty.period_sales_balance_may_overlap_current_debt_balance, true);
  assert.equal(output.certainty.balances_must_not_be_double_counted, true);
  assert.equal(output.certainty.debt_payment_is_not_new_sale, true);
  assert.equal(output.certainty.customer_identity_included, false);
  assert.equal(output.certainty.individual_debt_rows_included, false);

  const byKey = new Map(output.drivers.map((driver) => [driver.key, driver]));
  assert.equal(byKey.get("period_collection_pressure").effect, "cash_conversion_pressure");
  assert.equal(byKey.get("active_receivables_pressure").effect, "working_cash_and_credit_risk");
  assert.equal(byKey.get("new_debt_outpacing_debt_payments").effect, "receivable_accumulation_pressure");
  assert.equal(byKey.get("aged_receivables_pressure").effect, "collection_priority_pressure");
  assert.equal(byKey.get("supplier_payable_commitment").effect, "cash_commitment_separate_from_customer_receivables");
  assert.match(byKey.get("active_receivables_pressure").explanation, /must not be blindly added/i);
  assert.match(byKey.get("debt_collection_activity").explanation, /not be counted again as new sales/i);
  assert.match(byKey.get("aged_receivables_pressure").explanation, /does not by itself prove bad-debt write-off/i);
});

test("customer accounting diagnostic is Risk-1 branch aggregate while duplicate identity stays Risk-2", async () => {
  const registry = new AiToolRegistry();
  registerSparePartsAiTools(registry, {
    loader: async () => ({ intelligence: fixture(), context }),
  });
  const tools = registry.list({ persona: "copilot", workspace: "spare_parts" });
  const definition = tools.find(
    (tool) => tool.key === "spare_parts.customer_accounting_collections_diagnostics"
  );
  assert.ok(definition);
  assert.equal(definition.risk_level, 1);
  assert.equal(definition.scope_requirements.branch, true);
  assert.deepEqual(definition.required_business_permissions, ["spare_parts.audit"]);
  assert.match(definition.description, /without customer identities/i);

  const output = await registry.get(definition.key).handler({
    input: { start_date: "2026-08-01", end_date: "2026-08-11" },
    context,
  });
  assert.equal(output.execution_authority, "read_only");
  assert.equal(output.evidence[0].label, "Customer accounting and collections diagnostics");
  assert.equal(output.evidence[0].metadata.aggregate_only, true);
  assert.equal(output.evidence[0].metadata.customer_identity_included, false);

  const identityRegistry = new AiToolRegistry();
  registerCustomerIdentityAiTools(identityRegistry, { finder: async () => ({}) });
  const [identityTool] = identityRegistry.list({ persona: "copilot", workspace: "spare_parts" });
  assert.equal(identityTool.key, "spare_parts.duplicate_customer_suggestions");
  assert.equal(identityTool.risk_level, 2);
  assert.deepEqual(identityTool.required_permissions, ["ai.use", "ai.read_sensitive"]);
});

test("Local K7 chooses branch accounting diagnostics for causal receivable questions", async () => {
  const registry = new AiToolRegistry();
  registerSparePartsAiTools(registry, {
    loader: async () => ({ intelligence: fixture(), context }),
  });
  const tools = registry.list({ persona: "copilot", workspace: "spare_parts" });
  const messages = [
    { role: "user", content: "Why are customer receivables high today?" },
  ];

  const selected = shouldUseCustomerAccountingTool({
    messages,
    tools,
    providerContext: { workspace_code: "spare_parts" },
  });
  assert.equal(selected.key, "spare_parts.customer_accounting_collections_diagnostics");
  const call = localCustomerAccountingToolCall(selected, messages);
  assert.equal(call.tool_key, selected.key);
  assert.match(call.input.start_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(call.input.start_date, call.input.end_date);

  const provider = new LocalCustomerAccountingGovernedProvider();
  const response = await provider.generate({
    messages,
    tools,
    provider_context: { workspace_code: "spare_parts" },
  });
  assert.equal(response.finish_reason, "local_read_only_tool");
  assert.equal(response.tool_calls[0].tool_key, selected.key);
});

test("Local K7 evidence synthesis preserves receivable/accounting boundaries", async () => {
  const data = buildCustomerAccountingCollectionsDiagnostics(fixture(), context);
  const evidenceItem = {
    citation: "E1",
    heading: "Customer accounting and collections diagnostics",
    excerpt: JSON.stringify({
      branch_id: data.scope.branch_id,
      branch_code: data.scope.branch_code,
      branch_name: data.scope.branch_name,
      period: [data.scope.start_date, data.scope.end_date],
      performance_view: data.performance_view,
      certainty: data.certainty,
      causal_map: data.causal_map,
      drivers: data.drivers,
    }),
  };
  const direct = composeCustomerAccountingAnswer(evidenceItem);
  assert.match(direct, /current debt balance can overlap the selected-period sales balance/i);
  assert.match(direct, /Debt payments are collections of existing receivables, not a second sale/i);
  assert.match(direct, /Aging is a follow-up\/risk signal, not automatic write-off evidence/i);
  assert.match(direct, /\[E1\]/);

  const provider = new LocalCustomerAccountingGovernedProvider();
  const response = await provider.generate({
    messages: [
      {
        role: "system",
        content: `[E1] Customer accounting and collections diagnostics\n${evidenceItem.excerpt}`,
      },
      { role: "user", content: "Why are receivables high?" },
    ],
    tools: [],
    provider_context: { workspace_code: "spare_parts" },
  });
  assert.match(response.text, /must not be added together/i);
  assert.match(response.text, /not a second sale/i);
});

test("Local K7 product explanation teaches customer-accounting lifecycle without identities", async () => {
  const direct = composeCustomerAccountingProductAnswer();
  assert.match(direct, /Customer → Sale → Amount Paid \+ Unpaid Balance/i);
  assert.match(direct, /debt payment reduces an existing receivable/i);
  assert.match(direct, /can overlap/i);
  assert.match(direct, /not certified statutory accounts/i);
  assert.match(direct, /sensitive suggestion-only path/i);

  const provider = new LocalCustomerAccountingGovernedProvider();
  const response = await provider.generate({
    messages: [
      { role: "user", content: "How does customer debt accounting work in CHALIN?" },
    ],
    tools: [],
    provider_context: { public_safe_system_turn: true },
  });
  assert.match(response.text, /customer accounting follows a controlled chain/i);
  assert.match(response.text, /must not simply add them together/i);
  assert.match(response.text, /does not merge records automatically/i);
});
