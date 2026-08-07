"use strict";

const { pool } = require("../config/db");

class AiDocumentReviewError extends Error {
  constructor(message, { code = "AI_DOCUMENT_REVIEW_ERROR", statusCode = 400 } = {}) {
    super(message);
    this.name = "AiDocumentReviewError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function schemaMissing(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code);
}

async function listDocumentChunks({ sourceId, documentId } = {}) {
  const source = positiveInteger(sourceId);
  const document = positiveInteger(documentId);
  if (!source || !document) {
    throw new AiDocumentReviewError("A valid source and document are required.", {
      code: "AI_DOCUMENT_REVIEW_REFERENCE_INVALID",
    });
  }

  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.document_id, c.source_id, c.version_id,
              c.chunk_index, c.heading_path, c.line_start, c.line_end,
              c.char_start, c.char_end, c.chunk_text, c.chunk_sha256,
              c.token_estimate, c.vector_model_key,
              d.document_key, d.file_name, d.mime_type, d.parse_status,
              v.version_number, v.version_status
       FROM ai_knowledge_chunks c
       JOIN ai_knowledge_documents d ON d.id = c.document_id
       JOIN ai_knowledge_versions v ON v.id = c.version_id
       WHERE c.source_id = ? AND c.document_id = ?
       ORDER BY c.chunk_index ASC, c.id ASC`,
      [source, document]
    );
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          ...row,
          id: Number(row.id),
          document_id: Number(row.document_id),
          source_id: Number(row.source_id),
          version_id: Number(row.version_id),
          version_number: Number(row.version_number),
          chunk_index: Number(row.chunk_index),
          line_start: Number(row.line_start || 0) || null,
          line_end: Number(row.line_end || 0) || null,
          char_start: Number(row.char_start || 0),
          char_end: Number(row.char_end || 0),
          token_estimate: Number(row.token_estimate || 0),
        })
      )
    );
  } catch (error) {
    if (schemaMissing(error)) {
      throw new AiDocumentReviewError(
        "The CHALIN ONE document-intelligence schema is not ready in this environment.",
        { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
      );
    }
    throw error;
  }
}

module.exports = {
  AiDocumentReviewError,
  listDocumentChunks,
};
