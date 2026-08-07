"use strict";

const { normalizeEvidenceList } = require("./aiEvidenceService");
const { searchApprovedKnowledge } = require("./aiKnowledgeService");
const {
  searchPublishedDocumentChunks,
} = require("./aiDocumentIntelligenceService");

function evidenceIdentity(item = {}) {
  return [item.source_type, item.source_ref, item.source_version]
    .map((value) => String(value || ""))
    .join("|");
}

async function searchGovernedKnowledge({
  query,
  persona,
  workspaceCode = null,
  limit = 8,
} = {}) {
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 8));
  const [documentEvidence, legacyEvidence] = await Promise.all([
    searchPublishedDocumentChunks({
      query,
      persona,
      workspaceCode,
      limit: safeLimit,
    }),
    searchApprovedKnowledge({
      query,
      persona,
      workspaceCode,
      limit: safeLimit,
    }),
  ]);

  const merged = [];
  const seen = new Set();
  for (const item of [...documentEvidence, ...legacyEvidence]) {
    const identity = evidenceIdentity(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(item);
    if (merged.length >= safeLimit) break;
  }
  return normalizeEvidenceList(merged);
}

module.exports = {
  evidenceIdentity,
  searchGovernedKnowledge,
};
