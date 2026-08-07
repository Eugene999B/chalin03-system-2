"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  maskPhone,
  safeCustomer,
  safeSuggestion,
} = require("../services/aiCustomerIdentityIntelligenceService");
const {
  registerCustomerIdentityAiTools,
} = require("../ai-tools/customerIdentityTools");

const repoRoot = path.resolve(__dirname, "../..");
const toolSource = fs.readFileSync(
  path.join(repoRoot, "backend/ai-tools/customerIdentityTools.js"),
  "utf8"
);
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/aiCustomerIdentityIntelligenceService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/aiRoutes.js"),
  "utf8"
);

const context = Object.freeze({
  actor: Object.freeze({ id: 15, role: "staff" }),
  scope: Object.freeze({
    persona: "copilot",
    workspace_code: "spare_parts",
    branch_id: 3,
  }),
});

const finderOutput = Object.freeze({
  workspace_code: "spare_parts",
  branch_id: 3,
  algorithm_version: "customer-identity-v1.0",
  minimum_score: 58,
  database_customer_count: 120,
  scanned_customer_count: 120,
  scan_limited: false,
  total_matching_pairs: 1,
  returned_pairs: 1,
  suggestions: [
    {
      pair_id: "17-29",
      score: 91,
      confidence: "very_likely",
      reasons: ["Same normalized phone number", "Close spelling match"],
      warnings: [],
      recommended_master_id: 17,
      customers: [
        {
          customer_id: 17,
          customer_name: "Eugene Appiah",
          phone_masked: "***1234",
          customer_location: "Dunkwa",
          transaction_count: 14,
          outstanding_balance: 600,
        },
        {
          customer_id: 29,
          customer_name: "Eugine Appiah",
          phone_masked: "***1234",
          customer_location: "Dunkwa",
          transaction_count: 2,
          outstanding_balance: 0,
        },
      ],
    },
  ],
  execution_authority: "suggestion_only",
  merge_executed: false,
  generated_at: "2026-08-07T15:45:00.000Z",
});

test("phone masking never returns the full customer phone number", () => {
  assert.equal(maskPhone("024 123 4567"), "***4567");
  assert.equal(maskPhone("+233241234567"), "***4567");
  assert.equal(maskPhone(""), null);
});

test("safe customer identity retains useful review evidence while masking phone", () => {
  const customer = safeCustomer({
    customer_id: 44,
    customer_name: "Customer Review",
    customer_phone: "0241234567",
    customer_location: "Dunkwa",
    sale_count: 6,
    debt_count: 1,
    active_debt_count: 1,
    outstanding_balance: 125.556,
    total_sales_value: 850,
    transaction_count: 7,
  });
  assert.equal(customer.customer_id, 44);
  assert.equal(customer.phone_masked, "***4567");
  assert.equal(customer.outstanding_balance, 125.56);
  assert.doesNotMatch(JSON.stringify(customer), /0241234567/);
});

test("safe duplicate suggestion contains no unmasked phone field", () => {
  const suggestion = safeSuggestion({
    pair_id: "1-2",
    score: 87,
    confidence: "likely",
    reasons: ["Same phone"],
    warnings: [],
    recommended_master_id: 1,
    customers: [
      { customer_id: 1, customer_name: "One", customer_phone: "0241112222" },
      { customer_id: 2, customer_name: "Two", customer_phone: "0241112222" },
    ],
  });
  const serialized = JSON.stringify(suggestion);
  assert.doesNotMatch(serialized, /0241112222/);
  assert.match(serialized, /\*\*\*2222/);
  assert.equal(Object.hasOwn(suggestion.customers[0], "customer_phone"), false);
});

test("duplicate customer AI tool is R2, branch-scoped and suggestion-only", async () => {
  const registry = new AiToolRegistry();
  registerCustomerIdentityAiTools(registry, {
    finder: async ({ context: receivedContext }) => {
      assert.equal(receivedContext.scope.branch_id, 3);
      return finderOutput;
    },
  });
  const tool = registry.get("spare_parts.duplicate_customer_suggestions");
  assert.equal(tool.risk_level, 2);
  assert.deepEqual(tool.allowed_workspaces, ["spare_parts"]);
  assert.deepEqual(tool.required_permissions, ["ai.use", "ai.read_sensitive"]);
  assert.equal(tool.scope_requirements.branch, true);
  assert.equal(tool.evidence_required, true);

  const output = await tool.handler({ input: { limit: 8 }, context });
  assert.equal(output.execution_authority, "suggestion_only");
  assert.equal(output.merge_executed, false);
  assert.equal(output.evidence[0].classification, "sensitive");
  assert.equal(output.evidence[0].metadata.phones_masked, true);
  assert.equal(output.evidence[0].metadata.merge_executed, false);
  assert.doesNotMatch(JSON.stringify(output), /024\d{7}/);
});

test("customer identity AI service is branch-bounded and reuses the proven matcher", () => {
  assert.match(serviceSource, /duplicateSuggestions/);
  assert.match(serviceSource, /ALGORITHM_VERSION/);
  assert.match(serviceSource, /WHERE c\.branch_id = \?/);
  assert.match(serviceSource, /WHERE branch_id = \?/);
  assert.match(serviceSource, /MAX_SCAN_ROWS = 3000/);
  assert.match(serviceSource, /execution_authority: "suggestion_only"/);
  assert.match(serviceSource, /merge_executed: false/);
  assert.doesNotMatch(serviceSource, /UPDATE\s+customers|DELETE\s+FROM\s+customers/i);
});

test("customer identity AI tool layer contains no database or merge execution path", () => {
  assert.doesNotMatch(
    toolSource,
    /config\/db|mysql2|\bpool\s*\.|\bconnection\s*\.|\.query\s*\(|mergeCustomers|\/merge|UPDATE\s+customers|DELETE\s+FROM/i
  );
  assert.match(toolSource, /suggestion_only/);
  assert.match(toolSource, /phones_masked: true/);
});

test("staff AI router registers customer identity suggestions", () => {
  assert.match(routeSource, /registerCustomerIdentityAiTools/);
  assert.match(routeSource, /registerCustomerIdentityAiTools\(\)/);
});