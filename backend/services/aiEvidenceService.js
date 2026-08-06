"use strict";

const { redactSensitiveText } = require("./aiSafetyService");

const EVIDENCE_CLASSIFICATIONS = Object.freeze([
  "public",
  "internal",
  "confidential",
  "sensitive",
  "immutable",
]);
const SOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_.-]{1,79}$/;

class AiEvidenceError extends Error {
  constructor(message, { code = "AI_EVIDENCE_INVALID", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiEvidenceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeEvidence(item = {}, index = 0) {
  const sourceType = clean(item.source_type, 80).toLowerCase();
  const sourceRef = clean(item.source_ref, 180);
  const label = clean(item.label, 255);
  const classification = clean(item.classification || "internal", 30).toLowerCase();

  if (!SOURCE_TYPE_PATTERN.test(sourceType) || !sourceRef || !label) {
    throw new AiEvidenceError(`Evidence item ${index + 1} is incomplete.`, {
      details: ["source_type", "source_ref", "label"],
    });
  }
  if (!EVIDENCE_CLASSIFICATIONS.includes(classification)) {
    throw new AiEvidenceError(`Evidence item ${index + 1} has an invalid classification.`);
  }

  const excerpt = redactSensitiveText(clean(item.excerpt_text, 1200));
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? item.metadata
      : {};

  return Object.freeze({
    citation: `E${index + 1}`,
    source_type: sourceType,
    source_ref: sourceRef,
    source_version: clean(item.source_version, 80) || null,
    label,
    excerpt_text: excerpt.text || null,
    as_of_at: normalizeDate(item.as_of_at),
    classification,
    workspace_code: clean(item.workspace_code, 50) || null,
    metadata: Object.freeze({ ...metadata }),
    redaction_count: excerpt.redaction_count,
  });
}

function normalizeEvidenceList(items, { maximum = 50 } = {}) {
  if (!Array.isArray(items)) return Object.freeze([]);
  if (items.length > maximum) {
    throw new AiEvidenceError(`AI evidence may contain at most ${maximum} items.`, {
      code: "AI_EVIDENCE_LIMIT_EXCEEDED",
      statusCode: 413,
    });
  }
  const dedupe = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item?.source_type || ""}:${item?.source_ref || ""}:${item?.source_version || ""}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    result.push(normalizeEvidence(item, result.length));
  }
  return Object.freeze(result);
}

function evidenceCitationMap(items) {
  const evidence = normalizeEvidenceList(items);
  return Object.freeze(
    Object.fromEntries(
      evidence.map((item) => [
        item.citation,
        Object.freeze({
          label: item.label,
          source_type: item.source_type,
          source_ref: item.source_ref,
          source_version: item.source_version,
          as_of_at: item.as_of_at,
        }),
      ])
    )
  );
}

function assertEvidenceRequired(tool, evidence) {
  const normalized = normalizeEvidenceList(evidence);
  if (tool?.evidence_required !== false && normalized.length === 0) {
    throw new AiEvidenceError(
      `AI tool ${tool?.key || "unknown"} returned no evidence.`,
      { code: "AI_TOOL_EVIDENCE_REQUIRED", statusCode: 502 }
    );
  }
  return normalized;
}

function evidencePromptBlock(items) {
  const evidence = normalizeEvidenceList(items);
  if (evidence.length === 0) {
    return "No approved evidence was available. State this limitation clearly.";
  }
  return evidence
    .map(
      (item) =>
        `[${item.citation}] ${item.label} (${item.source_type}:${item.source_ref}${
          item.source_version ? `@${item.source_version}` : ""
        })${item.excerpt_text ? `\n${item.excerpt_text}` : ""}`
    )
    .join("\n\n");
}

module.exports = {
  AiEvidenceError,
  EVIDENCE_CLASSIFICATIONS,
  SOURCE_TYPE_PATTERN,
  assertEvidenceRequired,
  evidenceCitationMap,
  evidencePromptBlock,
  normalizeDate,
  normalizeEvidence,
  normalizeEvidenceList,
};
