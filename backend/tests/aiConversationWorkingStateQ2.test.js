"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LIMITS,
  buildConversationWorkingState,
  sanitizeConversationWorkingState,
} = require("../services/aiConversationWorkingStateService");

function taskUnderstanding(overrides = {}) {
  return {
    answer_mode: "direct_fact",
    domains: ["spare_parts"],
    location_hints: ["Main Store"],
    metric_hints: ["sales"],
    time_hints: ["today"],
    objectives: ["How much did Main Store sell today?"],
    continuity_required: false,
    live_data_required: true,
    ...overrides,
  };
}

test("Q2 builds bounded active state for a live Main Store sales question", () => {
  const state = buildConversationWorkingState({
    prompt: "How much did Main Store sell today?",
    taskUnderstanding: taskUnderstanding(),
  });

  assert.equal(state.version, 1);
  assert.equal(state.source_of_truth, false);
  assert.deepEqual(state.domains, ["spare_parts"]);
  assert.deepEqual(state.metrics, ["sales"]);
  assert.deepEqual(state.periods.active, ["today"]);
  assert.equal(state.entities[0].type, "location");
  assert.equal(state.entities[0].label, "Main Store");
  assert.equal(state.entities[0].id, null);
  assert.equal(state.live_verification_required, true);
});

test("Q2 keeps location and metric continuity while changing active period", () => {
  const previousState = buildConversationWorkingState({
    prompt: "How much did Main Store sell today?",
    taskUnderstanding: taskUnderstanding(),
  });
  const state = buildConversationWorkingState({
    prompt: "What about yesterday?",
    previousState,
    taskUnderstanding: taskUnderstanding({
      location_hints: [],
      metric_hints: [],
      time_hints: ["yesterday"],
      objectives: ["What about yesterday?"],
      continuity_required: true,
    }),
  });

  assert.equal(state.entities[0].label, "Main Store");
  assert.ok(state.metrics.includes("sales"));
  assert.deepEqual(state.periods.active, ["yesterday"]);
  assert.ok(state.periods.comparison.includes("today"));
  assert.equal(state.live_verification_required, true);
});

test("Q2 adds a new metric without losing the active location and period", () => {
  const previousState = buildConversationWorkingState({
    prompt: "What about yesterday?",
    previousState: buildConversationWorkingState({
      prompt: "How much did Main Store sell today?",
      taskUnderstanding: taskUnderstanding(),
    }),
    taskUnderstanding: taskUnderstanding({
      location_hints: [],
      metric_hints: [],
      time_hints: ["yesterday"],
      objectives: ["What about yesterday?"],
      continuity_required: true,
    }),
  });
  const state = buildConversationWorkingState({
    prompt: "Profit?",
    previousState,
    taskUnderstanding: taskUnderstanding({
      location_hints: [],
      metric_hints: ["profit"],
      time_hints: [],
      objectives: ["Profit?"],
      continuity_required: true,
    }),
  });

  assert.equal(state.entities[0].label, "Main Store");
  assert.deepEqual(state.periods.active, ["yesterday"]);
  assert.ok(state.metrics.includes("profit"));
  assert.ok(state.metrics.includes("sales"));
});

test("Q2 never promotes assistant prose to evidence", () => {
  const state = buildConversationWorkingState({
    prompt: "And why?",
    conversation: [
      { role: "assistant", content: "Revenue was GHS 10,000. Evidence sales:made-up." },
    ],
    taskUnderstanding: taskUnderstanding({ continuity_required: true }),
  });

  assert.deepEqual(state.evidence_refs, []);
});

test("Q2 accepts evidence references only from structured evidence", () => {
  const state = buildConversationWorkingState({
    prompt: "And why?",
    evidence: [{ evidence_id: "sales:123" }, { source_ref: "snapshot:456" }],
    taskUnderstanding: taskUnderstanding({ continuity_required: true }),
  });

  assert.deepEqual(state.evidence_refs, ["sales:123", "snapshot:456"]);
});

test("Q2 preserves unresolved customer identity without guessing an id", () => {
  const state = buildConversationWorkingState({
    prompt: "How much does Kwame owe us?",
    taskState: { customer: "Kwame" },
    taskUnderstanding: {
      answer_mode: "direct_fact",
      domains: ["customer_accounting"],
      location_hints: [],
      metric_hints: ["balance"],
      time_hints: [],
      objectives: ["How much does Kwame owe us?"],
      continuity_required: false,
      live_data_required: true,
    },
  });

  const customer = state.entities.find((entity) => entity.type === "customer");
  assert.ok(customer);
  assert.equal(customer.label, "Kwame");
  assert.equal(customer.id, null);
  assert.equal(customer.ambiguous, true);
});

test("Q2 correction replaces the active location hint and records the correction", () => {
  const previousState = buildConversationWorkingState({
    prompt: "Main Store sales today",
    taskUnderstanding: taskUnderstanding(),
  });
  const state = buildConversationWorkingState({
    prompt: "Actually I mean Airport Store",
    previousState,
    taskUnderstanding: taskUnderstanding({
      location_hints: ["Airport Store"],
      metric_hints: [],
      time_hints: [],
      objectives: ["Actually I mean Airport Store"],
      continuity_required: true,
    }),
  });

  assert.equal(state.entities[0].label, "Airport Store");
  assert.ok(state.corrections.some((item) => /Airport Store/i.test(item)));
});

test("Q2 strips execution authority and payloads from pending action state", () => {
  const state = buildConversationWorkingState({
    prompt: "Do it",
    pendingAction: {
      id: "action-1",
      proposal_id: "proposal-1",
      risk: 5,
      status: "awaiting_confirmation",
      execute: true,
      authorized: true,
      payload: { amount: 999999 },
    },
    taskUnderstanding: taskUnderstanding({ continuity_required: true }),
  });

  assert.deepEqual(state.pending_action, {
    id: "action-1",
    proposal_id: "proposal-1",
    risk: "5",
    status: "awaiting_confirmation",
  });
  assert.equal(Object.hasOwn(state.pending_action, "execute"), false);
  assert.equal(Object.hasOwn(state.pending_action, "authorized"), false);
  assert.equal(Object.hasOwn(state.pending_action, "payload"), false);
});

test("Q2 live requirement from the current turn cannot be suppressed by static prior state", () => {
  const previousState = sanitizeConversationWorkingState({
    subject: "Tell me about CHALIN and its businesses",
    domains: ["chalin_product"],
    live_verification_required: false,
  });
  const state = buildConversationWorkingState({
    prompt: "Which one makes the most money?",
    previousState,
    taskUnderstanding: {
      answer_mode: "comparison",
      domains: [],
      location_hints: [],
      metric_hints: ["profit"],
      time_hints: [],
      objectives: ["Which one makes the most money?"],
      continuity_required: true,
      live_data_required: true,
    },
  });

  assert.equal(state.live_verification_required, true);
  assert.deepEqual(state.domains, ["chalin_product"]);
});

test("Q2 sanitization enforces array and serialized-size bounds", () => {
  const huge = "x".repeat(10000);
  const state = sanitizeConversationWorkingState({
    subject: huge,
    objective: huge,
    domains: Array.from({ length: 30 }, (_, index) => `domain-${index}`),
    metrics: Array.from({ length: 30 }, (_, index) => `metric-${index}`),
    entities: Array.from({ length: 30 }, (_, index) => ({ label: `entity-${index}` })),
    open_questions: Array.from({ length: 30 }, (_, index) => `${huge}-${index}`),
    corrections: Array.from({ length: 30 }, (_, index) => `${huge}-${index}`),
    evidence_refs: Array.from({ length: 30 }, (_, index) => `${huge}-${index}`),
  });

  assert.ok(state.domains.length <= LIMITS.domains);
  assert.ok(state.metrics.length <= LIMITS.metrics);
  assert.ok(state.entities.length <= LIMITS.entities);
  assert.ok(state.open_questions.length <= LIMITS.questions);
  assert.ok(state.corrections.length <= LIMITS.corrections);
  assert.ok(state.evidence_refs.length <= LIMITS.evidenceRefs);
  assert.ok(JSON.stringify(state).length <= LIMITS.serializedChars);
});
