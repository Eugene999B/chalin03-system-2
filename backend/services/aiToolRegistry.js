"use strict";

const crypto = require("crypto");

const { isFeatureEnabled } = require("./featureFlagService");
const { assertAiRiskAuthorized } = require("./aiCapabilityService");
const {
  AiPermissionError,
  buildToolExecutionContext,
  validateAiScopeAccess,
} = require("./aiPermissionService");
const {
  normalizeAiPermission,
  normalizeAiPersona,
} = require("../security/aiPermissionCatalog");
const { ALL_PERMISSIONS } = require("../security/permissionCatalog");
const { EQUIPMENT_DIVISIONS } = require("../security/equipmentDivisionAccess");

const DEFAULT_TOOL_TIMEOUT_MS = 8000;
const DEFAULT_MAX_INPUT_BYTES = 12000;
const DEFAULT_MAX_OUTPUT_BYTES = 64000;
const TOOL_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,149}$/;
const FORBIDDEN_HANDLER_SOURCE =
  /(config\/db|mysql2|\bpool\s*\.|\bconnection\s*\.|\.query\s*\(|\bSELECT\s+|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b)/i;
const EQUIPMENT_DIVISION_VALUES = Object.freeze(Object.values(EQUIPMENT_DIVISIONS));
const TODAY_SIGNAL_PATTERN = /\btoday\b/i;
const YESTERDAY_SIGNAL_PATTERN = /\byesterday\b/i;
const RELATIVE_DATE_RANGE_PATTERN = /\b(?:compare|comparison|compared|versus|vs\.?|between|from|through|until|since|last\s+(?:week|month|quarter|year|\d+\s+days?)|this\s+(?:week|month|quarter|year)|past\s+\d+\s+days?)\b/i;

class AiToolRegistryError extends Error {
  constructor(message, { code = "AI_TOOL_REGISTRY_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiToolRegistryError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function serializedBytes(value) {
  let encoded;
  try {
    encoded = JSON.stringify(value ?? null);
  } catch {
    throw new AiToolRegistryError("AI tool data must be JSON serializable.", {
      code: "AI_TOOL_JSON_INVALID",
    });
  }
  return Buffer.byteLength(encoded, "utf8");
}

function requestPrompt(req) {
  return String(req?.body?.message ?? req?.body?.prompt ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 12000);
}

function utcDateOnly(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function shiftedUtcDateOnly(value = new Date(), days = 0) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return utcDateOnly(date);
}

function toolAcceptsDateWindow(tool) {
  const properties = tool?.input_schema?.properties;
  return Boolean(
    properties &&
    typeof properties === "object" &&
    Object.prototype.hasOwnProperty.call(properties, "start_date") &&
    Object.prototype.hasOwnProperty.call(properties, "end_date")
  );
}

function groundRelativeDateInput({ tool, input = {}, req = null, now = new Date() } = {}) {
  const sourceInput = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (Number(tool?.risk_level || 0) !== 1 || !toolAcceptsDateWindow(tool)) {
    return Object.freeze({ ...sourceInput });
  }

  const prompt = requestPrompt(req);
  if (!prompt || RELATIVE_DATE_RANGE_PATTERN.test(prompt)) {
    return Object.freeze({ ...sourceInput });
  }

  const today = TODAY_SIGNAL_PATTERN.test(prompt);
  const yesterday = YESTERDAY_SIGNAL_PATTERN.test(prompt);
  if (today === yesterday) {
    return Object.freeze({ ...sourceInput });
  }

  const groundedDate = yesterday
    ? shiftedUtcDateOnly(now, -1)
    : utcDateOnly(now);
  if (!groundedDate) {
    return Object.freeze({ ...sourceInput });
  }

  return Object.freeze({
    ...sourceInput,
    start_date: groundedDate,
    end_date: groundedDate,
  });
}

function hashJson(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value ?? null), "utf8")
    .digest("hex");
}

function normalizeToolDefinition(definition = {}) {
  const key = String(definition.key || "").trim().toLowerCase();
  const title = String(definition.title || "").trim().slice(0, 180);
  const description = String(definition.description || "").trim().slice(0, 1000);
  const version = String(definition.version || "1").trim().slice(0, 40);
  const riskLevel = Number(definition.risk_level || 1);
  const personas = [...new Set((definition.personas || []).map(normalizeAiPersona).filter(Boolean))];
  const requiredPermissions = [...new Set((definition.required_permissions || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const requiredBusinessPermissions = [...new Set((definition.required_business_permissions || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const allowedWorkspaces = [...new Set((definition.allowed_workspaces || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  const requiredEquipmentDivision = String(
    definition.required_equipment_division || ""
  )
    .trim()
    .toLowerCase() || null;
  const handler = definition.handler;

  if (!TOOL_KEY_PATTERN.test(key) || !title || !description) {
    throw new AiToolRegistryError(
      "AI tools require a safe key, title and description.",
      { code: "AI_TOOL_DEFINITION_INVALID" }
    );
  }
  if (!Number.isInteger(riskLevel) || riskLevel < 1 || riskLevel > 5) {
    throw new AiToolRegistryError("AI tool risk level must be between 1 and 5.", {
      code: "AI_TOOL_RISK_INVALID",
    });
  }
  if (personas.length === 0) {
    throw new AiToolRegistryError("AI tools require at least one allowed persona.", {
      code: "AI_TOOL_PERSONA_REQUIRED",
    });
  }
  const invalidAiPermissions = requiredPermissions.filter(
    (permission) => !normalizeAiPermission(permission)
  );
  if (invalidAiPermissions.length > 0) {
    throw new AiToolRegistryError(
      "AI tool permissions must exist in the CHALIN AI permission catalog.",
      {
        code: "AI_TOOL_AI_PERMISSION_INVALID",
        details: invalidAiPermissions,
      }
    );
  }
  const invalidBusinessPermissions = requiredBusinessPermissions.filter(
    (permission) => !ALL_PERMISSIONS.includes(permission)
  );
  if (invalidBusinessPermissions.length > 0) {
    throw new AiToolRegistryError(
      "AI tool business permissions must exist in the CHALIN permission catalog.",
      {
        code: "AI_TOOL_BUSINESS_PERMISSION_INVALID",
        details: invalidBusinessPermissions,
      }
    );
  }
  if (
    requiredEquipmentDivision &&
    !EQUIPMENT_DIVISION_VALUES.includes(requiredEquipmentDivision)
  ) {
    throw new AiToolRegistryError(
      "AI tool equipment division must be hire, finance or both.",
      {
        code: "AI_TOOL_EQUIPMENT_DIVISION_INVALID",
        details: [requiredEquipmentDivision],
      }
    );
  }
  if (typeof handler !== "function") {
    throw new AiToolRegistryError("AI tools require an executable handler.", {
      code: "AI_TOOL_HANDLER_REQUIRED",
    });
  }

  const handlerSource = Function.prototype.toString.call(handler);
  if (FORBIDDEN_HANDLER_SOURCE.test(handlerSource)) {
    throw new AiToolRegistryError(
      "AI tool handlers may not contain direct database or SQL access. Use an approved scoped business service.",
      { code: "AI_TOOL_DIRECT_DATABASE_BLOCKED" }
    );
  }

  return Object.freeze({
    key,
    title,
    description,
    version,
    risk_level: riskLevel,
    personas: Object.freeze(personas),
    required_permissions: Object.freeze(requiredPermissions),
    required_business_permissions: Object.freeze(requiredBusinessPermissions),
    required_equipment_division: requiredEquipmentDivision,
    allowed_workspaces: Object.freeze(allowedWorkspaces),
    scope_requirements: Object.freeze({
      branch: definition.scope_requirements?.branch === true,
      mining_site: definition.scope_requirements?.mining_site === true,
      hire_location: definition.scope_requirements?.hire_location === true,
    }),
    input_schema: Object.freeze(definition.input_schema || { type: "object" }),
    evidence_required: definition.evidence_required !== false,
    max_input_bytes: positiveInteger(
      definition.max_input_bytes,
      DEFAULT_MAX_INPUT_BYTES,
      100000
    ),
    max_output_bytes: positiveInteger(
      definition.max_output_bytes,
      DEFAULT_MAX_OUTPUT_BYTES,
      500000
    ),
    timeout_ms: positiveInteger(
      definition.timeout_ms,
      DEFAULT_TOOL_TIMEOUT_MS,
      30000
    ),
    handler,
  });
}

function publicToolDefinition(tool) {
  return Object.freeze({
    key: tool.key,
    title: tool.title,
    description: tool.description,
    version: tool.version,
    risk_level: tool.risk_level,
    personas: [...tool.personas],
    required_permissions: [...tool.required_permissions],
    required_business_permissions: [...tool.required_business_permissions],
    required_equipment_division: tool.required_equipment_division,
    allowed_workspaces: [...tool.allowed_workspaces],
    scope_requirements: { ...tool.scope_requirements },
    input_schema: tool.input_schema,
    evidence_required: tool.evidence_required,
    max_input_bytes: tool.max_input_bytes,
    max_output_bytes: tool.max_output_bytes,
    timeout_ms: tool.timeout_ms,
  });
}

function safeSummary(value, maxCharacters = 2000) {
  const text = JSON.stringify(value ?? null);
  return text.length <= maxCharacters
    ? JSON.parse(text)
    : { truncated: true, sha256: hashJson(value), serialized_characters: text.length };
}

function withTimeout(promise, timeoutMs, toolKey) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new AiToolRegistryError(`AI tool ${toolKey} exceeded its timeout.`, {
          code: "AI_TOOL_TIMEOUT",
          statusCode: 504,
        })
      );
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class AiToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(definition) {
    const tool = normalizeToolDefinition(definition);
    if (this.tools.has(tool.key)) {
      throw new AiToolRegistryError(`AI tool ${tool.key} is already registered.`, {
        code: "AI_TOOL_DUPLICATE",
      });
    }
    this.tools.set(tool.key, tool);
    return publicToolDefinition(tool);
  }

  get(toolKey) {
    const key = String(toolKey || "").trim().toLowerCase();
    const tool = this.tools.get(key);
    if (!tool) {
      throw new AiToolRegistryError("Requested AI tool is not registered.", {
        code: "AI_TOOL_NOT_FOUND",
        statusCode: 404,
      });
    }
    return tool;
  }

  list({ persona = null, workspace = null } = {}) {
    const normalizedPersona = persona ? normalizeAiPersona(persona) : null;
    return [...this.tools.values()]
      .filter(
        (tool) =>
          (!normalizedPersona || tool.personas.includes(normalizedPersona)) &&
          (!workspace ||
            tool.allowed_workspaces.length === 0 ||
            tool.allowed_workspaces.includes(workspace))
      )
      .map(publicToolDefinition)
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async execute({ toolKey, input = {}, req, persona }) {
    const tool = this.get(toolKey);
    const normalizedPersona = normalizeAiPersona(persona);
    if (!normalizedPersona || !tool.personas.includes(normalizedPersona)) {
      throw new AiPermissionError("This tool is not allowed for the selected AI persona.", {
        code: "AI_TOOL_PERSONA_DENIED",
      });
    }

    // Risk authority is derived from the authenticated login before a handler
    // can run. Risk 5 is therefore impossible for a non-original System
    // Administrator even if a future tool is accidentally registered with
    // insufficient permission metadata.
    assertAiRiskAuthorized(req?.user || {}, tool.risk_level);

    if (tool.risk_level >= 4 && !isFeatureEnabled("aiActions")) {
      throw new AiPermissionError(
        "AI execution actions are disabled. Only read, recommendation and draft tools are available.",
        { code: "AI_ACTIONS_DISABLED", statusCode: 404 }
      );
    }

    const groundedInput = groundRelativeDateInput({ tool, input, req });
    const inputBytes = serializedBytes(groundedInput);
    if (inputBytes > tool.max_input_bytes) {
      throw new AiToolRegistryError("AI tool input exceeded its safe size limit.", {
        code: "AI_TOOL_INPUT_TOO_LARGE",
        statusCode: 413,
        details: { input_bytes: inputBytes, limit_bytes: tool.max_input_bytes },
      });
    }

    const context = buildToolExecutionContext({ req, persona: normalizedPersona, tool });
    await validateAiScopeAccess({ req, scope: context.scope, tool });

    const started = Date.now();
    const output = await withTimeout(
      Promise.resolve(tool.handler(Object.freeze({ input: groundedInput, context }))),
      tool.timeout_ms,
      tool.key
    );
    const outputBytes = serializedBytes(output);
    if (outputBytes > tool.max_output_bytes) {
      throw new AiToolRegistryError("AI tool output exceeded its safe size limit.", {
        code: "AI_TOOL_OUTPUT_TOO_LARGE",
        statusCode: 502,
        details: { output_bytes: outputBytes, limit_bytes: tool.max_output_bytes },
      });
    }

    return Object.freeze({
      tool: publicToolDefinition(tool),
      input_sha256: hashJson(groundedInput),
      input_summary: safeSummary(groundedInput),
      output,
      output_summary: safeSummary(output),
      latency_ms: Date.now() - started,
      scope: context.scope,
    });
  }
}

const aiToolRegistry = new AiToolRegistry();

module.exports = {
  AiToolRegistry,
  AiToolRegistryError,
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TOOL_TIMEOUT_MS,
  EQUIPMENT_DIVISION_VALUES,
  FORBIDDEN_HANDLER_SOURCE,
  RELATIVE_DATE_RANGE_PATTERN,
  TODAY_SIGNAL_PATTERN,
  TOOL_KEY_PATTERN,
  YESTERDAY_SIGNAL_PATTERN,
  aiToolRegistry,
  groundRelativeDateInput,
  hashJson,
  normalizeToolDefinition,
  publicToolDefinition,
  requestPrompt,
  safeSummary,
  serializedBytes,
  shiftedUtcDateOnly,
  toolAcceptsDateWindow,
  utcDateOnly,
  withTimeout,
};
