"use strict";

const { normalizeEvidenceList } = require("./aiEvidenceService");
const { fuseGovernedEvidence } = require("./aiEvidenceFusionService");
const { searchApprovedKnowledge } = require("./aiKnowledgeService");
const {
  searchPublishedDocumentChunks,
} = require("./aiDocumentIntelligenceService");

const MAX_RETRIEVAL_CANDIDATES = 50;

function evidenceIdentity(item = {}) {
  return [item.source_type, item.source_ref, item.source_version]
    .map((value) => String(value || ""))
    .join("|");
}

function candidateLimitFor(finalLimit) {
  const safeLimit = Math.max(1, Math.min(20, Number(finalLimit) || 8));
  return Math.min(MAX_RETRIEVAL_CANDIDATES, Math.max(safeLimit * 3, 12));
}

async function searchGovernedKnowledge({
  query,
  persona,
  workspaceCode = null,
  limit = 8,
} = {}) {
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 8));
  const candidateLimit = candidateLimitFor(safeLimit);
  const [documentEvidence, legacyEvidence] = await Promise.all([
    searchPublishedDocumentChunks({
      query,
      persona,
      workspaceCode,
      limit: candidateLimit,
    }),
    searchApprovedKnowledge({
      query,
      persona,
      workspaceCode,
      limit: candidateLimit,
    }),
  ]);

  const merged = [];
  const seen = new Set();
  for (const item of [...documentEvidence, ...legacyEvidence]) {
    const identity = evidenceIdentity(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(item);
    if (merged.length >= MAX_RETRIEVAL_CANDIDATES) break;
  }

  const candidates = normalizeEvidenceList(merged, {
    maximum: MAX_RETRIEVAL_CANDIDATES,
  });
  return fuseGovernedEvidence({
    query,
    evidence: candidates,
    limit: safeLimit,
  });
}

module.exports = {
  MAX_RETRIEVAL_CANDIDATES,
  candidateLimitFor,
  evidenceIdentity,
  searchGovernedKnowledge,
};
