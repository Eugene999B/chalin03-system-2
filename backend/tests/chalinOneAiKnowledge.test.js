"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  AiKnowledgeError,
  checksum,
  normalizeSourceKey,
  parseJson,
  retrievalVisibility,
  sanitizeSource,
  sanitizeVersion,
} = require("../services/aiKnowledgeService");

const source = fs.readFileSync(
  path.resolve(__dirname, "../services/aiKnowledgeService.js"),
  "utf8"
);

test("knowledge identities, source types and visibility are controlled", () => {
  assert.equal(normalizeSourceKey("Equipment Hire Policy"), "equipment_hire_policy");
  assert.equal(normalizeSourceKey("../../secret"), null);
  assert.throws(
    () =>
      sanitizeSource({
        source_key: "policy",
        source_type: "policy",
        visibility: "workspace",
        title: "Policy",
      }),
    (error) =>
      error instanceof AiKnowledgeError &&
      error.code === "AI_KNOWLEDGE_WORKSPACE_REQUIRED"
  );
  const publicSource = sanitizeSource({
    source_key: "public_faq",
    source_type: "faq",
    visibility: "public",
    title: "Public FAQ",
  });
  assert.equal(publicSource.visibility, "public");
});

test("knowledge versions are checksummed, bounded and date validated", () => {
  const version = sanitizeVersion({
    title: "Approved Procedure",
    body_text: "Use the authorized workflow.",
    effective_from: "2026-08-01T00:00:00Z",
    expires_at: "2027-08-01T00:00:00Z",
    metadata: { owner: "Operations" },
  });
  assert.equal(version.checksum_sha256, checksum(version.body_text));
  assert.match(version.checksum_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(parseJson(version.metadata_json), { owner: "Operations" });

  assert.throws(
    () =>
      sanitizeVersion({
        title: "Invalid",
        body_text: "Invalid date range",
        effective_from: "2027-01-01T00:00:00Z",
        expires_at: "2026-01-01T00:00:00Z",
      }),
    (error) =>
      error instanceof AiKnowledgeError &&
      error.code === "AI_KNOWLEDGE_DATE_RANGE_INVALID"
  );
});

test("retrieval visibility separates Guide, Copilot and Executive", () => {
  assert.equal(retrievalVisibility("guide").sql, "s.visibility = 'public'");
  assert.match(retrievalVisibility("copilot", "mining").sql, /workspace/);
  assert.deepEqual(retrievalVisibility("copilot", "mining").params, ["mining"]);
  assert.match(retrievalVisibility("executive").sql, /executive/);
  assert.doesNotMatch(retrievalVisibility("executive").sql, /restricted/);
});

test("knowledge governance uses exact-version independent review and publishing", () => {
  assert.match(source, /version_status = 'in_review'/);
  assert.match(source, /version_status !== "in_review"/);
  assert.match(source, /AI_KNOWLEDGE_SELF_APPROVAL_BLOCKED/);
  assert.match(source, /AI_KNOWLEDGE_REVIEW_ASSIGNED_ELSEWHERE/);
  assert.match(source, /AI_KNOWLEDGE_INDEPENDENT_PUBLISHER_REQUIRED/);
  assert.match(source, /approval\.requested_by/);
  assert.match(source, /approval\.decided_by/);
  assert.match(source, /version_status = 'superseded'/);
  assert.match(source, /executed_at = UTC_TIMESTAMP/);
});

test("retrieval returns only published, active and currently effective versions", () => {
  assert.match(source, /v\.version_status = 'published'/);
  assert.match(source, /s\.source_status = 'active'/);
  assert.match(source, /effective_from/);
  assert.match(source, /expires_at/);
  assert.match(source, /UTC_TIMESTAMP\(\)/);
  assert.match(source, /normalizeEvidenceList/);
});

test("knowledge lifecycle contains no destructive delete operation", () => {
  assert.doesNotMatch(source, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});
