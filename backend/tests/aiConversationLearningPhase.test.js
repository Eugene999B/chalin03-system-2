"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
} = require("../services/aiProductKnowledgeService");
const {
  hasPrivateBusinessSignal,
  isPublicSafeGeneralTurn,
  publicSafeMessages,
} = require("../services/aiProviderService");
const {
  chooseLocalReadTool,
  composeSparePartsOperationsAnswer,
  inferredDateInput,
} = require("../ai-providers/localGovernedProvider");
const {
  CONVERSATION_ROLLOVER_CHARACTER_LIMIT,
  CONVERSATION_ROLLOVER_MESSAGE_LIMIT,
  continuationMessage,
  conversationRolloverReason,
  deriveConversationTitleFromTurns,
} = require("../services/aiConversationService");
const {
  withOperationsDefaultWindow,
} = require("../ai-tools/sparePartsTools");

function providerContext(overrides = {}) {
  return {
    persona: "copilot",
    workspace_code: "spare_parts",
    live_data_required: false,
    ...overrides,
  };
}

const operationsTool = Object.freeze({
  key: "spare_parts.operations_snapshot",
  title: "Spare Parts operations snapshot",
  risk_level: 1,
});

test("reported sold-today wording is treated as live business data, not product help", () => {
  const prompt = "how did the spare parts sold today";
  assert.equal(isLikelyLiveRecordRequest(prompt), true);
  assert.equal(isChalinProductKnowledgeTurn(prompt), false);
  assert.equal(hasPrivateBusinessSignal(prompt), true);
  assert.equal(
    isPublicSafeGeneralTurn({
      messages: [{ role: "user", content: prompt }],
      providerContext: providerContext(),
    }),
    false
  );
});

test("exact follow-up at main store continues the prior live sales task", () => {
  const messages = [
    { role: "user", content: "how did the spare parts sold today" },
    {
      role: "assistant",
      content:
        "To give you the exact numbers for today's spare parts sales, specify the store or branch name.",
    },
    { role: "user", content: "at main store" },
  ];

  assert.equal(isLikelyLiveRecordRequest("at main store"), true);
  assert.equal(hasPrivateBusinessSignal("at main store"), true);
  assert.equal(
    isPublicSafeGeneralTurn({ messages, providerContext: providerContext() }),
    false
  );

  const selected = chooseLocalReadTool({
    messages,
    tools: [operationsTool],
    providerContext: providerContext({ data_classification: "internal" }),
  });
  assert.equal(selected?.key, "spare_parts.operations_snapshot");

  const input = inferredDateInput(messages, new Date("2026-08-10T22:00:00.000Z"));
  assert.deepEqual(input, {
    start_date: "2026-08-10",
    end_date: "2026-08-10",
  });
});

test("safe general reasoning keeps a contiguous public-safe conversation tail", () => {
  const safe = publicSafeMessages([
    { role: "system", content: "PRIVATE SYSTEM CONTEXT MUST NOT CROSS" },
    { role: "user", content: "Explain compound interest simply." },
    {
      role: "assistant",
      content: "Compound interest means you earn or pay interest on earlier interest too.",
    },
    { role: "user", content: "why does that matter for a loan?" },
  ]);

  assert.equal(safe[0].role, "system");
  assert.equal(safe.at(-1).content, "why does that matter for a loan?");
  assert.match(JSON.stringify(safe), /Explain compound interest simply/i);
  assert.match(JSON.stringify(safe), /earlier interest too/i);
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE SYSTEM CONTEXT/);
});

test("public-safe continuity stops immediately at private live evidence", () => {
  const safe = publicSafeMessages([
    { role: "user", content: "How are sales doing?" },
    {
      role: "assistant",
      content: "Total Sales GHS 5000, Branch Id 1",
    },
    { role: "user", content: "Explain compound interest simply." },
  ]);

  assert.equal(safe.length, 2);
  assert.equal(safe[1].content, "Explain compound interest simply.");
  assert.doesNotMatch(JSON.stringify(safe), /GHS 5000|Branch Id 1|How are sales doing/i);
});

test("local Spare Parts evidence answers directly instead of dumping raw fields", () => {
  const text = composeSparePartsOperationsAnswer({
    citation: "E1",
    heading: "Spare Parts operations snapshot",
    excerpt: JSON.stringify({
      branch_id: 1,
      branch_code: "MAIN",
      branch_name: "Main Store",
      period: ["2026-08-10", "2026-08-10"],
      sales: {
        transaction_count: 3,
        total_sales: 4500,
        total_paid: 4000,
        total_balance: 500,
        collection_rate: 88.888,
      },
    }),
  });

  assert.match(text, /Main Store/);
  assert.match(text, /3 sales/);
  assert.match(text, /GHS 4,500\.00/);
  assert.match(text, /Outstanding.*GHS 500\.00/i);
  assert.match(text, /\[E1\]/);
  assert.doesNotMatch(text, /Sales Transaction Count|Here is what the approved CHALIN evidence shows/i);
});

test("Spare Parts operations snapshot defaults an empty request to today's date", () => {
  const input = withOperationsDefaultWindow(
    "operations",
    {},
    new Date("2026-08-10T04:00:00.000Z")
  );
  assert.deepEqual(input, {
    start_date: "2026-08-10",
    end_date: "2026-08-10",
  });
  assert.deepEqual(
    withOperationsDefaultWindow("inventory", {}, new Date("2026-08-10T04:00:00.000Z")),
    {}
  );
});

test("chat titles evolve from the actual topic and clarification", () => {
  const title = deriveConversationTitleFromTurns([
    "how are you doing today",
    "how did the spare parts sold today",
    "at main store",
  ]);
  assert.equal(title, "Today's Spare Parts Sales — Main Store");

  assert.equal(
    deriveConversationTitleFromTurns([
      "Can you tell me what audit intelligence does in CHALIN 03?",
    ]),
    "Audit Intelligence"
  );
});

test("conversation rollover has bounded message and character limits", () => {
  assert.equal(
    conversationRolloverReason({
      message_count: CONVERSATION_ROLLOVER_MESSAGE_LIMIT,
      character_count: 1,
    }),
    "message_limit"
  );
  assert.equal(
    conversationRolloverReason({
      message_count: 1,
      character_count: CONVERSATION_ROLLOVER_CHARACTER_LIMIT,
    }),
    "context_size_limit"
  );
  assert.equal(
    conversationRolloverReason({ message_count: 4, character_count: 1000 }),
    null
  );

  const note = continuationMessage({
    previousTitle: "Today's Spare Parts Sales — Main Store",
    reason: "message_limit",
    recentTurns: [
      { message_role: "user", content_text: "what about yesterday?" },
      { message_role: "assistant", content_text: "Yesterday's live figure was GHS 100." },
    ],
  });
  assert.match(note, /continues from/i);
  assert.match(note, /reached its conversation length limit/i);
  assert.match(note, /historical context only/i);
  assert.match(note, /re-checked/i);
});

test("feature refreshes never put a loaded CHALIN screen back into global loading mode", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/context/FeatureFlagContext.jsx"),
    "utf8"
  );
  assert.match(source, /hasLoadedSnapshotRef/);
  assert.match(source, /const initialLoad = !hasLoadedSnapshotRef\.current/);
  assert.match(source, /if \(initialLoad\) setLoading\(true\)/);
  assert.match(source, /if \(initialLoad\) \{[\s\S]*setFlags\(CHALIN_ONE_FEATURE_DEFAULTS\)/);
  assert.doesNotMatch(source, /const refreshFeatureFlags = useCallback\(async \(\) => \{[\s\S]{0,260}setLoading\(true\);\s*setError/);
});
