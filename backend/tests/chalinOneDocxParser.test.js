"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("@excel.js/jszip");

const {
  AiDocxParserError,
  DOCX_MIME_TYPE,
  MAX_ARCHIVE_ENTRIES,
  MAX_EXPANDED_XML_BYTES,
  parseDocxBuffer,
  wordXmlToText,
} = require("../services/aiDocxParserService");
const {
  decodeStrictBase64,
} = require("../services/aiBinaryDocumentIngestionService");

async function makeDocx({
  paragraphs = ["Approved equipment inspection is required before release."],
  macro = false,
  activeX = false,
  embeddedObject = false,
  extraEntries = 0,
} = {}) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
  );
  const body = paragraphs
    .map(
      (paragraph) =>
        `<w:p><w:r><w:t>${String(paragraph)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</w:t></w:r></w:p>`
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  if (macro) zip.file("word/vbaProject.bin", Buffer.from("macro"));
  if (activeX) zip.file("word/activeX/activeX1.bin", Buffer.from("activex"));
  if (embeddedObject) zip.file("word/embeddings/oleObject1.bin", Buffer.from("ole"));
  for (let index = 0; index < extraEntries; index += 1) {
    zip.file(`customXml/item${index}.xml`, "<item />");
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

test("DOCX MIME is explicit and the locked Excel ZIP dependency is installed", () => {
  assert.equal(
    DOCX_MIME_TYPE,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  const lock = fs.readFileSync(
    path.resolve(__dirname, "../package-lock.json"),
    "utf8"
  );
  assert.match(lock, /node_modules\/@excel\.js\/jszip/);
});

test("Word XML text extraction decodes entities and preserves paragraph boundaries", () => {
  const text = wordXmlToText(
    '<w:p><w:r><w:t>Cash &amp; Control</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p>'
  );
  assert.match(text, /Cash & Control/);
  assert.match(text, /Second line/);
  assert.match(text, /\n/);
});

test("DOCX parser extracts text in memory without external files, images or OCR", async () => {
  const buffer = await makeDocx({
    paragraphs: [
      "Approved equipment inspection is required before release.",
      "If a critical defect is open, release must stop.",
    ],
  });
  const parsed = await parseDocxBuffer(buffer);
  assert.equal(parsed.mime_type, DOCX_MIME_TYPE);
  assert.equal(parsed.parser_key, "builtin_docx_xml");
  assert.match(parsed.text, /inspection is required before release/);
  assert.match(parsed.text, /critical defect is open/);
  assert.equal(parsed.external_file_access, false);
  assert.equal(parsed.images_extracted, false);
  assert.equal(parsed.ocr_used, false);
  assert.equal(parsed.active_content_present, false);
  assert.equal(parsed.byte_size, buffer.length);
  assert.equal(parsed.actual_expanded_xml_bytes <= MAX_EXPANDED_XML_BYTES, true);
});

for (const [label, options] of [
  ["macro", { macro: true }],
  ["ActiveX", { activeX: true }],
  ["embedded object", { embeddedObject: true }],
]) {
  test(`DOCX parser blocks ${label} content`, async () => {
    const buffer = await makeDocx(options);
    await assert.rejects(
      () => parseDocxBuffer(buffer),
      (error) =>
        error instanceof AiDocxParserError &&
        error.code === "AI_DOCX_ACTIVE_CONTENT_BLOCKED"
    );
  });
}

test("DOCX parser rejects pathological archive entry counts", async () => {
  const buffer = await makeDocx({ extraEntries: MAX_ARCHIVE_ENTRIES + 1 });
  await assert.rejects(
    () => parseDocxBuffer(buffer),
    (error) =>
      error instanceof AiDocxParserError &&
      error.code === "AI_DOCX_ARCHIVE_ENTRY_LIMIT_EXCEEDED"
  );
});

test("binary ingestion requires strict base64", () => {
  assert.throws(
    () => decodeStrictBase64("%%%not-base64%%%"),
    (error) => error.code === "AI_DOCUMENT_BASE64_INVALID"
  );
  const decoded = decodeStrictBase64(Buffer.from("docx").toString("base64"));
  assert.equal(decoded.toString("utf8"), "docx");
});
