"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  loadScopedUserMemory,
  memoryPolicyPrompt,
  memorySummary,
  rankMemoryCandidates,
  resolveCurrentConversationId,
} = require("../services/aiConversationMemoryService");
const { AiToolRegistry } = require("../services/aiToolRegistry");
const {
  registerFoundationAiTools,
} = require("../ai-tools/foundationTools");

const NOW = new Date("2026-08-10T08:00:00.000Z").getTime();

function row({
  id,
  conversation = "conv_prior",
  title = "Prior work",
  content,
  createdAt = "2026-08-09T08:00:00.000Z",
  sha = null,
} = {}) {
  return {
    message_id: id,
    conversation_key: conversation,
    conversation_title: title,
    content_text: content,
    content_sha256: sha,
    created_at: createdAt,
  };
}

test("memory ranking recalls relevant user context and deduplicates repeated content", () => {
  const memories = rankMemoryCandidates({
    query: "Atlas excavator finance decision",
    now: NOW,
    rows: [
      row({
        id: 1,
        content: "We decided to review the Atlas excavator finance case after the August payment.",
        sha: "a".repeat(64),
      }),
      row({
        id: 2,
        conversation: "conv_duplicate",
        content: "We decided to review the Atlas excavator finance case after the August payment.",
        sha: "a".repeat(64),
      }),
      row({
        id: 3,
        content: "Unrelated warehouse paint discussion.",
      }),
    ],
  });

  assert.equal(memories.length, 1);
  assert.equal(memories[0].memory_id, "M1");
  assert.equal(memories[0].verified_fact, false);
  assert.equal(memories[0].authority, "continuity_only");
  assert.match(memories[0].content, /Atlas excavator finance case/);
});

test("continuity wording allows recent-context fallback without pretending it is evidence", () => {
  const memories = rankMemoryCandidates({
    query: "Continue from what we discussed before.",
    now: NOW,
    rows: [
      row({
        id: 1,
        content: "The user wanted the customer statement redesign reviewed on mobile.",
        createdAt: "2026-08-10T07:30:00.000Z",
      }),
    ],
  });
  assert.equal(memories.length, 1);
  const policy = memoryPolicyPrompt();
  assert.match(policy, /not governed evidence or proof/i);
  assert.match(policy, /Never cite memory as \[E#\]/i);
  assert.match(policy, /governed source wins/i);
});

test("non-continuity queries with no lexical relationship do not inject random old context", () => {
  const memories = rankMemoryCandidates({
    query: "What is the equipment finance arrears policy?",
    now: NOW,
    rows: [
      row({ id: 1, content: "We discussed the blue office chairs last week." }),
    ],
  });
  assert.deepEqual(memories, []);
});

test("memory summary never grants evidence authority", () => {
  const summary = memorySummary([
    {
      conversation_key: "conv_one",
    },
    {
      conversation_key: "conv_one",
    },
    {
      conversation_key: "conv_two",
    },
  ]);
  assert.deepEqual(summary, {
    recalled_count: 3,
    source_conversation_count: 2,
    continuity_only: true,
    evidence_authority: false,
    exact_scope_required: true,
  });
});

test("current conversation resolution is exact-user persona and scope locked", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{ id: 91 }]];
    },
  };
  const id = await resolveCurrentConversationId({
    connection,
    userId: 7,
    persona: "copilot",
    scope: {
      workspace_code: "spare_parts",
      branch_id: 3,
      mining_site_id: null,
      hire_location_id: null,
    },
  });
  assert.equal(id, 91);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /user_id = \?/);
  assert.match(calls[0].sql, /persona = \?/);
  assert.match(calls[0].sql, /conversation_status = 'active'/);
  assert.match(calls[0].sql, /workspace_code <=> \?/);
  assert.match(calls[0].sql, /branch_id <=> \?/);
  assert.match(calls[0].sql, /mining_site_id <=> \?/);
  assert.match(calls[0].sql, /hire_location_id <=> \?/);
  assert.deepEqual(calls[0].params, [7, "copilot", "spare_parts", 3, null, null]);
});

test("memory retrieval SQL excludes current conversation, assistant output, blocked content and archived conversations", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[
        row({
          id: 8,
          content: "Atlas excavator decision from the prior conversation.",
        }),
      ]];
    },
  };

  const memories = await loadScopedUserMemory({
    connection,
    userId: 7,
    persona: "executive",
    scope: {
      workspace_code: "equipment_hire",
      hire_location_id: 11,
    },
    currentConversationId: 99,
    query: "Atlas excavator decision",
    now: NOW,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /conversation\.user_id = \?/);
  assert.match(calls[0].sql, /conversation\.persona = \?/);
  assert.match(calls[0].sql, /conversation\.conversation_status = 'active'/);
  assert.match(calls[0].sql, /message\.message_role = 'user'/);
  assert.match(calls[0].sql, /message\.safety_status IN \('allowed', 'redacted'\)/);
  assert.match(calls[0].sql, /conversation\.id <> \?/);
  assert.equal(calls[0].params[6], 99);
  assert.equal(calls[0].params[7], 99);
  assert.equal(memories.length, 1);
  assert.equal(memories[0].verified_fact, false);
});

test("Guide never receives private staff conversation memory", async () => {
  let called = false;
  const connection = {
    async query() {
      called = true;
      return [[]];
    },
  };
  const memories = await loadScopedUserMemory({
    connection,
    userId: 7,
    persona: "guide",
    scope: {},
    query: "remember this",
  });
  assert.deepEqual(memories, []);
  assert.equal(called, false);
});

test("foundation registry exposes memory as a read-only continuity tool with no evidence authority", () => {
  const registry = new AiToolRegistry();
  registerFoundationAiTools(registry);
  const memory = registry.list({ persona: "copilot", workspace: "spare_parts" })
    .find((tool) => tool.key === "conversation.memory");
  assert.ok(memory);
  assert.equal(memory.risk_level, 1);
  assert.equal(memory.evidence_required, false);
  assert.deepEqual(memory.required_permissions, ["ai.use", "ai.conversations.view"]);
  assert.match(memory.description, /same user's prior active conversations/i);
  assert.match(memory.description, /never governed evidence/i);
});
