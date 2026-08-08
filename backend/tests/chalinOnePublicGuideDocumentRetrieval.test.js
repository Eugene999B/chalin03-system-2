"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const guideService = fs.readFileSync(
  path.join(root, "backend/services/publicGuideService.js"),
  "utf8"
);
const retrievalService = fs.readFileSync(
  path.join(root, "backend/services/aiKnowledgeRetrievalService.js"),
  "utf8"
);
const documentService = fs.readFileSync(
  path.join(root, "backend/services/aiDocumentIntelligenceService.js"),
  "utf8"
);

test("public Guide uses governed hybrid retrieval rather than legacy whole-body search only", () => {
  assert.match(
    guideService,
    /const \{ searchGovernedKnowledge \} = require\("\.\/aiKnowledgeRetrievalService"\)/
  );
  assert.match(
    guideService,
    /searchGovernedKnowledge\(\{[\s\S]*persona: "guide"[\s\S]*limit: 6/
  );
  assert.doesNotMatch(
    guideService,
    /const \{ searchApprovedKnowledge \} = require\("\.\/aiKnowledgeService"\)/
  );
});

test("hybrid retrieval asks document retrieval and legacy retrieval through one governed boundary", () => {
  assert.match(retrievalService, /searchPublishedDocumentChunks/);
  assert.match(retrievalService, /searchApprovedKnowledge/);
  assert.match(retrievalService, /normalizeEvidenceList/);
});

test("Guide document retrieval remains public-only", () => {
  assert.match(
    documentService,
    /if \(normalizedPersona === "guide"\)[\s\S]*s\.visibility = 'public'/
  );
  assert.match(documentService, /v\.version_status = 'published'/);
  assert.match(documentService, /s\.source_status = 'active'/);
  assert.match(documentService, /COALESCE\(v\.effective_from/);
  assert.match(documentService, /COALESCE\(v\.expires_at/);
});
