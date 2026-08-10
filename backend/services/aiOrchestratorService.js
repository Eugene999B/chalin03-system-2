"use strict";

const { pool } = require("../config/db");
const {
  hasEveryAiPermission,
  normalizeAiPersona,
} = require("../security/aiPermissionCatalog");
const { hasEveryPermission } = require("../security/permissionCatalog");
const { hasEquipmentDivisionAccess } = require("../security/equipmentDivisionAccess");
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
const { searchGovernedKnowledge } = require("./aiKnowledgeRetrievalService");
const { resolveAiScope } = require("./aiPermissionService");
const { generateProviderResponse } = require("./aiProviderService");
const {
  assessEvidenceConfidence,
  buildReasoningPlan,
  citationIntegrity,
  detectEvidenceTensions,
  rankEvidence,
  reasoningPromptBlock,
  selectRelevantHistory,
} = require("./aiReasoningService");
const {
  AiSafetyError,
  hashText,
  inspectPrompt,
  redactSensitiveText,
} = require("./aiSafetyService");
const {
  aiToolRegistry,
  hashJson,
  safeSummary,
} = require("./aiToolRegistry");
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
    "You are Chalin Copilot, a highly capable governed business intelligence partner. Use only supplied approved evidence and registered tool results. Respect the active workspace and location. For current operational facts, prefer governed live tools over static knowledge. Cite evidence as [E1], [E2], distinguish facts from inference and unknowns, and clearly state limitations. Never claim to execute a business change.",
  executive:
    "You are Chalin Executive, a rigorous private executive intelligence partner. Use only supplied approved evidence and registered tools. For current operational facts, prefer governed live tools over static knowledge. Cite evidence as [E1], [E2]. Separate facts, calculations, assumptions, scenarios, risks and unknowns. Compare competing explanations before making recommendations. Never claim to approve or execute an operational change.",
  guide:
    "You are Chalin Guide. Use only published public evidence and public tools. Do not request or expose customer, staff, financial, operational or security data. Cite evidence as [E1], [E2] and offer human handoff when evidence is insufficient. Never claim to execute, approve or complete a business action.",
});

class AiOrchestratorError extends Error {
  constructor(
    message,
    { code = "AI_ORCHESTRATOR_ERROR", statusCode = 500, details = [] } = {}
  ) {
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
    .filter(
      (tool) =>
        hasEveryAiPermission(user, tool.required_permissions) &&
        hasEveryPermission(user, tool.required_business_permissions || []) &&
        (!tool.required_equipment_division ||
          hasEquipmentDivisionAccess(user, tool.required_equipment_division))
    );
}

function compactToolResults(toolResults = []) {
  return toolResults.map((result) => ({
    tool_key: result?.tool?.key || "unknown",
    output: safeSummary(result?.output || {}, 2200),
    evidence_count: Array.isArray(result?.evidence) ? result.evidence.length : 0,
  }));
}

function providerMessages({
  persona,
  history = [],
  prompt,
  evidence,
  toolResults = [],
  reasoningBrief = "",
}) {
  const relevantHistory = selectRelevantHistory(history, prompt);
  const messages = [
    { role: "system", content: PERSONA_INSTRUCTIONS[persona] },
  ];
  if (reasoningBrief) {
    messages.push({ role: "system", content: reasoningBrief });
  }
  messages.push({
    role: "system",
    content: `Approved evidence for this request:\n${evidencePromptBlock(evidence)}`,
  });

  for (const item of relevantHistory) {
    if (!["user", "assistant"].includes(item.role)) continue;
    messages.push({ role: item.role, content: item.content });
  }
  messages.push({ role: "user", content: prompt });

  if (toolResults.length > 0) {
    messages.push({
      role: "tool",
      content: JSON.stringify({
        note: "Governed tool outputs. Detailed source excerpts are in the approved evidence block.",
        results: compactToolResults(toolResults),
      }),
    });
  }
  return messages;
}

async function conversationHistory(connection, conversationId) {
  const [rows] = await connection.query(
    `SELECT message_role, content_text
     FROM ai_messages
     WHERE conversation_id = ?
       AND message_role IN ('user', 'assistant')
     ORDER BY id DESC LIMIT 40`,
    [conversationId]
  );
  return rows.reverse().map((row) => ({
    role: row.message_role,
    content: row.content_text || "",
  }));
}

async function persistEvidence({
  connection = pool,
  messageId,
  invocationId = null,
  evidence,
}) {
  for (const item of normalizeEvidenceList(evidence)) {
    await connection.query(
      `INSERT INTO ai_evidence_records (
         message_id, invocation_id, source_type, source_ref, source_version,
         label, excerpt_text, as_of_at, classification, workspace_code,
         metadata_json
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
      inputSha256: hashJson(call.input || {}),
      inputSummary: safeSummary(call.input || {}),
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

async function ensureConversation({
  req,
  persona,
  scope,
  conversationKey = null,
}) {
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

function sumProviderUsage(results) {
  return Object.freeze({
    input_tokens: results.reduce(
      (sum, result) => sum + Number(result?.input_tokens || 0),
      0
    ),
    output_tokens: results.reduce(
      (sum, result) => sum + Number(result?.output_tokens || 0),
      0
    ),
    latency_ms: results.reduce(
      (sum, result) => sum + Number(result?.latency_ms || 0),
      0
    ),
  });
}

async function retrieveAutomaticEvidence({
  query,
  persona,
  workspaceCode = null,
  limit = 12,
  history = [],
} = {}) {
  const safeLimit = Math.max(1, Math.min(12, Number(limit) || 12));
  const plan = buildReasoningPlan({
    prompt: query,
    history,
    persona,
  });
  const batches = await Promise.all(
    plan.retrieval_queries.map((focusedQuery) =>
      searchGovernedKnowledge({
        query: focusedQuery,
        persona,
        workspaceCode,
        limit: Math.min(8, safeLimit),
      })
    )
  );
  return rankEvidence({
    evidence: batches.flat(),
    queries: plan.retrieval_queries,
    limit: safeLimit,
  });
}

async function auditBlockedPrompt({
  req,
  conversation,
  persona,
  scope,
  message,
  error,
}) {
  const redacted = redactSensitiveText(String(message || ""));
  await writePromptSafetyEvent({
    req,
    userId: req.user.id,
    conversationId: conversation.id,
    eventType:
      error?.code === "AI_PROMPT_INJECTION_BLOCKED"
        ? "prompt_injection"
        : error?.code === "AI_SECRET_REQUEST_BLOCKED"
          ? "secret_request"
          : "other",
    action: "blocked",
    patternKeys: error?.details || [],
    redactionCount: redacted.redaction_count,
    inputSha256: hashText(String(message || "")),
    safeSummary: redacted.text.slice(0, 500),
  }).catch(() => null);
  await writeAiAuditEvent({
    req,
    userId: req.user.id,
    conversationId: conversation.id,
    eventType: "AI_PROMPT_BLOCKED",
    outcome: "blocked",
    severity: "high",
    persona,
    scope,
    metadata: {
      error_code: error?.code || "AI_SAFETY_BLOCKED",
      prompt_sha256: hashText(String(message || "")),
    },
  }).catch(() => null);
}

function confidenceWithCitationReview(confidence, citationReview) {
  if (
    confidence?.level === "high" &&
    citationReview?.citation_required &&
    !citationReview?.citation_present
  ) {
    return Object.freeze({
      ...confidence,
      level: "medium",
      reasons: Object.freeze([
        ...(confidence.reasons || []),
        "the final answer did not cite the approved evidence inline",
      ].slice(0, 5)),
    });
  }
  return confidence;
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
    throw new AiOrchestratorError(
      "This staff endpoint supports Copilot or Executive only.",
      { code: "AI_PERSONA_INVALID", statusCode: 400 }
    );
  }

  const scope = resolveAiScope({ req, persona: normalizedPersona });
  const conversation = await ensureConversation({
    req,
    persona: normalizedPersona,
    scope,
    conversationKey,
  });
  const history = await conversationHistory(pool, conversation.id);

  let promptInspection = null;
  let userMessage = null;
  let assistantMessage = null;

  try {
    promptInspection = inspectPrompt(message, {
      allowHighRiskDiscussion: true,
    });
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

    const reasoningPlan = buildReasoningPlan({
      prompt: promptInspection.text,
      history,
      persona: normalizedPersona,
    });
    const knowledgeEvidence = await retrieveAutomaticEvidence({
      query: promptInspection.text,
      persona: normalizedPersona,
      workspaceCode: scope.workspace_code,
      limit: 12,
      history,
    });
    let finalEvidence = knowledgeEvidence;
    let tensions = detectEvidenceTensions(finalEvidence);
    let confidence = assessEvidenceConfidence({
      evidence: finalEvidence,
      tensions,
      liveDataRequired: reasoningPlan.live_data_required,
      toolResults: [],
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
      evidence: finalEvidence,
      reasoningBrief: reasoningPromptBlock({
        plan: reasoningPlan,
        confidence,
        tensions,
      }),
    });
    const budget = buildRequestBudget({
      messages: initialMessages,
      tools,
      env,
    });
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

    const providerRounds = [];
    const initialResult = await generateProviderResponse({
      provider,
      messages: initialMessages,
      tools,
      maxOutputTokens: budget.maximum_output_tokens,
      env,
    });
    providerRounds.push(initialResult);

    assistantMessage = await addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: initialResult.text,
      safetyStatus: "allowed",
      providerKey: initialResult.provider_key,
      modelKey: initialResult.model_key,
      inputTokens: initialResult.input_tokens,
      outputTokens: initialResult.output_tokens,
      latencyMs: initialResult.latency_ms,
      finishReason: initialResult.finish_reason,
      createdBy: req.user.id,
    });

    let finalResult = initialResult;
    let toolResults = [];
    if (initialResult.tool_calls.length > 0) {
      toolResults = await executeRequestedTools({
        req,
        persona: normalizedPersona,
        toolCalls: initialResult.tool_calls,
        assistantMessageId: assistantMessage.id,
        budget,
      });
      finalEvidence = rankEvidence({
        evidence: [
          ...knowledgeEvidence,
          ...toolResults.flatMap((result) => result.evidence || []),
        ],
        queries: reasoningPlan.retrieval_queries,
        limit: 12,
      });
      tensions = detectEvidenceTensions(finalEvidence);
      confidence = assessEvidenceConfidence({
        evidence: finalEvidence,
        tensions,
        liveDataRequired: reasoningPlan.live_data_required,
        toolResults,
      });
      finalResult = await generateProviderResponse({
        provider,
        messages: providerMessages({
          persona: normalizedPersona,
          history,
          prompt: promptInspection.text,
          evidence: finalEvidence,
          toolResults,
          reasoningBrief: reasoningPromptBlock({
            plan: reasoningPlan,
            confidence,
            tensions,
          }),
        }),
        tools: [],
        maxOutputTokens: budget.maximum_output_tokens,
        env,
      });
      providerRounds.push(finalResult);
      await pool.query(
        `UPDATE ai_messages
         SET content_text = ?, content_sha256 = ?, provider_key = ?,
             model_key = ?, input_tokens = input_tokens + ?,
             output_tokens = output_tokens + ?,
             latency_ms = COALESCE(latency_ms, 0) + ?, finish_reason = ?
         WHERE id = ?`,
        [
          finalResult.text,
          hashText(finalResult.text),
          finalResult.provider_key,
          finalResult.model_key,
          finalResult.input_tokens,
          finalResult.output_tokens,
          finalResult.latency_ms,
          finalResult.finish_reason,
          assistantMessage.id,
        ]
      );
    }

    const citationReview = citationIntegrity(finalResult.text, finalEvidence);
    if (!citationReview.valid) {
      throw new AiOrchestratorError(
        "The AI provider cited evidence that was not supplied to the answer.",
        {
          code: "AI_CITATION_INTEGRITY_FAILED",
          statusCode: 502,
          details: citationReview.unsupported,
        }
      );
    }
    confidence = confidenceWithCitationReview(confidence, citationReview);

    await persistEvidence({
      messageId: assistantMessage.id,
      evidence: finalEvidence,
    });

    const totalUsage = sumProviderUsage(providerRounds);
    await recordUsage({
      userId: req.user.id,
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      providerKey: finalResult.provider_key,
      modelKey: finalResult.model_key,
      workspaceCode: scope.workspace_code,
      inputTokens: totalUsage.input_tokens,
      outputTokens: totalUsage.output_tokens,
      costMicros: 0,
      requestId: req.requestId,
    });
    await writeAiAuditEvent({
      req,
      userId: req.user.id,
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      eventType: "AI_CONVERSATION_TURN_COMPLETED",
      outcome: "success",
      severity: "info",
      persona: normalizedPersona,
      scope,
      metadata: {
        provider_key: finalResult.provider_key,
        model_key: finalResult.model_key,
        provider_round_count: providerRounds.length,
        input_tokens: totalUsage.input_tokens,
        output_tokens: totalUsage.output_tokens,
        tool_count: toolResults.length,
        evidence_count: finalEvidence.length,
        reasoning_intent: reasoningPlan.intent,
        reasoning_confidence: confidence.level,
        live_data_required: reasoningPlan.live_data_required,
        live_tools_used: confidence.live_tools_used,
        tension_count: tensions.length,
        citation_present: citationReview.citation_present,
        prompt_sha256: promptInspection.input_sha256,
      },
    });

    return Object.freeze({
      conversation_key: conversation.conversation_key,
      message_key: assistantMessage.key,
      persona: normalizedPersona,
      answer: finalResult.text,
      evidence: finalEvidence,
      citations: evidenceCitationMap(finalEvidence),
      reasoning: Object.freeze({
        intent: reasoningPlan.intent,
        live_data_required: reasoningPlan.live_data_required,
        retrieval_query_count: reasoningPlan.retrieval_queries.length,
        evidence_confidence: confidence,
        tensions,
        citation_integrity: citationReview,
        hidden_chain_of_thought_exposed: false,
      }),
      provider: Object.freeze({
        key: finalResult.provider_key,
        model: finalResult.model_key,
        finish_reason: finalResult.finish_reason,
        rounds: providerRounds.length,
      }),
      usage: Object.freeze({
        input_tokens: totalUsage.input_tokens,
        output_tokens: totalUsage.output_tokens,
        cost_micros: 0,
      }),
    });
  } catch (error) {
    const safety = error instanceof AiSafetyError;
    if (safety && !userMessage) {
      await auditBlockedPrompt({
        req,
        conversation,
        persona: normalizedPersona,
        scope,
        message,
        error,
      });
    } else {
      if (userMessage && !assistantMessage) {
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
        messageId: userMessage?.id || assistantMessage?.id || null,
        eventType: "AI_CONVERSATION_TURN_FAILED",
        outcome: safety ? "blocked" : "failed",
        severity: safety ? "high" : "warning",
        persona: normalizedPersona,
        scope,
        metadata: {
          error_code: error?.code || "AI_REQUEST_FAILED",
          prompt_sha256:
            promptInspection?.input_sha256 || hashText(String(message || "")),
        },
      }).catch(() => null);
    }
    throw error;
  }
}

module.exports = {
  AiOrchestratorError,
  PERSONA_INSTRUCTIONS,
  auditBlockedPrompt,
  availableTools,
  compactToolResults,
  confidenceWithCitationReview,
  conversationHistory,
  ensureConversation,
  executeRequestedTools,
  persistEvidence,
  providerMessages,
  retrieveAutomaticEvidence,
  runAiConversationTurn,
  sumProviderUsage,
};
