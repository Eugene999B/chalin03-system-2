"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  GeminiGenerateContentProvider,
  DEFAULT_GEMINI_MODEL,
  thinkingLevelForContext,
} = require("../ai-providers/geminiGenerateContentProvider");
const {
  deleteConversation,
  deriveConversationTitle,
} = require("../services/aiConversationService");
const {
  rankMemoryCandidates,
  MEMORY_MAX_AGE_DAYS,
  MAX_MEMORY_SNIPPETS,
} = require("../services/aiConversationMemoryService");
const {
  effectiveSelection,
  safetyIdentifierForUser,
} = require("../services/aiProviderPolicyService");
const {
  isPublicSafeGeneralTurn,
  PUBLIC_SAFE_GENERAL_MAX_LENGTH,
} = require("../services/aiProviderService");
const {
  MAX_HISTORY_MESSAGES,
  MAX_REASONING_EVIDENCE,
  MAX_RETRIEVAL_QUERIES,
} = require("../services/aiReasoningService");
const {
  DEFAULT_REQUEST_TOKEN_LIMIT,
  DEFAULT_DAILY_USER_TOKEN_LIMIT,
} = require("../services/aiCostControlService");

const ROOT = path.resolve(__dirname, "../..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Gemini overhaul uses the current deep-reasoning model and enlarged CHALIN envelope", () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.6-flash");
  assert.equal(thinkingLevelForContext({ persona: "executive", intent: "diagnose" }, "gemini-3.6-flash"), "high");
  assert.equal(thinkingLevelForContext({ persona: "copilot", intent: "lookup" }, "gemini-3.6-flash"), "medium");
  assert.equal(thinkingLevelForContext({ persona: "copilot", public_safe_social_turn: true }, "gemini-3.6-flash"), "low");
  assert.ok(DEFAULT_REQUEST_TOKEN_LIMIT >= 262144);
  assert.ok(DEFAULT_DAILY_USER_TOKEN_LIMIT >= 10000000);
  assert.ok(MAX_HISTORY_MESSAGES >= 48);
  assert.ok(MAX_REASONING_EVIDENCE >= 32);
  assert.ok(MAX_RETRIEVAL_QUERIES >= 10);
  assert.ok(PUBLIC_SAFE_GENERAL_MAX_LENGTH >= 12000);
});

test("legacy Gemini profile is upgraded and transient provider failure is retried once", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) {
      return {
        ok: false,
        status: 503,
        async json() {
          return { error: { status: "UNAVAILABLE" } };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          candidates: [{ content: { parts: [{ text: "Deep answer" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
        };
      },
    };
  };
  const provider = new GeminiGenerateContentProvider({
    env: { GEMINI_API_KEY: "test_key_abcdefghijklmnopqrstuvwxyz123456" },
    fetchImpl,
  });
  const result = await provider.generate({
    messages: [{ role: "user", content: "Compare two approaches" }],
    provider_context: {
      persona: "copilot",
      intent: "compare",
      provider_model_override: "gemini-2.5-flash",
    },
  });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /gemini-3\.6-flash:generateContent$/);
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "high");
  assert.equal(result.model_key, "gemini-3.6-flash");
  assert.equal(result.reasoning_effort, "high");
  assert.equal(result.text, "Deep answer");
});

test("general non-private Copilot reasoning may use the stripped Gemini lane, business data may not", () => {
  assert.equal(
    isPublicSafeGeneralTurn({
      messages: [{ role: "user", content: "Explain compound interest simply and compare two teaching approaches" }],
      providerContext: { persona: "copilot", live_data_required: false },
    }),
    true
  );
  assert.equal(
    isPublicSafeGeneralTurn({
      messages: [{ role: "user", content: "What are our sales and stock today?" }],
      providerContext: { persona: "copilot", live_data_required: true },
    }),
    false
  );
  assert.equal(
    isPublicSafeGeneralTurn({
      messages: [{ role: "user", content: "Analyze employee payroll risk" }],
      providerContext: { persona: "copilot", live_data_required: false },
    }),
    false
  );
});

test("full-context Gemini is account-bound and paid-tier gated", () => {
  const ownerIdentity = safetyIdentifierForUser(1);
  const profile = {
    profile_key: "chalin-copilot",
    provider_key: "gemini",
    model_key: "gemini-3.6-flash",
    source: "database",
    configuration: {
      system_admin_full_context: true,
      full_context_safety_identifier: ownerIdentity,
    },
  };
  const baseEnv = {
    GEMINI_API_KEY: "test_key_abcdefghijklmnopqrstuvwxyz123456",
  };

  const freeSelection = effectiveSelection(profile, {
    persona: "copilot",
    providerContext: {
      data_classification: "confidential",
      safety_identifier: ownerIdentity,
    },
    env: { ...baseEnv, GEMINI_SERVICE_TIER: "free" },
  });
  assert.equal(freeSelection.effective_provider, "local");
  assert.equal(freeSelection.full_context_active, false);
  assert.equal(freeSelection.full_context_requires_paid_tier, true);

  const paidSelection = effectiveSelection(profile, {
    persona: "copilot",
    providerContext: {
      data_classification: "confidential",
      safety_identifier: ownerIdentity,
    },
    env: { ...baseEnv, GEMINI_SERVICE_TIER: "paid" },
  });
  assert.equal(paidSelection.effective_provider, "gemini");
  assert.equal(paidSelection.full_context_active, true);

  const otherUserSelection = effectiveSelection(profile, {
    persona: "copilot",
    providerContext: {
      data_classification: "confidential",
      safety_identifier: safetyIdentifierForUser(2),
    },
    env: { ...baseEnv, GEMINI_SERVICE_TIER: "paid" },
  });
  assert.equal(otherUserSelection.effective_provider, "local");
  assert.equal(otherUserSelection.full_context_active, false);
});

test("conversation titles are persistent topic-like labels rather than every chat being New conversation", () => {
  assert.equal(deriveConversationTitle("hi"), "General Conversation");
  assert.equal(deriveConversationTitle("hi how are you doing"), "General Conversation");
  const title = deriveConversationTitle("Can you analyze why our inventory turnover is slowing and what we should do next?");
  assert.notEqual(title, "New conversation");
  assert.notEqual(title, "General Conversation");
  assert.match(title, /Inventory Turnover/);
  assert.ok(title.length <= 72);
});

test("conversation hard-delete is scoped to the owning user", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return [[{
          id: 41,
          conversation_key: "conv_owned",
          user_id: 7,
          persona: "copilot",
          conversation_status: "active",
        }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  assert.equal(
    await deleteConversation({ connection, conversationKey: "conv_owned", userId: 7 }),
    true
  );
  assert.match(calls[1].sql, /DELETE FROM ai_conversations/i);
  assert.deepEqual(calls[1].params, [41, 7]);
});

test("deep continuity may include prior assistant turns but never upgrades them to evidence", () => {
  const now = Date.now();
  const memories = rankMemoryCandidates({
    query: "inventory plan",
    now,
    rows: [
      {
        message_id: 1,
        message_role: "user",
        content_text: "We need a new inventory plan for slow-moving parts",
        conversation_key: "conv_1",
        conversation_title: "Inventory Plan",
        created_at: new Date(now - 86400000).toISOString(),
      },
      {
        message_id: 2,
        message_role: "assistant",
        content_text: "The inventory plan should compare reorder policy and aging stock",
        conversation_key: "conv_1",
        conversation_title: "Inventory Plan",
        created_at: new Date(now - 86000000).toISOString(),
      },
    ],
  });
  assert.ok(MEMORY_MAX_AGE_DAYS >= 1095);
  assert.ok(MAX_MEMORY_SNIPPETS >= 24);
  assert.equal(memories.length, 2);
  assert.ok(memories.some((item) => item.memory_role === "assistant"));
  for (const memory of memories) {
    assert.equal(memory.authority, "continuity_only");
    assert.equal(memory.verified_fact, false);
  }
});

test("CHALIN Intelligence and operational surfaces never auto-refresh an active session", () => {
  const main = source("frontend/src/main.jsx");
  const serviceWorker = source("frontend/public/sw.js");
  const workspace = source("frontend/src/chalin-one/ai/ChalinIntelligenceWorkspace.jsx");
  const api = source("frontend/src/chalin-one/ai/aiApi.js");
  const control = source("frontend/src/chalin-one/ai/AiProviderControlLauncher.jsx");

  assert.match(main, /browser-cache-integrity-v36/);
  assert.match(main, /installNoAutomaticRefreshPolicy/);
  assert.match(main, /removeChalinServiceWorkerCaches/);
  assert.doesNotMatch(main, /serviceWorker\.register\(/);
  assert.doesNotMatch(main, /controllerchange/);
  assert.doesNotMatch(main, /window\.location\.reload\(/);
  assert.doesNotMatch(serviceWorker, /self\.skipWaiting\(\)/);
  assert.doesNotMatch(serviceWorker, /self\.clients\.claim\(\)/);
  assert.doesNotMatch(serviceWorker, /CHALIN03_SKIP_WAITING/);
  assert.match(workspace, /silent: true, force: true/);
  assert.match(workspace, /clearAiConversationHistory/);
  assert.match(workspace, /deleteAiConversation/);
  assert.match(workspace, />Delete<\/button>/);
  assert.match(workspace, /maxLength=\{32000\}/);
  assert.match(workspace, /CHALIN is thinking/);
  assert.match(workspace, /Understanding the question, then using product knowledge or authorized evidence only when needed/);
  assert.doesNotMatch(workspace, />Archive<\/button>/);
  assert.match(api, /axiosClient\.delete/);
  assert.match(control, /Full Gemini Intelligence/);
  assert.match(control, /fullContextAccess/);
});
