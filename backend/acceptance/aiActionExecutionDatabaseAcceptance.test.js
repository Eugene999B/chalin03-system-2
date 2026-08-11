"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const enabled = ["1", "true", "yes", "on"].includes(
  String(process.env.CHALIN_ONE_AI_ACTION_EXECUTION_ACCEPTANCE || "").trim().toLowerCase()
);

if (!enabled) {
  test("AI action execution database acceptance is isolated to its dedicated CI lane", { skip: true }, () => {});
} else {
  process.env.FEATURE_AI_ENABLED = "true";
  process.env.FEATURE_AI_ACTIONS = "true";

  const { pool } = require("../config/db");
  const { createConversation, loadOwnedConversation } = require("../services/aiConversationService");
  const { registerBuiltInAiActions } = require("../ai-actions/registerAiActions");
  const {
    createActionProposal,
    executeActionProposal,
    getActionProposal,
  } = require("../services/aiActionProposalService");

  const admin = Object.freeze({
    id: Number(process.env.SYSTEM_ADMIN_USER_ID || 1),
    username: String(process.env.SYSTEM_ADMIN_USERNAME || "admin"),
    role: "admin",
    workspace_code: "spare_parts",
    effective_permissions: [],
  });

  const req = Object.freeze({
    requestId: "action-acceptance-request",
    user: admin,
    headers: Object.freeze({}),
    ip: "127.0.0.1",
  });

  test("approved Risk-3 action executes exactly once against isolated acceptance database", async (t) => {
    registerBuiltInAiActions();

    const created = await createConversation({
      persona: "copilot",
      userId: admin.id,
      scope: { workspace_code: "spare_parts" },
      title: "Before governed action",
    });

    t.after(async () => {
      await pool.query("DELETE FROM ai_action_reviews WHERE proposal_id IN (SELECT id FROM ai_action_proposals WHERE request_id = ?)", [req.requestId]).catch(() => null);
      await pool.query("DELETE FROM ai_action_proposals WHERE request_id = ?", [req.requestId]).catch(() => null);
      await pool.query("DELETE FROM ai_conversations WHERE conversation_key = ?", [created.key]).catch(() => null);
    });

    const proposal = await createActionProposal({
      input: {
        action_key: "intelligence.conversation.rename",
        persona: "copilot",
        scope: { workspace_code: "spare_parts" },
        title: "Rename this Intelligence conversation",
        summary: "Exercise the governed Risk-3 execution path in isolated CI.",
        payload: {
          conversation_key: created.key,
          title: "Renamed by Governed AI Action",
        },
      },
      user: admin,
      req,
    });

    assert.equal(proposal.status, "approved");
    assert.equal(proposal.review_mode, "auto");
    assert.equal(proposal.execution_available, true);
    assert.match(proposal.payload_sha256, /^[a-f0-9]{64}$/);

    const executed = await executeActionProposal({
      proposalKey: proposal.proposal_key,
      confirmation: "",
      user: admin,
      req,
    });

    assert.equal(executed.status, "executed");
    assert.equal(executed.action_key, "intelligence.conversation.rename");
    assert.equal(executed.risk_level, 3);
    assert.equal(executed.result.renamed, true);

    const conversation = await loadOwnedConversation({
      conversationKey: created.key,
      userId: admin.id,
    });
    assert.equal(conversation.title, "Renamed by Governed AI Action");

    const details = await getActionProposal({
      proposalKey: proposal.proposal_key,
      user: admin,
    });
    assert.equal(details.proposal.status, "executed");
    assert.ok(details.proposal.executed_at);
    assert.match(String(details.proposal.result_summary || ""), /renamed/i);
    assert.equal(details.proposal.error_code, null);

    await assert.rejects(
      executeActionProposal({
        proposalKey: proposal.proposal_key,
        confirmation: "",
        user: admin,
        req,
      }),
      (error) => error?.code === "AI_ACTION_PROPOSAL_NOT_EXECUTABLE"
    );

    const afterReplay = await loadOwnedConversation({
      conversationKey: created.key,
      userId: admin.id,
    });
    assert.equal(afterReplay.title, "Renamed by Governed AI Action");
  });

  test.after(async () => {
    await pool.end();
  });
}
