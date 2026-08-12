"use strict";

const {
  addMessage,
  createConversation,
  deriveConversationTitle,
  loadOwnedConversation,
  sameScope,
} = require("./aiConversationService");
const { inspectPrompt } = require("./aiSafetyService");
const {
  writeAiAuditEvent,
  writePromptSafetyEvent,
} = require("./aiAuditService");

const DOCUMENT_ACTION_PATTERN = /\b(?:generate|create|make|prepare|export|download|produce|build|give me|put together|turn into)\b/i;
const DOCUMENT_NOUN_PATTERN = /\b(?:document|report|statement|file|spreadsheet|workbook|pdf|word|docx|excel|xlsx|csv)\b/i;
const DOCUMENT_TOPIC_PATTERN = /\b(?:sales?|stock|inventory|debts?|collections?|customers?|expenses?|payroll|salary|audit|mining|production|hire|finance|arrears|payments?|profit|performance|operations?)\b/i;
const FORMAT_PATTERN = /\b(?:pdf|word|docx|excel|xlsx|spreadsheet|csv)\b/i;
const PERIOD_PATTERN = /\b(?:today|yesterday|this\s+week|last\s+week|this\s+month|last\s+month|this\s+year|last\s+year|current(?:ly)?|right\s+now|from\s+\d{4}-\d{2}-\d{2}|to\s+\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2})\b/i;
const TIME_BOUND_TOPIC_PATTERN = /\b(?:sales?|stock|inventory|debts?|collections?|expenses?|payroll|salary|audit|mining|production|hire|finance|arrears|payments?|profit|performance|operations?)\b/i;

function clean(value, maximum = 12000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function isDocumentRequest(value) {
  const text = clean(value);
  if (!text) return false;
  if (DOCUMENT_ACTION_PATTERN.test(text) && DOCUMENT_NOUN_PATTERN.test(text)) return true;
  return (
    DOCUMENT_ACTION_PATTERN.test(text) &&
    DOCUMENT_TOPIC_PATTERN.test(text) &&
    /\b(?:report|document|spreadsheet|pdf|word|excel|csv)\b/i.test(text)
  );
}

function requestedFormat(value) {
  const text = clean(value, 4000);
  if (/\bpdf\b/i.test(text)) return "pdf";
  if (/\b(?:word|docx)\b/i.test(text)) return "docx";
  if (/\b(?:excel|xlsx|spreadsheet)\b/i.test(text)) return "xlsx";
  if (/\bcsv\b/i.test(text)) return "csv";
  return null;
}

function buildClarificationRequest({ prompt } = {}) {
  const text = clean(prompt);
  if (!isDocumentRequest(text)) return null;

  const missing = [];
  if (!FORMAT_PATTERN.test(text)) missing.push("format");
  if (TIME_BOUND_TOPIC_PATTERN.test(text) && !PERIOD_PATTERN.test(text)) {
    missing.push("period");
  }
  if (missing.length === 0) return null;

  let answer;
  if (missing.includes("format") && missing.includes("period")) {
    answer =
      "Yes — I can prepare that. Which format do you want: PDF, Word, Excel, or CSV? And what period should I use: today, yesterday, this week, this month, or custom dates? I’ll use your current authorized workspace/store unless you name another one.";
  } else if (missing.includes("format")) {
    answer =
      "Yes — I can prepare that. Which format do you want: PDF, Word, Excel, or CSV? I’ll keep the period and authorized business scope you already specified.";
  } else {
    answer =
      "Yes — I can prepare that document. What period should I use: today, yesterday, this week, this month, or custom dates? I’ll keep the format and current authorized workspace/store you already specified.";
  }

  return Object.freeze({
    kind: "document_generation",
    answer,
    missing_fields: Object.freeze(missing),
    requested_format: requestedFormat(text),
    source_of_truth: false,
    execution_authority: false,
    requires_provider: false,
  });
}

async function clarificationConversation({
  req,
  persona,
  scope,
  conversationKey = null,
  title,
} = {}) {
  if (!conversationKey) {
    const created = await createConversation({
      persona,
      userId: req.user.id,
      scope,
      title,
    });
    return loadOwnedConversation({
      conversationKey: created.key,
      userId: req.user.id,
    });
  }

  const conversation = await loadOwnedConversation({
    conversationKey,
    userId: req.user.id,
  });
  if (
    conversation.persona !== persona ||
    !sameScope(conversation, scope) ||
    conversation.conversation_status !== "active"
  ) {
    const error = new Error("The conversation belongs to a different intelligence scope.");
    error.name = "AiConversationError";
    error.code = "AI_CONVERSATION_SCOPE_MISMATCH";
    error.statusCode = 409;
    throw error;
  }
  return conversation;
}

async function runClarificationTurn({
  req,
  persona,
  scope,
  conversationKey = null,
  message,
  clarification = null,
} = {}) {
  const promptInspection = inspectPrompt(message, { allowHighRiskDiscussion: true });
  const request = clarification || buildClarificationRequest({ prompt: promptInspection.text });
  if (!request) return null;

  const conversation = await clarificationConversation({
    req,
    persona,
    scope,
    conversationKey,
    title: deriveConversationTitle(promptInspection.text),
  });
  const userMessage = await addMessage({
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
    eventType: promptInspection.redaction_count > 0 ? "sensitive_data" : "other",
    action: promptInspection.action,
    patternKeys: promptInspection.pattern_keys,
    redactionCount: promptInspection.redaction_count,
    inputSha256: promptInspection.input_sha256,
    safeSummary: promptInspection.safe_summary,
  });

  const assistantMessage = await addMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: request.answer,
    safetyStatus: "allowed",
    finishReason: "clarification",
    createdBy: req.user.id,
  });

  await writeAiAuditEvent({
    req,
    userId: req.user.id,
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    eventType: "AI_CLARIFICATION_REQUESTED",
    outcome: "success",
    severity: "info",
    persona,
    scope,
    metadata: {
      clarification_kind: request.kind,
      missing_fields: request.missing_fields,
      provider_called: false,
      source_of_truth: false,
      execution_authority: false,
      prompt_sha256: promptInspection.input_sha256,
    },
  }).catch(() => null);

  const title =
    userMessage.conversation_title ||
    conversation.title ||
    deriveConversationTitle(promptInspection.text);

  return Object.freeze({
    conversation_key: conversation.conversation_key,
    conversation: Object.freeze({
      key: conversation.conversation_key,
      title,
      persona,
      workspace_code: scope?.workspace_code || null,
    }),
    message_key: assistantMessage.key,
    persona,
    answer: request.answer,
    evidence: Object.freeze([]),
    citations: Object.freeze({}),
    continuity: Object.freeze({
      recalled_count: 0,
      evidence_authority: false,
    }),
    reasoning: Object.freeze({
      intent: "clarification",
      live_data_required: false,
      retrieval_query_count: 0,
      clarification: request,
      hidden_chain_of_thought_exposed: false,
    }),
    provider: Object.freeze({
      key: "server_clarification",
      model: "deterministic-v1",
      finish_reason: "clarification",
      reasoning_effort: null,
      provider_side_storage_enabled: false,
      rounds: 0,
      selection: null,
    }),
    usage: Object.freeze({
      input_tokens: 0,
      output_tokens: 0,
      cost_micros: 0,
    }),
  });
}

module.exports = {
  buildClarificationRequest,
  isDocumentRequest,
  requestedFormat,
  runClarificationTurn,
};
