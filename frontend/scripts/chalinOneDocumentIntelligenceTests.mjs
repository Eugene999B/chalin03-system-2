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
const documentClient = fs.readFileSync(
  path.join(repoRoot, "frontend/src/chalin-one/ai/aiDocumentClient.js"),
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
assert.match(page, /TXT, Markdown, CSV, JSON, HTML, XML and hardened DOCX text extraction are enabled/);
assert.match(page, /PDF, images and OCR remain disabled/);
assert.match(page, /DOCX_MIME/);
assert.match(page, /\.docx/);
assert.match(page, /fileToBase64/);
assert.match(page, /file\.arrayBuffer\(\)/);
assert.match(page, /payload\.content_base64/);
assert.match(page, /macros, ActiveX, embedded objects, external files and images are not accepted/);
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

// Natural chat now uses the already-governed Document Studio output instead of
// making the user find a separate export control. Incomplete requests are left
// to the server clarification turn; only a completed answer is exported.
assert.match(documentClient, /AI_DOCUMENT_FORMATS = Object\.freeze\(\["pdf", "xlsx", "csv", "docx"\]\)/);
assert.match(documentClient, /requestedAiDocumentFormat/);
assert.match(documentClient, /generateAndDownloadAiDocument/);
assert.match(api, /requestedAiDocumentFormat\(message\)/);
assert.match(api, /generateAndDownloadAiDocument\(\{/);
assert.match(api, /result\?\.reasoning\?\.intent !== "clarification"/);
assert.match(api, /result\?\.provider\?\.finish_reason !== "clarification"/);
assert.match(api, /status:\s*"downloaded"/);
assert.match(api, /status:\s*"failed"/);
assert.ok(
  api.indexOf("const result = unwrap(response) || null;") <
    api.indexOf("await generateAndDownloadAiDocument({"),
  "document generation must use the saved assistant answer, never run before the chat result exists"
);

assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /@media \(max-width: 420px\)/);
assert.match(css, /prefers-reduced-motion/);

console.log("CHALIN ONE Document Intelligence + natural chat export source contract passed.");
