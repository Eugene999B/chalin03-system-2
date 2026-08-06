"use strict";

const crypto = require("crypto");

const { pool } = require("../config/db");
const { normalizeAiPersona } = require("../security/aiPermissionCatalog");
const { hashText } = require("./aiSafetyService");

class AiConversationError extends Error {
  constructor(message, { code = "AI_CONVERSATION_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiConversationError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function key(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength) || null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function safeLimit(value, fallback = 30, maximum = 100) {
  return Math.max(1, Math.min(maximum, positiveInteger(value) || fallback));
}

function safeOffset(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new AiConversationError(
      "The CHALIN ONE AI conversation schema is not ready in this environment.",
      { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

function publicConversation(row) {
  return Object.freeze({
    key: row.conversation_key,
    persona: row.persona,
    workspace_code: row.workspace_code,
    branch_id: row.branch_id || null,
    mining_site_id: row.mining_site_id || null,
    hire_location_id: row.hire_location_id || null,
    title: row.title || "New conversation",
    status: row.conversation_status,
    visibility: row.visibility,
    last_message_at: row.last_message_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function publicMessage(row) {
  return Object.freeze({
    key: row.message_key,
    role: row.message_role,
    content: row.content_text || "",
    safety_status: row.safety_status,
    provider_key: row.provider_key || null,
    model_key: row.model_key || null,
    finish_reason: row.finish_reason || null,
    error_code: row.error_code || null,
    created_at: row.created_at,
  });
}

async function createConversation({
  connection = pool,
  persona,
  userId,
  scope,
  title = null,
} = {}) {
  const normalizedPersona = normalizeAiPersona(persona);
  const actorId = positiveInteger(userId);
  if (!normalizedPersona || !actorId) {
    throw new AiConversationError("A valid staff persona and user are required.", {
      code: "AI_CONVERSATION_IDENTITY_INVALID",
    });
  }
  const conversationKey = key("conv");
  try {
    const [result] = await connection.query(
      `INSERT INTO ai_conversations (
         conversation_key, persona, user_id, workspace_code, branch_id,
         mining_site_id, hire_location_id, title, conversation_status,
         visibility, last_message_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)`,
      [
        conversationKey,
        normalizedPersona,
        actorId,
        clean(scope?.workspace_code, 50),
        positiveInteger(scope?.branch_id),
        positiveInteger(scope?.mining_site_id),
        positiveInteger(scope?.hire_location_id),
        clean(title, 220) || "New conversation",
        normalizedPersona === "executive" ? "executive" : "private",
      ]
    );
    return Object.freeze({
      id: Number(result.insertId),
      key: conversationKey,
      persona: normalizedPersona,
    });
  } catch (error) {
    throw schemaError(error);
  }
}

async function loadOwnedConversation({
  connection = pool,
  conversationKey,
  userId,
  forUpdate = false,
} = {}) {
  const actorId = positiveInteger(userId);
  const keyValue = clean(conversationKey, 64);
  if (!actorId || !keyValue) {
    throw new AiConversationError("Invalid AI conversation identity.", {
      code: "AI_CONVERSATION_ID_INVALID",
    });
  }
  try {
    const [rows] = await connection.query(
      `SELECT * FROM ai_conversations
       WHERE conversation_key = ? AND user_id = ?
       LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [keyValue, actorId]
    );
    if (!rows[0]) {
      throw new AiConversationError("AI conversation not found.", {
        code: "AI_CONVERSATION_NOT_FOUND",
        statusCode: 404,
      });
    }
    return rows[0];
  } catch (error) {
    if (error instanceof AiConversationError) throw error;
    throw schemaError(error);
  }
}

async function listConversations({
  connection = pool,
  userId,
  persona = null,
  workspaceCode = null,
  status = "active",
  limit = 30,
  offset = 0,
} = {}) {
  const actorId = positiveInteger(userId);
  if (!actorId) {
    throw new AiConversationError("A valid user is required.", {
      code: "AI_CONVERSATION_USER_INVALID",
    });
  }
  const filters = ["user_id = ?"];
  const params = [actorId];
  if (persona) {
    const normalizedPersona = normalizeAiPersona(persona);
    if (!normalizedPersona) {
      throw new AiConversationError("Invalid AI persona filter.", {
        code: "AI_PERSONA_INVALID",
      });
    }
    filters.push("persona = ?");
    params.push(normalizedPersona);
  }
  if (workspaceCode) {
    filters.push("workspace_code = ?");
    params.push(clean(workspaceCode, 50));
  }
  if (["active", "archived", "blocked"].includes(status)) {
    filters.push("conversation_status = ?");
    params.push(status);
  }
  params.push(safeLimit(limit), safeOffset(offset));

  try {
    const [rows] = await connection.query(
      `SELECT * FROM ai_conversations
       WHERE ${filters.join(" AND ")}
       ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC
       LIMIT ? OFFSET ?`,
      params
    );
    return rows.map(publicConversation);
  } catch (error) {
    throw schemaError(error);
  }
}

async function getConversationDetails({
  connection = pool,
  conversationKey,
  userId,
  messageLimit = 100,
} = {}) {
  const conversation = await loadOwnedConversation({
    connection,
    conversationKey,
    userId,
  });
  try {
    const [rows] = await connection.query(
      `SELECT * FROM ai_messages
       WHERE conversation_id = ? AND message_role <> 'system'
       ORDER BY id ASC
       LIMIT ?`,
      [conversation.id, safeLimit(messageLimit, 100, 200)]
    );
    return Object.freeze({
      conversation: publicConversation(conversation),
      messages: rows.map(publicMessage),
    });
  } catch (error) {
    throw schemaError(error);
  }
}

async function addMessage({
  connection = pool,
  conversationId,
  role,
  content,
  safetyStatus = "allowed",
  providerProfileId = null,
  providerKey = null,
  modelKey = null,
  inputTokens = 0,
  outputTokens = 0,
  costMicros = 0,
  latencyMs = null,
  finishReason = null,
  errorCode = null,
  createdBy = null,
} = {}) {
  const conversation = positiveInteger(conversationId);
  const messageRole = clean(role, 20);
  const text = String(content ?? "").slice(0, 1000000);
  if (!conversation || !["user", "assistant", "system", "tool"].includes(messageRole)) {
    throw new AiConversationError("Invalid AI message.", {
      code: "AI_MESSAGE_INVALID",
    });
  }
  const messageKey = key("msg");
  try {
    const [result] = await connection.query(
      `INSERT INTO ai_messages (
         message_key, conversation_id, message_role, content_text,
         content_sha256, safety_status, provider_profile_id, provider_key,
         model_key, input_tokens, output_tokens, cost_micros, latency_ms,
         finish_reason, error_code, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        messageKey,
        conversation,
        messageRole,
        text || null,
        text ? hashText(text) : null,
        ["pending", "allowed", "redacted", "blocked", "error"].includes(
          safetyStatus
        )
          ? safetyStatus
          : "error",
        positiveInteger(providerProfileId),
        clean(providerKey, 80),
        clean(modelKey, 160),
        Math.max(0, Number(inputTokens || 0)),
        Math.max(0, Number(outputTokens || 0)),
        Math.max(0, Number(costMicros || 0)),
        Number.isFinite(Number(latencyMs)) ? Math.max(0, Number(latencyMs)) : null,
        clean(finishReason, 80),
        clean(errorCode, 120),
        positiveInteger(createdBy),
      ]
    );
    await connection.query(
      `UPDATE ai_conversations
       SET last_message_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [conversation]
    );
    return Object.freeze({ id: Number(result.insertId), key: messageKey });
  } catch (error) {
    throw schemaError(error);
  }
}

async function renameConversation({
  connection = pool,
  conversationKey,
  userId,
  title,
} = {}) {
  const conversation = await loadOwnedConversation({
    connection,
    conversationKey,
    userId,
  });
  const cleanedTitle = clean(title, 220);
  if (!cleanedTitle) {
    throw new AiConversationError("Conversation title is required.", {
      code: "AI_CONVERSATION_TITLE_REQUIRED",
    });
  }
  try {
    await connection.query(
      "UPDATE ai_conversations SET title = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?",
      [cleanedTitle, conversation.id]
    );
    return true;
  } catch (error) {
    throw schemaError(error);
  }
}

async function archiveConversation({
  connection = pool,
  conversationKey,
  userId,
} = {}) {
  const conversation = await loadOwnedConversation({
    connection,
    conversationKey,
    userId,
  });
  try {
    await connection.query(
      `UPDATE ai_conversations
       SET conversation_status = 'archived', updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [conversation.id]
    );
    return true;
  } catch (error) {
    throw schemaError(error);
  }
}

module.exports = {
  AiConversationError,
  addMessage,
  archiveConversation,
  createConversation,
  getConversationDetails,
  key,
  listConversations,
  loadOwnedConversation,
  positiveInteger,
  publicConversation,
  publicMessage,
  renameConversation,
  safeLimit,
  safeOffset,
  schemaError,
};
