"use strict";

const crypto = require("node:crypto");
const { assertToolCallBudget } = require("./aiCostControlService");
const { toolEvidenceTags } = require("./aiTaskPlannerService");

const DEFAULT_MAX_TOOL_ROUNDS = 3;
const HARD_MAX_TOOL_ROUNDS = 4;
const DEFAULT_MAX_PROVIDER_ROUNDS = DEFAULT_MAX_TOOL_ROUNDS + 1;
const PROVIDER_TOOL_DESCRIPTION_LIMIT = 720;
const PROVIDER_SCHEMA_DESCRIPTION_LIMIT = 180;
const PROVIDER_SCHEMA_ARRAY_LIMIT = 64;

class AiInvestigationLoopError extends Error {
  constructor(
    message,
    { code = "AI_INVESTIGATION_LOOP_ERROR", statusCode = 409, details = {} } = {}
  ) {
    super(message);
    this.name = "AiInvestigationLoopError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function boundedInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function getInvestigationConfig(env = process.env) {
  const maxToolRounds = boundedInteger(
    env.AI_MAX_TOOL_ROUNDS_PER_REQUEST,
    DEFAULT_MAX_TOOL_ROUNDS,
    HARD_MAX_TOOL_ROUNDS
  );
  return Object.freeze({
    max_tool_rounds: maxToolRounds,
    max_provider_rounds: maxToolRounds + 1,
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function toolCallIdentity(call = {}) {
  const toolKey = String(call.tool_key || call.name || "").trim();
  const payload = `${toolKey}|${canonicalJson(call.input || {})}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function assertReadOnlyInvestigationTools(tools = []) {
  const unsafe = (Array.isArray(tools) ? tools : []).filter(
    (tool) => Number(tool?.risk_level || 0) > 1
  );
  if (unsafe.length) {
    throw new AiInvestigationLoopError(
      "Autonomous multi-step investigation may use read-only intelligence tools only.",
      {
        code: "AI_INVESTIGATION_WRITE_TOOL_BLOCKED",
        statusCode: 403,
        details: {
          tool_keys: unsafe.map((tool) => String(tool?.key || "unknown")).slice(0, 10),
        },
      }
    );
  }
  return true;
}

function compactSchemaForProvider(value, key = "", depth = 0) {
  if (value == null || typeof value !== "object") {
    if (key === "description" && typeof value === "string") {
      return value.slice(0, PROVIDER_SCHEMA_DESCRIPTION_LIMIT);
    }
    return value;
  }

  if (depth > 12) return undefined;

  if (Array.isArray(value)) {
    return value
      .slice(0, PROVIDER_SCHEMA_ARRAY_LIMIT)
      .map((item) => compactSchemaForProvider(item, key, depth + 1))
      .filter((item) => item !== undefined);
  }

  const compact = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (["examples", "example", "$comment"].includes(childKey)) continue;
    if (childKey === "description" && typeof childValue === "string") {
      compact[childKey] = childValue.slice(0, PROVIDER_SCHEMA_DESCRIPTION_LIMIT);
      continue;
    }
    const normalized = compactSchemaForProvider(childValue, childKey, depth + 1);
    if (normalized !== undefined) compact[childKey] = normalized;
  }
  return compact;
}

function providerSafeReadTool(tool = {}) {
  const tags = toolEvidenceTags(tool);
  const description = String(tool?.description || tool?.title || tool?.key || "").trim();
  const tagHint = tags.length
    ? ` Planner evidence tags: ${tags.join(", ")}.`
    : " Planner evidence tags: general governed read.";
  const inputSchema =
    tool?.input_schema && typeof tool.input_schema === "object"
      ? compactSchemaForProvider(tool.input_schema)
      : { type: "object", properties: {}, additionalProperties: false };

  // Provider transport intentionally receives only the contract needed to ask
  // for a governed read. Permission, workspace, branch/site/location and
  // execution metadata remain server-side in aiToolRegistry and are rechecked
  // when a requested tool is executed.
  return Object.freeze({
    key: String(tool?.key || "").slice(0, 150),
    title: String(tool?.title || tool?.key || "Governed CHALIN read").slice(0, 180),
    description: `${description}${tagHint}`.trim().slice(0, PROVIDER_TOOL_DESCRIPTION_LIMIT),
    risk_level: Math.max(0, Number(tool?.risk_level || 0)),
    input_schema: Object.freeze(inputSchema),
    planner_evidence_tags: Object.freeze(tags),
  });
}

function plannerAwareReadTool(tool = {}) {
  return providerSafeReadTool(tool);
}

function filterReadOnlyInvestigationTools(tools = []) {
  return Object.freeze(
    (Array.isArray(tools) ? tools : [])
      .filter((tool) => Number(tool?.risk_level || 0) <= 1)
      .map(providerSafeReadTool)
  );
}

function assertToolRound({
  toolCalls = [],
  seenCallIds = new Set(),
  totalToolCalls = 0,
  toolRound = 1,
  budget,
  config,
} = {}) {
  const safeCalls = Array.isArray(toolCalls) ? toolCalls : [];
  const safeRound = Math.max(1, Number(toolRound) || 1);
  const safeConfig = config || getInvestigationConfig();

  if (safeRound > safeConfig.max_tool_rounds) {
    throw new AiInvestigationLoopError(
      "CHALIN reached the configured investigation round limit.",
      {
        code: "AI_TOOL_ROUND_LIMIT_EXCEEDED",
        details: {
          tool_round: safeRound,
          max_tool_rounds: safeConfig.max_tool_rounds,
        },
      }
    );
  }

  const projectedTotal = Number(totalToolCalls || 0) + safeCalls.length;
  assertToolCallBudget(projectedTotal, budget);

  const roundIds = new Set();
  const duplicates = [];
  for (const call of safeCalls) {
    const identity = toolCallIdentity(call);
    if (roundIds.has(identity) || seenCallIds.has(identity)) {
      duplicates.push({
        tool_key: String(call?.tool_key || call?.name || "unknown").slice(0, 150),
        identity,
      });
    }
    roundIds.add(identity);
  }

  if (duplicates.length) {
    throw new AiInvestigationLoopError(
      "CHALIN attempted to repeat an identical governed tool call during one investigation.",
      {
        code: "AI_TOOL_CALL_LOOP_BLOCKED",
        details: {
          duplicate_tool_keys: duplicates.map((item) => item.tool_key).slice(0, 10),
        },
      }
    );
  }

  return Object.freeze({
    projected_total_tool_calls: projectedTotal,
    new_call_ids: Object.freeze([...roundIds]),
  });
}

function investigationPromptBlock({ config, toolRound = 0, totalToolCalls = 0 } = {}) {
  const safeConfig = config || getInvestigationConfig();
  return [
    "CHALIN multi-step investigation contract:",
    `- You may request read-only governed tools across at most ${safeConfig.max_tool_rounds} investigation rounds.`,
    `- Completed tool rounds: ${Math.max(0, Number(toolRound) || 0)}; total governed tool calls: ${Math.max(0, Number(totalToolCalls) || 0)}.`,
    "- The preceding reasoning contract contains the server-resolved active task and subquestions. Treat every material subquestion as an investigation objective; do not silently drop one.",
    "- Authorized tools include planner evidence tags. Use those tags to choose the smallest set of tools that can cover the unresolved objectives.",
    "- Prefer one governed tool call that can answer several objectives over multiple redundant calls.",
    "- Use another tool only when it can resolve a material unknown, compare a needed period/source, or verify a conclusion.",
    "- Never repeat an identical tool call. Change the scope/period/query only when the new call answers a distinct question.",
    "- Stop investigating once the evidence is sufficient. More tool calls are not automatically better.",
    "- You have no autonomous write authority. Do not request or imply execution of payments, approvals, stock changes, customer changes, releases or other mutations.",
    "- On the final synthesis round no tools will be available. Answer every resolved objective and explicitly identify any objective that could not be verified from the governed evidence.",
  ].join("\n");
}

function investigationSummary({
  toolRounds = 0,
  totalToolCalls = 0,
  providerRounds = 1,
  duplicateLoopBlocked = false,
} = {}) {
  return Object.freeze({
    tool_rounds: Math.max(0, Number(toolRounds) || 0),
    total_tool_calls: Math.max(0, Number(totalToolCalls) || 0),
    provider_rounds: Math.max(1, Number(providerRounds) || 1),
    duplicate_loop_blocked: duplicateLoopBlocked === true,
    autonomous_write_authority: false,
    bounded: true,
  });
}

module.exports = {
  AiInvestigationLoopError,
  DEFAULT_MAX_PROVIDER_ROUNDS,
  DEFAULT_MAX_TOOL_ROUNDS,
  HARD_MAX_TOOL_ROUNDS,
  PROVIDER_SCHEMA_ARRAY_LIMIT,
  PROVIDER_SCHEMA_DESCRIPTION_LIMIT,
  PROVIDER_TOOL_DESCRIPTION_LIMIT,
  assertReadOnlyInvestigationTools,
  assertToolRound,
  boundedInteger,
  canonicalJson,
  compactSchemaForProvider,
  filterReadOnlyInvestigationTools,
  getInvestigationConfig,
  investigationPromptBlock,
  investigationSummary,
  plannerAwareReadTool,
  providerSafeReadTool,
  toolCallIdentity,
};
