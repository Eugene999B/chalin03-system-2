"use strict";

const { getConversationDetails, loadOwnedConversation } = require("./aiConversationService");
const { renderAiDocument, normalizeDocumentFormat } = require("./aiDocumentStudioService");
const { renderPremiumAiPdf } = require("./aiPremiumPdfRenderer");

class AiDocumentExportError extends Error {
  constructor(message, { code = "AI_DOCUMENT_EXPORT_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiDocumentExportError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maximum = 500) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function findAssistantMessage(details, messageKey) {
  const key = clean(messageKey, 100);
  const messages = Array.isArray(details?.messages) ? details.messages : [];
  const message = messages.find((item) => item?.key === key);
  if (!message || message.role !== "assistant") {
    throw new AiDocumentExportError("The requested CHALIN Intelligence answer was not found in this owned conversation.", {
      code: "AI_DOCUMENT_MESSAGE_NOT_FOUND",
      statusCode: 404,
    });
  }
  if (message.safety_status && message.safety_status !== "allowed") {
    throw new AiDocumentExportError("Only successfully completed CHALIN Intelligence answers can be exported.", {
      code: "AI_DOCUMENT_MESSAGE_NOT_EXPORTABLE",
      statusCode: 409,
    });
  }
  if (String(message.finish_reason || "").toLowerCase() === "clarification") {
    throw new AiDocumentExportError(
      "A clarification prompt is not a finished CHALIN Intelligence report and cannot be exported as the requested business document.",
      { code: "AI_DOCUMENT_CLARIFICATION_NOT_EXPORTABLE", statusCode: 409 }
    );
  }
  return message;
}

function defaultTitle(details, message) {
  const conversationTitle = clean(details?.conversation?.title, 180);
  if (conversationTitle && !["New conversation", "General Conversation"].includes(conversationTitle)) {
    return conversationTitle;
  }
  const firstLine = clean(message?.content, 180).split("\n")[0].trim();
  return firstLine || "CHALIN Intelligence Report";
}

async function createAiDocumentArtifact({
  conversationKey,
  messageKey,
  user,
  format,
  title = null,
  requestId = null,
  connection,
} = {}) {
  const userId = Number(user?.id || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new AiDocumentExportError("Authentication is required for CHALIN Intelligence document generation.", {
      code: "AI_DOCUMENT_AUTH_REQUIRED",
      statusCode: 401,
    });
  }
  const normalizedFormat = normalizeDocumentFormat(format);
  if (!normalizedFormat) {
    throw new AiDocumentExportError("Choose PDF, Excel, CSV or Word for the CHALIN Intelligence document.", {
      code: "AI_DOCUMENT_FORMAT_UNSUPPORTED",
      statusCode: 400,
    });
  }

  const conversation = await loadOwnedConversation({ connection, conversationKey, userId });
  const details = await getConversationDetails({ connection, conversationKey, userId, messageLimit: 500 });
  const message = findAssistantMessage(details, messageKey);
  const documentTitle = clean(title, 180) || defaultTitle(details, message);
  const renderInput = {
    title: documentTitle,
    filename: documentTitle,
    answer: message.content,
    evidence: message.evidence || [],
    actor_name: user?.full_name || user?.name || user?.username,
    actor_username: user?.username,
    actor_role: user?.role,
    workspace_code: conversation.workspace_code,
    conversation_key: conversation.conversation_key,
    message_key: message.key,
    request_id: requestId,
  };

  const artifact = normalizedFormat === "pdf"
    ? await renderPremiumAiPdf(renderInput)
    : await renderAiDocument(renderInput, normalizedFormat);

  return Object.freeze({
    ...artifact,
    conversation_id: Number(conversation.id),
    conversation_key: conversation.conversation_key,
    message_key: message.key,
    persona: conversation.persona,
    workspace_code: conversation.workspace_code || null,
    scope: Object.freeze({
      workspace_code: conversation.workspace_code || null,
      branch_id: conversation.branch_id || null,
      mining_site_id: conversation.mining_site_id || null,
      hire_location_id: conversation.hire_location_id || null,
    }),
  });
}

module.exports = {
  AiDocumentExportError,
  clean,
  createAiDocumentArtifact,
  defaultTitle,
  findAssistantMessage,
};
