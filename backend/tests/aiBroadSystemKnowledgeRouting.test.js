"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hasPrivateBusinessSignal,
  isPublicSafeGeneralTurn,
  isPublicSafeSystemTurn,
  publicSafeSystemMessages,
} = require("../services/aiProviderService");
const {
  isChalinProductKnowledgeTurn,
  isLikelyLiveRecordRequest,
} = require("../services/aiProductKnowledgeService");
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

function messages(prompt, history = []) {
  return [
    { role: "system", content: "PRIVATE SYSTEM CONTEXT MUST NOT CROSS" },
    ...history,
    { role: "user", content: prompt },
  ];
}

test("CHALIN product, IT, marketing and advisory questions use system reasoning instead of private fallback", () => {
  const prompts = [
    "can you tell me what the audit intelligence does in chalin 03 intelligence",
    "How does payroll work in CHALIN?",
    "Advise me on how to market CHALIN 03 to mining companies.",
    "Review the CHALIN software architecture and suggest improvements.",
    "How should we explain Equipment Installment Finance on the website?",
    "What is a good cybersecurity design for this system?",
  ];

  for (const prompt of prompts) {
    assert.equal(isChalinProductKnowledgeTurn(prompt), true, prompt);
    assert.equal(isLikelyLiveRecordRequest(prompt), false, prompt);
    assert.equal(hasPrivateBusinessSignal(prompt), false, prompt);
    assert.equal(
      isPublicSafeSystemTurn({ messages: messages(prompt), providerContext: context() }),
      true,
      prompt
    );
  }
});

test("live and personal business record questions remain private and governed", () => {
  const prompts = [
    "what is the worker salary?",
    "show payroll payments",
    "what are our stock balance figures?",
    "show me today's sales",
    "find the customer debt",
    "what is our current cash balance",
    "review this employee salary",
    "show me the current whole-system performance across all businesses",
  ];

  for (const prompt of prompts) {
    assert.equal(isLikelyLiveRecordRequest(prompt), true, prompt);
    assert.equal(isChalinProductKnowledgeTurn(prompt), false, prompt);
    assert.equal(hasPrivateBusinessSignal(prompt), true, prompt);
    assert.equal(
      isPublicSafeSystemTurn({ messages: messages(prompt), providerContext: context() }),
      false,
      prompt
    );
    assert.equal(
      isPublicSafeGeneralTurn({ messages: messages(prompt), providerContext: context() }),
      false,
      prompt
    );
  }
});

test("system reasoning receives static CHALIN knowledge and drops all prior conversation records", () => {
  const currentPrompt = "What does Audit Intelligence do?";
  const safe = publicSafeSystemMessages(
    messages(currentPrompt, [
      { role: "user", content: "How should we position CHALIN for business owners?" },
      { role: "assistant", content: "Focus on operational control and management visibility." },
      { role: "assistant", content: "PRIVATE: Total Sales GHS 5000, Branch Id 1" },
    ])
  );

  assert.equal(safe.length, 2);
  assert.equal(safe[0]?.role, "system");
  assert.equal(safe[1]?.role, "user");
  assert.equal(safe[1]?.content, currentPrompt);

  const serialized = JSON.stringify(safe);
  assert.match(serialized, /CHALIN 03 \/ CHALIN ONE is an integrated business operating system/i);
  assert.match(serialized, /Audit \/ Advanced Accounting Intelligence/i);
  assert.match(serialized, /management and audit observatory/i);
  assert.doesNotMatch(
    serialized,
    /position CHALIN for business owners|operational control and management visibility|GHS 5000|Branch Id 1|PRIVATE SYSTEM CONTEXT/
  );
});

test("the exact reported Audit Intelligence question never triggers a Spare Parts live snapshot in local fallback", async () => {
  const prompt = "can you tell me what the audit intelligence does in chalin 03 intelligence";
  const tools = [
    {
      key: "spare_parts.operations_snapshot",
      title: "Spare Parts operations snapshot",
      risk_level: 1,
    },
  ];
  const providerContext = context({
    data_classification: "public",
    public_safe_system_turn: true,
  });

  assert.equal(
    chooseLocalReadTool({ messages: [{ role: "user", content: prompt }], tools, providerContext }),
    null
  );

  const result = await new LocalGovernedProvider().generate({
    messages: [{ role: "user", content: prompt }],
    tools,
    provider_context: providerContext,
  });

  assert.equal(result.tool_calls.length, 0);
  assert.match(result.text, /management and audit observatory/i);
  assert.match(result.text, /audit (?:score|status)/i);
  assert.doesNotMatch(result.text, /Sales Transaction Count|Zero-cost local mode|operations snapshot/i);
});

test("Local fallback chooses System Administrator group intelligence for whole-system live questions", () => {
  const prompt = "show me the current whole-system performance across all businesses";
  const groupTool = {
    key: "system.group_intelligence",
    title: "Whole-system group intelligence",
    risk_level: 1,
  };
  const storeTool = {
    key: "spare_parts.operations_snapshot",
    title: "Spare Parts operations snapshot",
    risk_level: 1,
  };

  const selected = chooseLocalReadTool({
    messages: [{ role: "user", content: prompt }],
    tools: [storeTool, groupTool],
    providerContext: context({ data_classification: "internal" }),
  });

  assert.equal(selected?.key, "system.group_intelligence");
});