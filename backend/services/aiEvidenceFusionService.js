"use strict";

const { normalizeEvidenceList } = require("./aiEvidenceService");
const {
  meaningfulTokens,
  numericSignature,
  overlapScore,
} = require("./aiReasoningService");

const MAX_FUSION_CANDIDATES = 50;
const MAX_FUSION_RESULTS = 12;
const MAX_ITEMS_PER_SOURCE_FAMILY = 2;

function clean(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function sourceFamily(item = {}) {
  const ref = clean(item.source_ref, 220);
  if (!ref) return "unknown";
  return ref.split("#", 1)[0].split(":chunk:", 1)[0];
}

function retrievalChannel(item = {}) {
  const type = clean(item.source_type, 100).toLowerCase();
  if (type.startsWith("knowledge_document.")) return "document_chunk";
  if (type.startsWith("knowledge.")) return "governed_knowledge";
  return "other";
}

function freshnessScore(value, now = Date.now()) {
  if (!value) return 0.2;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 0.2;
  const days = Math.max(0, (now - timestamp) / 86400000);
  if (days <= 7) return 1;
  if (days <= 30) return 0.85;
  if (days <= 180) return 0.65;
  if (days <= 365) return 0.45;
  return 0.25;
}

function authorityScore(item = {}) {
  const channel = retrievalChannel(item);
  if (channel === "document_chunk") return 1;
  if (channel === "governed_knowledge") return 0.92;
  return 0.75;
}

function tokenJaccard(left, right) {
  const a = new Set(meaningfulTokens(left));
  const b = new Set(meaningfulTokens(right));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

function candidateText(item = {}) {
  return `${item.label || ""} ${item.excerpt_text || ""}`.trim();
}

function numericCompatible(left, right) {
  const a = numericSignature(candidateText(left));
  const b = numericSignature(candidateText(right));
  if (!a.length || !b.length) return true;
  return a.some((value) => b.includes(value));
}

function corroborationCount(item, candidates) {
  const family = sourceFamily(item);
  const supportingFamilies = new Set();
  for (const other of candidates) {
    if (other === item) continue;
    const otherFamily = sourceFamily(other);
    if (otherFamily === family) continue;
    if (tokenJaccard(candidateText(item), candidateText(other)) < 0.28) continue;
    if (!numericCompatible(item, other)) continue;
    supportingFamilies.add(otherFamily);
  }
  return supportingFamilies.size;
}

function baseFusionScore(item, query, now) {
  const lexical = overlapScore(query, candidateText(item));
  const retrieval = Math.max(
    0,
    Math.min(1, Number(item?.metadata?.retrieval_score || 0))
  );
  const freshness = freshnessScore(item.as_of_at, now);
  const authority = authorityScore(item);
  return lexical * 0.3 + retrieval * 0.4 + freshness * 0.12 + authority * 0.18;
}

function nearDuplicate(left, right) {
  if (!numericCompatible(left, right)) return false;
  return tokenJaccard(candidateText(left), candidateText(right)) >= 0.86;
}

function fuseGovernedEvidence({
  query = "",
  evidence = [],
  limit = MAX_FUSION_RESULTS,
  now = Date.now(),
} = {}) {
  const safeLimit = Math.max(
    1,
    Math.min(MAX_FUSION_RESULTS, Number(limit) || MAX_FUSION_RESULTS)
  );
  const normalized = normalizeEvidenceList(evidence, {
    maximum: MAX_FUSION_CANDIDATES,
  });
  if (!normalized.length) return Object.freeze([]);

  const scored = normalized.map((item) => {
    const corroboration = corroborationCount(item, normalized);
    const score = Math.min(
      1,
      baseFusionScore(item, query, now) + Math.min(0.12, corroboration * 0.04)
    );
    return {
      item,
      family: sourceFamily(item),
      channel: retrievalChannel(item),
      corroboration,
      score,
    };
  });
  scored.sort((left, right) => right.score - left.score);

  const selected = [];
  const familyCounts = new Map();
  while (selected.length < safeLimit) {
    let best = null;
    for (const candidate of scored) {
      if (candidate.selected) continue;
      const familyCount = familyCounts.get(candidate.family) || 0;
      if (familyCount >= MAX_ITEMS_PER_SOURCE_FAMILY) continue;
      const redundancy = selected.reduce(
        (maximum, chosen) =>
          Math.max(
            maximum,
            tokenJaccard(candidateText(candidate.item), candidateText(chosen.item))
          ),
        0
      );
      const adjusted = candidate.score - redundancy * 0.22;
      if (!best || adjusted > best.adjusted) {
        best = { ...candidate, adjusted, redundancy };
      }
    }
    if (!best) break;

    const source = scored.find(
      (candidate) =>
        candidate.item.source_type === best.item.source_type &&
        candidate.item.source_ref === best.item.source_ref &&
        candidate.item.source_version === best.item.source_version
    );
    if (source) source.selected = true;

    const duplicate = selected.some((chosen) => nearDuplicate(best.item, chosen.item));
    if (duplicate && selected.length >= Math.min(3, safeLimit)) continue;

    selected.push(best);
    familyCounts.set(best.family, (familyCounts.get(best.family) || 0) + 1);
  }

  return normalizeEvidenceList(
    selected.slice(0, safeLimit).map((candidate) => ({
      ...candidate.item,
      metadata: {
        ...(candidate.item.metadata || {}),
        retrieval_channel: candidate.channel,
        source_family: candidate.family,
        corroborating_source_count: candidate.corroboration,
        fusion_score: Number(candidate.score.toFixed(6)),
        redundancy_penalty: Number(candidate.redundancy.toFixed(6)),
      },
    })),
    { maximum: MAX_FUSION_RESULTS }
  );
}

module.exports = {
  MAX_FUSION_CANDIDATES,
  MAX_FUSION_RESULTS,
  MAX_ITEMS_PER_SOURCE_FAMILY,
  authorityScore,
  baseFusionScore,
  candidateText,
  corroborationCount,
  freshnessScore,
  fuseGovernedEvidence,
  nearDuplicate,
  numericCompatible,
  retrievalChannel,
  sourceFamily,
  tokenJaccard,
};
