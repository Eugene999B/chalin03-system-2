"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  actionNotice,
  detectConversationalAction,
  safeActionErrorState,
  stripWrappingQuotes,
} = require("../services/aiConversationalActionService");

const repoRoot = path.resolve(__dirname, "../..");

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("explicit conversation rename commands resolve to the governed Risk-3 action", () => {
  for (const command of [
    'rename this chat to "Main Store Profit Review"',
    "change this conversation title to Main Store Profit Review",
    "call this chat Main Store Profit Review",
  ]) {
    const action = detectConversationalAction(command, {
      conversationKey: "conv_123",
    });
    assert.ok(action, command);
    assert.equal(action.action_key, "intelligence.conversation.rename");
    assert.equal(action.risk_level, 3);
    assert.equal(action.input.conversation_key, "conv_123");
    assert.equal(action.input.title, "Main Store Profit Review");
    assert.equal(action.direct_user_command, true);
  }
});

test("ordinary conversation does not become an action", () => {
  for (const message of [
    "How much did Main Store sell today?",
    "Explain why the profit is lower.",
    "Can you tell me what user deactivation means?",
    "What would happen if we disabled an account?",
  ]) {
    assert.equal(detectConversationalAction(message, { conversationKey: "conv_1" }), null);
  }
});

test("Risk-5 deactivation requires an explicit numeric target and reason", () => {
  const complete = detectConversationalAction(
    "deactivate user 44 because employment ended",
    { conversationKey: "conv_admin" }
  );
  assert.equal(complete.action_key, "system.user.deactivate");
  assert.equal(complete.risk_level, 5);
  assert.deepEqual(complete.input, {
    target_user_id: 44,
    reason: "employment ended",
  });
  assert.deepEqual(complete.missing_fields, []);

  const missingReason = detectConversationalAction("disable account #44", {
    conversationKey: "conv_admin",
  });
  assert.equal(missingReason.action_key, "system.user.deactivate");
  assert.deepEqual(missingReason.missing_fields, ["reason"]);

  assert.equal(
    detectConversationalAction("deactivate Eugene because employment ended", {
      conversationKey: "conv_admin",
    }),
    null
  );
});

test("quoted titles are normalized without changing the requested title", () => {
  assert.equal(stripWrappingQuotes('“Board Pack — August”'), "Board Pack — August");
  assert.equal(stripWrappingQuotes("'Customer 360'"), "Customer 360");
});

test("action notices state execution truthfully", () => {
  assert.match(
    actionNotice({
      action_key: "intelligence.conversation.rename",
      risk_level: 3,
      status: "executed",
      result: { title: "New Name" },
    }),
    /Done.*renamed.*New Name/i
  );
  assert.match(
    actionNotice({
      action_key: "system.user.deactivate",
      risk_level: 5,
      status: "pending_review",
      proposal_key: "ap_abc",
      expected_confirmation: "EXECUTE ap_abc",
    }),
    /has \*\*not\*\* executed/i
  );
  assert.match(
    actionNotice({ status: "disabled" }),
    /execution is currently disabled/i
  );
  assert.match(
    actionNotice({ status: "needs_input", missing_fields: ["reason"] }),
    /need.*reason/i
  );
});

test("denied action errors become blocked metadata without pretending a write occurred", () => {
  const state = safeActionErrorState(
    { action_key: "system.user.deactivate", risk_level: 5 },
    {
      code: "AI_ACTION_RISK5_SYSTEM_ADMIN_REQUIRED",
      message: "System Administrator required.",
    }
  );
  assert.equal(state.status, "blocked");
  assert.equal(state.execution_performed, false);
  assert.match(state.reason, /System Administrator/i);
});

test("chat integration processes actions after the assistant turn and persists the action notice", () => {
  const route = source("backend/routes/aiRoutes.js");
  const service = source("backend/services/aiConversationalActionService.js");

  assert.match(route, /processConversationalAction/);
  assert.match(route, /const baseResult = withConversationRollover/);
  assert.match(route, /assistantMessageKey: baseResult\.message_key/);
  assert.match(route, /result: baseResult/);

  assert.match(service, /replaceOwnedAssistantMessage/);
  assert.match(service, /INNER JOIN ai_conversations c ON c\.id = m\.conversation_id/);
  assert.match(service, /c\.user_id = \?/);
  assert.match(service, /m\.message_role = 'assistant'/);
});

test("Risk-5 chat commands can never auto-execute", () => {
  const service = source("backend/services/aiConversationalActionService.js");
  assert.match(service, /definition\?\.confirmation_mode === "none"/);
  assert.match(service, /definition\?\.risk_level <= 3/);
  assert.match(service, /proposal\.status === "approved"/);
  assert.match(service, /system\.user\.deactivate/);
  assert.match(service, /status: "pending_review"/);
  assert.doesNotMatch(
    service,
    /intent\.action_key === "system\.user\.deactivate"[\s\S]{0,900}executeActionProposal/
  );
});

test("Risk-5 target evidence is loaded from the authenticated server database before proposal", () => {
  const service = source("backend/services/aiConversationalActionService.js");
  assert.match(service, /SELECT id, full_name, username, role, is_active/);
  assert.match(service, /FROM users/);
  assert.match(service, /source_type: "system\.user_identity"/);
  assert.match(service, /classification: "sensitive"/);
  assert.match(service, /if \(!target\.is_active\)/);
});

test("frontend action review requires review then exact proposal confirmation", () => {
  const client = source("frontend/src/chalin-one/ai/aiActionClient.js");
  const capture = source(
    "frontend/src/chalin-one/ai/AiFeedbackCorrectionCapture.jsx"
  );

  assert.match(client, /\/ai\/actions\/proposals\/\$\{encodeURIComponent\(proposalKey\)\}\/decision/);
  assert.match(client, /\/ai\/actions\/proposals\/\$\{encodeURIComponent\(proposalKey\)\}\/execute/);
  assert.match(client, /actionFromChatResponse/);
  assert.match(client, /pending_review/);

  assert.match(capture, /ActionReviewDialog/);
  assert.match(capture, /Approve proposal/);
  assert.match(capture, /Reject/);
  assert.match(capture, /Type the exact confirmation/);
  assert.match(capture, /actionConfirmation !== expected/);
  assert.match(capture, /Execute approved action/);
  assert.match(capture, /Leave pending/);
  assert.doesNotMatch(capture, /window\.prompt/);
  assert.doesNotMatch(capture, /window\.location\.reload|location\.reload/);
});
