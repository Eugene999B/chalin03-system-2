"use strict";

const { normalizeAiPersona, normalizeAiWorkspace } = require("../security/aiPermissionCatalog");
const { ALL_PERMISSIONS } = require("../security/permissionCatalog");

const ACTION_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const EXECUTOR_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const MAX_ACTION_DEFINITIONS = 200;
const REVIEW_MODES = Object.freeze(["auto", "independent", "system_admin"]);
const CONFIRMATION_MODES = Object.freeze(["none", "explicit", "risk5_exact"]);

class AiActionRegistryError extends Error {
  constructor(message, { code = "AI_ACTION_REGISTRY_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiActionRegistryError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength) || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeDefinition(input = {}) {
  const key = clean(input.key, 140)?.toLowerCase();
  const version = clean(input.version || "1", 40);
  const riskLevel = Number(input.risk_level);
  const personas = unique((input.personas || []).map(normalizeAiPersona).filter(Boolean));
  const workspaces = unique((input.allowed_workspaces || []).map(normalizeAiWorkspace).filter(Boolean));
  const requiredPermissions = unique(
    (input.required_permissions || [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const requiredBusinessPermissions = unique(
    (input.required_business_permissions || [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const executorKey = clean(input.executor_key, 140)?.toLowerCase() || null;
  const defaultReviewMode = riskLevel >= 5 ? "system_admin" : riskLevel >= 4 ? "independent" : "auto";
  const reviewMode = REVIEW_MODES.includes(input.review_mode) ? input.review_mode : defaultReviewMode;
  const defaultConfirmation = riskLevel >= 5 ? "risk5_exact" : riskLevel >= 4 ? "explicit" : "none";
  const confirmationMode = CONFIRMATION_MODES.includes(input.confirmation_mode)
    ? input.confirmation_mode
    : defaultConfirmation;

  if (!key || !ACTION_KEY_PATTERN.test(key) || !version) {
    throw new AiActionRegistryError("Action key and version are invalid.", {
      code: "AI_ACTION_DEFINITION_INVALID",
    });
  }
  if (!Number.isInteger(riskLevel) || riskLevel < 1 || riskLevel > 5) {
    throw new AiActionRegistryError("Action risk level must be from 1 to 5.", {
      code: "AI_ACTION_RISK_INVALID",
    });
  }
  if (personas.length === 0 || workspaces.length === 0) {
    throw new AiActionRegistryError(
      "Action definitions require explicit personas and workspaces.",
      { code: "AI_ACTION_SCOPE_REQUIRED" }
    );
  }
  if (requiredPermissions.length === 0) {
    throw new AiActionRegistryError(
      "Action definitions require explicit AI permissions.",
      { code: "AI_ACTION_PERMISSION_REQUIRED" }
    );
  }
  const invalidBusinessPermissions = requiredBusinessPermissions.filter(
    (permission) => !ALL_PERMISSIONS.includes(permission)
  );
  if (invalidBusinessPermissions.length) {
    throw new AiActionRegistryError(
      "Action definitions may require only registered CHALIN business permissions.",
      {
        code: "AI_ACTION_BUSINESS_PERMISSION_INVALID",
        details: invalidBusinessPermissions,
      }
    );
  }
  if (
    typeof input.execute === "function" ||
    typeof input.handler === "function" ||
    typeof input.run === "function"
  ) {
    throw new AiActionRegistryError(
      "Action definitions cannot embed executor functions. Use an approved executor_key adapter.",
      { code: "AI_ACTION_EXECUTOR_PROHIBITED", statusCode: 409 }
    );
  }
  if (executorKey && !EXECUTOR_KEY_PATTERN.test(executorKey)) {
    throw new AiActionRegistryError("Action executor key is invalid.", {
      code: "AI_ACTION_EXECUTOR_KEY_INVALID",
    });
  }
  if (riskLevel === 5 && input.system_admin_only === false) {
    throw new AiActionRegistryError("Risk Level 5 actions must remain System Administrator only.", {
      code: "AI_ACTION_RISK5_SYSTEM_ADMIN_REQUIRED",
      statusCode: 409,
    });
  }

  return Object.freeze({
    key,
    version,
    title: clean(input.title, 255) || key,
    description: clean(input.description, 1000),
    risk_level: riskLevel,
    personas: Object.freeze(personas),
    allowed_workspaces: Object.freeze(workspaces),
    required_permissions: Object.freeze(requiredPermissions),
    required_business_permissions: Object.freeze(requiredBusinessPermissions),
    evidence_required: input.evidence_required !== false,
    maximum_expiry_hours: Math.max(
      1,
      Math.min(168, Number(input.maximum_expiry_hours || 24))
    ),
    input_schema: Object.freeze(input.input_schema || { type: "object" }),
    review_mode: reviewMode,
    confirmation_mode: confirmationMode,
    system_admin_only: input.system_admin_only === true || riskLevel === 5,
    executor_key: executorKey,
    output_authority: executorKey ? "reviewed_execution" : "proposal_only",
    execution_available: Boolean(executorKey),
  });
}

class AiActionRegistry {
  constructor() {
    this.definitions = new Map();
  }

  register(input) {
    if (this.definitions.size >= MAX_ACTION_DEFINITIONS) {
      throw new AiActionRegistryError("Action registry capacity was reached.", {
        code: "AI_ACTION_REGISTRY_LIMIT_REACHED",
        statusCode: 503,
      });
    }
    const definition = normalizeDefinition(input);
    if (this.definitions.has(definition.key)) {
      throw new AiActionRegistryError(
        `Action definition ${definition.key} is already registered.`,
        { code: "AI_ACTION_DEFINITION_DUPLICATE", statusCode: 409 }
      );
    }
    this.definitions.set(definition.key, definition);
    return definition;
  }

  get(key) {
    return this.definitions.get(String(key || "").trim().toLowerCase()) || null;
  }

  list({ persona = null, workspace = null } = {}) {
    const normalizedPersona = normalizeAiPersona(persona);
    const normalizedWorkspace = normalizeAiWorkspace(workspace);
    return [...this.definitions.values()]
      .filter(
        (definition) =>
          (!normalizedPersona || definition.personas.includes(normalizedPersona)) &&
          (!normalizedWorkspace ||
            definition.allowed_workspaces.includes(normalizedWorkspace))
      )
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  clear() {
    this.definitions.clear();
  }
}

const aiActionRegistry = new AiActionRegistry();

module.exports = {
  ACTION_KEY_PATTERN,
  CONFIRMATION_MODES,
  EXECUTOR_KEY_PATTERN,
  MAX_ACTION_DEFINITIONS,
  REVIEW_MODES,
  AiActionRegistry,
  AiActionRegistryError,
  aiActionRegistry,
  normalizeDefinition,
};