"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

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
  ingestKnowledgeDocument,
} = require("../services/aiDocumentIntelligenceService");
const {
  searchGovernedKnowledge,
} = require("../services/aiKnowledgeRetrievalService");

const author = Object.freeze({ id: 1, full_name: "Guide Document Author" });
const reviewer = Object.freeze({ id: 2, full_name: "Guide Document Reviewer" });
const publisher = Object.freeze({ id: 3, full_name: "Guide Document Publisher" });
const request = Object.freeze({
  requestId: "chalin-one-guide-document-retrieval-acceptance",
  headers: {},
});

async function createPublishedDocumentSource({
  sourceKey,
  visibility,
  ownerWorkspaceCode = null,
  title,
  bodyText,
  documentText,
}) {
  const created = await createKnowledgeSourceDraft({
    input: {
      source_key: sourceKey,
      source_type: "faq",
      owner_workspace_code: ownerWorkspaceCode,
      visibility,
      title,
      description: `${title} isolated acceptance source.`,
      source_reference: `acceptance://${sourceKey}`,
      body_text: bodyText,
    },
    user: author,
    req: request,
  });

  const document = await ingestKnowledgeDocument({
    sourceId: created.source_id,
    versionId: created.version_id,
    input: {
      file_name: `${sourceKey}.md`,
      mime_type: "text/markdown",
      source_locator: `acceptance-register://${sourceKey}`,
      content_text: documentText,
    },
    user: author,
    req: request,
  });

  const submitted = await submitKnowledgeVersion({
    sourceId: created.source_id,
    versionId: created.version_id,
    assignedTo: reviewer.id,
    note: "Review the exact Guide document chunks.",
    user: author,
    req: request,
  });
  await decideKnowledgeApproval({
    approvalId: submitted.approval_id,
    decision: "approved",
    note: "Guide document chunks reviewed independently.",
    user: reviewer,
    req: request,
  });
  await publishKnowledgeVersion({
    sourceId: created.source_id,
    versionId: created.version_id,
    user: publisher,
    req: request,
  });

  return { ...created, document };
}

test(
  "Chalin Guide hybrid retrieval returns published public chunks and excludes workspace documents",
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

    const publicSource = await createPublishedDocumentSource({
      sourceKey: "acceptance_public_guide_delivery_faq",
      visibility: "public",
      title: "Acceptance Public Delivery FAQ",
      bodyText:
        "Public FAQ shell. The detailed public delivery guidance is attached as governed document evidence.",
      documentText: [
        "# Public Delivery Guidance",
        "",
        "Customers may contact CHALIN 03 through the published enquiry channels for equipment and service information.",
        "Public enquiries do not provide access to private account, debt, payment, application or contract records.",
      ].join("\n"),
    });

    const workspaceSource = await createPublishedDocumentSource({
      sourceKey: "acceptance_private_guide_internal_note",
      visibility: "workspace",
      ownerWorkspaceCode: "equipment_hire",
      title: "Acceptance Internal Hire Note",
      bodyText: "Internal-only source shell.",
      documentText: [
        "# Internal Collection Note",
        "",
        "INTERNAL_PRIVATE_MARKER_7788 must never be available to the anonymous public Guide.",
        "This document belongs only to the equipment hire workspace.",
      ].join("\n"),
    });

    const publicEvidence = await searchGovernedKnowledge({
      query: "published enquiry channels equipment service information",
      persona: "guide",
      limit: 8,
    });
    const publicChunk = publicEvidence.find(
      (item) => item.source_ref.split("#", 1)[0] === "acceptance_public_guide_delivery_faq"
    );
    assert.ok(publicChunk);
    assert.match(publicChunk.source_type, /^knowledge_document\./);
    assert.equal(publicChunk.classification, "public");
    assert.equal(publicChunk.metadata.document_id, publicSource.document.document_id);
    assert.match(publicChunk.excerpt_text, /published enquiry channels/);

    const privateEvidence = await searchGovernedKnowledge({
      query: "INTERNAL_PRIVATE_MARKER_7788 equipment hire workspace",
      persona: "guide",
      limit: 8,
    });
    assert.equal(
      privateEvidence.some(
        (item) =>
          item.source_ref.split("#", 1)[0] ===
          "acceptance_private_guide_internal_note"
      ),
      false
    );
    assert.equal(
      privateEvidence.some((item) =>
        String(item.excerpt_text || "").includes("INTERNAL_PRIVATE_MARKER_7788")
      ),
      false
    );

    const staffEvidence = await searchGovernedKnowledge({
      query: "INTERNAL_PRIVATE_MARKER_7788 equipment hire workspace",
      persona: "copilot",
      workspaceCode: "equipment_hire",
      limit: 8,
    });
    assert.equal(
      staffEvidence.some(
        (item) =>
          item.source_ref.split("#", 1)[0] ===
          "acceptance_private_guide_internal_note"
      ),
      true
    );
    assert.equal(workspaceSource.document.raw_binary_stored, false);
  }
);

test.after(async () => {
  await pool.end();
});
