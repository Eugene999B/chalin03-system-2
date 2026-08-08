import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const entry = fs.readFileSync(
  path.join(repoRoot, "frontend/src/chalin-one/ChalinOneStandaloneEntry.jsx"),
  "utf8"
);
const page = fs.readFileSync(
  path.join(repoRoot, "frontend/src/chalin-one/ai/DocumentIntelligencePage.jsx"),
  "utf8"
);
const workspace = fs.readFileSync(
  path.join(repoRoot, "frontend/src/chalin-one/ai/ChalinIntelligenceWorkspace.jsx"),
  "utf8"
);
const launcher = fs.readFileSync(
  path.join(repoRoot, "frontend/src/chalin-one/ai/DocumentIntelligenceLauncher.jsx"),
  "utf8"
);
const api = fs.readFileSync(
  path.join(repoRoot, "frontend/src/chalin-one/ai/aiApi.js"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(repoRoot, "frontend/src/chalin-one/ai/documentIntelligence.css"),
  "utf8"
);

assert.match(entry, /DocumentIntelligencePage/);
assert.match(entry, /DocumentIntelligenceLauncher/);
assert.match(entry, /\/intelligence\/documents/);
assert.match(page, /ai\.knowledge\.view/);
assert.match(page, /ai\.knowledge\.manage/);
assert.match(page, /version_status === "draft"/);
assert.match(page, /TXT, Markdown, CSV, JSON, HTML and XML/);
assert.match(page, /PDF, DOCX, images and OCR remain disabled/);
assert.match(page, /MAX_BYTES = 2 \* 1024 \* 1024/);
assert.match(page, /Raw binary storage: disabled/);
assert.match(page, /listAiKnowledgeDocumentChunks/);
assert.match(page, /lines \{chunk\.line_start/);
assert.match(page, /vector_model_key/);
assert.match(page, /useSearchParams/);
assert.match(page, /searchParams\.get\("source"\)/);
assert.match(page, /searchParams\.get\("document"\)/);
assert.match(page, /searchParams\.get\("chunk"\)/);
assert.match(page, /knowledge-chunk-\$\{chunk\.id\}/);
assert.match(page, /is-citation-target/);
assert.match(page, /scrollIntoView/);
assert.match(page, /target\.focus/);
assert.match(workspace, /function documentEvidenceLink/);
assert.match(workspace, /new URLSearchParams/);
assert.match(workspace, /source: sourceKey/);
assert.match(workspace, /document: String\(documentId\)/);
assert.match(workspace, /chunk: String\(chunkId\)/);
assert.match(workspace, /\/intelligence\/documents\?\$\{params\.toString\(\)\}/);
assert.match(workspace, /Open exact governed chunk/);
assert.match(launcher, /permissions\.has\("ai\.knowledge\.view"\)/);
assert.match(api, /ingestAiKnowledgeDocument/);
assert.match(api, /listAiKnowledgeDocuments/);
assert.match(api, /listAiKnowledgeDocumentChunks/);
assert.match(api, /getAiKnowledgeChunk/);
assert.match(api, /versions\/\$\{encodeURIComponent\(versionId\)\}\/documents/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /@media \(max-width: 420px\)/);
assert.match(css, /prefers-reduced-motion/);

console.log("CHALIN ONE Document Intelligence source contract passed.");
