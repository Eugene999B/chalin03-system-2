"use strict";

const { pool } = require("../config/db");
const { isOriginalSystemAdministrator } = require("../security/systemAdminIdentity");
const { renameConversation } = require("./aiConversationService");
const { secureDeactivateUser } = require("./userIdentityPreservationService");
const {
  executeCustomerDebtReminder,
  executeOutboundSms,
  validateCustomerDebtReminder,
  validateOutboundSms,
} = require("./aiCommunicationActionAdapters");

const EXECUTOR_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

class AiActionExecutorError extends Error {
  constructor(message, { code = "AI_ACTION_EXECUTOR_ERROR", statusCode = 400, details = [] } = {}) {
    super(message);
    this.name = "AiActionExecutorError";
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

function validateConversationRename(input = {}) {
  const conversationKey = clean(input.conversation_key, 100);
  const title = clean(input.title, 180);
  if (!conversationKey || !title) {
    throw new AiActionExecutorError("Conversation key and new title are required.", {
      code: "AI_ACTION_INPUT_INVALID",
    });
  }
  return Object.freeze({ conversation_key: conversationKey, title });
}

function validateUserDeactivation(input = {}) {
  const targetUserId = positiveInteger(input.target_user_id);
  const reason = clean(input.reason, 500);
  if (!targetUserId || !reason) {
    throw new AiActionExecutorError("Target user ID and a clear offboarding reason are required.", {
      code: "AI_ACTION_INPUT_INVALID",
    });
  }
  return Object.freeze({ target_user_id: targetUserId, reason });
}

class AiActionExecutorRegistry {
  constructor() {
    this.executors = new Map();
  }

  register({ key, validate, execute }) {
    const normalizedKey = clean(key, 140).toLowerCase();
    if (!EXECUTOR_KEY_PATTERN.test(normalizedKey)) {
      throw new AiActionExecutorError("AI action executor key is invalid.", {
        code: "AI_ACTION_EXECUTOR_KEY_INVALID",
      });
    }
    if (typeof validate !== "function" || typeof execute !== "function") {
      throw new AiActionExecutorError("AI action executors require validation and execution functions.", {
        code: "AI_ACTION_EXECUTOR_INVALID",
      });
    }
    if (this.executors.has(normalizedKey)) {
      throw new AiActionExecutorError(`AI action executor ${normalizedKey} is already registered.`, {
        code: "AI_ACTION_EXECUTOR_DUPLICATE",
        statusCode: 409,
      });
    }
    this.executors.set(
      normalizedKey,
      Object.freeze({ key: normalizedKey, validate, execute })
    );
    return normalizedKey;
  }

  get(key) {
    return this.executors.get(clean(key, 140).toLowerCase()) || null;
  }

  list() {
    return Object.freeze([...this.executors.keys()].sort());
  }
}

const aiActionExecutorRegistry = new AiActionExecutorRegistry();

aiActionExecutorRegistry.register({
  key: "intelligence.conversation.rename",
  validate: validateConversationRename,
  async execute({ input, user }) {
    await renameConversation({
      conversationKey: input.conversation_key,
      userId: Number(user.id),
      title: input.title,
    });
    return Object.freeze({
      renamed: true,
      conversation_key: input.conversation_key,
      title: input.title,
    });
  },
});

aiActionExecutorRegistry.register({
  key: "communications.sms.send",
  validate: validateOutboundSms,
  execute: executeOutboundSms,
});

aiActionExecutorRegistry.register({
  key: "spare_parts.debt_reminder.send",
  validate: validateCustomerDebtReminder,
  execute: executeCustomerDebtReminder,
});

aiActionExecutorRegistry.register({
  key: "system.user.deactivate",
  validate: validateUserDeactivation,
  async execute({ input, user }) {
    if (!isOriginalSystemAdministrator(user)) {
      throw new AiActionExecutorError(
        "Risk Level 5 secure user deactivation is reserved for the protected System Administrator.",
        { code: "AI_ACTION_RISK5_SYSTEM_ADMIN_REQUIRED", statusCode: 403 }
      );
    }
    if (Number(input.target_user_id) === Number(user.id)) {
      throw new AiActionExecutorError(
        "The protected System Administrator cannot deactivate its own active account through CHALIN Intelligence.",
        { code: "AI_ACTION_SELF_DEACTIVATION_BLOCKED", statusCode: 409 }
      );
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await secureDeactivateUser(connection, {
        targetUserId: input.target_user_id,
        actorUserId: Number(user.id),
        reason: input.reason,
      });
      await connection.commit();
      return Object.freeze(result);
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original business-service failure.
      }
      throw error;
    } finally {
      connection.release();
    }
  },
});

function executorForDefinition(definition) {
  const executorKey = clean(definition?.executor_key, 140).toLowerCase();
  if (!executorKey) return null;
  const executor = aiActionExecutorRegistry.get(executorKey);
  if (!executor) {
    throw new AiActionExecutorError("The approved action executor adapter is not registered.", {
      code: "AI_ACTION_EXECUTOR_NOT_FOUND",
      statusCode: 503,
      details: [executorKey],
    });
  }
  return executor;
}

function validateActionPayload(definition, payload = {}) {
  const executor = executorForDefinition(definition);
  if (!executor) return Object.freeze(payload && typeof payload === "object" ? { ...payload } : {});
  return executor.validate(payload);
}

async function executeActionDefinition({ definition, payload = {}, user, proposal, req = null } = {}) {
  const executor = executorForDefinition(definition);
  if (!executor) {
    throw new AiActionExecutorError("This action definition is proposal-only and has no executor.", {
      code: "AI_ACTION_EXECUTION_NOT_AVAILABLE",
      statusCode: 409,
    });
  }
  const input = executor.validate(payload);
  return executor.execute({ input, user, proposal, req });
}

module.exports = {
  EXECUTOR_KEY_PATTERN,
  AiActionExecutorError,
  AiActionExecutorRegistry,
  aiActionExecutorRegistry,
  clean,
  executeActionDefinition,
  executorForDefinition,
  positiveInteger,
  validateActionPayload,
  validateConversationRename,
  validateUserDeactivation,
};