"use strict";

const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { isFeatureEnabled } = require("./featureFlagService");
const { resolveAiScope } = require("./aiPermissionService");
const {
  createActionProposal,
  executeActionProposal,
  expectedActionConfirmation,
} = require("./aiActionProposalService");
const { aiActionRegistry } = require("./aiActionRegistry");

const RENAME_PATTERNS = Object.freeze([
  /^(?:please\s+)?rename\s+(?:this|the)\s+(?:chat|conversation)\s+(?:to|as)\s+(.+)$/i,
  /^(?:please\s+)?change\s+(?:this|the)\s+(?:chat|conversation)(?:'s)?\s+(?:name|title)\s+(?:to|as)\s+(.+)$/i,
  /^(?:please\s+)?call\s+(?:this|the)\s+(?:chat|conversation)\s+(.+)$/i,
]);
const USER_DEACTIVATION_PATTERN =
  /^(?:please\s+)?(?:deactivate|disable|offboard)\s+(?:user|account)\s+#?(\d+)\b(?:\s+(?:because|for|reason\s*:?|with\s+reason)\s+(.+))?$/i;

function clean(value, maximum = 4000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maximum);
}

function stripWrappingQuotes(value) {
  return clean(value, 180)
    .replace(/^["“”']+|["“”']+$/g, "")
    .trim();
}

function detectConversationalAction(message, { conversationKey = null } = {}) {
  const text = clean(message, 4000);
  if (!text) return null;

  for (const pattern of RENAME_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const title = stripWrappingQuotes(match[1]);
    if (!title) return null;
    return Object.freeze({
      action_key: "intelligence.conversation.rename",
      risk_level: 3,
      input: Object.freeze({
        conversation_key: clean(conversationKey, 100),
        title,
      }),
      direct_user_command: true,
    });
  }

  const deactivation = text.match(USER_DEACTIVATION_PATTERN);
  if (deactivation) {
    const targetUserId = Number(deactivation[1]);
    const reason = clean(deactivation[2], 500);
    return Object.freeze({
      action_key: "system.user.deactivate",
      risk_level: 5,
      input: Object.freeze({
        target_user_id: Number.isSafeInteger(targetUserId) ? targetUserId : null,
        reason: reason || null,
      }),
      missing_fields: Object.freeze(reason ? [] : ["reason"]),
      direct_user_command: true,
    });
  }

  return null;
}

function assistantContentHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

async function replaceOwnedAssistantMessage({
  messageKey,
  conversationKey,
  userId,
  content,
  connection = pool,
} = {}) {
  const text = clean(content, 1000000);
  if (!messageKey || !conversationKey || !userId || !text) return false;
  const [result] = await connection.query(
    `UPDATE ai_messages m
     INNER JOIN ai_conversations c ON c.id = m.conversation_id
     SET m.content_text = ?, m.content_sha256 = ?
     WHERE m.message_key = ?
       AND m.message_role = 'assistant'
       AND c.conversation_key = ?
       AND c.user_id = ?`,
    [text, assistantContentHash(text), messageKey, conversationKey, Number(userId)]
  );
  return Number(result.affectedRows || 0) === 1;
}

async function userDeactivationEvidence(targetUserId, connection = pool) {
  const [rows] = await connection.query(
    `SELECT id, full_name, username, role, is_active
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [Number(targetUserId)]
  );
  const user = rows[0];
  if (!user) {
    const error = new Error("The requested user account was not found.");
    error.code = "AI_ACTION_TARGET_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  return Object.freeze({
    user: Object.freeze({
      id: Number(user.id),
      full_name: user.full_name || null,
      username: user.username || null,
      role: user.role || null,
      is_active: Number(user.is_active || 0) === 1,
    }),
    evidence: Object.freeze([
      Object.freeze({
        source_type: "system.user_identity",
        source_ref: `users:${Number(user.id)}`,
        source_version: "live",
        label: `User account #${Number(user.id)} identity and active state`,
        excerpt_text: `User #${Number(user.id)} (${user.username || "no username"}), role ${user.role || "unknown"}, active ${Number(user.is_active || 0) === 1 ? "yes" : "no"}.`,
        as_of_at: new Date().toISOString(),
        classification: "sensitive",
        workspace_code: null,
        metadata: Object.freeze({ target_user_id: Number(user.id) }),
      }),
    ]),
  });
}

function actionNotice(actionState) {
  if (!actionState) return "";
  if (actionState.status === "executed") {
    if (actionState.action_key === "intelligence.conversation.rename") {
      return `Done — I renamed this conversation to “${actionState.result?.title || "the requested title"}”.`;
    }
    return `Done — the governed action ${actionState.action_key} completed successfully.`;
  }
  if (actionState.status === "pending_review") {
    return `I prepared Risk Level ${actionState.risk_level} action proposal ${actionState.proposal_key}. It has **not** executed. Review is required first; after approval, the exact confirmation “${actionState.expected_confirmation}” is required before execution.`;
  }
  if (actionState.status === "needs_input") {
    return `I can prepare that action, but I still need: ${(actionState.missing_fields || []).join(", ")}.`;
  }
  if (actionState.status === "disabled") {
    return "I recognized this as an action request, but CHALIN AI action execution is currently disabled in this environment. No business record was changed.";
  }
  if (actionState.status === "blocked") {
    return `I recognized the action request, but this login is not authorized to perform it. ${actionState.reason || "No business record was changed."}`.trim();
  }
  if (actionState.status === "already_inactive") {
    return `User #${actionState.target_user_id} is already inactive, so I did not create or execute another deactivation action.`;
  }
  if (actionState.status === "failed") {
    return `I recognized the action request, but the governed action could not be prepared safely: ${actionState.reason || "unknown action error"}. No unapproved write was performed.`;
  }
  return "";
}

function safeActionErrorState(intent, error) {
  const code = clean(error?.code, 120);
  const denied = /DENIED|REQUIRED|SYSTEM_ADMIN|RISK_CEILING|BUSINESS_PERMISSION|PERMISSION/.test(code);
  return Object.freeze({
    action_key: intent.action_key,
    risk_level: intent.risk_level,
    status: denied ? "blocked" : "failed",
    reason: clean(error?.message, 800) || "The governed action failed safely.",
    error_code: code || "AI_ACTION_REQUEST_FAILED",
    execution_performed: false,
  });
}

async function processConversationalAction({
  req,
  persona,
  message,
  conversationKey,
  assistantMessageKey,
  result,
} = {}) {
  const intent = detectConversationalAction(message, { conversationKey });
  if (!intent) return result;

  let actionState;
  if (!isFeatureEnabled("aiActions")) {
    actionState = Object.freeze({
      action_key: intent.action_key,
      risk_level: intent.risk_level,
      status: "disabled",
      execution_performed: false,
    });
  } else if (intent.missing_fields?.length) {
    actionState = Object.freeze({
      action_key: intent.action_key,
      risk_level: intent.risk_level,
      status: "needs_input",
      missing_fields: intent.missing_fields,
      execution_performed: false,
    });
  } else {
    try {
      const scope = resolveAiScope({ req, persona });
      let evidence = [];
      let target = null;
      if (intent.action_key === "system.user.deactivate") {
        const targetState = await userDeactivationEvidence(intent.input.target_user_id);
        target = targetState.user;
        evidence = targetState.evidence;
        if (!target.is_active) {
          actionState = Object.freeze({
            action_key: intent.action_key,
            risk_level: intent.risk_level,
            status: "already_inactive",
            target_user_id: target.id,
            target,
            execution_performed: false,
          });
        }
      }

      if (!actionState) {
        const proposal = await createActionProposal({
          input: {
            action_key: intent.action_key,
            persona,
            scope,
            title:
              intent.action_key === "system.user.deactivate"
                ? `Securely deactivate user #${intent.input.target_user_id}`
                : `Rename Intelligence conversation to ${intent.input.title}`,
            summary: clean(message, 2000),
            payload: intent.input,
            evidence,
          },
          user: req.user,
          req,
        });

        const definition = aiActionRegistry.get(intent.action_key);
        const expectedConfirmation =
          expectedActionConfirmation(
            { proposal_key: proposal.proposal_key },
            definition
          ) || null;

        if (
          proposal.status === "approved" &&
          definition?.confirmation_mode === "none" &&
          definition?.risk_level <= 3
        ) {
          const executed = await executeActionProposal({
            proposalKey: proposal.proposal_key,
            confirmation: "",
            user: req.user,
            req,
          });
          actionState = Object.freeze({
            action_key: intent.action_key,
            risk_level: Number(executed.risk_level || definition.risk_level),
            proposal_key: proposal.proposal_key,
            status: "executed",
            result: executed.result || null,
            execution_performed: true,
          });
        } else {
          actionState = Object.freeze({
            action_key: intent.action_key,
            risk_level: Number(definition?.risk_level || intent.risk_level),
            proposal_key: proposal.proposal_key,
            status: proposal.status,
            review_required: proposal.status === "pending_review",
            confirmation_mode: definition?.confirmation_mode || null,
            expected_confirmation: expectedConfirmation,
            target,
            execution_performed: false,
          });
        }
      }
    } catch (error) {
      actionState = safeActionErrorState(intent, error);
    }
  }

  const notice = actionNotice(actionState);
  const nextResult = Object.freeze({
    ...result,
    answer: notice || result?.answer || "",
    action: actionState,
  });

  if (notice && assistantMessageKey && conversationKey && req?.user?.id) {
    await replaceOwnedAssistantMessage({
      messageKey: assistantMessageKey,
      conversationKey,
      userId: req.user.id,
      content: notice,
    }).catch(() => null);
  }

  return nextResult;
}

module.exports = {
  RENAME_PATTERNS,
  USER_DEACTIVATION_PATTERN,
  actionNotice,
  assistantContentHash,
  clean,
  detectConversationalAction,
  processConversationalAction,
  replaceOwnedAssistantMessage,
  safeActionErrorState,
  stripWrappingQuotes,
  userDeactivationEvidence,
};
