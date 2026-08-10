"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assessEvidenceConfidence,
  isLiveOperationalToolResult,
  rankEvidence,
} = require("../services/aiReasoningService");

function evidence({
  sourceType = "tool.snapshot",
  ref = "snapshot",
  label = "Current operational snapshot",
  excerpt = "Current operational balance is 25.",
  asOf = "2026-08-10T08:00:00.000Z",
} = {}) {
  return {
    source_type: sourceType,
    source_ref: ref,
    source_version: "1",
    label,
    excerpt_text: excerpt,
    as_of_at: asOf,
    classification: "internal",
    workspace_code: "spare_parts",
    metadata: { retrieval_score: 0.9 },
  };
}

test("memory, knowledge and system tools cannot satisfy live operational verification", () => {
  const contextResults = [
    {
      tool: { key: "conversation.memory" },
      evidence: [],
    },
    {
      tool: { key: "knowledge.search" },
      evidence: [
        evidence({
          sourceType: "knowledge.policy",
          ref: "policy",
          label: "Stock policy",
          excerpt: "Stock policy says counts must be checked.",
        }),
      ],
    },
    {
      tool: { key: "system.scope_summary" },
      evidence: [],
    },
  ];

  for (const result of contextResults) {
    assert.equal(isLiveOperationalToolResult(result), false);
  }

  const ranked = rankEvidence({
    queries: ["current stock balance"],
    evidence: contextResults.flatMap((result) => result.evidence),
  });
  const confidence = assessEvidenceConfidence({
    evidence: ranked,
    liveDataRequired: true,
    toolResults: contextResults,
  });
  assert.equal(confidence.live_tools_used, false);
  assert.equal(confidence.level, "low");
  assert.ok(confidence.reasons.some((reason) => reason.includes("live operational data")));
});

test("a timestamped governed operational snapshot can satisfy live verification", () => {
  const operationalEvidence = evidence({
    sourceType: "tool.spare_parts_snapshot",
    ref: "spare_parts.operations_snapshot",
  });
  const result = {
    tool: { key: "spare_parts.operations_snapshot" },
    evidence: [operationalEvidence],
  };
  assert.equal(isLiveOperationalToolResult(result), true);

  const ranked = rankEvidence({
    queries: ["current operational balance"],
    evidence: [operationalEvidence],
  });
  const confidence = assessEvidenceConfidence({
    evidence: ranked,
    liveDataRequired: true,
    toolResults: [result],
  });
  assert.equal(confidence.live_tools_used, true);
  assert.notEqual(confidence.level, "low");
});

test("an operational-looking tool without timestamped governed evidence does not count as live", () => {
  assert.equal(
    isLiveOperationalToolResult({
      tool: { key: "spare_parts.operations_snapshot" },
      evidence: [
        evidence({
          sourceType: "tool.spare_parts_snapshot",
          asOf: null,
        }),
      ],
    }),
    false
  );
});
