"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  AiDocumentIntelligenceError,
  MAX_DOCUMENT_BYTES,
  SUPPORTED_MIME_TYPES,
  VECTOR_DIMENSIONS,
  VECTOR_MODEL_KEY,
  buildLocalHashVector,
  chunkDocumentText,
  cosineScore,
  normalizeDocumentKey,
  parseSupportedDocument,
  tokenCoverage,
} = require("../services/aiDocumentIntelligenceService");

const repoRoot = path.resolve(__dirname, "../..");
const migration = fs.readFileSync(
  path.join(
    repoRoot,
    "database/migrations/20260807_chalin_one_document_intelligence.sql"
  ),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/aiKnowledgeRoutes.js"),
  "utf8"
);
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/aiDocumentIntelligenceService.js"),
  "utf8"
);
const foundationToolSource = fs.readFileSync(
  path.join(repoRoot, "backend/ai-tools/foundationTools.js"),
  "utf8"
);

test("approved built-in parser types stay explicit and binary parsers remain disabled", () => {
  assert.deepEqual(SUPPORTED_MIME_TYPES, [
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/html",
    "application/json",
    "application/xml",
    "text/xml",
  ]);
  assert.equal(MAX_DOCUMENT_BYTES, 2 * 1024 * 1024);
  assert.throws(
    () =>
      parseSupportedDocument({
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7 fake"),
      }),
    (error) =>
      error instanceof AiDocumentIntelligenceError &&
      error.code === "AI_DOCUMENT_PARSER_NOT_AVAILABLE" &&
      error.statusCode === 415
  );
});

test("HTML and JSON parsers return clean governed text", () => {
  const html = parseSupportedDocument({
    mimeType: "text/html; charset=utf-8",
    buffer: Buffer.from(
      "<h1>Safety</h1><p>Inspect equipment &amp; record faults.</p><script>secret()</script>"
    ),
  });
  assert.match(html.text, /Safety/);
  assert.match(html.text, /Inspect equipment & record faults/);
  assert.doesNotMatch(html.text, /secret\(\)/);

  const json = parseSupportedDocument({
    mimeType: "application/json",
    buffer: Buffer.from('{"policy":"approved","count":2}'),
  });
  assert.match(json.text, /"policy": "approved"/);
  assert.match(json.text, /"count": 2/);
});

test("deterministic chunker creates precise locators and overlap", () => {
  const text = [
    "# Equipment Release",
    "The approved inspection must be completed before release.",
    ...Array.from(
      { length: 120 },
      (_, index) => `Line ${index + 3}: verified operational procedure and control evidence.`
    ),
  ].join("\n");
  const chunks = chunkDocumentText(text, {
    targetCharacters: 900,
    overlapCharacters: 120,
  });
  assert.equal(chunks.length > 2, true);
  assert.equal(chunks[0].chunk_index, 0);
  assert.equal(chunks[0].line_start, 1);
  assert.equal(chunks[0].heading_path, "Equipment Release");
  assert.equal(chunks.every((chunk) => chunk.line_end >= chunk.line_start), true);
  assert.equal(chunks.every((chunk) => chunk.char_end > chunk.char_start), true);
  assert.equal(
    chunks.slice(1).every((chunk, index) => chunk.char_start < chunks[index].char_end),
    true
  );
  assert.equal(chunks.every((chunk) => chunk.vector.length === VECTOR_DIMENSIONS), true);
  assert.equal(chunks.every((chunk) => chunk.vector_model_key === VECTOR_MODEL_KEY), true);
});

test("local hash vectors are deterministic and query coverage remains transparent", () => {
  const text = "approved hire inspection before equipment release";
  const same = buildLocalHashVector(text);
  const again = buildLocalHashVector(text);
  const unrelated = buildLocalHashVector("supplier invoice accounting reconciliation");
  assert.deepEqual(same, again);
  assert.equal(same.length, VECTOR_DIMENSIONS);
  assert.equal(cosineScore(same, again) > 0.99, true);
  assert.equal(cosineScore(same, unrelated) < 0.99, true);
  assert.equal(tokenCoverage("hire inspection", text), 1);
  assert.equal(tokenCoverage("hire warranty", text), 0.5);
});

test("document keys are stable and do not expose full checksums", () => {
  const checksum = "a".repeat(64);
  assert.equal(
    normalizeDocumentKey("", "Hire Release Policy.md", checksum),
    "hire_release_policy_aaaaaaaaaaaa"
  );
  assert.equal(normalizeDocumentKey("Board Policy v2", "ignored.txt", checksum), "board_policy_v2");
});

test("document schema is additive, version-bound and forbids raw binary storage", () => {
  assert.match(migration, /ADDITIVE MIGRATION ONLY/i);
  assert.match(migration, /BACKUP REQUIRED/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_knowledge_documents/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_knowledge_chunks/);
  assert.match(migration, /FOREIGN KEY \(version_id\) REFERENCES ai_knowledge_versions\(id\) ON DELETE CASCADE/);
  assert.match(migration, /CHECK \(raw_binary_stored = 0\)/);
  assert.match(migration, /20260807_chalin_one_document_intelligence/);
  assert.doesNotMatch(
    migration,
    /\b(password|password_hash|api_key|access_token|refresh_token|db_password)\b/i
  );
});

test("ingestion route requires knowledge management permission and exposes read-only chunk citations", () => {
  assert.match(
    routeSource,
    /\/:sourceId\/versions\/:versionId\/documents[\s\S]*requireAiPermission\("ai\.knowledge\.manage"\)/
  );
  assert.match(
    routeSource,
    /\/:sourceReference\/documents\/:documentId\/chunks\/:chunkId[\s\S]*requireAiPermission\("ai\.knowledge\.view"\)/
  );
  assert.match(routeSource, /resolveScopedKnowledgeDetails/);
});

test("document ingestion performs no external fetch, child process or raw-file write", () => {
  assert.doesNotMatch(serviceSource, /require\(["'](?:axios|node-fetch|child_process|fs)["']\)/);
  assert.doesNotMatch(serviceSource, /\bfetch\s*\(/);
  assert.doesNotMatch(serviceSource, /writeFile|createWriteStream|execFile|spawn\s*\(/);
  assert.match(serviceSource, /raw_binary_stored[^\n]*0/);
  assert.match(serviceSource, /version_status !== "draft"/);
  assert.match(serviceSource, /vector_model_key/);
  assert.match(serviceSource, /citation_deep_link/);
});

test("knowledge search tool uses hybrid governed retrieval", () => {
  assert.match(foundationToolSource, /searchGovernedKnowledge/);
  assert.match(foundationToolSource, /key: "knowledge\.search"/);
  assert.match(foundationToolSource, /version: "2"/);
  assert.match(foundationToolSource, /published_governed_knowledge_only/);
});
