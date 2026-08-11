"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AiBudgetError,
  buildRequestBudget,
  transportBudgetPayload,
} = require("../services/aiCostControlService");
const {
  filterReadOnlyInvestigationTools,
} = require("../services/aiInvestigationLoopService");
const {
  MAX_PROVIDER_CONTEXT_CHARACTERS,
  providerMessageCharacters,
  sanitizeProviderMessages,
} = require("../services/aiSafetyService");

function oversizedToolCatalogue() {
  return Array.from({ length: 40 }, (_, index) => ({
    key: `governed.read.${index + 1}`,
    title: `Governed read tool ${index + 1}`,
    description: `Operational schema ${index + 1} ${"x".repeat(7000)}`,
    risk_level: 1,
    required_permissions: ["ai.use", "ai.tools.read"],
    required_business_permissions: ["sensitive.business.permission"],
    allowed_workspaces: ["spare_parts", "mining", "equipment_hire"],
    internal_execution_notes: "server-only metadata ".repeat(100),
    input_schema: {
      type: "object",
      description: "schema description ".repeat(200),
      properties: {
        query: {
          type: "string",
          description: "y".repeat(2000),
          examples: ["example".repeat(300)],
        },
      },
    },
  }));
}

const SMALL_TRANSPORT_ENV = Object.freeze({
  AI_REQUEST_TOKEN_LIMIT: "50000",
});

test("exact CHALIN business-description question is budgeted on the lightweight product payload", () => {
  const messages = [
    {
      role: "system",
      content: `Private operational orchestration context ${"z".repeat(70000)}`,
    },
    {
      role: "user",
      content: "tell me more about chalin and its bussinesses",
    },
  ];
  const tools = oversizedToolCatalogue();

  const budget = buildRequestBudget({
    messages,
    tools,
    env: SMALL_TRANSPORT_ENV,
  });

  assert.equal(budget.transport_profile, "product_knowledge");
  assert.ok(budget.raw_estimated_input_tokens > budget.request_token_limit);
  assert.ok(budget.estimated_input_tokens < budget.request_token_limit);
  assert.ok(budget.maximum_output_tokens > 1);
});

test("product transport preflight removes operational tools and private orchestration context", () => {
  const payload = transportBudgetPayload({
    messages: [
      { role: "system", content: "PRIVATE INTERNAL TOOL ORCHESTRATION" },
      { role: "user", content: "Tell me more about CHALIN and its businesses" },
    ],
    tools: oversizedToolCatalogue(),
  });

  assert.equal(payload.profile, "product_knowledge");
  assert.deepEqual(payload.tools, []);
  assert.equal(payload.messages.at(-1)?.role, "user");
  assert.match(payload.messages.at(-1)?.content || "", /CHALIN.*businesses/i);
  assert.doesNotMatch(
    payload.messages.map((item) => item.content).join("\n"),
    /PRIVATE INTERNAL TOOL ORCHESTRATION/
  );
});

test("genuinely oversized live business requests still retain the transport guardrail", () => {
  const messages = [
    { role: "system", content: "Governed private operational request." },
    {
      role: "user",
      content: "Tell me today's live sales and current customer debt at Main Store",
    },
  ];

  assert.throws(
    () =>
      buildRequestBudget({
        messages,
        tools: oversizedToolCatalogue(),
        env: SMALL_TRANSPORT_ENV,
      }),
    (error) => {
      assert.ok(error instanceof AiBudgetError);
      assert.equal(error.code, "AI_REQUEST_TOKEN_LIMIT_EXCEEDED");
      assert.equal(error.statusCode, 413);
      assert.equal(error.details.transport_profile, "full_governed");
      return true;
    }
  );
});

test("provider-facing governed reads drop server-only metadata and compact verbose schemas", () => {
  const compact = filterReadOnlyInvestigationTools(oversizedToolCatalogue());

  assert.equal(compact.length, 40);
  assert.deepEqual(
    Object.keys(compact[0]).sort(),
    [
      "description",
      "input_schema",
      "key",
      "planner_evidence_tags",
      "risk_level",
      "title",
    ].sort()
  );
  assert.equal(compact[0].required_permissions, undefined);
  assert.equal(compact[0].allowed_workspaces, undefined);
  assert.equal(compact[0].internal_execution_notes, undefined);
  assert.ok(compact[0].description.length <= 720);
  assert.ok(compact[0].input_schema.description.length <= 180);
  assert.ok(compact[0].input_schema.properties.query.description.length <= 180);
  assert.equal(compact[0].input_schema.properties.query.examples, undefined);
});

test("live operational transport fits after governed read tools are compacted", () => {
  const messages = [
    { role: "system", content: "Governed private operational request." },
    {
      role: "user",
      content: "Tell me today's live sales and current customer debt at Main Store",
    },
  ];
  const compactTools = filterReadOnlyInvestigationTools(oversizedToolCatalogue());

  const budget = buildRequestBudget({
    messages,
    tools: compactTools,
    env: SMALL_TRANSPORT_ENV,
  });

  assert.equal(budget.transport_profile, "full_governed");
  assert.ok(budget.estimated_input_tokens < budget.request_token_limit);
  assert.ok(budget.maximum_output_tokens > 1);
});

test("long provider context keeps critical evidence and newest task while dropping oldest chat first", () => {
  const messages = [
    { role: "system", content: `CRITICAL SYSTEM CONTRACT ${"s".repeat(30000)}` },
    ...Array.from({ length: 16 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index === 0 ? "OLDEST-HISTORY" : `history-${index}`} ${"h".repeat(18000)}`,
    })),
    { role: "tool", content: `CRITICAL GOVERNED EVIDENCE ${"e".repeat(30000)}` },
    { role: "user", content: "LATEST USER TASK: explain the Main Store profit problem" },
  ];

  const compact = sanitizeProviderMessages(messages);
  const combined = compact.map((item) => item.content).join("\n");

  assert.ok(providerMessageCharacters(compact) <= MAX_PROVIDER_CONTEXT_CHARACTERS);
  assert.match(combined, /CRITICAL SYSTEM CONTRACT/);
  assert.match(combined, /CRITICAL GOVERNED EVIDENCE/);
  assert.match(combined, /LATEST USER TASK/);
  assert.doesNotMatch(combined, /OLDEST-HISTORY/);
  assert.ok(compact.length < messages.length);
});

test("full-governed budget uses the same compacted message set as provider transport", () => {
  const messages = [
    { role: "system", content: `Reasoning contract ${"r".repeat(30000)}` },
    ...Array.from({ length: 18 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `old-${index} ${"o".repeat(18000)}`,
    })),
    { role: "tool", content: `Governed evidence ${"e".repeat(30000)}` },
    { role: "user", content: "Tell me today's current sales at Main Store" },
  ];
  const compactTools = filterReadOnlyInvestigationTools(oversizedToolCatalogue().slice(0, 8));
  const payload = transportBudgetPayload({ messages, tools: compactTools });

  assert.equal(payload.profile, "full_governed");
  assert.ok(payload.messages.length < messages.length);
  assert.ok(providerMessageCharacters(payload.messages) <= MAX_PROVIDER_CONTEXT_CHARACTERS);
  assert.match(payload.messages.at(-1)?.content || "", /today's current sales at Main Store/i);
});
