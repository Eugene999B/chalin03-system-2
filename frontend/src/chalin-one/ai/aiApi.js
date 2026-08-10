import axiosClient from "../../api/axiosClient";

export const AI_PERSONAS = Object.freeze({
  copilot: "copilot",
  executive: "executive",
});

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
  { providerKey, modelKey = null }
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
    }
  );
  return unwrap(response) || {};
}

export async function listAiTools(persona, { signal } = {}) {
  const response = await axiosClient.get(
    `${personaPath(persona)}/tools`,
    noCacheConfig({ signal })
  );
  return unwrap(response) || [];
}

export async function listAiConversations(
  persona,
  params = {},
  { signal } = {}
) {
  const response = await axiosClient.get(
    `${personaPath(persona)}/conversations`,
    noCacheConfig({ params, signal })
  );
  return unwrap(response) || [];
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
  const response = await axiosClient.post(
    `${personaPath(persona)}/chat`,
    {
      conversation_key: conversationKey || null,
      message,
    },
    { signal }
  );
  return unwrap(response) || null;
}

export async function renameAiConversation(persona, conversationKey, title) {
  const response = await axiosClient.patch(
    `${personaPath(persona)}/conversations/${encodeURIComponent(
      conversationKey
    )}`,
    { title }
  );
  return unwrap(response) || null;
}

export async function archiveAiConversation(persona, conversationKey) {
  const response = await axiosClient.post(
    `${personaPath(persona)}/conversations/${encodeURIComponent(
      conversationKey
    )}/archive`
  );
  return unwrap(response) || null;
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
  if (code === "AI_PROVIDER_DISABLED") {
    return "The intelligence provider is safely disabled in this environment.";
  }
  if (code === "AI_PROVIDER_POLICY_SYSTEM_ADMIN_REQUIRED") {
    return "Only the original System Administrator can change CHALIN AI provider policy.";
  }
  if (code === "AI_GEMINI_API_KEY_REQUIRED") {
    return "Gemini is selected but its protected server-side key is not configured. Select CHALIN Local or configure the staging key in Railway.";
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
    "CHALIN ONE intelligence could not complete the request safely."
  );
}
