"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  AI_PERMISSIONS,
  getEffectiveAiPermissions,
} = require("../security/aiPermissionCatalog");
const {
  AiPermissionError,
  buildToolExecutionContext,
  validateAiScopeAccess,
} = require("../services/aiPermissionService");
const {
  AiToolRegistry,
  AiToolRegistryError,
} = require("../services/aiToolRegistry");
const { normalizeEvidence } = require("../services/aiEvidenceService");
const { registerMiningAiTools } = require("../ai-tools/miningTools");
const { registerHireAiTools } = require("../ai-tools/hireTools");
const { registerSparePartsAiTools } = require("../ai-tools/sparePartsTools");
const {
  buildEvidence: buildCustomerIdentityEvidence,
  registerCustomerIdentityAiTools,
} = require("../ai-tools/customerIdentityTools");

function definition(overrides = {}) {
  return {
    key: "test.read_tool",
    title: "Test read tool",
    description: "A read-only test tool.",
    risk_level: 1,
    personas: ["copilot"],
    required_permissions: ["ai.use", "ai.read"],
    required_business_permissions: [],
    allowed_workspaces: ["spare_parts"],
    evidence_required: false,
    handler: async () => ({ evidence: [] }),
    ...overrides,
  };
}

test("AI permission catalog registers normal and sensitive read authority", () => {
  assert.equal(AI_PERMISSIONS.includes("ai.read"), true);
  assert.equal(AI_PERMISSIONS.includes("ai.read_sensitive"), true);

  const manager = getEffectiveAiPermissions({
    id: 20,
    role: "manager",
    workspace_code: "spare_parts",
  });
  assert.equal(manager.includes("ai.read"), true);
  assert.equal(manager.includes("ai.read_sensitive"), false);

  const admin = getEffectiveAiPermissions({
    id: 21,
    role: "admin",
    workspace_code: "spare_parts",
  });
  assert.equal(admin.includes("ai.read"), true);
  assert.equal(admin.includes("ai.read_sensitive"), true);
});

test("AI registry rejects unknown business permission codes", () => {
  const registry = new AiToolRegistry();
  assert.throws(
    () =>
      registry.register(
        definition({ required_business_permissions: ["mining.not_a_real_permission"] })
      ),
    (error) =>
      error instanceof AiToolRegistryError &&
      error.code === "AI_TOOL_BUSINESS_PERMISSION_INVALID"
  );
});

test("tool execution context enforces ordinary business permissions", () => {
  const tool = definition({
    required_business_permissions: ["spare_parts.manage"],
    scope_requirements: { branch: true },
  });
  const req = {
    requestId: "req-business-gate",
    headers: {},
    user: {
      id: 30,
      username: "staff",
      role: "staff",
      workspace_code: "spare_parts",
      branch_id: 4,
      effective_permissions: ["spare_parts.read", "ai.use", "ai.read"],
    },
  };

  assert.throws(
    () => buildToolExecutionContext({ req, persona: "copilot", tool }),
    (error) =>
      error instanceof AiPermissionError &&
      error.code === "AI_TOOL_BUSINESS_PERMISSION_DENIED"
  );
});

test("Mining and Hire context IDs are independently revalidated", async () => {
  const miningTool = definition({
    allowed_workspaces: ["mining"],
    scope_requirements: { mining_site: true },
  });
  await assert.doesNotReject(() =>
    validateAiScopeAccess({
      req: {},
      scope: { mining_site_id: 7 },
      tool: miningTool,
      miningResolver: async () => ({ siteId: 7 }),
    })
  );
  await assert.rejects(
    () =>
      validateAiScopeAccess({
        req: {},
        scope: { mining_site_id: 7 },
        tool: miningTool,
        miningResolver: async () => ({ siteId: 8 }),
      }),
    (error) =>
      error instanceof AiPermissionError &&
      error.code === "AI_MINING_SITE_ACCESS_DENIED"
  );

  const hireTool = definition({
    allowed_workspaces: ["equipment_hire"],
    scope_requirements: { hire_location: true },
  });
  await assert.doesNotReject(() =>
    validateAiScopeAccess({
      req: {},
      scope: { hire_location_id: 11 },
      tool: hireTool,
      hireResolver: async () => ({ locationId: 11 }),
    })
  );
  await assert.rejects(
    () =>
      validateAiScopeAccess({
        req: {},
        scope: { hire_location_id: 11 },
        tool: hireTool,
        hireResolver: async () => ({ locationId: 12 }),
      }),
    (error) =>
      error instanceof AiPermissionError &&
      error.code === "AI_HIRE_LOCATION_ACCESS_DENIED"
  );
});

test("domain AI tool registrations carry workspace and business boundaries", () => {
  const mining = new AiToolRegistry();
  registerMiningAiTools(mining, { loader: async () => ({}) });
  const miningTools = mining.list({ persona: "copilot", workspace: "mining" });
  assert.deepEqual(
    miningTools.map((tool) => tool.key),
    [
      "mining.operations_snapshot",
      "mining.performance_diagnostics",
      "mining.production_cost_health",
      "mining.stock_fuel_health",
    ]
  );
  assert.equal(
    miningTools.every((tool) => tool.scope_requirements.mining_site === true),
    true
  );
  assert.equal(
    miningTools.every((tool) => tool.required_business_permissions.length > 0),
    true
  );
  const miningDiagnostics = miningTools.find(
    (tool) => tool.key === "mining.performance_diagnostics"
  );
  assert.equal(miningDiagnostics.risk_level, 1);
  assert.deepEqual(miningDiagnostics.required_business_permissions, ["mining.reports.view"]);

  const hire = new AiToolRegistry();
  registerHireAiTools(hire, { loader: async () => ({}) });
  const hireTools = hire.list({ persona: "copilot", workspace: "equipment_hire" });
  assert.deepEqual(
    hireTools.map((tool) => tool.key),
    [
      "equipment_hire.fleet_health",
      "equipment_hire.operations_snapshot",
      "equipment_hire.performance_diagnostics",
      "equipment_hire.receivables_health",
    ]
  );
  assert.equal(
    hireTools.every((tool) => tool.scope_requirements.hire_location === true),
    true
  );
  assert.equal(
    hireTools.every((tool) => tool.required_business_permissions.length > 0),
    true
  );
  const hireDiagnostics = hireTools.find(
    (tool) => tool.key === "equipment_hire.performance_diagnostics"
  );
  assert.equal(hireDiagnostics.risk_level, 1);
  assert.deepEqual(hireDiagnostics.required_business_permissions, ["hire.reports.view"]);
  assert.equal(hireDiagnostics.required_equipment_division, "hire");
});

test("Spare Parts AI tools now use registered AI and business read gates", () => {
  const registry = new AiToolRegistry();
  registerSparePartsAiTools(registry, { loader: async () => ({}) });
  const tools = registry.list({ persona: "copilot", workspace: "spare_parts" });
  const operations = tools.find((tool) => tool.key === "spare_parts.operations_snapshot");
  const collections = tools.find((tool) => tool.key === "spare_parts.collections_health");
  assert.deepEqual(operations.required_permissions, ["ai.use", "ai.read"]);
  assert.deepEqual(operations.required_business_permissions, ["spare_parts.read"]);
  assert.deepEqual(collections.required_business_permissions, ["spare_parts.audit"]);
});

test("duplicate-customer AI uses valid sensitive evidence and never gains merge authority", () => {
  const registry = new AiToolRegistry();
  registerCustomerIdentityAiTools(registry, { finder: async () => ({}) });
  const [tool] = registry.list({ persona: "copilot", workspace: "spare_parts" });
  assert.equal(tool.key, "spare_parts.duplicate_customer_suggestions");
  assert.deepEqual(tool.required_permissions, ["ai.use", "ai.read_sensitive"]);
  assert.deepEqual(tool.required_business_permissions, ["spare_parts.manage"]);
  assert.equal(tool.risk_level, 2);

  const [evidence] = buildCustomerIdentityEvidence({
    branch_id: 4,
    algorithm_version: "test-v1",
    minimum_score: 80,
    database_customer_count: 2,
    scanned_customer_count: 2,
    scan_limited: false,
    total_matching_pairs: 1,
    returned_pairs: 1,
    generated_at: new Date().toISOString(),
    suggestions: [
      {
        pair_id: "1-2",
        score: 92,
        confidence: "very_likely",
        reasons: ["Same normalized phone number"],
        warnings: [],
        recommended_master_id: 1,
        customers: [
          {
            customer_id: 1,
            customer_name: "Customer A",
            phone_masked: "+233******123",
            customer_location: "Accra",
            transaction_count: 3,
            outstanding_balance: 0,
          },
          {
            customer_id: 2,
            customer_name: "Customer A",
            phone_masked: "+233******123",
            customer_location: "Accra",
            transaction_count: 1,
            outstanding_balance: 0,
          },
        ],
      },
    ],
  });
  const normalized = normalizeEvidence(evidence);
  assert.equal(normalized.classification, "sensitive");
  assert.equal(normalized.metadata.merge_executed, false);
  assert.equal(normalized.metadata.phones_masked, true);
});

test("AI routes register all three operational-domain tool families", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "routes", "aiRoutes.js"),
    "utf8"
  );
  for (const marker of [
    "registerSparePartsAiTools();",
    "registerCustomerIdentityAiTools();",
    "registerMiningAiTools();",
    "registerHireAiTools();",
  ]) {
    assert.equal(source.includes(marker), true, `Missing ${marker}`);
  }
  assert.equal(source.includes("hasEveryPermission"), true);
});
