"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  filterReadOnlyInvestigationTools,
} = require("../services/aiInvestigationLoopService");
const {
  loadCustomerCommercialIntelligence,
  maskPhone,
  normalizedWindow,
} = require("../services/aiCustomerCommercialIntelligenceService");
const {
  registerCustomerCommercialAiTools,
} = require("../ai-tools/customerCommercialTools");
const {
  getExpertPack,
} = require("../services/aiExpertPackService");
const {
  LocalCustomerAccountingGovernedProvider,
  composeCustomerCommercialAnswer,
  customerCommercialToolInput,
  shouldUseCustomerCommercialTool,
} = require("../ai-providers/localCustomerAccountingGovernedProvider");

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

function topConnection() {
  return {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ");
      if (text.includes("FROM branches")) {
        return [[{ id: 4, branch_code: "MAIN", branch_name: "Main Store" }]];
      }
      if (text.includes("GROUP BY s.customer_id, customer_name, customer_phone")) {
        return [[
          {
            customer_id: 11,
            customer_name: "Alpha Mining",
            customer_phone: "0244000111",
            sales_count: 4,
            total_sales: 700,
            sale_record_paid_amount: 500,
            selected_sale_balance: 200,
            last_sale_at: "2026-08-11T09:00:00.000Z",
          },
          {
            customer_id: 22,
            customer_name: "Beta Works",
            customer_phone: "0203000222",
            sales_count: 2,
            total_sales: 300,
            sale_record_paid_amount: 300,
            selected_sale_balance: 0,
            last_sale_at: "2026-08-11T08:00:00.000Z",
          },
        ]];
      }
      if (
        text.includes("SELECT COALESCE(SUM(s.total), 0) AS total_sales") &&
        !text.includes("GROUP BY")
      ) {
        return [[{ total_sales: 1000 }]];
      }
      if (text.includes("COUNT(CASE WHEN d.balance > 0 THEN 1 END)")) {
        const customerId = Number(params[params.length - 1] || 0);
        return [[
          customerId === 11
            ? {
                active_debt_count: 2,
                outstanding_balance: 180,
                overdue_balance: 80,
                oldest_open_due_date: "2026-07-01",
              }
            : {
                active_debt_count: 0,
                outstanding_balance: 0,
                overdue_balance: 0,
                oldest_open_due_date: null,
              },
        ]];
      }
      throw new Error(`Unexpected query: ${text.slice(0, 180)}`);
    },
  };
}

function ambiguousConnection() {
  return {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, " ");
      if (text.includes("FROM branches")) {
        return [[{ id: 4, branch_code: "MAIN", branch_name: "Main Store" }]];
      }
      if (text.includes("UNION") && text.includes("candidate")) {
        return [[
          { customer_id: 31, customer_name: "Kofi Mensah", customer_phone: "0244000031" },
          { customer_id: 32, customer_name: "Kofi Mensah", customer_phone: "0203000032" },
        ]];
      }
      throw new Error(`Unexpected query: ${text.slice(0, 180)}`);
    },
  };
}

function accountConnection() {
  return {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, " ");
      if (text.includes("FROM branches")) {
        return [[{ id: 4, branch_code: "MAIN", branch_name: "Main Store" }]];
      }
      if (text.includes("identity_rows")) {
        return [[
          {
            customer_id: 11,
            customer_name: "Alpha Mining",
            customer_phone: "0244000111",
          },
        ]];
      }
      if (text.includes("COUNT(*) AS sales_count") && text.includes("FROM sales s")) {
        return [[
          {
            sales_count: 3,
            total_sales: 640,
            sale_record_paid_amount: 460,
            selected_sale_balance: 180,
            last_sale_at: "2026-08-11T09:00:00.000Z",
          },
        ]];
      }
      if (text.includes("COUNT(CASE WHEN d.balance > 0 THEN 1 END)")) {
        return [[
          {
            active_debt_count: 2,
            outstanding_balance: 180,
            overdue_balance: 80,
            oldest_open_due_date: "2026-07-01",
          },
        ]];
      }
      if (text.includes("FROM sale_items si")) {
        return [[
          { product_name: "Hydraulic Pump", quantity: 2, sales_value: 400 },
          { product_name: "Filter", quantity: 6, sales_value: 240 },
        ]];
      }
      throw new Error(`Unexpected query: ${text.slice(0, 180)}`);
    },
  };
}

function topOutputFixture() {
  return {
    scope: {
      workspace_code: "spare_parts",
      branch_id: 4,
      branch_code: "MAIN",
      branch_name: "Main Store",
      start_date: "2026-08-11",
      end_date: "2026-08-11",
    },
    mode: "top_customers",
    ranking_basis: "valid_sales_value_in_selected_period",
    branch_period_sales: 1000,
    customers: [
      {
        customer_id: 11,
        customer_name: "Alpha Mining",
        phone_masked: "024****111",
        identity_key: "id:11",
        ranking_basis: "valid_sales_value_in_selected_period",
        sales_count: 4,
        total_sales: 700,
        contribution_share_percent: 70,
        selected_sale_balance: 200,
        current_outstanding_debt: 180,
        current_overdue_debt: 80,
        active_debt_count: 2,
        oldest_open_due_date: "2026-07-01",
      },
    ],
    customer_rows_exposed: true,
    phone_numbers_masked: true,
    generated_at: "2026-08-11T14:00:00.000Z",
    execution_authority: "read_only_sensitive",
  };
}

test("customer 360 period defaults and phone masking are deterministic", () => {
  const now = new Date("2026-08-11T14:00:00.000Z");
  assert.deepEqual(normalizedWindow({}, { mode: "top_customers", now }), {
    start_date: "2026-08-11",
    end_date: "2026-08-11",
  });
  assert.deepEqual(normalizedWindow({}, { mode: "customer_account", now }), {
    start_date: "2026-07-13",
    end_date: "2026-08-11",
  });
  assert.equal(maskPhone("0244000111"), "024****111");
  assert.notEqual(maskPhone("0244000111"), "0244000111");
});

test("top-customer ranking uses valid period sales and keeps current debt separate", async () => {
  const output = await loadCustomerCommercialIntelligence({
    context,
    input: {
      mode: "top_customers",
      start_date: "2026-08-11",
      end_date: "2026-08-11",
      limit: 5,
    },
    connection: topConnection(),
    now: new Date("2026-08-11T14:00:00.000Z"),
  });
  assert.equal(output.ranking_basis, "valid_sales_value_in_selected_period");
  assert.equal(output.branch_period_sales, 1000);
  assert.equal(output.customers[0].customer_id, 11);
  assert.equal(output.customers[0].total_sales, 700);
  assert.equal(output.customers[0].contribution_share_percent, 70);
  assert.equal(output.customers[0].current_outstanding_debt, 180);
  assert.equal(output.customers[0].current_overdue_debt, 80);
  assert.equal(output.customers[0].phone_masked, "024****111");
  assert.equal(output.phone_numbers_masked, true);
  assert.equal(output.execution_authority, "read_only_sensitive");
});

test("exact customer-name ambiguity returns candidates instead of fuzzy guessing", async () => {
  const output = await loadCustomerCommercialIntelligence({
    context,
    input: {
      mode: "customer_account",
      customer_query: "Kofi Mensah",
      start_date: "2026-08-01",
      end_date: "2026-08-11",
    },
    connection: ambiguousConnection(),
  });
  assert.equal(output.resolution_status, "ambiguous");
  assert.equal(output.candidates.length, 2);
  assert.deepEqual(output.candidates.map((candidate) => candidate.customer_id), [31, 32]);
  assert.equal(output.candidates.every((candidate) => /\*/.test(candidate.phone_masked)), true);
  assert.equal(Object.hasOwn(output, "customer"), false);
});

test("customer account combines selected-period purchases with current receivable snapshot", async () => {
  const output = await loadCustomerCommercialIntelligence({
    context,
    input: {
      mode: "customer_account",
      customer_id: 11,
      start_date: "2026-08-01",
      end_date: "2026-08-11",
    },
    connection: accountConnection(),
  });
  assert.equal(output.resolution_status, "resolved");
  assert.equal(output.customer.customer_id, 11);
  assert.equal(output.customer.selected_period_sales, 640);
  assert.equal(output.customer.current_outstanding_debt, 180);
  assert.equal(output.customer.current_overdue_debt, 80);
  assert.equal(output.customer.top_purchased_items[0].product_name, "Hydraulic Pump");
  assert.equal(output.customer.top_purchased_items[0].sales_value, 400);
  assert.equal(output.customer.phone_masked, "024****111");
});

test("customer commercial tool is Risk-1 read-only but separately sensitive and branch-audited", async () => {
  const registry = new AiToolRegistry();
  registerCustomerCommercialAiTools(registry, {
    loader: async () => topOutputFixture(),
  });
  const [tool] = registry.list({ persona: "copilot", workspace: "spare_parts" });
  assert.equal(tool.key, "spare_parts.customer_commercial_360");
  assert.equal(tool.risk_level, 1);
  assert.deepEqual(tool.required_permissions, ["ai.use", "ai.read_sensitive"]);
  assert.deepEqual(tool.required_business_permissions, ["spare_parts.audit"]);
  assert.equal(tool.scope_requirements.branch, true);

  const providerTools = filterReadOnlyInvestigationTools([tool]);
  assert.equal(providerTools.length, 1);
  assert.equal(providerTools[0].key, tool.key);

  const output = await registry.get(tool.key).handler({ input: {}, context });
  assert.equal(output.execution_authority, "read_only_sensitive");
  assert.equal(output.evidence[0].classification, "sensitive");
  assert.equal(output.evidence[0].metadata.phones_masked, true);
  assert.equal(output.evidence[0].metadata.exact_identity_resolution_only, true);
});

test("customer accounting expert pack includes commercial ranking and exact-identity boundaries", () => {
  const pack = getExpertPack("customers_accounting_collections");
  assert.equal(pack.boundaries.customer_contribution_is_valid_sales_value_not_profit, true);
  assert.equal(pack.boundaries.customer_current_debt_is_separate_from_period_sales, true);
  assert.equal(pack.boundaries.customer_commercial_identity_resolution_is_exact_only, true);
  assert.equal(pack.boundaries.customer_commercial_phone_numbers_are_masked, true);
  assert.equal(pack.boundaries.customer_commercial_read_requires_sensitive_authority, true);
  assert.ok(pack.facts.some((fact) => fact.key === "customer_commercial_sensitive_read"));
  assert.ok(pack.workflows.some((workflow) => workflow.key === "customer_contribution_to_360"));
});

test("Local customer 360 selects top ranking and preserves exact customer referent on follow-up", async () => {
  const tool = {
    key: "spare_parts.customer_commercial_360",
    title: "Customer commercial 360 and contribution ranking",
    risk_level: 1,
  };
  const firstMessages = [
    { role: "user", content: "Which customer contributed most today?" },
  ];
  const selected = shouldUseCustomerCommercialTool({
    messages: firstMessages,
    tools: [tool],
    providerContext: { workspace_code: "spare_parts" },
  });
  assert.equal(selected.tool.key, tool.key);
  assert.equal(selected.input.mode, "top_customers");
  assert.equal(selected.input.limit, 5);
  assert.match(selected.input.start_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(selected.input.start_date, selected.input.end_date);

  const answer = composeCustomerCommercialAnswer({
    citation: "E1",
    heading: "Spare Parts customer contribution and debt ranking",
    excerpt: JSON.stringify(topOutputFixture()),
  });
  assert.match(answer, /Alpha Mining \(Customer ID 11\)/);
  assert.match(answer, /valid sales value/i);
  assert.match(answer, /current open debt/i);
  assert.match(answer, /not customer profit or margin/i);

  const followupMessages = [
    { role: "user", content: "Which customer contributed most today?" },
    { role: "assistant", content: answer },
    { role: "user", content: "What does he owe us?" },
  ];
  const followupInput = customerCommercialToolInput(followupMessages);
  assert.equal(followupInput.mode, "customer_account");
  assert.equal(followupInput.customer_id, 11);
  assert.match(followupInput.start_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(followupInput.start_date, followupInput.end_date);
  assert.equal(followupInput.start_date, selected.input.start_date);

  const provider = new LocalCustomerAccountingGovernedProvider();
  const response = await provider.generate({
    messages: followupMessages,
    tools: [tool],
    provider_context: { workspace_code: "spare_parts" },
  });
  assert.equal(response.finish_reason, "local_read_only_tool");
  assert.equal(response.tool_calls[0].tool_key, tool.key);
  assert.equal(response.tool_calls[0].input.mode, "customer_account");
  assert.equal(response.tool_calls[0].input.customer_id, 11);
  assert.equal(response.tool_calls[0].input.start_date, selected.input.start_date);
  assert.equal(response.tool_calls[0].input.end_date, selected.input.end_date);
});
