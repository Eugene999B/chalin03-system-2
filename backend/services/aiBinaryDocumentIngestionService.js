"use strict";

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");
const {
  CHUNK_OVERLAP_CHARACTERS,
  CHUNK_TARGET_CHARACTERS,
  VECTOR_MODEL_KEY,
  chunkDocumentText,
  lineStartOffsets,
  normalizeDocumentKey,
  sha256,
} = require("./aiDocumentIntelligenceService");
const {
  AiDocxParserError,
  DOCX_MIME_TYPE,
  parseDocxBuffer,
} = require("./aiDocxParserService");

class AiBinaryDocumentIngestionError extends Error {
  constructor(
    message,
    { code = "AI_BINARY_DOCUMENT_INGESTION_ERROR", statusCode = 400, details = [] } = {}
  ) {
    super(message);
    this.name = "AiBinaryDocumentIngestionError";
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

function decodeStrictBase64(value) {
  const encoded = String(value || "").replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new AiBinaryDocumentIngestionError(
      "Binary document ingestion requires valid content_base64.",
      { code: "AI_DOCUMENT_BASE64_INVALID" }
    );
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) {
    throw new AiBinaryDocumentIngestionError("The binary document is empty.", {
      code: "AI_DOCUMENT_EMPTY",
    });
  }
  return buffer;
}

function schemaMissing(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code);
}

async function ingestDocxKnowledgeDocument({
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
    throw new AiBinaryDocumentIngestionError(
      "A valid knowledge source and version are required.",
      { code: "AI_DOCUMENT_VERSION_INVALID" }
    );
  }

  const fileName = clean(input.file_name, 255);
  if (!fileName) {
    throw new AiBinaryDocumentIngestionError("Document file_name is required.", {
      code: "AI_DOCUMENT_FILE_NAME_REQUIRED",
    });
  }
  const mimeType = String(input.mime_type || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mimeType !== DOCX_MIME_TYPE) {
    throw new AiBinaryDocumentIngestionError(
      "This binary adapter accepts DOCX only.",
      { code: "AI_DOCUMENT_PARSER_NOT_AVAILABLE", statusCode: 415 }
    );
  }

  const binary = decodeStrictBase64(input.content_base64);
  let parsed;
  try {
    parsed = await parseDocxBuffer(binary);
  } catch (error) {
    if (error instanceof AiDocxParserError) throw error;
    throw new AiBinaryDocumentIngestionError(
      "DOCX parsing failed safely.",
      {
        code: "AI_DOCX_PARSE_ERROR",
        statusCode: 415,
        details: [String(error?.message || "DOCX parse failure").slice(0, 240)],
      }
    );
  }

  const contentSha256 = sha256(binary);
  const chunks = chunkDocumentText(parsed.text);
  if (!chunks.length) {
    throw new AiBinaryDocumentIngestionError(
      "DOCX chunking produced no usable chunks.",
      { code: "AI_DOCUMENT_CHUNKING_EMPTY" }
    );
  }
  const documentKey = normalizeDocumentKey(
    input.document_key,
    fileName,
    contentSha256
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
      throw new AiBinaryDocumentIngestionError("Knowledge version not found.", {
        code: "AI_KNOWLEDGE_VERSION_NOT_FOUND",
        statusCode: 404,
      });
    }
    if (governed.version_status !== "draft") {
      throw new AiBinaryDocumentIngestionError(
        "DOCX documents may be ingested only into an editable draft version so independent review covers the exact extracted text.",
        { code: "AI_DOCUMENT_VERSION_NOT_DRAFT", statusCode: 409 }
      );
    }

    const lineCount = lineStartOffsets(parsed.text).length;
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
        DOCX_MIME_TYPE,
        contentSha256,
        binary.length,
        parsed.parser_key,
        parsed.parser_version,
        parsed.text,
        parsed.text.length,
        lineCount,
        chunks.length,
        clean(input.source_locator, 700),
        JSON.stringify({
          input_source: "content_base64",
          raw_binary_stored: false,
          vector_model_key: VECTOR_MODEL_KEY,
          chunk_target_characters: CHUNK_TARGET_CHARACTERS,
          chunk_overlap_characters: CHUNK_OVERLAP_CHARACTERS,
          archive_entry_count: parsed.archive_entry_count,
          parsed_part_count: parsed.parsed_part_count,
          declared_expanded_xml_bytes: parsed.declared_expanded_xml_bytes,
          actual_expanded_xml_bytes: parsed.actual_expanded_xml_bytes,
          active_content_present: false,
          external_file_access: false,
          images_extracted: false,
          ocr_used: false,
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
      action: "AI_KNOWLEDGE_DOCX_INGESTED",
      details: "CHALIN ONE governed DOCX document parsed in memory and chunked",
      entityType: "ai_knowledge_source",
      entityId: governed.source_id,
      metadata: {
        version_id: governed.version_id,
        version_number: governed.version_number,
        document_id: documentId,
        document_key: documentKey,
        file_name: fileName,
        mime_type: DOCX_MIME_TYPE,
        content_sha256: contentSha256,
        parser_key: parsed.parser_key,
        chunk_count: chunks.length,
        raw_binary_stored: false,
        external_file_access: false,
        active_content_present: false,
        ocr_used: false,
        vector_model_key: VECTOR_MODEL_KEY,
      },
    });

    if (ownConnection) await db.commit();
    return Object.freeze({
      document_id: documentId,
      document_key: documentKey,
      file_name: fileName,
      mime_type: DOCX_MIME_TYPE,
      parser_key: parsed.parser_key,
      content_sha256: contentSha256,
      content_bytes: binary.length,
      extracted_character_count: parsed.text.length,
      extracted_line_count: lineCount,
      chunk_count: chunks.length,
      vector_model_key: VECTOR_MODEL_KEY,
      raw_binary_stored: false,
      external_file_access: false,
      active_content_present: false,
      ocr_used: false,
    });
  } catch (error) {
    if (ownConnection) await db.rollback();
    if (
      error instanceof AiBinaryDocumentIngestionError ||
      error instanceof AiDocxParserError
    ) {
      throw error;
    }
    if (error?.code === "ER_DUP_ENTRY") {
      throw new AiBinaryDocumentIngestionError(
        "This exact DOCX or document key is already attached to the draft version.",
        { code: "AI_DOCUMENT_DUPLICATE", statusCode: 409 }
      );
    }
    if (schemaMissing(error)) {
      throw new AiBinaryDocumentIngestionError(
        "The CHALIN ONE document-intelligence schema is not ready in this environment.",
        { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
      );
    }
    throw error;
  } finally {
    if (ownConnection) db.release();
  }
}

module.exports = {
  AiBinaryDocumentIngestionError,
  decodeStrictBase64,
  ingestDocxKnowledgeDocument,
};