"use strict";

const crypto = require("node:crypto");

const { pool } = require("../config/db");
const { isFeatureEnabled } = require("./featureFlagService");
const { resolveAiScope } = require("./aiPermissionService");
const {
  assertDefinitionAuthority,
  createActionProposal,
  executeActionProposal,
  expectedActionConfirmation,
} = require("./aiActionProposalService");
const { aiActionRegistry } = require("./aiActionRegistry");
const {
  capabilityAnswer,
  isCapabilityQuestion,
  resolveActionCapabilities,
} = require("./aiActionCapabilityService");
const {
  planGovernedActions,
} = require("./aiAgentActionPlanningService");

const RENAME_PATTERNS = Object.freeze([
  /^(?:please\s+)?rename\s+(?:this|the)\s+(?:chat|conversation)\s+(?:to|as)\s+(.+)$/i,
  /^(?:please\s+)?change\s+(?:this|the)\s+(?:chat|conversation)(?:'s)?\s+(?:name|title)\s+(?:to|as)\s+(.+)$/i,
  /^(?:please\s+)?call\s+(?:this|the)\s+(?:chat|conversation)\s+(.+)$/i,
]);
const USER_DEACTIVATION_PATTERN =
  /^(?:please\s+)?(?:deactivate|disable|offboard)\s+(?:user|account)\s+(.+?)(?:\s+(?:because|with\s+reason|reason\s*:)\s+(.+))?$/i;
const USER_ID_REFERENCE_PATTERN = /^#?(\d+)$/;
const USERNAME_REFERENCE_PATTERN = /^@([A-Za-z0-9._-]{1,120})$/;
const ACTION_CONFIRMATION_PATTERN = /^(CONFIRM|EXECUTE)\s+(ap_[a-z0-9]{16,80})$/i;

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

function normalizeUserReference(value) {
  return stripWrappingQuotes(value).replace(/\s+/g, " ").slice(0, 180);
}

function detectActionConfirmation(message) {
  const match = clean(message, 160).match(ACTION_CONFIRMATION_PATTERN);
  if (!match) return null;
  const verb = String(match[1]).toUpperCase();
  const proposalKey = String(match[2]).toLowerCase();
  return Object.freeze({
    proposal_key: proposalKey,
    confirmation: `${verb} ${proposalKey}`,
  });
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
    const targetReference = normalizeUserReference(deactivation[1]);
    const reason = clean(deactivation[2], 500);
    if (!targetReference) return null;
    return Object.freeze({
      action_key: "system.user.deactivate",
      risk_level: 5,
      target_reference: targetReference,
      input: Object.freeze({
        target_user_id: null,
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

function userPublicShape(user = {}) {
  return Object.freeze({
    id: Number(user.id),
    full_name: user.full_name || null,
    username: user.username || null,
    role: user.role || null,
    is_active: Number(user.is_active || 0) === 1,
  });
}

async function resolveUserActionTarget(reference, connection = pool) {
  const target = normalizeUserReference(reference);
  if (!target) {
    return Object.freeze({ status: "not_found", candidates: Object.freeze([]) });
  }

  const idMatch = target.match(USER_ID_REFERENCE_PATTERN);
  let rows;
  if (idMatch) {
    [rows] = await connection.query(
      `SELECT id, full_name, username, role, is_active
       FROM users
       WHERE id = ?
       LIMIT 2`,
      [Number(idMatch[1])]
    );
  } else {
    const usernameMatch = target.match(USERNAME_REFERENCE_PATTERN);
    const lookup = usernameMatch ? usernameMatch[1] : target;
    [rows] = await connection.query(
      `SELECT id, full_name, username, role, is_active
       FROM users
       WHERE LOWER(username) = LOWER(?)
          OR LOWER(full_name) = LOWER(?)
       ORDER BY
         CASE WHEN LOWER(username) = LOWER(?) THEN 0 ELSE 1 END,
         is_active DESC,
         id ASC
       LIMIT 10`,
      [lookup, lookup, lookup]
    );
  }

  const candidates = rows.map(userPublicShape);
  if (candidates.length === 0) {
    return Object.freeze({
      status: "not_found",
      reference: target,
      candidates: Object.freeze([]),
    });
  }
  if (candidates.length > 1) {
    return Object.freeze({
      status: "ambiguous",
      reference: target,
      candidates: Object.freeze(candidates),
    });
  }
  return Object.freeze({
    status: "resolved",
    reference: target,
    user: candidates[0],
    candidates: Object.freeze(candidates),
  });
}

function userIdentityEvidence(user) {
  return Object.freeze([
    Object.freeze({
      source_type: "system.user_identity",
      source_ref: `users:${Number(user.id)}`,
      source_version: "live",
      label: `User account #${Number(user.id)} identity and active state`,
      excerpt_text: `User #${Number(user.id)} (${user.username || "no username"}), full name ${user.full_name || "not recorded"}, role ${user.role || "unknown"}, active ${user.is_active ? "yes" : "no"}.`,
      as_of_at: new Date().toISOString(),
      classification: "sensitive",
      workspace_code: null,
      metadata: Object.freeze({ target_user_id: Number(user.id) }),
    }),
  ]);
}

async function userDeactivationEvidence(targetReference, connection = pool) {
  const resolution = await resolveUserActionTarget(targetReference, connection);
  if (resolution.status !== "resolved") return resolution;
  return Object.freeze({
    ...resolution,
    evidence: userIdentityEvidence(resolution.user),
  });
}

function candidateText(candidates = []) {
  return candidates
    .slice(0, 8)
    .map(
      (candidate) =>
        `#${candidate.id} — ${candidate.full_name || candidate.username || "Unnamed user"}${candidate.username ? ` (@${candidate.username})` : ""} — ${candidate.role || "unknown role"}${candidate.is_active ? "" : " — inactive"}`
    )
    .join("\n");
}

function actionNotice(actionState) {
  if (!actionState) return "";
  if (actionState.status === "executed") {
    if (actionState.action_key === "intelligence.conversation.rename") {
      return `Done — I renamed this conversation to “${actionState.result?.title || "the requested title"}”.`;
    }
    if (actionState.action_key === "communications.sms.send") {
      const result = actionState.result || {};
      return `Done — I submitted the SMS to ${result.recipient || "the confirmed recipient"}. Provider status: ${result.status || "accepted"}${result.delivery_confirmed ? " (delivery confirmed)" : ""}.`;
    }
    if (actionState.action_key === "spare_parts.debt_reminder.send") {
      const result = actionState.result || {};
      return `Done — I submitted the governed debt reminder${result.customer_name ? ` for ${result.customer_name}` : ""}. Provider status: ${result.status || "accepted"}${result.delivery_confirmed ? " (delivery confirmed)" : ""}.`;
    }
    return `Done — the governed action ${actionState.action_key} completed successfully.`;
  }
  if (actionState.status === "approved") {
    return `Governed action proposal ${actionState.proposal_key} is approved but has **not** executed. To proceed, use the exact confirmation “${actionState.expected_confirmation}”.`;
  }
  if (actionState.status === "pending_review") {
    const target = actionState.target;
    const targetText = target
      ? ` Target: #${target.id} — ${target.full_name || target.username || "user"}${target.username ? ` (@${target.username})` : ""}.`
      : "";
    return `I prepared Risk Level ${actionState.risk_level} action proposal ${actionState.proposal_key}.${targetText} It has **not** executed. Review is required first; after approval, the exact confirmation “${actionState.expected_confirmation}” is required before execution.`;
  }
  if (actionState.status === "needs_input") {
    return `I can prepare that action, but I still need: ${(actionState.missing_fields || []).join(", ")}.`;
  }
  if (actionState.status === "target_not_found") {
    return `I could not find an exact user account matching “${actionState.target_reference || "that reference"}”. I did not create an action proposal. Use the user ID, @username, or exact full name.`;
  }
  if (actionState.status === "ambiguous_target") {
    const choices = candidateText(actionState.candidates);
    return `More than one user exactly matches “${actionState.target_reference}”, so I will not guess. Choose the user ID or @username before I prepare the Risk Level 5 action.${choices ? `\n\n${choices}` : ""}`;
  }
  if (actionState.status === "disabled") {
    return "I recognized this as an action request, but CHALIN AI action execution is currently disabled in this environment. No business record was changed.";
  }
  if (actionState.status === "blocked") {
    return `I recognized the action request, but this login is not authorized to perform it. ${actionState.reason || "No business record was changed."}`.trim();
  }
  if (actionState.status === "already_inactive") {
    const target = actionState.target || {};
    return `User #${actionState.target_user_id}${target.username ? ` (@${target.username})` : ""} is already inactive, so I did not create or execute another deactivation action.`;
  }
  if (actionState.status === "failed") {
    return `I recognized the action request, but the governed action could not be completed safely: ${actionState.reason || "unknown action error"}. No unapproved write was performed.`;
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

async function capabilityResult({ req, persona, result }) {
  const scope = resolveAiScope({ req, persona });
  const snapshot = resolveActionCapabilities({
    user: req.user,
    persona,
    scope,
  });
  return Object.freeze({
    ...result,
    answer: capabilityAnswer(snapshot),
    capabilities: snapshot,
  });
}

async function conversationalConfirmationResult({
  req,
  confirmation,
  conversationKey,
  assistantMessageKey,
  result,
} = {}) {
  let actionState;
  try {
    const executed = await executeActionProposal({
      proposalKey: confirmation.proposal_key,
      confirmation: confirmation.confirmation,
      user: req.user,
      req,
    });
    actionState = Object.freeze({
      action_key: executed.action_key,
      risk_level: Number(executed.risk_level || 0),
      proposal_key: executed.proposal_key,
      status: "executed",
      result: executed.result || null,
      execution_performed: true,
    });
  } catch (error) {
    actionState = safeActionErrorState(
      {
        action_key: "governed.action.confirmation",
        risk_level: 1,
      },
      error
    );
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

async function processConversationalAction({
  req,
  persona,
  message,
  conversationKey,
  assistantMessageKey,
  result,
} = {}) {
  if (isCapabilityQuestion(message)) {
    const nextResult = await capabilityResult({ req, persona, result });
    if (assistantMessageKey && conversationKey && req?.user?.id) {
      await replaceOwnedAssistantMessage({
        messageKey: assistantMessageKey,
        conversationKey,
        userId: req.user.id,
        content: nextResult.answer,
      }).catch(() => null);
    }
    return nextResult;
  }

  const confirmation = detectActionConfirmation(message);
  if (confirmation) {
    return conversationalConfirmationResult({
      req,
      confirmation,
      conversationKey,
      assistantMessageKey,
      result,
    });
  }

  const intent = detectConversationalAction(message, { conversationKey });
  if (!intent) {
    try {
      return await planGovernedActions({
        req,
        persona,
        message,
        result,
      });
    } catch (error) {
      return Object.freeze({
        ...result,
        action_planning: Object.freeze({
          planner: "llm_structured_tool_selection",
          status: "unavailable",
          error_code: clean(error?.code, 120) || "AI_ACTION_PLANNER_UNAVAILABLE",
          execution_performed: false,
        }),
      });
    }
  }

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
      target_reference: intent.target_reference || null,
      execution_performed: false,
    });
  } else {
    try {
      const scope = resolveAiScope({ req, persona });
      const definition = aiActionRegistry.get(intent.action_key);

      assertDefinitionAuthority({
        definition,
        user: req.user,
        persona,
        workspaceCode: scope.workspace_code,
        phase: "propose",
      });

      let evidence = [];
      let target = null;
      let resolvedInput = { ...intent.input };
      if (intent.action_key === "system.user.deactivate") {
        const targetState = await userDeactivationEvidence(intent.target_reference);
        if (targetState.status === "not_found") {
          actionState = Object.freeze({
            action_key: intent.action_key,
            risk_level: intent.risk_level,
            status: "target_not_found",
            target_reference: intent.target_reference,
            execution_performed: false,
          });
        } else if (targetState.status === "ambiguous") {
          actionState = Object.freeze({
            action_key: intent.action_key,
            risk_level: intent.risk_level,
            status: "ambiguous_target",
            target_reference: intent.target_reference,
            candidates: targetState.candidates,
            execution_performed: false,
          });
        } else {
          target = targetState.user;
          evidence = targetState.evidence;
          resolvedInput = {
            target_user_id: target.id,
            reason: intent.input.reason,
          };
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
      }

      if (!actionState) {
        const proposal = await createActionProposal({
          input: {
            action_key: intent.action_key,
            persona,
            scope,
            title:
              intent.action_key === "system.user.deactivate"
                ? `Securely deactivate user #${resolvedInput.target_user_id}`
                : `Rename Intelligence conversation to ${resolvedInput.title}`,
            summary: clean(message, 2000),
            payload: resolvedInput,
            evidence,
          },
          user: req.user,
          req,
        });

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
  ACTION_CONFIRMATION_PATTERN,
  RENAME_PATTERNS,
  USER_DEACTIVATION_PATTERN,
  USER_ID_REFERENCE_PATTERN,
  USERNAME_REFERENCE_PATTERN,
  actionNotice,
  assistantContentHash,
  candidateText,
  capabilityResult,
  clean,
  conversationalConfirmationResult,
  detectActionConfirmation,
  detectConversationalAction,
  normalizeUserReference,
  processConversationalAction,
  replaceOwnedAssistantMessage,
  resolveUserActionTarget,
  safeActionErrorState,
  stripWrappingQuotes,
  userDeactivationEvidence,
  userIdentityEvidence,
};