"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const orchestrator = fs.readFileSync(
  path.join(root, "backend/services/aiOrchestratorService.js"),
  "utf8"
);
const retrievalService = fs.readFileSync(
  path.join(root, "backend/services/aiKnowledgeRetrievalService.js"),
  "utf8"
);
const fusionService = fs.readFileSync(
  path.join(root, "backend/services/aiEvidenceFusionService.js"),
  "utf8"
);
const conversations = fs.readFileSync(
  path.join(root, "backend/services/aiConversationService.js"),
  "utf8"
);
const documentService = fs.readFileSync(
  path.join(root, "backend/services/aiDocumentIntelligenceService.js"),
  "utf8"
);

test("Copilot and Executive automatically retrieve deeper governed candidates then fuse evidence", () => {
  assert.match(orchestrator, /searchGovernedKnowledge/);
  assert.match(orchestrator, /async function retrieveAutomaticEvidence/);
  assert.match(orchestrator, /const knowledgeEvidence = await retrieveAutomaticEvidence/);
  assert.match(orchestrator, /rankEvidence/);

  assert.match(retrievalService, /searchPublishedDocumentChunks/);
  assert.match(retrievalService, /searchApprovedKnowledge/);
  assert.match(retrievalService, /fuseGovernedEvidence/);
  assert.match(retrievalService, /candidateLimitFor/);
  assert.match(retrievalService, /safeLimit \* 3/);
  assert.match(
    retrievalService,
    /const \[documentEvidence, legacyEvidence\] = await Promise\.all/
  );
  assert.match(
    retrievalService,
    /for \(const item of \[\.\.\.documentEvidence, \.\.\.legacyEvidence\]\)/
  );
  assert.match(retrievalService, /normalizeEvidenceList\(merged/);
  assert.match(retrievalService, /evidence: candidates/);
  assert.match(retrievalService, /limit: safeLimit/);

  assert.match(fusionService, /corroborating_source_count/);
  assert.match(fusionService, /MAX_ITEMS_PER_SOURCE_FAMILY/);
  assert.match(fusionService, /nearDuplicate/);
  assert.match(fusionService, /numericCompatible/);
});

test("document retrieval evidence carries precise governed citation metadata", () => {
  for (const marker of [
    "document_id",
    "chunk_id",
    "chunk_index",
    "line_start",
    "line_end",
    "chunk_sha256",
    "citation_deep_link",
    "retrieval_score",
  ]) {
    assert.match(documentService, new RegExp(marker));
  }
  assert.match(documentService, /raw_binary_stored = 0/);
  assert.match(documentService, /v\.version_status = 'published'/);
});

test("reopened conversations restore persisted evidence and metadata", () => {
  assert.match(conversations, /FROM ai_evidence_records/);
  assert.match(conversations, /metadata_json/);
  assert.match(conversations, /evidenceByMessage/);
  assert.match(conversations, /publicMessage\(row, evidenceByMessage/);
  assert.match(conversations, /normalizeEvidenceList\(evidence\)/);
});
