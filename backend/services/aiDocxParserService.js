"use strict";

const JSZip = require("@excel.js/jszip");

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_PARSER_KEY = "builtin_docx_xml";
const DOCX_PARSER_VERSION = "1";
const MAX_DOCX_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_EXPANDED_XML_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_PARTS = 40;
const TEXT_PART_PATTERN =
  /^word\/(?:document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/i;
const FORBIDDEN_ACTIVE_CONTENT_PATTERN =
  /^(?:word\/vbaProject\.bin|word\/activeX\/|word\/embeddings\/)/i;

class AiDocxParserError extends Error {
  constructor(
    message,
    { code = "AI_DOCX_PARSE_ERROR", statusCode = 400, details = [] } = {}
  ) {
    super(message);
    this.name = "AiDocxParserError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function wordXmlToText(xml) {
  const source = String(xml || "")
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/w:tc\s*>/gi, "\t")
    .replace(/<\/w:tr\s*>/gi, "\n")
    .replace(/<\/w:p\s*>/gi, "\n");

  const textRuns = [];
  const pattern = /<w:(?:t|instrText)\b[^>]*>([\s\S]*?)<\/w:(?:t|instrText)>/gi;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(source))) {
    const between = source.slice(lastIndex, match.index);
    if (between.includes("\n")) textRuns.push("\n");
    else if (between.includes("\t")) textRuns.push("\t");
    textRuns.push(decodeXmlEntities(match[1]));
    lastIndex = pattern.lastIndex;
  }
  const tail = source.slice(lastIndex);
  if (tail.includes("\n")) textRuns.push("\n");

  return textRuns
    .join("")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/[\t ]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function declaredUncompressedSize(entry) {
  const value = Number(entry?._data?.uncompressedSize);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function orderedTextPartNames(zip) {
  const names = Object.keys(zip.files || {})
    .filter((name) => TEXT_PART_PATTERN.test(name) && !zip.files[name]?.dir)
    .sort((left, right) => {
      if (left.toLowerCase() === "word/document.xml") return -1;
      if (right.toLowerCase() === "word/document.xml") return 1;
      return left.localeCompare(right);
    });
  if (!names.some((name) => name.toLowerCase() === "word/document.xml")) {
    throw new AiDocxParserError(
      "The DOCX archive does not contain word/document.xml.",
      { code: "AI_DOCX_DOCUMENT_XML_MISSING", statusCode: 415 }
    );
  }
  if (names.length > MAX_TEXT_PARTS) {
    throw new AiDocxParserError("The DOCX contains too many text-bearing parts.", {
      code: "AI_DOCX_PART_LIMIT_EXCEEDED",
      statusCode: 413,
    });
  }
  return names;
}

function assertArchiveSafety(zip) {
  const entries = Object.values(zip.files || {});
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new AiDocxParserError("The DOCX archive contains too many entries.", {
      code: "AI_DOCX_ARCHIVE_ENTRY_LIMIT_EXCEEDED",
      statusCode: 413,
    });
  }
  const forbidden = Object.keys(zip.files || {}).filter((name) =>
    FORBIDDEN_ACTIVE_CONTENT_PATTERN.test(name)
  );
  if (forbidden.length > 0) {
    throw new AiDocxParserError(
      "Macro, ActiveX and embedded-object DOCX content is not accepted for AI knowledge ingestion.",
      {
        code: "AI_DOCX_ACTIVE_CONTENT_BLOCKED",
        statusCode: 415,
        details: forbidden.slice(0, 20),
      }
    );
  }

  const names = orderedTextPartNames(zip);
  let declaredBytes = 0;
  for (const name of names) {
    const size = declaredUncompressedSize(zip.files[name]);
    if (size === null) {
      throw new AiDocxParserError(
        "The DOCX archive did not expose safe uncompressed-size metadata.",
        { code: "AI_DOCX_SIZE_METADATA_REQUIRED", statusCode: 415 }
      );
    }
    declaredBytes += size;
    if (declaredBytes > MAX_EXPANDED_XML_BYTES) {
      throw new AiDocxParserError(
        "The DOCX expanded XML exceeds the governed parser limit.",
        { code: "AI_DOCX_EXPANDED_SIZE_LIMIT", statusCode: 413 }
      );
    }
  }
  return Object.freeze({ names, declaredBytes });
}

async function parseDocxBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AiDocxParserError("The DOCX document is empty.", {
      code: "AI_DOCUMENT_EMPTY",
    });
  }
  if (buffer.length > MAX_DOCX_BYTES) {
    throw new AiDocxParserError(
      `DOCX content exceeds the ${MAX_DOCX_BYTES} byte ingestion limit.`,
      { code: "AI_DOCUMENT_TOO_LARGE", statusCode: 413 }
    );
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  } catch (error) {
    throw new AiDocxParserError("The DOCX ZIP container is invalid or corrupted.", {
      code: "AI_DOCX_ARCHIVE_INVALID",
      statusCode: 415,
      details: [String(error?.message || "ZIP parsing failed").slice(0, 240)],
    });
  }

  const safety = assertArchiveSafety(zip);
  const parts = [];
  let actualXmlBytes = 0;
  for (const name of safety.names) {
    const xml = await zip.files[name].async("string");
    actualXmlBytes += Buffer.byteLength(xml, "utf8");
    if (actualXmlBytes > MAX_EXPANDED_XML_BYTES) {
      throw new AiDocxParserError(
        "The DOCX expanded XML exceeds the governed parser limit.",
        { code: "AI_DOCX_EXPANDED_SIZE_LIMIT", statusCode: 413 }
      );
    }
    const extracted = wordXmlToText(xml);
    if (extracted) parts.push(extracted);
  }

  const text = parts.join("\n\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (!text) {
    throw new AiDocxParserError(
      "The DOCX parser did not extract usable text. Scanned/image-only documents require the separately governed OCR pipeline.",
      { code: "AI_DOCUMENT_NO_TEXT", statusCode: 415 }
    );
  }

  return Object.freeze({
    parser_key: DOCX_PARSER_KEY,
    parser_version: DOCX_PARSER_VERSION,
    mime_type: DOCX_MIME_TYPE,
    text,
    byte_size: buffer.length,
    archive_entry_count: Object.keys(zip.files || {}).length,
    parsed_part_count: safety.names.length,
    declared_expanded_xml_bytes: safety.declaredBytes,
    actual_expanded_xml_bytes: actualXmlBytes,
    active_content_present: false,
    external_file_access: false,
    images_extracted: false,
    ocr_used: false,
  });
}

module.exports = {
  AiDocxParserError,
  DOCX_MIME_TYPE,
  DOCX_PARSER_KEY,
  DOCX_PARSER_VERSION,
  FORBIDDEN_ACTIVE_CONTENT_PATTERN,
  MAX_ARCHIVE_ENTRIES,
  MAX_DOCX_BYTES,
  MAX_EXPANDED_XML_BYTES,
  MAX_TEXT_PARTS,
  TEXT_PART_PATTERN,
  assertArchiveSafety,
  declaredUncompressedSize,
  decodeXmlEntities,
  orderedTextPartNames,
  parseDocxBuffer,
  wordXmlToText,
};