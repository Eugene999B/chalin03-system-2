"use strict";

const crypto = require("crypto");

const { pool } = require("../config/db");
const { createPublicFormSubmission } = require("./publicFormSubmissionService");
const { evidenceCitationMap, evidencePromptBlock } = require("./aiEvidenceService");
const { searchApprovedKnowledge } = require("./aiKnowledgeService");
const { generateProviderResponse } = require("./aiProviderService");
const {
  AiSafetyError,
  hashText,
  inspectPrompt,
  redactSensitiveText,
} = require("./aiSafetyService");
const { writeAiAuditEvent, writePromptSafetyEvent } = require("./aiAuditService");

const SESSION_TTL_MINUTES = 30;
const MAX_SESSION_MESSAGES = 30;
const MAX_HISTORY_MESSAGES = 12;
const PRIVATE_HANDOFF_PATTERNS = Object.freeze([
  /\bmy\s+(account|balance|debt|payment|receipt|application|contract|finance|installment|order|invoice)\b/i,
  /\b(customer|staff|employee|supplier|applicant)\s+(record|profile|statement|details?)\b/i,
  /\b(check|show|find|look up|verify)\b.{0,40}\b(account|balance|debt|payment|receipt|application|contract|invoice)\b/i,
  /\b(id card|ghana card|passport|bank statement|payslip|phone number|email address)\b/i,
]);
const GUIDE_SYSTEM_INSTRUCTION =
  "You are Chalin Guide, a public information assistant for CHALIN 03. Use only the supplied published public evidence. Cite claims as [E1], [E2]. Never infer private customer, staff, supplier, applicant, financial or operational records. Never request passwords, identity documents or banking records. When published evidence is insufficient, say so and recommend the governed enquiry handoff.";

class PublicGuideError extends Error {
  constructor(message, { code = "PUBLIC_GUIDE_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "PublicGuideError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength) || null;
}

function guideKey(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function tokenHash(token) {
  return hashText(String(token || ""));
}

function ipHash(ip, env = process.env) {
  const secret = String(env.PUBLIC_FORM_IP_HASH_SECRET || "").trim();
  if (secret.length < 32) {
    throw new PublicGuideError(
      "Public Guide privacy hashing is not configured in this environment.",
      { code: "PUBLIC_GUIDE_PRIVACY_NOT_CONFIGURED", statusCode: 503 }
    );
  }
  return crypto
    .createHmac("sha256", secret)
    .update(String(ip || "unknown"), "utf8")
    .digest("hex");
}

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new PublicGuideError(
      "The public Guide foundation is not ready in this environment.",
      { code: "PUBLIC_GUIDE_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

function requiresPrivateHandoff(message) {
  return PRIVATE_HANDOFF_PATTERNS.some((pattern) => pattern.test(message));
}

async function createPublicGuideSession({ ip, env = process.env } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const sessionKey = guideKey("gd");
  try {
    await pool.query(
      `INSERT INTO ai_public_guide_sessions (
         session_key, token_sha256, ip_hash, session_status, expires_at
       ) VALUES (?, ?, ?, 'active', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
      [sessionKey, tokenHash(token), ipHash(ip, env), SESSION_TTL_MINUTES]
    );
    return Object.freeze({
      session_key: sessionKey,
      session_token: token,
      expires_in_minutes: SESSION_TTL_MINUTES,
      privacy:
        "The raw session token is returned once and is not stored by the server.",
    });
  } catch (error) {
    throw schemaError(error);
  }
}

async function loadPublicGuideSession({ token, connection = pool, forUpdate = false } = {}) {
  const rawToken = clean(token, 200);
  if (!rawToken) {
    throw new PublicGuideError("A valid Guide session is required.", {
      code: "PUBLIC_GUIDE_SESSION_REQUIRED",
      statusCode: 401,
    });
  }
  try {
    const [rows] = await connection.query(
      `SELECT * FROM ai_public_guide_sessions
       WHERE token_sha256 = ?
       LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [tokenHash(rawToken)]
    );
    const session = rows[0];
    if (!session) {
      throw new PublicGuideError("Guide session not found.", {
        code: "PUBLIC_GUIDE_SESSION_NOT_FOUND",
        statusCode: 401,
      });
    }
    if (
      session.session_status !== "active" ||
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      if (session.session_status === "active") {
        await connection.query(
          `UPDATE ai_public_guide_sessions
           SET session_status = 'expired', updated_at = UTC_TIMESTAMP()
           WHERE id = ?`,
          [session.id]
        );
      }
      throw new PublicGuideError("Guide session has expired.", {
        code: "PUBLIC_GUIDE_SESSION_EXPIRED",
        statusCode: 401,
      });
    }
    if (Number(session.message_count || 0) >= MAX_SESSION_MESSAGES) {
      throw new PublicGuideError(
        "This Guide session reached its message limit. Start a new session or use the enquiry handoff.",
        { code: "PUBLIC_GUIDE_MESSAGE_LIMIT_REACHED", statusCode: 429 }
      );
    }
    return session;
  } catch (error) {
    if (error instanceof PublicGuideError) throw error;
    throw schemaError(error);
  }
}

async function guideHistory(sessionId, connection = pool) {
  try {
    const [rows] = await connection.query(
      `SELECT message_key, message_role, content_text, safety_status,
              evidence_json, provider_key, model_key, created_at
       FROM ai_public_guide_messages
       WHERE session_id = ?
       ORDER BY id DESC LIMIT ?`,
      [sessionId, MAX_HISTORY_MESSAGES]
    );
    return rows.reverse().map((row) => ({
      key: row.message_key,
      role: row.message_role,
      content: row.content_text,
      safety_status: row.safety_status,
      evidence:
        row.evidence_json && typeof row.evidence_json === "string"
          ? JSON.parse(row.evidence_json)
          : row.evidence_json || [],
      provider_key: row.provider_key,
      model_key: row.model_key,
      created_at: row.created_at,
    }));
  } catch (error) {
    throw schemaError(error);
  }
}

async function addGuideMessage({
  connection,
  sessionId,
  role,
  content,
  safetyStatus = "allowed",
  evidence = [],
  providerKey = null,
  modelKey = null,
  inputTokens = 0,
  outputTokens = 0,
  latencyMs = null,
  errorCode = null,
} = {}) {
  const text = String(content || "").slice(0, 24000);
  const messageKey = guideKey("gm");
  const [result] = await connection.query(
    `INSERT INTO ai_public_guide_messages (
       message_key, session_id, message_role, content_text, content_sha256,
       safety_status, evidence_json, provider_key, model_key, input_tokens,
       output_tokens, latency_ms, error_code
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      messageKey,
      sessionId,
      role,
      text,
      hashText(text),
      safetyStatus,
      evidence.length > 0 ? JSON.stringify(evidence).slice(0, 64000) : null,
      clean(providerKey, 80),
      clean(modelKey, 160),
      Math.max(0, Number(inputTokens || 0)),
      Math.max(0, Number(outputTokens || 0)),
      Number.isFinite(Number(latencyMs)) ? Math.max(0, Number(latencyMs)) : null,
      clean(errorCode, 120),
    ]
  );
  await connection.query(
    `UPDATE ai_public_guide_sessions
     SET message_count = message_count + 1,
         last_message_at = UTC_TIMESTAMP(),
         expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE),
         updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [SESSION_TTL_MINUTES, sessionId]
  );
  return Object.freeze({ id: Number(result.insertId), key: messageKey });
}

function publicGuideMessages({ history, question, evidence }) {
  return [
    { role: "system", content: GUIDE_SYSTEM_INSTRUCTION },
    {
      role: "system",
      content: `Published public evidence:\n${evidencePromptBlock(evidence)}`,
    },
    ...history
      .filter((message) => ["user", "assistant"].includes(message.role))
      .slice(-8)
      .map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: question },
  ];
}

async function answerPublicGuide({
  token,
  message,
  req,
  provider = null,
  env = process.env,
} = {}) {
  const connection = await pool.getConnection();
  let session = null;
  try {
    await connection.beginTransaction();
    session = await loadPublicGuideSession({
      token,
      connection,
      forUpdate: true,
    });
    const inspection = inspectPrompt(message, {
      allowHighRiskDiscussion: true,
    });
    const userMessage = await addGuideMessage({
      connection,
      sessionId: session.id,
      role: "user",
      content: inspection.text,
      safetyStatus: inspection.action,
    });
    await connection.commit();

    await writePromptSafetyEvent({
      req,
      conversationId: null,
      messageId: null,
      eventType:
        inspection.redaction_count > 0 ? "sensitive_data" : "other",
      action: inspection.action,
      patternKeys: inspection.pattern_keys,
      redactionCount: inspection.redaction_count,
      inputSha256: inspection.input_sha256,
      safeSummary: inspection.safe_summary,
    }).catch(() => null);

    if (requiresPrivateHandoff(inspection.text)) {
      const answer =
        "I cannot access or look up private customer, staff, supplier, applicant, payment, debt or application records. Use the secure enquiry handoff so an authorized CHALIN 03 team member can respond.";
      const responseConnection = await pool.getConnection();
      try {
        await responseConnection.beginTransaction();
        const refreshed = await loadPublicGuideSession({
          token,
          connection: responseConnection,
          forUpdate: true,
        });
        const assistant = await addGuideMessage({
          connection: responseConnection,
          sessionId: refreshed.id,
          role: "assistant",
          content: answer,
          safetyStatus: "blocked",
          errorCode: "PUBLIC_GUIDE_PRIVATE_HANDOFF_REQUIRED",
        });
        await responseConnection.commit();
        return Object.freeze({
          session_key: session.session_key,
          message_key: assistant.key,
          answer,
          evidence: [],
          citations: {},
          requires_handoff: true,
        });
      } catch (error) {
        await responseConnection.rollback();
        throw error;
      } finally {
        responseConnection.release();
      }
    }

    const [history, evidence] = await Promise.all([
      guideHistory(session.id),
      searchApprovedKnowledge({
        query: inspection.text,
        persona: "guide",
        limit: 6,
      }),
    ]);

    if (evidence.length === 0) {
      const answer =
        "I do not have enough approved published information to answer that reliably. Use the enquiry handoff and the appropriate CHALIN 03 team can assist.";
      const responseConnection = await pool.getConnection();
      try {
        await responseConnection.beginTransaction();
        const refreshed = await loadPublicGuideSession({
          token,
          connection: responseConnection,
          forUpdate: true,
        });
        const assistant = await addGuideMessage({
          connection: responseConnection,
          sessionId: refreshed.id,
          role: "assistant",
          content: answer,
          safetyStatus: "allowed",
        });
        await responseConnection.commit();
        return Object.freeze({
          session_key: session.session_key,
          message_key: assistant.key,
          answer,
          evidence: [],
          citations: {},
          requires_handoff: true,
        });
      } catch (error) {
        await responseConnection.rollback();
        throw error;
      } finally {
        responseConnection.release();
      }
    }

    const providerResult = await generateProviderResponse({
      provider,
      messages: publicGuideMessages({
        history: history.slice(0, -1),
        question: inspection.text,
        evidence,
      }),
      tools: [],
      maxOutputTokens: 1200,
      env,
    });

    const responseConnection = await pool.getConnection();
    try {
      await responseConnection.beginTransaction();
      const refreshed = await loadPublicGuideSession({
        token,
        connection: responseConnection,
        forUpdate: true,
      });
      const assistant = await addGuideMessage({
        connection: responseConnection,
        sessionId: refreshed.id,
        role: "assistant",
        content: providerResult.text,
        safetyStatus: "allowed",
        evidence,
        providerKey: providerResult.provider_key,
        modelKey: providerResult.model_key,
        inputTokens: providerResult.input_tokens,
        outputTokens: providerResult.output_tokens,
        latencyMs: providerResult.latency_ms,
      });
      await responseConnection.commit();
      await writeAiAuditEvent({
        req,
        eventType: "PUBLIC_GUIDE_TURN_COMPLETED",
        outcome: "success",
        severity: "info",
        persona: "guide",
        scope: { visibility: "public" },
        metadata: {
          session_key: session.session_key,
          user_message_key: userMessage.key,
          assistant_message_key: assistant.key,
          provider_key: providerResult.provider_key,
          model_key: providerResult.model_key,
          evidence_count: evidence.length,
          prompt_sha256: inspection.input_sha256,
        },
      }).catch(() => null);
      return Object.freeze({
        session_key: session.session_key,
        message_key: assistant.key,
        answer: providerResult.text,
        evidence,
        citations: evidenceCitationMap(evidence),
        requires_handoff: false,
      });
    } catch (error) {
      await responseConnection.rollback();
      throw error;
    } finally {
      responseConnection.release();
    }
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // The initial user message transaction may already be committed.
    }
    if (error instanceof PublicGuideError || error instanceof AiSafetyError) {
      throw error;
    }
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function getPublicGuideHistory({ token } = {}) {
  const session = await loadPublicGuideSession({ token });
  return Object.freeze({
    session_key: session.session_key,
    expires_at: session.expires_at,
    message_count: Number(session.message_count || 0),
    messages: await guideHistory(session.id),
  });
}

async function createPublicGuideHandoff({
  token,
  payload,
  requestContext,
  formSlug = "contact",
} = {}) {
  const session = await loadPublicGuideSession({ token });
  const message = clean(payload?.message, 2000);
  const fullName = clean(payload?.full_name, 180);
  const email = clean(payload?.email, 254);
  const phone = clean(payload?.phone, 80);
  if (!message || (!email && !phone)) {
    throw new PublicGuideError(
      "Provide an enquiry message and either an email address or phone number.",
      { code: "PUBLIC_GUIDE_HANDOFF_INVALID" }
    );
  }

  const result = await createPublicFormSubmission({
    formSlug,
    payload: {
      full_name: fullName,
      email,
      phone,
      company_name: clean(payload?.company_name, 180),
      consent_given: payload?.consent_given === true,
      consent_text_version: clean(
        payload?.consent_text_version || "privacy-v1",
        100
      ),
      source_page_slug: "chalin-guide",
      source_url: clean(payload?.source_url, 500),
      responses: {
        service_interest: clean(
          payload?.service_interest || "General company enquiry",
          180
        ),
        subject: clean(payload?.subject || "Chalin Guide handoff", 180),
        message: `${message}\n\nGuide session reference: ${session.session_key}`,
        preferred_contact_method: clean(
          payload?.preferred_contact_method,
          80
        ),
      },
    },
    requestContext,
  });

  await pool.query(
    `UPDATE ai_public_guide_sessions
     SET session_status = 'closed', updated_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [session.id]
  );

  return Object.freeze({
    accepted: result?.accepted === true,
    reference_code: result?.reference_code || null,
    confirmation_message:
      result?.confirmation_message ||
      "Your enquiry was sent to the appropriate CHALIN 03 team.",
  });
}

module.exports = {
  GUIDE_SYSTEM_INSTRUCTION,
  MAX_HISTORY_MESSAGES,
  MAX_SESSION_MESSAGES,
  PRIVATE_HANDOFF_PATTERNS,
  PublicGuideError,
  SESSION_TTL_MINUTES,
  addGuideMessage,
  answerPublicGuide,
  createPublicGuideHandoff,
  createPublicGuideSession,
  getPublicGuideHistory,
  guideHistory,
  guideKey,
  ipHash,
  loadPublicGuideSession,
  publicGuideMessages,
  requiresPrivateHandoff,
  schemaError,
  tokenHash,
};
