"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  corroborationCount,
  fuseGovernedEvidence,
  nearDuplicate,
  retrievalChannel,
  sourceFamily,
} = require("../services/aiEvidenceFusionService");

function evidence({
  type = "knowledge_document.policy",
  ref,
  label,
  excerpt,
  score = 0.6,
  asOf = "2026-08-10T08:00:00.000Z",
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

test("fusion recognizes document and governed legacy retrieval channels", () => {
  assert.equal(
    retrievalChannel(evidence({ type: "knowledge_document.policy" })),
    "document_chunk"
  );
  assert.equal(
    retrievalChannel(evidence({ type: "knowledge.policy" })),
    "governed_knowledge"
  );
  assert.equal(
    sourceFamily(evidence({ ref: "policy-key#doc-12:chunk:8" })),
    "policy-key"
  );
});

test("independent compatible sources increase corroboration while conflicting numbers do not", () => {
  const primary = evidence({
    ref: "collections-report#doc-a:chunk:1",
    label: "Outstanding customer debt",
    excerpt: "Outstanding customer debt is GHS 125,000 after August collections.",
  });
  const supporting = evidence({
    type: "knowledge.report",
    ref: "finance-summary",
    label: "Outstanding customer debt",
    excerpt: "August outstanding customer debt remains GHS 125,000 after collections.",
  });
  const conflicting = evidence({
    type: "knowledge.report",
    ref: "old-summary",
    label: "Outstanding customer debt",
    excerpt: "Outstanding customer debt is GHS 210,000 after August collections.",
  });

  assert.equal(corroborationCount(primary, [primary, supporting]), 1);
  assert.equal(corroborationCount(primary, [primary, conflicting]), 0);
});

test("fusion promotes relevant corroborated evidence over high-score unrelated material", () => {
  const result = fuseGovernedEvidence({
    query: "current customer debt collections balance",
    limit: 3,
    now: new Date("2026-08-10T12:00:00.000Z").getTime(),
    evidence: [
      evidence({
        ref: "debt-report#doc-a:chunk:1",
        label: "Customer debt collections",
        excerpt: "Customer debt collections reduced the outstanding balance to GHS 125,000.",
        score: 0.78,
      }),
      evidence({
        type: "knowledge.report",
        ref: "debt-summary",
        label: "Customer debt collections",
        excerpt: "Outstanding customer debt balance is GHS 125,000 after collections.",
        score: 0.68,
      }),
      evidence({
        ref: "paint-policy#doc-z:chunk:2",
        label: "Warehouse paint standard",
        excerpt: "Approved exterior paint colors for warehouse signage.",
        score: 0.99,
      }),
    ],
  });

  assert.equal(result.length, 3);
  assert.match(result[0].label, /Customer debt collections/);
  assert.ok(Number(result[0].metadata.corroborating_source_count) >= 1);
  assert.ok(Number(result[0].metadata.fusion_score) > 0);
});

test("near duplicate chunks are recognized but numerically conflicting claims are not collapsed", () => {
  const first = evidence({
    ref: "policy#doc-a:chunk:1",
    label: "Release inspection policy",
    excerpt: "Equipment release requires a documented inspection before handover.",
  });
  const duplicate = evidence({
    ref: "policy-copy#doc-b:chunk:1",
    label: "Release inspection policy",
    excerpt: "Equipment release requires a documented inspection before handover.",
  });
  const conflict = evidence({
    ref: "balance-a",
    label: "Outstanding balance",
    excerpt: "Outstanding balance is GHS 12,000.",
  });
  const conflictTwo = evidence({
    ref: "balance-b",
    label: "Outstanding balance",
    excerpt: "Outstanding balance is GHS 19,000.",
  });

  assert.equal(nearDuplicate(first, duplicate), true);
  assert.equal(nearDuplicate(conflict, conflictTwo), false);
});

test("fusion prevents one document family from consuming the whole answer context", () => {
  const candidates = Array.from({ length: 6 }, (_, index) =>
    evidence({
      ref: `same-policy#doc-a:chunk:${index + 1}`,
      label: "Equipment release procedure",
      excerpt: `Equipment release inspection procedure step ${index + 1} requires governed review.`,
      score: 0.95 - index * 0.02,
    })
  );
  candidates.push(
    evidence({
      type: "knowledge.policy",
      ref: "independent-release-summary",
      label: "Equipment release procedure",
      excerpt: "A separate governed policy summary also requires inspection before release.",
      score: 0.7,
    })
  );

  const result = fuseGovernedEvidence({
    query: "equipment release inspection procedure",
    evidence: candidates,
    limit: 4,
  });
  const sameFamily = result.filter(
    (item) => item.metadata.source_family === "same-policy"
  );
  assert.ok(sameFamily.length <= 2);
  assert.ok(
    result.some(
      (item) => item.metadata.source_family === "independent-release-summary"
    )
  );
});

test("fusion metadata remains advisory and does not change evidence classification or source identity", () => {
  const original = evidence({
    ref: "governed-policy#doc-a:chunk:3",
    label: "Governed policy",
    excerpt: "Governed policy text used for retrieval.",
  });
  const [fused] = fuseGovernedEvidence({
    query: "governed policy",
    evidence: [original],
    limit: 1,
  });
  assert.equal(fused.classification, original.classification);
  assert.equal(fused.source_ref, original.source_ref);
  assert.equal(fused.source_type, original.source_type);
  assert.equal(fused.metadata.retrieval_channel, "document_chunk");
});
