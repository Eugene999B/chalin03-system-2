"use strict";

// These are abuse/transport guardrails, not product allowances. CHALIN no longer
// imposes the tiny 6k-request / 100k-daily limits that made long reasoning and
// continuity feel artificially capped. Provider context/rate limits remain the
// outer technical boundary and explicit monthly cost enforcement remains opt-in.
const DEFAULT_REQUEST_TOKEN_LIMIT = 262144;
const DEFAULT_DAILY_USER_TOKEN_LIMIT = 10000000;
const DEFAULT_DAILY_WORKSPACE_TOKEN_LIMIT = 100000000;
const DEFAULT_MAX_TOOL_CALLS = 20;
const MAX_CONFIGURED_TOKEN_LIMIT = 10000000;

class AiBudgetError extends Error {
  constructor(message, { code = "AI_BUDGET_EXCEEDED", statusCode = 429, details = {} } = {}) {
    super(message);
    this.name = "AiBudgetError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function boundedInteger(value, fallback, maximum = MAX_CONFIGURED_TOKEN_LIMIT) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function estimateTokens(value) {
  const characters =
    typeof value === "string" ? value.length : JSON.stringify(value ?? null).length;
  return Math.max(1, Math.ceil(characters / 4));
}

function getAiBudgetConfig(env = process.env) {
  return Object.freeze({
    request_token_limit: boundedInteger(
      env.AI_REQUEST_TOKEN_LIMIT,
      DEFAULT_REQUEST_TOKEN_LIMIT
    ),
    daily_user_token_limit: boundedInteger(
      env.AI_DAILY_USER_TOKEN_LIMIT,
      DEFAULT_DAILY_USER_TOKEN_LIMIT
    ),
    daily_workspace_token_limit: boundedInteger(
      env.AI_DAILY_WORKSPACE_TOKEN_LIMIT,
      DEFAULT_DAILY_WORKSPACE_TOKEN_LIMIT
    ),
    max_tool_calls: boundedInteger(
      env.AI_MAX_TOOL_CALLS_PER_REQUEST,
      DEFAULT_MAX_TOOL_CALLS,
      20
    ),
    monthly_cost_limit_micros: boundedInteger(
      env.AI_MONTHLY_COST_LIMIT_MICROS,
      1,
      Number.MAX_SAFE_INTEGER
    ),
    cost_enforcement_enabled: Number(env.AI_MONTHLY_COST_LIMIT_MICROS || 0) > 0,
  });
}

function buildRequestBudget({ messages = [], tools = [], env = process.env } = {}) {
  const config = getAiBudgetConfig(env);
  const estimatedInputTokens = estimateTokens({ messages, tools });
  if (estimatedInputTokens >= config.request_token_limit) {
    throw new AiBudgetError(
      "This AI request is too large for the configured transport budget.",
      {
        code: "AI_REQUEST_TOKEN_LIMIT_EXCEEDED",
        statusCode: 413,
        details: {
          estimated_input_tokens: estimatedInputTokens,
          request_token_limit: config.request_token_limit,
        },
      }
    );
  }

  return Object.freeze({
    ...config,
    estimated_input_tokens: estimatedInputTokens,
    maximum_output_tokens: Math.max(
      1,
      Math.min(32768, config.request_token_limit - estimatedInputTokens)
    ),
  });
}

function assertToolCallBudget(toolCallCount, budget) {
  const count = Number(toolCallCount || 0);
  if (count > budget.max_tool_calls) {
    throw new AiBudgetError("The AI requested too many tools in one response.", {
      code: "AI_TOOL_CALL_LIMIT_EXCEEDED",
      details: { tool_call_count: count, limit: budget.max_tool_calls },
    });
  }
  return true;
}

function assertDailyUsage({ userTokens = 0, workspaceTokens = 0, budget }) {
  if (Number(userTokens) >= budget.daily_user_token_limit) {
    throw new AiBudgetError("The technical daily AI guardrail for this account was reached.", {
      code: "AI_DAILY_USER_LIMIT_EXCEEDED",
      details: {
        used_tokens: Number(userTokens),
        limit_tokens: budget.daily_user_token_limit,
      },
    });
  }
  if (Number(workspaceTokens) >= budget.daily_workspace_token_limit) {
    throw new AiBudgetError("The technical daily AI guardrail for this workspace was reached.", {
      code: "AI_DAILY_WORKSPACE_LIMIT_EXCEEDED",
      details: {
        used_tokens: Number(workspaceTokens),
        limit_tokens: budget.daily_workspace_token_limit,
      },
    });
  }
  return true;
}

function assertMonthlyCost({ usedMicros = 0, additionalMicros = 0, budget }) {
  if (!budget.cost_enforcement_enabled) return true;
  const projected = Number(usedMicros || 0) + Number(additionalMicros || 0);
  if (projected > budget.monthly_cost_limit_micros) {
    throw new AiBudgetError("The configured monthly AI cost limit would be exceeded.", {
      code: "AI_MONTHLY_COST_LIMIT_EXCEEDED",
      details: {
        projected_cost_micros: projected,
        limit_micros: budget.monthly_cost_limit_micros,
      },
    });
  }
  return true;
}

module.exports = {
  AiBudgetError,
  DEFAULT_DAILY_USER_TOKEN_LIMIT,
  DEFAULT_DAILY_WORKSPACE_TOKEN_LIMIT,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_REQUEST_TOKEN_LIMIT,
  assertDailyUsage,
  assertMonthlyCost,
  assertToolCallBudget,
  boundedInteger,
  buildRequestBudget,
  estimateTokens,
  getAiBudgetConfig,
};
