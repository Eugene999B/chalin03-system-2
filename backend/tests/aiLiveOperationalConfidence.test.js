"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LIVE_OPERATIONAL_EVIDENCE_TYPES,
  assessEvidenceConfidence,
  isLiveOperationalToolResult,
  rankEvidence,
} = require("../services/aiReasoningService");

function evidence({
  sourceType = "system_snapshot",
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

test("memory, knowledge and system context tools cannot satisfy live operational verification", () => {
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
    {
      tool: { key: "system.ai_feature_status" },
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

test("real CHALIN operational evidence families can satisfy live verification", () => {
  const cases = [
    ["spare_parts.operations_snapshot", "system_snapshot", "spare_parts:operations:branch:1"],
    ["mining.operations_snapshot", "mining_snapshot", "mining:operations:site:2"],
    ["equipment_hire.operations_snapshot", "hire_snapshot", "equipment_hire:operations:location:3"],
    ["equipment_finance.portfolio_health", "equipment_finance_snapshot", "equipment_finance:portfolio:business:4"],
  ];

  assert.deepEqual(
    [...LIVE_OPERATIONAL_EVIDENCE_TYPES].sort(),
    ["equipment_finance_snapshot", "hire_snapshot", "mining_snapshot", "system_snapshot"]
  );

  for (const [toolKey, sourceType, ref] of cases) {
    const operationalEvidence = evidence({ sourceType, ref });
    const result = {
      tool: { key: toolKey },
      evidence: [operationalEvidence],
    };
    assert.equal(isLiveOperationalToolResult(result), true, toolKey);
  }
});

test("timestamped Spare Parts operational snapshot upgrades live confidence", () => {
  const operationalEvidence = evidence({
    sourceType: "system_snapshot",
    ref: "spare_parts:operations:branch:1",
  });
  const result = {
    tool: { key: "spare_parts.operations_snapshot" },
    evidence: [operationalEvidence],
  };

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

test("unknown or untimestamped evidence fails closed even behind an operational-looking tool key", () => {
  assert.equal(
    isLiveOperationalToolResult({
      tool: { key: "spare_parts.operations_snapshot" },
      evidence: [
        evidence({
          sourceType: "system_snapshot",
          asOf: null,
        }),
      ],
    }),
    false
  );

  assert.equal(
    isLiveOperationalToolResult({
      tool: { key: "spare_parts.operations_snapshot" },
      evidence: [
        evidence({
          sourceType: "unregistered_snapshot_type",
        }),
      ],
    }),
    false
  );
});
