"use strict";

const { pool } = require("../config/db");
const { hasEveryPermission } = require("../security/permissionCatalog");
const {
  hasEveryAiPermission,
  normalizeAiPersona,
} = require("../security/aiPermissionCatalog");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const {
  resolveAiAuthorityProfile,
} = require("./aiCapabilityService");
const { renameConversation } = require("./aiConversationService");
const { secureDeactivateUser } = require("./userIdentityPreservationService");

const ACTION_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,139}$/;
const ACTION_RISK_MIN = 2;
const ACTION_RISK_MAX = 5;

class AiActionRegistryError extends Error {
  constructor(message, { code = "AI_ACTION_REGISTRY_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiActionRegistryError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function clean(value, maximum = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeActionDefinition(definition = {}) {
  const key = clean(definition.key, 140).toLowerCase();
  const title = clean(definition.title, 180);
  const description = clean(definition.description, 1000);
  const version = clean(definition.version || "1", 40) || "1";
  const riskLevel = Number(definition.risk_level);
  const personas = [...new Set((definition.personas || []).map(normalizeAiPersona).filter(Boolean))];
  const requiredAiPermissions = [...new Set((definition.required_ai_permissions || []).map((item) => clean(item, 120)).filter(Boolean))];
  const requiredBusinessPermissions = [...new Set((definition.required_business_permissions || []).map((item) => clean(item, 120)).filter(Boolean))];
  const allowedWorkspaces = [...new Set((definition.allowed_workspaces || []).map((item) => clean(item, 80).toLowerCase()).filter(Boolean))];
  const confirmationMode = ["none", "explicit", "risk5_exact"].includes(definition.confirmation_mode)
    ? definition.confirmation_mode
    : riskLevel >= 5
      ? "risk5_exact"
      : riskLevel >= 4
        ? "explicit"
        : "none";

  if (!ACTION_KEY_PATTERN.test(key) || !title || !description) {
    throw new AiActionRegistryError("AI actions require a safe key, title and description.", {
      code: "AI_ACTION_DEFINITION_INVALID",
    });
  }
  if (!Number.isInteger(riskLevel) || riskLevel < ACTION_RISK_MIN || riskLevel > ACTION_RISK_MAX) {
    throw new AiActionRegistryError("AI action risk level must be between 2 and 5.", {
      code: "AI_ACTION_RISK_INVALID",
    });
  }
  if (!personas.length) {
    throw new AiActionRegistryError("AI actions require at least one staff persona.", {
      code: "AI_ACTION_PERSONA_REQUIRED",
    });
  }
  if (typeof definition.validate_input !== "function" || typeof definition.execute !== "function") {
    throw new AiActionRegistryError("AI actions require input validation and an approved executor.", {
      code: "AI_ACTION_HANDLER_REQUIRED",
    });
  }

  return Object.freeze({
    key,
    title,
    description,
    version,
    risk_level: riskLevel,
    personas: Object.freeze(personas),
    required_ai_permissions: Object.freeze(requiredAiPermissions),
    required_business_permissions: Object.freeze(requiredBusinessPermissions),
    allowed_workspaces: Object.freeze(allowedWorkspaces),
    system_admin_only: definition.system_admin_only === true || riskLevel === 5,
    confirmation_mode: confirmationMode,
    max_payload_bytes: Math.max(1000, Math.min(50000, Number(definition.max_payload_bytes) || 12000)),
    validate_input: definition.validate_input,
    execute: definition.execute,
  });
}

function publicActionDefinition(action) {
  return Object.freeze({
    key: action.key,
    title: action.title,
    description: action.description,
    version: action.version,
    risk_level: action.risk_level,
    personas: [...action.personas],
    required_ai_permissions: [...action.required_ai_permissions],
    required_business_permissions: [...action.required_business_permissions],
    allowed_workspaces: [...action.allowed_workspaces],
    system_admin_only: action.system_admin_only,
    confirmation_mode: action.confirmation_mode,
    max_payload_bytes: action.max_payload_bytes,
  });
}

function assertActionAuthority({ action, user, persona, workspaceCode = null, phase = "propose" }) {
  const normalizedPersona = normalizeAiPersona(persona);
  if (!normalizedPersona || !action.personas.includes(normalizedPersona)) {
    throw new AiActionRegistryError("This action is not allowed for the selected CHALIN Intelligence persona.", {
      code: "AI_ACTION_PERSONA_DENIED",
      statusCode: 403,
    });
  }
  const authority = resolveAiAuthorityProfile(user);
  if (Number(action.risk_level) > Number(authority.risk_ceiling || 0)) {
    throw new AiActionRegistryError("The logged-in account is not authorized for this AI action risk level.", {
      code: "AI_ACTION_RISK_CEILING_DENIED",
      statusCode: 403,
      details: { action_risk: action.risk_level, risk_ceiling: authority.risk_ceiling },
    });
  }
  if (action.system_admin_only && !isOriginalSystemAdministrator(user)) {
    throw new AiActionRegistryError("This Risk-5 enterprise action is reserved for the protected System Administrator.", {
      code: "AI_ACTION_SYSTEM_ADMIN_REQUIRED",
      statusCode: 403,
    });
  }
  const phasePermission = {
    propose: "ai.actions.propose",
    review: "ai.actions.review",
    execute: "ai.actions.execute",
  }[phase];
  const aiPermissions = [...action.required_ai_permissions, phasePermission].filter(Boolean);
  if (!hasEveryAiPermission(user, aiPermissions)) {
    throw new AiActionRegistryError("The logged-in account does not have the required AI action permissions.", {
      code: "AI_ACTION_PERMISSION_DENIED",
      statusCode: 403,
      details: aiPermissions,
    });
  }
  if (!hasEveryPermission(user, action.required_business_permissions || [])) {
    throw new AiActionRegistryError("The logged-in account does not have the required business permissions for this action.", {
      code: "AI_ACTION_BUSINESS_PERMISSION_DENIED",
      statusCode: 403,
      details: action.required_business_permissions,
    });
  }
  if (
    action.allowed_workspaces.length > 0 &&
    workspaceCode &&
    !action.allowed_workspaces.includes(String(workspaceCode).toLowerCase())
  ) {
    throw new AiActionRegistryError("This AI action is not available in the selected workspace.", {
      code: "AI_ACTION_WORKSPACE_DENIED",
      statusCode: 403,
      details: { workspace_code: workspaceCode, allowed_workspaces: action.allowed_workspaces },
    });
  }
  return Object.freeze({ authority, phase_permission: phasePermission });
}

class AiActionRegistry {
  constructor() {
    this.actions = new Map();
  }

  register(definition) {
    const action = normalizeActionDefinition(definition);
    if (this.actions.has(action.key)) {
      throw new AiActionRegistryError(`AI action ${action.key} is already registered.`, {
        code: "AI_ACTION_DUPLICATE",
      });
    }
    this.actions.set(action.key, action);
    return publicActionDefinition(action);
  }

  get(actionKey) {
    const key = clean(actionKey, 140).toLowerCase();
    const action = this.actions.get(key);
    if (!action) {
      throw new AiActionRegistryError("Requested AI action is not registered.", {
        code: "AI_ACTION_NOT_FOUND",
        statusCode: 404,
      });
    }
    return action;
  }

  list({ persona = null } = {}) {
    const normalizedPersona = persona ? normalizeAiPersona(persona) : null;
    return [...this.actions.values()]
      .filter((action) => !normalizedPersona || action.personas.includes(normalizedPersona))
      .map(publicActionDefinition)
      .sort((left, right) => left.key.localeCompare(right.key));
  }
}

const aiActionRegistry = new AiActionRegistry();

function registerBuiltInAiActions() {
  if (aiActionRegistry.actions.size > 0) return aiActionRegistry.list();

  aiActionRegistry.register({
    key: "intelligence.conversation.rename",
    title: "Rename intelligence conversation",
    description: "Rename an owned CHALIN Intelligence conversation without changing business records.",
    risk_level: 3,
    personas: ["copilot", "executive"],
    required_ai_permissions: ["ai.conversations.manage"],
    required_business_permissions: [],
    confirmation_mode: "none",
    validate_input(input = {}) {
      const conversationKey = clean(input.conversation_key, 100);
      const title = clean(input.title, 180);
      if (!conversationKey || !title) {
        throw new AiActionRegistryError("Conversation key and new title are required.", {
          code: "AI_ACTION_INPUT_INVALID",
        });
      }
      return Object.freeze({ conversation_key: conversationKey, title });
    },
    async execute({ input, actor }) {
      await renameConversation({
        conversationKey: input.conversation_key,
        userId: actor.id,
        title: input.title,
      });
      return Object.freeze({
        renamed: true,
        conversation_key: input.conversation_key,
        title: input.title,
      });
    },
  });

  aiActionRegistry.register({
    key: "system.user.deactivate",
    title: "Securely deactivate user",
    description: "Risk-5 secure offboarding: deactivate an account while preserving identity/history and revoking access, overrides and sessions.",
    risk_level: 5,
    personas: ["copilot", "executive"],
    required_ai_permissions: [],
    required_business_permissions: ["users.manage", "security.admin"],
    system_admin_only: true,
    confirmation_mode: "risk5_exact",
    validate_input(input = {}) {
      const targetUserId = positiveInteger(input.target_user_id);
      const reason = clean(input.reason, 500);
      if (!targetUserId || !reason) {
        throw new AiActionRegistryError("Target user ID and an offboarding reason are required.", {
          code: "AI_ACTION_INPUT_INVALID",
        });
      }
      return Object.freeze({ target_user_id: targetUserId, reason });
    },
    async execute({ input, actor }) {
      if (Number(input.target_user_id) === Number(actor.id)) {
        throw new AiActionRegistryError("The protected System Administrator cannot deactivate its own active session through CHALIN Intelligence.", {
          code: "AI_ACTION_SELF_DEACTIVATION_BLOCKED",
          statusCode: 409,
        });
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await secureDeactivateUser(connection, {
          targetUserId: input.target_user_id,
          actorUserId: actor.id,
          reason: input.reason,
        });
        await connection.commit();
        return Object.freeze(result);
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original executor error.
        }
        throw error;
      } finally {
        connection.release();
      }
    },
  });

  return aiActionRegistry.list();
}

registerBuiltInAiActions();

module.exports = {
  ACTION_KEY_PATTERN,
  ACTION_RISK_MAX,
  ACTION_RISK_MIN,
  AiActionRegistry,
  AiActionRegistryError,
  aiActionRegistry,
  assertActionAuthority,
  clean,
  normalizeActionDefinition,
  positiveInteger,
  publicActionDefinition,
  registerBuiltInAiActions,
};
