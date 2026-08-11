"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AiBudgetError,
  buildRequestBudget,
  transportBudgetPayload,
} = require("../services/aiCostControlService");

function oversizedToolCatalogue() {
  return Array.from({ length: 40 }, (_, index) => ({
    key: `governed.read.${index + 1}`,
    title: `Governed read tool ${index + 1}`,
    description: `Operational schema ${index + 1} ${"x".repeat(7000)}`,
    risk_level: 1,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "y".repeat(2000) },
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
