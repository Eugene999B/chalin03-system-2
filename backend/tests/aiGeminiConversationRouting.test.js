"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  isPublicSafeGeneralTurn,
  isPublicSafeSocialTurn,
  publicSafeMessages,
  publicSafeSocialMessages,
} = require("../services/aiProviderService");
const {
  DEFAULT_MODELS,
  effectiveSelection,
} = require("../services/aiProviderPolicyService");
const {
  LocalGovernedProvider,
  chooseLocalReadTool,
} = require("../ai-providers/localGovernedProvider");

function context(overrides = {}) {
  return {
    persona: "copilot",
    workspace_code: "spare_parts",
    live_data_required: false,
    ...overrides,
  };
}

function messages(prompt, extras = []) {
  return [
    { role: "system", content: "PRIVATE SYSTEM CONTEXT MUST NOT CROSS" },
    ...extras,
    { role: "user", content: prompt },
  ];
}

test("plain and imperfect greetings are public-safe social turns", () => {
  for (const prompt of [
    "hi",
    "hello!",
    "hi ow ae you doing",
    "how are you doing?",
    "good morning",
    "who are you?",
    "what can you do?",
    "thank you",
  ]) {
    assert.equal(
      isPublicSafeSocialTurn({ messages: messages(prompt), providerContext: context() }),
      true,
      prompt
    );
  }
});

test("ordinary non-private reasoning may use Gemini after stripping CHALIN context", () => {
  for (const prompt of [
    "Explain compound interest simply.",
    "Help me improve this paragraph about leadership.",
    "Compare centralized and decentralized decision making.",
  ]) {
    assert.equal(
      isPublicSafeGeneralTurn({ messages: messages(prompt), providerContext: context() }),
      true,
      prompt
    );
  }

  const safe = publicSafeMessages(messages("Explain compound interest simply.", [
    { role: "assistant", content: "PRIVATE SALES SNAPSHOT [E1]" },
  ]));
  assert.equal(safe.length, 2);
  assert.equal(safe[1].content, "Explain compound interest simply.");
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE SALES SNAPSHOT/);
  assert.match(safe[0].content, /public-safe general reasoning turn/i);
});

test("business, payroll, sensitive and live questions never enter public-safe routing", () => {
  const prompts = [
    "hi, what are today's sales?",
    "hello what is our stock balance",
    "how are you, show me customer debt",
    "what is the worker salary?",
    "hi show payroll payments",
    "hello user@example.com",
    "hi GHS 5000",
    "hello 0241234567",
  ];

  for (const prompt of prompts) {
    assert.equal(
      isPublicSafeSocialTurn({ messages: messages(prompt), providerContext: context() }),
      false,
      `social ${prompt}`
    );
    assert.equal(
      isPublicSafeGeneralTurn({ messages: messages(prompt), providerContext: context() }),
      false,
      `general ${prompt}`
    );
  }

  assert.equal(
    isPublicSafeGeneralTurn({
      messages: messages("Explain something"),
      providerContext: context({ live_data_required: true }),
    }),
    false
  );
  assert.equal(
    isPublicSafeGeneralTurn({
      messages: messages("Explain something"),
      providerContext: context({ data_classification: "confidential" }),
    }),
    false
  );
});

test("public-safe social provider payload drops prior history, evidence and tools by construction", () => {
  const prior = [
    { role: "user", content: "PRIVATE: what are our sales?" },
    { role: "assistant", content: "PRIVATE SALES SNAPSHOT [E1]" },
    { role: "system", content: "Approved evidence for this request: PRIVATE EVIDENCE" },
  ];
  const safe = publicSafeSocialMessages(messages("hi ow ae you doing", prior));

  assert.equal(safe.length, 2);
  assert.equal(safe[0].role, "system");
  assert.equal(safe[1].role, "user");
  assert.equal(safe[1].content, "hi ow ae you doing");
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE SALES|PRIVATE EVIDENCE|what are our sales/i);
  assert.match(safe[0].content, /public-safe social conversation turn/i);
  assert.match(safe[0].content, /Do not introduce, infer, summarize, request, or expose/i);
});

test("Gemini Free is eligible for an explicitly public Copilot turn", () => {
  const selection = effectiveSelection(
    {
      profile_key: "chalin-copilot",
      provider_key: "gemini",
      model_key: "gemini-3.6-flash",
      source: "test",
    },
    {
      persona: "copilot",
      providerContext: { data_classification: "public" },
      env: {
        GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
        GEMINI_SERVICE_TIER: "free",
      },
    }
  );

  assert.equal(selection.selected_provider, "gemini");
  assert.equal(selection.effective_provider, "gemini");
  assert.equal(selection.effective_model, "gemini-3.6-flash");
  assert.equal(selection.data_classification, "public");
  assert.equal(selection.external_network_used, true);
});

test("Gemini Free still falls back to Local for internal Copilot evidence", () => {
  const selection = effectiveSelection(
    {
      profile_key: "chalin-copilot",
      provider_key: "gemini",
      model_key: "gemini-3.6-flash",
      source: "test",
    },
    {
      persona: "copilot",
      providerContext: { data_classification: "internal" },
      env: {
        GEMINI_API_KEY: "test-gemini-secret-abcdefghijklmnopqrstuvwxyz-123456",
        GEMINI_SERVICE_TIER: "free",
      },
    }
  );

  assert.equal(selection.selected_provider, "gemini");
  assert.equal(selection.effective_provider, "local");
  assert.equal(selection.effective_model, DEFAULT_MODELS.local);
  assert.equal(selection.external_network_used, false);
});

test("Local fallback never chooses an operations tool for a public-safe greeting", async () => {
  const tools = [
    {
      key: "spare_parts.operations_snapshot",
      title: "Spare Parts operations snapshot",
      risk_level: 1,
    },
  ];
  const providerContext = context({ public_safe_social_turn: true, data_classification: "public" });

  assert.equal(
    chooseLocalReadTool({ messages: [{ role: "user", content: "hi" }], tools, providerContext }),
    null
  );

  const result = await new LocalGovernedProvider().generate({
    messages: [{ role: "user", content: "hi" }],
    tools,
    provider_context: providerContext,
  });
  assert.equal(result.tool_calls.length, 0);
  assert.match(result.text, /Hi!|ready to help/i);
  assert.doesNotMatch(result.text, /sales transaction|operations snapshot|approved CHALIN evidence/i);
});

test("provider service applies the lossy privacy boundary before external provider selection", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../services/aiProviderService.js"),
    "utf8"
  );
  const publicBoundary = source.indexOf("if (publicSafeSocialTurn || publicSafeGeneralTurn)");
  const policyResolution = source.indexOf("selection = await resolveAiProviderSelection");

  assert.ok(publicBoundary >= 0);
  assert.ok(policyResolution > publicBoundary);
  assert.match(source, /publicSafeSocialTurn\s*\? publicSafeSocialMessages\(effectiveMessages\)/);
  assert.match(source, /: publicSafeMessages\(effectiveMessages\)/);
  assert.match(source, /effectiveTools = \[\]/);
  assert.match(source, /data_classification: "public"/);
  assert.match(source, /public_safe_general_turn: publicSafeGeneralTurn/);
});
