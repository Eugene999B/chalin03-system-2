"use strict";

const crypto = require("crypto");

const { pool } = require("../config/db");
const { normalizeAiPersona } = require("../security/aiPermissionCatalog");
const { hashText } = require("./aiSafetyService");
const { normalizeEvidenceList } = require("./aiEvidenceService");

const GENERIC_TITLES = new Set(["", "New conversation", "General Conversation"]);
const SOCIAL_ONLY_PATTERN = /^(?:hi|hello|hey|hiya|greetings|good\s+(?:morning|afternoon|evening)|how\s+(?:are|r)\s+you(?:\s+doing)?|what(?:'s|\s+is)\s+up|how(?:'s|\s+is)\s+it\s+going|thanks|thank\s+you|okay|ok|cool|great|nice|bye|goodbye|see\s+you)[\s!.?,'-]*$/i;
const LEADING_SOCIAL_PATTERN = /^(?:(?:hi|hello|hey|hiya|greetings|good\s+(?:morning|afternoon|evening))[,!?.\s-]*)+/i;
const TITLE_FILLER_PATTERN = /^(?:(?:please|can\s+you|could\s+you|would\s+you|tell\s+me|show\s+me|explain|help\s+me|i\s+want\s+to\s+know|i\s+need\s+to\s+know|what\s+is|what\s+are|how\s+is|how\s+are|why\s+is|why\s+are)\s+)+/i;
const CONVERSATION_ROLLOVER_MESSAGE_LIMIT = 80;
const CONVERSATION_ROLLOVER_CHARACTER_LIMIT = 120000;
const AUTO_TITLE_USER_TURN_LIMIT = 4;
const CONTINUATION_CONTEXT_TURN_LIMIT = 6;

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

function parseJson(value, fallback = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
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

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function isSocialOnly(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (SOCIAL_ONLY_PATTERN.test(text)) return true;
  const withoutGreeting = text.replace(LEADING_SOCIAL_PATTERN, "").trim();
  return Boolean(withoutGreeting) && SOCIAL_ONLY_PATTERN.test(withoutGreeting);
}

function deriveConversationTitle(value, maximum = 72) {
  const original = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!original || isSocialOnly(original)) return "General Conversation";

  let text = original
    .replace(LEADING_SOCIAL_PATTERN, "")
    .replace(TITLE_FILLER_PATTERN, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[?!.]+$/g, "")
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, "")
    .trim();
  if (!text || isSocialOnly(text)) return "General Conversation";

  const words = text.split(/\s+/).filter(Boolean).slice(0, 10);
  text = words.join(" ").slice(0, maximum).trim();
  if (!text) return "General Conversation";
  return titleCase(text);
}

function meaningfulTitleTurns(turns = []) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => String(turn || "").replace(/\s+/g, " ").trim())
    .filter((turn) => turn && !isSocialOnly(turn))
    .slice(0, AUTO_TITLE_USER_TURN_LIMIT);
}

function locationTitle(text) {
  const match = String(text || "").match(
    /\b(?:at|in|from|for)\s+(?:the\s+)?([a-z0-9][a-z0-9 &'’-]{0,40}?(?:store|branch|site|location))\b/i
  );
  if (match?.[1]) return titleCase(match[1]);
  const direct = String(text || "").match(/\b((?:main|head)\s+(?:store|branch))\b/i);
  return direct?.[1] ? titleCase(direct[1]) : "";
}

function deriveConversationTitleFromTurns(turns = [], maximum = 72) {
  const useful = meaningfulTitleTurns(turns);
  if (useful.length === 0) return "General Conversation";
  const joined = useful.join(" ");
  const lower = joined.toLowerCase();
  const location = locationTitle(joined);

  let title = "";
  if (/\bspare parts\b/.test(lower) && /\b(sale|sales|sold|selling|sell)\b/.test(lower)) {
    title = /\btoday\b/.test(lower) ? "Today's Spare Parts Sales" : "Spare Parts Sales";
  } else if (/\baudit(?:\s+|-)intelligence\b|\badvanced accounting intelligence\b/.test(lower)) {
    title = "Audit Intelligence";
  } else if (/\b(marketing|branding|campaign|positioning|advertising)\b/.test(lower)) {
    title = "CHALIN Marketing Strategy";
  } else if (/\b(architecture|cybersecurity|security design|database design|technical|\bit\b)\b/.test(lower)) {
    title = "CHALIN IT & Security";
  } else if (/\b(payroll|salary|wage|worker compensation)\b/.test(lower)) {
    title = "Payroll & Worker Compensation";
  } else if (/\b(mining|production|stockpile|fuel)\b/.test(lower)) {
    title = "Mining Operations";
  } else if (/\b(equipment hire|hire contract|fleet|utili[sz]ation)\b/.test(lower)) {
    title = "Equipment Hire Operations";
  } else if (/\b(installment finance|arrears|portfolio|credit application)\b/.test(lower)) {
    title = "Installment Finance";
  } else {
    title = deriveConversationTitle(useful[0], maximum);
  }

  if (location && !title.toLowerCase().includes(location.toLowerCase())) {
    title = `${title} — ${location}`;
  }
  return title.slice(0, maximum).trim() || "General Conversation";
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

function publicMessage(row, evidence = []) {
  return Object.freeze({
    key: row.message_key,
    role: row.message_role,
    content: row.content_text || "",
    safety_status: row.safety_status,
    provider_key: row.provider_key || null,
    model_key: row.model_key || null,
    finish_reason: row.finish_reason || null,
    error_code: row.error_code || null,
    evidence: normalizeEvidenceList(evidence),
    created_at: row.created_at,
  });
}

function publicEvidence(row) {
  return Object.freeze({
    source_type: row.source_type,
    source_ref: row.source_ref,
    source_version: row.source_version || null,
    label: row.label,
    excerpt_text: row.excerpt_text || null,
    as_of_at: row.as_of_at || null,
    classification: row.classification,
    workspace_code: row.workspace_code || null,
    metadata: Object.freeze(parseJson(row.metadata_json, {})),
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
  messageLimit = 200,
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
      [conversation.id, safeLimit(messageLimit, 200, 500)]
    );
    const messageIds = rows.map((row) => Number(row.id)).filter(Boolean);
    const evidenceByMessage = new Map();
    if (messageIds.length > 0) {
      const placeholders = messageIds.map(() => "?").join(", ");
      const [evidenceRows] = await connection.query(
        `SELECT message_id, source_type, source_ref, source_version, label,
                excerpt_text, as_of_at, classification, workspace_code,
                metadata_json
         FROM ai_evidence_records
         WHERE message_id IN (${placeholders})
         ORDER BY message_id ASC, id ASC`,
        messageIds
      );
      for (const row of evidenceRows) {
        const messageId = Number(row.message_id);
        if (!evidenceByMessage.has(messageId)) evidenceByMessage.set(messageId, []);
        evidenceByMessage.get(messageId).push(publicEvidence(row));
      }
    }
    return Object.freeze({
      conversation: publicConversation(conversation),
      messages: rows.map((row) =>
        publicMessage(row, evidenceByMessage.get(Number(row.id)) || [])
      ),
    });
  } catch (error) {
    throw schemaError(error);
  }
}

async function refreshAutomaticConversationTitle({ connection = pool, conversationId } = {}) {
  const id = positiveInteger(conversationId);
  if (!id) return null;
  try {
    const [conversationRows] = await connection.query(
      "SELECT title, workspace_code FROM ai_conversations WHERE id = ? LIMIT 1",
      [id]
    );
    const conversation = conversationRows[0];
    if (!conversation) return null;
    const [turnRows] = await connection.query(
      `SELECT content_text
         FROM ai_messages
        WHERE conversation_id = ?
          AND message_role = 'user'
          AND content_text IS NOT NULL
        ORDER BY id ASC
        LIMIT ?`,
      [id, AUTO_TITLE_USER_TURN_LIMIT]
    );
    const turns = turnRows.map((row) => row.content_text || "");
    if (turns.length === 0) return conversation.title || "New conversation";

    const prefixTitles = [];
    for (let index = 1; index <= turns.length; index += 1) {
      prefixTitles.push(deriveConversationTitleFromTurns(turns.slice(0, index)));
    }
    const currentTitle = String(conversation.title || "").trim();
    const isAutoTitle = GENERIC_TITLES.has(currentTitle) || prefixTitles.includes(currentTitle);
    if (!isAutoTitle) return currentTitle;

    const nextTitle = prefixTitles[prefixTitles.length - 1] || "General Conversation";
    if (nextTitle !== currentTitle) {
      await connection.query(
        "UPDATE ai_conversations SET title = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?",
        [nextTitle, id]
      );
    }
    return nextTitle;
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

    let conversationTitle = null;
    if (messageRole === "user" && text.trim()) {
      conversationTitle = await refreshAutomaticConversationTitle({
        connection,
        conversationId: conversation,
      });
      await connection.query(
        "UPDATE ai_conversations SET last_message_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?",
        [conversation]
      );
    } else {
      await connection.query(
        `UPDATE ai_conversations
         SET last_message_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [conversation]
      );
    }
    return Object.freeze({
      id: Number(result.insertId),
      key: messageKey,
      conversation_title: conversationTitle,
    });
  } catch (error) {
    throw schemaError(error);
  }
}

async function conversationUsage({ connection = pool, conversationId } = {}) {
  const id = positiveInteger(conversationId);
  if (!id) return Object.freeze({ message_count: 0, character_count: 0 });
  try {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS message_count,
              COALESCE(SUM(CHAR_LENGTH(content_text)), 0) AS character_count
         FROM ai_messages
        WHERE conversation_id = ?
          AND message_role IN ('user', 'assistant')`,
      [id]
    );
    return Object.freeze({
      message_count: Number(rows[0]?.message_count || 0),
      character_count: Number(rows[0]?.character_count || 0),
    });
  } catch (error) {
    throw schemaError(error);
  }
}

function conversationRolloverReason(usage = {}) {
  if (Number(usage.message_count || 0) >= CONVERSATION_ROLLOVER_MESSAGE_LIMIT) {
    return "message_limit";
  }
  if (Number(usage.character_count || 0) >= CONVERSATION_ROLLOVER_CHARACTER_LIMIT) {
    return "context_size_limit";
  }
  return null;
}

function sameScope(conversation, scope = {}) {
  return (
    String(conversation?.workspace_code || "") === String(scope?.workspace_code || "") &&
    Number(conversation?.branch_id || 0) === Number(scope?.branch_id || 0) &&
    Number(conversation?.mining_site_id || 0) === Number(scope?.mining_site_id || 0) &&
    Number(conversation?.hire_location_id || 0) === Number(scope?.hire_location_id || 0)
  );
}

function continuedTitle(value) {
  const base = String(value || "New conversation").replace(/\s+·\s+Continued(?:\s+\d+)?$/i, "").trim();
  return `${base || "Conversation"} · Continued`.slice(0, 220);
}

function continuationMessage({ previousTitle, recentTurns = [], reason }) {
  const context = recentTurns
    .map((turn) => {
      const role = turn.message_role === "user" ? "User" : "Copilot";
      const text = String(turn.content_text || "").replace(/\s+/g, " ").trim().slice(0, 700);
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
  return [
    `This chat continues from “${String(previousTitle || "the previous conversation").slice(0, 180)}” because that chat reached its ${reason === "message_limit" ? "conversation length" : "reasoning context"} limit.`,
    "I carried forward only a small recent continuity capsule so the discussion can continue without overloading the model.",
    "Any old live figures in this capsule are historical context only and must be re-checked before being treated as current.",
    context ? `\nRecent continuity:\n${context}` : "",
  ].filter(Boolean).join("\n");
}

async function rolloverConversationIfNeeded({
  connection = pool,
  conversationKey,
  userId,
  persona,
  scope,
} = {}) {
  if (!conversationKey) {
    return Object.freeze({ conversation_key: null, rolled_over: false });
  }
  const conversation = await loadOwnedConversation({
    connection,
    conversationKey,
    userId,
  });
  const normalizedPersona = normalizeAiPersona(persona);
  if (
    conversation.persona !== normalizedPersona ||
    !sameScope(conversation, scope) ||
    conversation.conversation_status !== "active"
  ) {
    return Object.freeze({
      conversation_key: conversationKey,
      rolled_over: false,
    });
  }

  const usage = await conversationUsage({
    connection,
    conversationId: conversation.id,
  });
  const reason = conversationRolloverReason(usage);
  if (!reason) {
    return Object.freeze({
      conversation_key: conversationKey,
      rolled_over: false,
      usage,
    });
  }

  const [recentRows] = await connection.query(
    `SELECT message_role, content_text
       FROM ai_messages
      WHERE conversation_id = ?
        AND message_role IN ('user', 'assistant')
        AND content_text IS NOT NULL
      ORDER BY id DESC
      LIMIT ?`,
    [conversation.id, CONTINUATION_CONTEXT_TURN_LIMIT]
  );
  const created = await createConversation({
    connection,
    persona: normalizedPersona,
    userId,
    scope,
    title: continuedTitle(conversation.title),
  });
  await addMessage({
    connection,
    conversationId: created.id,
    role: "assistant",
    content: continuationMessage({
      previousTitle: conversation.title,
      recentTurns: recentRows.reverse(),
      reason,
    }),
    safetyStatus: "allowed",
    providerKey: "system",
    modelKey: "conversation-rollover-v1",
    finishReason: "conversation_rollover",
    createdBy: userId,
  });

  return Object.freeze({
    conversation_key: created.key,
    previous_conversation_key: conversation.conversation_key,
    rolled_over: true,
    reason,
    usage,
    title: continuedTitle(conversation.title),
  });
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

async function deleteConversation({
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
      "DELETE FROM ai_conversations WHERE id = ? AND user_id = ?",
      [conversation.id, positiveInteger(userId)]
    );
    return true;
  } catch (error) {
    throw schemaError(error);
  }
}

module.exports = {
  AUTO_TITLE_USER_TURN_LIMIT,
  AiConversationError,
  CONVERSATION_ROLLOVER_CHARACTER_LIMIT,
  CONVERSATION_ROLLOVER_MESSAGE_LIMIT,
  CONTINUATION_CONTEXT_TURN_LIMIT,
  GENERIC_TITLES,
  addMessage,
  archiveConversation,
  continuationMessage,
  continuedTitle,
  conversationRolloverReason,
  conversationUsage,
  createConversation,
  deleteConversation,
  deriveConversationTitle,
  deriveConversationTitleFromTurns,
  getConversationDetails,
  isSocialOnly,
  key,
  listConversations,
  loadOwnedConversation,
  locationTitle,
  meaningfulTitleTurns,
  parseJson,
  positiveInteger,
  publicConversation,
  publicEvidence,
  publicMessage,
  refreshAutomaticConversationTitle,
  renameConversation,
  rolloverConversationIfNeeded,
  safeLimit,
  safeOffset,
  sameScope,
  schemaError,
};