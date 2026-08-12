import axiosClient from "../../api/axiosClient";
import {
  generateAndDownloadAiDocument,
  requestedAiDocumentFormat,
} from "./aiDocumentClient";

export const AI_PERSONAS = Object.freeze({
  copilot: "copilot",
  executive: "executive",
});

const conversationCache = new Map();
const toolCache = new Map();

function unwrap(response) {
  return response?.data?.data ?? response?.data ?? null;
}

function personaPath(persona) {
  if (!Object.values(AI_PERSONAS).includes(persona)) {
    throw new Error("Unsupported CHALIN ONE intelligence persona.");
  }
  return `/ai/${persona}`;
}

function noCacheConfig(config = {}) {
  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  };
}

function paramsIdentity(params = {}) {
  return JSON.stringify(
    Object.entries(params || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function conversationCacheKey(persona, params = {}) {
  return `${persona}:${paramsIdentity(params)}`;
}

function derivedConversationTitle(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "New conversation";
  if (/^(?:hi|hello|hey|hiya|greetings|good\s+(?:morning|afternoon|evening)|how\s+(?:are|r)\s+you(?:\s+doing)?|thanks|thank\s+you|okay|ok|cool|great|nice|bye|goodbye)[\s!.?,'-]*$/i.test(text)) {
    return "General Conversation";
  }
  const cleaned = text
    .replace(/^(?:(?:hi|hello|hey|hiya|greetings|good\s+(?:morning|afternoon|evening))[,!?.\s-]*)+/i, "")
    .replace(/^(?:(?:please|can\s+you|could\s+you|would\s+you|tell\s+me|show\s+me|explain|help\s+me|what\s+is|what\s+are|how\s+is|how\s+are)\s+)+/i, "")
    .replace(/[?!.]+$/g, "")
    .trim();
  if (!cleaned) return "General Conversation";
  return cleaned
    .split(/\s+/)
    .slice(0, 10)
    .join(" ")
    .slice(0, 72)
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function updateConversationCaches(persona, updater) {
  for (const [key, rows] of conversationCache.entries()) {
    if (!key.startsWith(`${persona}:`) || !Array.isArray(rows)) continue;
    conversationCache.set(key, updater(rows));
  }
}

function upsertConversationCache(persona, conversationKey, message, explicitTitle = null) {
  if (!conversationKey) return;
  const now = new Date().toISOString();
  updateConversationCaches(persona, (rows) => {
    const existing = rows.find((row) => row?.key === conversationKey) || null;
    const nextTitle =
      explicitTitle ||
      (existing?.title && !["New conversation", "General Conversation"].includes(existing.title)
        ? existing.title
        : derivedConversationTitle(message));
    const next = {
      ...(existing || {}),
      key: conversationKey,
      persona,
      title: nextTitle,
      last_message_at: now,
      updated_at: now,
      status: "active",
    };
    return [next, ...rows.filter((row) => row?.key !== conversationKey)];
  });
}

function removeConversationFromCache(persona, conversationKey) {
  updateConversationCaches(persona, (rows) =>
    rows.filter((row) => row?.key !== conversationKey)
  );
}

export async function getAiStatus({ signal } = {}) {
  const response = await axiosClient.get(
    "/ai/status",
    noCacheConfig({ signal })
  );
  return unwrap(response) || {};
}

export async function getAiProviderControl({ signal } = {}) {
  const response = await axiosClient.get(
    "/ai/provider-control",
    noCacheConfig({ signal })
  );
  return unwrap(response) || {};
}

export async function updateAiProviderControl(
  persona,
  { providerKey, modelKey = null, fullContextAccess = false }
) {
  const supportedPersonas = new Set(["guide", "copilot", "executive"]);
  if (!supportedPersonas.has(persona)) {
    throw new Error("Unsupported CHALIN AI provider persona.");
  }
  const response = await axiosClient.put(
    `/ai/provider-control/${encodeURIComponent(persona)}`,
    {
      provider_key: providerKey,
      model_key: modelKey || null,
      full_context_access: fullContextAccess === true,
    }
  );
  return unwrap(response) || {};
}

export async function listAiTools(persona, { signal, force = false } = {}) {
  if (!force && toolCache.has(persona)) return toolCache.get(persona);
  const response = await axiosClient.get(
    `${personaPath(persona)}/tools`,
    noCacheConfig({ signal })
  );
  const rows = unwrap(response) || [];
  toolCache.set(persona, rows);
  return rows;
}

export async function listAiConversations(
  persona,
  params = {},
  { signal, force = false } = {}
) {
  const key = conversationCacheKey(persona, params);
  if (!force && conversationCache.has(key)) return conversationCache.get(key);
  const response = await axiosClient.get(
    `${personaPath(persona)}/conversations`,
    noCacheConfig({ params, signal })
  );
  const rows = unwrap(response) || [];
  conversationCache.set(key, rows);
  return rows;
}

export async function getAiConversation(persona, conversationKey, { signal } = {}) {
  const response = await axiosClient.get(
    `${personaPath(persona)}/conversations/${encodeURIComponent(
      conversationKey
    )}`,
    noCacheConfig({ signal })
  );
  return unwrap(response) || null;
}

export async function sendAiMessage(
  persona,
  { conversationKey = null, message },
  { signal } = {}
) {
  const requestedFormat = requestedAiDocumentFormat(message);
  const response = await axiosClient.post(
    `${personaPath(persona)}/chat`,
    {
      conversation_key: conversationKey || null,
      message,
    },
    { signal }
  );
  const result = unwrap(response) || null;
  if (result?.conversation_key) {
    upsertConversationCache(
      persona,
      result.conversation_key,
      message,
      result?.conversation?.title || null
    );
  }

  if (
    requestedFormat &&
    result?.conversation_key &&
    result?.message_key &&
    result?.reasoning?.intent !== "clarification" &&
    result?.provider?.finish_reason !== "clarification"
  ) {
    try {
      const artifact = await generateAndDownloadAiDocument({
        conversationKey: result.conversation_key,
        messageKey: result.message_key,
        format: requestedFormat,
        title: result?.conversation?.title || null,
      });
      return {
        ...result,
        document_export: Object.freeze({
          status: "downloaded",
          format: requestedFormat,
          filename: artifact.filename,
          sha256: artifact.sha256,
          classification: artifact.classification,
        }),
      };
    } catch (documentError) {
      return {
        ...result,
        document_export: Object.freeze({
          status: "failed",
          format: requestedFormat,
          message: aiErrorMessage(documentError),
        }),
      };
    }
  }

  return result;
}

export async function renameAiConversation(persona, conversationKey, title) {
  const response = await axiosClient.patch(
    `${personaPath(persona)}/conversations/${encodeURIComponent(
      conversationKey
    )}`,
    { title }
  );
  updateConversationCaches(persona, (rows) =>
    rows.map((row) =>
      row?.key === conversationKey ? { ...row, title } : row
    )
  );
  return unwrap(response) || null;
}

export async function archiveAiConversation(persona, conversationKey) {
  const response = await axiosClient.post(
    `${personaPath(persona)}/conversations/${encodeURIComponent(
      conversationKey
    )}/archive`
  );
  removeConversationFromCache(persona, conversationKey);
  return unwrap(response) || null;
}

export async function deleteAiConversation(persona, conversationKey) {
  const response = await axiosClient.delete(
    `${personaPath(persona)}/conversations/${encodeURIComponent(
      conversationKey
    )}`
  );
  removeConversationFromCache(persona, conversationKey);
  return unwrap(response) || null;
}

export async function clearAiConversationHistory(persona) {
  const statuses = ["active", "archived", "blocked"];
  let deleted = 0;

  for (const status of statuses) {
    while (true) {
      const rows = await listAiConversations(
        persona,
        { status, limit: 100, offset: 0 },
        { force: true }
      );
      const keys = [
        ...new Set(
          rows
            .map((row) => row?.key)
            .filter(Boolean)
        ),
      ];
      if (keys.length === 0) break;

      for (let index = 0; index < keys.length; index += 8) {
        await Promise.all(
          keys
            .slice(index, index + 8)
            .map((conversationKey) =>
              deleteAiConversation(persona, conversationKey)
            )
        );
      }
      deleted += keys.length;

      // Re-read offset zero because deleting the first page pulls the next
      // owned conversations into that page. This continues until none remain.
      invalidateAiConversationCache(persona);
    }
  }

  invalidateAiConversationCache(persona);
  return Object.freeze({ deleted });
}

export function invalidateAiConversationCache(persona = null) {
  if (!persona) {
    conversationCache.clear();
    toolCache.clear();
    return;
  }
  for (const key of conversationCache.keys()) {
    if (key.startsWith(`${persona}:`)) conversationCache.delete(key);
  }
  toolCache.delete(persona);
}

export async function createAiFeedback(input) {
  const response = await axiosClient.post("/ai/feedback", input);
  return unwrap(response) || null;
}

export async function listAiUsage(params = {}, { signal } = {}) {
  const response = await axiosClient.get(
    "/ai/usage",
    noCacheConfig({ params, signal })
  );
  return unwrap(response) || [];
}

export async function listAiKnowledge(params = {}, { signal } = {}) {
  const response = await axiosClient.get(
    "/ai/knowledge",
    noCacheConfig({ params, signal })
  );
  return unwrap(response) || [];
}

export async function createAiKnowledgeDraft(input) {
  const response = await axiosClient.post("/ai/knowledge", input);
  return unwrap(response) || null;
}

export async function getAiKnowledgeSource(sourceId, { signal } = {}) {
  const response = await axiosClient.get(
    `/ai/knowledge/${encodeURIComponent(sourceId)}`,
    noCacheConfig({ signal })
  );
  return unwrap(response) || null;
}

export async function createAiKnowledgeVersion(sourceId, input) {
  const response = await axiosClient.post(
    `/ai/knowledge/${encodeURIComponent(sourceId)}/versions`,
    input
  );
  return unwrap(response) || null;
}

export async function updateAiKnowledgeDraft(sourceId, versionId, input) {
  const response = await axiosClient.put(
    `/ai/knowledge/${encodeURIComponent(
      sourceId
    )}/versions/${encodeURIComponent(versionId)}`,
    input
  );
  return unwrap(response) || null;
}

export async function ingestAiKnowledgeDocument(
  sourceId,
  versionId,
  input,
  { signal } = {}
) {
  const response = await axiosClient.post(
    `/ai/knowledge/${encodeURIComponent(
      sourceId
    )}/versions/${encodeURIComponent(versionId)}/documents`,
    input,
    { signal }
  );
  return unwrap(response) || null;
}

export async function listAiKnowledgeDocuments(
  sourceId,
  { versionId = null, signal } = {}
) {
  const response = await axiosClient.get(
    `/ai/knowledge/${encodeURIComponent(sourceId)}/documents`,
    noCacheConfig({
      params: versionId ? { version_id: versionId } : {},
      signal,
    })
  );
  return unwrap(response) || [];
}

export async function listAiKnowledgeDocumentChunks(
  sourceReference,
  documentId,
  { signal } = {}
) {
  const response = await axiosClient.get(
    `/ai/knowledge/${encodeURIComponent(
      sourceReference
    )}/documents/${encodeURIComponent(documentId)}/chunks`,
    noCacheConfig({ signal })
  );
  return unwrap(response) || [];
}

export async function getAiKnowledgeChunk(
  sourceReference,
  documentId,
  chunkId,
  { signal } = {}
) {
  const response = await axiosClient.get(
    `/ai/knowledge/${encodeURIComponent(
      sourceReference
    )}/documents/${encodeURIComponent(documentId)}/chunks/${encodeURIComponent(
      chunkId
    )}`,
    noCacheConfig({ signal })
  );
  return unwrap(response) || null;
}

export async function submitAiKnowledgeVersion(
  sourceId,
  versionId,
  { assignedTo, note }
) {
  const response = await axiosClient.post(
    `/ai/knowledge/${encodeURIComponent(
      sourceId
    )}/versions/${encodeURIComponent(versionId)}/submit`,
    { assigned_to: assignedTo, note }
  );
  return unwrap(response) || null;
}

export async function decideAiKnowledgeApproval(approvalId, decision, note) {
  const response = await axiosClient.post(
    `/ai/knowledge/approvals/${encodeURIComponent(approvalId)}/decision`,
    { decision, note }
  );
  return unwrap(response) || null;
}

export async function publishAiKnowledgeVersion(sourceId, versionId) {
  const response = await axiosClient.post(
    `/ai/knowledge/${encodeURIComponent(
      sourceId
    )}/versions/${encodeURIComponent(versionId)}/publish`
  );
  return unwrap(response) || null;
}

export function aiErrorMessage(error) {
  if (error?.name === "CanceledError" || error?.code === "ERR_CANCELED") {
    return "";
  }
  const code = error?.response?.data?.code;
  const details = Array.isArray(error?.response?.data?.details)
    ? error.response.data.details.filter(Boolean).slice(0, 3)
    : [];
  if (code === "AI_PROVIDER_DISABLED") {
    return "The intelligence provider is not active for this request.";
  }
  if (code === "AI_PROVIDER_POLICY_SYSTEM_ADMIN_REQUIRED") {
    return "Only the original System Administrator can change CHALIN AI provider policy.";
  }
  if (code === "AI_GEMINI_API_KEY_REQUIRED") {
    return "Gemini is selected but its protected server-side key is not configured in this Railway service.";
  }
  if (code === "AI_GEMINI_FULL_CONTEXT_REQUIRES_PAID_TIER") {
    return "Full private-data Gemini mode is requested, but the configured Gemini service tier is unpaid. CHALIN kept private data on Local.";
  }
  if (["AI_GEMINI_RESPONSE_FAILED", "AI_GEMINI_NETWORK_FAILED", "AI_PROVIDER_TIMEOUT"].includes(code)) {
    return `Gemini could not complete this request${details.length ? ` (${details.join(", ")})` : ""}. CHALIN preserved the conversation; retry when the provider connection is available.`;
  }
  if (["AI_PROVIDER_ROUND_LIMIT_EXCEEDED", "AI_FINAL_SYNTHESIS_TOOL_CALL_BLOCKED"].includes(code)) {
    return "I could not finish that task yet. Your conversation is intact, so continue with the missing detail or narrow the request and I’ll pick up from the same topic.";
  }
  if (code === "AI_SCHEMA_NOT_READY") {
    return "The intelligence database foundation has not been prepared in this environment.";
  }
  if (code === "AI_DOCUMENT_PARSER_NOT_AVAILABLE") {
    return "This document type is not enabled yet. Use TXT, Markdown, CSV, JSON, HTML or XML. PDF, DOCX and OCR remain separately disabled until their parser adapters are reviewed.";
  }
  if (code === "AI_DOCUMENT_VERSION_NOT_DRAFT") {
    return "Documents can be ingested only into an editable draft knowledge version so the exact parsed content is covered by independent review.";
  }
  if (code === "AI_PROMPT_INJECTION_BLOCKED") {
    return "This message was blocked because it attempted to override security controls.";
  }
  if (code === "AI_SECRET_REQUEST_BLOCKED") {
    return "CHALIN ONE will not reveal passwords, tokens, provider keys or other restricted secrets.";
  }
  return (
    error?.response?.data?.message ||
    error?.message ||
    "I could not finish that request yet. Your conversation is intact, so you can continue from the same topic."
  );
}