"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { pool } = require("../config/db");
const {
  EXPECTED_TABLES,
  FORBIDDEN_SECRET_COLUMN_PATTERN,
} = require("../scripts/runChalinOneAiFoundationMigration");
const {
  AiKnowledgeError,
  createKnowledgeSourceDraft,
  decideKnowledgeApproval,
  publishKnowledgeVersion,
  searchApprovedKnowledge,
  submitKnowledgeVersion,
} = require("../services/aiKnowledgeService");
const {
  addMessage,
  createConversation,
  getConversationDetails,
} = require("../services/aiConversationService");
const { createFeedback } = require("../services/aiFeedbackService");
const {
  getDailyUsage,
  recordUsage,
} = require("../services/aiUsageService");
const { writeAiAuditEvent } = require("../services/aiAuditService");

const author = Object.freeze({ id: 1, full_name: "Acceptance Author" });
const reviewer = Object.freeze({ id: 2, full_name: "Acceptance Reviewer" });
const publisher = Object.freeze({ id: 3, full_name: "Acceptance Publisher" });
const request = Object.freeze({
  requestId: "chalin-one-ai-database-acceptance",
  headers: {},
});

async function tableCount(tableName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS row_count FROM \`${tableName}\``
  );
  return Number(row?.row_count || 0);
}

test(
  "CHALIN ONE AI governance, conversations, feedback, usage and audit work against isolated MySQL",
  { timeout: 120000 },
  async () => {
    const [tableRows] = await pool.query(
      `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'ai\\_%'`
    );
    const names = new Set(tableRows.map((row) => row.table_name));
    assert.deepEqual(
      EXPECTED_TABLES.filter((tableName) => !names.has(tableName)),
      []
    );

    const [columnRows] = await pool.query(
      `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'ai\\_%'`
    );
    assert.deepEqual(
      columnRows.filter((row) =>
        FORBIDDEN_SECRET_COLUMN_PATTERN.test(row.column_name)
      ),
      []
    );

    const created = await createKnowledgeSourceDraft({
      input: {
        source_key: "acceptance_equipment_hire_policy",
        source_type: "policy",
        owner_workspace_code: "equipment_hire",
        visibility: "workspace",
        title: "Acceptance Equipment Hire Policy",
        description: "Isolated acceptance knowledge source.",
        source_reference: "acceptance://equipment-hire-policy",
        body_text:
          "Approved hire inspections must be completed before an asset is released.",
        metadata: { acceptance: true },
      },
      user: author,
      req: request,
    });
    assert.equal(created.version_number, 1);

    const submitted = await submitKnowledgeVersion({
      sourceId: created.source_id,
      versionId: created.version_id,
      assignedTo: reviewer.id,
      note: "Review the exact acceptance knowledge version.",
      user: author,
      req: request,
    });
    assert.ok(submitted.approval_id);

    await assert.rejects(
      () =>
        decideKnowledgeApproval({
          approvalId: submitted.approval_id,
          decision: "approved",
          note: "Self approval must fail.",
          user: author,
          req: request,
        }),
      (error) =>
        error instanceof AiKnowledgeError &&
        error.code === "AI_KNOWLEDGE_SELF_APPROVAL_BLOCKED"
    );

    await decideKnowledgeApproval({
      approvalId: submitted.approval_id,
      decision: "approved",
      note: "Exact acceptance version approved independently.",
      user: reviewer,
      req: request,
    });

    await assert.rejects(
      () =>
        publishKnowledgeVersion({
          sourceId: created.source_id,
          versionId: created.version_id,
          user: reviewer,
          req: request,
        }),
      (error) =>
        error instanceof AiKnowledgeError &&
        error.code === "AI_KNOWLEDGE_INDEPENDENT_PUBLISHER_REQUIRED"
    );

    await publishKnowledgeVersion({
      sourceId: created.source_id,
      versionId: created.version_id,
      user: publisher,
      req: request,
    });

    const copilotEvidence = await searchApprovedKnowledge({
      query: "hire inspections",
      persona: "copilot",
      workspaceCode: "equipment_hire",
      limit: 8,
    });
    assert.equal(copilotEvidence.length, 1);
    assert.equal(
      copilotEvidence[0].source_ref,
      "acceptance_equipment_hire_policy"
    );
    assert.equal(copilotEvidence[0].workspace_code, "equipment_hire");

    const wrongWorkspaceEvidence = await searchApprovedKnowledge({
      query: "hire inspections",
      persona: "copilot",
      workspaceCode: "mining",
      limit: 8,
    });
    assert.equal(wrongWorkspaceEvidence.length, 0);

    const guideEvidence = await searchApprovedKnowledge({
      query: "hire inspections",
      persona: "guide",
      limit: 8,
    });
    assert.equal(guideEvidence.length, 0);

    const conversation = await createConversation({
      persona: "copilot",
      userId: author.id,
      scope: {
        workspace_code: "equipment_hire",
        hire_location_id: 1,
      },
      title: "Acceptance AI Conversation",
    });
    const userMessage = await addMessage({
      conversationId: conversation.id,
      role: "user",
      content: "What must happen before equipment release?",
      safetyStatus: "allowed",
      createdBy: author.id,
    });
    await addMessage({
      conversationId: conversation.id,
      role: "system",
      content: "Hidden system instruction for acceptance only.",
      safetyStatus: "allowed",
      createdBy: author.id,
    });
    const assistantMessage = await addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content:
        "The approved policy requires a completed hire inspection before release [E1].",
      safetyStatus: "allowed",
      providerKey: "mock",
      modelKey: "mock-v1",
      inputTokens: 20,
      outputTokens: 18,
      createdBy: author.id,
    });

    const details = await getConversationDetails({
      conversationKey: conversation.key,
      userId: author.id,
    });
    assert.equal(details.conversation.workspace_code, "equipment_hire");
    assert.deepEqual(
      details.messages.map((message) => message.role),
      ["user", "assistant"]
    );

    const feedback = await createFeedback({
      conversationKey: conversation.key,
      messageKey: assistantMessage.key,
      rating: "helpful",
      comment: "Acceptance answer cites approved evidence.",
      user: author,
      req: { ...request, user: author },
    });
    assert.equal(feedback.review_status, "new");

    const usage = await recordUsage({
      userId: author.id,
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      providerKey: "mock",
      modelKey: "mock-v1",
      workspaceCode: "equipment_hire",
      inputTokens: 20,
      outputTokens: 18,
      costMicros: 0,
      requestId: request.requestId,
    });
    assert.equal(usage.total_tokens, 38);

    const daily = await getDailyUsage({
      userId: author.id,
      workspaceCode: "equipment_hire",
    });
    assert.equal(daily.user_tokens >= 38, true);
    assert.equal(daily.workspace_tokens >= 38, true);

    const audit = await writeAiAuditEvent({
      req: { ...request, user: author },
      userId: author.id,
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      eventType: "AI_ACCEPTANCE_COMPLETED",
      outcome: "success",
      severity: "info",
      persona: "copilot",
      scope: {
        workspace_code: "equipment_hire",
        hire_location_id: 1,
      },
      metadata: {
        provider_secret: "must-be-redacted-by-platform-audit",
        user_message_id: userMessage.id,
      },
    });
    assert.ok(audit.id);

    assert.equal(await tableCount("ai_knowledge_sources"), 1);
    assert.equal(await tableCount("ai_knowledge_versions"), 1);
    assert.equal(await tableCount("ai_knowledge_approvals"), 1);
    assert.equal(await tableCount("ai_conversations"), 1);
    assert.equal(await tableCount("ai_feedback"), 1);
    assert.equal((await tableCount("ai_usage_ledger")) >= 1, true);
    assert.equal((await tableCount("ai_audit_events")) >= 1, true);
  }
);
