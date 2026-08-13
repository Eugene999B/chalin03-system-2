"use strict";

const crypto = require("node:crypto");
const { pool } = require("../config/db");
const { isFeatureEnabled } = require("./featureFlagService");
const { aiActionRegistry } = require("./aiActionRegistry");
const {
  assertDefinitionAuthority,
  createActionProposal,
  expectedActionConfirmation,
} = require("./aiActionProposalService");
const {
  assertDailyUsage,
  assertMonthlyCost,
  buildRequestBudget,
} = require("./aiCostControlService");
const { generateProviderResponse } = require("./aiProviderService");
const { resolveAiScope } = require("./aiPermissionService");
const {
  getDailyUsage,
  getMonthlyCost,
  recordUsage,
} = require("./aiUsageService");

const MAX_PLANNED_ACTIONS = 4;
const ACTION_REQUEST_SIGNAL =
  /\b(?:send|text|message|notify|remind|contact|rename|change|update|create|add|remove|delete|deactivate|disable|offboard|approve|reject|cancel|close|reopen|issue|pay|collect|refund|whatsapp|sms)\b/i;

function clean(value, maximum = 8000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maximum);
}

function contentHash(value) {
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
  const [update] = await connection.query(
    `UPDATE ai_messages m
     INNER JOIN ai_conversations c ON c.id = m.conversation_id
     SET m.content_text = ?, m.content_sha256 = ?
     WHERE m.message_key = ?
       AND m.message_role = 'assistant'
       AND c.conversation_key = ?
       AND c.user_id = ?`,
    [text, contentHash(text), messageKey, conversationKey, Number(userId)]
  );
  return Number(update.affectedRows || 0) === 1;
}

function looksLikeActionRequest(message) {
  return ACTION_REQUEST_SIGNAL.test(clean(message, 4000));
}

function canProposeDefinition({ definition, user, persona, scope }) {
  try {
    assertDefinitionAuthority({
      definition,
      user,
      persona,
      workspaceCode: scope.workspace_code,
      phase: "propose",
    });
    return true;
  } catch {
    return false;
  }
}

function proposalToolKey(actionKey) {
  return `action_proposal_${String(actionKey || "").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`.slice(0, 150);
}

function availableProposalTools({ user, persona, scope }) {
  const definitions = aiActionRegistry
    .list({ persona, workspace: scope.workspace_code })
    .filter((definition) => canProposeDefinition({ definition, user, persona, scope }));

  const actionByTool = new Map();
  const tools = definitions.map((definition) => {
    const key = proposalToolKey(definition.key);
    actionByTool.set(key, definition.key);
    return Object.freeze({
      key,
      title: `Propose: ${definition.title}`,
      description: `${definition.description || definition.title} This tool ONLY prepares a governed Risk Level ${definition.risk_level} proposal. It never performs the business write by itself.`,
      version: definition.version,
      risk_level: 1,
      personas: [persona],
      required_permissions: [],
      required_business_permissions: [],
      allowed_workspaces: [scope.workspace_code],
      scope_requirements: {},
      input_schema: definition.input_schema,
      evidence_required: false,
    });
  });

  return Object.freeze({
    definitions: Object.freeze(definitions),
    tools: Object.freeze(tools),
    actionByTool,
  });
}

function compactEvidence(evidence = []) {
  return (Array.isArray(evidence) ? evidence : [])
    .slice(0, 12)
    .map((item, index) => ({
      id: `E${index + 1}`,
      source_ref: clean(item?.source_ref, 220) || null,
      label: clean(item?.label, 300) || null,
      excerpt: clean(item?.excerpt_text, 900) || null,
      as_of_at: item?.as_of_at || null,
    }));
}

function planningMessages({ message, evidence = [], result = {} }) {
  const evidenceRows = compactEvidence(evidence);
  const context = {
    workspace_code: result?.conversation?.workspace_code || null,
    conversation_key: result?.conversation_key || null,
    evidence: evidenceRows,
  };
  return Object.freeze([
    Object.freeze({
      role: "system",
      content: [
        "You are the CHALIN governed action planner, not the final-answer writer.",
        "Decide whether the latest user message clearly asks CHALIN to change something, contact someone, or perform an operational write.",
        "If and only if a supplied proposal tool exactly matches the requested action, call it with grounded inputs.",
        "A proposal tool does not execute the action; CHALIN's server-side review, confirmation, permission and executor controls remain authoritative.",
        "Never invent a phone number, customer ID, branch ID, amount, sale ID, recipient, message body, reason or other material field.",
        "Use a value only when it is explicit in the user's request, supplied server context, or approved evidence.",
        "For questions such as why something happened, what the business is doing, analysis, investigation or advice, do not call an action tool unless the user also clearly asks for a change.",
        "If required information is missing or ambiguous, make no tool call. Do not substitute a vaguely similar action.",
        `You may request at most ${MAX_PLANNED_ACTIONS} independent proposals in one turn.`,
        `Server context: ${JSON.stringify(context)}`,
      ].join("\n"),
    }),
    Object.freeze({ role: "user", content: clean(message, 8000) }),
  ]);
}

function withScopeDefaults(definition, input = {}, { scope, result } = {}) {
  const payload = input && typeof input === "object" ? { ...input } : {};
  const properties = definition?.input_schema?.properties || {};
  if (Object.hasOwn(properties, "branch_id") && !payload.branch_id && scope?.branch_id) {
    payload.branch_id = Number(scope.branch_id);
  }
  if (
    Object.hasOwn(properties, "conversation_key") &&
    !payload.conversation_key &&
    result?.conversation_key
  ) {
    payload.conversation_key = result.conversation_key;
  }
  return payload;
}

function missingRequiredFields(definition, payload = {}) {
  return (definition?.input_schema?.required || []).filter((field) => {
    const value = payload?.[field];
    return value === undefined || value === null || (typeof value === "string" && !value.trim());
  });
}

function actionPlanNotice(states = []) {
  if (!states.length) return "";
  return states
    .map((state) => {
      if (state.status === "needs_input") {
        return `I can prepare ${state.title}, but I still need: ${state.missing_fields.join(", ")}. Nothing was sent or changed.`;
      }
      if (state.status === "pending_review") {
        return `I prepared ${state.title} as governed proposal ${state.proposal_key}. It has not executed. An independent review is required first; after approval, execute it with the exact confirmation “${state.expected_confirmation}”.`;
      }
      if (state.status === "approved") {
        return `I prepared ${state.title} as governed proposal ${state.proposal_key}. It has not executed yet. To proceed, confirm exactly: “${state.expected_confirmation}”.`;
      }
      return `I prepared ${state.title} as proposal ${state.proposal_key || ""}. No business write has executed.`.trim();
    })
    .join("\n\n");
}

async function governedPlanningProviderCall({ req, persona, scope, message, result, catalogue, provider, env }) {
  const messages = planningMessages({
    message,
    evidence: result?.evidence || [],
    result,
  });
  const budget = buildRequestBudget({ messages, tools: catalogue.tools, env });
  const [dailyUsage, monthlyCost] = await Promise.all([
    getDailyUsage({
      userId: req.user.id,
      workspaceCode: scope.workspace_code,
    }),
    getMonthlyCost(),
  ]);

  assertDailyUsage({
    userTokens: dailyUsage.user_tokens,
    workspaceTokens: dailyUsage.workspace_tokens,
    budget,
  });
  assertMonthlyCost({
    usedMicros: monthlyCost,
    additionalMicros: 0,
    budget,
  });

  const planning = await generateProviderResponse({
    provider,
    messages,
    tools: catalogue.tools,
    maxOutputTokens: Math.min(600, budget.maximum_output_tokens),
    providerContext: {
      persona,
      intent: "governed_action_planning",
      live_data_required: false,
      workspace_code: scope.workspace_code,
      // Action planning is a privileged CHALIN operation even when the user's
      // sentence contains no private literal. Mark it sensitive so the normal
      // public-safe rewrite cannot discard the proposal-tool catalogue.
      data_classification: "sensitive",
      full_context_active: false,
    },
    env,
  });

  const planningTokens = Number(planning.input_tokens || 0) + Number(planning.output_tokens || 0);

  // The provider call has already happened, so always account for its usage
  // before any post-call ceiling prevents proposal creation.
  await recordUsage({
    userId: req.user.id,
    conversationId: null,
    messageId: null,
    providerKey: planning.provider_key,
    modelKey: planning.model_key,
    workspaceCode: scope.workspace_code,
    inputTokens: planning.input_tokens,
    outputTokens: planning.output_tokens,
    costMicros: planning.cost_micros,
    requestId: req.requestId,
  });

  assertDailyUsage({
    userTokens: Number(dailyUsage.user_tokens || 0) + planningTokens,
    workspaceTokens: Number(dailyUsage.workspace_tokens || 0) + planningTokens,
    budget,
  });
  assertMonthlyCost({
    usedMicros: monthlyCost,
    additionalMicros: planning.cost_micros,
    budget,
  });

  return planning;
}

async function planGovernedActions({ req, persona, message, result, provider = null, env = process.env } = {}) {
  if (!isFeatureEnabled("aiActions") || !looksLikeActionRequest(message) || result?.action) {
    return result;
  }

  const scope = resolveAiScope({ req, persona });
  const catalogue = availableProposalTools({ user: req.user, persona, scope });
  if (!catalogue.tools.length) return result;

  const planning = await governedPlanningProviderCall({
    req,
    persona,
    scope,
    message,
    result,
    catalogue,
    provider,
    env,
  });

  const calls = (planning.tool_calls || []).slice(0, MAX_PLANNED_ACTIONS);
  if (!calls.length) return result;

  const states = [];
  for (const call of calls) {
    const actionKey = catalogue.actionByTool.get(String(call.tool_key || ""));
    const definition = actionKey ? aiActionRegistry.get(actionKey) : null;
    if (!definition) continue;

    const payload = withScopeDefaults(definition, call.input || {}, { scope, result });
    const missing = missingRequiredFields(definition, payload);
    if (missing.length) {
      states.push(Object.freeze({
        action_key: definition.key,
        title: definition.title,
        risk_level: definition.risk_level,
        status: "needs_input",
        missing_fields: Object.freeze(missing),
        execution_performed: false,
      }));
      continue;
    }

    try {
      const proposal = await createActionProposal({
        input: {
          action_key: definition.key,
          persona,
          scope,
          title: definition.title,
          summary: clean(message, 2000),
          payload,
          evidence: result?.evidence || [],
        },
        user: req.user,
        req,
      });
      states.push(Object.freeze({
        action_key: definition.key,
        title: definition.title,
        risk_level: definition.risk_level,
        proposal_key: proposal.proposal_key,
        status: proposal.status,
        review_required: proposal.status === "pending_review",
        confirmation_mode: definition.confirmation_mode,
        expected_confirmation:
          expectedActionConfirmation({ proposal_key: proposal.proposal_key }, definition) || null,
        execution_performed: false,
      }));
    } catch (error) {
      states.push(Object.freeze({
        action_key: definition.key,
        title: definition.title,
        risk_level: definition.risk_level,
        status: "blocked",
        reason: clean(error?.message, 800) || "The action proposal was blocked safely.",
        error_code: clean(error?.code, 120) || "AI_ACTION_PROPOSAL_FAILED",
        execution_performed: false,
      }));
    }
  }

  if (!states.length) return result;
  const notice = actionPlanNotice(states.filter((state) => state.status !== "blocked"));
  const blocked = states.filter((state) => state.status === "blocked");
  const blockedNotice = blocked.length
    ? blocked.map((state) => `I could not prepare ${state.title}: ${state.reason}`).join("\n")
    : "";
  const answer = [notice, blockedNotice].filter(Boolean).join("\n\n") || result?.answer || "";
  const nextResult = Object.freeze({
    ...result,
    answer,
    action: states.length === 1 ? states[0] : result?.action || null,
    agent_actions: Object.freeze(states),
    action_planning: Object.freeze({
      planner: "llm_structured_tool_selection",
      proposal_only: true,
      requested_count: calls.length,
      prepared_count: states.filter((state) => state.proposal_key).length,
      execution_performed: false,
      provider_key: planning.provider_key,
      model_key: planning.model_key,
      usage_recorded: true,
    }),
  });

  if (answer && result?.message_key && result?.conversation_key && req?.user?.id) {
    await replaceOwnedAssistantMessage({
      messageKey: result.message_key,
      conversationKey: result.conversation_key,
      userId: req.user.id,
      content: answer,
    }).catch(() => null);
  }

  return nextResult;
}

module.exports = {
  ACTION_REQUEST_SIGNAL,
  MAX_PLANNED_ACTIONS,
  actionPlanNotice,
  availableProposalTools,
  canProposeDefinition,
  clean,
  compactEvidence,
  contentHash,
  governedPlanningProviderCall,
  looksLikeActionRequest,
  missingRequiredFields,
  planGovernedActions,
  planningMessages,
  proposalToolKey,
  replaceOwnedAssistantMessage,
  withScopeDefaults,
};