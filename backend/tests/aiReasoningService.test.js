"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_HISTORY_MESSAGES,
  MAX_REASONING_EVIDENCE,
  MAX_RETRIEVAL_QUERIES,
  assessEvidenceConfidence,
  buildReasoningPlan,
  citationIntegrity,
  detectEvidenceTensions,
  rankEvidence,
  reasoningPromptBlock,
  selectRelevantHistory,
} = require("../services/aiReasoningService");

function evidence({
  ref,
  label,
  excerpt,
  score = 0.5,
  asOf = "2026-08-10T00:00:00.000Z",
  type = "knowledge.report",
} = {}) {
  return {
    source_type: type,
    source_ref: ref,
    source_version: "1",
    label,
    excerpt_text: excerpt,
    as_of_at: asOf,
    classification: "internal",
    workspace_code: "spare_parts",
    metadata: { retrieval_score: score },
  };
}

test("reasoning plan decomposes comparison and live operational questions", () => {
  const plan = buildReasoningPlan({
    persona: "executive",
    prompt:
      "Compare current Spare Parts stock balance versus last month and explain why it changed.",
    history: [
      { role: "user", content: "We were discussing the main store inventory." },
    ],
  });

  assert.equal(plan.intent, "compare");
  assert.equal(plan.live_data_required, true);
  assert.ok(plan.retrieval_queries.length >= 2);
  assert.ok(plan.retrieval_queries.length <= MAX_RETRIEVAL_QUERIES);
  assert.ok(MAX_RETRIEVAL_QUERIES >= 10);
  assert.ok(plan.answer_shape.includes("trade-offs"));
});

test("reasoning plan does not mark ordinary policy explanation as live operational data", () => {
  const plan = buildReasoningPlan({
    persona: "copilot",
    prompt: "Explain the approved equipment hire release policy and its review steps.",
  });

  assert.equal(plan.intent, "explain");
  assert.equal(plan.live_data_required, false);
});

test("deeper evidence ranking preserves independent corroboration in the production-sized context", () => {
  const ranked = rankEvidence({
    queries: ["customer debt outstanding balance"],
    limit: 4,
    now: new Date("2026-08-10T12:00:00.000Z").getTime(),
    evidence: [
      evidence({
        ref: "debt_policy#doc-a:chunk:1",
        label: "Customer debt balance procedure",
        excerpt: "Outstanding customer debt balance review rules.",
        score: 0.94,
      }),
      evidence({
        ref: "debt_policy#doc-a:chunk:2",
        label: "Customer debt balance procedure",
        excerpt: "Debt balances must be reviewed against receipts.",
        score: 0.91,
      }),
      evidence({
        ref: "debt_policy#doc-a:chunk:3",
        label: "Customer debt balance procedure",
        excerpt: "A third nearby chunk from the same source.",
        score: 0.9,
      }),
      evidence({
        ref: "collections_report#august:chunk:1",
        label: "Outstanding customer debt report",
        excerpt: "The report summarizes outstanding customer debt balances.",
        score: 0.72,
      }),
    ],
  });

  assert.equal(ranked.length, 4);
  assert.ok(
    ranked.some((item) => item.source_ref.startsWith("collections_report")),
    "an independent strong source family must survive the deeper answer context"
  );
  assert.ok(ranked.every((item) => Number(item.metadata.reasoning_score) >= 0));
  assert.ok(MAX_REASONING_EVIDENCE >= 32);
});

test("evidence tension detection flags similar claims with incompatible numeric facts", () => {
  const tensions = detectEvidenceTensions([
    evidence({
      ref: "finance_snapshot_a",
      label: "Outstanding finance balance",
      excerpt: "Outstanding finance balance is GHS 125,000.",
    }),
    evidence({
      ref: "finance_snapshot_b",
      label: "Outstanding finance balance",
      excerpt: "Outstanding finance balance is GHS 210,000.",
    }),
  ]);

  assert.equal(tensions.length, 1);
  assert.equal(tensions[0].left, "E1");
  assert.equal(tensions[0].right, "E2");
});

test("confidence fails low when live data is required but no governed live tool ran", () => {
  const ranked = rankEvidence({
    queries: ["current stock quantity"],
    evidence: [
      evidence({
        ref: "inventory_policy",
        label: "Stock count policy",
        excerpt: "Policy for physical stock counting.",
        score: 0.8,
      }),
    ],
  });
  const confidence = assessEvidenceConfidence({
    evidence: ranked,
    liveDataRequired: true,
    toolResults: [],
  });

  assert.equal(confidence.level, "low");
  assert.equal(confidence.live_tools_used, false);
  assert.ok(confidence.reasons.some((reason) => reason.includes("live operational data")));
});

test("confidence records governed tool use for live questions", () => {
  const ranked = rankEvidence({
    queries: ["current stock quantity"],
    evidence: [
      evidence({
        ref: "spare_parts:inventory:branch:1",
        label: "Current stock quantity",
        excerpt: "Current governed stock quantity is 44 units.",
        score: 0.95,
        type: "system_snapshot",
      }),
      evidence({
        ref: "inventory_policy",
        label: "Stock count policy",
        excerpt: "Policy for physical stock counting and variance review.",
        score: 0.7,
      }),
    ],
  });
  const confidence = assessEvidenceConfidence({
    evidence: ranked,
    liveDataRequired: true,
    toolResults: [
      {
        tool: { key: "spare_parts.inventory_health" },
        evidence: [ranked[0]],
      },
    ],
  });

  assert.equal(confidence.live_tools_used, true);
  assert.notEqual(confidence.level, "low");
});

test("relevant history stays deeply bounded and always retains the newest context", () => {
  const history = Array.from({ length: 90 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content:
      index === 2
        ? "Excavator finance arrears were discussed here."
        : `Unrelated historical conversation turn ${index}.`,
  }));
  history[89] = {
    role: "user",
    content: "Now compare those excavator finance arrears with payments.",
  };

  const selected = selectRelevantHistory(
    history,
    "Why are excavator finance arrears increasing?"
  );

  assert.ok(MAX_HISTORY_MESSAGES >= 48);
  assert.ok(selected.length <= MAX_HISTORY_MESSAGES);
  assert.equal(selected.at(-1).content, history.at(-1).content);
  assert.ok(selected.some((item) => item.content.includes("Excavator finance arrears")));
  assert.ok(selected.length > 12, "deep history should no longer be artificially capped at 12 turns");
});

test("citation integrity rejects invented evidence references", () => {
  const items = [
    evidence({
      ref: "policy_one",
      label: "Approved policy",
      excerpt: "Approved evidence.",
    }),
    evidence({
      ref: "policy_two",
      label: "Second approved policy",
      excerpt: "Second approved evidence.",
    }),
  ];

  assert.equal(citationIntegrity("Supported by [E1] and [E2].", items).valid, true);
  const invalid = citationIntegrity("Supported by [E3].", items);
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.unsupported, [3]);
});

test("reasoning prompt requires deep synthesis without exposing hidden chain of thought", () => {
  const plan = buildReasoningPlan({
    persona: "executive",
    prompt: "Should we prioritize debt recovery or new sales this month?",
  });
  const confidence = { level: "medium" };
  const prompt = reasoningPromptBlock({ plan, confidence, tensions: [] });

  assert.match(prompt, /never reveal hidden chain-of-thought/i);
  assert.match(prompt, /distinguish fact, inference, scenario and unknown/i);
  assert.match(prompt, /test alternative explanations/i);
  assert.match(prompt, /Recommendations must explain the strongest reason/i);
  assert.match(prompt, /what new evidence would change the recommendation/i);
  assert.match(prompt, /Do not lead with a mechanical evidence dump/i);
});
