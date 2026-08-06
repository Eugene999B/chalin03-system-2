"use strict";

const {
  normalizeAiPersona,
  normalizeAiWorkspace,
} = require("../security/aiPermissionCatalog");

const JOB_KEY_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/;
const MAX_JOB_DEFINITIONS = 100;

class AiScheduledJobRegistryError extends Error {
  constructor(
    message,
    {
      code = "AI_SCHEDULED_JOB_REGISTRY_ERROR",
      statusCode = 400,
    } = {}
  ) {
    super(message);
    this.name = "AiScheduledJobRegistryError";
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
  const personas = [
    ...new Set(
      (input.personas || []).map(normalizeAiPersona).filter(Boolean)
    ),
  ];
  const workspaces = [
    ...new Set(
      (input.allowed_workspaces || [])
        .map(normalizeAiWorkspace)
        .filter(Boolean)
    ),
  ];
  const requiredPermissions = [
    ...new Set(
      (input.required_permissions || [])
        .map((permission) =>
          String(permission || "").trim().toLowerCase()
        )
        .filter(Boolean)
    ),
  ];

  if (!key || !JOB_KEY_PATTERN.test(key) || !version) {
    throw new AiScheduledJobRegistryError(
      "Scheduled intelligence job key and version are invalid.",
      { code: "AI_SCHEDULED_JOB_DEFINITION_INVALID" }
    );
  }
  if (personas.length === 0 || workspaces.length === 0) {
    throw new AiScheduledJobRegistryError(
      "Scheduled intelligence definitions require explicit personas and workspaces.",
      { code: "AI_SCHEDULED_JOB_SCOPE_REQUIRED" }
    );
  }
  if (requiredPermissions.length === 0) {
    throw new AiScheduledJobRegistryError(
      "Scheduled intelligence definitions require explicit permissions.",
      { code: "AI_SCHEDULED_JOB_PERMISSION_REQUIRED" }
    );
  }
  if (
    typeof input.execute === "function" ||
    typeof input.handler === "function" ||
    typeof input.run === "function" ||
    typeof input.deliver === "function"
  ) {
    throw new AiScheduledJobRegistryError(
      "This release accepts schedule metadata only and prohibits runner or delivery functions.",
      { code: "AI_SCHEDULED_JOB_RUNNER_PROHIBITED", statusCode: 409 }
    );
  }

  return Object.freeze({
    key,
    version,
    title: clean(input.title, 255) || key,
    description: clean(input.description, 1000),
    personas: Object.freeze(personas),
    allowed_workspaces: Object.freeze(workspaces),
    required_permissions: Object.freeze(requiredPermissions),
    evidence_required: input.evidence_required !== false,
    minimum_interval_minutes: Math.max(
      60,
      Math.min(43200, Number(input.minimum_interval_minutes || 1440))
    ),
    input_schema: Object.freeze(
      input.input_schema || { type: "object" }
    ),
    output_authority: "approved_schedule_definition_only",
    runner_available: false,
    delivery_available: false,
  });
}

class AiScheduledJobRegistry {
  constructor() {
    this.definitions = new Map();
  }

  register(input) {
    if (this.definitions.size >= MAX_JOB_DEFINITIONS) {
      throw new AiScheduledJobRegistryError(
        "Scheduled intelligence registry capacity was reached.",
        {
          code: "AI_SCHEDULED_JOB_REGISTRY_LIMIT_REACHED",
          statusCode: 503,
        }
      );
    }
    const definition = normalizeDefinition(input);
    if (this.definitions.has(definition.key)) {
      throw new AiScheduledJobRegistryError(
        `Scheduled intelligence definition ${definition.key} is already registered.`,
        {
          code: "AI_SCHEDULED_JOB_DEFINITION_DUPLICATE",
          statusCode: 409,
        }
      );
    }
    this.definitions.set(definition.key, definition);
    return definition;
  }

  get(key) {
    return (
      this.definitions.get(String(key || "").trim().toLowerCase()) || null
    );
  }

  list({ persona = null, workspace = null } = {}) {
    const normalizedPersona = normalizeAiPersona(persona);
    const normalizedWorkspace = normalizeAiWorkspace(workspace);
    return [...this.definitions.values()]
      .filter(
        (definition) =>
          (!normalizedPersona ||
            definition.personas.includes(normalizedPersona)) &&
          (!normalizedWorkspace ||
            definition.allowed_workspaces.includes(normalizedWorkspace))
      )
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  clear() {
    this.definitions.clear();
  }
}

const aiScheduledJobRegistry = new AiScheduledJobRegistry();

module.exports = {
  JOB_KEY_PATTERN,
  MAX_JOB_DEFINITIONS,
  AiScheduledJobRegistry,
  AiScheduledJobRegistryError,
  aiScheduledJobRegistry,
  normalizeDefinition,
};
