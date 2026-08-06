"use strict";

const crypto = require("crypto");

const { pool } = require("../config/db");
const { writeAuditEvent } = require("./auditTrailService");

const RATINGS = Object.freeze([
  "helpful",
  "not_helpful",
  "incorrect",
  "unsafe",
]);

class AiFeedbackError extends Error {
  constructor(message, { code = "AI_FEEDBACK_ERROR", statusCode = 400 } = {}) {
    super(message);
    this.name = "AiFeedbackError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength) || null;
}

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new AiFeedbackError(
      "The CHALIN ONE AI feedback schema is not ready in this environment.",
      { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

async function createFeedback({
  conversationKey,
  messageKey,
  rating,
  comment = null,
  correction = null,
  user,
  req,
} = {}) {
  const normalizedRating = clean(rating, 30)?.toLowerCase();
  if (!RATINGS.includes(normalizedRating)) {
    throw new AiFeedbackError("Choose a valid AI feedback rating.", {
      code: "AI_FEEDBACK_RATING_INVALID",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT c.id AS conversation_id, m.id AS message_id, m.message_role
       FROM ai_conversations c
       JOIN ai_messages m ON m.conversation_id = c.id
       WHERE c.conversation_key = ? AND c.user_id = ? AND m.message_key = ?
       LIMIT 1 FOR UPDATE`,
      [clean(conversationKey, 64), user?.id || null, clean(messageKey, 64)]
    );
    const target = rows[0];
    if (!target || target.message_role !== "assistant") {
      throw new AiFeedbackError("The assistant message was not found.", {
        code: "AI_FEEDBACK_MESSAGE_NOT_FOUND",
        statusCode: 404,
      });
    }

    const feedbackKey = `feedback_${crypto.randomUUID()}`;
    const [result] = await connection.query(
      `INSERT INTO ai_feedback (
         feedback_key, conversation_id, message_id, user_id, rating,
         comment_text, correction_text, review_status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')`,
      [
        feedbackKey,
        target.conversation_id,
        target.message_id,
        user?.id || null,
        normalizedRating,
        clean(comment, 2000),
        clean(correction, 10000),
      ]
    );
    await writeAuditEvent({
      connection,
      req,
      action: "AI_FEEDBACK_CREATED",
      details: "CHALIN ONE AI answer feedback submitted",
      entityType: "ai_feedback",
      entityId: Number(result.insertId),
      metadata: {
        feedback_key: feedbackKey,
        rating: normalizedRating,
        conversation_id: target.conversation_id,
        message_id: target.message_id,
      },
    });
    await connection.commit();
    return Object.freeze({
      feedback_key: feedbackKey,
      review_status: "new",
    });
  } catch (error) {
    await connection.rollback();
    if (error instanceof AiFeedbackError) throw error;
    throw schemaError(error);
  } finally {
    connection.release();
  }
}

async function listFeedback({ status = "new", rating = null, limit = 50 } = {}) {
  const filters = ["1 = 1"];
  const params = [];
  if (["new", "reviewed", "accepted", "rejected"].includes(status)) {
    filters.push("f.review_status = ?");
    params.push(status);
  }
  if (rating && RATINGS.includes(rating)) {
    filters.push("f.rating = ?");
    params.push(rating);
  }
  params.push(Math.max(1, Math.min(100, Number(limit) || 50)));

  try {
    const [rows] = await pool.query(
      `SELECT f.feedback_key, f.rating, f.comment_text, f.correction_text,
              f.review_status, f.created_at, f.reviewed_at,
              c.conversation_key, m.message_key, c.workspace_code,
              c.persona, f.user_id, f.reviewed_by
       FROM ai_feedback f
       JOIN ai_conversations c ON c.id = f.conversation_id
       JOIN ai_messages m ON m.id = f.message_id
       WHERE ${filters.join(" AND ")}
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT ?`,
      params
    );
    return rows;
  } catch (error) {
    throw schemaError(error);
  }
}

module.exports = {
  AiFeedbackError,
  RATINGS,
  createFeedback,
  listFeedback,
  schemaError,
};
