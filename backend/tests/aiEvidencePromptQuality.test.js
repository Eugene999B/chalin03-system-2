"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evidencePromptBlock,
  promptAsOf,
  promptCorroboration,
} = require("../services/aiEvidenceService");

test("evidence prompt gives the model source recency and independent corroboration", () => {
  const block = evidencePromptBlock([
    {
      source_type: "knowledge_document.report",
      source_ref: "debt-report#doc-1:chunk:2",
      source_version: "7",
      label: "Outstanding debt report",
      excerpt_text: "Outstanding debt is GHS 125,000.",
      as_of_at: "2026-08-10T07:30:00.000Z",
      classification: "internal",
      metadata: {
        corroborating_source_count: 2,
      },
    },
  ]);

  assert.match(block, /\[E1\] Outstanding debt report/);
  assert.match(block, /knowledge_document\.report@7/);
  assert.match(block, /as-of 2026-08-10T07:30:00\.000Z/);
  assert.match(block, /2 independent corroborating sources/);
  assert.match(block, /Outstanding debt is GHS 125,000/);
});

test("invalid timestamps and uncorroborated sources do not invent quality metadata", () => {
  assert.equal(promptAsOf("not-a-date"), null);
  assert.equal(promptCorroboration({ metadata: {} }), 0);
  const block = evidencePromptBlock([
    {
      source_type: "knowledge.policy",
      source_ref: "policy",
      label: "Policy",
      excerpt_text: "Approved policy content.",
      as_of_at: "invalid",
      metadata: {},
    },
  ]);
  assert.doesNotMatch(block, /as-of/);
  assert.doesNotMatch(block, /corroborating source/);
});

test("empty evidence remains an explicit no-guessing instruction", () => {
  assert.match(
    evidencePromptBlock([]),
    /State the limitation instead of guessing/i
  );
});
