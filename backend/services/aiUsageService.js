"use strict";

const crypto = require("crypto");

const { pool } = require("../config/db");

class AiUsageError extends Error {
  constructor(message, { code = "AI_USAGE_FAILED", statusCode = 503, details = [] } = {}) {
    super(message);
    this.name = "AiUsageError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function usageKey() {
  return `usage_${crypto.randomUUID()}`;
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength) || null;
}

function nonNegativeInteger(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function schemaError(error) {
  if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) {
    return new AiUsageError(
      "The CHALIN ONE AI usage schema is not ready in this environment.",
      { code: "AI_SCHEMA_NOT_READY", statusCode: 503 }
    );
  }
  return error;
}

async function recordUsage({
  connection = pool,
  userId = null,
  conversationId = null,
  messageId = null,
  providerKey,
  modelKey,
  workspaceCode = null,
  inputTokens = 0,
  outputTokens = 0,
  costMicros = 0,
  requestId = null,
} = {}) {
  const input = nonNegativeInteger(inputTokens);
  const output = nonNegativeInteger(outputTokens);
  const key = usageKey();

  try {
    const [result] = await connection.query(
      `INSERT INTO ai_usage_ledger (
         usage_key, user_id, conversation_id, message_id,
         provider_key, model_key, workspace_code,
         input_tokens, output_tokens, total_tokens, cost_micros, request_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        userId || null,
        conversationId || null,
        messageId || null,
        clean(providerKey || "unknown", 80),
        clean(modelKey || "unknown", 160),
        clean(workspaceCode, 50),
        input,
        output,
        input + output,
        nonNegativeInteger(costMicros),
        clean(requestId, 100),
      ]
    );
    return Object.freeze({
      id: Number(result.insertId),
      usage_key: key,
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
      cost_micros: nonNegativeInteger(costMicros),
    });
  } catch (error) {
    throw schemaError(error);
  }
}

async function getDailyUsage({
  connection = pool,
  userId = null,
  workspaceCode = null,
} = {}) {
  try {
    const [[userRows], [workspaceRows]] = await Promise.all([
      userId
        ? connection.query(
            `SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens,
                    COALESCE(SUM(cost_micros), 0) AS cost_micros
             FROM ai_usage_ledger
             WHERE user_id = ? AND created_at >= UTC_DATE()`,
            [userId]
          )
        : Promise.resolve([[]]),
      workspaceCode
        ? connection.query(
            `SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens,
                    COALESCE(SUM(cost_micros), 0) AS cost_micros
             FROM ai_usage_ledger
             WHERE workspace_code = ? AND created_at >= UTC_DATE()`,
            [workspaceCode]
          )
        : Promise.resolve([[]]),
    ]);

    return Object.freeze({
      user_tokens: nonNegativeInteger(userRows?.[0]?.total_tokens),
      user_cost_micros: nonNegativeInteger(userRows?.[0]?.cost_micros),
      workspace_tokens: nonNegativeInteger(workspaceRows?.[0]?.total_tokens),
      workspace_cost_micros: nonNegativeInteger(workspaceRows?.[0]?.cost_micros),
    });
  } catch (error) {
    throw schemaError(error);
  }
}

async function getMonthlyCost({ connection = pool } = {}) {
  try {
    const [rows] = await connection.query(
      `SELECT COALESCE(SUM(cost_micros), 0) AS cost_micros
       FROM ai_usage_ledger
       WHERE created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01 00:00:00')`
    );
    return nonNegativeInteger(rows[0]?.cost_micros);
  } catch (error) {
    throw schemaError(error);
  }
}

async function listUsageSummary({
  connection = pool,
  workspaceCode = null,
  userId = null,
  days = 30,
} = {}) {
  const safeDays = Math.max(1, Math.min(90, nonNegativeInteger(days) || 30));
  const filters = ["created_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)"];
  const params = [safeDays - 1];
  if (workspaceCode) {
    filters.push("workspace_code = ?");
    params.push(clean(workspaceCode, 50));
  }
  if (userId) {
    filters.push("user_id = ?");
    params.push(Number(userId));
  }

  try {
    const [rows] = await connection.query(
      `SELECT DATE(created_at) AS usage_date,
              provider_key, model_key,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(total_tokens) AS total_tokens,
              SUM(cost_micros) AS cost_micros,
              COUNT(*) AS request_count
       FROM ai_usage_ledger
       WHERE ${filters.join(" AND ")}
       GROUP BY DATE(created_at), provider_key, model_key
       ORDER BY usage_date DESC, provider_key, model_key`,
      params
    );
    return rows.map((row) => ({
      usage_date: row.usage_date,
      provider_key: row.provider_key,
      model_key: row.model_key,
      input_tokens: nonNegativeInteger(row.input_tokens),
      output_tokens: nonNegativeInteger(row.output_tokens),
      total_tokens: nonNegativeInteger(row.total_tokens),
      cost_micros: nonNegativeInteger(row.cost_micros),
      request_count: nonNegativeInteger(row.request_count),
    }));
  } catch (error) {
    throw schemaError(error);
  }
}

module.exports = {
  AiUsageError,
  getDailyUsage,
  getMonthlyCost,
  listUsageSummary,
  nonNegativeInteger,
  recordUsage,
  schemaError,
  usageKey,
};
