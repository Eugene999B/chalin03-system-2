"use strict";

const { normalizeAiPersona, normalizeAiWorkspace } = require("../security/aiPermissionCatalog");

const ACTION_KEY_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/;
const MAX_ACTION_DEFINITIONS = 200;

class AiActionRegistryError extends Error {
  constructor(message, { code = "AI_ACTION_REGISTRY_ERROR", statusCode = 400 } = {}) {
    super(message);
    this.name = "AiActionRegistryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function clean(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength) || null;
}

function normalizeDefinition(input = {}) {
  const key = clean(input.key, 140)?.toLowerCase();
  const version = clean(input.version || "1", 40);
  const riskLevel = Number(input.risk_level);
  const personas = [...new Set((input.personas || []).map(normalizeAiPersona).filter(Boolean))];
  const workspaces = [...new Set((input.allowed_workspaces || []).map(normalizeAiWorkspace).filter(Boolean))];
  const requiredPermissions = [...new Set((input.required_permissions || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];

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
      "Action definitions require explicit permissions.",
      { code: "AI_ACTION_PERMISSION_REQUIRED" }
    );
  }
  if (
    typeof input.execute === "function" ||
    typeof input.handler === "function" ||
    typeof input.run === "function"
  ) {
    throw new AiActionRegistryError(
      "This release accepts action metadata only and prohibits executor functions.",
      { code: "AI_ACTION_EXECUTOR_PROHIBITED", statusCode: 409 }
    );
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
    evidence_required: input.evidence_required !== false,
    maximum_expiry_hours: Math.max(
      1,
      Math.min(168, Number(input.maximum_expiry_hours || 24))
    ),
    input_schema: Object.freeze(input.input_schema || { type: "object" }),
    output_authority: "proposal_only",
    execution_available: false,
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
  MAX_ACTION_DEFINITIONS,
  AiActionRegistry,
  AiActionRegistryError,
  aiActionRegistry,
  normalizeDefinition,
};
