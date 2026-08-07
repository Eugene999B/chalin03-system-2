"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { pool } = require("../config/db");
const {
  EXPECTED_TABLES,
  MIGRATION_RECORD,
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
  getKnowledgeChunk,
  ingestKnowledgeDocument,
  listKnowledgeDocuments,
  searchPublishedDocumentChunks,
} = require("../services/aiDocumentIntelligenceService");
const {
  searchGovernedKnowledge,
} = require("../services/aiKnowledgeRetrievalService");

const author = Object.freeze({ id: 1, full_name: "Document Acceptance Author" });
const reviewer = Object.freeze({ id: 2, full_name: "Document Acceptance Reviewer" });
const publisher = Object.freeze({ id: 3, full_name: "Document Acceptance Publisher" });
const request = Object.freeze({
  requestId: "chalin-one-document-intelligence-acceptance",
  headers: {},
});

function acceptanceEnv(extra = {}) {
  return {
    ...process.env,
    NODE_ENV: "test",
    ...extra,
  };
}

async function assertTablesExist(tableNames) {
  const placeholders = tableNames.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    tableNames
  );
  const actual = new Set(rows.map((row) => row.table_name));
  assert.deepEqual(tableNames.filter((tableName) => !actual.has(tableName)), []);
}

test(
  "CHALIN ONE governed document ingestion migrates twice and retrieves exact published chunks",
  { timeout: 120000 },
  async () => {
    const env = acceptanceEnv({
      CHALIN_ONE_ALLOW_DOCUMENT_INTELLIGENCE_SCHEMA_MIGRATION: "true",
      CHALIN_ONE_DOCUMENT_INTELLIGENCE_MIGRATION_CONFIRM: RELEASE_CONFIRMATION,
    });

    const first = await runChalinOneDocumentIntelligenceMigration({ env });
    const second = await runChalinOneDocumentIntelligenceMigration({ env });
    assert.equal(first.production, false);
    assert.equal(second.verified_table_count, EXPECTED_TABLES.length);
    assert.equal(second.secret_columns_present, false);
    assert.equal(second.raw_binary_rows, 0);
    await assertTablesExist(EXPECTED_TABLES);

    const [migrationRows] = await pool.query(
      `SELECT migration_name FROM schema_migrations
       WHERE migration_name = ?`,
      [MIGRATION_RECORD]
    );
    assert.equal(migrationRows.length, 1);

    const created = await createKnowledgeSourceDraft({
      input: {
        source_key: "acceptance_document_release_manual",
        source_type: "manual",
        owner_workspace_code: "equipment_hire",
        visibility: "workspace",
        title: "Acceptance Equipment Release Manual",
        description: "Document intelligence isolated acceptance source.",
        source_reference: "acceptance://document-release-manual",
        body_text:
          "This summary exists only as the governed version shell; the detailed procedure is attached as an ingested document.",
      },
      user: author,
      req: request,
    });

    const document = await ingestKnowledgeDocument({
      sourceId: created.source_id,
      versionId: created.version_id,
      input: {
        file_name: "equipment-release-procedure.md",
        mime_type: "text/markdown",
        document_key: "equipment_release_procedure",
        source_locator: "controlled-manual://equipment-release/section-4",
        content_text: [
          "# Equipment Release Procedure",
          "",
          "Before any excavator leaves the yard, the release officer must verify the signed inspection checklist.",
          "The meter reading and visible damage notes must be recorded before keys are handed over.",
          "If a critical defect is open, release must stop and the asset remains unavailable.",
          "",
          "## Evidence",
          "The approved inspection record and release note are the controlling evidence for the handover.",
        ].join("\n"),
      },
      user: author,
      req: request,
    });
    assert.equal(document.raw_binary_stored, false);
    assert.equal(document.chunk_count >= 1, true);
    assert.equal(document.vector_model_key, "local_hash_v1");

    const documents = await listKnowledgeDocuments({
      sourceId: created.source_id,
      versionId: created.version_id,
    });
    assert.equal(documents.length, 1);
    assert.equal(documents[0].parse_status, "parsed");
    assert.equal(documents[0].raw_binary_stored, false);

    const submitted = await submitKnowledgeVersion({
      sourceId: created.source_id,
      versionId: created.version_id,
      assignedTo: reviewer.id,
      note: "Review the exact version and its parsed document chunks.",
      user: author,
      req: request,
    });
    await decideKnowledgeApproval({
      approvalId: submitted.approval_id,
      decision: "approved",
      note: "Parsed document content and locators reviewed.",
      user: reviewer,
      req: request,
    });
    await publishKnowledgeVersion({
      sourceId: created.source_id,
      versionId: created.version_id,
      user: publisher,
      req: request,
    });

    const direct = await searchPublishedDocumentChunks({
      query: "signed inspection checklist before keys handed over",
      persona: "copilot",
      workspaceCode: "equipment_hire",
      limit: 5,
    });
    assert.equal(direct.length >= 1, true);
    assert.match(direct[0].source_type, /^knowledge_document\./);
    assert.match(direct[0].source_ref, /equipment_release_procedure:chunk:/);
    assert.equal(direct[0].metadata.file_name, "equipment-release-procedure.md");
    assert.equal(direct[0].metadata.line_start >= 1, true);
    assert.equal(direct[0].metadata.line_end >= direct[0].metadata.line_start, true);
    assert.equal(direct[0].metadata.retrieval_model, "local_hash_v1");
    assert.match(
      direct[0].metadata.citation_deep_link,
      /\/api\/ai\/knowledge\/acceptance_document_release_manual\/documents\//
    );

    const hybrid = await searchGovernedKnowledge({
      query: "critical defect release stop",
      persona: "copilot",
      workspaceCode: "equipment_hire",
      limit: 5,
    });
    assert.equal(hybrid.length >= 1, true);
    assert.match(hybrid[0].source_type, /^knowledge_document\./);

    const wrongWorkspace = await searchPublishedDocumentChunks({
      query: "critical defect release stop",
      persona: "copilot",
      workspaceCode: "mining",
      limit: 5,
    });
    assert.equal(wrongWorkspace.length, 0);

    const publicGuide = await searchPublishedDocumentChunks({
      query: "critical defect release stop",
      persona: "guide",
      limit: 5,
    });
    assert.equal(publicGuide.length, 0);

    const [chunkRows] = await pool.query(
      `SELECT id FROM ai_knowledge_chunks
       WHERE document_id = ? ORDER BY chunk_index ASC LIMIT 1`,
      [document.document_id]
    );
    const chunk = await getKnowledgeChunk({
      sourceId: created.source_id,
      documentId: document.document_id,
      chunkId: chunkRows[0].id,
    });
    assert.equal(chunk.file_name, "equipment-release-procedure.md");
    assert.match(chunk.chunk_text, /signed inspection checklist/);
    assert.equal(chunk.version_status, "published");

    const [[rawBinary]] = await pool.query(
      "SELECT COUNT(*) AS total FROM ai_knowledge_documents WHERE raw_binary_stored <> 0"
    );
    assert.equal(Number(rawBinary.total || 0), 0);
  }
);

test.after(async () => {
  await pool.end();
});
