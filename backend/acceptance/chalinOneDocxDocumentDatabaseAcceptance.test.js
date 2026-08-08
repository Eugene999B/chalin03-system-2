"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("@excel.js/jszip");

const { pool } = require("../config/db");
const {
  RELEASE_CONFIRMATION,
  runChalinOneDocumentIntelligenceMigration,
} = require("../scripts/runChalinOneDocumentIntelligenceMigration");
const {
  createKnowledgeSourceDraft,
  decideKnowledgeApproval,
  publishKnowledgeVersion,
  submitKnowledgeVersion,
} = require("../services/aiKnowledgeService");
const {
  ingestDocxKnowledgeDocument,
} = require("../services/aiBinaryDocumentIngestionService");
const {
  DOCX_MIME_TYPE,
} = require("../services/aiDocxParserService");
const {
  listKnowledgeDocuments,
  searchPublishedDocumentChunks,
} = require("../services/aiDocumentIntelligenceService");

const author = Object.freeze({ id: 1, full_name: "DOCX Acceptance Author" });
const reviewer = Object.freeze({ id: 2, full_name: "DOCX Acceptance Reviewer" });
const publisher = Object.freeze({ id: 3, full_name: "DOCX Acceptance Publisher" });
const request = Object.freeze({
  requestId: "chalin-one-docx-database-acceptance",
  headers: {},
});

async function buildDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?>
     <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
       <w:body>
         <w:p><w:r><w:t>DOCX controlled release procedure.</w:t></w:r></w:p>
         <w:p><w:r><w:t>The release officer must verify the signed inspection checklist before handing over equipment keys.</w:t></w:r></w:p>
         <w:p><w:r><w:t>A critical defect blocks release until the defect is closed.</w:t></w:r></w:p>
       </w:body>
     </w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

test(
  "CHALIN ONE DOCX ingestion stays draft-governed and becomes retrievable only after independent publication",
  { timeout: 120000 },
  async () => {
    await runChalinOneDocumentIntelligenceMigration({
      env: {
        ...process.env,
        NODE_ENV: "test",
        CHALIN_ONE_ALLOW_DOCUMENT_INTELLIGENCE_SCHEMA_MIGRATION: "true",
        CHALIN_ONE_DOCUMENT_INTELLIGENCE_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
      },
    });

    const created = await createKnowledgeSourceDraft({
      input: {
        source_key: "acceptance_docx_release_procedure",
        source_type: "procedure",
        owner_workspace_code: "equipment_hire",
        visibility: "workspace",
        title: "Acceptance DOCX Release Procedure",
        description: "Isolated DOCX parser acceptance source.",
        source_reference: "acceptance://docx-release-procedure",
        body_text:
          "Governed source shell. Detailed procedure is attached as an in-memory parsed DOCX.",
      },
      user: author,
      req: request,
    });

    const buffer = await buildDocx();
    const ingested = await ingestDocxKnowledgeDocument({
      sourceId: created.source_id,
      versionId: created.version_id,
      input: {
        file_name: "controlled-release-procedure.docx",
        mime_type: DOCX_MIME_TYPE,
        source_locator: "acceptance-register://release-procedure/docx",
        content_base64: buffer.toString("base64"),
      },
      user: author,
      req: request,
    });

    assert.equal(ingested.mime_type, DOCX_MIME_TYPE);
    assert.equal(ingested.parser_key, "builtin_docx_xml");
    assert.equal(ingested.raw_binary_stored, false);
    assert.equal(ingested.external_file_access, false);
    assert.equal(ingested.active_content_present, false);
    assert.equal(ingested.ocr_used, false);
    assert.equal(ingested.chunk_count >= 1, true);

    const documents = await listKnowledgeDocuments({
      sourceId: created.source_id,
      versionId: created.version_id,
    });
    assert.equal(documents.length, 1);
    assert.equal(documents[0].mime_type, DOCX_MIME_TYPE);
    assert.equal(documents[0].parser_key, "builtin_docx_xml");
    assert.equal(documents[0].raw_binary_stored, false);

    const beforePublish = await searchPublishedDocumentChunks({
      query: "signed inspection checklist equipment keys",
      persona: "copilot",
      workspaceCode: "equipment_hire",
      limit: 5,
    });
    assert.equal(
      beforePublish.some(
        (item) => item.source_ref.split("#", 1)[0] === "acceptance_docx_release_procedure"
      ),
      false
    );

    const submitted = await submitKnowledgeVersion({
      sourceId: created.source_id,
      versionId: created.version_id,
      assignedTo: reviewer.id,
      note: "Review the extracted DOCX text and exact chunks.",
      user: author,
      req: request,
    });
    await decideKnowledgeApproval({
      approvalId: submitted.approval_id,
      decision: "approved",
      note: "DOCX extraction and chunks reviewed independently.",
      user: reviewer,
      req: request,
    });
    await publishKnowledgeVersion({
      sourceId: created.source_id,
      versionId: created.version_id,
      user: publisher,
      req: request,
    });

    const evidence = await searchPublishedDocumentChunks({
      query: "signed inspection checklist equipment keys",
      persona: "copilot",
      workspaceCode: "equipment_hire",
      limit: 5,
    });
    const docxEvidence = evidence.find(
      (item) => item.source_ref.split("#", 1)[0] === "acceptance_docx_release_procedure"
    );
    assert.ok(docxEvidence);
    assert.equal(docxEvidence.metadata.file_name, "controlled-release-procedure.docx");
    assert.equal(docxEvidence.metadata.document_id, ingested.document_id);
    assert.match(docxEvidence.excerpt_text, /inspection checklist/);

    const [[rawBinary]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM ai_knowledge_documents
       WHERE id = ? AND raw_binary_stored <> 0`,
      [ingested.document_id]
    );
    assert.equal(Number(rawBinary.total || 0), 0);
  }
);

test.after(async () => {
  await pool.end();
});
