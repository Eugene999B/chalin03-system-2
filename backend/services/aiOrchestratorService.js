"use strict";

const { pool } = require("../config/db");
const {
  hasEveryAiPermission,
  normalizeAiPersona,
} = require("../security/aiPermissionCatalog");
const {
  assertDailyUsage,
  assertMonthlyCost,
  assertToolCallBudget,
  buildRequestBudget,
} = require("./aiCostControlService");
const {
  addMessage,
  createConversation,
  loadOwnedConversation,
} = require("./aiConversationService");
const {
  assertEvidenceRequired,
  evidenceCitationMap,
  evidencePromptBlock,
  normalizeEvidenceList,
} = require("./aiEvidenceService");
const { searchApprovedKnowledge } = require("./aiKnowledgeService");
const { resolveAiScope } = require("./aiPermissionService");
const { generateProviderResponse } = require("./aiProviderService");
const {
  AiSafetyError,
  inspectPrompt,
} = require("./aiSafetyService");
const { aiToolRegistry } = require("./aiToolRegistry");
const {
  completeToolInvocation,
  startToolInvocation,
  writeAiAuditEvent,
  writePromptSafetyEvent,
} = require("./aiAuditService");
const {
  getDailyUsage,
  getMonthlyCost,
  recordUsage,
} = require("./aiUsageService");

const PERSONA_INSTRUCTIONS = Object.freeze({
  copilot:
    "You are Chalin Copilot. Use only supplied approved evidence and registered tool results. Respect the active workspace and location. Cite evidence as [E1], [E2], and clearly state limitations. Never claim to execute a business change.",
  executive:
    "You are Chalin Executive. Treat the conversation as private executive intelligence. Use only supplied approved evidence and registered tools. Cite evidence as [E1], [E2]. Separate facts, calculations, assumptions and scenarios. Never claim to approve or execute an operational change.",
  guide:
    "You are Chalin Guide. Use only published public evidence and public tools. Do not request or expose customer, staff, financial, operational or security data. Cite evidence as [E1], [E2] and offer human handoff when evidence is insufficient.",
});

class AiOrchestratorError extends Error {
  constructor(message, { code = "AI_ORCHESTRATOR_ERROR", statusCode = 500, details = [] } = {}) {
    super(message);
    this.name = "AiOrchestratorError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function availableTools({ persona, scope, user }) {
  return aiToolRegistry
    .list({ persona, workspace: scope.workspace_code })
    .filter((tool) => hasEveryAiPermission(user, tool.required_permissions));
}

function providerMessages({ persona, history = [], prompt, evidence, toolResults = [] }) {
  const messages = [
    { role: "system", content: PERSONA_INSTRUCTIONS[persona] },
    {
      role: "system",
      content: `Approved evidence for this request:\n${evidencePromptBlock(evidence)}`,
    },
  ];
  for (const item of history.slice(-20)) {
    if (!["user", "assistant"].includes(item.role)) continue;
    messages.push({ role: item.role, content: item.content });
  }
  messages.push({ role: "user", content: prompt });
  for (const result of toolResults) {
    messages.push({
      role: "tool",
      content: JSON.stringify({
        tool_key: result.tool.key,
        output: result.output,
        evidence: result.evidence,
      }),
    });
  }
  return messages;
}

async function conversationHistory(connection, conversationId) {
  const [rows] = await connection.query(
    `SELECT message_role, content_text
     FROM ai_messages
     WHERE conversation_id = ? AND message_role IN ('user', 'assistant')
     ORDER BY id DESC LIMIT 20`,
    [conversationId]
  );
  return rows.reverse().map((row) => ({
    role: row.message_role,
    content: row.content_text || "",
  }));
}

async function persistEvidence({ connection = pool, messageId, invocationId = null, evidence }) {
  for (const item of normalizeEvidenceList(evidence)) {
    await connection.query(
      `INSERT INTO ai_evidence_records (
         message_id, invocation_id, source_type, source_ref, source_version,
         label, excerpt_text, as_of_at, classification, workspace_code, metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        messageId || null,
        invocationId || null,
        item.source_type,
        item.source_ref,
        item.source_version,
        item.label,
        item.excerpt_text,
        item.as_of_at ? new Date(item.as_of_at) : null,
        item.classification,
        item.workspace_code,
        JSON.stringify(item.metadata || {}).slice(0, 16000),
      ]
    );
  }
}

async function executeRequestedTools({
  req,
  persona,
  toolCalls,
  assistantMessageId,
  budget,
} = {}) {
  assertToolCallBudget(toolCalls.length, budget);
  const results = [];

  for (const call of toolCalls) {
    const tool = aiToolRegistry.get(call.tool_key);
    const invocation = await startToolInvocation({
      req,
      messageId: assistantMessageId,
      tool,
      persona,
      scope: resolveAiScope({ req, persona }),
      inputSha256: require("./aiToolRegistry").hashJson(call.input || {}),
      inputSummary: require("./aiToolRegistry").safeSummary(call.input || {}),
      permissionSnapshot: req.aiPermissionSnapshot || null,
    });

    try {
      const executed = await aiToolRegistry.execute({
        toolKey: call.tool_key,
        input: call.input || {},
        req,
        persona,
      });
      const evidence = assertEvidenceRequired(
        executed.tool,
        executed.output?.evidence || []
      );
      await persistEvidence({
        messageId: assistantMessageId,
        invocationId: invocation.id,
        evidence,
      });
      await completeToolInvocation({
        invocationId: invocation.id,
        status: "succeeded",
        outputSummary: executed.output_summary,
        evidenceCount: evidence.length,
        latencyMs: executed.latency_ms,
      });
      results.push(Object.freeze({ ...executed, evidence }));
    } catch (error) {
      await completeToolInvocation({
        invocationId: invocation.id,
        status:
          String(error?.code || "").includes("DENIED") ||
          String(error?.code || "").includes("DISABLED")
            ? "blocked"
            : "failed",
        errorCode: error?.code || "AI_TOOL_FAILED",
        errorMessage: error?.message || "AI tool failed safely.",
      });
      throw error;
    }
  }

  return Object.freeze(results);
}

async function ensureConversation({ req, persona, scope, conversationKey = null }) {
  if (conversationKey) {
    const existing = await loadOwnedConversation({
      conversationKey,
      userId: req.user.id,
    });
    if (
      existing.persona !== persona ||
      existing.workspace_code !== scope.workspace_code ||
      Number(existing.branch_id || 0) !== Number(scope.branch_id || 0) ||
      Number(existing.mining_site_id || 0) !== Number(scope.mining_site_id || 0) ||
      Number(existing.hire_location_id || 0) !== Number(scope.hire_location_id || 0)
    ) {
      throw new AiOrchestratorError(
        "The conversation belongs to a different intelligence scope.",
        { code: "AI_CONVERSATION_SCOPE_MISMATCH", statusCode: 409 }
      );
    }
    if (existing.conversation_status !== "active") {
      throw new AiOrchestratorError("This conversation is not active.", {
        code: "AI_CONVERSATION_NOT_ACTIVE",
        statusCode: 409,
      });
    }
    return existing;
  }

  const created = await createConversation({
    persona,
    userId: req.user.id,
    scope,
    title: "New conversation",
  });
  return loadOwnedConversation({
    conversationKey: created.key,
    userId: req.user.id,
  });
}

async function runAiConversationTurn({
  req,
  persona = "copilot",
  conversationKey = null,
  message,
  provider = null,
  env = process.env,
} = {}) {
  const normalizedPersona = normalizeAiPersona(persona);
  if (!normalizedPersona || normalizedPersona === "guide") {
    throw new AiOrchestratorError("This staff endpoint supports Copilot or Executive only.", {
      code: "AI_PERSONA_INVALID",
      statusCode: 400,
    });
  }

  const scope = resolveAiScope({ req, persona: normalizedPersona });
  const promptInspection = inspectPrompt(message, {
    allowHighRiskDiscussion: true,
  });
  const conversation = await ensureConversation({
    req,
    persona: normalizedPersona,
    scope,
    conversationKey,
  });

  let userMessage = null;
  try {
    userMessage = await addMessage({
      conversationId: conversation.id,
      role: "user",
      content: promptInspection.text,
      safetyStatus: promptInspection.action,
      createdBy: req.user.id,
    });
    await writePromptSafetyEvent({
      req,
      userId: req.user.id,
      conversationId: conversation.id,
      messageId: userMessage.id,
      eventType:
        promptInspection.redaction_count > 0 ? "sensitive_data" : "other",
      action: promptInspection.action,
      patternKeys: promptInspection.pattern_keys,
      redactionCount: promptInspection.redaction_count,
      inputSha256: promptInspection.input_sha256,
      safeSummary: promptInspection.safe_summary,
    });

    const history = await conversationHistory(pool, conversation.id);
    const knowledgeEvidence = await searchApprovedKnowledge({
      query: promptInspection.text,
      persona: normalizedPersona,
      workspaceCode: scope.workspace_code,
      limit: 8,
    });
    const tools = availableTools({
      persona: normalizedPersona,
      scope,
      user: req.user,
    });
    const initialMessages = providerMessages({
      persona: normalizedPersona,
      history,
      prompt: promptInspection.text,
      evidence: knowledgeEvidence,
    });
    const budget = buildRequestBudget({ messages: initialMessages, tools, env });
    const [dailyUsage, monthlyCost] = await Promise.all([
      getDailyUsage({ userId: req.user.id, workspaceCode: scope.workspace_code }),
      getMonthlyCost(),
    ]);
    assertDailyUsage({
      userTokens: dailyUsage.user_tokens,
      workspaceTokens: dailyUsage.workspace_tokens,
      budget,
    });
    assertMonthlyCost({ usedMicros: monthlyCost, additionalMicros: 0, budget });

    let providerResult = await generateProviderResponse({
      provider,
      messages: initialMessages,
      tools,
      maxOutputTokens: budget.maximum_output_tokens,
      env,
    });

    const provisionalAssistant = await addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: providerResult.text,
      safetyStatus: "allowed",
      providerKey: providerResult.provider_key,
      modelKey: providerResult.model_key,
      inputTokens: providerResult.input_tokens,
      outputTokens: providerResult.output_tokens,
      latencyMs: providerResult.latency_ms,
      finishReason: providerResult.finish_reason,
      createdBy: req.user.id,
    });

    let toolResults = [];
    if (providerResult.tool_calls.length > 0) {
      toolResults = await executeRequestedTools({
        req,
        persona: normalizedPersona,
        toolCalls: providerResult.tool_calls,
        assistantMessageId: provisionalAssistant.id,
        budget,
      });
      const combinedEvidence = normalizeEvidenceList([
        ...knowledgeEvidence,
        ...toolResults.flatMap((result) => result.evidence || []),
      ]);
      providerResult = await generateProviderResponse({
        provider,
        messages: providerMessages({
          persona: normalizedPersona,
          history,
          prompt: promptInspection.text,
          evidence: combinedEvidence,
          toolResults,
        }),
        tools: [],
        maxOutputTokens: budget.maximum_output_tokens,
        env,
      });
      await pool.query(
        `UPDATE ai_messages
         SET content_text = ?, content_sha256 = ?, provider_key = ?, model_key = ?,
             input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
             latency_ms = COALESCE(latency_ms, 0) + ?, finish_reason = ?
         WHERE id = ?`,
        [
          providerResult.text,
          require("./aiSafetyService").hashText(providerResult.text),
          providerResult.provider_key,
          providerResult.model_key,
          providerResult.input_tokens,
          providerResult.output_tokens,
          providerResult.latency_ms,
          providerResult.finish_reason,
          provisionalAssistant.id,
        ]
      );
    }

    const finalEvidence = normalizeEvidenceList([
      ...knowledgeEvidence,
      ...toolResults.flatMap((result) => result.evidence || []),
    ]);
    await persistEvidence({
      messageId: provisionalAssistant.id,
      evidence: finalEvidence,
    });
    const totalInputTokens = providerResult.input_tokens;
    const totalOutputTokens = providerResult.output_tokens;
    await recordUsage({
      userId: req.user.id,
      conversationId: conversation.id,
      messageId: provisionalAssistant.id,
      providerKey: providerResult.provider_key,
      modelKey: providerResult.model_key,
      workspaceCode: scope.workspace_code,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costMicros: 0,
      requestId: req.requestId,
    });
    await writeAiAuditEvent({
      req,
      userId: req.user.id,
      conversationId: conversation.id,
      messageId: provisionalAssistant.id,
      eventType: "AI_CONVERSATION_TURN_COMPLETED",
      outcome: "success",
      severity: "info",
      persona: normalizedPersona,
      scope,
      metadata: {
        provider_key: providerResult.provider_key,
        model_key: providerResult.model_key,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        tool_count: toolResults.length,
        evidence_count: finalEvidence.length,
        prompt_sha256: promptInspection.input_sha256,
      },
    });

    return Object.freeze({
      conversation_key: conversation.conversation_key,
      message_key: provisionalAssistant.key,
      persona: normalizedPersona,
      answer: providerResult.text,
      evidence: finalEvidence,
      citations: evidenceCitationMap(finalEvidence),
      provider: Object.freeze({
        key: providerResult.provider_key,
        model: providerResult.model_key,
        finish_reason: providerResult.finish_reason,
      }),
      usage: Object.freeze({
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cost_micros: 0,
      }),
    });
  } catch (error) {
    const safety = error instanceof AiSafetyError;
    if (userMessage) {
      await addMessage({
        conversationId: conversation.id,
        role: "assistant",
        content:
          "CHALIN ONE intelligence could not complete this request safely. Ordinary system operations are unaffected.",
        safetyStatus: safety ? "blocked" : "error",
        errorCode: error?.code || "AI_REQUEST_FAILED",
        createdBy: req.user.id,
      }).catch(() => null);
    }
    await writeAiAuditEvent({
      req,
      userId: req.user.id,
      conversationId: conversation.id,
      messageId: userMessage?.id || null,
      eventType: "AI_CONVERSATION_TURN_FAILED",
      outcome: safety ? "blocked" : "failed",
      severity: safety ? "high" : "warning",
      persona: normalizedPersona,
      scope,
      metadata: {
        error_code: error?.code || "AI_REQUEST_FAILED",
        prompt_sha256: promptInspection.input_sha256,
      },
    }).catch(() => null);
    throw error;
  }
}

module.exports = {
  AiOrchestratorError,
  PERSONA_INSTRUCTIONS,
  availableTools,
  conversationHistory,
  ensureConversation,
  executeRequestedTools,
  persistEvidence,
  providerMessages,
  runAiConversationTurn,
};
