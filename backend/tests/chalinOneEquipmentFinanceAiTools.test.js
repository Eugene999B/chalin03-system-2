"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  AiToolRegistry,
  AiToolRegistryError,
  aiToolRegistry,
} = require("../services/aiToolRegistry");
const {
  AiPermissionError,
  assertEquipmentDivision,
  buildToolExecutionContext,
} = require("../services/aiPermissionService");
const { availableTools } = require("../services/aiOrchestratorService");
const {
  aggregateArrearsRows,
  safePortfolio,
} = require("../services/aiEquipmentFinanceIntelligenceService");
const {
  evidenceFor,
  registerEquipmentFinanceAiTools,
} = require("../ai-tools/equipmentFinanceTools");
const { registerHireAiTools } = require("../ai-tools/hireTools");

const repoRoot = path.resolve(__dirname, "../..");
const financeToolSource = fs.readFileSync(
  path.join(repoRoot, "backend", "ai-tools", "equipmentFinanceTools.js"),
  "utf8"
);
const financeServiceSource = fs.readFileSync(
  path.join(repoRoot, "backend", "services", "aiEquipmentFinanceIntelligenceService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend", "routes", "aiRoutes.js"),
  "utf8"
);

function financeRoleUser(overrides = {}) {
  return {
    id: 901,
    username: "finance.manager",
    role: "staff",
    workspace_code: "equipment_hire",
    workspace_role: "finance_manager",
    effective_permissions: [
      "workspace.view",
      "fleet.assets.view",
      "ai.use",
      "ai.read",
      "ai.tools.view",
    ],
    ...overrides,
  };
}

function hireRoleUser(overrides = {}) {
  return {
    id: 902,
    username: "hire.officer",
    role: "staff",
    workspace_code: "equipment_hire",
    workspace_role: "hire_officer",
    effective_permissions: [
      "workspace.view",
      "fleet.assets.view",
      "hire.reports.view",
      "ai.use",
      "ai.read",
      "ai.tools.view",
    ],
    ...overrides,
  };
}

function financeDefinition(overrides = {}) {
  return {
    key: "test.finance_division",
    title: "Finance division test",
    description: "Verifies Finance-only AI isolation.",
    version: "1",
    risk_level: 1,
    personas: ["copilot"],
    required_permissions: ["ai.use", "ai.read"],
    required_business_permissions: ["fleet.assets.view"],
    required_equipment_division: "finance",
    allowed_workspaces: ["equipment_hire"],
    scope_requirements: {},
    evidence_required: false,
    handler: async () => ({ evidence: [] }),
    ...overrides,
  };
}

test("Equipment Finance AI registers four company-wide aggregate tools", () => {
  const registry = new AiToolRegistry();
  registerEquipmentFinanceAiTools(registry, {
    portfolio: async () => ({}),
    arrears: async () => ({}),
    cashflow: async () => ({}),
    salesPipeline: async () => ({}),
  });

  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  assert.deepEqual(
    tools.map((tool) => tool.key),
    [
      "equipment_finance.arrears_health",
      "equipment_finance.cashflow_health",
      "equipment_finance.portfolio_health",
      "equipment_finance.sales_pipeline",
    ]
  );
  assert.equal(
    tools.every((tool) => tool.required_equipment_division === "finance"),
    true
  );
  assert.equal(
    tools.every((tool) => tool.scope_requirements.hire_location === false),
    true
  );
  assert.equal(
    tools.every((tool) => tool.required_business_permissions.includes("fleet.assets.view")),
    true
  );
  assert.equal(tools.every((tool) => tool.risk_level === 1), true);
});

test("Hire AI tools are explicitly Hire-only", () => {
  const registry = new AiToolRegistry();
  registerHireAiTools(registry, { loader: async () => ({}) });
  const tools = registry.list({ persona: "copilot", workspace: "equipment_hire" });
  assert.deepEqual(
    tools.map((tool) => tool.key),
    [
      "equipment_hire.fleet_health",
      "equipment_hire.operations_snapshot",
      "equipment_hire.performance_diagnostics",
      "equipment_hire.receivables_health",
    ]
  );
  assert.equal(
    tools.every((tool) => tool.required_equipment_division === "hire"),
    true
  );
  assert.equal(
    tools.every((tool) => tool.scope_requirements.hire_location === true),
    true
  );
});

test("AI registry rejects an unknown equipment division", () => {
  const registry = new AiToolRegistry();
  assert.throws(
    () =>
      registry.register(
        financeDefinition({
          key: "test.invalid_equipment_division",
          required_equipment_division: "finance_and_hire_everything",
        })
      ),
    (error) =>
      error instanceof AiToolRegistryError &&
      error.code === "AI_TOOL_EQUIPMENT_DIVISION_INVALID"
  );
});

test("Finance roles pass the Finance division gate and Hire roles are denied", () => {
  assert.doesNotThrow(() => assertEquipmentDivision(financeRoleUser(), "finance"));
  assert.throws(
    () => assertEquipmentDivision(hireRoleUser(), "finance"),
    (error) =>
      error instanceof AiPermissionError &&
      error.code === "AI_EQUIPMENT_DIVISION_DENIED"
  );
  assert.doesNotThrow(() => assertEquipmentDivision(hireRoleUser(), "hire"));
  assert.throws(
    () => assertEquipmentDivision(financeRoleUser(), "hire"),
    (error) =>
      error instanceof AiPermissionError &&
      error.code === "AI_EQUIPMENT_DIVISION_DENIED"
  );
});

test("Finance execution context needs Finance division even with fleet view permission", () => {
  const tool = financeDefinition();
  const financeReq = { user: financeRoleUser(), headers: {}, requestId: "finance-ok" };
  const context = buildToolExecutionContext({
    req: financeReq,
    persona: "copilot",
    tool,
  });
  assert.equal(context.scope.workspace_code, "equipment_hire");
  assert.equal(context.scope.hire_location_id, null);
  assert.equal(context.tool.required_equipment_division, "finance");

  const hireReq = { user: hireRoleUser(), headers: {}, requestId: "finance-denied" };
  assert.throws(
    () => buildToolExecutionContext({ req: hireReq, persona: "copilot", tool }),
    (error) =>
      error instanceof AiPermissionError &&
      error.code === "AI_EQUIPMENT_DIVISION_DENIED"
  );
});

test("provider tool menu does not leak Finance tools to Hire-only users", () => {
  const key = "test.finance_provider_visibility";
  if (!aiToolRegistry.tools.has(key)) {
    aiToolRegistry.register(financeDefinition({ key }));
  }
  const scope = { workspace_code: "equipment_hire" };

  assert.equal(
    availableTools({ persona: "copilot", scope, user: hireRoleUser() }).some(
      (tool) => tool.key === key
    ),
    false
  );
  assert.equal(
    availableTools({ persona: "copilot", scope, user: financeRoleUser() }).some(
      (tool) => tool.key === key
    ),
    true
  );
});

test("portfolio sanitizer removes customer and payment-row detail", () => {
  const safe = safePortfolio(
    {
      period: { date_from: "2026-01-01", date_to: "2026-08-07" },
      summary: {
        agreement_count: 2,
        overdue_count: 1,
        overdue_balance: 500,
      },
      statuses: [{ status: "active", accounts: 2 }],
      aging: [{ aging_bucket: "1_30", accounts: 1, overdue_amount: 500 }],
      upcoming: [{ due_window: "7_days", agreements: 1, expected_amount: 300 }],
      accounts: [
        {
          customer_name: "Must Not Leak",
          customer_phone: "0240000000",
          agreement_number: "FIN-001",
        },
      ],
      recent_payments: [
        {
          customer_name: "Must Not Leak",
          receipt_number: "REC-001",
          amount: 100,
        },
      ],
    },
    Object.freeze({ application_count: 1 }),
    Object.freeze({ sale_capable_assets: 3, available_for_sale: 2 })
  );

  const serialized = JSON.stringify(safe);
  assert.equal(Object.hasOwn(safe, "accounts"), false);
  assert.equal(Object.hasOwn(safe, "recent_payments"), false);
  assert.equal(safe.customer_rows_exposed, false);
  assert.doesNotMatch(serialized, /Must Not Leak|0240000000|FIN-001|REC-001/);
});

test("arrears intelligence aggregates customer rows into aging buckets", () => {
  const aging = aggregateArrearsRows([
    {
      aging_bucket: "1_30",
      calculated_arrears: 100,
      outstanding_balance: 500,
      missed_lines: 1,
      customer_name: "Private A",
    },
    {
      aging_bucket: "1_30",
      calculated_arrears: 50,
      outstanding_balance: 250,
      missed_lines: 2,
      customer_name: "Private B",
    },
    {
      aging_bucket: "over_90",
      calculated_arrears: 400,
      outstanding_balance: 900,
      missed_lines: 4,
      customer_name: "Private C",
    },
  ]);

  assert.deepEqual(aging, [
    {
      bucket: "1_30",
      accounts: 2,
      arrears: 150,
      outstanding: 750,
      missed_lines: 3,
    },
    {
      bucket: "over_90",
      accounts: 1,
      arrears: 400,
      outstanding: 900,
      missed_lines: 4,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(aging), /Private A|Private B|Private C/);
});

test("Finance evidence is confidential, aggregate-only and no-customer-row", () => {
  const [evidence] = evidenceFor("portfolio", {
    scope: {
      workspace_code: "equipment_hire",
      equipment_division: "finance",
      finance_scope: "company_wide",
    },
    summary: { agreement_count: 5 },
    customer_rows_exposed: false,
    generated_at: "2026-08-07T17:30:00.000Z",
  });

  assert.equal(evidence.classification, "confidential");
  assert.equal(evidence.metadata.equipment_division, "finance");
  assert.equal(evidence.metadata.aggregate_only, true);
  assert.equal(evidence.metadata.customer_rows_exposed, false);
  assert.equal(evidence.metadata.execution_authority, "read_only");
});

test("Finance AI tool handlers contain no direct database or mutation path", () => {
  assert.doesNotMatch(
    financeToolSource,
    /config\/db|mysql2|\bpool\s*\.|\bconnection\s*\.|\.query\s*\(|\bSELECT\s+|\bINSERT\s+INTO\b|\bUPDATE\s+|\bDELETE\s+FROM\b/i
  );
  assert.match(financeToolSource, /required_equipment_division: "finance"/);
  assert.match(financeToolSource, /execution_authority: "read_only"/);
  assert.match(financeServiceSource, /getPortfolioDashboard/);
  assert.match(financeServiceSource, /getArrearsReport/);
  assert.match(financeServiceSource, /getCashFlowReport/);
  assert.match(financeServiceSource, /customer_rows_exposed: false/);
});

test("staff AI router registers Finance tools and filters equipment divisions", () => {
  assert.match(routeSource, /registerEquipmentFinanceAiTools/);
  assert.match(routeSource, /registerEquipmentFinanceAiTools\(\)/);
  assert.match(routeSource, /hasToolDivisionAccess/);
  assert.match(routeSource, /hasEquipmentDivisionAccess/);
});
