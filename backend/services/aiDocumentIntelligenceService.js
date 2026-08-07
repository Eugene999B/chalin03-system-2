"use strict";

const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const { normalizeEvidenceList } = require("./aiEvidenceService");
const { normalizeAiPersona } = require("../security/aiPermissionCatalog");

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const CHUNK_TARGET_CHARACTERS = 3200;
const CHUNK_OVERLAP_CHARACTERS = 320;
const VECTOR_DIMENSIONS = 96;
const VECTOR_MODEL_KEY = "local_hash_v1";
const SUPPORTED_MIME_TYPES = Object.freeze([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
]);

class AiDocumentIntelligenceError extends Error {
  constructor(
    message,
    { code = "AI_DOCUMENT_INTELLIGENCE_ERROR", statusCode = 400, details = [] } = {}
  ) {
    super(message);
    this.name = "AiDocumentIntelligenceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maxLength = 255) {
  return String(value ?? "").trim().slice(0, maxLength) || null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeMimeType(value) {
  return String(value || "text/plain")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function normalizeDocumentKey(value, fileName, checksum) {
  const supplied = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  if (supplied) return supplied;
  const stem = String(fileName || "document")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "document";
  return `${stem}_${String(checksum || "").slice(0, 12)}`;
}

function decodeHtmlEntities(text) {
  const replacements = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  };
  return String(text || "").replace(
    /&(nbsp|amp|lt|gt|quot|#39);/gi,
    (match) => replacements[match.toLowerCase()] || match
  );
}

function stripHtml(text) {
  return decodeHtmlEntities(
    String(text || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeInputContent(input = {}) {
  if (typeof input.content_text === "string") {
    const buffer = Buffer.from(input.content_text, "utf8");
    return { buffer, source: "content_text" };
  }

  const encoded = String(input.content_base64 || "").trim();
  if (!encoded) {
    throw new AiDocumentIntelligenceError(
      "Document ingestion requires content_text or content_base64.",
      { code: "AI_DOCUMENT_CONTENT_REQUIRED" }
    );
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded.replace(/\s+/g, ""))) {
    throw new AiDocumentIntelligenceError("Document base64 content is invalid.", {
      code: "AI_DOCUMENT_BASE64_INVALID",
    });
  }
  return {
    buffer: Buffer.from(encoded.replace(/\s+/g, ""), "base64"),
    source: "content_base64",
  };
}

function parseSupportedDocument({ mimeType, buffer }) {
  const normalizedMime = normalizeMimeType(mimeType);
  if (!SUPPORTED_MIME_TYPES.includes(normalizedMime)) {
    throw new AiDocumentIntelligenceError(
      `The ${normalizedMime || "unknown"} parser is not enabled. PDF, DOCX and image OCR remain disabled until their binary parser adapters are separately reviewed.`,
      {
        code: "AI_DOCUMENT_PARSER_NOT_AVAILABLE",
        statusCode: 415,
        details: SUPPORTED_MIME_TYPES,
      }
    );
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AiDocumentIntelligenceError("The document is empty.", {
      code: "AI_DOCUMENT_EMPTY",
    });
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new AiDocumentIntelligenceError(
      `Document content exceeds the ${MAX_DOCUMENT_BYTES} byte ingestion limit.`,
      { code: "AI_DOCUMENT_TOO_LARGE", statusCode: 413 }
    );
  }

  let text = buffer.toString("utf8");
  if (text.includes("\uFFFD") || text.includes("\0")) {
    throw new AiDocumentIntelligenceError(
      "The document does not contain clean UTF-8 text and cannot use the approved text parser.",
      { code: "AI_DOCUMENT_TEXT_ENCODING_INVALID", statusCode: 415 }
    );
  }
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  if (normalizedMime === "text/html") {
    text = stripHtml(text);
  } else if (normalizedMime === "application/json") {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      throw new AiDocumentIntelligenceError("The JSON document is invalid.", {
        code: "AI_DOCUMENT_JSON_INVALID",
      });
    }
  } else if (["application/xml", "text/xml"].includes(normalizedMime)) {
    text = stripHtml(text);
  }

  text = text
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (!text) {
    throw new AiDocumentIntelligenceError(
      "The approved parser did not extract usable text from this document.",
      { code: "AI_DOCUMENT_NO_TEXT" }
    );
  }

  return Object.freeze({
    parser_key: `builtin_${normalizedMime.replace(/[^a-z0-9]+/g, "_")}`,
    parser_version: "1",
    mime_type: normalizedMime,
    text,
    byte_size: buffer.length,
    content_sha256: sha256(buffer),
  });
}

function lineStartOffsets(text) {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function lineNumberForOffset(offsets, offset) {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(1, high + 1);
}

function markdownHeadingAt(text, lineNumber) {
  const lines = String(text || "").split("\n");
  const stack = [];
  const last = Math.min(lines.length, Math.max(0, lineNumber));
  for (let index = 0; index < last; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;
    const level = match[1].length;
    stack.length = level - 1;
    stack[level - 1] = match[2].trim().slice(0, 180);
  }
  return stack.filter(Boolean).join(" > ").slice(0, 700) || null;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]{2,}/g) || [];
}

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildLocalHashVector(text) {
  const vector = Array(VECTOR_DIMENSIONS).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const hash = hashToken(token);
    const bucket = hash % VECTOR_DIMENSIONS;
    const sign = hash & 0x100 ? -1 : 1;
    vector[bucket] += sign;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function cosineScore(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return 0;
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += Number(left[index] || 0) * Number(right[index] || 0);
  }
  return Number.isFinite(score) ? Math.max(-1, Math.min(1, score)) : 0;
}

function tokenCoverage(query, text) {
  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length) return 0;
  const textTokens = new Set(tokenize(text));
  const matches = queryTokens.filter((token) => textTokens.has(token)).length;
  return matches / queryTokens.length;
}

function chunkDocumentText(text, options = {}) {
  const target = Math.max(
    800,
    Math.min(6000, Number(options.targetCharacters || CHUNK_TARGET_CHARACTERS))
  );
  const overlap = Math.max(
    0,
    Math.min(Math.floor(target / 3), Number(options.overlapCharacters || CHUNK_OVERLAP_CHARACTERS))
  );
  const offsets = lineStartOffsets(text);
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + target);
    if (end < text.length) {
      const windowStart = Math.max(start + Math.floor(target * 0.65), end - 500);
      const window = text.slice(windowStart, end);
      const breakIndex = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf(" "));
      if (breakIndex > 0) end = windowStart + breakIndex + 1;
    }
    if (end <= start) end = Math.min(text.length, start + target);

    const raw = text.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const charStart = start + leading;
    const charEnd = Math.max(charStart, end - trailing);
    const chunkText = text.slice(charStart, charEnd);

    if (chunkText) {
      const lineStart = lineNumberForOffset(offsets, charStart);
      const lineEnd = lineNumberForOffset(offsets, Math.max(charStart, charEnd - 1));
      chunks.push(
        Object.freeze({
          chunk_index: chunks.length,
          heading_path: markdownHeadingAt(text, lineStart),
          line_start: lineStart,
          line_end: lineEnd,
          char_start: charStart,
          char_end: charEnd,
          chunk_text: chunkText,
          chunk_sha256: sha256(Buffer.from(chunkText, "utf8")),
          token_estimate: Math.max(1, Math.ceil(chunkText.length / 4)),
          vector_model_key: VECTOR_MODEL_KEY,
          vector: buildLocalHashVector(chunkText),
        })
      );
    }

    if (end >= text.length) break;
    const next = Math.max(start + 1, end - overlap);
    start = next;
  }

  return Object.freeze(chunks);
}

function schemaMissing(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code);
}

async function ingestKnowledgeDocument({
  sourceId,
  versionId,
  input = {},
  user,
  req,
  connection = null,
} = {}) {
  const source = positiveInteger(sourceId);
  const version = positiveInteger(versionId);
  if (!source || !version) {
    throw new AiDocumentIntelligenceError("A valid knowledge source and version are required.", {
      code: "AI_DOCUMENT_VERSION_INVALID",
    });
  }

  const fileName = clean(input.file_name, 255);
  const mimeType = normalizeMimeType(input.mime_type);
  if (!fileName) {
    throw new AiDocumentIntelligenceError("Document file_name is required.", {
      code: "AI_DOCUMENT_FILE_NAME_REQUIRED",
    });
  }

  const decoded = decodeInputContent(input);
  const parsed = parseSupportedDocument({ mimeType, buffer: decoded.buffer });
  const chunks = chunkDocumentText(parsed.text);
  if (!chunks.length) {
    throw new AiDocumentIntelligenceError("Document chunking produced no usable chunks.", {
      code: "AI_DOCUMENT_CHUNKING_EMPTY",
    });
  }

  const documentKey = normalizeDocumentKey(
    input.document_key,
    fileName,
    parsed.content_sha256
  );
  const ownConnection = !connection;
  const db = connection || (await pool.getConnection());
  try {
    if (ownConnection) await db.beginTransaction();
    const [rows] = await db.query(
      `SELECT s.id AS source_id, s.source_key, s.visibility, s.owner_workspace_code,
              v.id AS version_id, v.version_number, v.version_status
       FROM ai_knowledge_sources s
       JOIN ai_knowledge_versions v ON v.source_id = s.id
       WHERE s.id = ? AND v.id = ?
       LIMIT 1 FOR UPDATE`,
      [source, version]
    );
    const governed = rows[0];
    if (!governed) {
      throw new AiDocumentIntelligenceError("Knowledge version not found.", {
        code: "AI_KNOWLEDGE_VERSION_NOT_FOUND",
        statusCode: 404,
      });
    }
    if (governed.version_status !== "draft") {
      throw new AiDocumentIntelligenceError(
        "Documents may be ingested only into an editable draft version so independent review covers the exact parsed content.",
        { code: "AI_DOCUMENT_VERSION_NOT_DRAFT", statusCode: 409 }
      );
    }

    const [documentResult] = await db.query(
      `INSERT INTO ai_knowledge_documents (
         source_id, version_id, document_key, file_name, mime_type,
         content_sha256, content_bytes, parser_key, parser_version,
         parse_status, extracted_text, extracted_character_count,
         extracted_line_count, chunk_count, raw_binary_stored,
         source_locator, metadata_json, ingested_by, parsed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'parsed', ?, ?, ?, ?, 0, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        governed.source_id,
        governed.version_id,
        documentKey,
        fileName,
        parsed.mime_type,
        parsed.content_sha256,
        parsed.byte_size,
        parsed.parser_key,
        parsed.parser_version,
        parsed.text,
        parsed.text.length,
        lineStartOffsets(parsed.text).length,
        chunks.length,
        clean(input.source_locator, 700),
        JSON.stringify({
          input_source: decoded.source,
          raw_binary_stored: false,
          vector_model_key: VECTOR_MODEL_KEY,
          chunk_target_characters: CHUNK_TARGET_CHARACTERS,
          chunk_overlap_characters: CHUNK_OVERLAP_CHARACTERS,
        }),
        user?.id || null,
      ]
    );
    const documentId = Number(documentResult.insertId);

    for (const chunk of chunks) {
      await db.query(
        `INSERT INTO ai_knowledge_chunks (
           document_id, source_id, version_id, chunk_index, heading_path,
           line_start, line_end, char_start, char_end, chunk_text,
           chunk_sha256, token_estimate, vector_model_key, vector_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          documentId,
          governed.source_id,
          governed.version_id,
          chunk.chunk_index,
          chunk.heading_path,
          chunk.line_start,
          chunk.line_end,
          chunk.char_start,
          chunk.char_end,
          chunk.chunk_text,
          chunk.chunk_sha256,
          chunk.token_estimate,
          chunk.vector_model_key,
          JSON.stringify(chunk.vector),
        ]
      );
    }

    await writeAuditEvent({
      connection: db,
      req,
      action: "AI_KNOWLEDGE_DOCUMENT_INGESTED",
      details: "CHALIN ONE governed knowledge document parsed and chunked",
      entityType: "ai_knowledge_source",
      entityId: governed.source_id,
      metadata: {
        version_id: governed.version_id,
        version_number: governed.version_number,
        document_id: documentId,
        document_key: documentKey,
        file_name: fileName,
        mime_type: parsed.mime_type,
        content_sha256: parsed.content_sha256,
        chunk_count: chunks.length,
        raw_binary_stored: false,
        vector_model_key: VECTOR_MODEL_KEY,
      },
    });

    if (ownConnection) await db.commit();
    return Object.freeze({
      document_id: documentId,
      document_key: documentKey,
      file_name: fileName,
      mime_type: parsed.mime_type,
      content_sha256: parsed.content_sha256,
      extracted_character_count: parsed.text.length,
      extracted_line_count: lineStartOffsets(parsed.text).length,
      chunk_count: chunks.length,
      vector_model_key: VECTOR_MODEL_KEY,
      raw_binary_stored: false,
    });
  } catch (error) {
    if (ownConnection) await db.rollback();
    if (error instanceof AiDocumentIntelligenceError) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw new AiDocumentIntelligenceError(
        "This exact document or document key is already attached to the draft version.",
        { code: "AI_DOCUMENT_DUPLICATE", statusCode: 409 }
      );
    }
    if (schemaMissing(error)) {
      throw new AiDocumentIntelligenceError(
        "The CHALIN ONE document-intelligence schema is not ready in this environment.",
        { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
      );
    }
    throw error;
  } finally {
    if (ownConnection) db.release();
  }
}

async function listKnowledgeDocuments({ sourceId, versionId = null } = {}) {
  const source = positiveInteger(sourceId);
  if (!source) return Object.freeze([]);
  const params = [source];
  let versionFilter = "";
  if (positiveInteger(versionId)) {
    versionFilter = "AND d.version_id = ?";
    params.push(positiveInteger(versionId));
  }
  try {
    const [rows] = await pool.query(
      `SELECT d.id, d.source_id, d.version_id, d.document_key, d.file_name,
              d.mime_type, d.content_sha256, d.content_bytes, d.parser_key,
              d.parser_version, d.parse_status, d.extracted_character_count,
              d.extracted_line_count, d.chunk_count, d.raw_binary_stored,
              d.source_locator, d.parsed_at, d.created_at,
              v.version_number, v.version_status
       FROM ai_knowledge_documents d
       JOIN ai_knowledge_versions v ON v.id = d.version_id
       WHERE d.source_id = ? ${versionFilter}
       ORDER BY v.version_number DESC, d.id DESC`,
      params
    );
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          ...row,
          id: Number(row.id),
          source_id: Number(row.source_id),
          version_id: Number(row.version_id),
          version_number: Number(row.version_number),
          content_bytes: Number(row.content_bytes || 0),
          extracted_character_count: Number(row.extracted_character_count || 0),
          extracted_line_count: Number(row.extracted_line_count || 0),
          chunk_count: Number(row.chunk_count || 0),
          raw_binary_stored: Number(row.raw_binary_stored || 0) === 1,
        })
      )
    );
  } catch (error) {
    if (schemaMissing(error)) return Object.freeze([]);
    throw error;
  }
}

async function getKnowledgeChunk({ sourceId, documentId, chunkId } = {}) {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.document_id, c.source_id, c.version_id, c.chunk_index,
              c.heading_path, c.line_start, c.line_end, c.char_start, c.char_end,
              c.chunk_text, c.chunk_sha256, c.token_estimate, c.vector_model_key,
              d.document_key, d.file_name, d.mime_type, d.source_locator,
              s.source_key, s.title AS source_title, s.visibility,
              s.owner_workspace_code, v.version_number, v.version_status,
              v.published_at
       FROM ai_knowledge_chunks c
       JOIN ai_knowledge_documents d ON d.id = c.document_id
       JOIN ai_knowledge_sources s ON s.id = c.source_id
       JOIN ai_knowledge_versions v ON v.id = c.version_id
       WHERE c.source_id = ? AND c.document_id = ? AND c.id = ?
       LIMIT 1`,
      [positiveInteger(sourceId), positiveInteger(documentId), positiveInteger(chunkId)]
    );
    if (!rows[0]) {
      throw new AiDocumentIntelligenceError("Knowledge document chunk not found.", {
        code: "AI_DOCUMENT_CHUNK_NOT_FOUND",
        statusCode: 404,
      });
    }
    const row = rows[0];
    return Object.freeze({
      ...row,
      id: Number(row.id),
      document_id: Number(row.document_id),
      source_id: Number(row.source_id),
      version_id: Number(row.version_id),
      chunk_index: Number(row.chunk_index),
      line_start: Number(row.line_start || 0) || null,
      line_end: Number(row.line_end || 0) || null,
      char_start: Number(row.char_start || 0),
      char_end: Number(row.char_end || 0),
      token_estimate: Number(row.token_estimate || 0),
      version_number: Number(row.version_number || 0),
    });
  } catch (error) {
    if (error instanceof AiDocumentIntelligenceError) throw error;
    if (schemaMissing(error)) {
      throw new AiDocumentIntelligenceError(
        "The CHALIN ONE document-intelligence schema is not ready in this environment.",
        { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
      );
    }
    throw error;
  }
}

function documentRetrievalVisibility(persona, workspaceCode) {
  const normalizedPersona = normalizeAiPersona(persona);
  if (normalizedPersona === "guide") {
    return { sql: "s.visibility = 'public'", params: [] };
  }
  if (normalizedPersona === "executive") {
    return {
      sql: "s.visibility IN ('public', 'workspace', 'executive')",
      params: [],
    };
  }
  return {
    sql: `(s.visibility = 'public' OR
           (s.visibility = 'workspace' AND s.owner_workspace_code = ?))`,
    params: [clean(workspaceCode, 50)],
  };
}

async function searchPublishedDocumentChunks({
  query,
  persona,
  workspaceCode = null,
  limit = 8,
} = {}) {
  const term = clean(query, 500);
  const normalizedPersona = normalizeAiPersona(persona);
  if (!term || !normalizedPersona) return Object.freeze([]);
  const visibility = documentRetrievalVisibility(normalizedPersona, workspaceCode);
  const safeLimit = Math.max(1, Math.min(20, positiveInteger(limit) || 8));
  const queryVector = buildLocalHashVector(term);

  try {
    const [rows] = await pool.query(
      `SELECT c.id AS chunk_id, c.chunk_index, c.heading_path,
              c.line_start, c.line_end, c.chunk_text, c.chunk_sha256,
              c.vector_model_key, c.vector_json,
              d.id AS document_id, d.document_key, d.file_name, d.mime_type,
              d.source_locator, s.source_key, s.source_type,
              s.owner_workspace_code, s.visibility,
              s.title AS source_title, s.source_reference,
              v.id AS version_id, v.version_number, v.title,
              v.checksum_sha256 AS version_checksum, v.published_at
       FROM ai_knowledge_chunks c
       JOIN ai_knowledge_documents d ON d.id = c.document_id
       JOIN ai_knowledge_sources s ON s.id = c.source_id
       JOIN ai_knowledge_versions v ON v.id = c.version_id
       WHERE d.parse_status = 'parsed'
         AND d.raw_binary_stored = 0
         AND s.source_status = 'active'
         AND v.version_status = 'published'
         AND ${visibility.sql}
         AND COALESCE(v.effective_from, s.effective_from, UTC_TIMESTAMP()) <= UTC_TIMESTAMP()
         AND (COALESCE(v.expires_at, s.expires_at) IS NULL OR
              COALESCE(v.expires_at, s.expires_at) > UTC_TIMESTAMP())
       ORDER BY v.published_at DESC, c.id DESC
       LIMIT 1000`,
      visibility.params
    );

    const ranked = rows
      .map((row) => {
        let vector = [];
        try {
          vector = Array.isArray(row.vector_json)
            ? row.vector_json
            : JSON.parse(row.vector_json || "[]");
        } catch {
          vector = [];
        }
        const cosine = Math.max(0, cosineScore(queryVector, vector));
        const coverage = tokenCoverage(
          term,
          `${row.title || ""} ${row.source_title || ""} ${row.file_name || ""} ${
            row.heading_path || ""
          } ${row.chunk_text || ""}`
        );
        const score = cosine * 0.72 + coverage * 0.28;
        return { row, score };
      })
      .filter((item) => item.score >= 0.05)
      .sort((left, right) => right.score - left.score)
      .slice(0, safeLimit);

    return normalizeEvidenceList(
      ranked.map(({ row, score }) => ({
        source_type: `knowledge_document.${row.source_type}`,
        source_ref: `${row.source_key}#${row.document_key}:chunk:${row.chunk_index}`,
        source_version: String(row.version_number),
        label: `${row.title || row.source_title} · ${row.file_name}${
          row.line_start ? ` · lines ${row.line_start}-${row.line_end || row.line_start}` : ""
        }`,
        excerpt_text: String(row.chunk_text || "").slice(0, 1200),
        as_of_at: row.published_at,
        classification: row.visibility === "public" ? "public" : "internal",
        workspace_code: row.owner_workspace_code,
        metadata: {
          checksum_sha256: row.version_checksum,
          chunk_sha256: row.chunk_sha256,
          source_reference: row.source_reference,
          source_locator: row.source_locator,
          visibility: row.visibility,
          document_id: Number(row.document_id),
          document_key: row.document_key,
          file_name: row.file_name,
          mime_type: row.mime_type,
          chunk_id: Number(row.chunk_id),
          chunk_index: Number(row.chunk_index),
          heading_path: row.heading_path,
          line_start: Number(row.line_start || 0) || null,
          line_end: Number(row.line_end || 0) || null,
          retrieval_model: VECTOR_MODEL_KEY,
          retrieval_score: Number(score.toFixed(6)),
          citation_deep_link: `/api/ai/knowledge/${row.source_key}/documents/${row.document_id}/chunks/${row.chunk_id}`,
          execution_authority: "read_only",
        },
      }))
    );
  } catch (error) {
    if (schemaMissing(error)) return Object.freeze([]);
    throw error;
  }
}

module.exports = {
  AiDocumentIntelligenceError,
  CHUNK_OVERLAP_CHARACTERS,
  CHUNK_TARGET_CHARACTERS,
  MAX_DOCUMENT_BYTES,
  SUPPORTED_MIME_TYPES,
  VECTOR_DIMENSIONS,
  VECTOR_MODEL_KEY,
  buildLocalHashVector,
  chunkDocumentText,
  cosineScore,
  decodeInputContent,
  documentRetrievalVisibility,
  getKnowledgeChunk,
  ingestKnowledgeDocument,
  lineNumberForOffset,
  lineStartOffsets,
  listKnowledgeDocuments,
  normalizeDocumentKey,
  normalizeMimeType,
  parseSupportedDocument,
  searchPublishedDocumentChunks,
  sha256,
  stripHtml,
  tokenCoverage,
  tokenize,
};
